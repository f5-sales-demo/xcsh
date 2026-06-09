---
title: MCP 伺服器與工具撰寫
description: 建置自訂 MCP 伺服器並為程式碼代理註冊工具的指南。
sidebar:
  order: 4
  label: 伺服器與工具撰寫
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCP 伺服器與工具撰寫

本文件說明 MCP 伺服器定義如何在 coding-agent 中成為可呼叫的 `mcp_*` 工具，以及當設定無效、重複、停用或受驗證閘控時，操作人員應預期的行為。

## 架構概覽

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) 伺服器設定模型與驗證

`src/mcp/types.ts` 定義了 MCP 設定撰寫者和執行階段所使用的撰寫結構：

- `stdio`（當 `type` 缺失時的預設值）：需要 `command`，可選 `args`、`env`、`cwd`
- `http`：需要 `url`，可選 `headers`
- `sse`：需要 `url`，可選 `headers`（保留以維持相容性）
- 共用欄位：`enabled`、`timeout`、`auth`

`validateServerConfig()`（`src/mcp/config.ts`）強制執行傳輸層基本驗證：

- 拒絕同時設定 `command` 和 `url` 的設定
- stdio 需要 `command`
- http/sse 需要 `url`
- 拒絕未知的 `type`

`config-writer.ts` 在新增/更新操作時套用此驗證，並同時驗證伺服器名稱：

- 不可為空
- 最多 100 個字元
- 僅允許 `[a-zA-Z0-9_.-]`

### 傳輸層陷阱

- 省略 `type` 表示 stdio。如果您想使用 HTTP/SSE 但省略了 `type`，則 `command` 會變成必填。
- `sse` 仍然被接受，但在內部被視為 HTTP 傳輸處理（`createHttpTransport`）。
- 驗證是結構性的，而非可達性的：語法正確的 URL 仍可能在連線時失敗。

## 2) 探索、正規化與優先順序

### 基於能力的探索

`loadAllMCPConfigs()`（`src/mcp/config.ts`）透過 `loadCapability(mcpCapability.id)` 載入標準 `MCPServer` 項目。

能力層（`src/capability/index.ts`）接著：

1. 按優先順序載入提供者
2. 依 `server.name` 去重（先載入的獲勝 = 最高優先順序）
3. 驗證去重後的項目

結果：跨來源的重複伺服器名稱不會被合併。只有一個定義會生效；較低優先順序的重複項會被遮蔽。

### `.mcp.json` 及相關檔案

`src/discovery/mcp-json.ts` 中的專用備援提供者會讀取專案根目錄的 `mcp.json` 和 `.mcp.json`（低優先順序）。

實務上，MCP 伺服器也來自較高優先順序的提供者（例如原生 `.xcsh/...` 和工具專屬設定目錄）。撰寫建議：

- 偏好使用 `.xcsh/mcp.json`（專案層級）或 `~/.xcsh/mcp.json`（使用者層級）以獲得明確控制。
- 當需要備援相容性時使用根目錄的 `mcp.json` / `.mcp.json`。
- 在多個來源中重複使用相同的伺服器名稱會造成優先順序遮蔽，而非合併。

### 正規化行為

`convertToLegacyConfig()`（`src/mcp/config.ts`）將標準 `MCPServer` 映射為執行階段 `MCPServerConfig`。

關鍵行為：

- 傳輸層推斷為 `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- 已停用的伺服器（`enabled === false`）在連線前被移除
- 可選欄位在存在時予以保留

### 探索期間的環境變數展開

`mcp-json.ts` 使用 `expandEnvVarsDeep()` 展開字串欄位中的環境變數佔位符：

- 支援 `${VAR}` 和 `${VAR:-default}`
- 未解析的值會保持為字面字串 `${VAR}`

`mcp-json.ts` 也會對使用者 JSON 執行執行階段型別檢查，並針對無效的 `enabled`/`timeout` 值記錄警告，而非使整個檔案硬性失敗。

## 3) 驗證與執行階段值解析

`MCPManager.prepareConfig()`/`#resolveAuthConfig()`（`src/mcp/manager.ts`）是連線前的最終處理階段。

### OAuth 憑證注入

如果設定包含：

```ts
auth: { type: "oauth", credentialId: "..." }
```

且憑證存在於驗證儲存中：

- `http`/`sse`：注入 `Authorization: Bearer <access_token>` 標頭
- `stdio`：注入 `OAUTH_ACCESS_TOKEN` 環境變數

