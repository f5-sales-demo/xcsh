---
title: 原生 Rust 任務執行與取消
description: Rust 非同步任務執行模型，具備協作式取消與清理語意。
sidebar:
  order: 5
  label: 任務取消
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# 原生 Rust 任務執行與取消（`pi-natives`）

本文件說明 `crates/pi-natives` 如何排程原生工作，以及取消操作如何從 JS 選項（`timeoutMs`、`AbortSignal`）流向 Rust 執行層。

## 實作檔案

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## 核心原語（`task.rs`）

`task.rs` 定義了三個核心元件：

1. `task::blocking(tag, cancel_token, work)`
   - 封裝 `napi::AsyncTask` / `Task`。
   - `compute()` 在 libuv 工作執行緒上執行（適用於 CPU 密集型或阻塞式/同步系統呼叫）。
   - 回傳 JS `Promise<T>`。

2. `task::future(env, tag, work)`
   - 封裝 `env.spawn_future(...)`。
   - 在 Tokio 執行時期上執行非同步工作。
   - 回傳 `PromiseRaw<'env, T>`。

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` 結合截止時間與可選的 `AbortSignal`。
   - `CancelToken::heartbeat()` 為阻塞式迴圈提供協作式取消機制。
   - `CancelToken::wait()` 為非同步取消等待（`Signal` / `Timeout` / 使用者 Ctrl-C）。
   - `AbortToken` 允許外部程式碼請求中止（`abort(reason)`）。

## `blocking` 與 `future`：執行模型與選擇

### 使用 `task::blocking`

適用於 CPU 密集型或本質上為同步/阻塞的工作：

- 正規表達式/檔案掃描（`grep`、`glob`、`fuzzy_find`）
- 同步 PTY 迴圈內部（透過 `spawn_blocking` 的 `run_pty_sync`）
- 剪貼簿/影像/HTML 轉換

行為：

- 工作閉包接收已複製的 `CancelToken`。
- 取消操作僅在程式碼呼叫 `ct.heartbeat()?` 時才會被觀察到。
- 閉包 `Err(...)` 會拒絕 JS promise。

### 使用 `task::future`

適用於需要 `await` 非同步操作的工作：

- shell 工作階段協調（`shell.run`、`executeShell`）
- 使用 `tokio::select!` 進行完成與取消之間的任務競爭

行為：

- Future 可在正常完成與 `ct.wait()` 之間進行競爭。
- 在取消路徑上，非同步實作通常會將取消傳播至內部子系統（例如 `tokio_util::CancellationToken`），並可在寬限期逾時後強制中止。

## JS API ↔ Rust 匯出對應（任務/取消相關）

| JS 對外 API | Rust 匯出（`#[napi]`） | 排程器 | 取消掛接 |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + 過濾器迴圈中的 `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + 評分迴圈中的 `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` 與執行任務競爭；橋接至 Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | 同上 |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + 內部 `spawn_blocking` | `CancelToken` 透過 `heartbeat()` 在同步 PTY 迴圈中檢查 |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | 無（`()` token） |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | 無（`()` token） |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | 無（`()` token） |

`text.rs` 與 `ps.rs` 目前未使用 `task::blocking`/`task::future`，因此不參與此取消路徑。

## 取消生命週期與狀態轉換

### `CancelToken` 生命週期

`CancelToken` 為協作式且具有狀態：

```text
已建立
  ├─ 無 signal + 無 timeout  -> 被動 token（除非外部設置，否則永不中止）
  ├─ 已註冊 signal           -> 等待 AbortSignal 回呼
  └─ 已設定截止時間          -> timeout 檢查變為啟用

執行中
  ├─ heartbeat()/wait() 偵測到 signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() 偵測到截止時間  -> AbortReason::Timeout
  ├─ wait() 偵測到 Ctrl-C               -> AbortReason::User
  └─ 無中止                             -> 繼續

已中止（終態）
  └─ 第一個中止原因勝出（原子旗標 + 通知器）
```

### 啟動前與執行中途的取消

- **啟動前 / 首次取消檢查前**：
  - 對 `ct.wait()` 進行競爭的 `task::future` 使用者，一旦進入 `select!` 即可立即解析取消。
  - `task::blocking` 使用者僅在閉包程式碼到達 `heartbeat()` 時才能觀察到取消。若閉包未提早執行 heartbeat，取消操作將被延遲。

- **執行中途**：
  - `blocking`：下一次 `heartbeat()` 回傳 `Err("Aborted: ...")`。
  - `future`：`ct.wait()` 分支在 `select!` 中勝出，隨後程式碼取消從屬非同步機制（對於 shell：取消 Tokio token，等待最多 2 秒，然後中止任務）。

