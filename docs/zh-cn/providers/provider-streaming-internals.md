---
title: Provider 流式处理内部机制
description: Provider 流式处理实现，包括 SSE 解析、token 计数和背压处理。
sidebar:
  order: 2
  label: 流式处理内部机制
i18n:
  sourceHash: a32ffa769c4d
  translator: machine
---

# Provider 流式处理内部机制

本文档解释了 `@f5-sales-demo/pi-ai` 中 token/工具流式处理的标准化方式，以及如何通过 `@f5-sales-demo/pi-agent-core` 和 `coding-agent` 会话事件进行传播。

## 端到端流程

1. `streamSimple()`（`packages/ai/src/stream.ts`）映射通用选项并分发到 provider 流函数。
2. Provider 流函数（`anthropic.ts`、`openai-responses.ts`、`google.ts`）将 provider 原生流事件转换为统一的 `AssistantMessageEvent` 序列。
3. 每个 provider 将事件推送到 `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`），该模块对 delta 事件进行节流并提供：
   - 用于增量更新的异步迭代
   - `result()` 用于获取最终的 `AssistantMessage`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）消费这些事件，修改正在进行的助手状态，并发出携带原始 `assistantMessageEvent` 的 `message_update` 事件。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）订阅代理事件，持久化消息，驱动扩展钩子，并应用会话行为（重试、压缩、TTSR、流式编辑中止检查）。

## `@f5-sales-demo/pi-ai` 中的统一流契约

所有 provider 发出相同的形状（`packages/ai/src/types.ts` 中的 `AssistantMessageEvent`）：

- `start`
- 内容块生命周期三元组：
  - 文本：`text_start` → `text_delta`* → `text_end`
  - 思考：`thinking_start` → `thinking_delta`* → `thinking_end`
  - 工具调用：`toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 终止事件：
  - `done`，带有 `reason: "stop" | "length" | "toolUse"`
  - 或 `error`，带有 `reason: "aborted" | "error"`

`AssistantMessageEventStream` 保证：

- 最终结果由终止事件（`done` 或 `error`）解析
- delta 事件被批量化/节流（约 50ms）
- 在非 delta 事件之前和完成之前刷新缓冲的 delta

## Delta 节流与协调行为

`AssistantMessageEventStream` 将 `text_delta`、`thinking_delta` 和 `toolcall_delta` 视为可合并事件：

- 缓冲的 delta 仅在**类型 + contentIndex** 匹配时合并
- 合并保留最新的 `partial` 快照
- 非 delta 事件强制立即刷新

这为 TUI/事件消费者平滑了高频 provider 流，但这不是 provider 背压：provider 仍以全速生产，而本地流进行缓冲。

## Provider 标准化详情

## Anthropic（`anthropic-messages`）

源码：`packages/ai/src/providers/anthropic.ts`

标准化要点：

- `message_start` 初始化用量（输入/输出/缓存 token）
- `content_block_start` 映射为文本/思考/工具调用的开始事件
- `content_block_delta` 映射：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` 仅更新 `thinkingSignature`（不产生事件）
- `content_block_stop` 发出对应的 `*_end`
- `message_delta.stop_reason` 通过 `mapStopReason()` 映射

工具调用参数流式处理：

- 每个工具块携带内部 `partialJson`
- 每个 JSON delta 追加到 `partialJson`
- 每次 delta 都通过 `parseStreamingJson()` 重新解析 `arguments`
- `toolcall_end` 再次重新解析，然后移除 `partialJson`

## OpenAI Responses（`openai-responses`）

源码：`packages/ai/src/providers/openai-responses.ts`

标准化要点：

- `response.output_item.added` 启动推理/文本/函数调用块
- 推理摘要事件（`response.reasoning_summary_text.delta`）变为 `thinking_delta`
- 输出/拒绝 delta 变为 `text_delta`
- `response.function_call_arguments.delta` 变为 `toolcall_delta`
- `response.output_item.done` 发出 `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` 将状态映射为停止原因和用量

工具调用参数流式处理：

- 与 Anthropic 相同的 `partialJson` 累积模式
- 仅发送 `response.function_call_arguments.done` 的 provider 仍然填充最终参数
- 工具调用 ID 标准化为 `"<call_id>|<item_id>"`

## Google Generative AI（`google-generative-ai`）

源码：`packages/ai/src/providers/google.ts`

标准化要点：

- 迭代 `candidate.content.parts`
- 文本部分通过 `isThinkingPart(part)` 分为思考与文本
- 块转换在开始新块之前关闭上一个块
- `part.functionCall` 被视为完整的工具调用（立即发出 start/delta/end）
- 完成原因通过 `google-shared.ts` 中的 `mapStopReason()` 映射

工具调用参数流式处理：

- 函数调用参数以结构化对象形式到达，而非增量 JSON 文本
- 实现发出一个合成的 `toolcall_delta`，包含 `JSON.stringify(arguments)`
- 在此路径中 Google 不需要部分 JSON 解析器

