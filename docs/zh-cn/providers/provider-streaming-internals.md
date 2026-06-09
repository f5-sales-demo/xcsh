---
title: 提供者流式处理内部机制
description: 提供者流式处理实现，包括 SSE 解析、Token 计数和背压处理。
sidebar:
  order: 2
  label: 流式处理内部机制
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# 提供者流式处理内部机制

本文档介绍了 `@f5xc-salesdemos/pi-ai` 中 token/工具流式处理的标准化方式，以及如何通过 `@f5xc-salesdemos/pi-agent-core` 和 `coding-agent` 会话事件进行传播。

## 端到端流程

1. `streamSimple()`（`packages/ai/src/stream.ts`）映射通用选项并分派到提供者流式处理函数。
2. 提供者流式处理函数（`anthropic.ts`、`openai-responses.ts`、`google.ts`）将提供者原生流事件转换为统一的 `AssistantMessageEvent` 序列。
3. 每个提供者将事件推送到 `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`），该流对增量事件进行节流并暴露：
   - 用于增量更新的异步迭代
   - 用于获取最终 `AssistantMessage` 的 `result()`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）消费这些事件，修改进行中的助手状态，并发出携带原始 `assistantMessageEvent` 的 `message_update` 事件。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）订阅代理事件，持久化消息，驱动扩展钩子，并应用会话行为（重试、压缩、TTSR、流式编辑中止检查）。

## `@f5xc-salesdemos/pi-ai` 中的统一流式处理契约

所有提供者发出相同的数据结构（`packages/ai/src/types.ts` 中的 `AssistantMessageEvent`）：

- `start`
- 内容块生命周期三元组：
  - 文本：`text_start` → `text_delta`* → `text_end`
  - 思考：`thinking_start` → `thinking_delta`* → `thinking_end`
  - 工具调用：`toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 终止事件：
  - `done`，附带 `reason: "stop" | "length" | "toolUse"`
  - 或 `error`，附带 `reason: "aborted" | "error"`

`AssistantMessageEventStream` 保证：

- 最终结果由终止事件（`done` 或 `error`）解析
- 增量事件被批量/节流处理（约 50ms）
- 缓冲的增量事件在非增量事件之前和完成之前被刷新

## 增量事件节流与协调行为

`AssistantMessageEventStream` 将 `text_delta`、`thinking_delta` 和 `toolcall_delta` 视为可合并事件：

- 缓冲的增量事件仅在 **type + contentIndex** 匹配时才会合并
- 合并保留最新的 `partial` 快照
- 非增量事件强制立即刷新

这为 TUI/事件消费者平滑了高频提供者流，但这不是提供者背压：提供者仍然以全速生产，而本地流进行缓冲。

## 提供者标准化细节

## Anthropic（`anthropic-messages`）

源码：`packages/ai/src/providers/anthropic.ts`

标准化要点：

- `message_start` 初始化用量（输入/输出/缓存 token）
- `content_block_start` 映射为文本/思考/工具调用的开始事件
- `content_block_delta` 映射：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` 仅更新 `thinkingSignature`（不发出事件）
- `content_block_stop` 发出对应的 `*_end`
- `message_delta.stop_reason` 通过 `mapStopReason()` 映射

工具调用参数流式处理：

- 每个工具块携带内部 `partialJson`
- 每个 JSON 增量追加到 `partialJson`
- `arguments` 在每次增量时通过 `parseStreamingJson()` 重新解析
- `toolcall_end` 再次重新解析，然后剥离 `partialJson`

## OpenAI Responses（`openai-responses`）

源码：`packages/ai/src/providers/openai-responses.ts`

标准化要点：

- `response.output_item.added` 开始推理/文本/函数调用块
- 推理摘要事件（`response.reasoning_summary_text.delta`）变为 `thinking_delta`
- 输出/拒绝增量变为 `text_delta`
- `response.function_call_arguments.delta` 变为 `toolcall_delta`
- `response.output_item.done` 发出 `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` 将状态映射为停止原因和用量

工具调用参数流式处理：

- 与 Anthropic 相同的 `partialJson` 累积模式
- 仅发送 `response.function_call_arguments.done` 的提供者仍会填充最终参数
- 工具调用 ID 标准化为 `"<call_id>|<item_id>"`

## Google Generative AI（`google-generative-ai`）

源码：`packages/ai/src/providers/google.ts`

标准化要点：

- 迭代 `candidate.content.parts`
- 文本部分通过 `isThinkingPart(part)` 分为思考和文本
- 块转换在开始新块之前关闭前一个块
- `part.functionCall` 被视为完整的工具调用（立即发出 start/delta/end）
- 完成原因通过 `google-shared.ts` 中的 `mapStopReason()` 映射

工具调用参数流式处理：

- 函数调用参数以结构化对象到达，而非增量 JSON 文本
- 实现发出一个合成的 `toolcall_delta`，包含 `JSON.stringify(arguments)`
- 在此路径中 Google 不需要部分 JSON 解析器

