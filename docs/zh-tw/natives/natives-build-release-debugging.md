---
title: 原生模組建置、發佈與除錯操作手冊
description: 跨平台 Rust 原生附加模組的建置、發佈與除錯操作手冊。
sidebar:
  order: 8
  label: 建置、發佈與除錯
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# 原生模組建置、發佈與除錯操作手冊

本操作手冊描述 `@f5xc-salesdemos/pi-natives` 建置管線如何產生 `.node` 附加模組、編譯後的發行版如何載入它們，以及如何除錯載入器/建置失敗的問題。

本文遵循 `docs/natives-architecture.md` 中的架構術語：

- **建置時產物產生** (`scripts/build-native.ts`)
- **嵌入式附加模組清單產生** (`scripts/embed-native.ts`)
- **執行時附加模組載入 + 驗證閘道** (`src/native.ts`)

## 實作檔案

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## 建置管線概覽

### 1) 建置進入點

`packages/natives/package.json` 腳本：

- `bun scripts/build-native.ts` (`build`) → 發佈版建置
- `bun scripts/build-native.ts --dev` (`dev:native`) → 除錯/開發設定檔建置（相同輸出命名）
- `bun scripts/embed-native.ts` (`embed:native`) → 從已建置檔案產生 `src/embedded-addon.ts`

### 2) Rust 產物建置

`build-native.ts` 在 `crates/pi-natives` 中執行 Cargo：

- 基本命令：`cargo build`
- 發佈模式會加上 `--release`，除非傳入了 `--dev`
- 交叉編譯目標會加上 `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` 宣告 `crate-type = ["cdylib"]`，因此 Cargo 會輸出共享函式庫（`.so`/`.dylib`/`.dll`），然後被複製/重新命名為 `.node` 附加模組檔名。

### 3) 產物發現與安裝

Cargo 完成後，`build-native.ts` 依序掃描候選輸出目錄：

1. `${CARGO_TARGET_DIR}`（如果有設定）
2. `<repo>/target`
3. `crates/pi-natives/target`

對於每個根目錄，它會檢查設定檔目錄：

- 交叉編譯：`<root>/<crossTarget>/<profile>` 然後 `<root>/<profile>`
- 原生建置：`<root>/<profile>`

然後尋找以下其中一個：

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

找到後，它會以原子方式安裝到 `packages/natives/native/`，使用暫存檔 + 重新命名語義（Windows 備援方案會明確處理鎖定 DLL 替換失敗的情況）。

## 目標/變體模型與命名慣例

## 平台標籤

建置和執行時都使用平台標籤：

`<platform>-<arch>`（範例：`darwin-arm64`、`linux-x64`）

## 變體模型（僅限 x64）

x64 支援 CPU 變體：

- `modern`（支援 AVX2 的路徑）
- `baseline`（備援方案）

非 x64 使用單一預設產物（無變體後綴）。

### 輸出檔名

發佈版建置：

- x64：`pi_natives.<platform>-<arch>-modern.node` 或 `...-baseline.node`
- 非 x64：`pi_natives.<platform>-<arch>.node`

開發版建置（`--dev`）：

- 使用除錯設定檔旗標但保持標準平台標籤輸出命名

`native.ts` 中執行時載入器候選順序：

- 發佈版候選
- 編譯模式會在套件本地檔案之前加入提取/快取候選

## 環境旗標與建置選項

## 執行時旗標

- `PI_DEV`（載入器行為）：啟用載入器診斷
- `PI_NATIVE_VARIANT`（載入器行為，僅限 x64）：在執行時強制選擇 `modern` 或 `baseline`
- `PI_COMPILED`（載入器行為）：啟用編譯二進位檔候選/提取行為

## 建置時旗標/選項

