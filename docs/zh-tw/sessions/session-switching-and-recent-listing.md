---
title: 工作階段切換與近期工作階段列表
description: 工作階段切換機制及近期工作階段列表，包含搜尋與篩選功能。
sidebar:
  order: 4
  label: 切換與近期
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# 工作階段切換與近期工作階段列表

本文件描述 coding-agent 如何發現近期工作階段、解析 `--resume` 目標、呈現工作階段選擇器，以及切換目前的執行中工作階段。

本文件聚焦於目前的實作行為，包含備援路徑與注意事項。

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

`SessionManager.list(cwd, sessionDir?)` 僅讀取該目錄，除非提供了明確的 `sessionDir`。

### 兩種具有不同資料承載的列表管線

存在兩種不同的列表管線：

1. `getRecentSessions(sessionDir, limit)`（歡迎/摘要視圖）
   - 僅從每個檔案讀取 4KB 前綴（`readTextPrefix(..., 4096)`）。
   - 解析標頭 + 最早的使用者文字預覽。
   - 回傳輕量的 `RecentSessionInfo`，具有延遲載入的 `name` 和 `timeAgo` getter。
   - 依檔案 `mtime` 降序排列。

2. `SessionManager.list(...)` / `SessionManager.listAll()`（恢復選擇器與 ID 比對）
   - 讀取完整的工作階段檔案。
   - 建構 `SessionInfo` 物件（`id`、`cwd`、`title`、`messageCount`、`firstMessage`、`allMessagesText`、時間戳記）。
   - 捨棄零 `message` 條目的工作階段。
   - 依 `modified` 降序排列。

### 中繼資料備援行為

對於近期摘要（`RecentSessionInfo`）：

- 顯示名稱偏好順序：`header.title` -> 第一則使用者提示 -> `header.id` -> 檔名
- 名稱會被截斷至 40 個字元以用於精簡顯示
- 從標題衍生的名稱中會移除/清理控制字元與換行符

對於 `SessionInfo` 列表項目：

- `title` 為 `header.title` 或最新壓縮的 `shortSummary`
- `firstMessage` 為第一則使用者訊息文字或 `"(no messages)"`

## `--continue` 解析與終端機麵包屑偏好

`SessionManager.continueRecent(cwd, sessionDir?)` 依以下順序解析目標：

1. 讀取終端機範圍的麵包屑（`~/.xcsh/agent/terminal-sessions/<terminal-id>`）
2. 驗證麵包屑：
   - 可識別目前終端機
   - 麵包屑 cwd 與目前 cwd 相符（已解析的路徑比較）
   - 參照的檔案仍然存在
3. 若麵包屑無效/不存在，則退回至工作階段目錄中依 mtime 排序的最新檔案（`findMostRecentSession`）
4. 若找不到任何檔案，則建立新的工作階段

終端機 ID 衍生偏好使用 TTY 路徑，並退回至基於環境變數的識別碼（`KITTY_WINDOW_ID`、`TMUX_PANE`、`TERM_SESSION_ID`、`WT_SESSION`）。

麵包屑寫入為盡力而為且不會導致致命錯誤。

## 啟動時恢復目標解析（`main.ts`）

### `--resume <value>`

`createSessionManager(...)` 以兩種模式處理字串值的 `--resume`：

