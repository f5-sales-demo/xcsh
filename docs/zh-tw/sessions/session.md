---
title: 工作階段儲存與條目模型
description: Append-only 工作階段儲存模型，涵蓋條目類型、持久化，以及格式間的遷移。
sidebar:
  order: 1
  label: 儲存與條目模型
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# 工作階段儲存與條目模型

本文件是程式編碼代理工作階段如何表示、持久化、遷移及在執行時重建的權威來源。

## 範圍

涵蓋：

- 工作階段 JSONL 格式與版本管理
- 條目分類與樹狀語義（`id`/`parentId` + 葉節點指標）
- 載入舊檔案或格式異常檔案時的遷移/相容性行為
- 上下文重建（`buildSessionContext`）
- 持久化保證、失敗行為、截斷/Blob 外部化
- 儲存抽象層（`FileSessionStorage`、`MemorySessionStorage`）及相關工具程式

不涵蓋 `/tree` UI 渲染行為，除了影響工作階段資料的語義之外。

## 實作檔案

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## 磁碟上的檔案配置

預設工作階段檔案位置：

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` 由工作目錄衍生而來，方式為去除前導斜線並將 `/`、`\\` 和 `:` 替換為 `-`。

Blob 儲存位置：

```text
~/.xcsh/agent/blobs/<sha256>
```

終端機 breadcrumb 檔案寫入位置：

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

Breadcrumb 內容為兩行：原始工作目錄（cwd），然後是工作階段檔案路徑。`continueRecent()` 會優先使用此終端機範圍的指標，然後才掃描最近修改時間（mtime）。

## 檔案格式

工作階段檔案為 JSONL 格式：每行一個 JSON 物件。

- 第 1 行始終為工作階段標頭（`type: "session"`）。
- 其餘行為 `SessionEntry` 值。
- 條目在執行時為 append-only；分支導航移動指標（`leafId`）而非修改既有條目。

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

- `version` 在 v1 檔案中為選填；缺少時表示 v1。
- `parentSession` 為不透明的血統字串。目前程式碼根據不同流程（`fork`、`forkFrom`、`createBranchedSession` 或明確的 `newSession({ parentSession })`）寫入工作階段 id 或工作階段路徑。請視為中繼資料，非型別化的外鍵。

### 條目基底（`SessionEntryBase`）

所有非標頭條目都包含：

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` 對於根條目可以為 `null`（首次追加，或 `resetLeaf()` 之後）。

## 條目分類

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

直接儲存一個 `AgentMessage`。

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

`role` 為選填；在上下文重建中缺少時視為 `default`。

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

如果從根節點分支（`branchFromId === null`），`fromId` 為字面字串 `"root"`。

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

由擴充功能提供的訊息，會參與 LLM 上下文。

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

目前工作階段版本：`3`。

### v1 -> v2

當標頭 `version` 缺少或 `< 2` 時套用：

- 為每個非標頭條目新增 `id` 和 `parentId`。
- 使用檔案順序重建線性父鏈。
- 當存在時，遷移壓縮欄位 `firstKeptEntryIndex` -> `firstKeptEntryId`。
- 設定標頭 `version = 2`。

### v2 -> v3

當標頭 `version < 3` 時套用：

- 對於 `message` 條目：將舊版 `message.role === "hookMessage"` 重寫為 `"custom"`。
- 設定標頭 `version = 3`。

### 遷移觸發與持久化

- 遷移在工作階段載入時執行（`setSessionFile`）。
- 如果有任何遷移執行過，整個檔案會立即重寫至磁碟。
- 遷移先修改記憶體中的條目，然後持久化重寫的 JSONL。

## 載入與相容性行為

`loadEntriesFromFile(path)` 行為：

- 檔案不存在（`ENOENT`）-> 回傳 `[]`。
- 無法解析的行由寬鬆的 JSONL 解析器（`parseJsonlLenient`）處理。
- 如果第一個解析的條目不是有效的工作階段標頭（`type !== "session"` 或缺少字串 `id`）-> 回傳 `[]`。

`SessionManager.setSessionFile()` 行為：

- 從載入器取得 `[]` 時視為空的/不存在的工作階段，並在該路徑以新初始化的工作階段檔案替代。
- 有效檔案會被載入，如需要則進行遷移，解析 blob 參照，然後建立索引。

## 樹狀結構與葉節點語義

底層模型是 append-only 樹狀結構 + 可變葉節點指標：

- 每個追加方法僅建立一個新條目，其 `parentId` 為目前的 `leafId`。
- 新條目成為新的 `leafId`。
- `branch(entryId)` 僅移動 `leafId`；既有條目保持不變。
- `resetLeaf()` 設定 `leafId = null`；下一次追加會建立新的根條目（`parentId: null`）。
- `branchWithSummary()` 將葉節點設定為分支目標並追加一個 `branch_summary` 條目。

`getEntries()` 以插入順序回傳所有非標頭條目。正常操作中不會刪除既有條目；重寫在更新表示（遷移、移動、目標式重寫輔助程式）的同時保留邏輯歷史。

## 上下文重建（`buildSessionContext`）

`buildSessionContext(entries, leafId, byId?)` 解析要傳送給模型的內容。

演算法：

1. 決定葉節點：
   - `leafId === null` -> 回傳空上下文。
   - 明確的 `leafId` -> 若找到則使用該條目。
   - 否則回退至最後一個條目。
