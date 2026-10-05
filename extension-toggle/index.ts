import path from "node:path";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  DefaultPackageManager,
  CustomEditor,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type AutocompleteItem,
  type OverlayHandle,
  type OverlayOptions,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  assertToggleableScope,
  buildSourceOptions,
  filterExtensionOptions,
  isSourceEnabled,
  stripPatternPrefix,
  toggleAllPackageResources,
  toggleTopLevelResourcePaths,
  type ExtensionOption,
  type FilteredExtensionOption,
} from "./utils";
import {
  assertSettingsErrors,
  readCollections,
  restoreCollection,
  saveCollection,
} from "./collections";
import { promptCollectionReload, runCollectionManager } from "./collection-ui";
import { withExtensionToggleCompletion } from "./command-completion";
import { readExtensionChangelog, notifyExtensionUpdate } from "./changelog";
import { runChangelogCommand } from "./changelog-ui";

const COMMAND_NAME = "extension-toggle";
const FLOATING_WINDOW_SHORTCUT = Key.ctrlShift("e");
const FALLBACK_EDITOR = Symbol.for("pi-extension-toggle.fallback-editor");
const UPDATE_WIDGET_KEY = "extension-toggle-updates";

export async function getExtensionToggleCompletions(prefix: string): Promise<AutocompleteItem[] | null> {
  const use = /^\s*use\s+(\S*)$/.exec(prefix);
  if (use) {
    try {
      const names = Object.keys(await readCollections(getAgentDir())).sort();
      const items = names.filter(name => name.startsWith(use[1])).map(name => ({
        value: `use ${name}`, label: name, description: "Apply saved global configuration",
      }));
      return items.length ? items : null;
    } catch {
      return null;
    }
  }
  const options = [
    { value: "toggle", label: "toggle", description: "Enable or disable resource sources" },
    { value: "collections", label: "collections", description: "Browse, save, rename and delete collections" },
    { value: "changelog", label: "changelog", description: "View extension-toggle release notes" },
    { value: "save ", label: "save <name>", description: "Save current global settings as a collection" },
    { value: "use ", label: "use <name>", description: "Apply a saved collection" },
    { value: "list", label: "list", description: "List saved collection names" },
  ];
  const items = options.filter(option => option.value.trimEnd().startsWith(prefix.trimStart()));
  return items.length ? items : null;
}

export interface ExtensionToggleSelection {
  option: ExtensionOption;
  enabled: boolean;
}

type SaveScope = "global" | "project";
export interface ExtensionToggleResult {
  selections: ExtensionToggleSelection[];
  saveScope: SaveScope;
}

const OPEN_FLOATING_WINDOW = "open-floating-window";
type SelectExtensionTogglesResult =
  ExtensionToggleResult | null | typeof OPEN_FLOATING_WINDOW;
type VisibleRowCount = number | (() => number);

function fitControlHints(
  hints: string[],
  width: number,
  pinnedHints: string[] = [],
): string {
  const safeWidth = Math.max(0, width);
  const joined = hints.join(" · ");
  if (visibleWidth(joined) <= safeWidth) {
    return joined;
  }

  const pinned = new Set(pinnedHints);
  const kept = new Set<string>(pinnedHints);
  for (const hint of hints) {
    if (pinned.has(hint)) continue;

    const candidate = hints
      .filter((entry) => kept.has(entry) || entry === hint)
      .join(" · ");
    if (visibleWidth(candidate) <= safeWidth) {
      kept.add(hint);
    }
  }

  const fitted = hints.filter((hint) => kept.has(hint)).join(" · ");
  if (visibleWidth(fitted) <= safeWidth) {
    return fitted;
  }

  if (pinned.has("? help")) {
    return visibleWidth("? help") <= safeWidth
      ? "? help"
      : truncateToWidth("?", safeWidth, "");
  }

  const keptHints: string[] = [];
  for (const hint of hints) {
    const candidate = [...keptHints, hint].join(" · ");
    if (visibleWidth(candidate) <= safeWidth) {
      keptHints.push(hint);
    }
  }

  return keptHints.join(" · ");
}

