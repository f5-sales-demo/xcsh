---
title: 非壓縮自動重試策略
description: 針對壓縮路徑以外的暫時性 API 失敗的自動重試策略。
sidebar:
  order: 6
  label: 重試策略
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# 非壓縮自動重試策略

本文件描述 `AgentSession` 中的標準 API 錯誤重試路徑。

本文件明確排除透過自動壓縮進行的上下文溢位恢復。溢位由壓縮邏輯處理，並在 [`compaction.md`](./compaction.md) 中另行記載。

## 實作檔案

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## 範圍界限 vs 壓縮

重試和壓縮從同一個 `agent_end` 路徑進行檢查，但它們是刻意分開的：

1. `agent_end` 檢查最後一則助理訊息。
2. `#isRetryableError(...)` 優先執行。
3. 如果啟動了重試，則該輪次會跳過壓縮檢查。
4. 上下文溢位錯誤被硬性排除在重試分類之外（`isContextOverflow(...)` 會短路重試）。
5. 因此溢位會落入 `#checkCompaction(...)` 而非標準重試。

所以：過載/速率限制/伺服器/網路類型的失敗使用此重試策略；上下文視窗溢位使用壓縮恢復。

## 重試分類

`#isRetryableError(...)` 需要滿足以下所有條件：

- 助理的 `stopReason === "error"`
- `errorMessage` 存在
- 訊息**並非**上下文溢位
- `errorMessage` 符合 `#isRetryableErrorMessage(...)`

目前可重試的模式集合（基於正規表達式）：

- overloaded
- rate limit / usage limit / too many requests
- HTTP 類伺服器狀態碼：429、500、502、503、504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay` 措辭

這是字串模式分類，而非型別化的提供者錯誤碼。

## 重試生命週期與狀態轉換

重試使用的工作階段狀態：

- `#retryAttempt: number`（`0` 表示閒置）
- `#retryPromise: Promise<void> | undefined`（追蹤進行中的重試生命週期）
- `#retryResolve: (() => void) | undefined`（解析 `#retryPromise`）
- `#retryAbortController: AbortController | undefined`（取消退避等待）

流程（`#handleRetryableError`）：

1. 讀取 `retry` 設定群組。
2. 如果 `retry.enabled === false`，立即停止（`false`，不啟動重試）。
3. 遞增 `#retryAttempt`。
4. 首次嘗試時建立一次 `#retryPromise`（鏈中的第一次嘗試）。
5. 如果嘗試次數超過 `retry.maxRetries`，發出最終失敗事件並停止。
6. 計算延遲：`retry.baseDelayMs * 2^(attempt-1)`。
7. 對於用量限制錯誤，解析重試提示並呼叫認證儲存（`markUsageLimitReached(...)`）；如果提供者/模型切換成功，將延遲強制設為 `0`。
8. 發出 `auto_retry_start`。
9. 從代理執行時狀態中移除尾端的助理錯誤訊息（保留在持久化的工作階段歷史中）。
10. 支援中止的等待。
11. 喚醒後，透過 `setTimeout(..., 0)` 排程 `agent.continue()`。

### 重試計數器重置的情況

`#retryAttempt` 在以下情況重置為 `0`：

- 重試開始後第一個成功的非錯誤、非中止助理訊息（發出 `auto_retry_end { success: true }`）
- 退避等待期間的重試取消
- 超過最大重試次數的路徑

`#retryPromise` 在重試鏈結束時（成功、取消或超過上限）透過 `#resolveRetry()` 解析/清除。

## 退避與最大嘗試次數語義

設定：

- `retry.enabled`（預設 `true`）
- `retry.maxRetries`（預設 `3`）
- `retry.baseDelayMs`（預設 `2000`）

嘗試次數編號：

- 嘗試計數器在最大值檢查前遞增
- 開始事件使用當前嘗試次數（從 1 開始）
- 超過上限的結束事件回報 `attempt: this.#retryAttempt - 1`（最後一次嘗試的重試計數）

