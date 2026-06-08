---
title: Python 工具與 IPython 執行環境
description: 具備 IPython 核心管理、執行與輸出擷取功能的 Python REPL 工具執行環境。
sidebar:
  order: 3
  label: Python 與 IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python 工具與 IPython 執行環境

本文件描述 `packages/coding-agent` 中目前的 Python 執行堆疊。
內容涵蓋工具行為、核心/閘道器生命週期、環境處理、執行語意、輸出渲染以及操作故障模式。

## 範圍與關鍵檔案

- 工具介面：`src/tools/python.ts`
- 會話/每次呼叫的核心編排：`src/ipy/executor.ts`
- 核心協定 + 閘道器整合：`src/ipy/kernel.ts`
- 共享本地閘道器協調器：`src/ipy/gateway-coordinator.ts`
- 使用者觸發 Python 執行的互動模式渲染器：`src/modes/components/python-execution.ts`
- 執行環境/環境變數過濾與 Python 解析：`src/ipy/runtime.ts`

## Python 工具是什麼

`python` 工具透過 Jupyter Kernel Gateway 支援的核心來執行一個或多個 Python 儲存格（而非每個儲存格直接產生 `python -c` 程序）。

工具參數：

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // 秒，限制在 1..600 之間，預設 30
  cwd?: string;
  reset?: boolean; // 僅在第一個儲存格前重設核心
}
```

該工具在會話中為 `concurrency = "exclusive"`，因此呼叫不會重疊。

## 閘道器生命週期

### 模式

有兩種閘道器路徑：

1. **外部閘道器**（已設定 `PI_PYTHON_GATEWAY_URL`）
   - 直接使用設定的 URL。
   - 可選擇使用 `PI_PYTHON_GATEWAY_TOKEN` 進行驗證。
   - 不會產生或管理本地閘道器程序。

2. **本地共享閘道器**（預設路徑）
   - 使用在 `~/.xcsh/agent/python-gateway` 下協調的單一共享程序。
   - 中繼資料檔案：`gateway.json`
   - 鎖定檔案：`gateway.lock`
   - 啟動命令：
     - `python -m kernel_gateway`
     - 綁定至 `127.0.0.1:<分配的連接埠>`
     - 啟動健康檢查：`GET /api/kernelspecs`

### 本地共享閘道器協調

`acquireSharedGateway()`：

- 取得檔案鎖（`gateway.lock`）並帶有心跳機制。
- 如果 PID 存活且健康檢查通過，則重用 `gateway.json`。
- 必要時清理過期的資訊/PID。
- 當不存在健康的閘道器時，啟動新的閘道器。

`releaseSharedGateway()` 目前為空操作（核心關閉不會拆除共享閘道器）。

`shutdownSharedGateway()` 會明確終止共享程序並清除閘道器中繼資料。

### 重要限制

`python.sharedGateway=false` 在核心啟動時會被拒絕：

- 錯誤訊息：`Shared Python gateway required; local gateways are disabled`
- 不存在每個程序的非共享本地閘道器模式。

## 核心生命週期

每次執行使用透過 `POST /api/kernels` 在選定閘道器上建立的核心。

核心啟動序列：

1. 可用性檢查（`checkPythonKernelAvailability`）
2. 建立核心（`/api/kernels`）
3. 開啟 websocket（`/api/kernels/:id/channels`）
4. 初始化核心環境（`cwd`、環境變數、`sys.path`）
5. 執行 `PYTHON_PRELUDE`
6. 從以下位置載入擴充模組：
   - 使用者：`~/.xcsh/agent/modules/*.py`
   - 專案：`<cwd>/.xcsh/modules/*.py`（覆寫同名的使用者模組）

核心關閉：

- 透過 `DELETE /api/kernels/:id` 刪除遠端核心
- 關閉 websocket
- 呼叫共享閘道器釋放鉤子（目前為空操作）

## 會話持久化語意

`python.kernelMode` 控制核心重用：

- `session`（預設）
  - 以會話身份 + cwd 為鍵重用核心會話。
  - 每個會話的執行透過佇列序列化。
  - 閒置會話在 5 分鐘後被驅逐。
  - 最多 4 個會話；溢出時驅逐最舊的會話。
  - 心跳檢查偵測已失效的核心。
  - 允許自動重啟一次；重複崩潰則導致硬性失敗。

- `per-call`
  - 每個執行請求建立全新的核心。
  - 請求完成後關閉核心。
  - 無跨呼叫的狀態持久化。

### 單次工具呼叫中的多儲存格行為

儲存格在該次工具呼叫的同一核心實例中依序執行。

如果中間的儲存格失敗：

- 先前儲存格的狀態仍保留在記憶體中。
- 工具回傳指出哪個儲存格失敗的針對性錯誤。
- 後續儲存格不會被執行。

`reset=true` 僅適用於該次呼叫中的第一個儲存格執行。

## 環境過濾與執行環境解析

在啟動閘道器/核心執行環境之前，環境會經過過濾：

- 允許清單包含核心變數，如 `PATH`、`HOME`、區域設定變數、`VIRTUAL_ENV`、`PYTHONPATH` 等。
- 允許前綴：`LC_`、`XDG_`、`PI_`
- 拒絕清單移除常見的 API 金鑰（OpenAI/Anthropic/Gemini/等）

執行環境選擇順序：

1. 啟用的/已定位的 venv（`VIRTUAL_ENV`，然後 `<cwd>/.venv`、`<cwd>/venv`）
2. 位於 `~/.xcsh/python-env` 的受管理 venv
3. PATH 上的 `python` 或 `python3`

當選擇了 venv 時，其 bin/Scripts 路徑會被前置到 `PATH`。

Python 內部的核心環境初始化也會：

- `os.chdir(cwd)`
- 將提供的環境變數映射注入 `os.environ`
- 確保 cwd 在 `sys.path` 中

## 工具可用性與模式選擇

`python.toolMode`（預設 `both`）+ 可選的 `PI_PY` 覆寫控制暴露方式：

- `ipy-only`
- `bash-only`
- `both`

`PI_PY` 接受的值：

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

如果 Python 預檢失敗，該會話的工具建立會降級為 bash-only。

## 執行流程與取消/逾時

### 工具層級逾時

`python` 工具逾時以秒為單位，預設 30，限制在 `1..600` 之間。

工具結合：

- 呼叫者中止訊號
- 逾時中止訊號

使用 `AbortSignal.any(...)`。

### 核心執行取消

當中止/逾時時：

- 執行被標記為已取消。
- 嘗試透過 REST（`POST /interrupt`）和控制通道 `interrupt_request` 中斷核心。
- 結果包含 `cancelled=true`。
- 逾時路徑會將輸出標註為 `Command timed out after <n> seconds`。

### stdin 行為

不支援互動式 stdin。

如果核心發出 `input_request`：

- 工具記錄 `stdinRequested=true`
- 發出說明文字
- 傳送空的 `input_reply`
- 執行在執行器層被視為失敗

## 輸出擷取與渲染

### 擷取的輸出類別

來自核心訊息：

- `stream` -> 純文字區塊
- `display_data`/`execute_result` -> 豐富顯示處理
- `error` -> 追蹤文字
- 自訂 MIME `application/x-xcsh-status` -> 結構化狀態事件

顯示 MIME 優先順序：

1. `text/markdown`
2. `text/plain`
3. `text/html`（轉換為基本 markdown）

另外作為結構化輸出擷取：

- `application/json` -> JSON 樹狀資料
- `image/png` -> 圖片負載
- `application/x-xcsh-status` -> 狀態事件

### 儲存與截斷

輸出透過 `OutputSink` 串流，並可能持久化至成品儲存。

工具結果可包含截斷中繼資料和 `artifact://<id>` 用於完整輸出回復。

### 渲染器行為

- 工具渲染器（`python.ts`）：
  - 顯示帶有每個儲存格狀態的程式碼儲存格區塊
  - 摺疊預覽預設為 10 行
  - 支援展開模式以顯示完整輸出和更豐富的狀態詳情
- 互動渲染器（`python-execution.ts`）：
  - 用於 TUI 中使用者觸發的 Python 執行
  - 摺疊預覽預設為 20 行
  - 為顯示安全性，將很長的單行限制在 4000 個字元
  - 顯示取消/錯誤/截斷通知

## 外部閘道器支援

設定：

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# 可選：
export PI_PYTHON_GATEWAY_TOKEN="..."
```

與本地共享閘道器的行為差異：

- 無本地閘道器鎖定/資訊檔案
- 無本地程序產生/終止
- 健康檢查和核心 CRUD 針對外部端點執行
- 驗證失敗會顯示明確的令牌指引

## 操作疑難排解（目前的故障模式）

- **Python 工具不可用**
  - 檢查 `python.toolMode` / `PI_PY`。
  - 如果預檢失敗，執行環境會退回到 bash-only。

- **核心可用性錯誤**
  - 本地模式要求在解析的 Python 執行環境中 `kernel_gateway` 和 `ipykernel` 都可匯入。
  - 使用以下命令安裝：

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` 導致啟動失敗**
  - 這在目前的實作中是預期行為。

- **外部閘道器驗證/可達性失敗**
  - 401/403 -> 設定 `PI_PYTHON_GATEWAY_TOKEN`。
  - 逾時/無法連線 -> 驗證 URL/網路和閘道器健康狀態。

- **執行掛起然後逾時**
  - 如果工作負載是合理的，增加工具 `timeout`（最大 600 秒）。
  - 對於卡住的程式碼，取消會觸發核心中斷，但使用者程式碼可能仍需重構。

- **Python 程式碼中的 stdin/輸入提示**
  - 此執行環境路徑不支援互動式 `input()`；請以程式方式傳遞資料。

- **資源耗盡（`EMFILE` / 開啟的檔案過多）**
  - 會話管理器會觸發共享閘道器復原（會話拆除 + 共享閘道器重啟）。

- **工作目錄錯誤**
  - 工具在執行前會驗證 `cwd` 存在且為目錄。

## 相關環境變數

- `PI_PY` — 工具暴露覆寫（對應上述 `bash-only`/`ipy-only`/`both` 映射）
- `PI_PYTHON_GATEWAY_URL` — 使用外部閘道器
- `PI_PYTHON_GATEWAY_TOKEN` — 可選的外部閘道器驗證令牌
- `PI_PYTHON_SKIP_CHECK=1` — 略過 Python 預檢/暖機檢查
- `PI_PYTHON_IPC_TRACE=1` — 記錄核心 IPC 傳送/接收追蹤
- `PI_DEBUG_STARTUP=1` — 發出啟動階段除錯標記
