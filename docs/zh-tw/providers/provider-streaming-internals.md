---
title: 提供者串流內部機制
description: 提供者串流實作，包含 SSE 解析、token 計數及背壓處理。
sidebar:
  order: 2
  label: 串流內部機制
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# 提供者串流內部機制

本文件說明 token/工具串流如何在 `@f5xc-salesdemos/pi-ai` 中進行正規化，然後透過 `@f5xc-salesdemos/pi-agent-core` 和 `coding-agent` 會話事件進行傳播。

## 端對端流程

1. `streamSimple()`（`packages/ai/src/stream.ts`）映射通用選項並分派至提供者串流函式。
2. 提供者串流函式（`anthropic.ts`、`openai-responses.ts`、`google.ts`）將提供者原生串流事件轉換為統一的 `AssistantMessageEvent` 序列。
3. 每個提供者將事件推送至 `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`），其會節流 delta 事件並公開：
   - 非同步迭代以進行增量更新
   - `result()` 以取得最終的 `AssistantMessage`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）消費這些事件、變更進行中的助手狀態，並發出攜帶原始 `assistantMessageEvent` 的 `message_update` 事件。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）訂閱代理事件、持久化訊息、驅動擴充掛鉤，並套用會話行為（重試、壓縮、TTSR、串流編輯中止檢查）。

## `@f5xc-salesdemos/pi-ai` 中的統一串流契約

所有提供者發出相同形狀（`packages/ai/src/types.ts` 中的 `AssistantMessageEvent`）：

- `start`
- 內容區塊生命週期三元組：
  - 文字：`text_start` → `text_delta`* → `text_end`
  - 思考：`thinking_start` → `thinking_delta`* → `thinking_end`
  - 工具呼叫：`toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 終端事件：
  - `done`，附帶 `reason: "stop" | "length" | "toolUse"`
  - 或 `error`，附帶 `reason: "aborted" | "error"`

`AssistantMessageEventStream` 保證：

- 最終結果由終端事件（`done` 或 `error`）解析
- delta 會被批次處理/節流（約 50ms）
- 緩衝的 delta 在非 delta 事件和完成之前會被刷新

## Delta 節流與協調行為

`AssistantMessageEventStream` 將 `text_delta`、`thinking_delta` 和 `toolcall_delta` 視為可合併事件：

- 緩衝的 delta 僅在**類型 + contentIndex** 匹配時才會合併
- 合併保留最新的 `partial` 快照
- 非 delta 事件會強制立即刷新

這為 TUI/事件消費者平滑了高頻提供者串流，但這不是提供者背壓：提供者仍然以全速產生資料，而本地串流進行緩衝。

## 提供者正規化細節

## Anthropic（`anthropic-messages`）

來源：`packages/ai/src/providers/anthropic.ts`

正規化要點：

- `message_start` 初始化使用量（輸入/輸出/快取 token）
- `content_block_start` 映射為文字/思考/工具呼叫的開始
- `content_block_delta` 映射：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` 僅更新 `thinkingSignature`（不產生事件）
- `content_block_stop` 發出對應的 `*_end`
- `message_delta.stop_reason` 透過 `mapStopReason()` 映射

工具呼叫參數串流：

- 每個工具區塊攜帶內部 `partialJson`
- 每個 JSON delta 附加到 `partialJson`
- `arguments` 在每個 delta 上透過 `parseStreamingJson()` 重新解析
- `toolcall_end` 再次重新解析，然後移除 `partialJson`

## OpenAI Responses（`openai-responses`）

來源：`packages/ai/src/providers/openai-responses.ts`

正規化要點：

- `response.output_item.added` 啟動推理/文字/函式呼叫區塊
- 推理摘要事件（`response.reasoning_summary_text.delta`）轉為 `thinking_delta`
- 輸出/拒絕 delta 轉為 `text_delta`
- `response.function_call_arguments.delta` 轉為 `toolcall_delta`
- `response.output_item.done` 發出 `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` 將狀態映射為停止原因和使用量

工具呼叫參數串流：

- 與 Anthropic 相同的 `partialJson` 累積模式
- 僅發送 `response.function_call_arguments.done` 的提供者仍會填充最終參數
- 工具呼叫 ID 正規化為 `"<call_id>|<item_id>"`

## Google 生成式 AI（`google-generative-ai`）

來源：`packages/ai/src/providers/google.ts`

正規化要點：

- 迭代 `candidate.content.parts`
- 文字部分透過 `isThinkingPart(part)` 分為思考與文字
- 區塊轉換在啟動新區塊之前關閉前一個區塊
- `part.functionCall` 被視為完整的工具呼叫（立即發出 start/delta/end）
- 完成原因透過 `google-shared.ts` 中的 `mapStopReason()` 映射

工具呼叫參數串流：

- 函式呼叫參數以結構化物件到達，而非增量 JSON 文字
- 實作發出一個合成的 `toolcall_delta`，包含 `JSON.stringify(arguments)`
- 在此路徑中 Google 不需要部分 JSON 解析器

## 部分工具呼叫 JSON 累積與恢復

