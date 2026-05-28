import type {
  PackageSource,
  ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import path from "node:path";

export const EXTENSION_TOGGLE_PACKAGE_NAME = "pi-extension-toggle";

type ToggleableScope = "user" | "project";

type PackageSourceObject = Extract<PackageSource, { source: string }>;

export type ResourceType = "extensions" | "skills" | "prompts" | "themes";

interface ResourceWithType {
  resource: ResolvedResource;
  type: ResourceType;
}

export interface ExtensionOption {
  label: string;
  resources: ResolvedResource[];
  sourceKey: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  resourceType?: ResourceType;
}

export interface FilteredExtensionOption {
  option: ExtensionOption;
  originalIndex: number;
  searchText: string;
}

export function isToggleableExtension(resource: ResolvedResource): boolean {
  return (
    resource.metadata.scope === "user" || resource.metadata.scope === "project"
  );
}

export function scopeLabel(scope: string): string {
  if (scope === "user") {
    return "global";
  }
  return scope;
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function getTopLevelPattern(
  resource: ResolvedResource,
  cwd: string,
  agentDir: string,
): string {
  const baseDir =
    resource.metadata.baseDir ??
    (resource.metadata.scope === "project" ? path.join(cwd, ".pi") : agentDir);

  return toPosix(path.relative(baseDir, resource.path));
}

export function getPackagePattern(resource: ResolvedResource): string {
  const baseDir = resource.metadata.baseDir ?? path.dirname(resource.path);
  return toPosix(path.relative(baseDir, resource.path));
}

export function getExtensionPattern(
  resource: ResolvedResource,
  cwd: string,
  agentDir: string,
): string {
  return resource.metadata.origin === "package"
    ? getPackagePattern(resource)
    : getTopLevelPattern(resource, cwd, agentDir);
}

export function stripPatternPrefix(pattern: string): string {
  if (
    pattern.startsWith("!") ||
    pattern.startsWith("+") ||
    pattern.startsWith("-")
  ) {
    return pattern.slice(1);
  }
  return pattern;
}

export function withoutExistingPattern(
  patterns: string[] | undefined,
  exactPattern: string,
): string[] {
  return (patterns ?? []).filter(
    (pattern) => stripPatternPrefix(pattern) !== exactPattern,
  );
}

export function toggleExtensionPatterns(
  patterns: string[] | undefined,
  exactPattern: string,
  enabled: boolean,
): string[] {
  const updated = withoutExistingPattern(patterns, exactPattern);
  updated.push(`${enabled ? "+" : "-"}${exactPattern}`);
  return updated;
}

export function toggleTopLevelResourcePaths(
  paths: string[] | undefined,
  exactPattern: string,
  enabled: boolean,
): string[] {
  return toggleExtensionPatterns(paths, exactPattern, enabled);
}

export const toggleTopLevelExtensionPaths = toggleTopLevelResourcePaths;

export function toggleAllTopLevelResources(enable: boolean): string[] {
  if (enable) {
    return [];
  }
  return ["!*"];
}

export function toggleAllPackageResources(
  packages: PackageSource[] | undefined,
  source: string,
  enable: boolean,
): { packages: PackageSource[]; changed: boolean } {
  const nextPackages = [...(packages ?? [])];
  const packageIndex = nextPackages.findIndex((pkg) => {
    return (typeof pkg === "string" ? pkg : pkg.source) === source;
  });

  if (packageIndex === -1) {
    return { packages: nextPackages, changed: false };
  }

  const currentPackage = nextPackages[packageIndex];
  const packageObject: PackageSourceObject =
    typeof currentPackage === "string"
      ? { source: currentPackage }
      : { ...currentPackage };

  if (enable) {
    // Clear all filters to enable all resources
    delete packageObject.extensions;
    delete packageObject.skills;
    delete packageObject.prompts;
    delete packageObject.themes;
  } else {
    // Empty package filters explicitly disable all resources of that type.
    packageObject.extensions = [];
    packageObject.skills = [];
    packageObject.prompts = [];
    packageObject.themes = [];
  }

  const hasFilters =
    packageObject.extensions !== undefined ||
    packageObject.skills !== undefined ||
    packageObject.prompts !== undefined ||
    packageObject.themes !== undefined;

  nextPackages[packageIndex] = hasFilters
    ? packageObject
    : packageObject.source;

  return { packages: nextPackages, changed: true };
}

export function togglePackageSources(
  packages: PackageSource[] | undefined,
  source: string,
  exactPattern: string,
  enabled: boolean,
): { packages: PackageSource[]; changed: boolean } {
  const nextPackages = [...(packages ?? [])];
  const packageIndex = nextPackages.findIndex((pkg) => {
    return (typeof pkg === "string" ? pkg : pkg.source) === source;
  });

  if (packageIndex === -1) {
    return { packages: nextPackages, changed: false };
  }

  const currentPackage = nextPackages[packageIndex];
  const packageObject: PackageSourceObject =
    typeof currentPackage === "string"
      ? { source: currentPackage }
      : { ...currentPackage };

  packageObject.extensions = toggleExtensionPatterns(
    packageObject.extensions,
    exactPattern,
    enabled,
  );

  const hasFilters = ["extensions", "skills", "prompts", "themes"].some(
    (key) => packageObject[key as keyof PackageSourceObject] !== undefined,
  );

  nextPackages[packageIndex] = hasFilters
    ? packageObject
    : packageObject.source;

  return { packages: nextPackages, changed: true };
}

function resourceTypeLabel(type: ResourceType): string {
  switch (type) {
    case "extensions":
      return "extension";
    case "skills":
      return "skill";
    case "prompts":
      return "prompt";
    case "themes":
      return "theme";
  }
}

function topLevelResourceName(pattern: string, type: ResourceType): string {
  const parts = pattern.split("/").filter(Boolean);
  if (parts[0] === type && parts.length >= 2) {
    return parts.length >= 3 ? parts[1] : parts[parts.length - 1];
  }
  return parts[parts.length - 1] ?? pattern;
}

export function getExtensionSourceLabel(
  resource: ResolvedResource,
  type?: ResourceType,
  pattern?: string,
): string {
  if (resource.metadata.origin === "package") {
    return `${resource.metadata.source} (${scopeLabel(resource.metadata.scope)})`;
  }

  if (type && pattern) {
    return `${topLevelResourceName(pattern, type)} (${scopeLabel(resource.metadata.scope)} ${resourceTypeLabel(type)})`;
  }

  if (resource.metadata.scope === "project") {
    return "Project (.pi/)";
  }

  return "Global (~/.pi/agent/)";
}

export function isSourceEnabled(resources: ResolvedResource[]): boolean {
  return resources.some((r) => r.enabled);
}

function uniqueSearchParts(parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(value);
  }

  return values.join(" ");
}

export function buildExtensionOptionSearchText(
  option: ExtensionOption,
): string {
  const resourceParts = option.resources.flatMap((resource) => [
    resource.path,
    path.basename(resource.path),
    path.dirname(resource.path),
    resource.metadata.source,
    resource.metadata.scope,
    resource.metadata.origin,
    resource.metadata.baseDir,
  ]);

  return uniqueSearchParts([
    option.label,
    option.sourceKey,
    option.scope,
    option.origin,
    option.resourceType,
    option.resourceType ? resourceTypeLabel(option.resourceType) : undefined,
    ...resourceParts,
  ]);
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\-_./:()]+/g, " ")
    .trim();
}

