/**
 * Prompt builders for maintaining a persistent, LLM-owned codebase wiki.
 *
 * The init prompt still uses the beginner-friendly PocketFlow-style tutorial
 * flow, while update/query prompts treat the wiki as a durable artifact that is
 * incrementally maintained over time.
 */

import * as path from "node:path";
import { crawlFiles } from "./crawler";
import { getChangedFilesSince, getCurrentCommit } from "./repo";
import {
  GENERATED_CONTENT_FILES,
  WIKI_ANSWERS_DIR,
  WIKI_FORMATS,
  WIKI_INDEX_FILE,
  WIKI_LOG_FILE,
  WIKI_METADATA_FILE,
  WIKI_SCHEMA_FILE,
  type WikiFormat,
} from "./wiki-layout";

export interface PromptConfig {
  repoRoot: string;
  wikiDir: string;
  projectName: string;
  options: Record<string, string | boolean | undefined>;
  isUpdate?: boolean;
  previousCommit?: string;
}

export interface QueryPromptConfig extends PromptConfig {
  question: string;
}

interface PromptContext {
  repoRoot: string;
  wikiDir: string;
  wikiRel: string;
  projectName: string;
  language: string;
  format: WikiFormat;
  maxSize: number;
  includePatterns: string[];
  excludePatterns: string[];
  fileListStr: string;
  changedFileListStr: string;
  commit: string | null;
  generatedAt: string;
  generatedDate: string;
  metadataJson: string;
}

const DEFAULT_INCLUDE = [
  "*.py",
  "*.js",
  "*.jsx",
  "*.ts",
  "*.tsx",
  "*.go",
  "*.java",
  "*.pyi",
  "*.pyx",
  "*.c",
  "*.cc",
  "*.cpp",
  "*.h",
  "*.md",
  "*.rst",
  "*Dockerfile",
  "*Makefile",
  "*.yaml",
  "*.yml",
].join(",");

const DEFAULT_EXCLUDE = [
  "assets/*",
  "data/*",
  "images/*",
  "public/*",
  "static/*",
  "temp/*",
  "*docs/code-wiki/*",
  "*.code-wiki/*",
  "*docs/*",
  "*venv/*",
  "*.venv/*",
  "*test*",
  "*tests/*",
  "*examples/*",
  "v1/*",
  "*dist/*",
  "*build/*",
  "*experimental/*",
  "*deprecated/*",
  "*misc/*",
  "*legacy/*",
  ".git/*",
  ".github/*",
  ".next/*",
  ".vscode/*",
  "*obj/*",
  "*bin/*",
  "*node_modules/*",
  "*.log",
].join(",");

/** Backwards-compatible wrapper for older callers. */
export function buildWikiPrompt(config: PromptConfig): string {
  return config.isUpdate ? buildUpdatePrompt(config) : buildInitPrompt(config);
}