export class ExtensionMultiSelect implements Component {
  private selectedFilteredIndex = 0;
  private searchQuery = "";
  private readonly checkedIndexes = new Set<number>();
  private readonly initialCheckedIndexes = new Set<number>();

  constructor(
    private readonly options: ExtensionOption[],
    private readonly done: (result: ExtensionToggleResult | null) => void,
    private readonly maxVisibleRows: VisibleRowCount = 12,
    private readonly showHelpHint = false,
    private readonly floatingShortcutFooterHint: string | undefined = undefined,
    private saveScope: SaveScope = "global",
  ) {
    for (let i = 0; i < options.length; i++) {
      if (isSourceEnabled(options[i].resources)) {
        this.checkedIndexes.add(i);
        this.initialCheckedIndexes.add(i);
      }
    }
  }

  invalidate() {}

  private get filteredOptions(): FilteredExtensionOption[] {
    return filterExtensionOptions(this.options, this.searchQuery);
  }

  private get maxVisible(): number {
    const value =
      typeof this.maxVisibleRows === "function"
        ? this.maxVisibleRows()
        : this.maxVisibleRows;
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 12;
  }

  private clampSelectedIndex(filtered = this.filteredOptions): void {
    if (filtered.length === 0) {
      this.selectedFilteredIndex = 0;
      return;
    }

    this.selectedFilteredIndex = Math.max(
      0,
      Math.min(this.selectedFilteredIndex, filtered.length - 1),
    );
  }

