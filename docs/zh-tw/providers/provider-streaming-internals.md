---
title: Provider 串流內部機制
description: Provider 串流實作，包含 SSE 解析、token 計數與背壓處理。
sidebar:
  order: 2
  label: 串流內部機制
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Provider 串流內部機制

本文件說明 `@f5xc-salesdemos/pi-ai` 中如何正規化 token/tool 串流，然後透過 `@f5xc-salesdemos/pi-agent-core` 和 `coding-agent` session 事件進行傳播。

## 端到端流程

1. `streamSimple()`（`packages/ai/src/stream.ts`）映射通用選項並分派至 provider 串流函式。
2. Provider 串流函式（`anthropic.ts`、`openai-responses.ts`、`google.ts`）將 provider 原生串流事件轉換為統一的 `AssistantMessageEvent` 序列。
3. 每個 provider 將事件推送至 `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`），該模組會對 delta 事件進行節流並提供：
   - 非同步迭代以進行增量更新
   - `result()` 用於取得最終的 `AssistantMessage`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）消費這些事件，修改進行中的 assistant 狀態，並發出攜帶原始 `assistantMessageEvent` 的 `message_update` 事件。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）訂閱 agent 事件、持久化訊息、驅動擴充功能 hook，並套用 session 行為（重試、壓縮、TTSR、串流編輯中止檢查）。

## `@f5xc-salesdemos/pi-ai` 中的統一串流契約

所有 provider 發出相同的形狀（`packages/ai/src/types.ts` 中的 `AssistantMessageEvent`）：

- `start`
- 內容區塊生命週期三連組：
  - 文字：`text_start` → `text_delta`* → `text_end`
  - 思考：`thinking_start` → `thinking_delta`* → `thinking_end`
  - 工具呼叫：`toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 終端事件：
  - `done`，附帶 `reason: "stop" | "length" | "toolUse"`
  - 或 `error`，附帶 `reason: "aborted" | "error"`

`AssistantMessageEventStream` 保證：

- 最終結果由終端事件（`done` 或 `error`）解析
- delta 事件會被批次處理/節流（約 50ms）
- 緩衝的 delta 會在非 delta 事件之前以及完成之前被刷新

## Delta 節流與協調行為

`AssistantMessageEventStream` 將 `text_delta`、`thinking_delta` 和 `toolcall_delta` 視為可合併事件：

- 緩衝的 delta 僅在 **type + contentIndex** 匹配時才會合併
- 合併時保留最新的 `partial` 快照
- 非 delta 事件會強制立即刷新

這為 TUI/事件消費者平滑了高頻率的 provider 串流，但這不是 provider 背壓：provider 仍以全速產生資料，而本地串流進行緩衝。

## Provider 正規化細節

## Anthropic（`anthropic-messages`）

來源：`packages/ai/src/providers/anthropic.ts`

正規化要點：

- `message_start` 初始化使用量（input/output/cache token）
- `content_block_start` 映射至 text/thinking/toolcall 開始事件
- `content_block_delta` 映射：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` 僅更新 `thinkingSignature`（不產生事件）
- `content_block_stop` 發出對應的 `*_end`
- `message_delta.stop_reason` 透過 `mapStopReason()` 映射

工具呼叫引數串流：

- 每個工具區塊攜帶內部 `partialJson`
- 每個 JSON delta 附加至 `partialJson`
- `arguments` 在每次 delta 時透過 `parseStreamingJson()` 重新解析
- `toolcall_end` 再解析一次，然後移除 `partialJson`

## OpenAI Responses（`openai-responses`）

來源：`packages/ai/src/providers/openai-responses.ts`

正規化要點：

- `response.output_item.added` 開始 reasoning/text/function-call 區塊
- 推理摘要事件（`response.reasoning_summary_text.delta`）變為 `thinking_delta`
- output/refusal delta 變為 `text_delta`
- `response.function_call_arguments.delta` 變為 `toolcall_delta`
- `response.output_item.done` 發出 `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` 將狀態映射為停止原因和使用量

工具呼叫引數串流：

- 與 Anthropic 相同的 `partialJson` 累積模式
- 僅傳送 `response.function_call_arguments.done` 的 provider 仍會填充最終引數
- 工具呼叫 ID 正規化為 `"<call_id>|<item_id>"`

## Google Generative AI（`google-generative-ai`）

來源：`packages/ai/src/providers/google.ts`

正規化要點：

- 迭代 `candidate.content.parts`
- 文字部分透過 `isThinkingPart(part)` 區分為思考與文字
- 區塊轉換時在開始新區塊之前關閉先前的區塊
- `part.functionCall` 被視為完整的工具呼叫（立即發出 start/delta/end）
- 完成原因透過 `google-shared.ts` 中的 `mapStopReason()` 映射

工具呼叫引數串流：

- 函式呼叫引數以結構化物件抵達，而非增量 JSON 文字
- 實作發出一個合成的 `toolcall_delta`，包含 `JSON.stringify(arguments)`
- 此路徑中 Google 不需要部分 JSON 解析器

## 部分工具呼叫 JSON 累積與恢復