export function buildInitPrompt(config: PromptConfig): string {
  const ctx = buildPromptContext(config, "init");
  const shouldTranslate = ctx.language !== "english";
  const languageNote = shouldTranslate
    ? `write ALL content (names, descriptions, chapter text, schema prose, and log text) in ${ctx.language}. Only fixed filenames and JSON keys stay in English.`
    : "";
  const translatedNameInstruction = shouldTranslate
    ? ` in ${ctx.language}`
    : "";
  const chapterLanguageInstruction = shouldTranslate
    ? `- Write ALL chapter content in ${ctx.language}`
    : "";
  const indexLanguage = shouldTranslate ? ctx.language : "English";

  return `## Task: Initialize a Persistent Codebase Wiki

You will analyze the **${ctx.projectName}** codebase and generate a durable, LLM-maintained wiki in \`${ctx.wikiRel}/\`. Follow the workflow below. Write ALL output files using the write tool.

This is not a disposable one-shot answer: create a wiki that future update and query runs can maintain incrementally.

${commonConfiguration(ctx)}
${languageNote ? `\nLanguage note: ${languageNote}` : ""}

---

### Step 1 — Survey the File Map

I have already crawled the repository. Below is the complete source file listing (index + relative path). Files matching include/exclude patterns and within the size limit are shown. Use the \`read\` tool to inspect files you need.

\`\`\`
${ctx.fileListStr}
\`\`\`

Quickly scan a representative sample of files across different directories to understand the project structure. Focus on files that define core logic, key abstractions, public APIs, command/tool registration, configuration, and data flow.

---

### Step 2 — Identify Core Abstractions

Read the most important files and identify the core abstractions (classes, modules, concepts, patterns) that form the backbone of the codebase.

For each abstraction, note:
- **Name**: A short, descriptive name${translatedNameInstruction}
- **Description**: A 2-3 sentence beginner-friendly explanation${translatedNameInstruction}
- **Key files**: The file indices (from the listing above) where this abstraction lives

Keep this structured list in your working memory for the next steps.

---

### Step 3 — Analyze Relationships

For the abstractions you identified, determine how they relate to each other:
- Which abstractions depend on or use others?
- What data or control flows between them?
- Are there parent-child, producer-consumer, or plugin relationships?

Also write a **high-level project summary** (3-5 sentences)${translatedNameInstruction} describing what the project does.

---

### Step 4 — Order the Chapters

Determine the best order to present the abstractions. Put foundational concepts first, then build up to higher-level ones. Consider dependencies: if A depends on B, explain B first.

---

### Step 5 — Write Beginner-Friendly Chapter Pages

For each abstraction, write a detailed, beginner-friendly chapter as a Markdown file in \`${ctx.wikiRel}/\`.

**Each chapter file should:**
- Start with a clear heading: \`# Chapter N: Abstraction Name\`
- Explain what the abstraction does, using analogies where helpful
- Show how it fits into the bigger picture
- Include relevant code snippets from actual source files, with file-path citations such as \`src/foo.ts\`
- Explain the snippets in plain language
- Link to related wiki pages using relative Markdown links
- End with a brief summary

**Writing style:**
- Write for someone who is NEW to this codebase
- Use analogies and concrete examples
- Avoid jargon without explanation
- Keep pages self-contained but connected
${chapterLanguageInstruction}

---

### Step 6 — Write Persistent Wiki Control Files

Write these durable files in \`${ctx.wikiRel}/\`:

#### \`${WIKI_INDEX_FILE}\`

The index is content-oriented. It must include:
- Project title and high-level project summary
- Source repository link: \`[local](${ctx.repoRoot})\`
- Mermaid \`flowchart TD\` relationship diagram
- A categorized catalog of every generated wiki page with one-line summaries
- A section for query answer pages under \`${WIKI_ANSWERS_DIR}/\` (initially empty)
- Maintenance links to \`${WIKI_SCHEMA_FILE}\` and \`${WIKI_LOG_FILE}\`

Use ${indexLanguage} for abstraction names, summaries, labels, and chapter links. Sanitize page filenames: lowercase and replace non-alphanumeric characters with underscores. Chapter filenames should be \`01_name.md\`, \`02_name.md\`, etc.

#### \`${WIKI_SCHEMA_FILE}\`

Create the wiki maintenance schema using the required contents below.

${schemaSpecification(ctx)}

#### \`${WIKI_LOG_FILE}\`

Create an append-only chronological log. The first entry must use this parseable heading format:

\`## [${ctx.generatedDate}] init | Created codebase wiki\`

Under it, summarize the generated chapters, important source files inspected, and any known gaps.

#### \`${WIKI_METADATA_FILE}\` metadata

After ALL wiki files are written, update the \`generatedFiles\` array and write this JSON to \`${ctx.wikiDir}/${WIKI_METADATA_FILE}\`:

\`\`\`json
${ctx.metadataJson}
\`\`\`

Before writing, replace the empty \`generatedFiles\` array with the actual list of relative wiki paths you created (for example: \`["${WIKI_INDEX_FILE}", "${WIKI_SCHEMA_FILE}", "${WIKI_LOG_FILE}", "01_foo.md"]\`). Do NOT include \`${WIKI_METADATA_FILE}\` itself in \`generatedFiles\`.

---

${commonRules(ctx)}${formatRules(ctx)}
- **Write ALL required files** — ${GENERATED_CONTENT_FILES.join(", ")}, chapter files, and ${WIKI_METADATA_FILE}. Leave nothing unwritten.
- If you cannot complete everything in one turn, continue in the next turn until all files are written.`;
}

