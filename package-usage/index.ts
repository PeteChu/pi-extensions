import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildReportDataset,
  buildRuntimeNameMap,
  discoverPackageResources,
  injectUsageStatsBootstrap,
} from "./utils";
import { UsageStatsStore } from "./store";
import {
  setupCommandTracking,
  setupSkillTracking,
  setupToolTracking,
} from "./tracker";

const COMMAND_NAME = "package-usage";
const RESET_CONFIRMATIONS = new Set(["yes", "--yes", "-y"]);
const REPORT_ASSET_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "assets",
  "package-usage-report.html",
);

function tryOpenBrowser(filePath: string, ctx: ExtensionCommandContext): void {
  const platform = process.platform;
  let command: string;

  if (platform === "darwin") {
    command = "open";
  } else if (platform === "win32") {
    command = "start";
  } else {
    command = "xdg-open";
  }

  try {
    execFileSync(command, [filePath], { timeout: 5000, stdio: "ignore" });
  } catch {
    ctx.ui.notify(`Report saved to ${filePath}`, "info");
  }
}

async function packageUsageHandler(
  args: string,
  ctx: ExtensionCommandContext,
  store: UsageStatsStore,
  pi?: Pick<ExtensionAPI, "getAllTools" | "getCommands">,
): Promise<void> {
  const [subcommand, confirmationWord = ""] = args
    .trim()
    .toLowerCase()
    .split(/\s+/);

  if (subcommand === "reset") {
    const hasExplicitConfirmation = RESET_CONFIRMATIONS.has(confirmationWord);

    if (ctx.hasUI && !hasExplicitConfirmation) {
      const confirmed = await ctx.ui.confirm(
        "Clear usage statistics?",
        "This will reset all usage counts for all packages. This action cannot be undone.",
      );
      if (!confirmed) {
        ctx.ui.notify("Reset cancelled", "info");
        return;
      }
    } else if (!ctx.hasUI && !hasExplicitConfirmation) {
      ctx.ui.notify(
        "Reset requires explicit confirmation. Use `/package-usage reset --yes` to confirm.",
        "warning",
      );
      return;
    }

    try {
      await store.reset();
      ctx.ui.notify("Usage statistics cleared", "info");
    } catch {
      ctx.ui.notify("No usage statistics to clear", "info");
    }
    return;
  }

  await store.ensureLoaded();
  await store.flushNow();

  const { packages } = await discoverPackageResources(ctx);
  const runtime = pi
    ? { tools: pi.getAllTools(), commands: pi.getCommands() }
    : undefined;
  const runtimeNameMap = runtime ? buildRuntimeNameMap(runtime) : undefined;
  const dataset = buildReportDataset(
    packages,
    store.getSnapshot(),
    7,
    runtimeNameMap,
    runtime,
  );
  const assetHtml = await fs.readFile(REPORT_ASSET_PATH, "utf-8");
  const html = injectUsageStatsBootstrap(assetHtml, dataset);

  const reportsDir = path.join(getAgentDir(), "package-usage");
  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, "package-usage-report.html");
  await fs.writeFile(reportPath, html, "utf-8");

  if (ctx.hasUI) {
    tryOpenBrowser(reportPath, ctx);
  } else {
    ctx.ui.notify(`Report saved to ${reportPath}`, "info");
  }
}

export default function (pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const store = new UsageStatsStore(agentDir);
  store.load().catch(() => {});

  setupToolTracking(pi, store);
  setupSkillTracking(pi, store);
  setupCommandTracking(pi, store);

  pi.on("session_shutdown", async () => {
    await store.flushNow();
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "View usage statistics for installed Pi packages",
    handler: async (args, ctx) => packageUsageHandler(args, ctx, store, pi),
  });
}
