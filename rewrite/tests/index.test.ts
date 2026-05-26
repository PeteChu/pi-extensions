import { getAgentDir } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import rewrite, {
  DEFAULT_REWRITE_INSTRUCTION,
  MAX_CONTEXT_CHARS,
  buildRewriteConversationTranscript,
  buildRewriteSystemPrompt,
  buildRewriteUserMessageText,
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

  it("suggests the --context argument", () => {
    let completions: unknown;
    rewrite({
      registerCommand(_name: string, options: any) {
        completions = options.getArgumentCompletions("");
      },
    } as never);

    assert.deepEqual(completions, [
      {
        value: "--context ",
        label: "--context",
        description: "Include current conversation context",
      },
    ]);
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
      maxContextChars: MAX_CONTEXT_CHARS,
      warnings: [],
    });
  });

  it("uses a global instruction", () => {
    assert.deepEqual(
      resolveRewriteSettings({ instruction: " Global style " }, undefined),
      {
        instruction: "Global style",
        maxContextChars: MAX_CONTEXT_CHARS,
        warnings: [],
      },
    );
  });

  it("lets project instruction override global instruction", () => {
    assert.deepEqual(
      resolveRewriteSettings(
        { instruction: "Global style" },
        { instruction: "Project style" },
      ),
      {
        instruction: "Project style",
        maxContextChars: MAX_CONTEXT_CHARS,
        warnings: [],
      },
    );
  });

  it("falls back to the default instruction for invalid project instruction", () => {
    const result = resolveRewriteSettings(
      { instruction: "Global style" },
      { instruction: 123 },
    );

    assert.equal(result.instruction, DEFAULT_REWRITE_INSTRUCTION);
    assert.equal(result.maxContextChars, MAX_CONTEXT_CHARS);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /project rewrite\.instruction/);
  });

  it("uses the default max context size when unset", () => {
    assert.equal(
      resolveRewriteSettings({ instruction: "Global style" }, undefined)
        .maxContextChars,
      MAX_CONTEXT_CHARS,
    );
  });

  it("uses a configured max context size", () => {
    assert.equal(
      resolveRewriteSettings({ maxContextChars: 1234 }, undefined)
        .maxContextChars,
      1234,
    );
  });

  it("lets project max context size override global max context size", () => {
    assert.equal(
      resolveRewriteSettings(
        { maxContextChars: 1234 },
        { maxContextChars: 5678 },
      ).maxContextChars,
      5678,
    );
  });

  it("falls back to the default max context size for invalid project value", () => {
    const result = resolveRewriteSettings(
      { maxContextChars: 1234 },
      { maxContextChars: 0 },
    );

    assert.equal(result.maxContextChars, MAX_CONTEXT_CHARS);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /project rewrite\.maxContextChars/);
  });
});

describe("validateRewriteInput", () => {
  it("trims prompt text", () => {
    assert.deepEqual(validateRewriteInput("  fix the bug  "), {
      ok: true,
      prompt: "fix the bug",
      includeContext: false,
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
      includeContext: false,
    });
  });

  it("accepts --context as the first argument", () => {
    assert.deepEqual(validateRewriteInput(" --context  fix the bug "), {
      ok: true,
      prompt: "fix the bug",
      includeContext: true,
    });
  });

  it("requires prompt text after --context", () => {
    assert.deepEqual(validateRewriteInput(" --context "), {
      ok: false,
      reason: "missing",
    });
  });

  it("only treats --context as a flag in the first argument", () => {
    assert.deepEqual(validateRewriteInput("fix --context bug"), {
      ok: true,
      prompt: "fix --context bug",
      includeContext: false,
    });
  });

  it("rejects command-like prompt text after --context", () => {
    assert.deepEqual(validateRewriteInput("--context /handoff make docs"), {
      ok: false,
      reason: "command-like",
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

describe("buildRewriteUserMessageText", () => {
  it("uses the prompt alone when no context is provided", () => {
    assert.equal(buildRewriteUserMessageText("Fix it"), "Fix it");
  });

  it("wraps context and prompt in explicit sections", () => {
    const text = buildRewriteUserMessageText("Fix it", "User: Prior request");

    assert.match(text, /<context>\nUser: Prior request\n<\/context>/);
    assert.match(text, /<prompt>\nFix it\n<\/prompt>/);
  });
});

describe("buildRewriteConversationTranscript", () => {
  it("includes only visible user and assistant text", () => {
    const result = buildRewriteConversationTranscript([
      { role: "user", content: "Fix this" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "I can help." },
          {
            type: "toolCall",
            id: "t1",
            name: "read",
            arguments: { path: "secret" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "read",
        content: [{ type: "text", text: "tool output" }],
      },
      { role: "compactionSummary", summary: "summary" },
      { role: "custom", content: "custom context" },
      {
        role: "user",
        content: [{ type: "image", data: "...", mimeType: "image/png" }],
      },
    ]);

    assert.equal(result.transcript, "User: Fix this\n\nAssistant: I can help.");
    assert.equal(result.messageCount, 2);
    assert.equal(result.truncated, false);
  });

  it("keeps the most recent context when transcript is too long", () => {
    const oldText = "old".repeat(MAX_CONTEXT_CHARS);
    const newText = "new context";
    const result = buildRewriteConversationTranscript(
      [
        { role: "user", content: oldText },
        { role: "assistant", content: [{ type: "text", text: newText }] },
      ],
      50,
    );

    assert.equal(result.truncated, true);
    assert.match(
      result.transcript,
      /^\[Earlier conversation context omitted\.\]/,
    );
    assert.match(result.transcript, /Assistant: new context$/);
    assert.doesNotMatch(result.transcript, /^User: old/);
  });

  it("uses the provided max context size only for transcript truncation", () => {
    const result = buildRewriteConversationTranscript(
      [
        { role: "user", content: "first message" },
        {
          role: "assistant",
          content: [{ type: "text", text: "second message" }],
        },
      ],
      25,
    );

    assert.equal(result.truncated, true);
    assert.match(
      result.transcript,
      /^\[Earlier conversation context omitted\.\]/,
    );
    assert.match(result.transcript, /Assistant: second message$/);
    assert.equal(result.messageCount, 2);
  });
});

describe("cleanupRewriteOutput", () => {
  it("trims output", () => {
    assert.equal(
      cleanupRewriteOutput("  Rewrite this clearly.  "),
      "Rewrite this clearly.",
    );
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
