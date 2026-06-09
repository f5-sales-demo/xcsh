---
title: MCP 協定與傳輸層內部機制
description: MCP 協定實作，包含 stdio、SSE 和串流 HTTP 傳輸層。
sidebar:
  order: 2
  label: 協定與傳輸層
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# MCP 協定與傳輸層內部機制

本文件描述 coding-agent 如何實作 MCP JSON-RPC 訊息傳遞，以及協定層面與傳輸層面的關注點如何分離。

## 範圍

涵蓋內容：

- JSON-RPC 請求/回應與通知流程
- stdio 和 HTTP/SSE 傳輸的請求關聯與生命週期
- 逾時與取消行為
- 錯誤傳播與格式錯誤的酬載處理
- 傳輸選擇邊界（`stdio` vs `http`/`sse`）
- 哪些重連/重試職責屬於傳輸層級 vs 管理器層級

不涵蓋擴充功能的開發者體驗或命令列 UI。

## 實作檔案

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## 層級邊界

### 協定層（JSON-RPC + MCP 方法）

- 訊息結構定義在 `types.ts` 中（`JsonRpcRequest`、`JsonRpcNotification`、`JsonRpcResponse`、`JsonRpcMessage`）。
- MCP 客戶端邏輯（`client.ts`）決定方法順序與工作階段握手：
  1. `initialize` 請求
  2. `notifications/initialized` 通知
  3. 方法呼叫如 `tools/list`、`tools/call`

### 傳輸層（`MCPTransport`）

`MCPTransport` 抽象化傳遞與生命週期：

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- 選用回呼：`onClose`、`onError`、`onNotification`

傳輸層實作擁有訊框處理與 I/O 細節：

- `StdioTransport`：透過子行程 stdio 的換行分隔 JSON
- `HttpTransport`：透過 HTTP POST 的 JSON-RPC，可選 SSE 回應/監聽

### 目前的重要注意事項

傳輸層回呼（`onClose`、`onError`、`onNotification`）已實作，但目前 `MCPClient`/`MCPManager` 流程並未將重連邏輯連接到這些回呼。通知僅在呼叫者註冊處理器時才會被消費。

## 傳輸選擇

`client.ts:createTransport()` 根據設定選擇傳輸方式：

- `type` 省略或 `"stdio"` -> `createStdioTransport`
- `"http"` 或 `"sse"` -> `createHttpTransport`

`"sse"` 被視為 HTTP 傳輸的變體（同一個類別），而非獨立的傳輸實作。

## JSON-RPC 訊息流程與關聯

## 請求 ID

每個傳輸層為每個請求產生 ID（`Math.random` + 時間戳記字串）。ID 是傳輸層本地的關聯令牌。

## Stdio 關聯路徑

- 輸出請求序列化為一個 JSON 物件 + `\n`。
- `#pendingRequests: Map<id, {resolve,reject}>` 儲存進行中的請求。
- 讀取迴圈從 stdout 解析 JSONL 並呼叫 `#handleMessage`。
- 如果輸入訊息有匹配的 `id`，請求會被解析/拒絕。
- 如果輸入訊息有 `method` 但沒有 `id`，視為通知並傳送至 `onNotification`。

未知 ID 會被忽略（不拒絕、不觸發錯誤回呼）。

## HTTP 關聯路徑

- 輸出請求是帶有 JSON 主體和產生的 `id` 的 HTTP `POST`。
- 非 SSE 回應路徑：解析一個 JSON-RPC 回應並回傳 `result`/在 `error` 時拋出例外。
- SSE 回應路徑（`Content-Type: text/event-stream`）：串流事件，回傳第一個 `id` 匹配預期請求 ID 且包含 `result` 或 `error` 的訊息。
- 帶有 `method` 但沒有 `id` 的 SSE 訊息被視為通知。

如果 SSE 串流在匹配回應之前結束，請求會以 `No response received for request ID ...` 失敗。

