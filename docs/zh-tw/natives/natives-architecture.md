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

`@f5xc-salesdemos/pi-natives` 是一個三層架構：

1. **TypeScript 包裝/API 層** 提供穩定的 JS/TS 進入點。
2. **附加模組載入/驗證層** 為當前執行環境解析並驗證 `.node` 二進位檔。
3. **Rust N-API 模組層** 實作匯出至 JS 的效能關鍵基礎元件。

本文件是更深入模組級文件的基礎。

## 實作檔案

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## 第 1 層：TypeScript 包裝/API 層

`packages/natives/src/index.ts` 是公開的彙總匯出檔案。它依功能領域分組匯出，並重新匯出具型別的包裝函式，而非直接暴露原始 N-API 繫結。

目前的頂層分組：

- **搜尋/文字基礎元件**：`grep`、`glob`、`text`、`highlight`
- **執行/程序/終端機基礎元件**：`shell`、`pty`、`ps`、`keys`
- **系統/媒體/轉換基礎元件**：`image`、`html`、`clipboard`、`system-info`、`work`

`packages/natives/src/bindings.ts` 定義基礎介面契約：

- `NativeBindings` 以共用成員開始（`cancelWork(id: number)`）
- 模組特定繫結透過各模組的 `types.ts` 以宣告合併方式加入
- `Cancellable` 標準化了逾時和中止訊號選項，供暴露取消功能的包裝函式使用

**保證契約（API 面向）：** 消費者從 `@f5xc-salesdemos/pi-natives` 匯入並使用具型別的包裝函式。

**實作細節（可能變更）：** 宣告合併和內部包裝佈局（`src/<module>/index.ts`、`src/<module>/types.ts`）。

## 第 2 層：附加模組載入與驗證

`packages/natives/src/native.ts` 負責執行階段附加模組選擇、選擇性解壓縮，以及匯出驗證。

### 候選解析模型

- 平台標籤為 `"${process.platform}-${process.arch}"`。
- 目前支援的標籤為：
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 可使用 CPU 變體：
  - `modern`（支援 AVX2）
  - `baseline`（備援方案）
- 非 x64 使用預設檔名（無變體後綴）。

檔名策略：

- 發行版：`pi_natives.<platform>-<arch>.node`
- x64 變體發行版：`pi_natives.<platform>-<arch>-modern.node` 和/或 `...-baseline.node`
- `PI_DEV` 啟用載入器診斷資訊，但不會更改附加模組檔名

### 平台特定變體偵測

對於 x64，變體選擇使用：

- **Linux**：`/proc/cpuinfo`
- **macOS**：`sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**：PowerShell 檢查 `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` 可明確強制使用 `modern` 或 `baseline`。

### 二進位檔分發與解壓縮模型

`packages/natives/package.json` 在發佈檔案中包含 `src` 和 `native`。`native/` 目錄儲存預建置的平台產物。

對於已編譯二進位檔（`PI_COMPILED` 或 Bun 嵌入式執行環境標記），載入器行為為：

1. 檢查版本化使用者快取路徑：`<getNativesDir()>/<packageVersion>/...`
2. 檢查舊版已編譯二進位檔位置：
   - Windows：`%LOCALAPPDATA%/xcsh`（備援 `%USERPROFILE%/AppData/Local/xcsh`）
   - 非 Windows：`~/.local/bin`
3. 回退至套件內的 `native/` 和可執行檔目錄候選

若存在嵌入式附加模組清單（由 `scripts/embed-native.ts` 產生的 `embedded-addon.ts`），`native.ts` 可在載入前將匹配的嵌入式二進位檔具體化至版本化快取目錄。

### 驗證與失敗模式

在 `require(candidate)` 之後，`validateNative(...)` 會驗證必要的匯出（例如 `grep`、`glob`、`highlightCode`、`PtySession`、`Shell`、`getSystemInfo`、`getWorkProfile`、`invalidateFsScanCache`）。

失敗路徑是明確的：

- **不支援的平台標籤**：拋出錯誤並附上支援的平台清單
- **無可載入的候選**：拋出錯誤並附上所有嘗試過的路徑和修復建議
- **缺少匯出**：拋出錯誤並附上確切缺少的名稱和重建命令
- **嵌入式解壓縮錯誤**：記錄目錄/寫入失敗並將其包含在最終載入診斷資訊中

**保證契約（API 面向）：** 附加模組載入要嘛以經驗證的繫結集成功，要嘛以可操作的錯誤訊息快速失敗。

**實作細節（可能變更）：** 確切的候選搜尋順序和已編譯二進位檔備援路徑排序。

## 第 3 層：Rust N-API 模組層

`crates/pi-natives/src/lib.rs` 是宣告匯出模組所有權的 Rust 入口模組：

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

這些模組實作由 `native.ts` 消費和驗證的 N-API 符號。JS 層級名稱透過 `packages/natives/src` 中的 TS 包裝函式呈現。

**保證契約（API 面向）：** Rust 模組匯出必須與 `validateNative` 和包裝模組預期的繫結名稱相符。

**實作細節（可能變更）：** 內部 Rust 模組分解和輔助模組邊界（`glob_util`、`task` 等）。

## 所有權邊界

在架構層級，所有權劃分如下：

- **TS 包裝/API 所有權（`packages/natives/src`）**
  - 公開 API 分組、選項型別定義，以及穩定的 JS 人體工學設計
  - 向呼叫者暴露的取消介面（`timeoutMs`、`AbortSignal`）
- **載入器所有權（`packages/natives/src/native.ts`）**
  - 執行階段二進位檔選擇
  - CPU 變體選擇和覆寫處理
  - 已編譯二進位檔解壓縮和候選探測
  - 必要原生匯出的嚴格驗證
- **Rust 所有權（`crates/pi-natives/src`）**
  - 演算法和系統層級實作
  - 平台原生行為和效能敏感邏輯
  - TS 包裝函式消費的 N-API 符號實作

## 執行流程（高層級）

1. 消費者從 `@f5xc-salesdemos/pi-natives` 匯入。
2. 包裝模組呼叫單例 `native` 繫結。
3. `native.ts` 為平台/架構/變體選擇候選二進位檔。
4. 對於已編譯分發版本，執行選擇性嵌入式二進位檔解壓縮。
5. 載入附加模組並驗證匯出集。
6. 包裝函式向呼叫者回傳具型別的結果。

## 詞彙表

- **原生附加模組**：透過 Node-API（N-API）載入的 `.node` 二進位檔。
- **平台標籤**：執行階段元組 `platform-arch`（例如 `darwin-arm64`）。
- **變體**：x64 CPU 特定建置版本（`modern` AVX2、`baseline` 備援方案）。
- **包裝函式**：在原始原生匯出上提供具型別 API 的 TS 函式/類別。
- **宣告合併**：模組 `types.ts` 檔案用來擴展 `NativeBindings` 的 TS 技術。
- **已編譯二進位檔模式**：CLI 被打包且原生附加模組從解壓縮/快取路徑而非僅套件本地路徑解析的執行模式。
- **嵌入式附加模組**：產生至 `embedded-addon.ts` 的建置產物中繼資料和檔案參考，使已編譯二進位檔可以解壓縮匹配的 `.node` 載荷。
- **驗證閘門**：`validateNative(...)` 檢查，拒絕缺少必要匯出的過時/不匹配二進位檔。
