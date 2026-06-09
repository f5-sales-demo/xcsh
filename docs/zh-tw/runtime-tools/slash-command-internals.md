---
title: 斜線指令內部機制
description: 斜線指令系統內部機制，包含註冊、參數解析與執行調度。
sidebar:
  order: 5
  label: 斜線指令
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# 斜線指令內部機制

本文件描述在 `coding-agent` 中，斜線指令如何被發現、去重、在互動模式中呈現，以及在提示時展開。

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

斜線指令是一種能力（`id: "slash-commands"`），以指令名稱為鍵（`key: cmd => cmd.name`）。

能力註冊表會載入所有已註冊的提供者，按提供者優先順序降序排列，並以**先到先得**的語意進行鍵值去重。

### 提供者優先順序

目前的斜線指令提供者及其優先順序：

1. `native`（OMP）— 優先順序 `100`
2. `claude` — 優先順序 `80`
3. `claude-plugins` — 優先順序 `70`
4. `codex` — 優先順序 `70`

平手行為：優先順序相同的提供者保持註冊順序。目前的匯入順序會在 `codex` 之前註冊 `claude-plugins`，因此當名稱衝突時，外掛指令優先於 codex 指令。

### 名稱衝突行為

對於 `slash-commands`，衝突嚴格由能力去重機制解決：

- 最高優先順序的項目保留在 `result.items` 中
- 較低優先順序的重複項目僅保留在 `result.all` 中，並標記為 `_shadowed = true`

這適用於跨提供者的情況，也適用於同一提供者內傳回重複名稱的情況。

### 檔案掃描行為

提供者主要使用 `loadFilesFromDir(...)`，目前的行為：

- 預設為非遞迴匹配（`*.md`）
- 使用原生 glob，設定 `gitignore: true`、`hidden: false`
- 讀取每個匹配的檔案並將其轉換為 `SlashCommand`

因此隱藏檔案/目錄不會被載入，被忽略的路徑也會被略過。

## 2) 提供者特定的來源路徑與本地優先順序

## `native` 提供者（`builtin.ts`）

搜尋根目錄來自 `.xcsh` 目錄：

- 專案：`<cwd>/.xcsh/commands/*.md`
- 使用者：`~/.xcsh/agent/commands/*.md`

`getConfigDirs()` 先傳回專案目錄，再傳回使用者目錄，因此當名稱衝突時，**專案原生指令優先於使用者原生指令**。

## `claude` 提供者（`claude.ts`）

載入：

- 使用者：`~/.claude/commands/*.md`
- 專案：`<cwd>/.claude/commands/*.md`

提供者先推入使用者項目再推入專案項目，因此在此提供者內，當名稱相同時，**使用者 Claude 指令優先於專案 Claude 指令**。

## `codex` 提供者（`codex.ts`）

載入：

- 使用者：`~/.codex/commands/*.md`
- 專案：`<cwd>/.codex/commands/*.md`

兩邊載入後以使用者優先的順序展平，因此衝突時**使用者 Codex 指令優先於專案 Codex 指令**。

Codex 指令內容使用 frontmatter 剝離（`parseFrontmatter`）進行解析，指令名稱可由 frontmatter 的 `name` 覆寫；否則使用檔案名稱。

## `claude-plugins` 提供者（`claude-plugins.ts`）

從 `~/.claude/plugins/installed_plugins.json` 載入外掛指令根目錄，然後掃描 `<pluginRoot>/commands/*.md`。

排序遵循註冊表的迭代順序和該 JSON 資料中每個外掛的項目順序。沒有額外的排序步驟。

## 3) 實體化為執行時期 `FileSlashCommand`

`src/extensibility/slash-commands.ts` 中的 `loadSlashCommands()` 將能力項目轉換為提示時使用的 `FileSlashCommand` 物件。

對於每個指令：

1. 解析 frontmatter/內文（`parseFrontmatter`）
2. 描述來源：
   - 若存在 `frontmatter.description` 則使用
   - 否則使用第一行非空內文（去除空白，最多 60 字元加 `...`）
3. 保留已解析的內文作為可執行的範本內容
4. 計算顯示來源字串，例如 `via Claude Code Project`

Frontmatter 解析嚴重程度取決於來源：

- `native` 層級 -> 解析錯誤為 `fatal`
- `user`/`project` 層級 -> 解析錯誤為 `warn`，並有備援解析

### 內建備援指令

在檔案系統/提供者指令之後，如果名稱尚未存在，會附加嵌入式指令範本（`EMBEDDED_COMMAND_TEMPLATES`）。

目前的嵌入式集合來自 `src/task/commands.ts`，作為備援使用（`source: "bundled"`）。

## 4) 互動模式：指令列表的來源

互動模式結合多個指令來源用於自動完成和指令路由。

在建構時，它從以下來源建立待處理的指令列表：

- 內建指令（`BUILTIN_SLASH_COMMANDS`，包含所選指令的參數自動完成和內嵌提示）
- 擴充功能註冊的斜線指令（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript 自訂指令（`session.customCommands`），對應到斜線指令標籤
- 選用的技能指令（`/skill:<name>`），當 `skills.enableSkillCommands` 啟用時

然後 `init()` 呼叫 `refreshSlashCommandState(...)` 來載入基於檔案的指令，並安裝一個包含以下內容的 `CombinedAutocompleteProvider`：

