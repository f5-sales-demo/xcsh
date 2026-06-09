---
title: 原生 Addon 載入器執行期
description: 具備平台偵測、備援策略及模組解析功能的 N-API addon 載入器執行期。
sidebar:
  order: 3
  label: Addon 載入器
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# 原生 Addon 載入器執行期

本文件深入探討 `@f5xc-salesdemos/pi-natives` 中的 addon 載入/驗證層：`native.ts` 如何決定載入哪個 `.node` 檔案、嵌入式 payload 提取何時執行，以及啟動失敗如何回報。

## 實作檔案

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## 範圍與職責

載入器/執行期的職責被刻意限縮：

- 建構平台/CPU 感知的候選 addon 檔名及目錄清單。
- 可選擇性地將嵌入式 addon 具現化至版本化的使用者快取目錄。
- 以確定性順序嘗試候選項目。
- 在公開綁定之前，透過 `validateNative` 拒絕過時或不相容的 addon。

不在此範圍內：模組特定的 grep/text/highlight 行為。

## 執行期輸入與衍生狀態

在模組初始化時（`export const native = loadNative();`），`native.ts` 會計算靜態上下文：

- **平台標籤**：``${process.platform}-${process.arch}``（例如 `darwin-arm64`）。
- **套件版本**：取自 `packages/natives/package.json`（`version` 欄位）。
- **核心目錄**：
  - `nativeDir`：套件本地的 `packages/natives/native`。
  - `execDir`：包含 `process.execPath` 的目錄。
  - `versionedDir`：`<getNativesDir()>/<packageVersion>`。
  - `userDataDir` 備援：
    - Windows：`%LOCALAPPDATA%/xcsh`（或 `%USERPROFILE%/AppData/Local/xcsh`）。
    - 非 Windows：`~/.local/bin`。
- **編譯二進位模式**（`isCompiledBinary`）：當以下任一條件成立時為 true：
  - 設定了 `PI_COMPILED` 環境變數，或
  - `import.meta.url` 包含 Bun 嵌入標記（`$bunfs`、`~BUN`、`%7EBUN`）。
- **變體覆寫**：`PI_NATIVE_VARIANT`（僅限 `modern`/`baseline`；無效值會被忽略）。
- **選定變體**：明確的覆寫值，否則在 x64 上進行執行期 AVX2 偵測（有 AVX2 則為 `modern`，否則為 `baseline`）。

## 平台支援與標籤解析

`SUPPORTED_PLATFORMS` 固定為：

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

行為細節：

- 不支援的平台不會被預先拒絕。
- 載入器仍會先嘗試所有計算出的候選項目。
- 如果都無法載入，則會拋出明確的不支援平台錯誤，並列出支援的標籤。

這在為近似情況保留有用的診斷資訊的同時，對真正不支援的目標仍會嚴格失敗。

## 變體選擇（`modern` / `baseline` / 預設）

### x64 行為

1. 如果 `PI_NATIVE_VARIANT` 是 `modern` 或 `baseline`，該值優先。
2. 否則偵測 AVX2 支援：
   - Linux：掃描 `/proc/cpuinfo` 尋找 `avx2`。
   - macOS：查詢 `sysctl`（`machdep.cpu.leaf7_features`，備援 `machdep.cpu.features`）。
   - Windows：執行 PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`。
3. 結果：
   - AVX2 可用 -> `modern`
   - AVX2 不可用/無法偵測 -> `baseline`

### 非 x64 行為

- 不使用變體；載入器維持預設檔名（`pi_natives.<platform>-<arch>.node`）。

### 檔名建構

給定 `tag = <platform>-<arch>`：

- 非 x64 或無變體：`pi_natives.<tag>.node`
- x64 + `modern`：依序嘗試
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node`（刻意的備援）
- x64 + `baseline`：僅 `pi_natives.<tag>-baseline.node`

最終錯誤訊息中使用的 `addonLabel` 為 `<tag>` 或 `<tag> (<variant>)`。

## 候選路徑建構與備援順序

`native.ts` 在任何 `require(...)` 呼叫之前建構候選池。

### 發行候選

從變體解析後的檔名清單建構，按以下順序搜尋：

