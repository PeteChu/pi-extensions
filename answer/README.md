# Answer

Extracts questions from the last assistant message, lets you answer them in a terminal UI, and compiles the responses back into the chat. Trigger with `/answer`.

## Install

```bash
pi install npm:@petechu/pi-answer-studio
/reload
```

## Usage

1. Run `/answer` after an assistant message that contains questions.
2. Answer each question in the UI.
3. Press **Ctrl+R** or finish the last question to enter review.
4. Press **Enter** on the review screen to submit.

### Keys

| Key                        | Action                              |
| -------------------------- | ----------------------------------- |
| `←` / `→`                  | switch questions                    |
| `Enter`                    | commit answer, move to next         |
| `Ctrl+R`                   | review / submit                     |
| `↑` / `↓`                  | select an option / move cursor      |
| `1` – `9`                  | jump to option number / toggle      |
| type while option selected | switch to custom text input         |
| `Shift+Enter`              | newline in custom input             |
| `Ctrl+T`                   | apply next answer template          |
| `Ctrl+M`                   | toggle single-select / multi-select |
| `Space` (multi-select)     | toggle option at cursor             |
| `Ctrl+C`                   | cancel                              |
| `Esc` (on review)          | back to editing                     |

### Answer modes

Each question defaults to **single-select** (radio buttons). Press **Ctrl+M** to switch the current question to **multi-select** (checkboxes) and vice versa. The mode indicator `[S]` or `[M]` is shown next to the choices label.

- **Single-select**: `↑`/`↓` changes the selection, `Enter` commits
- **Multi-select**: `↑`/`↓` moves the cursor (`▸`), `Space` or a number key toggles the option at cursor, selected options are joined with `,` in the answer

The compiled submission omits unanswered questions and context lines.

## Design & workflow

The extension has three layers: **extraction**, **answering**, and **submission**.

### Extraction

When `/answer` runs, the extension walks the current session branch from newest to oldest and uses the latest completed assistant text message as the source. It then selects an extraction model from the configured preferences, falling back to the current chat model if none of the preferred models are available with credentials.

The assistant message is sent to the extraction model with a structured `extract_questions` tool when supported. If that tool path fails, the extension retries with the plain JSON system prompt. Extracted questions are normalized before display: ids are stabilized, empty questions are dropped, optional headers/context are trimmed, and choices are kept only when they have usable labels.

### Answering

Questions are shown in a custom terminal UI called **Answer Studio**. The UI keeps the extracted order, shows optional context and choices, and always offers an "Other / custom answer" path for choice-based questions. You can move between questions, select numbered options, type free-form responses, cycle configured templates, and enter a review screen before submitting.

Answer templates are applied locally in the TUI using `{{question}}`, `{{context}}`, `{{answer}}`, `{{index}}`, and `{{total}}` placeholders. They only change the current draft text; they do not re-run extraction or call another model.

### Drafts and submission

Drafts are stored as custom session entries tied to the assistant message id and the normalized question list. While enabled, answer changes are autosaved after the configured debounce interval, restored only when the same questions are extracted again, and cleared after a successful submission.

When you submit from the review screen, the extension sends one new chat message that starts with `I answered your questions in the following way:` followed by the compiled Q/A text, then triggers the next assistant turn. Cancelling keeps or flushes the current draft depending on where you exit; submitting clears it.

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