export function buildUpdatePrompt(config: PromptConfig): string {
  const ctx = buildPromptContext(config, "update");

  return `## Task: Incrementally Maintain the Codebase Wiki

You will update the existing **${ctx.projectName}** codebase wiki in \`${ctx.wikiRel}/\`. This is an incremental maintenance pass, not a full regeneration.

The previous recorded commit was ${config.previousCommit || "unknown"}. Current HEAD is ${ctx.commit || "unknown"}.

${commonConfiguration(ctx)}

---

### Step 1 — Read Existing Wiki State First

Before inspecting source files, read these wiki control files if they exist:

- \`${ctx.wikiRel}/${WIKI_SCHEMA_FILE}\` — maintenance rules and page conventions
- \`${ctx.wikiRel}/${WIKI_INDEX_FILE}\` — current content catalog and links
- \`${ctx.wikiRel}/${WIKI_LOG_FILE}\` — recent chronological activity
- \`${ctx.wikiRel}/${WIKI_METADATA_FILE}\` — saved options and generated file list

Use the schema as the authority for how this wiki should be maintained. If the schema is missing, create it using the schema specification in this prompt.

---

### Step 2 — Inspect Changed and Relevant Source Files

Changed files since the previous recorded commit:

\`\`\`
${ctx.changedFileListStr || "(No changed-file list available; inspect relevant source files from the file map.)"}
\`\`\`

Current source file map:

\`\`\`
${ctx.fileListStr}
\`\`\`

Read changed files first when they are relevant and within scope. Also read any related source files and existing wiki pages needed to understand impact. Do not read or analyze the wiki output directory as source input; read wiki files only to maintain the wiki.

---

### Step 3 — Determine Affected Wiki Pages

Identify which existing wiki pages need updates because code, APIs, control flow, configuration, or relationships changed. Prefer targeted edits. Create new pages only when a new core abstraction deserves durable documentation.

Check for:
- Stale summaries or code snippets
- Changed relationships/cross-links
- New or removed commands, APIs, modules, or configuration
- Index entries that need to be added, removed, or reworded
- Query answer pages that are now stale and should receive a short note or correction

---

### Step 4 — Apply Incremental Updates

Update only the affected wiki files where practical. Preserve useful existing structure and wording. When making claims about implementation details, cite source files by path and keep code snippets grounded in the current repository.

Required maintenance actions:
- Update affected chapter/concept pages and cross-links.
- Update \`${WIKI_INDEX_FILE}\` so it remains a complete content catalog.
- Ensure \`${WIKI_SCHEMA_FILE}\` exists and matches the conventions below if it was missing or outdated.
- Append exactly one new entry to \`${WIKI_LOG_FILE}\` using this parseable heading format:
  \`## [${ctx.generatedDate}] update | Incremental maintenance at ${ctx.commit || "unknown"}\`
- Summarize changed files inspected, wiki pages touched, and known follow-up gaps in the log entry.
- Refresh \`${WIKI_METADATA_FILE}\` with the JSON below, replacing \`generatedFiles\` with the current list of generated wiki content files. Do not include \`${WIKI_METADATA_FILE}\` itself.

Schema specification to use if needed:

${schemaSpecification(ctx)}

Metadata JSON to write at the end:

\`\`\`json
${ctx.metadataJson}
\`\`\`

---

${commonRules(ctx)}${formatRules(ctx)}
- **Do not fully regenerate the wiki unless the existing wiki is unusable.** Prefer incremental maintenance.
- If no source changes affect the wiki, still append a log entry noting that the wiki was checked and refresh metadata.`;
}

