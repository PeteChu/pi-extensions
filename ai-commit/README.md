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

## Design & workflow

The extension has three layers: **staged-change collection**, **message generation**, and **review/commit**.

### Staged-change collection

When `/commit` is invoked, the extension waits for Pi to become idle, verifies that an interactive UI and model are available, and resolves the repository root with `git rev-parse --show-toplevel`. It only works from staged changes; it does not stage files or inspect unstaged work for you.

The extension reads `aiCommit` settings, then gathers staged metadata with `git diff --cached --name-status -z` and `git diff --cached --numstat -z`. For each staged file that is not binary and does not match a skip pattern, it reads the cached text diff with `git diff --cached -- <path>`.

Diff preparation keeps the prompt focused and bounded:

- **Noisy files** — files matching skip patterns are excluded from full diff context.
- **Binary or empty diffs** — binary files and files with no text diff are summarized only.
- **Oversized diffs** — files beyond `perFileDiffLimit` are skipped; the combined included diff text is capped by `totalDiffLimit` and may truncate the last included diff.
- **Skipped files** — skipped staged files are still included by status/path/statistics and skip reason so the model can account for their presence.

If every staged file is skipped, `/commit` warns you but still generates a message from staged file summaries.

### Message generation

The extension builds a single prompt containing a summary of all staged files, fenced diffs for included files, and a skipped-file section for anything summarized without a full diff. The default system prompt asks for one Conventional Commit subject line and forbids extra explanation or formatting.

Generation uses the first configured model that exists in Pi's model registry
and has working authentication. A valid thinking suffix is removed for registry
lookup and applied only to this commit-message request; `/commit` does not
change Pi's active model or thinking level. Unsuffixed model IDs remain
backward-compatible and run without a reasoning override. If no configured
`generationModels` preference is usable, the extension uses the currently
selected Pi model without a reasoning override. Model output is cleaned before
review: markdown fences, labels, bullets, quotes, trailing periods, and common
prompt-anchored wording are removed. If the model does not return a
Conventional Commit subject, the extension falls back to a `chore:` subject
based on the first cleaned line.

### Review and commit

The generated message is shown in an interactive confirmation flow:

1. **Commit** runs `git commit -m <message>` from the repository root.
2. **Edit** opens the generated message in Pi's editor, then returns to the same review prompt with your edited text.
3. **Regenerate** calls the model again with the same staged-change prompt.
4. **Cancel** stops without running git.

The extension never commits without confirmation. If `git commit` fails, the git error is shown and no retry is attempted automatically.

## Configuration

The extension reads `aiCommit` settings from Pi's global agent settings and project `.pi/settings.json` (project overrides global):

```json
{
  "aiCommit": {
    "generationModels": [
      { "provider": "openai-codex", "id": "gpt-5.6-luna:low" },
      { "provider": "github-copilot", "id": "gpt-5.4-mini:off" }
    ],
    "systemPrompt": "Custom Conventional Commit prompt...",
    "skipPatterns": ["*-lock.json", "pnpm-lock.yaml", "generated/*"],
    "perFileDiffLimit": 12000,
    "totalDiffLimit": 40000
  }
}
```

Append a thinking level to the model `id` after its final colon. Valid suffixes
are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. For example,
`gpt-5.6-luna:low` looks up the base model `gpt-5.6-luna` and generates with low
reasoning. The `off` suffix explicitly selects the base model without passing a
reasoning level.

Unsuffixed model IDs continue to work as before and do not pass a reasoning
override. An unrecognized final suffix is treated as part of the full legacy
model ID. If no configured model can be resolved and authenticated, `/commit`
falls back to Pi's currently selected/default model without passing a reasoning
level.
