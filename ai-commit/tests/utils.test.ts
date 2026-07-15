import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GENERATION_MODELS,
  DEFAULT_GENERATION_PROMPT,
  applyNumstatToMetadata,
  buildGenerationPrompt,
  cleanupCommitMessage,
  isConventionalCommitSubject,
  isNoisyFilePath,
  mergeAiCommitSettings,
  parseModelThinkingSuffix,
  parseNameStatusZ,
  parseNumstatZ,
  prepareStagedDiffs,
} from "../utils";

describe("mergeAiCommitSettings", () => {
  it("uses defaults and configured generation model order", () => {
    const settings = mergeAiCommitSettings(undefined, undefined);

    assert.strictEqual(settings.systemPrompt, DEFAULT_GENERATION_PROMPT);
    assert.deepEqual(settings.generationModels, DEFAULT_GENERATION_MODELS);
    assert.match(
      settings.systemPrompt,
      /Generate a concise git commit message/,
    );
    assert.match(settings.systemPrompt, /type\(scope\): description/);
  });

  it("lets project settings override global settings", () => {
    const settings = mergeAiCommitSettings(
      {
        systemPrompt: "global prompt",
        generationModels: [{ provider: "global", id: "slow" }],
        perFileDiffLimit: 100,
        totalDiffLimit: 200,
      },
      {
        generationModels: [{ provider: "project", id: "gpt-5.4-mini" }],
        totalDiffLimit: 300,
      },
    );

    assert.strictEqual(settings.systemPrompt, "global prompt");
    assert.deepEqual(settings.generationModels, [
      { provider: "project", id: "gpt-5.4-mini" },
    ]);
    assert.strictEqual(settings.perFileDiffLimit, 100);
    assert.strictEqual(settings.totalDiffLimit, 300);
  });
});

describe("parseModelThinkingSuffix", () => {
  it("parses every Pi-supported thinking level from the final colon", () => {
    for (const thinkingLevel of [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ] as const) {
      assert.deepEqual(
        parseModelThinkingSuffix(`model:variant:${thinkingLevel}`),
        {
          modelId: "model:variant",
          thinkingLevel,
        },
      );
    }
  });

  it("returns no override when the suffix is absent or unrecognized", () => {
    assert.strictEqual(parseModelThinkingSuffix("gpt-5.6-luna"), undefined);
    assert.strictEqual(
      parseModelThinkingSuffix("gpt-5.6-luna:extreme"),
      undefined,
    );
  });

  it("recognizes off as an explicit level", () => {
    assert.deepEqual(parseModelThinkingSuffix("gpt-5.6-luna:off"), {
      modelId: "gpt-5.6-luna",
      thinkingLevel: "off",
    });
  });
});

describe("staged metadata parsers", () => {
  it("parses name-status records including renames", () => {
    const files = parseNameStatusZ("M\0src/a.ts\0R100\0old.ts\0new.ts\0");

    assert.deepEqual(files, [
      { status: "M", path: "src/a.ts" },
      { status: "R100", oldPath: "old.ts", path: "new.ts" },
    ]);
  });

  it("parses numstat records and applies stats to metadata", () => {
    const stats = parseNumstatZ("10\t2\tsrc/a.ts\0-\t-\timage.png\0");
    const files = applyNumstatToMetadata(
      [
        { status: "M", path: "src/a.ts" },
        { status: "A", path: "image.png" },
      ],
      stats,
    );

    assert.deepEqual(files, [
      {
        status: "M",
        path: "src/a.ts",
        additions: 10,
        deletions: 2,
        binary: false,
      },
      {
        status: "A",
        path: "image.png",
        additions: undefined,
        deletions: undefined,
        binary: true,
      },
    ]);
  });
});

