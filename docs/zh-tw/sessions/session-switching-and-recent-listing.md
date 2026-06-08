---
title: 工作階段切換與近期工作階段列表
description: 工作階段切換機制以及包含搜尋與篩選功能的近期工作階段列表。
sidebar:
  order: 4
  label: 切換與近期
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# 工作階段切換與近期工作階段列表

本文件描述 coding-agent 如何探索近期工作階段、解析 `--resume` 目標、呈現工作階段選擇器，以及切換作用中的執行時期工作階段。

本文聚焦於目前的實作行為，包含備援路徑與注意事項。

## 實作檔案

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## 近期工作階段探索

### 目錄範圍

`SessionManager` 預設將工作階段儲存在以 cwd 為範圍的目錄下：

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` 僅讀取該目錄，除非明確提供 `sessionDir`。

### 兩種具有不同資料承載的列表路徑

存在兩種不同的列表管線：

1. `getRecentSessions(sessionDir, limit)`（歡迎/摘要檢視）
   - 僅從每個檔案讀取 4KB 前綴（`readTextPrefix(..., 4096)`）。
   - 解析標頭 + 最早的使用者文字預覽。
   - 回傳輕量化的 `RecentSessionInfo`，包含延遲載入的 `name` 和 `timeAgo` getter。
   - 依檔案 `mtime` 降序排列。

2. `SessionManager.list(...)` / `SessionManager.listAll()`（恢復選擇器與 ID 比對）
   - 讀取完整的工作階段檔案。
   - 建構 `SessionInfo` 物件（`id`、`cwd`、`title`、`messageCount`、`firstMessage`、`allMessagesText`、時間戳記）。
   - 捨棄 `message` 項目為零的工作階段。
   - 依 `modified` 降序排列。

### 中繼資料備援行為

對於近期摘要（`RecentSessionInfo`）：

- 顯示名稱偏好順序：`header.title` -> 第一個使用者提示 -> `header.id` -> 檔案名稱
- 名稱被截斷為 40 個字元以供精簡顯示
- 控制字元/換行符號會從標題衍生的名稱中被移除/淨化

對於 `SessionInfo` 列表項目：

- `title` 為 `header.title` 或最新壓縮的 `shortSummary`
- `firstMessage` 為第一個使用者訊息文字或 `"(no messages)"`

## `--continue` 解析與終端機書籤偏好

`SessionManager.continueRecent(cwd, sessionDir?)` 依以下順序解析目標：

1. 讀取終端機範圍的書籤（`~/.xcsh/agent/terminal-sessions/<terminal-id>`）
2. 驗證書籤：
   - 可識別當前終端機
   - 書籤的 cwd 與當前 cwd 相符（解析路徑比對）
   - 參照的檔案仍然存在
3. 若書籤無效/遺失，則退回到工作階段目錄中依 mtime 排列的最新檔案（`findMostRecentSession`）
4. 若未找到任何檔案，則建立新的工作階段

終端機 ID 衍生偏好使用 TTY 路徑，並退回到基於環境變數的識別碼（`KITTY_WINDOW_ID`、`TMUX_PANE`、`TERM_SESSION_ID`、`WT_SESSION`）。

書籤寫入為盡力而為且非致命性的。

## 啟動時恢復目標解析（`main.ts`）

### `--resume <value>`

`createSessionManager(...)` 以兩種模式處理字串值的 `--resume`：

1. 類路徑值（包含 `/`、`\\`，或以 `.jsonl` 結尾）
   - 直接 `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ID 前綴值
   - 在 `SessionManager.list(cwd, sessionDir)` 中以 `id.startsWith(sessionArg)` 尋找匹配
   - 若本地無匹配且未強制指定 `sessionDir`，則嘗試 `SessionManager.listAll()`
   - 使用第一個匹配結果（無歧義提示）

跨專案匹配行為：

- 若匹配的工作階段 cwd 與當前 cwd 不同，CLI 會提示是否要分支到當前專案
- 是 -> `SessionManager.forkFrom(...)`
- 否 -> 拋出錯誤（`Session "..." is in another project (...)`）

無匹配 -> 拋出錯誤（`Session "..." not found.`）。

### `--resume`（無值）

在初始工作階段管理器建構後處理：

1. 以 `SessionManager.list(cwd, parsed.sessionDir)` 列出本地工作階段
2. 若為空：印出 `No sessions found` 並提前結束
3. 開啟 TUI 選擇器（`selectSession`）
4. 若取消：印出 `No session selected` 並提前結束
5. 若選取：`SessionManager.open(selectedPath)`

### `--continue`

直接使用 `SessionManager.continueRecent(...)`（上述的書籤優先行為）。

## 選擇器式選取內部機制

## CLI 選擇器（`src/cli/session-picker.ts`）

`selectSession(sessions)` 建立一個獨立的 TUI 搭配 `SessionSelectorComponent`，並精確解析一次：

- 選取 -> 解析為選取的路徑
- 取消（Esc） -> 解析為 `null`
- 強制結束（Ctrl+C 路徑） -> 停止 TUI 並 `process.exit(0)`

## 互動式工作階段內選擇器（`SelectorController.showSessionSelector`）

流程：

1. 透過 `SessionManager.list(currentCwd, currentSessionDir)` 從當前工作階段目錄取得工作階段
2. 使用 `showSelector(...)` 在編輯器區域掛載 `SessionSelectorComponent`
3. 回呼：
   - 選取 -> 關閉選擇器並呼叫 `handleResumeSession(sessionPath)`
   - 取消 -> 還原編輯器並重新渲染
   - 結束 -> `ctx.shutdown()`

