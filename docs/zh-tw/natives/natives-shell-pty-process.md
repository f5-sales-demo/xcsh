---
title: 原生層 Shell、PTY、Process 與 Key 內部機制
description: 原生層中的 Shell 執行、PTY 管理、程序生命週期與按鍵事件處理。
sidebar:
  order: 4
  label: Shell、PTY 與 process
i18n:
  sourceHash: 00ea95614c6a
  translator: machine
---

# 原生層 Shell、PTY、Process 與 Key 內部機制

本文件涵蓋 `@f5-sales-demo/pi-natives` 中的**執行/程序/終端基礎元件**：`shell`、`pty`、`ps` 和 `keys`，使用 `docs/natives-architecture.md` 中的架構術語。

## 實作檔案

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs`（僅限 Windows）
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs`（shell/pty 使用的共用取消行為）
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## 層級職責

- **TS 包裝/API 層**（`packages/natives/src/*`）：型別化入口點、取消介面（`timeoutMs`、`AbortSignal`）及 JS 使用便利性。
- **Rust N-API 模組層**（`crates/pi-natives/src/*`）：shell/PTY 程序執行、程序樹遍歷/終止，以及按鍵序列解析。
- **驗證閘道**（`native.ts`，架構層級）：確保所需的匯出項目（`Shell`、`executeShell`、`PtySession`、`killTree`、`listDescendants`、key 輔助函式）在包裝器使用前已存在。

## Shell 子系統（`shell`）

### API 模型

提供兩種執行模式：

1. **一次性執行**，透過 `executeShell(options, onChunk?)`。
2. **持久性工作階段**，透過 `new Shell(options?)` 然後重複呼叫 `shell.run(...)`。

兩者都透過執行緒安全的回呼函式串流輸出，並回傳 `{ exitCode?, cancelled, timedOut }`。

### 工作階段建立與環境模型

Rust 建立 `brush_core::Shell` 時使用：

- 非互動模式，
- `do_not_inherit_env: true`，
- 從主機環境明確重建環境變數，
- 對 shell 敏感變數的跳過清單（`PS1`、`PWD`、`SHLVL`、bash 函式匯出等）。

工作階段環境行為：

- `ShellOptions.sessionEnv` 在工作階段建立時套用一次。
- `ShellRunOptions.env` 是命令範疇（`EnvironmentScope::Command`），每次執行後會被彈出。
- `PATH` 在 Windows 上以不區分大小寫的去重方式進行特殊合併。

Windows 專屬路徑擴充（`shell/windows.rs`）：偵測到的 Git-for-Windows 路徑（`cmd`、`bin`、`usr/bin`）會在存在且尚未包含時附加。

### 執行時期生命週期與狀態轉換

持久性 shell（`Shell.run`）使用以下狀態機：

- **閒置/未初始化**：`session: None`。
- **執行中**：第一次 `run()` 延遲建立工作階段，儲存 `current_abort` 令牌，執行命令。
- **完成 + 保活**：如果執行控制流為 `Normal`，`current_abort` 被清除且工作階段被重複使用。
- **完成 + 拆除**：如果控制流與迴圈/腳本/shell 退出相關（`BreakLoop`、`ContinueLoop`、`ReturnFromFunctionOrScript`、`ExitShell`），工作階段被丟棄（`session: None`）。
- **已取消/已逾時**：執行任務被取消，寬限等待（2 秒），然後強制中止；工作階段被丟棄。
- **錯誤**：工作階段被丟棄。

一次性 shell（`executeShell`）每次呼叫總是建立並丟棄一個新的工作階段。

### 串流/輸出行為

- 標準輸出/標準錯誤被路由到共用管道並同時讀取。
- 讀取器以增量方式解碼 UTF-8；無效的位元組序列會發出 `U+FFFD` 替換字元區塊。
- 程序完成後，輸出排空有閒置/最大保護（`250ms` 閒置，`2s` 最大），以避免因背景工作保持描述子開啟而卡住。

### 取消、逾時與背景工作

- `CancelToken` 由 `timeoutMs` 和可選的 `AbortSignal` 構建。
- 在取消/逾時時，shell 取消令牌被觸發，然後任務獲得 2 秒寬限視窗後強制中止。
- 如果發生取消，背景工作會使用 brush 工作中繼資料被終止（`TERM`，然後延遲 `KILL`）。

`Shell.abort()` 行為：

- 僅中止該 `Shell` 實例當前正在執行的命令，
- 當沒有命令正在執行時為無操作的成功回傳。

### 失敗行為

常見的浮現錯誤包括：

- 工作階段初始化失敗（`Failed to initialize shell`），
- cwd 錯誤（`Failed to set cwd`），
- 環境變數設定/彈出失敗，
- 快照來源失敗，
- 管道建立/複製失敗，
- 執行失敗（`Shell execution failed: ...`），
- 任務包裝器失敗（`Shell execution task failed: ...`）。

結果層級的取消旗標：

- 逾時 -> `exitCode: undefined`，`timedOut: true`。
- 中止訊號 -> `exitCode: undefined`，`cancelled: true`。

## PTY 子系統（`pty`）

### API 模型

`new PtySession()` 公開：

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### 執行時期生命週期與狀態轉換

`PtySession` 狀態機：

- **閒置**：`core: None`。
- **已預留**：`start()` 在非同步工作開始前同步安裝控制通道（`core: Some`），使 `write/resize/kill` 立即可用。
- **執行中**：阻塞式 PTY 迴圈處理子程序狀態、讀取器事件、取消心跳及控制訊息。
- **終端已關閉**：子程序退出 + 讀取器完成。
- **已完成**：`core` 在 start 任務完成後（包括成功或錯誤路徑）總是被重設為 `None`。

並行保護：

