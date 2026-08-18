---
title: Extensions
description: Extension runtime overview covering types, runner lifecycle, registration, and discovery.
sidebar:
  order: 1
  label: Overview
---

This document details the extension system for the xcsh coding agent runtime.

Implementation files:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

For discovery paths and filesystem scanning rules, see [Extension loading](file:///data/robin-GIT/language-improvement/xcsh/docs/en/extensions/extension-loading.md).

## Extension architecture

An extension is a TypeScript or JavaScript module that exports a default factory function:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
  // Register event handlers, tools, commands, and renderers
}
```

A single extension module can register and combine multiple capabilities:

- Lifecycle event handlers (`pi.on(...)`)
- LLM-callable tools (`pi.registerTool(...)`)
- Interactive slash commands (`pi.registerCommand(...)`)
- Keyboard shortcuts and CLI flags
- Custom message renderers
- Message injection APIs (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Runtime execution model

The extension lifecycle proceeds through the following stages:

1. Dynamic import: The runtime imports modules and executes their exported factory functions.
2. Registration: Factory functions register tools, commands, and event handlers. Calling runtime action methods during this phase is disallowed.
3. Initialization: `ExtensionRunner.initialize(...)` binds live contexts and action dispatchers for the active execution mode.
4. Event dispatch: The runner emits lifecycle events to registered handlers.
5. Tool interception: The runtime wraps every tool invocation with `tool_call` and `tool_result` middleware handlers.

Calling runtime action methods (such as `pi.sendMessage()`) during the initial loading phase throws `ExtensionRuntimeNotInitializedError`. Complete all registrations first, and perform runtime actions from within event handlers, command callbacks, or tool execution functions.

## Quick start guide

The following example registers an extension with event interception, a custom tool, and a slash command:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.setLabel("Safety and Utilities");

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      return { block: true, reason: "Command blocked by security policy." };
    }
  });

  pi.registerTool({
    name: "hello_extension",
    label: "Hello Extension",
    description: "Returns a friendly greeting.",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: { greeted: params.name },
      };
    },
  });

  pi.registerCommand("check-queue", {
    description: "Displays pending message queue status.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Pending messages: ${ctx.hasPendingMessages()}`, "info");
    },
  });
}
```

## Extension API reference

### 1. Registration and action APIs (`ExtensionAPI`)

Core methods available on the `pi` API object:

- `on(event, handler)`: Subscribes to lifecycle and operational events.
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`: Registers capabilities.
- `registerMessageRenderer`: Registers custom UI component renderers.
- `sendMessage`, `sendUserMessage`, `appendEntry`: Injects messages and custom session state entries.
- `getActiveTools`, `getAllTools`, `setActiveTools`: Inspects and reconfigures active tools.
- `getSessionName`, `setSessionName`: Inspects and updates session titles.
- `setModel`, `getThinkingLevel`, `setThinkingLevel`: Reconfigures active models and reasoning levels.
- `registerProvider`: Registers custom LLM inference providers.
- `events`: Exposes the shared event bus.

In interactive mode, `input` handlers execute prior to automatic session titling. Extensions calling `await pi.setSessionName(...)` within an `input` handler set a persistent title and bypass automatic title generation.

Utility exports on the API object:

- `pi.logger`: Structured logger.
- `pi.typebox`: TypeBox schema builder.
- `pi.pi`: Re-exported package symbols.

#### Message delivery semantics

`pi.sendMessage(message, options)` supports the following delivery policies:

- `deliverAs: "steer"` (default): Interrupts the current agent run immediately.
- `deliverAs: "followUp"`: Queues the message for execution after the current run completes.
- `deliverAs: "nextTurn"`: Preserves the message to inject into the subsequent user turn.
- `triggerTurn: true`: Initiates an agent turn when idle (ignored for `nextTurn`).

`pi.sendUserMessage(content, { deliverAs })` processes input through the prompt pipeline. During streaming, it queues as a steering or follow-up turn.

### 2. Handler execution context (`ExtensionContext`)

Event handlers and tool `execute` callbacks receive a context object containing:

- `ui`: User interface controller (`ExtensionUIContext`).
- `hasUI`: Boolean indicating interactive UI availability.
- `cwd`: Active working directory path.
- `sessionManager`: Read-only session management interface.
- `modelRegistry`, `model`: Active model metadata and registry instance.
- `getContextUsage()`: Returns context window token utilization.
- `compact(...)`: Triggers session compaction.
- `isIdle()`, `hasPendingMessages()`, `abort()`: Runtime status queries and cancellation.
- `shutdown()`: Terminates the agent process.
- `getSystemPrompt()`: Returns the active system prompt string.

### 3. Command execution context (`ExtensionCommandContext`)

Slash command handlers receive an extended context with session-control operations:

- `waitForIdle()`: Waits for active streaming to complete.
- `newSession(...)`: Initializes a fresh session.
- `switchSession(...)`: Switches to an existing session file.
- `branch(entryId)`: Forks a session branch from a specific history entry.
- `navigateTree(targetId, { summarize })`: Navigates to a specific node in the session tree.
- `reload()`: Reloads the active configuration and extension suite.

## Event system reference

### Session lifecycle events

- `session_start`: Dispatched after session initialization.
- `session_before_switch`, `session_switch`: Dispatched prior to and following a session switch.
- `session_before_branch`, `session_branch`: Dispatched prior to and following a branch fork.
- `session_before_compact`, `session.compacting`, `session_compact`: Dispatched during compaction.
- `session_before_tree`, `session_tree`: Dispatched during session tree traversal.
- `session_shutdown`: Dispatched before process termination.

Cancelable pre-event return structures:

