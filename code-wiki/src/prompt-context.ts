/**
 * Context Provider — gathers all data needed for prompt composition.
 * This is the I/O layer: filesystem crawling, git operations, option parsing.
 * The prompt composers (prompt.ts) are pure and take the resulting PromptContext.
 */

import * as path from "node:path";
import {
  DEFAULT_DETAIL_LEVEL,
  parseDetailLevel,
  type DetailLevel,
} from "./detail-level";
import { crawlFiles } from "./file-lister";
import { getFormatAdapter } from "./obsidian";
import type { ProjectProfile } from "./profiler";
import { profileProjectFiles } from "./profiler";
import {
  DEFAULT_EXCLUDE,
  type PromptConfig,
  type PromptContext,
} from "./prompt-types";
import { getChangedFilesSince, getCurrentCommit } from "./repo";
import { splitPatterns } from "./utils";
import { WIKI_FORMATS, type WikiFormat } from "./wiki-layout";

/**
 * Gather all data needed to compose a wiki prompt.
 * Crawls the filesystem, queries git, and parses options — everything
 * the pure prompt composers need in a single structured context.
 */
export function resolvePromptContext(config: PromptConfig): PromptContext {
  const {
    repoRoot,
    targetDir,
    wikiDir,
    projectName,
    options,
    maxSize,
    previousCommit,
  } = config;

  const language = getNonEmptyStringOption(options, "language", "english");
  const format = getFormatOption(options);
  const detailLevel = getDetailLevelOption(options);
  const excludeRaw = getStringOption(options, "exclude", DEFAULT_EXCLUDE);

  // Auto-discover include patterns from the project profile
  const profile = profileProjectFiles(targetDir);
  const includeRaw = autoSelectPatterns(profile);

  const includePatterns = splitPatterns(includeRaw);
  const excludePatterns = splitPatterns(excludeRaw);

  // Crawl from the target directory, then convert to repo-relative paths
  const targetRel = path.relative(repoRoot, targetDir);
  const fileListing = crawlFiles(
    targetDir,
    includePatterns,
    excludePatterns,
    maxSize,
  );
  const repoRelativeFiles = targetRel
    ? fileListing.map((f) => path.join(targetRel, f))
    : fileListing;

  const wikiRelForSourceFilter = path.relative(repoRoot, wikiDir);
  const changedFiles = getChangedFilesSince(previousCommit).filter(
    (file) => !file.startsWith(wikiRelForSourceFilter + path.sep),
  );
  const scopedChangedFiles =
    targetDir === repoRoot
      ? changedFiles
      : changedFiles.filter(
          (file) => file === targetRel || file.startsWith(targetRel + path.sep),
        );

  const wikiRel = wikiRelForSourceFilter || "docs/code-wiki";
  const commit = getCurrentCommit();
  const generatedAt = new Date().toISOString();
  const generatedDate = generatedAt.slice(0, 10);

  const formatAdapter = getFormatAdapter(format);
  const formatRulesText = formatAdapter.getPromptRules(generatedDate);

  return {
    repoRoot,
    targetDir,
    wikiDir,
    wikiRel,
    projectName,
    language,
    format,
    detailLevel,
    maxSize,
    includePatterns,
    excludePatterns,
    fileList: repoRelativeFiles,
    changedFiles: scopedChangedFiles,
    profile,
    commit,
    generatedAt,
    generatedDate,
    formatRulesText,
  };
}

// ── Auto-selection heuristics ────────────────────────────────────────────

/** Extension sets mapped to recognized config files. */
const CONFIG_EXTENSION_MAP: Record<string, string[]> = {
  "tsconfig.json": ["*.ts", "*.tsx"],
  "package.json": ["*.js", "*.jsx", "*.mjs", "*.cjs"],
  "Cargo.toml": ["*.rs"],
  "go.mod": ["*.go"],
  "pyproject.toml": ["*.py", "*.pyi", "*.pyx"],
  "setup.py": ["*.py", "*.pyi", "*.pyx"],
  "setup.cfg": ["*.py", "*.pyi", "*.pyx"],
  "CMakeLists.txt": ["*.c", "*.cc", "*.cpp", "*.h", "*.hpp"],
  Gemfile: ["*.rb"],
  "mix.exs": ["*.ex", "*.exs"],
  "pom.xml": ["*.java", "*.kt", "*.kts"],
  "build.gradle": ["*.java", "*.kt", "*.kts"],
  "build.gradle.kts": ["*.java", "*.kt", "*.kts"],
  "composer.json": ["*.php"],
};

/** Extensions always included (docs and config are universally useful). */
const ALWAYS_INCLUDE = ["*.md", "*.rst", "*.yaml", "*.yml", "*.toml"];

/** Extensions never auto-selected (binary, asset, lockfiles). */
const ALWAYS_EXCLUDE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".lock",
  ".sum",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
]);

/**
 * Auto-select include patterns based on a project profile.
 *
 * Heuristic rules (in priority order):
 * 1. Start with extensions from recognized config files.
 * 2. Merge `ALWAYS_INCLUDE` (docs/config).
 * 3. If no config files were recognized, fall back to the top extensions by
 *    count (≥ 5 files, capped at 8) excluding binary/asset extensions.
 * 4. Deduplicate and return as a sorted comma-separated string.
 */
export function autoSelectPatterns(profile: ProjectProfile): string {
  const selected = new Set<string>();
  let hadConfigMatch = false;

  // 1. Config-driven extensions
  for (const configFile of profile.configFiles) {
    const exts = CONFIG_EXTENSION_MAP[configFile];
    if (exts) {
      hadConfigMatch = true;
      for (const ext of exts) selected.add(ext);
    }
  }

  // 2. Always-include extensions
  for (const ext of ALWAYS_INCLUDE) selected.add(ext);

  // 3. Fallback: top extensions by count when no config files were recognized
  if (!hadConfigMatch) {
    const ranked = Object.entries(profile.extensionCounts)
      .filter(
        ([ext]) =>
          !ALWAYS_EXCLUDE_EXTENSIONS.has(ext.toLowerCase()) &&
          ext !== "(no extension)",
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    for (const [ext] of ranked) {
      if (profile.extensionCounts[ext] >= 5) {
        selected.add(`*${ext}`);
      }
    }
  }

  return [...selected].sort().join(",");
}

// ── Option parsers ────────────────────────────────────────────────────────

function getStringOption(
  options: PromptConfig["options"],
  key: string,
  fallback: string,
): string {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}

function getNonEmptyStringOption(
  options: PromptConfig["options"],
  key: string,
  fallback: string,
): string {
  const value = getStringOption(options, key, fallback);
  return value || fallback;
}

function getFormatOption(options: PromptConfig["options"]): WikiFormat {
  const value = options.format;
  return WIKI_FORMATS.includes(value as WikiFormat)
    ? (value as WikiFormat)
    : "standard";
}

function getDetailLevelOption(options: PromptConfig["options"]): DetailLevel {
  return (
    parseDetailLevel(options.detailLevel) ??
    parseDetailLevel(options["detail-level"]) ??
    DEFAULT_DETAIL_LEVEL
  );
}
