/**
 * Lightweight project profiler — walks the filesystem for a statistical snapshot.
 *
 * Respects .gitignore and default excluded directories. Returns extension counts,
 * file/directory totals, and recognized config files. No include/exclude/size
 * filtering — the goal is a complete snapshot for auto-selection heuristics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { globMatch } from "./glob";

const DEFAULT_EXCLUDED_DIRS = [
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
];

/** Recognized project config filenames (checked at the target root only). */
const RECOGNIZED_CONFIG_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "Makefile",
  "Dockerfile",
  "CMakeLists.txt",
  "Gemfile",
  "mix.exs",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "requirements.txt",
]);

/** Lean summary returned by {@link profileProjectFiles}. */
export interface ProjectProfile {
  /** File counts keyed by extension (leading dot, e.g. ".ts"). */
  extensionCounts: Record<string, number>;
  /** Total number of files (excluding excluded dirs and git-ignored). */
  totalFiles: number;
  /** Total number of directories (excluding excluded dirs and git-ignored). */
  totalDirs: number;
  /** Recognized config filenames found at the target root. */
  configFiles: string[];
}

/**
 * Walk a directory and return a lean file-distribution profile.
 *
 * Respects {@link DEFAULT_EXCLUDED_DIRS} and `.gitignore` but does NOT apply
 * include/exclude/size filtering — the goal is a complete snapshot so the agent
 * (or auto-selection heuristics) can understand the project type.
 *
 * @param rootDir - Absolute path to the repository root
 * @returns A {@link ProjectProfile} with extension counts, totals, and config files.
 */
export function profileProjectFiles(rootDir: string): ProjectProfile {
  const state: ProfileWalkState = {
    extensionCounts: {},
    totalFiles: 0,
    totalDirs: 0,
    gitignorePatterns: loadGitignore(rootDir),
    defaultExclude: DEFAULT_EXCLUDED_DIRS,
  };

  profileWalk(rootDir, rootDir, state);

  // Look for recognized config files at root only
  const configFiles: string[] = [];
  for (const name of RECOGNIZED_CONFIG_FILES) {
    const absPath = path.join(rootDir, name);
    try {
      if (fs.statSync(absPath).isFile()) {
        configFiles.push(name);
      }
    } catch {
      // not found — skip
    }
  }

  return {
    extensionCounts: state.extensionCounts,
    totalFiles: state.totalFiles,
    totalDirs: state.totalDirs,
    configFiles,
  };
}

interface ProfileWalkState {
  extensionCounts: Record<string, number>;
  totalFiles: number;
  totalDirs: number;
  gitignorePatterns: string[];
  defaultExclude: string[];
}

function profileWalk(
  rootDir: string,
  currentDir: string,
  state: ProfileWalkState,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, absPath);

    if (entry.isDirectory()) {
      if (state.defaultExclude.includes(entry.name)) continue;
      if (matchesGitignore(relPath, state.gitignorePatterns)) continue;

      state.totalDirs++;
      profileWalk(rootDir, absPath, state);
    } else if (entry.isFile()) {
      if (matchesGitignore(relPath, state.gitignorePatterns)) continue;

      state.totalFiles++;
      const ext = path.extname(entry.name).toLowerCase() || "(no extension)";
      state.extensionCounts[ext] = (state.extensionCounts[ext] || 0) + 1;
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
