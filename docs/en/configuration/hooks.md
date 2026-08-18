---
title: Hooks
description: Hook system for pre/post event automation in the coding agent lifecycle.
sidebar:
  order: 4
  label: Hooks
---

# Hooks

This document describes the hook subsystem implementation located in `src/extensibility/hooks/*`.

## Current runtime status

The hook package (`src/extensibility/hooks/`) provides a public API surface, while the default CLI runtime initializes the extension runner path:

- `--hook` operates as an alias for `--extension` (CLI paths merge into `additionalExtensionPaths`).
- Tools are wrapped by `ExtensionToolWrapper` rather than `HookToolWrapper`.
- Context transformations and lifecycle event emissions route through `ExtensionRunner`.

This document covers the hook subsystem implementation (types, loader, runner, and wrapper), including backward-compatibility behaviors and constraints.

## Key files

- `src/extensibility/hooks/types.ts` — Hook context, event types, and result contracts.
- `src/extensibility/hooks/loader.ts` — Module loading and hook discovery bridge.
- `src/extensibility/hooks/runner.ts` — Event dispatch, command lookup, and error signaling.
- `src/extensibility/hooks/tool-wrapper.ts` — Pre-execution and post-execution tool interception wrapper.
- `src/extensibility/hooks/index.ts` — Public module exports and re-exports.

## Hook module anatomy

A hook module must provide a default export of a factory function:

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh";