  private setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.selectedFilteredIndex = 0;
    this.clampSelectedIndex();
  }

  private getSelectedRow(): FilteredExtensionOption | undefined {
    const filtered = this.filteredOptions;
    this.clampSelectedIndex(filtered);
    return filtered[this.selectedFilteredIndex];
  }

  private moveSelection(delta: number): void {
    const filtered = this.filteredOptions;
    if (filtered.length === 0) {
      this.selectedFilteredIndex = 0;
      return;
    }

    this.selectedFilteredIndex = Math.max(
      0,
      Math.min(filtered.length - 1, this.selectedFilteredIndex + delta),
    );
  }

  private toggleSelectedRow(): void {
    const row = this.getSelectedRow();
    if (!row) return;

    if (this.checkedIndexes.has(row.originalIndex)) {
      this.checkedIndexes.delete(row.originalIndex);
    } else {
      this.checkedIndexes.add(row.originalIndex);
    }
  }

  private submit(): void {
    this.done({
      saveScope: this.saveScope,
      selections: this.options
        .map((option, index) => ({
          option,
          enabled: this.checkedIndexes.has(index),
          changed:
            this.checkedIndexes.has(index) !==
            this.initialCheckedIndexes.has(index),
        }))
        .filter((selection) => selection.changed)
        .map(({ option, enabled }) => ({ option, enabled })),
    });
  }

  private isPrintableInput(data: string): boolean {
    return (
      data.length === 1 &&
      data.charCodeAt(0) >= 32 &&
      data.charCodeAt(0) !== 127
    );
  }

  render(width: number): string[] {
    const filtered = this.filteredOptions;
    this.clampSelectedIndex(filtered);
    const safeWidth = Math.max(0, width);
    const maxVisible = this.maxVisible;
    const fitLine = (line: string): string =>
      visibleWidth(line) > safeWidth
        ? truncateToWidth(line, safeWidth, "...")
        : line;
    const queryDisplay =
      this.searchQuery.length > 0 ? this.searchQuery : "(empty)";
    const controlHints = this.showHelpHint
      ? [
          "↑/↓ move",
          "space toggle",
          "type search",
          "backspace/delete remove",
          "ctrl+u clear",
          "enter apply",
          "esc clear/cancel",
          ...(this.floatingShortcutFooterHint
            ? [this.floatingShortcutFooterHint]
            : []),
          "? help",
        ]
      : [
          "↑/↓: move",
          "space: toggle",
          "type: search",
          "backspace/delete: remove",
          "ctrl+u: clear",
          "enter: apply",
          "esc: clear/cancel",
        ];
    const fitControls = (): string =>
      fitControlHints(
        controlHints,
        safeWidth,
        this.showHelpHint
          ? [
              ...(this.floatingShortcutFooterHint
                ? [this.floatingShortcutFooterHint]
                : []),
              "? help",
            ]
          : [],
      );
    const lines = [
      fitLine("Enable or disable sources"),
      fitLine(`Save to: ${this.saveScope === "project" ? "Repo (.pi/settings.json)" : "Global"} · Tab to switch`),
      fitLine(`Search: ${queryDisplay}`),
      "",
    ];

    if (filtered.length === 0) {
      lines.push(fitLine(`No sources match "${this.searchQuery}"`));
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedFilteredIndex - Math.floor(maxVisible / 2),
          filtered.length - maxVisible,
        ),
      );
      const endIndex = Math.min(startIndex + maxVisible, filtered.length);

      for (let i = startIndex; i < endIndex; i++) {
        const row = filtered[i];
        const option = row.option;
        const cursor = i === this.selectedFilteredIndex ? ">" : " ";
        const checked = this.checkedIndexes.has(row.originalIndex);
        const selected = checked ? "[x]" : "[ ]";
        const status = checked ? "Enabled" : "Disabled";
        lines.push(
          fitLine(`${cursor} ${selected} ${option.label} · ${status}`),
        );
      }
    }

    if (filtered.length > maxVisible) {
      lines.push(
        fitLine(
          `(${this.selectedFilteredIndex + 1}/${filtered.length} shown, ${this.options.length} total) ${this.checkedIndexes.size} enabled`,
        ),
      );
    } else if (this.searchQuery.trim().length > 0) {
      lines.push(
        fitLine(
          `${filtered.length}/${this.options.length} shown · ${this.checkedIndexes.size} enabled`,
        ),
      );
    } else {
      lines.push(fitLine(`${this.checkedIndexes.size} enabled`));
    }

    lines.push(fitControls());

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.done(null);
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.saveScope = this.saveScope === "project" ? "global" : "project";
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.submit();
      return;
    }

    if (matchesKey(data, Key.ctrl("u"))) {
      this.setSearchQuery("");
      return;
    }

    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      this.setSearchQuery(this.searchQuery.slice(0, -1));
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.moveSelection(-1);
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.moveSelection(1);
      return;
    }

    if (matchesKey(data, Key.space)) {
      this.toggleSelectedRow();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      if (this.searchQuery.length > 0) {
        this.setSearchQuery("");
        return;
      }

      this.done(null);
      return;
    }

    if (this.isPrintableInput(data)) {
      this.setSearchQuery(`${this.searchQuery}${data}`);
    }
  }
}

