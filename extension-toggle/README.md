# pi-extension-toggle

Toggle installed Pi extensions, skills, prompts, and themes. Save named global resource collections to switch configurations while keeping repo-specific settings.

## Install

Requires Pi 1.0.2 or newer.

```bash
pi install npm:@petechu/pi-extension-toggle
```

Run `/reload` in Pi after installation.

## Commands

| Command                         | Action                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| `/extension-toggle`             | Open the resource picker.                                      |
| `/extension-toggle toggle`      | Open the resource picker.                                      |
| `/extension-toggle collections` | Browse, preview, save, rename, and delete collections.         |
| `/extension-toggle save <name>` | Save the current global resource settings as a collection.     |
| `/extension-toggle use <name>`  | Restore a collection to global settings.                       |
| `/extension-toggle list`        | List saved collection names.                                   |
| `/extension-toggle changelog`   | Read release notes for the installed extension-toggle version. |

Use Tab, or your configured completion key, to complete commands. Selecting `use <name>` or typing `/extension-toggle use` shows saved collection names. Completion respects your configured menu size and preserves input history across reloads.

## Resource picker

Run `/extension-toggle`, or press Ctrl+Shift+E to open a floating picker. Pressing Ctrl+Shift+E in the regular picker opens the floating picker. In the floating picker, the shortcut hides or shows the window without losing pending selections.

The picker groups extensions, skills, prompts, and themes by source:

- A package is one toggleable source containing all its resources.
- Each standalone local extension, skill, prompt, or theme is a separate source.

A source starts checked if any of its resources are enabled. Checking a package enables all its resources; unchecking it disables all of them. The toggle manager hides itself from the list.

Type a package name, resource name, or path to filter sources. Search also matches resource types and Pi metadata. Filtering preserves pending selections, including those on hidden rows.

| Key                | Action                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Up / Down          | Select a source.                                                                          |
| Space              | Toggle the selected source.                                                               |
| Ctrl+A             | Check all matching sources, including rows offscreen. With no filter, check every source. |
| Tab                | Switch the save destination between Repo and Global.                                      |
| Backspace / Delete | Remove the last search character.                                                         |
| Ctrl+U             | Clear the search.                                                                         |
| Enter              | Save sources whose checked state changed.                                                 |
| Esc                | Clear the search, or cancel if the search is empty.                                       |
| Ctrl+C             | Cancel without saving.                                                                    |
| ?                  | Show picker help.                                                                         |

The command picker asks whether to reload after saving. The floating picker saves settings and shows a `/reload` reminder. Settings take effect after reload or the next Pi start. Cancelling or applying without changed sources writes nothing.

## Repository persistence

The picker shows the save destination above the search field. Tab changes the destination for that picker only and preserves your search and pending selections. It does not move or delete settings.

| Destination | Settings file                                                         |
| ----------- | --------------------------------------------------------------------- |
| Repo        | `<current directory>/.pi/settings.json`                               |
| Global      | `<getAgentDir()>/settings.json`, normally `~/.pi/agent/settings.json` |

Pi and the picker read global settings and the current directory's `.pi/settings.json`. They do not search parent directories or the Git root for settings. To use repository-root settings, start Pi from that root. Starting Pi in a subdirectory uses that subdirectory's settings instead.

The picker defaults to Repo when the current directory's settings define `packages`, `extensions`, `skills`, `prompts`, or `themes`. Empty arrays count as configuration. Otherwise, it defaults to Global. Unrelated settings, such as the model, do not affect this choice.

Changes go to the selected destination, regardless of a resource's origin. Settings in the other destination remain untouched. Repo settings can override global changes. To make Global the default again, remove the repo resource fields while preserving unrelated settings.

### Package settings

For normal package declarations, disabling writes empty `extensions`, `skills`, `prompts`, and `themes` filters. Enabling removes those filters and stores the package as its source string.

When saving a globally installed package to Repo, the picker writes an `autoload: false` entry that reuses the global installation. Its filters explicitly enable or disable all four resource types, including hidden resources. An existing normal project declaration stays a normal declaration, and a project-only package keeps its own installation.

Relative local package paths become absolute when saved across destinations, unless an equivalent declaration already exists in the destination.

Pi cannot apply package filters to a package declared as a single extension file or a bare extension directory without a `pi` manifest or resource subdirectories. The picker rejects these toggles before writing any selected changes. Put a standalone resource in the top-level `extensions` list, or give a directory package a `pi.extensions` manifest.

### Standalone resource settings

Disabling a standalone resource writes an exact `-path` exclusion. Enabling writes an exact `+path` include that overrides broader exclusions. Saving removes existing exact include or exclude entries for the same path before writing the new one.

Resources saved across destinations also receive an absolute discovery path. Absolute paths are specific to the machine and checkout; they are not portable to another machine.

## Collections

A collection stores the global `packages`, `extensions`, `skills`, `prompts`, and `themes` settings. Package objects retain their exact resource filters and `autoload` value, including empty arrays and partially enabled packages. Missing fields remain missing. Models, credentials, tools, and unrelated settings are not captured or restored.

