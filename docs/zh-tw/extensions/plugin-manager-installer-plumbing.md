---
title: 外掛程式管理器與安裝程序底層機制
description: 外掛程式管理器內部實作，涵蓋安裝、驗證、相依性解析與生命週期管理。
sidebar:
  order: 5
  label: 外掛程式管理器
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# 外掛程式管理器與安裝程序底層機制

本文件說明 `xcsh plugin` 操作如何在磁碟上變更外掛程式狀態，以及已安裝的外掛程式如何成為執行期能力（目前為工具，Hooks/指令路徑解析亦已可用）。

## 範疇與架構

程式碼庫中存在兩套外掛程式管理實作：

1. **CLI 指令所使用的現行路徑**：`PluginManager`（`src/extensibility/plugins/manager.ts`）
2. **舊版輔助模組**：安裝函式（`src/extensibility/plugins/installer.ts`）

`xcsh plugin ...` 指令執行會透過 `PluginManager` 進行。

`installer.ts` 仍記載了重要的安全性檢查與檔案系統行為，但它並非 `src/commands/plugin.ts` + `src/cli/plugin-cli.ts` 所使用的路徑。

## 生命週期：從 CLI 呼叫到執行期可用性

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### 指令進入點

- `src/commands/plugin.ts` 定義指令/旗標並轉發至 `runPluginCommand`。
- `src/cli/plugin-cli.ts` 將子指令對應至 `PluginManager` 方法：
  - `install`、`uninstall`、`list`、`link`、`doctor`、`features`、`config`、`enable`、`disable`
- 不存在明確的 `update` 動作；更新是透過重新執行 `install` 並指定新的套件/版本規格來完成。

## 磁碟上的模型

全域外掛程式狀態存放於 `~/.xcsh/plugins`：

- `package.json` — 供 `bun install`/`bun uninstall` 使用的相依性清單
- `node_modules/` — 已安裝的外掛程式套件或符號連結
- `xcsh-plugins.lock.json` — 執行期狀態：
  - 各外掛程式的啟用/停用狀態
  - 各外掛程式所選取的功能集
  - 持久化的外掛程式設定

專案本地覆寫設定存放於：

- `<cwd>/.xcsh/plugin-overrides.json`

從管理器/載入器的角度來看，覆寫設定為唯讀（此處無寫入路徑），可停用外掛程式，或為此專案覆寫功能/設定。

## 外掛程式規格解析與詮釋資料解讀

## 安裝規格語法

`parsePluginSpec`（`parser.ts`）支援：

- `pkg` -> `features: null`（預設行為）
- `pkg[*]` -> 啟用清單中的所有功能
- `pkg[]` -> 不啟用任何選用功能
- `pkg[a,b]` -> 啟用具名功能
- `@scope/pkg@1.2.3[feat]` -> 含範疇與版本的套件，並明確選取功能

`extractPackageName` 會在安裝後去除版本後綴，以便進行磁碟上的路徑查詢。

## 清單來源與必要欄位

清單的解析順序如下：

1. `package.json.xcsh`
2. 備用 `package.json.pi`
3. 備用 `{ version: package.version }`

影響說明：

- 管理器/載入器中不存在嚴格的結構描述驗證。
- 缺少 `xcsh`/`pi` 的套件仍可安裝並列出。
- 執行期外掛程式載入（`getEnabledPlugins`）會跳過沒有 `xcsh`/`pi` 清單的套件。
- `manifest.version` 始終從套件的 `version` 覆寫。

`package.json` JSON 格式錯誤會在讀取時造成硬性失敗；清單結構錯誤可能在後續消費特定欄位時才發生失敗。

## 安裝/更新流程（`PluginManager.install`）

1. 從安裝規格解析功能括號語法。
2. 以正規表示式與 Shell 特殊字元黑名單驗證套件名稱。
3. 確認外掛程式 `package.json` 存在（`xcsh-plugins`、私有相依性對應）。
4. 在 `~/.xcsh/plugins` 中執行 `bun install <packageSpec>`。
5. 讀取已安裝套件的 `node_modules/<name>/package.json`。
6. 解析清單並計算 `enabledFeatures`：
   - `[*]`：所有已宣告的功能（若無功能對應則為 `null`）
   - `[a,b]`：驗證各功能是否存在於清單功能對應中
   - `[]`：空功能列表
   - 裸規格：`null`（在載入器中稍後使用預設策略）
