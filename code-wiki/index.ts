import { StringEnum, type Api, type Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { Type } from "typebox";
import { parseArgs } from "./src/args";
import { readMetadata } from "./src/metadata";
import {
  buildInitPrompt,
  buildQueryPrompt,
  buildUpdatePrompt,
} from "./src/prompt";
import { getRepoRoot, isPathInsideRepo } from "./src/repo";
import {
  mergeCodeWikiSettings,
  type CodeWikiSettings,
  type ResolvedCodeWikiSettings,
} from "./src/settings";
import {
  OBSIDIAN_VAULT_CONFIG,
  WIKI_FORMATS,
  WIKI_INDEX_FILE,
  WIKI_LOG_FILE,
  WIKI_METADATA_FILE,
  WIKI_SCHEMA_FILE,
  type WikiFormat,
} from "./src/wiki-layout";

const DEFAULT_OUTPUT = "docs/code-wiki";
const WIKI_ACTIONS = ["init", "update", "query", "doctor", "open"] as const;
type WikiAction = (typeof WIKI_ACTIONS)[number];
type WikiOptions = Record<string, string | boolean | undefined>;

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

function getWikiFormatOption(value: unknown): WikiFormat | undefined {
  return WIKI_FORMATS.includes(value as WikiFormat)
    ? (value as WikiFormat)
    : undefined;
}

function ensureObsidianVaultConfig(wikiDir: string): void {
  const obsidianConfigDir = path.join(wikiDir, OBSIDIAN_VAULT_CONFIG);
  const appConfigPath = path.join(obsidianConfigDir, "app.json");
  fs.mkdirSync(obsidianConfigDir, { recursive: true });
  if (!fs.existsSync(appConfigPath)) {
    fs.writeFileSync(appConfigPath, `${JSON.stringify({}, null, 2)}\n`);
  }
}

function getObsidianOpenInfo(wikiDir: string): {
  uri: string;
  command: string;
} {
  const uri = `obsidian://open?path=${encodeURIComponent(wikiDir)}`;
  const quotedUri = shellQuote(uri);

  if (process.platform === "darwin") {
    return { uri, command: `open ${quotedUri}` };
  }

  if (process.platform === "win32") {
    return { uri, command: `start "" "${uri.replace(/"/g, '""')}"` };
  }

  return { uri, command: `xdg-open ${quotedUri}` };
}

function formatObsidianOpenMessage(wikiDir: string): string {
  const { uri, command } = getObsidianOpenInfo(wikiDir);
  return [
    "Obsidian vault support enabled.",
    `Open URI: ${uri}`,
    `Copyable command: ${command}`,
  ].join("\n");
}

function openObsidianVault(wikiDir: string): void {
  const { uri } = getObsidianOpenInfo(wikiDir);

  if (process.platform === "darwin") {
    execFileSync("open", [uri], { stdio: "ignore" });
    return;
  }

  if (process.platform === "win32") {
    execFileSync("cmd", ["/c", "start", "", uri], { stdio: "ignore" });
    return;
  }

  execFileSync("xdg-open", [uri], { stdio: "ignore" });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ── Wiki action handler ───────────────────────────────────────────────────

async function handleWikiAction(
  action: WikiAction,
  options: WikiOptions,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    ctx.ui.notify("Not inside a Git repository", "error");
    return;
  }

  const output =
    typeof options.output === "string" && options.output
      ? options.output
      : DEFAULT_OUTPUT;
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
    runDoctorCheck(ctx, repoRoot, wikiDir, options);
    return;
  }

  if (action === "open") {
    runOpenObsidian(ctx, wikiDir, output);
    return;
  }

  const question = action === "query" ? getQuestion(options) : "";
  if (action === "query" && !question) {
    ctx.ui.notify(
      'Usage: /code-wiki query --question="..." or /code-wiki query "..."',
      "error",
    );
    return;
  }

  // init / update / query require a model
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
    const format = getWikiFormatOption(options.format) ?? "standard";

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

    if (format === "obsidian") {
      ensureObsidianVaultConfig(wikiDir);
    }

    ctx.ui.notify(`Generating codebase wiki into ${output} ...`, "info");
    const prompt = buildInitPrompt({
      repoRoot,
      wikiDir,
      projectName,
      options,
    });

    pi.sendUserMessage(prompt);
    if (format === "obsidian") {
      ctx.ui.notify(formatObsidianOpenMessage(wikiDir), "info");
    }
    return;
  }

  const metadataPath = path.join(wikiDir, WIKI_METADATA_FILE);
  const existingMeta = readMetadata(metadataPath);
  const mergedOptions = existingMeta
    ? { ...existingMeta.options, ...options }
    : options;

  if (action === "update") {
    ctx.ui.notify(`Incrementally updating wiki at ${output} ...`, "info");
    const prompt = buildUpdatePrompt({
      repoRoot,
      wikiDir,
      projectName,
      options: mergedOptions,
      previousCommit: existingMeta?.gitCommit ?? undefined,
    });

    pi.sendUserMessage(prompt);
    return;
  }

  ctx.ui.notify(`Querying codebase wiki at ${output} ...`, "info");
  const prompt = buildQueryPrompt({
    repoRoot,
    wikiDir,
    projectName,
    options: mergedOptions,
    previousCommit: existingMeta?.gitCommit ?? undefined,
    question,
  });

  pi.sendUserMessage(prompt);
}

