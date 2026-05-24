import * as path from "node:path";
import { parseDetailLevel, resolveDetailLevel } from "../detail-level";
import { readMetadata } from "../metadata";
import { buildUpdatePrompt } from "../prompt";
import { resolvePromptContext } from "../prompt-context";
import { DEFAULT_EXCLUDE } from "../prompt-types";
import { splitPatterns } from "../utils";
import { WIKI_METADATA_FILE } from "../wiki-layout";
import type { WikiActionHandler, WikiOptions } from "./types";

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
    settings,
  }) {
    const metadataPath = path.join(wikiDir, WIKI_METADATA_FILE);
    const existingMeta = readMetadata(metadataPath);
    const existingOptions = existingMeta ? (existingMeta.options ?? {}) : null;
    const detailLevel = resolveDetailLevel({
      explicit: parseDetailLevel(options.detailLevel),
      existingMetadataOptions: existingOptions,
      settingsDefault: settings.defaultDetailLevel,
      warn: (message) => ctx.ui.notify(message, "warning"),
    });
    const mergedOptions: WikiOptions = existingMeta
      ? { ...existingOptions, ...options, detailLevel }
      : { ...options, detailLevel };

    ctx.ui.notify(`Incrementally updating wiki at ${output} ...`, "info");
    const promptCtx = resolvePromptContext({
      repoRoot,
      targetDir,
      wikiDir,
      projectName: targetBasename,
      options: mergedOptions,
      maxSize: settings.maxSize,
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
