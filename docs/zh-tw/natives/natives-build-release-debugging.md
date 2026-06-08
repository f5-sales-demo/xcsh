---
title: 原生套件建置、發布與除錯操作手冊
description: Rust 原生附加元件跨平台建置、發布與除錯操作手冊。
sidebar:
  order: 8
  label: 建置、發布與除錯
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# 原生套件建置、發布與除錯操作手冊

本操作手冊說明 `@f5xc-salesdemos/pi-natives` 建置流程如何產生 `.node` 附加元件、編譯後的發行版如何載入這些元件，以及如何除錯載入器/建置失敗問題。

本文遵循 `docs/natives-architecture.md` 中的架構術語：

- **建置時期成品產生** (`scripts/build-native.ts`)
- **內嵌附加元件清單產生** (`scripts/embed-native.ts`)
- **執行時期附加元件載入 + 驗證閘道** (`src/native.ts`)

## 實作檔案

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## 建置流程概觀

### 1) 建置進入點

`packages/natives/package.json` 腳本：

- `bun scripts/build-native.ts` (`build`) → 發布版建置
- `bun scripts/build-native.ts --dev` (`dev:native`) → 除錯/開發設定檔建置（相同的輸出命名）
- `bun scripts/embed-native.ts` (`embed:native`) → 從建置檔案產生 `src/embedded-addon.ts`

### 2) Rust 成品建置

`build-native.ts` 在 `crates/pi-natives` 中執行 Cargo：

- 基本指令：`cargo build`
- 發布模式會加入 `--release`，除非傳入 `--dev`
- 跨平台目標會加入 `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` 宣告 `crate-type = ["cdylib"]`，因此 Cargo 會輸出共享函式庫（`.so`/`.dylib`/`.dll`），然後複製/重新命名為 `.node` 附加元件檔名。

### 3) 成品探索與安裝

Cargo 完成後，`build-native.ts` 依序掃描候選輸出目錄：

1. `${CARGO_TARGET_DIR}`（如有設定）
2. `<repo>/target`
3. `crates/pi-natives/target`

對於每個根目錄，它會檢查設定檔目錄：

- 跨平台建置：`<root>/<crossTarget>/<profile>` 然後 `<root>/<profile>`
- 本機建置：`<root>/<profile>`

然後尋找以下其中之一：

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

找到後，會以暫存檔 + 重新命名的語義原子性安裝到 `packages/natives/native/`（Windows 備援方案會明確處理鎖定的 DLL 替換失敗）。

## 目標/變體模型與命名慣例

## 平台標籤

建置和執行時期都使用平台標籤：

`<platform>-<arch>`（範例：`darwin-arm64`、`linux-x64`）

## 變體模型（僅限 x64）

x64 支援 CPU 變體：

- `modern`（支援 AVX2 的路徑）
- `baseline`（備援）

非 x64 使用單一預設成品（無變體後綴）。

### 輸出檔名

發布版建置：

- x64：`pi_natives.<platform>-<arch>-modern.node` 或 `...-baseline.node`
- 非 x64：`pi_natives.<platform>-<arch>.node`

開發版建置（`--dev`）：

- 使用除錯設定檔旗標但保持標準的平台標籤輸出命名

`native.ts` 中執行時期載入器候選順序：

- 發布版候選
- 編譯模式會在套件本機檔案之前優先使用解壓/快取候選

## 環境旗標與建置選項

## 執行時期旗標

- `PI_DEV`（載入器行為）：啟用載入器診斷
- `PI_NATIVE_VARIANT`（載入器行為，僅限 x64）：在執行時期強制選擇 `modern` 或 `baseline`
- `PI_COMPILED`（載入器行為）：啟用編譯二進位檔候選/解壓行為

## 建置時期旗標/選項