export function buildQueryPrompt(config: QueryPromptConfig): string {
  const ctx = buildPromptContext(config, "query");
  const safeQuestion = config.question.trim();

  return `## Task: Answer a Codebase Wiki Query and File Useful Results

Question: **${safeQuestion}**

Use the existing **${ctx.projectName}** codebase wiki in \`${ctx.wikiRel}/\` as the first layer of knowledge, then inspect source files only as needed. Answer the user and preserve substantial findings back into the wiki so future questions compound instead of starting over.

${commonConfiguration(ctx)}

---

### Step 1 — Read Navigation and Maintenance Files First

Read these files first if they exist:

- \`${ctx.wikiRel}/${WIKI_INDEX_FILE}\` — find relevant wiki pages
- \`${ctx.wikiRel}/${WIKI_LOG_FILE}\` — understand recent changes and prior queries
- \`${ctx.wikiRel}/${WIKI_SCHEMA_FILE}\` — follow answer filing conventions
- \`${ctx.wikiRel}/${WIKI_METADATA_FILE}\` — know current generated files/options

If there is no existing wiki, say so briefly, then inspect the source file map and create the minimum durable wiki scaffolding needed for this answer.

---

### Step 2 — Inspect Relevant Wiki and Source Files

Current source file map:

\`\`\`
${ctx.fileListStr}
\`\`\`

Read relevant wiki pages first based on the index. Then read source files needed to verify details. Cite both wiki pages and source file paths where useful; never invent implementation details.

---

### Step 3 — Answer the Question

Provide a clear answer in chat with:
- A direct answer first
- Supporting explanation grounded in wiki/source citations
- Any uncertainty, outdated wiki notes, or follow-up suggestions

Use citations as inline file/path references such as \`${ctx.wikiRel}/01_example.md\` and \`src/example.ts\`.

---

### Step 4 — File Substantial Answers Back Into the Wiki

If the answer contains durable explanation, comparison, workflow knowledge, debugging notes, or design synthesis that would help future readers, create an answer page under \`${ctx.wikiRel}/${WIKI_ANSWERS_DIR}/\`.

Answer page requirements:
- Filename: date prefix plus a short slug, e.g. \`${WIKI_ANSWERS_DIR}/${ctx.generatedDate}-model-selection.md\`
- Heading: \`# <question or concise title>\`
- Include the original question
- Include the durable answer with citations to wiki/source files
- Link to related chapter/concept pages
- Note any follow-up gaps

Then update:
- \`${WIKI_INDEX_FILE}\` — add/link the answer page under a "Query Answers" or similar section.
- \`${WIKI_LOG_FILE}\` — append exactly one entry using this parseable heading format:
  \`## [${ctx.generatedDate}] query | ${truncateForLog(safeQuestion)}\`
- \`${WIKI_METADATA_FILE}\` — refresh metadata using the JSON below, replacing \`generatedFiles\` with the current list of generated wiki content files, including the answer page. Do not include \`${WIKI_METADATA_FILE}\` itself.

If the answer is trivial and not worth filing, still append a short log entry explaining that no answer page was created, and refresh metadata.

Metadata JSON to write at the end:

\`\`\`json
${ctx.metadataJson}
\`\`\`

If \`${WIKI_SCHEMA_FILE}\` is missing, create it using this schema specification:

${schemaSpecification(ctx)}

---

${commonRules(ctx)}${formatRules(ctx)}
- Do not turn this query into a full wiki regeneration.
- Prefer reading the index/log/schema first, then only the most relevant source files.`;
}

