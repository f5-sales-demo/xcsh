---
title: 斜線指令內部機制
description: 斜線指令系統內部機制，包含註冊、參數解析與執行分派。
sidebar:
  order: 5
  label: 斜線指令
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# 斜線指令內部機制

本文件說明在 `coding-agent` 中，斜線指令如何被探索、去重複、在互動模式中呈現，以及在提示時展開。

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

## 1) 探索模型

斜線指令是一種能力（`id: "slash-commands"`），以指令名稱作為索引鍵（`key: cmd => cmd.name`）。

能力登錄表載入所有已註冊的提供者，依提供者優先順序遞減排序，並以**先進者優先**的語義依索引鍵去重複。

### 提供者優先順序

目前的斜線指令提供者及其優先順序：

1. `native`（OMP）— 優先順序 `100`
2. `claude` — 優先順序 `80`
3. `claude-plugins` — 優先順序 `70`
4. `codex` — 優先順序 `70`

平手行為：相同優先順序的提供者保留其註冊順序。目前的匯入順序會先註冊 `claude-plugins`，再註冊 `codex`，因此在名稱衝突時外掛指令優先於 codex 指令。

### 名稱衝突行為

對於 `slash-commands`，衝突嚴格依能力去重複規則解決：

- 最高優先順序的項目保留在 `result.items` 中
- 較低優先順序的重複項目僅保留在 `result.all` 中，並標記為 `_shadowed = true`

此規則適用於跨提供者的情況，以及同一提供者回傳重複名稱的情況。

### 檔案掃描行為

提供者大多使用 `loadFilesFromDir(...)`，其目前行為如下：

- 預設為非遞迴比對（`*.md`）
- 使用原生 glob，並設定 `gitignore: true`、`hidden: false`
- 讀取每個符合的檔案並將其轉換為 `SlashCommand`

因此隱藏的檔案或目錄不會被載入，且被忽略的路徑會被跳過。

## 2) 提供者專屬來源路徑與本地優先順序

## `native` 提供者（`builtin.ts`）

搜尋根目錄來自 `.xcsh` 目錄：

- 專案：`<cwd>/.xcsh/commands/*.md`
- 使用者：`~/.xcsh/agent/commands/*.md`

`getConfigDirs()` 先回傳專案目錄，再回傳使用者目錄，因此在名稱衝突時**專案原生指令優先於使用者原生指令**。

## `claude` 提供者（`claude.ts`）

載入：

- 使用者：`~/.claude/commands/*.md`
- 專案：`<cwd>/.claude/commands/*.md`

提供者先推入使用者項目，再推入專案項目，因此在此提供者內部的同名衝突中，**使用者 Claude 指令優先於專案 Claude 指令**。

## `codex` 提供者（`codex.ts`）

載入：

- 使用者：`~/.codex/commands/*.md`
- 專案：`<cwd>/.codex/commands/*.md`

兩側均被載入，然後以使用者優先的順序展平，因此在衝突時**使用者 Codex 指令優先於專案 Codex 指令**。

Codex 指令內容使用前置資料剝離（`parseFrontmatter`）解析，指令名稱可由前置資料中的 `name` 欄位覆寫；否則使用檔名。

## `claude-plugins` 提供者（`claude-plugins.ts`）

從 `~/.claude/plugins/installed_plugins.json` 載入外掛指令根目錄，然後掃描 `<pluginRoot>/commands/*.md`。

排序遵循登錄表的迭代順序以及該 JSON 資料中每個外掛的條目順序，不進行額外的排序步驟。

## 3) 實體化為執行時期的 `FileSlashCommand`

`src/extensibility/slash-commands.ts` 中的 `loadSlashCommands()` 將能力項目轉換為提示時使用的 `FileSlashCommand` 物件。

對每個指令執行以下操作：

1. 解析前置資料與內文（`parseFrontmatter`）
2. 描述來源：
   - 若存在 `frontmatter.description` 則使用之
   - 否則使用內文第一個非空行（修剪後，最多 60 個字元並加上 `...`）
3. 保留解析後的內文作為可執行的範本內容
4. 計算顯示來源字串，例如 `via Claude Code Project`

前置資料解析的嚴重性等級依來源而異：

- `native` 層級 -> 解析錯誤為 `fatal`
- `user`/`project` 層級 -> 解析錯誤為 `warn`，並使用備用解析

### 內嵌備用指令

在檔案系統/提供者指令之後，若名稱尚不存在，則附加內嵌的指令範本（`EMBEDDED_COMMAND_TEMPLATES`）。

目前的內嵌集來自 `src/task/commands.ts`，作為備用使用（`source: "bundled"`）。

## 4) 互動模式：指令清單的來源

互動模式結合多個指令來源，用於自動補全與指令路由。

在建構時，它從以下來源建立待處理指令清單：

- 內建指令（`BUILTIN_SLASH_COMMANDS`，包含特定指令的參數補全與行內提示）
- 擴充功能已註冊的斜線指令（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript 自訂指令（`session.customCommands`），映射至斜線指令標籤
- 啟用 `skills.enableSkillCommands` 時的選用技能指令（`/skill:<name>`）

然後 `init()` 呼叫 `refreshSlashCommandState(...)` 以載入檔案型指令，並安裝一個包含以下內容的 `CombinedAutocompleteProvider`：

