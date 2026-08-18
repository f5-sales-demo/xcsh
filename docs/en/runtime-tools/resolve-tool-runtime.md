---
title: Resolve Tool Runtime Internals
description: Resolve tool runtime for file path resolution, content fetching, and URL-based resource access.
sidebar:
  order: 3
  label: Resolve tool
---

This document describes the preview and commit workflow in `packages/coding-agent` and explains how built-in tools (`ast_edit`) and custom tools participate in deferred execution via `pushPendingAction`.

## Overview of deferred actions

The `resolve` tool provides a confirmation and commit boundary for staged actions:

- **`action: "apply"`**: Executes the `apply(reason)` callback on the active pending action and commits modifications to the filesystem or remote state.
- **`action: "discard"`**: Executes the optional `reject(reason)` callback to discard staged operations and release allocated resources.

If no action is staged when `resolve` is called, the tool returns an error indicating that no pending actions exist.

## Action stack semantics (LIFO)

Pending actions are managed by `PendingActionStore` as a Last-In, First-Out (LIFO) stack:

- `push(action)`: Stages a new pending action at the top of the stack.
- `peek()`: Inspects the active pending action without modifying stack state.
- `pop()`: Removes and returns the top action.
- `hasPending`: Indicates whether uncommitted actions exist.

When multiple previews are registered sequentially, `resolve` processes the most recently staged action first.

## Custom tool integration (`pushPendingAction`)

Custom tools register staged operations through `CustomToolAPI.pushPendingAction(...)`:

```typescript
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

const factory: CustomToolFactory = (pi) => ({
  name: "batch_rename_preview",
  label: "Batch rename preview",
  description: "Stages file rename operations for confirmation via resolve",
  parameters: pi.typebox.Type.Object({
    files: pi.typebox.Type.Array(pi.typebox.Type.String()),
  }),

  async execute(_toolCallId, params) {
    const previewSummary = `Prepared rename plan for ${params.files.length} files`;

    pi.pushPendingAction({
      label: `Batch rename: ${params.files.length} files`,
      sourceToolName: "batch_rename_preview",
      apply: async (reason) => {
        // Execute the atomic file rename operations here
        return {
          content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
        };
      },
      reject: async (reason) => {
        // Optional cleanup on discard
        return {
          content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
        };
      },
    });

    return {
      content: [{ type: "text", text: `${previewSummary}. Run resolve to apply or discard.` }],
    };
  },
});

export default factory;
```

## Related implementation files

- `src/tools/resolve.ts`: Resolve tool implementation and action confirmation handlers.
- `src/tools/pending-action.ts`: `PendingActionStore` stack implementation and action types.
- `src/tools/ast-edit.ts`: AST editing tool producing preview actions.
- `src/extensibility/custom-tools/types.ts`: Custom tool type definitions and API interfaces.