- `--dev`（腳本參數）：建置除錯設定檔
- `CROSS_TARGET`：傳遞給 Cargo `--target`
- `TARGET_PLATFORM`：覆寫輸出平台標籤命名
- `TARGET_ARCH`：覆寫輸出架構命名
- `TARGET_VARIANT`（僅限 x64）：強制輸出檔名和 RUSTFLAGS 策略使用 `modern` 或 `baseline`
- `CARGO_TARGET_DIR`：搜尋 Cargo 輸出時的額外根目錄
- `RUSTFLAGS`：
  - 如未設定且非跨平台編譯，腳本會設定：
    - modern：`-C target-cpu=x86-64-v3`
    - baseline：`-C target-cpu=x86-64-v2`
    - 非 x64 / 無變體：`-C target-cpu=native`
  - 如已設定，腳本不會覆寫

## 建置狀態/生命週期轉換

### 建置生命週期（`build-native.ts`）

1. **初始化**：解析參數/環境（`--dev`、目標覆寫、跨平台旗標）
2. **變體解析**：
   - 非 x64 → 無變體
   - x64 + `TARGET_VARIANT` → 明確變體
   - x64 跨平台建置但無 `TARGET_VARIANT` → 強制錯誤
   - x64 本機建置且無覆寫 → 偵測主機 AVX2
3. **編譯**：以解析的設定檔/目標執行 Cargo
4. **定位成品**：掃描目標根目錄/設定檔目錄/函式庫名稱
5. **安裝**：複製 + 原子性重新命名到 `packages/natives/native`
6. **完成**：附加元件準備就緒供載入器候選使用

任何階段失敗都會退出並顯示明確的錯誤文字（無效變體、cargo 建置失敗、找不到輸出函式庫、安裝/重新命名失敗）。

### 內嵌生命週期（`embed-native.ts`）

1. **初始化**：從 `TARGET_PLATFORM`/`TARGET_ARCH` 或主機值計算平台標籤
2. **候選集合**：
   - x64 預期同時有 `modern` 和 `baseline`
   - 非 x64 預期有一個預設檔案
3. **驗證 `packages/natives/native` 中的可用性**
4. **產生清單**（`src/embedded-addon.ts`）包含 Bun `file` 匯入和套件版本
5. **執行時期解壓準備就緒**供編譯模式使用

`--reset` 會略過驗證並寫入空清單存根（`embeddedAddon = null`）。

## 開發工作流程 vs 出貨/編譯行為

## 本機開發工作流程

典型的本機迴圈：

1. 建置附加元件：
   - 發布版：`bun --cwd=packages/natives run build`
   - 除錯設定檔：`bun --cwd=packages/natives run dev:native`
2. 測試載入器診斷時設定 `PI_DEV=1`
3. `native.ts` 中的載入器解析套件本機 `native/`（以及可執行檔目錄備援）候選
4. `validateNative` 在包裝器使用綁定之前強制執行匯出相容性

## 出貨/編譯二進位檔工作流程

在編譯模式中（`PI_COMPILED` 或 Bun 內嵌標記）：

1. 載入器計算版本化快取目錄：`<getNativesDir()>/<packageVersion>`（操作上為 `~/.xcsh/natives/<version>`）
2. 如果內嵌清單符合當前平台+版本，載入器可能會將選取的內嵌檔案解壓到該版本化目錄
3. 執行時期候選順序包括：
   - 版本化快取目錄
   - 舊版編譯二進位檔目錄（Windows 上為 `%LOCALAPPDATA%/xcsh`，其他系統為 `~/.local/bin`）
   - 套件/可執行檔目錄
4. 第一個成功載入的附加元件仍必須通過 `validateNative`

這就是為什麼打包 + 執行時期載入器預期必須一致：檔名、平台標籤和匯出符號必須符合 `native.ts` 探測和驗證的內容。

## JS API ↔ Rust 匯出對應（驗證閘道子集）

`native.ts` 要求載入的附加元件上必須存在這些 JS 可見匯出。它們對應到 `crates/pi-natives/src` 中的 Rust N-API 匯出：