class ExtensionToggleHelpOverlay implements Component {
  constructor(
    private readonly theme: Theme,
    private readonly shortcutHelp: string,
    private readonly onClose: () => void,
    private readonly onToggleShortcut: () => void,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, FLOATING_WINDOW_SHORTCUT)) {
      this.onClose();
      this.onToggleShortcut();
      return;
    }

    if (
      data === "?" ||
      matchesKey(data, Key.question) ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.ctrl("c"))
    ) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth < 3) {
      return [truncateToWidth("?", safeWidth, "")];
    }

    const innerWidth = safeWidth - 2;
    const fitLine = (line: string): string => {
      const fitted =
        visibleWidth(line) > innerWidth
          ? truncateToWidth(line, innerWidth, "...")
          : line;
      return `${fitted}${" ".repeat(Math.max(0, innerWidth - visibleWidth(fitted)))}`;
    };
    const accent = (text: string) => this.theme.fg("accent", text);
    const dim = (text: string) => this.theme.fg("dim", text);
    const content = [
      accent("Extension Toggle Help"),
      "",
      `${accent("Ctrl+Shift+E")} ${this.shortcutHelp}`,
      `${accent("?")} close this help overlay`,
      `${accent("↑/↓")} move selection`,
      `${accent("Space")} check or uncheck a source`,
      `${accent("Tab")} switch between repo and global saving`,
      `${accent("Type")} filter sources immediately`,
      `${accent("Backspace/Delete")} remove search text`,
      `${accent("Ctrl+U")} clear search text`,
      `${accent("Enter")} apply selected changes`,
      `${accent("Esc")} clear the filter, or cancel when it is empty`,
      "",
      dim("This help is a second overlay stacked above the picker."),
    ];

    return [
      `╭${"─".repeat(innerWidth)}╮`,
      ...content.map((line) => `│${fitLine(line)}│`),
      `╰${"─".repeat(innerWidth)}╯`,
    ];
  }
}

class ExtensionToggleOverlay implements Component {
  private helpHandle: OverlayHandle | null = null;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly inner: ExtensionMultiSelect,
    private readonly onToggleShortcut: () => void,
    private readonly shortcutHelp: string,
    private readonly showBorder: boolean,
  ) {}

  invalidate(): void {
    this.inner.invalidate();
  }

  dispose(): void {
    this.hideHelp();
  }

  private hideHelp(): void {
    this.helpHandle?.hide();
    this.helpHandle = null;
  }

  private showHelp(): void {
    if (this.helpHandle) {
      this.helpHandle.focus();
      return;
    }

    const component = new ExtensionToggleHelpOverlay(
      this.theme,
      this.shortcutHelp,
      () => this.hideHelp(),
      this.onToggleShortcut,
    );
    this.helpHandle = this.tui.showOverlay(component, {
      anchor: "center",
      width: 64,
      maxHeight: "80%",
      margin: 2,
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, FLOATING_WINDOW_SHORTCUT)) {
      this.onToggleShortcut();
      return;
    }

    if (data === "?" || matchesKey(data, Key.question)) {
      this.showHelp();
      return;
    }

    this.inner.handleInput(data);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (!this.showBorder) {
      return this.inner.render(safeWidth);
    }

    if (safeWidth < 3) {
      return this.inner.render(safeWidth);
    }

    const innerWidth = safeWidth - 2;
    const padLine = (line: string): string => {
      const fitted =
        visibleWidth(line) > innerWidth
          ? truncateToWidth(line, innerWidth, "...")
          : line;
      return `${fitted}${" ".repeat(Math.max(0, innerWidth - visibleWidth(fitted)))}`;
    };

    return [
      `╭${"─".repeat(innerWidth)}╮`,
      ...this.inner.render(innerWidth).map((line) => `│${padLine(line)}│`),
      `╰${"─".repeat(innerWidth)}╯`,
    ];
  }
}

interface SelectExtensionTogglesOptions {
  overlay?: boolean;
  onHandle?: (handle: OverlayHandle) => void;
  onToggleShortcut?: () => void;
}

const extensionToggleOverlayOptions: OverlayOptions = {
  anchor: "center",
  width: "80%",
  minWidth: 50,
  maxHeight: "80%",
  margin: 2,
};

function getResponsiveOverlayVisibleRows(termRows: number): number {
  const verticalMargins = 4;
  const overlayChromeLines = 8;
  const maxOverlayHeight = Math.min(
    Math.floor(termRows * 0.8),
    Math.max(1, termRows - verticalMargins),
  );
  return Math.max(1, maxOverlayHeight - overlayChromeLines);
}