- `--dev`（腳本引數）：建置除錯設定檔
- `CROSS_TARGET`：傳遞給 Cargo `--target`
- `TARGET_PLATFORM`：覆寫輸出平台標籤命名
- `TARGET_ARCH`：覆寫輸出架構命名
- `TARGET_VARIANT`（僅限 x64）：強制輸出檔名和 RUSTFLAGS 策略使用 `modern` 或 `baseline`
- `CARGO_TARGET_DIR`：搜尋 Cargo 輸出時的額外根目錄
- `RUSTFLAGS`：
  - 如果未設定且非交叉編譯，腳本會設定：
    - modern：`-C target-cpu=x86-64-v3`
    - baseline：`-C target-cpu=x86-64-v2`
    - 非 x64 / 無變體：`-C target-cpu=native`
  - 如果已經設定，腳本不會覆寫

## 建置狀態/生命週期轉換

### 建置生命週期（`build-native.ts`）

1. **初始化**：解析引數/環境變數（`--dev`、目標覆寫、交叉編譯旗標）
2. **變體解析**：
   - 非 x64 → 無變體
   - x64 + `TARGET_VARIANT` → 明確變體
   - x64 交叉編譯且無 `TARGET_VARIANT` → 硬錯誤
   - x64 本地建置且無覆寫 → 偵測主機 AVX2
3. **編譯**：使用已解析的設定檔/目標執行 Cargo
4. **定位產物**：掃描目標根目錄/設定檔目錄/函式庫名稱
5. **安裝**：複製 + 原子重新命名到 `packages/natives/native`
6. **完成**：附加模組產物已準備好供載入器候選使用

失敗會在任何階段以明確錯誤文字結束程式（無效變體、cargo 建置失敗、找不到輸出函式庫、安裝/重新命名失敗）。

### 嵌入生命週期（`embed-native.ts`）

1. **初始化**：從 `TARGET_PLATFORM`/`TARGET_ARCH` 或主機值計算平台標籤
2. **候選集合**：
   - x64 預期同時有 `modern` 和 `baseline`
   - 非 x64 預期一個預設檔案
3. **驗證可用性**，檢查 `packages/natives/native`
4. **產生清單**（`src/embedded-addon.ts`），包含 Bun `file` 匯入和套件版本
5. **執行時提取就緒**，供編譯模式使用

`--reset` 會跳過驗證並寫入空清單存根（`embeddedAddon = null`）。

## 開發工作流程 vs 發佈/編譯行為

## 本地開發工作流程

典型的本地開發循環：

1. 建置附加模組：
   - 發佈版：`bun --cwd=packages/natives run build`
   - 除錯設定檔：`bun --cwd=packages/natives run dev:native`
2. 測試載入器診斷時設定 `PI_DEV=1`
3. `native.ts` 中的載入器解析套件本地 `native/`（以及可執行檔目錄備援）候選
4. `validateNative` 在包裝函式使用繫結之前強制執行匯出相容性檢查

## 發佈/編譯二進位檔工作流程

在編譯模式下（`PI_COMPILED` 或 Bun 嵌入標記）：

1. 載入器計算版本化快取目錄：`<getNativesDir()>/<packageVersion>`（操作上為 `~/.xcsh/natives/<version>`）
2. 如果嵌入清單匹配當前平台+版本，載入器可能會將選定的嵌入檔案提取到該版本化目錄
3. 執行時候選順序包括：
   - 版本化快取目錄
   - 舊版編譯二進位檔目錄（Windows 上為 `%LOCALAPPDATA%/xcsh`，其他平台為 `~/.local/bin`）
   - 套件/可執行檔目錄
4. 第一個成功載入的附加模組仍然必須通過 `validateNative`

這就是為什麼打包與執行時載入器的預期必須一致：檔名、平台標籤和匯出符號必須匹配 `native.ts` 探測和驗證的內容。

## JS API ↔ Rust 匯出對應（驗證閘道子集）

`native.ts` 要求這些 JS 可見匯出存在於已載入的附加模組上。它們對應到 `crates/pi-natives/src` 中的 Rust N-API 匯出：

