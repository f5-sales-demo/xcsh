---
title: 斜線命令內部機制
description: 斜線命令系統的內部機制，涵蓋註冊、參數解析與執行分派。
sidebar:
  order: 5
  label: 斜線命令
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# 斜線命令內部機制

本文件說明斜線命令在 `coding-agent` 中如何被探索、去重複、顯示於互動模式，以及在提示時展開。

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

斜線命令是一種能力（`id: "slash-commands"`），以命令名稱為鍵（`key: cmd => cmd.name`）。

能力登錄表會載入所有已註冊的提供者，按提供者優先順序由高至低排序，並以**先到優先**語意依鍵去重複。

### 提供者優先順序

目前斜線命令提供者及其優先級：

1. `native`（OMP）— 優先級 `100`
2. `claude` — 優先級 `80`
3. `claude-plugins` — 優先級 `70`
4. `codex` — 優先級 `70`

同優先級行為：優先級相同的提供者依照註冊順序保留。目前的匯入順序會在 `codex` 之前註冊 `claude-plugins`，因此在名稱衝突時，插件命令優先於 codex 命令。

### 名稱衝突行為

對於 `slash-commands`，衝突嚴格依能力去重複處理：

- 優先級最高的項目保留於 `result.items`
- 優先級較低的重複項僅保留於 `result.all` 中，並標記為 `_shadowed = true`

此規則適用於跨提供者之間，以及提供者內部傳回重複名稱的情況。

### 檔案掃描行為

提供者大多使用 `loadFilesFromDir(...)`，目前行為如下：

- 預設為非遞迴比對（`*.md`）
- 使用原生 glob，搭配 `gitignore: true`、`hidden: false`
- 讀取每個符合的檔案並轉換為 `SlashCommand`

因此，隱藏檔案／目錄不會被載入，而被忽略的路徑也會被跳過。

## 2) 提供者專屬來源路徑與本地優先順序

## `native` 提供者（`builtin.ts`）

搜尋根目錄來自 `.xcsh` 目錄：

- 專案：`<cwd>/.xcsh/commands/*.md`
- 使用者：`~/.xcsh/agent/commands/*.md`

`getConfigDirs()` 先傳回專案路徑，再傳回使用者路徑，因此在名稱衝突時，**專案原生命令優先於使用者原生命令**。

## `claude` 提供者（`claude.ts`）

載入：

- 使用者：`~/.claude/commands/*.md`
- 專案：`<cwd>/.claude/commands/*.md`

提供者會先推入使用者項目，再推入專案項目，因此在此提供者內，**使用者 Claude 命令在同名衝突時優先於專案 Claude 命令**。

## `codex` 提供者（`codex.ts`）

載入：

- 使用者：`~/.codex/commands/*.md`
- 專案：`<cwd>/.codex/commands/*.md`

兩側均載入後以使用者優先的順序展平，因此在衝突時，**使用者 Codex 命令優先於專案 Codex 命令**。

Codex 命令內容會以前置元資料剝除方式解析（`parseFrontmatter`），命令名稱可由前置元資料的 `name` 欄位覆寫；否則使用檔案名稱。

## `claude-plugins` 提供者（`claude-plugins.ts`）

從 `~/.claude/plugins/installed_plugins.json` 載入插件命令根目錄，然後掃描 `<pluginRoot>/commands/*.md`。

排序依照登錄表的迭代順序以及該 JSON 資料中每個插件的項目順序，無額外排序步驟。

## 3) 具現化為執行時期的 `FileSlashCommand`

`src/extensibility/slash-commands.ts` 中的 `loadSlashCommands()` 會將能力項目轉換為在提示時使用的 `FileSlashCommand` 物件。

對每個命令：

1. 解析前置元資料／主體（`parseFrontmatter`）
2. 描述來源：
   - 若 `frontmatter.description` 存在則使用該值
   - 否則使用主體第一個非空行（修剪後，超過 60 個字元以 `...` 截斷）
3. 保留已解析的主體作為可執行的範本內容
4. 計算顯示來源字串，例如 `via Claude Code Project`

前置元資料解析嚴重性取決於來源：

- `native` 層級 -> 解析錯誤為 `fatal`（致命）
- `user`／`project` 層級 -> 解析錯誤為 `warn`（警告），並以備援解析處理

### 內建備援命令

在檔案系統／提供者命令之後，若其名稱尚未存在，則附加嵌入式命令範本（`EMBEDDED_COMMAND_TEMPLATES`）。

目前的嵌入集來自 `src/task/commands.ts`，作為備援使用（`source: "bundled"`）。

## 4) 互動模式：命令清單的來源

互動模式結合多個命令來源以供自動完成與命令路由使用。

在建構時，它從以下來源建立待處理的命令清單：

- 內建命令（`BUILTIN_SLASH_COMMANDS`，包含部分命令的參數完成與內嵌提示）
- 擴充功能已註冊的斜線命令（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript 自訂命令（`session.customCommands`），對應至斜線命令標籤
- 可選的技能命令（`/skill:<name>`），當 `skills.enableSkillCommands` 啟用時

接著 `init()` 呼叫 `refreshSlashCommandState(...)` 來載入檔案型命令，並安裝一個包含以下內容的 `CombinedAutocompleteProvider`：

