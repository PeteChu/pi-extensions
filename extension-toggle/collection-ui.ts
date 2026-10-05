import {
  getAgentDir, SettingsManager,
  type ExtensionCommandContext, type Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import {
  assertSettingsErrors, deleteCollection, readCollections, renameCollection,
  restoreCollection, saveCollection, type ResourceSnapshot,
} from "./collections";

type CollectionAction = { type: "save" } | { type: "use" | "rename" | "delete"; name: string } | null;
const fields = ["extensions", "skills", "prompts", "themes"] as const;

function sources(snapshot: ResourceSnapshot): string[] {
  return (snapshot.packages ?? []).map(pkg => typeof pkg === "string" ? pkg : pkg.source);
}

export function collectionSourcesMatch(current: ResourceSnapshot, saved: ResourceSnapshot): boolean {
  return JSON.stringify(sources(current)) === JSON.stringify(sources(saved));
}

function snapshotLines(snapshot: ResourceSnapshot): string[] {
  const lines: string[] = [];
  if (snapshot.packages === undefined) lines.push("Packages: not configured");
  else if (!snapshot.packages.length) lines.push("Packages: []");
  else for (const pkg of snapshot.packages) {
    lines.push(`Package: ${JSON.stringify(typeof pkg === "string" ? pkg : pkg.source)}`);
    if (typeof pkg === "string") lines.push("  All package resources (no filters)");
    else for (const field of fields) {
      if (pkg[field] !== undefined) lines.push(`  ${field}: ${JSON.stringify(pkg[field])}`);
    }
  }
  for (const field of fields) lines.push(`${field}: ${snapshot[field] === undefined ? "not configured" : JSON.stringify(snapshot[field])}`);
  return lines;
}

export class CollectionManager implements Component {
  private query = "";
  private index = 0;
  private preview = false;
  private scroll = 0;

  constructor(
    private readonly collections: Record<string, ResourceSnapshot>,
    private readonly current: ResourceSnapshot,
    private readonly done: (action: CollectionAction) => void,
    private readonly theme: Pick<Theme, "fg">,
    private readonly rows: () => number = () => 24,
    selected?: string,
  ) {
    this.index = Math.max(0, this.names.indexOf(selected ?? ""));
  }

  invalidate(): void {}

  private get names(): string[] {
    return Object.keys(this.collections).sort().filter(name => name.toLowerCase().includes(this.query.toLowerCase()));
  }

  private get selected(): string | undefined {
    const names = this.names;
    this.index = Math.max(0, Math.min(this.index, names.length - 1));
    return names[this.index];
  }

  handleInput(data: string): void {
    const name = this.selected;
    if (matchesKey(data, Key.ctrl("c"))) { this.done(null); return; }
    if (matchesKey(data, Key.escape)) {
      if (this.preview) { this.preview = false; this.scroll = 0; }
      else if (this.query) { this.query = ""; this.index = 0; }
      else this.done(null);
      return;
    }
    if (matchesKey(data, Key.ctrl("s"))) { this.done({ type: "save" }); return; }
    if (name && matchesKey(data, Key.ctrl("r"))) { this.done({ type: "rename", name }); return; }
    if (name && matchesKey(data, Key.ctrl("d"))) { this.done({ type: "delete", name }); return; }
    if (matchesKey(data, Key.enter) && name) {
      if (!this.preview) { this.preview = true; this.scroll = 0; }
      else if (collectionSourcesMatch(this.current, this.collections[name])) this.done({ type: "use", name });
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      const delta = matchesKey(data, Key.up) ? -1 : 1;
      if (this.preview) this.scroll = Math.max(0, this.scroll + delta);
      else this.index = Math.max(0, Math.min(this.names.length - 1, this.index + delta));
      return;
    }
    if (this.preview) return;
    if (matchesKey(data, Key.ctrl("u"))) this.query = "";
    else if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) this.query = this.query.slice(0, -1);
    else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) !== 127) this.query += data;
    else return;
    this.index = 0;
  }

  render(width: number): string[] {
    const name = this.selected;
    const accent = (text: string) => this.theme.fg("accent", text);
    const dim = (text: string) => this.theme.fg("dim", text);
    const available = Math.max(1, Math.floor(this.rows()) - 12);
    const lines = [accent("Collections · global resource snapshots"), dim("Project settings may override these settings. Applying offers a reload."), ""];
    if (this.preview && name) {
      const snapshot = this.collections[name];
      const compatible = collectionSourcesMatch(this.current, snapshot);
      lines.push(accent(`Preview: ${name}`), compatible
        ? "Enter replaces global resource settings with this snapshot."
        : this.theme.fg("warning", "Cannot apply: package sources changed. Save a new collection."), "");
      const details = snapshotLines(snapshot);
      this.scroll = Math.min(this.scroll, Math.max(0, details.length - available));
      lines.push(...details.slice(this.scroll, this.scroll + available));
      lines.push(dim(`Settings ${this.scroll + 1}–${Math.min(details.length, this.scroll + available)} of ${details.length}`));
      lines.push("", dim(compatible ? "↑/↓ scroll · Enter apply · Esc back" : "↑/↓ scroll · Esc back"));
    } else {
      const names = this.names;
      lines.push(`Search: ${this.query || "(type to filter)"}`, "");
      const start = Math.max(0, Math.min(this.index - Math.floor(available / 2), names.length - available));
      if (!names.length) lines.push(this.query ? "No matching collections. Ctrl+U clears search." : "No collections yet. Ctrl+S saves your current global settings.");
      for (const n of names.slice(start, start + available)) {
        const snapshot = this.collections[n];
        const status = collectionSourcesMatch(this.current, snapshot) ? "ready" : "sources changed";
        const row = `${n === name ? "›" : " "} ${n} · ${sources(snapshot).length} packages · ${status}`;
        lines.push(n === name ? accent(row) : row);
      }
      lines.push("", dim(`${names.length} collection(s) · Enter preview · ↑/↓ move · Esc close`));
      lines.push(dim("Ctrl+S save current · Ctrl+R rename · Ctrl+D delete"));
    }
    lines.push(dim("Only packages, extensions, skills, prompts and themes are captured."));
    return lines.map(line => truncateToWidth(line, Math.max(0, width), ""));
  }
}

