export interface ModelPreference {
  provider: string;
  id: string;
}

export interface AiCommitSettings {
  systemPrompt?: string;
  generationModels?: ModelPreference[];
  skipPatterns?: string[];
  perFileDiffLimit?: number;
  totalDiffLimit?: number;
}

export interface ResolvedAiCommitSettings {
  systemPrompt: string;
  generationModels: ModelPreference[];
  skipPatterns: string[];
  perFileDiffLimit: number;
  totalDiffLimit: number;
}

export interface StagedFileMetadata {
  path: string;
  status: string;
  oldPath?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

export interface StagedFileWithDiff extends StagedFileMetadata {
  diff?: string;
}

export interface PreparedStagedFile extends StagedFileMetadata {
  included: boolean;
  diff?: string;
  skippedReason?: string;
  truncated?: boolean;
}

export const DEFAULT_GENERATION_MODELS: ModelPreference[] = [
  { provider: "deepseek", id: "deepseek-v4-flash" },
  { provider: "openai-codex", id: "gpt-5.4-mini" },
  { provider: "github-copilot", id: "gpt-5.4-mini" },
  { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
  { provider: "github-copilot", id: "gemini-3-flash-preview" },
  { provider: "github-copilot", id: "claude-haiku-4.5" },
  { provider: "anthropic", id: "claude-haiku-4-5" },
];

export const DEFAULT_SKIP_PATTERNS = [
  "*-lock.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "Pipfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
  "flake.lock",
  "*.lock",
];

export const DEFAULT_PER_FILE_DIFF_LIMIT = 12_000;
export const DEFAULT_TOTAL_DIFF_LIMIT = 40_000;
const MIN_DIFF_CHARS_TO_INCLUDE = 500;

export const DEFAULT_GENERATION_PROMPT = [
  "Generate a concise git commit message subject line in present tense that precisely describes the key changes in the following code diff. Focus on what was changed, not just file names. Provide only the subject line, no description or body.",
  "Format: type(scope): description",
  "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
  "",
  "Rules:",
  "- Use an optional scope only when it is clear from the changed files",
  "- Use imperative mood and keep the subject concise",
  "- Describe the user-facing project change, not git mechanics or implementation details",
  "- Be specific: include concrete details (package names, versions, functionality) rather than generic statements.",
  "- Prefer concrete names from the change over generic phrases copied from file descriptions",
  "",
  "IMPORTANT: Do not include any explanations, introductions, or additional text. Do not wrap the commit message in quotes, markdown, or any other formatting. The commit message must be a single subject line. Your entire response will be passed directly into git commit. Respond with ONLY the commit message text.",
].join("\n");

const CONVENTIONAL_COMMIT_RE =
  /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)\n]+\))?!?:\s+\S.+$/i;

