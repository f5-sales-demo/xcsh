---
title: MCP Protocol and Transport Internals
description: MCP protocol implementation with stdio, SSE, and streamable HTTP transport layers.
sidebar:
  order: 2
  label: Protocol & transports
---

# MCP protocol and transport internals

This document describes how the xcsh coding agent implements Model Context Protocol (MCP) JSON-RPC messaging and separates protocol semantics from physical transport layers.

## Scope and responsibilities

- JSON-RPC request-response cycles and notification distribution.
- Request correlation and lifecycle management for `stdio` and HTTP/SSE transports.
- Timeout management and cancellation propagation.
- Error handling, status propagation, and malformed payload recovery.
- Transport boundaries and failure isolation.

## Primary implementation files

- `packages/coding-agent/src/mcp/types.ts`: JSON-RPC protocol and transport type definitions.
- `packages/coding-agent/src/mcp/transports/stdio.ts`: Process-backed `stdio` transport implementation.
- `packages/coding-agent/src/mcp/transports/http.ts`: Streamable HTTP and SSE transport implementation.
- `packages/coding-agent/src/mcp/transports/index.ts`: Transport factory and common interfaces.
- `packages/coding-agent/src/mcp/json-rpc.ts`: Lightweight HTTP JSON-RPC utility functions.
- `packages/coding-agent/src/mcp/client.ts`: High-level MCP client orchestrator.
- `packages/coding-agent/src/mcp/manager.ts`: Multi-server lifecycle and discovery manager.

## Architecture and layer separation

### Protocol layer (`MCPClient`)

The protocol layer coordinates method sequencing, capability negotiation, and message schema enforcement:

1. Handshake initialization: Dispatches `initialize` request with client capabilities.
2. Confirmation: Sends `notifications/initialized` notification upon successful response.
3. Operation invocation: Calls MCP methods (such as `tools/list` and `tools/call`).

### Transport abstraction layer (`MCPTransport`)

The `MCPTransport` interface isolates network and process I/O from client logic:

```ts
interface MCPTransport {
  readonly connected: boolean;
  request<T>(method: string, params?: unknown, options?: RequestOptions): Promise<T>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
  onClose?: () => void;
  onError?: (error: Error) => void;
  onNotification?: (notification: JsonRpcNotification) => void;
}
```

## Transport selection rules

The client factory `createTransport()` instantiates the appropriate transport based on configuration:

- `type: "stdio"` (or omitted `type`): Instantiates `StdioTransport`.
- `type: "http"` or `type: "sse"`: Instantiates `HttpTransport`.

## JSON-RPC message flow and request correlation

### Request correlation identifiers

Transports generate unique alphanumeric correlation identifiers per request using timestamp tokens. These identifiers correlate asynchronous responses with active caller promises.

### `stdio` transport correlation workflow

1. Request serialization: Serializes the request envelope as single-line JSON terminated with `\n`.
2. Tracking: Registers the pending promise resolvers in `#pendingRequests` indexed by request ID.
3. Stream ingestion: Reads stdout via `readJsonl` and processes incoming lines.
4. Resolution: Matches inbound response `id` against `#pendingRequests` to resolve or reject the caller promise.
5. Notification handling: Routes messages with a `method` and no `id` to `onNotification`.

### HTTP transport correlation workflow

1. Request dispatch: Sends an HTTP `POST` request containing the JSON-RPC payload.
2. Standard HTTP responses: Parses JSON response bodies directly and returns the `result` property.
3. Streamable responses (`Content-Type: text/event-stream`): Ingests the SSE event stream, extracting the event matching the active request ID.
4. Stream termination: If the SSE stream terminates without a matching message, the request rejects with a correlation error.

## Transport implementations

### `stdio` transport (`StdioTransport`)

`StdioTransport` manages an isolated operating system subprocess communicating via standard input and output:

- **Initialization**: Spawns the subprocess with configured command arguments, working directory, and environment variables.
- **Stream monitoring**: Concurrently monitors stdout (JSON-RPC messages) and stderr (process diagnostics).
- **Teardown**: Terminates the subprocess, closes I/O pipes, and rejects all pending requests with `Transport closed`.
- **Fault tolerance**: Skips malformed JSON lines on stdout without terminating the connection.

### HTTP and SSE transport (`HttpTransport`)

`HttpTransport` connects to remote endpoints over HTTP and HTTPS:

- **Stateless request dispatch**: Dispatches individual HTTP POST requests for standard operations.
- **Session management**: Extracts and persists `Mcp-Session-Id` response headers across subsequent operations.
- **Session termination**: Issues an HTTP `DELETE` request with the active `Mcp-Session-Id` during teardown.
- **Cancellation**: Combines user `AbortSignal` instances with internal timeout controllers using `AbortSignal.any()`.

## Error handling and failure modes

| Failure scenario | Transport behavior | Recovery action |
|---|---|---|
| Malformed `stdio` JSON line | Drops line; logs debug trace; continues reading stdout. | Server process maintains active connection. |
| Subprocess termination | Rejects all pending requests with `Transport closed`. | Higher-level manager must re-instantiate transport. |
| HTTP non-2xx response | Throws formatted `HTTP <STATUS>: <TEXT>` error. | Caller handles HTTP failure code. |
| SSE stream interruption | Rejects request with `No response received for request ID`. | Caller retries operation. |
| Execution timeout | Aborts request; rejects promise with timeout error. | Caller handles timeout exception. |

## Architectural boundaries

- **Protocol layer**: Owns JSON-RPC schema contracts, method naming, sequence validation, and response parsing.
- **Transport layer**: Owns stream framing, process lifecycle, HTTP connections, I/O timeouts, and network cancellation.