export async function runCollectionManager(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) { ctx.ui.notify("Collection manager requires interactive mode", "error"); return; }
  const agentDir = getAgentDir();
  let selected: string | undefined;
  while (true) {
    let opened = false;
    try {
      const collections = await readCollections(agentDir);
      const settings = SettingsManager.create(ctx.cwd, agentDir);
      assertSettingsErrors(settings);
      const action = await ctx.ui.custom<CollectionAction>((tui, theme, _kb, done) =>
        new CollectionManager(collections, settings.getGlobalSettings(), done, theme, () => tui.terminal.rows, selected));
      opened = true;
      if (!action) return;
      if (action.type === "save") {
        const name = await ctx.ui.input("Save current global settings as collection", "e.g. review");
        if (name === undefined) continue;
        const latest = SettingsManager.create(ctx.cwd, agentDir);
        assertSettingsErrors(latest);
        await saveCollection(agentDir, name, latest.getGlobalSettings());
        selected = name;
        ctx.ui.notify(`Saved collection "${name}".`, "info");
      } else if (action.type === "rename") {
        selected = action.name;
        const name = await ctx.ui.input(`Rename collection "${action.name}"`, action.name);
        if (name === undefined) continue;
        await renameCollection(agentDir, action.name, name);
        selected = name;
        ctx.ui.notify(`Renamed collection to "${name}".`, "info");
      } else if (action.type === "delete") {
        selected = action.name;
        if (!await ctx.ui.confirm(`Delete collection "${action.name}"?`, "Removes the saved snapshot. Current global settings are unchanged.")) continue;
        await deleteCollection(agentDir, action.name);
        selected = undefined;
        ctx.ui.notify(`Deleted collection "${action.name}".`, "info");
      } else {
        await ctx.waitForIdle();
        const latest = await readCollections(agentDir);
        if (!Object.hasOwn(latest, action.name)) throw new Error(`Unknown collection "${action.name}"`);
        await restoreCollection(SettingsManager.create(ctx.cwd, agentDir), latest[action.name], { cwd: ctx.cwd, agentDir });
        await promptCollectionReload(ctx, action.name);
        return;
      }
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      if (!opened) return;
      try { await readCollections(agentDir); assertSettingsErrors(SettingsManager.create(ctx.cwd, agentDir)); }
      catch { return; }
    }
  }
}

export async function promptCollectionReload(ctx: ExtensionCommandContext, name: string): Promise<void> {
  ctx.ui.notify(`Applied collection "${name}". Project settings can still override it.`, "info");
  if (ctx.hasUI && await ctx.ui.confirm("Reload now?", "Reload Pi now to load the collection's resources?")) {
    await ctx.reload();
  } else {
    ctx.ui.notify("Collection saved to settings. Run /reload later to load the resources.", "info");
  }
}
