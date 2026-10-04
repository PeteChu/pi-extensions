import {
  DefaultPackageManager,
  SettingsManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getExtensionPattern } from "./utils";

export interface ResourceSnapshot {
  packages?: PackageSource[];
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

const RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"] as const;
const SNAPSHOT_FIELDS = ["packages", ...RESOURCE_FIELDS] as const;
const STORE_FILENAME = "extension-toggle-collections.json";

function validateName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new Error("Collection names must be 1–64 letters, digits, underscores or hyphens, starting with a letter or digit.");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateSnapshot(value: unknown): asserts value is ResourceSnapshot {
  if (!isObject(value) || Object.keys(value).some((key) => !SNAPSHOT_FIELDS.includes(key as typeof SNAPSHOT_FIELDS[number]))) {
    throw new Error("Invalid collection resource settings");
  }
  for (const field of RESOURCE_FIELDS) {
    if (Object.hasOwn(value, field) && !isStringArray(value[field])) {
      throw new Error(`Invalid collection ${field}: expected an array of strings`);
    }
  }
  if (!Object.hasOwn(value, "packages")) return;
  if (!Array.isArray(value.packages) || !value.packages.every((pkg) => {
    if (typeof pkg === "string") return pkg.trim().length > 0;
    return isObject(pkg) && typeof pkg.source === "string" && pkg.source.trim().length > 0 &&
      Object.keys(pkg).every((key) => key === "source" || RESOURCE_FIELDS.includes(key as typeof RESOURCE_FIELDS[number])) &&
      RESOURCE_FIELDS.every((field) => !Object.hasOwn(pkg, field) || isStringArray(pkg[field]));
  })) {
    throw new Error("Invalid collection packages: expected package sources with string-array filters");
  }
}

export async function readCollections(agentDir: string): Promise<Record<string, ResourceSnapshot>> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(agentDir, STORE_FILENAME), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const data: unknown = JSON.parse(raw);
  if (!isObject(data)) throw new Error("Invalid collections file: expected named collections");
  for (const [name, snapshot] of Object.entries(data)) {
    validateName(name);
    validateSnapshot(snapshot);
  }
  return data as Record<string, ResourceSnapshot>;
}

export async function saveCollection(agentDir: string, name: string, settings: ResourceSnapshot): Promise<void> {
  validateName(name);
  const collections = await readCollections(agentDir);
  if (Object.hasOwn(collections, name)) throw new Error(`Collection "${name}" already exists`);
  const snapshot = Object.fromEntries(
    SNAPSHOT_FIELDS.filter((field) => settings[field] !== undefined)
      .map((field) => [field, settings[field]]),
  );
  validateSnapshot(snapshot);
  collections[name] = snapshot;
  await writeCollections(agentDir, collections);
}

