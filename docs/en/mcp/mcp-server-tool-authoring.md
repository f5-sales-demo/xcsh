---
title: MCP Server and Tool Authoring
description: Guide to building custom MCP servers and registering tools for the coding agent.
sidebar:
  order: 4
  label: Server & tool authoring
---

# MCP server and tool authoring

This guide describes how to author Model Context Protocol (MCP) server configurations, expose server tools as agent-callable capabilities, and manage credentials and runtime lifecycle events in the xcsh coding agent.

## Architecture overview

1. **Configuration sources**: Scans `.xcsh/mcp.json`, `~/.xcsh/mcp.json`, and fallback files (`mcp.json`, `.mcp.json`).
2. **Normalization**: Discovery providers normalize server definitions into canonical `MCPServer` objects.
3. **Deduplication**: Resolves duplicate server names by provider priority.
4. **Configuration parsing**: `loadAllMCPConfigs()` converts objects into `MCPServerConfig` instances and excludes disabled entries (`enabled: false`).
5. **Connection and listing**: `MCPManager` establishes connections, injects credentials, and retrieves tool definitions via `tools/list`.
6. **Tool bridging**: `MCPTool` and `DeferredMCPTool` wrap tool definitions into agent tools named `mcp_<SERVER>_<TOOL>`.
7. **Session registration**: `AgentSession.refreshMCPTools()` activates tools in the running session.

## 1. Server configuration schema and validation

`packages/coding-agent/src/mcp/types.ts` defines the supported configuration properties:

- `stdio` (default when `type` is omitted): Requires `command`; accepts optional `args`, `env`, and `cwd`.
- `http`: Requires `url`; accepts optional `headers`.
- `sse`: Requires `url`; accepts optional `headers`.
- Common properties: `enabled`, `timeout`, `auth`, `oauth`.

### Validation rules

`validateServerConfig()` (`packages/coding-agent/src/mcp/config.ts`) enforces the following constraints:

- Rejects configurations specifying both `command` and `url`.
- Requires `command` for `stdio` transports.
- Requires `url` for `http` and `sse` transports.
- Rejects unrecognized `type` values.

`packages/coding-agent/src/mcp/config-writer.ts` validates server identifiers:

- Must not be empty.
- Maximum length of 100 characters.
- Must match the pattern `^[a-zA-Z0-9_.-]+$`.

## 2. Discovery, normalization, and provider precedence

### Capability-based discovery

`loadAllMCPConfigs()` aggregates server definitions across registered capability providers:

1. Evaluates providers in priority order.
2. Deduplicates by `server.name` (highest-priority provider wins).
3. Validates deduplicated items.

> [!IMPORTANT]
> Duplicate server names across different configuration files are shadowed by priority rather than merged.

### Configuration recommendations

- Use `.xcsh/mcp.json` for repository-specific servers and `~/.xcsh/mcp.json` for personal servers.
- Use root `mcp.json` or `.mcp.json` only when maintaining compatibility with external MCP clients.

## 3. Credential and variable resolution

`MCPManager.prepareConfig()` (`packages/coding-agent/src/mcp/manager.ts`) performs environment variable and credential substitution prior to connection:

### OAuth credential injection

When a server defines an OAuth credential binding (`auth: { type: "oauth", credentialId: "<CREDENTIAL_ID>" }`):

- **HTTP / SSE transports**: Injects the `Authorization: Bearer <ACCESS_TOKEN>` request header.
- **`stdio` transport**: Injects the `OAUTH_ACCESS_TOKEN` environment variable into the child process.

### Environment and command expansion

The runtime evaluates `env` and `headers` values using `resolveConfigValue()`:

- **Command execution**: Prefixing a value with `!` executes the string in a shell and uses the trimmed output.
- **Environment substitution**: Looks up environment variable values matching the key name.
- **Literal values**: Falls back to the raw string if no environment variable matches.

## 4. Tool bridging and execution

`packages/coding-agent/src/mcp/tool-bridge.ts` converts MCP tool definitions into `CustomTool` instances:

### Tool naming conventions

Discovered tools are registered using the following template:

```text
mcp_<SANITIZED_SERVER_NAME>_<SANITIZED_TOOL_NAME>
```

Sanitization rules:

- Converts all characters to lowercase.
- Replaces non-alphanumeric characters with underscores (`_`).
- Collapses consecutive underscores.
- Strips redundant `<SERVER>_` prefixes if already present in the tool name.

### Execution handling

`MCPTool.execute()` and `DeferredMCPTool.execute()`:

- Dispatch `tools/call` JSON-RPC requests to the target server.
- Format structured response text for model consumption.
- Catch transport and protocol errors and format them as structured tool error responses.
- Propagate cancellation signals through `ToolAbortError`.

## 5. Management commands and dynamic reload

The interactive CLI provides `/mcp` management commands:

- `/mcp add`: Launches an interactive configuration wizard or quick-add flow.
- `/mcp remove <SERVER_NAME>`: Deletes a server definition and updates configuration files.
- `/mcp enable <SERVER_NAME>` / `/mcp disable <SERVER_NAME>`: Toggles server activation state.
- `/mcp test <SERVER_NAME>`: Tests connection health and retrieves tool schemas.
- `/mcp reload`: Re-scans configuration files and updates live session tools.

Configuration updates are written atomically using temporary files and rename operations.

## 6. Authoring best practices

1. Ensure server names are unique across all configuration files.
2. Use alphanumeric names with hyphens or underscores to ensure clean tool identifiers.
3. Explicitly declare transport `type` (`"http"` or `"stdio"`) rather than relying on defaults.
4. Use `disabledServers` or `enabled: false` to deactivate servers without deleting their configuration.
5. Store sensitive API keys in environment variables and reference them in `env` or `headers` maps.

## Primary implementation files

- `packages/coding-agent/src/mcp/types.ts`: MCP configuration and message type definitions.
- `packages/coding-agent/src/mcp/config.ts`: Configuration loading and validation routines.
- `packages/coding-agent/src/mcp/config-writer.ts`: Atomic configuration write operations.
- `packages/coding-agent/src/mcp/tool-bridge.ts`: Tool wrapper and execution bridges.
- `packages/coding-agent/src/discovery/mcp-json.ts`: Standalone `mcp.json` fallback discovery provider.
- `packages/coding-agent/src/modes/controllers/mcp-command-controller.ts`: Interactive `/mcp` command controllers.
- `packages/coding-agent/src/mcp/manager.ts`: Connection orchestration and tool caching.

