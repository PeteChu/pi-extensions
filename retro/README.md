# Pi Retro

Generate a coaching retrospective report for your current Pi session. `/retro` analyzes your conversation, extracts actionable insights, and produces an HTML report that helps you collaborate better with AI agents.

## How It Helps

- **Learn from your session** — See what went well, what could be improved, and what to avoid next time
- **Better prompts** — Get concrete examples of how to rephrase your prompts for clearer results
- **Understand agent behavior** — Learn how the agent interpreted your requests and where corrections were needed
- **Actionable takeaways** — Get specific, personalized advice you can apply to future sessions

## Install

```bash
pi install npm:@petechu/pi-retro
/reload
```

## Usage

Run `/retro` at any point during a session:

```text
/retro
```

The extension waits for the agent to become idle, then sends a hidden retrospective request through the active Pi agent. The extension does not call provider APIs directly.

### The Report

The report is saved as an HTML file and automatically opened in your browser:

```text
pi-retro-2026-06-05T12-30-00.html
```

By default, the report is saved to the git repository root if available, otherwise to the current working directory.

### What's Inside

Each report includes:

- **Session metrics** — turns, duration, tool calls, corrections detected
- **Session summary** — a concise overview of what happened
- **Timeline** — key moments and milestones
- **What went well** — effective approaches worth repeating
- **What could be improved** — areas where communication or approach could be clearer
- **What not to do** — patterns to avoid
- **Better prompts** — concrete examples with original/improved/why
- **Agent behavior notes** — insights into how the agent interpreted your requests
- **Actionable takeaways** — personalized advice for next time
- **Detailed breakdowns** — tool calls by name, files read/edited/written, verification commands

## Design & Workflow

The extension has three layers: **collection**, **analysis**, and **reporting**.

### Collection

When `/retro` runs, the extension walks the current session branch and extracts:

- **Conversation transcript** — user prompts, assistant responses, with truncation for long sessions
- **Tool call metrics** — which tools were called, how often, and which failed
- **File operations** — which files were read, edited, or written
- **Verification commands** — test, lint, and typecheck commands that ran
- **Correction signals** — moments where the user clarified or redirected the agent

### Analysis

The extension sends a hidden prompt to the active Pi agent with:

- The condensed transcript (truncated at ~40k characters for long sessions)
- Structured metrics as JSON
- A system prompt that asks the agent to analyze the collaboration from the user's perspective

The agent is instructed to:

- Focus on how well it interpreted user intent
- Identify where user corrections were needed
- Provide specific, actionable feedback
- Generate concrete prompt rewrites with explanations
- Call `retro_save_report` exactly once as its final action

### Reporting

When the agent calls `retro_save_report`, the extension:

1. Renders the analysis as a styled HTML report
2. Saves it to the git root or current working directory
3. Opens the report in your browser (or shows a notification if this fails)

The HTML report includes:

- Light/dark theme toggle with system preference detection
- Responsive layout that works on mobile and desktop
- Print-friendly styles for archiving
- All content stored locally — no external requests

## Privacy

Reports may contain excerpts from your session, including:

- User prompts and assistant responses
- File paths and tool arguments
- Commands and their outputs
- Agent behavior observations

**Review the report before sharing or committing.** The extension saves reports locally and does not transmit them anywhere.

## Notes

- The transcript is truncated at ~40,000 characters for long sessions — this preserves early turns and errors, but mid-session content may be summarized or omitted
- Correction detection uses heuristics — phrases like "actually," "I meant," "not what I wanted" — and may miss some corrections or flag false positives
- The `/retro` request itself is persisted in the session context; future versions may isolate this to avoid polluting the main conversation history
