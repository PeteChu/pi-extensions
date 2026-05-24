import * as path from "node:path";
import { readMetadata } from "../metadata";
import { buildQueryPrompt } from "../prompt";
import { resolvePromptContext } from "../prompt-context";
import { DEFAULT_EXCLUDE } from "../prompt-types";
import { splitPatterns } from "../utils";
import { WIKI_METADATA_FILE } from "../wiki-layout";
import type { WikiActionHandler } from "./types";

export const queryHandler: WikiActionHandler = {
  async handle({
    options,
    pi,
    ctx,
    repoRoot,
    targetDir,
    wikiDir,
    targetBasename,
    output,
    guard,
  }) {
    const question =
      typeof options.question === "string" ? options.question.trim() : "";

    const metadataPath = path.join(wikiDir, WIKI_METADATA_FILE);
    const existingMeta = readMetadata(metadataPath);
    const mergedOptions = existingMeta
      ? { ...existingMeta.options, ...options }
      : options;

    ctx.ui.notify(`Querying codebase wiki at ${output} ...`, "info");
    const promptCtx = resolvePromptContext({
      repoRoot,
      targetDir,
      wikiDir,
      projectName: targetBasename,
      options: mergedOptions,
      previousCommit: existingMeta?.gitCommit ?? undefined,
    });
    const prompt = buildQueryPrompt(promptCtx, question);

    guard.activate({
      repoRoot,
      targetDir,
      wikiDir,
      allowWikiReads: true,
      excludePatterns: splitPatterns(
        typeof mergedOptions.exclude === "string"
          ? mergedOptions.exclude
          : DEFAULT_EXCLUDE,
      ),
    });
    pi.sendUserMessage(prompt);
  },
};
