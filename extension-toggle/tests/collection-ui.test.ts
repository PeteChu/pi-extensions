import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CombinedAutocompleteProvider, Editor, getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { getExtensionToggleCompletions } from "../index";
import { withExtensionToggleCompletion } from "../command-completion";
import { CollectionManager } from "../collection-ui";
import { deleteCollection, readCollections, renameCollection, saveCollection } from "../collections";

const theme = { fg: (_color: string, text: string) => text };
const snapshot = { packages: [{ source: "npm:tools", extensions: [], skills: ["review"], prompts: [], themes: [] }], skills: [] };

function completionEditor(cwd = process.cwd()) {
  const plain = (text: string) => text;
  const pending = new Set<() => void>();
  const editor = withExtensionToggleCompletion(new Editor(
    { requestRender() { for (const check of pending) check(); }, terminal: { columns: 100, rows: 24 } } as never,
    { borderColor: plain, selectList: { selectedPrefix: plain, selectedText: plain, description: plain, scrollInfo: plain, noMatch: plain } },
  ));
  const provider = new CombinedAutocompleteProvider([
    { name: "extension-toggle", getArgumentCompletions: getExtensionToggleCompletions },
    { name: "other" },
  ], cwd);
  const getSuggestions = provider.getSuggestions.bind(provider);
  let lastRequest: Promise<unknown> = Promise.resolve();
  provider.getSuggestions = (...args) => {
    const request = getSuggestions(...args);
    lastRequest = request;
    return request;
  };
  editor.setAutocompleteProvider(provider);
  return {
    editor,
    async settleRequests() {
      await new Promise<void>(resolve => setImmediate(resolve));
      await lastRequest;
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    waitForRender(predicate: () => boolean) {
      return new Promise<void>(resolve => {
        const check = () => {
          if (!predicate()) return;
          pending.delete(check);
          resolve();
        };
        pending.add(check);
      });
    },
  };
}

const settleCompletion = () => new Promise<void>(resolve => setImmediate(resolve));

describe("extension-toggle Tab completion", { concurrency: false, timeout: 5000 }, () => {
  it("opens actions immediately after Tab selects the command, and inserts the chosen action", async t => {
    const priorKeys = getKeybindings();
    t.after(() => setKeybindings(priorKeys));
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
    const { editor, waitForRender } = completionEditor();
    let submitted: string | undefined;
    editor.onSubmit = text => submitted = text;
    for (const c of "/extension-t") editor.handleInput(c);
    await waitForRender(() => editor.render(100).join("\n").includes("extension-toggle"));
    editor.handleInput("\t");
    await waitForRender(() => editor.render(100).join("\n").includes("save <name>"));
    assert.equal(editor.getText(), "/extension-toggle ");
    const menu = editor.render(100).join("\n");
    for (const label of ["toggle", "collections", "save <name>", "use <name>", "list"]) assert.ok(menu.includes(label), label);
    assert.equal(submitted, undefined);
    editor.handleInput("\x1b[B");
    editor.handleInput("\t");
    assert.equal(editor.getText(), "/extension-toggle collections");
    assert.equal(submitted, undefined);
    editor.handleInput("\r");
    assert.equal(submitted, "/extension-toggle collections");
  });

  it("leaves other command completion unchanged and does not stack hooks", async t => {
    const priorKeys = getKeybindings();
    t.after(() => setKeybindings(priorKeys));
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
    const { editor, waitForRender } = completionEditor();
    assert.equal(withExtensionToggleCompletion(editor), editor);
    for (const c of "/oth") editor.handleInput(c);
    await waitForRender(() => editor.render(100).join("\n").includes("other"));
    editor.handleInput("\t");
    await settleCompletion();
    assert.equal(editor.getText(), "/other ");
    assert.doesNotMatch(editor.render(100).join("\n"), /save <name>|collections/);
  });

  for (const [binding, key] of [["tab", "\t"], ["ctrl+space", "\x00"]] as const) {
    it(`opens saved names after selecting use with ${binding}, without inserting files or submitting`, async t => {
      const agentDir = await mkdtemp(join(tmpdir(), "collection-completion-"));
      const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
      const priorKeys = getKeybindings();
      t.after(async () => {
        if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
        setKeybindings(priorKeys);
        await rm(agentDir, { recursive: true, force: true });
      });
      process.env.PI_CODING_AGENT_DIR = agentDir;
      await saveCollection(agentDir, "baseline", {});
      await saveCollection(agentDir, "review", snapshot);
      await writeFile(join(agentDir, "review-file.txt"), "tempt filesystem completion");
      const { editor, waitForRender, settleRequests } = completionEditor(agentDir);
      setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS, { "tui.input.tab": binding }));
      let submitted: string | undefined;
      editor.onSubmit = text => submitted = text;
      for (const c of "/extension-t") editor.handleInput(c);
      await waitForRender(() => editor.render(100).join("\n").includes("extension-toggle"));
      editor.handleInput(key);
      await waitForRender(() => editor.render(100).join("\n").includes("use <name>"));
      assert.equal(editor.getText(), "/extension-toggle ");
      for (let i = 0; i < 3; i++) editor.handleInput("\x1b[B");
      editor.handleInput(key);
      await waitForRender(() => editor.render(100).join("\n").includes("baseline"));
      assert.equal(editor.getText(), "/extension-toggle use ");
      const menu = editor.render(100).join("\n");
      assert.match(menu, /baseline/);
      assert.match(menu, /review/);
      assert.doesNotMatch(menu, /review-file\.txt|extension-toggle-collections\.json/);
      let changes = 0;
      editor.onChange = () => { changes++; };
      editor.handleInput("\x1b[B");
      editor.handleInput(key);
      await settleRequests();
      assert.equal(editor.getText(), "/extension-toggle use review");
      assert.doesNotMatch(editor.render(100).join("\n"), /Apply saved global configuration/);
      assert.equal(editor.isShowingAutocomplete(), false);
      assert.equal(changes, 1);
      assert.equal(submitted, undefined);
      editor.handleInput("\r");
      assert.equal(submitted, "/extension-toggle use review");
    });
  }

  it("routes arguments at the cursor after provider reassignment and preserves file completion elsewhere", async t => {
    const agentDir = await mkdtemp(join(tmpdir(), "collection-completion-"));
    const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
    const priorKeys = getKeybindings();
    t.after(async () => {
      if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
      setKeybindings(priorKeys);
      await rm(agentDir, { recursive: true, force: true });
    });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
    await saveCollection(agentDir, "baseline", {});
    await saveCollection(agentDir, "review", {});
    await writeFile(join(agentDir, "review-file.txt"), "tempt filesystem completion");
    await writeFile(join(agentDir, "missing-file.txt"), "tempt unmatched argument completion");
    const { editor, waitForRender } = completionEditor(agentDir);
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider([
      { name: "extension-toggle", getArgumentCompletions: getExtensionToggleCompletions },
      { name: "extension-toggle-other" },
      { name: "fresh-command", description: "replacement-only command" },
    ], agentDir));
    editor.setText("/fresh-c");
    editor.handleInput("\t");
    await waitForRender(() => editor.render(100).join("\n").includes("replacement-only command"));
    editor.handleInput("\t");
    assert.equal(editor.getText(), "/fresh-command ");
    assert.equal(editor.isShowingAutocomplete(), false);
    editor.setText("/extension-toggle use re suffix");
    for (let i = 0; i < " suffix".length; i++) editor.handleInput("\x1b[D");
    editor.handleInput("\t");
    await waitForRender(() => editor.render(100).join("\n").includes("Apply saved global configuration") || editor.getText() !== "/extension-toggle use re suffix");
    if (editor.getText() === "/extension-toggle use re suffix") editor.handleInput("\t");
    assert.equal(editor.getText(), "/extension-toggle use review suffix");
    editor.setText("/extension-toggle use missing");
    editor.handleInput("\t");
    await waitForRender(() => !editor.isShowingAutocomplete());
    assert.equal(editor.getText(), "/extension-toggle use missing");
    assert.doesNotMatch(editor.render(100).join("\n"), /missing-file\.txt|review-file\.txt/);
    editor.setText("/extension-toggle-other review-f");
    editor.handleInput("\t");
    await waitForRender(() => editor.getText() === "/extension-toggle-other review-file.txt");
    editor.setText("open review-f");
    editor.handleInput("\t");
    await waitForRender(() => editor.getText() !== "open review-f");
    assert.match(editor.getText(), /^open review-file\.txt\s*$/);
  });
});