## 長時間執行迴圈的 Heartbeat 預期

`heartbeat()` 必須在具有無界或大型工作集的迴圈中以可預測的節奏執行。

已觀察到的模式：

- `glob::filter_entries`：在過濾/匹配前檢查每個條目。
- `fd::score_entries`：檢查每個被掃描的候選項目。
- `grep_sync`：在繁重的搜尋階段前進行明確的取消檢查，以及同樣接收 token 的 fs-cache 呼叫。
- `run_pty_sync`：檢查每個迴圈滴答（約 16ms 的休眠節奏），並在取消時終止子程序。

實用規則：對外部大小輸入進行的任何迴圈，都不應在未執行 heartbeat 的情況下超過短暫的有界間隔。

## 失敗行為與錯誤傳播至 JS

### 阻塞式任務

錯誤路徑：

1. 閉包回傳 `Err(napi::Error)`（包含 `heartbeat()` 中止）。
2. `Task::compute()` 回傳 `Err`。
3. `AsyncTask` 拒絕 JS promise。

典型錯誤字串：

- `Aborted: Timeout`
- `Aborted: Signal`
- 領域錯誤（`Failed to decode image: ...`、`Conversion error: ...` 等）

### Future 任務

錯誤路徑：

1. 非同步主體回傳 `Err(napi::Error)` 或 join 失敗被對應（`... task failed: {err}`）。
2. `task::future` 所生成的 promise 被拒絕。
3. 部分 API 有意回傳結構化的取消結果而非拒絕（`ShellRunResult`/`ShellExecuteResult` 帶有 `cancelled`/`timed_out` 旗標及 `exit_code: None`）。

### 取消回報的分歧

- **以錯誤方式中止**：大多數使用 `heartbeat()?` 的阻塞式匯出。
- **以型別化結果方式中止**：以結果結構體模型化取消的 shell/pty 風格命令 API。

請為每個 API 選擇一種模型，並明確記錄。

## 常見陷阱

1. **阻塞式迴圈中缺少 heartbeat**
   - 症狀：timeout/signal 看似被忽略，直到迴圈結束才生效。
   - 修正：在迴圈頂部及每個昂貴的逐項步驟前加入 `ct.heartbeat()?`。

2. **長時間無法取消的區段**
   - 症狀：在單次大型呼叫（解碼、排序、壓縮等）期間，取消延遲激增。
   - 修正：將工作分割為具有 heartbeat 邊界的區塊；若無法分割，則記錄延遲情況。

3. **阻塞非同步執行器**
   - 症狀：同步密集型程式碼直接在 future 中執行時，非同步 API 發生停滯。
   - 修正：將 CPU/同步區塊移至 `task::blocking` 或 `tokio::task::spawn_blocking`。

4. **不一致的取消語意**
   - 症狀：某個 API 在取消時拒絕，另一個則解析並帶有旗標，使呼叫方感到困惑。
   - 修正：按領域標準化，並保持封裝文件的一致性。

5. **在巢狀非同步任務中忘記橋接取消**
   - 症狀：外部 token 已取消，但內部讀取器/子程序任務仍持續執行。
   - 修正：將取消橋接至內部 token/signal，並強制執行寬限期逾時與強制中止的備援機制。

## 新可取消匯出的檢查清單

1. 正確分類工作：
   - CPU 密集型或同步阻塞 -> `task::blocking`
   - 非同步 I/O / `await` 協調 -> `task::future`

2. 在需要時公開取消輸入：
   - 在 `#[napi(object)]` 選項中加入 `timeoutMs` 與 `signal`
   - 建立 `let ct = task::CancelToken::new(timeout_ms, signal);`

3. 跨所有層級串接取消機制：
   - 阻塞式迴圈：以穩定間隔執行 `ct.heartbeat()?`
   - 非同步協調：與 `ct.wait()` 競爭並取消子任務/token

4. 決定取消合約：
   - 以中止錯誤拒絕 promise，或
   - 解析型別化的 `{ cancelled, timedOut, ... }`
   - 對同一 API 系列保持合約一致性

5. 以上下文傳播失敗：
   - 透過 `Error::from_reason(format!("...: {err}"))` 對應錯誤
   - 加入階段特定的前綴（`spawn`、`decode`、`wait` 等）

6. 處理啟動前與執行中途的取消：
   - 取消檢查/等待必須在昂貴的主體執行前及長時間執行期間進行

7. 驗證無執行器誤用：
   - 不得在非同步 future 內部直接執行長時間同步工作，而未使用 `spawn_blocking`/阻塞式任務封裝
