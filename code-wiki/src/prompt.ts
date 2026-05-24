/**
 * Pure prompt composers — take a PromptContext and return a prompt string.
 * No filesystem access, no git calls, no I/O.
 */

import * as path from "node:path";
import type { DetailLevel } from "./detail-level";
import type { ProjectProfile } from "./profiler";
import type { PromptContext } from "./prompt-types";
import {
  GENERATED_CONTENT_FILES,
  WIKI_ANSWERS_DIR,
  WIKI_INDEX_FILE,
  WIKI_LOG_FILE,
  WIKI_METADATA_FILE,
  WIKI_SCHEMA_FILE,
} from "./wiki-layout";

export function buildInitPrompt(ctx: PromptContext): string {
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

  const profileSummary = buildProfileSummary(ctx.profile, ctx.includePatterns);
  const fileListStr = formatNumberedList(ctx.fileList);

  return `## Task: Initialize a Persistent Codebase Wiki

You will analyze the **${ctx.projectName}** codebase and generate a durable, LLM-maintained wiki in \`${ctx.wikiRel}/\`. Follow the workflow below. Write ALL output files using the write tool.

This is not a disposable one-shot answer: create a wiki that future update and query runs can maintain incrementally.

${commonConfiguration(ctx)}

${detailLevelSpecification(ctx)}
${languageNote ? `\nLanguage note: ${languageNote}` : ""}

---

### Step 1 — Survey the File Map

The repository has been profiled and the file listing below was built using auto-detected include patterns. You can read files outside this listing if needed — it is advisory, not restrictive.

**Project profile:**

\`\`\`
${profileSummary}
\`\`\`

**Filtered file listing (index + relative path):**

\`\`\`
${fileListStr}
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

### Step 5 — Write Chapter Pages at the Selected Detail Level

For each abstraction, write a beginner-friendly chapter at the selected detail level as a Markdown file in \`${ctx.wikiRel}/\`.

**Each chapter file should:**
- Start with a clear heading: \`# Chapter N: Abstraction Name\`
- Explain what the abstraction does, using analogies where helpful
- Show how it fits into the bigger picture
- Include short, relevant code snippets from actual source files only when they clarify behavior, with file-path citations such as \`src/foo.ts\`
- Introduce why each snippet matters and explain it afterward in plain language
- Link to related wiki pages using relative Markdown links
- End with a brief summary

**Writing style:**
- Write for someone who is NEW to this codebase
- Use analogies and concrete examples
- Prefer explanatory prose, walkthroughs, and relationship descriptions over raw code excerpts
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
${buildMetadataJson(ctx, "init")}
\`\`\`

Before writing, replace the empty \`generatedFiles\` array with the actual list of relative wiki paths you created (for example: \`["${WIKI_INDEX_FILE}", "${WIKI_SCHEMA_FILE}", "${WIKI_LOG_FILE}", "01_foo.md"]\`). Do NOT include \`${WIKI_METADATA_FILE}\` itself in \`generatedFiles\`.

---

${commonRules(ctx)}${ctx.formatRulesText}
- **Write ALL required files** — ${GENERATED_CONTENT_FILES.join(", ")}, chapter files, and ${WIKI_METADATA_FILE}. Leave nothing unwritten.
- If you cannot complete everything in one turn, continue in the next turn until all files are written.`;
}

export function buildUpdatePrompt(ctx: PromptContext): string {
  const profileSummary = buildProfileSummary(ctx.profile, ctx.includePatterns);
  const fileListStr = formatNumberedList(ctx.fileList);
  const changedFileListStr = formatNumberedList(ctx.changedFiles);

  return `## Task: Incrementally Maintain the Codebase Wiki

You will update the existing **${ctx.projectName}** codebase wiki in \`${ctx.wikiRel}/\`. This is an incremental maintenance pass, not a full regeneration.

The previous recorded commit was ${ctx.commit || "unknown"}. Current HEAD is ${ctx.commit || "unknown"}.

${commonConfiguration(ctx)}

${detailLevelSpecification(ctx)}

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
${changedFileListStr || "(No changed-file list available; inspect relevant source files from the file map.)"}
\`\`\`

Current source file map (auto-detected include patterns):

\`\`\`
${profileSummary}
\`\`\`

\`\`\`
${fileListStr}
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

Update only the affected wiki files where practical. Preserve useful existing structure and wording. Write touched or new durable wiki content at the selected detail level, but do not rewrite untouched pages solely to match a changed detail level. When making claims about implementation details, cite source files by path and keep code snippets grounded in the current repository.

Required maintenance actions:
- Update affected chapter/concept pages and cross-links.
- Update \`${WIKI_INDEX_FILE}\` so it remains a complete content catalog.
- Ensure \`${WIKI_SCHEMA_FILE}\` exists and matches the conventions below if it was missing or outdated.
- Append exactly one new entry to \`${WIKI_LOG_FILE}\` using this parseable heading format:
  \`## [${ctx.generatedDate}] update | Incremental maintenance at ${ctx.commit || "unknown"}\`
- Summarize changed files inspected, wiki pages touched, detail-level/style gaps, and known follow-up gaps in the log entry.
- Refresh \`${WIKI_METADATA_FILE}\` with the JSON below, replacing \`generatedFiles\` with the current list of generated wiki content files. Do not include \`${WIKI_METADATA_FILE}\` itself.

Schema specification to use if needed:

${schemaSpecification(ctx)}

Metadata JSON to write at the end:

\`\`\`json
${buildMetadataJson(ctx, "update")}
\`\`\`

---

${commonRules(ctx)}${ctx.formatRulesText}
- **Do not fully regenerate the wiki unless the existing wiki is unusable.** Prefer incremental maintenance.
- If no source changes affect the wiki, still append a log entry noting that the wiki was checked and refresh metadata.`;
}

