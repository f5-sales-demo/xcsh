---
title: Native Rust Task Execution and Cancellation
description: Rust 非同步任務執行模型，具備協作式取消與清理語義。
sidebar:
  order: 5
  label: 任務取消
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# 原生 Rust 任務執行與取消（`pi-natives`）

本文件描述 `crates/pi-natives` 如何排程原生工作，以及取消操作如何從 JS 選項（`timeoutMs`、`AbortSignal`）流向 Rust 執行層。

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

`task.rs` 定義了三個核心組件：

1. `task::blocking(tag, cancel_token, work)`
   - 封裝 `napi::AsyncTask` / `Task`。
   - `compute()` 在 libuv 工作執行緒上執行（用於 CPU 密集型或阻塞/同步系統呼叫）。
   - 回傳 JS `Promise<T>`。

2. `task::future(env, tag, work)`
   - 封裝 `env.spawn_future(...)`。
   - 在 Tokio 執行環境上執行非同步工作。
   - 回傳 `PromiseRaw<'env, T>`。

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` 結合截止時間與可選的 `AbortSignal`。
   - `CancelToken::heartbeat()` 用於阻塞迴圈中的協作式取消。
   - `CancelToken::wait()` 用於非同步取消等待（`Signal` / `Timeout` / `User` Ctrl-C）。
   - `AbortToken` 允許外部程式碼請求中止（`abort(reason)`）。

## `blocking` vs `future`：執行模型與選擇

### 使用 `task::blocking`

當工作為 CPU 密集型或本質上為同步/阻塞時使用：

- 正規表示式/檔案掃描（`grep`、`glob`、`fuzzy_find`）
- 同步 PTY 迴圈內部（`run_pty_sync` 透過 `spawn_blocking`）
- 剪貼簿/圖片/HTML 轉換

行為：

- 工作閉包接收一個複製的 `CancelToken`。
- 取消操作只在程式碼檢查 `ct.heartbeat()?` 時才會被觀察到。
- 閉包 `Err(...)` 會拒絕 JS promise。

### 使用 `task::future`

當工作必須 `await` 非同步操作時使用：

- shell 工作階段協調（`shell.run`、`executeShell`）
- 任務競速（`tokio::select!`），在完成與取消之間競爭

行為：

- Future 可以將正常完成與 `ct.wait()` 進行競速。
- 在取消路徑上，非同步實作通常會將取消傳播到內部子系統（例如 `tokio_util::CancellationToken`），並可選擇在寬限逾時後強制中止。

## JS API ↔ Rust 匯出對應（任務/取消相關）

| JS 對外 API | Rust 匯出（`#[napi]`） | 排程器 | 取消掛接方式 |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` 在過濾迴圈中 |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` 在評分迴圈中 |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` 與執行任務競速；橋接至 Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | 同上 |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + 內部 `spawn_blocking` | `CancelToken` 在同步 PTY 迴圈中透過 `heartbeat()` 檢查 |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | 無（`()` 令牌） |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | 無（`()` 令牌） |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | 無（`()` 令牌） |

`text.rs` 和 `ps.rs` 目前未使用 `task::blocking`/`task::future`，因此不參與此取消路徑。

## 取消生命週期與狀態轉換

### `CancelToken` 生命週期

`CancelToken` 是協作式且具狀態的：

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### 啟動前 vs 執行中取消

- **啟動前 / 第一次取消檢查前**：
  - 使用 `ct.wait()` 競速的 `task::future` 使用者，一旦進入 `select!` 就能立即解析取消。
  - `task::blocking` 使用者只在閉包程式碼到達 `heartbeat()` 時才會觀察到取消。如果閉包未及早進行 heartbeat，取消會被延遲。

- **執行中**：
  - `blocking`：下一次 `heartbeat()` 回傳 `Err("Aborted: ...")`。
  - `future`：`ct.wait()` 分支贏得 `select!`，然後程式碼取消從屬的非同步機制（對於 shell：取消 Tokio 令牌，等待最多 2 秒，然後中止任務）。

