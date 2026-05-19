# Answer

Extracts questions from the last assistant message, lets you answer them in a terminal UI, and compiles the responses back into the chat. Trigger with `/answer`.

## Install

This directory lives at `~/.pi/agent/extensions/answer`. Run `/reload` in Pi to activate.

To install from another location:

```bash
pi install /path/to/answer
```

## Usage

1. Run `/answer` after an assistant message that contains questions.
2. Answer each question in the UI.
3. Press **Ctrl+R** or finish the last question to enter review.
4. Press **Enter** on the review screen to submit.

### Keys

| Key                        | Action                      |
| -------------------------- | --------------------------- |
| `←` / `→`                  | switch questions            |
| `Enter`                    | commit answer, move to next |
| `Ctrl+R`                   | review / submit             |
| `↑` / `↓`                  | select an option            |
| `1` – `9`                  | jump to option number       |
| type while option selected | switch to custom text input |
| `Shift+Enter`              | newline in custom input     |
| `Ctrl+T`                   | apply next answer template  |
| `Ctrl+C`                   | cancel                      |
| `Esc` (on review)          | back to editing             |

The compiled submission omits unanswered questions and context lines.

## Configuration

The extension reads `answer` settings from Pi's global agent settings and project `.pi/settings.json` (project overrides global):

```json
{
  "answer": {
    "systemPrompt": "Custom extraction prompt...",
    "extractionModels": [
      { "provider": "openai-codex", "id": "gpt-5.4-mini" },
      { "provider": "github-copilot", "id": "gpt-5.4-mini" },
      { "provider": "github-copilot", "id": "gemini-3-flash-preview" },
      { "provider": "anthropic", "id": "claude-haiku-4-5" }
    ],
    "answerTemplates": [
      { "label": "Brief", "template": "{{answer}}" },
      { "label": "Need info", "template": "I need more details about: " }
    ],
    "drafts": {
      "enabled": true,
      "autosaveMs": 1000,
      "promptOnRestore": true
    }
  }
}
```

Template placeholders: `{{question}}`, `{{context}}`, `{{answer}}`, `{{index}}`, `{{total}}`.

## Tests

From the cloned source:

```bash
pnpm test -- answer/tests/utils.test.ts answer/tests/qna-adapter.test.ts answer/tests/index.test.ts
```