export function buildQueryPrompt(ctx: PromptContext, question: string): string {
  const safeQuestion = question.trim();
  const profileSummary = buildProfileSummary(ctx.profile, ctx.includePatterns);
  const fileListStr = formatNumberedList(ctx.fileList);

  return `## Task: Answer a Codebase Wiki Query and File Useful Results

Question: **${safeQuestion}**

Use the existing **${ctx.projectName}** codebase wiki in \`${ctx.wikiRel}/\` as the first layer of knowledge, then inspect source files only as needed. Answer the user and preserve substantial findings back into the wiki so future questions compound instead of starting over.

${commonConfiguration(ctx)}

${detailLevelSpecification(ctx)}

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

Current source file map (auto-detected include patterns):

\`\`\`
${profileSummary}
\`\`\`

\`\`\`
${fileListStr}
\`\`\`

Read relevant wiki pages first based on the index. Then read source files needed to verify details. Cite both wiki pages and source file paths where useful; never invent implementation details.

---

### Step 3 — Answer the Question

Provide a clear, concise answer in chat with:
- A direct answer first
- Supporting explanation grounded in wiki/source citations
- Any uncertainty, outdated wiki notes, or follow-up suggestions

Do not make the chat response long solely because the wiki detail level is deep or exhaustive; the detail level applies to durable wiki content.

Use citations as inline file/path references such as \`${ctx.wikiRel}/01_example.md\` and \`src/example.ts\`.

---

### Step 4 — File Substantial Answers Back Into the Wiki

If the answer contains durable explanation, comparison, workflow knowledge, debugging notes, or design synthesis that would help future readers, create an answer page under \`${ctx.wikiRel}/${WIKI_ANSWERS_DIR}/\`.

Answer page requirements:
- Filename: date prefix plus a short slug, e.g. \`${WIKI_ANSWERS_DIR}/${ctx.generatedDate}-model-selection.md\`
- Heading: \`# <question or concise title>\`
- Include the original question
- Write the durable answer at the selected detail level, scaled to the question's importance
- Include citations to wiki/source files
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
${buildMetadataJson(ctx, "query")}
\`\`\`

If \`${WIKI_SCHEMA_FILE}\` is missing, create it using this schema specification:

${schemaSpecification(ctx)}

---

${commonRules(ctx)}${ctx.formatRulesText}
- Do not turn this query into a full wiki regeneration.
- Prefer reading the index/log/schema first, then only the most relevant source files.`;
}

// ── Private helpers ───────────────────────────────────────────────────────

const DETAIL_LEVEL_GUIDANCE: Record<
  DetailLevel,
  { contract: string; target: string; index: string; diagram: string }
