/**
 * Format adapter — isolates Obsidian-specific behaviour behind a common
 * interface so the orchestration layer and prompt composers don't branch
 * on format type.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  OBSIDIAN_VAULT_CONFIG,
  WIKI_ANSWERS_DIR,
  WIKI_FORMATS,
  WIKI_INDEX_FILE,
  WIKI_SCHEMA_FILE,
  type WikiFormat,
} from "./wiki-layout";

export type WikiFormatAdapter = {
  /** Filesystem setup (called once on init). */
  setup(wikiDir: string): void;
  /** Markdown formatting conventions for prompt instructions. */
  getPromptRules(generatedDate: string): string;
};

export function getFormatAdapter(format: WikiFormat): WikiFormatAdapter {
  if (!WIKI_FORMATS.includes(format)) {
    return standardFormat;
  }
  return format === "obsidian" ? obsidianFormat : standardFormat;
}

// ── Standard format (no-op adapter) ──────────────────────────────────────

const standardFormat: WikiFormatAdapter = {
  setup(): void {
    // no-op
  },
  getPromptRules(): string {
    return "";
  },
};

// ── Obsidian format ──────────────────────────────────────────────────────

const obsidianFormat: WikiFormatAdapter = {
  setup(wikiDir: string): void {
    const obsidianConfigDir = path.join(wikiDir, OBSIDIAN_VAULT_CONFIG);
    const appConfigPath = path.join(obsidianConfigDir, "app.json");
    fs.mkdirSync(obsidianConfigDir, { recursive: true });
    if (!fs.existsSync(appConfigPath)) {
      fs.writeFileSync(appConfigPath, `${JSON.stringify({}, null, 2)}\n`);
    }

    // Ignore .obsidian/ — its contents are device-specific workspace settings
    // (open files, window layout, plugin state) that should not be committed.
    const gitignorePath = path.join(wikiDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, ".obsidian/\n");
    }
  },

  getPromptRules(generatedDate: string): string {
    return `

### Obsidian Flavored Markdown Conventions

You are writing for an Obsidian vault. Follow these rules for every generated, updated, or newly filed wiki page.

**Links**

- Use [[wikilinks]] for internal wiki links: \`[[01_auth_flow]]\` not \`[Auth Flow](./01_auth_flow.md)\`.
- Use custom display text when helpful: \`[[01_auth_flow|Authentication Flow]]\`.
- Link answer pages as \`[[answers/${generatedDate}-model-selection|Model selection answer]]\`.
- Embed related notes only when useful: \`![[01_database_schema]]\`.
- For important anchored details, add a stable block ID like \`^implementation-details\` and link it as \`[[01_auth_flow#^implementation-details]]\`.
- Standard Markdown links are still OK for external URLs and absolute source paths.
- Do not use \`[text](url)\` for internal wiki links — always use \`[[page]]\` or \`[[page|display text]]\`.

**Frontmatter**

- Every Markdown page starts with YAML frontmatter between \`---\` fences, followed by exactly one H1.
- Use date-only values like \`${generatedDate}\` for \`created\` and \`updated\`; do not use full ISO timestamps in frontmatter.
- Index pages use: \`title\`, \`type: index\`, \`tags\`, \`created\`, \`updated\`.
- Chapter/concept pages use: \`title\`, \`type: chapter\`, \`aliases\`, \`tags\`, \`created\`, \`updated\`, \`related\`.
- Answer pages use: \`title\`, \`type: answer\`, \`aliases\`, \`tags\`, \`created\`, \`updated\`, \`related\`, and \`question: "original query"\`.
- Log pages use: \`title\`, \`type: log\`; schema pages use: \`title\`, \`type: schema\`.
- Keep \`related\` entries as wikilinks, for example \`related: ["[[01_auth_flow]]", "[[02_request_pipeline]]"]\`.

**Callouts**

- Use Obsidian callouts for key explanations, warnings, summaries, and tips.
- Supported callouts include \`> [!note]\`, \`> [!warning]\`, \`> [!tip]\`, \`> [!info]\`, \`> [!question]\`, \`> [!danger]\`, \`> [!success]\`, \`> [!abstract]\`, \`> [!example]\`, and \`> [!quote]\`.
- Foldable sections are allowed: \`> [!note]- Collapsed Section\`.

**Tags**

- Include inline #tags in body text, especially in index summaries, chapter summaries, and answer pages.
- Use kebab-case tags such as \`#request-pipeline\`, \`#model-selection\`, and \`#architecture\`.

**Answer filing**

- Answer pages under \`${WIKI_ANSWERS_DIR}/\` must use Obsidian frontmatter, wikilinks to related pages, callouts for durable takeaways, and #tags.
- Link filed answers from \`${WIKI_INDEX_FILE}\` with wikilinks, not relative Markdown links.

**Schema conventions**

- When writing or updating \`${WIKI_SCHEMA_FILE}\`, record that this wiki uses Obsidian Flavored Markdown.
- The schema should instruct future maintainers to preserve frontmatter, wikilinks, callouts, #tags, and answer-page conventions.
- Internal maintenance links in the schema should also use wikilinks where possible.`;
  },
};