## 部分工具调用 JSON 累积与恢复

Anthropic/OpenAI Responses 的共享行为使用 `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）：

1. 尝试 `JSON.parse`
2. 回退到 `partial-json` 解析器处理不完整片段
3. 如果两者都失败，返回 `{}`

影响：

- 格式错误或截断的参数增量不会立即导致流处理崩溃
- 处理中的 `arguments` 可能暂时为 `{}`
- 后续有效的增量可以恢复结构化参数，因为每次追加都会重新尝试解析
- 最终的 `toolcall_end` 在发出前执行最后一次解析尝试

## 停止原因与传输/运行时错误

提供者停止原因被映射为标准化的 `stopReason`：

- Anthropic：`end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全/拒绝情况→`error`
- OpenAI Responses：`completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google：`STOP`→`stop`、`MAX_TOKENS`→`length`、安全/禁止/格式错误的函数调用类别→`error`

错误语义分为两个阶段：

1. **模型完成语义**（提供者报告的完成原因/状态）
2. **传输/运行时故障**（网络/客户端/解析器/中止异常）

如果提供者流抛出异常或发出故障信号，每个提供者包装器会捕获并发出终止 `error` 事件，附带：

- 当中止信号被设置时 `stopReason = "aborted"`
- 否则 `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 格式错误的块 / SSE 解析失败行为

对于这些提供者路径，块/SSE 帧处理由供应商 SDK 流处理（Anthropic SDK、OpenAI SDK、Google SDK）。此代码在这里不实现自定义 SSE 解码器。

当前实现中观察到的行为：

- SDK 层面的格式错误块/SSE 解析以异常或流 `error` 事件的形式出现
- 提供者包装器将其转换为统一的终止 `error` 事件
- 流式处理函数内部没有特定于提供者的恢复/重试
- 更高层级的重试在 `AgentSession` 自动重试逻辑中处理（消息级别重试，而非流块重放）

## 取消边界

取消是分层的：

- AI 提供者请求：`options.signal` 被传入提供者客户端流调用。
- 提供者包装器：流循环之后，已中止的信号强制进入错误路径（`"Request was aborted"`）。
- 代理循环：在处理每个提供者事件之前检查 `signal.aborted`，并可以从最新的部分内容合成一个已中止的助手消息。
- 会话/代理控制：`AgentSession.abort()` -> `agent.abort()` -> 共享中止控制器取消。

工具执行取消与模型流取消是分开的：

- 工具运行器使用 `AbortSignal.any([agentSignal, steeringAbortSignal])`
- 引导中断可以中止剩余的工具执行，同时保留已产生的工具结果

## 背压边界

提供者 SDK 流与下游消费者之间没有硬性背压机制：

- `EventStream` 使用无最大大小限制的内存队列
- 节流降低了 UI 更新频率，但不会减慢提供者的摄入速度
- 如果消费者严重滞后，排队的事件可能会增长直到完成

当前设计优先考虑响应性和简单的排序，而非有界缓冲区流控制。

## 流事件如何作为代理/会话事件呈现

`agentLoop.streamAssistantResponse()` 将 `AssistantMessageEvent` 桥接到 `AgentEvent`：

- 在 `start` 时：推送占位助手消息并发出 `message_start`
- 在块事件（`text_*`、`thinking_*`、`toolcall_*`）时：更新最后的助手消息，发出附带原始 `assistantMessageEvent` 的 `message_update`
- 在终止（`done`/`error`）时：从 `response.result()` 解析最终消息，发出 `message_end`

`AgentSession` 随后消费这些事件以实现会话级别的行为：

- TTSR 监视 `message_update.assistantMessageEvent` 中的 `text_delta` 和 `toolcall_delta`
- 流式编辑守卫检查 `edit` 调用上的 `toolcall_delta`/`toolcall_end`，并可以提前中止
- 持久化在 `message_end` 时写入最终消息
- 自动重试检查助手的 `stopReason === "error"` 加上 `errorMessage` 启发式规则

## 统一职责与提供者特定职责

统一（通用契约）：

- 事件结构（`AssistantMessageEvent`）
- 最终结果提取（`done`/`error`）
- 增量节流 + 合并规则
- 代理/会话事件传播模型

提供者特定（未完全抽象）：

- 上游事件分类体系和映射逻辑
- 停止原因转换表
- 工具调用 ID 约定
- 推理/思考块语义和签名
- 用量 token 语义和可用时机
- 每个 API 的消息转换约束

## 实现文件

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — 提供者分派、选项映射、API 密钥/会话管道。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 通用流队列 + 助手增量节流。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — 用于流式工具参数的部分 JSON 解析。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic 事件转换和工具 JSON 增量累积。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses 事件转换和状态映射。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini 流块到块的转换。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini 完成原因映射和共享转换规则。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — 提供者流消费和 `message_update` 桥接。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 流式更新、中止、重试和持久化的会话级处理。
