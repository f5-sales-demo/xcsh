---
title: MCP 執行時期生命週期
description: MCP 伺服器程序的生命週期，從初始化到工具註冊、健康監控及關閉。
sidebar:
  order: 3
  label: 執行時期生命週期
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCP 執行時期生命週期

本文件描述 MCP 伺服器如何在 coding-agent 執行時期中被發現、連線、公開為工具、重新整理及終止。

## 生命週期概覽

1. **SDK 啟動**時呼叫 `discoverAndLoadMCPTools()`（除非 MCP 已停用）。
2. **發現階段**（`loadAllMCPConfigs`）從能力來源解析 MCP 伺服器設定、過濾已停用/專案/Exa 項目，並保留來源中繼資料。
3. **管理器連線階段**（`MCPManager.connectServers`）以平行方式啟動各伺服器的連線 + `tools/list`。
4. **快速啟動閘門**最多等待 250 毫秒，然後可能回傳：
   - 完全載入的 `MCPTool`，
   - 各伺服器的失敗資訊，
   - 或針對仍在等待中的伺服器回傳快取的 `DeferredMCPTool`。
5. **SDK 串接**將 MCP 工具合併至該工作階段的執行時期工具註冊表。
6. **即時工作階段**可透過 `/mcp` 流程重新整理 MCP 工具（`disconnectAll` + 重新發現 + `session.refreshMCPTools`）。
7. **終止**發生在呼叫者調用 `disconnectServer`/`disconnectAll` 時；管理器也會清除已中斷連線伺服器的 MCP 工具註冊。

## 發現與載入階段

### 從 SDK 進入的路徑

`src/sdk.ts` 中的 `createAgentSession()` 在 `enableMCP` 為 true（預設值）時執行 MCP 啟動：

- 呼叫 `discoverAndLoadMCPTools(cwd, { ... })`，
- 傳入 `authStorage`、快取儲存，以及 `mcp.enableProjectConfig` 設定，
- 始終設定 `filterExa: true`，
- 記錄各伺服器的載入/連線錯誤，
- 將回傳的管理器儲存在 `toolSession.mcpManager` 和工作階段結果中。

若 `enableMCP` 為 false，則完全跳過 MCP 發現。

### 設定發現與過濾

`loadAllMCPConfigs()`（`src/mcp/config.ts`）透過能力發現載入標準 MCP 伺服器項目，然後轉換為舊版 `MCPServerConfig`。

過濾行為：

- `enableProjectConfig: false` 會移除專案層級的項目（`_source.level === "project"`）。
- `enabled: false` 的伺服器在連線嘗試前即被跳過。
- Exa 伺服器預設會被過濾掉，其 API 金鑰會被擷取用於原生 Exa 工具整合。

結果包含 `configs` 和 `sources`（後續用於提供者標籤的中繼資料）。

### 發現層級的失敗行為

`discoverAndLoadMCPTools()` 區分兩種失敗類別：

- **發現硬失敗**（來自 `manager.discoverAndConnect` 的例外，通常來自設定發現）：回傳空的工具集和一個合成錯誤 `{ path: ".mcp.json", error }`。
- **各伺服器的執行時期/連線失敗**：管理器回傳部分成功結果及 `errors` 映射；其他伺服器繼續運作。

因此，當個別 MCP 伺服器失敗時，啟動不會使整個代理工作階段失敗。

## 管理器狀態模型

`MCPManager` 透過獨立的註冊表追蹤執行時期生命週期：

- `#connections: Map<string, MCPServerConnection>` — 已完全連線的伺服器。
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — 正在進行交握。
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — 已連線但工具仍在載入中。
- `#tools: CustomTool[]` — 公開給呼叫者的目前 MCP 工具檢視。
- `#sources: Map<string, SourceMeta>` — 即使在連線完成前也保留的提供者/來源中繼資料。

`getConnectionStatus(name)` 從這些映射推導狀態：

- 若在 `#connections` 中則為 `connected`，
- 若在待處理的連線或待處理的工具載入中則為 `connecting`，
- 否則為 `disconnected`。

## 連線建立與啟動時序

## 各伺服器的連線管線

對於 `connectServers()` 中每個已發現的伺服器：

1. 儲存/更新來源中繼資料，
2. 若已連線/待處理則跳過，
3. 驗證傳輸欄位（`validateServerConfig`），
4. 解析驗證/shell 替換（`#resolveAuthConfig`），
5. 呼叫 `connectToServer(name, resolvedConfig)`，
6. 呼叫 `listTools(connection)`，
7. 盡力快取工具定義（`MCPToolCache.set`）。

`connectToServer()` 行為（`src/mcp/client.ts`）：

- 建立 stdio 或 HTTP/SSE 傳輸，
- 執行 MCP `initialize` + `notifications/initialized`，
- 使用逾時設定（`config.timeout` 或預設 30 秒），
- 初始化失敗時關閉傳輸。

### 快速啟動閘門 + 延遲回退

`connectServers()` 等待以下兩者的競爭：

- 所有連線/工具載入任務已結算，以及
- `STARTUP_TIMEOUT_MS = 250`。

250 毫秒之後：

- 已完成的任務成為即時的 `MCPTool`，
- 已拒絕的任務產生各伺服器的錯誤，
- 仍在等待中的任務：
  - 若有快取的工具定義可用（`MCPToolCache.get`），則建立 `DeferredMCPTool`，
  - 否則阻塞等待這些待處理任務結算。