7. 更新插入鎖定檔執行期狀態：`{ version, enabledFeatures, enabled: true }`。

### 更新語意

由於更新由安裝驅動：

- `xcsh plugin install pkg@newVersion` 會更新相依性與鎖定檔版本。
- 現有設定會被保留；狀態條目的版本/功能/啟用狀態會被覆寫。
- 不存在獨立的「檢查更新」或交易式遷移邏輯。

## 移除流程（`PluginManager.uninstall`）

1. 驗證套件名稱。
2. 在外掛程式目錄中執行 `bun uninstall <name>`。
3. 從鎖定檔移除外掛程式執行期狀態：
   - `config.plugins[name]`
   - `config.settings[name]`

若卸載指令失敗，執行期狀態不會變更。

## 列出流程（`PluginManager.list`）

1. 從 `~/.xcsh/plugins/package.json` 讀取外掛程式相依性對應。
2. 載入鎖定檔執行期設定（檔案不存在 -> 空白預設值）。
3. 載入專案覆寫設定（`<cwd>/.xcsh/plugin-overrides.json`，解析/讀取錯誤 -> 空白物件並顯示警告）。
4. 對每個具有可解析 package.json 的相依性：
   - 建立 `InstalledPlugin` 記錄
   - 合併功能/啟用狀態：
     - 基礎狀態來自鎖定檔（或預設值）
     - 專案覆寫可取代功能選取
     - 專案 `disabled` 清單會遮蔽外掛程式為停用狀態

這是 CLI 狀態輸出與設定/功能操作所使用的有效狀態。

## 連結流程（`PluginManager.link`）

`link` 透過將本地套件符號連結至 `~/.xcsh/plugins/node_modules/<pkg.name>` 來支援本地外掛程式開發。

行為：

1. 以管理器的 cwd 解析 `localPath`。
2. 要求本地 `package.json` 及 `name` 欄位。
3. 確認外掛程式目錄存在。
4. 若為範疇名稱，建立範疇目錄。
5. 移除目標連結位置的現有路徑。
6. 建立符號連結。
7. 新增執行期鎖定檔條目，以預設功能啟用（`null`）。

注意事項：目前 `PluginManager.link` 並未強制執行舊版 `installer.ts` 中的 `cwd` 路徑邊界檢查（`normalizedPath.startsWith(normalizedCwd)`），因此信任責任由呼叫端承擔。

## 執行期載入：從已安裝外掛程式到可呼叫的能力

## 探索閘道

`getEnabledPlugins(cwd)`（`plugins/loader.ts`）讀取：

- 外掛程式相依性清單（`package.json`）
- 鎖定檔執行期狀態
- 透過 `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })` 取得的專案覆寫設定

過濾規則：

- 若無外掛程式 package.json 則跳過
- 若清單（`xcsh`/`pi`）不存在則跳過
- 若在鎖定檔中全域停用則跳過
- 若被專案停用則跳過

## 能力路徑解析

對每個已啟用的外掛程式：

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

各解析器包含基礎條目與功能條目：

- 明確的功能清單 -> 僅選取的功能
- `enabledFeatures === null` -> 啟用標記為 `default: true` 的功能

遺失的檔案會被靜默跳過（`existsSync` 守衛）。

## 目前執行期接線差異

- **工具今日已接入執行期**，透過 `discoverAndLoadCustomTools`（`custom-tools/loader.ts`），其呼叫 `getAllPluginToolPaths(cwd)`。
- 路徑在自訂工具探索中以已解析的絕對路徑進行去重（`seen` 集合，第一個路徑優先）。
- **Hooks/指令解析器已存在**且已匯出，但此程式碼路徑目前並未以與工具相同的方式將其接入執行期登錄。

