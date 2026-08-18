---
title: Session Storage and Entry Model
description: Append-only session storage model with entry types, persistence, and migration between formats.
sidebar:
  order: 1
  label: Storage & entry model
---

This document defines the storage layout, serialization formats, entry taxonomy, and context reconstruction algorithms used by xcsh.

## Storage directory structure

Sessions persist as newline-delimited JSON (`.jsonl`) files in a directory derived from the working directory:

```text
~/.xcsh/agent/sessions/--<encoded-workspace-path>--/<timestamp>_<sessionId>.jsonl
```

- **Large binary blobs**: Stored in content-addressable storage under `~/.xcsh/agent/blobs/<sha256>`.
- **Terminal breadcrumbs**: Written to `~/.xcsh/agent/terminal-sessions/<terminal-id>` containing the current working directory and active session file path.

## File format and entry schema

The first line of every `.jsonl` file contains the session header. Subsequent lines contain append-only `SessionEntry` records.

### Session header (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/project",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

### Entry taxonomy

All entry records inherit base properties (`id`, `parentId`, `timestamp`):

| Entry type | Description | Context impact |
| --- | --- | --- |
| `message` | Complete user or assistant conversation turn | Emitted directly as an `AgentMessage` |
| `model_change` | Updates active model assignment for a role | Updates model mapping in active context |
| `thinking_level_change` | Updates reasoning/thinking budget | Adjusts thinking parameters |
| `compaction` | Checkpoint summarizing prior turns | Replaces preceding turns with summary text |
| `branch_summary` | Summary of abandoned branch turns | Injected as context on the active leaf |
| `custom_message` | Extension-injected conversational turns | Emitted as user-role context |
| `custom` | Extension state records | Ignored during context reconstruction |
| `label` | Human-readable tag assigned to an entry | Visible in tree selectors |
| `ttsr_injection` | Record of rules triggered during turn generation | Restores rule evaluation state |
| `session_init` | Initial system prompt, tools, and schema configuration | Recorded for headless transcript inspection |
| `mode_change` | Operational mode transitions (`plan`, `none`) | Restores mode state on resume |

## Context reconstruction (`buildSessionContext`)

When xcsh initializes or resumes a session, `buildSessionContext()` reconstructs the LLM prompt payload:

1. Resolves the active `leafId` and traces parent pointers backward to the root entry.
2. Reverses the path to establish chronological execution order.
3. Applies state modifiers (`thinking_level_change`, `model_change`, `mode_change`).
4. If a `compaction` entry exists on the active branch:
   - Prepends the compaction summary text.
   - Appends all entries from `firstKeptEntryId` up to the compaction point.
   - Appends all entries following the compaction point.

## Related implementation files

- `src/session/session-manager.ts`: Storage management, append streams, and context resolution.
- `src/session/messages.ts`: LLM message formatting and prompt serialization.
- `src/session/session-storage.ts`: File and in-memory storage abstractions.
- `src/session/blob-store.ts`: Content-addressable binary blob store.