## 部分工具调用 JSON 累积与恢复

Anthropic/OpenAI Responses 的共享行为使用 `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）：

1. 尝试 `JSON.parse`
2. 回退到 `partial-json` 解析器处理不完整片段
3. 如果两者都失败，返回 `{}`

影响：

- 格式错误或截断的参数 delta 不会立即导致流处理崩溃
- 进行中的 `arguments` 可能暂时为 `{}`
- 后续有效的 delta 可以恢复结构化参数，因为每次追加都会重新解析
- 最终的 `toolcall_end` 在发出之前执行最后一次解析尝试

## 停止原因与传输/运行时错误

Provider 停止原因映射为标准化的 `stopReason`：

- Anthropic：`end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全/拒绝情况→`error`
- OpenAI Responses：`completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google：`STOP`→`stop`、`MAX_TOKENS`→`length`、安全/禁止/格式错误的函数调用类别→`error`

错误语义分为两个阶段：

1. **模型完成语义**（provider 报告的完成原因/状态）
2. **传输/运行时故障**（网络/客户端/解析器/中止异常）

如果 provider 流抛出异常或发出失败信号，每个 provider 包装器捕获并发出终止 `error` 事件，包含：

- 当中止信号被设置时 `stopReason = "aborted"`
- 否则 `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 格式错误的 chunk / SSE 解析失败行为

对于这些 provider 路径，chunk/SSE 帧处理由供应商 SDK 流（Anthropic SDK、OpenAI SDK、Google SDK）处理。此代码未在此处实现自定义 SSE 解码器。

当前实现中观察到的行为：

- SDK 级别的格式错误 chunk/SSE 解析以异常或流 `error` 事件的形式呈现
- Provider 包装器将其转换为统一的终止 `error` 事件
- 流函数本身内部没有 provider 特定的恢复/重试
- 更高级别的重试在 `AgentSession` 自动重试逻辑中处理（消息级重试，而非流 chunk 重放）

## 取消边界

取消是分层的：

- AI provider 请求：`options.signal` 被传递到 provider 客户端流调用中。
- Provider 包装器：流循环结束后，中止信号强制进入错误路径（`"Request was aborted"`）。
- 代理循环：在处理每个 provider 事件之前检查 `signal.aborted`，并可以从最新的部分内容合成一个中止的助手消息。
- 会话/代理控制：`AgentSession.abort()` -> `agent.abort()` -> 共享中止控制器取消。

工具执行取消与模型流取消是分开的：

- 工具运行器使用 `AbortSignal.any([agentSignal, steeringAbortSignal])`
- 引导中断可以中止剩余的工具执行，同时保留已产生的工具结果

## 背压边界

provider SDK 流与下游消费者之间没有硬背压机制：

- `EventStream` 使用无最大大小限制的内存队列
- 节流降低了 UI 更新速率但不会减慢 provider 接收速度
- 如果消费者严重滞后，排队的事件会持续增长直到完成

当前设计优先考虑响应性和简单排序，而非有界缓冲区流控制。

## 流事件如何呈现为代理/会话事件

`agentLoop.streamAssistantResponse()` 将 `AssistantMessageEvent` 桥接到 `AgentEvent`：

- 在 `start` 时：推送占位助手消息并发出 `message_start`
- 在块事件（`text_*`、`thinking_*`、`toolcall_*`）时：更新最后的助手消息，发出带有原始 `assistantMessageEvent` 的 `message_update`
- 在终止（`done`/`error`）时：从 `response.result()` 解析最终消息，发出 `message_end`

`AgentSession` 然后消费这些事件以实现会话级行为：

- TTSR 监视 `message_update.assistantMessageEvent` 中的 `text_delta` 和 `toolcall_delta`
- 流式编辑守卫检查 `edit` 调用上的 `toolcall_delta`/`toolcall_end`，并可以提前中止
- 持久化在 `message_end` 时写入最终消息
- 自动重试检查助手的 `stopReason === "error"` 加上 `errorMessage` 启发式规则

## 统一与 provider 特定职责

统一（通用契约）：

- 事件形状（`AssistantMessageEvent`）
- 最终结果提取（`done`/`error`）
- delta 节流 + 合并规则
- 代理/会话事件传播模型

Provider 特定（未完全抽象）：

- 上游事件分类法和映射逻辑
- 停止原因转换表
- 工具调用 ID 约定
- 推理/思考块语义和签名
- 用量 token 语义和可用时间
- 每个 API 的消息转换约束

## 实现文件

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — provider 分发、选项映射、API 密钥/会话管道。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 通用流队列 + 助手 delta 节流。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — 用于流式工具参数的部分 JSON 解析。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic 事件转换和工具 JSON delta 累积。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses 事件转换和状态映射。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini 流 chunk 到块的转换。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini 完成原因映射和共享转换规则。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — provider 流消费和 `message_update` 桥接。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 会话级流式更新处理、中止、重试和持久化。
