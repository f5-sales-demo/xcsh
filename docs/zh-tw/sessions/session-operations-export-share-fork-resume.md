---
title: 工作階段操作：匯出、傾印、分享、分支、恢復
description: 用於匯出、分享、分支和恢復對話的工作階段操作。
sidebar:
  order: 3
  label: 操作
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# 工作階段操作：export、dump、share、fork、resume/continue

本文件描述目前實作中，操作者可見的工作階段匯出/分享/分支/恢復操作行為。

## 實作檔案

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## 操作矩陣

| 操作 | 進入路徑 | 工作階段變更 | 工作階段檔案建立/切換 | 輸出產物 |
|---|---|---|---|---|
| `/dump` | 互動式斜線命令 | 否 | 否 | 剪貼簿文字 |
| `/export [path]` | 互動式斜線命令 | 否 | 否 | HTML 檔案 |
| `--export <session.jsonl> [outputPath]` | CLI 啟動快速路徑 | 無執行階段工作階段變更 | 無活躍工作階段；讀取目標檔案 | HTML 檔案 |
| `/share` | 互動式斜線命令 | 否 | 否 | 暫存 HTML + 分享 URL/gist |
| `/fork` | 互動式斜線命令 | 是（活躍工作階段身分變更） | 建立新工作階段檔案並將當前工作階段切換至該檔案（僅限持久化模式） | 當產物目錄存在時，複製到新工作階段命名空間 |
| `/resume` | 互動式斜線命令 | 是（活躍的記憶體狀態被替換） | 切換至所選的既有工作階段檔案 | 無 |
| `--resume` | CLI 啟動（選擇器） | 工作階段建立後是 | 開啟所選的既有工作階段檔案 | 無 |
| `--resume <id\|path>` | CLI 啟動 | 工作階段建立後是 | 開啟既有工作階段；跨專案情況可分支至當前專案 | 無 |
| `--continue` | CLI 啟動 | 工作階段建立後是 | 開啟終端機麵包屑或最近的工作階段；若無則建立新工作階段 | 無 |

## 匯出與傾印

### `/export [outputPath]`（互動式）

流程：

1. `InputController` 將 `/export...` 路由至 `CommandController.handleExportCommand`。
2. 該命令依空白字元分割，僅使用 `/export` 後的第一個引數作為 `outputPath`。
3. `AgentSession.exportToHtml()` 呼叫 `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`。
4. 成功時，UI 顯示路徑並在瀏覽器中開啟檔案。

行為細節：

- `--copy`、`clipboard` 和 `copy` 引數會被明確拒絕，並附帶使用 `/dump` 的警告訊息。
- 匯出會嵌入工作階段標頭/條目/葉節點，以及來自代理程式狀態的當前 `systemPrompt` 和工具描述。
- 匯出期間不會附加任何工作階段條目。

注意事項：

- 引數解析基於空白字元（`text.split(/\s+/)`），因此包含空格的引號路徑不會被此命令路徑保留為單一路徑。

### `--export <inputSessionFile> [outputPath]`（CLI）

`main.ts` 中的流程：

1. 在互動式/工作階段啟動之前提前處理。
2. 呼叫 `exportFromFile(inputPath, outputPath?)`。
3. `SessionManager.open(inputPath)` 載入條目，然後產生並寫入 HTML。
4. 程序印出 `Exported to: ...` 並退出。

行為細節：

- 缺少輸入檔案時會顯示 `File not found: <path>`。
- 此路徑不會建立 `AgentSession`，也不會變更任何執行中的工作階段。

### `/dump`（互動式剪貼簿匯出）

流程：

1. `CommandController.handleDumpCommand()` 呼叫 `session.formatSessionAsText()`。
2. 若為空字串，報告 `No messages to dump yet.`
3. 否則透過原生 `copyToClipboard` 複製至剪貼簿。

傾印內容包括：

- 系統提示詞
- 活躍模型/思考層級
- 工具定義 + 參數
- 使用者/助理訊息
- 思考區塊和工具呼叫
- 工具結果和執行區塊（排除 `excludeFromContext` 的 bash/python 條目）
- 自訂/掛鉤/檔案提及/分支摘要/壓縮摘要條目

傾印不會進行任何工作階段持久化變更。

## 分享

