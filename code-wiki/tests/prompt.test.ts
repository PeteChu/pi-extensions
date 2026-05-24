import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../src/args";
import {
  parseExplicitDetailLevelOption,
  resolveDetailLevel,
} from "../src/detail-level";
import { getFormatAdapter } from "../src/obsidian";
import {
  buildInitPrompt,
  buildQueryPrompt,
  buildUpdatePrompt,
} from "../src/prompt";
import type { PromptContext } from "../src/prompt-types";
import { mergeCodeWikiSettings } from "../src/settings";

const generatedDate = "2026-05-24";

const minimalCtx: PromptContext = {
  repoRoot: "/home/user/repo",
  targetDir: "/home/user/repo",
  wikiDir: "/home/user/repo/docs/code-wiki",
  wikiRel: "docs/code-wiki",
  projectName: "test-project",
  language: "english",
  format: "standard",
  detailLevel: "standard",
  maxSize: 100000,
  includePatterns: ["*.ts"],
  excludePatterns: [],
  fileList: ["src/index.ts", "src/lib.ts"],
  changedFiles: [],
  profile: {
    extensionCounts: { ".ts": 2 },
    totalFiles: 2,
    totalDirs: 1,
    configFiles: ["package.json", "tsconfig.json"],
  },
  commit: "abc1234",
  generatedAt: "2026-05-24T10:00:00.000Z",
  generatedDate,
  formatRulesText: "",
};

describe("buildInitPrompt", () => {
  it("includes project name", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("test-project"));
  });

  it("includes wiki output directory", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("docs/code-wiki"));
  });

  it("includes the numbered file list", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("0  src/index.ts"));
    assert.ok(out.includes("1  src/lib.ts"));
  });

  it("includes the project profile summary", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("Project profile"));
    assert.ok(out.includes("2 files across 1 directories"));
  });

  it("includes auto-selected include patterns", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("*.ts"));
  });

  it('includes "Step 1" through "Step 6" headings', () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("Step 1"));
    assert.ok(out.includes("Step 2"));
    assert.ok(out.includes("Step 3"));
    assert.ok(out.includes("Step 4"));
    assert.ok(out.includes("Step 5"));
    assert.ok(out.includes("Step 6"));
  });

  it("includes metadata JSON template with generatedFiles array", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes('"generatedFiles"'));
  });

  it("includes the common rules section", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("Important Rules"));
    assert.ok(out.includes("Read actual files"));
  });

  it("does NOT include scope enforcement note when targetDir equals repoRoot", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(!out.includes("Target scope is enforced"));
  });

  it("includes scope enforcement note when targetDir differs from repoRoot", () => {
    const ctx = {
      ...minimalCtx,
      targetDir: "/home/user/repo/packages/backend",
    };
    const out = buildInitPrompt(ctx);
    assert.ok(out.includes("Target scope is enforced"));
  });
});

describe("Detail Level", () => {
  it("parses --detail-level as a CLI option", () => {
    const out = parseArgs("init --detail-level=deep");
    assert.equal(out.options["detail-level"], "deep");
  });

  it("accepts valid explicit detail levels", () => {
    assert.deepEqual(parseExplicitDetailLevelOption({ detailLevel: "deep" }), {
      ok: true,
      value: "deep",
    });
  });

  it("rejects invalid explicit detail levels", () => {
    assert.deepEqual(
      parseExplicitDetailLevelOption({ detailLevel: "medium" }),
      {
        ok: false,
        raw: "medium",
      },
    );
  });

  it("resolves explicit detail level before metadata and settings", () => {
    assert.equal(
      resolveDetailLevel({
        explicit: "deep",
        existingMetadataOptions: { detailLevel: "summary" },
        settingsDefault: "exhaustive",
      }),
      "deep",
    );
  });

  it("treats existing metadata without detailLevel as standard", () => {
    assert.equal(
      resolveDetailLevel({
        existingMetadataOptions: { format: "standard" },
        settingsDefault: "deep",
      }),
      "standard",
    );
  });

  it("includes detail level guidance in init, update, and query prompts", () => {
    const ctx: PromptContext = { ...minimalCtx, detailLevel: "deep" };
    const initOut = buildInitPrompt(ctx);
    const updateOut = buildUpdatePrompt(ctx);
    const queryOut = buildQueryPrompt(ctx, "How does it work?");

    for (const out of [initOut, updateOut, queryOut]) {
      assert.ok(out.includes("Selected detail level**: `deep`"));
      assert.ok(out.includes("~1,800–3,500 words"));
    }
    assert.ok(initOut.includes('"detailLevel": "deep"'));
    assert.ok(updateOut.includes('"detailLevel": "deep"'));
    assert.ok(queryOut.includes('"detailLevel": "deep"'));
  });

  it("includes snippet discipline in the prompt and schema", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(out.includes("Code snippets are evidence, not the main content"));
    assert.ok(out.includes("## Snippet Discipline"));
  });
});

