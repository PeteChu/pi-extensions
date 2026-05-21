# AI Commit

Generates a git commit message following the Conventional Commit style, asks you to confirm, edit, or regenerate it, then runs `git commit -m "<message>"`. Trigger with `/commit`.

## Install

```bash
pi install npm:@petechu/pi-ai-commit
/reload
```

## Usage

1. Stage the changes you want to commit:

   ```bash
   git add path/to/files
   ```

2. Run `/commit` in Pi.
3. Review the generated Conventional Commit subject.
4. Choose **Commit** to run `git commit -m`, **Edit** to revise the generated message first, **Regenerate** to ask the model for a new message, or **Cancel**.

## Skipped files

To avoid spending tokens on huge or noisy diffs, `/commit` skips known lockfiles and binary/oversized diffs. Skipped staged files are still listed in the prompt by path/status so the model can account for them without seeing the full diff.

Default skipped lock/noisy patterns include `*-lock.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, and `*.lock`.

## Configuration

The extension reads `aiCommit` settings from Pi's global agent settings and project `.pi/settings.json` (project overrides global):

```json
{
  "aiCommit": {
    "generationModels": [
      { "provider": "openai-codex", "id": "gpt-5.4-mini" },
      { "provider": "github-copilot", "id": "gpt-5.4-mini" }
    ],
    "systemPrompt": "Custom Conventional Commit prompt...",
    "skipPatterns": ["*-lock.json", "pnpm-lock.yaml", "generated/*"],
    "perFileDiffLimit": 12000,
    "totalDiffLimit": 40000
  }
}
```

If none of the configured `generationModels` are available, `/commit` falls back to the currently selected Pi model.
