---
title: RPC Protocol Reference
description: JSON-RPC protocol reference for inter-process communication between xcsh components.
sidebar:
  order: 5
  label: RPC protocol
---

# RPC protocol reference

RPC mode executes the coding agent using a newline-delimited JSON protocol over standard I/O (stdio):

- **stdin**: Inbound commands (`RpcCommand`) and extension UI responses (`RpcExtensionUIResponse`).
- **stdout**: Outbound command responses (`RpcResponse`), session and agent events (`AgentSessionEvent`), and extension UI requests (`RpcExtensionUIRequest`).

Primary implementation files:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## Starting RPC mode

Start the agent in RPC mode using the `--mode rpc` CLI flag:

```bash
xcsh --mode rpc [CLI options]
```

Runtime operational behavior:

- File mention CLI arguments (`@file`) are rejected in RPC mode.
- Automatic session title generation is disabled by default to eliminate redundant model calls.
- Workflow configuration overrides (`todo.*`, `task.*`, `async.*`) reset to built-in defaults rather than inheriting user overrides.
- The process consumes stdin as a JSON Lines stream (`readJsonl(Bun.stdin.stream())`).
- When stdin closes, the process terminates cleanly with exit code `0`.
- Responses and event frames are emitted as individual newline-delimited JSON objects.

## Transport and framing

Each transport frame consists of a single JSON object terminated by a newline (`\n`) character. No additional framing envelope is applied.

### Outbound frame categories (stdout)

1. `RpcResponse` (`{ type: "response", ... }`): Command results and errors.
2. `AgentSessionEvent` (`agent_start`, `message_update`, etc.): Real-time agent and session lifecycle events.
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`): Extension interactive UI requests.
4. Extension errors (`{ type: "extension_error", extensionPath, event, error }`): Extension execution failures.

### Inbound frame categories (stdin)

1. `RpcCommand`: Action and control requests dispatched to the agent.
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`): Interactive UI responses returned to extensions.

## Request and response correlation

All inbound commands accept an optional identifier field (`id?: string`).

- When supplied, command responses echo the identical `id`.
- `RpcClient` relies on this identifier for pending-request resolution.

Special correlation behaviors:

- Unknown command responses return `id: undefined` even if the originating request included an `id`.
- Input parsing errors and handler exceptions emit `command: "parse"` with `id: undefined`.
- `prompt` and `abort_and_prompt` return immediate success responses upon ingestion, but can emit subsequent error responses with the **same** identifier if asynchronous scheduling fails.

## Command schema

The canonical `RpcCommand` schema is defined in `src/modes/rpc/rpc-types.ts`:

### Prompting and control

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### State management

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### Model configuration

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### Thinking configuration

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### Queue modes

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### Compaction

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### Retry control

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Command execution

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### Session operations

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### Message history

- `{ id?, type: "get_messages" }`

## Response schema

All command responses adhere to the `RpcResponse` contract:

- Success: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- Failure: `{ id?, type: "response", command: string, success: false, error: string }`

### `get_state` payload example

```json
{
  "model": { "provider": "anthropic", "id": "claude-3-5-sonnet-20241022" },
  "thinkingLevel": "low",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "interruptMode": "wait",
  "sessionFile": "/path/to/session.json",
  "sessionId": "session-123",
  "sessionName": "Feature Implementation",
  "autoCompactionEnabled": true,
  "messageCount": 12,
  "queuedMessageCount": 0,
  "todoPhases": [
    {
      "id": "phase-1",
      "name": "Implementation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Verify RPC command handling",
          "status": "in_progress"
        }
      ]
    }
  ]
}
```

### `set_todos` payload example

Replaces the in-memory task tracking state for the active session and returns the normalized phases:

```json
{
  "id": "req_2",
  "type": "set_todos",
  "phases": [
    {
      "id": "phase-1",
      "name": "Evaluation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Inspect tool schema",
          "status": "in_progress"
        },
        {
          "id": "task-2",
          "content": "Execute unit tests",
          "status": "pending"
        }
      ]
    }
  ]
}
```

### `set_host_tools` payload example

Replaces the registered host-provided tools that the RPC server can invoke over stdio:

```json
{
  "id": "req_3",
  "type": "set_host_tools",
  "tools": [
    {
      "name": "echo_host",
      "label": "Echo Host",
      "description": "Echoes a value from the embedding host environment",
      "parameters": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"],
        "additionalProperties": false
      }
    }
  ]
}
```

Response payload:

```json
{
  "toolNames": ["echo_host"]
}
```

## Event stream schema

RPC mode streams `AgentSessionEvent` objects dispatched from `AgentSession.subscribe(...)`.

Common event types:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

Extension runner errors emit separately:

```json
{
  "type": "extension_error",
  "extensionPath": "/path/to/extension.ts",
  "event": "tool_call",
  "error": "Execution timed out"
}
```

The `message_update` event provides streaming text, thinking, and tool call deltas within the nested `assistantMessageEvent` structure.

## Prompt and queue concurrency

### Immediate acknowledgment versus run completion

The `prompt` and `abort_and_prompt` commands return an immediate acknowledgment response:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

- Inbound acknowledgment indicates request ingestion, not model run completion.
- Full execution completion is signaled by the outbound `agent_end` event.

### Prompting during active streaming

When an agent turn is actively streaming, `AgentSession.prompt()` requires the `streamingBehavior` parameter:

- `"steer"`: Injects a queued steering message that interrupts execution according to `interruptMode`.
- `"followUp"`: Injects a follow-up message queued for post-turn execution.

Omitting `streamingBehavior` during active streaming causes the prompt request to fail.

### Queue configuration defaults

From the coding agent settings schema (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### Queue mode semantics

- `set_steering_mode` / `set_follow_up_mode`:
  - `"one-at-a-time"`: Dequeues a single queued message per turn.
  - `"all"`: Dequeues the entire message queue in a single batch.
- `set_interrupt_mode`:
  - `"immediate"`: Checks for pending steering messages between tool executions, aborting subsequent tool calls in the active turn.
  - `"wait"`: Defers steering message processing until the active turn completes.

## Extension UI sub-protocol

Extensions running in RPC mode interact with the embedding host using dedicated request/response frames.

### Outbound UI requests

`RpcExtensionUIRequest` (`type: "extension_ui_request"`) methods:

- Dialogs: `select`, `confirm`, `input`, `editor`
- Notifications and state: `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

Terminal title updates (`setTitle`) are suppressed by default because headless hosts do not support a terminal title surface. Set `PI_RPC_EMIT_TITLE=1` to enable title event emission.

Request frame example:

```json
{
  "type": "extension_ui_request",
  "id": "123",
  "method": "confirm",
  "title": "Confirm Action",
  "message": "Proceed with deployment?",
  "timeout": 30000
}
```

### Inbound UI responses

`RpcExtensionUIResponse` (`type: "extension_ui_response"`) payloads:

- Text value: `{ type: "extension_ui_response", id: "123", value: "selected-option" }`
- Confirmation: `{ type: "extension_ui_response", id: "123", confirmed: true }`
- Cancellation: `{ type: "extension_ui_response", id: "123", cancelled: true }`

When dialog timeouts or abort events trigger, RPC mode resolves the request using its configured default fallback value.

## Host tool sub-protocol

Embedding hosts can expose host-native tools to the agent using `set_host_tools` and service execution calls across stdio.

### Outbound tool execution requests

When the agent invokes a host-provided tool, RPC mode emits:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "Hello from agent" }
}
```

If tool execution is subsequently cancelled, RPC mode emits:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### Inbound updates and results

Hosts can stream intermediate progress updates:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "Processing request..." }]
  }
}
```

Final execution completion is signaled by:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "Operation completed successfully" }]
  }
}
```

Set `isError: true` inside `host_tool_result` to signal execution failure to the agent.

## Error handling and recoverability

### Command failures

Command failures return `success: false` with a descriptive `error` message:

```json
{
  "id": "req_2",
  "type": "response",
  "command": "set_model",
  "success": false,
  "error": "Model not found: provider/model"
}
```

### Fault tolerance guarantees

- Command failures do not terminate the RPC process; execution continues normally.
- Malformed JSON Lines and parser exceptions return a `parse` error response and continue reading subsequent lines.
- Invalid requests (such as an empty `set_session_name` value) are rejected with clear error messages.
- Extension UI responses containing unmapped identifiers are dropped safely.
- Process termination occurs only upon stdin stream closure or explicit shutdown commands.

## Common execution workflows

### 1. Prompt and stream

Inbound stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize the repository structure." }
```

Outbound stdout sequence:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "Repository overview..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2. Prompt during active streaming

Inbound stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Highlight potential security risks.", "streamingBehavior": "followUp" }
```

### 3. Inspect and configure queues

Inbound stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4. Extension UI interaction

Outbound stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch Name", "placeholder": "feature/..." }
```

Inbound stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-enhancement" }
```

## RPC client helper library

The helper class in `src/modes/rpc/rpc-client.ts` provides client-side transport management:

- Spawns child processes using `bun <cliPath> --mode rpc`.
- Correlates asynchronous responses with request identifiers (`req_<n>`).
- Dispatches recognized `AgentEvent` objects to registered event listeners.
- Manages host-provided tools via `setCustomTools()` and dispatches `host_tool_call` and `host_tool_cancel` events.

For low-level integrations requiring complete protocol control, send raw JSON Lines frames directly over stdio.