## 工作階段選擇器元件行為

`SessionList` 支援：

- 方向鍵/翻頁導覽
- Enter 選取
- Esc 取消
- Ctrl+C 結束
- 跨工作階段 id/標題/cwd/第一則訊息/所有訊息/路徑的模糊搜尋

空列表渲染行為：

- 渲染一則訊息而非當機
- 在空列表上按 Enter 不執行任何動作（無回呼）
- Esc/Ctrl+C 仍然有效

注意事項：UI 文字顯示 `Press Tab to view all`，但此元件目前沒有 Tab 處理器，且當前的接線僅列出當前範圍的工作階段。

## 執行時期切換執行（`AgentSession.switchSession`）

`switchSession(sessionPath)` 是核心的行程內切換路徑。

生命週期/狀態轉換：

1. 擷取 `previousSessionFile`
2. 發送 `session_before_switch` 鉤子事件（`reason: "resume"`，可取消）
3. 若被取消 -> 回傳 `false` 且不切換
4. 從當前代理事件串流斷開連線
5. 中止作用中的生成/工具流程
6. 清除已排入佇列的導向/後續/下一輪訊息緩衝區
7. 刷新工作階段寫入器（`sessionManager.flush()`）以持久化待處理的寫入
8. `sessionManager.setSessionFile(sessionPath)`
   - 更新工作階段檔案指標
   - 寫入終端機書籤
   - 載入項目 / 遷移 / blob 解析 / 重新索引
   - 若檔案資料遺失/無效：在該路徑初始化新的工作階段並重寫標頭
9. 更新 `agent.sessionId`
10. 透過 `buildSessionContext()` 重建上下文
11. 發送 `session_switch` 鉤子事件（`reason: "resume"`，`previousSessionFile`）
12. 以重建的上下文替換代理訊息
13. 從 `sessionContext.models.default` 還原預設模型（若可用且存在於模型登錄中）
14. 還原思考層級：
    - 若分支已有 `thinking_level_change`，套用已儲存的工作階段層級
    - 否則從設定衍生預設思考層級，限縮至模型能力範圍，設定後附加新的 `thinking_level_change` 項目
15. 重新連接代理監聽器並回傳 `true`

## 互動式切換後的 UI 狀態重建

`SelectorController.handleResumeSession` 在 `switchSession` 前後執行 UI 重設：

- 停止載入動畫
- 清除狀態容器
- 清除待處理訊息 UI 和待處理工具對應
- 重設串流元件/訊息參照
- 呼叫 `session.switchSession(...)`
- 清除聊天容器並從工作階段上下文重新渲染（`renderInitialMessages`）
- 從新工作階段的產出物重新載入待辦事項
- 顯示 `Resumed session`

因此可見的對話/待辦事項狀態是從新的工作階段檔案重建的。

## 啟動時恢復 vs 工作階段內切換

### 啟動時恢復（`--continue`、`--resume`、直接開啟）

- 工作階段檔案在 `createAgentSession(...)` 之前選定。
- `sdk.ts` 建構 `existingSession = sessionManager.buildSessionContext()`。
- 代理訊息在工作階段建立期間還原一次。
- 模型/思考在建立期間選定（包含還原/備援邏輯）。
- 互動模式接著執行 `#restoreModeFromSession()` 以重新進入已持久化的模式狀態（目前為 plan/plan_paused）。

### 工作階段內切換（`/resume` 式選擇器路徑）

- 在已執行的 `AgentSession` 上使用 `AgentSession.switchSession(...)`。
- 訊息/模型/思考立即就地重建。
- 發送 `session_before_switch`/`session_switch` 鉤子事件。
- UI 聊天/待辦事項已重新整理。
- 選擇器流程中沒有專門的切換後模式還原呼叫；模式重新進入行為與啟動時的 `#restoreModeFromSession()` 不對稱。

## 失敗與邊緣案例行為

### 取消路徑

- CLI 選擇器取消 -> 回傳 `null`，呼叫者印出 `No session selected`，程序提前結束。
- 互動式選擇器取消 -> 編輯器還原，無工作階段變更。
- 鉤子取消（`session_before_switch`） -> `switchSession()` 回傳 `false`。

### 空列表路徑

- CLI `--resume`（無值）：空列表印出 `No sessions found` 並結束。
- 互動式選擇器：空列表渲染訊息且保持可取消。

### 目標工作階段檔案遺失/無效

當開啟/切換至特定路徑（`setSessionFile`）時：

- ENOENT -> 視為空 -> 在該確切路徑初始化新工作階段並持久化。
- 格式錯誤/無效標頭（或實際上無法讀取的解析項目） -> 視為空 -> 初始化新工作階段並持久化。

這是復原行為，而非硬性失敗。

### 硬性失敗

切換/開啟在真正的 I/O 失敗（權限錯誤、重寫失敗等）時仍可能拋出例外，這些例外會傳播至呼叫者。

### ID 前綴匹配注意事項

- ID 匹配使用 `startsWith` 並取排序列表中的第一個匹配。
- 若多個工作階段共用前綴，不會出現歧義 UI。
- `SessionManager.list(...)` 會排除訊息為零的工作階段，因此這些工作階段無法透過 ID 匹配/列表選擇器恢復。