describe("collection manager UI", () => {
  it("filters immediately, previews exact filters and applies only after a second Enter", () => {
    let result: unknown;
    const ui = new CollectionManager({ baseline: {}, review: snapshot }, snapshot, action => result = action, theme);
    for (const c of "review") ui.handleInput(c);
    assert.doesNotMatch(ui.render(100).join("\n"), /baseline/);
    ui.handleInput("\r");
    assert.equal(result, undefined);
    const preview = ui.render(100).join("\n");
    assert.match(preview, /extensions: \[\]/);
    assert.match(preview, /skills: \["review"\]/);
    assert.match(preview, /prompts: not configured/);
    ui.handleInput("\r");
    assert.deepEqual(result, { type: "use", name: "review" });
  });

  it("blocks restoration when package declarations differ, including order", () => {
    let result: unknown;
    const ui = new CollectionManager({ old: { packages: ["npm:b", "npm:a"] } }, { packages: ["npm:a", "npm:b"] }, action => result = action, theme);
    ui.handleInput("\r");
    assert.match(ui.render(100).join("\n"), /Cannot apply: package sources changed/);
    ui.handleInput("\r");
    assert.equal(result, undefined);
    ui.handleInput("\x13");
    assert.deepEqual(result, { type: "save" });
  });

  it("allows saving an empty store and avoids rename/delete actions without a selection", () => {
    let result: unknown;
    const ui = new CollectionManager({}, {}, action => result = action, theme);
    assert.match(ui.render(100).join("\n"), /No collections yet/);
    for (const key of ["\r", "\x12", "\x04"]) ui.handleInput(key);
    assert.equal(result, undefined);
    ui.handleInput("\x13");
    assert.deepEqual(result, { type: "save" });
  });

  it("uses the filtered selection for rename/delete and Escape goes back before cancelling", () => {
    for (const [key, type] of [["\x12", "rename"], ["\x04", "delete"]]) {
      let result: unknown;
      const ui = new CollectionManager({ baseline: {}, review: {} }, {}, action => result = action, theme);
      for (const c of "review") ui.handleInput(c);
      ui.handleInput(key);
      assert.deepEqual(result, { type, name: "review" });
    }
    let result: unknown;
    const ui = new CollectionManager({ review: {} }, {}, action => result = action, theme);
    ui.handleInput("r"); ui.handleInput("\r"); ui.handleInput("\x1b");
    assert.match(ui.render(80).join("\n"), /Search: r/);
    ui.handleInput("\x1b");
    assert.equal(result, undefined);
    ui.handleInput("\x1b");
    assert.equal(result, null);
  });

  it("scrolls long snapshots within terminal height and fits narrow widths", () => {
    const saved = { packages: Array.from({ length: 30 }, (_, i) => `npm:package-${i}-測試`) };
    const ui = new CollectionManager({ review: saved }, saved, () => {}, theme, () => 24);
    ui.handleInput("\r");
    for (let i = 0; i < 100; i++) ui.handleInput("\x1b[B");
    assert.match(ui.render(100).join("\n"), /themes: not configured/);
    for (const width of [0, 1, 20, 80]) {
      const lines = ui.render(width);
      assert.ok(lines.length <= 24);
      for (const line of lines) assert.ok(visibleWidth(line) <= width);
    }
  });
});

describe("collection management storage", () => {
  it("renames exact snapshots, refuses collisions/invalid names, and deletes only the named entry", async t => {
    const agentDir = await mkdtemp(join(tmpdir(), "collection-ui-"));
    t.after(() => rm(agentDir, { recursive: true, force: true }));
    await saveCollection(agentDir, "baseline", {});
    await saveCollection(agentDir, "review", snapshot);
    const file = join(agentDir, "extension-toggle-collections.json");
    const before = await readFile(file);
    for (const newName of ["baseline", "../escape", "bad name"]) {
      await assert.rejects(renameCollection(agentDir, "review", newName));
      assert.deepEqual(await readFile(file), before);
    }
    await renameCollection(agentDir, "review", "Review-v2");
    assert.deepEqual(await readCollections(agentDir), { baseline: {}, "Review-v2": snapshot });
    await assert.rejects(deleteCollection(agentDir, "constructor"));
    await deleteCollection(agentDir, "Review-v2");
    assert.deepEqual(await readCollections(agentDir), { baseline: {} });
    await renameCollection(agentDir, "baseline", "baseline");
    await deleteCollection(agentDir, "baseline");
    assert.deepEqual(await readCollections(agentDir), {});
  });
});
