import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import type { UsageStatsStore } from "./store";

const COMMAND_PATCH_KEY = Symbol.for("pi-package-usage.commandExecutionPatch");

interface CommandPatchState {
  patched: boolean;
  patching: boolean;
  recorders: Set<(command: { source: string; name: string }) => void>;
}

interface ToolMapEntry {
  name: string;
  source?: string;
  origin?: string;
  sourceInfo?: { origin: string; source: string };
}

function packageToolSource(tool: ToolMapEntry): string | undefined {
  const origin = tool.sourceInfo?.origin ?? tool.origin;
  const source = tool.sourceInfo?.source ?? tool.source;
  return origin === "package" ? source : undefined;
}

function buildToolMap(tools: ToolMapEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tool of tools) {
    const source = packageToolSource(tool);
    if (source) {
      map.set(tool.name, source);
    }
  }
  return map;
}

export function setupToolTracking(
  pi: ExtensionAPI,
  store: UsageStatsStore,
): void {
  let toolMap = new Map<string, string>();
  let refreshScheduled = false;

  function refreshToolMap(): void {
    toolMap = buildToolMap(pi.getAllTools());
  }

  function scheduleLazyRefresh(): void {
    if (refreshScheduled) return;
    refreshScheduled = true;
    setTimeout(() => {
      refreshScheduled = false;
      refreshToolMap();
    }, 0);
  }

  pi.on("session_start", () => {
    refreshToolMap();
    refreshScheduled = false;
  });

  pi.on("tool_execution_end", (event) => {
    const { toolName } = event as { toolName: string };
    const source = toolMap.get(toolName);
    if (!source) {
      scheduleLazyRefresh();
      return;
    }
    store.recordUsage(source, "tool", toolName);
    store.scheduleFlush();
  });
}

interface CommandMapEntry {
  name: string;
  source: string;
  sourceInfo?: { origin: string; source: string; path?: string };
}

interface CommandMapValue {
  packageSource: string;
  resourceName: string;
}

function packageCommandSource(command: CommandMapEntry): string | undefined {
  if (command.source === "skill") return undefined;
  return command.sourceInfo?.origin === "package"
    ? command.sourceInfo.source
    : undefined;
}

function buildCommandMap(
  commands: CommandMapEntry[],
): Map<string, CommandMapValue> {
  const map = new Map<string, CommandMapValue>();
  for (const command of commands) {
    const source = packageCommandSource(command);
    if (!source) continue;
    const value = { packageSource: source, resourceName: command.name };
    map.set(command.name, value);
    map.set(command.name.toLowerCase(), value);
  }
  return map;
}

function commandNameFromInput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  return trimmed.slice(1).split(/\s+/)[0];
}

function getCommandPatchState(): CommandPatchState {
  const globalObj = globalThis as typeof globalThis & {
    [COMMAND_PATCH_KEY]?: CommandPatchState;
  };
  globalObj[COMMAND_PATCH_KEY] ??= {
    patched: false,
    patching: false,
    recorders: new Set(),
  };
  return globalObj[COMMAND_PATCH_KEY];
}

function patchExtensionCommandExecution(state: CommandPatchState): void {
  const sessionProto = AgentSession.prototype as unknown as Record<
    string,
    unknown
  >;
  const original = sessionProto._tryExecuteExtensionCommand as
    | ((text: string) => Promise<boolean>)
    | undefined;

  if (typeof original !== "function") return;
  if ((original as { __packageUsagePatched?: boolean }).__packageUsagePatched) {
    return;
  }

  const wrapped = async function (
    this: {
      _extensionRunner?: {
        getCommand?: (name: string) =>
          | {
              name?: string;
              invocationName?: string;
              sourceInfo?: { origin?: string; source?: string };
            }
          | undefined;
      };
    },
    text: string,
  ): Promise<boolean> {
    const commandName = commandNameFromInput(text);
    const command = commandName
      ? this._extensionRunner?.getCommand?.(commandName)
      : undefined;
    if (
      command?.sourceInfo?.origin === "package" &&
      typeof command.sourceInfo.source === "string"
    ) {
      const name = command.invocationName ?? command.name ?? commandName;
      for (const record of state.recorders) {
        if (name) {
          record({ source: command.sourceInfo.source, name });
        }
      }
    }
    return original.call(this, text);
  };
  (wrapped as { __packageUsagePatched?: boolean }).__packageUsagePatched = true;
  sessionProto._tryExecuteExtensionCommand = wrapped;
}

