# code-wiki — Pi Extension

Generate a beginner-friendly codebase wiki inside your repository. The extension guides Pi's agent through a structured 6-step workflow (based on the [PocketFlow technique](https://github.com/The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge)) to analyze your codebase and produce well-organized Markdown documentation with Mermaid diagrams.

## How It Works

The extension sends a detailed, step-by-step prompt to Pi's agent, which:

1. **Surveys files** — scans the provided file listing and reads key source files
2. **Identifies abstractions** — finds core concepts, classes, and patterns
3. **Analyzes relationships** — maps how abstractions interact
4. **Orders chapters** — determines a logical learning sequence
5. **Writes chapters** — creates beginner-friendly explanations with code snippets
6. **Combines the wiki** — writes `index.md` with a Mermaid diagram, chapter files, and metadata

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

| Command                       | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `/code-wiki init [options]`   | Generate a new wiki for the current repository |
| `/code-wiki update [options]` | Refresh an existing wiki using saved settings  |
| `/code-wiki doctor`           | Check if a wiki exists and show its status     |
| `/code-wiki help`             | Show usage information                         |

### Options

| Option                   | Description                                   | Default                      |
| ------------------------ | --------------------------------------------- | ---------------------------- |
| `--output=<path>`        | Wiki output directory (relative to repo root) | `docs/code-wiki`             |
| `--include=<glob,...>`   | File patterns to include                      | `*.py,*.js,*.ts,...`         |
| `--exclude=<glob,...>`   | File patterns to exclude                      | tests, deps, build artifacts |
| `--language=<lang>`      | Output language                               | `english`                    |
| `--max-abstractions=<n>` | Maximum number of abstractions                | `10`                         |
| `--max-size=<bytes>`     | Maximum file size in bytes                    | `100000`                     |
| `--no-cache`             | Tell the agent not to cache LLM responses     | Caching enabled              |
| `--force`                | Overwrite existing wiki (init only)           | Prompt before overwrite      |

### Model Selection

`/code-wiki init` and `/code-wiki update` select a generation model before sending the wiki prompt:

1. Read `codeWiki.generationModels` from Pi's global settings and project `.pi/settings.json` (project overrides global).
2. Iterate the list in order and use the first model that exists in Pi's model registry and has working authentication.
3. If none of the configured models are available, fall back to the currently selected Pi model.
4. Switch the active model to the selection before sending the wiki generation prompt.

`/code-wiki doctor` does **not** require or switch any model — it only checks local filesystem and git metadata.

#### Default generation models

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

#### Customizing via settings

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

### Custom Tool

The LLM can also invoke the wiki generator via the `code_wiki` tool:

```
Use code_wiki with action="init" to generate a codebase wiki
Use code_wiki with action="update" to refresh the wiki
Use code_wiki with action="doctor" to check the wiki status
```

## What Gets Generated

The wiki is written to `docs/code-wiki/` (configurable via `--output`) and includes:

- `index.md` — project overview, Mermaid relationship diagram, and chapter links
- `01_*.md`, `02_*.md`, etc. — one chapter per core abstraction
- `.code-wiki.json` — metadata (settings, git commit, timestamp, generated file list)

## Update vs Init

- **`init`** — generates a fresh wiki. Fails if the output directory already has content unless `--force` is used.
- **`update`** — reads saved settings from `.code-wiki.json`, merges with new overrides, and regenerates the wiki.

## Troubleshooting

| Problem                         | Solution                                                                    |
| ------------------------------- | --------------------------------------------------------------------------- |
| "Not inside a Git repository"   | Run Pi from within a Git working directory                                  |
| "Wiki directory already exists" | Use `--force` to overwrite, or `/code-wiki update` to refresh               |
| Agent doesn't write all files   | The prompt may span multiple turns — the agent will continue until complete |
| Wiki includes its own output    | The prompt explicitly instructs the agent to exclude the wiki directory     |

## Files

```
code-wiki/
├── index.ts              # Extension entry point (command + tool registration)
├── src/
│   ├── args.ts           # Argument parsing (subcommands + flags)
│   ├── repo.ts           # Git root and commit detection
│   ├── crawler.ts        # Local file listing (paths only, respects .gitignore)
│   ├── prompt.ts         # Prompt builder (encodes the 6-step PocketFlow workflow)
│   ├── metadata.ts       # .code-wiki.json reader
│   └── settings.ts       # Model preference settings and defaults
└── README.md
```

## Acknowledgement & Inspiration

This extension is inspired by [PocketFlow-Tutorial-Codebase-Knowledge](https://github.com/The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge), which demonstrates a structured 6-step workflow for building codebase knowledge bases.
