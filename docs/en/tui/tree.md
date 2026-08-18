---
title: Tree Command Reference
description: /tree command reference for visualizing session history and conversation branches.
sidebar:
  order: 4
  label: /tree command
---

# `/tree` command reference

The `/tree` slash command launches the interactive Session Tree Navigator, allowing you to visually inspect the conversation hierarchy, jump to prior checkpoints, and fork alternate lines of investigation within the current session.

## Opening the tree navigator

Open the tree navigator using any of the following methods:

- Execute `/tree` in the command editor.
- Press `Escape` twice on an empty prompt editor (when configured with default `doubleEscapeAction = "tree"`).
- Execute `/branch` while `doubleEscapeAction = "tree"` is active.

## Navigation and selection semantics

```text
├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Approach A"
│     │  └─ • assistant: "Completed"
│     └─ user: "Approach B"
```

- **Active branch path**: Marked with bullet indicators (`•`).
- **User turns**: Selecting a previous user turn resets the leaf to that prompt's parent and populates the editor with the original text for rapid editing.
- **Assistant/tool turns**: Selecting assistant turns redirects the conversation leaf directly to that point without altering prompt editor text.

## Keyboard shortcuts

| Keybinding | Action |
| --- | --- |
| `Up` / `Down` | Move selection up or down |
| `Left` / `Right` | Page up or down |
| `Enter` | Select active node and navigate |
| `Escape` | Clear active search filter or exit modal |
| `Shift+L` | Attach or edit a text label on the selected node |
| `Ctrl+O` / `Shift+Ctrl+O` | Cycle filter modes forward or backward |
| `Alt+D` / `Alt+T` / `Alt+U` / `Alt+L` / `Alt+A` | Switch directly to `default`, `no-tools`, `user-only`, `labeled-only`, or `all` |

## Related implementation files

- `src/modes/components/tree-selector.ts`: Interactive tree visualization and navigation component.
- `src/modes/controllers/selector-controller.ts`: Selector modal presentation and summarization flows.
- `src/session/agent-session.ts`: `navigateTree()` orchestration.
- `src/session/session-manager.ts`: Tree indexing (`getTree()`) and branch manipulation methods.
