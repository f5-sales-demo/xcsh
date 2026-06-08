---
title: 原生綁定合約（TypeScript 端）
description: 透過 N-API 呼叫 Rust 原生函式的 TypeScript 端綁定合約。
sidebar:
  order: 2
  label: 綁定合約
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# 原生綁定合約（TypeScript 端）

本文件定義了介於 `@f5xc-salesdemos/pi-natives` 呼叫端與已載入的 N-API 附加元件之間的 TypeScript 端合約。

本文聚焦於三個部分：

1. 合約結構（`NativeBindings` + 模組擴充），
2. 包裝器行為（`src/<module>/index.ts`），
3. 公開匯出介面（`src/index.ts`）。

## 實作檔案

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## 合約模型

`packages/natives/src/bindings.ts` 定義了基礎合約：

- `NativeBindings`（基礎介面，目前包含 `cancelWork(id: number): void`）
- `Cancellable`（`timeoutMs?: number`、`signal?: AbortSignal`）
- `TsFunc<T>` N-API 執行緒安全回呼所使用的回呼函式簽章

每個模組透過宣告合併新增自己的欄位：

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

如此便能維護一個聚合的綁定介面，而無需使用單一的巨型中央型別檔案。

## 宣告合併生命週期與狀態轉換

### 1) 編譯期型別組裝

- `bindings.ts` 提供基礎的 `NativeBindings` 符號。
- 每個 `src/<module>/types.ts` 擴充 `NativeBindings`。
- `src/native.ts` 為了副作用匯入所有 `./<module>/types` 檔案，使合併後的合約在 `NativeBindings` 被使用的地方處於作用域內。

狀態轉換：**基礎合約** → **合併後合約**。

### 2) 執行期附加元件載入與驗證關卡

- `src/native.ts` 載入候選的 `.node` 二進位檔案。
- 載入的物件被視為 `NativeBindings` 並立即通過 `validateNative(...)` 驗證。
- `validateNative` 透過 `typeof bindings[name] === "function"` 驗證所需的匯出鍵。

狀態轉換：**不受信任的附加元件物件** → **已驗證的原生綁定物件**（或硬性失敗）。

### 3) 包裝器呼叫

- `src/<module>/index.ts` 中的模組包裝器呼叫 `native.<export>`。
- 包裝器適配預設值和回呼簽章（將 `(err, value)` 轉換為 JS API 中僅傳遞值的回呼模式）。
- `src/index.ts` 重新匯出模組包裝器/型別作為套件的公開 API。

狀態轉換：**已驗證的原始綁定** → **符合人體工學的公開 API**。

## 包裝器職責

包裝器刻意保持輕薄；它們不會重新實作原生邏輯。

主要職責：

- **引數正規化/預設值設定**
  - `glob()` 將 `options.path` 解析為絕對路徑並為 `hidden`、`gitignore`、`recursive` 設定預設值。
  - `hasMatch()` 在原生呼叫前填充預設旗標（`ignoreCase`、`multiline`）。
- **回呼適配**
  - `grep()`、`glob()`、`executeShell()` 將 `TsFunc<T>`（`error, value`）轉換為僅接收成功值的使用者回呼。
- **原生呼叫周圍的環境或策略行為**
  - 剪貼簿包裝器新增 OSC52/Termux/無頭模式處理，並將複製操作視為盡力而為。
- **公開命名與重新匯出策劃**
  - `searchContent()` 映射到原生匯出 `search`。

## 公開匯出介面組織

`packages/natives/src/index.ts` 是標準的公開桶狀檔案。它按功能領域分組匯出：

- 搜尋/文字：`grep`、`glob`、`text`、`highlight`
- 執行/處理程序/終端機：`shell`、`pty`、`ps`、`keys`
- 系統/媒體/轉換：`image`、`html`、`clipboard`、`system-info`、`work`

維護者規則：若包裝器未從 `src/index.ts` 重新匯出，則不屬於預期的公開套件介面。

## JS API ↔ 原生匯出映射（代表性範例）

Rust 端使用 N-API 匯出名稱（通常由 `#[napi]` snake_case -> camelCase 轉換，偶爾使用明確別名），必須與這些綁定鍵匹配。