export function filterExtensionOptions(
  options: ExtensionOption[],
  query: string,
): FilteredExtensionOption[] {
  const indexedOptions = options.map((option, originalIndex) => ({
    option,
    originalIndex,
    searchText: buildExtensionOptionSearchText(option),
  }));
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) {
    return indexedOptions;
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const directMatches = indexedOptions.filter((entry) => {
    const normalizedText = normalizeSearchText(entry.searchText);
    return tokens.every((token) => normalizedText.includes(token));
  });

  return fuzzyFilter(directMatches, query, (entry) => entry.searchText);
}

export function buildSourceOptions(
  extensions: ResolvedResource[],
  skills: ResolvedResource[],
  prompts: ResolvedResource[],
  themes: ResolvedResource[],
  context?: { cwd: string; agentDir: string },
): ExtensionOption[] {
  // Filter out the toggle manager extension and non-toggleable resources
  const allResources: ResourceWithType[] = [
    ...extensions.map((resource) => ({
      resource,
      type: "extensions" as const,
    })),
    ...skills.map((resource) => ({ resource, type: "skills" as const })),
    ...prompts.map((resource) => ({ resource, type: "prompts" as const })),
    ...themes.map((resource) => ({ resource, type: "themes" as const })),
  ].filter(
    ({ resource }) =>
      isToggleableExtension(resource) && !isExtensionToggleManager(resource),
  );

  const groups = new Map<string, ResourceWithType[]>();

  for (const entry of allResources) {
    const { resource, type } = entry;
    const key =
      resource.metadata.origin === "package"
        ? resource.metadata.source
        : `${resource.metadata.scope}:${type}:${getTopLevelPattern(
            resource,
            context?.cwd ?? "",
            context?.agentDir ?? "",
          )}`;

    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const options: ExtensionOption[] = [];

  for (const [key, entries] of groups) {
    const first = entries[0];
    const firstResource = first.resource;
    const pattern =
      firstResource.metadata.origin === "top-level"
        ? getTopLevelPattern(
            firstResource,
            context?.cwd ?? "",
            context?.agentDir ?? "",
          )
        : undefined;
    const label = getExtensionSourceLabel(firstResource, first.type, pattern);

    const scope = firstResource.metadata.scope;
    assertToggleableScope(scope);

    options.push({
      label,
      resources: entries.map((entry) => entry.resource),
      sourceKey:
        firstResource.metadata.origin === "package" ? key : (pattern ?? key),
      scope,
      origin: firstResource.metadata.origin,
      resourceType:
        firstResource.metadata.origin === "top-level" ? first.type : undefined,
    });
  }

  return options;
}

export function isExtensionToggleManager(resource: ResolvedResource): boolean {
  const normalizedPath = resource.path.replaceAll(path.sep, "/");
  return (
    resource.metadata.source.includes(EXTENSION_TOGGLE_PACKAGE_NAME) ||
    normalizedPath.includes(`/${EXTENSION_TOGGLE_PACKAGE_NAME}/`) ||
    normalizedPath.includes("/extension-toggle/")
  );
}

export function assertToggleableScope(
  scope: string,
): asserts scope is ToggleableScope {
  if (scope !== "user" && scope !== "project") {
    throw new Error(`Cannot persist changes for ${scope} extensions`);
  }
}
