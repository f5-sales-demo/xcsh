---
title: MCP 运行时生命周期
description: MCP 服务器进程的生命周期，涵盖从初始化到工具注册、健康监控和关闭的全过程。
sidebar:
  order: 3
  label: 运行时生命周期
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCP 运行时生命周期

本文档描述了 MCP 服务器在 coding-agent 运行时中如何被发现、连接、作为工具暴露、刷新以及销毁。

## 生命周期概览

1. **SDK 启动**时调用 `discoverAndLoadMCPTools()`（除非 MCP 被禁用）。
2. **发现阶段**（`loadAllMCPConfigs`）从能力源解析 MCP 服务器配置，过滤已禁用的/项目级的/Exa 条目，并保留源元数据。
3. **管理器连接阶段**（`MCPManager.connectServers`）并行启动每个服务器的连接 + `tools/list`。
4. **快速启动门控**最多等待 250ms，然后可能返回：
   - 完全加载的 `MCPTool`，
   - 每个服务器的失败信息，
   - 或仍在等待的服务器的缓存 `DeferredMCPTool`。
5. **SDK 装配**将 MCP 工具合并到会话的运行时工具注册表中。
6. **活动会话**可以通过 `/mcp` 流程刷新 MCP 工具（`disconnectAll` + 重新发现 + `session.refreshMCPTools`）。
7. **销毁阶段**在调用者调用 `disconnectServer`/`disconnectAll` 时执行；管理器同时会清除已断开服务器的 MCP 工具注册。

## 发现和加载阶段

### 从 SDK 的入口路径

`src/sdk.ts` 中的 `createAgentSession()` 在 `enableMCP` 为 true（默认值）时执行 MCP 启动：

- 调用 `discoverAndLoadMCPTools(cwd, { ... })`，
- 传入 `authStorage`、缓存存储和 `mcp.enableProjectConfig` 设置，
- 始终设置 `filterExa: true`，
- 记录每个服务器的加载/连接错误，
- 将返回的管理器存储在 `toolSession.mcpManager` 和会话结果中。

如果 `enableMCP` 为 false，则完全跳过 MCP 发现。

### 配置发现与过滤

`loadAllMCPConfigs()`（`src/mcp/config.ts`）通过能力发现加载规范的 MCP 服务器条目，然后转换为旧版 `MCPServerConfig`。

过滤行为：

- `enableProjectConfig: false` 会移除项目级条目（`_source.level === "project"`）。
- `enabled: false` 的服务器在连接尝试之前即被跳过。
- Exa 服务器默认被过滤掉，其 API 密钥被提取用于原生 Exa 工具集成。

结果包含 `configs` 和 `sources`（元数据，后续用于提供者标签）。

### 发现级别的失败行为

`discoverAndLoadMCPTools()` 区分两类失败：

- **发现硬失败**（来自 `manager.discoverAndConnect` 的异常，通常来自配置发现）：返回空工具集和一个合成错误 `{ path: ".mcp.json", error }`。
- **每服务器的运行时/连接失败**：管理器返回部分成功结果及 `errors` 映射；其他服务器继续运行。

因此，当个别 MCP 服务器失败时，启动不会导致整个代理会话失败。

## 管理器状态模型

`MCPManager` 通过独立的注册表跟踪运行时生命周期：

- `#connections: Map<string, MCPServerConnection>` — 已完全连接的服务器。
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — 握手进行中。
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — 已连接但工具仍在加载。
- `#tools: CustomTool[]` — 暴露给调用者的当前 MCP 工具视图。
- `#sources: Map<string, SourceMeta>` — 即使在连接完成前也存在的提供者/源元数据。

`getConnectionStatus(name)` 从这些映射派生状态：

- 如果在 `#connections` 中则为 `connected`，
- 如果在待处理连接或待处理工具加载中则为 `connecting`，
- 否则为 `disconnected`。

## 连接建立与启动时序

## 每服务器的连接管道

对于 `connectServers()` 中发现的每个服务器：

1. 存储/更新源元数据，
2. 如果已连接/待处理则跳过，
3. 验证传输字段（`validateServerConfig`），
4. 解析认证/shell 替换（`#resolveAuthConfig`），
5. 调用 `connectToServer(name, resolvedConfig)`，
6. 调用 `listTools(connection)`，
7. 尽力缓存工具定义（`MCPToolCache.set`）。

`connectToServer()` 行为（`src/mcp/client.ts`）：

- 创建 stdio 或 HTTP/SSE 传输，
- 执行 MCP `initialize` + `notifications/initialized`，
- 使用超时（`config.timeout` 或默认 30 秒），
- 初始化失败时关闭传输。

### 快速启动门控 + 延迟回退

`connectServers()` 在以下两者之间进行竞争等待：

- 所有连接/工具加载任务完成，以及
- `STARTUP_TIMEOUT_MS = 250`。

250ms 之后：

- 已完成的任务变为活动的 `MCPTool`，
- 已拒绝的任务产生每服务器的错误，
- 仍在等待的任务：
  - 如果有可用的缓存工具定义（`MCPToolCache.get`），则创建 `DeferredMCPTool`，
  - 否则阻塞等待这些待处理任务完成。

