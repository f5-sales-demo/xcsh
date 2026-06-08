---
title: 原生层 Shell、PTY、进程与按键内部机制
description: 原生层中的 Shell 执行、PTY 管理、进程生命周期和按键事件处理。
sidebar:
  order: 4
  label: Shell、PTY 与进程
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# 原生层 Shell、PTY、进程与按键内部机制

本文档涵盖 `@f5xc-salesdemos/pi-natives` 中的**执行/进程/终端原语**：`shell`、`pty`、`ps` 和 `keys`，使用 `docs/natives-architecture.md` 中的架构术语。

## 实现文件

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs`（仅 Windows）
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs`（shell/pty 共用的取消行为）
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## 层级职责

- **TS 封装/API 层**（`packages/natives/src/*`）：类型化入口点、取消接口（`timeoutMs`、`AbortSignal`）以及 JS 人体工程学设计。
- **Rust N-API 模块层**（`crates/pi-natives/src/*`）：shell/PTY 进程执行、进程树遍历/终止以及按键序列解析。
- **验证门控**（`native.ts`，架构级）：确保所需导出（`Shell`、`executeShell`、`PtySession`、`killTree`、`listDescendants`、按键辅助函数）在封装器使用前存在。

## Shell 子系统（`shell`）

### API 模型

暴露两种执行模式：

1. **一次性执行**，通过 `executeShell(options, onChunk?)`。
2. **持久会话**，通过 `new Shell(options?)` 然后重复调用 `shell.run(...)`。

两者都通过线程安全回调流式传输输出，并返回 `{ exitCode?, cancelled, timedOut }`。

### 会话创建与环境模型

Rust 创建 `brush_core::Shell` 时使用：

- 非交互模式，
- `do_not_inherit_env: true`，
- 从宿主环境显式重建环境变量，
- 跳过对 shell 敏感的变量（`PS1`、`PWD`、`SHLVL`、bash 函数导出等）。

会话环境行为：

- `ShellOptions.sessionEnv` 在会话创建时应用一次。
- `ShellRunOptions.env` 的作用域为命令级（`EnvironmentScope::Command`），每次运行后弹出。
- `PATH` 在 Windows 上进行特殊合并，采用大小写不敏感的去重。

Windows 专有路径增强（`shell/windows.rs`）：如果发现 Git-for-Windows 路径（`cmd`、`bin`、`usr/bin`）且尚未包含，则将其追加。

### 运行时生命周期与状态转换

持久 shell（`Shell.run`）使用以下状态机：

- **空闲/未初始化**：`session: None`。
- **运行中**：首次 `run()` 延迟创建会话，存储 `current_abort` 令牌，执行命令。
- **完成 + 保活**：如果执行控制流为 `Normal`，则清除 `current_abort` 并复用会话。
- **完成 + 清理**：如果控制流与循环/脚本/shell 退出相关（`BreakLoop`、`ContinueLoop`、`ReturnFromFunctionOrScript`、`ExitShell`），则丢弃会话（`session: None`）。
- **已取消/已超时**：取消运行任务，等待宽限期（2 秒），然后强制中止；会话被丢弃。
- **错误**：会话被丢弃。

一次性 shell（`executeShell`）每次调用始终创建并丢弃一个新会话。

### 流式传输/输出行为

- 标准输出/标准错误被路由到共享管道中并发读取。
- 读取器增量解码 UTF-8；无效字节序列以 `U+FFFD` 替换字符形式输出。
- 进程完成后，输出排空设有空闲/最大保护（`250ms` 空闲，`2s` 最大），以避免后台任务保持描述符打开而导致挂起。

### 取消、超时与后台任务

- `CancelToken` 由 `timeoutMs` 和可选的 `AbortSignal` 构造。
- 取消/超时时，触发 shell 取消令牌，然后任务获得 2 秒宽限窗口后强制中止。
- 如果发生取消，后台任务将使用 brush 作业元数据被终止（先 `TERM`，再延迟 `KILL`）。

`Shell.abort()` 行为：

- 仅中止该 `Shell` 实例当前正在运行的命令，
- 没有运行中命令时为无操作成功。

### 失败行为

常见暴露的错误包括：

- 会话初始化失败（`Failed to initialize shell`），
- cwd 错误（`Failed to set cwd`），
- 环境变量设置/弹出失败，
- 快照源失败，
- 管道创建/克隆失败，
- 执行失败（`Shell execution failed: ...`），
- 任务封装失败（`Shell execution task failed: ...`）。

结果级取消标志：

- 超时 -> `exitCode: undefined`，`timedOut: true`。
- 中止信号 -> `exitCode: undefined`，`cancelled: true`。

## PTY 子系统（`pty`）

### API 模型

`new PtySession()` 暴露：

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### 运行时生命周期与状态转换

`PtySession` 状态机：

- **空闲**：`core: None`。
- **已预留**：`start()` 在异步工作开始前同步安装控制通道（`core: Some`），因此 `write/resize/kill` 立即变为有效。
- **运行中**：阻塞 PTY 循环处理子进程状态、读取器事件、取消心跳和控制消息。
- **终端已关闭**：子进程退出 + 读取器完成。
- **已终结**：`start()` 任务完成后（无论成功或错误），`core` 始终被重置为 `None`。

并发保护：

- 在已运行时启动将返回 `PTY session already running`。