function buildPromptContext(
  config: PromptConfig,
  operation: "init" | "update" | "query",
): PromptContext {
  const { repoRoot, wikiDir, projectName, options, previousCommit } = config;

  const language = getNonEmptyStringOption(options, "language", "english");
  const format = getFormatOption(options);
  const maxSize = getIntegerOption(options, "max-size", "100000");
  const includeRaw = getStringOption(options, "include", DEFAULT_INCLUDE);
  const excludeRaw = getStringOption(options, "exclude", DEFAULT_EXCLUDE);

  const includePatterns = parseCsv(includeRaw);
  const excludePatterns = parseCsv(excludeRaw);

  const fileListing = crawlFiles(
    repoRoot,
    includePatterns,
    excludePatterns,
    maxSize,
  );
  const fileListStr = formatNumberedList(fileListing);

  const wikiRelForSourceFilter = path.relative(repoRoot, wikiDir);
  const changedFiles = getChangedFilesSince(previousCommit).filter(
    (file) => !file.startsWith(wikiRelForSourceFilter + path.sep),
  );
  const changedFileListStr = formatNumberedList(changedFiles);

  const wikiRel = wikiRelForSourceFilter || "docs/code-wiki";
  const commit = getCurrentCommit();
  const generatedAt = new Date().toISOString();
  const generatedDate = generatedAt.slice(0, 10);

  const metadataJson = JSON.stringify(
    {
      version: "1.1.0",
      repoRoot,
      gitCommit: commit,
      generatedAt,
      updatedAt: generatedAt,
      lastOperation: operation,
      layout: {
        index: WIKI_INDEX_FILE,
        log: WIKI_LOG_FILE,
        schema: WIKI_SCHEMA_FILE,
        answersDir: WIKI_ANSWERS_DIR,
      },
      options: {
        include: includeRaw,
        exclude: excludeRaw,
        language,
        format,
        maxSize: String(maxSize),
      },
      generatedFiles: [],
    },
    null,
    2,
  );

  return {
    repoRoot,
    wikiDir,
    wikiRel,
    projectName,
    language,
    format,
    maxSize,
    includePatterns,
    excludePatterns,
    fileListStr,
    changedFileListStr,
    commit,
    generatedAt,
    generatedDate,
    metadataJson,
  };
}

function commonConfiguration(ctx: PromptContext): string {
  return `### Configuration
- **Project**: ${ctx.projectName}
- **Repo root**: ${ctx.repoRoot}
- **Wiki output directory**: ${ctx.wikiDir} (create it if needed)
- **Language**: ${ctx.language}
- **Max file size**: ${ctx.maxSize} bytes (skip larger files)
- **Include patterns**: ${ctx.includePatterns.join(", ")}
- **Exclude patterns**: ${ctx.excludePatterns.join(", ")}`;
}

function schemaSpecification(ctx: PromptContext): string {
  return `Write \`${WIKI_SCHEMA_FILE}\` with these sections and rules:

\`\`\`markdown
# Code Wiki Schema: ${ctx.projectName}

## Scope

This wiki documents the ${ctx.projectName} codebase only. Source files in the repository are the source of truth. The generated wiki is maintained by the LLM and should summarize, connect, and explain the code without replacing it.

## Layout

- \`${WIKI_INDEX_FILE}\` is the content-oriented catalog and primary navigation page.
- Numbered chapter pages document core abstractions and codebase concepts.
- \`${WIKI_ANSWERS_DIR}/\` contains durable answers created from substantial query results.
- \`${WIKI_LOG_FILE}\` is the chronological append-only activity log.
- \`${WIKI_METADATA_FILE}\` records generation settings, commit, timestamps, layout, and generated files.

## Page Conventions

- Write beginner-friendly Markdown.
- Start every page with one H1.
- Include source-file citations for implementation claims, using repository-relative paths.
- Prefer relative links to other wiki pages.
- Keep pages focused; create or update cross-links instead of duplicating long explanations.
- Update code snippets when source files change.

## Index Maintenance

- Keep \`${WIKI_INDEX_FILE}\` as a complete catalog of generated pages.
- Each listed page should have a link and one-line summary.
- Maintain sections for chapters/concepts, query answers, and maintenance files.
- Update relationship diagrams and cross-links when abstractions change.

## Log Maintenance

- Append one entry for every init, update, and query operation.
- Use parseable headings: \`## [YYYY-MM-DD] <operation> | <short title>\`.
- Mention source files inspected, wiki pages touched, and known gaps.
- Do not rewrite old log entries except to fix broken formatting.

## Update Workflow

1. Read this schema, \`${WIKI_INDEX_FILE}\`, \`${WIKI_LOG_FILE}\`, and \`${WIKI_METADATA_FILE}\` first.
2. Inspect changed or relevant source files.
3. Update only affected wiki pages where practical.
4. Refresh cross-links, the index, the log, and metadata.
5. Preserve useful existing synthesis unless current source code contradicts it.

## Query Answer Workflow

1. Read \`${WIKI_INDEX_FILE}\`, \`${WIKI_LOG_FILE}\`, and this schema first.
2. Read relevant wiki pages, then source files needed for verification.
3. Answer with citations.
4. If the answer is durable or substantial, write it under \`${WIKI_ANSWERS_DIR}/\`.
5. Link the answer from \`${WIKI_INDEX_FILE}\`, append \`${WIKI_LOG_FILE}\`, and refresh \`${WIKI_METADATA_FILE}\`.

## Citation Expectations

- Cite source paths for code behavior, APIs, commands, configuration, and data flow.
- Cite wiki pages when relying on existing synthesis.
- Mark uncertainty when source evidence is incomplete.
\`\`\``;
}

