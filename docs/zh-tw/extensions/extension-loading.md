---
title: 擴充功能載入（TypeScript/JavaScript 模組）
description: TypeScript 和 JavaScript 模組載入管線，用於擴充功能的解析、驗證和快取。
sidebar:
  order: 2
  label: 擴充功能載入
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# 擴充功能載入（TypeScript/JavaScript 模組）

本文件涵蓋程式碼代理程式如何在啟動時探索和載入**擴充功能模組**（`.ts`/`.js`）。

本文件**不**涵蓋 `gemini-extension.json` 資訊清單擴充功能（另行文件說明）。

## 此子系統的功能

擴充功能載入會建立模組入口檔案清單，使用 Bun 匯入每個模組，執行其工廠函式，並回傳：

- 已載入的擴充功能定義
- 每個路徑的載入錯誤（不會中止整體載入）
- 稍後由 `ExtensionRunner` 使用的共用擴充功能執行時物件

## 主要實作檔案

- `src/extensibility/extensions/loader.ts` — 路徑探索 + 匯入/執行
- `src/extensibility/extensions/index.ts` — 公開匯出
- `src/extensibility/extensions/runner.ts` — 載入後的執行時/事件執行
- `src/discovery/builtin.ts` — 擴充功能模組的原生自動探索提供者
- `src/config/settings.ts` — 載入合併後的 `extensions` / `disabledExtensions` 設定

---

## 擴充功能載入的輸入

### 1) 自動探索的原生擴充功能模組

`discoverAndLoadExtensions()` 首先向探索提供者請求 `extension-module` 能力項目，然後僅保留提供者 `native` 的項目。

有效的原生位置：

- 專案：`<cwd>/.xcsh/extensions`
- 使用者：`~/.xcsh/agent/extensions`

路徑根目錄來自原生提供者（`SOURCE_PATHS.native`）。

注意事項：

- 原生自動探索目前基於 `.xcsh`。
- 舊版 `.pi` 仍可在 `package.json` 資訊清單鍵（`pi.extensions`）中使用，但此處不作為原生根目錄。

### 2) 明確設定的路徑

在自動探索之後，設定的路徑會被附加並解析。

主要會話啟動路徑（`sdk.ts`）中的設定路徑來源：

1. CLI 提供的路徑（`--extension/-e`，而 `--hook` 也被視為擴充功能路徑）
2. 設定中的 `extensions` 陣列（合併全域 + 專案設定）

全域設定檔：

- `~/.xcsh/agent/config.yml`（或透過 `PI_CODING_AGENT_DIR` 自訂代理程式目錄）

專案設定檔：

- `<cwd>/.xcsh/settings.json`

範例：

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## 啟用/停用控制

### 停用探索

- CLI：`--no-extensions`
- SDK 選項：`disableExtensionDiscovery`

行為差異：

- SDK：當 `disableExtensionDiscovery=true` 時，仍會透過 `loadExtensions()` 載入 `additionalExtensionPaths`。
- CLI 路徑建構（`main.ts`）目前在設定 `--no-extensions` 時會清除 CLI 擴充功能路徑，因此在該模式下明確的 `-e/--hook` 不會被轉發。

### 停用特定擴充功能模組

`disabledExtensions` 設定依擴充功能 ID 格式過濾：

- `extension-module:<derivedName>`

`derivedName` 基於入口路徑（`getExtensionNameFromPath`），例如：

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

範例：

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## 路徑與入口解析

### 路徑正規化

對於設定的路徑：

1. 正規化 Unicode 空格
2. 展開 `~`
3. 若為相對路徑，則根據當前 `cwd` 解析

### 若設定的路徑是檔案

直接作為模組入口候選使用。

### 若設定的路徑是目錄

解析順序：

1. 該目錄中的 `package.json` 含有 `xcsh.extensions`（或舊版 `pi.extensions`）-> 使用宣告的入口
2. `index.ts`
3. `index.js`
4. 否則掃描一層以尋找擴充功能入口：
   - 直接的 `*.ts` / `*.js`
   - 子目錄的 `index.ts` / `index.js`
   - 子目錄的 `package.json` 含有 `xcsh.extensions` / `pi.extensions`

規則與限制：

- 不會遞迴探索超過一個子目錄層級
- 宣告的 `extensions` 資訊清單入口相對於該套件目錄解析
- 宣告的入口僅在檔案存在/允許存取時才包含
- 在 `*/index.{ts,js}` 配對中，TypeScript 優先於 JavaScript
- 符號連結被視為合格的檔案/目錄

### 忽略行為因來源而異

- 原生自動探索（探索輔助程式中的 `discoverExtensionModulePaths`）使用原生 glob，設定 `gitignore: true` 和 `hidden: false`。
- `loader.ts` 中的明確設定目錄掃描使用 `readdir` 規則，**不**套用 gitignore 過濾。

---

## 載入順序與優先順序

`discoverAndLoadExtensions()` 建立一個有序清單，然後呼叫 `loadExtensions()`。

順序：

1. 原生自動探索的模組
2. 明確設定的路徑（按提供順序）

在 `sdk.ts` 中，設定順序為：

1. CLI 額外路徑
2. 設定中的 `extensions`

去重複：

- 基於絕對路徑
- 先出現的路徑優先
- 後續重複項被忽略

含義：如果相同的模組路徑同時被自動探索和明確設定，它只會在第一個位置（自動探索階段）載入一次。

---

## 模組匯入與工廠合約

每個候選路徑透過動態匯入載入：

- `await import(resolvedPath)`
- 工廠函式為 `module.default ?? module`
- 工廠函式必須是函式（`ExtensionFactory`）

如果匯出不是函式，該路徑會以結構化錯誤失敗，載入繼續進行。

---

## 失敗處理與隔離

### 載入期間

每個擴充功能路徑的失敗會被捕獲為 `{ path, error }`，不會阻止其他路徑的載入。

常見情況：

- 匯入失敗 / 檔案遺失
- 無效的工廠匯出（非函式）
- 執行工廠時拋出例外

### 執行時隔離模型

- 擴充功能**未被沙箱化**（同一行程/執行時）。
- 它們共用一個 `EventBus` 和一個 `ExtensionRuntime` 實例。
- 在載入期間，執行時動作方法會刻意拋出 `ExtensionRuntimeNotInitializedError`；動作連接稍後在 `ExtensionRunner.initialize()` 中進行。

### 載入之後

當事件透過 `ExtensionRunner` 執行時，處理器例外會被捕獲並作為擴充功能錯誤發出，而非使執行器迴圈崩潰。

---

## 最小使用者/專案佈局範例

### 使用者層級

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### 專案層級

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`：

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

舊版資訊清單鍵仍可使用：

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
