---
title: Plugin Manager and Installer Plumbing
description: 外掛管理器內部機制，涵蓋安裝、驗證、依賴解析及生命週期管理。
sidebar:
  order: 5
  label: 外掛管理器
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# 外掛管理器與安裝器底層機制

本文件描述 `xcsh plugin` 操作如何變更磁碟上的外掛狀態，以及已安裝的外掛如何成為執行時期能力（目前支援工具，hooks/commands 路徑解析可用）。

## 範圍與架構

程式碼庫中有兩個外掛管理實作：

1. **CLI 命令使用的活躍路徑**：`PluginManager`（`src/extensibility/plugins/manager.ts`）
2. **舊版輔助模組**：安裝器函式（`src/extensibility/plugins/installer.ts`）

`xcsh plugin ...` 命令執行通過 `PluginManager`。

`installer.ts` 仍然記錄了重要的安全檢查和檔案系統行為，但它不是 `src/commands/plugin.ts` + `src/cli/plugin-cli.ts` 使用的路徑。

## 生命週期：從 CLI 調用到執行時期可用性

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

### 命令進入點

- `src/commands/plugin.ts` 定義命令/旗標並轉發至 `runPluginCommand`。
- `src/cli/plugin-cli.ts` 將子命令對應至 `PluginManager` 方法：
  - `install`、`uninstall`、`list`、`link`、`doctor`、`features`、`config`、`enable`、`disable`
- 不存在明確的 `update` 操作；更新是透過以新的套件/版本規格重新執行 `install` 來完成。

## 磁碟上的模型

全域外掛狀態位於 `~/.xcsh/plugins` 下：

- `package.json` — 供 `bun install`/`bun uninstall` 使用的依賴清單
- `node_modules/` — 已安裝的外掛套件或符號連結
- `xcsh-plugins.lock.json` — 執行時期狀態：
  - 每個外掛的啟用/停用狀態
  - 每個外掛選定的功能集
  - 持久化的外掛設定

專案本地覆寫位於：

- `<cwd>/.xcsh/plugin-overrides.json`

從管理器/載入器的角度來看，覆寫是唯讀的（此處沒有寫入路徑），可以為此專案停用外掛或覆寫功能/設定。

## 外掛規格解析與中繼資料解讀

## 安裝規格語法

`parsePluginSpec`（`parser.ts`）支援：

- `pkg` -> `features: null`（預設行為）
- `pkg[*]` -> 啟用所有清單中的功能
- `pkg[]` -> 不啟用任何選用功能
- `pkg[a,b]` -> 啟用指定功能
- `@scope/pkg@1.2.3[feat]` -> 帶作用域 + 版本的套件，並明確選擇功能

`extractPackageName` 會去除版本後綴，用於安裝後的磁碟路徑查詢。

## 清單來源與必要欄位

清單的解析順序為：

1. `package.json.xcsh`
2. 後備 `package.json.pi`
3. 後備 `{ version: package.version }`

影響：

- 管理器/載入器中沒有嚴格的結構描述驗證。
- 缺少 `xcsh`/`pi` 的套件仍然可以安裝和列出。
- 執行時期外掛載入（`getEnabledPlugins`）會跳過沒有 `xcsh`/`pi` 清單的套件。
- `manifest.version` 始終從套件的 `version` 覆寫。

格式錯誤的 `package.json` JSON 會在讀取時產生硬性失敗；清單結構格式錯誤可能僅在使用特定欄位時才會失敗。

## 安裝/更新流程（`PluginManager.install`）

1. 從安裝規格解析功能括號語法。
2. 根據正規表達式 + shell 特殊字元拒絕清單驗證套件名稱。
3. 確保外掛 `package.json` 存在（`xcsh-plugins`，私有依賴對應表）。
4. 在 `~/.xcsh/plugins` 中執行 `bun install <packageSpec>`。
5. 讀取已安裝套件的 `node_modules/<name>/package.json`。
6. 解析清單並計算 `enabledFeatures`：
   - `[*]`：所有宣告的功能（若無功能對應表則為 `null`）
   - `[a,b]`：驗證每個功能存在於清單功能對應表中
   - `[]`：空功能列表
   - 無修飾規格：`null`（稍後在載入器中使用預設策略）
