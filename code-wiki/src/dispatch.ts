import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatDetailLevels,
  parseExplicitDetailLevelOption,
} from "./detail-level";
import { doctorHandler } from "./handlers/doctor";
import { initHandler } from "./handlers/init";
import { queryHandler } from "./handlers/query";
import type {
  WikiAction,
  WikiActionHandler,
  WikiActionHandlerContext,
  WikiOptions,
} from "./handlers/types";
import { updateHandler } from "./handlers/update";
import type { ReadGuard } from "./read-guard";
import { getRepoRoot, isPathInsideRepo } from "./repo";
import { loadCodeWikiSettings, selectGenerationModel } from "./settings";

// ── Handler registry ──────────────────────────────────────────────────────

const handlers: Record<Exclude<WikiAction, "doctor">, WikiActionHandler> = {
  init: initHandler,
  update: updateHandler,
  query: queryHandler,
};

const DEFAULT_OUTPUT = "docs/code-wiki";

// ── Path resolution ───────────────────────────────────────────────────────

interface ValidatedPaths {
  repoRoot: string;
  targetDir: string;
  wikiDir: string;
  targetBasename: string;
  output: string;
}

function resolvePaths(
  options: WikiOptions,
  ctx: ExtensionContext,
): ValidatedPaths | null {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    ctx.ui.notify("Not inside a Git repository", "error");
    return null;
  }

  const targetOption =
    typeof options.target === "string" && options.target ? options.target : "";
  let targetDir: string;
  let targetBasename: string;
  if (targetOption) {
    targetDir = path.resolve(repoRoot, targetOption);
    if (!isPathInsideRepo(targetDir, repoRoot)) {
      ctx.ui.notify(
        `Target directory "${targetOption}" resolves outside the Git repository root`,
        "error",
      );
      return null;
    }
    if (!fs.existsSync(targetDir)) {
      ctx.ui.notify(
        `Target directory "${targetOption}" does not exist`,
        "error",
      );
      return null;
    }
    targetBasename = path.basename(targetDir);
  } else {
    targetDir = repoRoot;
    targetBasename = path.basename(repoRoot);
  }

  let output: string;
  if (typeof options.output === "string" && options.output) {
    output = options.output;
  } else if (targetOption) {
    output = `docs/code-wiki/${targetBasename}`;
  } else {
    output = DEFAULT_OUTPUT;
  }
  const wikiDir = path.resolve(repoRoot, output);

  if (!isPathInsideRepo(wikiDir, repoRoot)) {
    ctx.ui.notify(
      `Output directory "${output}" resolves outside the Git repository root`,
      "error",
    );
    return null;
  }

  return { repoRoot, targetDir, wikiDir, targetBasename, output };
}

// ── Dispatcher ────────────────────────────────────────────────────────────

export async function dispatch(
  action: WikiAction,
  options: WikiOptions,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  guard: ReadGuard,
): Promise<void> {
  const paths = resolvePaths(options, ctx);
  if (!paths) return;

  const { repoRoot, targetDir, wikiDir, targetBasename, output } = paths;

  const explicitDetailLevel = parseExplicitDetailLevelOption(options);
  if (!explicitDetailLevel.ok) {
    ctx.ui.notify(
      `Invalid --detail-level "${explicitDetailLevel.raw}". Use: ${formatDetailLevels()}.`,
      "error",
    );
    return;
  }

  if (explicitDetailLevel.value) {
    options = { ...options, detailLevel: explicitDetailLevel.value };
  }

  // Doctor: no model, no settings, no guard — just inspect and notify.
  if (action === "doctor") {
    doctorHandler.inspect({
      options,
      ctx,
      repoRoot,
      targetDir,
      wikiDir,
      output,
    });
    return;
  }

  // Query pre-condition: a question is required.
  if (action === "query") {
    const question =
      typeof options.question === "string" ? options.question.trim() : "";
    if (!question) {
      ctx.ui.notify(
        'Usage: /code-wiki query --question="..." or /code-wiki query "..."',
        "error",
      );
      return;
    }
  }

  // Init / update / query require a model.
  if (!ctx.model) {
    ctx.ui.notify("No model selected", "error");
    return;
  }

  const settings = await loadCodeWikiSettings(ctx);

  const modelSelection = await selectGenerationModel(
    ctx.model,
    ctx.modelRegistry,
    settings.generationModels,
    (model) => pi.setModel(model),
  );

  if (modelSelection.failedSwitches.length > 0) {
    const failedModels = modelSelection.failedSwitches
      .map(({ provider, id }) => `${provider}/${id}`)
      .join(", ");
    ctx.ui.notify(
      modelSelection.switched
        ? `Could not switch to ${failedModels}; using ${modelSelection.model.provider}/${modelSelection.model.id} for wiki generation`
        : `Could not switch to ${failedModels}; continuing with ${modelSelection.model.provider}/${modelSelection.model.id}`,
      "warning",
    );
  }

  if (modelSelection.switched) {
    ctx.ui.notify(
      `Switched to ${modelSelection.model.provider}/${modelSelection.model.id} for wiki generation`,
      "info",
    );
  }

  const handlerCtx: WikiActionHandlerContext = {
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
  };

  await handlers[action].handle(handlerCtx);
}