使用預設設定的退避序列：

- 嘗試 1：2000 ms
- 嘗試 2：4000 ms
- 嘗試 3：8000 ms

延遲覆寫輸入僅用於用量限制處理路徑，且僅用於影響認證儲存的模型/帳戶切換決策。在主要的非壓縮重試路徑中，退避保持本地指數延遲，除非切換成功（`delayMs = 0`）。

## 中止機制

### 明確的重試中止

`abortRetry()`：

- 中止 `#retryAbortController`（如果存在）
- 解析重試 promise（`#resolveRetry()`），使等待者不被阻塞

如果中止在等待期間觸發，catch 路徑會發出：

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- 重置嘗試次數/控制器

### 全域操作中止互動

`abort()` 在中止活動的代理串流之前呼叫 `abortRetry()`。這保證當使用者發出一般中止時，重試退避會被取消。

### TUI 互動

在 `auto_retry_start` 時，EventController：

- 將 `Esc` 處理器切換為 `session.abortRetry()`
- 顯示載入文字：`Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

在 `auto_retry_end` 時，恢復先前的 `Esc` 處理器並清除載入狀態。

## 串流與提示完成行為

`prompt()` 最終在 `agent.prompt(...)` 回傳後等待 `#waitForRetry()`。

效果：

- 一個提示呼叫不會完全解析，直到任何已啟動的重試鏈結束（成功/失敗/取消）
- 重試生命週期是一個邏輯提示執行邊界的一部分

這可防止呼叫者過早地將正在重試的輪次視為已完成。

## 控制：設定與 RPC

### 設定選項

在設定結構描述中定義於 retry 群組下：

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

工作階段中的程式化切換：

- `setAutoRetryEnabled(enabled)` 寫入 `retry.enabled`
- `autoRetryEnabled` 讀取 `retry.enabled`
- `isRetrying` 回報重試生命週期 promise 是否處於活動狀態

### RPC 控制

RPC 命令介面：

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

客戶端輔助方法：

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

兩個命令都回傳成功回應；重試進度/失敗詳情來自串流的工作階段事件，而非命令回應的酬載。

## 事件發出與失敗呈現

工作階段層級的重試事件：

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

傳播方式：

- 透過 `AgentSession.subscribe(...)` 發出
- 作為擴充事件轉發至擴充執行器
- 在 RPC 模式中，直接作為 JSON 事件物件轉發（`session.subscribe(event => output(event))`）
- 在 TUI 中，由 `EventController` 消費以呈現載入/錯誤 UI

最終失敗呈現：

- 在超過上限或取消時，`auto_retry_end.success === false`
- TUI 顯示：`Retry failed after N attempts: <finalError>`
- 擴充/掛鉤接收具有相同欄位的 `auto_retry_end`
- RPC 消費者在 stdout 串流上接收相同的事件物件

## 永久停止條件

在以下任一情況發生時，重試會停止且不會自動繼續：

- `retry.enabled` 為 false
- 錯誤不符合重試分類
- 錯誤為上下文溢位（委派給壓縮路徑）
- 超過最大重試次數
- 使用者取消重試（重試載入期間按 `abort_retry` 或 `Esc`）
- 全域中止（`abort`）先取消重試

在計數器重置後，新的重試鏈仍可在未來的可重試錯誤上啟動。

## 操作注意事項

- 分類使用正規表達式文字比對；此處不使用提供者特定的結構化錯誤。
- 重試會從**執行時上下文**中移除失敗的助理錯誤，然後再繼續，但工作階段歷史仍保留該錯誤條目。
- `RpcSessionState` 目前公開 `autoCompactionEnabled` 但未公開 `autoRetryEnabled` 欄位；RPC 呼叫者必須自行追蹤切換狀態，或透過其他 API 查詢設定。
