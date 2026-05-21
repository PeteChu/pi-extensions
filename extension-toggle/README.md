# pi-extension-toggle

Pi extension that lets you enable or disable installed Pi extensions, skills, prompts, and themes from inside an interactive Pi session.

## Install

```bash
pi install npm:@petechu/pi-extension-toggle
/reload
```

## Usage

After installing, run:

```text
/extension-toggle
```

The command shows grouped entries by source with their current state:

```text
[x] npm:plannotator (global) · Enabled
[ ] npm:other-package (project) · Disabled
[x] ai-commit (global extension) · Enabled
[ ] answer (global extension) · Disabled
```

Move through entries with the arrow keys or `j`/`k`. Check or uncheck entries with `space`, then press `enter` to apply changes. Checked sources are enabled; unchecked sources are disabled. Package sources are toggled as a unit; top-level local resources are toggled individually. The extension writes the matching global or project settings changes, then asks whether to reload immediately. Confirm the reload for the changes to take effect right away.

## Search

Press `/` or Ctrl+F to enter search mode, then type an extension, skill, prompt, theme, package, or path name to filter the list. While searching:

- type printable characters to update the query;
- use Backspace/Delete to remove characters;
- use Ctrl+U to clear the query;
- use Esc to leave search mode without clearing the filter;
- press Enter to apply selected changes.

Filtering only changes which rows are visible. Toggle state is remembered by the original source, so checked/unchecked entries stay changed even when the search query hides them.

## Grouping

Resources are grouped by their origin:

- **Package sources** (e.g., `npm:plannotator`): all extensions, skills, prompts, and themes from that package form one toggleable unit.
- **Top-level sources** (`~/.pi/agent/` and `.pi/` auto-discovered resources): each local extension, skill, prompt, or theme is its own toggleable unit.

When you disable a package source, the toggler writes empty filters for all four resource types so nothing from that package is loaded. When you disable a top-level source, it writes an exact exclusion for that resource. When you re-enable a source, it writes an exact include for that resource so it can override broader exclusions.

## Notes and limitations

- It supports global (`~/.pi/agent`) and project (`.pi/`) scopes.
- `pi-extension-toggle` hides itself from the selection list so you cannot disable the manager from its own UI.
