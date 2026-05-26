import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { parseArgs } from "./src/args";
import { getCodeWikiArgumentCompletions } from "./src/completions";
import { dispatch } from "./src/dispatch";
import { matchesAny } from "./src/glob";
import { isWikiAction } from "./src/handlers/types";
import { createReadGuard } from "./src/read-guard";

const guard = createReadGuard(matchesAny);

// ── Extension registration ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Register /code-wiki command ──
  pi.registerCommand("code-wiki", {
    description: "Generate and manage a codebase wiki",
    getArgumentCompletions: getCodeWikiArgumentCompletions,
    handler: async (args, ctx) => {
      const parsed = parseArgs(args);
      const action = parsed.subcommand;

      if (!isWikiAction(action)) {
        ctx.ui.notify(
          "Usage: /code-wiki <init|update|query|doctor> [options]\n" +
            "  init     - Generate a new persistent codebase wiki\n" +
            "  update   - Incrementally maintain an existing wiki\n" +
            "  query    - Answer a question and file substantial results\n" +
            "  doctor   - Check setup\n" +
            "\nOptions:\n" +
            "  --target=<path>        Target subdirectory (narrows scope, default: repo root)\n" +
            "  --output=<path>        Wiki directory (default: docs/code-wiki)\n" +
            "  --exclude=<glob,...>   File patterns to exclude\n" +
            "  --language=<lang>      Output language (default: english)\n" +
            "  --format=<standard|obsidian> Output Markdown format (default: standard)\n" +
            "  --detail-level=<summary|standard|deep|exhaustive> Wiki explanation detail (default: standard)\n" +
            "  --question=<text>      Question for query action\n" +
            "  --force                Overwrite existing wiki (init only)\n" +
            "\nExamples:\n" +
            "  /code-wiki init --target=packages/backend\n" +
            '  /code-wiki query --question="How does model selection work?"\n' +
            '  /code-wiki query "How does model selection work?"',
          "info",
        );
        return;
      }

      await dispatch(action, parsed.options, pi, ctx, guard);
    },
  });

  // ── Clear read-guard state when the agent finishes or session ends ──
  pi.on("agent_end", async () => {
    guard.deactivate();
  });

  pi.on("session_shutdown", async () => {
    guard.deactivate();
  });

  // ── Enforce target directory and exclude patterns on built-in `read` tool ──
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("read", event)) return;
    return guard.check(event.input.path, ctx.cwd);
  });
}
