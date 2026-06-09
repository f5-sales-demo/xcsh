---
title: 原生層 Shell、PTY、程序與按鍵內部機制
description: 原生層中的 Shell 執行、PTY 管理、程序生命週期及按鍵事件處理。
sidebar:
  order: 4
  label: Shell、PTY 與程序
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# 原生層 Shell、PTY、程序與按鍵內部機制

本文件涵蓋 `@f5xc-salesdemos/pi-natives` 中的**執行/程序/終端基礎元件**：`shell`、`pty`、`ps` 和 `keys`，使用 `docs/natives-architecture.md` 中的架構術語。

## 實作檔案

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs`（僅限 Windows）
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs`（shell/pty 共用的取消行為）
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

- **TS 包裝器/API 層**（`packages/natives/src/*`）：型別化進入點、取消介面（`timeoutMs`、`AbortSignal`）及 JS 人因工程。
- **Rust N-API 模組層**（`crates/pi-natives/src/*`）：shell/PTY 程序執行、程序樹遍歷/終止，以及按鍵序列解析。
- **驗證閘道**（`native.ts`，架構層級）：確保所需的匯出項（`Shell`、`executeShell`、`PtySession`、`killTree`、`listDescendants`、按鍵輔助函式）在包裝器使用前存在。

## Shell 子系統（`shell`）

### API 模型

提供兩種執行模式：

1. **一次性執行**，透過 `executeShell(options, onChunk?)`。
2. **持久化工作階段**，透過 `new Shell(options?)` 然後重複呼叫 `shell.run(...)`。

兩者皆透過執行緒安全的回呼函式串流輸出，並回傳 `{ exitCode?, cancelled, timedOut }`。

### 工作階段建立與環境模型

Rust 建立 `brush_core::Shell` 時使用：

- 非互動模式，
- `do_not_inherit_env: true`，
- 從主機環境明確重建環境變數，
- 跳過對 shell 敏感的變數清單（`PS1`、`PWD`、`SHLVL`、bash 函式匯出等）。

工作階段環境行為：

- `ShellOptions.sessionEnv` 在工作階段建立時套用一次。
- `ShellRunOptions.env` 是命令範圍的（`EnvironmentScope::Command`），每次執行後會被彈出。
- `PATH` 在 Windows 上以不區分大小寫的去重方式特殊合併。

Windows 專用路徑擴充（`shell/windows.rs`）：發現的 Git-for-Windows 路徑（`cmd`、`bin`、`usr/bin`）若存在且尚未包含，則會被附加。

### 執行時期生命週期與狀態轉換

持久化 shell（`Shell.run`）使用以下狀態機：

- **閒置/未初始化**：`session: None`。
- **執行中**：首次 `run()` 延遲建立工作階段，儲存 `current_abort` 令牌，執行命令。
- **完成 + 保活**：如果執行控制流程為 `Normal`，`current_abort` 被清除且工作階段被重用。
- **完成 + 拆解**：如果控制流程與迴圈/腳本/shell 結束相關（`BreakLoop`、`ContinueLoop`、`ReturnFromFunctionOrScript`、`ExitShell`），工作階段被丟棄（`session: None`）。
- **已取消/已逾時**：執行任務被取消，寬限等待（2 秒），然後強制中止；工作階段被丟棄。
- **錯誤**：工作階段被丟棄。

一次性 shell（`executeShell`）每次呼叫都建立並丟棄全新的工作階段。

### 串流/輸出行為

- 標準輸出/標準錯誤被路由至共用管線並同時讀取。
- 讀取器以遞增方式解碼 UTF-8；無效位元組序列產生 `U+FFFD` 替換字元區塊。
- 程序完成後，輸出排空有閒置/最大值保護（`250ms` 閒置，`2s` 最大），以避免因背景工作持有描述子而導致掛起。

### 取消、逾時與背景工作

- `CancelToken` 由 `timeoutMs` 和可選的 `AbortSignal` 建構。
- 在取消/逾時時，shell 取消令牌被觸發，然後任務獲得 2 秒的寬限視窗後才強制中止。
- 如果發生取消，背景工作會使用 brush 工作中繼資料被終止（`TERM`，然後延遲 `KILL`）。

`Shell.abort()` 行為：

- 僅中止該 `Shell` 實例當前正在執行的命令，
- 當沒有任何命令在執行時，為無操作成功。

### 失敗行為

常見的錯誤訊息包括：

- 工作階段初始化失敗（`Failed to initialize shell`），
- 工作目錄錯誤（`Failed to set cwd`），
- 環境變數設定/彈出失敗，
- 快照來源失敗，
- 管線建立/複製失敗，
- 執行失敗（`Shell execution failed: ...`），
- 任務包裝器失敗（`Shell execution task failed: ...`）。

結果層級的取消旗標：

- 逾時 -> `exitCode: undefined`、`timedOut: true`。
- 中止訊號 -> `exitCode: undefined`、`cancelled: true`。

## PTY 子系統（`pty`）

### API 模型

`new PtySession()` 提供：

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### 執行時期生命週期與狀態轉換

`PtySession` 狀態機：

- **閒置**：`core: None`。
- **已保留**：`start()` 在非同步工作開始前同步安裝控制通道（`core: Some`），因此 `write/resize/kill` 立即變為有效。
- **執行中**：阻塞式 PTY 迴圈處理子程序狀態、讀取器事件、取消心跳和控制訊息。
- **終端關閉**：子程序結束 + 讀取器完成。
- **已定案**：`start()` 任務完成後（無論成功或錯誤），`core` 總是被重設為 `None`。

並行保護：

- 在已經執行中時啟動會回傳 `PTY session already running`。