- `session_before_switch`: Returns `{ cancel?: boolean }`.
- `session_before_branch`: Returns `{ cancel?: boolean; skipConversationRestore?: boolean }`.
- `session_before_compact`: Returns `{ cancel?: boolean; compaction?: CompactionResult }`.
- `session_before_tree`: Returns `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`.

### Prompt and turn lifecycle events

- `input`: Dispatched when the user submits input.
- `before_agent_start`: Dispatched before model invocation.
- `context`: Dispatched during prompt context assembly.
- `agent_start`, `agent_end`: Dispatched at the boundaries of an overall agent task.
- `turn_start`, `turn_end`: Dispatched at the boundaries of a single model inference turn.
- `message_start`, `message_update`, `message_end`: Dispatched during message generation and streaming.

### Tool lifecycle events

- `tool_call`: Dispatched before tool execution. Handlers can block execution by returning `{ block: true, reason: "..." }`.
- `tool_result`: Dispatched after execution. Middleware handlers can modify `content`, `details`, or `isError`.
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`: Observability events for progress tracking.

### Operational and reliability events

- `auto_compaction_start`, `auto_compaction_end`: Auto-compaction boundaries.
- `auto_retry_start`, `auto_retry_end`: Model request retry attempts.
- `ttsr_triggered`: Test-time self-reflection event triggers.
- `todo_reminder`: Task tracking reminders.

### User command interception

- `user_bash`: Intercepts interactive bash commands (override with `{ result }`).
- `user_python`: Intercepts interactive Python commands (override with `{ result }`).

## Tool implementation reference

Register tools using `pi.registerTool(...)` with the following schema:

```ts
pi.registerTool({
  name: "custom_analyzer",
  label: "Custom Analyzer",
  description: "Analyzes workspace configuration files.",
  parameters: Type.Object({
    targetPath: Type.String(),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Execution cancelled." }] };
    }
    onUpdate?.({ content: [{ type: "text", text: "Analyzing configuration..." }] });
    return {
      content: [{ type: "text", text: "Analysis complete." }],
      details: { target: params.targetPath, status: "clean" },
    };
  },
  onSession(event, ctx) {
    // Handles session lifecycle transitions (start, switch, branch, shutdown)
  },
  renderCall(args, theme) {
    // Optional TUI call renderer
  },
  renderResult(result, options, theme, args) {
    // Optional TUI result renderer
  },
});
```

Tool interception via `tool_call` and `tool_result` applies globally to all registered tools, including built-in tools.

## User interface integration

`ctx.ui` provides the `ExtensionUIContext` interface across execution modes.

### Interactive terminal mode

Supported capabilities:

- Dialogs: `select`, `confirm`, `input`, `editor`.
- Notifications, status updates, editor text replacement, and custom overlays.
- Theme listing and switching via `setTheme`.
- Tool display expansion toggling.

`setFooter`, `setHeader`, and `setEditorComponent` are reserved for custom layouts and act as no-ops in standard TUI views. `setWidget` routes status text to the terminal status bar.

### RPC mode

In RPC mode, UI calls dispatch newline-delimited JSON frames over stdio:

- Interactive dialogs (`select`, `confirm`, `input`, `editor`) await host responses.
- Notifications and state updates (`notify`, `setStatus`, `setWidget`, `setTitle`, `setEditorText`) emit asynchronous events.

Terminal input listeners, custom overlays, and theme switching are disabled in headless RPC mode.

### Headless and subagent modes

When running in print, subagent, or headless environments, `ctx.hasUI` evaluates to `false`, and UI methods return default fallback values immediately.

## Session state management

To persist extension state across session switches and restarts:

1. Record state updates using `pi.appendEntry("custom_type", stateData)`.
2. Restore state during `session_start`, `session_branch`, or `session_tree` by querying `ctx.sessionManager.getBranch()`.
3. Store structured data in tool result `details` objects so state remains reconstructible from history.

State reconstruction pattern:

```ts
pi.on("session_start", async (_event, ctx) => {
  let restoredState: unknown = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "my-extension-state") {
      restoredState = entry.data;
    }
  }
  if (restoredState) {
    // Reinitialize extension state
  }
});
```

## Custom visual renderers

### Custom message renderer

```ts
pi.registerMessageRenderer("custom-result", (message, { expanded }, theme) => {
  // Return a pi-tui Component for TUI rendering
});
```

### Custom tool renderer

Define `renderCall` and `renderResult` within `registerTool` to render specialized TUI widgets for tool arguments and results.

## Operational constraints

- Runtime actions are unavailable during the initial module loading phase.
- Handlers returning `{ block: true }` in `tool_call` fail closed and prevent tool execution.
- Command names matching existing built-in commands are ignored with diagnostic warnings.
- Reserved keyboard shortcuts cannot be overridden (`Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+K`, `Ctrl+P`, `Ctrl+L`, `Ctrl+O`, `Ctrl+T`, `Ctrl+G`, `Shift+Tab`, `Shift+Ctrl+P`, `Alt+Enter`, `Escape`, `Enter`).
- Invoking `ctx.reload()` terminates the active command execution frame.

## Comparing extensions, hooks, and custom tools

- **Extensions** (`src/extensibility/extensions/*`): Unified extension surface supporting events, tools, slash commands, UI renderers, and custom model providers.
- **Hooks** (`src/extensibility/hooks/*`): Dedicated event handling subsystem.
- **Custom tools** (`src/extensibility/custom-tools/*`): Focused tool definitions adapted automatically into the extension tool registry.

When building packages that require coordinated policy enforcement, custom tools, slash commands, and user interface elements, use the unified extension system.
