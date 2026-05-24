import * as fs from "node:fs";
import { getFormatAdapter } from "../obsidian";
import { buildInitPrompt } from "../prompt";
import { resolvePromptContext } from "../prompt-context";
import type { WikiActionHandler } from "./types";
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

    getFormatAdapter(format).setup(wikiDir);

    ctx.ui.notify(`Generating codebase wiki into ${output} ...`, "info");
    const promptCtx = resolvePromptContext({
      repoRoot,
      targetDir,
      wikiDir,
      projectName: targetBasename,
      options,
    });
    const prompt = buildInitPrompt(promptCtx);

    guard.activate({
      repoRoot,
      targetDir,
      wikiDir,
      allowWikiReads: false,
      excludePatterns: guard.parseExcludePatterns(
        typeof options.exclude === "string" ? options.exclude : undefined,
      ),
    });
    pi.sendUserMessage(prompt);
  },
};
