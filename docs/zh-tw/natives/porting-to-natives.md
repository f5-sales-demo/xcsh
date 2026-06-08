---
title: 移植至 pi-natives (N-API) — 實戰筆記
description: 將 Node.js child_process 和 shell 程式碼遷移至 Rust N-API 原生層的實戰筆記。
sidebar:
  order: 9
  label: 移植至 pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# 移植至 pi-natives (N-API) — 實戰筆記

這是一份實用指南，說明如何將熱點路徑移入 `crates/pi-natives` 並透過 JS 繫結進行串接。本文件的存在是為了避免相同的錯誤重複發生。

## 何時應該移植

當以下任一條件成立時，就應該進行移植：

- 熱點路徑在渲染迴圈、頻繁的 UI 更新或大批量處理中執行。
- JS 記憶體配置佔主導地位（字串頻繁建立與銷毀、正規表達式回溯、大型陣列）。
- 您已有 JS 基準版本，且可以並排比較兩個版本的效能。
- 該工作屬於 CPU 密集型或可在 libuv 執行緒池上執行的阻塞式 I/O。
- 該工作屬於可在 Tokio 執行時期上運行的非同步 I/O（例如 shell 執行）。

避免移植那些依賴 JS 獨有狀態或動態匯入的部分。N-API 匯出應該是純粹的，資料進、資料出。長時間運行的工作應透過 `task::blocking`（CPU 密集型/阻塞式 I/O）或 `task::future`（非同步 I/O）搭配取消機制來處理。

## 原生匯出的結構

**Rust 端：**

- 實作放在 `crates/pi-natives/src/<module>.rs`。如果新增模組，需在 `crates/pi-natives/src/lib.rs` 中註冊。
- 使用 `#[napi]` 匯出；snake_case 匯出會自動轉換為 camelCase。僅在需要真正的別名或非預設名稱時才使用顯式的 `js_name`。結構體使用 `#[napi(object)]`。
- 對於 CPU 密集型或阻塞式工作，使用 `task::blocking(tag, cancel_token, work)`（請參閱 `crates/pi-natives/src/task.rs`）。對於需要 Tokio 的非同步工作（例如 shell 工作階段），使用 `task::future(env, tag, work)`。當您公開 `timeoutMs` 或 `AbortSignal` 時，傳入 `CancelToken`。

**JS 端：**

- `packages/natives/src/bindings.ts` 包含基礎的 `NativeBindings` 介面。
- `packages/natives/src/<module>/types.ts` 定義 TS 型別，並透過宣告合併擴充 `NativeBindings`。
- `packages/natives/src/native.ts` 匯入每個 `<module>/types.ts` 檔案以啟用宣告。
- `packages/natives/src/<module>/index.ts` 包裝來自 `packages/natives/src/native.ts` 的 `native` 繫結。
- `packages/natives/src/native.ts` 載入附加元件，`validateNative` 強制檢查必要的匯出。
- `packages/natives/src/index.ts` 重新匯出包裝器，供 `packages/*` 中的呼叫方使用。

## 移植檢查清單

1. **新增 Rust 實作**

- 將核心邏輯放在純 Rust 函式中。
- 如果是新模組，將其加入 `crates/pi-natives/src/lib.rs`。
- 使用 `#[napi]` 公開，使預設的 snake_case -> camelCase 對應保持一致。
- 保持函式簽章為擁有所有權且簡單的型別：`String`、`Vec<String>`、`Uint8Array`，或對大型字串/位元組輸入使用 `Either<JsString, Uint8Array>`。
- 對於 CPU 密集型或阻塞式工作，使用 `task::blocking`；對於非同步工作，使用 `task::future`。傳入 `CancelToken` 並在長迴圈中呼叫 `heartbeat()`。

2. **串接 JS 繫結**

- 在 `packages/natives/src/<module>/types.ts` 中新增型別和 `NativeBindings` 擴充。
- 在 `packages/natives/src/native.ts` 中匯入 `./<module>/types` 以觸發宣告合併。
- 在 `packages/natives/src/<module>/index.ts` 中新增呼叫 `native` 的包裝器。
- 從 `packages/natives/src/index.ts` 重新匯出。

3. **更新原生驗證**

- 在 `validateNative`（`packages/natives/src/native.ts`）中新增 `checkFn("newExport")`。

4. **新增效能基準測試**

- 將基準測試放在擁有該功能的套件旁（`packages/tui/bench`、`packages/natives/bench` 或 `packages/coding-agent/bench`）。
- 在同一次執行中包含 JS 基準版本和原生版本。
- 使用 `Bun.nanoseconds()` 和固定的迭代次數。
- 保持基準測試輸入小而真實（使用熱點路徑中實際觀察到的資料）。

5. **建構原生二進位檔**

- `bun --cwd=packages/natives run build`
- 使用 `bun --cwd=packages/natives run build`，如果測試時需要載入器診斷資訊，設定 `PI_DEV=1`。

6. **執行基準測試**

- `bun run packages/<pkg>/bench/<bench>.ts`（或 `bun --cwd=packages/natives run bench`）

7. **決定使用方式**

- 如果原生版本較慢，**保留 JS 版本**，讓原生匯出保持未使用狀態。
- 如果原生版本較快，將呼叫端切換至原生包裝器。

## 痛點及避免方式

### 1) 過期的 `pi_natives.node` 導致新匯出無法使用

載入器優先使用 `packages/natives/native` 中帶有平台標記的二進位檔（`pi_natives.<platform>-<arch>.node`）。`PI_DEV=1` 現在僅啟用載入器診斷資訊；它不再切換到單獨的開發用附加元件檔名。另外還有一個備用的 `pi_natives.node`。已編譯的二進位檔會解壓縮至 `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`。如果其中任何一個過期，匯出將不會更新。

**修正方式：** 在重新建構前移除過期的檔案。

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

如果您正在執行已編譯的二進位檔，請刪除快取的附加元件目錄：

```bash
rm -rf ~/.xcsh/natives/<version>
```

然後驗證匯出是否存在於二進位檔中：

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) 來自 `validateNative` 的「缺少匯出」錯誤

這是**好事** — 它可以防止無聲的不匹配。當您看到：

```
Native addon missing exports ... Missing: visibleWidth
```

這表示您的二進位檔過期了、Rust 匯出名稱（或使用時的顯式別名）與 JS 名稱不匹配，或者該匯出根本沒有被編譯進去。修正建構和命名不匹配的問題，不要弱化驗證。

### 3) Rust 簽章不匹配

保持簡單且擁有所有權。`String`、`Vec<String>` 和 `Uint8Array` 可以正常使用。避免在公開匯出中使用 `&str` 等參考。如果需要結構化資料，請用 `#[napi(object)]` 結構體包裝。

### 4) 基準測試的常見錯誤

- 不要比較不同的輸入或記憶體配置。
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

- `validateNative` 通過（沒有缺少的匯出）。
- `NativeBindings` 已在 `packages/natives/src/<module>/types.ts` 中擴充，且包裝器已在 `packages/natives/src/index.ts` 中重新匯出。
- `Object.keys(require(...))` 包含您的新匯出。
- 效能基準數據已記錄在 PR/筆記中。
- **僅在**原生版本更快或效能相當時才更新呼叫端。

## 經驗法則

- 如果原生版本較慢，**不要切換**。保留該匯出供未來使用，但 TUI 應保持在較快的路徑上。
- 如果原生版本較快，切換呼叫端並保留基準測試以捕捉效能回退。
