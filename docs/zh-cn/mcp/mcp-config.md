---
title: MCP 配置
description: 编码代理运行时的 MCP 服务器配置、验证和管理。
sidebar:
  order: 1
  label: 配置
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# OMP 中的 MCP 配置

本指南介绍如何为 OMP 编码代理添加、编辑和验证 MCP 服务器。

代码中的权威来源：

- 运行时配置类型：`packages/coding-agent/src/mcp/types.ts`
- 配置写入器：`packages/coding-agent/src/mcp/config-writer.ts`
- 加载器 + 验证：`packages/coding-agent/src/mcp/config.ts`
- 独立 `mcp.json` 发现：`packages/coding-agent/src/discovery/mcp-json.ts`
- Schema：`packages/coding-agent/src/config/mcp-schema.json`

## 首选配置位置

OMP 可以从多种工具（`.claude/`、`.cursor/`、`.vscode/`、`opencode.json` 等）发现 MCP 服务器，但对于 OMP 原生配置，通常应使用以下文件之一：

- 项目级别：`.xcsh/mcp.json`
- 用户级别：`~/.xcsh/mcp.json`

OMP 还接受项目根目录中的备用独立文件：

- `mcp.json`
- `.mcp.json`

当你希望由 OMP 管理配置时，使用 `.xcsh/mcp.json`。仅当你需要一个其他 MCP 客户端也可能读取的可移植备用文件时，才使用根目录的 `mcp.json` / `.mcp.json`。

## 添加 schema 引用

在文件顶部添加以下内容以获得编辑器自动补全和验证：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

当 `/mcp add`、`/mcp enable`、`/mcp disable`、`/mcp reauth` 或其他配置写入流程创建或更新 OMP 管理的 MCP 文件时，OMP 现在会自动写入此内容。

## 文件结构

OMP 支持以下顶层结构：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

顶层键：

- `$schema` — 可选的 JSON Schema URL，用于工具支持
- `mcpServers` — 服务器名称到服务器配置的映射
- `disabledServers` — 用户级别的拒绝列表，用于按名称关闭已发现的服务器

服务器名称必须匹配 `^[a-zA-Z0-9_.-]{1,100}$`。

## 支持的服务器字段

所有传输方式共享的字段：

- `enabled?: boolean` — 当值为 `false` 时跳过该服务器
- `timeout?: number` — 连接超时时间（毫秒）
- `auth?: { ... }` — OMP 用于 OAuth/API 密钥流程的认证元数据
- `oauth?: { ... }` — 在认证/重新认证期间使用的显式 OAuth 客户端设置

### `stdio` 传输

当省略 `type` 时，默认使用 `stdio`。

必需：

- `command: string`

可选：

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

示例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

这遵循了官方文件系统 MCP 服务器包（`@modelcontextprotocol/server-filesystem`）。

### `http` 传输

必需：

- `type: "http"`
- `url: string`

可选：

- `headers?: Record<string, string>`

示例：

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

这与 GitHub 托管的 GitHub MCP 服务器端点一致。

### `sse` 传输

必需：

- `type: "sse"`
- `url: string`

可选：

- `headers?: Record<string, string>`

示例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` 仍然支持以保持兼容性，但 MCP 规范现在建议新服务器使用 Streamable HTTP（`type: "http"`）。

## 认证字段

OMP 支持两种与认证相关的对象。

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

当需要 OMP 记住如何为服务器恢复凭据时，使用此配置。

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

当 MCP 服务器需要显式 OAuth 客户端设置时，使用此配置。

Slack 是当前最清晰的示例。Slack 的 MCP 服务器托管在 `https://mcp.slack.com/mcp`，使用 Streamable HTTP，并要求使用 Slack 应用的客户端凭据进行机密 OAuth 认证。

示例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

来自 Slack 文档的相关端点：

- MCP 端点：`https://mcp.slack.com/mcp`
- 授权端点：`https://slack.com/oauth/v2_user/authorize`
- 令牌端点：`https://slack.com/api/oauth.v2.user.access`

## 常用复制粘贴示例

### 通过 stdio 使用文件系统服务器

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### 通过 HTTP 使用 GitHub 托管服务器

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

### 通过 Docker 使用 GitHub 本地服务器

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