7. 更新或插入鎖定檔案執行時期狀態：`{ version, enabledFeatures, enabled: true }`。

### 更新語意

由於更新是安裝驅動的：

- `xcsh plugin install pkg@newVersion` 會更新依賴和鎖定檔案版本。
- 現有設定會保留；狀態條目會針對版本/功能/啟用狀態被覆寫。
- 不存在獨立的「檢查更新」或交易式遷移邏輯。

## 移除流程（`PluginManager.uninstall`）

1. 驗證套件名稱。
2. 在外掛目錄中執行 `bun uninstall <name>`。
3. 從鎖定檔案中移除外掛執行時期狀態：
   - `config.plugins[name]`
   - `config.settings[name]`

如果解除安裝命令失敗，執行時期狀態不會被變更。

## 列表流程（`PluginManager.list`）

1. 從 `~/.xcsh/plugins/package.json` 讀取外掛依賴對應表。
2. 載入鎖定檔案執行時期設定（檔案不存在 -> 空預設值）。
3. 載入專案覆寫（`<cwd>/.xcsh/plugin-overrides.json`，解析/讀取錯誤 -> 空物件並發出警告）。
4. 對於每個具有可解析 package.json 的依賴：
   - 建構 `InstalledPlugin` 記錄
   - 合併功能/啟用狀態：
     - 基礎來自鎖定檔案（或預設值）
     - 專案覆寫可替換功能選擇
     - 專案 `disabled` 清單將外掛標記為停用

這是 CLI 狀態輸出和設定/功能操作使用的有效狀態。

## 連結流程（`PluginManager.link`）

`link` 透過將本地套件符號連結至 `~/.xcsh/plugins/node_modules/<pkg.name>` 來支援本地外掛開發。

行為：

1. 根據管理器 cwd 解析 `localPath`。
2. 要求本地 `package.json` 和 `name` 欄位。
3. 確保外掛目錄存在。
4. 對於帶作用域的名稱，建立作用域目錄。
5. 移除目標連結位置的現有路徑。
6. 建立符號連結。
7. 新增鎖定檔案執行時期條目，以預設功能（`null`）啟用。

注意事項：目前 `PluginManager.link` 不強制執行舊版 `installer.ts` 中存在的 `cwd` 路徑邊界檢查（`normalizedPath.startsWith(normalizedCwd)`），因此信任責任在於呼叫者。

## 執行時期載入：從已安裝外掛到可呼叫的能力

## 探索閘道

`getEnabledPlugins(cwd)`（`plugins/loader.ts`）讀取：

- 外掛依賴清單（`package.json`）
- 鎖定檔案執行時期狀態
- 透過 `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })` 讀取專案覆寫

過濾條件：

- 若無外掛 package.json 則跳過
- 若缺少清單（`xcsh`/`pi`）則跳過
- 若在鎖定檔案中全域停用則跳過
- 若專案停用則跳過

## 能力路徑解析

對於每個已啟用的外掛：

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

每個解析器包含基礎條目加上功能條目：

- 明確的功能列表 -> 僅選定的功能
- `enabledFeatures === null` -> 啟用標記為 `default: true` 的功能

缺失的檔案會被靜默跳過（`existsSync` 保護）。

## 目前的執行時期連接差異

- **工具目前已連接至執行時期**，透過 `discoverAndLoadCustomTools`（`custom-tools/loader.ts`），其呼叫 `getAllPluginToolPaths(cwd)`。
- 路徑在自訂工具探索中透過已解析的絕對路徑進行去重複（`seen` 集合，第一個路徑優先）。
- **Hooks/commands 解析器存在**且已匯出，但此程式碼路徑目前未像工具那樣將它們連接至執行時期註冊表。

## 鎖定/狀態管理細節

