import * as fs from "node:fs";
import { parseDetailLevel, resolveDetailLevel } from "../detail-level";
import { getFormatAdapter } from "../obsidian";
import { buildInitPrompt } from "../prompt";
import { resolvePromptContext } from "../prompt-context";
import { DEFAULT_EXCLUDE } from "../prompt-types";
import { splitPatterns } from "../utils";
import type { WikiActionHandler, WikiOptions } from "./types";
import { getWikiFormatOption } from "./types";

export const initHandler: WikiActionHandler = {
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
    const format = getWikiFormatOption(options.format) ?? "standard";

    if (fs.existsSync(wikiDir) && fs.readdirSync(wikiDir).length > 0) {
      if (!options.force) {
        ctx.ui.notify(
          `Wiki directory "${output}" already exists. Use --force to overwrite, or /code-wiki update to refresh.`,
          "error",
        );
        return;
      }
      ctx.ui.notify(`Force-overwriting existing wiki at "${output}"`, "info");
    }

    const detailLevel = resolveDetailLevel({
      explicit: parseDetailLevel(options.detailLevel),
      settingsDefault: settings.defaultDetailLevel,
    });
    const effectiveOptions: WikiOptions = { ...options, detailLevel };

    getFormatAdapter(format).setup(wikiDir);

    ctx.ui.notify(`Generating codebase wiki into ${output} ...`, "info");
    const promptCtx = resolvePromptContext({
      repoRoot,
      targetDir,
      wikiDir,
      projectName: targetBasename,
      options: effectiveOptions,
      maxSize: settings.maxSize,
    });
    const prompt = buildInitPrompt(promptCtx);

    guard.activate({
      repoRoot,
      targetDir,
      wikiDir,
      allowWikiReads: false,
      excludePatterns: splitPatterns(
        typeof effectiveOptions.exclude === "string"
          ? effectiveOptions.exclude
          : DEFAULT_EXCLUDE,
      ),
    });
    pi.sendUserMessage(prompt);
  },
};
