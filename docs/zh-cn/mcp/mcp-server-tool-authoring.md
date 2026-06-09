---
title: MCP 服务器与工具编写
description: 构建自定义 MCP 服务器并为编码代理注册工具的指南。
sidebar:
  order: 4
  label: 服务器与工具编写
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCP 服务器与工具编写

本文档说明 MCP 服务器定义如何在编码代理中转换为可调用的 `mcp_*` 工具，以及当配置无效、重复、禁用或受认证限制时，操作者应该了解的行为。

## 架构概览

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) 服务器配置模型与验证

`src/mcp/types.ts` 定义了 MCP 配置编写者和运行时使用的编写格式：

- `stdio`（`type` 缺省时的默认值）：需要 `command`，可选 `args`、`env`、`cwd`
- `http`：需要 `url`，可选 `headers`
- `sse`：需要 `url`，可选 `headers`（保留以兼容旧版）
- 共享字段：`enabled`、`timeout`、`auth`

`validateServerConfig()`（`src/mcp/config.ts`）执行传输层基本验证：

- 拒绝同时设置 `command` 和 `url` 的配置
- stdio 要求必须有 `command`
- http/sse 要求必须有 `url`
- 拒绝未知的 `type`

`config-writer.ts` 在添加/更新操作时应用此验证，同时还验证服务器名称：

- 非空
- 最大 100 个字符
- 仅允许 `[a-zA-Z0-9_.-]`

### 传输层注意事项

- 省略 `type` 意味着 stdio。如果你本意是 HTTP/SSE 但省略了 `type`，`command` 将变为必填项。
- `sse` 仍被接受，但在内部被当作 HTTP 传输处理（`createHttpTransport`）。
- 验证是结构性的，而非连通性的：语法正确的 URL 仍可能在连接时失败。

## 2) 发现、规范化与优先级

### 基于能力的发现

`loadAllMCPConfigs()`（`src/mcp/config.ts`）通过 `loadCapability(mcpCapability.id)` 加载规范的 `MCPServer` 项。

能力层（`src/capability/index.ts`）随后：

1. 按优先级顺序加载提供者
2. 按 `server.name` 去重（先到先得 = 最高优先级获胜）
3. 验证去重后的项

结果：跨来源的重复服务器名称不会合并。一个定义获胜；低优先级的重复项被覆盖。

### `.mcp.json` 及相关文件

`src/discovery/mcp-json.ts` 中的专用降级提供者读取项目根目录的 `mcp.json` 和 `.mcp.json`（低优先级）。

实际上 MCP 服务器也来自更高优先级的提供者（例如原生 `.xcsh/...` 和工具特定的配置目录）。编写指导：

- 优先使用 `.xcsh/mcp.json`（项目级）或 `~/.xcsh/mcp.json`（用户级）以获得显式控制。
- 当需要降级兼容性时使用根目录的 `mcp.json` / `.mcp.json`。
- 在多个来源中重用相同的服务器名称会导致优先级覆盖，而非合并。

### 规范化行为

`convertToLegacyConfig()`（`src/mcp/config.ts`）将规范的 `MCPServer` 映射为运行时 `MCPServerConfig`。

关键行为：

- 传输方式推断为 `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- 禁用的服务器（`enabled === false`）在连接前被丢弃
- 可选字段在存在时被保留

### 发现过程中的环境变量展开

`mcp-json.ts` 使用 `expandEnvVarsDeep()` 在字符串字段中展开环境变量占位符：

- 支持 `${VAR}` 和 `${VAR:-default}`
- 未解析的值保持为字面量 `${VAR}` 字符串

`mcp-json.ts` 还对用户 JSON 执行运行时类型检查，对无效的 `enabled`/`timeout` 值记录警告而非整个文件解析失败。

## 3) 认证与运行时值解析

`MCPManager.prepareConfig()`/`#resolveAuthConfig()`（`src/mcp/manager.ts`）是连接前的最终处理阶段。

### OAuth 凭据注入

如果配置包含：

```ts
auth: { type: "oauth", credentialId: "..." }
```

且凭据存在于认证存储中：

