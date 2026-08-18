---
title: MCP Configuration
description: MCP server configuration, validation, and management for the coding agent runtime.
sidebar:
  order: 1
  label: Configuration
---

This guide describes how to register, configure, and validate Model Context Protocol (MCP) servers for the xcsh coding agent runtime.

## Implementation references

- Runtime configuration types: `packages/coding-agent/src/mcp/types.ts`
- Configuration writer: `packages/coding-agent/src/mcp/config-writer.ts`
- Configuration loader and validation: `packages/coding-agent/src/mcp/config.ts`
- Standalone `mcp.json` discovery: `packages/coding-agent/src/discovery/mcp-json.ts`
- JSON Schema definition: `packages/coding-agent/src/config/mcp-schema.json`

## Configuration file locations

The xcsh runtime discovers MCP server definitions from multiple configuration sources. For native configuration, use one of the following locations:

- **Project scope**: `.xcsh/mcp.json`
- **User scope**: `~/.xcsh/mcp.json`

The runtime also supports root-level fallback files for cross-client compatibility:

- `mcp.json`
- `.mcp.json`

> [!TIP]
> Use `.xcsh/mcp.json` for repository-scoped xcsh configurations. Use root `mcp.json` or `.mcp.json` when sharing configurations with external MCP clients.

## Schema declaration

Include the `$schema` reference in your configuration file to enable validation and autocompletion in your editor:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

CLI management commands (`/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth`) insert this schema reference automatically.

## Configuration file structure

MCP configuration files use the following schema:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  },
  "disabledServers": ["legacy-server"]
}
```

### Top-level properties

- `$schema`: Optional URI referencing the JSON schema.
- `mcpServers`: Key-value map of server identifiers to server configuration objects.
- `disabledServers`: Array of server identifiers to exclude from discovery.

Server identifiers must match the regular expression `^[a-zA-Z0-9_.-]{1,100}$`.

## Server configuration properties

### Shared properties

The following properties apply to all transport types:

- `enabled`: Boolean flag indicating whether the server is active. Defaults to `true`.
- `timeout`: Connection timeout in milliseconds.
- `auth`: Authentication metadata for OAuth or API key token retrieval.
- `oauth`: Explicit OAuth 2.0 client credentials and endpoint parameters.

### Standard input and output (`stdio`) transport

`stdio` serves as the default transport when `type` is omitted.

#### stdio required properties

- `command`: The executable binary or script to invoke.

#### stdio optional properties

- `type`: Explicitly set to `"stdio"`.
- `args`: Array of command-line arguments.
- `env`: Environment variable map passed to the subprocess.
- `cwd`: Working directory path for the subprocess.

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/data/projects",
        "/data/documents"
      ]
    }
  }
}
```

### Streamable HTTP (`http`) transport

Streamable HTTP connects to remote endpoints supporting HTTP POST requests with streaming responses.

#### HTTP required properties

- `type`: Set to `"http"`.
- `url`: Target HTTP or HTTPS endpoint URI.

#### HTTP optional properties

- `headers`: HTTP headers sent with each request.

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Server-sent events (`sse`) transport

> [!NOTE]
> The `sse` transport remains supported for legacy integrations. New hosted deployments should use Streamable HTTP (`type: "http"`).

#### SSE required properties

- `type`: Set to `"sse"`.
- `url`: Target SSE endpoint URI.

#### SSE optional properties

- `headers`: HTTP headers sent during connection initialization.

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "remote-service": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

## Authentication configuration

### Authentication descriptor (`auth`)

```json
{
  "type": "oauth",
  "credentialId": "<CREDENTIAL_ID>",
  "tokenUrl": "https://auth.example.com/oauth/token",
  "clientId": "<CLIENT_ID>",
  "clientSecret": "<CLIENT_SECRET>"
}
```

Use `auth` to persist credential binding metadata across agent sessions.

### OAuth client configuration (`oauth`)

```json
{
  "clientId": "<CLIENT_ID>",
  "clientSecret": "<CLIENT_SECRET>",
  "redirectUri": "http://localhost:3334/oauth/callback",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

Use `oauth` when a server endpoint requires confidential OAuth 2.0 client authorization flows.

#### Slack MCP server example

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "<SLACK_CLIENT_ID>",
        "clientSecret": "<SLACK_CLIENT_SECRET>"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "<SLACK_CLIENT_ID>",
        "clientSecret": "<SLACK_CLIENT_SECRET>"
      }
    }
  }
}
```

## Configuration examples

### Local Docker container via `stdio`

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

## Variable resolution and secrets management

### Resolution within `.xcsh/mcp.json`

Before initializing a server process or issuing HTTP requests, the runtime evaluates values in `env` and `headers`:

1. **Command execution**: If a value begins with `!`, the runtime executes the string as a shell command and captures standard output.
2. **Environment substitution**: If a value matches an active environment variable name, the runtime substitutes its value.
3. **Literal values**: If no environment variable matches, the string is treated as a literal value.

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\"",
    "X-Custom-Header": "literal-value"
  }
}
```

### Resolution within root `mcp.json` and `.mcp.json`

Fallback discovery loaders expand `${VAR}` and `${VAR:-default}` syntax during file parsing:

```json
{
  "mcpServers": {
    "remote-api": {
      "type": "http",
      "url": "https://api.example.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

## Disabling discovered servers (`disabledServers`)

Define `disabledServers` in `~/.xcsh/mcp.json` to prevent specific servers discovered from third-party tools from loading:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["unwanted-server", "legacy-endpoint"]
}
```

## Management commands

- `/mcp add`: Interactive wizard for configuring new MCP servers.
- `/mcp reload`: Re-scans configuration files and reconnects active servers.
- `/mcp list`: Displays configured servers and origin configuration paths.
- `/mcp test <SERVER_NAME>`: Validates connection health and retrieves tool schemas for a specific server.

## Validation rules

`validateServerConfig` (`packages/coding-agent/src/mcp/config.ts`) enforces the following invariants:

- `stdio` servers require `command`.
- `http` and `sse` servers require `url`.
- A single server definition cannot declare both `command` and `url`.
- Unrecognized `type` values are rejected.

## Troubleshooting

### `Server "<NAME>": stdio server requires "command" field`

Remote endpoints require `"type": "http"`. When `type` is omitted, the runtime defaults to `stdio` and requires a `command` property.

### `Server "<NAME>": both "command" and "url" are set`

Select a single transport type. Use `command` for local subprocesses or `url` for HTTP and SSE endpoints.

### Server connection failures

Run `/mcp test <SERVER_NAME>` to inspect error output and verify:

- The local binary or container image is installed and executable.
- Required environment variables and credentials are defined.
- Remote network endpoints are reachable without firewall blocks.
- OAuth tokens or API keys remain valid.
