/**
 * Pure glob pattern matching — no filesystem, no I/O, no project dependencies.
 *
 * Supports simple *, ?, and ** wildcards compatible with fnmatch-style patterns.
 * This is the single source of truth for all glob matching in the codebase.
 */

/**
 * Check if a filepath matches any glob pattern.
 * Supports simple * and ** globs compatible with fnmatch-style patterns.
 */
export function matchesAny(filepath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globMatch(filepath, pattern));
}

/**
 * Simple glob matching that handles *, ?, and **.
 * Compatible with the fnmatch behavior used by the PocketFlow Python crawler.
 */
export function globMatch(str: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(str);
}

function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*") {
      if (i + 1 < pattern.length && pattern[i + 1] === "*") {
        regexStr += ".*";
        i += 2;
        if (i < pattern.length && pattern[i] === "/") {
          regexStr += "/?";
          i++;
        }
      } else {
        regexStr += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (ch === ".") {
      regexStr += "\\.";
      i++;
    } else if (ch === "/") {
      regexStr += "/";
      i++;
    } else {
      regexStr += "(){}[]+^$|\\".includes(ch) ? "\\" + ch : ch;
      i++;
    }
  }

  return new RegExp("^" + regexStr + "$");
}
