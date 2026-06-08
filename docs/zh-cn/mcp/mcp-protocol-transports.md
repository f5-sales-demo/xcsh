---
title: MCP 协议与传输层内部机制
description: MCP 协议实现，包含 stdio、SSE 和可流式传输的 HTTP 传输层。
sidebar:
  order: 2
  label: 协议与传输层
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# MCP 协议与传输层内部机制

本文档描述了 coding-agent 如何实现 MCP JSON-RPC 消息传递，以及协议关注点与传输关注点的分离方式。

## 范围

涵盖内容：

- JSON-RPC 请求/响应和通知流程
- stdio 和 HTTP/SSE 传输的请求关联与生命周期
- 超时和取消行为
- 错误传播和格式异常负载处理
- 传输选择边界（`stdio` vs `http`/`sse`）
- 哪些重连/重试职责属于传输层，哪些属于管理器层

不涵盖扩展编写 UX 或命令 UI。

## 实现文件

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## 层级边界

### 协议层（JSON-RPC + MCP 方法）

- 消息结构定义在 `types.ts` 中（`JsonRpcRequest`、`JsonRpcNotification`、`JsonRpcResponse`、`JsonRpcMessage`）。
- MCP 客户端逻辑（`client.ts`）决定方法顺序和会话握手：
  1. `initialize` 请求
  2. `notifications/initialized` 通知
  3. 方法调用如 `tools/list`、`tools/call`

### 传输层（`MCPTransport`）

`MCPTransport` 抽象了消息传递和生命周期：

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- 可选回调：`onClose`、`onError`、`onNotification`

传输实现负责帧格式和 I/O 细节：

- `StdioTransport`：通过子进程 stdio 进行换行符分隔的 JSON 传输
- `HttpTransport`：通过 HTTP POST 进行 JSON-RPC 传输，可选 SSE 响应/监听

### 当前重要注意事项

传输回调（`onClose`、`onError`、`onNotification`）已实现，但当前的 `MCPClient`/`MCPManager` 流程并未将重连逻辑与这些回调关联。通知仅在调用方注册了处理器时才会被消费。

## 传输选择

`client.ts:createTransport()` 根据配置选择传输方式：

- `type` 省略或为 `"stdio"` -> `createStdioTransport`
- `"http"` 或 `"sse"` -> `createHttpTransport`

`"sse"` 被视为 HTTP 传输的变体（相同的类），而非独立的传输实现。

## JSON-RPC 消息流和关联

## 请求 ID

每个传输为每个请求生成 ID（`Math.random` + 时间戳字符串）。ID 是传输本地的关联令牌。

## Stdio 关联路径

- 出站请求序列化为一个 JSON 对象 + `\n`。
- `#pendingRequests: Map<id, {resolve,reject}>` 存储进行中的请求。
- 读取循环从 stdout 解析 JSONL 并调用 `#handleMessage`。
- 如果入站消息有匹配的 `id`，请求被 resolve/reject。
- 如果入站消息有 `method` 但没有 `id`，则视为通知并发送至 `onNotification`。

未知 ID 会被忽略（不会 reject，不会触发错误回调）。

## HTTP 关联路径

- 出站请求是带有 JSON body 和生成的 `id` 的 HTTP `POST`。
- 非 SSE 响应路径：解析一个 JSON-RPC 响应并返回 `result`/在 `error` 时抛出异常。
- SSE 响应路径（`Content-Type: text/event-stream`）：流式读取事件，返回第一个 `id` 匹配预期请求 ID 且包含 `result` 或 `error` 的消息。
- 带有 `method` 但没有 `id` 的 SSE 消息被视为通知。

如果 SSE 流在匹配响应之前结束，请求将失败并报错 `No response received for request ID ...`。

## 通知

客户端通过 `transport.notify(...)` 发出 JSON-RPC 通知。

- Stdio：将通知帧（`jsonrpc`、`method`、可选 `params`）加换行符写入 stdin。
- HTTP：发送不带 `id` 的 POST body；成功接受 `2xx` 或 `202 Accepted`。

服务器发起的通知仅通过传输的 `onNotification` 暴露；管理器/客户端中没有默认的全局订阅者。

## Stdio 传输内部机制

## 生命周期和状态转换

- 初始状态：`connected=false`，`process=null`，待处理映射为空
- `connect()`：
  - 使用配置的 command/args/env/cwd 生成子进程
  - 标记为已连接
  - 启动 stdout 读取循环（`readJsonl`）
  - 启动 stderr 循环（读取/丢弃；当前静默处理）
- `close()`：
  - 标记为已断开
  - reject 所有待处理请求（`Transport closed`）
  - 终止子进程
  - 等待读取循环关闭
  - 触发 `onClose`

如果读取循环意外退出，`finally` 会触发 `#handleClose()`，执行相同的待处理请求 reject 和关闭回调。

## 超时和取消

每个请求：

- 超时默认为 `config.timeout ?? 30000`
- 可选的来自调用方的 `AbortSignal`
- 中止和超时都会 reject 待处理 promise 并清理映射条目

取消仅在本地生效：传输不会向服务器发送协议级别的取消通知。

## 格式异常负载处理

在读取循环中：

- 每个解析的 JSONL 行在 `try/catch` 中传递给 `#handleMessage`
- 格式异常/无效消息的处理异常会被丢弃（`Skip malformed lines` 注释）
- 循环继续，因此单条错误消息不会终止连接