如果憑證查詢失敗，管理器會記錄警告並以未解析的驗證狀態繼續。

### 標頭/環境變數值解析

連線前，管理器透過 `resolveConfigValue()`（`src/config/resolve-config-value.ts`）解析每個標頭/環境變數值：

- 以 `!` 開頭的值 => 執行 shell 命令，使用修剪後的 stdout（已快取）
- 否則，先將值視為環境變數名稱（`process.env[name]`），回退為字面值
- 未解析的命令/環境變數值會從最終的標頭/環境變數映射中省略

操作注意事項：這意味著拼寫錯誤的密鑰命令/環境變數鍵可能會靜默移除該標頭/環境變數項目，導致下游出現 401/403 或伺服器啟動失敗。

## 4) 工具橋接：MCP -> 代理可呼叫工具

`src/mcp/tool-bridge.ts` 將 MCP 工具定義轉換為 `CustomTool`。

### 命名與衝突域

工具名稱的生成方式為：

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

規則：

- 轉為小寫
- 非 `[a-z_]` 的字元變為 `_`
- 重複的底線會合併
- 工具名稱中多餘的 `<server>_` 前綴會移除一次

這避免了許多衝突，但並非全部。不同的原始名稱仍可能清理後變成相同的識別符（例如 `my-server` 和 `my.server` 清理後結果相似），且註冊表插入採用後寫入者獲勝。

### 結構描述映射

`convertSchema()` 基本上保持 MCP JSON Schema 不變，但會為缺少 `properties` 的物件結構描述補上 `{}` 以確保提供者相容性。

### 執行映射

`MCPTool.execute()` / `DeferredMCPTool.execute()`：

- 呼叫 MCP `tools/call`
- 將 MCP 內容扁平化為可顯示的文字
- 回傳結構化詳細資訊（`serverName`、`mcpToolName`、提供者中繼資料）
- 將伺服器回報的 `isError` 映射為 `Error: ...` 文字結果
- 將拋出的傳輸層/執行階段失敗映射為 `MCP error: ...`
- 透過將 AbortError 轉換為 `ToolAbortError` 來保留中止語意

## 5) 操作人員生命週期：新增/編輯/移除與即時更新

互動模式在 `src/modes/controllers/mcp-command-controller.ts` 中公開 `/mcp`。

支援的操作：

- `add`（精靈或快速新增）
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

設定寫入是原子性的（`writeMCPConfigFile`：暫存檔 + 重新命名）。

變更後，控制器呼叫 `#reloadMCP()`：

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` 會替換所有 `mcp_` 註冊表項目並立即重新啟用最新的 MCP 工具集，因此變更無需重新啟動工作階段即可生效。

### 模式差異

- **互動/TUI 模式**：`/mcp` 提供應用程式內的使用者體驗（精靈、OAuth 流程、連線狀態文字、即時執行階段重新繫結）。
- **SDK/無頭整合**：`discoverAndLoadMCPTools()`（`src/mcp/loader.ts`）回傳已載入的工具 + 各伺服器錯誤；無 `/mcp` 命令使用者體驗。

## 6) 使用者可見的錯誤介面

使用者/操作人員常見的錯誤訊息：

- 新增/更新驗證失敗：
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- 快速新增參數問題：
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- 連線/測試失敗：
  - `Failed to connect to "<name>": <message>`
  - 逾時輔助文字建議增加逾時值
  - 針對 `401/403` 的驗證輔助文字
- 驗證/OAuth 流程：
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- 已停用伺服器的使用：
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

探索階段中損壞的來源 JSON 通常以警告/日誌方式處理；config-writer 路徑會拋出明確的錯誤。

## 7) 實務撰寫指南

在此程式碼庫中進行穩健的 MCP 撰寫：

1. 在所有 MCP 相容的設定來源中保持伺服器名稱全域唯一。
2. 偏好使用英數字元/底線名稱，以避免在生成的 `mcp_*` 工具名稱中發生清理後名稱衝突。
3. 使用明確的 `type` 以避免意外的 stdio 預設值。
4. 將 `enabled: false` 視為硬性關閉：伺服器會從執行階段連線集合中省略。
5. 對於 OAuth 設定，儲存有效的 `credentialId`；否則驗證注入會被跳過。
6. 如果使用基於命令的密鑰解析（`!cmd`），請驗證命令輸出是穩定且非空的。

## 實作檔案

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