- 上述待處理指令
- 已探索的檔案型指令

`refreshSlashCommandState(...)` 也會更新 `session.setSlashCommands(...)`，使提示展開使用相同的已探索檔案指令集。

### 重新整理生命週期

斜線指令狀態的重新整理時機：

- 在互動模式初始化期間
- `/move` 變更工作目錄後（`handleMoveCommand` 呼叫 `resetCapabilities()`，再呼叫 `refreshSlashCommandState(newCwd)`）

指令目錄沒有持續的檔案監視器。

### 其他呈現方式

擴充功能儀表板也會載入 `slash-commands` 能力，並顯示作用中與被遮蔽的指令條目，包括 `_shadowed` 重複項目。

## 5) 提示管線中的位置

`AgentSession.prompt(...)` 的斜線指令處理順序（當 `expandPromptTemplates !== false` 時）：

1. **擴充功能指令**（`#tryExecuteExtensionCommand`）  
   若 `/name` 符合擴充功能已註冊的指令，處理器立即執行，提示隨即返回。
2. **TypeScript 自訂指令**（`#tryExecuteCustomCommand`）  
   僅作為邊界：若符合，則執行並可能返回：
   - `string` -> 以該字串替換提示文字
   - `void/undefined` -> 視為已處理；不觸發 LLM 提示
3. **檔案型斜線指令**（`expandSlashCommand`）  
   若文字仍以 `/` 開頭，嘗試展開 markdown 指令。
4. **提示範本**（`expandPromptTemplate`）  
   在斜線/自訂指令處理之後套用。
5. **傳遞**
   - 閒置：提示立即傳送至代理
   - 串流中：根據 `streamingBehavior` 將提示排入佇列作為引導/後續訊息

這就是為何斜線指令展開位於提示範本展開之前，以及為何自訂指令可以在檔案指令比對之前轉換掉前導的斜線。

## 6) 檔案型斜線指令的展開語義

`expandSlashCommand(text, fileCommands)` 的行為：

- 僅在文字以 `/` 開頭時執行
- 從 `/` 後的第一個語彙單元解析指令名稱
- 透過 `parseCommandArgs` 從剩餘文字解析參數
- 在已載入的 `fileCommands` 中尋找完全符合的名稱
- 若符合，則套用：
  - 位置替換：`$1`、`$2`、...
  - 彙總替換：`$ARGUMENTS` 與 `$@`
  - 然後透過 `prompt.render` 進行範本渲染，使用 `{ args, ARGUMENTS, arguments }`
- 若無符合項目，返回原始文字不變

### `parseCommandArgs` 注意事項

解析器是簡單的引號感知分割器：

- 支援 `'單引號'` 和 `"雙引號"` 以保留空格
- 去除引號分隔符號
- 未實作反斜線跳脫規則
- 未配對的引號不視為錯誤；解析器持續消耗至結尾

## 7) 未知 `/...` 的行為

未知的斜線輸入**不會**被核心斜線邏輯拒絕。

若指令未被擴充功能/自訂/檔案層處理，`expandSlashCommand` 返回原始文字，字面上的 `/...` 提示繼續通過正常的提示範本展開與 LLM 傳遞流程。

互動模式在 `InputController` 中另外對許多內建指令進行硬處理（例如 `/settings`、`/model`、`/mcp`、`/move`、`/exit`）。這些指令在 `session.prompt(...)` 之前被消耗，因此在該路徑中永遠不會到達檔案指令展開階段。

## 8) 串流時與閒置時的差異

## 閒置路徑

- `session.prompt("/x ...")` 執行指令管線，立即執行指令或直接傳送展開後的文字。

## 串流路徑（`session.isStreaming === true`）

- `prompt(...)` 仍會先執行擴充功能/自訂/檔案/範本的轉換
- 然後需要 `streamingBehavior`：
  - `"steer"` -> 排入中斷訊息（`agent.steer`）
  - `"followUp"` -> 排入輪次後訊息（`agent.followUp`）
- 若省略 `streamingBehavior`，提示將拋出錯誤

### 重要的指令特定串流行為

- 擴充功能指令即使在串流期間也會立即執行（不以文字形式排入佇列）。
- `steer(...)`/`followUp(...)` 輔助方法會拒絕擴充功能指令（`#throwIfExtensionCommand`），以避免將必須同步執行的處理器指令文字排入佇列。
- 壓縮佇列重播使用 `isKnownSlashCommand(...)` 來決定排入佇列的條目應透過 `session.prompt(...)`（針對已知斜線指令）還是原始的 steer/follow-up 方法重播。

## 9) 錯誤處理與失敗面

- 提供者載入失敗是隔離的；登錄表收集警告並繼續處理其他提供者。
- 無效的斜線指令項目（缺少名稱/路徑/內容或層級無效）會被能力驗證丟棄。
- 前置資料解析失敗：
  - 原生指令：致命解析錯誤會向上冒泡
  - 非原生指令：警告 + 備用鍵值解析
- 擴充功能/自訂指令處理器的例外情況會被捕捉，並透過擴充功能錯誤頻道回報（或對無擴充功能執行器的自訂指令使用日誌記錄器備用），並視為已處理（不會發生意外的備用執行）。
