---
title: Gemini 清單擴充功能
description: 用於跨平台技能與代理相容性的 Gemini 清單擴充功能格式。
sidebar:
  order: 7
  label: Gemini 清單
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini 清單擴充功能（`gemini-extension.json`）

本文件說明程式碼代理如何探索並解析 Gemini 風格的清單擴充功能（`gemini-extension.json`）至 `extensions` 能力。

本文件**不**涵蓋 TypeScript/JavaScript 擴充功能模組載入（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`），相關說明請參閱 `extension-loading.md`。

## 實作檔案

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 探索範圍

Gemini 提供者（`id: gemini`，優先順序 `60`）註冊一個 `extensions` 載入器，用於掃描兩個固定根目錄：

- 使用者：`~/.gemini/extensions`
- 專案：`<cwd>/.gemini/extensions`

路徑解析透過 `getUserPath()` / `getProjectPath()` 直接從 `ctx.home` 和 `ctx.cwd` 取得。

重要範圍規則：專案查找**僅限於 cwd**，不會向上遍歷父目錄。

---

## 目錄掃描規則

針對每個根目錄（`~/.gemini/extensions` 與 `<cwd>/.gemini/extensions`），探索程序執行以下步驟：

1. `readDirEntries(root)`
2. 僅保留直接子目錄（`entry.isDirectory()`）
3. 對每個子目錄 `<name>`，嘗試讀取：
   - `<root>/<name>/gemini-extension.json`

掃描不會超過一層目錄深度。

### 隱藏目錄

Gemini 清單探索**不會**過濾以點號開頭的目錄名稱。若隱藏子目錄存在且包含 `gemini-extension.json`，則會納入探索。

### 缺失或無法讀取的檔案

若 `gemini-extension.json` 缺失或無法讀取，該目錄將被靜默略過（不發出警告）。

---

## 清單結構（依實作定義）

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

探索階段的行為刻意保持寬鬆：

- 需要 JSON 解析成功。
- 除 JSON 語法外，不對欄位類型或內容進行執行期綱要驗證。
- 解析後的物件以 `manifest` 形式儲存於能力項目上。

### 名稱正規化

`Extension.name` 的設定規則：

1. 若 `manifest.name` 不為 `null`/`undefined`，則使用該值
2. 否則使用擴充功能目錄名稱

此處不強制套用字串類型檢查。

---

## 具體化為能力項目

成功解析的清單將建立一個 `Extension` 能力項目：

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // 由能力登錄表附加
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

注意事項：

- `_source.path` 由 `createSourceMeta()` 正規化為絕對路徑。
- 登錄表層級的 `extensions` 能力驗證僅檢查 `name` 與 `path` 是否存在。
- 清單內部欄位（`mcpServers`、`tools`、`context`）在探索階段不進行驗證。

---

## 錯誤處理與警告語義

### 會發出警告

- 清單檔案中的 JSON 無效：
  - 警告格式：`Invalid JSON in <manifestPath>`

### 不發出警告（靜默略過）

- `extensions` 目錄不存在
- 子目錄不含 `gemini-extension.json`
- 清單檔案無法讀取
- 清單 JSON 語法正確但語義異常或不完整

這意味著部分有效性是可接受的：只有 JSON 語法錯誤才會觸發警告。

---

## 與其他來源的優先順序與去重

`extensions` 能力由能力登錄表跨提供者彙整。

目前提供此能力的提供者：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）優先順序 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）優先順序 `60`

去重鍵為 `ext.name`（`extensionCapability.key = ext => ext.name`）。

### 跨提供者優先順序

優先順序較高的提供者在擴充功能名稱重複時獲勝。

- 若 `native` 與 `gemini` 均輸出名稱為 `foo` 的擴充功能，保留 native 的項目。
- 優先順序較低的重複項目僅保留於 `result.all` 中，並標記 `_shadowed = true`。

### 提供者內部排序效果

由於去重採用「先出現者優先」策略，提供者內部的項目順序至關重要。

- Gemini 載入器的附加順序為**使用者優先**，其次為專案。
- 因此，`~/.gemini/extensions` 與 `<cwd>/.gemini/extensions` 之間名稱重複時，保留使用者項目並遮蔽專案項目。

相較之下，native 提供者透過 `getConfigDirs()` 以不同的設定目錄順序建立（先專案後使用者），因此 native 提供者內部的遮蔽方向相反。

---

## 使用者與專案行為摘要

就 Gemini 清單而言：

- 每次載入時均會掃描使用者與專案兩個根目錄。
- 專案根目錄固定為 `<cwd>/.gemini/extensions`（不向上遍歷祖先目錄）。
- Gemini 來源內部的名稱重複以使用者優先解析。
- 與優先順序較高的提供者（尤其是 native）名稱重複時，依優先順序落敗。

---

## 邊界：探索中繼資料與執行期擴充功能載入

`gemini-extension.json` 探索目前僅提供能力中繼資料（`Extension` 項目），**不會**直接載入可執行的 TS/JS 擴充功能模組。

執行期模組載入（`discoverAndLoadExtensions()` / `loadExtensions()`）使用 `extension-modules` 及明確路徑，且目前僅篩選提供者為 `native` 的自動探索模組。

實際影響：

- Gemini 清單擴充功能可作為能力記錄被探索。
- 它們本身不會被擴充功能載入器管線作為執行期擴充功能模組執行。

此邊界在現行實作中是刻意設計的，也說明了清單探索與可執行模組載入為何可能出現差異。
