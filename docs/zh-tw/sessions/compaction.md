---
title: 壓縮與分支摘要
description: 長時間會話的上下文視窗壓縮與分支摘要產生機制。
sidebar:
  order: 5
  label: 壓縮
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# 壓縮與分支摘要

壓縮與分支摘要是保持長時間會話可用性同時不遺失先前工作上下文的兩種機制。

- **壓縮** 將當前分支上的舊歷史記錄重寫為摘要。
- **分支摘要** 在 `/tree` 導航期間擷取被放棄的分支上下文。

兩者都作為會話條目持久化儲存，並在重建 LLM 輸入時轉換回使用者上下文訊息。

## 關鍵實作檔案

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## 會話條目模型

壓縮與分支摘要是一級會話條目，而非普通的 assistant/user 訊息。

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`，可選的 `shortSummary`
  - `firstKeptEntryId`（壓縮邊界）
  - `tokensBefore`
  - 可選的 `details`、`preserveData`、`fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`、`summary`
  - 可選的 `details`、`fromExtension`

當上下文被重建時（`buildSessionContext`）：

1. 活動路徑上最新的壓縮條目被轉換為一條 `compactionSummary` 訊息。
2. 從 `firstKeptEntryId` 到壓縮點之間的保留條目會被重新包含。
3. 路徑上後續的條目會被附加。
4. `branch_summary` 條目被轉換為 `branchSummary` 訊息。
5. `custom_message` 條目被轉換為 `custom` 訊息。

這些自訂角色隨後在 `convertToLlm()` 中使用靜態範本轉換為面向 LLM 的使用者訊息：

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## 壓縮流程

### 觸發條件

壓縮可以透過三種方式執行：

1. **手動**：`/compact [instructions]` 呼叫 `AgentSession.compact(...)`。
2. **自動溢位恢復**：在助手錯誤匹配上下文溢位時觸發。
3. **自動閾值壓縮**：在成功的回合後，當上下文超過閾值時觸發。

### 壓縮形態（視覺化）

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### 溢位重試 vs 閾值壓縮

兩種自動路徑的設計有意不同：

- **溢位重試壓縮**
  - 觸發條件：當前模型的助手錯誤被偵測為上下文溢位。
  - 失敗的助手錯誤訊息在重試前從活動代理狀態中移除。
  - 自動壓縮以 `reason: "overflow"` 和 `willRetry: true` 執行。
  - 成功後，代理自動繼續（`agent.continue()`）進行壓縮後的操作。

- **閾值壓縮**
  - 觸發條件：`contextTokens > contextWindow - compaction.reserveTokens`。
  - 以 `reason: "threshold"` 和 `willRetry: false` 執行。
  - 成功後，如果 `compaction.autoContinue !== false`，注入一個合成提示：
    - `"Continue if you have next steps."`

### 壓縮前修剪

在壓縮檢查之前，可能會執行工具結果修剪（`pruneToolOutputs`）。

預設修剪策略：

- 保護最新的 `40_000` 個工具輸出 token。
- 要求至少 `20_000` 個預估節省的 token 總量。
- 絕不修剪來自 `skill` 或 `read` 的工具結果。

被修剪的工具結果會被替換為：

- `[Output truncated - N tokens]`

如果修剪變更了條目，會話儲存會被重寫，且代理訊息狀態會在壓縮決策之前重新整理。

### 邊界與切點邏輯

`prepareCompaction()` 僅考慮自上次壓縮條目（如果有的話）之後的條目。

1. 找到先前的壓縮索引。
2. 計算 `boundaryStart = prevCompactionIndex + 1`。
3. 在有可用的量測使用率時，調整 `keepRecentTokens`。
4. 在邊界視窗上執行 `findCutPoint()`。

有效的切點包括：

- 角色為以下值的訊息條目：`user`、`assistant`、`bashExecution`、`hookMessage`、`branchSummary`、`compactionSummary`
- `custom_message` 條目
- `branch_summary` 條目

硬性規則：絕不在 `toolResult` 處切割。

如果切點之前緊接著非訊息的中繼資料條目（`model_change`、`thinking_level_change`、標籤等），這些條目會透過向後移動切割索引被拉入保留區域，直到遇到訊息或壓縮邊界為止。

### 分割回合處理

如果切點不在使用者回合的起始位置，壓縮會將其視為分割回合。

回合起始偵測將以下視為使用者回合邊界：

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` 條目
- `branch_summary` 條目

分割回合壓縮會產生兩個摘要：

1. 歷史摘要（`messagesToSummarize`）
2. 回合前綴摘要（`turnPrefixMessages`）

最終儲存的摘要會合併為：

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### 摘要產生

`compact(...)` 從序列化的對話文字建構摘要：

1. 透過 `convertToLlm()` 轉換訊息。
2. 使用 `serializeConversation()` 序列化。
3. 包裹在 `<conversation>...</conversation>` 中。
4. 可選地包含 `<previous-summary>...</previous-summary>`。
5. 可選地將鉤子上下文作為 `<additional-context>` 列表注入。
6. 使用 `SUMMARIZATION_SYSTEM_PROMPT` 執行摘要提示。