async function selectExtensionToggles(
  ctx: ExtensionContext,
  options: ExtensionOption[],
  saveScope: SaveScope,
  uiOptions: SelectExtensionTogglesOptions = {},
): Promise<SelectExtensionTogglesResult> {
  return await ctx.ui.custom<SelectExtensionTogglesResult>(
    (tui, _theme, _kb, done) => {
      const showHelpHint =
        uiOptions.overlay === true || uiOptions.onToggleShortcut !== undefined;
      const component = new ExtensionMultiSelect(
        options,
        done,
        uiOptions.overlay
          ? () => getResponsiveOverlayVisibleRows(tui.terminal.rows)
          : 12,
        showHelpHint,
        !uiOptions.overlay && uiOptions.onToggleShortcut
          ? "ctrl+shift+e float"
          : undefined,
        saveScope,
      );
      if (!showHelpHint) {
        return component;
      }

      const handleToggleShortcut = () => {
        if (uiOptions.overlay) {
          uiOptions.onToggleShortcut?.();
          return;
        }

        done(OPEN_FLOATING_WINDOW);
        setTimeout(() => uiOptions.onToggleShortcut?.(), 0);
      };

      return new ExtensionToggleOverlay(
        tui,
        _theme,
        component,
        handleToggleShortcut,
        uiOptions.overlay
          ? "hide/show the floating window"
          : "open floating window",
        uiOptions.overlay === true,
      );
    },
    uiOptions.overlay
      ? {
          overlay: true,
          overlayOptions: extensionToggleOverlayOptions,
          onHandle: uiOptions.onHandle,
        }
      : undefined,
  );
}

export async function discoverExtensionResources(
  ctx: Pick<ExtensionCommandContext, "cwd">,
) {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(ctx.cwd, agentDir);
  const packageManager = new DefaultPackageManager({
    cwd: ctx.cwd,
    agentDir,
    settingsManager,
  });
  const resolvedPaths = await packageManager.resolve();

  return {
    agentDir,
    settingsManager,
    extensions: resolvedPaths.extensions,
    skills: resolvedPaths.skills,
    prompts: resolvedPaths.prompts,
    themes: resolvedPaths.themes,
  };
}

function resolvePackageSource(source: string, baseDir: string): string {
  const trimmed = source.trim();
  if (/^(npm:|git:|https?:|ssh:|git@)/.test(trimmed)) return source;
  if (trimmed.startsWith("~")) return path.join(homedir(), trimmed.slice(1));
  return path.resolve(baseDir, trimmed);
}

