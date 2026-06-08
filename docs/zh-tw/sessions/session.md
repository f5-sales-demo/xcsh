---
title: 會話儲存與項目模型
description: >-
  Append-only session storage model with entry types, persistence, and migration
  between formats.
sidebar:
  order: 1
  label: 儲存與項目模型
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# 會話儲存與項目模型

本文件是程式碼代理會話如何表示、持久化、遷移及在執行時重建的權威來源。

## 範圍

涵蓋內容：

- 會話 JSONL 格式與版本管理
- 項目分類與樹狀語義（`id`/`parentId` + 葉節點指標）
- 載入舊版或格式錯誤檔案時的遷移/相容性行為
- 上下文重建（`buildSessionContext`）
- 持久化保證、失敗行為、截斷/blob 外部化
- 儲存抽象層（`FileSessionStorage`、`MemorySessionStorage`）及相關工具

不涵蓋 `/tree` UI 渲染行為，除非涉及影響會話資料的語義。

## 實作檔案

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## 磁碟佈局

預設會話檔案位置：

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` 由工作目錄衍生而來，方式是移除前導斜線並將 `/`、`\\` 和 `:` 替換為 `-`。

Blob 儲存位置：

```text
~/.xcsh/agent/blobs/<sha256>
```

終端機麵包屑檔案寫入位置：

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

麵包屑內容為兩行：原始工作目錄，然後是會話檔案路徑。`continueRecent()` 會優先使用此終端機範圍的指標，之後才掃描最近修改時間。

## 檔案格式

會話檔案為 JSONL 格式：每行一個 JSON 物件。

- 第 1 行始終為會話標頭（`type: "session"`）。
- 其餘行為 `SessionEntry` 值。
- 項目在執行時僅追加；分支導航移動指標（`leafId`）而非修改既有項目。

### 標頭（`SessionHeader`）

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

備註：

- `version` 在 v1 檔案中為可選；缺少表示 v1。
- `parentSession` 是不透明的譜系字串。目前的程式碼依據流程（`fork`、`forkFrom`、`createBranchedSession` 或明確的 `newSession({ parentSession })`）寫入會話 id 或會話路徑。視為中繼資料，而非具型別的外鍵。

### 項目基底（`SessionEntryBase`）

所有非標頭項目包含：

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` 對於根項目可為 `null`（首次追加，或在 `resetLeaf()` 之後）。

## 項目分類

`SessionEntry` 是以下類型的聯合型別：

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

直接儲存 `AgentMessage`。

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` 為可選；缺少時在上下文重建中視為 `default`。

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

若從根節點分支（`branchFromId === null`），`fromId` 為字面字串 `"root"`。

### `custom`

擴充功能狀態持久化；被 `buildSessionContext` 忽略。

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

擴充功能提供的訊息，會參與 LLM 上下文。

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` 會清除 `targetId` 的標籤。

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## 版本管理與遷移

目前會話版本：`3`。

### v1 -> v2

當標頭 `version` 缺少或 `< 2` 時套用：

- 為每個非標頭項目新增 `id` 和 `parentId`。
- 使用檔案順序重建線性父鏈。
- 當存在時將壓縮欄位 `firstKeptEntryIndex` 遷移為 `firstKeptEntryId`。
- 設定標頭 `version = 2`。

### v2 -> v3

當標頭 `version < 3` 時套用：

- 對於 `message` 項目：將舊版 `message.role === "hookMessage"` 重寫為 `"custom"`。
- 設定標頭 `version = 3`。

### 遷移觸發與持久化

- 遷移在會話載入時執行（`setSessionFile`）。
- 若執行了任何遷移，整個檔案會立即重寫至磁碟。
- 遷移先修改記憶體中的項目，然後持久化重寫的 JSONL。

## 載入與相容性行為

`loadEntriesFromFile(path)` 行為：

- 檔案不存在（`ENOENT`）-> 回傳 `[]`。
- 無法解析的行由寬容的 JSONL 解析器（`parseJsonlLenient`）處理。
- 若第一個已解析的項目不是有效的會話標頭（`type !== "session"` 或缺少字串 `id`）-> 回傳 `[]`。

`SessionManager.setSessionFile()` 行為：

- 從載入器取得的 `[]` 視為空/不存在的會話，並在該路徑以新的已初始化會話檔案取代。
- 有效檔案會被載入、必要時遷移、解析 blob 參考，然後建立索引。

## 樹狀結構與葉節點語義

底層模型為僅追加樹狀結構 + 可變葉節點指標：

- 每個追加方法恰好建立一個新項目，其 `parentId` 為目前的 `leafId`。
- 新項目成為新的 `leafId`。
- `branch(entryId)` 僅移動 `leafId`；既有項目保持不變。
- `resetLeaf()` 設定 `leafId = null`；下次追加建立新的根項目（`parentId: null`）。
- `branchWithSummary()` 設定葉節點至分支目標並追加 `branch_summary` 項目。

`getEntries()` 以插入順序回傳所有非標頭項目。在正常操作中不會刪除既有項目；重寫在更新表示方式的同時保留邏輯歷史（遷移、移動、目標化重寫輔助程式）。

## 上下文重建（`buildSessionContext`）

`buildSessionContext(entries, leafId, byId?)` 解析要傳送給模型的內容。

演算法：