function formatRules(ctx: PromptContext): string {
  if (ctx.format !== "obsidian") {
    return "";
  }

  return `

### Obsidian Flavored Markdown Conventions

You are writing for an Obsidian vault. Follow these rules for every generated, updated, or newly filed wiki page.

**Links**

- Use [[wikilinks]] for internal wiki links: \`[[01_auth_flow]]\` not \`[Auth Flow](./01_auth_flow.md)\`.
- Use custom display text when helpful: \`[[01_auth_flow|Authentication Flow]]\`.
- Link answer pages as \`[[answers/${ctx.generatedDate}-model-selection|Model selection answer]]\`.
- Embed related notes only when useful: \`![[01_database_schema]]\`.
- For important anchored details, add a stable block ID like \`^implementation-details\` and link it as \`[[01_auth_flow#^implementation-details]]\`.
- Standard Markdown links are still OK for external URLs and absolute source paths.
- Do not use \`[text](url)\` for internal wiki links — always use \`[[page]]\` or \`[[page|display text]]\`.

**Frontmatter**

- Every Markdown page starts with YAML frontmatter between \`---\` fences, followed by exactly one H1.
- Use date-only values like \`${ctx.generatedDate}\` for \`created\` and \`updated\`; do not use full ISO timestamps in frontmatter.
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
}

function commonRules(ctx: PromptContext): string {
  return `### Important Rules

- **Read actual files** — do not guess or hallucinate code behavior. Use the read tool with file indices or paths.
- **Never include the wiki output directory (\`${ctx.wikiRel}/\`) as source analysis input.** It must not feed back into source discovery.
- **It is OK to read and edit files inside \`${ctx.wikiRel}/\` only as wiki artifacts.**
- **Do not read or analyze \`.git/\`, \`node_modules/\`, or other excluded directories.**
- **Keep generated file paths relative to the wiki directory in metadata.**
- **Do not include \`${WIKI_METADATA_FILE}\` itself in \`generatedFiles\`.**`;
}

function formatNumberedList(items: string[]): string {
  return items.map((item, index) => `${index}  ${item}`).join("\n");
}

function truncateForLog(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function getStringOption(
  options: PromptConfig["options"],
  key: string,
  fallback: string,
): string {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}

function getNonEmptyStringOption(
  options: PromptConfig["options"],
  key: string,
  fallback: string,
): string {
  const value = getStringOption(options, key, fallback);
  return value || fallback;
}

function getIntegerOption(
  options: PromptConfig["options"],
  key: string,
  fallback: string,
): number {
  return parseInt(getNonEmptyStringOption(options, key, fallback), 10);
}

function getFormatOption(options: PromptConfig["options"]): WikiFormat {
  const value = options.format;
  return WIKI_FORMATS.includes(value as WikiFormat)
    ? (value as WikiFormat)
    : "standard";
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
