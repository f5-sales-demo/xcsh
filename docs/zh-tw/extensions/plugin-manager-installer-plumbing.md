---
title: 套件管理器與安裝程式內部機制
description: 套件管理器內部原理，涵蓋安裝、驗證、相依性解析及生命週期管理。
sidebar:
  order: 5
  label: 套件管理器
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# 套件管理器與安裝程式內部機制

本文件說明 `xcsh plugin` 操作如何改變磁碟上的套件狀態，以及已安裝的套件如何成為執行時期功能（目前為工具，鉤子/指令路徑解析亦已可用）。

## 範疇與架構

程式碼庫中有兩套套件管理實作：

1. **CLI 指令使用的主要路徑**：`PluginManager`（`src/extensibility/plugins/manager.ts`）
2. **舊版輔助模組**：安裝程式函式（`src/extensibility/plugins/installer.ts`）

`xcsh plugin ...` 指令執行會經過 `PluginManager`。

`installer.ts` 仍記錄了重要的安全檢查與檔案系統行為，但並非 `src/commands/plugin.ts` + `src/cli/plugin-cli.ts` 所使用的路徑。

## 生命週期：從 CLI 呼叫到執行時期可用性

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
- 不存在明確的 `update` 動作；更新是透過以新套件/版本規格重新執行 `install` 來完成。

## 磁碟模型

全域套件狀態儲存於 `~/.xcsh/plugins`：

- `package.json` — 由 `bun install`/`bun uninstall` 使用的相依性清單
- `node_modules/` — 已安裝的套件或符號連結
- `xcsh-plugins.lock.json` — 執行時期狀態：
  - 每個套件的啟用/停用狀態
  - 每個套件所選的功能集
  - 持久化的套件設定

專案本機覆寫設定儲存於：

- `<cwd>/.xcsh/plugin-overrides.json`

覆寫設定從管理器/載入器角度而言是唯讀的（此處無寫入路徑），可停用套件或覆寫此專案的功能/設定。

## 套件規格解析與元資料解讀

## 安裝規格語法

`parsePluginSpec`（`parser.ts`）支援：

- `pkg` -> `features: null`（預設行為）
- `pkg[*]` -> 啟用清單中的所有功能
- `pkg[]` -> 不啟用任何可選功能
- `pkg[a,b]` -> 啟用具名功能
- `@scope/pkg@1.2.3[feat]` -> 帶有明確功能選擇的有範疇 + 版本化套件

`extractPackageName` 在安裝後的磁碟路徑查詢中會去除版本後綴。

## 清單來源與必要欄位

清單的解析順序為：

1. `package.json.xcsh`
2. 後備 `package.json.pi`
3. 後備 `{ version: package.version }`

影響：

- 管理器/載入器中不存在嚴格的結構描述驗證。
- 缺少 `xcsh`/`pi` 的套件仍可安裝並列出。
- 執行時期套件載入（`getEnabledPlugins`）會跳過沒有 `xcsh`/`pi` 清單的套件。
- `manifest.version` 一律從套件的 `version` 覆寫。

格式錯誤的 `package.json` JSON 在讀取時即為嚴重失敗；格式錯誤的清單結構可能要等到特定欄位被使用時才會失敗。

## 安裝/更新流程（`PluginManager.install`）

1. 從安裝規格解析功能括號語法。
2. 以正規表示式 + 殼層特殊字元拒絕清單驗證套件名稱。
3. 確保套件 `package.json` 存在（`xcsh-plugins`、私有相依性對應）。
4. 在 `~/.xcsh/plugins` 中執行 `bun install <packageSpec>`。
5. 讀取已安裝套件的 `node_modules/<name>/package.json`。
6. 解析清單並計算 `enabledFeatures`：
   - `[*]`：所有已宣告的功能（若無功能對應則為 `null`）
   - `[a,b]`：驗證每個功能是否存在於清單功能對應中
   - `[]`：空功能清單
   - 裸規格：`null`（稍後在載入器中使用預設策略）
