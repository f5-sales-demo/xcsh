---
title: 移植到 pi-natives (N-API) — 實戰筆記
description: 將 Node.js child_process 和 shell 程式碼遷移到 Rust N-API 原生層的實戰筆記。
sidebar:
  order: 9
  label: 移植到 pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# 移植到 pi-natives (N-API) — 實戰筆記

這是一份將熱路徑移入 `crates/pi-natives` 並透過 JS 綁定進行串接的實用指南。本文件的存在是為了避免相同的錯誤重複發生。

## 何時應該移植

當以下任一條件成立時進行移植：

- 熱路徑在渲染迴圈、密集的 UI 更新或大批量處理中執行。
- JS 記憶體分配佔主導地位（字串反覆產生、正規表達式回溯、大型陣列）。
- 你已經有 JS 基準版本，可以並排比較兩個版本的效能。
- 工作是 CPU 密集型或阻塞式 I/O，可以在 libuv 執行緒池上執行。
- 工作是非同步 I/O，可以在 Tokio 的執行時上執行（例如 shell 執行）。

避免移植依賴 JS 專有狀態或動態匯入的程式碼。N-API 匯出應該是純粹的、資料輸入/資料輸出。長時間執行的工作應透過 `task::blocking`（CPU 密集型/阻塞式 I/O）或 `task::future`（非同步 I/O）並搭配取消機制進行處理。

## 原生匯出的結構

**Rust 端：**

- 實作放在 `crates/pi-natives/src/<module>.rs`。如果新增模組，請在 `crates/pi-natives/src/lib.rs` 中註冊。
- 使用 `#[napi]` 匯出；snake_case 的匯出會自動轉換為 camelCase。僅在真正的別名/非預設名稱時才使用明確的 `js_name`。對結構體使用 `#[napi(object)]`。
- 對 CPU 密集型或阻塞式工作使用 `task::blocking(tag, cancel_token, work)`（參見 `crates/pi-natives/src/task.rs`）。對需要 Tokio 的非同步工作（例如 shell 會話）使用 `task::future(env, tag, work)`。當你公開 `timeoutMs` 或 `AbortSignal` 時傳入 `CancelToken`。

**JS 端：**

- `packages/natives/src/bindings.ts` 持有基礎 `NativeBindings` 介面。
- `packages/natives/src/<module>/types.ts` 定義 TS 類型，並透過宣告合併擴充 `NativeBindings`。
- `packages/natives/src/native.ts` 匯入每個 `<module>/types.ts` 檔案以啟用宣告。
- `packages/natives/src/<module>/index.ts` 封裝來自 `packages/natives/src/native.ts` 的 `native` 綁定。
- `packages/natives/src/native.ts` 載入附加模組，`validateNative` 強制驗證所需的匯出。
- `packages/natives/src/index.ts` 重新匯出封裝器供 `packages/*` 中的呼叫者使用。

## 移植檢查清單

1. **新增 Rust 實作**

- 將核心邏輯放在純 Rust 函式中。
- 如果是新模組，將其新增到 `crates/pi-natives/src/lib.rs`。
- 使用 `#[napi]` 匯出，保持預設的 snake_case -> camelCase 對應一致性。
- 保持簽名使用擁有權類型且簡單：`String`、`Vec<String>`、`Uint8Array`，或對大型字串/位元組輸入使用 `Either<JsString, Uint8Array>`。
- 對 CPU 密集型或阻塞式工作使用 `task::blocking`；對非同步工作使用 `task::future`。傳入 `CancelToken` 並在長迴圈內呼叫 `heartbeat()`。

2. **串接 JS 綁定**

- 在 `packages/natives/src/<module>/types.ts` 中新增類型和 `NativeBindings` 擴充。
- 在 `packages/natives/src/native.ts` 中匯入 `./<module>/types` 以觸發宣告合併。
- 在 `packages/natives/src/<module>/index.ts` 中新增呼叫 `native` 的封裝器。
- 從 `packages/natives/src/index.ts` 重新匯出。

3. **更新原生驗證**

- 在 `validateNative`（`packages/natives/src/native.ts`）中新增 `checkFn("newExport")`。

4. **新增基準測試**

- 將基準測試放在所屬套件旁邊（`packages/tui/bench`、`packages/natives/bench` 或 `packages/coding-agent/bench`）。
- 在同一次執行中包含 JS 基準版本和原生版本。
- 使用 `Bun.nanoseconds()` 和固定的迭代次數。
- 保持基準測試輸入小且切合實際（熱路徑中實際觀察到的資料）。

5. **建置原生二進位檔**

- `bun --cwd=packages/natives run build`
- 使用 `bun --cwd=packages/natives run build`，如果你想在測試時查看載入器診斷資訊，請設定 `PI_DEV=1`。

6. **執行基準測試**

- `bun run packages/<pkg>/bench/<bench>.ts`（或 `bun --cwd=packages/natives run bench`）

7. **決定使用方式**

- 如果原生版本較慢，**保留 JS** 並讓原生匯出閒置。
- 如果原生版本較快，將呼叫端切換到原生封裝器。

## 痛點及如何避免

### 1) 過時的 `pi_natives.node` 阻止新匯出

載入器優先使用 `packages/natives/native` 中帶平台標籤的二進位檔（`pi_natives.<platform>-<arch>.node`）。`PI_DEV=1` 現在僅啟用載入器診斷資訊；它不再切換到單獨的開發附加模組檔名。還有一個備用的 `pi_natives.node`。編譯後的二進位檔會解壓到 `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`。如果其中任何一個是過時的，匯出將不會更新。

**修復方式：** 在重新建置前移除過時的檔案。

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

如果你正在執行編譯後的二進位檔，請刪除快取的附加模組目錄：

```bash
rm -rf ~/.xcsh/natives/<version>
```

然後驗證匯出是否存在於二進位檔中：

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) 來自 `validateNative` 的「缺少匯出」錯誤

這是**好事** — 它防止了靜默的不匹配。當你看到這個：

```
Native addon missing exports ... Missing: visibleWidth
```

這表示你的二進位檔是過時的、Rust 匯出名稱（或使用時的明確別名）與 JS 名稱不匹配，或者匯出根本沒有被編譯進去。修復建置和命名不匹配，不要削弱驗證。

### 3) Rust 簽名不匹配

保持簡單且使用擁有權類型。`String`、`Vec<String>` 和 `Uint8Array` 都可以。避免在公開匯出中使用引用如 `&str`。如果需要結構化資料，將其封裝在 `#[napi(object)]` 結構體中。

### 4) 基準測試的常見錯誤

- 不要比較不同的輸入或分配。
- 保持 JS 和原生版本使用相同的輸入陣列。
- 在同一個基準測試檔案中執行兩者以避免偏差。

## 基準測試範本

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## 驗證檢查清單

- `validateNative` 通過（無缺少的匯出）。
- `NativeBindings` 已在 `packages/natives/src/<module>/types.ts` 中擴充，且封裝器已在 `packages/natives/src/index.ts` 中重新匯出。
- `Object.keys(require(...))` 包含你的新匯出。
- 基準測試數據已記錄在 PR/筆記中。
- **僅在**原生版本更快或相等時才更新呼叫端。

## 經驗法則

- 如果原生版本較慢，**不要切換**。保留匯出供未來使用，但 TUI 應該繼續使用較快的路徑。
- 如果原生版本較快，切換呼叫端並保留基準測試以捕捉效能回歸。