export function mergeAiCommitSettings(
  globalSettings: AiCommitSettings | undefined,
  projectSettings: AiCommitSettings | undefined,
): ResolvedAiCommitSettings {
  return {
    systemPrompt:
      projectSettings?.systemPrompt ??
      globalSettings?.systemPrompt ??
      DEFAULT_GENERATION_PROMPT,
    generationModels:
      projectSettings?.generationModels ??
      globalSettings?.generationModels ??
      DEFAULT_GENERATION_MODELS,
    skipPatterns:
      projectSettings?.skipPatterns ??
      globalSettings?.skipPatterns ??
      DEFAULT_SKIP_PATTERNS,
    perFileDiffLimit: positiveNumberOrDefault(
      projectSettings?.perFileDiffLimit ?? globalSettings?.perFileDiffLimit,
      DEFAULT_PER_FILE_DIFF_LIMIT,
    ),
    totalDiffLimit: positiveNumberOrDefault(
      projectSettings?.totalDiffLimit ?? globalSettings?.totalDiffLimit,
      DEFAULT_TOTAL_DIFF_LIMIT,
    ),
  };
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function parseNameStatusZ(output: string): StagedFileMetadata[] {
  const parts = output.split("\0");
  const files: StagedFileMetadata[] = [];
  let index = 0;

  while (index < parts.length) {
    const status = parts[index++];
    if (!status) {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = parts[index++];
      const filePath = parts[index++];
      if (filePath) {
        files.push({ status, oldPath, path: filePath });
      }
      continue;
    }

    const filePath = parts[index++];
    if (filePath) {
      files.push({ status, path: filePath });
    }
  }

  return files;
}

export function parseNumstatZ(output: string): StagedFileMetadata[] {
  const parts = output.split("\0");
  const files: StagedFileMetadata[] = [];
  let index = 0;

  while (index < parts.length) {
    const record = parts[index++];
    if (!record) {
      continue;
    }

    const fields = record.split("\t");
    if (fields.length < 3) {
      continue;
    }

    const additionsText = fields[0];
    const deletionsText = fields[1];
    let filePath = fields.slice(2).join("\t");

    if (!filePath) {
      index++; // old path for renamed/copied files
      filePath = parts[index++] ?? "";
    }

    if (!filePath) {
      continue;
    }

    const binary = additionsText === "-" || deletionsText === "-";
    files.push({
      status: "",
      path: filePath,
      additions: binary ? undefined : Number(additionsText),
      deletions: binary ? undefined : Number(deletionsText),
      binary,
    });
  }

  return files;
}

export function applyNumstatToMetadata(
  files: StagedFileMetadata[],
  stats: StagedFileMetadata[],
): StagedFileMetadata[] {
  const statsByPath = new Map(stats.map((stat) => [stat.path, stat]));

  return files.map((file) => {
    const stat = statsByPath.get(file.path);
    if (!stat) {
      return file;
    }

    return {
      ...file,
      additions: stat.additions,
      deletions: stat.deletions,
      binary: stat.binary,
    };
  });
}

const patternCache = new Map<string, RegExp>();

export function isNoisyFilePath(
  filePath: string,
  patterns: string[] = DEFAULT_SKIP_PATTERNS,
): boolean {
  const normalizedPath = normalizePath(filePath).toLowerCase();
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;

  return patterns.some((pattern) => {
    const normalizedPattern = normalizePath(pattern).toLowerCase();
    const target = normalizedPattern.includes("/") ? normalizedPath : basename;

    let regex = patternCache.get(normalizedPattern);
    if (!regex) {
      regex = globToRegExp(normalizedPattern);
      patternCache.set(normalizedPattern, regex);
    }
    return regex.test(target);
  });
}

export function prepareStagedDiffs(
  files: StagedFileWithDiff[],
  settings: Pick<
    ResolvedAiCommitSettings,
    "skipPatterns" | "perFileDiffLimit" | "totalDiffLimit"
  >,
): PreparedStagedFile[] {
  const prepared: PreparedStagedFile[] = [];
  let totalChars = 0;

  for (const file of files) {
    const { diff: _diff, ...base } = file;

    if (isNoisyFilePath(file.path, settings.skipPatterns)) {
      prepared.push({
        ...base,
        included: false,
        skippedReason: "matches skip pattern",
      });
      continue;
    }

    const diff = file.diff ?? "";
    if (file.binary || isBinaryDiff(diff)) {
      prepared.push({ ...base, included: false, skippedReason: "binary file" });
      continue;
    }

    if (!diff.trim()) {
      prepared.push({
        ...base,
        included: false,
        skippedReason: "no text diff",
      });
      continue;
    }

    if (diff.length > settings.perFileDiffLimit) {
      prepared.push({
        ...base,
        included: false,
        skippedReason: `diff exceeds per-file limit (${settings.perFileDiffLimit} chars)`,
      });
      continue;
    }

    const remaining = settings.totalDiffLimit - totalChars;
    if (remaining <= 0) {
      prepared.push({
        ...base,
        included: false,
        skippedReason: `total diff limit reached (${settings.totalDiffLimit} chars)`,
      });
      continue;
    }

    if (diff.length <= remaining) {
      prepared.push({ ...base, included: true, diff });
      totalChars += diff.length;
      continue;
    }

    if (remaining < MIN_DIFF_CHARS_TO_INCLUDE) {
      prepared.push({
        ...base,
        included: false,
        skippedReason: `total diff limit reached (${settings.totalDiffLimit} chars)`,
      });
      continue;
    }

    prepared.push({
      ...base,
      included: true,
      diff:
        diff.slice(0, remaining) +
        "\n...[truncated because total diff limit was reached]",
      truncated: true,
    });
    totalChars = settings.totalDiffLimit;
  }

  return prepared;
}

export function buildGenerationPrompt(files: PreparedStagedFile[]): string {
  const lines = [
    "The diffs below are the complete intended commit context.",
    "Infer the main user-facing behavior from the diffs before choosing the subject.",
    "",
    "Files in this commit:",
  ];

  for (const file of files) {
    lines.push(`- ${formatFileSummary(file)}`);
  }

  const includedFiles: PreparedStagedFile[] = [];
  const skippedFiles: PreparedStagedFile[] = [];

  for (const file of files) {
    if (file.included && file.diff) {
      includedFiles.push(file);
    } else if (!file.included) {
      skippedFiles.push(file);
    }
  }

  if (includedFiles.length > 0) {
    lines.push("", "Included diffs:");
    for (const file of includedFiles) {
      lines.push(
        "",
        `--- ${formatFileSummary(file)}`,
        "```diff",
        file.diff!,
        "```",
      );
    }
  }

  if (skippedFiles.length > 0) {
    lines.push(
      "",
      "Skipped files (summarize their intent from path/status only):",
    );
    for (const file of skippedFiles) {
      lines.push(`- ${formatFileSummary(file)}: ${file.skippedReason}`);
    }
  }

  return lines.join("\n");
}

export function cleanupCommitMessage(output: string): string {
  const text = output
    .trim()
    .replace(/^```(?:[a-zA-Z]+)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  const lines = text
    .split(/\r?\n/)
    .map(cleanCommitLine)
    .filter((line) => line.length > 0);

  const conventional = lines.find((line) => CONVENTIONAL_COMMIT_RE.test(line));
  if (conventional) {
    return normalizeCommitSubject(conventional);
  }

  const firstLine = lines[0] ?? "update staged changes";
  return normalizeCommitSubject(`chore: ${lowercaseFirst(firstLine)}`);
}

export function isConventionalCommitSubject(subject: string): boolean {
  return CONVENTIONAL_COMMIT_RE.test(subject.trim());
}

function cleanCommitLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^commit message:\s*/i, "")
    .replace(/^subject:\s*/i, "")
    .replace(/^message:\s*/i, "")
    .replace(/^[`"']+/, "")
    .replace(/[`"']+$/, "")
    .trim();
}

function normalizeCommitSubject(subject: string): string {
  const singleLine = subject.replace(/\s+/g, " ").trim();
  const withoutPeriod = singleLine.endsWith(".")
    ? singleLine.slice(0, -1)
    : singleLine;
  const withoutStaged = withoutPeriod
    .replace(/\bstaged commit message\b/gi, "commit message")
    .replace(/\bstaged changes\b/gi, "changes")
    .replace(/\bstaged diff\b/gi, "diff");

  return withoutStaged.replace(/^[A-Z]+/, (type) => type.toLowerCase());
}

function lowercaseFirst(value: string): string {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

function formatFileSummary(file: StagedFileMetadata): string {
  const rename = file.oldPath ? `${file.oldPath} -> ` : "";
  const stats =
    typeof file.additions === "number" || typeof file.deletions === "number"
      ? `, +${file.additions ?? 0}/-${file.deletions ?? 0}`
      : "";
  const binary = file.binary ? ", binary" : "";
  return `${file.status || "?"} ${rename}${file.path}${stats}${binary}`;
}

function isBinaryDiff(diff: string): boolean {
  return /^Binary files /m.test(diff) || /^GIT binary patch$/m.test(diff);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += escapeRegex(char);
    }
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