1. 路徑型值（包含 `/`、`\\`，或以 `.jsonl` 結尾）
   - 直接呼叫 `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ID 前綴值
   - 在 `SessionManager.list(cwd, sessionDir)` 中透過 `id.startsWith(sessionArg)` 尋找匹配
   - 若本地無匹配且 `sessionDir` 未被強制指定，則嘗試 `SessionManager.listAll()`
   - 使用第一個匹配結果（不提供歧義提示）

跨專案匹配行為：

- 若匹配的工作階段 cwd 與目前 cwd 不同，CLI 會提示是否分叉至目前專案
- 是 -> `SessionManager.forkFrom(...)`
- 否 -> 拋出錯誤（`Session "..." is in another project (...)`）

無匹配 -> 拋出錯誤（`Session "..." not found.`）。

### `--resume`（無值）

在初始 session-manager 建構之後處理：

1. 使用 `SessionManager.list(cwd, parsed.sessionDir)` 列出本地工作階段
2. 若為空：輸出 `No sessions found` 並提前結束
3. 開啟 TUI 選擇器（`selectSession`）
4. 若取消：輸出 `No session selected` 並提前結束
5. 若已選取：`SessionManager.open(selectedPath)`

### `--continue`

直接使用 `SessionManager.continueRecent(...)`（上述麵包屑優先行為）。

## 基於選擇器的選取內部機制

## CLI 選擇器（`src/cli/session-picker.ts`）

`selectSession(sessions)` 建立獨立的 TUI，使用 `SessionSelectorComponent` 並精確解析一次：

- 選取 -> 解析為選取的路徑
- 取消（Esc）-> 解析為 `null`
- 強制結束（Ctrl+C 路徑）-> 停止 TUI 並執行 `process.exit(0)`

## 互動式工作階段內選擇器（`SelectorController.showSessionSelector`）

流程：

1. 透過 `SessionManager.list(currentCwd, currentSessionDir)` 從目前工作階段目錄取得工作階段
2. 使用 `showSelector(...)` 在編輯器區域掛載 `SessionSelectorComponent`
3. 回呼：
   - 選取 -> 關閉選擇器並呼叫 `handleResumeSession(sessionPath)`
   - 取消 -> 還原編輯器並重新渲染
   - 結束 -> `ctx.shutdown()`

## 工作階段選擇器元件行為

`SessionList` 支援：

- 方向鍵/頁面導覽
- Enter 選取
- Esc 取消
- Ctrl+C 結束
- 跨工作階段 id/title/cwd/first message/all messages/path 的模糊搜尋

空列表渲染行為：

- 渲染訊息而非崩潰
- 在空列表上按 Enter 不執行任何動作（無回呼）
- Esc/Ctrl+C 仍然可用

注意事項：UI 文字顯示 `Press Tab to view all`，但此元件目前沒有 Tab 處理器，且目前的接線僅列出目前範圍的工作階段。

## 執行時切換執行（`AgentSession.switchSession`）

`switchSession(sessionPath)` 是核心的行程內切換路徑。

生命週期/狀態轉換：

1. 擷取 `previousSessionFile`
2. 發出 `session_before_switch` 鉤子事件（`reason: "resume"`，可取消）
3. 若被取消 -> 回傳 `false` 且不執行切換
4. 中斷與目前代理事件串流的連線
5. 中止進行中的產生/工具流程
6. 清除排隊中的引導/後續/下一輪訊息緩衝區
7. 刷新工作階段寫入器（`sessionManager.flush()`）以持久化待寫入的資料
8. `sessionManager.setSessionFile(sessionPath)`
   - 更新工作階段檔案指標
   - 寫入終端機麵包屑
   - 載入條目 / 遷移 / blob 解析 / 重建索引
   - 若檔案資料不存在/無效：在該路徑初始化新的工作階段並重寫標頭
9. 更新 `agent.sessionId`
10. 透過 `buildSessionContext()` 重建上下文
11. 發出 `session_switch` 鉤子事件（`reason: "resume"`、`previousSessionFile`）
12. 以重建的上下文取代代理訊息
13. 從 `sessionContext.models.default` 還原預設模型（若可用且存在於模型註冊表中）
14. 還原思考層級：
    - 若分支已有 `thinking_level_change`，套用已儲存的工作階段層級
    - 否則從設定衍生預設思考層級，限制至模型能力範圍，設定之，並附加新的 `thinking_level_change` 條目
15. 重新連接代理監聽器並回傳 `true`

## 互動式切換後的 UI 狀態重建

`SelectorController.handleResumeSession` 在 `switchSession` 周圍執行 UI 重設：

- 停止載入動畫
- 清除狀態容器
- 清除待處理訊息 UI 與待處理工具對應表
- 重設串流元件/訊息參照
- 呼叫 `session.switchSession(...)`
- 清除聊天容器並從工作階段上下文重新渲染（`renderInitialMessages`）
- 從新工作階段的產出物重新載入待辦事項
- 顯示 `Resumed session`

因此可見的對話/待辦事項狀態是從新的工作階段檔案重建的。

## 啟動恢復與工作階段內切換的比較

### 啟動恢復（`--continue`、`--resume`、直接開啟）

- 工作階段檔案在 `createAgentSession(...)` 之前選定。
- `sdk.ts` 建構 `existingSession = sessionManager.buildSessionContext()`。
- 代理訊息在工作階段建立期間還原一次。
- 模型/思考在建立期間選取（包含還原/備援邏輯）。
- 互動模式接著執行 `#restoreModeFromSession()` 以重新進入已持久化的模式狀態（目前為 plan/plan_paused）。

### 工作階段內切換（`/resume` 式選擇器路徑）

- 在已執行中的 `AgentSession` 上使用 `AgentSession.switchSession(...)`。
- 訊息/模型/思考立即就地重建。
- 發出 `session_before_switch`/`session_switch` 鉤子事件。
- 重新整理 UI 聊天/待辦事項。
- 在選擇器流程中未進行專門的切換後模式還原呼叫；模式重新進入行為與啟動時的 `#restoreModeFromSession()` 並不對稱。

## 失敗與邊界情況行為

### 取消路徑

- CLI 選擇器取消 -> 回傳 `null`，呼叫者輸出 `No session selected`，程序提前結束。
- 互動式選擇器取消 -> 編輯器還原，不進行工作階段變更。
- 鉤子取消（`session_before_switch`）-> `switchSession()` 回傳 `false`。

### 空列表路徑

- CLI `--resume`（無值）：空列表輸出 `No sessions found` 並結束。
- 互動式選擇器：空列表渲染訊息並保持可取消狀態。

### 目標工作階段檔案不存在/無效

當開啟/切換至特定路徑（`setSessionFile`）時：

- ENOENT -> 視為空 -> 在該確切路徑初始化新工作階段並持久化。
- 格式錯誤/無效標頭（或實際上無法讀取的解析條目）-> 視為空 -> 初始化新工作階段並持久化。

這是復原行為，而非硬性失敗。

### 硬性失敗

切換/開啟在遇到真正的 I/O 失敗（權限錯誤、重寫失敗等）時仍可能拋出例外，這些例外會傳播至呼叫者。

### ID 前綴匹配注意事項

- ID 匹配使用 `startsWith` 並取排序列表中的第一個匹配。
- 若多個工作階段共享前綴，不會顯示歧義 UI。
- `SessionManager.list(...)` 排除零訊息的工作階段，因此這些工作階段無法透過 ID 匹配/列表選擇器恢復。
