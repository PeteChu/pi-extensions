import {
  completeSimple,
  type Api,
  type Model,
  type ModelThinkingLevel,
  type UserMessage,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_GENERATION_MODELS,
  applyNumstatToMetadata,
  buildGenerationPrompt,
  cleanupCommitMessage,
  isNoisyFilePath,
  mergeAiCommitSettings,
  parseModelThinkingSuffix,
  parseNameStatusZ,
  parseNumstatZ,
  prepareStagedDiffs,
  type AiCommitSettings,
  type ModelPreference,
  type PreparedStagedFile,
  type ResolvedAiCommitSettings,
  type StagedFileMetadata,
} from "./utils";

enum UserChoice {
  Commit = "Commit",
  Edit = "Edit",
  Regenerate = "Regenerate",
  Cancel = "Cancel",
}

export type CommitMessageReviewResult =
  | { action: "commit"; message: string }
  | { action: "regenerate" }
  | { action: "cancel" };

export interface GenerationModelSelection {
  model: Model<Api>;
  thinkingLevel?: ModelThinkingLevel;
}

export async function selectGenerationModel(
  currentModel: Model<Api>,
  modelRegistry: {
    find: (provider: string, modelId: string) => Model<Api> | undefined;
    getApiKeyAndHeaders: (model: Model<Api>) => Promise<{
      ok: boolean;
      apiKey?: string;
      headers?: Record<string, string>;
    }>;
  },
  modelPreferences: ModelPreference[],
): Promise<GenerationModelSelection> {
  for (const preference of modelPreferences) {
    const parsed = parseModelThinkingSuffix(preference.id);
    const model = modelRegistry.find(
      preference.provider,
      parsed?.modelId ?? preference.id,
    );
    if (!model) {
      continue;
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok) {
      return {
        model,
        ...(parsed ? { thinkingLevel: parsed.thinkingLevel } : {}),
      };
    }
  }

  return { model: currentModel };
}

async function readSettingsFile(
  filePath: string,
  ctx: ExtensionContext,
): Promise<Record<string, unknown> | null> {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(
        `Failed to read ${filePath}: ${err.message ?? "unknown error"}`,
        "warning",
      );
    }
    return null;
  }
}

export function getAiCommitSettingsPaths(cwd: string): {
  globalPath: string;
  projectPath: string;
} {
  return {
    globalPath: path.join(getAgentDir(), "settings.json"),
    projectPath: path.join(cwd, ".pi", "settings.json"),
  };
}

async function loadAiCommitSettings(
  ctx: ExtensionContext,
): Promise<ResolvedAiCommitSettings> {
  const { globalPath, projectPath } = getAiCommitSettingsPaths(ctx.cwd);

  const [globalSettings, projectSettings] = await Promise.all([
    readSettingsFile(globalPath, ctx),
    readSettingsFile(projectPath, ctx),
  ]);

  return mergeAiCommitSettings(
    (globalSettings?.aiCommit as AiCommitSettings | undefined) ?? undefined,
    (projectSettings?.aiCommit as AiCommitSettings | undefined) ?? undefined,
  );
}

async function getGitRoot(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<string | null> {
  const root = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd: ctx.cwd,
  });
  if (root.code !== 0) {
    ctx.ui.notify(root.stderr.trim() || "Not inside a git repository", "error");
    return null;
  }

  return root.stdout.trim();
}

async function getStagedFiles(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  gitRoot: string,
): Promise<StagedFileMetadata[] | null> {
  const nameStatus = await pi.exec(
    "git",
    ["diff", "--cached", "--name-status", "-z"],
    { cwd: gitRoot },
  );
  if (nameStatus.code !== 0) {
    ctx.ui.notify(
      `Failed to inspect staged files: ${nameStatus.stderr.trim() || "unknown git error"}`,
      "error",
    );
    return null;
  }

  const files = parseNameStatusZ(nameStatus.stdout);
  if (files.length === 0) {
    return [];
  }

  const numstat = await pi.exec(
    "git",
    ["diff", "--cached", "--numstat", "-z"],
    { cwd: gitRoot },
  );
  if (numstat.code !== 0) {
    return files;
  }

  return applyNumstatToMetadata(files, parseNumstatZ(numstat.stdout));
}

async function gatherStagedDiffContext(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  settings: ResolvedAiCommitSettings,
  gitRoot: string,
): Promise<PreparedStagedFile[] | null> {
  const files = await getStagedFiles(pi, ctx, gitRoot);
  if (files === null) {
    return null;
  }

  if (files.length === 0) {
    return [];
  }

  const filesWithDiff = await Promise.all(
    files.map(async (file) => {
      if (file.binary || isNoisyFilePath(file.path, settings.skipPatterns)) {
        return file;
      }

      const diff = await pi.exec("git", ["diff", "--cached", "--", file.path], {
        cwd: gitRoot,
      });

      return {
        ...file,
        diff: diff.code === 0 ? diff.stdout : "",
      };
    }),
  );

  return prepareStagedDiffs(filesWithDiff, settings);
}

