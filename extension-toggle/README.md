# pi-extension-toggle

Toggle installed Pi extensions, skills, prompts, and themes, and save named global resource collections for repeatable switching.

## Install

Requires Pi 0.74.0 or newer.

```bash
pi install npm:@petechu/pi-extension-toggle
/reload
```

## Usage

After installing, run:

```text
/extension-toggle
```

Use Tab, or your configured completion key, to complete `/extension-toggle` and
select `toggle`, `collections`, `save <name>`, `use <name>`, or `list`.
Selecting `use <name>` opens saved collection names. Typing
`/extension-toggle use ` also shows them. The extension preserves your configured
autocomplete menu size and input history across reloads. `toggle` opens the same
picker as the command without arguments.

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

## Collections

Open the collection manager inside Pi's custom terminal UI:

```text
/extension-toggle collections
```

Type to filter saved names, use Up/Down to select, and press Enter to preview
the stored settings. Press Enter again to restore the snapshot, then confirm
the reload prompt to load the resources immediately. Declining keeps the saved
settings and shows a `/reload` reminder. Package-source mismatches are shown in the
list and block applying the snapshot. Preview Up/Down scrolls settings;
Esc returns to the list, clears a search, then closes the manager.

- **Ctrl+S** saves the current global configuration under a new name.
- **Ctrl+R** renames the selected collection without changing its snapshot.
- **Ctrl+D** deletes the selected collection after confirmation; current settings remain unchanged.

Saving and renaming enforce the same name validation and refuse collisions.
The preview shows saved filters, including empty arrays and absent settings,
rather than estimating the number of enabled resources. The existing picker,
floating shortcut, and commands below remain available.

Save and restore named **global** resource configurations without opening the picker:

```text
/extension-toggle save baseline
# Change resource toggles with /extension-toggle or pi config.
/extension-toggle save review
/extension-toggle list
/extension-toggle use baseline
/reload
/extension-toggle use review
/reload
```

`save <name>` captures only `packages`, `extensions`, `skills`, `prompts`, and `themes` from global settings. Package objects retain their exact resource filters, including empty arrays and partially enabled packages; missing settings remain missing. Models, credentials, tools, and unrelated settings are not captured or restored.

Collections persist in `<getAgentDir()>/extension-toggle-collections.json` (normally `~/.pi/agent/extension-toggle-collections.json`). Names are case-sensitive, 1–64 letters, digits, underscores, or hyphens, starting with a letter or digit. Duplicate names are refused, not overwritten. Invalid names or malformed collection data fail without replacing existing data; saves use a temporary file and rename.

`use <name>` waits for idle, writes and flushes global settings, then asks whether to reload immediately in interactive mode. Declining (or applying without an interactive UI) leaves the settings saved and shows a `/reload` reminder. The no-argument command and floating picker are unchanged.

Collection scope and limits:

- Project settings are untouched and can override the restored configuration.
- Package source declarations must match the saved collection exactly, including order and versions. Adding, removing, reordering, or changing a source prevents restoration; save a new collection after such changes.
- The globally configured toggle manager stays enabled. Restoration retains its discovery path when needed and overrides exclusions for its extension without enabling siblings. This is the exception to exact restoration.
- This restores configuration, not a strict allowlist. Newly discovered local resources follow Pi's normal discovery rules.
- Concurrent saves from multiple sessions are last-writer-wins; avoid editing collections concurrently.
- Project collections, individual-resource collection editing, additive collections, automatic reload, and active-collection indicators are not included.

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