## 鎖定/狀態管理細節

`PluginManager` 會在每個實例中快取執行期設定（`#runtimeConfig`），並於首次存取時延遲載入。

載入行為：

- 鎖定檔不存在 -> `{ plugins: {}, settings: {} }`
- 鎖定檔讀取/解析失敗 -> 警告 + 相同的空白預設值

儲存行為：

- 每次變更時以格式化 JSON 寫入完整鎖定檔

不存在跨行程鎖定或合併策略；並發寫入者可能互相覆寫。

## 安全性檢查與信任邊界

## 輸入/套件驗證

現行管理器路徑強制執行套件名稱驗證：

- 含範疇/不含範疇套件規格的正規表示式（可選擇性包含版本）
- 明確的 Shell 特殊字元黑名單（`[;&|`$(){}[]<>\\]`）

這降低了呼叫 `bun install/uninstall` 時的指令注入風險。

## 檔案系統信任邊界

- 匯入自訂工具模組時，外掛程式程式碼會在行程內執行；不存在沙箱機制。
- 清單相對路徑會與外掛程式套件目錄合併，且僅檢查存在性。
- 外掛程式套件本身在安裝後即被視為受信任的程式碼。

## 僅存於舊版安裝程式的檢查

`installer.ts` 包含 `PluginManager.link` 中未鏡像的額外連結時期檢查：

- 本地路徑必須解析至專案 cwd 內部
- 符號連結目標命名的額外套件名稱/路徑遍歷防護

由於 CLI 使用 `PluginManager`，這些較嚴格的連結守衛目前不在主要路徑上。

## 失敗、部分成功與回滾行為

外掛程式管理器並非交易式。

| 操作階段 | 失敗行為 | 回滾 |
| --- | --- | --- |
| `bun install` 失敗 | 安裝中止並顯示 stderr | N/A（尚未寫入狀態） |
| 安裝成功，但清單/功能驗證失敗 | 指令失敗 | 無卸載回滾；相依性可能仍殘留於 `node_modules`/`package.json` |
| 安裝成功，但鎖定檔寫入失敗 | 指令失敗 | 無已安裝套件的回滾 |
| `bun uninstall` 成功，但鎖定檔寫入失敗 | 指令失敗 | 套件已移除，可能殘留過時的執行期狀態 |
| `link` 移除舊目標後符號連結建立失敗 | 指令失敗 | 不還原先前的連結/目錄 |

在操作上，`doctor --fix` 可修復部分漂移（`bun install`、孤立設定清理、無效功能清理），但屬於盡力而為。

## 清單格式錯誤/遺失的行為摘要

- 缺少 `xcsh`/`pi` 欄位：
  - 安裝/列出：可容忍（最小清單）
  - 執行期啟用外掛程式探索：跳過，視為非外掛程式
- 安裝規格或 `features --set/--enable` 所參照的功能遺失：硬性錯誤，並顯示可用功能清單
- 無效的 `plugin-overrides.json`：在管理器與載入器路徑中均忽略，並退回至 `{}`
- 清單所參照的工具/Hook/指令檔案路徑遺失：在解析器展開期間靜默忽略；僅由 `doctor` 標記為錯誤

## 模式差異與優先順序

- `--dry-run`（安裝）：回傳合成的安裝結果，不寫入檔案系統/網路/狀態。
- `--json`：僅影響輸出格式，不變更行為。
- 在功能/設定檢視中，專案覆寫設定始終優先於全域鎖定檔。
- 有效啟用狀態為 `runtimeEnabled && !projectDisabled`。

## 實作檔案

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI 指令宣告與旗標對應
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — 動作派送、面向使用者的指令處理器
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — 現行安裝/移除/列出/連結/狀態/doctor 實作
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — 舊版安裝程式輔助函式與額外連結安全性檢查
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 已啟用外掛程式探索與工具/Hook/指令路徑解析
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — 安裝規格與套件名稱解析輔助函式
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — 清單/執行期/覆寫型別契約
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — 外掛程式所提供工具模組的執行期接線
