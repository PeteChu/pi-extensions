import * as path from "node:path";
import { readMetadata } from "../metadata";
import { buildUpdatePrompt } from "../prompt";
import { resolvePromptContext } from "../prompt-context";
import { DEFAULT_EXCLUDE } from "../prompt-types";
import { splitPatterns } from "../utils";
import { WIKI_METADATA_FILE } from "../wiki-layout";
import type { WikiActionHandler } from "./types";

export const updateHandler: WikiActionHandler = {
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
    const metadataPath = path.join(wikiDir, WIKI_METADATA_FILE);
    const existingMeta = readMetadata(metadataPath);
    const mergedOptions = existingMeta
      ? { ...existingMeta.options, ...options }
      : options;

    ctx.ui.notify(`Incrementally updating wiki at ${output} ...`, "info");
    const promptCtx = resolvePromptContext({
      repoRoot,
      targetDir,
      wikiDir,
      projectName: targetBasename,
      options: mergedOptions,
      previousCommit: existingMeta?.gitCommit ?? undefined,
    });
    const prompt = buildUpdatePrompt(promptCtx);

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
