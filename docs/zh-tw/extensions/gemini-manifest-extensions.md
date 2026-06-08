---
title: Gemini Manifest Extensions
description: >-
  Gemini manifest extension format for cross-platform skill and agent
  compatibility.
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini Manifest 擴充功能 (`gemini-extension.json`)

本文件說明 coding-agent 如何發現並解析 Gemini 風格的 manifest 擴充功能 (`gemini-extension.json`) 至 `extensions` capability。

本文件**不**涵蓋 TypeScript/JavaScript 擴充模組載入（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`），該部分記載於 `extension-loading.md`。

## 實作檔案

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 發現的內容

Gemini 提供者（`id: gemini`，優先權 `60`）註冊了一個 `extensions` 載入器，掃描兩個固定的根目錄：

- 使用者：`~/.gemini/extensions`
- 專案：`<cwd>/.gemini/extensions`

路徑解析直接透過 `getUserPath()` / `getProjectPath()` 從 `ctx.home` 和 `ctx.cwd` 進行。

重要的作用域規則：專案查詢**僅限於 cwd**。它不會向上遍歷父目錄。

---

## 目錄掃描規則

對於每個根目錄（`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions`），發現過程會：

1. `readDirEntries(root)`
2. 僅保留直接子目錄（`entry.isDirectory()`）
3. 對於每個子目錄 `<name>`，嘗試精確讀取：
   - `<root>/<name>/gemini-extension.json`

不會進行超過一層目錄的遞迴掃描。

### 隱藏目錄

Gemini manifest 發現**不會**過濾以點號為前綴的目錄名稱。如果隱藏的子目錄存在且包含 `gemini-extension.json`，它會被納入考慮。

### 缺失/不可讀取的檔案

如果 `gemini-extension.json` 缺失或不可讀取，該目錄會被靜默跳過（無警告）。

---

## Manifest 結構（依實作）

capability 類型定義了以下 manifest 結構：

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

發現階段的行為刻意寬鬆：

- 需要 JSON 解析成功。
- 除了 JSON 語法之外，不會對欄位類型/內容進行執行時期的 schema 驗證。
- 解析後的物件會作為 `manifest` 儲存在 capability 項目上。

### 名稱正規化

`Extension.name` 設定為：

1. 如果 `manifest.name` 不是 `null`/`undefined`，則使用 `manifest.name`
2. 否則使用擴充功能的目錄名稱

此處不會套用字串類型強制。

---

## 具體化為 capability 項目

一個有效解析的 manifest 會建立一個 `Extension` capability 項目：

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

備註：

- `_source.path` 會透過 `createSourceMeta()` 正規化為絕對路徑。
- Registry 層級的 `extensions` capability 驗證僅檢查 `name` 和 `path` 的存在。
- Manifest 內部（`mcpServers`、`tools`、`context`）在發現階段不會被驗證。

---

## 錯誤處理與警告語意

### 會發出警告

- manifest 檔案中的無效 JSON：
  - 警告格式：`Invalid JSON in <manifestPath>`

### 不會發出警告（靜默跳過）

- `extensions` 目錄缺失
- 子目錄沒有 `gemini-extension.json`
- 不可讀取的 manifest 檔案
- manifest JSON 語法正確但語意異常/不完整

這意味著部分有效性會被接受：僅語法上的 JSON 失敗會發出警告。

---

## 與其他來源的優先順序和去重

`extensions` capability 由 capability registry 跨提供者進行聚合。

此 capability 目前的提供者：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）優先權 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）優先權 `60`

去重鍵為 `ext.name`（`extensionCapability.key = ext => ext.name`）。

### 跨提供者優先順序

較高優先權的提供者在重複的擴充功能名稱上獲勝。

- 如果 `native` 和 `gemini` 都發出擴充功能名稱 `foo`，則保留 native 項目。
- 較低優先權的重複項目僅保留在 `result.all` 中，並標記 `_shadowed = true`。

### 提供者內部的順序效果

因為去重是「先出現者獲勝」，提供者內部的項目順序很重要。

- Gemini 載入器先附加**使用者**，然後是**專案**。
- 因此，`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions` 之間的重複名稱會保留使用者項目並遮蔽專案項目。

相比之下，native 提供者以不同方式建構設定目錄順序（在 `getConfigDirs()` 中先 `project` 後 `user`），因此 native 提供者內部的遮蔽方向相反。

---

## 使用者與專案行為摘要

特別針對 Gemini manifest：

- 每次載入都會掃描使用者和專案兩個根目錄。
- 專案根目錄固定為 `<cwd>/.gemini/extensions`（不進行祖先目錄遍歷）。
- Gemini 來源內部的重複名稱以使用者優先解析。
- 與較高優先權提供者（特別是 native）的重複名稱會因優先權較低而被淘汰。

---

## 邊界：發現元資料與執行時期擴充功能載入

`gemini-extension.json` 發現目前提供 capability 元資料（`Extension` 項目）。它**不會**直接載入可執行的 TS/JS 擴充模組。

執行時期模組載入（`discoverAndLoadExtensions()` / `loadExtensions()`）使用 `extension-modules` 和明確路徑，且目前僅將自動發現的模組過濾為提供者 `native`。

實際意涵：

- Gemini manifest 擴充功能可作為 capability 記錄被發現。
- 它們本身不會被擴充功能載入器管線作為執行時期擴充模組來執行。

這個邊界在目前的實作中是刻意為之的，也說明了為何 manifest 發現與可執行模組載入可以各自獨立運作。