| `validateNative` 要求的 JS 名稱 | Rust 匯出宣告 | Rust 原始檔 |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)`（駝峰式命名匯出） | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

如果任何必要符號缺失，載入器會立即失敗並提供重建提示。

## 失敗行為與診斷

## 建置時失敗

- 無效的變體設定：
  - 在非 x64 上設定 `TARGET_VARIANT` → 立即錯誤
  - x64 交叉編譯且無明確 `TARGET_VARIANT` → 立即錯誤
- Cargo 建置失敗：
  - 腳本會顯示非零結束碼和 stderr
- 找不到產物：
  - 腳本會印出每個檢查過的設定檔目錄
- 安裝失敗：
  - 明確訊息；Windows 包含鎖定檔案提示

## 執行時載入器失敗（`native.ts`）

- 不支援的平台標籤：
  - 拋出例外並列出支援的平台清單
- 無法載入任何候選：
  - 拋出例外並列出完整的候選錯誤清單和特定模式的修復提示
- 缺少匯出：
  - 拋出例外並列出確切缺少的符號名稱和重建命令
- 嵌入提取問題：
  - 提取 mkdir/write 錯誤會被記錄並包含在最終診斷中

## 故障排除矩陣

| 症狀 | 可能原因 | 驗證方式 | 修復方式 |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | 過時的 `.node` 二進位檔、Rust 匯出名稱不匹配，或載入了錯誤的二進位檔 | 使用 `PI_DEV=1` 執行以查看載入路徑；檢查該檔案的匯出清單 | 重新建置 `build`；確保 Rust `#[napi]` 匯出名稱（或需要時的明確別名）匹配 JS 鍵；移除過時的快取/版本化檔案 |
| x64 機器在預期 modern 時載入了 baseline | `PI_NATIVE_VARIANT=baseline`、未偵測到 AVX2，或僅存在 baseline 檔案 | 檢查 `PI_NATIVE_VARIANT`；檢查 `native/` 中的 `-modern` 檔案 | 建置 modern 變體（`TARGET_VARIANT=modern ... build`）並確保檔案已發佈 |
| 交叉編譯產生無法使用/標籤錯誤的二進位檔 | `CROSS_TARGET` 與 `TARGET_PLATFORM`/`TARGET_ARCH` 不匹配，或 x64 缺少 `TARGET_VARIANT` | 確認環境變數組合和輸出檔名 | 使用一致的環境變數值和明確的 x64 `TARGET_VARIANT` 重新執行 |
| 升級後編譯二進位檔失敗 | 過時的提取快取（`~/.xcsh/natives/<old-or-mismatched-version>`）或嵌入清單不匹配 | 檢查版本化 natives 目錄和載入器錯誤清單 | 刪除該套件版本的版本化 natives 快取並重新執行；在打包期間重新產生嵌入清單 |
| 載入器探測多個路徑且全部失敗 | 平台不匹配或套件 `native/` 中缺少發佈版產物 | 檢查 `platformTag` 與實際檔名 | 確保建置檔名完全匹配 `pi_natives.<platform>-<arch>(-variant).node` 慣例，且套件包含 `native/` |
| `embed:native` 失敗並顯示「Incomplete native addons」 | 嵌入前未建置所需的變體檔案 | 檢查錯誤文字中預期與找到的清單 | 先建置所需檔案（x64：modern+baseline 都要；非 x64：預設），然後重新執行 `embed:native` |

## 操作命令

```bash
# 當前主機的發佈版產物
bun --cwd=packages/natives run build

# 除錯設定檔產物建置
bun --cwd=packages/natives run dev:native

# 建置明確的 x64 變體
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# 從已建置的原生檔案產生嵌入式附加模組清單
bun --cwd=packages/natives run embed:native

# 重設嵌入清單為空存根
bun --cwd=packages/natives run embed:native -- --reset
```