function getQuestion(options: WikiOptions): string {
  const value = options.question;
  return typeof value === "string" ? value.trim() : "";
}

function runOpenObsidian(
  ctx: ExtensionContext,
  wikiDir: string,
  output: string,
): void {
  if (!fs.existsSync(wikiDir)) {
    ctx.ui.notify(
      `Wiki directory "${output}" does not exist. Run /code-wiki init first.`,
      "error",
    );
    return;
  }

  ensureObsidianVaultConfig(wikiDir);

  try {
    openObsidianVault(wikiDir);
    ctx.ui.notify(`Opening Obsidian vault at ${output} ...`, "info");
  } catch (error) {
    const err = error as Error;
    ctx.ui.notify(
      `Failed to open Obsidian automatically: ${err.message}\n${formatObsidianOpenMessage(wikiDir)}`,
      "error",
    );
  }
}

function runDoctorCheck(
  ctx: ExtensionContext,
  repoRoot: string,
  wikiDir: string,
  options: WikiOptions,
): void {
  const checks: string[] = [];
  const wikiRel = path.relative(repoRoot, wikiDir) || DEFAULT_OUTPUT;

  checks.push(`✓ Git repo: ${repoRoot}`);

  const requestedFormat = getWikiFormatOption(options.format);

  if (!fs.existsSync(wikiDir)) {
    checks.push(`- Wiki directory not yet created (run /code-wiki init)`);
    if (requestedFormat) {
      checks.push(`  requested format: ${requestedFormat}`);
    }
    if (requestedFormat === "obsidian") {
      const { uri, command } = getObsidianOpenInfo(wikiDir);
      checks.push("Obsidian open (after init creates the directory):");
      checks.push(`  URI: ${uri}`);
      checks.push(`  command: ${command}`);
    }
    ctx.ui.notify(checks.join("\n"), "info");
    return;
  }

  checks.push(`✓ Wiki directory: ${wikiRel}`);

  const logPath = path.join(wikiDir, WIKI_LOG_FILE);
  const metaPath = path.join(wikiDir, WIKI_METADATA_FILE);
  let shouldShowObsidianOpen = requestedFormat === "obsidian";

  for (const fileName of [WIKI_INDEX_FILE, WIKI_SCHEMA_FILE, WIKI_LOG_FILE]) {
    const marker = fs.existsSync(path.join(wikiDir, fileName)) ? "✓" : "-";
    checks.push(`${marker} ${fileName}`);
  }

  if (fs.existsSync(metaPath)) {
    const meta = readMetadata(metaPath);
    const storedFormat =
      getWikiFormatOption(meta?.options?.format) ?? "standard";
    shouldShowObsidianOpen ||= storedFormat === "obsidian";

    checks.push(`✓ ${WIKI_METADATA_FILE}`);
    checks.push(`  generated files: ${meta?.generatedFiles?.length ?? 0}`);
    checks.push(`  format: ${storedFormat}`);
    if (requestedFormat && requestedFormat !== storedFormat) {
      checks.push(`  requested format: ${requestedFormat}`);
    }
    const lastUpdated = meta?.updatedAt ?? meta?.generatedAt ?? "unknown";
    checks.push(`  last generated: ${meta?.generatedAt ?? "unknown"}`);
    checks.push(`  last updated: ${lastUpdated}`);
    checks.push(`  last operation: ${meta?.lastOperation ?? "unknown"}`);
  } else {
    checks.push(`- ${WIKI_METADATA_FILE}`);
    if (requestedFormat) {
      checks.push(`  requested format: ${requestedFormat}`);
    }
    checks.push(`  markdown files found: ${countMarkdownFiles(wikiDir)}`);
  }

  const recentLogHeadings = readRecentLogHeadings(logPath, 5);
  if (recentLogHeadings.length > 0) {
    checks.push("Recent log entries:");
    checks.push(...recentLogHeadings.map((heading) => `  ${heading}`));
  }

  if (shouldShowObsidianOpen) {
    const { uri, command } = getObsidianOpenInfo(wikiDir);
    checks.push("Obsidian open:");
    checks.push(`  URI: ${uri}`);
    checks.push(`  command: ${command}`);
  }

  ctx.ui.notify(checks.join("\n"), "info");
}

