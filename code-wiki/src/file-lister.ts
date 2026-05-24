/**
 * Filtered file lister — crawls the filesystem and returns matching file paths.
 *
 * Respects .gitignore, include/exclude glob patterns, and max file size.
 * This gives Pi's agent a complete file map without reading everything upfront.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { globMatch, matchesAny } from "./glob";

const DEFAULT_EXCLUDED_DIRS = [
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
];

/**
 * Crawl a local directory and return matching file paths (relative to the root).
 *
 * @param rootDir   - Absolute path to the repository root
 * @param include   - Glob patterns for files to include (e.g., ["*.py", "*.ts"])
 * @param exclude   - Glob patterns for files to exclude (e.g., ["tests/*", "docs/*"])
 * @param maxSize   - Maximum file size in bytes (skip larger files)
 * @returns Array of relative file paths sorted alphabetically
 */
export function crawlFiles(
  rootDir: string,
  include: string[],
  exclude: string[],
  maxSize: number,
): string[] {
  const results: string[] = [];

  const gitignorePatterns = loadGitignore(rootDir);

  walkDir(rootDir, rootDir, results, {
    include,
    exclude,
    gitignorePatterns,
    defaultExclude: DEFAULT_EXCLUDED_DIRS,
    maxSize,
  });

  results.sort();
  return results;
}

interface WalkOptions {
  include: string[];
  exclude: string[];
  gitignorePatterns: string[];
  defaultExclude: string[];
  maxSize: number;
}

function walkDir(
  rootDir: string,
  currentDir: string,
  results: string[],
  opts: WalkOptions,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return; // skip unreadable directories
  }

  for (const entry of entries) {
    const absPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, absPath);

    if (entry.isDirectory()) {
      if (opts.defaultExclude.includes(entry.name)) continue;
      if (matchesAny(relPath, opts.exclude)) continue;
      if (matchesGitignore(relPath, opts.gitignorePatterns)) continue;

      walkDir(rootDir, absPath, results, opts);
    } else if (entry.isFile()) {
      if (matchesGitignore(relPath, opts.gitignorePatterns)) continue;
      if (matchesAny(relPath, opts.exclude)) continue;
      if (!matchesAny(relPath, opts.include)) continue;

      try {
        if (fs.statSync(absPath).size > opts.maxSize) continue;
      } catch {
        continue;
      }

      results.push(relPath);
    }
  }
}

// ── Gitignore support (duplicated — each walker owns its own copy) ────────

/**
 * Load .gitignore patterns from the repository root.
 */
function loadGitignore(rootDir: string): string[] {
  const gitignorePath = path.join(rootDir, ".gitignore");
  try {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Check if a relative path matches any .gitignore pattern.
 * Handles patterns with leading / (root-relative) and trailing / (directories).
 */
function matchesGitignore(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    let p = pattern;

    // If pattern ends with /, it only matches directories
    // (We don't have dir-only matching here since we check files)
    if (p.endsWith("/")) {
      p = p.slice(0, -1);
    }

    // If pattern starts with /, anchor to root
    if (p.startsWith("/")) {
      p = p.slice(1);
    }

    if (!p) continue;

    if (globMatch(relPath, p)) return true;

    // Also try matching with **/ prefix for non-anchored patterns
    if (!pattern.startsWith("/") && globMatch(relPath, "**/" + p)) return true;
  }
  return false;
}
