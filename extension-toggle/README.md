# pi-extension-toggle

Pi extension that lets you enable or disable installed Pi extensions from inside an interactive Pi session.

## Usage

Install or load this package as a Pi package, then run:

```text
/extension-toggle
```

The command shows global and project extensions with their current state:

```text
[x] npm:example-package (global) extensions/main.ts · Enabled
[ ] Project (.pi/) extensions/local.ts · Disabled
```

Select one or more entries with `space`, then press `enter` to apply the toggles. The extension writes the matching global or project settings changes, then asks whether to reload immediately. Confirm the reload for the changes to take effect right away.

## Notes and limitations

- This manages extensions only. It does not manage skills, prompts, or themes.
- It supports global (`~/.pi/agent`) and project (`.pi/`) scopes.
- `pi-extension-toggle` hides itself from the selection list so you cannot disable the manager from its own UI.