這是一種混合啟動模型：當快取可用時快速回傳，當快取不可用時等待以確保正確性。

### 背景完成行為

每個待處理的 `toolsPromise` 也有一個背景延續，最終會：

- 透過 `#replaceServerTools` 替換管理器狀態中該伺服器的工具切片，
- 寫入快取，
- 僅在啟動後記錄延遲失敗（`allowBackgroundLogging`）。

## 工具公開與即時工作階段可用性

### 啟動註冊

`discoverAndLoadMCPTools()` 將管理器工具轉換為 `LoadedCustomTool[]`，並裝飾路徑（已知時為 `mcp:<server> via <providerName>`）。

`createAgentSession()` 接著將這些工具推入 `customTools`，這些工具被包裝後加入執行時期工具註冊表，名稱格式為 `mcp_<server>_<tool>`。

### 工具呼叫

- `MCPTool` 透過已連線的 `MCPServerConnection` 呼叫工具。
- `DeferredMCPTool` 在呼叫前等待 `waitForConnection(server)`；這允許快取的工具在連線就緒前即存在。

兩者都回傳結構化的工具輸出，並將傳輸/工具錯誤轉換為 `MCP error: ...` 工具內容（中止仍為中止）。

## 重新整理/重新載入路徑（啟動 vs 即時重新載入）

### 初始啟動路徑

- 在 `sdk.ts` 中進行一次性發現/載入，
- 工具註冊在初始工作階段工具註冊表中。

### 互動式重新載入路徑

`/mcp reload` 路徑（`src/modes/controllers/mcp-command-controller.ts`）執行：

1. `mcpManager.disconnectAll()`，
2. `mcpManager.discoverAndConnect()`，
3. `session.refreshMCPTools(mcpManager.getTools())`。

`session.refreshMCPTools()`（`src/session/agent-session.ts`）移除所有 `mcp_` 工具、重新包裝最新的 MCP 工具，並重新啟用工具集，使 MCP 變更無需重啟工作階段即可生效。

還有一個用於延遲連線的後續路徑：在等待特定伺服器後，若狀態變為 `connected`，它會重新執行 `session.refreshMCPTools(...)` 以在工作階段中重新綁定新可用的工具。

## 健康狀態、重新連線與部分失敗行為

目前的執行時期行為刻意保持最小化：

- 管理器/客戶端中**沒有自主健康監控器**。
- 當傳輸中斷時**沒有自動重新連線迴圈**。
- 管理器不訂閱傳輸的 `onClose`/`onError`；狀態由註冊表驅動。
- 重新連線是顯式的：透過重新載入流程或直接調用 `connectServers()`。

實際運作上：

- 一個伺服器失敗不會移除其他健康伺服器的工具，
- 連線/列表失敗按各伺服器隔離，
- 工具快取和背景更新為盡力而為（記錄警告/錯誤，不會硬停止）。

## 終止語意

### 伺服器層級終止

`disconnectServer(name)`：

- 移除待處理項目/來源中繼資料，
- 若已連線則關閉傳輸，
- 從管理器狀態中移除該伺服器的 `mcp_` 工具。

### 全域終止

`disconnectAll()`：

- 以 `Promise.allSettled` 關閉所有作用中的傳輸，
- 清除待處理映射、來源、連線及管理器工具列表。

在目前的串接中，顯式終止用於 MCP 命令流程（重新載入/移除/停用）。啟動路徑本身沒有單獨的自動管理器釋放掛鉤；呼叫者需要在需要確定性 MCP 關閉時負責調用管理器的中斷連線方法。

## 失敗模式與保證

| 情境 | 行為 | 硬失敗 vs 盡力而為 |
| --- | --- | --- |
| 發現階段拋出例外（能力/設定載入路徑） | 載入器回傳空工具 + 合成 `.mcp.json` 錯誤 | 盡力而為的工作階段啟動 |
| 無效的伺服器設定 | 伺服器被跳過並記錄驗證錯誤項目 | 各伺服器盡力而為 |
| 連線逾時/初始化失敗 | 記錄伺服器錯誤；其他伺服器繼續 | 各伺服器盡力而為 |
| 啟動時 `tools/list` 仍在等待且有快取命中 | 立即回傳延遲工具 | 盡力而為的快速啟動 |
| 啟動時 `tools/list` 仍在等待且無快取 | 啟動等待待處理項目結算 | 為正確性進行硬等待 |
| 延遲的背景工具載入失敗 | 在啟動閘門之後記錄 | 盡力而為的記錄 |
| 執行時期傳輸中斷 | 無自動重新連線；後續呼叫失敗直到重新連線/重新載入 | 透過手動操作盡力恢復 |

## 公開 API 介面

`src/mcp/index.ts` 為外部呼叫者重新匯出載入器/管理器/客戶端 API。`src/sdk.ts` 將 `discoverMCPServers()` 公開為便利包裝器，回傳相同的載入器結果結構。

## 實作檔案

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — 載入器外觀、發現錯誤正規化、`LoadedCustomTool` 轉換。
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — 生命週期狀態註冊表、平行連線/列表流程、重新整理/中斷連線。
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — 傳輸設定、初始化交握、列表/呼叫/中斷連線。
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP 模組 API 匯出。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 啟動串接至工作階段/工具註冊表。
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — 管理器使用的設定發現/過濾/驗證。
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — `MCPTool` 和 `DeferredMCPTool` 執行時期行為。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` 即時重新綁定。
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — 互動式重新載入/重新連線流程。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 透過父管理器連線進行子代理 MCP 代理。
