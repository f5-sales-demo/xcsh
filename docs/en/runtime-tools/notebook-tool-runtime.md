---
title: Notebook Tool Runtime Internals
description: Jupyter notebook tool runtime with cell execution, kernel lifecycle, and output rendering.
sidebar:
  order: 2
  label: Notebook tool
---

This document describes the architectural differences and boundaries between the `notebook` editing tool and the kernel-backed `python` execution runtime in `packages/coding-agent`.

> [!IMPORTANT]
> The `notebook` tool is a structural JSON editor for `.ipynb` notebook files. It does not spawn Jupyter kernels or execute Python code. To execute code cells interactively, use the `python` tool.

## Architectural boundary: editing vs. execution

### Notebook manipulation (`src/tools/notebook.ts`)

The `notebook` tool performs atomic JSON mutations on `.ipynb` files on disk:

- **Supported actions**: `edit`, `insert`, and `delete` operations targeting cell indices.
- **Path resolution**: Resolves notebook paths relative to session workspace roots (`resolveToCwd`).
- **Formatting**: Serializes modified notebook structures using formatted JSON (`JSON.stringify(notebook, null, 1)`).
- **Execution isolation**: Does not interact with Jupyter Kernel Gateways, WebSocket communication channels, or runtime execution queues.

### Python cell execution (`src/tools/python.ts`, `src/ipy/*`)

Interactive execution of cell-style code is handled exclusively by the `python` tool:

- Manages Jupyter Kernel Gateway processes and session lifecycles.
- Multiplexes WebSocket channels for message passing (`stream`, `display_data`, `execute_result`).
- Formats structured outputs, MIME bundles, and status events.
- Enforces execution timeouts and cooperative kernel interruptions.

## Cell manipulation semantics

### Source normalization

When modifying cell content, xcsh splits incoming source text into string arrays preserving line endings (`\n`). This aligns with Jupyter JSON schema conventions and prevents unintended newline collapsing during incremental edits.

### Mutation actions

- `edit`: Replaces `source` lines for `cells[cell_index]` while preserving existing metadata and `cell_type`.
- `insert`: Adds a new cell at the specified index. Defaults to `cell_type: "code"` with empty outputs and execution counters.
- `delete`: Removes the cell at `cell_index` and returns the deleted source in operation details.

## Related implementation files

- `src/tools/notebook.ts`: Notebook JSON editor and TUI cell diff renderer.
- `src/tools/python.ts`: Interactive Python REPL tool definition.
- `src/ipy/executor.ts`: Jupyter kernel session pooling and execution queue manager.
- `src/ipy/kernel.ts`: Kernel lifecycle and WebSocket protocol handler.
- `src/session/streaming-output.ts`: Streaming output sink and artifact spillover.