| 類別 | 公開 JS API（包裝器） | 原生綁定鍵 | 回傳型別 | 非同步？ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | 是 |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | 否 |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | 否 |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | 是 |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | 是 |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | 否 |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | 是 |
| Shell | `Shell` | `Shell` | class 建構函式 | N/A |
| PTY | `PtySession` | `PtySession` | class 建構函式 | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | 否 |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | 否 |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | 否 |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | 否 |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | 是 |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | 否 |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | 否 |
| Process | `killTree(pid, signal)` | `killTree` | `number` | 否 |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | 否 |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>`（盡力而為的包裝器行為） | 是 |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | 是 |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | 否 |

## 同步與非同步合約差異

合約混合了同步和非同步 API；包裝器保留原生呼叫風格，而非強制使用單一模型：

- **基於 Promise 的非同步匯出**用於 I/O 或長時間執行的工作（`grep`、`glob`、`htmlToMarkdown`、`executeShell`、剪貼簿、圖片操作）。
- **同步匯出**用於確定性的記憶體內轉換/解析器（`search`、`hasMatch`、語法高亮、文字寬度/切片、按鍵解析、處理程序查詢）。
- **建構函式匯出**用於有狀態的執行期物件（`Shell`、`PtySession`、`PhotonImage`）。

對維護者的影響：更改現有匯出的同步 ↔ 非同步性質，是跨包裝器和呼叫端的破壞性 API 與合約變更。

## 物件與列舉型別模式

### 物件模式（`#[napi(object)]` 風格的 JS 物件）

TS 將物件形狀的原生值建模為介面，例如：

- `GrepResult`、`SearchResult`、`GlobResult`
- `SystemInfo`、`WorkProfile`
- `ClipboardImage`、`ParsedKittyResult`

這些是編譯期的結構性合約；執行期的形狀正確性由原生實作負責。

### 列舉模式

數值型原生列舉在 TS 中以 `const enum` 值表示：

- `FileType`（`1=file`、`2=dir`、`3=symlink`）
- `ImageFormat`（`0=PNG`、`1=JPEG`、`2=WEBP`、`3=GIF`）
- `SamplingFilter`、`Ellipsis`、`KeyEventType`

呼叫端看到具名的列舉成員；綁定邊界傳遞的是數值。

## 如何捕捉不匹配

不匹配偵測發生在兩個層級：

1. **編譯期 TypeScript 合約檢查**
   - 包裝器針對合併後的 `NativeBindings` 呼叫 `native.<name>`。
   - 缺少/重新命名的綁定鍵會導致包裝器中的 TS 型別檢查失敗。

2. **`validateNative` 中的執行期驗證**
   - 載入後，`native.ts` 檢查所需匯出，若有缺少則拋出例外。
   - 錯誤訊息包含缺少的鍵和重新建置的指示。

這能捕捉常見的過期二進位檔偏移問題：包裝器/型別存在，但已載入的 `.node` 缺少該匯出。

## 失敗行為與注意事項

### 載入/驗證失敗（硬性失敗）

- 附加元件載入失敗或不支援的平台會在 `native.ts` 的模組初始化期間拋出例外。
- 缺少所需匯出會在包裝器可用之前拋出例外。

效果：套件快速失敗，而非將失敗延遲到首次呼叫。

### 包裝器層級的行為差異

- 部分包裝器刻意軟化失敗（`copyToClipboard` 為盡力而為，會吞掉原生失敗）。
- 串流回呼忽略回呼錯誤酬載，僅轉發成功的值事件。

### 型別層級注意事項（執行期比 TS 更嚴格）

- TS 可選欄位不保證語義有效性；原生層仍可能拒絕格式不正確的值。
- `const enum` 型別無法防止未經型別化的呼叫端在執行期傳入超出範圍的數值。
- `validateNative` 僅檢查所需匯出的存在性/是否為函式，不檢查深層的引數/回傳值形狀相容性。
- `bindings.ts` 在基礎介面中包含 `cancelWork(id)`，但目前的執行期驗證清單並未強制該鍵。

## 綁定變更的維護者檢查清單

新增/變更匯出時，請更新以下所有項目：

1. `src/<module>/types.ts`（擴充 + 合約型別）
2. `src/<module>/index.ts`（包裝器行為）
3. `src/native.ts` 模組型別的匯入（若為新模組）
4. `validateNative` 所需匯出檢查
5. `src/index.ts` 公開重新匯出

跳過任何步驟都會導致編譯期偏移或執行期載入失敗。