export default function hook(pi: HookAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
      return { block: true, reason: "blocked by policy" };
    }
  });
}
```

The factory function supports the following operations:

- Register event handlers with `pi.on(...)`.
- Send persistent custom messages with `pi.sendMessage(...)`.
- Persist non-LLM state entries with `pi.appendEntry(...)`.
- Register slash commands via `pi.registerCommand(...)`.
- Register custom message renderers via `pi.registerMessageRenderer(...)`.
- Execute shell commands via `pi.exec(...)`.

## Discovery and loading

`discoverAndLoadHooks(configuredPaths, cwd)` executes the following sequence:

1. Loads discovered hooks from the capability registry (`loadCapability("hooks")`).
2. Appends explicitly configured paths (deduplicating by canonical absolute path).
3. Invokes `loadHooks(allPaths, cwd)`.

`loadHooks` imports each path dynamically and expects a `default` export function.

### Path resolution

`loader.ts` resolves hook paths as follows:

- Absolute paths: Used directly.
- Home directory (`~`) paths: Expanded to the user home directory.
- Relative paths: Resolved against `cwd`.

### Module format requirements

Capability discovery for `hookCapability` scans pre-execution and post-execution shell hooks (such as `.claude/hooks/pre/*` and `.xcsh/.../hooks/pre/*`).

The hook loader uses dynamic module imports requiring a default JavaScript or TypeScript export function. If a discovered file path cannot be imported as a JavaScript/TypeScript module, loading fails and records the failure in `LoadHooksResult.errors`.

## Event surfaces

Hook events are strongly typed in `types.ts`.

### Session events

- `session_start`
- `session_before_switch` — Can return `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` — Can return `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` — Can return `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` — Can return `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` — Can return `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### Agent and context events

- `context` — Can return `{ messages?: Message[] }`
- `before_agent_start` — Can return `{ message?: { customType; content; display; details } }`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Tool interception events

- `tool_call` (pre-execution) — Can return `{ block?: boolean; reason?: string }`
- `tool_result` (post-execution) — Can return `{ content?; details?; isError? }`

```text
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## Execution model and mutation semantics

### 1. Pre-execution: `tool_call`

`HookToolWrapper.execute()` emits `tool_call` before executing the underlying tool:

- If any handler returns `{ block: true }`, execution halts immediately.
- If a handler throws an unhandled error, the wrapper fails closed and blocks execution.
- The returned `reason` string becomes the thrown error message.

### 2. Tool execution

The underlying tool executes normally if no handler blocks the call.

### 3. Post-execution: `tool_result`

Upon successful execution, the wrapper emits `tool_result` containing:

- `toolName`, `toolCallId`, and `input`
- `content`
- `details`
- `isError: false`

If a handler returns overrides:

- `content` can replace the returned result content.
- `details` can replace the returned result details.

On tool failure, the wrapper emits `tool_result` with `isError: true` and the error text content, then rethrows the original error.

### Supported mutations

Hooks can perform the following modifications:

- Mutate LLM context for a single prompt via `context` (message replacement chain).
- Override tool output content and details on successful tool executions (`tool_result`).
- Inject pre-execution messages via `before_agent_start`.
- Control session compaction, branch, and tree operations via `session_before_*` and `session.compacting`.

### Unsupported mutations

This hook implementation does not support:

- Mutating raw tool input parameters in place (handlers can only permit or block via `tool_call`).
- Suppressing thrown tool errors (error handling paths rethrow after emission).
- Overriding the final tool status (`isError`) within `HookToolWrapper`.

## Ordering and conflict resolution

### Discovery-level ordering

Capability providers are sorted in descending order by numeric priority. Deduplication uses the capability key, where the first item encountered wins.

For `hooks`, the capability key is `${type}:${tool}:${name}`. Shadowed duplicates from lower-priority providers are excluded from the active discovery list.

### Load ordering

`discoverAndLoadHooks` constructs a flat `allPaths` list deduplicated by resolved absolute path, and `loadHooks` processes them in order. File ordering within individual directories reflects filesystem `readdir` order without additional sorting.

### Runtime handler ordering

Inside `HookRunner`, handlers execute deterministically in registration sequence:

1. Hook module loading order.
2. Handler registration order per hook and event.

Conflict resolution rules by event type:

- `tool_call`: The last returned result applies unless a handler blocks; any block short-circuits immediately.
- `tool_result`: The last returned override applies without short-circuiting.
- `context`: Chained sequentially; each handler receives the message output of the previous handler.
- `before_agent_start`: The first returned message persists; subsequent messages are ignored.
- `session_before_*`: The latest returned result applies; `cancel: true` short-circuits immediately.
- `session.compacting`: The latest returned result applies.

Command and renderer conflict rules:

- `getCommand(name)` returns the first match across registered hooks.
- `getMessageRenderer(customType)` returns the first match across registered hooks.
- `getRegisteredCommands()` returns all registered commands without deduplication.

## User-interface interactions

`HookUIContext` exposes the following methods:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme` getter

`ctx.hasUI` indicates whether interactive UI capabilities are available.

When running in headless or non-interactive mode:

- `select`, `input`, and `editor` return `undefined`.
- `confirm` returns `false`.
- `notify`, `setStatus`, and `setEditorText` operate as no-ops.
- `getEditorText` returns an empty string (`""`).

### Status line behavior

Status text registered via `ctx.ui.setStatus(key, text)`:

- Persists in a key-value store per status key.
- Sorts alphabetically by key name.
- Sanitizes whitespace (`\r`, `\n`, `\t` convert to spaces; contiguous spaces collapse).
- Joins and truncates content to fit terminal display width.

## Error handling and propagation

### Load-time errors

- Invalid modules or missing default exports are recorded in `LoadHooksResult.errors`.
- Loading continues for remaining valid hook modules.

### Event-time errors

`HookRunner.emit(...)` catches handler errors for most event types, emits a `HookError` event (`hookPath`, `event`, `error`) to registered listeners, and continues execution.

`emitToolCall(...)` applies stricter handling: handler errors propagate to the caller without suppression. In `HookToolWrapper`, any thrown error blocks the tool call fail-closed.

## API examples

### Block unsafe commands

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh";

export default function (pi: HookAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input.command ?? "");
    if (!cmd.includes("rm -rf")) return;

    if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked in headless mode" };
    const confirmed = await ctx.ui.confirm("Dangerous command detected", `Allow execution: ${cmd}`);
    if (!confirmed) return { block: true, reason: "User denied execution" };
  });
}
```

### Redact sensitive tool output

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh";

export default function (pi: HookAPI): void {
  pi.on("tool_result", async event => {
    if (event.toolName !== "read" || event.isError) return;

    const redacted = event.content.map(chunk => {
      if (chunk.type !== "text") return chunk;
      return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
    });

    return { content: redacted };
  });
}
```

### Modify model context

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh";

export default function (pi: HookAPI): void {
  pi.on("context", async event => {
    const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
    return { messages: filtered };
  });
}
```

### Register slash commands

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh";

export default function (pi: HookAPI): void {
  pi.registerCommand("handoff", {
    description: "Create a new session with an initial setup message",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      await ctx.newSession({
        parentSession: ctx.sessionManager.getSessionFile(),
        setup: async sm => {
          sm.appendMessage({
            role: "user",
            content: [{ type: "text", text: "Continue from prior session summary." }],
            timestamp: Date.now(),
          });
        },
      });
    },
  });
}
```

## Exported package surface

`src/extensibility/hooks/index.ts` exports:

- Loading APIs (`discoverAndLoadHooks`, `loadHooks`)
- Runner and wrapper classes (`HookRunner`, `HookToolWrapper`)
- All TypeScript hook types
- Re-export of `execCommand`

The package root (`src/index.ts`) re-exports hook TypeScript types for backward compatibility.
