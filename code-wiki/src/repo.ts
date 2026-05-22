import { execSync } from "node:child_process";
import * as path from "node:path";

/**
 * Detect the root of the current Git repository.
 * Returns the absolute path, or null if not inside a Git repo.
 */
export function getRepoRoot(): string | null {
  return gitRevParse("--show-toplevel");
}

/**
 * Get the current HEAD commit hash.
 * Returns null if not in a Git repo or no commits exist.
 */
export function getCurrentCommit(): string | null {
  return gitRevParse("HEAD");
}

/**
 * Validate that a resolved path is inside the repository root.
 */
export function isPathInsideRepo(
  resolvedPath: string,
  repoRoot: string,
): boolean {
  return (
    resolvedPath === repoRoot || resolvedPath.startsWith(repoRoot + path.sep)
  );
}

function gitRevParse(argument: string): string | null {
  try {
    const value = execSync(`git rev-parse ${argument}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}