function countMarkdownFiles(dir: string): number {
  try {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countMarkdownFiles(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function readRecentLogHeadings(logPath: string, limit: number): string[] {
  try {
    const contents = fs.readFileSync(logPath, "utf-8");
    return contents
      .split("\n")
      .filter((line) => line.startsWith("## ["))
      .slice(-limit);
  } catch {
    return [];
  }
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
          "Usage: /code-wiki <init|update|query|doctor|open> [options]\n" +
            "  init     - Generate a new persistent codebase wiki\n" +
            "  update   - Incrementally maintain an existing wiki\n" +
            "  query    - Answer a question and file substantial results\n" +
            "  doctor   - Check setup\n" +
            "  open     - Open the wiki directory in Obsidian\n" +
            "\nOptions:\n" +
            "  --output=<path>        Wiki directory (default: docs/code-wiki)\n" +
            "  --include=<glob,...>   File patterns to include\n" +
            "  --exclude=<glob,...>   File patterns to exclude\n" +
            "  --language=<lang>      Output language (default: english)\n" +
            "  --format=<standard|obsidian> Output Markdown format (default: standard)\n" +
            "  --max-abstractions=<n> Max abstractions (default: 10)\n" +
            "  --max-size=<bytes>     Max file size in bytes (default: 100000)\n" +
            "  --question=<text>      Question for query action\n" +
            "  --no-cache             Tell the agent not to cache LLM responses\n" +
            "  --force                Overwrite existing wiki (init only)\n" +
            "\nExamples:\n" +
            '  /code-wiki query --question="How does model selection work?"\n' +
            '  /code-wiki query "How does model selection work?"',
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
      "Generate, incrementally update, query, open, or inspect a persistent codebase wiki. " +
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
      "Use code_wiki with action='open' when the user asks to open the wiki in Obsidian.",
    ],
    parameters: Type.Object({
      action: StringEnum([
        "init",
        "update",
        "query",
        "doctor",
        "open",
      ] as const),
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
      question: Type.Optional(
        Type.String({
          description: "Question to answer when action='query'",
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
      const options: WikiOptions = {};
      if (params.output) options.output = params.output;
      if (params.language) options.language = params.language;
      if (params.format) options.format = params.format;
      if (params.include) options.include = params.include;
      if (params.exclude) options.exclude = params.exclude;
      if (params.question) options.question = params.question;
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
            text:
              params.action === "open"
                ? "code_wiki open: requested Obsidian to open the wiki."
                : `code_wiki ${params.action}: prompt sent to agent for processing.`,
          },
        ],
        details: {},
      };
    },
  });
}