| `validateNative` 要求的 JS 名稱 | Rust 匯出宣告 | Rust 原始檔 |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)`（駝峰式匯出） | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

如果任何必要符號遺失，載入器會快速失敗並提示重新建置。

## 失敗行為與診斷

## 建置時期失敗

- 無效的變體設定：
  - 在非 x64 上設定 `TARGET_VARIANT` → 立即錯誤
  - x64 跨平台建置但無明確 `TARGET_VARIANT` → 立即錯誤
- Cargo 建置失敗：
  - 腳本顯示非零退出碼和 stderr
- 找不到成品：
  - 腳本印出每個檢查過的設定檔目錄
- 安裝失敗：
  - 明確訊息；Windows 包含檔案鎖定提示

## 執行時期載入器失敗（`native.ts`）

- 不支援的平台標籤：
  - 拋出錯誤並列出支援的平台清單
- 沒有候選可以載入：
  - 拋出錯誤並列出完整的候選錯誤清單和模式特定的修復提示
- 遺失匯出：
  - 拋出錯誤並列出確切的遺失符號名稱和重新建置指令
- 內嵌解壓問題：
  - 解壓 mkdir/write 錯誤會被記錄並包含在最終診斷中

## 疑難排解對照表

| 症狀 | 可能原因 | 驗證方式 | 修復方式 |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | 過時的 `.node` 二進位檔、Rust 匯出名稱不符，或載入了錯誤的二進位檔 | 使用 `PI_DEV=1` 執行以查看載入路徑；檢查該檔案的匯出清單 | 重新建置 `build`；確保 Rust `#[napi]` 匯出名稱（或需要時的明確別名）符合 JS 鍵；移除過時的快取/版本化檔案 |
| x64 機器在預期 modern 時載入 baseline | `PI_NATIVE_VARIANT=baseline`、未偵測到 AVX2，或只有 baseline 檔案存在 | 檢查 `PI_NATIVE_VARIANT`；檢查 `native/` 中的 `-modern` 檔案 | 建置 modern 變體（`TARGET_VARIANT=modern ... build`）並確保檔案已出貨 |
| 跨平台建置產生無法使用/標籤錯誤的二進位檔 | `CROSS_TARGET` 與 `TARGET_PLATFORM`/`TARGET_ARCH` 不符，或 x64 缺少 `TARGET_VARIANT` | 確認環境變數組合和輸出檔名 | 使用一致的環境變數值和明確的 x64 `TARGET_VARIANT` 重新執行 |
| 升級後編譯二進位檔失敗 | 過時的解壓快取（`~/.xcsh/natives/<old-or-mismatched-version>`）或內嵌清單不符 | 檢查版本化原生套件目錄和載入器錯誤清單 | 刪除該套件版本的版本化原生套件快取並重新執行；在打包期間重新產生內嵌清單 |
| 載入器探測多個路徑但都沒有成功 | 平台不符或套件 `native/` 中缺少發布版成品 | 檢查 `platformTag` vs 實際檔名 | 確保建置的檔名完全符合 `pi_natives.<platform>-<arch>(-variant).node` 慣例且套件包含 `native/` |
| `embed:native` 失敗並顯示 "Incomplete native addons" | 內嵌之前未建置所需的變體檔案 | 檢查錯誤文字中預期 vs 找到的清單 | 先建置所需檔案（x64：modern+baseline 兩者；非 x64：預設），然後重新執行 `embed:native` |

## 操作指令

```bash
# 當前主機的發布版成品
bun --cwd=packages/natives run build

# 除錯設定檔成品建置
bun --cwd=packages/natives run dev:native

# 建置明確的 x64 變體
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# 從建置的原生檔案產生內嵌附加元件清單
bun --cwd=packages/natives run embed:native

# 將內嵌清單重設為空存根
bun --cwd=packages/natives run embed:native -- --reset
```