async function writeCollections(agentDir: string, collections: Record<string, ResourceSnapshot>): Promise<void> {
  const filePath = path.join(agentDir, STORE_FILENAME);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.mkdir(agentDir, { recursive: true });
  // ponytail: concurrent sessions are last-writer-wins; add a file lock if shared editing is needed.
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(collections, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export async function renameCollection(agentDir: string, name: string, newName: string): Promise<void> {
  validateName(newName);
  const collections = await readCollections(agentDir);
  if (!Object.hasOwn(collections, name)) throw new Error(`Unknown collection "${name}"`);
  if (name === newName) return;
  if (Object.hasOwn(collections, newName)) throw new Error(`Collection "${newName}" already exists`);
  collections[newName] = collections[name];
  delete collections[name];
  await writeCollections(agentDir, collections);
}

export async function deleteCollection(agentDir: string, name: string): Promise<void> {
  const collections = await readCollections(agentDir);
  if (!Object.hasOwn(collections, name)) throw new Error(`Unknown collection "${name}"`);
  delete collections[name];
  await writeCollections(agentDir, collections);
}

export function assertSettingsErrors(settingsManager: SettingsManager): void {
  const errors = settingsManager.drainErrors();
  if (errors.length > 0) {
    throw new Error(errors.map(({ scope, error }) => `${scope} settings: ${error.message}`).join("; "));
  }
}

function forceIncludeManager(
  patterns: string[] | undefined,
  resourcePath: string,
  baseDir: string,
  includePattern: string,
): string[] {
  const absolute = resourcePath.split(path.sep).join("/");
  const relative = path.relative(baseDir, resourcePath).split(path.sep).join("/");
  const updated = (patterns ?? []).filter((pattern) => {
    if (!pattern.startsWith("+") && !pattern.startsWith("-")) return true;
    const exact = pattern.slice(1);
    const normalized = (exact.startsWith("./") || exact.startsWith(".\\") ? exact.slice(2) : exact)
      .split(path.sep).join("/");
    return normalized !== absolute && normalized !== relative;
  });
  updated.push(`+${includePattern.split(path.sep).join("/")}`);
  return updated;
}

export async function restoreCollection(
  settingsManager: SettingsManager,
  snapshot: ResourceSnapshot,
  context: { cwd: string; agentDir: string },
): Promise<void> {
  assertSettingsErrors(settingsManager);
  validateSnapshot(snapshot);
  const current = settingsManager.getGlobalSettings();
  const currentSources = (current.packages ?? []).map((pkg) => typeof pkg === "string" ? pkg : pkg.source);
  const savedSources = (snapshot.packages ?? []).map((pkg) => typeof pkg === "string" ? pkg : pkg.source);
  if (JSON.stringify(currentSources) !== JSON.stringify(savedSources)) {
    throw new Error("Package source declarations changed since this collection was saved. Save a new collection before switching.");
  }
  const restored = structuredClone(snapshot);
  const globalExtensions = async (settings: ResourceSnapshot) => {
    const manager = new DefaultPackageManager({ ...context, settingsManager: SettingsManager.inMemory(settings) });
    return (await manager.resolve(async () => "skip")).extensions;
  };
  const [currentExtensions, restoredExtensions] = await Promise.all([
    globalExtensions(current), globalExtensions(restored),
  ]);
  const managerPath = await fs.realpath(new URL("./index.ts", import.meta.url));
  for (const resource of currentExtensions) {
    if (resource.metadata.scope !== "user" || await fs.realpath(resource.path) !== managerPath) continue;
    const restoredResource = restoredExtensions.find(
      (candidate) => candidate.metadata.scope === "user" && candidate.path === resource.path,
    );
    if (restoredResource?.enabled) continue;
    if (resource.metadata.origin === "package") {
      const pkg = restored.packages?.find((entry) => (typeof entry === "string" ? entry : entry.source) === resource.metadata.source);
      if (pkg && typeof pkg !== "string") {
        // Empty filters disable everything; a lone +include otherwise enables siblings by default.
        pkg.extensions = forceIncludeManager(
          pkg.extensions?.length === 0 ? ["!*"] : pkg.extensions,
          resource.path,
          resource.metadata.baseDir ?? path.dirname(resource.path),
          getExtensionPattern(resource, context.cwd, context.agentDir),
        );
      }
    } else {
      if (!restoredResource) {
        restored.extensions = [...(restored.extensions ?? []), resource.path];
      }
      restored.extensions = forceIncludeManager(
        restored.extensions, resource.path, context.agentDir, resource.path,
      );
    }
  }
  // Pi's setters store undefined verbatim; JSON serialization removes absent fields.
  // The non-null assertions bridge their array-only declarations; preserve absence, not [].
  settingsManager.setPackages(restored.packages!);
  settingsManager.setExtensionPaths(restored.extensions!);
  settingsManager.setSkillPaths(restored.skills!);
  settingsManager.setPromptTemplatePaths(restored.prompts!);
  settingsManager.setThemePaths(restored.themes!);
  await settingsManager.flush();
  assertSettingsErrors(settingsManager);
}
