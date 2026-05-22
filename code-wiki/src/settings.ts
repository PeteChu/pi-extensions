export interface ModelPreference {
  provider: string;
  id: string;
}

export interface CodeWikiSettings {
  generationModels?: ModelPreference[];
}

export interface ResolvedCodeWikiSettings {
  generationModels: ModelPreference[];
}

export const DEFAULT_GENERATION_MODELS: ModelPreference[] = [
  { provider: "openai-codex", id: "gpt-5.4-mini" },
  { provider: "github-copilot", id: "gpt-5.4-mini" },
  { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
  { provider: "github-copilot", id: "gemini-3-flash-preview" },
  { provider: "github-copilot", id: "claude-haiku-4.5" },
  { provider: "anthropic", id: "claude-haiku-4-5" },
];

export function mergeCodeWikiSettings(
  globalSettings: CodeWikiSettings | undefined,
  projectSettings: CodeWikiSettings | undefined,
): ResolvedCodeWikiSettings {
  return {
    generationModels:
      projectSettings?.generationModels ??
      globalSettings?.generationModels ??
      DEFAULT_GENERATION_MODELS,
  };
}
