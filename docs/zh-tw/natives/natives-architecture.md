---
title: 原生模組架構
description: Rust N-API 原生附加模組架構，橋接 TypeScript 與平台特定操作。
sidebar:
  order: 1
  label: 架構
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# 原生模組架構

`@f5xc-salesdemos/pi-natives` 是一個三層堆疊架構：

1. **TypeScript 封裝/API 層** 提供穩定的 JS/TS 進入點。
2. **附加模組載入/驗證層** 為目前的執行環境解析並驗證 `.node` 二進位檔。
3. **Rust N-API 模組層** 實作匯出至 JS 的效能關鍵原語。

本文件是更深入模組層級文件的基礎。

## 實作檔案

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## 第 1 層：TypeScript 封裝/API 層

`packages/natives/src/index.ts` 是公開的桶狀檔案（barrel）。它依功能領域分組匯出，並重新匯出具型別的封裝，而非直接暴露原始的 N-API 綁定。

目前的頂層分組：

- **搜尋/文字原語**：`grep`、`glob`、`text`、`highlight`
- **執行/程序/終端原語**：`shell`、`pty`、`ps`、`keys`
- **系統/媒體/轉換原語**：`image`、`html`、`clipboard`、`system-info`、`work`

`packages/natives/src/bindings.ts` 定義了基礎介面契約：

- `NativeBindings` 以共用成員開始（`cancelWork(id: number)`）
- 模組特定的綁定由各模組的 `types.ts` 透過宣告合併（declaration merging）加入
- `Cancellable` 標準化了逾時和中止信號選項，供公開取消功能的封裝使用

**保證契約（API 面向）：** 使用者從 `@f5xc-salesdemos/pi-natives` 匯入並使用具型別的封裝。

**實作細節（可能變更）：** 宣告合併和內部封裝佈局（`src/<module>/index.ts`、`src/<module>/types.ts`）。

## 第 2 層：附加模組載入與驗證

`packages/natives/src/native.ts` 負責執行期附加模組的選擇、選擇性解壓縮，以及匯出驗證。

### 候選項解析模型

- 平台標籤為 `"${process.platform}-${process.arch}"`。
- 目前支援的標籤為：
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 可使用 CPU 變體：
  - `modern`（支援 AVX2）
  - `baseline`（後備方案）
- 非 x64 使用預設檔名（無變體後綴）。

檔名策略：

- 發行版：`pi_natives.<platform>-<arch>.node`
- x64 變體發行版：`pi_natives.<platform>-<arch>-modern.node` 和/或 `...-baseline.node`
- `PI_DEV` 啟用載入器診斷資訊，但不會變更附加模組檔名

### 平台特定變體偵測

對於 x64，變體選擇使用：

