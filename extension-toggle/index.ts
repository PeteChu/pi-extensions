import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import {
  assertToggleableScope,
  buildExtensionOptions,
  getExtensionPattern,
  togglePackageSources,
  toggleTargetEnabled,
  toggleTopLevelExtensionPaths,
  type ExtensionOption,
} from "./utils";

const COMMAND_NAME = "extension-toggle";

class ExtensionMultiSelect implements Component {
  private selectedIndex = 0;
  private readonly selectedIndexes = new Set<number>();
  private readonly maxVisible = 12;

  constructor(
    private readonly options: ExtensionOption[],
    private readonly done: (result: ExtensionOption[] | null) => void,
  ) {}

  invalidate() {}

  render(width: number): string[] {
    const lines = [
      "Select extensions to toggle",
      "space: select/unselect · enter: apply · esc: cancel",
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
      const selected = this.selectedIndexes.has(i) ? "[*]" : "[ ]";
      const status = option.resource.enabled ? "Enabled" : "Disabled";
      lines.push(
        truncateToWidth(`${cursor} ${selected} ${option.label} · ${status}`, width, "..."),
      );
    }

    if (this.options.length > this.maxVisible) {
      lines.push(
        `(${this.selectedIndex + 1}/${this.options.length}) ${this.selectedIndexes.size} selected`,
      );
    } else {
      lines.push(`${this.selectedIndexes.size} selected`);
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
      if (this.selectedIndexes.has(this.selectedIndex)) {
        this.selectedIndexes.delete(this.selectedIndex);
      } else {
        this.selectedIndexes.add(this.selectedIndex);
      }
      return;
    }

    if (data === "\r" || data === "\n") {
      this.done(
        [...this.selectedIndexes]
          .sort((a, b) => a - b)
          .map((index) => this.options[index]),
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
): Promise<ExtensionOption[] | null> {
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

  return { agentDir, settingsManager, extensions: resolvedPaths.extensions };
}

function applyExtensionToggle(
  settingsManager: SettingsManager,
  resource: ResolvedResource,
  cwd: string,
  agentDir: string,
): boolean {
  assertToggleableScope(resource.metadata.scope);

  const enabled = toggleTargetEnabled(resource);
  const pattern = getExtensionPattern(resource, cwd, agentDir);

  if (resource.metadata.origin === "package") {
    const settings =
      resource.metadata.scope === "project"
        ? settingsManager.getProjectSettings()
        : settingsManager.getGlobalSettings();
    const result = togglePackageSources(
      settings.packages,
      resource.metadata.source,
      pattern,
      enabled,
    );

    if (!result.changed) {
      return false;
    }

    if (resource.metadata.scope === "project") {
      settingsManager.setProjectPackages(result.packages);
    } else {
      settingsManager.setPackages(result.packages);
    }
    return true;
  }

  const settings =
    resource.metadata.scope === "project"
      ? settingsManager.getProjectSettings()
      : settingsManager.getGlobalSettings();
  const extensions = toggleTopLevelExtensionPaths(
    settings.extensions,
    pattern,
    enabled,
  );

  if (resource.metadata.scope === "project") {
    settingsManager.setProjectExtensionPaths(extensions);
  } else {
    settingsManager.setExtensionPaths(extensions);
  }
  return true;
}

async function extensionToggleHandler(ctx: ExtensionCommandContext) {
  await ctx.waitForIdle();

  if (!ctx.hasUI) {
    ctx.ui.notify("/extension-toggle requires interactive mode", "error");
    return;
  }

  const { agentDir, settingsManager, extensions } =
    await discoverExtensionResources(ctx);
  const options = buildExtensionOptions(extensions, ctx.cwd, agentDir);

  if (options.length === 0) {
    ctx.ui.notify("No global or project extensions found", "info");
    return;
  }

  const selectedOptions = await selectExtensionToggles(ctx, options);

  if (selectedOptions === null) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }

  if (selectedOptions.length === 0) {
    ctx.ui.notify("No extensions selected", "info");
    return;
  }

  const changedOptions: ExtensionOption[] = [];
  for (const selected of selectedOptions) {
    const changed = applyExtensionToggle(
      settingsManager,
      selected.resource,
      ctx.cwd,
      agentDir,
    );

    if (changed) {
      changedOptions.push(selected);
    }
  }

  if (changedOptions.length === 0) {
    ctx.ui.notify("Could not update settings for the selected extensions", "error");
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

  const enabledCount = changedOptions.filter((option) =>
    toggleTargetEnabled(option.resource),
  ).length;
  const disabledCount = changedOptions.length - enabledCount;
  const summary = [
    enabledCount > 0 ? `${enabledCount} enabled` : undefined,
    disabledCount > 0 ? `${disabledCount} disabled` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");

  ctx.ui.notify(`Updated ${changedOptions.length} extension(s): ${summary}`, "info");

  const reload = await ctx.ui.confirm(
    "Reload now?",
    "Reload extensions now so the change takes effect immediately?",
  );

  if (!reload) {
    ctx.ui.notify("Change saved. Run /reload later to apply it.", "info");
    return;
  }

  await ctx.reload();
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description: "Enable or disable installed Pi extensions and optionally reload",
    handler: async (_args, ctx) => extensionToggleHandler(ctx),
  });
}