- 上述待處理命令
- 已探索的檔案型命令

`refreshSlashCommandState(...)` 也會更新 `session.setSlashCommands(...)`，使提示展開使用相同的已探索檔案命令集。

### 刷新生命週期

斜線命令狀態會在以下時機刷新：

- 互動初始化期間
- `/move` 變更工作目錄後（`handleMoveCommand` 呼叫 `resetCapabilities()`，然後呼叫 `refreshSlashCommandState(newCwd)`）

命令目錄沒有持續的檔案監視器。

### 其他顯示位置

擴充功能儀表板也會載入 `slash-commands` 能力，並顯示啟用中及被遮蔽的命令項目，包括 `_shadowed` 的重複項。

## 5) 提示管線中的位置

`AgentSession.prompt(...)` 的斜線處理順序（當 `expandPromptTemplates !== false` 時）：

1. **擴充功能命令**（`#tryExecuteExtensionCommand`）  
   若 `/name` 符合擴充功能已註冊的命令，處理器立即執行，提示隨即返回。
2. **TypeScript 自訂命令**（`#tryExecuteCustomCommand`）  
   僅作為邊界：若符合，則執行並可能返回：
   - `string` -> 以該字串取代提示文字
   - `void/undefined` -> 視為已處理；不發送 LLM 提示
3. **檔案型斜線命令**（`expandSlashCommand`）  
   若文字仍以 `/` 開頭，嘗試進行 Markdown 命令展開。
4. **提示範本**（`expandPromptTemplate`）  
   在斜線／自訂處理之後套用。
5. **傳遞**
   - 閒置：提示立即傳送至代理程式
   - 串流中：依 `streamingBehavior` 將提示排隊為引導或後續訊息

這說明了斜線命令展開位於提示範本展開之前，以及自訂命令可在檔案命令比對前先轉換掉開頭的斜線。

## 6) 檔案型斜線命令的展開語意

`expandSlashCommand(text, fileCommands)` 行為：

- 僅在文字以 `/` 開頭時執行
- 從 `/` 後的第一個標記解析命令名稱
- 透過 `parseCommandArgs` 從其餘文字解析參數
- 在已載入的 `fileCommands` 中尋找完全相符的名稱
- 若符合，則套用：
  - 位置替換：`$1`、`$2`、...
  - 彙總替換：`$ARGUMENTS` 與 `$@`
  - 再透過 `prompt.render` 以 `{ args, ARGUMENTS, arguments }` 進行範本渲染
- 若無符合，則返回原始文字不變

### `parseCommandArgs` 注意事項

解析器為簡單的引號感知分割：

- 支援 `'單引號'` 與 `"雙引號"` 以保留空格
- 剝除引號分隔符號
- 未實作反斜線跳脫規則
- 未配對的引號不視為錯誤；解析器持續消耗直到結尾

## 7) 未知 `/...` 的行為

未知的斜線輸入**不會**被核心斜線邏輯拒絕。

若命令未被擴充功能／自訂／檔案層處理，`expandSlashCommand` 會返回原始文字，且字面上的 `/...` 提示會繼續通過一般提示範本展開與 LLM 傳遞流程。

互動模式會在 `InputController` 中另外硬式處理許多內建命令（例如 `/settings`、`/model`、`/mcp`、`/move`、`/exit`）。這些命令在 `session.prompt(...)` 之前被消耗，因此在該路徑中永遠不會到達檔案命令展開階段。

## 8) 串流時期與閒置時期的差異

## 閒置路徑

- `session.prompt("/x ...")` 執行命令管線，並立即執行命令或直接傳送展開後的文字。

## 串流路徑（`session.isStreaming === true`）

- `prompt(...)` 仍會先執行擴充功能／自訂／檔案／範本轉換
- 接著需要 `streamingBehavior`：
  - `"steer"` -> 排隊中斷訊息（`agent.steer`）
  - `"followUp"` -> 排隊回合後訊息（`agent.followUp`）
- 若省略 `streamingBehavior`，提示會擲出錯誤

### 重要的命令專屬串流行為

- 擴充功能命令即使在串流期間也會立即執行（不以文字形式排隊）。
- `steer(...)`／`followUp(...)` 輔助方法會拒絕擴充功能命令（`#throwIfExtensionCommand`），以避免將必須同步執行的處理器命令文字排隊。
- 壓縮佇列重播使用 `isKnownSlashCommand(...)` 來決定已排隊的項目應透過 `session.prompt(...)` 重播（已知的斜線命令），還是透過原始的 steer／follow-up 方法。

## 9) 錯誤處理與失敗面

- 提供者載入失敗為獨立處理；登錄表收集警告並繼續處理其他提供者。
- 無效的斜線命令項目（缺少名稱／路徑／內容，或無效的層級）會在能力驗證階段被丟棄。
- 前置元資料解析失敗：
  - 原生命令：致命解析錯誤會向上傳遞
  - 非原生命令：警告 + 備援鍵值解析
- 擴充功能／自訂命令處理器例外會被捕獲，並透過擴充功能錯誤通道（或自訂命令沒有擴充功能執行器時的記錄器備援）回報，並視為已處理（不觸發意外的備援執行）。
