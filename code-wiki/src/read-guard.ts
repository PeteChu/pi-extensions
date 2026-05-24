/**
 * Read-guard — enforces target-directory scope and exclude patterns on
 * `read` tool calls during code-wiki operations (init / update / query).
 *
 * The guard is stateful: call `activate` before sending a wiki prompt,
 * `deactivate` on agent_end or session_shutdown. `check` is called from
 * the `tool_call` event handler to allow or block reads.
 *
 * Pattern matching is injected via the `Matcher` type so the guard module
 * has no direct dependency on the crawler or glob modules.
 */

import * as path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ReadGuardState {
  /** Absolute path to the repository root */
  repoRoot: string;
  /** Absolute path to the target directory (narrowed scope) */
  targetDir: string;
  /** Absolute path to the wiki output directory */
  wikiDir: string;
  /** Whether wiki artifact reads should be allowed (update / query) */
  allowWikiReads: boolean;
  /** Parsed exclude patterns (repository-relative globs) */
  excludePatterns: string[];
}

export type Matcher = (filepath: string, patterns: string[]) => boolean;

export interface ReadGuard {
  activate(state: ReadGuardState): void;
  deactivate(): void;
  check(
    requestedPath: string,
    cwd: string,
  ): { block: true; reason: string } | undefined;
  parseExcludePatterns(exclude?: string): string[];
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createReadGuard(
  matcher: Matcher,
  defaultExclude: string,
): ReadGuard {
  let state: ReadGuardState | undefined;

  return {
    activate(newState: ReadGuardState): void {
      if (state) {
        throw new Error(
          "Read-guard is already active. Call deactivate() before re-activating.",
        );
      }
      state = { ...newState };
    },

    deactivate(): void {
      state = undefined;
    },

    check(
      requestedPath: string,
      cwd: string,
    ): { block: true; reason: string } | undefined {
      if (!state) return undefined;

      // Resolve to an absolute path (relative paths are relative to cwd)
      const resolved = path.resolve(cwd, requestedPath);

      // Compute repo-relative path for matching
      const relPath = path.relative(state.repoRoot, resolved);

      // If the resolved path is outside the repo root, let the built-in read
      // handle it normally (it will fail) rather than injecting our own error.
      if (relPath.startsWith("..") || path.isAbsolute(relPath))
        return undefined;

      // Allow wiki artifact reads for update/query
      if (state.allowWikiReads) {
        const wikiRel = path.relative(state.repoRoot, state.wikiDir);
        if (relPath === wikiRel || relPath.startsWith(wikiRel + path.sep)) {
          return undefined; // allowed — wiki artifact
        }
      }

      // Block reads outside the target directory (narrowed scope)
      const targetRel = path.relative(state.targetDir, resolved);
      if (targetRel.startsWith("..") || path.isAbsolute(targetRel)) {
        return {
          block: true,
          reason: `Blocked by code-wiki target scope: "${relPath}" is outside the target directory`,
        };
      }

      // Check exclude patterns
      if (matcher(relPath, state.excludePatterns)) {
        return {
          block: true,
          reason: `Blocked by code-wiki exclude pattern: ${relPath}`,
        };
      }

      return undefined;
    },

    parseExcludePatterns(exclude?: string): string[] {
      const raw = exclude || defaultExclude;
      return raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    },
  };
}
