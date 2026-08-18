---
title: Session Switching and Recent Session Listing
description: Session switching mechanics and recent session listing with search and filtering.
sidebar:
  order: 4
  label: Switching & recent
---

# Session switching and recent session listing

This document describes how xcsh discovers historical sessions, resolves CLI resume targets, presents interactive selection modals, and manages active session switches.

## Session discovery and storage hierarchy

Session files are stored in `.jsonl` format organized by encoded workspace working directory:

```text
~/.xcsh/agent/sessions/--<encoded-workspace-path>--/<session-id>.jsonl
```

### Discovery pipelines

1. **Lightweight summary listing (`getRecentSessions`)**: Reads only the initial 4 KB file prefix from candidate `.jsonl` files to extract titles, timestamps, and introductory prompts without loading full conversation histories into memory.
2. **Comprehensive listing (`SessionManager.list`)**: Parses full session structures to compute message counts, cumulative token stats, tool invocation histories, and compaction checkpoints.

## Resume resolution order

When you pass the `--resume` or `--continue` flags at startup:

1. **Terminal breadcrumbs (`--continue`)**: Inspects `~/.xcsh/agent/terminal-sessions/<terminal-id>` for an active session associated with the current terminal session and workspace directory.
2. **Explicit paths (`--resume <path>`)**: Loads the designated `.jsonl` file directly.
3. **Session ID prefix search (`--resume <id-prefix>`)**: Scans local workspace sessions matching the provided ID prefix. If not found locally, xcsh queries all global sessions and offers to fork matching sessions into the current workspace.
4. **Interactive picker (`--resume`)**: Renders a fuzzy-searchable terminal modal when invoked without arguments.

## Runtime session switching (`switchSession`)

When switching active sessions via `/resume`:

1. Emits the `session_before_switch` lifecycle event (`reason: "resume"`).
2. Aborts any active LLM generation or background tool execution.
3. Clears pending turn, steering, and follow-up message queues.
4. Flushes the persistent write stream of the departing session.
5. Loads the target session `.jsonl` and recalculates context boundaries.
6. Restores model selections and thinking levels associated with the target branch.
7. Emits the `session_switch` event and triggers a full chat viewport re-render.

## Related implementation files

- `src/session/session-manager.ts`: Session storage indexing, breadcrumb caching, and file resolution.
- `src/session/agent-session.ts`: `switchSession()` orchestration and event dispatch.
- `src/cli/session-picker.ts`: Standalone terminal startup session selector.
- `src/modes/components/session-selector.ts`: Interactive TUI session search modal.
- `src/modes/controllers/selector-controller.ts`: Selection event bridge and UI viewport restoration.
