# Code Wiki

Generate and maintain a persistent, beginner-friendly codebase wiki inside your repository. The extension guides Pi's agent to build Markdown documentation, keep it current incrementally, and file substantial answers from codebase questions back into the wiki.

The design is inspired by Karpathy's LLM Wiki pattern: the wiki is a durable, compounding artifact (`index.md` + pages + `log.md` + schema), not a throwaway answer or full regeneration on every run.

## Install

```bash
pi install npm:@petechu/pi-code-wiki
/reload
```

## How It Works

The extension sends focused prompts to Pi's agent for three maintenance operations:

1. **Init** — survey the codebase, identify core abstractions, write beginner-friendly chapter pages, and create the persistent wiki control files.
2. **Update** — read the existing schema/index/log/metadata first, inspect changed or relevant source files, update affected pages and links, append the log, and refresh metadata.
3. **Query** — answer a codebase question using the wiki first and source files as needed; file substantial answers under `answers/` so future work compounds.

Everything runs through Pi's native tools — no Python, no external LLM calls, no GitHub crawling.

## Usage

### Commands

| Command                                 | Description                                               |
| --------------------------------------- | --------------------------------------------------------- |
| `/code-wiki init [options]`             | Generate a new persistent wiki for the current repository |
| `/code-wiki update [options]`           | Incrementally maintain an existing wiki                   |
| `/code-wiki query "question" [options]` | Answer a codebase question and file substantial results   |
| `/code-wiki doctor`                     | Check if a wiki exists and show its status                |
| `/code-wiki help`                       | Show usage information                                    |

### Query forms

Both forms are supported:

```bash
/code-wiki query --question="How does model selection work?"
/code-wiki query "How does model selection work?"
```

### Options

| Option                                                 | Description                                   | Default                      |
| ------------------------------------------------------ | --------------------------------------------- | ---------------------------- |
| `--target=<path>`                                      | Target subdirectory (narrows scope)           | Repo root                    |
| `--output=<path>`                                      | Wiki output directory (relative to repo root) | `docs/code-wiki`             |
| `--exclude=<glob,...>`                                 | File patterns to exclude (strictly enforced)  | tests, deps, build artifacts |
| `--language=<lang>`                                    | Output language                               | `english`                    |
| `--format=<standard\|obsidian>`                        | Output Markdown format                        | `standard`                   |
| `--detail-level=<summary\|standard\|deep\|exhaustive>` | Durable wiki explanation detail               | `standard`                   |
| `--question=<text>`                                    | Question for `query`                          | none                         |
| `--force`                                              | Overwrite existing wiki (init only)           | Prompt before overwrite      |

### Detail Level

Use `--detail-level` to control how much explanation durable wiki content should contain without changing source analysis scope.

```bash
/code-wiki init --detail-level=summary
/code-wiki init --detail-level=deep
/code-wiki update --detail-level=exhaustive
```

| Detail level | Contract                                                                                                                          | Soft target per chapter/concept page   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `summary`    | Concise orientation: purpose, main responsibilities, and relationships. Minimal snippets only when essential.                     | ~300–700 words, 0–1 short snippets     |
| `standard`   | Default. Beginner-friendly but not thin: explains why each abstraction exists, how it fits, main flows, and important files.      | ~900–1,600 words, 1–3 short snippets   |
| `deep`       | Thorough walkthroughs: lifecycle/data-flow examples, important edge cases, module interactions, and source-grounded explanations. | ~1,800–3,500 words, 2–5 short snippets |
| `exhaustive` | Near-reference level: relevant internals, public surfaces, variants, gotchas, and detailed relationships without raw code dumps.  | ~3,500+ words when warranted           |

Detail level applies to durable wiki content: generated pages, maintained pages, index summaries/diagrams, and filed answer pages. `/code-wiki query` chat responses stay concise by default; any durable answer page follows the wiki detail level.

The selected level is stored in `.code-wiki.json` and reflected in `.code-wiki-schema.md`. `update` and `query` inherit the existing wiki's level unless explicitly overridden. If an override is passed to `update` or `query`, it is persisted for future maintenance. `init --force` behaves like a fresh init and does not preserve the previous wiki's detail level.

Precedence:

1. Explicit CLI/tool option (`--detail-level` or `detailLevel`)
2. Existing wiki metadata for `update`/`query`
3. `codeWiki.defaultDetailLevel` from project/global settings for new wikis
4. Built-in default: `standard`

Invalid explicit values fail fast. Invalid settings values are warned about and ignored. Existing metadata without `detailLevel` is treated as `standard`.

