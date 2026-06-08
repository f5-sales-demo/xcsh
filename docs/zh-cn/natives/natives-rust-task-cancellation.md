---
title: 原生 Rust 任务执行与取消
description: Rust 异步任务执行模型，支持协作式取消与清理语义。
sidebar:
  order: 5
  label: 任务取消
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# 原生 Rust 任务执行与取消 (`pi-natives`)

本文档描述了 `crates/pi-natives` 如何调度原生工作，以及取消操作如何从 JS 选项（`timeoutMs`、`AbortSignal`）传递到 Rust 执行层。

## 实现文件

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

## 核心原语 (`task.rs`)

`task.rs` 定义了三个核心组件：

1. `task::blocking(tag, cancel_token, work)`
   - 封装 `napi::AsyncTask` / `Task`。
   - `compute()` 在 libuv 工作线程上运行（用于 CPU 密集型或阻塞/同步系统调用）。
   - 返回 JS `Promise<T>`。

2. `task::future(env, tag, work)`
   - 封装 `env.spawn_future(...)`。
   - 在 Tokio 运行时上执行异步工作。
   - 返回 `PromiseRaw<'env, T>`。

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` 组合截止时间 + 可选的 `AbortSignal`。
   - `CancelToken::heartbeat()` 用于阻塞循环中的协作式取消。
   - `CancelToken::wait()` 用于异步取消等待（`Signal` / `Timeout` / `User` Ctrl-C）。
   - `AbortToken` 允许外部代码请求中止（`abort(reason)`）。

## `blocking` vs `future`：执行模型与选择

### 使用 `task::blocking`

当工作是 CPU 密集型或本质上是同步/阻塞时使用：

- 正则/文件扫描（`grep`、`glob`、`fuzzy_find`）
- 同步 PTY 循环内部操作（通过 `spawn_blocking` 的 `run_pty_sync`）
- 剪贴板/图像/HTML 转换

行为：

- 工作闭包接收一个克隆的 `CancelToken`。
- 取消仅在代码检查 `ct.heartbeat()?` 时被观察到。
- 闭包 `Err(...)` 会拒绝 JS promise。

### 使用 `task::future`

当工作必须 `await` 异步操作时使用：

- shell 会话编排（`shell.run`、`executeShell`）
- 任务竞争（`tokio::select!`）在完成和取消之间

行为：

- Future 可以将正常完成与 `ct.wait()` 进行竞争。
- 在取消路径上，异步实现通常会将取消传播到内部子系统（例如 `tokio_util::CancellationToken`），并在宽限超时后选择性地强制中止。

## JS API ↔ Rust 导出映射（任务/取消相关）

| JS 端 API | Rust 导出 (`#[napi]`) | 调度器 | 取消接入方式 |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + 过滤循环中的 `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + 评分循环中的 `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` 与运行任务竞争；桥接到 Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | 同上 |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + 内部 `spawn_blocking` | 通过 `heartbeat()` 在同步 PTY 循环中检查 `CancelToken` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | 无（`()` token） |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | 无（`()` token） |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | 无（`()` token） |

`text.rs` 和 `ps.rs` 目前不使用 `task::blocking`/`task::future`，因此不参与此取消路径。

## 取消生命周期与状态转换

### `CancelToken` 生命周期

`CancelToken` 是协作式且有状态的：

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

### 启动前 vs 执行中取消

- **启动前 / 首次取消检查前**：
  - 使用 `task::future` 并通过 `ct.wait()` 竞争的用户，一旦进入 `select!` 即可立即解析取消。
  - 使用 `task::blocking` 的用户仅在闭包代码到达 `heartbeat()` 时才能观察到取消。如果闭包没有提前进行心跳检查，取消将被延迟。

- **执行中**：
  - `blocking`：下一次 `heartbeat()` 返回 `Err("Aborted: ...")`。
  - `future`：`ct.wait()` 分支赢得 `select!`，然后代码取消下级异步机制（对于 shell：取消 Tokio token，等待最多 2 秒，然后中止任务）。

## 长时间运行循环的心跳预期