- **非編譯執行期**：
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **編譯執行期**（`PI_COMPILED` 或 Bun 嵌入標記）：
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` 在保留首次出現順序的同時移除重複項目。

### 最終執行期序列

在載入時：

1. 可選的嵌入式提取候選（如果產生）會被插入最前方。
2. 其餘去重後的候選項目依序嘗試。
3. 第一個同時通過 `require(...)` 載入和 `validateNative(...)` 驗證的候選項目勝出。

## 嵌入式 addon 提取生命週期

`embedded-addon.ts` 定義了一個生成的資訊清單結構：

- `platformTag`
- `version`
- `files[]`，其中每個項目包含 `variant`、`filename`、`filePath`

目前已簽入的預設值為 `embeddedAddon: null`；編譯的產出物可能會以真實的中繼資料取代此值。

### 提取狀態機

提取（`maybeExtractEmbeddedAddon`）僅在所有閘門通過時執行：

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. 找到適合變體的嵌入式檔案

變體檔案選擇反映執行期的變體意圖：

- 非 x64：優先 `default`，然後第一個可用的檔案。
- x64 + `modern`：優先 `modern`，備援至 `baseline`。
- x64 + `baseline`：要求 `baseline`。

具現化行為：

1. 確保 `<versionedDir>` 存在（`mkdirSync(..., { recursive: true })`）。
2. 如果 `<versionedDir>/<selected filename>` 已存在，重複使用（不重寫）。
3. 否則讀取嵌入式來源 `filePath` 並寫入目標檔案。
4. 回傳目標路徑作為最高優先載入嘗試。

失敗時，提取不會立即崩潰；它會附加一個錯誤條目（目錄建立或寫入失敗），載入器繼續進行正常的候選探測。

## 生命週期與狀態轉換

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## `validateNative` 合約檢查

`validateNative(bindings, source)` 在啟動時對 `NativeBindings` 強制執行僅函式合約。

機制：

- 對每個必要的匯出名稱，檢查 `typeof bindings[name] === "function"`。
- 缺少的名稱會被彙總。
- 如果有任何缺少，載入器會拋出：
  - 來源 addon 路徑，
  - 缺少的匯出清單，
  - 重新建構命令提示。

這是一個針對過時二進位檔、部分建構和符號/名稱漂移的硬性相容性閘門。

### JS API ↔ 原生匯出對應（驗證閘門）

| 在 `validateNative` 中檢查的 JS 綁定名稱 | 預期的原生匯出名稱 |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

注意：`bindings.ts` 僅宣告基礎的 `cancelWork(id)` 成員；模組的 `types.ts` 檔案透過宣告合併增加 `validateNative` 所強制的額外符號。

## 失敗行為與診斷

## 不支援的平台

如果所有候選項目都失敗且 `platformTag` 不在 `SUPPORTED_PLATFORMS` 中，載入器會拋出：

- `Unsupported platform: <tag>`
- 完整的支援平台清單
- 明確的問題回報指引

## 過時二進位檔 / 不匹配症狀

典型的過時不匹配信號：

- `Native addon missing exports (<candidate>). Missing: ...`

常見原因：

- 來自先前套件版本/API 結構的舊 `.node` 二進位檔。
- 選擇了錯誤的變體產出物（針對 x64）。
- 載入的產出物中不存在新的 Rust 匯出。

載入器行為：

- 記錄每個候選的匯出缺少失敗。
- 繼續探測剩餘候選項目。
- 如果沒有候選通過驗證，最終錯誤會包含每個嘗試過的路徑及各自的失敗訊息。

## 編譯二進位啟動失敗

在編譯模式下，最終診斷包含：

- 預期的版本化快取目標路徑（`<versionedDir>/<filename>`），
- 刪除過時 `<versionedDir>` 並重新執行的修復方法，
- 每個預期檔名的直接發行下載 `curl` 命令。

## 非編譯啟動失敗

在正常套件/執行期模式下，最終診斷包含：

- 重新安裝提示（`bun install @f5xc-salesdemos/pi-natives`），
- 本地重新建構命令（`bun --cwd=packages/natives run build`），
- 可選的 x64 變體建構提示（`TARGET_VARIANT=baseline|modern ...`）。

## 執行期行為

- 載入器始終使用發行候選鏈。
- 設定 `PI_DEV` 僅啟用每個候選的主控台診斷（`Loaded native addon...` 和載入錯誤）。
