import path from "node:path";
import type { PackageSource, ResolvedResource } from "@earendil-works/pi-coding-agent";

export const EXTENSION_TOGGLE_PACKAGE_NAME = "pi-extension-toggle";

type ToggleableScope = "user" | "project";

type PackageSourceObject = Extract<PackageSource, { source: string }>;

export interface ExtensionOption {
  label: string;
  resource: ResolvedResource;
}

export function isToggleableExtension(resource: ResolvedResource): boolean {
  return resource.metadata.scope === "user" || resource.metadata.scope === "project";
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

export function toggleTopLevelExtensionPaths(
  paths: string[] | undefined,
  exactPattern: string,
  enabled: boolean,
): string[] {
  return toggleExtensionPatterns(paths, exactPattern, enabled);
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

export function getExtensionSourceLabel(resource: ResolvedResource): string {
  if (resource.metadata.origin === "package") {
    return `${resource.metadata.source} (${scopeLabel(resource.metadata.scope)})`;
  }

  if (resource.metadata.scope === "project") {
    return "Project (.pi/)";
  }

  return "Global (~/.pi/agent/)";
}

export function buildExtensionLabel(
  resource: ResolvedResource,
  cwd: string,
  agentDir: string,
): string {
  const checkbox = resource.enabled ? "[x]" : "[ ]";
  const sourceLabel = getExtensionSourceLabel(resource);
  const pattern = getExtensionPattern(resource, cwd, agentDir);
  return `${checkbox} ${sourceLabel} ${pattern}`;
}

export function buildExtensionOptions(
  resources: ResolvedResource[],
  cwd: string,
  agentDir: string,
): ExtensionOption[] {
  const labels = new Map<string, number>();

  return resources
    .filter((resource) =>
      isToggleableExtension(resource) && !isExtensionToggleManager(resource),
    )
    .map((resource) => {
      const baseLabel = buildExtensionLabel(resource, cwd, agentDir);
      const count = labels.get(baseLabel) ?? 0;
      labels.set(baseLabel, count + 1);

      return {
        label: count === 0 ? baseLabel : `${baseLabel} #${count + 1}`,
        resource,
      };
    });
}

export function isExtensionToggleManager(resource: ResolvedResource): boolean {
  const normalizedPath = resource.path.replaceAll(path.sep, "/");
  return (
    resource.metadata.source.includes(EXTENSION_TOGGLE_PACKAGE_NAME) ||
    normalizedPath.includes(`/${EXTENSION_TOGGLE_PACKAGE_NAME}/`) ||
    normalizedPath.includes("/extension-toggle/")
  );
}

export function toggleTargetEnabled(resource: ResolvedResource): boolean {
  return !resource.enabled;
}

export function assertToggleableScope(
  scope: string,
): asserts scope is ToggleableScope {
  if (scope !== "user" && scope !== "project") {
    throw new Error(`Cannot persist changes for ${scope} extensions`);
  }
}