## 通知

客戶端透過 `transport.notify(...)` 發出 JSON-RPC 通知。

- Stdio：將通知框架寫入 stdin（`jsonrpc`、`method`、選用 `params`）加上換行。
- HTTP：傳送不含 `id` 的 POST 主體；成功接受 `2xx` 或 `202 Accepted`。

伺服器發起的通知僅透過傳輸層的 `onNotification` 呈現；管理器/客戶端中沒有預設的全域訂閱者。

## Stdio 傳輸層內部機制

## 生命週期與狀態轉換

- 初始狀態：`connected=false`、`process=null`、待處理 map 為空
- `connect()`：
  - 使用設定的命令/參數/環境變數/工作目錄產生子行程
  - 標記為已連線
  - 啟動 stdout 讀取迴圈（`readJsonl`）
  - 啟動 stderr 迴圈（讀取/丟棄；目前為靜默模式）
- `close()`：
  - 標記為已斷線
  - 拒絕所有待處理請求（`Transport closed`）
  - 終止子行程
  - 等待讀取迴圈關閉
  - 觸發 `onClose`

如果讀取迴圈意外退出，`finally` 會觸發 `#handleClose()`，執行相同的待處理請求拒絕和關閉回呼。

## 逾時與取消

每個請求：

- 逾時預設為 `config.timeout ?? 30000`
- 來自呼叫者的選用 `AbortSignal`
- 中止和逾時都會拒絕待處理的 promise 並清除 map 條目

取消僅限本地：傳輸層不會向伺服器發送協定層級的取消通知。

## 格式錯誤的酬載處理

在讀取迴圈中：

- 每個解析的 JSONL 行在 `try/catch` 中傳遞給 `#handleMessage`
- 格式錯誤/無效訊息的處理例外會被丟棄（`Skip malformed lines` 註解）
- 迴圈繼續，因此一條錯誤訊息不會中斷連線

如果底層串流解析器拋出例外，會呼叫 `onError`（在仍處於連線狀態時），然後連線關閉。

## 斷線/失敗行為

當行程退出或串流關閉時：

- 所有進行中的請求以 `Transport closed` 被拒絕
- 沒有自動重啟或重連
- 上層必須透過建立新的傳輸層來重連

## 背壓/串流注意事項

- 輸出寫入使用 `stdin.write()` + `flush()`，不等待排水語意。
- 傳輸層中沒有明確的佇列或高水位標記管理。
- 輸入處理由串流驅動（透過 `readJsonl` 的 `for await`），一次處理一個解析的訊息。

## HTTP/SSE 傳輸層內部機制

## 生命週期與連線語意

HTTP 傳輸有邏輯連線狀態，但請求路徑是每次 HTTP 呼叫的無狀態：

- `connect()` 設定 `connected=true`（無 socket/工作階段握手）
- 透過 `Mcp-Session-Id` 標頭進行選用的伺服器工作階段追蹤
- `close()` 選擇性地傳送帶有 `Mcp-Session-Id` 的 `DELETE`，中止 SSE 監聽器，觸發 `onClose`

因此 `connected` 意味著「傳輸層可用」，而非「已建立持久串流」。

## 工作階段標頭行為

- 在 POST 回應中，如果存在 `Mcp-Session-Id` 標頭，傳輸層會儲存它。
- 後續請求/通知包含 `Mcp-Session-Id`。
- `close()` 嘗試透過 HTTP DELETE 終止伺服器工作階段；終止失敗會被忽略。

## 逾時與取消

對於 `request()` 和 `notify()`：

- 逾時使用 `AbortController`（`config.timeout ?? 30000`）
- 外部 signal 如有提供，透過 `AbortSignal.any([...])` 合併
- AbortError 處理會區分呼叫者中止與逾時

拋出的錯誤：

- 逾時：`Request timeout after ...ms`（或 `SSE response timeout ...`、`Notify timeout ...`）
- 呼叫者中止：當外部 signal 已經被中止時，重新拋出原始 AbortError

