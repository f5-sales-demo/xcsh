---
title: "Session Operations: Export, Dump, Share, Fork, Resume"
description: Session operations for exporting, sharing, forking, and resuming conversations.
sidebar:
  order: 3
  label: Operations
---

# Session operations: export, dump, share, fork, resume

This document details session lifecycle operations in xcsh: exporting transcripts, generating shareable links, forking session trees, and resuming historical conversations.

## Operation reference matrix

| Operation | Invocation | Persistence behavior | Output artifact |
| --- | --- | --- | --- |
| `/dump` | Slash command | In-memory only | Formatted plain text in clipboard |
| `/export [path]` | Slash command | Reads active session | Standalone HTML transcript file |
| `--export <file> [path]` | CLI flag | Standalone execution | Standalone HTML transcript file |
| `/share` | Slash command | Reads active session | Temporary HTML file + GitHub Gist or custom URL |
| `/fork` | Slash command | Creates new session file | Copies artifact directory into new session namespace |
| `/resume` | Slash command | Switches session file | Rebuilds active chat context |
| `--resume [id\|path]` | CLI flag | Opens or forks session | Restores conversation state at startup |
| `--continue` | CLI flag | Opens recent session | Re-attaches to the most recent workspace session |

## Export and clipboard dump

### HTML export (`/export` and `--export`)

Generate standalone HTML transcripts embedding system prompts, tool invocations, code blocks, and conversation turns:

```bash
# Interactive export
/export ./artifacts/session-summary.html

# Headless CLI export
xcsh --export ~/.xcsh/sessions/abc-123.jsonl ./session-report.html
```

### Clipboard dump (`/dump`)

Copies complete linear conversation context directly to the operating system clipboard, including system guidance, tool declarations, tool outputs, and assistant thinking blocks.

## Share operations (`/share`)

When you execute `/share`, xcsh:

1. Exports the active session to a temporary HTML document in `$TMPDIR`.
2. Checks for custom share handlers located in `~/.xcsh/agent/share.{ts,js,mjs}`.
3. If no custom script is present, creates an unlisted GitHub Gist using the `gh` CLI and generates a `gistpreview.github.io` viewing URL.

## Forking sessions (`/fork`)

Creates an independent branching session from the current conversation point:

1. Flushes unwritten buffer data to disk.
2. Creates a new `.jsonl` file with a unique ID, setting `parentSession` to the prior session ID.
3. Copies associated task artifacts to the new session directory namespace.
4. Switches active execution context to the new branch without interrupting user input.

## Resuming and continuing sessions

- **`/resume`**: Opens an interactive modal listing historical sessions recorded within the current workspace directory.
- **`xcsh --resume <id>`**: Resolves session IDs across project workspaces. If the matched session originated in a different project root, xcsh prompts to fork the session into the current workspace.
- **`xcsh --continue`**: Automatically resumes the last active session associated with the current terminal session or workspace directory.

## Related implementation files

- `src/session/agent-session.ts`: Session lifecycle orchestration (`exportToHtml`, `fork`, `switchSession`).
- `src/session/session-manager.ts`: File persistence, session tree indices, and `.jsonl` management.
- `src/export/html/index.ts`: HTML export rendering engine.
- `src/export/custom-share.ts`: Custom share script resolution and Gist fallback dispatch.
- `src/modes/controllers/command-controller.ts`: Interactive slash command handlers.