Code snippets are evidence, not the main content. Generated wiki pages should prefer prose explanations, diagrams, and walkthroughs over long snippets; snippets should be short, cited, introduced, and explained afterward.

### Target Directory (Monorepo Support)

Use `--target=<subdirectory>` to narrow the wiki scope to a specific subdirectory within a monorepo:

```bash
/code-wiki init --target=packages/backend
/code-wiki init --target=packages/frontend --output=docs/frontend-wiki
```

When `--target` is set:

- Only files **within** that subdirectory are crawled and analyzed.
- The **project name** in the wiki uses the target directory's basename (e.g., `backend`).
- The **default output** path becomes `docs/code-wiki/<target-basename>` (e.g., `docs/code-wiki/backend`).
- The **read guard** blocks the agent from reading files outside the target directory.
- Omit `--target` to use the full repo root (default behavior, unchanged).

## Generated Wiki Layout

The wiki is written to `docs/code-wiki/` by default and includes:

- `index.md` — content-oriented catalog, project overview, relationship diagram, chapter links, query-answer links, and maintenance links.
- `01_*.md`, `02_*.md`, etc. — beginner-friendly pages for core codebase abstractions.
- `.code-wiki-schema.md` — durable maintenance rules for future Pi agents: scope, page conventions, index/log maintenance, cross-linking, citations, update workflow, and query-answer filing workflow.
- `log.md` — append-only chronological record with parseable headings such as `## [YYYY-MM-DD] update | ...`.
- `answers/` — durable answer pages created from substantial `/code-wiki query` results.
- `.code-wiki.json` — metadata: settings, layout, git commit, timestamps, last operation, selected format/detail level, and generated file list.
- `.obsidian/app.json` — created only for `--format=obsidian` so the output directory can be opened as an Obsidian vault.

## Obsidian Mode

Use `--format=obsidian` to generate Obsidian Flavored Markdown instead of portable standard Markdown:

```bash
/code-wiki init --format=obsidian --output=my-vault/docs
```

In Obsidian mode, the prompt asks the agent to use:

- `[[wikilinks]]` for internal wiki links, including answer pages under `answers/`.
- YAML frontmatter properties on every page.
- Obsidian callouts such as `> [!note]` and `> [!warning]`.
- Inline kebab-case `#tags` for graph/search discovery.

On init, the extension creates `.obsidian/app.json` in the wiki directory and displays a copyable open URI plus platform command, for example:

```text
obsidian://open?path=<absolute-wiki-path>
open 'obsidian://open?path=<absolute-wiki-path>'      # macOS
xdg-open 'obsidian://open?path=<absolute-wiki-path>'  # Linux
start "" "obsidian://open?path=<absolute-wiki-path>" # Windows
```

`/code-wiki doctor` reports the stored format from `.code-wiki.json`. `update` and `query` inherit the stored format automatically, so you do not need to repeat `--format=obsidian` after initialization.

Standard mode remains the default and keeps the current portable Markdown behavior. Invalid `--format` values silently fall back to `standard`.

## Update vs Init

- **`init`** — generates a fresh persistent codebase wiki. Fails if the output directory already has content unless `--force` is used.
- **`update`** — performs incremental maintenance. The agent reads `.code-wiki-schema.md`, `index.md`, `log.md`, and `.code-wiki.json` first, then updates affected pages, links, log, and metadata based on changed or relevant source files.

## Query Behavior

`/code-wiki query` asks the agent to:

1. Read `index.md`, `log.md`, `.code-wiki-schema.md`, and metadata first.
2. Inspect relevant wiki pages, then source files needed to verify the answer.
3. Answer with citations to wiki/source paths.
4. Write a durable page under `answers/` when the answer is substantial.
5. Link the answer from `index.md`, append `log.md`, and refresh `.code-wiki.json`.

Trivial answers may be logged without creating an answer page.

## Model Selection

`/code-wiki init`, `/code-wiki update`, and `/code-wiki query` select a generation model before sending the wiki prompt:

1. Read `codeWiki.generationModels` from Pi's global settings and project `.pi/settings.json` (project overrides global).
2. Iterate the list in order and use the first model that exists in Pi's model registry and has working authentication.
3. If none of the configured models are available, fall back to the currently selected Pi model.
4. Switch the active model to the selection before sending the wiki prompt.

`/code-wiki doctor` does **not** require or switch any model — it only checks local filesystem and git metadata.

### Default generation models

```json
[
  { "provider": "openai-codex", "id": "gpt-5.4-mini" },
  { "provider": "github-copilot", "id": "gpt-5.4-mini" },
  { "provider": "openai-codex", "id": "gpt-5.3-codex-spark" },
  { "provider": "github-copilot", "id": "gemini-3-flash-preview" },
  { "provider": "github-copilot", "id": "claude-haiku-4.5" },
  { "provider": "anthropic", "id": "claude-haiku-4-5" }
]
```