> = {
  summary: {
    contract:
      "Concise orientation: explain purpose, main responsibilities, and relationships with minimal snippets only when essential.",
    target: "~300–700 words per chapter/concept page, 0–1 short snippets.",
    index: "Keep the index compact.",
    diagram: "Show major components only.",
  },
  standard: {
    contract:
      "Beginner-friendly but not thin: explain why each abstraction exists, how it fits, main data/control flow, and important files.",
    target: "~900–1,600 words per chapter/concept page, 1–3 short snippets.",
    index: "Use helpful one-line summaries.",
    diagram: "Show core abstractions and primary flows.",
  },
  deep: {
    contract:
      "Thorough walkthrough: include lifecycle/data-flow examples, important edge cases, module interactions, and source-grounded explanations.",
    target: "~1,800–3,500 words per chapter/concept page, 2–5 short snippets.",
    index:
      "Use richer summaries and relationship notes without duplicating chapters.",
    diagram:
      "Show more nuanced relationships where useful, while avoiding unreadable diagrams.",
  },
  exhaustive: {
    contract:
      "Near-reference level: cover most relevant internals, public surfaces, important variants, gotchas, and detailed relationships without raw code dumps.",
    target:
      "~3,500+ words per chapter/concept page when warranted; snippets as needed, never as a raw code dump.",
    index:
      "Use richer summaries and relationship notes without turning the index into a chapter.",
    diagram:
      "Show more nuanced relationships where useful, while avoiding unreadable giant diagrams.",
  },
};

function detailLevelSpecification(ctx: PromptContext): string {
  const guidance = DETAIL_LEVEL_GUIDANCE[ctx.detailLevel];

  return `### Detail Level Contract
- **Selected detail level**: \`${ctx.detailLevel}\`
- Applies to durable wiki content: generated pages, maintained pages, index summaries/diagrams, and filed answer pages.
- Does **not** change source analysis scope, target/exclude rules, or which core concepts deserve pages.
- Higher detail means more explanation, walkthroughs, relationships, and source-grounded narrative — not more code dumping.
- Soft target for chapter/concept pages: ${guidance.target}
- Current preset contract: ${guidance.contract}
- Index guidance: ${guidance.index}
- Diagram guidance: ${guidance.diagram}
- Durable query answer pages follow the same style, scaled to the question's importance; chat answers stay concise by default.
- Code snippets are evidence, not the main content. Prefer prose explanations, diagrams, and walkthroughs over long snippets. Use snippets only when they clarify source behavior; keep them short, cite the source path, introduce why the snippet matters, and explain it afterward.`;
}

function commonConfiguration(ctx: PromptContext): string {
  const targetLine =
    ctx.targetDir !== ctx.repoRoot
      ? `\n- **Target directory**: ${ctx.targetDir}`
      : "";
  return `### Configuration
- **Project**: ${ctx.projectName}
- **Repo root**: ${ctx.repoRoot}${targetLine}
- **Wiki output directory**: ${ctx.wikiDir} (create it if needed)
- **Language**: ${ctx.language}
- **Detail level**: ${ctx.detailLevel}
- **Max file size**: ${ctx.maxSize} bytes (skip larger files)
- **Include patterns** (auto-detected): ${ctx.includePatterns.join(", ") || "(none)"}
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

## Detail Level

- Current detail level: \`${ctx.detailLevel}\`.
- Detail Level applies to durable wiki content: generated pages, maintained pages, index summaries/diagrams, and filed answer pages.
- Detail Level does not change source analysis scope, target/exclude rules, or which core concepts deserve pages.
- Preset contract:
  - \`summary\`: Concise orientation; purpose, main responsibilities, and relationships; minimal snippets only when essential.
  - \`standard\`: Beginner-friendly but not thin; explains why each abstraction exists, how it fits, main flows, and important files.
  - \`deep\`: Thorough walkthroughs; lifecycle/data-flow examples, important edge cases, module interactions, and source-grounded explanations.
  - \`exhaustive\`: Near-reference level; relevant internals, public surfaces, variants, gotchas, and detailed relationships without raw code dumps.
- Soft chapter targets:
  - \`summary\`: ~300–700 words, 0–1 short snippets.
  - \`standard\`: ~900–1,600 words, 1–3 short snippets.
  - \`deep\`: ~1,800–3,500 words, 2–5 short snippets.
  - \`exhaustive\`: ~3,500+ words when warranted; snippets as needed, never as a raw code dump.
- On update, apply the current detail level to touched or new pages; do not rewrite untouched pages solely to match a changed detail level.
- Query chat answers may stay concise; durable answer pages should follow the current detail level, scaled to the question's importance.

## Snippet Discipline

- Code snippets are evidence, not the main content.
- Prefer prose explanations, diagrams, and walkthroughs over long snippets.
- Use snippets only when they clarify source behavior.
- Keep snippets short, cite the source path, introduce why each snippet matters, and explain it afterward.

## Index Maintenance

- Keep \`${WIKI_INDEX_FILE}\` as a complete catalog of generated pages.
- Each listed page should have a link and one-line summary.
- Maintain sections for chapters/concepts, query answers, and maintenance files.
- Reflect the current detail level lightly: compact for \`summary\`, useful one-line summaries for \`standard\`, and richer summaries or relationship notes for \`deep\`/\`exhaustive\` without turning the index into a chapter.
- Update relationship diagrams and cross-links when abstractions change. Diagram detail should follow the current detail level, but avoid unreadable giant diagrams.

## Log Maintenance

- Append one entry for every init, update, and query operation.
- Use parseable headings: \`## [YYYY-MM-DD] <operation> | <short title>\`.
- Mention source files inspected, wiki pages touched, and known gaps.
- Do not rewrite old log entries except to fix broken formatting.

## Update Workflow

1. Read this schema, \`${WIKI_INDEX_FILE}\`, \`${WIKI_LOG_FILE}\`, and \`${WIKI_METADATA_FILE}\` first.
2. Inspect changed or relevant source files.
3. Update only affected wiki pages where practical, applying the current detail level to touched or new durable content.
4. Refresh cross-links, the index, the log, and metadata.
5. Preserve useful existing synthesis unless current source code contradicts it.

## Query Answer Workflow

1. Read \`${WIKI_INDEX_FILE}\`, \`${WIKI_LOG_FILE}\`, and this schema first.
2. Read relevant wiki pages, then source files needed for verification.
3. Answer with citations.
4. If the answer is durable or substantial, write it under \`${WIKI_ANSWERS_DIR}/\` at the current detail level.
5. Link the answer from \`${WIKI_INDEX_FILE}\`, append \`${WIKI_LOG_FILE}\`, and refresh \`${WIKI_METADATA_FILE}\`.

## Citation Expectations

- Cite source paths for code behavior, APIs, commands, configuration, and data flow.
- Cite wiki pages when relying on existing synthesis.
- Mark uncertainty when source evidence is incomplete.
\`\`\``;
}