- 在已經執行時再次啟動會回傳 `PTY session already running`。

### 產生/附加/寫入/讀取/終止模式

- PTY 透過 `portable_pty::native_pty_system().openpty(...)` 開啟。
- 命令目前以 `sh -lc <command>` 執行，並支援可選的 `cwd` 和環境變數覆蓋。
- `write()` 將原始位元組傳送到 PTY 標準輸入。
- `resize()` 限制維度（`cols 20..400`、`rows 5..200`）並呼叫主端調整大小。
- `kill()` 將執行標記為已取消並終止子程序。

輸出路徑：

- 專用讀取執行緒讀取主端串流，
- 增量式 UTF-8 解碼，對無效位元組使用 `U+FFFD` 替換，
- 區塊透過 N-API 執行緒安全回呼函式轉發。

### 取消與逾時語意

- `timeoutMs` 和 `AbortSignal` 饋入 `CancelToken`。
- 迴圈定期呼叫 `ct.heartbeat()`；中止會觸發子程序終止。
- 逾時分類是基於字串的（心跳錯誤中的 `"Timeout"` 子字串）。

### 失敗行為

錯誤介面包括：

- PTY 配置/開啟失敗，
- PTY 產生失敗，
- 寫入器/讀取器取得失敗，
- 子程序狀態/等待失敗，
- 鎖中毒，
- 控制通道斷線（`PTY session is no longer available`）。

非執行時的控制呼叫失敗：

- `write/resize/kill` 回傳 `PTY session is not running`。

## 程序樹子系統（`ps`）

### API 模型

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS 包裝器也透過 `setNativeKillTree(native.killTree)` 將原生 kill-tree 整合註冊到共用工具中。

### 平台特定實作

- **Linux**：遞迴讀取 `/proc/<pid>/task/<pid>/children`。
- **macOS**：使用 `libproc` 的 `proc_listchildpids`。
- **Windows**：使用 `CreateToolhelp32Snapshot` 快照程序表，建立父子對應表，以 `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` 終止。

### Kill-tree 行為

- 子程序以遞迴方式收集。
- 終止順序為由下而上（最深的子程序優先），以減少孤兒程序重新歸屬。
- 根 pid 最後被終止。
- 回傳值為成功終止的數量。

訊號行為：

- POSIX：提供的 `signal` 傳遞給 `kill`。
- Windows：`signal` 被忽略；終止為無條件程序終止。

### 失敗行為

此模組在 API 介面上有意設計為不拋出例外：

- 缺少/無法存取的程序樹分支會被跳過，
- 每個 pid 的終止失敗計為不成功（非錯誤），
- 查詢未命中通常從 `listDescendants` 產生 `[]`，從 `killTree` 產生 `0`。

## 按鍵解析子系統（`keys`）

### API 模型

公開的輔助函式：

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### 解析模型

解析器結合：

- 直接的單位元組對應（`enter`、`tab`、`ctrl+<letter>`、可列印 ASCII），
- O(1) 傳統跳脫序列查詢（PHF 映射），
- xterm `modifyOtherKeys` 解析，
- Kitty 協定解析（`CSI u`、`CSI ~`、`CSI 1;...<letter>`），
- 正規化為按鍵 ID（`ctrl+c`、`shift+tab`、`pageUp`、`f5` 等）。

修飾鍵處理：

- 按鍵比對時僅比較 shift/alt/ctrl 位元，
- 鎖定位元在比較前會被遮罩掉。

佈局行為：

- 基本佈局回退是有意受限的，使重新對應的佈局不會對 ASCII 字母/符號產生誤匹配。

### 失敗行為

- 無法辨識或無效的序列從解析函式產生 `null`。
- 比對函式在解析失敗或不匹配時回傳 `false`。
- 對於格式錯誤的按鍵輸入不會拋出錯誤。

## JS 包裝器 API ↔ Rust 匯出對應

### Shell + PTY + Process

| TS 包裝器 API | Rust N-API 匯出 | 備註 |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | 一次性 shell 執行 |
| `new Shell(options?)` | `Shell` class | 持久性 shell 工作階段 |
| `shell.run(options, onChunk?)` | `Shell::run` | 在保活控制流上重複使用工作階段 |
| `shell.abort()` | `Shell::abort` | 中止該 shell 實例的活躍執行 |
| `new PtySession()` | `PtySession` class | 有狀態的 PTY 工作階段 |
| `pty.start(options, onChunk?)` | `PtySession::start` | 互動式 PTY 執行 |
| `pty.write(data)` | `PtySession::write` | 原始標準輸入透傳 |
| `pty.resize(cols, rows)` | `PtySession::resize` | 受限的終端維度 |
| `pty.kill()` | `PtySession::kill` | 強制終止活躍的 PTY 子程序 |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | 子程序優先的程序樹終止 |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | 遞迴子程序列表 |

### Keys

| TS 包裝器 API | Rust N-API 匯出 | 備註 |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty 碼點+修飾鍵比對 |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | 正規化按鍵 ID 解析器 |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | 精確傳統序列映射檢查 |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | 結構化 Kitty 解析結果 |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | 高階按鍵比對器 |

## 已放棄的工作階段清理與最終化備註

- **Shell 持久性工作階段**：如果執行被取消/逾時/錯誤/非保活控制流，Rust 會明確丟棄內部工作階段狀態。成功的正常執行會保留工作階段以供重複使用。
- **PTY 工作階段**：`core` 在 `start()` 完成後總是被清除，包括失敗路徑。
- 包裝器**未公開明確的 JS 終結器驅動終止契約**；清理主要繫結於執行完成/取消路徑。呼叫者應使用 `timeoutMs`、`AbortSignal`、`shell.abort()` 或 `pty.kill()` 進行確定性拆除。
