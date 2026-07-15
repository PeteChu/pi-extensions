import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAnswerSettingsPaths, selectExtractionModel } from "../index";

describe("getAnswerSettingsPaths", () => {
  it("uses pi's configured agent dir for the global settings path", () => {
    const cwd = "/tmp/project";
    assert.deepEqual(getAnswerSettingsPaths(cwd), {
      globalPath: path.join(getAgentDir(), "settings.json"),
      projectPath: path.join(cwd, ".pi", "settings.json"),
    });
  });
});

describe("selectExtractionModel", () => {
  it("looks up a suffixed preference by its base model ID", async () => {
    const currentModel = createModel("current");
    const configuredModel = createModel("gpt-5.6-luna");
    const lookups: Array<[string, string]> = [];

    const result = await selectExtractionModel(
      currentModel as never,
      {
        find(provider, modelId) {
          lookups.push([provider, modelId]);
          return modelId === configuredModel.id
            ? (configuredModel as never)
            : undefined;
        },
        getApiKeyAndHeaders: async () => ({ ok: true }),
      },
      [{ provider: "openai-codex", id: "gpt-5.6-luna:low" }],
    );

    assert.deepEqual(lookups, [["openai-codex", "gpt-5.6-luna"]]);
    assert.strictEqual(result.model, configuredModel);
    assert.strictEqual(result.thinkingLevel, "low");
  });

  it("preserves unsuffixed and legacy colon-containing model IDs", async () => {
    const currentModel = createModel("current");
    const configuredModel = createModel("legacy:model");
    const lookups: Array<[string, string]> = [];

    const result = await selectExtractionModel(
      currentModel as never,
      {
        find(provider, modelId) {
          lookups.push([provider, modelId]);
          return modelId === configuredModel.id
            ? (configuredModel as never)
            : undefined;
        },
        getApiKeyAndHeaders: async () => ({ ok: true }),
      },
      [{ provider: "legacy-provider", id: "legacy:model" }],
    );

    assert.deepEqual(lookups, [["legacy-provider", "legacy:model"]]);
    assert.deepEqual(result, { model: configuredModel });
  });

  it("advances to the next preference when authentication fails", async () => {
    const currentModel = createModel("current");
    const firstModel = createModel("first");
    const secondModel = createModel("second");
    const authenticated: string[] = [];

    const result = await selectExtractionModel(
      currentModel as never,
      {
        find(_provider, modelId) {
          if (modelId === firstModel.id) return firstModel as never;
          if (modelId === secondModel.id) return secondModel as never;
          return undefined;
        },
        getApiKeyAndHeaders: async (model) => {
          authenticated.push(model.id);
          return { ok: model.id === secondModel.id };
        },
      },
      [
        { provider: "provider-a", id: "first:high" },
        { provider: "provider-b", id: "second" },
      ],
    );

    assert.deepEqual(authenticated, ["first", "second"]);
    assert.deepEqual(result, { model: secondModel });
  });

  it("falls back to the current model when no preference is usable", async () => {
    const currentModel = createModel("current");

    const result = await selectExtractionModel(
      currentModel as never,
      {
        find: () => undefined,
        getApiKeyAndHeaders: async () => ({ ok: true }),
      },
      [{ provider: "openai-codex", id: "missing:medium" }],
    );

    assert.deepEqual(result, { model: currentModel });
  });
});

function createModel(id: string) {
  return { id, provider: "test-provider" };
}