## 長時間執行迴圈的 Heartbeat 預期

`heartbeat()` 必須在具有無限制或大型工作集的迴圈中以可預測的頻率執行。

觀察到的模式：

- `glob::filter_entries`：在過濾/比對之前檢查每個項目。
- `fd::score_entries`：檢查每個掃描的候選項。
- `grep_sync`：在高負載搜尋階段之前明確進行取消檢查，加上同樣接收令牌的檔案系統快取呼叫。
- `run_pty_sync`：每個迴圈週期（約 16ms 的 sleep 頻率）檢查，並在取消時終止子程序。

實務規則：對外部大小輸入的迴圈，不應超過短暫的有限間隔而未進行 heartbeat。

## 失敗行為與錯誤傳播至 JS

### 阻塞任務

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

1. 非同步主體回傳 `Err(napi::Error)` 或 join 失敗被映射（`... task failed: {err}`）。
2. `task::future` 產生的 promise 被拒絕。
3. 某些 API 刻意回傳結構化的取消結果而非拒絕（`ShellRunResult`/`ShellExecuteResult` 具有 `cancelled`/`timed_out` 旗標和 `exit_code: None`）。

### 取消回報的區分

- **中止作為錯誤**：大多數使用 `heartbeat()?` 的阻塞匯出。
- **中止作為型別化結果**：shell/pty 風格的命令 API，在結果結構中建模取消狀態。

每個 API 選擇一種模型並明確記載。

## 常見陷阱

1. **阻塞迴圈中缺少 heartbeat**
   - 症狀：timeout/signal 看起來被忽略，直到迴圈結束。
   - 修正：在迴圈頂部和昂貴的逐項步驟之前加入 `ct.heartbeat()?`。

2. **長時間不可取消的區段**
   - 症狀：在單一大型呼叫（解碼、排序、壓縮等）期間取消延遲飆升。
   - 修正：將工作拆分為帶有 heartbeat 邊界的區塊；如果不可能，記載延遲情況。

3. **阻塞非同步執行器**
   - 症狀：當同步密集型程式碼直接在 future 中執行時，非同步 API 停滯。
   - 修正：將 CPU/同步區塊移至 `task::blocking` 或 `tokio::task::spawn_blocking`。

4. **不一致的取消語義**
   - 症狀：一個 API 在取消時拒絕，另一個以旗標解析，令呼叫者困惑。
   - 修正：按領域標準化，並保持封裝文件對齊。

5. **巢狀非同步任務中忘記取消橋接**
   - 症狀：外部令牌已取消，但內部讀取器/子程序任務繼續執行。
   - 修正：將取消橋接至內部令牌/信號，並強制執行寬限逾時 + 強制中止的後備方案。

## 新可取消匯出的檢查清單

1. 正確分類工作：
   - CPU 密集型或同步阻塞 -> `task::blocking`
   - 非同步 I/O / `await` 協調 -> `task::future`

2. 需要時公開取消輸入：
   - 在 `#[napi(object)]` 選項中包含 `timeoutMs` 和 `signal`
   - 建立 `let ct = task::CancelToken::new(timeout_ms, signal);`

3. 將取消貫穿所有層級：
   - 阻塞迴圈：以穩定間隔使用 `ct.heartbeat()?`
   - 非同步協調：與 `ct.wait()` 競速並取消子任務/令牌

4. 決定取消契約：
   - 以中止錯誤拒絕 promise，或
   - 解析型別化的 `{ cancelled, timedOut, ... }`
   - 在 API 家族中保持此契約一致

5. 帶上下文傳播失敗：
   - 透過 `Error::from_reason(format!("...: {err}"))` 映射錯誤
   - 包含階段特定前綴（`spawn`、`decode`、`wait` 等）

6. 處理啟動前和執行中的取消：
   - 取消檢查/等待必須在昂貴主體之前以及長時間執行期間發生

7. 驗證無執行器誤用：
   - 不在非同步 future 內部直接進行長時間同步工作，需使用 `spawn_blocking`/阻塞任務封裝