如果底层流解析器抛出异常，会调用 `onError`（仍处于连接状态时），然后连接关闭。

## 断开/故障行为

当进程退出或流关闭时：

- 所有进行中的请求被 reject 为 `Transport closed`
- 不会自动重启或重连
- 上层必须通过创建新传输来重连

## 背压/流式处理说明

- 出站写入使用 `stdin.write()` + `flush()`，不等待 drain 语义。
- 传输中没有显式的队列或高水位线管理。
- 入站处理是流驱动的（对 `readJsonl` 使用 `for await`），每次处理一个解析的消息。

## HTTP/SSE 传输内部机制

## 生命周期和连接语义

HTTP 传输有逻辑连接状态，但请求路径是每次 HTTP 调用无状态的：

- `connect()` 设置 `connected=true`（没有 socket/会话握手）
- 通过 `Mcp-Session-Id` header 进行可选的服务器会话跟踪
- `close()` 可选地发送带 `Mcp-Session-Id` 的 `DELETE`，中止 SSE 监听器，触发 `onClose`

因此 `connected` 意味着"传输可用"，而非"已建立持久流"。

## 会话 header 行为

- 在 POST 响应中，如果存在 `Mcp-Session-Id` header，传输会存储它。
- 后续的请求/通知包含 `Mcp-Session-Id`。
- `close()` 尝试通过 HTTP DELETE 终止服务器会话；终止失败会被忽略。

## 超时和取消

对于 `request()` 和 `notify()`：

- 超时使用 `AbortController`（`config.timeout ?? 30000`）
- 外部信号（如提供）通过 `AbortSignal.any([...])` 合并
- AbortError 处理区分调用方中止和超时

抛出的错误：

- 超时：`Request timeout after ...ms`（或 `SSE response timeout ...`、`Notify timeout ...`）
- 调用方中止：当外部信号已被中止时，重新抛出原始 AbortError

## HTTP 错误传播

对于非 OK 响应：

- 响应文本包含在抛出的错误中（`HTTP <status>: <text>`）
- 如果存在，来自 `WWW-Authenticate` 和 `Mcp-Auth-Server` 的认证提示会被附加

对于 JSON-RPC 错误对象：

- 抛出 `MCP error <code>: <message>`

格式异常的 JSON body（`response.json()` 失败）作为解析异常传播。

## SSE 行为和模式

存在两种 SSE 路径：

1. **每请求 SSE 响应**（`#parseSSEResponse`）
   - 当 POST 响应内容类型为 `text/event-stream` 时使用
   - 消费流直到找到匹配的响应 id
   - 可在同一流中处理交错的通知

2. **后台 SSE 监听器**（`startSSEListener()`）
   - 用于服务器发起通知的可选 GET 监听器
   - 当前不会被 MCP 管理器/客户端自动启动
   - 如果 GET 返回 `405`，监听器静默禁用自身（服务器不支持此模式）

## 格式异常负载和断开处理

SSE JSON 解析错误从 `readSseJson` 冒泡并 reject 请求/监听器。

- 请求 SSE 解析错误 reject 当前活动请求。
- 后台监听器错误触发 `onError`（AbortError 除外）。
- 后台监听器无自动重连。

## `json-rpc.ts` 工具函数 vs 传输抽象

`src/mcp/json-rpc.ts` 提供 `callMCP()` 和 `parseSSE()` 辅助函数用于直接 HTTP MCP 调用（由 Exa 集成使用），而非 `MCPClient`/`MCPManager` 使用的 `MCPTransport` 抽象。

与 `HttpTransport` 的显著差异：

- 先解析整个响应文本，然后提取第一行 `data:`（`parseSSE`），并提供 JSON 回退
- 无请求超时管理、无中止 API、无 session-id 处理、无传输生命周期
- 返回原始 JSON-RPC 封装对象

此路径轻量但不如完整传输实现健壮。

## 重试/重连职责

## 传输层

当前传输实现**不会**：

- 重试失败的请求
- 在 stdio 进程退出后重连
- 重连 SSE 监听器
- 在断开后重发进行中的请求

它们会快速失败并传播错误。

## 管理器/客户端层

`MCPManager` 处理发现/初始连接编排，只能通过再次运行连接流程来重连（`connectToServer`/`discoverAndConnect` 路径）。它不会在运行时故障回调中自动修复已连接的传输。

`MCPManager` 确实有针对慢速服务器的启动回退行为（从缓存中延迟加载工具），但这是工具可用性回退，而非传输重试。

## 故障场景总结

- **格式异常的 stdio 消息行**：丢弃；流继续。
- **Stdio 流/进程结束**：传输关闭；待处理请求被 reject 为 `Transport closed`。
- **HTTP 非 2xx**：请求/通知抛出 HTTP 错误。
- **无效 JSON 响应**：解析异常被传播。
- **SSE 在匹配 id 之前结束**：请求失败并报错 `No response received for request ID ...`。
- **超时**：传输特定的超时错误。
- **调用方中止**：从调用方信号传播 AbortError/reason。

## 实际边界规则

如果关注点是消息结构、id 关联或 MCP 方法排序，则属于协议/客户端逻辑。

如果关注点是帧格式（JSONL vs HTTP/SSE）、流解析、fetch/spawn 生命周期、超时时钟或连接拆除，则属于传输实现。