`heartbeat()` 必须在具有无界或大规模工作集的循环中以可预测的节奏运行。

已观察到的模式：

- `glob::filter_entries`：在过滤/匹配之前检查每个条目。
- `fd::score_entries`：检查每个扫描的候选项。
- `grep_sync`：在繁重搜索阶段之前进行显式取消检查，此外接收 token 的文件系统缓存调用也会进行检查。
- `run_pty_sync`：每个循环周期检查（约 16ms 睡眠节奏），取消时杀死子进程。

实践规则：遍历外部大小输入的循环不应在没有心跳的情况下超过短暂的有界时间间隔。

## 失败行为与错误传播到 JS

### 阻塞任务

错误路径：

1. 闭包返回 `Err(napi::Error)`（包括 `heartbeat()` 中止）。
2. `Task::compute()` 返回 `Err`。
3. `AsyncTask` 拒绝 JS promise。

典型错误字符串：

- `Aborted: Timeout`
- `Aborted: Signal`
- 领域错误（`Failed to decode image: ...`、`Conversion error: ...` 等）

### Future 任务

错误路径：

1. 异步体返回 `Err(napi::Error)` 或 join 失败被映射（`... task failed: {err}`）。
2. `task::future` 生成的 promise 被拒绝。
3. 某些 API 有意返回结构化的取消结果而非拒绝（`ShellRunResult`/`ShellExecuteResult` 带有 `cancelled`/`timed_out` 标志和 `exit_code: None`）。

### 取消报告的分类

- **中止作为错误**：大多数使用 `heartbeat()?` 的阻塞导出。
- **中止作为类型化结果**：shell/pty 风格的命令 API，在结果结构体中建模取消。

为每个 API 选择一种模型并明确记录。

## 常见陷阱

1. **阻塞循环中缺少心跳**
   - 症状：超时/信号似乎被忽略，直到循环结束。
   - 修复：在循环顶部和昂贵的逐项步骤之前添加 `ct.heartbeat()?`。

2. **长时间不可取消的段落**
   - 症状：在单次大调用期间（解码、排序、压缩等）取消延迟飙升。
   - 修复：将工作分割成带有心跳边界的块；如果不可能，记录延迟情况。

3. **阻塞异步执行器**
   - 症状：当同步密集型代码直接在 future 中运行时，异步 API 停滞。
   - 修复：将 CPU/同步块移至 `task::blocking` 或 `tokio::task::spawn_blocking`。

4. **不一致的取消语义**
   - 症状：一个 API 在取消时拒绝，另一个用标志解析，令调用者困惑。
   - 修复：按领域标准化，并保持包装器文档一致。

5. **嵌套异步任务中忘记取消桥接**
   - 症状：外部 token 已取消，但内部读取器/子进程任务继续运行。
   - 修复：将取消桥接到内部 token/信号，并强制执行宽限超时 + 强制中止回退。

## 新可取消导出的检查清单

1. 正确分类工作：
   - CPU 密集型或同步阻塞 -> `task::blocking`
   - 异步 I/O / `await` 编排 -> `task::future`

2. 需要时暴露取消输入：
   - 在 `#[napi(object)]` 选项中包含 `timeoutMs` 和 `signal`
   - 创建 `let ct = task::CancelToken::new(timeout_ms, signal);`

3. 在所有层中传递取消：
   - 阻塞循环：以稳定的间隔调用 `ct.heartbeat()?`
   - 异步编排：与 `ct.wait()` 竞争并取消子任务/token

4. 确定取消契约：
   - 以中止错误拒绝 promise，或
   - 解析类型化的 `{ cancelled, timedOut, ... }`
   - 在 API 系列中保持此契约一致

5. 带上下文传播失败：
   - 通过 `Error::from_reason(format!("...: {err}"))` 映射错误
   - 包含阶段特定的前缀（`spawn`、`decode`、`wait` 等）

6. 处理启动前和执行中的取消：
   - 取消检查/等待必须在昂贵的主体之前以及长时间执行期间发生

7. 验证无执行器误用：
   - 不要在异步 future 中直接进行长时间同步工作，应使用 `spawn_blocking`/blocking 任务包装器