Anthropic/OpenAI Responses 的共用行為使用 `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）：

1. 嘗試 `JSON.parse`
2. 回退到 `partial-json` 解析器處理不完整的片段
3. 如果兩者都失敗，返回 `{}`

影響：

- 格式錯誤或截斷的參數 delta 不會立即導致串流處理崩潰
- 進行中的 `arguments` 可能暫時為 `{}`
- 後續有效的 delta 可以恢復結構化參數，因為每次附加都會重試解析
- 最終 `toolcall_end` 在發出之前執行最後一次解析嘗試

## 停止原因 vs 傳輸/執行時期錯誤

提供者停止原因映射為正規化的 `stopReason`：

- Anthropic：`end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全/拒絕情況→`error`
- OpenAI Responses：`completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google：`STOP`→`stop`、`MAX_TOKENS`→`length`、安全/禁止/格式錯誤的函式呼叫類別→`error`

錯誤語義分為兩個階段：

1. **模型完成語義**（提供者回報的完成原因/狀態）
2. **傳輸/執行時期失敗**（網路/客戶端/解析器/中止例外）

如果提供者串流拋出例外或發出失敗訊號，每個提供者包裝器會捕獲並發出終端 `error` 事件，附帶：

- 當中止訊號被設定時 `stopReason = "aborted"`
- 否則 `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 格式錯誤的區塊 / SSE 解析失敗行為

對於這些提供者路徑，區塊/SSE 框架由供應商 SDK 串流處理（Anthropic SDK、OpenAI SDK、Google SDK）。此程式碼在這裡不實作自訂 SSE 解碼器。

當前實作中觀察到的行為：

- SDK 層級的格式錯誤區塊/SSE 解析以例外或串流 `error` 事件形式浮現
- 提供者包裝器將其轉換為統一的終端 `error` 事件
- 串流函式本身內部沒有提供者特定的恢復/重試機制
- 較高層級的重試在 `AgentSession` 自動重試邏輯中處理（訊息層級重試，而非串流區塊重播）

## 取消邊界

取消是分層的：

- AI 提供者請求：`options.signal` 傳入提供者客戶端串流呼叫。
- 提供者包裝器：串流迴圈結束後，已中止的訊號強制進入錯誤路徑（`"Request was aborted"`）。
- 代理迴圈：在處理每個提供者事件之前檢查 `signal.aborted`，可以從最新的部分結果合成一個已中止的助手訊息。
- 會話/代理控制：`AgentSession.abort()` -> `agent.abort()` -> 共享中止控制器取消。

工具執行取消與模型串流取消是分開的：

- 工具執行器使用 `AbortSignal.any([agentSignal, steeringAbortSignal])`
- 引導中斷可以中止剩餘的工具執行，同時保留已產生的工具結果

## 背壓邊界

提供者 SDK 串流與下游消費者之間沒有硬性背壓機制：

- `EventStream` 使用沒有最大容量限制的記憶體內佇列
- 節流降低了 UI 更新速率，但不會減慢提供者的接收速度
- 如果消費者嚴重落後，排隊的事件可能會持續增長直到完成

當前設計優先考慮回應性和簡單排序，而非有界緩衝區流控制。

## 串流事件如何作為代理/會話事件浮現

`agentLoop.streamAssistantResponse()` 將 `AssistantMessageEvent` 橋接至 `AgentEvent`：

- 在 `start` 時：推送佔位助手訊息並發出 `message_start`
- 在區塊事件（`text_*`、`thinking_*`、`toolcall_*`）時：更新最後的助手訊息，發出攜帶原始 `assistantMessageEvent` 的 `message_update`
- 在終端（`done`/`error`）時：從 `response.result()` 解析最終訊息，發出 `message_end`

`AgentSession` 隨後消費這些事件以處理會話層級行為：

- TTSR 監視 `message_update.assistantMessageEvent` 中的 `text_delta` 和 `toolcall_delta`
- 串流編輯防護檢查 `edit` 呼叫上的 `toolcall_delta`/`toolcall_end`，並可提前中止
- 持久化在 `message_end` 時寫入已完成的訊息
- 自動重試檢查助手的 `stopReason === "error"` 加上 `errorMessage` 啟發式規則

## 統一 vs 提供者特定職責

統一（共同契約）：

- 事件形狀（`AssistantMessageEvent`）
- 最終結果提取（`done`/`error`）
- delta 節流 + 合併規則
- 代理/會話事件傳播模型

提供者特定（未完全抽象化）：

- 上游事件分類法和映射邏輯
- 停止原因轉換表
- 工具呼叫 ID 慣例
- 推理/思考區塊語義和簽章
- 使用量 token 語義和可用時機
- 每個 API 的訊息轉換限制

## 實作檔案

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — 提供者分派、選項映射、API 金鑰/會話管線。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 通用串流佇列 + 助手 delta 節流。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — 串流工具參數的部分 JSON 解析。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic 事件轉換和工具 JSON delta 累積。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses 事件轉換和狀態映射。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini 串流區塊到區塊的轉換。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini 完成原因映射和共用轉換規則。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — 提供者串流消費和 `message_update` 橋接。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 串流更新、中止、重試和持久化的會話層級處理。