describe("Settings maxSize", () => {
  it("derives maxSize from settings", () => {
    assert.equal(
      mergeCodeWikiSettings({ maxSize: 50000 }, undefined).maxSize,
      50000,
    );
  });

  it("ignores non-positive maxSize settings", () => {
    assert.equal(
      mergeCodeWikiSettings({ maxSize: 0 }, undefined).maxSize,
      100000,
    );
  });
});

describe("buildUpdatePrompt", () => {
  it("includes project name", () => {
    const out = buildUpdatePrompt(minimalCtx);
    assert.ok(out.includes("test-project"));
  });

  it("includes 'Incrementally Maintain' in the heading", () => {
    const out = buildUpdatePrompt(minimalCtx);
    assert.ok(out.includes("Incrementally Maintain"));
  });

  it("includes current HEAD commit", () => {
    const out = buildUpdatePrompt(minimalCtx);
    assert.ok(out.includes("abc1234"));
  });

  it("includes changed files section", () => {
    const ctx = { ...minimalCtx, changedFiles: ["src/index.ts"] };
    const out = buildUpdatePrompt(ctx);
    assert.ok(out.includes("0  src/index.ts"));
  });

  it("shows fallback text when no changed files", () => {
    const out = buildUpdatePrompt(minimalCtx);
    assert.ok(out.includes("No changed-file list available"));
  });
});

describe("buildQueryPrompt", () => {
  const question = "How does model selection work?";

  it("includes the question verbatim", () => {
    const out = buildQueryPrompt(minimalCtx, question);
    assert.ok(out.includes(question));
  });

  it("includes 'Answer a Codebase Wiki Query' heading", () => {
    const out = buildQueryPrompt(minimalCtx, question);
    assert.ok(out.includes("Answer a Codebase Wiki Query"));
  });

  it("includes the wiki index file path", () => {
    const out = buildQueryPrompt(minimalCtx, question);
    assert.ok(out.includes("00-index.md"));
  });

  it("includes the answers directory path", () => {
    const out = buildQueryPrompt(minimalCtx, question);
    assert.ok(out.includes("answers/"));
  });

  it("truncates long questions in log instruction", () => {
    const longQ = "A".repeat(100) + "?";
    const out = buildQueryPrompt(minimalCtx, longQ);
    // The truncated version should appear in the log heading instruction
    assert.ok(out.includes("..."));
    assert.ok(!out.includes(longQ + "] query"));
  });
});

describe("Obsidian format", () => {
  const obsidianCtx: PromptContext = {
    ...minimalCtx,
    format: "obsidian",
    formatRulesText: getFormatAdapter("obsidian").getPromptRules(generatedDate),
  };

  it("includes Obsidian wikilink conventions", () => {
    const out = buildInitPrompt(obsidianCtx);
    assert.ok(out.includes("[[wikilinks]]"));
  });

  it("includes frontmatter conventions", () => {
    const out = buildInitPrompt(obsidianCtx);
    assert.ok(out.includes("YAML frontmatter"));
  });

  it("includes callout conventions", () => {
    const out = buildInitPrompt(obsidianCtx);
    assert.ok(out.includes("> [!note]"));
  });

  it("standard format does NOT include Obsidian conventions", () => {
    const out = buildInitPrompt(minimalCtx);
    assert.ok(!out.includes("[[wikilinks]]"));
    assert.ok(!out.includes("YAML frontmatter"));
  });
});
