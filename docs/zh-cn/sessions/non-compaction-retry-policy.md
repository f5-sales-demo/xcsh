---
title: 非压缩自动重试策略
description: 针对压缩路径之外的瞬时 API 故障的自动重试策略。
sidebar:
  order: 6
  label: 重试策略
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# 非压缩自动重试策略

本文档描述了 `AgentSession` 中的标准 API 错误重试路径。

本文档明确排除了通过自动压缩进行的上下文溢出恢复。溢出由压缩逻辑处理，相关文档请参见 [`compaction.md`](./compaction.md)。

## 实现文件

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## 重试与压缩的范围边界

重试和压缩从同一个 `agent_end` 路径进行检查，但它们被有意分离：

1. `agent_end` 检查最后一条助手消息。
2. `#isRetryableError(...)` 首先运行。
3. 如果发起了重试，则该轮次跳过压缩检查。
4. 上下文溢出错误被硬排除在重试分类之外（`isContextOverflow(...)` 会短路重试判断）。
5. 因此，溢出会落入 `#checkCompaction(...)` 而非标准重试路径。

总结：过载/限流/服务器/网络类故障使用此重试策略；上下文窗口溢出使用压缩恢复。

## 重试分类

`#isRetryableError(...)` 要求同时满足以下所有条件：

- 助手 `stopReason === "error"`
- `errorMessage` 存在
- 消息**不是**上下文溢出
- `errorMessage` 匹配 `#isRetryableErrorMessage(...)`

当前可重试的模式集（基于正则表达式）：

- overloaded
- rate limit / usage limit / too many requests
- 类 HTTP 服务器错误状态码：429、500、502、503、504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay` 相关措辞

这是基于字符串模式的分类，而非类型化的提供商错误码。

## 重试生命周期和状态转换

重试使用的会话状态：

- `#retryAttempt: number`（`0` 表示空闲）
- `#retryPromise: Promise<void> | undefined`（跟踪进行中的重试生命周期）
- `#retryResolve: (() => void) | undefined`（解析 `#retryPromise`）
- `#retryAbortController: AbortController | undefined`（取消退避等待）

流程（`#handleRetryableError`）：

1. 读取 `retry` 设置组。
2. 如果 `retry.enabled === false`，立即停止（返回 `false`，不发起重试）。
3. 递增 `#retryAttempt`。
4. 首次创建 `#retryPromise`（链中的第一次尝试）。
5. 如果尝试次数超过 `retry.maxRetries`，发出最终失败事件并停止。
6. 计算延迟：`retry.baseDelayMs * 2^(attempt-1)`。
7. 对于用量限制错误，解析重试提示并调用认证存储（`markUsageLimitReached(...)`）；如果提供商/模型切换成功，将延迟强制设为 `0`。
8. 发出 `auto_retry_start` 事件。
9. 从代理运行时状态中移除尾部的助手错误消息（但保留在持久化的会话历史中）。
10. 支持中止的等待休眠。
11. 唤醒后，通过 `setTimeout(..., 0)` 调度 `agent.continue()`。

### 重试计数器的重置条件

`#retryAttempt` 在以下情况下重置为 `0`：

- 重试开始后首次收到成功的非错误、非中止的助手消息（发出 `auto_retry_end { success: true }`）
- 退避等待期间的重试取消
- 超过最大重试次数的路径

`#retryPromise` 在重试链结束时（成功、取消或超过最大次数）通过 `#resolveRetry()` 解析/清除。

## 退避和最大尝试次数语义

设置项：

- `retry.enabled`（默认 `true`）
- `retry.maxRetries`（默认 `3`）
- `retry.baseDelayMs`（默认 `2000`）

尝试次数编号：

- 尝试计数器在最大值检查之前递增
- 开始事件使用当前尝试次数（从 1 开始）
- 超过最大次数的结束事件报告 `attempt: this.#retryAttempt - 1`（最后一次实际重试计数）

默认设置下的退避序列：

- 第 1 次尝试：2000 毫秒
- 第 2 次尝试：4000 毫秒
- 第 3 次尝试：8000 毫秒

延迟覆盖输入仅在用量限制处理路径中使用，且仅用于影响认证存储的模型/账户切换决策。在主要的非压缩重试路径中，退避保持本地指数延迟，除非切换成功（`delayMs = 0`）。

## 中止机制

### 显式重试中止

`abortRetry()`：

- 中止 `#retryAbortController`（如果存在）
- 解析重试 Promise（`#resolveRetry()`）以解除等待者的阻塞

如果中止发生在等待休眠期间，捕获路径会发出：

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- 重置尝试次数/控制器

### 全局操作中止交互

`abort()` 在中止活跃的代理流之前会先调用 `abortRetry()`。这保证了当用户发出通用中止时，重试退避会被取消。

### TUI 交互

在 `auto_retry_start` 时，EventController：

- 将 `Esc` 处理程序切换为 `session.abortRetry()`
- 渲染加载文本：`Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

在 `auto_retry_end` 时，恢复之前的 `Esc` 处理程序并清除加载状态。

## 流式传输和提示完成行为

`prompt()` 最终在 `agent.prompt(...)` 返回后等待 `#waitForRetry()`。

效果：

- 一次 prompt 调用不会完全解析，直到任何已启动的重试链完成（成功/失败/取消）
- 重试生命周期是一个逻辑提示执行边界的一部分

这防止了调用者过早地将正在重试的轮次视为已完成。

## 控制：设置和 RPC

### 配置选项

在设置模式的 retry 组中定义：

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

会话中的编程切换：

- `setAutoRetryEnabled(enabled)` 写入 `retry.enabled`
- `autoRetryEnabled` 读取 `retry.enabled`
- `isRetrying` 报告重试生命周期 Promise 是否处于活跃状态

### RPC 控制

RPC 命令接口：

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

客户端辅助方法：

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

两个命令都返回成功响应；重试进度/失败详情通过流式会话事件传递，而非命令响应载荷。

## 事件发出和失败呈现

会话级重试事件：

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

传播方式：

- 通过 `AgentSession.subscribe(...)` 发出
- 作为扩展事件转发给扩展运行器
- 在 RPC 模式下，直接作为 JSON 事件对象转发（`session.subscribe(event => output(event))`）
- 在 TUI 中，由 `EventController` 消费用于加载/错误界面

最终失败呈现：

- 超过最大次数或取消时，`auto_retry_end.success === false`
- TUI 显示：`Retry failed after N attempts: <finalError>`
- 扩展/钩子接收包含相同字段的 `auto_retry_end`
- RPC 消费者在 stdout 流上接收相同的事件对象

## 永久停止条件

当以下任一情况发生时，重试将停止且不会自动继续：

- `retry.enabled` 为 false
- 错误未被分类为可重试
- 错误为上下文溢出（委托给压缩路径）
- 超过最大重试次数
- 用户取消重试（在重试加载器期间使用 `abort_retry` 或 `Esc`）
- 全局中止（`abort`）会首先取消重试

在计数器重置后，新的重试链仍可在未来的可重试错误上启动。

## 操作注意事项

- 分类基于正则文本匹配；此处未使用提供商特定的结构化错误。
- 重试会从**运行时上下文**中剥离失败的助手错误消息再继续，但会话历史仍保留该错误条目。
- `RpcSessionState` 目前暴露了 `autoCompactionEnabled` 但没有 `autoRetryEnabled` 字段；RPC 调用者必须自行跟踪切换状态或通过其他 API 查询设置。