2. 從葉節點沿 `parentId` 鏈走訪至根節點，然後反轉為根到葉的路徑。
3. 沿路徑推導執行時狀態：
   - `thinkingLevel` 來自最新的 `thinking_level_change`（預設 `"off"`）
   - 模型對應表來自 `model_change` 條目（`role ?? "default"`）
   - 若無明確的模型變更，`models.default` 回退自助理訊息的 provider/model
   - 從所有 `ttsr_injection` 條目取得去重的 `injectedTtsrRules`
   - mode/modeData 來自最新的 `mode_change`（預設模式 `"none"`）
4. 建構訊息列表：
   - `message` 條目直接傳遞
   - `custom_message` 條目透過 `createCustomMessage` 轉為 `custom` AgentMessages
   - `branch_summary` 條目透過 `createBranchSummaryMessage` 轉為 `branchSummary` AgentMessages
   - 若路徑上存在 `compaction`：
     - 先發出壓縮摘要（`createCompactionSummaryMessage`）
     - 發出從 `firstKeptEntryId` 到壓縮邊界的路徑條目
     - 發出壓縮邊界之後的條目

`custom` 和 `session_init` 條目不會直接注入模型上下文。

## 持久化保證與失敗模型

### 持久化 vs 記憶體

- `SessionManager.create/open/continueRecent/forkFrom` -> 持久化模式（`persist = true`）。
- `SessionManager.inMemory` -> 非持久化模式（`persist = false`），使用 `MemorySessionStorage`。

### 寫入管線

寫入透過內部 promise 鏈（`#persistChain`）和 `NdjsonFileWriter` 序列化。

- `append*` 立即更新記憶體狀態。
- 持久化會延遲到至少有一則助理訊息存在時才執行。
  - 在第一則助理訊息之前：條目保留在記憶體中；不進行檔案追加。
  - 當第一則助理訊息存在時：完整的記憶體內工作階段刷新至檔案。
  - 之後：新條目以增量方式追加。

程式碼中的理由：避免持久化從未產生助理回應的工作階段。

### 持久性操作

- `flush()` 刷新寫入器並呼叫 `fsync()`。
- 原子性完整重寫（`#rewriteFile`）先寫入暫存檔、flush+fsync、關閉，然後重新命名覆蓋目標檔案。
- 用於遷移、`setSessionName`、`rewriteEntries`、移動操作及工具呼叫引數重寫。

### 錯誤行為

- 持久化錯誤會被鎖存（`#persistError`）並在後續操作時重新拋出。
- 首次錯誤會連同工作階段檔案上下文記錄一次。
- 寫入器關閉為盡力嘗試，但會傳播第一個有意義的錯誤。

## 資料大小控制與 Blob 外部化

在持久化條目之前：

- 大型字串會截斷至 `MAX_PERSIST_CHARS`（500,000 字元）並附帶通知：
  - `"[Session persistence truncated large content]"`
- 暫態欄位 `partialJson` 和 `jsonlEvents` 會被移除。
- 若物件同時具有 `content` 和 `lineCount`，截斷後會重新計算行數。
- `content` 陣列中 base64 長度 >= 1024 的圖片區塊會外部化為 blob 參照：
  - 儲存為 `blob:sha256:<hash>`
  - 原始位元組寫入 blob 儲存（`BlobStore.put`）

載入時，blob 參照會被解析回 base64，用於 message/custom_message 的圖片區塊。

## 儲存抽象層

`SessionStorage` 介面提供 `SessionManager` 使用的所有檔案系統操作：

- 同步：`ensureDirSync`、`existsSync`、`writeTextSync`、`statSync`、`listFilesSync`
- 非同步：`exists`、`readText`、`readTextPrefix`、`writeText`、`rename`、`unlink`、`openWriter`

實作：

- `FileSessionStorage`：真實檔案系統（Bun + node fs）
- `MemorySessionStorage`：以 map 為後端的記憶體內實作，用於測試/非持久化工作階段

`SessionStorageWriter` 公開 `writeLine`、`flush`、`fsync`、`close`、`getError`。

## 工作階段探索工具程式

定義於 `session-manager.ts`：

- `getRecentSessions(sessionDir, limit)` -> 為 UI/工作階段選擇器提供的輕量中繼資料
- `findMostRecentSession(sessionDir)` -> 依 mtime 排序的最新工作階段
- `list(cwd, sessionDir?)` -> 單一專案範圍內的工作階段
- `listAll()` -> `~/.xcsh/agent/sessions` 下所有專案範圍的工作階段

中繼資料擷取盡可能只讀取前綴（`readTextPrefix(..., 4096)`）。

## 相關但獨立的功能：提示歷史儲存

`HistoryStorage`（`history-storage.ts`）是一個獨立的 SQLite 子系統，用於提示回顧/搜尋，而非工作階段重播。

- 資料庫：`~/.xcsh/agent/history.db`
- 資料表：`history(id, prompt, created_at, cwd)`
- FTS5 索引：`history_fts`，透過觸發器維護同步
- 使用記憶體內的最後提示快取來去除連續相同的提示
- 非同步插入（`setImmediate`），使提示擷取不會阻塞回合執行

使用工作階段檔案進行對話圖/狀態重播；使用 `HistoryStorage` 提供提示歷史使用者體驗。
