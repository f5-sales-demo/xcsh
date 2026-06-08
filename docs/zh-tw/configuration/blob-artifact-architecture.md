---
title: Blob 與 Artifact 儲存架構
description: 內容定址的 blob 儲存與 artifact 註冊表，用於會話媒體、螢幕截圖和工具輸出。
sidebar:
  order: 7
  label: Blob 與 artifact 儲存
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob 與 artifact 儲存架構

本文件描述 coding-agent 如何將大型/二進位資料儲存在會話 JSONL 之外、截斷的工具輸出如何被持久化，以及內部 URL（`artifact://`、`agent://`）如何解析回已儲存的資料。

## 為何存在兩種儲存系統

執行環境針對不同的資料形態使用兩種不同的持久化機制：

- **內容定址的 blob**（`blob:sha256:<hash>`）：全域、二進位導向的儲存，用於將大型 image base64 資料從持久化的會話條目中外部化。
- **會話範圍的 artifact**（`<sessionFile-without-.jsonl>/` 目錄下的檔案）：每個會話的文字檔案，用於完整的工具輸出和子代理輸出。

它們是刻意分離的：

- blob 儲存透過內容雜湊來最佳化去重複和穩定引用，
- artifact 儲存透過本地 ID 來最佳化僅附加的會話工具和人工/工具檢索。

## 儲存邊界與磁碟布局

## Blob 儲存邊界（全域）

`SessionManager` 建構 `BlobStore(getBlobsDir())`，因此 blob 檔案存放在共享的全域 blob 目錄中（不在會話資料夾內）。

Blob 檔案命名：

- 檔案路徑：`<blobsDir>/<sha256-hex>`
- 無副檔名
- 條目中儲存的引用字串：`blob:sha256:<sha256-hex>`

影響：

- 跨會話的相同二進位內容會解析到相同的雜湊/路徑，
- 在內容層級上寫入是冪等的，
- blob 可以比任何單一會話檔案存活更久。

## Artifact 邊界（會話本地）

`ArtifactManager` 從會話檔案路徑衍生 artifact 目錄：

- 會話檔案：`.../<timestamp>_<sessionId>.jsonl`
- artifact 目錄：`.../<timestamp>_<sessionId>/`（去除 `.jsonl`）

Artifact 類型共享此目錄：

- 截斷的工具輸出檔案：`<numericId>.<toolType>.log`（對應 `artifact://`）
- 子代理輸出檔案：`<outputId>.md`（對應 `agent://`）

## ID 與名稱分配方案

## Blob ID：內容雜湊

`BlobStore.put()` 對原始二進位位元組計算 SHA-256 並回傳：

- `hash`：十六進位摘要，
- `path`：`<blobsDir>/<hash>`，
- `ref`：`blob:sha256:<hash>`。

不使用會話本地計數器。

## Artifact ID：會話本地單調遞增整數

`ArtifactManager` 在首次使用時掃描現有的 `*.log` artifact 檔案，找到最大的現有數字 ID 並設定 `nextId = max + 1`。

分配行為：

- 檔案格式：`{id}.{toolType}.log`
- ID 是連續字串（`"0"`、`"1"`、...）
- 恢復時不會覆寫現有 artifact，因為掃描發生在分配之前。

如果 artifact 目錄不存在，掃描會產生空列表，分配從 `0` 開始。

## 代理輸出 ID（`agent://`）

`AgentOutputManager` 為子代理輸出分配 ID，格式為 `<index>-<requestedId>`（可選擇性地巢狀在父級前綴之下，例如 `0-Parent.1-Child`）。它在初始化時掃描現有的 `.md` 檔案，以便在恢復時從下一個索引繼續。

## 持久化資料流

## 1) 會話條目持久化重寫路徑

在會話條目寫入之前（`#rewriteFile` / 增量持久化），`SessionManager` 呼叫 `prepareEntryForPersistence()`（透過 `truncateForPersistence`）。

關鍵行為：

1. **大型字串截斷**：過大的字串會被截斷並附加 `"[Session persistence truncated large content]"` 後綴。
2. **暫時性欄位剝離**：`partialJson` 和 `jsonlEvents` 從持久化條目中移除。
3. **圖片外部化至 blob**：
   - 僅適用於 `content` 陣列中的圖片區塊，
   - 僅當 `data` 尚未是 blob 引用時，
   - 僅當 base64 長度至少達到閾值時（`BLOB_EXTERNALIZE_THRESHOLD = 1024`），
   - 將行內 base64 替換為 `blob:sha256:<hash>`。

這使會話 JSONL 保持精簡，同時保留可恢復性。

## 2) 會話載入重新水合路徑

開啟會話時（`setSessionFile`），在遷移之後，`SessionManager` 執行 `resolveBlobRefsInEntries()`。

對於每個含有 `blob:sha256:<hash>` 的 message/custom-message 圖片區塊：

- 從 blob 儲存讀取 blob 位元組，
- 將位元組轉換回 base64，
- 修改記憶體中的條目以內嵌 base64 供執行時期消費者使用。

如果 blob 遺失：

- `resolveImageData()` 記錄警告，
- 回傳原始引用字串不變，
- 載入繼續（不會硬性崩潰）。

## 3) 工具輸出溢出/截斷路徑

`OutputSink` 驅動 bash/python/ssh 及相關執行器中的串流輸出。

行為：

1. 每個區塊都被清理並附加到記憶體中的尾部緩衝區。
2. 當記憶體中的位元組超過溢出閾值（`DEFAULT_MAX_BYTES`，50KB）時，sink 標記輸出為已截斷。
3. 如果有可用的 artifact 路徑，sink 會開啟檔案寫入器並寫入：
   - 現有的緩衝內容（一次），
   - 所有後續的區塊。