### 创建/附加/写入/读取/终止模式

- PTY 通过 `portable_pty::native_pty_system().openpty(...)` 打开。
- 命令当前以 `sh -lc <command>` 运行，支持可选的 `cwd` 和环境变量覆盖。
- `write()` 向 PTY 标准输入发送原始字节。
- `resize()` 限制尺寸（`cols 20..400`，`rows 5..200`）并调用主端 resize。
- `kill()` 将运行标记为已取消并杀死子进程。

输出路径：

- 专用读取器线程从主端流读取数据，
- 增量 UTF-8 解码，无效字节以 `U+FFFD` 替换，
- 数据块通过 N-API 线程安全回调转发。

### 取消与超时语义

- `timeoutMs` 和 `AbortSignal` 馈入 `CancelToken`。
- 循环周期性调用 `ct.heartbeat()`；中止触发子进程杀死。
- 超时分类基于字符串（心跳错误中的 `"Timeout"` 子串）。

### 失败行为

错误表面包括：

- PTY 分配/打开失败，
- PTY 创建子进程失败，
- 写入器/读取器获取失败，
- 子进程状态/等待失败，
- 锁中毒，
- 控制通道断开连接（`PTY session is no longer available`）。

非运行时的控制调用失败：

- `write/resize/kill` 返回 `PTY session is not running`。

## 进程树子系统（`ps`）

### API 模型

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS 封装器还通过 `setNativeKillTree(native.killTree)` 将原生 kill-tree 实现注册到共享工具中。

### 平台特定实现

- **Linux**：递归读取 `/proc/<pid>/task/<pid>/children`。
- **macOS**：使用 `libproc` 的 `proc_listchildpids`。
- **Windows**：通过 `CreateToolhelp32Snapshot` 快照进程表，构建父->子映射，使用 `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` 终止。

### Kill-tree 行为

- 递归收集后代进程。
- 杀死顺序为自底向上（最深层后代优先），以减少孤儿进程重新挂靠。
- 根 pid 最后被杀死。
- 返回值为成功终止的数量。

信号行为：

- POSIX：提供的 `signal` 传递给 `kill`。
- Windows：`signal` 被忽略；终止为无条件的进程终止。

### 失败行为

此模块在 API 表面有意设计为不抛出异常：

- 缺失/不可访问的进程树分支被跳过，
- 单个 pid 的杀死失败计为不成功（非错误），
- 查找未命中通常从 `listDescendants` 返回 `[]`，从 `killTree` 返回 `0`。

## 按键解析子系统（`keys`）

### API 模型

暴露的辅助函数：

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### 解析模型

解析器组合了：

- 直接单字节映射（`enter`、`tab`、`ctrl+<letter>`、可打印 ASCII），
- O(1) 传统转义序列查找（PHF 映射），
- xterm `modifyOtherKeys` 解析，
- Kitty 协议解析（`CSI u`、`CSI ~`、`CSI 1;...<letter>`），
- 标准化为按键 ID（`ctrl+c`、`shift+tab`、`pageUp`、`f5` 等）。

修饰键处理：

- 按键匹配时仅比较 shift/alt/ctrl 位，
- 比较前屏蔽锁定位。

布局行为：

- 基础布局回退有意受限，以防止重新映射的布局对 ASCII 字母/符号产生误匹配。

### 失败行为

- 无法识别或无效的序列从解析函数返回 `null`。
- 匹配函数在解析失败或不匹配时返回 `false`。
- 对格式错误的按键输入不抛出异常。

## JS 封装器 API ↔ Rust 导出映射

### Shell + PTY + 进程

| TS 封装器 API | Rust N-API 导出 | 说明 |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | 一次性 shell 执行 |
| `new Shell(options?)` | `Shell` class | 持久 shell 会话 |
| `shell.run(options, onChunk?)` | `Shell::run` | 在保活控制流下复用会话 |
| `shell.abort()` | `Shell::abort` | 中止该 shell 实例的活动运行 |
| `new PtySession()` | `PtySession` class | 有状态的 PTY 会话 |
| `pty.start(options, onChunk?)` | `PtySession::start` | 交互式 PTY 运行 |
| `pty.write(data)` | `PtySession::write` | 原始标准输入透传 |
| `pty.resize(cols, rows)` | `PtySession::resize` | 受限的终端尺寸 |
| `pty.kill()` | `PtySession::kill` | 强制杀死活动的 PTY 子进程 |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | 子进程优先的进程树终止 |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | 递归后代列表 |

### 按键

| TS 封装器 API | Rust N-API 导出 | 说明 |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty 码点+修饰键匹配 |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | 标准化按键 ID 解析器 |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | 精确传统序列映射检查 |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | 结构化 Kitty 解析结果 |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | 高级按键匹配器 |

## 废弃会话清理与终结说明

- **Shell 持久会话**：如果运行被取消/超时/出错/非保活控制流，Rust 会显式丢弃内部会话状态。成功的正常运行会保留会话以供复用。
- **PTY 会话**：`start()` 完成后 `core` 始终被清除，包括失败路径。
- 封装器**未暴露显式的 JS 终结器驱动的杀死契约**；清理主要与运行完成/取消路径绑定。调用者应使用 `timeoutMs`、`AbortSignal`、`shell.abort()` 或 `pty.kill()` 进行确定性清理。
