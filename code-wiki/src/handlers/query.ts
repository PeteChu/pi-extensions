import * as path from "node:path";
import { readMetadata } from "../metadata";
import { buildQueryPrompt } from "../prompt";
import { resolvePromptContext } from "../prompt-context";
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
      excludePatterns: guard.parseExcludePatterns(
        typeof mergedOptions.exclude === "string"
          ? mergedOptions.exclude
          : undefined,
      ),
    });
    pi.sendUserMessage(prompt);
  },
};
