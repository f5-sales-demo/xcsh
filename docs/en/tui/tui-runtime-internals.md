---
title: TUI Runtime Internals
description: Terminal UI runtime internals covering rendering pipeline, input handling, and state management.
sidebar:
  order: 2
  label: Runtime internals
---

# TUI runtime internals

This document describes the runtime execution path of the xcsh terminal interface, from raw input processing to differential terminal screen rendering.

## Architecture layers

- **Terminal engine (`packages/tui`)**: Manages raw terminal state, escape sequence parsing, focus routing, synchronized output, and differential line updates.
- **Application controllers (`packages/coding-agent`)**: Translates agent events, stream deltas, tool executions, and modes into UI components.

## Rendering lifecycle and differential diffing

1. **Input debounce**: Renders coalesce per tick (`process.nextTick`) to eliminate redundant repaints during fast streaming.
2. **Component tree composition**: Root containers (`chatContainer`, `statusContainer`, `todoContainer`, `editorContainer`) render line arrays matching terminal width.
3. **Synchronized rendering**: Emits ANSI synchronized output escapes (`CSI ? 2026 h/l`) to prevent visual tearing during updates.
4. **Differential line updates**: Compares new line buffers against previous frames and writes only modified terminal rows.
5. **Hardware cursor placement**: Resolves `CURSOR_MARKER` positions within the focused component to support IME text input.

## Terminal input and Kitty keyboard protocol

- Uses `StdinBuffer` to reassemble split ANSI escape sequences across data chunks.
- Enables the Kitty keyboard protocol when supported by the host terminal to capture distinct key combinations (for example, distinguishing `Ctrl+Enter` from `Enter`).
- Handles bracketed paste events to preserve multi-line pastes without triggering unwanted line submits.

## Related implementation files

- `packages/tui/src/tui.ts`: Core differential renderer, cursor management, and frame scheduler.
- `packages/tui/src/terminal.ts`: `ProcessTerminal` raw mode and capability discovery.
- `packages/tui/src/stdin-buffer.ts`: Split ANSI escape sequence reassembly.
- `packages/coding-agent/src/modes/interactive-mode.ts`: Interactive mode orchestration and container layout.
- `packages/coding-agent/src/modes/controllers/event-controller.ts`: Agent event dispatch to UI components.