这与 GitHub 官方本地 Docker 镜像 `ghcr.io/github/github-mcp-server` 一致。

### 通过 OAuth 使用 Slack 托管服务器

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## 密钥和变量解析

这是最容易让人困惑的部分。

### 在 `.xcsh/mcp.json` 和 `~/.xcsh/mcp.json` 中

在 OMP 启动服务器或发起 HTTP 请求之前，它会按以下方式解析 `env` 和 `headers` 的值：

1. 如果值以 `!` 开头，OMP 会将其作为 shell 命令运行并使用去除首尾空白的标准输出。
2. 否则，OMP 首先检查该值是否匹配某个环境变量名。
3. 如果该环境变量未设置，OMP 将原样使用该字符串。

示例：

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

这意味着以下方式对于本地密钥是有效且便捷的：

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → 从当前 shell 环境复制
- `"Authorization": "Bearer hardcoded-token"` → 使用字面值
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → 通过命令构建请求头

### 在根目录 `mcp.json` 和 `.mcp.json` 中

独立备用加载器还会在发现过程中展开字符串中的 `${VAR}` 和 `${VAR:-default}`。

示例：

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

如果你希望 OMP 的行为最不出人意料，建议使用 `.xcsh/mcp.json` 并使用显式的 env/header 值。

## `disabledServers`

`disabledServers` 主要在用户配置文件（`~/.xcsh/mcp.json`）中使用，当某个服务器是从其他来源发现的，而你希望 OMP 忽略它且不编辑该工具的配置时。

示例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` 与直接编辑 JSON

当你需要引导式设置时，使用 `/mcp add`。

在以下情况下直接编辑 JSON：

- 你需要向导尚未提示的传输方式或认证选项
- 你想从另一个 MCP 客户端粘贴服务器定义
- 你想在编辑器中获得基于 schema 的验证

编辑后，使用：

- `/mcp reload` 重新发现并在当前会话中重新连接服务器
- `/mcp list` 查看服务器来自哪个配置文件
- `/mcp test <name>` 测试单个服务器

## OMP 强制执行的验证规则

来自 `packages/coding-agent/src/mcp/config.ts` 中的 `validateServerConfig()`：

- `stdio` 需要 `command`
- `http` 和 `sse` 需要 `url`
- 一个服务器不能同时设置 `command` 和 `url`
- 未知的 `type` 值会被拒绝

实际影响：

- 省略 `type` 意味着 `stdio`
- 如果你粘贴了一个远程服务器配置但忘记了 `"type": "http"`，OMP 会将其视为 `stdio` 并提示缺少 `command`
- `sse` 仍然有效以保持兼容性，但新的托管服务器通常应配置为 `http`

## 发现和优先级

OMP 不会合并不同文件中的重复服务器定义。发现提供者有优先级排序，优先级更高的定义获胜。

实际操作中：

- 当你需要 OMP 特定的覆盖时，优先使用 `.xcsh/mcp.json` 或 `~/.xcsh/mcp.json`
- 尽可能在各工具之间保持服务器名称唯一
- 当第三方配置不断重新引入你不需要的服务器时，在用户配置中使用 `disabledServers`

## 故障排除

### `Server "name": stdio server requires "command" field`

你可能在远程服务器上遗漏了 `type: "http"`。

### `Server "name": both "command" and "url" are set`

选择一种传输方式。OMP 将 `command` 视为 stdio，将 `url` 视为 http/sse。

### `/mcp add` 成功但服务器仍然无法连接

JSON 是有效的，但服务器可能仍然不可达。使用 `/mcp test <name>` 并检查：

- 二进制文件或 Docker 镜像是否存在
- 必需的环境变量是否已设置
- 远程 URL 是否可达
- OAuth 或 API 令牌是否有效

### 服务器存在于其他工具的配置中但不在 OMP 中

运行 `/mcp list`。OMP 可以发现许多第三方 MCP 文件，但项目级别的加载也可以通过 `mcp.enableProjectConfig` 设置来禁用。

## 参考资料

- MCP 传输规范：<https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- 文件系统服务器包：<https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP 服务器：<https://github.com/github/github-mcp-server>
- Slack MCP 服务器文档：<https://docs.slack.dev/ai/slack-mcp-server/>
