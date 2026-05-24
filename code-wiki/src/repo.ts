import { execFileSync } from "node:child_process";
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
 * List files changed between a previous commit and HEAD.
 * Returns an empty list when the repo has no previous commit or git diff fails.
 */
export function getChangedFilesSince(previousCommit?: string): string[] {
  if (!previousCommit) {
    return [];
  }

  const output = runGit(["diff", "--name-only", previousCommit, "HEAD"]);
  return output ? output.split("\n").filter(Boolean).sort() : [];
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
  return runGit(["rev-parse", argument]);
}

function runGit(args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}