7. 在鎖定檔執行時期狀態中進行更新插入：`{ version, enabledFeatures, enabled: true }`。

### 更新語意

由於更新是由安裝驅動的：

- `xcsh plugin install pkg@newVersion` 會更新相依性與鎖定檔版本。
- 現有設定會保留；版本/功能/啟用狀態的條目會被覆寫。
- 不存在獨立的「檢查更新」或交易式遷移邏輯。

## 移除流程（`PluginManager.uninstall`）

1. 驗證套件名稱。
2. 在套件目錄中執行 `bun uninstall <name>`。
3. 從鎖定檔中移除套件執行時期狀態：
   - `config.plugins[name]`
   - `config.settings[name]`

若解除安裝指令失敗，執行時期狀態不會變更。

## 列出流程（`PluginManager.list`）

1. 從 `~/.xcsh/plugins/package.json` 讀取套件相依性對應。
2. 載入鎖定檔執行時期設定（檔案不存在時 -> 空預設值）。
3. 載入專案覆寫設定（`<cwd>/.xcsh/plugin-overrides.json`，解析/讀取錯誤 -> 帶有警告的空物件）。
4. 對每個具有可解析 package.json 的相依性：
   - 建立 `InstalledPlugin` 記錄
   - 合併功能/啟用狀態：
     - 基礎來自鎖定檔（或預設值）
     - 專案覆寫可替換功能選擇
     - 專案 `disabled` 清單會將套件標示為停用

此為 CLI 狀態輸出及設定/功能操作所使用的有效狀態。

## 連結流程（`PluginManager.link`）

`link` 透過將本機套件符號連結至 `~/.xcsh/plugins/node_modules/<pkg.name>` 來支援本機套件開發。

行為：

1. 以管理器的 cwd 解析 `localPath`。
2. 要求本機 `package.json` 及 `name` 欄位。
3. 確保套件目錄存在。
4. 若為有範疇名稱，建立範疇目錄。
5. 移除目標連結位置的現有路徑。
6. 建立符號連結。
7. 以預設功能（`null`）新增已啟用的執行時期鎖定檔條目。

注意：目前的 `PluginManager.link` 不強制執行舊版 `installer.ts` 中存在的 `cwd` 路徑邊界檢查（`normalizedPath.startsWith(normalizedCwd)`），因此信任由呼叫者負責。

## 執行時期載入：從已安裝套件到可呼叫的功能

## 探索關卡

`getEnabledPlugins(cwd)`（`plugins/loader.ts`）讀取：

- 套件相依性清單（`package.json`）
- 鎖定檔執行時期狀態
- 透過 `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })` 取得的專案覆寫設定

過濾條件：

- 若無套件 package.json 則跳過
- 若清單（`xcsh`/`pi`）不存在則跳過
- 若在鎖定檔中全域停用則跳過
- 若專案停用則跳過

## 功能路徑解析

對每個已啟用的套件：

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

每個解析器包含基礎條目加上功能條目：

- 明確的功能清單 -> 僅選取的功能
- `enabledFeatures === null` -> 啟用標記為 `default: true` 的功能

遺失的檔案會被靜默略過（`existsSync` 防護）。

## 目前執行時期連線差異

- **工具今日已連線至執行時期**，透過 `discoverAndLoadCustomTools`（`custom-tools/loader.ts`），其呼叫 `getAllPluginToolPaths(cwd)`。
- 路徑在自訂工具探索中以解析後的絕對路徑進行去重複（`seen` 集合，第一個路徑優先）。
- **鉤子/指令解析器已存在**且已匯出，但此程式碼路徑目前並未以工具連線的相同方式將其連線至執行時期登錄中。

## 鎖定/狀態管理細節

`PluginManager` 在每個實例中快取執行時期設定於記憶體（`#runtimeConfig`），並於首次使用時延遲載入。