`/share` 僅限互動式使用，且始終以將當前工作階段匯出至暫存 HTML 檔案開始。

### 第一階段：暫存匯出

- 暫存檔案路徑：`${os.tmpdir()}/${Snowflake.next()}.html`
- 使用 `session.exportToHtml(tmpFile)`
- 若匯出失敗（特別是記憶體內工作階段），分享以錯誤結束。

### 第二階段：自訂分享處理器（若存在）

`loadCustomShare()` 檢查 `~/.xcsh/agent` 中第一個存在的候選檔案：

- `share.ts`
- `share.js`
- `share.mjs`

要求：

- 模組必須預設匯出一個函式 `(htmlPath) => Promise<CustomShareResult | string | undefined>`。

若存在且有效：

- UI 進入 `Sharing...` 載入狀態。
- 處理器結果解讀：
  - 字串 => 視為 URL，顯示並開啟
  - 物件 => 顯示 `url` 和/或 `message`；開啟 `url`
  - `undefined`/假值 => 通用 `Session shared`
- 完成後移除暫存檔案。

關鍵回退行為：

- 若自訂處理器存在但載入失敗，命令出錯並返回。
- 若自訂處理器執行並拋出例外，命令出錯並返回。
- 在兩種失敗情況下，**不會**回退至 GitHub gist。
- 僅當不存在自訂分享腳本時才會使用 gist 回退。

### 第三階段：預設 gist 回退

僅當未找到自訂分享處理器時：

1. 驗證 `gh auth status`。
2. 顯示 `Creating gist...` 載入畫面。
3. 執行 `gh gist create --public=false <tmpFile>`。
4. 解析 gist URL，推導 gist id，建構預覽 URL `https://gistpreview.github.io/?<id>`。
5. 同時顯示預覽和 gist URL；開啟預覽。

分享中的取消/中止語意：

- 載入畫面有 `onAbort` 掛鉤，會恢復編輯器 UI 並報告 `Share cancelled`。
- 在此程式碼路徑中，底層的 `gh gist create` 命令未傳入中止信號；取消是 UI 層級的，在命令返回後檢查。

## 分支

`/fork` 從當前工作階段建立新工作階段，並切換活躍的工作階段身分。

### 前置條件與即時檢查

- 若代理程式正在串流中，`/fork` 會被拒絕並顯示警告。
- 操作前會清除 UI 狀態/載入指示器。

### 工作階段層級流程

`AgentSession.fork()`：

1. 發出 `session_before_switch`，原因為 `reason: "fork"`（可取消）。
2. 沖刷待寫入的資料。
3. 呼叫 `SessionManager.fork()`。
4. 將產物目錄從舊工作階段命名空間複製到新命名空間（盡力而為；非 ENOENT 的複製失敗會記錄但不致命）。
5. 更新 `agent.sessionId`。
6. 發出 `session_switch`，原因為 `reason: "fork"`。

`SessionManager.fork()` 行為：

- 需要持久化模式和既有的工作階段檔案。
- 建立新的工作階段 id 和新的 JSONL 檔案路徑。
- 以下列內容重寫標頭：
  - 新 `id`
  - 新時間戳記
  - `cwd` 不變
  - `parentSession` 設為前一個工作階段 id
- 在新檔案中保留所有非標頭條目不變。

### 非持久化行為

- 記憶體內工作階段管理器從 `fork()` 返回 `undefined`。
- `AgentSession.fork()` 返回 `false`。
- UI 報告 `Fork failed (session not persisted or cancelled)`。

## 恢復與繼續

## 互動式 `/resume`

流程：

1. 開啟透過 `SessionManager.list(currentCwd, currentSessionDir)` 填充的工作階段選擇器。
2. 選擇後，`SelectorController.handleResumeSession(sessionPath)` 呼叫 `session.switchSession(sessionPath)`。
3. UI 清除/重建聊天和待辦事項，然後報告 `Resumed session`。

備註：

- 此選擇器僅列出當前工作階段目錄範圍內的工作階段。
- 它不使用全域跨專案搜尋。

## CLI `--resume`

### `--resume`（無值）

- `main.ts` 列出當前 cwd/sessionDir 的工作階段並開啟選擇器。
- 所選路徑在工作階段建立前以 `SessionManager.open(selectedPath)` 開啟。