## HTTP 錯誤傳播

在非 OK 回應時：

- 回應文字包含在拋出的錯誤中（`HTTP <status>: <text>`）
- 如果存在，來自 `WWW-Authenticate` 和 `Mcp-Auth-Server` 的驗證提示會被附加

在 JSON-RPC 錯誤物件時：

- 拋出 `MCP error <code>: <message>`

格式錯誤的 JSON 主體（`response.json()` 失敗）作為解析例外傳播。

## SSE 行為與模式

存在兩種 SSE 路徑：

1. **每請求 SSE 回應**（`#parseSSEResponse`）
   - 當 POST 回應內容類型為 `text/event-stream` 時使用
   - 消費串流直到找到匹配的回應 id
   - 可在同一串流中處理交錯的通知

2. **背景 SSE 監聽器**（`startSSEListener()`）
   - 用於伺服器發起通知的選用 GET 監聽器
   - 目前不會被 MCP 管理器/客戶端自動啟動
   - 如果 GET 回傳 `405`，監聽器會靜默地自行停用（伺服器不支援此模式）

## 格式錯誤的酬載與斷線處理

SSE JSON 解析錯誤會從 `readSseJson` 冒出並拒絕請求/監聽器。

- 請求 SSE 解析錯誤會拒絕當前的請求。
- 背景監聽器錯誤會觸發 `onError`（AbortError 除外）。
- 背景監聽器沒有自動重連。

## `json-rpc.ts` 工具函式 vs 傳輸抽象

`src/mcp/json-rpc.ts` 提供 `callMCP()` 和 `parseSSE()` 輔助函式，用於直接 HTTP MCP 呼叫（被 Exa 整合使用），而非 `MCPClient`/`MCPManager` 使用的 `MCPTransport` 抽象。

與 `HttpTransport` 的顯著差異：

- 先解析整個回應文字，然後提取第一個 `data:` 行（`parseSSE`），並以 JSON 作為備用
- 沒有請求逾時管理、沒有中止 API、沒有 session-id 處理、沒有傳輸生命週期
- 回傳原始 JSON-RPC 信封物件

此路徑輕量但不如完整傳輸實作穩健。

## 重試/重連職責

## 傳輸層級

目前的傳輸實作**不會**：

- 重試失敗的請求
- 在 stdio 行程退出後重連
- 重連 SSE 監聽器
- 在斷線後重新傳送進行中的請求

它們會快速失敗並傳播錯誤。

## 管理器/客戶端層級

`MCPManager` 處理探索/初始連線編排，僅能透過再次執行連線流程（`connectToServer`/`discoverAndConnect` 路徑）來重連。它不會在執行期間的失敗回呼中自動修復已連線的傳輸。

`MCPManager` 確實具有針對慢速伺服器的啟動備用行為（從快取延遲載入工具），但那是工具可用性的備用機制，而非傳輸重試。

## 失敗情境摘要

- **格式錯誤的 stdio 訊息行**：被丟棄；串流繼續。
- **Stdio 串流/行程結束**：傳輸關閉；待處理請求以 `Transport closed` 被拒絕。
- **HTTP 非 2xx**：請求/通知拋出 HTTP 錯誤。
- **無效 JSON 回應**：解析例外被傳播。
- **SSE 在匹配 id 之前結束**：請求以 `No response received for request ID ...` 失敗。
- **逾時**：傳輸特定的逾時錯誤。
- **呼叫者中止**：從呼叫者 signal 傳播 AbortError/原因。

## 實務邊界規則

如果關注點是訊息結構、id 關聯或 MCP 方法排序，它屬於協定/客戶端邏輯。

如果關注點是訊框處理（JSONL vs HTTP/SSE）、串流解析、fetch/spawn 生命週期、逾時計時器或連線拆除，它屬於傳輸層實作。
