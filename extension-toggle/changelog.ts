import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export interface ChangelogEntry { version: string; markdown: string }
export interface ExtensionChangelog {
  key: string;
  version: string;
  markdown: string;
}

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;

function parseVersion(version: string) {
  const match = versionPattern.exec(version);
  if (!match) return undefined;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === "0")) return undefined;
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

/** SemVer precedence, including prereleases; build metadata does not affect precedence. */
export function compareVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) return undefined;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** Keep Markdown sections intact, and ignore version-looking headings in code fences. */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | undefined;
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && /^\s*(?:`+|~+)\s*$/.test(line)) fence = undefined;
      if (current) current.markdown += `${line}\n`;
      continue;
    }
    const heading = !fence && /^#{1,2}\s+\[?v?(\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?)(?=\]|\s|$)/.exec(line);
    if (heading && parseVersion(heading[1])) {
      current = { version: heading[1], markdown: `${line}\n` };
      entries.push(current);
    } else if (!fence && /^#{1,2}\s+(?:\[unreleased\](?=\s|\(|$)|unreleased(?=\s|$))/i.test(line)) {
      current = undefined;
    } else if (current) current.markdown += `${line}\n`;
  }
  return entries.map(entry => ({ ...entry, markdown: entry.markdown.trim() }));
}

export async function readExtensionChangelog(
  root = fileURLToPath(new URL(".", import.meta.url)),
): Promise<ExtensionChangelog> {
  const manifest: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (!manifest || typeof manifest !== "object" ||
      !("name" in manifest) || manifest.name !== "@petechu/pi-extension-toggle" ||
      !("version" in manifest) || typeof manifest.version !== "string" || !parseVersion(manifest.version)) {
    throw new Error("Invalid extension-toggle package manifest.");
  }
  const version = manifest.version;
  const markdown = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
  const entries = parseChangelog(markdown).filter(entry => (compareVersions(entry.version, version) ?? 1) <= 0);
  return {
    key: path.resolve(root),
    version,
    markdown: entries.map(entry => entry.markdown).join("\n\n") || "No release notes provided.",
  };
}

let pending = Promise.resolve();
export async function notifyExtensionUpdate(
  ctx: Pick<ExtensionContext, "hasUI"> & { ui: Pick<ExtensionContext["ui"], "notify"> },
  release: ExtensionChangelog, agentDir = getAgentDir(),
): Promise<void> {
  if (!ctx.hasUI) return;
  const task = pending.then(async () => {
    const filename = path.join(agentDir, "extension-toggle", "changelog-seen-v1.json");
    const versions: Record<string, string> = Object.create(null);
    try {
      const saved: unknown = JSON.parse(await readFile(filename, "utf8"));
      if (saved && typeof saved === "object" && "schemaVersion" in saved && saved.schemaVersion === 1 &&
          "versions" in saved && saved.versions && typeof saved.versions === "object" && !Array.isArray(saved.versions)) {
        for (const [key, value] of Object.entries(saved.versions)) {
          if (typeof value === "string" && parseVersion(value)) versions[key] = value;
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) &&
          !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const previous = versions[release.key];
    if (previous && (compareVersions(release.version, previous) ?? 0) <= 0) return;
    versions[release.key] = release.version;
    await mkdir(path.dirname(filename), { recursive: true });
    if (previous) {
      ctx.ui.notify(`extension-toggle updated (${previous} → ${release.version}). Run /extension-toggle changelog to see what changed.`, "info");
    }
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, versions }), "utf8");
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  });
  pending = task.catch(() => {});
  return task;
}