这是一种混合启动模型：缓存可用时快速返回，缓存不可用时等待以确保正确性。

### 后台完成行为

每个待处理的 `toolsPromise` 还有一个后台延续，最终会：

- 通过 `#replaceServerTools` 替换管理器状态中该服务器的工具切片，
- 写入缓存，
- 仅在启动后记录延迟失败（`allowBackgroundLogging`）。

## 工具暴露与活动会话可用性

### 启动注册

`discoverAndLoadMCPTools()` 将管理器工具转换为 `LoadedCustomTool[]`，并装饰路径（已知时为 `mcp:<server> via <providerName>`）。

`createAgentSession()` 然后将这些工具推入 `customTools`，它们被包装并添加到运行时工具注册表中，名称格式为 `mcp_<server>_<tool>`。

### 工具调用

- `MCPTool` 通过已连接的 `MCPServerConnection` 调用工具。
- `DeferredMCPTool` 在调用前等待 `waitForConnection(server)`；这允许缓存的工具在连接就绪前即可存在。

两者都返回结构化的工具输出，并将传输/工具错误转换为 `MCP error: ...` 工具内容（中止仍为中止）。

## 刷新/重新加载路径（启动 vs 实时重载）

### 初始启动路径

- 在 `sdk.ts` 中进行一次性发现/加载，
- 工具注册到初始会话工具注册表中。

### 交互式重载路径

`/mcp reload` 路径（`src/modes/controllers/mcp-command-controller.ts`）执行：

1. `mcpManager.disconnectAll()`，
2. `mcpManager.discoverAndConnect()`，
3. `session.refreshMCPTools(mcpManager.getTools())`。

`session.refreshMCPTools()`（`src/session/agent-session.ts`）移除所有 `mcp_` 工具，重新包装最新的 MCP 工具，并重新激活工具集，使 MCP 更改无需重启会话即可生效。

还有一个用于延迟连接的后续路径：在等待特定服务器后，如果状态变为 `connected`，它会重新运行 `session.refreshMCPTools(...)`，以便新可用的工具在会话中重新绑定。

## 健康检查、重连和部分失败行为

当前运行时行为有意保持最小化：

- 管理器/客户端中**没有自主健康监控**。
- 传输断开时**没有自动重连循环**。
- 管理器不订阅传输的 `onClose`/`onError`；状态由注册表驱动。
- 重连是显式的：通过重载流程或直接调用 `connectServers()`。

在操作层面：

- 一个服务器失败不会移除健康服务器的工具，
- 连接/列表失败按服务器隔离，
- 工具缓存和后台更新为尽力而为（记录警告/错误，不会硬停止）。

## 销毁语义

### 服务器级别的销毁

`disconnectServer(name)`：

- 移除待处理条目/源元数据，
- 如果已连接则关闭传输，
- 从管理器状态中移除该服务器的 `mcp_` 工具。

### 全局销毁

`disconnectAll()`：

- 使用 `Promise.allSettled` 关闭所有活动传输，
- 清除待处理映射、源、连接和管理器工具列表。

在当前的装配中，显式销毁用于 MCP 命令流程（重载/移除/禁用）。启动路径本身没有单独的自动管理器处置钩子；调用者需要在需要确定性 MCP 关闭时负责调用管理器的断开方法。

## 失败模式与保证

| 场景 | 行为 | 硬失败 vs 尽力而为 |
| --- | --- | --- |
| 发现阶段抛出异常（能力/配置加载路径） | 加载器返回空工具 + 合成的 `.mcp.json` 错误 | 尽力而为的会话启动 |
| 无效的服务器配置 | 服务器被跳过并记录验证错误条目 | 尽力而为（按服务器） |
| 连接超时/初始化失败 | 记录服务器错误；其他服务器继续 | 尽力而为（按服务器） |
| 启动时 `tools/list` 仍在等待但有缓存命中 | 立即返回延迟工具 | 尽力而为的快速启动 |
| 启动时 `tools/list` 仍在等待且无缓存 | 启动等待待处理任务完成 | 硬等待以确保正确性 |
| 后台工具加载延迟失败 | 在启动门控之后记录 | 尽力而为的日志记录 |
| 运行时传输断开 | 无自动重连；后续调用失败直到重连/重载 | 通过手动操作尽力恢复 |

## 公共 API 接口

`src/mcp/index.ts` 为外部调用者重新导出加载器/管理器/客户端 API。`src/sdk.ts` 将 `discoverMCPServers()` 作为便捷包装暴露，返回相同的加载器结果形状。

## 实现文件

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — 加载器门面、发现错误规范化、`LoadedCustomTool` 转换。
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — 生命周期状态注册表、并行连接/列表流程、刷新/断开。
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — 传输设置、初始化握手、列表/调用/断开。
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP 模块 API 导出。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 启动装配到会话/工具注册表。
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — 管理器使用的配置发现/过滤/验证。
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — `MCPTool` 和 `DeferredMCPTool` 运行时行为。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` 实时重绑定。
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — 交互式重载/重连流程。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 通过父管理器连接进行子代理 MCP 代理。