- 上述待處理的指令
- 已發現的基於檔案的指令

`refreshSlashCommandState(...)` 也會更新 `session.setSlashCommands(...)`，使提示展開使用相同的已發現檔案指令集。

### 重新整理生命週期

斜線指令狀態在以下時機重新整理：

- 互動模式初始化期間
- `/move` 變更工作目錄後（`handleMoveCommand` 呼叫 `resetCapabilities()` 然後 `refreshSlashCommandState(newCwd)`）

指令目錄沒有持續的檔案監控器。

### 其他呈現方式

擴充功能儀表板也會載入 `slash-commands` 能力，並顯示使用中/被遮蔽的指令項目，包括 `_shadowed` 的重複項目。

## 5) 提示管線中的位置

`AgentSession.prompt(...)` 斜線處理順序（當 `expandPromptTemplates !== false` 時）：

1. **擴充功能指令**（`#tryExecuteExtensionCommand`）
   若 `/name` 匹配擴充功能註冊的指令，處理器立即執行且提示返回。
2. **TypeScript 自訂指令**（`#tryExecuteCustomCommand`）
   僅限邊界：若匹配，則執行並可能傳回：
   - `string` -> 以該字串取代提示文字
   - `void/undefined` -> 視為已處理；不發送 LLM 提示
3. **基於檔案的斜線指令**（`expandSlashCommand`）
   若文字仍以 `/` 開頭，嘗試 markdown 指令展開。
4. **提示範本**（`expandPromptTemplate`）
   在斜線/自訂處理之後套用。
5. **傳遞**
   - 閒置時：提示立即發送給代理
   - 串流中：提示根據 `streamingBehavior` 排入佇列作為導向/後續訊息

這就是為什麼斜線指令展開位於提示範本展開之前，以及為什麼自訂指令可以在檔案指令匹配之前轉換掉開頭的斜線。

## 6) 基於檔案的斜線指令展開語意

`expandSlashCommand(text, fileCommands)` 行為：

- 僅在文字以 `/` 開頭時執行
- 從 `/` 之後的第一個標記解析指令名稱
- 透過 `parseCommandArgs` 從剩餘文字解析參數
- 在已載入的 `fileCommands` 中尋找完全匹配的名稱
- 若匹配，則套用：
  - 位置替換：`$1`、`$2`、...
  - 聚合替換：`$ARGUMENTS` 和 `$@`
  - 然後透過 `prompt.render` 以 `{ args, ARGUMENTS, arguments }` 進行範本渲染
- 若無匹配，傳回原始文字不變

### `parseCommandArgs` 注意事項

解析器是簡單的引號感知分割：

- 支援 `'單引號'` 和 `"雙引號"` 以保留空格
- 移除引號分隔符
- 不實作反斜線跳脫規則
- 未匹配的引號不視為錯誤；解析器會消耗到結尾

## 7) 未知 `/...` 行為

未知的斜線輸入**不會被**核心斜線邏輯拒絕。

若指令未被擴充功能/自訂/檔案層處理，`expandSlashCommand` 傳回原始文字，字面的 `/...` 提示會繼續經過正常的提示範本展開和 LLM 傳遞。

互動模式另外在 `InputController` 中硬處理許多內建指令（例如 `/settings`、`/model`、`/mcp`、`/move`、`/exit`）。這些指令在 `session.prompt(...)` 之前就被消耗，因此在該路徑中永遠不會到達檔案指令展開。

## 8) 串流時與閒置時的差異

## 閒置路徑

- `session.prompt("/x ...")` 執行指令管線，然後直接執行指令或直接發送展開後的文字。

## 串流路徑（`session.isStreaming === true`）

- `prompt(...)` 仍然先執行擴充功能/自訂/檔案/範本轉換
- 然後需要 `streamingBehavior`：
  - `"steer"` -> 排入中斷訊息佇列（`agent.steer`）
  - `"followUp"` -> 排入回合後訊息佇列（`agent.followUp`）
- 若省略 `streamingBehavior`，提示會拋出錯誤

### 重要的指令特定串流行為

- 擴充功能指令即使在串流期間也會立即執行（不會作為文字排入佇列）。
- `steer(...)`/`followUp(...)` 輔助方法會拒絕擴充功能指令（`#throwIfExtensionCommand`），以避免將指令文字排入必須同步執行的處理器佇列。
- 壓縮佇列重播使用 `isKnownSlashCommand(...)` 來決定排入佇列的項目應該透過 `session.prompt(...)`（用於已知的斜線指令）還是原始的導向/後續方法來重播。

## 9) 錯誤處理與失敗面

- 提供者載入失敗是隔離的；註冊表收集警告並繼續處理其他提供者。
- 無效的斜線指令項目（缺少名稱/路徑/內容或層級無效）會被能力驗證丟棄。
- Frontmatter 解析失敗：
  - 原生指令：致命的解析錯誤會向上傳遞
  - 非原生指令：警告 + 備援鍵值解析
- 擴充功能/自訂指令處理器的例外會被捕獲，並透過擴充功能錯誤通道報告（或對於沒有擴充功能執行器的自訂指令使用日誌記錄器備援），且視為已處理（不會有意外的備援執行）。
