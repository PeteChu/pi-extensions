import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import rewrite, {
  DEFAULT_REWRITE_INSTRUCTION,
  buildRewriteSystemPrompt,
  cleanupRewriteOutput,
  getRewriteSettingsPaths,
  resolveRewriteSettings,
  validateRewriteInput,
} from "../index";

describe("rewrite extension", () => {
  it("exports an extension factory", () => {
    assert.equal(typeof rewrite, "function");
  });

  it("registers the /rewrite command", () => {
    let registeredName = "";
    rewrite({
      registerCommand(name: string) {
        registeredName = name;
      },
    } as never);

    assert.strictEqual(registeredName, "rewrite");
  });
});

describe("getRewriteSettingsPaths", () => {
  it("uses pi's configured agent dir for the global settings path", () => {
    const cwd = "/tmp/project";
    assert.deepEqual(getRewriteSettingsPaths(cwd), {
      globalPath: path.join(getAgentDir(), "settings.json"),
      projectPath: path.join(cwd, ".pi", "settings.json"),
    });
  });
});

describe("resolveRewriteSettings", () => {
  it("uses the default instruction when no settings exist", () => {
    assert.deepEqual(resolveRewriteSettings(undefined, undefined), {
      instruction: DEFAULT_REWRITE_INSTRUCTION,
      warnings: [],
    });
  });

  it("uses a global instruction", () => {
    assert.deepEqual(
      resolveRewriteSettings({ instruction: " Global style " }, undefined),
      { instruction: "Global style", warnings: [] },
    );
  });

  it("lets project instruction override global instruction", () => {
    assert.deepEqual(
      resolveRewriteSettings(
        { instruction: "Global style" },
        { instruction: "Project style" },
      ),
      { instruction: "Project style", warnings: [] },
    );
  });

  it("falls back to the default instruction for invalid project instruction", () => {
    const result = resolveRewriteSettings(
      { instruction: "Global style" },
      { instruction: 123 },
    );

    assert.equal(result.instruction, DEFAULT_REWRITE_INSTRUCTION);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /project rewrite\.instruction/);
  });
});

describe("validateRewriteInput", () => {
  it("trims prompt text", () => {
    assert.deepEqual(validateRewriteInput("  fix the bug  "), {
      ok: true,
      prompt: "fix the bug",
    });
  });

  it("rejects empty prompt text", () => {
    assert.deepEqual(validateRewriteInput("   "), {
      ok: false,
      reason: "missing",
    });
  });

  it("rejects prompt text that starts with a slash command", () => {
    assert.deepEqual(validateRewriteInput(" /handoff make docs"), {
      ok: false,
      reason: "command-like",
    });
  });

  it("allows slash command references later in prompt text", () => {
    assert.deepEqual(validateRewriteInput("design it, then use /handoff"), {
      ok: true,
      prompt: "design it, then use /handoff",
    });
  });
});

describe("buildRewriteSystemPrompt", () => {
  it("includes guardrails and the selected instruction", () => {
    const systemPrompt = buildRewriteSystemPrompt("Custom style");

    assert.match(systemPrompt, /Preserve the user's original intent/);
    assert.match(systemPrompt, /Rewrite instruction:\nCustom style/);
  });
});

describe("cleanupRewriteOutput", () => {
  it("trims output", () => {
    assert.equal(cleanupRewriteOutput("  Rewrite this clearly.  "), "Rewrite this clearly.");
  });

  it("strips common labels", () => {
    assert.equal(
      cleanupRewriteOutput("Rewritten prompt: Fix the failing tests."),
      "Fix the failing tests.",
    );
  });

  it("strips markdown fences", () => {
    assert.equal(
      cleanupRewriteOutput("```markdown\nFix the failing tests.\n```"),
      "Fix the failing tests.",
    );
  });

  it("strips surrounding quotes", () => {
    assert.equal(
      cleanupRewriteOutput('"Fix the failing tests."'),
      "Fix the failing tests.",
    );
  });
});
