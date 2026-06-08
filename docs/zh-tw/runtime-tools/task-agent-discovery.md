---
title: 任務代理發現與選擇
description: 任務代理的發現與選擇邏輯，用於將工作路由到專門的子代理類型。
sidebar:
  order: 6
  label: 任務代理發現
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# 任務代理發現與選擇

本文件描述任務子系統如何發現代理定義、合併多個來源，以及在執行時期解析請求的代理。

內容涵蓋目前已實作的執行時期行為，包括優先順序、無效定義處理，以及可能使代理實際上不可用的衍生/深度限制。

## 實作檔案

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## 代理定義結構

任務代理會標準化為 `AgentDefinition`（`src/task/types.ts`）：

- `name`、`description`、`systemPrompt`（有效載入代理的必要欄位）
- 選填的 `tools`、`spawns`、`model`、`thinkingLevel`、`output`
- `source`：`"bundled" | "user" | "project"`
- 選填的 `filePath`

解析來自透過 `parseAgentFields()`（`src/discovery/helpers.ts`）處理的 frontmatter：

- 缺少 `name` 或 `description` => 無效（`null`），呼叫方視為解析失敗
- `tools` 接受 CSV 或陣列；若有提供，`submit_result` 會自動加入
- `spawns` 接受 `*`、CSV 或陣列
- 向後相容行為：若缺少 `spawns` 但 `tools` 包含 `task`，則 `spawns` 變為 `*`
- `output` 作為不透明的 schema 資料直接傳遞

## 內建代理

內建代理在建置時嵌入（`src/task/agents.ts`），使用文字匯入。

`EMBEDDED_AGENT_DEFS` 定義：

- 來自提示詞檔案的 `explore`、`plan`、`designer`、`reviewer`
- 來自共用 `task.md` 本體加上注入 frontmatter 的 `task` 和 `quick_task`

載入路徑：

1. `loadBundledAgents()` 使用 `parseAgent(..., "bundled", "fatal")` 解析嵌入的 markdown
2. 結果快取於記憶體中（`bundledAgentsCache`）
3. `clearBundledAgentsCache()` 僅供測試用的快取重設

由於內建解析使用 `level: "fatal"`，格式錯誤的內建 frontmatter 會拋出例外，可能導致整個發現流程失敗。

## 檔案系統與外掛發現

`discoverAgents(cwd, home)`（`src/task/discovery.ts`）在附加內建定義之前，會合併多個來源的代理。

### 發現輸入

1. 使用者設定代理目錄，來自 `getConfigDirs("agents", { project: false })`
2. 最近的專案代理目錄，來自 `findAllNearestProjectConfigDirs("agents", cwd)`
3. Claude 外掛根目錄（`listClaudePluginRoots(home)`）中的 `agents/` 子目錄
4. 內建代理（`loadBundledAgents()`）

### 實際來源順序

來源系列順序來自 `getConfigDirs("", { project: false })`，其衍生自 `src/config.ts` 中的 `priorityList`：

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

對於每個來源系列，發現順序為：

1. 該來源的最近專案目錄（若找到）
2. 該來源的使用者目錄

在所有來源系列目錄之後，會附加外掛的 `agents/` 目錄（專案範圍的外掛優先，然後是使用者範圍的）。

內建代理最後附加。

### 重要注意事項：過時的註解與目前程式碼

`discovery.ts` 標頭註解仍然提到 `.pi`，且未提及 `.codex`/`.gemini`。實際執行時期順序由 `src/config.ts` 驅動，目前使用 `.xcsh`、`.claude`、`.codex`、`.gemini`。

## 合併與衝突規則

發現使用依精確 `agent.name` 的先到先得去重：

- 一個 `Set<string>` 追蹤已見過的名稱。
- 載入的代理按目錄順序展平，僅在名稱未見過時保留。
- 內建代理依相同集合過濾，僅在仍未見過時加入。

影響：

- 對於相同來源系列，專案覆蓋使用者。
- 較高優先順序的來源系列覆蓋較低的（`.xcsh` 在 `.claude` 之前，依此類推）。
- 非內建代理覆蓋同名的內建代理。
- 名稱比對區分大小寫（`Task` 和 `task` 是不同的）。
- 在單一目錄內，markdown 檔案在去重前按檔名字典順序讀取。

