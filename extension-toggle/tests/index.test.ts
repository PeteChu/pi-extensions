import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CustomEditor,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionStartEvent,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCollections, saveCollection } from "../collections";
import { CombinedAutocompleteProvider, Editor, getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, visibleWidth, type EditorComponent } from "@earendil-works/pi-tui";
import extensionToggle, {
  ExtensionMultiSelect,
  getExtensionToggleCompletions,
  type ExtensionToggleSelection,
} from "../index";
import type { ExtensionOption } from "../utils";
import { CollectionManager } from "../collection-ui";

describe("extension-toggle extension", () => {
  it("registers the floating window shortcut", () => {
    let registeredShortcut = "";
    let description = "";

    extensionToggle({
      on() {},
      registerCommand() {},
      registerShortcut(shortcut: string, options: { description?: string }) {
        registeredShortcut = shortcut;
        description = options.description ?? "";
      },
    } as never);

    assert.equal(registeredShortcut, "ctrl+shift+e");
    assert.match(description, /floating window/);
  });

  it("filters immediately and toggles filtered rows by original index", () => {
    let result: ExtensionToggleSelection[] | null | undefined;
    const options = testOptions();
    const component = new ExtensionMultiSelect(options, (selection) => {
      result = selection;
    });

    for (const character of "review") component.handleInput(character);

    const filteredRender = component.render(80).join("\n");
    assert.match(filteredRender, /Search: review/);
    assert.match(filteredRender, /reviewer \(global skill\)/);
    assert.doesNotMatch(filteredRender, /ai-commit/);
    assert.match(filteredRender, /1\/3 shown/);

    component.handleInput(" "); // toggle the selected filtered row
    component.handleInput("\r");

    assert.deepEqual(result, [
      {
        option: options[2],
        enabled: true,
      },
    ]);
  });

  it("keeps arrow navigation and Space toggling available while filtering", () => {
    let result: ExtensionToggleSelection[] | null | undefined;
    const options = testOptions();
    const component = new ExtensionMultiSelect(options, (selection) => {
      result = selection;
    });

    for (const character of "global") component.handleInput(character);
    component.handleInput("\u001b[A"); // Up stays on the first filtered row.
    component.handleInput("\u001b[B"); // Down selects the next filtered row.
    component.handleInput(" ");
    component.handleInput("\r");

    assert.deepEqual(result, [
      {
        option: options[2],
        enabled: true,
      },
    ]);
  });

  it("edits and clears the query while filtering", () => {
    const component = new ExtensionMultiSelect(testOptions(), () => {});

    for (const character of "review") component.handleInput(character);
    component.handleInput("\x7f");
    assert.match(component.render(80).join("\n"), /Search: revie/);

    component.handleInput("\x15");
    const render = component.render(80).join("\n");
    assert.match(render, /Search: \(empty\)/);
    assert.match(render, /ai-commit/);
    assert.match(render, /answer/);
    assert.match(render, /reviewer/);
  });

  it("clears the query before Escape cancels and remains searchable", () => {
    let result: ExtensionToggleSelection[] | null | undefined;
    const component = new ExtensionMultiSelect(testOptions(), (selection) => {
      result = selection;
    });

    for (const character of "review") component.handleInput(character);
    component.handleInput("\u001b");
    const clearedRender = component.render(80).join("\n");
    assert.equal(result, undefined);
    assert.match(clearedRender, /Search: \(empty\)/);
    assert.match(clearedRender, /ai-commit/);

    for (const character of "answer") component.handleInput(character);
    assert.match(component.render(80).join("\n"), /Search: answer/);

    component.handleInput("\u001b");
    component.handleInput("\u001b");
    assert.equal(result, null);
  });

  it("uses a configurable visible row count", () => {
    const options = Array.from({ length: 20 }, (_, index) =>
      longLabelOption(index),
    );
    const component = new ExtensionMultiSelect(
      options,
      () => {},
      () => 5,
    );
    const lines = component.render(100);

    assert.equal(
      lines.filter((line) => line.includes("[x]") || line.includes("[ ]"))
        .length,
      5,
    );
    assert.match(lines.join("\n"), /\(1\/20 shown, 20 total\)/);
  });

  it("uses a compact footer when help is available", () => {
    const component = new ExtensionMultiSelect(
      testOptions(),
      () => {},
      12,
      true,
    );
    const render = component.render(100).join("\n");

    assert.match(render, /\? help/);
    assert.doesNotMatch(render, /j\/k/);
    assert.doesNotMatch(render, /ctrl\+f/);
  });

  it("drops overflowing default footer hints instead of ellipsizing", () => {
    const component = new ExtensionMultiSelect(testOptions(), () => {});

    const normalFooter = component.render(35).at(-1) ?? "";
    assert.equal(normalFooter, "↑/↓: move · space: toggle");
    assert.doesNotMatch(normalFooter, /\.\.\./);

    const searchFooter = component.render(35).at(-1) ?? "";
    assert.equal(searchFooter, "↑/↓: move · space: toggle");
    assert.doesNotMatch(searchFooter, /\.\.\./);
  });

  it("drops only overflowing footer hints while preserving question mark help", () => {
    const component = new ExtensionMultiSelect(
      testOptions(),
      () => {},
      12,
      true,
    );

    const normalFooter = component.render(20).at(-1) ?? "";
    assert.equal(normalFooter, "↑/↓ move · ? help");
    assert.doesNotMatch(normalFooter, /\.\.\./);

    const searchFooter = component.render(20).at(-1) ?? "";
    assert.equal(searchFooter, "↑/↓ move · ? help");
    assert.doesNotMatch(searchFooter, /\.\.\./);
  });

  it("pins the floating window shortcut before question mark help", () => {
    const component = new ExtensionMultiSelect(
      testOptions(),
      () => {},
      12,
      true,
      "ctrl+shift+e float",
    );

    const normalFooter = component.render(35).at(-1) ?? "";
    assert.equal(normalFooter, "ctrl+shift+e float · ? help");

    const searchFooter = component.render(35).at(-1) ?? "";
    assert.equal(searchFooter, "ctrl+shift+e float · ? help");
  });

  it("keeps rendered lines within width for long labels and narrow terminals", () => {
    const width = 20;
    const options = Array.from({ length: 16 }, (_, index) => ({
      ...longLabelOption(index),
      label: `extremely-long-extension-label-${index}-with-extra-detail-and-wide-text-測試`,
    }));
    const component = new ExtensionMultiSelect(options, () => {});

    assertRenderedLinesFitWidth(component.render(width), width);
  });

  it("keeps rendered lines within width for long search queries and empty results", () => {
    const width = 18;
    const component = new ExtensionMultiSelect([longLabelOption(0)], () => {});

    for (const character of "query-that-is-much-longer-than-the-terminal-width") {
      component.handleInput(character);
    }

    assertRenderedLinesFitWidth(component.render(width), width);
  });
});