提示選擇：

- 首次壓縮：`compaction-summary.md`
- 帶有先前摘要的迭代壓縮：`compaction-update-summary.md`
- 分割回合第二次傳遞：`compaction-turn-prefix.md`
- 簡短 UI 摘要：`compaction-short-summary.md`

遠端摘要模式：

- 如果設定了 `compaction.remoteEndpoint`，壓縮會 POST：
  - `{ systemPrompt, prompt }`
- 預期回應的 JSON 至少包含 `{ summary }`。

### 摘要中的檔案操作上下文

壓縮使用助手工具呼叫追蹤累積的檔案活動：

- `read(path)` → 讀取集合
- `write(path)` → 修改集合
- `edit(path)` → 修改集合

累積行為：

- 僅在先前條目是 pi 產生的（`fromExtension !== true`）時，才包含先前壓縮的詳細資訊。
- 在分割回合中，也包含回合前綴的檔案操作。
- `readFiles` 排除同時被修改的檔案。

摘要文字透過提示範本附加檔案標籤：

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### 持久化與重新載入

摘要產生後（或由鉤子提供的摘要），代理會話：

1. 使用 `appendCompaction(...)` 附加 `CompactionEntry`。
2. 透過 `buildSessionContext()` 重建上下文。
3. 使用重建的上下文替換即時代理訊息。
4. 發出 `session_compact` 鉤子事件。

## 分支摘要流程

分支摘要與樹狀導航相關，而非與 token 溢位相關。

### 觸發條件

在 `navigateTree(...)` 期間：

1. 使用 `collectEntriesForBranchSummary(...)` 計算從舊葉節點到共同祖先的被放棄條目。
2. 如果呼叫者請求摘要（`options.summarize`），在切換葉節點前產生摘要。
3. 如果摘要存在，使用 `branchWithSummary(...)` 將其附加到導航目標。

在操作上，這通常由 `/tree` 流程在 `branchSummary.enabled` 啟用時驅動。

### 分支切換形態（視覺化）

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### 準備與 token 預算

`generateBranchSummary(...)` 計算預算為：

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` 接著：

1. 第一次遍歷：從所有摘要條目中收集累積的檔案操作，包括先前 pi 產生的 `branch_summary` 詳細資訊。
2. 第二次遍歷：從最新到最舊遍歷，新增訊息直到達到 token 預算。
3. 優先保留最近的上下文。
4. 為了連續性，可能仍會在預算邊緣包含大型摘要條目。

壓縮條目在分支摘要輸入期間作為訊息（`compactionSummary`）被包含。

### 摘要產生與持久化

分支摘要：

1. 轉換並序列化選定的訊息。
2. 包裹在 `<conversation>` 中。
3. 如有提供則使用自訂指示，否則使用 `branch-summary.md`。
4. 使用 `SUMMARIZATION_SYSTEM_PROMPT` 呼叫摘要模型。
5. 前置 `branch-summary-preamble.md`。
6. 附加檔案操作標籤。

結果儲存為 `BranchSummaryEntry`，帶有可選的詳細資訊（`readFiles`、`modifiedFiles`）。

## 擴充與鉤子接觸點

### `session_before_compact`

壓縮前鉤子。

可以：

- 取消壓縮（`{ cancel: true }`）
- 提供完整的自訂壓縮負載（`{ compaction: CompactionResult }`）

### `session.compacting`

預設壓縮的提示/上下文自訂鉤子。

可以回傳：

- `prompt`（覆寫基礎摘要提示）
- `context`（注入到 `<additional-context>` 的額外上下文行）
- `preserveData`（儲存在壓縮條目上）

### `session_compact`

壓縮後通知，包含已儲存的 `compactionEntry` 和 `fromExtension` 旗標。

### `session_before_tree`

在預設分支摘要產生之前的樹狀導航時執行。

可以：

- 取消導航
- 提供自訂的 `{ summary: { summary, details } }`，在使用者請求摘要時使用

### `session_tree`

導航後事件，公開新舊葉節點和可選的摘要條目。

## 執行時行為與失敗語義

- 手動壓縮會先中止當前代理操作。
- `abortCompaction()` 取消手動和自動壓縮控制器。
- 自動壓縮為 UI/狀態更新發出開始/結束會話事件。
- 自動壓縮可以嘗試多個候選模型並重試暫時性失敗。
- 溢位錯誤被排除在通用重試路徑之外，因為它們由壓縮處理。
- 如果自動壓縮失敗：
  - 溢位路徑發出 `Context overflow recovery failed: ...`
  - 閾值路徑發出 `Auto-compaction failed: ...`
- 分支摘要可以透過中止信號（例如 Escape）取消，回傳已取消/已中止的導航結果。

## 設定與預設值

來自 `settings-schema.ts`：

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

這些值在執行時由 `AgentSession` 以及壓縮/分支摘要模組使用。
