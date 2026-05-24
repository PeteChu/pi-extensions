/**
 * Shared utilities with no dependencies on other modules.
 */

/**
 * Split a comma-separated string of patterns into a trimmed, non-empty array.
 * Used by both the read-guard (at handler call sites) and the prompt-context
 * provider (for include/exclude pattern parsing).
 */
export function splitPatterns(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}