async function generateCommitMessage(
  ctx: ExtensionCommandContext,
  settings: ResolvedAiCommitSettings,
  generationModel: GenerationModelSelection,
  prompt: string,
): Promise<string | null> {
  return await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(
      tui,
      theme,
      `Generating commit message using ${generationModel.model.id}${generationModel.thinkingLevel ? `:${generationModel.thinkingLevel}` : ""}...`,
    );
    loader.onAbort = () => done(null);

    const doGenerate = async () => {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(
        generationModel.model,
      );
      if (!auth.ok) {
        throw new Error(auth.error);
      }

      const userMessage: UserMessage = {
        role: "user",
        content: [{ type: "text", text: prompt }],
        timestamp: Date.now(),
      };

      const reasoning =
        generationModel.thinkingLevel === undefined ||
        generationModel.thinkingLevel === "off"
          ? {}
          : { reasoning: generationModel.thinkingLevel };
      const response = await completeSimple(
        generationModel.model,
        {
          systemPrompt: settings.systemPrompt,
          messages: [userMessage],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          signal: loader.signal,
          ...reasoning,
        },
      );

      if (response.stopReason === "aborted") {
        return null;
      }

      const responseText = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return cleanupCommitMessage(responseText);
    };

    doGenerate()
      .then(done)
      .catch(() => done(null));

    return loader;
  });
}

export async function reviewCommitMessage(
  ctx: Pick<ExtensionCommandContext, "ui">,
  generatedMessage: string,
): Promise<CommitMessageReviewResult> {
  let message = generatedMessage;

  while (true) {
    const choice = await ctx.ui.select(
      `Use this commit message?\n\n${message}`,
      [
        UserChoice.Commit,
        UserChoice.Edit,
        UserChoice.Regenerate,
        UserChoice.Cancel,
      ],
    );

    if (!choice || choice === UserChoice.Cancel) {
      return { action: "cancel" };
    }

    if (choice === UserChoice.Regenerate) {
      return { action: "regenerate" };
    }

    if (choice === UserChoice.Edit) {
      const edited = await ctx.ui.editor("Edit commit message", message);
      if (edited === undefined) {
        return { action: "cancel" };
      }

      const editedMessage = edited.trim();
      if (!editedMessage) {
        ctx.ui.notify("Commit message cannot be empty", "warning");
        continue;
      }

      message = editedMessage;
      continue;
    }

    return { action: "commit", message };
  }
}

async function aiCommitHandler(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  await ctx.waitForIdle();

  if (!ctx.hasUI) {
    ctx.ui.notify("/commit requires interactive mode", "error");
    return;
  }

  if (!ctx.model) {
    ctx.ui.notify("No model selected", "error");
    return;
  }

  const gitRoot = await getGitRoot(pi, ctx);
  if (!gitRoot) {
    return;
  }

  const settings = await loadAiCommitSettings(ctx);
  const files = await gatherStagedDiffContext(pi, ctx, settings, gitRoot);
  if (files === null) {
    return;
  }

  if (files.length === 0) {
    ctx.ui.notify("No staged changes found", "info");
    return;
  }

  const includedCount = files.filter((file) => file.included).length;
  if (includedCount === 0) {
    ctx.ui.notify(
      "All staged files were skipped; generating from staged file names only",
      "warning",
    );
  }

  const generationModel = await selectGenerationModel(
    ctx.model,
    ctx.modelRegistry,
    settings.generationModels ?? DEFAULT_GENERATION_MODELS,
  );

  const prompt = buildGenerationPrompt(files);

  while (true) {
    const message = await generateCommitMessage(
      ctx,
      settings,
      generationModel,
      prompt,
    );

    if (!message) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    const review = await reviewCommitMessage(ctx, message);
    if (review.action === "cancel") {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    if (review.action === "regenerate") {
      continue;
    }

    const commit = await pi.exec("git", ["commit", "-m", review.message], {
      cwd: gitRoot,
    });
    if (commit.code === 0) {
      ctx.ui.notify(`Committed: ${review.message}`, "info");
      return;
    }

    ctx.ui.notify(
      `git commit failed: ${commit.stderr.trim() || commit.stdout.trim() || "unknown error"}`,
      "error",
    );
    return;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("commit", {
    description:
      "Generate and commit a Conventional Commit message from staged changes",
    handler: async (_args, ctx) => aiCommitHandler(pi, ctx),
  });
}
