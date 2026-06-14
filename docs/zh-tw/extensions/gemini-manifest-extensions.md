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

本文件說明程式碼代理如何發現並解析 Gemini 風格的清單擴充功能（`gemini-extension.json`）至 `extensions` 能力中。

本文件**不**涵蓋 TypeScript/JavaScript 擴充模組載入（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`），該部分記錄於 `extension-loading.md`。

## 實作檔案

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 發現範圍

Gemini 提供者（`id: gemini`，優先級 `60`）註冊一個 `extensions` 載入器，掃描兩個固定根目錄：

- 使用者：`~/.gemini/extensions`
- 專案：`<cwd>/.gemini/extensions`

路徑解析直接透過 `getUserPath()` / `getProjectPath()` 從 `ctx.home` 與 `ctx.cwd` 取得。

重要的範圍規則：專案查找**僅限當前工作目錄**，不會向上遍歷父目錄。

---

## 目錄掃描規則

對於每個根目錄（`~/.gemini/extensions` 與 `<cwd>/.gemini/extensions`），發現程序執行以下步驟：

1. `readDirEntries(root)`
2. 僅保留直接子目錄（`entry.isDirectory()`）
3. 對每個子目錄 `<name>`，嘗試讀取：
   - `<root>/<name>/gemini-extension.json`

不進行超過一個目錄層級的遞迴掃描。

### 隱藏目錄

Gemini 清單發現**不會**過濾以點號開頭的目錄名稱。若隱藏子目錄存在且包含 `gemini-extension.json`，則會被納入考量。

### 缺失或不可讀的檔案

若 `gemini-extension.json` 缺失或不可讀，該目錄將被靜默跳過（不發出警告）。

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

發現階段的行為設計上較為寬鬆：

- 要求 JSON 解析成功。
- 除 JSON 語法外，不對欄位類型或內容進行執行期模式驗證。
- 解析後的物件將作為 `manifest` 儲存於能力項目中。

### 名稱正規化

`Extension.name` 設定規則如下：

1. 若 `manifest.name` 不為 `null` 或 `undefined`，則使用該值
2. 否則使用擴充功能的目錄名稱

此處不強制套用字串類型驗證。

---

## 實體化為能力項目

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
- 登錄表層級對 `extensions` 的能力驗證僅檢查 `name` 與 `path` 是否存在。
- 清單內部欄位（`mcpServers`、`tools`、`context`）在發現階段不進行驗證。

---

## 錯誤處理與警告語意

### 發出警告

- 清單檔案中的 JSON 格式無效：
  - 警告格式：`Invalid JSON in <manifestPath>`

### 不發出警告（靜默跳過）

- `extensions` 目錄不存在
- 子目錄中沒有 `gemini-extension.json`
- 清單檔案不可讀
- 清單 JSON 語法正確但語意上有異常或不完整

這表示接受部分有效性：僅 JSON 語法失敗才會發出警告。

---

## 與其他來源的優先順序及去重機制

`extensions` 能力由能力登錄表跨提供者彙總。

目前提供此能力的提供者：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）優先級 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）優先級 `60`

去重鍵為 `ext.name`（`extensionCapability.key = ext => ext.name`）。

### 跨提供者優先順序

優先級較高的提供者在擴充功能名稱重複時獲勝。

- 若 `native` 與 `gemini` 均輸出擴充功能名稱 `foo`，則保留 native 的項目。
- 優先級較低的重複項目僅保留於 `result.all` 中，並標記 `_shadowed = true`。

### 提供者內部順序影響

由於去重採用「先出現者優先」的策略，提供者內部的項目順序至關重要。

- Gemini 載入器依序附加：**使用者優先**，其次為**專案**。
- 因此，`~/.gemini/extensions` 與 `<cwd>/.gemini/extensions` 之間的同名擴充功能將保留使用者項目，並遮蔽專案項目。

相較之下，native 提供者以不同方式建立設定目錄順序（`getConfigDirs()` 中先 `project` 後 `user`），因此 native 提供者內部的遮蔽方向相反。

---

## 使用者與專案行為摘要

針對 Gemini 清單：

- 每次載入時，使用者與專案根目錄均會被掃描。
- 專案根目錄固定為 `<cwd>/.gemini/extensions`（不向上遍歷祖先目錄）。
- Gemini 來源內部的同名衝突以使用者優先解決。
- 與優先級較高的提供者（尤其是 native）之間的同名衝突，則依優先級讓步。

---

## 邊界：發現元資料與執行期擴充載入

`gemini-extension.json` 的發現目前提供能力元資料（`Extension` 項目），**不**直接載入可執行的 TS/JS 擴充模組。

執行期模組載入（`discoverAndLoadExtensions()` / `loadExtensions()`）使用 `extension-modules` 與明確路徑，且目前將自動發現的模組篩選為僅限 `native` 提供者。

實際影響：

- Gemini 清單擴充功能可作為能力記錄被發現。
- 它們本身不會被擴充載入器管道作為執行期擴充模組執行。

此邊界在當前實作中是有意為之的設計，說明了為何清單發現與可執行模組載入可能出現差異。
