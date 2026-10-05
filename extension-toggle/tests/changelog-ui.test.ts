import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ChangelogViewer } from "../changelog-ui";
import type { ExtensionChangelog } from "../changelog";

initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text } as never;
const release: ExtensionChangelog = {
  key: "/extension-toggle", version: "1.1.0",
  markdown: "## 1.1.0\nAdded collections\n\n## 1.0.0\nInitial toggles",
};

describe("release notes viewer", () => {
  it("shows its history immediately and closes with one Escape or Ctrl+C", () => {
    for (const key of ["\x1b", "\x03"]) {
      let closed = false;
      const ui = new ChangelogViewer(release, theme, () => { closed = true; }, () => 24);
      const history = ui.render(80).join("\n");
      assert.match(history, /Added collections/);
      assert.match(history, /Initial toggles/);
      ui.handleInput(key);
      assert.equal(closed, true);
    }
  });

  it("scrolls long histories, clamps after resize, and leaves room for the host footer", () => {
    const long = { ...release, markdown: Array.from({ length: 60 }, (_, i) => `- Change number ${i}`).join("\n") };
    let rows = 15;
    const ui = new ChangelogViewer(long, theme, () => {}, () => rows);
    const first = ui.render(25).join("\n");
    assert.match(first, /Change number 0/);
    ui.handleInput("\x1b[6~");
    const next = ui.render(25);
    assert.doesNotMatch(next.join("\n"), /Change number 0\b/);
    assert.match(next.join("\n"), /Change number 10/);
    assert.ok(next.length + 3 <= rows);
    assert.ok(next.every(line => visibleWidth(line) <= 25));
    ui.handleInput("\x1b[5~");
    assert.equal(ui.render(25).join("\n"), first);
    for (let i = 0; i < 100; i++) ui.handleInput("\x1b[B");
    assert.match(ui.render(25).join("\n"), /Change number 59/);
    rows = 80;
    assert.match(ui.render(25).join("\n"), /Change number 0/);
    rows = 6;
    const small = ui.render(25);
    assert.ok(small.length + 3 <= rows);
    assert.match(small.join("\n"), /Change number 0/);
  });
});

describe("changelog command integration", () => {
  it("announces only self upgrades and opens only self notes even with another plugin configured", async t => {
    const root = await mkdtemp(join(tmpdir(), "pi-changelog-integration-"));
    const agentDir = join(root, "agent"), cwd = join(root, "project"), plugin = join(root, "plugin"), other = join(root, "other");
    const previousDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    t.after(async () => {
      if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousDir;
      await rm(root, { recursive: true, force: true });
    });
    await mkdir(agentDir); await mkdir(cwd); await mkdir(other);
    await cp(fileURLToPath(new URL("../", import.meta.url)), plugin, { recursive: true });
    await symlink(fileURLToPath(new URL("../../node_modules", import.meta.url)), join(root, "node_modules"));
    await writeFile(join(plugin, "package.json"), JSON.stringify({ name: "@petechu/pi-extension-toggle", version: "1.0.0", type: "module" }));
    await writeFile(join(plugin, "CHANGELOG.md"), "## [Unreleased]\nFuture self notes\n## 1.1.0\nNew self collections\n## 1.0.0\nOriginal self toggles");
    await writeFile(join(other, "package.json"), JSON.stringify({ name: "unrelated-plugin", version: "1.0.0" }));
    await writeFile(join(other, "CHANGELOG.md"), "## 2.0.0\nUnrelated plugin changes");
    const settings = JSON.stringify({ packages: [other] });
    await writeFile(join(agentDir, "settings.json"), settings);
    // The temporary package path is chosen at runtime to exercise module-relative assets.
    const { default: extensionToggle } = await import(pathToFileURL(join(plugin, "index.ts")).href);
    let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    const hooks: ((event: never, ctx: never) => unknown)[] = [];
    const notifications: string[] = [];
    let opened: ChangelogViewer | undefined;
    const api = {
      on(event: string, callback: (event: never, ctx: never) => unknown) { if (event === "session_start") hooks.push(callback); },
      registerCommand(_name: string, options: { handler: typeof handler }) { handler = options.handler; },
      registerShortcut() {},
    };
    extensionToggle(api as unknown as ExtensionAPI);
    const ctx = {
      cwd, hasUI: true, waitForIdle: async () => {},
      ui: {
        getEditorComponent: () => undefined,
        setEditorComponent: () => {},
        notify: (message: string) => notifications.push(message),
        setWidget: (_key: string, lines: string[] | undefined) => { if (lines) notifications.push(...lines); },
        custom: async (factory: (...args: unknown[]) => ChangelogViewer) => {
          opened = factory({ terminal: { rows: 24 } }, theme, {}, () => {});
        },
      },
    } as unknown as ExtensionCommandContext;
    const start = async () => { for (const hook of hooks) await hook({ type: "session_start", reason: "reload" } as never, ctx as never); };
    await start();
    await writeFile(join(other, "package.json"), JSON.stringify({ name: "unrelated-plugin", version: "2.0.0" }));
    await start();
    assert.deepEqual(notifications, []);
    await handler("changelog", ctx);
    assert.ok(opened);
    assert.match(opened.render(80).join("\n"), /Original self toggles/);
    assert.doesNotMatch(opened.render(80).join("\n"), /New self collections|Future self notes|Unrelated plugin changes|unrelated-plugin/);
    await writeFile(join(plugin, "package.json"), JSON.stringify({ name: "@petechu/pi-extension-toggle", version: "1.1.0", type: "module" }));
    await start();
    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /extension-toggle.*1.0.0 → 1.1.0/);
    assert.doesNotMatch(notifications[0], /unrelated-plugin|New self collections/);
    await start();
    assert.equal(notifications.length, 1);
    await handler("changelog", ctx);
    assert.ok(opened);
    assert.match(opened.render(80).join("\n"), /New self collections/);
    assert.doesNotMatch(opened.render(80).join("\n"), /Future self notes|Unrelated plugin changes/);
    assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), settings);
    opened = undefined;
    await handler("changelog unrelated-plugin", ctx);
    assert.equal(opened, undefined);
    await handler("list", ctx);
    assert.match(notifications.at(-1)!, /No collections saved/);
  });
});
