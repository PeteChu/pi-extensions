import { StringEnum, type Api, type Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { Type } from "typebox";
import { parseArgs } from "./src/args";
import { readMetadata } from "./src/metadata";
import { buildWikiPrompt } from "./src/prompt";
import { getRepoRoot, isPathInsideRepo } from "./src/repo";
import {
  mergeCodeWikiSettings,
  type CodeWikiSettings,
  type ResolvedCodeWikiSettings,
} from "./src/settings";

const DEFAULT_OUTPUT = "docs/code-wiki";
const WIKI_ACTIONS = ["init", "update", "doctor"] as const;
type WikiAction = (typeof WIKI_ACTIONS)[number];

// ── Settings helpers ──────────────────────────────────────────────────────

async function readSettingsFile(
  filePath: string,
  ctx: ExtensionContext,
): Promise<Record<string, unknown> | null> {
  try {
    const contents = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(
        `Failed to read ${filePath}: ${err.message ?? "unknown error"}`,
        "warning",
      );
    }
    return null;
  }
}

function getCodeWikiSettingsPaths(cwd: string): {
  globalPath: string;
  projectPath: string;
} {
  return {
    globalPath: path.join(getAgentDir(), "settings.json"),
    projectPath: path.join(cwd, ".pi", "settings.json"),
  };
}

async function loadCodeWikiSettings(
  ctx: ExtensionContext,
): Promise<ResolvedCodeWikiSettings> {
  const { globalPath, projectPath } = getCodeWikiSettingsPaths(ctx.cwd);

  const [globalSettings, projectSettings] = await Promise.all([
    readSettingsFile(globalPath, ctx),
    readSettingsFile(projectPath, ctx),
  ]);

  return mergeCodeWikiSettings(
    globalSettings?.codeWiki as CodeWikiSettings | undefined,
    projectSettings?.codeWiki as CodeWikiSettings | undefined,
  );
}

async function selectGenerationModel(
  currentModel: Model<Api>,
  modelRegistry: {
    find: (provider: string, modelId: string) => Model<Api> | undefined;
    getApiKeyAndHeaders: (model: Model<Api>) => Promise<{
      ok: boolean;
      apiKey?: string;
      headers?: Record<string, string>;
    }>;
  },
  modelPreferences: { provider: string; id: string }[],
): Promise<Model<Api>> {
  for (const preference of modelPreferences) {
    const model = modelRegistry.find(preference.provider, preference.id);
    if (!model) {
      continue;
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok) {
      return model;
    }
  }

  return currentModel;
}

function isWikiAction(action: string): action is WikiAction {
  return WIKI_ACTIONS.includes(action as WikiAction);
}

// ── Wiki action handler ───────────────────────────────────────────────────

async function handleWikiAction(
  action: WikiAction,
  options: Record<string, string | boolean | undefined>,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    ctx.ui.notify("Not inside a Git repository", "error");
    return;
  }

  const output =
    (typeof options.output === "string" && options.output) || DEFAULT_OUTPUT;
  const wikiDir = path.resolve(repoRoot, output);

  if (!isPathInsideRepo(wikiDir, repoRoot)) {
    ctx.ui.notify(
      `Output directory "${output}" resolves outside the Git repository root`,
      "error",
    );
    return;
  }

  const projectName = path.basename(repoRoot);

  if (action === "doctor") {
    runDoctorCheck(ctx, repoRoot, wikiDir);
    return;
  }

  // init / update require a model
  if (!ctx.model) {
    ctx.ui.notify("No model selected", "error");
    return;
  }

  const settings = await loadCodeWikiSettings(ctx);
  const generationModel = await selectGenerationModel(
    ctx.model,
    ctx.modelRegistry,
    settings.generationModels,
  );

  // Switch to the selected generation model if it differs from the current one.
  // This remains active after the wiki generation turn (no restore).
  if (generationModel !== ctx.model) {
    const ok = await pi.setModel(generationModel);
    if (!ok) {
      ctx.ui.notify(
        `Failed to switch to ${generationModel.id} — no API key available`,
        "error",
      );
      return;
    }
    ctx.ui.notify(
      `Switched to ${generationModel.id} for wiki generation`,
      "info",
    );
  }

  if (action === "init") {
    if (fs.existsSync(wikiDir) && fs.readdirSync(wikiDir).length > 0) {
      if (!options.force) {
        ctx.ui.notify(
          `Wiki directory "${output}" already exists. Use --force to overwrite, or /code-wiki update to refresh.`,
          "error",
        );
        return;
      }
      ctx.ui.notify(`Force-overwriting existing wiki at "${output}"`, "info");
    }

    ctx.ui.notify(`Generating codebase wiki into ${output} ...`, "info");
    const prompt = buildWikiPrompt({
      repoRoot,
      wikiDir,
      projectName,
      options,
      isUpdate: false,
    });

    pi.sendUserMessage(prompt);
  } else {
    const metadataPath = path.join(wikiDir, ".code-wiki.json");
    const existingMeta = readMetadata(metadataPath);
    const mergedOptions = existingMeta
      ? { ...existingMeta.options, ...options }
      : options;

    ctx.ui.notify(`Updating wiki at ${output} ...`, "info");
    const prompt = buildWikiPrompt({
      repoRoot,
      wikiDir,
      projectName,
      options: mergedOptions,
      isUpdate: true,
      previousCommit: existingMeta?.gitCommit ?? undefined,
    });

    pi.sendUserMessage(prompt);
  }
}