### 產生/附加/寫入/讀取/終止模式

- PTY 透過 `portable_pty::native_pty_system().openpty(...)` 開啟。
- 命令目前以 `sh -lc <command>` 執行，可選設定 `cwd` 和環境變數覆寫。
- `write()` 將原始位元組送至 PTY 標準輸入。
- `resize()` 夾持尺寸（`cols 20..400`、`rows 5..200`）並呼叫主端調整大小。
- `kill()` 將執行標記為已取消並殺死子程序。

輸出路徑：

- 專用讀取器執行緒從主端串流讀取，
- 遞增式 UTF-8 解碼，無效位元組使用 `U+FFFD` 替換，
- 區塊透過 N-API 執行緒安全回呼轉發。

### 取消與逾時語義

- `timeoutMs` 和 `AbortSignal` 饋入 `CancelToken`。
- 迴圈定期呼叫 `ct.heartbeat()`；中止會觸發子程序殺死。
- 逾時分類基於字串（心跳錯誤中的 `"Timeout"` 子字串）。

### 失敗行為

錯誤介面包括：

- PTY 分配/開啟失敗，
- PTY 產生失敗，
- 寫入器/讀取器取得失敗，
- 子程序狀態/等待失敗，
- 鎖中毒，
- 控制通道斷線（`PTY session is no longer available`）。

非執行中時的控制呼叫失敗：

- `write/resize/kill` 回傳 `PTY session is not running`。

## 程序樹子系統（`ps`）

### API 模型

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS 包裝器還透過 `setNativeKillTree(native.killTree)` 將原生殺程序樹整合註冊至共用工具中。

### 平台特定實作

- **Linux**：遞迴讀取 `/proc/<pid>/task/<pid>/children`。
- **macOS**：使用 `libproc` 的 `proc_listchildpids`。
- **Windows**：使用 `CreateToolhelp32Snapshot` 快照程序表，建立父→子映射，以 `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` 終止。

### 殺程序樹行為

- 子孫程序以遞迴方式收集。
- 殺死順序為由下而上（最深的子孫程序優先），以減少孤兒程序重新歸屬。
- 根程序最後被殺死。
- 回傳值為成功終止的數量。

訊號行為：

- POSIX：提供的 `signal` 被傳遞給 `kill`。
- Windows：`signal` 被忽略；終止為無條件的程序終止。

### 失敗行為

此模組在 API 介面刻意設計為不拋出例外：

- 缺失/無法存取的程序樹分支被跳過，
- 每個 pid 的殺死失敗計為不成功（非錯誤），
- 查詢未命中時，`listDescendants` 通常產生 `[]`，`killTree` 產生 `0`。

## 按鍵解析子系統（`keys`）

### API 模型

提供的輔助函式：

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### 解析模型

解析器結合了：

- 直接的單位元組對應（`enter`、`tab`、`ctrl+<字母>`、可列印 ASCII），
- O(1) 傳統轉義序列查找（PHF 映射表），
- xterm `modifyOtherKeys` 解析，
- Kitty 協定解析（`CSI u`、`CSI ~`、`CSI 1;...<字母>`），
- 正規化為按鍵 ID（`ctrl+c`、`shift+tab`、`pageUp`、`f5` 等）。

修飾鍵處理：

- 按鍵比對時僅比較 shift/alt/ctrl 位元，
- 鎖定位元在比較前會被遮罩掉。

佈局行為：

- 基礎佈局回退刻意受限，使重新映射的佈局不會對 ASCII 字母/符號產生錯誤匹配。

### 失敗行為

- 無法辨識或無效的序列從解析函式產生 `null`。
- 比對函式在解析失敗或不匹配時回傳 `false`。
- 對於格式錯誤的按鍵輸入不會拋出例外。

## JS 包裝器 API ↔ Rust 匯出對應

### Shell + PTY + 程序

| TS 包裝器 API | Rust N-API 匯出 | 備註 |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | 一次性 shell 執行 |
| `new Shell(options?)` | `Shell` class | 持久化 shell 工作階段 |
| `shell.run(options, onChunk?)` | `Shell::run` | 在保活控制流程下重用工作階段 |
| `shell.abort()` | `Shell::abort` | 中止該 shell 實例的活動執行 |
| `new PtySession()` | `PtySession` class | 有狀態的 PTY 工作階段 |
| `pty.start(options, onChunk?)` | `PtySession::start` | 互動式 PTY 執行 |
| `pty.write(data)` | `PtySession::write` | 原始標準輸入透傳 |
| `pty.resize(cols, rows)` | `PtySession::resize` | 夾持的終端尺寸 |
| `pty.kill()` | `PtySession::kill` | 強制殺死活動的 PTY 子程序 |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | 子程序優先的程序樹終止 |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | 遞迴子孫程序列表 |

### 按鍵

| TS 包裝器 API | Rust N-API 匯出 | 備註 |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty 碼點+修飾鍵比對 |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | 正規化按鍵 ID 解析器 |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | 精確傳統序列映射檢查 |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | 結構化 Kitty 解析結果 |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | 高階按鍵比對器 |

## 廢棄工作階段清理與定案注意事項

- **Shell 持久化工作階段**：如果執行被取消/逾時/錯誤/非保活控制流程，Rust 會明確丟棄內部工作階段狀態。成功的正常執行會保留工作階段以供重用。
- **PTY 工作階段**：`start()` 完成後（包括失敗路徑），`core` 總是會被清除。
- 包裝器**未公開明確的 JS 終結器驅動殺死契約**；清理主要繫結於執行完成/取消路徑。呼叫者應使用 `timeoutMs`、`AbortSignal`、`shell.abort()` 或 `pty.kill()` 來進行確定性的拆解。
