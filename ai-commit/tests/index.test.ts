import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import aiCommit, { getAiCommitSettingsPaths } from "../index";

describe("ai-commit extension", () => {
  it("exports an extension factory", () => {
    assert.equal(typeof aiCommit, "function");
  });

  it("registers the /commit command", () => {
    let registeredName = "";
    aiCommit({
      registerCommand(name: string) {
        registeredName = name;
      },
    } as never);

    assert.strictEqual(registeredName, "commit");
  });
});

describe("getAiCommitSettingsPaths", () => {
  it("uses pi's configured agent dir for the global settings path", () => {
    const cwd = "/tmp/project";
    assert.deepEqual(getAiCommitSettingsPaths(cwd), {
      globalPath: path.join(getAgentDir(), "settings.json"),
      projectPath: path.join(cwd, ".pi", "settings.json"),
    });
  });
});
