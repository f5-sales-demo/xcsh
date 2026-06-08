---
title: 原生 Shell、PTY、行程與按鍵內部機制
description: 原生層中的 Shell 執行、PTY 管理、行程生命週期與按鍵事件處理。
sidebar:
  order: 4
  label: Shell、PTY 與行程
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# 原生 Shell、PTY、行程與按鍵內部機制

本文件涵蓋 `@f5xc-salesdemos/pi-natives` 中的**執行/行程/終端機基礎元件**：`shell`、`pty`、`ps` 和 `keys`，使用 `docs/natives-architecture.md` 中的架構術語。

## 實作檔案

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs`（僅限 Windows）
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs`（shell/pty 使用的共享取消行為）
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

- **TS 封裝/API 層**（`packages/natives/src/*`）：型別化進入點、取消介面（`timeoutMs`、`AbortSignal`）以及 JS 人體工學設計。
- **Rust N-API 模組層**（`crates/pi-natives/src/*`）：shell/PTY 行程執行、行程樹遍歷/終止以及按鍵序列解析。
- **驗證閘門**（`native.ts`，架構層級）：確保所需的匯出項目（`Shell`、`executeShell`、`PtySession`、`killTree`、`listDescendants`、按鍵輔助函式）在封裝器使用前存在。

## Shell 子系統（`shell`）

### API 模型

公開兩種執行模式：

1. **一次性執行**，透過 `executeShell(options, onChunk?)`。
2. **持久化工作階段**，透過 `new Shell(options?)` 然後重複呼叫 `shell.run(...)`。

兩者都透過執行緒安全回呼串流輸出，並回傳 `{ exitCode?, cancelled, timedOut }`。

### 工作階段建立與環境模型

Rust 建立 `brush_core::Shell` 時使用：

- 非互動模式，
- `do_not_inherit_env: true`，
- 從主機環境明確重建環境變數，
- 跳過 shell 敏感變數的清單（`PS1`、`PWD`、`SHLVL`、bash 函式匯出等）。

工作階段環境行為：

- `ShellOptions.sessionEnv` 在工作階段建立時套用一次。
- `ShellRunOptions.env` 是命令範圍的（`EnvironmentScope::Command`），每次執行後會彈出。
- `PATH` 在 Windows 上以不區分大小寫的去重方式特別合併。

Windows 專用路徑擴充（`shell/windows.rs`）：若發現 Git-for-Windows 路徑（`cmd`、`bin`、`usr/bin`）且尚未包含，則會附加至路徑中。

### 執行時期生命週期與狀態轉換

持久化 shell（`Shell.run`）使用以下狀態機：

- **閒置/未初始化**：`session: None`。
- **執行中**：第一次 `run()` 惰性建立工作階段，儲存 `current_abort` 權杖，執行命令。
- **完成 + 保持存活**：若執行控制流程為 `Normal`，清除 `current_abort` 並重用工作階段。
- **完成 + 拆除**：若控制流程與迴圈/腳本/shell 退出相關（`BreakLoop`、`ContinueLoop`、`ReturnFromFunctionOrScript`、`ExitShell`），則丟棄工作階段（`session: None`）。
- **已取消/已逾時**：取消執行任務，等待寬限期（2 秒），然後強制中止；丟棄工作階段。
- **錯誤**：丟棄工作階段。

一次性 shell（`executeShell`）每次呼叫都會建立並丟棄全新的工作階段。

### 串流/輸出行為

- 標準輸出/標準錯誤被路由至共享管道並同時讀取。
- 讀取器以增量方式解碼 UTF-8；無效的位元組序列會產生 `U+FFFD` 替換區塊。
- 行程完成後，輸出排放有閒置/最大守衛（`250ms` 閒置，`2s` 最大），以避免在背景工作保持描述符開啟時卡住。

### 取消、逾時與背景工作

- `CancelToken` 由 `timeoutMs` 和可選的 `AbortSignal` 構建。
- 在取消/逾時時，觸發 shell 取消權杖，然後任務獲得 2 秒寬限視窗後才強制中止。
- 若發生取消，背景工作會使用 brush 工作中繼資料被終止（先 `TERM`，延遲後再 `KILL`）。

`Shell.abort()` 行為：

- 僅中止該 `Shell` 實例目前正在執行的命令，
- 沒有正在執行的命令時為無操作成功。

### 失敗行為

常見的浮現錯誤包括：

- 工作階段初始化失敗（`Failed to initialize shell`），
- 工作目錄錯誤（`Failed to set cwd`），
- 環境設定/彈出失敗，
- 快照來源失敗，
- 管道建立/複製失敗，
- 執行失敗（`Shell execution failed: ...`），
- 任務封裝失敗（`Shell execution task failed: ...`）。

結果層級的取消旗標：

- 逾時 -> `exitCode: undefined`、`timedOut: true`。
- 中止訊號 -> `exitCode: undefined`、`cancelled: true`。

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
- **已保留**：`start()` 在非同步工作開始前同步安裝控制通道（`core: Some`），因此 `write/resize/kill` 立即變為有效。
- **執行中**：阻塞式 PTY 迴圈處理子行程狀態、讀取器事件、取消心跳和控制訊息。
- **終端機已關閉**：子行程退出 + 讀取器完成。
- **已最終化**：`start()` 任務完成後（包括成功或錯誤），`core` 始終重設為 `None`。

並行防護：

- 已在執行中時再次啟動會回傳 `PTY session already running`。

### 生成/附加/寫入/讀取/終止模式