function recordCommandUsage(
  store: UsageStatsStore,
  packageSource: string,
  resourceName: string,
): void {
  store.recordUsage(packageSource, "command", resourceName);
  store.scheduleFlush();
}

function setupExtensionCommandExecutionTracking(
  pi: ExtensionAPI,
  store: UsageStatsStore,
): void {
  const state = getCommandPatchState();
  const recorder = (command: { source: string; name: string }) => {
    recordCommandUsage(store, command.source, command.name);
  };
  state.recorders.add(recorder);
  pi.on("session_shutdown", () => {
    state.recorders.delete(recorder);
  });

  if (state.patched || state.patching) return;
  state.patching = true;
  try {
    patchExtensionCommandExecution(state);
    state.patched = true;
  } finally {
    state.patching = false;
  }
}

export function setupCommandTracking(
  pi: ExtensionAPI,
  store: UsageStatsStore,
): void {
  let commandMap = new Map<string, CommandMapValue>();

  function refreshCommandMap(): void {
    commandMap = buildCommandMap(pi.getCommands());
  }

  pi.on("session_start", () => {
    refreshCommandMap();
  });

  pi.on("input", (event) => {
    const { text } = event as { text: string };
    const commandName = commandNameFromInput(text);
    if (!commandName) return;
    const command =
      commandMap.get(commandName) ?? commandMap.get(commandName.toLowerCase());
    if (!command) return;
    recordCommandUsage(store, command.packageSource, command.resourceName);
  });

  setupExtensionCommandExecutionTracking(pi, store);
}

function buildSkillMaps(
  commands: Array<{
    name: string;
    source: string;
    sourceInfo: { origin: string; source: string; path: string };
  }>,
): { nameMap: Map<string, string>; pathMap: Map<string, string> } {
  const nameMap = new Map<string, string>();
  const pathMap = new Map<string, string>();

  for (const command of commands) {
    if (command.source === "skill" && command.sourceInfo.origin === "package") {
      nameMap.set(command.name, command.sourceInfo.source);
      pathMap.set(command.sourceInfo.path, command.sourceInfo.source);
    }
  }

  return { nameMap, pathMap };
}

function skillNameFromPath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? filePath;
  return fileName.replace(/\.\w+$/, "");
}

export function setupSkillTracking(
  pi: ExtensionAPI,
  store: UsageStatsStore,
): void {
  let nameMap = new Map<string, string>();
  let pathMap = new Map<string, string>();
  const dedupMap = new Map<string, number>();
  const DEDUP_WINDOW_MS = 10_000;

  function recordWithDedup(packageSource: string, skillName: string): void {
    const key = `${packageSource}::${skillName}`;
    const now = Date.now();
    const last = dedupMap.get(key);
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
      return;
    }
    dedupMap.set(key, now);
    store.recordUsage(packageSource, "skill", skillName);
    store.scheduleFlush();
  }

  function refreshMaps(): void {
    ({ nameMap, pathMap } = buildSkillMaps(pi.getCommands()));
    dedupMap.clear();
  }

  pi.on("session_start", () => {
    refreshMaps();
  });

  pi.on("input", (event) => {
    const { text } = event as { text: string };
    const trimmed = text.trim();
    if (!trimmed) return;
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

    // Handle both /skill-name and bare skill name in conversation
    const key = firstWord.startsWith("/")
      ? (commandNameFromInput(trimmed) ?? firstWord.slice(1))
      : firstWord;

    const packageSource = nameMap.get(key);
    if (packageSource) {
      recordWithDedup(packageSource, key);
    }
  });

  pi.on("tool_result", (event) => {
    const e = event as { toolName: string; input?: { path?: string } };
    if (e.toolName !== "read" || typeof e.input?.path !== "string") return;

    const packageSource = pathMap.get(e.input.path);
    if (!packageSource) return;

    const skillName = skillNameFromPath(e.input.path);
    recordWithDedup(packageSource, skillName);
  });
}