- `http`/`sse`：注入 `Authorization: Bearer <access_token>` 头
- `stdio`：注入 `OAUTH_ACCESS_TOKEN` 环境变量

如果凭据查找失败，管理器记录警告并继续使用未解析的认证。

### 头部/环境变量值解析

连接前，管理器通过 `resolveConfigValue()`（`src/config/resolve-config-value.ts`）解析每个头部/环境变量值：

- 以 `!` 开头的值 => 执行 shell 命令，使用去除空白的 stdout（有缓存）
- 否则，先将值视为环境变量名（`process.env[name]`），回退为字面值
- 未解析的命令/环境变量值从最终的头部/环境变量映射中省略

操作注意事项：这意味着拼写错误的密钥命令/环境变量名称可能会静默移除该头部/环境变量条目，导致下游出现 401/403 或服务器启动失败。

## 4) 工具桥接：MCP -> 代理可调用工具

`src/mcp/tool-bridge.ts` 将 MCP 工具定义转换为 `CustomTool`。

### 命名与冲突域

工具名称生成规则为：

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

规则：

- 转为小写
- 非 `[a-z_]` 字符变为 `_`
- 重复的下划线合并
- 工具名称中冗余的 `<server>_` 前缀被去除一次

这避免了许多冲突，但并非全部。不同的原始名称仍可能清理为相同的标识符（例如 `my-server` 和 `my.server` 清理后类似），注册表插入时采用后写入覆盖策略。

### Schema 映射

`convertSchema()` 基本保持 MCP JSON Schema 不变，但为缺少 `properties` 的对象 schema 补充 `{}` 以兼容提供者。

### 执行映射

`MCPTool.execute()` / `DeferredMCPTool.execute()`：

- 调用 MCP `tools/call`
- 将 MCP 内容展平为可显示的文本
- 返回结构化详情（`serverName`、`mcpToolName`、提供者元数据）
- 将服务器报告的 `isError` 映射为 `Error: ...` 文本结果
- 将抛出的传输/运行时故障映射为 `MCP error: ...`
- 通过将 AbortError 转换为 `ToolAbortError` 来保持中止语义

## 5) 操作者生命周期：添加/编辑/移除与实时更新

交互模式在 `src/modes/controllers/mcp-command-controller.ts` 中暴露 `/mcp` 命令。

支持的操作：

- `add`（向导或快速添加）
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

配置写入是原子性的（`writeMCPConfigFile`：临时文件 + 重命名）。

变更后，控制器调用 `#reloadMCP()`：

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` 替换所有 `mcp_` 注册表条目并立即重新激活最新的 MCP 工具集，因此变更无需重启会话即可生效。

### 模式差异

- **交互/TUI 模式**：`/mcp` 提供应用内用户体验（向导、OAuth 流程、连接状态文本、即时运行时重绑定）。
- **SDK/无头集成**：`discoverAndLoadMCPTools()`（`src/mcp/loader.ts`）返回已加载的工具 + 每个服务器的错误；无 `/mcp` 命令用户体验。

## 6) 用户可见的错误信息

用户/操作者常见的错误字符串：

- 添加/更新验证失败：
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- 快速添加参数问题：
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- 连接/测试失败：
  - `Failed to connect to "<name>": <message>`
  - 超时帮助文本建议增加超时时间
  - `401/403` 的认证帮助文本
- 认证/OAuth 流程：
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- 禁用的服务器使用：
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

发现过程中格式错误的源 JSON 通常作为警告/日志处理；config-writer 路径抛出显式错误。

## 7) 实用编写指导

在此代码库中进行稳健的 MCP 编写：

1. 在所有支持 MCP 的配置来源中保持服务器名称全局唯一。
2. 优先使用字母数字/下划线名称，以避免生成的 `mcp_*` 工具名称出现清理后的命名冲突。
3. 使用显式 `type` 以避免意外的 stdio 默认值。
4. 将 `enabled: false` 视为硬关闭：服务器从运行时连接集中被排除。
5. 对于 OAuth 配置，存储有效的 `credentialId`；否则认证注入将被跳过。
6. 如果使用基于命令的密钥解析（`!cmd`），请验证命令输出是否稳定且非空。

## 实现文件

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