Anthropic/OpenAI Responses 的共用行為使用 `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）：

1. 嘗試 `JSON.parse`
2. 退而使用 `partial-json` 解析器處理不完整的片段
3. 若兩者都失敗，回傳 `{}`

影響：

- 格式錯誤或截斷的引數 delta 不會立即使串流處理崩潰
- 進行中的 `arguments` 可能暫時為 `{}`
- 後續有效的 delta 可以恢復結構化引數，因為每次附加時都會重新嘗試解析
- 最終的 `toolcall_end` 在發出之前會執行最後一次解析嘗試

## 停止原因與傳輸/執行期錯誤

Provider 停止原因被映射為正規化的 `stopReason`：

- Anthropic：`end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全/拒絕情況→`error`
- OpenAI Responses：`completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google：`STOP`→`stop`、`MAX_TOKENS`→`length`、安全/禁止/格式錯誤的函式呼叫類別→`error`

錯誤語意分為兩個階段：

1. **模型完成語意**（provider 回報的完成原因/狀態）
2. **傳輸/執行期失敗**（網路/客戶端/解析器/中止例外）

如果 provider 串流拋出例外或發出失敗訊號，每個 provider 包裝器會捕獲並發出終端 `error` 事件，包含：

- 當中止訊號被設定時 `stopReason = "aborted"`
- 否則 `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 格式錯誤的區塊 / SSE 解析失敗行為

對於這些 provider 路徑，區塊/SSE 框架由供應商 SDK 串流處理（Anthropic SDK、OpenAI SDK、Google SDK）。此程式碼在此處未實作自訂 SSE 解碼器。

目前實作中觀察到的行為：

- SDK 層級的格式錯誤區塊/SSE 解析會以例外或串流 `error` 事件的形式浮現
- provider 包裝器將其轉換為統一的終端 `error` 事件
- 串流函式本身內部不進行 provider 特定的恢復/重試
- 更高層級的重試在 `AgentSession` 自動重試邏輯中處理（訊息層級重試，而非串流區塊重播）

## 取消邊界

取消是分層的：

- AI provider 請求：`options.signal` 傳入 provider 客戶端串流呼叫。
- Provider 包裝器：串流迴圈結束後，已中止的訊號強制進入錯誤路徑（`"Request was aborted"`）。
- Agent 迴圈：在處理每個 provider 事件之前檢查 `signal.aborted`，並可從最新的部分資料合成一個已中止的 assistant 訊息。
- Session/agent 控制：`AgentSession.abort()` -> `agent.abort()` -> 共用的 abort controller 取消。

工具執行取消與模型串流取消是分開的：

- 工具執行器使用 `AbortSignal.any([agentSignal, steeringAbortSignal])`
- steering 中斷可以在保留已產生的工具結果的同時中止剩餘的工具執行

## 背壓邊界

在 provider SDK 串流與下游消費者之間不存在硬性背壓機制：

- `EventStream` 使用無最大大小限制的記憶體佇列
- 節流降低了 UI 更新頻率，但不會減慢 provider 的輸入速度
- 如果消費者嚴重滯後，佇列事件會持續增長直到完成

目前的設計偏好回應性和簡單的排序，而非有界緩衝區的流量控制。

## 串流事件如何呈現為 agent/session 事件

`agentLoop.streamAssistantResponse()` 將 `AssistantMessageEvent` 橋接至 `AgentEvent`：

- 在 `start` 時：推送佔位的 assistant 訊息並發出 `message_start`
- 在區塊事件（`text_*`、`thinking_*`、`toolcall_*`）時：更新最後的 assistant 訊息，發出攜帶原始 `assistantMessageEvent` 的 `message_update`
- 在終端事件（`done`/`error`）時：從 `response.result()` 解析最終訊息，發出 `message_end`

`AgentSession` 接著消費這些事件以進行 session 層級的行為：

- TTSR 監視 `message_update.assistantMessageEvent` 中的 `text_delta` 和 `toolcall_delta`
- 串流編輯防護檢查 `edit` 呼叫上的 `toolcall_delta`/`toolcall_end` 並可提前中止
- 持久化在 `message_end` 時寫入最終訊息
- 自動重試檢查 assistant 的 `stopReason === "error"` 加上 `errorMessage` 啟發式判斷

## 統一與 provider 特定的職責

統一（共用契約）：

- 事件形狀（`AssistantMessageEvent`）
- 最終結果擷取（`done`/`error`）
- delta 節流 + 合併規則
- agent/session 事件傳播模型

Provider 特定（未完全抽象）：

- 上游事件分類法和映射邏輯
- 停止原因轉換表
- 工具呼叫 ID 慣例
- 推理/思考區塊語意和簽章
- 使用量 token 語意和可用時機
- 每個 API 的訊息轉換限制

## 實作檔案

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — provider 分派、選項映射、API 金鑰/session 管道。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 通用串流佇列 + assistant delta 節流。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — 串流工具引數的部分 JSON 解析。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic 事件轉換和工具 JSON delta 累積。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses 事件轉換和狀態映射。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini 串流區塊到區塊的轉換。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini 完成原因映射和共用轉換規則。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — provider 串流消費和 `message_update` 橋接。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — session 層級的串流更新處理、中止、重試和持久化。