### `--resume <value>`

`createSessionManager()` 解析順序：

1. 若值看起來像路徑（`/`、`\` 或 `.jsonl`），直接開啟。
2. 否則視為 id 前綴：
   - 搜尋當前範圍（`SessionManager.list(cwd, sessionDir)`）
   - 若未找到且無明確的 `sessionDir`，搜尋全域（`SessionManager.listAll()`）

跨專案 id 匹配行為：

- 若匹配的工作階段 cwd 與當前 cwd 不同，CLI 會詢問：
  - `Session found in different project ... Fork into current directory? [y/N]`
- 選擇是：`SessionManager.forkFrom(match.path, cwd, sessionDir)` 建立新的本地分支檔案。
- 選擇否/非 TTY 預設值：命令出錯。

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`：

1. 解析當前 cwd 的工作階段目錄。
2. 首先讀取終端機範圍的麵包屑。
3. 回退至最近修改的工作階段檔案。
4. 開啟找到的工作階段；若不存在則建立新工作階段。

這是僅限啟動時的行為；沒有互動式 `/continue` 斜線命令。

## 工作階段切換如何實際變更執行階段狀態

`AgentSession.switchSession(sessionPath)` 執行恢復類操作所使用的執行階段轉換：

1. 發出 `session_before_switch`，原因為 `reason: "resume"` 和 `targetSessionFile`（可取消）。
2. 斷開代理程式事件訂閱並中止進行中的工作。
3. 清除排隊的導引/後續/下一輪訊息。
4. 沖刷當前工作階段管理器的寫入。
5. `sessionManager.setSessionFile(sessionPath)` 並更新 `agent.sessionId`。
6. 從已載入的條目建構工作階段上下文。
7. 發出 `session_switch`，原因為 `reason: "resume"`。
8. 從上下文替換代理程式訊息。
9. 恢復模型（若在當前登錄中可用）。
10. 恢復或初始化思考層級。
11. 重新連接代理程式事件訂閱。

`switchSession()` 本身不會建立新的工作階段檔案。

## 事件發射與取消點

### 切換/分支生命週期掛鉤

對於 `newSession`、`fork` 和 `switchSession`：

- 前置事件：`session_before_switch`
  - 原因：`new`、`fork`、`resume`
  - 可透過返回 `{ cancel: true }` 取消
- 後置事件：`session_switch`
  - 相同的原因集合
  - 包含 `previousSessionFile`

`ExtensionRunner.emit()` 在第一個取消性前置事件結果時提前返回。

### 自訂工具 `onSession` 行為

SDK 橋接將擴充功能工作階段事件轉發至自訂工具 `onSession` 回呼：

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

這些回呼是觀察性的；它們不會取消切換/分支。

### 與本文件相關的其他取消表面

- `/fork` 在串流中時被阻擋（使用者必須先等待/中止當前回應）。
- `/resume` 選擇器可透過使用者關閉選擇器來取消。
- 跨專案 `--resume <id>` 可透過拒絕分支提示來取消。
- `/share` 在 gist 流程中有 UI 中止路徑（`Share cancelled`）；在此程式碼路徑中，它不會為 `gh gist create` 連接程序終止語意。

## 非持久化（記憶體內）工作階段行為

當工作階段管理器以 `SessionManager.inMemory()`（`--no-session`）建立時：

- 工作階段檔案路徑不存在。
- `/export` 和 `/share` 會以 `Cannot export in-memory session to HTML` 失敗（傳播至命令錯誤 UI）。
- `/fork` 會失敗，因為 `SessionManager.fork()` 需要持久化。
- `/dump` 仍可運作，因為它序列化記憶體內的代理程式狀態。
- 若設定了 `--no-session`，CLI 恢復/繼續語意會被略過，因為管理器建立會立即返回記憶體內模式。

## 已知實作注意事項（截至目前程式碼）

- `SelectorController.handleResumeSession()` 不檢查 `session.switchSession(...)` 的布林結果；被掛鉤取消的切換仍可能繼續執行 UI 的「Resumed session」重繪/狀態路徑。
- `/share` 自訂分享失敗不會降級至預設 gist 回退；它們會以錯誤終止命令。
- `/export` 引數標記化方式簡單，不會保留包含空格的引號路徑。