- PTY 透過 `portable_pty::native_pty_system().openpty(...)` 開啟。
- 命令目前以 `sh -lc <command>` 執行，可選擇性設定 `cwd` 和環境覆寫。
- `write()` 將原始位元組傳送至 PTY 標準輸入。
- `resize()` 將維度限制在範圍內（`cols 20..400`、`rows 5..200`）並呼叫主端調整大小。
- `kill()` 將執行標記為已取消並終止子行程。

輸出路徑：

- 專用讀取器執行緒讀取主端串流，
- 以增量方式解碼 UTF-8，無效位元組使用 `U+FFFD` 替換，
- 區塊透過 N-API 執行緒安全回呼轉發。

### 取消與逾時語意

- `timeoutMs` 和 `AbortSignal` 饋入 `CancelToken`。
- 迴圈定期呼叫 `ct.heartbeat()`；中止會觸發子行程終止。
- 逾時分類基於字串（心跳錯誤中的 `"Timeout"` 子字串）。

### 失敗行為

錯誤介面包括：

- PTY 分配/開啟失敗，
- PTY 生成失敗，
- 寫入器/讀取器取得失敗，
- 子行程狀態/等待失敗，
- 鎖中毒，
- 控制通道斷開（`PTY session is no longer available`）。

非執行中時的控制呼叫失敗：

- `write/resize/kill` 回傳 `PTY session is not running`。

## 行程樹子系統（`ps`）

### API 模型

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS 封裝器也透過 `setNativeKillTree(native.killTree)` 將原生終止樹整合註冊至共享工具程式。

### 平台特定實作

- **Linux**：遞迴讀取 `/proc/<pid>/task/<pid>/children`。
- **macOS**：使用 `libproc` 的 `proc_listchildpids`。
- **Windows**：使用 `CreateToolhelp32Snapshot` 建立行程表快照，建構父->子對應表，以 `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` 終止。

### 終止樹行為

- 遞迴收集子孫行程。
- 終止順序為由下而上（最深的子孫先終止），以減少孤兒行程的重新掛載。
- 根 pid 最後終止。
- 回傳值為成功終止的數量。

訊號行為：

- POSIX：提供的 `signal` 會傳遞給 `kill`。
- Windows：`signal` 被忽略；終止為無條件的行程終止。

### 失敗行為

此模組在 API 介面上刻意設計為不拋出例外：

- 缺失/無法存取的行程樹分支會被跳過，
- 每個 pid 的終止失敗計為不成功（非錯誤），
- 查詢未命中時，`listDescendants` 通常產生 `[]`，`killTree` 產生 `0`。

## 按鍵解析子系統（`keys`）

### API 模型

公開的輔助函式：

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### 解析模型

解析器結合了：

- 直接的單位元組對應（`enter`、`tab`、`ctrl+<letter>`、可列印 ASCII），
- O(1) 傳統跳脫序列查詢（PHF 雜湊表），
- xterm `modifyOtherKeys` 解析，
- Kitty 協定解析（`CSI u`、`CSI ~`、`CSI 1;...<letter>`），
- 正規化為按鍵 ID（`ctrl+c`、`shift+tab`、`pageUp`、`f5` 等）。

修飾鍵處理：

- 按鍵比對時僅比較 shift/alt/ctrl 位元，
- 比較前會遮罩掉鎖定鍵位元。

鍵盤配置行為：

- 基礎配置後備機制刻意受限，使重新對應的配置不會對 ASCII 字母/符號產生錯誤匹配。

### 失敗行為

- 無法辨識或無效的序列從解析函式產生 `null`。
- 匹配函式在解析失敗或不匹配時回傳 `false`。
- 對於格式錯誤的按鍵輸入，不會拋出錯誤。

## JS 封裝器 API ↔ Rust 匯出對應

### Shell + PTY + 行程

| TS 封裝器 API | Rust N-API 匯出 | 備註 |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | 一次性 shell 執行 |
| `new Shell(options?)` | `Shell` class | 持久化 shell 工作階段 |
| `shell.run(options, onChunk?)` | `Shell::run` | 在保持存活控制流程時重用工作階段 |
| `shell.abort()` | `Shell::abort` | 中止該 shell 實例的進行中執行 |
| `new PtySession()` | `PtySession` class | 有狀態的 PTY 工作階段 |
| `pty.start(options, onChunk?)` | `PtySession::start` | 互動式 PTY 執行 |
| `pty.write(data)` | `PtySession::write` | 原始標準輸入透傳 |
| `pty.resize(cols, rows)` | `PtySession::resize` | 限制範圍的終端機維度 |
| `pty.kill()` | `PtySession::kill` | 強制終止進行中的 PTY 子行程 |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | 子行程優先的行程樹終止 |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | 遞迴子孫行程列表 |

### 按鍵

| TS 封裝器 API | Rust N-API 匯出 | 備註 |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty 碼位+修飾鍵匹配 |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | 正規化按鍵 ID 解析器 |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | 精確傳統序列對應表檢查 |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | 結構化 Kitty 解析結果 |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | 高階按鍵匹配器 |

## 已棄用工作階段清理與最終化備註

- **Shell 持久化工作階段**：若執行被取消/逾時/錯誤/非保持存活控制流程，Rust 會明確丟棄內部工作階段狀態。成功的正常執行會保留工作階段以供重用。
- **PTY 工作階段**：`start()` 完成後（包括失敗路徑），`core` 始終會被清除。
- 封裝器**未公開明確的 JS 最終化器驅動的終止契約**；清理主要綁定在執行完成/取消路徑。呼叫者應使用 `timeoutMs`、`AbortSignal`、`shell.abort()` 或 `pty.kill()` 進行確定性拆除。