describe("extension-toggle collection commands", { concurrency: false }, () => {
  it("suggests command actions and completes saved names using the full argument value", async (t) => {
    const fixture = await commandFixture(t);
    assert.equal(fixture.completions, getExtensionToggleCompletions);
    assert.deepEqual((await fixture.completions!(""))?.map(item => item.value), ["toggle", "collections", "save ", "use ", "list"]);
    assert.deepEqual((await fixture.completions!("col"))?.map(item => item.value), ["collections"]);
    await saveCollection(fixture.agentDir, "review", {});
    await saveCollection(fixture.agentDir, "baseline", {});
    assert.deepEqual((await fixture.completions!("use "))?.map(item => item.value), ["use baseline", "use review"]);
    assert.deepEqual((await fixture.completions!("use re"))?.map(item => item.value), ["use review"]);
    for (const prefix of ["unknown", "save new", "use missing", "use review extra"]) {
      assert.equal(await fixture.completions!(prefix), null);
    }
    await writeFile(fixture.storePath, "{broken");
    assert.equal(await fixture.completions!("use "), null);
    assert.ok(await fixture.completions!("collections"));
  });

  it("returns to the manager after cancelled dialogs or invalid names without writes", async (t) => {
    const fixture = await commandFixture(t, { skills: ["keep.md"] });
    await saveCollection(fixture.agentDir, "baseline", { skills: [] });
    const before = await fixture.settingsBytes();
    const storeBefore = await readFile(fixture.storePath);
    const keys = ["\x13", "\x13", "\x04", "\x1b"];
    const names = [undefined, "invalid name"];
    fixture.ctx.ui.input = async () => names.shift();
    fixture.ctx.ui.confirm = async () => false;
    fixture.ctx.ui.custom = ((factory: Parameters<typeof fixture.ctx.ui.custom>[0]) => new Promise<unknown>(resolve => {
      const component = factory(
        { terminal: { rows: 24 } } as never,
        { fg: (_color: string, text: string) => text } as never,
        {} as never,
        resolve,
      ) as CollectionManager;
      component.handleInput!(keys.shift()!);
    })) as typeof fixture.ctx.ui.custom;
    await fixture.handler("collections", fixture.ctx);
    assert.equal(keys.length, 0);
    assert.deepEqual(await fixture.settingsBytes(), before);
    assert.deepEqual(await readFile(fixture.storePath), storeBefore);
    assert.ok(fixture.notifications.some(({ type }) => type === "error"));
  });

  it("manages collections through the custom Pi UI without changing current settings", async (t) => {
    const fixture = await commandFixture(t, { skills: ["review.md"], defaultModel: "keep" });
    const before = await fixture.settingsBytes();
    const keys = ["\x13", "\x12", "\x04", "\x1b"];
    const names = ["review", "review-renamed"];
    fixture.ctx.ui.input = async () => names.shift();
    fixture.ctx.ui.confirm = async () => true;
    fixture.ctx.ui.custom = ((factory: Parameters<typeof fixture.ctx.ui.custom>[0]) => new Promise<unknown>(resolve => {
      const component = factory(
        { terminal: { rows: 24 } } as never,
        { fg: (_color: string, text: string) => text } as never,
        {} as never,
        resolve,
      ) as CollectionManager;
      assert.ok(component instanceof CollectionManager);
      component.handleInput(keys.shift()!);
    })) as typeof fixture.ctx.ui.custom;
    await fixture.handler("collections", fixture.ctx);
    assert.equal(keys.length, 0);
    assert.deepEqual(await readCollections(fixture.agentDir), {});
    assert.deepEqual(await fixture.settingsBytes(), before);
    assert.ok(fixture.notifications.some(({ message }) => message.includes('Saved collection "review"')));
    assert.ok(fixture.notifications.some(({ message }) => message.includes('Renamed collection to "review-renamed"')));
    assert.ok(fixture.notifications.some(({ message }) => message.includes('Deleted collection "review-renamed"')));
  });

  for (const reloadNow of [false, true]) it(`applies a previewed collection and ${reloadNow ? "reloads when confirmed" : "keeps settings when reload is declined"}`, async (t) => {
    const fixture = await commandFixture(t, { skills: ["current.md"], defaultModel: "keep" });
    await saveCollection(fixture.agentDir, "review", { skills: [] });
    const before = await fixture.settingsBytes();
    let waited = false;
    let reloads = 0;
    fixture.ctx.reload = async () => { reloads++; };
    fixture.ctx.ui.confirm = async (title) => {
      assert.equal(title, "Reload now?");
      assert.deepEqual(SettingsManager.create(fixture.cwd, fixture.agentDir).getGlobalSettings(), { skills: [], defaultModel: "keep" });
      return reloadNow;
    };
    fixture.ctx.waitForIdle = async () => { waited = true; };
    fixture.ctx.ui.custom = ((factory: Parameters<typeof fixture.ctx.ui.custom>[0]) => new Promise<unknown>(resolve => {
      const component = factory(
        { terminal: { rows: 24 } } as never,
        { fg: (_color: string, text: string) => text } as never,
        {} as never,
        resolve,
      ) as CollectionManager;
      component.handleInput!("\r");
      component.handleInput!("\r");
    })) as typeof fixture.ctx.ui.custom;
    await fixture.handler("collections", fixture.ctx);
    assert.equal(waited, true);
    assert.deepEqual(SettingsManager.create(fixture.cwd, fixture.agentDir).getGlobalSettings(), { skills: [], defaultModel: "keep" });
    assert.deepEqual(await readFile(fixture.projectPath), before.project);
    assert.equal(reloads, reloadNow ? 1 : 0);
    if (!reloadNow) assert.ok(fixture.notifications.some(({ message }) => message.includes("/reload")));
    assert.equal(fixture.notifications.some(({ type }) => type === "error"), false);
  });

  it("saves global resource settings and lists persisted names without changing settings", async (t) => {
    const fixture = await commandFixture(t, {
      extensions: [], skills: ["skills/review.md"], defaultModel: "keep",
    });
    const before = await fixture.settingsBytes();
    await fixture.handler("save review", fixture.ctx);
    assert.deepEqual(await readCollections(fixture.agentDir), {
      review: { extensions: [], skills: ["skills/review.md"] },
    });
    assert.deepEqual(await fixture.settingsBytes(), before);
    fixture.notifications.length = 0;
    await fixture.handler("list", fixture.ctx);
    assert.ok(fixture.notifications.some(({ message, type }) => type === "info" && message.includes("review")));
    assert.deepEqual(await fixture.settingsBytes(), before);
  });

  it("rejects bad commands, argument counts, invalid names and unknown collections without writes", async (t) => {
    const fixture = await commandFixture(t, { extensions: ["current.ts"] });
    await saveCollection(fixture.agentDir, "baseline", { extensions: ["current.ts"] });
    const before = await fixture.settingsBytes();
    const storeBefore = await readFile(fixture.storePath);
    for (const args of [
      "save", "use", "save name extra", "use baseline extra", "list extra",
      "unknown baseline", "save ../escape", "use ../escape", "use missing",
      "use constructor", "save baseline",
    ]) {
      fixture.notifications.length = 0;
      await fixture.handler(args, fixture.ctx);
      assert.ok(fixture.notifications.some(({ type }) => type === "error"), args);
      assert.deepEqual(await fixture.settingsBytes(), before, args);
      assert.deepEqual(await readFile(fixture.storePath), storeBefore, args);
    }
  });

  it("waits for idle before restoring and prompts for reload after settings are saved", async (t) => {
    const fixture = await commandFixture(t, { extensions: ["current.ts"], defaultModel: "keep" });
    await saveCollection(fixture.agentDir, "review", { extensions: [], skills: [] });
    const before = await fixture.settingsBytes();
    const storeBefore = await readFile(fixture.storePath);
    let signalIdleEntered!: () => void;
    let releaseIdle!: () => void;
    const idleEntered = new Promise<void>(resolve => { signalIdleEntered = resolve; });
    const idleReleased = new Promise<void>(resolve => { releaseIdle = resolve; });
    fixture.ctx.waitForIdle = async () => {
      signalIdleEntered();
      await idleReleased;
    };
    const applying = fixture.handler("use review", fixture.ctx);
    try {
      await idleEntered;
      assert.deepEqual(await fixture.settingsBytes(), before);
      assert.deepEqual(await readFile(fixture.storePath), storeBefore);
      assert.equal(fixture.notifications.length, 0);
    } finally {
      releaseIdle();
    }
    await applying;
    assert.deepEqual(
      SettingsManager.create(fixture.cwd, fixture.agentDir).getGlobalSettings(),
      { defaultModel: "keep", extensions: [], skills: [] },
    );
    assert.deepEqual(await readFile(fixture.projectPath), before.project);
    assert.deepEqual(await readFile(fixture.storePath), storeBefore);
    assert.deepEqual(fixture.confirmations, ["Reload now?"]);
    assert.ok(fixture.notifications.some(({ message, type }) => type === "info" && message.includes("/reload")));
    assert.equal(fixture.notifications.some(({ type }) => type === "error"), false);
  });

  it("reports collection and settings errors without announcing a successful restore", async (t) => {
    const fixture = await commandFixture(t, { extensions: ["current.ts"] });
    await writeFile(fixture.storePath, "{broken");
    const before = await fixture.settingsBytes();
    for (const args of ["list", "save new", "use baseline"]) {
      fixture.notifications.length = 0;
      await fixture.handler(args, fixture.ctx);
      assert.ok(fixture.notifications.some(({ type }) => type === "error"), args);
      assert.equal(fixture.notifications.some(({ message }) => message.includes("/reload")), false, args);
      assert.deepEqual(await fixture.settingsBytes(), before, args);
      assert.equal(await readFile(fixture.storePath, "utf8"), "{broken");
    }
    await writeFile(fixture.storePath, '{"baseline":{"extensions":[]}}');
    await writeFile(fixture.globalPath, "{broken-settings");
    for (const args of ["save new", "use baseline"]) {
      fixture.notifications.length = 0;
      await fixture.handler(args, fixture.ctx);
      assert.ok(fixture.notifications.some(({ type }) => type === "error"), args);
      assert.equal(fixture.notifications.some(({ message }) => message.includes("/reload")), false, args);
      assert.equal(await readFile(fixture.globalPath, "utf8"), "{broken-settings");
      assert.equal(await readFile(fixture.storePath, "utf8"), '{"baseline":{"extensions":[]}}');
    }
  });

  it("keeps no-argument invocation on the existing picker path", async (t) => {
    const fixture = await commandFixture(t);
    await mkdir(join(fixture.agentDir, "extensions"));
    await writeFile(join(fixture.agentDir, "extensions", "example.ts"), "export default function () {}");
    let openedPicker = false;
    fixture.ctx.ui.custom = (async () => {
      openedPicker = true;
      return null;
    }) as typeof fixture.ctx.ui.custom;
    const before = await fixture.settingsBytes();
    await fixture.handler("", fixture.ctx);
    assert.equal(openedPicker, true);
    openedPicker = false;
    await fixture.handler("toggle", fixture.ctx);
    assert.equal(openedPicker, true);
    assert.deepEqual(await fixture.settingsBytes(), before);
    await assert.rejects(readFile(fixture.storePath), { code: "ENOENT" });
  });
});

