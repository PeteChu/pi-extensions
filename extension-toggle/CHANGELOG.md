# Changelog

Release notes for `@petechu/pi-extension-toggle`.

## [0.2.0]

### Added

- Named global resource collections, with commands to save and restore them and an interactive manager.
- Argument completion for toggle, collection, and changelog actions.
- `/extension-toggle changelog` to view bundled release notes, with an update hint after upgrading extension-toggle.
- Repo and Global save destinations in both pickers, selectable with Tab. The default is Repo when the current directory has resource configuration, otherwise Global.

### Changed

- Pi 1.0.2 or newer is now required.
- Toggle changes now go to the save destination selected in the picker instead of each resource's original scope.
- Unsupported package declarations are rejected before any selected changes are written.

### Fixed

- Local packages with identical source text in different scopes can be toggled independently.

## [0.1.3]

- Sources now filter as you type without entering a separate search mode.
- Arrow navigation and Space toggling remain available while typing a search query.
- Esc now clears the query before cancelling the picker.

## [0.1.2]

- Added a floating toggle window with the Ctrl+Shift+E shortcut.
- The floating window can be hidden and reopened without losing pending selections.
- Added a help overlay opened with `?` in either picker.

## [0.1.1]

- Rendered lines now fit the available terminal width.

## [0.1.0]

- Added `/extension-toggle` to enable or disable installed resources.
- Added package grouping for bulk toggling and source filtering.
