---
title: 會話儲存與條目模型
description: 僅追加的會話儲存模型，包含條目類型、持久化，以及格式間的遷移。
sidebar:
  order: 1
  label: 儲存與條目模型
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# 會話儲存與條目模型

本文件是 coding-agent 會話如何表示、持久化、遷移及在執行時重建的權威參考。

## 範圍

涵蓋：

- 會話 JSONL 格式與版本控制
- 條目分類與樹狀語意（`id`/`parentId` + 葉節點指標）
- 載入舊檔案或格式錯誤檔案時的遷移/相容性行為
- 上下文重建（`buildSessionContext`）
- 持久化保證、失敗行為、截斷/blob 外部化
- 儲存抽象層（`FileSessionStorage`、`MemorySessionStorage`）及相關工具

不涵蓋 `/tree` UI 渲染行為，除非涉及影響會話資料的語意。

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

`<cwd-encoded>` 從工作目錄衍生而來，去除前導斜線並將 `/`、`\\` 和 `:` 替換為 `-`。

Blob 儲存位置：

```text
~/.xcsh/agent/blobs/<sha256>
```

終端機麵包屑檔案寫入位置：

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

麵包屑內容為兩行：原始 cwd，然後是會話檔案路徑。`continueRecent()` 在掃描最近 mtime 之前，優先使用此終端機範圍的指標。

## 檔案格式

會話檔案為 JSONL：每行一個 JSON 物件。

- 第 1 行始終是會話標頭（`type: "session"`）。
- 其餘行為 `SessionEntry` 值。
- 條目在執行時僅追加；分支導航移動指標（`leafId`）而非修改現有條目。

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

注意事項：

- `version` 在 v1 檔案中為可選；缺少表示 v1。
- `parentSession` 是不透明的血統字串。目前的程式碼根據流程（`fork`、`forkFrom`、`createBranchedSession` 或明確的 `newSession({ parentSession })`）寫入會話 id 或會話路徑。視為中繼資料，而非具型別的外鍵。

### 條目基礎（`SessionEntryBase`）

所有非標頭條目包含：

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` 對於根條目可以為 `null`（首次追加，或在 `resetLeaf()` 之後）。

## 條目分類

`SessionEntry` 是以下型別的聯合型別：

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

`role` 為可選；在上下文重建中缺少時視為 `default`。

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

如果從根分支（`branchFromId === null`），`fromId` 為字面字串 `"root"`。

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

擴充功能提供的訊息，參與 LLM 上下文。

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

## 版本控制與遷移

目前會話版本：`3`。

### v1 -> v2

當標頭 `version` 缺少或 `< 2` 時套用：

- 為每個非標頭條目新增 `id` 和 `parentId`。
- 使用檔案順序重建線性父鏈。
- 當存在時，將壓縮欄位 `firstKeptEntryIndex` 遷移為 `firstKeptEntryId`。
- 設定標頭 `version = 2`。

### v2 -> v3

當標頭 `version < 3` 時套用：

- 對於 `message` 條目：將舊版 `message.role === "hookMessage"` 重寫為 `"custom"`。
- 設定標頭 `version = 3`。

### 遷移觸發與持久化

- 遷移在會話載入時執行（`setSessionFile`）。
- 如果執行了任何遷移，整個檔案會立即重寫到磁碟。
- 遷移先修改記憶體中的條目，然後持久化重寫的 JSONL。

## 載入與相容性行為

`loadEntriesFromFile(path)` 行為：

- 檔案不存在（`ENOENT`）-> 回傳 `[]`。
- 不可解析的行由寬鬆的 JSONL 解析器（`parseJsonlLenient`）處理。
- 如果第一個解析的條目不是有效的會話標頭（`type !== "session"` 或缺少字串 `id`）-> 回傳 `[]`。

`SessionManager.setSessionFile()` 行為：

- 載入器回傳 `[]` 時視為空的/不存在的會話，並在該路徑建立新的已初始化會話檔案。
- 有效檔案會被載入，如需要則進行遷移，解析 blob 參照，然後建立索引。

## 樹狀結構與葉節點語意

底層模型為僅追加樹 + 可變葉節點指標：

- 每個追加方法建立恰好一個新條目，其 `parentId` 為目前的 `leafId`。
- 新條目成為新的 `leafId`。
- `branch(entryId)` 僅移動 `leafId`；現有條目保持不變。
- `resetLeaf()` 設定 `leafId = null`；下一次追加建立新的根條目（`parentId: null`）。
- `branchWithSummary()` 將葉節點設定為分支目標並追加一個 `branch_summary` 條目。

`getEntries()` 按插入順序回傳所有非標頭條目。在正常操作中不刪除現有條目；重寫在更新表示的同時保留邏輯歷史（遷移、移動、目標重寫輔助方法）。

## 上下文重建（`buildSessionContext`）

`buildSessionContext(entries, leafId, byId?)` 解析要發送給模型的內容。

演算法：

1. 確定葉節點：
   - `leafId === null` -> 回傳空上下文。
   - 明確的 `leafId` -> 使用該條目（如果找到）。
   - 否則回退到最後一個條目。
2. 從葉節點沿 `parentId` 鏈走到根節點，然後反轉為根->葉路徑。
3. 在路徑上推導執行時狀態：
   - 從最新的 `thinking_level_change` 取得 `thinkingLevel`（預設為 `"off"`）
   - 從 `model_change` 條目取得模型對應（`role ?? "default"`）
   - 如果沒有明確的模型變更，從助手訊息的 provider/model 回退 `models.default`
   - 從所有 `ttsr_injection` 條目取得去重後的 `injectedTtsrRules`
   - 從最新的 `mode_change` 取得 mode/modeData（預設模式為 `"none"`）
4. 建構訊息列表：
   - `message` 條目直接傳遞
   - `custom_message` 條目透過 `createCustomMessage` 成為 `custom` AgentMessages
   - `branch_summary` 條目透過 `createBranchSummaryMessage` 成為 `branchSummary` AgentMessages
   - 如果路徑上存在 `compaction`：
     - 先發出壓縮摘要（`createCompactionSummaryMessage`）
     - 發出從 `firstKeptEntryId` 到壓縮邊界的路徑條目
     - 發出壓縮邊界之後的條目

`custom` 和 `session_init` 條目不直接注入模型上下文。

## 持久化保證與失敗模型

### 持久化 vs 記憶體

- `SessionManager.create/open/continueRecent/forkFrom` -> 持久化模式（`persist = true`）。
- `SessionManager.inMemory` -> 非持久化模式（`persist = false`），使用 `MemorySessionStorage`。

### 寫入管線

寫入透過內部 promise 鏈（`#persistChain`）和 `NdjsonFileWriter` 序列化。

