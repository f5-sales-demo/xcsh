---
title: Natives Shell, PTY, Process, and Key Internals
description: Shell execution, PTY management, process lifecycle, and key event handling in the native layer.
sidebar:
  order: 4
  label: Shell, PTY & process
---

This document describes the native execution primitives for subprocesses, interactive pseudoterminals (PTY), process tree management, and terminal key sequence parsing in `@f5-sales-demo/pi-natives`.

## Implementation files

- `crates/pi-natives/src/shell.rs`: High-performance persistent shell session executor.
- `crates/pi-natives/src/shell/windows.rs`: Windows-specific environment and path resolution.
- `crates/pi-natives/src/pty.rs`: Interactive pseudoterminal runtime based on `portable_pty`.
- `crates/pi-natives/src/ps.rs`: Platform-native process tree discovery and bottom-up termination.
- `crates/pi-natives/src/keys.rs`: High-throughput terminal key escape sequence parser.
- `packages/natives/src/shell/index.ts`: TypeScript wrapper for shell execution.
- `packages/natives/src/pty/index.ts`: TypeScript wrapper for PTY sessions.
- `packages/natives/src/ps/index.ts`: TypeScript process management interface.
- `packages/natives/src/keys/index.ts`: TypeScript keyboard input matching interface.

## Subsystem architecture

### 1. Shell execution subsystem (`shell`)

The shell execution engine provides two execution modes:

- **One-shot execution (`executeShell`)**: Spawns an isolated shell process, streams output through a callback, and terminates the session upon completion.
- **Persistent shell session (`Shell`)**: Maintains shell state across sequential commands (environment variables, working directories, and shell functions).

#### Execution lifecycle and error handling

- **Environment isolation**: Configured with `do_not_inherit_env: true` and reconstructs clean host environments while filtering out transient variables (`PS1`, `SHLVL`).
- **Cancellation**: Cancelling an active command sends a termination signal, allows a 2-second graceful exit period, and then forcefully terminates background jobs.
- **Streaming output**: Interleaves `stdout` and `stderr` streams, incrementally decoding UTF-8 chunks with `U+FFFD` replacement for malformed byte sequences.

### 2. Pseudoterminal subsystem (`pty`)

The PTY runtime manages interactive terminal sessions:

- **Initialization**: `PtySession.start(options, onChunk?)` allocates an OS pseudoterminal and spawns the target shell command.
- **Dynamic control**: Supports runtime `write(data)` input streaming, window resizing (`resize(cols, rows)`), and immediate process termination (`kill()`).
- **Cancellation**: Evaluates cancellation tokens during event loop iterations, terminating child processes upon timeout or abort signals.

### 3. Process tree management (`ps`)

Provides deterministic process discovery and termination without shell dependencies:

- **`killTree(pid, signal)`**: Traverses process hierarchies recursively and terminates children before parent processes (bottom-up termination) to prevent orphaned processes.
- **`listDescendants(pid)`**: Returns an array of active descendant process IDs.

#### Platform implementations

- **Linux**: Recursively parses `/proc/<PID>/task/<PID>/children`.
- **macOS**: Uses `libproc` `proc_listchildpids`.
- **Windows**: Traverses process snapshots via `CreateToolhelp32Snapshot` and terminates tasks using `TerminateProcess`.

### 4. Keyboard sequence parser (`keys`)

Parses high-frequency terminal input:

- Decodes single-byte control characters, legacy ANSI escape sequences, xterm `modifyOtherKeys` sequences, and Kitty keyboard protocol events.
- Normalizes parsed inputs to standard key descriptors (for example, `ctrl+c`, `shift+tab`, `f5`).

## TypeScript API and native export mapping

| TypeScript API | Native Node-API export | Description |
| --- | --- | --- |
| `executeShell(options, onChunk?)` | `executeShell` | Runs a one-shot subprocess command. |
| `new Shell(options?)` | `Shell` | Instantiates a stateful persistent shell session. |
| `shell.run(options, onChunk?)` | `Shell::run` | Executes a command in a persistent session. |
| `shell.abort()` | `Shell::abort` | Aborts the currently active command in the session. |
| `new PtySession()` | `PtySession` | Instantiates an interactive pseudoterminal session. |
| `pty.start(options, onChunk?)` | `PtySession::start` | Starts PTY execution and output streaming. |
| `pty.write(data)` | `PtySession::write` | Writes data to the PTY standard input. |
| `pty.resize(cols, rows)` | `PtySession::resize` | Updates PTY column and row dimensions. |
| `pty.kill()` | `PtySession::kill` | Terminates the active PTY child process. |
| `killTree(pid, signal)` | `killTree` | Recursively terminates a process and all descendants. |
| `listDescendants(pid)` | `listDescendants` | Lists all descendant process IDs for a given PID. |
| `parseKey(data, kittyProtocolActive)` | `parseKey` | Parses raw terminal input into normalized key names. |
