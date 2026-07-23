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

Or press `Ctrl+Shift+E` to open the picker as a floating window. Pressing `Ctrl+Shift+E` from `/extension-toggle` closes the default picker and opens the floating one; pressing it again from the floating window hides/shows that window without losing pending selections.

Press `?` in either picker to show help, including the floating-window shortcut.

The command shows grouped entries by source with their current state:

```text
[x] npm:package-usage (global) · Enabled
[ ] npm:other-package (project) · Disabled
[x] ai-commit (global extension) · Enabled
[ ] answer (global extension) · Disabled
```

The picker opens ready for typing: type an extension, skill, prompt, theme, package, or path name to filter the list immediately. Move through the filtered entries with the arrow keys. Check or uncheck the highlighted source with `space`, then press `enter` to apply changes. Checked sources are enabled; unchecked sources are disabled. Package sources are toggled as a unit; top-level local resources are toggled individually. The extension writes the matching global or project settings changes, then asks whether to reload immediately. Confirm the reload for the changes to take effect right away.

## Search

The picker is always searchable, so printable characters filter sources as you type. While using it:

- use the arrow keys to move through matching sources;
- use Space to toggle the highlighted source;
- use Backspace/Delete to remove characters;
- use Ctrl+U to clear the query;
- use Esc to clear the query, or cancel when it is already empty;
- press Enter to apply selected changes.

Filtering only changes which rows are visible. Toggle state is remembered by the original source, so checked/unchecked entries stay changed even when the search query hides them.

## Grouping

Resources are grouped by their origin:

- **Package sources** (e.g., `npm:package-usage`): all extensions, skills, prompts, and themes from that package form one toggleable unit.
- **Top-level sources** (`~/.pi/agent/` and `.pi/` auto-discovered resources): each local extension, skill, prompt, or theme is its own toggleable unit.

When you disable a package source, the toggler writes empty filters for all four resource types so nothing from that package is loaded. When you disable a top-level source, it writes an exact exclusion for that resource. When you re-enable a source, it writes an exact include for that resource so it can override broader exclusions.

## Design & workflow

The extension has three layers: **discovery**, **selection**, and **settings updates**.

### Discovery

When `/extension-toggle` starts, it waits for the current session to become idle, then resolves Pi resources from both the global agent directory and the current project's `.pi/` directory. It asks Pi's package manager for the installed extensions, skills, prompts, and themes, then filters the list down to resources that can be toggled from settings.

The toggle manager excludes itself from this list so you cannot accidentally disable `/extension-toggle` while using it. Package resources are grouped by package source, while top-level local resources are grouped by their scope, type, and path relative to `~/.pi/agent/` or `.pi/`.

### Selection

The command renders an interactive multi-select list. Each row starts checked if any resource in that source is currently enabled, and only rows whose checked state changes are applied when you press Enter.

Search mode filters rows without losing pending toggle state. The search index includes the visible label, source key, resource type, resource path, and Pi metadata, so queries can match package names, local resource names, nested file names, or paths.

### Settings updates

When changes are applied, the extension writes to the matching global or project settings scope:

1. **Package sources** update the package entry itself. Disabling a package writes empty `extensions`, `skills`, `prompts`, and `themes` filters so none of that package's resources load. Enabling a package clears those filters; if no filters remain, the package entry is stored as its plain source string again.
2. **Top-level resources** update the relevant path list for that resource type. Disabling writes an exact `-path` exclusion, while enabling writes an exact `+path` include so the resource can override broader exclusions.
3. Existing include or exclude entries for the same exact path are removed before the new entry is written, keeping the setting deterministic.

After settings are flushed, the command reports how many sources changed and asks whether to reload immediately. If you skip the reload, the saved settings will take effect the next time you run `/reload`.

## Notes and limitations

- It supports global (`~/.pi/agent`) and project (`.pi/`) scopes.
- `pi-extension-toggle` hides itself from the selection list so you cannot disable the manager from its own UI.
