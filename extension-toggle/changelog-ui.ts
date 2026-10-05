import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { readExtensionChangelog } from "./changelog";
import type { ExtensionChangelog } from "./changelog";

export class ChangelogViewer implements Component {
  private scroll = 0;
  private readonly markdown: Markdown;

  constructor(
    private readonly release: ExtensionChangelog,
    private readonly theme: Theme,
    private readonly done: () => void,
    private readonly rows: () => number,
  ) { this.markdown = new Markdown(release.markdown, 0, 0, getMarkdownTheme()); }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape)) { this.done(); return; }
    const delta = matchesKey(data, Key.up) ? -1 : matchesKey(data, Key.down) ? 1
      : matchesKey(data, Key.pageUp) ? -10 : matchesKey(data, Key.pageDown) ? 10 : 0;
    this.scroll = Math.max(0, this.scroll + delta);
  }

  render(width: number): string[] {
    const height = Math.max(1, Math.floor(this.rows()) - 4);
    const content = this.markdown.render(Math.max(1, width));
    const available = Math.max(1, height - 2);
    this.scroll = Math.min(this.scroll, Math.max(0, content.length - available));
    return [
      this.theme.fg("accent", `extension-toggle · ${this.release.version}`),
      ...content.slice(this.scroll, this.scroll + available),
      this.theme.fg("dim", "↑/↓ scroll · PgUp/PgDn page · Esc close · Ctrl+C close"),
    ].slice(0, height).map(line => truncateToWidth(line, Math.max(0, width), ""));
  }

  invalidate(): void { this.markdown.invalidate(); }
}

export async function runChangelogCommand(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) { ctx.ui.notify("Release notes require interactive mode", "error"); return; }
  await ctx.waitForIdle();
  try {
    const release = await readExtensionChangelog();
    await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
      new ChangelogViewer(release, theme, () => done(), () => tui.terminal.rows));
  } catch (error) {
    ctx.ui.notify(`Could not open release notes: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