4. 記憶體緩衝區始終被修剪為尾部窗口以供顯示。
5. `dump()` 僅在檔案 sink 成功建立時回傳包含 `artifactId` 的摘要。

實際效果：

- UI/工具回傳顯示截斷的尾部，
- 完整輸出保存在 artifact 檔案中並以 `artifact://<id>` 引用。

如果檔案 sink 建立失敗（I/O 錯誤、路徑遺失等），sink 會靜默退回至僅記憶體截斷；完整輸出不會被持久化。

## URL 存取模型

## `blob:` 引用

`blob:sha256:<hash>` 是持久化的會話條目資料中的持久化引用，不是由路由器處理的內部 URL 方案。解析由 `SessionManager` 在會話載入期間完成。

## `artifact://<id>`

由 `ArtifactProtocolHandler` 處理：

- 需要活躍的會話 artifact 目錄，
- ID 必須是數字，
- 透過匹配檔名前綴 `<id>.` 進行解析，
- 從匹配的 `.log` 檔案回傳原始文字（`text/plain`），
- 遺失時，錯誤訊息包含可用 artifact ID 列表。

目錄遺失行為：

- 如果 artifact 目錄不存在，拋出 `No artifacts directory found`。

## `agent://<id>`

由 `AgentProtocolHandler` 處理，對應 `<artifactsDir>/<id>.md`：

- 純粹形式回傳 markdown 文字，
- `/path` 或 `?q=` 形式執行 JSON 提取，
- 路徑和查詢提取不能組合使用，
- 如果請求提取，檔案內容必須可解析為 JSON。

目錄遺失行為：

- 拋出 `No artifacts directory found`。

輸出遺失行為：

- 拋出 `Not found: <id>` 並列出現有 `.md` 檔案中的可用 ID。

讀取工具整合：

- `read` 支援非提取內部 URL 讀取的 offset/limit 分頁，
- 當使用 `agent://` 提取時拒絕 `offset/limit`。

## 恢復、分支與搬移語義

## 恢復

- `ArtifactManager` 在首次分配時掃描現有的 `{id}.*.log` 檔案並繼續編號。
- `AgentOutputManager` 掃描現有的 `.md` 輸出 ID 並繼續編號。
- `SessionManager` 在載入時將 blob 引用重新水合為 base64。

## 分支

`SessionManager.fork()` 建立一個帶有新會話 ID 和 `parentSession` 連結的新會話檔案，然後回傳舊/新檔案路徑。Artifact 複製由 `AgentSession.fork()` 處理：

- 嘗試將舊 artifact 目錄遞迴複製到新 artifact 目錄，
- 容忍舊目錄不存在的情況，
- 非 ENOENT 的複製錯誤記錄為警告，分支仍然完成。

分支後的 ID 影響：

- 如果複製成功，新會話中的 artifact 計數器從已複製的最大 ID 之後繼續，
- 如果複製失敗/跳過，新會話的 artifact ID 從 `0` 開始。

分支後的 blob 影響：

- blob 是全域且內容定址的，因此不需要複製 blob 目錄。

## 搬移至新的 cwd

`SessionManager.moveTo()` 將會話檔案和 artifact 目錄重新命名到新的預設會話目錄，如果後續步驟失敗則有回滾邏輯。這在重新定位會話範圍的同時保留了 artifact 身分。

## 失敗處理與退回路徑

| 情境 | 行為 |
| --- | --- |
| 重新水合期間 blob 檔案遺失 | 警告並保留記憶體中的 `blob:sha256:` 引用字串 |
| 透過 `BlobStore.get` 讀取 blob 時 ENOENT | 回傳 `null` |
| Artifact 目錄遺失（`ArtifactManager.listFiles`） | 回傳空列表（分配可以重新開始） |
| Artifact 目錄遺失（`artifact://` / `agent://`） | 拋出明確的 `No artifacts directory found` |
| Artifact ID 未找到 | 拋出錯誤並列出可用 ID |
| OutputSink artifact 寫入器初始化失敗 | 繼續僅尾部截斷（無完整輸出 artifact） |
| 無會話檔案（某些任務路徑） | 任務工具退回至暫存 artifact 目錄用於子代理輸出 |

## 二進位 blob 外部化 vs 文字輸出 artifact

- **Blob 外部化**用於持久化會話條目內容中的二進位圖片資料；它將 JSONL 中的行內 base64 替換為穩定的內容引用。
- **Artifact** 是用於執行輸出和子代理輸出的純文字檔案；它們透過會話本地 ID 經由內部 URL 進行定址。

這兩個系統僅間接交集（都減少會話 JSONL 的膨脹），但具有不同的身分、生命週期和檢索路徑。

## 實作檔案

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — blob 引用格式、雜湊、put/get、外部化/解析輔助函式。
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — 會話 artifact 目錄模型和數字 artifact ID 分配。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 截斷/溢出至檔案行為和摘要中繼資料。
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — 持久化轉換、載入時的 blob 重新水合、會話分支/搬移互動。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 互動式分支期間的 artifact 目錄複製。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 工具 artifact 管理器啟動和每工具 artifact 路徑分配。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` 解析器。
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` 解析器 + JSON 提取。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 內部 URL 路由器接線和 artifact 目錄解析器。
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — `agent://` 的會話範圍代理輸出 ID 分配。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 子代理輸出 artifact 寫入（`<id>.md`）和暫存 artifact 目錄退回。
