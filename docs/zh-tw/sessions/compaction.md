---
title: 壓縮與分支摘要
description: 長時間工作階段的上下文視窗壓縮與分支摘要生成。
sidebar:
  order: 5
  label: 壓縮
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# 壓縮與分支摘要

壓縮與分支摘要是讓長時間工作階段在不遺失先前工作上下文的情況下保持可用的兩種機制。

- **壓縮**將當前分支上的舊歷史記錄改寫為摘要。
- **分支摘要**在 `/tree` 導航期間捕捉被放棄的分支上下文。

兩者都以工作階段項目的形式持久化儲存，並在重建 LLM 輸入時轉換回使用者上下文訊息。

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

## 工作階段項目模型

壓縮與分支摘要是一等工作階段項目，而非純粹的 assistant/user 訊息。

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

1. 活動路徑上最新的壓縮項目會被轉換為一條 `compactionSummary` 訊息。
2. 從 `firstKeptEntryId` 到壓縮點之間保留的項目會被重新包含。
3. 路徑上後續的項目會被附加。
4. `branch_summary` 項目會被轉換為 `branchSummary` 訊息。
5. `custom_message` 項目會被轉換為 `custom` 訊息。

這些自訂角色隨後在 `convertToLlm()` 中使用靜態範本轉換為面向 LLM 的使用者訊息：

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## 壓縮管線

### 觸發條件

壓縮可以透過三種方式執行：

1. **手動**：`/compact [instructions]` 呼叫 `AgentSession.compact(...)`。
2. **自動溢位恢復**：在 assistant 錯誤符合上下文溢位條件之後。
3. **自動閾值壓縮**：在成功的回合中上下文超過閾值之後。

### 壓縮示意圖（視覺化）

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

### 溢位重試與閾值壓縮

兩種自動路徑在設計上有所不同：

- **溢位重試壓縮**
  - 觸發條件：當前模型的 assistant 錯誤被偵測為上下文溢位。
  - 失敗的 assistant 錯誤訊息在重試前會從活動代理狀態中移除。
  - 自動壓縮以 `reason: "overflow"` 和 `willRetry: true` 執行。
  - 成功後，代理會在壓縮後自動繼續（`agent.continue()`）。

- **閾值壓縮**
  - 觸發條件：`contextTokens > contextWindow - compaction.reserveTokens`。
  - 以 `reason: "threshold"` 和 `willRetry: false` 執行。
  - 成功後，如果 `compaction.autoContinue !== false`，會注入一個合成提示：
    - `"Continue if you have next steps."`

### 壓縮前修剪

在壓縮檢查之前，可能會執行工具結果修剪（`pruneToolOutputs`）。

預設修剪策略：

- 保護最新的 `40_000` 個工具輸出 token。
- 要求至少 `20_000` 個預估節省的 token 總量。
- 絕不修剪來自 `skill` 或 `read` 的工具結果。

被修剪的工具結果會被替換為：

- `[Output truncated - N tokens]`

如果修剪改變了項目，工作階段儲存會被重寫，且代理訊息狀態會在壓縮決策前被刷新。

### 邊界與切割點邏輯

`prepareCompaction()` 只考慮自上次壓縮項目（如果有的話）以來的項目。

1. 找到先前的壓縮索引。
2. 計算 `boundaryStart = prevCompactionIndex + 1`。
3. 在有可用的測量使用率時，使用該比率調整 `keepRecentTokens`。
4. 在邊界視窗上執行 `findCutPoint()`。

有效的切割點包括：

- 角色為以下的訊息項目：`user`、`assistant`、`bashExecution`、`hookMessage`、`branchSummary`、`compactionSummary`
- `custom_message` 項目
- `branch_summary` 項目

硬性規則：絕不在 `toolResult` 處切割。

如果切割點之前有非訊息的中繼資料項目（`model_change`、`thinking_level_change`、標籤等），它們會透過向後移動切割索引直到遇到訊息或壓縮邊界，被拉入保留區域。

### 分割回合處理

如果切割點不在使用者回合的起始位置，壓縮會將其視為分割回合。