export function applyExtensionToggle(
  settingsManager: SettingsManager,
  option: ExtensionOption,
  enabled: boolean,
  saveScope: SaveScope = "global",
  agentDir: string = getAgentDir(),
  cwd: string = process.cwd(),
): boolean {
  const first = option.resources[0];
  if (!first) return false;
  assertToggleableScope(first.metadata.scope);

  const targetScope = saveScope;

  if (option.origin === "package") {
    const settings =
      targetScope === "project"
        ? settingsManager.getProjectSettings()
        : settingsManager.getGlobalSettings();
    let source = option.sourceKey;
    let packages = settings.packages;
    if ((saveScope === "project") !== (first.metadata.scope === "project")) {
      const sourceBaseDir = first.metadata.scope === "project" ? path.join(cwd, ".pi") : agentDir;
      const targetBaseDir = saveScope === "project" ? path.join(cwd, ".pi") : agentDir;
      const resolvedSource = resolvePackageSource(source, sourceBaseDir);
      const existing = (packages ?? []).find((pkg) =>
        resolvePackageSource(typeof pkg === "string" ? pkg : pkg.source, targetBaseDir) === resolvedSource,
      );
      source = existing ? (typeof existing === "string" ? existing : existing.source) : resolvedSource;
      if (!existing) packages = [...(packages ?? []), source];
    }
    const existingPackage = (settings.packages ?? []).find((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === source);
    const resolver = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const reuseGlobal = targetScope === "project" && first.metadata.packageRoot !== undefined &&
      (existingPackage === undefined || (typeof existingPackage === "object" && existingPackage.autoload === false)) &&
      (settingsManager.getGlobalSettings().packages ?? []).some((pkg) =>
        resolver.getInstalledPath(typeof pkg === "string" ? pkg : pkg.source, "user") === first.metadata.packageRoot,
      );
    const result = reuseGlobal
      ? {
          changed: true,
          packages: (packages ?? []).map((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === source
            ? {
                source,
                autoload: false,
                extensions: enabled ? ["**/*", ".*"] : ["!**/*", "!.*"],
                skills: enabled ? ["**/*", ".*"] : ["!**/*", "!.*"],
                prompts: enabled ? ["**/*", ".*"] : ["!**/*", "!.*"],
                themes: enabled ? ["**/*", ".*"] : ["!**/*", "!.*"],
              }
            : pkg),
        }
      : toggleAllPackageResources(packages, source, enabled);

    if (!result.changed) {
      return false;
    }

    if (targetScope === "project") {
      settingsManager.setProjectPackages(result.packages);
    } else {
      settingsManager.setPackages(result.packages);
    }
    return true;
  }

  // origin === "top-level" — toggle this individual local resource
  const settings =
    targetScope === "project"
      ? settingsManager.getProjectSettings()
      : settingsManager.getGlobalSettings();
  const resourceType = option.resourceType;
  if (!resourceType) return false;

  const baseDir = targetScope === "project" ? path.join(cwd, ".pi") : agentDir;
  const crossScope = (saveScope === "project") !== (first.metadata.scope === "project");
  const pattern = crossScope ? first.path : option.sourceKey;
  // Remove equivalent exact overrides, whether written as relative or absolute paths.
  const paths = (settings[resourceType] ?? []).filter((entry) => {
    if (!entry.startsWith("+") && !entry.startsWith("-")) return true;
    const exactPath = path.resolve(baseDir, stripPatternPrefix(entry));
    return exactPath !== first.path &&
      !(resourceType === "skills" && path.basename(first.path) === "SKILL.md" && exactPath === path.dirname(first.path));
  });
  const updatedPaths = toggleTopLevelResourcePaths(paths, pattern, enabled);
  if (crossScope && !updatedPaths.includes(first.path)) {
    updatedPaths.unshift(first.path);
  }

  if (targetScope === "project") {
    switch (resourceType) {
      case "extensions":
        settingsManager.setProjectExtensionPaths(updatedPaths);
        break;
      case "skills":
        settingsManager.setProjectSkillPaths(updatedPaths);
        break;
      case "prompts":
        settingsManager.setProjectPromptTemplatePaths(updatedPaths);
        break;
      case "themes":
        settingsManager.setProjectThemePaths(updatedPaths);
        break;
    }
  } else {
    switch (resourceType) {
      case "extensions":
        settingsManager.setExtensionPaths(updatedPaths);
        break;
      case "skills":
        settingsManager.setSkillPaths(updatedPaths);
        break;
      case "prompts":
        settingsManager.setPromptTemplatePaths(updatedPaths);
        break;
      case "themes":
        settingsManager.setThemePaths(updatedPaths);
        break;
    }
  }
  return true;
}

interface RunExtensionToggleOptions extends SelectExtensionTogglesOptions {
  reload?: () => Promise<void> | void;
}

async function runExtensionToggle(
  ctx: ExtensionContext,
  uiOptions: RunExtensionToggleOptions = {},
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("extension-toggle requires interactive mode", "error");
    return;
  }

  const discovered = await discoverExtensionResources(ctx).catch((error: unknown) => {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  });
  if (!discovered) return;
  const { agentDir, settingsManager, extensions, skills, prompts, themes } = discovered;
  try {
    assertSettingsErrors(settingsManager);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  const options = buildSourceOptions(extensions, skills, prompts, themes, {
    cwd: ctx.cwd,
    agentDir,
  });
  const projectSettings = settingsManager.getProjectSettings();
  const saveScope: SaveScope = ["packages", "extensions", "skills", "prompts", "themes"]
    .some((field) => Object.hasOwn(projectSettings, field)) ? "project" : "global";

  if (options.length === 0) {
    ctx.ui.notify("No toggleable sources found", "info");
    return;
  }

  const result = await selectExtensionToggles(ctx, options, saveScope, uiOptions);

  if (result === OPEN_FLOATING_WINDOW) {
    return;
  }

  if (result === null) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }

  const { selections: selectedOptions, saveScope: selectedScope } = result;

  if (selectedOptions.length === 0) {
    ctx.ui.notify("No changes selected", "info");
    return;
  }

  try {
    for (const { option } of selectedOptions) {
      if (option.origin !== "package") continue;
      const resource = option.resources[0];
      if (!resource) continue;
      const root = resource.metadata.packageRoot;
      if (root && resource.path !== root) continue;
      let hasManifest = false;
      if (root) {
        try {
          const manifest: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
          hasManifest = manifest !== null && typeof manifest === "object" && "pi" in manifest &&
            manifest.pi !== null && typeof manifest.pi === "object" && !Array.isArray(manifest.pi);
        } catch {}
      }
      if (!hasManifest) {
        throw new Error(`Pi cannot apply package filters to ${option.sourceKey}. Use top-level extensions settings or a directory package with a pi manifest.`);
      }
    }
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    return;
  }

  const changedOptions: ExtensionToggleSelection[] = [];
  for (const selected of selectedOptions) {
    const changed = applyExtensionToggle(
      settingsManager,
      selected.option,
      selected.enabled,
      selectedScope,
      agentDir,
      ctx.cwd,
    );

    if (changed) {
      changedOptions.push(selected);
    }
  }

  if (changedOptions.length === 0) {
    ctx.ui.notify(
      "Could not update settings for the selected sources",
      "error",
    );
    return;
  }

  await settingsManager.flush();
  const errors = settingsManager.drainErrors();
  if (errors.length > 0) {
    for (const error of errors) {
      ctx.ui.notify(
        `Failed to write ${error.scope} settings: ${error.error.message}`,
        "error",
      );
    }
    return;
  }

  const enabledCount = changedOptions.filter(
    (selection) => selection.enabled,
  ).length;
  const disabledCount = changedOptions.length - enabledCount;
  const summary = [
    enabledCount > 0 ? `${enabledCount} enabled` : undefined,
    disabledCount > 0 ? `${disabledCount} disabled` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");

  ctx.ui.notify(
    `Updated ${changedOptions.length} source(s): ${summary} (saved to ${selectedScope === "project" ? ".pi/settings.json" : "global settings"})`,
    "info",
  );

  if (!uiOptions.reload) {
    ctx.ui.notify("Change saved. Run /reload later to apply it.", "info");
    return;
  }

  const reload = await ctx.ui.confirm(
    "Reload now?",
    "Reload now so the change takes effect immediately?",
  );

  if (!reload) {
    ctx.ui.notify("Change saved. Run /reload later to apply it.", "info");
    return;
  }

  await uiOptions.reload();
}

async function runCollectionCommand(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const [command, name, ...extra] = args.trim().split(/\s+/);
  if (
    extra.length > 0 ||
    (command === "list" ? name !== undefined : !name) ||
    !["save", "use", "list"].includes(command)
  ) {
    ctx.ui.notify("Usage: /extension-toggle toggle | collections | changelog | save <name> | use <name> | list", "error");
    return;
  }
  try {
    const agentDir = getAgentDir();
    if (command === "list") {
      const names = Object.keys(await readCollections(agentDir)).sort();
      ctx.ui.notify(
        names.length > 0 ? `Collections:\n${names.join("\n")}` : "No collections saved. Use /extension-toggle save <name>.",
        "info",
      );
      return;
    }
    if (command === "use") {
      const collections = await readCollections(agentDir);
      if (!Object.hasOwn(collections, name)) {
        throw new Error(`Unknown collection "${name}". Use /extension-toggle list.`);
      }
      await ctx.waitForIdle();
      const settingsManager = SettingsManager.create(ctx.cwd, agentDir);
      await restoreCollection(settingsManager, collections[name], { cwd: ctx.cwd, agentDir });
      await promptCollectionReload(ctx, name);
    } else {
      const settingsManager = SettingsManager.create(ctx.cwd, agentDir);
      assertSettingsErrors(settingsManager);
      await saveCollection(agentDir, name, settingsManager.getGlobalSettings());
      ctx.ui.notify(`Saved collection "${name}".`, "info");
    }
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

async function extensionToggleHandler(
  ctx: ExtensionCommandContext,
  openFloatingWindow?: () => void,
) {
  await ctx.waitForIdle();
  await runExtensionToggle(ctx, {
    reload: () => ctx.reload(),
    onToggleShortcut: openFloatingWindow,
  });
}

export default function (pi: ExtensionAPI) {
  let floatingWindowHandle: OverlayHandle | null = null;
  let floatingWindowPromise: Promise<void> | null = null;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      await notifyExtensionUpdate({
        hasUI: ctx.hasUI,
        ui: { notify: message => ctx.ui.setWidget(UPDATE_WIDGET_KEY, [message]) },
      }, await readExtensionChangelog());
    } catch { /* Optional update hints must not interrupt a session. */ }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const existing = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      if (existing) return withExtensionToggleCompletion(existing(tui, theme, keybindings));
      const cached: unknown = Reflect.get(tui, FALLBACK_EDITOR);
      const autocompleteMaxVisible = SettingsManager.create(ctx.cwd, getAgentDir()).getAutocompleteMaxVisible();
      if (cached instanceof CustomEditor) {
        cached.setAutocompleteMaxVisible(autocompleteMaxVisible);
        return withExtensionToggleCompletion(cached);
      }
      const editor = new CustomEditor(tui, theme, keybindings, { autocompleteMaxVisible });
      Reflect.set(tui, FALLBACK_EDITOR, editor);
      return withExtensionToggleCompletion(editor);
    });
  });

  async function toggleFloatingWindow(ctx: ExtensionContext): Promise<void> {
    if (floatingWindowHandle) {
      if (floatingWindowHandle.isHidden()) {
        floatingWindowHandle.setHidden(false);
        floatingWindowHandle.focus();
      } else {
        floatingWindowHandle.setHidden(true);
      }
      return;
    }

    if (floatingWindowPromise) {
      return;
    }

    floatingWindowPromise = runExtensionToggle(ctx, {
      overlay: true,
      onHandle: (handle) => {
        floatingWindowHandle = handle;
      },
      onToggleShortcut: () => {
        floatingWindowHandle?.setHidden(true);
      },
    }).finally(() => {
      floatingWindowHandle = null;
      floatingWindowPromise = null;
    });

    await floatingWindowPromise;
  }

  pi.registerShortcut(FLOATING_WINDOW_SHORTCUT, {
    description: "Toggle extension options floating window",
    handler: async (ctx) => toggleFloatingWindow(ctx),
  });

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Toggle Pi resources, manage collections, or view extension-toggle release notes",
    getArgumentCompletions: getExtensionToggleCompletions,
    handler: async (args, ctx) => {
      if (args.trim() === "changelog") {
        ctx.ui.setWidget(UPDATE_WIDGET_KEY, undefined);
        await runChangelogCommand(ctx);
      } else if (args.trim() === "collections") {
        await runCollectionManager(ctx);
      } else if (args.trim() && args.trim() !== "toggle") {
        await runCollectionCommand(args, ctx);
      } else {
        await extensionToggleHandler(ctx, () => {
          void toggleFloatingWindow(ctx);
        });
      }
    },
  });
}
