import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import {
  getAgentDir,
  SettingsManager,
  DefaultPackageManager,
} from "@earendil-works/pi-coding-agent";
import type { UsageResourceType, UsageStatsRecord } from "./store";

interface TrackedResource {
  packageSource: string;
  resourceType: UsageResourceType;
  resourceName: string;
  active: boolean;
  count: number;
  firstUsed: string | null;
  lastUsed: string | null;
}

interface ReportDataset {
  generatedAt: string;
  privacyNote: string;
  resources: TrackedResource[];
  noLongerInstalledResources: TrackedResource[];
  staleThresholdDays: number;
}

type PackageResources = {
  extensions: ResolvedResource[];
  skills: ResolvedResource[];
};

type CurrentResource = Pick<
  TrackedResource,
  "packageSource" | "resourceType" | "resourceName" | "active"
>;

interface RuntimeToolResource {
  name: string;
  path?: string;
  source?: string;
  origin?: string;
  sourceInfo?: { origin: string; source: string };
}

interface RuntimeCommandResource {
  name: string;
  source: string;
  sourceInfo?: { origin: string; source: string; path?: string };
}

interface RuntimeResources {
  tools: RuntimeToolResource[];
  commands: RuntimeCommandResource[];
}

const PRIVACY_NOTE =
  "This report shows aggregate usage statistics for third-party installed Pi packages only. " +
  "It does not store user prompts, command arguments, tool arguments, tool results, skill contents, project paths, " +
  "session identifiers, or absolute resource paths. All data is stored locally and never transmitted.";

function isThirdPartyPackageResource(resource: ResolvedResource): boolean {
  return resource.metadata.origin === "package";
}

export async function discoverPackageResources(ctx: { cwd: string }): Promise<{
  packages: Map<string, PackageResources>;
}> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(ctx.cwd, agentDir);
  const packageManager = new DefaultPackageManager({
    cwd: ctx.cwd,
    agentDir,
    settingsManager,
  });
  const resolved = await packageManager.resolve();

  const packages = new Map<string, PackageResources>();

  for (const ext of resolved.extensions) {
    if (!isThirdPartyPackageResource(ext)) continue;
    getPackageResources(packages, ext.metadata.source).extensions.push(ext);
  }

  for (const skill of resolved.skills) {
    if (!isThirdPartyPackageResource(skill)) continue;
    getPackageResources(packages, skill.metadata.source).skills.push(skill);
  }

  return { packages };
}

function getPackageResources(
  packages: Map<string, PackageResources>,
  source: string,
): PackageResources {
  const existing = packages.get(source);
  if (existing) return existing;

  const resources: PackageResources = { extensions: [], skills: [] };
  packages.set(source, resources);
  return resources;
}

export function buildReportDataset(
  packages: Map<string, PackageResources>,
  storedRecords: UsageStatsRecord[] = [],
  staleThresholdDays = 7,
  runtimeNameMap?: Map<string, string>,
  runtime?: RuntimeResources,
): ReportDataset {
  const currentResources: CurrentResource[] = [];
  const extensionCommandPaths = runtime
    ? buildRuntimeExtensionCommandPaths(runtime)
    : new Set<string>();

  for (const [packageSource, entry] of packages) {
    for (const ext of entry.extensions) {
      const runtimeName = runtimeNameMap?.get(ext.path);
      if (!runtimeName && extensionCommandPaths.has(ext.path)) continue;
      currentResources.push({
        packageSource,
        resourceType: "tool",
        resourceName: runtimeName ?? resourceDisplayName(ext.path),
        active: ext.enabled !== false,
      });
    }
    for (const skill of entry.skills) {
      const runtimeName = runtimeNameMap?.get(skill.path);
      currentResources.push({
        packageSource,
        resourceType: "skill",
        resourceName: runtimeName ?? resourceDisplayName(skill.path),
        active: skill.enabled !== false,
      });
    }
  }

  if (runtime) {
    currentResources.push(...buildRuntimeCurrentResources(runtime));
  }

  return buildReportDatasetFromCurrentResources(
    currentResources,
    storedRecords,
    staleThresholdDays,
  );
}

export function buildRuntimeNameMap(
  runtime: RuntimeResources,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const tool of runtime.tools) {
    const origin = tool.sourceInfo?.origin ?? tool.origin;
    if (origin === "package" && tool.path) {
      map.set(tool.path, tool.name);
    }
  }

  for (const command of runtime.commands) {
    if (
      command.source === "skill" &&
      command.sourceInfo?.origin === "package"
    ) {
      const path = command.sourceInfo.path;
      if (path) {
        map.set(path, command.name);
      }
    }
  }

  return map;
}