- `append*` 立即更新記憶體中的狀態。
- 持久化延遲到至少存在一個助手訊息時。
  - 在第一個助手訊息之前：條目保留在記憶體中；不進行檔案追加。
  - 當第一個助手訊息存在時：將完整的記憶體會話刷新到檔案。
  - 之後：新條目以增量方式追加。

程式碼中的理由：避免持久化從未產生助手回應的會話。

### 持久性操作

- `flush()` 刷新寫入器並呼叫 `fsync()`。
- 原子性完整重寫（`#rewriteFile`）寫入暫存檔案，刷新+fsync，關閉，然後重新命名覆蓋目標。
- 用於遷移、`setSessionName`、`rewriteEntries`、移動操作及工具呼叫參數重寫。

### 錯誤行為

- 持久化錯誤會被鎖存（`#persistError`）並在後續操作中重新拋出。
- 第一個錯誤會連同會話檔案上下文記錄一次。
- 寫入器關閉為盡力而為，但會傳播第一個有意義的錯誤。

## 資料大小控制與 Blob 外部化

在持久化條目之前：

- 大型字串會截斷至 `MAX_PERSIST_CHARS`（500,000 字元），並附帶通知：
  - `"[Session persistence truncated large content]"`
- 暫態欄位 `partialJson` 和 `jsonlEvents` 會被移除。
- 如果物件同時具有 `content` 和 `lineCount`，行數會在截斷後重新計算。
- `content` 陣列中 base64 長度 >= 1024 的圖片區塊會被外部化為 blob 參照：
  - 儲存為 `blob:sha256:<hash>`
  - 原始位元組寫入 blob 儲存區（`BlobStore.put`）

載入時，blob 參照會被解析回 base64，用於 message/custom_message 圖片區塊。

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

- `getRecentSessions(sessionDir, limit)` -> 用於 UI/會話選取器的輕量中繼資料
- `findMostRecentSession(sessionDir)` -> 按 mtime 取最新
- `list(cwd, sessionDir?)` -> 單一專案範圍中的會話
- `listAll()` -> `~/.xcsh/agent/sessions` 下所有專案範圍的會話

中繼資料提取盡可能只讀取前綴（`readTextPrefix(..., 4096)`）。

## 相關但獨立的：提示詞歷史儲存

`HistoryStorage`（`history-storage.ts`）是用於提示詞回憶/搜尋的獨立 SQLite 子系統，而非會話重播。

- 資料庫：`~/.xcsh/agent/history.db`
- 資料表：`history(id, prompt, created_at, cwd)`
- FTS5 索引：`history_fts`，透過觸發器維護同步
- 使用記憶體中的上一筆提示詞快取，對連續相同的提示詞進行去重
- 非同步插入（`setImmediate`），使提示詞擷取不會阻塞回合執行

使用會話檔案進行對話圖/狀態重播；使用 `HistoryStorage` 進行提示詞歷史 UX。
