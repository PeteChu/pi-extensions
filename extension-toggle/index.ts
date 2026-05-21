import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import {
  assertToggleableScope,
  buildSourceOptions,
  isSourceEnabled,
  toggleAllPackageResources,
  toggleTopLevelResourcePaths,
  type ExtensionOption,
} from "./utils";

const COMMAND_NAME = "extension-toggle";

interface ExtensionToggleSelection {
  option: ExtensionOption;
  enabled: boolean;
}

class ExtensionMultiSelect implements Component {
  private selectedIndex = 0;
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

  render(width: number): string[] {
    const lines = [
      "Enable or disable sources",
      "space: check/uncheck · enter: apply · esc: cancel",
      "",
    ];

    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.options.length - this.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.options.length);

    for (let i = startIndex; i < endIndex; i++) {
      const option = this.options[i];
      const cursor = i === this.selectedIndex ? ">" : " ";
      const checked = this.checkedIndexes.has(i);
      const selected = checked ? "[x]" : "[ ]";
      const status = checked ? "Enabled" : "Disabled";
      lines.push(
        truncateToWidth(`${cursor} ${selected} ${option.label} · ${status}`, width, "..."),
      );
    }

    if (this.options.length > this.maxVisible) {
      lines.push(
        `(${this.selectedIndex + 1}/${this.options.length}) ${this.checkedIndexes.size} enabled`,
      );
    } else {
      lines.push(`${this.checkedIndexes.size} enabled`);
    }

    return lines;
  }

  handleInput(data: string): void {
    if (data === "\u001b[A" || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }

    if (data === "\u001b[B" || data === "j") {
      this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
      return;
    }

    if (data === " ") {
      if (this.checkedIndexes.has(this.selectedIndex)) {
        this.checkedIndexes.delete(this.selectedIndex);
      } else {
        this.checkedIndexes.add(this.selectedIndex);
      }
      return;
    }

    if (data === "\r" || data === "\n") {
      this.done(
        this.options
          .map((option, index) => ({
            option,
            enabled: this.checkedIndexes.has(index),
            changed:
              this.checkedIndexes.has(index) !== this.initialCheckedIndexes.has(index),
          }))
          .filter((selection) => selection.changed)
          .map(({ option, enabled }) => ({ option, enabled })),
      );
      return;
    }

    if (data === "\u001b" || data === "\u0003") {
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

export async function discoverExtensionResources(ctx: Pick<ExtensionCommandContext, "cwd">) {
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
    ctx.ui.notify("Could not update settings for the selected sources", "error");
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

  const enabledCount = changedOptions.filter((selection) => selection.enabled).length;
  const disabledCount = changedOptions.length - enabledCount;
  const summary = [
    enabledCount > 0 ? `${enabledCount} enabled` : undefined,
    disabledCount > 0 ? `${disabledCount} disabled` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");

  ctx.ui.notify(`Updated ${changedOptions.length} source(s): ${summary}`, "info");

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
    description: "Enable or disable installed Pi extensions, skills, prompts, and themes",
    handler: async (_args, ctx) => extensionToggleHandler(ctx),
  });
}
