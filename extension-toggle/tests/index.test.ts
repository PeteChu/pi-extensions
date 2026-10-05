import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CustomEditor,
  DefaultPackageManager,
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
  applyExtensionToggle,
  ExtensionMultiSelect,
  getExtensionToggleCompletions,
  type ExtensionToggleResult,
} from "../index";
import { buildSourceOptions, type ExtensionOption } from "../utils";
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
    let result: ExtensionToggleResult | null | undefined;
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

    assert.deepEqual(result, {
      saveScope: "global",
      selections: [{ option: options[2], enabled: true }],
    });
  });

  it("keeps arrow navigation and Space toggling available while filtering", () => {
    let result: ExtensionToggleResult | null | undefined;
    const options = testOptions();
    const component = new ExtensionMultiSelect(options, (selection) => {
      result = selection;
    });

    for (const character of "global") component.handleInput(character);
    component.handleInput("\u001b[A"); // Up stays on the first filtered row.
    component.handleInput("\u001b[B"); // Down selects the next filtered row.
    component.handleInput(" ");
    component.handleInput("\r");

    assert.deepEqual(result, {
      saveScope: "global",
      selections: [{ option: options[2], enabled: true }],
    });
  });

  it("selects all matching sources with Ctrl+A without toggling checked or hidden rows", () => {
    for (const [query, changedIndexes] of [
      ["", [1, 2]],
      ["global", [1, 2]],
      ["review", [2]],
      ["missing", []],
    ] as const) {
      let result: ExtensionToggleResult | null | undefined;
      const options = testOptions();
      const component = new ExtensionMultiSelect(options, (selection) => {
        result = selection;
      }, 1);

      for (const character of query) component.handleInput(character);
      component.handleInput("\x01");
      component.handleInput("\x01");
      component.handleInput("\r");

      assert.deepEqual(result, {
        saveScope: "global",
        selections: changedIndexes.map(index => ({ option: options[index], enabled: true })),
      }, query);
    }
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
    let result: ExtensionToggleResult | null | undefined;
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
    on() { return () => {}; },
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


describe("repository persistence", () => {
  it("switches save destinations with Tab without losing filtered selections", () => {
    const options = testOptions();
    let result: ExtensionToggleResult | null | undefined;
    const picker = new ExtensionMultiSelect(options, selection => { result = selection; });
    for (const character of "review") picker.handleInput(character);
    picker.handleInput(" ");
    picker.handleInput("\t");
    assert.match(picker.render(80).join("\n"), /Save to: Repo/);
    assert.match(picker.render(80).join("\n"), /Search: review/);
    picker.handleInput("\t");
    assert.match(picker.render(80).join("\n"), /Save to: Global/);
    picker.handleInput("\t");
    picker.handleInput("\r");
    assert.deepEqual(result, { saveScope: "project", selections: [{ option: options[2], enabled: true }] });
  });

  it("defaults from repo resource configuration, saves only to the selected destination and falls back after removal", async t => {
    const fixture = await commandFixture(t);
    await writeFile(fixture.projectPath, '{"defaultModel":"project"}');
    await mkdir(join(fixture.agentDir, "extensions"));
    const resourcePath = join(fixture.agentDir, "extensions", "example.ts");
    await writeFile(resourcePath, "export default function () {};");
    const globalBefore = await readFile(fixture.globalPath);
    const projectBefore = await readFile(fixture.projectPath);
    let expectedScope = "Global";
    let keys = ["\t", "\x03"];
    fixture.ctx.ui.custom = async (factory) => {
      const { promise, resolve } = Promise.withResolvers<Parameters<Parameters<typeof factory>[3]>[0]>();
      const picker = await factory({ terminal: { rows: 38 } } as never, { fg: (_color: string, text: string) => text } as never, {} as never, resolve);
      assert.match(picker.render(110).join("\n"), new RegExp(`Save to: ${expectedScope}`));
      for (const character of "example.ts") picker.handleInput?.(character);
      for (const key of keys) picker.handleInput?.(key);
      return promise;
    };
    await fixture.handler("toggle", fixture.ctx);
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
    assert.deepEqual(await readFile(fixture.projectPath), projectBefore);
    keys = ["\t", "\r"];
    await fixture.handler("toggle", fixture.ctx);
    assert.deepEqual(await readFile(fixture.projectPath), projectBefore);
    keys = ["\t", " ", "\r"];
    await fixture.handler("toggle", fixture.ctx);
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
    assert.deepEqual(JSON.parse(await readFile(fixture.projectPath, "utf8")), {
      defaultModel: "project", extensions: [resourcePath, `-${resourcePath}`],
    });
    expectedScope = "Repo";
    const projectSaved = await readFile(fixture.projectPath);
    keys = ["\t", " ", "\r"];
    await fixture.handler("toggle", fixture.ctx);
    assert.deepEqual(await readFile(fixture.projectPath), projectSaved);
    assert.deepEqual(JSON.parse(await readFile(fixture.globalPath, "utf8")), {
      extensions: [resourcePath, `+${resourcePath}`],
    });
    await writeFile(fixture.projectPath, '{"extensions":[],"defaultModel":"project"}');
    keys = ["\x03"];
    await fixture.handler("toggle", fixture.ctx);
    await rm(fixture.projectPath);
    expectedScope = "Global";
    await fixture.handler("toggle", fixture.ctx);
    await assert.rejects(readFile(fixture.projectPath), { code: "ENOENT" });
    for (const args of ["scope project", "scope source"]) {
      fixture.notifications.length = 0;
      await fixture.handler(args, fixture.ctx);
      assert.ok(fixture.notifications.some(({ type }) => type === "error"));
    }
    await assert.rejects(readFile(join(fixture.cwd, ".pi", "extension-toggle.json")), { code: "ENOENT" });
  });

  it("refuses malformed project settings before opening or writing", async t => {
    const fixture = await commandFixture(t);
    await writeFile(fixture.projectPath, "{invalid");
    const globalBefore = await readFile(fixture.globalPath);
    await fixture.handler("toggle", fixture.ctx);
    assert.ok(fixture.notifications.some(({ type }) => type === "error"));
    assert.equal(await readFile(fixture.projectPath, "utf8"), "{invalid");
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
    assert.deepEqual(fixture.confirmations, []);
  });


  it("saves a projected relative package globally without duplicating or rebasing its declaration", async t => {
    const fixture = await commandFixture(t, { packages: [" ./bundle "], defaultModel: "keep" });
    const bundle = join(fixture.agentDir, "bundle");
    await mkdir(bundle);
    await writeFile(join(bundle, "package.json"), JSON.stringify({ pi: { extensions: ["index.ts"] } }));
    await writeFile(join(bundle, "index.ts"), "export default function () {};");
    await writeFile(fixture.projectPath, JSON.stringify({ packages: [{ source: bundle, extensions: [], skills: [], prompts: [], themes: [] }] }));
    const projectBefore = await readFile(fixture.projectPath);
    const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    const resolver = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
    const resources = (await resolver.resolve()).extensions;
    const option = buildSourceOptions(resources, [], [], [], fixture).find(option => option.resources.some(resource => resource.path === join(bundle, "index.ts")));
    assert.ok(option);
    applyExtensionToggle(manager, option, false, "global", fixture.agentDir, fixture.cwd);
    await manager.flush();
    assert.deepEqual(await readFile(fixture.projectPath), projectBefore);
    assert.deepEqual(manager.getGlobalSettings(), {
      defaultModel: "keep", packages: [{ source: " ./bundle ", extensions: [], skills: [], prompts: [], themes: [] }],
    });
    await rm(fixture.projectPath);
    const globalResolver = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: SettingsManager.create(fixture.cwd, fixture.agentDir) });
    assert.equal((await globalResolver.resolve()).extensions.find(resource => resource.path === join(bundle, "index.ts"))?.enabled, false);
  });

  it("disables and re-enables global resources through project overrides after resolution", async (t) => {
    const fixture = await commandFixture(t);
    await mkdir(join(fixture.agentDir, "extensions"));
    const resourcePath = join(fixture.agentDir, "extensions", "example.ts");
    await writeFile(resourcePath, "export default function () {};");
    const globalBefore = await readFile(fixture.globalPath);
    const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    const packageManager = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
    const original = (await packageManager.resolve()).extensions.find((r) => r.path === resourcePath)!;
    const option: ExtensionOption = {
      label: "example", resources: [original], sourceKey: "extensions/example.ts",
      scope: "user", origin: "top-level", resourceType: "extensions",
    };
    applyExtensionToggle(manager, option, false, "project", fixture.agentDir, fixture.cwd);
    await manager.flush();
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
    const disabled = (await packageManager.resolve()).extensions.find((r) => r.path === resourcePath)!;
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.metadata.scope, "project");
    // The next picker sees a project entry and uses a project-relative pattern.
    applyExtensionToggle(manager, { ...option, resources: [disabled], scope: "project", sourceKey: "../../agent/extensions/example.ts" }, true, "project", fixture.agentDir, fixture.cwd);
    await manager.flush();
    assert.equal((await packageManager.resolve()).extensions.find((r) => r.path === resourcePath)!.enabled, true);
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
  });

  it("overrides a relative global package without rebasing it to the project", async (t) => {
    const fixture = await commandFixture(t, { packages: [" ./bundle "] });
    const bundle = join(fixture.agentDir, "bundle");
    await mkdir(bundle);
    await writeFile(join(bundle, "package.json"), JSON.stringify({ name: "bundle", pi: { extensions: ["index.ts"] } }));
    await writeFile(join(bundle, "index.ts"), "export default function () {};");
    const globalBefore = await readFile(fixture.globalPath);
    const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    const packageManager = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
    const original = (await packageManager.resolve()).extensions[0];
    const option: ExtensionOption = { label: "bundle", resources: [original], sourceKey: " ./bundle ", scope: "user", origin: "package" };
    applyExtensionToggle(manager, option, false, "project", fixture.agentDir, fixture.cwd);
    await manager.flush();
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
    assert.equal((await packageManager.resolve()).extensions[0].enabled, false);
    assert.equal(manager.getProjectSettings().defaultModel, "project");
    applyExtensionToggle(manager, option, true, "project", fixture.agentDir, fixture.cwd);
    await manager.flush();
    assert.equal((await packageManager.resolve()).extensions[0].enabled, true);
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
  });

  it("keeps same-text local packages in different scopes independently toggleable", async t => {
    const fixture = await commandFixture(t, { packages: ["./bundle"] });
    const globalBundle = join(fixture.agentDir, "bundle"), projectBundle = join(fixture.cwd, ".pi", "bundle");
    for (const bundle of [globalBundle, projectBundle]) {
      await mkdir(bundle);
      await writeFile(join(bundle, "package.json"), JSON.stringify({ pi: { extensions: ["index.ts"] } }));
      await writeFile(join(bundle, "index.ts"), "export default function () {};");
    }
    await writeFile(fixture.projectPath, JSON.stringify({ packages: ["./bundle"], defaultModel: "keep" }));
    const globalBefore = await readFile(fixture.globalPath);
    const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    const resolver = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
    const resolved = await resolver.resolve();
    const options = buildSourceOptions(resolved.extensions, [], [], [], fixture);
    assert.equal(options.length, 2);
    const global = options.find(option => option.scope === "user");
    assert.ok(global);
    applyExtensionToggle(manager, global, false, "project", fixture.agentDir, fixture.cwd);
    await manager.flush();
    const next = (await resolver.resolve()).extensions;
    assert.equal(next.find(resource => resource.path === join(globalBundle, "index.ts"))?.enabled, false);
    assert.equal(next.find(resource => resource.path === join(projectBundle, "index.ts"))?.enabled, true);
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
    assert.equal(manager.getProjectSettings().defaultModel, "keep");
  });

  it("retains explicit external resource declarations through disable and re-enable", async t => {
    const fixture = await commandFixture(t);
    const external = join(fixture.cwd, "external", "example.ts");
    await mkdir(join(fixture.cwd, "external"));
    await writeFile(external, "export default function () {};");
    await writeFile(fixture.projectPath, JSON.stringify({ extensions: ["../external/example.ts"], defaultModel: "keep" }));
    const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    const resolver = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
    for (const enabled of [false, true]) {
      const resolved = await resolver.resolve();
      const option = buildSourceOptions(resolved.extensions, [], [], [], fixture).find(option => option.resources.some(resource => resource.path === external));
      assert.ok(option);
      applyExtensionToggle(manager, option, enabled, "project", fixture.agentDir, fixture.cwd);
      await manager.flush();
      assert.equal((await resolver.resolve()).extensions.find(resource => resource.path === external)?.enabled, enabled);
      assert.equal(manager.getProjectSettings().defaultModel, "keep");
    }
  });

  it("re-enables a projected skill excluded by its exact directory path", async t => {
    const fixture = await commandFixture(t);
    const directory = join(fixture.agentDir, "skills", "release-reviewer"), skill = join(directory, "SKILL.md");
    await mkdir(directory, { recursive: true });
    await writeFile(skill, "---\nname: release-reviewer\ndescription: Review releases.\n---\nReview the release.");
    await writeFile(fixture.projectPath, JSON.stringify({ skills: [`-${directory}`] }));
    const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    const resolver = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
    for (const enabled of [false, true]) {
      const resolved = await resolver.resolve();
      const option = buildSourceOptions([], resolved.skills, [], [], fixture).find(option => option.resources.some(resource => resource.path === skill));
      assert.ok(option);
      applyExtensionToggle(manager, option, enabled, "project", fixture.agentDir, fixture.cwd);
      await manager.flush();
      assert.equal((await resolver.resolve()).skills.find(resource => resource.path === skill)?.enabled, enabled);
    }
  });

  it("reuses a global npm installation through project disable and enable after rediscovery", async t => {
    const source = "npm:@fixture/shared@1.0.0";
    const fixture = await commandFixture(t, { packages: [source], defaultModel: "keep-global" });
    const bundle = join(fixture.agentDir, "npm", "node_modules", "@fixture", "shared");
    await mkdir(bundle, { recursive: true });
    const entries = ["index.ts", "other.ts", ".hidden.ts"];
    await writeFile(join(bundle, "package.json"), JSON.stringify({ name: "@fixture/shared", version: "1.0.0", pi: { extensions: entries } }));
    for (const name of entries) await writeFile(join(bundle, name), "export default function () {};");
    const globalBefore = await readFile(fixture.globalPath);
    for (const enabled of [false, true, false]) {
      const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
      const resolver = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
      const missing: string[] = [];
      const resolved = await resolver.resolve(async source => { missing.push(source); return "skip"; });
      const option = buildSourceOptions(resolved.extensions, [], [], [], fixture).find(option => option.resources.some(resource => resource.path.startsWith(`${bundle}/`)));
      assert.ok(option);
      applyExtensionToggle(manager, option, enabled, "project", fixture.agentDir, fixture.cwd);
      await manager.flush();
      const next = await resolver.resolve(async source => { missing.push(source); return "skip"; });
      const resources = next.extensions.filter(resource => resource.path.startsWith(`${bundle}/`));
      assert.deepEqual(missing, []);
      assert.deepEqual(resources.map(resource => resource.enabled), entries.map(() => enabled));
      assert.equal(resolver.getInstalledPath(source, "project"), undefined);
      assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
      assert.equal(manager.getProjectSettings().defaultModel, "project");
    }
  });

  it("replaces project autoload deltas when toggling an entire package", async t => {
    const fixture = await commandFixture(t, { packages: ["./bundle"] });
    const bundle = join(fixture.agentDir, "bundle");
    await mkdir(bundle);
    await writeFile(join(bundle, "package.json"), JSON.stringify({ pi: { extensions: ["index.ts", "other.ts"] } }));
    for (const name of ["index.ts", "other.ts"]) await writeFile(join(bundle, name), "export default function () {};");
    await writeFile(fixture.projectPath, JSON.stringify({ packages: [{ source: bundle, autoload: false, extensions: ["+index.ts"] }] }));
    const globalBefore = await readFile(fixture.globalPath);
    const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    const resolver = new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager });
    const before = await resolver.resolve();
    const global = buildSourceOptions(before.extensions, [], [], [], fixture).find(option => option.scope === "user");
    assert.ok(global);
    applyExtensionToggle(manager, global, false, "project", fixture.agentDir, fixture.cwd);
    await manager.flush();
    const disabled = (await resolver.resolve()).extensions.filter(resource => resource.path.startsWith(`${bundle}/`));
    assert.deepEqual(disabled.map(resource => resource.enabled), [false, false]);
    const project = buildSourceOptions(disabled, [], [], [], fixture)[0];
    applyExtensionToggle(manager, project, true, "project", fixture.agentDir, fixture.cwd);
    await manager.flush();
    const enabled = (await resolver.resolve()).extensions.filter(resource => resource.path.startsWith(`${bundle}/`));
    assert.deepEqual(enabled.map(resource => resource.enabled), [true, true]);
    assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
  });

  it("rejects unfilterable packages before writing any selected changes", async t => {
    for (const kind of ["file", "bare-directory"]) {
      const source = kind === "file" ? "./example.ts" : "./bare";
      const fixture = await commandFixture(t, { packages: [source] });
      const target = join(fixture.agentDir, source);
      if (kind === "bare-directory") await mkdir(target);
      await writeFile(kind === "file" ? target : join(target, "index.ts"), "export default function () {};");
      await mkdir(join(fixture.agentDir, "extensions"));
      const standalone = join(fixture.agentDir, "extensions", "valid.ts");
      await writeFile(standalone, "export default function () {};");
      const manager = SettingsManager.create(fixture.cwd, fixture.agentDir);
      const resolved = await new DefaultPackageManager({ cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: manager }).resolve();
      const options = buildSourceOptions(resolved.extensions, [], [], [], fixture);
      const valid = options.find(option => option.resources.some(resource => resource.path === standalone));
      const unsupported = options.find(option => option.origin === "package");
      assert.ok(valid);
      assert.ok(unsupported);
      for (const saveScope of ["global", "project"] as const) {
        fixture.ctx.ui.custom = (async () => ({
          saveScope, selections: [{ option: valid, enabled: false }, { option: unsupported, enabled: false }],
        })) as typeof fixture.ctx.ui.custom;
        const before = await fixture.settingsBytes();
        fixture.notifications.length = 0;
        await fixture.handler("toggle", fixture.ctx);
        assert.ok(fixture.notifications.some(({ message, type }) => type === "error" && message.includes("cannot apply package filters")));
        assert.deepEqual(await fixture.settingsBytes(), before);
        assert.deepEqual(fixture.confirmations, []);
      }
    }
  });
});