describe("extension-toggle editor installation", { concurrency: false, timeout: 5000 }, () => {
  for (const [custom, projectLimit, expectedRows] of [
    [false, undefined, 12],
    [false, 7, 7],
    [true, 7, 9],
  ] as const) {
    it(`keeps ${expectedRows} visible completions with ${custom ? "an existing factory" : "the default editor"} and project limit ${projectLimit}`, async t => {
      const root = await mkdtemp(join(tmpdir(), "extension-toggle-editor-"));
      const agentDir = join(root, "agent");
      const cwd = join(root, "project");
      const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
      const priorKeys = getKeybindings();
      t.after(async () => {
        if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
        setKeybindings(priorKeys);
        await rm(root, { recursive: true, force: true });
      });
      process.env.PI_CODING_AGENT_DIR = agentDir;
      await mkdir(agentDir);
      await mkdir(join(cwd, ".pi"), { recursive: true });
      await writeFile(join(agentDir, "settings.json"), '{"autocompleteMaxVisible":12}');
      await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ autocompleteMaxVisible: projectLimit }));
      for (let i = 0; i < 15; i++) await saveCollection(agentDir, `collection-${String(i).padStart(2, "0")}`, {});
      const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
      setKeybindings(keybindings);
      let sessionStart: ((event: SessionStartEvent, ctx: ExtensionContext) => unknown) | undefined;
      extensionToggle({
        on(event: string, handler: typeof sessionStart) {
          if (event === "session_start") sessionStart = handler;
        },
        registerCommand() {},
        registerShortcut() {},
      } as never);
      let installedFactory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
      const existingFactory: NonNullable<typeof installedFactory> = (tui, theme) =>
        new Editor(tui, theme, { paddingX: 3, autocompleteMaxVisible: 9 });
      const ctx = {
        cwd,
        hasUI: true,
        ui: {
          getEditorComponent: () => custom ? existingFactory : undefined,
          setEditorComponent(factory: typeof installedFactory) { installedFactory = factory; },
        },
      } as unknown as ExtensionContext;
      assert.ok(sessionStart);
      await sessionStart({ type: "session_start", reason: "startup" }, ctx);
      assert.ok(installedFactory);
      let resolveRendered!: () => void;
      const rendered = new Promise<void>(resolve => { resolveRendered = resolve; });
      let editor: EditorComponent | undefined;
      const plain = (text: string) => text;
      const tui = {
        terminal: { columns: 100, rows: 30 },
        requestRender() {
          if (editor?.render(100).some(line => /collection-\d{2}/.test(line))) resolveRendered();
        },
      } as never;
      const editorTheme = { borderColor: plain, selectList: { selectedPrefix: plain, selectedText: plain, description: plain, scrollInfo: plain, noMatch: plain } };
      editor = installedFactory(tui, editorTheme, keybindings as never);
      assert.ok(editor instanceof Editor);
      if (!custom) assert.ok(editor instanceof CustomEditor);
      editor.setAutocompleteProvider(new CombinedAutocompleteProvider([
        { name: "extension-toggle", getArgumentCompletions: getExtensionToggleCompletions },
      ], cwd));
      editor.setText("/extension-toggle use ");
      editor.handleInput("\t");
      await rendered;
      const rows = editor.render(100).filter(line => /collection-\d{2}/.test(line));
      assert.equal(rows.length, expectedRows);
      assert.match(rows[0], /collection-00/);
      assert.match(rows.at(-1) ?? "", new RegExp(`collection-${String(expectedRows - 1).padStart(2, "0")}`));
      assert.equal(editor.getText(), "/extension-toggle use ");
      if (!custom) {
        editor.addToHistory("/extension-toggle list");
        editor.setText("");
        await sessionStart({ type: "session_start", reason: "reload" }, ctx);
        assert.ok(installedFactory);
        const reloaded = installedFactory(tui, editorTheme, keybindings as never);
        reloaded.handleInput("\x1b[A");
        assert.equal(reloaded.getText(), "/extension-toggle list");
        reloaded.setText("");
      }
    });
  }
});

