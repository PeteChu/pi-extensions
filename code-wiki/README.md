# code-wiki — Pi Extension

Generate and maintain a persistent, beginner-friendly codebase wiki inside your repository. The extension guides Pi's agent to build Markdown documentation, keep it current incrementally, and file substantial answers from codebase questions back into the wiki.

The design is inspired by Karpathy's LLM Wiki pattern: the wiki is a durable, compounding artifact (`index.md` + pages + `log.md` + schema), not a throwaway answer or full regeneration on every run.

## How It Works

The extension sends focused prompts to Pi's agent for three maintenance operations:

1. **Init** — survey the codebase, identify core abstractions, write beginner-friendly chapter pages, and create the persistent wiki control files.
2. **Update** — read the existing schema/index/log/metadata first, inspect changed or relevant source files, update affected pages and links, append the log, and refresh metadata.
3. **Query** — answer a codebase question using the wiki first and source files as needed; file substantial answers under `answers/` so future work compounds.

Everything runs through Pi's native tools — no Python, no external LLM calls, no GitHub crawling.

## Installation

Place the `code-wiki` directory in `~/.pi/agent/extensions/`:

```bash
cp -r code-wiki ~/.pi/agent/extensions/
```

Then reload Pi: `/reload`

No additional dependencies — the extension uses only Node.js built-ins and Pi's APIs.

## Usage

### Commands

| Command                                 | Description                                               |
| --------------------------------------- | --------------------------------------------------------- |
| `/code-wiki init [options]`             | Generate a new persistent wiki for the current repository |
| `/code-wiki update [options]`           | Incrementally maintain an existing wiki                   |
| `/code-wiki query "question" [options]` | Answer a codebase question and file substantial results   |
| `/code-wiki doctor`                     | Check if a wiki exists and show its status                |
| `/code-wiki open [options]`             | Open the wiki directory directly in Obsidian              |
| `/code-wiki help`                       | Show usage information                                    |

### Query forms

Both forms are supported:

```bash
/code-wiki query --question="How does model selection work?"
/code-wiki query "How does model selection work?"
```

### Options

| Option                   | Description                                   | Default                      |
| ------------------------ | --------------------------------------------- | ---------------------------- |
| `--output=<path>`        | Wiki output directory (relative to repo root) | `docs/code-wiki`             |
| `--include=<glob,...>`   | File patterns to include                      | `*.py,*.js,*.ts,...`         |
| `--exclude=<glob,...>`   | File patterns to exclude                      | tests, deps, build artifacts |
| `--language=<lang>`      | Output language                               | `english`                    |
| `--format=<standard\|obsidian>` | Output Markdown format                | `standard`                   |
| `--max-abstractions=<n>` | Maximum number of abstractions                | `10`                         |
| `--max-size=<bytes>`     | Maximum file size in bytes                    | `100000`                     |
| `--question=<text>`      | Question for `query`                          | none                         |
| `--no-cache`             | Tell the agent not to cache LLM responses     | Caching enabled              |
| `--force`                | Overwrite existing wiki (init only)           | Prompt before overwrite      |

## Generated Wiki Layout

The wiki is written to `docs/code-wiki/` by default and includes:

- `index.md` — content-oriented catalog, project overview, relationship diagram, chapter links, query-answer links, and maintenance links.
- `01_*.md`, `02_*.md`, etc. — beginner-friendly pages for core codebase abstractions.
- `.code-wiki-schema.md` — durable maintenance rules for future Pi agents: scope, page conventions, index/log maintenance, cross-linking, citations, update workflow, and query-answer filing workflow.
- `log.md` — append-only chronological record with parseable headings such as `## [YYYY-MM-DD] update | ...`.
- `answers/` — durable answer pages created from substantial `/code-wiki query` results.
- `.code-wiki.json` — metadata: settings, layout, git commit, timestamps, last operation, selected format, and generated file list.
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

On init, the extension creates `.obsidian/app.json` in the wiki directory and displays a copyable open URI plus platform command. You can also open the wiki directly from the extension:

```bash
/code-wiki open --output=my-vault/docs
```

The extension launches the Obsidian URI with the platform opener (`open`, `xdg-open`, or Windows `start`). It also keeps displaying the equivalent copyable command, for example:

```text
obsidian://open?path=<absolute-wiki-path>
open 'obsidian://open?path=<absolute-wiki-path>'      # macOS
xdg-open 'obsidian://open?path=<absolute-wiki-path>'  # Linux
start "" "obsidian://open?path=<absolute-wiki-path>" # Windows
```

`/code-wiki doctor` reports the stored format from `.code-wiki.json` and shows the Obsidian open URI/command for Obsidian wikis. `update` and `query` inherit the stored format automatically, so you do not need to repeat `--format=obsidian` after initialization.

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
    "generationModels": [
      { "provider": "openai-codex", "id": "gpt-5.4-mini" },
      { "provider": "github-copilot", "id": "gpt-5.4-mini" }
    ]
  }
}
```

Place this in `~/.pi/settings.json` (global) or `<project>/.pi/settings.json` (per-project, overrides global).

## Custom Tool

The LLM can also invoke the wiki generator via the `code_wiki` tool:

```text
Use code_wiki with action="init" to generate a codebase wiki
Use code_wiki with action="update" to incrementally maintain the wiki
Use code_wiki with action="query" and question="..." to answer and file useful results
Use code_wiki with action="doctor" to check the wiki status
Use code_wiki with action="open" to open the wiki directly in Obsidian
Pass format="obsidian" to initialize or maintain an Obsidian-ready vault
```

## Troubleshooting

| Problem                           | Solution                                                                    |
| --------------------------------- | --------------------------------------------------------------------------- |
| "Not inside a Git repository"     | Run Pi from within a Git working directory                                  |
| "Wiki directory already exists"   | Use `--force` to overwrite, or `/code-wiki update` to maintain it           |
| Query requires a question         | Use `--question="..."` or positional text after `/code-wiki query`          |
| Agent doesn't write all files     | The prompt may span multiple turns — the agent will continue until complete |
| Wiki includes its own output      | The prompt explicitly excludes the wiki directory from source analysis      |
| Doctor reports missing schema/log | Run `/code-wiki update`; the prompt will recreate missing control files     |
| Obsidian does not open automatically | Copy the `obsidian://open?...` URI from `/code-wiki doctor --format=obsidian` |

## Files

```text
code-wiki/
├── index.ts              # Extension entry point (command + tool registration)
├── src/
│   ├── args.ts           # Argument parsing (subcommands, flags, query text)
│   ├── repo.ts           # Git root, commit, and changed-file helpers
│   ├── crawler.ts        # Local file listing (paths only, respects .gitignore)
│   ├── prompt.ts         # Prompt builders for init, incremental update, query
│   ├── metadata.ts       # .code-wiki.json reader/types
│   ├── wiki-layout.ts    # Shared generated wiki filenames/layout constants
│   └── settings.ts       # Model preference settings and defaults
└── README.md
```

## Acknowledgement & Inspiration

This extension is inspired by [PocketFlow-Tutorial-Codebase-Knowledge](https://github.com/The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge) and Karpathy's LLM Wiki pattern for persistent, compounding knowledge bases maintained by LLM agents.