## 無效/遺失代理檔案行為

每個目錄（`loadAgentsFromDir`）：

- 無法讀取/遺失的目錄：視為空目錄（`readdir(...).catch(() => [])`）
- 檔案讀取或解析失敗：記錄警告，跳過檔案
- 解析路徑使用 `parseAgent(..., level: "warn")`

Frontmatter 失敗行為來自 `parseFrontmatter`：

- `warn` 層級的解析錯誤會記錄警告
- 解析器退回到簡單的 `key: value` 逐行解析器
- 若必要欄位仍然缺少，`parseAgentFields` 失敗，然後拋出 `AgentParsingError` 並被呼叫方捕獲（跳過檔案）

淨效果：一個損壞的自訂代理檔案不會中止其他檔案的發現。

## 代理查詢與選擇

查詢為精確名稱線性搜尋：

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

在任務執行中（`TaskTool.execute`）：

1. 代理在呼叫時重新發現（`discoverAgents(this.session.cwd)`）
2. 請求的 `params.agent` 透過 `getAgent` 解析
3. 找不到代理時回傳立即工具回應：
   - `Unknown agent "...". Available: ...`
   - 不執行子程序

### 描述與執行時期發現的差異

`TaskTool.create()` 在初始化時從發現結果建立工具描述（`buildDescription`）。

`execute()` 會再次重新發現代理。因此如果代理檔案在會話期間發生變更，執行時期集合可能與先前工具描述中列出的不同。

## 結構化輸出防護機制與 schema 優先順序

`TaskTool.execute` 中的執行時期輸出 schema 優先順序：

1. 代理 frontmatter `output`
2. 任務呼叫的 `params.schema`
3. 父會話的 `outputSchema`

（`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`）

`src/prompts/tools/task.md` 中的提示詞時期防護機制文字，針對結構化輸出代理（`explore`、`reviewer`）警告不匹配行為：prose 中的輸出格式指示可能與內建 schema 衝突，產生 `null` 輸出。

這是指引性質，並非 `discoverAgents` 中的硬性執行時期驗證邏輯。

## 命令發現互動

`src/task/commands.ts` 是工作流命令（非代理定義）的平行基礎設施，但遵循相同的整體模式：

- 先從能力提供者發現
- 以先到先得方式按名稱去重
- 若仍未見過則附加內建命令
- 透過 `getCommand` 進行精確名稱查詢

在 `src/task/index.ts` 中，命令輔助函式與代理發現輔助函式一起重新匯出。代理發現本身在執行時期不依賴命令發現。

## 超越發現的可用性限制

代理可以被發現但由於執行防護機制仍然無法執行。

### 父代衍生策略

`TaskTool.execute` 檢查 `session.getSessionSpawns()`：

- `"*"` => 允許任何
- `""` => 拒絕所有
- CSV 列表 => 僅允許列出的名稱

若被拒絕：立即回應 `Cannot spawn '...'. Allowed: ...`。

### 阻止自我遞迴的環境變數防護

`PI_BLOCKED_AGENT` 在工具建構時讀取。若請求匹配，執行會被拒絕並顯示遞迴防止訊息。

### 遞迴深度控制（子會話中的任務工具可用性）

在 `runSubprocess`（`src/task/executor.ts`）中：

- 深度從 `taskDepth` 計算
- `task.maxRecursionDepth` 控制截止點
- 當達到最大深度時：
  - `task` 工具從子工具列表中移除
  - 子代的 `spawns` 環境變數設為空

因此較深層級無法衍生更多任務，即使代理定義包含 `spawns`。

## 計畫模式注意事項（目前實作）

`TaskTool.execute` 為計畫模式計算 `effectiveAgent`（前置計畫模式提示詞、強制唯讀工具子集、清除 spawns），但 `runSubprocess` 呼叫時使用的是 `agent` 而非 `effectiveAgent`。

目前的效果：

- 模型覆蓋/思考層級/輸出 schema 衍生自 `effectiveAgent`
- 來自 `effectiveAgent` 的系統提示詞和工具/衍生限制在此呼叫路徑中未被傳遞

這是在閱讀計畫模式行為預期時值得了解的實作注意事項。