async function commandFixture(
  t: { after: (fn: () => Promise<void>) => void },
  global: object = {},
) {
  const root = await mkdtemp(join(tmpdir(), "extension-toggle-command-"));
  const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir);
  const globalPath = join(agentDir, "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");
  const storePath = join(agentDir, "extension-toggle-collections.json");
  await writeFile(globalPath, JSON.stringify(global));
  await writeFile(projectPath, '{"skills":["project.md"],"defaultModel":"project"}');
  let handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let completions: typeof getExtensionToggleCompletions | undefined;
  const api: Pick<ExtensionAPI, "registerCommand" | "registerShortcut" | "on"> = {
    on() {},
    registerCommand(name, options) {
      if (name === "extension-toggle") {
        handler = options.handler;
        completions = options.getArgumentCompletions as typeof getExtensionToggleCompletions;
      }
    },
    registerShortcut() {},
  };
  extensionToggle(api as ExtensionAPI);
  const notifications: { message: string; type: string }[] = [];
  const confirmations: string[] = [];
  const ctx = {
    cwd,
    hasUI: true,
    waitForIdle: async () => {},
    reload: async () => assert.fail("Collection commands must not reload"),
    ui: {
      notify(message: string, type = "info") { notifications.push({ message, type }); },
      confirm: async (title: string) => { confirmations.push(title); return false; },
      custom: async () => assert.fail("Collection commands must not open a picker"),
    },
  } as unknown as ExtensionCommandContext;
  return {
    cwd, agentDir, globalPath, projectPath, storePath, handler: handler!, completions, ctx, notifications, confirmations,
    settingsBytes: async () => ({
      global: await readFile(globalPath),
      project: await readFile(projectPath),
    }),
  };
}

