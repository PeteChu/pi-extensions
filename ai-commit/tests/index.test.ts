import { getAgentDir } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import aiCommit, {
  getAiCommitSettingsPaths,
  reviewCommitMessage,
  selectGenerationModel,
} from "../index";

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

describe("selectGenerationModel", () => {
  it("looks up a suffixed preference by its base model ID", async () => {
    const currentModel = createModel("current");
    const configuredModel = createModel("gpt-5.6-luna");
    const lookups: Array<[string, string]> = [];

    const result = await selectGenerationModel(
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

  it("advances to the next preference when authentication fails", async () => {
    const currentModel = createModel("current");
    const firstModel = createModel("first");
    const secondModel = createModel("second");
    const authenticated: string[] = [];

    const result = await selectGenerationModel(
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
        { provider: "provider-b", id: "second:minimal" },
      ],
    );

    assert.deepEqual(authenticated, ["first", "second"]);
    assert.strictEqual(result.model, secondModel);
    assert.strictEqual(result.thinkingLevel, "minimal");
  });

  it("uses unsuffixed preferences without a reasoning override", async () => {
    const currentModel = createModel("current");
    const configuredModel = createModel("gpt-5.6-luna");
    const lookups: Array<[string, string]> = [];

    const result = await selectGenerationModel(
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
      [{ provider: "openai-codex", id: "gpt-5.6-luna" }],
    );

    assert.deepEqual(lookups, [["openai-codex", "gpt-5.6-luna"]]);
    assert.deepEqual(result, { model: configuredModel });
  });

  it("falls back to the current model when no suffixed model is usable", async () => {
    const currentModel = createModel("current");

    const result = await selectGenerationModel(
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

describe("reviewCommitMessage", () => {
  it("commits the generated message when accepted", async () => {
    const { ctx } = createReviewContext({ choices: ["Commit"] });

    const result = await reviewCommitMessage(ctx as never, "feat: add thing");

    assert.deepEqual(result, { action: "commit", message: "feat: add thing" });
  });

  it("lets the user edit before committing", async () => {
    const generated = "feat(ai-commit): generate message";
    const edited =
      "fix(ai-commit): allow editing generated message\n\nPreserve an optional body.\n";
    const { ctx, editorInitialValues, selectPrompts } = createReviewContext({
      choices: ["Edit", "Commit"],
      edited,
    });

    const result = await reviewCommitMessage(ctx as never, generated);

    assert.deepEqual(result, {
      action: "commit",
      message:
        "fix(ai-commit): allow editing generated message\n\nPreserve an optional body.",
    });
    assert.deepEqual(editorInitialValues, [generated]);
    assert.match(
      selectPrompts.at(-1) ?? "",
      /fix\(ai-commit\): allow editing generated message/,
    );
  });

  it("returns regenerate when requested", async () => {
    const { ctx } = createReviewContext({ choices: ["Regenerate"] });

    const result = await reviewCommitMessage(ctx as never, "feat: add thing");

    assert.deepEqual(result, { action: "regenerate" });
  });

  it("cancels when editing is aborted", async () => {
    const { ctx } = createReviewContext({
      choices: ["Edit"],
      edited: undefined,
    });

    const result = await reviewCommitMessage(ctx as never, "feat: add thing");

    assert.deepEqual(result, { action: "cancel" });
  });
});

function createModel(id: string) {
  return { id, provider: "test-provider" };
}

function createReviewContext({
  choices,
  edited,
}: {
  choices: Array<string | undefined>;
  edited?: string;
}) {
  const selectPrompts: string[] = [];
  const editorInitialValues: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];

  return {
    selectPrompts,
    editorInitialValues,
    notifications,
    ctx: {
      ui: {
        select: async (prompt: string) => {
          selectPrompts.push(prompt);
          return choices.shift();
        },
        editor: async (_title: string, initialValue: string) => {
          editorInitialValues.push(initialValue);
          return edited;
        },
        notify: (message: string, level: string) => {
          notifications.push({ message, level });
        },
      },
    },
  };
}
