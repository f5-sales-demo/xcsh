---
title: Native Rust Task Execution and Cancellation
description: Rust async task execution model with cooperative cancellation and cleanup semantics.
sidebar:
  order: 5
  label: Task cancellation
---

This document describes how `@f5-sales-demo/pi-natives` schedules asynchronous work on worker threads and bridges TypeScript cancellation primitives (`AbortSignal`, `timeoutMs`) to Rust runtimes.

## Implementation files

- `crates/pi-natives/src/task.rs`: Task scheduling abstractions and cancellation token implementations.
- `crates/pi-natives/src/grep.rs`: Multithreaded search execution and cancellation hooks.
- `crates/pi-natives/src/glob.rs`: Filesystem scanning loops with cooperative cancellation checks.
- `crates/pi-natives/src/shell.rs`: Subprocess execution orchestration with Tokio async cancellation.
- `crates/pi-natives/src/pty.rs`: Pseudoterminal worker loops and cancellation management.

## Task execution primitives

`crates/pi-natives/src/task.rs` provides two primary execution abstractions:

### 1. Blocking tasks (`task::blocking`)

- Wraps `napi::AsyncTask` to schedule work on libuv worker threads.
- Used for CPU-intensive algorithms and synchronous filesystem I/O (`grep`, `glob`, `fuzzy_find`, image processing, HTML conversion).
- Cancellation is cooperative: worker closures inspect `ct.heartbeat()?` at regular intervals.

### 2. Future tasks (`task::future`)

- Wraps `env.spawn_future(...)` to execute asynchronous futures on the Tokio runtime.
- Used for I/O multiplexing and subprocess lifecycle management (`shell.run`, `executeShell`, `PtySession.start`).
- Cancellation uses `tokio::select!` to race completion against `ct.wait()`.

## Cancellation token architecture

`CancelToken` combines explicit timeout deadlines and JavaScript `AbortSignal` instances:

```text
[ JavaScript AbortSignal / timeoutMs ]
                 │
                 ▼
        [ CancelToken::new ]
        ┌────────┴────────┐
        ▼                 ▼
[ Blocking loop ]   [ Async future ]
  ct.heartbeat()?     tokio::select! (ct.wait())
```

### Cooperative heartbeats in blocking loops

Long-running loops across arbitrary filesystem hierarchies or match lists must invoke `ct.heartbeat()?` at stable intervals:

```rust
for entry in entries {
    ct.heartbeat()?;
    // Process entry
}
```

If the cancellation token triggers due to a timeout or abort signal, `heartbeat()` returns `Err(napi::Error::from_reason("Aborted: ..."))`, rejecting the JavaScript promise immediately.

## TypeScript API and cancellation mapping

| API | Rust export | Execution primitive | Cancellation mechanism |
| --- | --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `task::blocking` | `CancelToken::new` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking` | `CancelToken::new` + `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking` | `CancelToken::new` + `ct.heartbeat()` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future` | `ct.wait()` raced via `tokio::select!` |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future` + worker | `ct.heartbeat()` in event tick loop |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking` | None (short synchronous execution) |
| `PhotonImage.parse/resize/encode` | `PhotonImage` methods | `task::blocking` | None (in-memory image processing) |

## Best practices for native task authors

1. **Select the correct executor**: Use `task::blocking` for CPU work and `task::future` for asynchronous stream coordination.
2. **Include frequent heartbeats**: Never run unbounded iterations without calling `ct.heartbeat()?`.
3. **Avoid blocking Tokio threads**: Offload CPU-bound compression or sorting to `tokio::task::spawn_blocking` or `task::blocking`.
4. **Clean up child processes on abort**: When an execution future is cancelled, terminate child processes before returning.
