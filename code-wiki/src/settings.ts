import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import {
  formatDetailLevels,
  isDetailLevel,
  type DetailLevel,
} from "./detail-level";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ModelPreference {
  provider: string;
  id: string;
}

export interface CodeWikiSettings {
  generationModels?: ModelPreference[];
  /**
   * Maximum file size in bytes when scanning for wiki content.
   * Files larger than this are skipped. Defaults to 100000.
   */
  maxSize?: number;
  /**
   * Default detail level for new wikis. Existing wiki metadata takes precedence.
   */
  defaultDetailLevel?: DetailLevel;
}

export interface ResolvedCodeWikiSettings {
  generationModels: ModelPreference[];
  maxSize: number;
  defaultDetailLevel?: DetailLevel;
}

export const DEFAULT_MAX_SIZE = 100000;

export const DEFAULT_GENERATION_MODELS: ModelPreference[] = [
  { provider: "openai-codex", id: "gpt-5.4-mini" },
  { provider: "github-copilot", id: "gpt-5.4-mini" },
  { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
  { provider: "github-copilot", id: "gemini-3-flash-preview" },
  { provider: "github-copilot", id: "claude-haiku-4.5" },
  { provider: "anthropic", id: "claude-haiku-4-5" },
];

// ── Merge ─────────────────────────────────────────────────────────────────

export function mergeCodeWikiSettings(
  globalSettings: CodeWikiSettings | undefined,
  projectSettings: CodeWikiSettings | undefined,
): ResolvedCodeWikiSettings {
  return {
    generationModels:
      projectSettings?.generationModels ??
      globalSettings?.generationModels ??
      DEFAULT_GENERATION_MODELS,
    maxSize:
      parseSettingsMaxSize(projectSettings?.maxSize) ??
      parseSettingsMaxSize(globalSettings?.maxSize) ??
      DEFAULT_MAX_SIZE,
    defaultDetailLevel:
      projectSettings?.defaultDetailLevel ?? globalSettings?.defaultDetailLevel,
  };
}

// ── Load ──────────────────────────────────────────────────────────────────

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

export function getCodeWikiSettingsPaths(cwd: string): {
  globalPath: string;
  projectPath: string;
} {
  return {
    globalPath: path.join(getAgentDir(), "settings.json"),
    projectPath: path.join(cwd, ".pi", "settings.json"),
  };
}

export async function loadCodeWikiSettings(
  ctx: ExtensionContext,
): Promise<ResolvedCodeWikiSettings> {
  const { globalPath, projectPath } = getCodeWikiSettingsPaths(ctx.cwd);

  const [globalSettings, projectSettings] = await Promise.all([
    readSettingsFile(globalPath, ctx),
    readSettingsFile(projectPath, ctx),
  ]);

  return mergeCodeWikiSettings(
    sanitizeCodeWikiSettings(
      globalSettings?.codeWiki as CodeWikiSettings | undefined,
      ctx,
      globalPath,
    ),
    sanitizeCodeWikiSettings(
      projectSettings?.codeWiki as CodeWikiSettings | undefined,
      ctx,
      projectPath,
    ),
  );
}

function parseSettingsMaxSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function sanitizeCodeWikiSettings(
  settings: CodeWikiSettings | undefined,
  ctx: ExtensionContext,
  filePath: string,
): CodeWikiSettings | undefined {
  if (!settings) {
    return undefined;
  }

  const { defaultDetailLevel, ...rest } = settings;

  if (defaultDetailLevel === undefined) {
    return rest;
  }

  if (isDetailLevel(defaultDetailLevel)) {
    return { ...rest, defaultDetailLevel };
  }

  if (ctx.hasUI) {
    ctx.ui.notify(
      `Invalid codeWiki.defaultDetailLevel "${String(defaultDetailLevel)}" in ${filePath}; ignoring. Use: ${formatDetailLevels()}.`,
      "warning",
    );
  }

  return rest;
}

// ── Model selection ───────────────────────────────────────────────────────

export async function selectGenerationModel(
  currentModel: Model<Api>,
  modelRegistry: {
    find: (provider: string, modelId: string) => Model<Api> | undefined;
    getApiKeyAndHeaders: (model: Model<Api>) => Promise<{
      ok: boolean;
      apiKey?: string;
      headers?: Record<string, string>;
    }>;
  },
  modelPreferences: ModelPreference[],
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
