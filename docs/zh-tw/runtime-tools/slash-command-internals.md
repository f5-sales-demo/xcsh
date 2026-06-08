---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# 斜線命令內部機制

本文件描述在 `coding-agent` 中，斜線命令如何被發現、去重、在互動模式中呈現，以及在提示時進行展開。

## 實作檔案

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) 發現模型

斜線命令是一種能力（`id: "slash-commands"`），以命令名稱為鍵（`key: cmd => cmd.name`）。

能力註冊表載入所有已註冊的提供者，按提供者優先順序降序排列，並以**先到先贏**的語意進行按鍵去重。

### 提供者優先順序

目前的斜線命令提供者及其優先順序：

1. `native`（OMP）— 優先順序 `100`
2. `claude` — 優先順序 `80`
3. `claude-plugins` — 優先順序 `70`
4. `codex` — 優先順序 `70`

相同優先順序的行為：優先順序相同的提供者保持註冊順序。目前的匯入順序是先註冊 `claude-plugins` 再註冊 `codex`，因此在名稱衝突時外掛命令優先於 codex 命令。

### 名稱衝突行為

對於 `slash-commands`，衝突嚴格透過能力去重來解決：

- 最高優先順序的項目保留在 `result.items` 中
- 較低優先順序的重複項僅保留在 `result.all` 中，並被標記為 `_shadowed = true`

這適用於跨提供者的情況，也適用於單一提供者返回重複名稱的情況。

### 檔案掃描行為

提供者大多使用 `loadFilesFromDir(...)`，目前的行為：

- 預設為非遞迴匹配（`*.md`）
- 使用原生 glob，設定 `gitignore: true`、`hidden: false`
- 讀取每個匹配的檔案並將其轉換為 `SlashCommand`

因此隱藏檔案/目錄不會被載入，被忽略的路徑也會被跳過。

## 2) 提供者特定的來源路徑與本地優先順序

## `native` 提供者（`builtin.ts`）

搜尋根目錄來自 `.xcsh` 目錄：

- 專案：`<cwd>/.xcsh/commands/*.md`
- 使用者：`~/.xcsh/agent/commands/*.md`

`getConfigDirs()` 先返回專案目錄，再返回使用者目錄，因此**專案原生命令在名稱衝突時優先於使用者原生命令**。

## `claude` 提供者（`claude.ts`）

載入：

- 使用者：`~/.claude/commands/*.md`
- 專案：`<cwd>/.claude/commands/*.md`

提供者先推入使用者項目再推入專案項目，因此**在此提供者內部，使用者 Claude 命令在同名衝突時優先於專案 Claude 命令**。

## `codex` 提供者（`codex.ts`）

載入：

- 使用者：`~/.codex/commands/*.md`
- 專案：`<cwd>/.codex/commands/*.md`

兩邊載入後以使用者優先的順序展平，因此**使用者 Codex 命令在衝突時優先於專案 Codex 命令**。

Codex 命令內容透過 frontmatter 剝離（`parseFrontmatter`）進行解析，命令名稱可由 frontmatter 的 `name` 覆寫；否則使用檔案名稱。

## `claude-plugins` 提供者（`claude-plugins.ts`）

從 `~/.claude/plugins/installed_plugins.json` 載入外掛命令根目錄，然後掃描 `<pluginRoot>/commands/*.md`。

排序遵循註冊表的迭代順序以及該 JSON 資料中每個外掛的條目順序。沒有額外的排序步驟。

## 3) 實體化為執行時期 `FileSlashCommand`

`src/extensibility/slash-commands.ts` 中的 `loadSlashCommands()` 將能力項目轉換為提示時使用的 `FileSlashCommand` 物件。

對於每個命令：

1. 解析 frontmatter/內文（`parseFrontmatter`）
2. 描述來源：
   - 若存在 `frontmatter.description` 則使用
   - 否則使用第一個非空內文行（修剪後，最多 60 字元加上 `...`）
3. 保留已解析的內文作為可執行範本內容
4. 計算顯示來源字串，例如 `via Claude Code Project`

Frontmatter 解析嚴重程度取決於來源：

- `native` 層級 -> 解析錯誤為 `fatal`
- `user`/`project` 層級 -> 解析錯誤為 `warn` 並使用備援解析

### 內建備援命令

在檔案系統/提供者命令之後，如果名稱尚未存在，則會附加嵌入式命令範本（`EMBEDDED_COMMAND_TEMPLATES`）。

目前的嵌入式集合來自 `src/task/commands.ts`，作為備援使用（`source: "bundled"`）。

## 4) 互動模式：命令列表的來源

互動模式結合多個命令來源進行自動完成和命令路由。

建構時會從以下來源建立待處理命令列表：

- 內建命令（`BUILTIN_SLASH_COMMANDS`，包含選定命令的引數完成和內嵌提示）
- 擴充功能註冊的斜線命令（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript 自訂命令（`session.customCommands`），映射為斜線命令標籤
- 當 `skills.enableSkillCommands` 啟用時的可選技能命令（`/skill:<name>`）

然後 `init()` 呼叫 `refreshSlashCommandState(...)` 來載入檔案型命令，並安裝一個包含以下內容的 `CombinedAutocompleteProvider`：