回合起始偵測將以下視為使用者回合邊界：

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` 項目
- `branch_summary` 項目

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

### 摘要生成

`compact(...)` 從序列化的對話文字建構摘要：

1. 透過 `convertToLlm()` 轉換訊息。
2. 使用 `serializeConversation()` 序列化。
3. 包裝在 `<conversation>...</conversation>` 中。
4. 可選地包含 `<previous-summary>...</previous-summary>`。
5. 可選地以 `<additional-context>` 列表注入 hook 上下文。
6. 使用 `SUMMARIZATION_SYSTEM_PROMPT` 執行摘要提示。

提示選擇：

- 首次壓縮：`compaction-summary.md`
- 帶有先前摘要的迭代壓縮：`compaction-update-summary.md`
- 分割回合的第二次處理：`compaction-turn-prefix.md`
- 簡短 UI 摘要：`compaction-short-summary.md`

遠端摘要模式：

- 如果設定了 `compaction.remoteEndpoint`，壓縮會以 POST 發送：
  - `{ systemPrompt, prompt }`
- 預期回應的 JSON 至少包含 `{ summary }`。

### 摘要中的檔案操作上下文

壓縮使用 assistant 工具呼叫追蹤累積的檔案活動：

- `read(path)` → 讀取集合
- `write(path)` → 修改集合
- `edit(path)` → 修改集合

累積行為：

- 僅在先前項目是 pi 生成的（`fromExtension !== true`）時，才包含先前壓縮的詳細資訊。
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

在摘要生成（或 hook 提供的摘要）之後，代理工作階段：

1. 使用 `appendCompaction(...)` 附加 `CompactionEntry`。
2. 透過 `buildSessionContext()` 重建上下文。
3. 用重建的上下文替換即時代理訊息。
4. 發出 `session_compact` hook 事件。

## 分支摘要管線

分支摘要與樹狀導航相關，而非 token 溢位。

### 觸發條件

在 `navigateTree(...)` 期間：

1. 使用 `collectEntriesForBranchSummary(...)` 計算從舊葉節點到共同祖先的被放棄項目。
2. 如果呼叫者請求摘要（`options.summarize`），在切換葉節點前生成摘要。
3. 如果摘要存在，使用 `branchWithSummary(...)` 將其附加到導航目標。

在操作上，這通常由 `/tree` 流程在 `branchSummary.enabled` 啟用時驅動。

### 分支切換示意圖（視覺化）

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

1. 第一次遍歷：從所有摘要項目收集累積的檔案操作，包括先前 pi 生成的 `branch_summary` 詳細資訊。
2. 第二次遍歷：從最新到最舊遍歷，添加訊息直到達到 token 預算。
3. 優先保留最近的上下文。
4. 為了連續性，仍可能在預算邊緣包含較大的摘要項目。

壓縮項目在分支摘要輸入期間會作為訊息（`compactionSummary`）被包含。

### 摘要生成與持久化

分支摘要：

1. 轉換並序列化選定的訊息。
2. 包裝在 `<conversation>` 中。
3. 如果有提供自訂指示則使用，否則使用 `branch-summary.md`。
4. 使用 `SUMMARIZATION_SYSTEM_PROMPT` 呼叫摘要模型。
5. 前置 `branch-summary-preamble.md`。
6. 附加檔案操作標籤。

結果以 `BranchSummaryEntry` 儲存，帶有可選的詳細資訊（`readFiles`、`modifiedFiles`）。

## 擴充與 hook 接觸點

### `session_before_compact`

壓縮前 hook。

可以：

- 取消壓縮（`{ cancel: true }`）
- 提供完整的自訂壓縮酬載（`{ compaction: CompactionResult }`）

### `session.compacting`

預設壓縮的提示/上下文自訂 hook。

可以回傳：

- `prompt`（覆寫基礎摘要提示）
- `context`（注入 `<additional-context>` 的額外上下文行）
- `preserveData`（儲存在壓縮項目上）

### `session_compact`

壓縮後通知，包含已儲存的 `compactionEntry` 和 `fromExtension` 旗標。

### `session_before_tree`

在預設分支摘要生成前的樹狀導航時執行。

可以：

- 取消導航
- 提供自訂的 `{ summary: { summary, details } }`，在使用者請求摘要時使用

### `session_tree`

導航後事件，公開新/舊葉節點和可選的摘要項目。

## 執行時行為與失敗語意

- 手動壓縮會先中止當前的代理操作。
- `abortCompaction()` 取消手動和自動壓縮的控制器。
- 自動壓縮會發出開始/結束工作階段事件以供 UI/狀態更新。
- 自動壓縮可以嘗試多個候選模型並重試暫時性失敗。
- 溢位錯誤被排除在通用重試路徑之外，因為它們由壓縮處理。
- 如果自動壓縮失敗：
  - 溢位路徑發出 `Context overflow recovery failed: ...`
  - 閾值路徑發出 `Auto-compaction failed: ...`
- 分支摘要可以透過中止信號取消（例如 Escape），回傳已取消/已中止的導航結果。

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