Collections persist in `<getAgentDir()>/extension-toggle-collections.json`, normally `~/.pi/agent/extension-toggle-collections.json`. Names are case-sensitive and contain 1–64 letters, digits, underscores, or hyphens, starting with a letter or digit. Duplicate names are refused rather than overwritten. Invalid names or malformed collection data fail without replacing existing data. Writes use a temporary file and rename.

### Collection manager

Run `/extension-toggle collections`. Type to filter names, use Up and Down to select a collection, and press Enter to preview its saved settings. Press Enter again to restore it. The preview shows saved filters and unconfigured fields, not the final enabled resources in the current repo.

| Key       | Action                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| Ctrl+S    | Save current global settings under a new name.                                        |
| Ctrl+R    | Rename the selected collection without changing its snapshot.                         |
| Ctrl+D    | Delete the selected collection after confirmation, without changing current settings. |
| Up / Down | Select a collection, or scroll its preview.                                           |
| Ctrl+U    | Clear the name filter.                                                                |
| Esc       | Return from preview, clear the name filter, or close the manager.                     |
| Ctrl+C    | Close the manager.                                                                    |

Collections with mismatched global package sources show `sources changed` and cannot be restored. Saving and renaming use the same name rules and refuse collisions.

### Save and restore commands

Run `/extension-toggle save baseline` to capture the current global resource settings. To capture a different configuration, change resources with the picker set to Global, then run `/extension-toggle save review`.

Run `/extension-toggle list` to see saved names. Run `/extension-toggle use baseline` or `/extension-toggle use review` to restore one.

Restoration waits for idle, replaces the five global resource fields, and flushes settings before prompting for reload. Declining the prompt, or restoring without an interactive UI, leaves the settings saved and shows a `/reload` reminder. Restoring does not change the saved collection.

### Collections and repo settings

A collection is a saved global configuration, not a snapshot of everything enabled in the current repo. Repo settings keep directory-specific choices while collections switch the global configuration.

`save <name>` and Ctrl+S in the collection manager read only global settings, even when the picker defaults to Repo. Saving after a Repo toggle does not capture that toggle. Tab does not change collection scope.

Restoring a collection does not write to `.pi/settings.json`, remove repo overrides, or associate the repo with a collection name. After reload, Pi resolves resources using the restored global settings and the current directory's unchanged repo settings.

For a globally installed package toggled through Repo, its `autoload: false` entry overrides the global resource filters. A Repo-disabled package stays disabled when a collection enables it globally. A Repo-enabled package stays enabled when a collection disables it globally. A normal project package declaration takes precedence over the matching global package instead. Standalone resources retain their repo discovery paths and exact include or exclude patterns across collection switches.

For example, with a globally installed package enabled:

1. Run `/extension-toggle save baseline` to capture the global configuration.
2. Open `/extension-toggle`, select Repo with Tab, disable that package, and apply the change. Only the current directory's `.pi/settings.json` changes.
3. Run `/extension-toggle use baseline` and confirm reload. The package remains disabled in this repo because its repo filters still apply.
4. Start Pi in a directory without that repo override. The package uses the restored global filters and is enabled there.

To let a package follow collections again, remove its repo override from `.pi/settings.json`. Enabling it in Repo writes an explicit enable override; it does not restore inheritance. For a standalone resource, remove its repo include or exclude override and any discovery path added for that override. Preserve unrelated repo settings.

Restoration changes the shared global settings file. Other Pi sessions use those changes on their next reload or start. Later picker changes do not update an existing collection. Save a new name to capture a new global configuration.

### Restoration limits

- Global package source declarations must match the saved collection exactly, including order and versions. Adding, removing, reordering, or changing a global source blocks restoration. Save a new collection after such changes. Project package declarations are not part of this check.
- The globally configured toggle manager stays enabled. Restoration retains its discovery path when needed and overrides exclusions for its extension without enabling siblings. This is the exception to exact restoration.
- Collections restore settings, not a strict resource allowlist. Newly discovered local resources follow Pi's normal discovery rules.
- Concurrent collection saves from multiple sessions are last-writer-wins. Avoid editing collections concurrently.

## Release notes

Run `/extension-toggle changelog` to read the installed extension-toggle release notes. Use Up and Down to scroll, or Page Up and Page Down in regular TUI mode. In fullscreen mode, Pi reserves page keys for transcript scrolling. Esc or Ctrl+C closes the viewer.

At session start or reload, a version increase shows an update hint above the editor. The hint remains until you open the release notes or reload again. The first interactive load records a baseline silently. Unchanged versions, downgrades, and previously announced versions stay quiet. Noninteractive runs do not consume hints. Release notes are not opened automatically or sent to the model.

The viewer reads the `package.json` and `CHANGELOG.md` bundled with the loaded extension. It omits Unreleased sections and releases newer than the installed version. It does not fetch releases, install updates, or show notes for other extensions. Run `/reload` after updating extension files to load the new code.

Seen versions persist in `<getAgentDir()>/extension-toggle/changelog-seen-v1.json`, keyed by installation directory. Different installation paths have separate baselines. Writes use atomic replacement and are serialized within one process. Simultaneous Pi processes can still duplicate hints or lose recorded baselines.