describe("noisy file detection", () => {
  it("detects lockfiles and package manager noise", () => {
    assert.strictEqual(isNoisyFilePath("package-lock.json"), true);
    assert.strictEqual(isNoisyFilePath("apps/web/pnpm-lock.yaml"), true);
    assert.strictEqual(isNoisyFilePath("api/foo-lock.json"), true);
    assert.strictEqual(isNoisyFilePath("src/lock.ts"), false);
  });

  it("supports project skip patterns", () => {
    assert.strictEqual(
      isNoisyFilePath("generated/schema.sql", ["generated/*"]),
      true,
    );
  });
});

describe("prepareStagedDiffs", () => {
  const settings = {
    skipPatterns: ["*-lock.json"],
    perFileDiffLimit: 1_000,
    totalDiffLimit: 1_000,
  };

  it("includes small text diffs", () => {
    const prepared = prepareStagedDiffs(
      [
        {
          status: "M",
          path: "src/a.ts",
          diff: "diff --git a/src/a.ts b/src/a.ts\n+hello",
        },
      ],
      settings,
    );

    assert.strictEqual(prepared[0]?.included, true);
    assert.match(prepared[0]?.diff ?? "", /hello/);
  });

  it("skips noisy, binary, and oversized file diffs", () => {
    const prepared = prepareStagedDiffs(
      [
        { status: "M", path: "foo-lock.json", diff: "+lots" },
        {
          status: "A",
          path: "logo.png",
          binary: true,
          diff: "Binary files differ",
        },
        { status: "M", path: "src/big.ts", diff: "x".repeat(1_001) },
      ],
      settings,
    );

    assert.deepEqual(
      prepared.map((file) => file.skippedReason),
      [
        "matches skip pattern",
        "binary file",
        "diff exceeds per-file limit (1000 chars)",
      ],
    );
  });

  it("truncates at the total diff limit and marks the file", () => {
    const prepared = prepareStagedDiffs(
      [
        { status: "M", path: "src/a.ts", diff: "a".repeat(400) },
        { status: "M", path: "src/b.ts", diff: "b".repeat(800) },
      ],
      settings,
    );

    assert.strictEqual(prepared[0]?.included, true);
    assert.strictEqual(prepared[1]?.included, true);
    assert.strictEqual(prepared[1]?.truncated, true);
    assert.match(prepared[1]?.diff ?? "", /truncated/);
  });
});

describe("prompt assembly", () => {
  it("includes staged-only context and skipped file summaries", () => {
    const prompt = buildGenerationPrompt([
      {
        status: "M",
        path: "src/a.ts",
        additions: 1,
        deletions: 0,
        included: true,
        diff: "+hello",
      },
      {
        status: "M",
        path: "package-lock.json",
        included: false,
        skippedReason: "matches skip pattern",
      },
    ]);

    assert.doesNotMatch(prompt, /Staged files/);
    assert.match(
      prompt,
      /The diffs below are the complete intended commit context/,
    );
    assert.match(prompt, /Infer the main user-facing behavior from the diffs/);
    assert.match(prompt, /```diff\n\+hello/);
    assert.match(prompt, /package-lock\.json: matches skip pattern/);
  });
});

describe("cleanupCommitMessage", () => {
  it("returns a single Conventional Commit subject from markdown output", () => {
    const message = cleanupCommitMessage(
      "```text\nCommit message: Feat(ai-commit): add staged generator.\n```",
    );

    assert.strictEqual(message, "feat(ai-commit): add staged generator");
    assert.strictEqual(isConventionalCommitSubject(message), true);
  });

  it("falls back to chore when the model omits a type", () => {
    assert.strictEqual(
      cleanupCommitMessage("Update the generated README"),
      "chore: update the generated README",
    );
  });

  it("removes prompt-anchored staged wording", () => {
    assert.strictEqual(
      cleanupCommitMessage(
        "feat(ai-commit): add staged commit message generator",
      ),
      "feat(ai-commit): add commit message generator",
    );
    assert.strictEqual(
      cleanupCommitMessage(
        "feat(ai-commit): generate messages from staged changes",
      ),
      "feat(ai-commit): generate messages from changes",
    );
  });
});