載入行為：

- 鎖定檔不存在 -> `{ plugins: {}, settings: {} }`
- 鎖定檔讀取/解析失敗 -> 警告 + 相同的空預設值

儲存行為：

- 每次狀態異動都會寫入完整的鎖定檔 JSON（美化列印格式）

不存在跨進程鎖定或合併策略；並行寫入者可能互相覆寫。

## 安全檢查與信任邊界

## 輸入/套件驗證

主要管理器路徑強制執行套件名稱驗證：

- 適用於有範疇/無範疇套件規格的正規表示式（可選帶版本）
- 明確的殼層特殊字元拒絕清單（`[;&|`$(){}[]<>\\]`）

這限制了呼叫 `bun install/uninstall` 時的指令注入風險。

## 檔案系統信任邊界

- 套件程式碼在匯入自訂工具模組時於同進程中執行；無沙箱化。
- 清單相對路徑會相對於套件目錄進行合併，並僅進行存在性檢查。
- 套件本身在安裝後即為受信任的程式碼。

## 僅限舊版安裝程式的檢查

`installer.ts` 包含未在 `PluginManager.link` 中鏡像的額外連結時檢查：

- 本機路徑必須解析至專案 cwd 內部
- 符號連結目標命名的額外套件名稱/路徑遍歷防護

由於 CLI 使用 `PluginManager`，這些更嚴格的連結防護目前並不在主要路徑上。

## 失敗、部分成功與回滾行為

套件管理器並非交易式的。

| 操作階段 | 失敗行為 | 回滾 |
| --- | --- | --- |
| `bun install` 失敗 | 安裝中止並顯示標準錯誤輸出 | 不適用（尚未進行狀態寫入） |
| 安裝成功，然後清單/功能驗證失敗 | 指令失敗 | 無解除安裝回滾；相依性可能留在 `node_modules`/`package.json` 中 |
| 安裝成功，然後鎖定檔寫入失敗 | 指令失敗 | 無已安裝套件的回滾 |
| `bun uninstall` 成功，鎖定檔寫入失敗 | 指令失敗 | 套件已移除，可能留有過時的執行時期狀態 |
| `link` 移除舊目標後符號連結建立失敗 | 指令失敗 | 無先前連結/目錄的還原 |

在操作層面，`doctor --fix` 可修復部分不一致狀態（`bun install`、孤立設定清理、無效功能清理），但屬於盡力而為。

## 格式錯誤/遺失清單行為摘要

- 遺失 `xcsh`/`pi` 欄位：
  - 安裝/列出：可容忍（最小清單）
  - 執行時期已啟用套件探索：跳過為非套件
- 安裝規格或 `features --set/--enable` 參照的遺失功能：嚴重錯誤，並顯示可用功能清單
- 無效的 `plugin-overrides.json`：在管理器與載入器路徑中均被忽略，並後備至 `{}`
- 清單參照的遺失工具/鉤子/指令檔案路徑：在解析器展開期間被靜默忽略；僅由 `doctor` 標記為錯誤

## 模式差異與優先順序

- `--dry-run`（安裝）：回傳模擬的安裝結果，不進行任何檔案系統/網路/狀態寫入。
- `--json`：僅影響輸出格式，不改變行為。
- 專案覆寫設定在功能/設定視圖中一律優先於全域鎖定檔。
- 有效啟用狀態為 `runtimeEnabled && !projectDisabled`。

## 實作檔案

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI 指令宣告與旗標對應
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — 動作分派、面向使用者的指令處理器
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — 主要安裝/移除/列出/連結/狀態/doctor 實作
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — 舊版安裝程式輔助程式與額外連結安全檢查
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 已啟用套件探索與工具/鉤子/指令路徑解析
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — 安裝規格與套件名稱解析輔助程式
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — 清單/執行時期/覆寫型別合約
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — 套件提供的工具模組執行時期連線