- **Linux**：`/proc/cpuinfo`
- **macOS**：`sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**：PowerShell 檢查 `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` 可明確強制使用 `modern` 或 `baseline`。

### 二進位檔分發與解壓縮模型

`packages/natives/package.json` 在發佈的檔案中同時包含 `src` 和 `native`。`native/` 目錄儲存預建的平台產物。

對於編譯後的二進位檔（`PI_COMPILED` 或 Bun 嵌入式執行環境標記），載入器行為如下：

1. 檢查有版本號的使用者快取路徑：`<getNativesDir()>/<packageVersion>/...`
2. 檢查舊版編譯二進位檔位置：
   - Windows：`%LOCALAPPDATA%/xcsh`（後備 `%USERPROFILE%/AppData/Local/xcsh`）
   - 非 Windows：`~/.local/bin`
3. 退回至套件內的 `native/` 和可執行檔目錄候選項

如果存在嵌入式附加模組清單（由 `scripts/embed-native.ts` 產生的 `embedded-addon.ts`），`native.ts` 可以在載入前將匹配的嵌入式二進位檔具現化到有版本號的快取目錄中。

### 驗證與失敗模式

在 `require(candidate)` 之後，`validateNative(...)` 會驗證必要的匯出（例如 `grep`、`glob`、`highlightCode`、`PtySession`、`Shell`、`getSystemInfo`、`getWorkProfile`、`invalidateFsScanCache`）。

失敗路徑是明確的：

- **不支援的平台標籤**：拋出錯誤並列出支援的平台清單
- **無可載入的候選項**：拋出錯誤並列出所有嘗試的路徑及修復提示
- **缺少匯出**：拋出錯誤並列出確切缺少的名稱及重建命令
- **嵌入式解壓縮錯誤**：記錄目錄/寫入失敗，並將其包含在最終載入診斷資訊中

**保證契約（API 面向）：** 附加模組載入要麼成功並提供經過驗證的綁定集，要麼快速失敗並提供可採取行動的錯誤文字。

**實作細節（可能變更）：** 確切的候選項搜尋順序和編譯二進位檔後備路徑排序。

## 第 3 層：Rust N-API 模組層

`crates/pi-natives/src/lib.rs` 是 Rust 進入模組，宣告匯出的模組所有權：

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

這些模組實作了由 `native.ts` 使用和驗證的 N-API 符號。JS 層級的名稱透過 `packages/natives/src` 中的 TS 封裝呈現。

**保證契約（API 面向）：** Rust 模組匯出必須與 `validateNative` 和封裝模組預期的綁定名稱相符。

**實作細節（可能變更）：** 內部 Rust 模組分解和輔助模組邊界（`glob_util`、`task` 等）。

## 所有權邊界

在架構層級，所有權劃分如下：

- **TS 封裝/API 所有權（`packages/natives/src`）**
  - 公開 API 分組、選項型別定義，以及穩定的 JS 人體工學設計
  - 向呼叫者公開取消介面（`timeoutMs`、`AbortSignal`）
- **載入器所有權（`packages/natives/src/native.ts`）**
  - 執行期二進位檔選擇
  - CPU 變體選擇與覆蓋處理
  - 編譯二進位檔解壓縮與候選項探測
  - 必要原生匯出的嚴格驗證
- **Rust 所有權（`crates/pi-natives/src`）**
  - 演算法和系統層級實作
  - 平台原生行為和效能敏感邏輯
  - TS 封裝所使用的 N-API 符號實作

## 執行流程（高層級）

1. 使用者從 `@f5xc-salesdemos/pi-natives` 匯入。
2. 封裝模組呼叫單例 `native` 綁定。
3. `native.ts` 為平台/架構/變體選擇候選二進位檔。
4. 對於編譯分發版本，進行選擇性的嵌入式二進位檔解壓縮。
5. 載入附加模組並驗證匯出集。
6. 封裝向呼叫者回傳具型別的結果。

## 術語表

- **原生附加模組（Native addon）**：透過 Node-API (N-API) 載入的 `.node` 二進位檔。
- **平台標籤（Platform tag）**：執行期元組 `platform-arch`（例如 `darwin-arm64`）。
- **變體（Variant）**：x64 CPU 特定的建構風格（`modern` AVX2、`baseline` 後備方案）。
- **封裝（Wrapper）**：在原始原生匯出之上提供具型別 API 的 TS 函式/類別。
- **宣告合併（Declaration merging）**：模組 `types.ts` 檔案用來擴展 `NativeBindings` 的 TS 技術。
- **編譯二進位檔模式（Compiled binary mode）**：CLI 被打包的執行模式，原生附加模組從解壓縮/快取路徑解析，而非僅從套件本地路徑解析。
- **嵌入式附加模組（Embedded addon）**：產生到 `embedded-addon.ts` 中的建構產物中繼資料和檔案參照，使編譯後的二進位檔能夠解壓縮匹配的 `.node` 載荷。
- **驗證閘道（Validation gate）**：`validateNative(...)` 檢查，用於拒絕過時/不匹配且缺少必要匯出的二進位檔。
