---
title: Notebook 工具執行環境內部機制
description: Jupyter notebook 工具執行環境，包含儲存格執行、核心生命週期與輸出渲染。
sidebar:
  order: 2
  label: Notebook 工具
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Notebook 工具執行環境內部機制

本文件描述目前 `notebook` 工具的實作方式，以及它與核心支援的 Python 執行環境之間的關係。

關鍵區別：**`notebook` 是一個 JSON notebook 編輯器，而非 notebook 執行器**。它直接編輯 `.ipynb` 儲存格來源；它不會啟動 Python 核心，也不會與之通訊。

## 實作檔案

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) 執行環境邊界：編輯 vs 執行

## `notebook` 工具 (`src/tools/notebook.ts`)

- 支援對 `.ipynb` 檔案進行 `action: edit | insert | delete` 操作。
- 相對於工作階段 CWD 解析路徑（`resolveToCwd`）。
- 載入 notebook JSON，驗證 `cells` 陣列，驗證 `cell_index` 邊界。
- 在記憶體中套用來源編輯，並以 `JSON.stringify(notebook, null, 1)` 將完整 notebook JSON 寫回。
- 回傳文字摘要 + 結構化 `details`（`action`、`cellIndex`、`cellType`、`totalCells`、`cellSource`）。

此工具中不存在核心生命週期：

- 無閘道器取得
- 無核心工作階段 ID
- 無 `execute_request`
- 無來自核心通道的串流區塊
- 無豐富顯示擷取（`image/png`、JSON 顯示、狀態 MIME）

## 類 Notebook 執行路徑 (`src/tools/python.ts` + `src/ipy/*`)

當代理程式需要執行儲存格風格的 Python 程式碼（循序儲存格、持久狀態、豐富顯示）時，會透過 **`python` 工具**而非 `notebook`。

該路徑是核心模式、重啟/取消行為、區塊串流及輸出產物截斷所在之處。

## 2) Notebook 儲存格處理語義（`notebook` 工具）

## 來源正規化

`content` 被分割成帶有換行符保留的 `source: string[]`：

- 每個非最終行保留尾隨 `\n`
- 最終行不強制添加尾隨換行符

這符合 notebook JSON 慣例，避免後續編輯時意外的行連接。

## 操作行為

- `edit`
  - 替換 `cells[cell_index].source`
  - 保留現有 `cell_type`
- `insert`
  - 在 `[0..cellCount]` 位置插入
  - `cell_type` 預設為 `code`
  - 程式碼儲存格初始化 `execution_count: null` 和 `outputs: []`
  - markdown 儲存格僅初始化 `metadata` + `source`
- `delete`
  - 移除 `cells[cell_index]`
  - 在 details 中回傳已移除的 `source` 以供渲染器預覽

## 錯誤表面

以下情況會拋出硬性失敗：

- 缺少 notebook 檔案
- 無效 JSON
- 缺少或非陣列的 `cells`
- 超出範圍的索引（插入和非插入有不同的有效範圍）
- `edit`/`insert` 缺少 `content`

這些會成為上游的 `Error:` 工具回應；渲染器使用 notebook 路徑 + 格式化的錯誤文字。

## 3) 核心工作階段語義（實際存在之處）

核心語義實作在 `executePython` / `PythonKernel` 中，適用於 `python` 工具。

## 模式

`PythonKernelMode`：

- `session`（預設）
  - 核心快取在 `kernelSessions` 映射中
  - 最多 4 個工作階段；溢出時驅逐最舊的
  - 每 30 秒進行閒置/死亡清理，5 分鐘後逾時
  - 每個工作階段佇列序列化執行（`session.queue`）
- `per-call`
  - 為請求建立核心
  - 執行
  - 始終在 `finally` 中關閉核心

## 重設行為

`python` 工具僅在多儲存格呼叫的第一個儲存格傳遞 `reset`；後續儲存格始終以 `reset: false` 執行。

## 核心死亡 / 重啟 / 重試

在工作階段模式（`withKernelSession`）中：

- 死亡核心透過心跳偵測（每 5 秒 `kernel.isAlive()` 檢查）或執行失敗來偵測。
- 執行前的死亡狀態觸發 `restartKernelSession`。
- 執行時的崩潰路徑重試一次：重啟核心，重新執行處理程式。
- 同一工作階段中 `restartCount > 1` 會拋出 `Python kernel restarted too many times in this session`。

啟動重試行為：

- 共享閘道器核心建立在 HTTP 5xx 的 `SharedGatewayCreateError` 時重試一次。

資源耗盡恢復：