1. 確定葉節點：
   - `leafId === null` -> 回傳空上下文。
   - 明確的 `leafId` -> 使用該項目（若找到）。
   - 否則退回至最後一個項目。
2. 從葉節點沿 `parentId` 鏈走到根節點，然後反轉為根->葉路徑。
3. 沿路徑推導執行時狀態：
   - `thinkingLevel` 來自最新的 `thinking_level_change`（預設 `"off"`）
   - 模型對映來自 `model_change` 項目（`role ?? "default"`）
   - 若無明確的模型變更，退回 `models.default` 從助理訊息的 provider/model 取得
   - 從所有 `ttsr_injection` 項目取得去重的 `injectedTtsrRules`
   - 模式/modeData 來自最新的 `mode_change`（預設模式 `"none"`）
4. 建立訊息列表：
   - `message` 項目直接傳遞
   - `custom_message` 項目透過 `createCustomMessage` 成為 `custom` AgentMessages
   - `branch_summary` 項目透過 `createBranchSummaryMessage` 成為 `branchSummary` AgentMessages
   - 若路徑上存在 `compaction`：
     - 先發出壓縮摘要（`createCompactionSummaryMessage`）
     - 發出從 `firstKeptEntryId` 到壓縮邊界的路徑項目
     - 發出壓縮邊界之後的項目

`custom` 和 `session_init` 項目不直接注入模型上下文。

## 持久化保證與失敗模型

### 持久化 vs 記憶體模式

- `SessionManager.create/open/continueRecent/forkFrom` -> 持久化模式（`persist = true`）。
- `SessionManager.inMemory` -> 非持久化模式（`persist = false`），使用 `MemorySessionStorage`。

### 寫入管線

寫入透過內部 promise 鏈（`#persistChain`）和 `NdjsonFileWriter` 序列化。

- `append*` 立即更新記憶體狀態。
- 持久化延遲到至少存在一個助理訊息時才進行。
  - 第一個助理訊息之前：項目保留在記憶體中；不進行檔案追加。
  - 當第一個助理訊息存在時：完整的記憶體會話被刷新至檔案。
  - 之後：新項目以增量方式追加。

程式碼中的理由：避免持久化從未產生助理回應的會話。

### 持久性操作

- `flush()` 刷新寫入器並呼叫 `fsync()`。
- 原子性完整重寫（`#rewriteFile`）寫入暫存檔案，刷新+fsync，關閉，然後重新命名覆蓋目標。
- 用於遷移、`setSessionName`、`rewriteEntries`、移動操作及工具呼叫參數重寫。

### 錯誤行為

- 持久化錯誤會被鎖定（`#persistError`）並在後續操作中重新拋出。
- 第一個錯誤會連同會話檔案上下文記錄一次。
- 寫入器關閉為盡力嘗試，但會傳播第一個有意義的錯誤。

## 資料大小控制與 Blob 外部化

在持久化項目之前：

- 大型字串會截斷至 `MAX_PERSIST_CHARS`（500,000 字元）並附帶通知：
  - `"[Session persistence truncated large content]"`
- 暫態欄位 `partialJson` 和 `jsonlEvents` 會被移除。
- 若物件同時具有 `content` 和 `lineCount`，行數會在截斷後重新計算。
- `content` 陣列中 base64 長度 >= 1024 的影像區塊會外部化為 blob 參考：
  - 儲存為 `blob:sha256:<hash>`
  - 原始位元組寫入 blob 儲存（`BlobStore.put`）

載入時，blob 參考會為 message/custom_message 影像區塊解析回 base64。

## 儲存抽象層

`SessionStorage` 介面提供 `SessionManager` 使用的所有檔案系統操作：

- 同步：`ensureDirSync`、`existsSync`、`writeTextSync`、`statSync`、`listFilesSync`
- 非同步：`exists`、`readText`、`readTextPrefix`、`writeText`、`rename`、`unlink`、`openWriter`

實作：

- `FileSessionStorage`：真實檔案系統（Bun + node fs）
- `MemorySessionStorage`：基於 map 的記憶體實作，用於測試/非持久化會話

`SessionStorageWriter` 公開 `writeLine`、`flush`、`fsync`、`close`、`getError`。

## 會話探索工具

定義在 `session-manager.ts` 中：

- `getRecentSessions(sessionDir, limit)` -> 用於 UI/會話選擇器的輕量中繼資料
- `findMostRecentSession(sessionDir)` -> 依修改時間最新者
- `list(cwd, sessionDir?)` -> 單一專案範圍內的會話
- `listAll()` -> `~/.xcsh/agent/sessions` 下所有專案範圍的會話

中繼資料擷取盡可能僅讀取前綴（`readTextPrefix(..., 4096)`）。

## 相關但獨立的：提示歷史儲存

`HistoryStorage`（`history-storage.ts`）是獨立的 SQLite 子系統，用於提示回憶/搜尋，而非會話重播。

- 資料庫：`~/.xcsh/agent/history.db`
- 資料表：`history(id, prompt, created_at, cwd)`
- FTS5 索引：`history_fts`，透過觸發器維護同步
- 使用記憶體中的最後提示快取來去重連續相同的提示
- 非同步插入（`setImmediate`），使提示捕獲不會阻塞回合執行

使用會話檔案進行對話圖/狀態重播；使用 `HistoryStorage` 進行提示歷史使用者體驗。
