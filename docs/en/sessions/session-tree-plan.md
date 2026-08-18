---
title: Session Tree Architecture
description: Session tree architecture with branching, navigation, and parent-child conversation relationships.
sidebar:
  order: 2
  label: Tree architecture
---

# Session tree architecture

This document describes the session tree architecture in xcsh: in-memory tree models, leaf pointer movement, intra-session navigation (`/tree`), and branch forking (`/branch`).

## Data model and leaf semantics

Sessions persist as append-only `.jsonl` entries where each non-header entry contains an `id` and `parentId`:

- **Tree projection**: `SessionManager` indexes entries into an in-memory parent-child graph (`getTree()`).
- **Active leaf (`leafId`)**: Points to the most recent entry on the active conversation branch.
- **Append behavior**: New turns append as direct children of the active `leafId`.
- **Branching**: Moving the leaf pointer does not rewrite historical records — it redirects where subsequent entries attach.

## Navigation and branching commands

### Intra-session navigation (`/tree`)

The `/tree` command navigates conversational history within the current session file:

1. **Target selection**: Presents an interactive tree modal showing turn hierarchy, labels, and timestamps.
2. **Abandoned path collection**: Identifies turns between the previous leaf and the nearest common ancestor.
3. **Optional summarization**: If enabled, summarizes abandoned branch context and attaches a `branch_summary` entry at the new navigation target.
4. **Context reconstruction**: Rebuilds the LLM prompt context from the newly selected branch path (`buildSessionContext()`).

### Branch forking (`/branch`)

The `/branch` command creates an independent session file branched from a historical prompt:

1. Prompts you to select a prior user message.
2. Clones the ancestral history up to the selected message's parent into a new `.jsonl` session file.
3. Prefills the command editor with the original prompt text to allow prompt revision.
4. Switches active execution context to the new session branch.

## Related implementation files

- `src/session/session-manager.ts`: Tree indexing, ancestry resolution, and branch session creation.
- `src/session/agent-session.ts`: `navigateTree()`, branch summarization, and lifecycle hook dispatch.
- `src/modes/components/tree-selector.ts`: Interactive tree visualization and keyboard navigation component.
- `src/modes/controllers/selector-controller.ts`: Selector modal orchestration for `/tree` and `/branch`.