- 偵測 `EMFILE`/`ENFILE`/"Too many open files" 類型的失敗
- 清除追蹤的工作階段
- 呼叫 `shutdownSharedGateway()`
- 重試核心工作階段建立一次

## 4) 環境/工作階段變數注入

核心啟動從執行器接收可選的環境映射：

- `PI_SESSION_FILE`（工作階段狀態檔案路徑）
- `ARTIFACTS`（產物目錄）

`PythonKernel.#initializeKernelEnvironment(...)` 接著在核心內執行初始化腳本以：

- `os.chdir(cwd)`
- 將環境條目注入 `os.environ`
- 若缺少則將 cwd 前置到 `sys.path`

含義：

- 讀取工作階段或產物上下文的前置輔助程式依賴 Python 程序狀態中的這些環境變數。

## 5) 串流/區塊與顯示處理（核心支援路徑）

核心客戶端按每次執行處理 Jupyter 協定訊息：

- `stream` -> 文字區塊傳送到 `onChunk`
- `execute_result` / `display_data` ->
  - 顯示文字按 MIME 優先順序選擇：`text/markdown` > `text/plain` > 轉換後的 `text/html`
  - 結構化輸出另行擷取：
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }`（不發出文字）
- `error` -> 回溯文字推送到區塊串流 + 結構化錯誤中繼資料
- `input_request` -> 發出 stdin 警告文字，傳送空的 `input_reply`，標記 stdin 已請求
- 完成等待 `execute_reply` 和核心 `status=idle` 兩者

取消/逾時：

- 中止信號觸發 `interrupt()`（REST `/interrupt` + 控制通道 `interrupt_request`）
- 結果標記 `cancelled=true`
- 逾時路徑在輸出中註記 `Command timed out after <n> seconds`

## 6) 截斷與產物行為

`src/session/streaming-output.ts` 中的 `OutputSink` 被核心執行路徑（`executeWithKernel`）使用：

- 清理每個區塊（`sanitizeText`）
- 追蹤總行數/輸出行數和位元組數
- 可選的產物溢出檔案（`artifactPath`、`artifactId`）
- 當記憶體內緩衝區超過閾值（`DEFAULT_MAX_BYTES`，除非被覆寫）時：
  - 標記為已截斷
  - 在記憶體中保留尾部位元組（UTF-8 安全邊界）
  - 可將完整串流溢出到產物接收器

`dump()` 回傳：

- 可見輸出文字（可能為尾部截斷）
- 截斷旗標 + 計數
- 產物 ID（用於 `artifact://<id>` 參考）

`python` 工具將此中繼資料轉換為結果截斷通知和 TUI 警告。

`notebook` 工具**不**使用 `OutputSink`；它沒有串流/產物截斷管線，因為它不執行程式碼。

## 7) 渲染器假設與格式化

## Notebook 渲染器 (`notebookToolRenderer`)

- 呼叫檢視：包含操作 + notebook 路徑 + 儲存格/類型中繼資料的狀態行
- 結果檢視：
  - 成功摘要從 `details` 衍生
  - `cellSource` 透過 `renderCodeCell` 渲染
  - markdown 儲存格設定語言提示 `markdown`；其他儲存格無明確語言覆寫
  - 摺疊程式碼預覽限制為 `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 透過共享渲染選項支援展開模式
  - 使用以寬度 + 展開狀態為鍵的渲染快取

錯誤渲染假設：

- 若第一個文字內容以 `Error:` 開頭，渲染器將其格式化為 notebook 錯誤區塊。

## Python 渲染器（用於實際執行輸出）

核心支援的執行渲染預期：

- 每個儲存格的狀態轉換（`pending/running/complete/error`）
- 可選的結構化狀態事件區段
- 可選的 JSON 輸出樹
- 截斷警告 + 可選的 `artifact://<id>` 指標

此渲染器行為與 `notebook` JSON 編輯結果無關，唯一的共通點是兩者都重用共享的 TUI 基礎元件。

## 8) 與純 Python 工具行為的差異

若「純 Python 工具」指的是 `python` 執行路徑：

- `python` 在核心中執行程式碼，按模式持久化狀態，串流區塊，擷取豐富顯示，處理中斷/逾時，並支援輸出截斷/產物。
- `notebook` 僅執行確定性的 notebook JSON 變異；無執行、無核心狀態、無區塊串流、無顯示輸出、無產物管線。

若工作流程需要兩者：

1. 使用 `notebook` 編輯 notebook 來源
2. 透過 `python` 執行程式碼儲存格（手動傳遞程式碼），而非透過 `notebook`

目前的實作未提供單一工具能同時變異 `.ipynb` 並透過核心上下文執行 notebook 儲存格。