function commonRules(ctx: PromptContext): string {
  const targetRule =
    ctx.targetDir !== ctx.repoRoot
      ? `\n- **Target scope is enforced.** The extension blocks \`read\` tool calls for files outside the target directory (\`${ctx.targetDir}\`).`
      : "";
  return `### Important Rules

- **Read actual files** — do not guess or hallucinate code behavior. Use the read tool with file indices or paths.
- **Include patterns are advisory, not enforced.** The file listing helps orient you but you may read files outside it.
- **Excluded patterns are strictly enforced.** The extension blocks \`read\` tool calls matching any exclude pattern. If a read is blocked, the file is excluded — do not try to bypass this.${targetRule}
- **Never include the wiki output directory (\`${ctx.wikiRel}/\`) as source analysis input.** It must not feed back into source discovery.
- **Code snippets are evidence, not the main content.** Prefer prose explanations, diagrams, and walkthroughs over long snippets. Use snippets only when they clarify source behavior; keep them short, cite the source path, introduce why each snippet matters, and explain it afterward.
- **It is OK to read and edit files inside \`${ctx.wikiRel}/\` only as wiki artifacts.**
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

function buildProfileSummary(
  profile: ProjectProfile,
  includePatterns: string[],
): string {
  const top = Object.entries(profile.extensionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([ext, count]) => `  ${ext}: ${count}`)
    .join("\n");

  const configLine =
    profile.configFiles.length > 0
      ? `Recognized config files: ${profile.configFiles.join(", ")}\n`
      : "No recognized config files found.\n";

  return [
    `Project profile — ${profile.totalFiles} files across ${profile.totalDirs} directories`,
    configLine,
    `Top extensions:`,
    top || "  (none)",
    `\nAuto-selected include patterns: ${includePatterns.join(", ") || "(none)"}`,
  ].join("\n");
}

function buildMetadataJson(ctx: PromptContext, operation: string): string {
  const targetRel =
    ctx.targetDir !== ctx.repoRoot
      ? path.relative(ctx.repoRoot, ctx.targetDir)
      : undefined;

  return JSON.stringify(
    {
      version: "1.2.0",
      repoRoot: ctx.repoRoot,
      targetDir: ctx.targetDir !== ctx.repoRoot ? ctx.targetDir : undefined,
      gitCommit: ctx.commit,
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.generatedAt,
      lastOperation: operation,
      layout: {
        index: WIKI_INDEX_FILE,
        log: WIKI_LOG_FILE,
        schema: WIKI_SCHEMA_FILE,
        answersDir: WIKI_ANSWERS_DIR,
      },
      options: {
        target: targetRel,
        include: ctx.includePatterns.join(","),
        exclude: ctx.excludePatterns.join(","),
        language: ctx.language,
        format: ctx.format,
        detailLevel: ctx.detailLevel,
        maxSize: String(ctx.maxSize),
      },
      generatedFiles: [],
    },
    null,
    2,
  );
}
