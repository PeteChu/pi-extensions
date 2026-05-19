import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAnswerSettingsPaths } from "../index";

describe("getAnswerSettingsPaths", () => {
  it("uses pi's configured agent dir for the global settings path", () => {
    const cwd = "/tmp/project";
    assert.deepEqual(getAnswerSettingsPaths(cwd), {
      globalPath: path.join(getAgentDir(), "settings.json"),
      projectPath: path.join(cwd, ".pi", "settings.json"),
    });
  });
});