function assertRenderedLinesFitWidth(lines: string[], width: number): void {
  for (const [index, line] of lines.entries()) {
    assert.ok(
      visibleWidth(line) <= width,
      `line ${index} exceeds width ${width}: ${visibleWidth(line)} > ${width}`,
    );
  }
}

function testOptions(): ExtensionOption[] {
  return [
    {
      label: "ai-commit (global extension)",
      resources: [
        resource({
          path: "/home/user/.pi/agent/extensions/ai-commit/index.ts",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      sourceKey: "extensions/ai-commit/index.ts",
      scope: "user",
      origin: "top-level",
      resourceType: "extensions",
    },
    {
      label: "answer (global extension)",
      resources: [
        resource({
          path: "/home/user/.pi/agent/extensions/answer/index.ts",
          enabled: false,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      sourceKey: "extensions/answer/index.ts",
      scope: "user",
      origin: "top-level",
      resourceType: "extensions",
    },
    {
      label: "reviewer (global skill)",
      resources: [
        resource({
          path: "/home/user/.pi/agent/skills/reviewer/skill.md",
          enabled: false,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      sourceKey: "skills/reviewer/skill.md",
      scope: "user",
      origin: "top-level",
      resourceType: "skills",
    },
  ];
}

function longLabelOption(index: number): ExtensionOption {
  return {
    label: `long-label-${index}`,
    resources: [
      resource({
        path: `/home/user/.pi/agent/extensions/long-label-${index}/index.ts`,
        enabled: index % 2 === 0,
        source: "auto",
        scope: "user",
        origin: "top-level",
        baseDir: "/home/user/.pi/agent",
      }),
    ],
    sourceKey: `extensions/long-label-${index}/index.ts`,
    scope: "user",
    origin: "top-level",
    resourceType: "extensions",
  };
}

function resource(options: {
  path: string;
  enabled: boolean;
  source: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  baseDir?: string;
}): ResolvedResource {
  return {
    path: options.path,
    enabled: options.enabled,
    metadata: {
      source: options.source,
      scope: options.scope,
      origin: options.origin,
      baseDir: options.baseDir,
    },
  };
}
