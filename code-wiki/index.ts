import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseArgs } from "./src/args";
import { matchesAny } from "./src/crawler";
import { dispatch } from "./src/dispatch";
import { type WikiOptions, isWikiAction } from "./src/handlers/types";
import { DEFAULT_EXCLUDE } from "./src/prompt-types";
import { createReadGuard } from "./src/read-guard";
import { WIKI_FORMATS } from "./src/wiki-layout";

const guard = createReadGuard(matchesAny, DEFAULT_EXCLUDE);

// ── Extension registration ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Register /code-wiki command ──
  pi.registerCommand("code-wiki", {
    description: "Generate and manage a codebase wiki",
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
            "  --max-size=<bytes>     Max file size in bytes (default: 100000)\n" +
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

  // ── Register code_wiki tool ──
  pi.registerTool({
    name: "code_wiki",
    label: "Code Wiki",
    description:
      "Generate, incrementally update, query, or inspect a persistent codebase wiki. " +
      "Use this when the user asks to document, explain, maintain, or query codebase knowledge.",
    promptSnippet:
      "Generate, update, or query a codebase wiki in docs/code-wiki/",
    promptGuidelines: [
      "Use code_wiki with action='init' when the user asks to generate documentation, " +
        "a wiki, or a tutorial for the codebase for the first time.",
      "Use code_wiki with action='update' when the user asks to refresh or maintain " +
        "existing codebase documentation incrementally.",
      "Use code_wiki with action='query' when the user asks a codebase question that should " +
        "be answered from the wiki/source and potentially filed back into the wiki.",
      "Use code_wiki with action='doctor' when the user asks to check the wiki setup.",
      "Use the target parameter to narrow scope to a subdirectory (e.g., 'packages/backend') " +
        "in monorepos, instead of the full repo root.",
    ],
    parameters: Type.Object({
      action: StringEnum(["init", "update", "query", "doctor"] as const),
      target: Type.Optional(
        Type.String({
          description:
            "Target subdirectory within the repo (e.g., 'packages/backend'). Defaults to repo root.",
        }),
      ),
      output: Type.Optional(
        Type.String({
          description: "Wiki directory path (default: docs/code-wiki)",
        }),
      ),
      language: Type.Optional(
        Type.String({ description: "Output language (default: english)" }),
      ),
      format: Type.Optional(
        StringEnum(WIKI_FORMATS, {
          description: "Output Markdown format (default: standard)",
        }),
      ),
      exclude: Type.Optional(
        Type.String({
          description:
            "Comma-separated file patterns to exclude (e.g., 'tests/*,docs/*')",
        }),
      ),
      question: Type.Optional(
        Type.String({
          description: "Question to answer when action='query'",
        }),
      ),
      max_size: Type.Optional(
        Type.Number({
          description: "Maximum file size in bytes (default: 100000)",
        }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Force overwrite existing wiki on init" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const options: WikiOptions = {};
      if (params.target) options.target = params.target;
      if (params.output) options.output = params.output;
      if (params.language) options.language = params.language;
      if (params.format) options.format = params.format;
      if (params.exclude) options.exclude = params.exclude;
      if (params.question) options.question = params.question;
      if (params.max_size != null)
        options["max-size"] = String(params.max_size);
      if (params.force) options.force = true;

      await dispatch(params.action, options, pi, ctx, guard);

      return {
        content: [
          {
            type: "text",
            text: `code_wiki ${params.action}: prompt sent to agent for processing.`,
          },
        ],
        details: {},
      };
    },
  });
}
