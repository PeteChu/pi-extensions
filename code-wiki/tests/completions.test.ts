import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import codeWiki from "../index";
import { getCodeWikiArgumentCompletions } from "../src/completions";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("code-wiki completions", () => {
  it("registers argument completions", () => {
    let completions: unknown;
    codeWiki({
      registerCommand(_name: string, options: any) {
        completions = options.getArgumentCompletions("");
      },
      on() {},
    } as never);

    assert.deepEqual(completions, [
      {
        value: "init ",
        label: "init",
        description: "Generate a new persistent codebase wiki",
      },
      {
        value: "update ",
        label: "update",
        description: "Incrementally maintain an existing wiki",
      },
      {
        value: "query ",
        label: "query",
        description: "Answer a question and file substantial results",
      },
      { value: "doctor ", label: "doctor", description: "Check setup" },
    ]);
  });

  it("filters subcommands by partial input", () => {
    assert.deepEqual(getCodeWikiArgumentCompletions("q"), [
      {
        value: "query ",
        label: "query",
        description: "Answer a question and file substantial results",
      },
    ]);
  });

  it("suggests flags for the selected subcommand", () => {
    const completions = getCodeWikiArgumentCompletions("init ");

    assert.ok(completions?.some((item) => item.value === "init --target="));
    assert.ok(completions?.some((item) => item.value === "init --force "));
  });

  it("filters flags by partial input and preserves previous arguments", () => {
    assert.deepEqual(getCodeWikiArgumentCompletions("init --fo"), [
      {
        value: "init --format=",
        label: "--format",
        description: "Markdown format",
      },
      {
        value: "init --force ",
        label: "--force",
        description: "Overwrite existing wiki",
      },
    ]);
  });

  it("excludes already typed flags", () => {
    const completions = getCodeWikiArgumentCompletions("init --force ");

    assert.ok(completions);
    assert.equal(
      completions.some((item) => item.label === "--force"),
      false,
    );
  });

  it("suggests values for --format", () => {
    assert.deepEqual(getCodeWikiArgumentCompletions("init --format=o"), [
      { value: "init --format=obsidian ", label: "obsidian" },
    ]);
  });

  it("suggests values after --format followed by a space", () => {
    assert.deepEqual(getCodeWikiArgumentCompletions("init --format "), [
      { value: "init --format=standard ", label: "standard" },
      { value: "init --format=obsidian ", label: "obsidian" },
    ]);
  });

  it("suggests values for --detail-level", () => {
    assert.deepEqual(
      getCodeWikiArgumentCompletions("update --detail-level=d"),
      [{ value: "update --detail-level=deep ", label: "deep" }],
    );
  });

  it("does not suggest values for unsupported subcommand flags", () => {
    assert.equal(
      getCodeWikiArgumentCompletions("doctor --detail-level=d"),
      null,
    );
  });

  it("suggests target subdirectories", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-wiki-completions-"),
    );
    fs.mkdirSync(path.join(tmpDir, "alpha"));
    fs.mkdirSync(path.join(tmpDir, "beta"));
    fs.writeFileSync(path.join(tmpDir, "aardvark.txt"), "not a directory");
    process.chdir(tmpDir);

    assert.deepEqual(getCodeWikiArgumentCompletions("init --target=a"), [
      {
        value: "init --target=alpha/",
        label: "alpha/",
        description: "Directory",
      },
    ]);
  });
});
