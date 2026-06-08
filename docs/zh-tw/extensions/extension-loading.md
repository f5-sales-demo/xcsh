---
title: 擴充功能載入（TypeScript/JavaScript 模組）
description: 擴充功能的 TypeScript 和 JavaScript 模組載入管線，包含解析、驗證與快取機制。
sidebar:
  order: 2
  label: 擴充功能載入
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# 擴充功能載入（TypeScript/JavaScript 模組）

本文件涵蓋程式撰寫代理程式如何在啟動時探索並載入**擴充功能模組**（`.ts`/`.js`）。

本文件**不**涵蓋 `gemini-extension.json` 清單擴充功能（另有獨立文件說明）。

## 此子系統的功能

擴充功能載入會建立一份模組入口檔案清單，透過 Bun 匯入每個模組，執行其工廠函式，並回傳：

- 已載入的擴充功能定義
- 各路徑的載入錯誤（不會中止整體載入流程）
- 一個共享的擴充功能執行階段物件，供後續 `ExtensionRunner` 使用

## 主要實作檔案

- `src/extensibility/extensions/loader.ts` — 路徑探索 + 匯入/執行
- `src/extensibility/extensions/index.ts` — 公開匯出
- `src/extensibility/extensions/runner.ts` — 載入後的執行階段/事件執行
- `src/discovery/builtin.ts` — 擴充功能模組的原生自動探索提供者
- `src/config/settings.ts` — 載入合併後的 `extensions` / `disabledExtensions` 設定

---

## 擴充功能載入的輸入

### 1) 自動探索的原生擴充功能模組

`discoverAndLoadExtensions()` 首先向探索提供者請求具有 `extension-module` 能力的項目，然後僅保留提供者為 `native` 的項目。

有效的原生位置：

- 專案層級：`<cwd>/.xcsh/extensions`
- 使用者層級：`~/.xcsh/agent/extensions`

路徑根目錄來自原生提供者（`SOURCE_PATHS.native`）。

注意事項：

- 原生自動探索目前基於 `.xcsh`。
- 舊版 `.pi` 在 `package.json` 清單鍵（`pi.extensions`）中仍被接受，但此處不作為原生根目錄。

### 2) 明確設定的路徑

自動探索之後，會附加並解析已設定的路徑。

主要工作階段啟動路徑（`sdk.ts`）中的設定路徑來源：

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
- CLI 路徑建構（`main.ts`）目前在設定 `--no-extensions` 時會清除 CLI 擴充功能路徑，因此在該模式下不會轉送明確的 `-e/--hook`。

### 停用特定擴充功能模組

`disabledExtensions` 設定以擴充功能 ID 格式進行篩選：

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

對於已設定的路徑：

1. 正規化 Unicode 空格
2. 展開 `~`
3. 如為相對路徑，以當前 `cwd` 為基準進行解析

### 若設定的路徑為檔案

則直接作為模組入口候選使用。

### 若設定的路徑為目錄

解析順序：

1. 該目錄中的 `package.json` 含有 `xcsh.extensions`（或舊版 `pi.extensions`）-> 使用宣告的入口
2. `index.ts`
3. `index.js`
4. 否則掃描一層目錄以尋找擴充功能入口：
   - 直接的 `*.ts` / `*.js`
   - 子目錄的 `index.ts` / `index.js`
   - 子目錄的 `package.json` 含有 `xcsh.extensions` / `pi.extensions`

規則與限制：

- 不會遞迴探索超過一層子目錄
- 宣告的 `extensions` 清單入口會相對於該套件目錄進行解析
- 僅在檔案存在/允許存取時才會包含宣告的入口
- 在 `*/index.{ts,js}` 配對中，TypeScript 優先於 JavaScript
- 符號連結視為合格的檔案/目錄

### 忽略行為因來源而異

- 原生自動探索（探索輔助工具中的 `discoverExtensionModulePaths`）使用原生 glob，設定 `gitignore: true` 和 `hidden: false`。
- `loader.ts` 中明確設定的目錄掃描使用 `readdir` 規則，且**不**套用 gitignore 篩選。

---

## 載入順序與優先順序

`discoverAndLoadExtensions()` 建立一個有序清單，然後呼叫 `loadExtensions()`。

順序：

1. 原生自動探索的模組
2. 明確設定的路徑（依提供順序）

在 `sdk.ts` 中，設定順序為：

1. CLI 附加路徑
2. 設定中的 `extensions`

去重複：

- 基於絕對路徑
- 先出現的路徑優先
- 後續的重複項目會被忽略

影響：若同一模組路徑同時被自動探索和明確設定，則僅在第一個位置（自動探索階段）載入一次。

---

## 模組匯入與工廠函式契約

每個候選路徑都透過動態匯入載入：

- `await import(resolvedPath)`
- 工廠函式為 `module.default ?? module`
- 工廠函式必須是一個函式（`ExtensionFactory`）

若匯出不是函式，該路徑會以結構化錯誤失敗，載入流程繼續進行。

---

## 失敗處理與隔離

### 載入期間

每個擴充功能路徑的失敗會被擷取為 `{ path, error }`，不會阻止其他路徑的載入。

常見情況：

- 匯入失敗 / 檔案遺失
- 無效的工廠函式匯出（非函式）
- 執行工廠函式時拋出例外

### 執行階段隔離模型

- 擴充功能**未進行沙箱隔離**（相同程序/執行環境）。
- 它們共享一個 `EventBus` 和一個 `ExtensionRuntime` 實例。
- 載入期間，執行階段的動作方法會刻意拋出 `ExtensionRuntimeNotInitializedError`；動作連線會在後續的 `ExtensionRunner.initialize()` 中進行。

### 載入之後

當事件透過 `ExtensionRunner` 執行時，處理常式的例外會被捕獲並作為擴充功能錯誤發出，而不會導致執行器迴圈崩潰。

---

## 最小化的使用者/專案配置範例

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

舊版清單鍵仍被接受：

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
