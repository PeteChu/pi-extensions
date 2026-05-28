import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import {
  assertToggleableScope,
  buildSourceOptions,
  filterExtensionOptions,
  isSourceEnabled,
  toggleAllPackageResources,
  toggleTopLevelResourcePaths,
  type ExtensionOption,
  type FilteredExtensionOption,
} from "./utils";

const COMMAND_NAME = "extension-toggle";

export interface ExtensionToggleSelection {
  option: ExtensionOption;
  enabled: boolean;
}

export class ExtensionMultiSelect implements Component {
  private selectedFilteredIndex = 0;
  private searchMode = false;
  private searchQuery = "";
  private readonly checkedIndexes = new Set<number>();
  private readonly initialCheckedIndexes = new Set<number>();
  private readonly maxVisible = 12;

  constructor(
    private readonly options: ExtensionOption[],
    private readonly done: (result: ExtensionToggleSelection[] | null) => void,
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
    this.done(
      this.options
        .map((option, index) => ({
          option,
          enabled: this.checkedIndexes.has(index),
          changed:
            this.checkedIndexes.has(index) !==
            this.initialCheckedIndexes.has(index),
        }))
        .filter((selection) => selection.changed)
        .map(({ option, enabled }) => ({ option, enabled })),
    );
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
    const fitLine = (line: string): string =>
      visibleWidth(line) > safeWidth
        ? truncateToWidth(line, safeWidth, "...")
        : line;
    const searchStatus = this.searchMode ? "active" : "inactive";
    const queryDisplay =
      this.searchQuery.length > 0 ? this.searchQuery : "(empty)";
    const controls = this.searchMode
      ? "type: search · backspace/delete: remove · ctrl+u: clear · esc: close search · enter: apply"
      : "↑/↓ or j/k: move · / or ctrl+f: search · space: check/uncheck · enter: apply · esc: cancel";
    const lines = [
      fitLine("Enable or disable sources"),
      fitLine(`Search (${searchStatus}): ${queryDisplay}`),
      "",
    ];

    if (filtered.length === 0) {
      lines.push(fitLine(`No sources match "${this.searchQuery}"`));
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedFilteredIndex - Math.floor(this.maxVisible / 2),
          filtered.length - this.maxVisible,
        ),
      );
      const endIndex = Math.min(startIndex + this.maxVisible, filtered.length);

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

    if (filtered.length > this.maxVisible) {
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

    lines.push(fitLine(controls));

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.done(null);
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.submit();
      return;
    }

    if (this.searchMode) {
      if (matchesKey(data, Key.escape)) {
        this.searchMode = false;
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

      if (this.isPrintableInput(data)) {
        this.setSearchQuery(`${this.searchQuery}${data}`);
      }
      return;
    }

    if (data === "/" || matchesKey(data, Key.ctrl("f"))) {
      this.searchMode = true;
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      this.moveSelection(-1);
      return;
    }

    if (matchesKey(data, Key.down) || data === "j") {
      this.moveSelection(1);
      return;
    }

    if (matchesKey(data, Key.space)) {
      this.toggleSelectedRow();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.done(null);
    }
  }
}

async function selectExtensionToggles(
  ctx: ExtensionCommandContext,
  options: ExtensionOption[],
): Promise<ExtensionToggleSelection[] | null> {
  return await ctx.ui.custom((_, _theme, _kb, done) => {
    return new ExtensionMultiSelect(options, done);
  });
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

function applyExtensionToggle(
  settingsManager: SettingsManager,
  option: ExtensionOption,
  enabled: boolean,
): boolean {
  const first = option.resources[0];
  if (!first) return false;
  assertToggleableScope(first.metadata.scope);

  if (option.origin === "package") {
    const settings =
      first.metadata.scope === "project"
        ? settingsManager.getProjectSettings()
        : settingsManager.getGlobalSettings();
    const result = toggleAllPackageResources(
      settings.packages,
      option.sourceKey,
      enabled,
    );

    if (!result.changed) {
      return false;
    }

    if (first.metadata.scope === "project") {
      settingsManager.setProjectPackages(result.packages);
    } else {
      settingsManager.setPackages(result.packages);
    }
    return true;
  }

  // origin === "top-level" — toggle this individual local resource
  const settings =
    first.metadata.scope === "project"
      ? settingsManager.getProjectSettings()
      : settingsManager.getGlobalSettings();
  const resourceType = option.resourceType;
  if (!resourceType) return false;

  const updatedPaths = toggleTopLevelResourcePaths(
    settings[resourceType],
    option.sourceKey,
    enabled,
  );

  if (first.metadata.scope === "project") {
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

async function extensionToggleHandler(ctx: ExtensionCommandContext) {
  await ctx.waitForIdle();

  if (!ctx.hasUI) {
    ctx.ui.notify("/extension-toggle requires interactive mode", "error");
    return;
  }

  const { agentDir, settingsManager, extensions, skills, prompts, themes } =
    await discoverExtensionResources(ctx);
  const options = buildSourceOptions(extensions, skills, prompts, themes, {
    cwd: ctx.cwd,
    agentDir,
  });

  if (options.length === 0) {
    ctx.ui.notify("No toggleable sources found", "info");
    return;
  }

  const selectedOptions = await selectExtensionToggles(ctx, options);

  if (selectedOptions === null) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }

  if (selectedOptions.length === 0) {
    ctx.ui.notify("No changes selected", "info");
    return;
  }

  const changedOptions: ExtensionToggleSelection[] = [];
  for (const selected of selectedOptions) {
    const changed = applyExtensionToggle(
      settingsManager,
      selected.option,
      selected.enabled,
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
    `Updated ${changedOptions.length} source(s): ${summary}`,
    "info",
  );

  const reload = await ctx.ui.confirm(
    "Reload now?",
    "Reload now so the change takes effect immediately?",
  );

  if (!reload) {
    ctx.ui.notify("Change saved. Run /reload later to apply it.", "info");
    return;
  }

  await ctx.reload();
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Enable or disable installed Pi extensions, skills, prompts, and themes",
    handler: async (_args, ctx) => extensionToggleHandler(ctx),
  });
}
