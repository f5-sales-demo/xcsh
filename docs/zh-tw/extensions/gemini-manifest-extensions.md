---
title: Gemini 清單擴充
description: Gemini 清單擴充格式，用於跨平台技能與代理相容性。
sidebar:
  order: 7
  label: Gemini 清單
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini 清單擴充 (`gemini-extension.json`)

本文件說明 coding-agent 如何探索並解析 Gemini 風格的清單擴充 (`gemini-extension.json`) 至 `extensions` 能力中。

本文件**不**涵蓋 TypeScript/JavaScript 擴充模組載入 (`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`)，相關內容請參閱 `extension-loading.md`。

## 實作檔案

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 探索的內容

Gemini 提供者 (`id: gemini`，優先順序 `60`) 註冊了一個 `extensions` 載入器，會掃描兩個固定根目錄：

- 使用者：`~/.gemini/extensions`
- 專案：`<cwd>/.gemini/extensions`

路徑解析直接透過 `getUserPath()` / `getProjectPath()` 從 `ctx.home` 和 `ctx.cwd` 取得。

重要的範圍規則：專案查找**僅限 cwd**。不會向上遍歷父目錄。

---

## 目錄掃描規則

對於每個根目錄 (`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions`)，探索會：

1. `readDirEntries(root)`
2. 僅保留直接子目錄 (`entry.isDirectory()`)
3. 對每個子目錄 `<name>`，嘗試精確讀取：
   - `<root>/<name>/gemini-extension.json`

不會進行超過一層目錄的遞迴掃描。

### 隱藏目錄

Gemini 清單探索**不會**過濾以點號開頭的目錄名稱。如果隱藏子目錄存在且包含 `gemini-extension.json`，它會被納入考慮。

### 遺失/無法讀取的檔案

如果 `gemini-extension.json` 遺失或無法讀取，該目錄會被靜默跳過（無警告）。

---

## 清單結構（依實作）

能力類型定義了以下清單結構：

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

探索時的行為刻意保持寬鬆：

- 需要 JSON 解析成功。
- 除了 JSON 語法之外，沒有對欄位類型/內容的執行時期結構驗證。
- 解析後的物件作為 `manifest` 儲存在能力項目上。

### 名稱正規化

`Extension.name` 設定為：

1. 如果 `manifest.name` 不是 `null`/`undefined`，則使用 `manifest.name`
2. 否則使用擴充目錄名稱

此處不強制字串類型。

---

## 具體化為能力項目

有效解析的清單會建立一個 `Extension` 能力項目：

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

注意事項：

- `_source.path` 由 `createSourceMeta()` 正規化為絕對路徑。
- 註冊表層級對 `extensions` 的能力驗證僅檢查 `name` 和 `path` 是否存在。
- 清單內部（`mcpServers`、`tools`、`context`）在探索期間不會被驗證。

---

## 錯誤處理與警告語義

### 會發出警告

- 清單檔案中的無效 JSON：
  - 警告格式：`Invalid JSON in <manifestPath>`

### 不會發出警告（靜默跳過）

- `extensions` 目錄不存在
- 子目錄沒有 `gemini-extension.json`
- 無法讀取的清單檔案
- 清單 JSON 語法有效但語義上奇怪/不完整

這意味著部分有效性是被接受的：只有語法上的 JSON 失敗才會發出警告。

---

## 與其他來源的優先順序和去重

`extensions` 能力由能力註冊表跨提供者進行彙總。

此能力的目前提供者：

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) 優先順序 `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) 優先順序 `60`

去重鍵為 `ext.name` (`extensionCapability.key = ext => ext.name`)。

### 跨提供者優先順序

較高優先順序的提供者在重複擴充名稱時勝出。

- 如果 `native` 和 `gemini` 都發出擴充名稱 `foo`，則保留 native 的項目。
- 較低優先順序的重複項僅保留在 `result.all` 中，並標記 `_shadowed = true`。

### 提供者內部的順序影響

由於去重是「先出現者優先」，提供者本地的項目順序很重要。

- Gemini 載入器先附加**使用者**，然後附加**專案**。
- 因此，`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions` 之間的重複名稱會保留使用者項目並遮蔽專案項目。

相比之下，native 提供者以不同順序建構設定目錄（在 `getConfigDirs()` 中先 `project` 後 `user`），因此 native 提供者內部的遮蔽方向相反。

---

## 使用者與專案行為摘要

特別針對 Gemini 清單：

- 每次載入都會掃描使用者和專案兩個根目錄。
- 專案根目錄固定為 `<cwd>/.gemini/extensions`（不向上遍歷祖先目錄）。
- Gemini 來源內的重複名稱以使用者優先解析。
- 與較高優先順序提供者（特別是 native）之間的重複名稱依優先順序落敗。

---

## 邊界：探索中繼資料與執行時期擴充載入

`gemini-extension.json` 探索目前提供能力中繼資料（`Extension` 項目）。它**不會**直接載入可執行的 TS/JS 擴充模組。

執行時期模組載入（`discoverAndLoadExtensions()` / `loadExtensions()`）使用 `extension-modules` 和明確路徑，且目前將自動探索的模組過濾為僅限 `native` 提供者。

實際影響：

- Gemini 清單擴充可作為能力記錄被探索。
- 它們本身不會被擴充載入器管線作為執行時期擴充模組執行。

這個邊界在目前實作中是刻意的，這也解釋了為何清單探索和可執行模組載入可以有所分歧。
