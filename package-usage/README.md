# Package Usage

> **⚠️ Beta**: This extension is in active development and has not been battle-tested. It needs real-world usage over time to validate that the tracking is accurate and the stale/unused classifications produce useful signals. Feedback and bug reports are welcome.

Passively collects usage statistics for installed Pi packages — see which tools, skills, and commands earn their place in your workflow. Trigger `/package-usage` to view an interactive HTML report, or `/package-usage reset` to clear all counters.

> **Privacy**: All data is stored locally in `~/.pi/agent/package-usage/usage-stats-v1.json`. No usage data is ever transmitted — no telemetry, no analytics service, no network requests. The extension only counts the _fact_ that a resource was used; it does not store prompts, arguments, results, session identifiers, or absolute paths.

## Install

```bash
pi install npm:@petechu/pi-package-usage
/reload
```

## Usage

| Command                      | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `/package-usage`             | Generate and open an HTML usage report                            |
| `/package-usage reset`       | Clear all usage counters (with confirmation)                      |
| `/package-usage reset --yes` | Clear all usage counters (skip confirmation, for non-UI sessions) |

The report groups resources by package, with sortable columns, search, type/status filters, and stale threshold controls. It also surfaces no-longer-installed resources so you can review historical usage from packages you've since removed.

## What is tracked

| Resource     | How it's tracked                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tools**    | `tool_execution_end` event — logged when a tool from an installed package completes execution                                                          |
| **Commands** | `input` event (detects `/commandName` patterns) + a patch on `AgentSession.prototype._tryExecuteExtensionCommand` for extension-registered commands    |
| **Skills**   | `input` event (detects skill names in conversation), plus `tool_result` for `read` invocations on skill files — deduplicated within a 10-second window |

Only resources originating from third-party installed Pi packages (`origin === "package"`) are tracked. Built-in tools, local extensions, and local skills are excluded.

## Design & workflow

The extension has three layers: **tracking**, **storage**, and **reporting**.

### Tracking

On startup, the extension subscribes to Pi events to detect when package resources are used:

- **Tools** — `tool_execution_end` fires each time a tool completes; if the tool belongs to an installed package, its usage is recorded.
- **Commands** — two mechanisms cover both `/command` text typed by the user and commands dispatched internally by Pi's extension runner.
- **Skills** — detected from conversation input and file reads, with a 10-second deduplication window to avoid double-counting when a skill is triggered and its file is simultaneously read.

All trackers resolve the origin of each resource against Pi's registry, filtering out anything that isn't from a third-party package.

### Storage

Usage records are kept in memory as a simple array of `{ packageSource, resourceType, resourceName, count, firstUsed, lastUsed }` objects. A debounced flush (default 2 seconds) writes the in-memory state to `~/.pi/agent/package-usage/usage-stats-v1.json`. On session shutdown the store flushes immediately to ensure nothing is lost.

### Reporting

When `/package-usage` is invoked, the extension:

1. Discovers all currently installed package resources via Pi's package manager.
2. Merges the live install list with stored usage records — resources that are no longer installed are separated into a "historical" section.
3. Classifies each resource as **used** (recent usage), **stale** (last used outside the configured threshold), or **unused** (zero usage count).
4. Embeds the full dataset into a self-contained HTML report and opens it in the browser.

The HTML report is fully interactive — you can search, filter by type or status, sort by usage, adjust the stale threshold, toggle dark mode, and collapse/expand packages.