### Customizing via settings

```json
{
  "codeWiki": {
    "defaultDetailLevel": "deep",
    "maxSize": 100000,
    "generationModels": [
      { "provider": "openai-codex", "id": "gpt-5.4-mini" },
      { "provider": "github-copilot", "id": "gpt-5.4-mini" }
    ]
  }
}
```

Place this in `~/.pi/settings.json` (global) or `<project>/.pi/settings.json` (per-project, overrides global). `defaultDetailLevel` applies to new wikis; existing wiki metadata takes precedence during `update` and `query`. `maxSize` is only configured through settings.

## Custom Tool

The LLM can also invoke the wiki generator via the `code_wiki` tool:

```text
Use code_wiki with action="init" to generate a codebase wiki
Use code_wiki with action="update" to incrementally maintain the wiki
Use code_wiki with action="query" and question="..." to answer and file useful results
Use code_wiki with action="doctor" to check the wiki status
Pass target="packages/backend" to narrow scope to a subdirectory
Pass format="obsidian" to initialize or maintain an Obsidian-ready vault
Pass detailLevel="deep" to control durable wiki explanation detail
```

### Custom Tool Parameters

The `code_wiki` tool accepts all the same parameters as the `/code-wiki` command, including:

| Parameter     | Type               | Description                                    |
| ------------- | ------------------ | ---------------------------------------------- |
| `action`      | string             | `init`, `update`, `query`, or `doctor`         |
| `target`      | string (optional)  | Subdirectory to scope the wiki to              |
| `output`      | string (optional)  | Wiki directory path                            |
| `language`    | string (optional)  | Output language                                |
| `format`      | string (optional)  | `standard` or `obsidian`                       |
| `detailLevel` | string (optional)  | `summary`, `standard`, `deep`, or `exhaustive` |
| `exclude`     | string (optional)  | Comma-separated exclude patterns               |
| `question`    | string (optional)  | Question for `query`                           |
| `force`       | boolean (optional) | Overwrite existing wiki on init                |

## Strict Exclude Enforcement

During any code-wiki operation (`init`, `update`, `query`), the extension intercepts built-in `read` tool calls and blocks reads matching the configured exclude patterns. This ensures excluded files cannot be accidentally read even if the agent drifts from the prompt guidance.

**Behavior:**

- **Blocked (exclude):** Any file matching an `--exclude` pattern is blocked with an error: `Blocked by code-wiki exclude pattern: <path>`.
- **Blocked (target scope):** When `--target=<path>` is set, any file outside the target directory is blocked with an error: `Blocked by code-wiki target scope: ...`.
- **Allowed:** Wiki artifact files inside the output directory are still readable during `update` and `query` operations (e.g., `index.md`, `log.md`, chapter pages, schema, metadata).
- **Normal reads unaffected:** When no code-wiki operation is active, the `read` tool works normally without any restrictions.
- **Defaults applied:** If no `--exclude` is specified, the built-in defaults are used (test directories, build artifacts, `node_modules`, `.git`/`.github`, wiki output, etc.).

The enforcement is a safety net, not a replacement for prompt guidance. The agent is still strongly encouraged to follow the file map and exclude instructions in the prompt.

## Troubleshooting

| Problem                           | Solution                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| "Not inside a Git repository"     | Run Pi from within a Git working directory                                           |
| "Wiki directory already exists"   | Use `--force` to overwrite, or `/code-wiki update` to maintain it                    |
| Query requires a question         | Use `--question="..."` or positional text after `/code-wiki query`                   |
| Invalid detail level              | Use one of `summary`, `standard`, `deep`, or `exhaustive`                            |
| Agent doesn't write all files     | The prompt may span multiple turns — the agent will continue until complete          |
| Wiki includes its own output      | The prompt explicitly excludes the wiki directory from source analysis               |
| "Target directory does not exist" | Ensure the path exists relative to the repo root, e.g. `--target=packages/backend`   |
| Doctor reports missing schema/log | Run `/code-wiki update`; the prompt will recreate missing control files              |
| Obsidian vault not recognized     | Copy the `obsidian://open?...` URI from the init output to open in Obsidian manually |

## Acknowledgement & Inspiration

This extension is inspired by [PocketFlow-Tutorial-Codebase-Knowledge](https://github.com/The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge) and Karpathy's LLM Wiki pattern for persistent, compounding knowledge bases maintained by LLM agents.