`PluginManager` 在每個實例中將執行時期設定快取在記憶體中（`#runtimeConfig`），並延遲載入一次。

載入行為：

- 鎖定檔案不存在 -> `{ plugins: {}, settings: {} }`
- 鎖定檔案讀取/解析失敗 -> 警告 + 相同的空預設值

儲存行為：

- 每次變更都寫入完整的格式化 JSON 鎖定檔案

不存在跨程序鎖定或合併策略；並行寫入者可能互相覆寫。

## 安全檢查與信任邊界

## 輸入/套件驗證

活躍管理器路徑強制執行套件名稱驗證：

- 帶作用域/不帶作用域套件規格的正規表達式（可選帶版本）
- 明確的 shell 特殊字元拒絕清單（`[;&|`$(){}[]<>\\]`）

這限制了在調用 `bun install/uninstall` 時的命令注入風險。

## 檔案系統信任邊界

- 外掛程式碼在匯入自訂工具模組時於行程內執行；無沙箱機制。
- 清單相對路徑會與外掛套件目錄連接，並僅進行存在性檢查。
- 外掛套件本身在安裝後即被視為可信任的程式碼。

## 僅限舊版安裝器的檢查

`installer.ts` 包含 `PluginManager.link` 中未鏡像的額外連結時期檢查：

- 本地路徑必須解析在專案 cwd 內
- 針對符號連結目標命名的額外套件名稱/路徑遍歷保護

由於 CLI 使用 `PluginManager`，這些更嚴格的連結保護目前不在主要路徑上。

## 失敗、部分成功與回滾行為

外掛管理器不是交易式的。

| 操作階段 | 失敗行為 | 回滾 |
| --- | --- | --- |
| `bun install` 失敗 | 安裝中止並輸出 stderr | 不適用（尚未寫入狀態） |
| 安裝成功，但清單/功能驗證失敗 | 命令失敗 | 不進行解除安裝回滾；依賴可能殘留在 `node_modules`/`package.json` 中 |
| 安裝成功，但鎖定檔案寫入失敗 | 命令失敗 | 不回滾已安裝的套件 |
| `bun uninstall` 成功，但鎖定檔案寫入失敗 | 命令失敗 | 套件已移除，過時的執行時期狀態可能殘留 |
| `link` 移除舊目標後符號連結建立失敗 | 命令失敗 | 不復原先前的連結/目錄 |

在操作上，`doctor --fix` 可以修復部分漂移（`bun install`、孤立設定清理、無效功能清理），但這是盡力而為的。

## 格式錯誤/缺失清單行為摘要

- 缺少 `xcsh`/`pi` 欄位：
  - 安裝/列表：容許（最小清單）
  - 執行時期已啟用外掛探索：作為非外掛跳過
- 安裝規格或 `features --set/--enable` 參考了缺失的功能：硬性錯誤，並列出可用功能
- 無效的 `plugin-overrides.json`：在管理器和載入器路徑中均被忽略，回退至 `{}`
- 清單參考的缺失工具/hook/command 檔案路徑：在解析器展開期間靜默忽略；僅由 `doctor` 標記為錯誤

## 模式差異與優先順序

- `--dry-run`（安裝）：回傳模擬安裝結果，不進行檔案系統/網路/狀態寫入。
- `--json`：僅影響輸出格式，不改變行為。
- 專案覆寫在功能/設定檢視方面始終優先於全域鎖定檔案。
- 有效啟用狀態為 `runtimeEnabled && !projectDisabled`。

## 實作檔案

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI 命令宣告與旗標對應
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — 操作分派、面向使用者的命令處理器
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — 活躍的安裝/移除/列表/連結/狀態/doctor 實作
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — 舊版安裝器輔助工具與額外連結安全檢查
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 已啟用外掛探索與工具/hook/command 路徑解析
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — 安裝規格與套件名稱解析輔助工具
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — 清單/執行時期/覆寫型別契約
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — 外掛提供的工具模組之執行時期連接
