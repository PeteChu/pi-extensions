/**
 * Build the wiki generation prompt that encodes the PocketFlow workflow technique.
 *
 * The prompt guides Pi's agent through the same 6-step workflow:
 *   1. Crawl & survey files
 *   2. Identify core abstractions
 *   3. Analyze relationships
 *   4. Order chapters
 *   5. Write detailed chapters
 *   6. Combine into index.md + chapter files
 */

import * as path from "node:path";
import { crawlFiles } from "./crawler";
import { getCurrentCommit } from "./repo";

export interface PromptConfig {
  repoRoot: string;
  wikiDir: string;
  projectName: string;
  options: Record<string, string | boolean | undefined>;
  isUpdate: boolean;
  previousCommit?: string;
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

export function buildWikiPrompt(config: PromptConfig): string {
  const { repoRoot, wikiDir, projectName, options, isUpdate, previousCommit } =
    config;

  const language = getNonEmptyStringOption(options, "language", "english");
  const maxAbstractions = getIntegerOption(options, "max-abstractions", "10");
  const maxSize = getIntegerOption(options, "max-size", "100000");
  const noCache = !!options["no-cache"];
  const includeRaw = getStringOption(options, "include", DEFAULT_INCLUDE);
  const excludeRaw = getStringOption(options, "exclude", DEFAULT_EXCLUDE);

  const includePatterns = parseCsv(includeRaw);
  const excludePatterns = parseCsv(excludeRaw);

  // Crawl files for the listing (paths only, no content)
  const fileListing = crawlFiles(
    repoRoot,
    includePatterns,
    excludePatterns,
    maxSize,
  );
  const fileListStr = fileListing.map((f, i) => `${i}  ${f}`).join("\n");

  const wikiRel = path.relative(repoRoot, wikiDir) || "docs/code-wiki";
  const commit = getCurrentCommit();
  const generatedAt = new Date().toISOString();

  // Build the metadata JSON that the agent should write at the end
  const metadataJson = JSON.stringify(
    {
      version: "1.0.0",
      repoRoot,
      gitCommit: commit,
      generatedAt,
      options: {
        include: includeRaw,
        exclude: excludeRaw,
        language,
        maxAbstractions: String(maxAbstractions),
        maxSize: String(maxSize),
        noCache: noCache ? "true" : undefined,
      },
      generatedFiles: [], // agent fills this in
    },
    null,
    2,
  );

  const updateContext = isUpdate
    ? `This is an UPDATE run. The wiki was previously generated at commit ${
        previousCommit || "unknown"
      }. Current HEAD is ${commit || "unknown"}. Focus on changes since the last generation, but produce a complete, fresh wiki.`
    : "";
  const useTranslatedContent = language !== "english";
  const languageInstruction = useTranslatedContent
    ? ` — write ALL content (names, descriptions, chapter text) in ${language}. Only fixed labels like 'Chapters' and the footer can stay in English.`
    : "";
  const translatedNameInstruction = useTranslatedContent
    ? ` in ${language}`
    : "";
  const chapterLanguageInstruction = useTranslatedContent
    ? `- Write ALL chapter content in ${language}`
    : "";
  const indexLanguage = useTranslatedContent ? language : "English";

  return `## Task: Generate a Beginner-Friendly Codebase Wiki

You will analyze the **${projectName}** codebase and generate a well-structured wiki in \`${wikiRel}/\`. Follow the 6-step workflow below. Write ALL output files using the write tool.

${updateContext}

### Configuration
- **Project**: ${projectName}
- **Repo root**: ${repoRoot}
- **Wiki output directory**: ${wikiDir} (create it if needed)
- **Language**: ${language}${languageInstruction}
- **Max abstractions**: up to ${maxAbstractions} core concepts
- **Max file size**: ${maxSize} bytes (skip larger files)
- **Include patterns**: ${includePatterns.join(", ")}
- **Exclude patterns**: ${excludePatterns.join(", ")}

---

### Step 1 — Survey the File Map

I have already crawled the repository. Below is the complete file listing (index + relative path). Files matching include/exclude patterns and within the size limit are shown. Use the \`read\` tool to inspect files you need.

\`\`\`
${fileListStr}
\`\`\`

Quickly scan a representative sample of files across different directories to understand the project structure. Focus on files that define core logic, key abstractions, and public APIs.

---

### Step 2 — Identify Core Abstractions

Read the most important files and identify up to **${maxAbstractions}** core abstractions (classes, modules, concepts, patterns) that form the backbone of the codebase.

For each abstraction, note:
- **Name**: A short, descriptive name${translatedNameInstruction}
- **Description**: A 2-3 sentence beginner-friendly explanation${translatedNameInstruction}
- **Key files**: The file indices (from the listing above) where this abstraction lives

Output this as a structured list. Keep it in your working memory for the next steps.

---

### Step 3 — Analyze Relationships

For the abstractions you identified, determine how they relate to each other:
- Which abstractions depend on or use others?
- What data or control flows between them?
- Are there parent-child, producer-consumer, or plugin relationships?

For each relationship, note:
- **From** abstraction → **To** abstraction
- A concise **label** (3-6 words) describing the relationship${translatedNameInstruction}

Also write a **high-level project summary** (3-5 sentences)${translatedNameInstruction} describing what the project does at a high level.

---

### Step 4 — Order the Chapters

Determine the best order to present the abstractions. Put foundational concepts first, then build up to higher-level ones. Consider dependencies: if A depends on B, explain B first.

Output an ordered list of abstraction indices (0-based, referencing the order from Step 2).

---

### Step 5 — Write the Chapters

For each abstraction (in the order from Step 4), write a detailed, beginner-friendly chapter as a Markdown file.

**Each chapter file should:**
- Start with a clear heading: \`# Chapter N: Abstraction Name\`
- Explain what the abstraction does, using analogies where helpful
- Show how it fits into the bigger picture (reference the relationship diagram)
- Include relevant code snippets from the actual source files (use read to get them)
- Explain the code snippets in plain language
- Mention related abstractions and link forward/backward to neighboring chapters
- End with a brief summary

**Writing style:**
- Write for someone who is NEW to this codebase
- Use analogies and concrete examples
- Avoid jargon without explanation
- Each chapter should be self-contained but cross-reference others
${chapterLanguageInstruction}

**Context for sequential writing:** When writing chapter N, you can reference what was covered in chapters 1 through N-1. Build on previous explanations.

---

### Step 6 — Combine into the Wiki

Write the final wiki files into \`${wikiDir}/\`:

#### \`index.md\`

\`\`\`markdown
# Tutorial: ${projectName}

[High-level project summary from Step 3]

**Source Repository**: [local](${repoRoot})

\`\`\`mermaid
flowchart TD
    A0["Abstraction 0 Name"]
    A1["Abstraction 1 Name"]
    ...
    A0 -- "relationship label" --> A1
    ...
\`\`\`

## Chapters

1. [Abstraction 0 Name](01_abstraction_0.md)
2. [Abstraction 1 Name](02_abstraction_1.md)
...

\`\`\`

- Use the relationships from Step 3 to build the Mermaid \`flowchart TD\` diagram.
- Use ${indexLanguage} for abstraction names, summaries, labels, and chapter links.
- Sanitize names for filenames: lowercase, replace non-alphanumeric with underscores.
- Chapter filenames: \`01_name.md\`, \`02_name.md\`, etc.

#### Individual chapter files

Write each chapter from Step 5 as \`NN_abstraction_name.md\` in the wiki directory.

#### \`.code-wiki.json\` metadata

After ALL wiki files are written, update the \`generatedFiles\` array and write this exact JSON to \`${wikiDir}/.code-wiki.json\`:

\`\`\`json
${metadataJson}
\`\`\`

Before writing, replace the empty \`generatedFiles\` array with the actual list of relative paths you created (e.g., \`["index.md", "01_foo.md", "02_bar.md"]\`). Do NOT include \`.code-wiki.json\` itself in the list.

---

### Important Rules

- **Do ALL steps.** Do not skip the file survey or jump straight to writing.
- **Read actual source files** — do not guess or hallucinate code snippets. Use the read tool with file indices or paths.
- **Never include the wiki output directory (\`${wikiRel}/\`) in the generated file list or analysis.** It must not feed back into future runs.
- **Do not read or analyze files inside \`${wikiRel}/\`, \`.git/\`, \`node_modules/\`, or other excluded directories.**
- **Write ALL files** — index.md, all chapter files, and .code-wiki.json. Leave nothing unwritten.
- If you cannot complete everything in one turn, continue in the next turn until all files are written.`;
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

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