- 上述待處理命令
- 已發現的檔案型命令

`refreshSlashCommandState(...)` 也會更新 `session.setSlashCommands(...)`，使提示展開使用相同的已發現檔案命令集。

### 重新整理生命週期

斜線命令狀態在以下時機重新整理：

- 互動模式初始化期間
- `/move` 變更工作目錄後（`handleMoveCommand` 呼叫 `resetCapabilities()` 然後 `refreshSlashCommandState(newCwd)`）

命令目錄沒有持續的檔案監視器。

### 其他呈現方式

擴充功能儀表板也會載入 `slash-commands` 能力並顯示啟用/被遮蔽的命令條目，包括 `_shadowed` 的重複項。

## 5) 提示管線中的位置

`AgentSession.prompt(...)` 斜線處理順序（當 `expandPromptTemplates !== false` 時）：

1. **擴充功能命令**（`#tryExecuteExtensionCommand`）
   若 `/name` 匹配擴充功能註冊的命令，處理器立即執行，提示即返回。
2. **TypeScript 自訂命令**（`#tryExecuteCustomCommand`）
   僅限邊界：若匹配，則執行並可能返回：
   - `string` -> 用該字串替換提示文字
   - `void/undefined` -> 視為已處理；不發送 LLM 提示
3. **檔案型斜線命令**（`expandSlashCommand`）
   若文字仍以 `/` 開頭，嘗試 markdown 命令展開。
4. **提示範本**（`expandPromptTemplate`）
   在斜線/自訂處理之後套用。
5. **傳送**
   - 閒置：提示立即發送給代理
   - 串流中：提示根據 `streamingBehavior` 排入佇列作為引導/後續訊息

這就是為什麼斜線命令展開位於提示範本展開之前，以及為什麼自訂命令可以在檔案命令匹配之前移除開頭的斜線。

## 6) 檔案型斜線命令的展開語意

`expandSlashCommand(text, fileCommands)` 行為：

- 僅在文字以 `/` 開頭時執行
- 從 `/` 之後的第一個標記解析命令名稱
- 透過 `parseCommandArgs` 從剩餘文字解析引數
- 在已載入的 `fileCommands` 中尋找精確名稱匹配
- 若匹配，則套用：
  - 位置替換：`$1`、`$2`、...
  - 聚合替換：`$ARGUMENTS` 和 `$@`
  - 然後透過 `prompt.render` 使用 `{ args, ARGUMENTS, arguments }` 進行範本渲染
- 若無匹配，返回原始文字不變

### `parseCommandArgs` 注意事項

解析器是簡單的引號感知分割：

- 支援 `'single'` 和 `"double"` 引號以保留空格
- 剝離引號分隔符
- 不實作反斜線跳脫規則
- 未匹配的引號不是錯誤；解析器會消耗到結尾

## 7) 未知 `/...` 行為

未知的斜線輸入**不會被**核心斜線邏輯拒絕。

若命令未被擴充功能/自訂/檔案層處理，`expandSlashCommand` 返回原始文字，字面的 `/...` 提示會繼續通過正常的提示範本展開和 LLM 傳送。

互動模式在 `InputController` 中另外硬處理許多內建命令（例如 `/settings`、`/model`、`/mcp`、`/move`、`/exit`）。這些命令在 `session.prompt(...)` 之前就被消耗，因此在該路徑中永遠不會到達檔案命令展開。

## 8) 串流時與閒置時的差異

## 閒置路徑

- `session.prompt("/x ...")` 執行命令管線，要麼立即執行命令，要麼直接發送展開後的文字。

## 串流路徑（`session.isStreaming === true`）

- `prompt(...)` 仍然先執行擴充功能/自訂/檔案/範本轉換
- 然後需要 `streamingBehavior`：
  - `"steer"` -> 排入中斷訊息佇列（`agent.steer`）
  - `"followUp"` -> 排入回合後訊息佇列（`agent.followUp`）
- 若省略 `streamingBehavior`，提示會拋出錯誤

### 重要的命令特定串流行為

- 擴充功能命令即使在串流期間也會立即執行（不會作為文字排入佇列）。
- `steer(...)`/`followUp(...)` 輔助方法會拒絕擴充功能命令（`#throwIfExtensionCommand`），以避免將命令文字排入佇列給必須同步執行的處理器。
- 壓縮佇列重播使用 `isKnownSlashCommand(...)` 來決定排入佇列的條目應透過 `session.prompt(...)`（用於已知斜線命令）還是原始引導/後續方法進行重播。

## 9) 錯誤處理與失敗面

- 提供者載入失敗是隔離的；註冊表收集警告並繼續處理其他提供者。
- 無效的斜線命令項目（缺少名稱/路徑/內容或無效層級）會被能力驗證丟棄。
- Frontmatter 解析失敗：
  - 原生命令：致命解析錯誤會向上傳播
  - 非原生命令：警告 + 備援鍵值解析
- 擴充功能/自訂命令處理器異常會被捕獲並透過擴充功能錯誤通道回報（或對於沒有擴充功能執行器的自訂命令使用記錄器備援），並視為已處理（不會發生非預期的備援執行）。