function runDoctorCheck(
  ctx: ExtensionContext,
  repoRoot: string,
  wikiDir: string,
): void {
  const checks: string[] = [];

  checks.push(`✓ Git repo: ${repoRoot}`);

  if (fs.existsSync(wikiDir)) {
    const metaPath = path.join(wikiDir, ".code-wiki.json");
    if (fs.existsSync(metaPath)) {
      const meta = readMetadata(metaPath);
      checks.push(
        `✓ Wiki exists at ${path.relative(repoRoot, wikiDir)} (last generated: ${meta?.generatedAt ?? "unknown"})`,
      );
    } else {
      checks.push(`✓ Wiki directory exists (no metadata found)`);
    }
  } else {
    checks.push(`- Wiki directory not yet created (run /code-wiki init)`);
  }

  ctx.ui.notify(checks.join("\n"), "info");
}

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
          "Usage: /code-wiki <init|update|doctor> [options]\n" +
            "  init     - Generate a new wiki\n" +
            "  update   - Refresh an existing wiki\n" +
            "  doctor   - Check setup\n" +
            "\nOptions:\n" +
            "  --output=<path>        Wiki directory (default: docs/code-wiki)\n" +
            "  --include=<glob,...>   File patterns to include\n" +
            "  --exclude=<glob,...>   File patterns to exclude\n" +
            "  --language=<lang>      Output language (default: english)\n" +
            "  --max-abstractions=<n> Max abstractions (default: 10)\n" +
            "  --max-size=<bytes>     Max file size in bytes (default: 100000)\n" +
            "  --no-cache             Tell the agent not to cache LLM responses\n" +
            "  --force                Overwrite existing wiki (init only)",
          "info",
        );
        return;
      }

      await handleWikiAction(action, parsed.options, pi, ctx);
    },
  });

  // ── Register code_wiki tool ──
  pi.registerTool({
    name: "code_wiki",
    label: "Code Wiki",
    description:
      "Generate or update a beginner-friendly codebase wiki. " +
      "Use this when the user asks to document, explain, or create a wiki/tutorial for the codebase.",
    promptSnippet: "Generate or update a codebase wiki in docs/code-wiki/",
    promptGuidelines: [
      "Use code_wiki with action='init' when the user asks to generate documentation, " +
        "a wiki, or a tutorial for the codebase for the first time.",
      "Use code_wiki with action='update' when the user asks to refresh, update, or " +
        "regenerate existing codebase documentation.",
      "Use code_wiki with action='doctor' when the user asks to check the wiki setup.",
    ],
    parameters: Type.Object({
      action: StringEnum(["init", "update", "doctor"] as const),
      output: Type.Optional(
        Type.String({
          description: "Wiki directory path (default: docs/code-wiki)",
        }),
      ),
      language: Type.Optional(
        Type.String({ description: "Output language (default: english)" }),
      ),
      include: Type.Optional(
        Type.String({
          description:
            "Comma-separated file patterns to include (e.g., '*.py,*.ts')",
        }),
      ),
      exclude: Type.Optional(
        Type.String({
          description:
            "Comma-separated file patterns to exclude (e.g., 'tests/*,docs/*')",
        }),
      ),
      max_abstractions: Type.Optional(
        Type.Number({
          description:
            "Maximum number of abstractions to identify (default: 10)",
        }),
      ),
      max_size: Type.Optional(
        Type.Number({
          description: "Maximum file size in bytes (default: 100000)",
        }),
      ),
      no_cache: Type.Optional(
        Type.Boolean({ description: "Disable LLM response caching" }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Force overwrite existing wiki on init" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const options: Record<string, string | boolean | undefined> = {};
      if (params.output) options.output = params.output;
      if (params.language) options.language = params.language;
      if (params.include) options.include = params.include;
      if (params.exclude) options.exclude = params.exclude;
      if (params.max_abstractions != null)
        options["max-abstractions"] = String(params.max_abstractions);
      if (params.max_size != null)
        options["max-size"] = String(params.max_size);
      if (params.no_cache) options["no-cache"] = true;
      if (params.force) options.force = true;

      await handleWikiAction(params.action, options, pi, ctx);

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
