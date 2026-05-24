import * as fs from "node:fs";
import * as path from "node:path";
import { readMetadata } from "../metadata";
import {
  WIKI_INDEX_FILE,
  WIKI_LOG_FILE,
  WIKI_METADATA_FILE,
  WIKI_SCHEMA_FILE,
} from "../wiki-layout";
import type { WikiInspector } from "./types";
import { getWikiFormatOption } from "./types";

const DEFAULT_OUTPUT = "docs/code-wiki";

export const doctorHandler: WikiInspector = {
  inspect({ options, ctx, repoRoot, targetDir, wikiDir }) {
    const checks: string[] = [];
    const wikiRel = path.relative(repoRoot, wikiDir) || DEFAULT_OUTPUT;

    checks.push(`✓ Git repo: ${repoRoot}`);

    if (targetDir !== repoRoot) {
      checks.push(`✓ Target directory: ${targetDir}`);
    }

    const requestedFormat = getWikiFormatOption(options.format);

    if (!fs.existsSync(wikiDir)) {
      checks.push(`- Wiki directory not yet created (run /code-wiki init)`);
      if (requestedFormat) {
        checks.push(`  requested format: ${requestedFormat}`);
      }
      ctx.ui.notify(checks.join("\n"), "info");
      return;
    }

    checks.push(`✓ Wiki directory: ${wikiRel}`);

    const logPath = path.join(wikiDir, WIKI_LOG_FILE);
    const metaPath = path.join(wikiDir, WIKI_METADATA_FILE);
    for (const fileName of [WIKI_INDEX_FILE, WIKI_SCHEMA_FILE, WIKI_LOG_FILE]) {
      const marker = fs.existsSync(path.join(wikiDir, fileName)) ? "✓" : "-";
      checks.push(`${marker} ${fileName}`);
    }

    if (fs.existsSync(metaPath)) {
      const meta = readMetadata(metaPath);
      const storedFormat =
        getWikiFormatOption(meta?.options?.format) ?? "standard";
      checks.push(`✓ ${WIKI_METADATA_FILE}`);
      checks.push(`  generated files: ${meta?.generatedFiles?.length ?? 0}`);
      checks.push(`  format: ${storedFormat}`);
      if (meta?.options?.target) {
        checks.push(`  target: ${meta.options.target}`);
      }
      if (requestedFormat && requestedFormat !== storedFormat) {
        checks.push(`  requested format: ${requestedFormat}`);
      }
      const lastUpdated = meta?.updatedAt ?? meta?.generatedAt ?? "unknown";
      checks.push(`  last generated: ${meta?.generatedAt ?? "unknown"}`);
      checks.push(`  last updated: ${lastUpdated}`);
      checks.push(`  last operation: ${meta?.lastOperation ?? "unknown"}`);
    } else {
      checks.push(`- ${WIKI_METADATA_FILE}`);
      if (requestedFormat) {
        checks.push(`  requested format: ${requestedFormat}`);
      }
      checks.push(`  markdown files found: ${countMarkdownFiles(wikiDir)}`);
    }

    const recentLogHeadings = readRecentLogHeadings(logPath, 5);
    if (recentLogHeadings.length > 0) {
      checks.push("Recent log entries:");
      checks.push(...recentLogHeadings.map((heading) => `  ${heading}`));
    }

    ctx.ui.notify(checks.join("\n"), "info");
  },
};

function countMarkdownFiles(dir: string): number {
  try {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countMarkdownFiles(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function readRecentLogHeadings(logPath: string, limit: number): string[] {
  try {
    const contents = fs.readFileSync(logPath, "utf-8");
    return contents
      .split("\n")
      .filter((line) => line.startsWith("## ["))
      .slice(-limit);
  } catch {
    return [];
  }
}
