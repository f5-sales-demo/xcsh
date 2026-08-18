---
title: MCP Runtime Lifecycle
description: MCP server process lifecycle from initialization through tool registration, health monitoring, and shutdown.
sidebar:
  order: 3
  label: Runtime lifecycle
---

This document describes how Model Context Protocol (MCP) servers are discovered, connected, exposed as agent tools, refreshed, and terminated in the xcsh coding agent runtime.

## Lifecycle overview

1. **Session initialization**: `createAgentSession()` invokes `discoverAndLoadMCPTools()` (unless MCP is explicitly disabled).
2. **Discovery**: `loadAllMCPConfigs()` discovers MCP server configurations across capability sources and applies filters.
3. **Connection phase**: `MCPManager.connectServers()` initiates concurrent connections and issues `tools/list` requests.
4. **Fast startup gate**: Waits up to 250 milliseconds:
   - Returns live `MCPTool` instances for completed connections.
   - Registers error records for failed servers.
   - Instantiates cached `DeferredMCPTool` instances for pending connections.
5. **Tool registration**: Merges MCP tools into the runtime session tool registry under `mcp_<SERVER>_<TOOL>` identifiers.
6. **Live session management**: `/mcp reload` re-scans configurations and updates active tools dynamically.
7. **Session teardown**: Invokes `disconnectServer()` or `disconnectAll()` to terminate subprocesses and close connections.

## Discovery and loading

### SDK startup integration

`createAgentSession()` (`packages/coding-agent/src/sdk.ts`) manages MCP initialization:

- Calls `discoverAndLoadMCPTools(cwd, { ... })`.
- Passes authentication storage, cache storage, and project configuration flags.
- Isolates per-server connection errors so individual server failures do not block session startup.
- Stores the initialized manager instance on `toolSession.mcpManager`.

### Configuration filtering

`loadAllMCPConfigs()` (`packages/coding-agent/src/mcp/config.ts`) applies the following filters:

- `enableProjectConfig: false`: Excludes project-level configurations (`_source.level === "project"`).
- `enabled: false`: Skips explicitly disabled server definitions.
- Exa servers: Filtered out for direct handling by native Exa search capabilities.

## Manager state model

`MCPManager` tracks runtime state across internal registries:

- `#connections`: Map of active, fully connected `MCPServerConnection` instances.
- `#pendingConnections`: Map of connection promises currently performing handshake negotiation.
- `#pendingToolLoads`: Map of connected servers awaiting tool listing completion.
- `#tools`: Array of active `CustomTool` instances exposed to the agent.
- `#sources`: Map of source metadata tracking configuration origin.

`getConnectionStatus(name)` reports one of three states:

- `connected`: Active connection registered in `#connections`.
- `connecting`: Handshake or tool listing in progress.
- `disconnected`: Server is inactive or failed.

## Connection establishment and caching

### Fast startup gate

To prevent slow MCP servers from delaying CLI startup, `connectServers()` races connection establishment against a 250 millisecond threshold:

- **Settled connections**: Instantiates active `MCPTool` instances immediately.
- **Pending connections with cache hits**: Returns `DeferredMCPTool` instances populated from `MCPToolCache` without blocking startup.
- **Pending connections without cache**: Blocks until connections establish or fail.

### Background completion

Pending connection promises continue executing in the background:

- Updates the active tool collection in the manager via `#replaceServerTools`.
- Persists discovered tool schemas to disk cache.
- Logs late-stage connection failures.

## Runtime tool invocation

- `MCPTool`: Invokes operations directly through established connections.
- `DeferredMCPTool`: Awaits `waitForConnection(server)` before dispatching tool calls, ensuring tool schemas are visible to the model while connections finish establishing.

Both wrapper types catch transport and tool errors and format them as structured tool error responses.

## Dynamic reload and refresh

Executing `/mcp reload` updates server configurations during an active session:

1. Invokes `mcpManager.disconnectAll()`.
2. Discovers configurations and establishes connections via `mcpManager.discoverAndConnect()`.
3. Invokes `session.refreshMCPTools(mcpManager.getTools())` to rebind tools in the session registry without restarting the process.

## Teardown semantics

### Server disconnection (`disconnectServer`)

- Cancels pending connection promises and removes source metadata.
- Closes the active transport.
- Removes associated `mcp_` tools from the manager registry.

### Global disconnection (`disconnectAll`)

- Concurrently closes all active transports via `Promise.allSettled`.
- Clears connection maps, pending promises, and registered tools.

## Failure modes and recovery

| Scenario | Runtime behavior | Impact |
| --- | --- | --- |
| Configuration parse error | Loader returns empty tool collection with synthetic error record. | Session starts; error logged. |
| Invalid server definition | Server is skipped with validation error. | Healthy servers continue. |
| Handshake timeout | Connection recorded as failed. | Other servers load normally. |
| Delayed tool listing (cached) | Instantiates `DeferredMCPTool` instances immediately. | Session starts without delay. |
| Delayed tool listing (uncached) | Startup blocks until connection settles. | Guarantees tool availability. |
| Runtime connection drop | Tool calls return errors until `/mcp reload` is executed. | Manual reload required. |

## Primary implementation files

- `packages/coding-agent/src/mcp/loader.ts`: Discovery normalization and `LoadedCustomTool` conversion.
- `packages/coding-agent/src/mcp/manager.ts`: Connection lifecycle, parallel handshake orchestration, and tool caching.
- `packages/coding-agent/src/mcp/client.ts`: Transport setup and MCP JSON-RPC protocol handling.
- `packages/coding-agent/src/mcp/tool-bridge.ts`: `MCPTool` and `DeferredMCPTool` bridge implementations.
- `packages/coding-agent/src/session/agent-session.ts`: Session tool registration and dynamic refresh.
- `packages/coding-agent/src/modes/controllers/mcp-command-controller.ts`: Interactive `/mcp` command controllers.