function buildRuntimeExtensionCommandPaths(
  runtime: RuntimeResources,
): Set<string> {
  const paths = new Set<string>();

  for (const command of runtime.commands) {
    if (
      command.source === "extension" &&
      command.sourceInfo?.origin === "package" &&
      command.sourceInfo.path
    ) {
      paths.add(command.sourceInfo.path);
    }
  }

  return paths;
}

function buildRuntimeCurrentResources(
  runtime: RuntimeResources,
): CurrentResource[] {
  const currentResources: CurrentResource[] = [];

  for (const tool of runtime.tools) {
    const packageSource = packageToolSource(tool);
    if (packageSource) {
      currentResources.push({
        packageSource,
        resourceType: "tool",
        resourceName: tool.name,
        active: true,
      });
    }
  }

  for (const command of runtime.commands) {
    if (command.sourceInfo?.origin !== "package") continue;
    currentResources.push({
      packageSource: command.sourceInfo.source,
      resourceType: command.source === "skill" ? "skill" : "command",
      resourceName: command.name,
      active: true,
    });
  }

  return currentResources;
}

function buildReportDatasetFromCurrentResources(
  currentResources: CurrentResource[],
  storedRecords: UsageStatsRecord[],
  staleThresholdDays: number,
): ReportDataset {
  const resources: TrackedResource[] = [];
  const now = new Date().toISOString();
  const statsMap = new Map<string, UsageStatsRecord>();
  const installedSources = new Set<string>();
  const resourceKeys = new Set<string>();
  const resourceIndexes = new Map<string, number>();

  for (const record of storedRecords) {
    statsMap.set(statsKey(record), record);
  }

  for (const current of currentResources) {
    installedSources.add(current.packageSource);
    const key = statsKey(current);
    const stored = statsMap.get(key);
    const resource = {
      ...current,
      count: stored?.count ?? 0,
      firstUsed: stored?.firstUsed ?? null,
      lastUsed: stored?.lastUsed ?? null,
    };

    if (resourceKeys.has(key)) {
      const index = resourceIndexes.get(key);
      if (current.active && index !== undefined && !resources[index].active) {
        resources[index] = resource;
      }
      continue;
    }

    resourceKeys.add(key);
    resourceIndexes.set(key, resources.length);
    resources.push(resource);
  }

  const noLongerInstalledResources: TrackedResource[] = [];
  for (const record of storedRecords) {
    const key = statsKey(record);
    if (resourceKeys.has(key)) continue;
    if (installedSources.has(record.packageSource)) {
      resourceKeys.add(key);
      resources.push({ ...record, active: false });
    } else {
      noLongerInstalledResources.push({ ...record, active: false });
    }
  }

  return {
    generatedAt: now,
    privacyNote: PRIVACY_NOTE,
    resources,
    noLongerInstalledResources,
    staleThresholdDays,
  };
}

function statsKey(resource: {
  packageSource: string;
  resourceType: string;
  resourceName: string;
}): string {
  return `${resource.packageSource}::${resource.resourceType}::${resource.resourceName}`;
}

function packageToolSource(tool: RuntimeToolResource): string | undefined {
  const origin = tool.sourceInfo?.origin ?? tool.origin;
  const source = tool.sourceInfo?.source ?? tool.source;
  return origin === "package" ? source : undefined;
}

function resourceDisplayName(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? filePath;
  const dirName = parts.at(-2);
  if (dirName && fileName !== "index.ts" && !fileName.startsWith("skill")) {
    return `${dirName}/${fileName}`;
  }
  return dirName ?? fileName;
}

const REPORT_BOOTSTRAP_PLACEHOLDER = "__PI_PACKAGE_USAGE_STATS_JSON__";

function serializeJsonForHtmlScript(value: unknown): string {
  const json = JSON.stringify(value) ?? "null";
  return json.replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return char;
    }
  });
}

export function injectUsageStatsBootstrap(
  html: string,
  data: ReportDataset,
): string {
  const encoded = serializeJsonForHtmlScript(data);

  if (html.includes(REPORT_BOOTSTRAP_PLACEHOLDER)) {
    return html.replace(REPORT_BOOTSTRAP_PLACEHOLDER, encoded);
  }

  const bootstrapScript = `<script id="packageUsageStatsBootstrap" type="application/json">${encoded}</script>`;

  if (html.includes("</head>")) {
    return html.replace("</head>", `${bootstrapScript}\n</head>`);
  }

  return `${html}\n${bootstrapScript}`;
}
