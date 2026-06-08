---
title: 設定探索與解析
description: xcsh 如何從專案、使用者及企業根目錄探索、解析及分層設定。
sidebar:
  order: 1
  label: 設定
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# 設定探索與解析

本文件描述 coding-agent 目前如何解析設定：掃描哪些根目錄、優先順序如何運作，以及解析後的設定如何被 settings、skills、hooks、tools 和 extensions 所使用。

## 範圍

主要實作：

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

關鍵整合點：

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## 解析流程（視覺化）

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) 設定根目錄與來源順序

## 標準根目錄

`src/config.ts` 定義了一個固定的來源優先順序清單：

1. `.xcsh`（原生）
2. `.claude`
3. `.codex`
4. `.gemini`

使用者層級基礎路徑：

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

專案層級基礎路徑：

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` 為 `.xcsh`（`packages/utils/src/dirs.ts`）。

## 重要限制

`src/config.ts` 中的通用輔助函式在來源探索順序中**不**包含 `.pi`。

---

## 2) 核心探索輔助函式（`src/config.ts`）

## `getConfigDirs(subpath, options)`

回傳排序後的項目：

- 使用者層級項目優先（按來源優先順序）
- 接著是專案層級項目（按相同的來源優先順序）

選項：

- `user`（預設 `true`）
- `project`（預設 `true`）
- `cwd`（預設 `getProjectDir()`）
- `existingOnly`（預設 `false`）

此 API 用於基於目錄的設定查詢（commands、hooks、tools、agents 等）。

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

在排序後的基礎路徑中搜尋第一個存在的檔案，回傳第一個匹配結果（僅路徑或路徑+中繼資料）。

## `findAllNearestProjectConfigDirs(subpath, cwd)`

向上遍歷父目錄，回傳**每個來源基礎路徑最近的現有目錄**（`.xcsh`、`.claude`、`.codex`、`.gemini`），然後按來源優先順序排序結果。

當專案設定應從祖先目錄繼承時使用此函式（monorepo/巢狀工作區行為）。

---

## 3) 檔案設定包裝器（`src/config.ts` 中的 `ConfigFile<T>`）

`ConfigFile<T>` 是針對單一設定檔的 schema 驗證載入器。

支援的格式：

- `.yml` / `.yaml`
- `.json` / `.jsonc`

行為：

- 使用 AJV 對照提供的 TypeBox schema 驗證解析後的資料。
- 快取載入結果直到 `invalidate()` 被呼叫。
- 透過 `tryLoad()` 回傳三態結果：
  - `ok`
  - `not-found`
  - `error`（帶有 schema/解析上下文的 `ConfigError`）

仍支援舊版遷移：

- 如果目標路徑是 `.yml`/`.yaml`，會自動將同層的 `.json` 遷移一次（`migrateJsonToYml`）。

---

## 4) Settings 解析模型（`src/config/settings.ts`）

執行時期的 settings 模型是分層的：

1. 全域設定：`~/.xcsh/agent/config.yml`
2. 專案設定：透過 settings capability 探索（來自 providers 的 `settings.json`）
3. 執行時期覆寫：記憶體內，非持久化
4. Schema 預設值：來自 `SETTINGS_SCHEMA`

有效讀取路徑：

`defaults <- global <- project <- overrides`

寫入行為：

- `settings.set(...)` 寫入**全域**層（`config.yml`）並排入背景儲存佇列。
- 專案設定從 capability 探索中以唯讀方式取得。

## 仍然有效的遷移行為

啟動時，如果 `config.yml` 不存在：

1. 從 `~/.xcsh/agent/settings.json` 遷移（成功後重新命名為 `.bak`）
2. 與 `agent.db` 中的舊版 DB 設定合併
3. 將合併結果寫入 `config.yml`

`#migrateRawSettings` 中的欄位層級遷移：

- `queueMode` -> `steeringMode`
- `ask.timeout` 毫秒 -> 秒（當舊值看起來像毫秒時，即 `> 1000`）
- 舊版扁平 `theme: "..."` -> `theme.dark/theme.light` 結構

---

## 5) Capability/探索整合

大多數非核心設定載入流程會透過 capability 註冊表（`src/capability/index.ts` + `src/discovery/index.ts`）。

## Provider 排序

Providers 按數字優先順序排序（數字越高越優先）。優先順序範例：

- 原生 OMP（`builtin.ts`）：`100`
- Claude：`80`
- Codex / agents / Claude marketplace：`70`
- Gemini：`60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## 去重語義

Capabilities 定義一個 `key(item)`：

- 相同 key => 第一個項目勝出（優先順序較高/較早載入的項目）
- 無 key（`undefined`）=> 不去重，所有項目都保留

相關的 key：

- skills：`name`
- tools：`name`
- hooks：`${type}:${tool}:${name}`
- extension modules：`name`
- extensions：`name`
- settings：不去重（所有項目都保留）

---

## 6) 原生 `.xcsh` provider 行為（`src/discovery/builtin.ts`）

原生 provider（`id: native`）從以下位置讀取：

- 專案：`<cwd>/.xcsh/...`
- 使用者：`~/.xcsh/agent/...`

### 目錄准入規則

`builtin.ts` 僅在目錄存在**且非空**（`ifNonEmptyDir`）時才納入設定根目錄。

### 特定範圍的載入

- Skills：`skills/*/SKILL.md`
- Slash commands：`commands/*.md`
- Rules：`rules/*.{md,mdc}`
- Prompts：`prompts/*.md`
- Instructions：`instructions/*.md`
- Hooks：`hooks/pre/*`、`hooks/post/*`
- Tools：`tools/*.json|*.md` 和 `tools/<name>/index.ts`
- Extension modules：在 `extensions/` 下探索（+ 舊版 `settings.json.extensions` 字串陣列）
- Extensions：`extensions/<name>/gemini-extension.json`
- Settings capability：`settings.json`

### 最近專案查詢的細微差異

對於 `SYSTEM.md` 和 `AGENTS.md`，原生 provider 使用最近祖先專案 `.xcsh` 目錄搜尋（向上遍歷），但仍要求 `.xcsh` 目錄非空。

---

## 7) 主要子系統如何使用設定

## Settings 子系統

- `Settings.init()` 載入全域 `config.yml` + 探索到的專案 `settings.json` capability 項目。
- 僅 `level === "project"` 的 capability 項目會合併至專案層。

## Skills 子系統

- `extensibility/skills.ts` 透過 `loadCapability(skillCapability.id, { cwd })` 載入。
- 套用來源切換和篩選器（`ignoredSkills`、`includeSkills`、自訂目錄）。
- 舊版命名的切換仍然存在（`skills.enablePiUser`、`skills.enablePiProject`），但它們控制的是原生 provider（`provider === "native"`）。

## Hooks 子系統

- `discoverAndLoadHooks()` 從 hook capability + 明確設定的路徑解析 hook 路徑。
- 然後透過 Bun import 載入模組。

## Tools 子系統

- `discoverAndLoadCustomTools()` 從 tool capability + 外掛 tool 路徑 + 明確設定的路徑解析 tool 路徑。
- 宣告式 `.md/.json` tool 檔案僅為中繼資料；可執行載入需要程式碼模組。

## Extensions 子系統

- `discoverAndLoadExtensions()` 從 extension-module capability 加上明確路徑解析 extension modules。
- 目前的實作在載入前會刻意僅保留 `_source.provider === "native"` 的 capability 項目。

---

## 8) 可依賴的優先順序規則

使用此心智模型：

1. `config.ts` 中的來源目錄排序決定候選路徑順序。
2. Capability provider 優先順序決定跨 provider 的優先順序。
3. Capability key 去重決定衝突行為（對於有 key 的 capabilities，第一個勝出）。
4. 子系統特定的合併邏輯可能進一步改變有效優先順序（特別是 settings）。

### Settings 特定注意事項

Settings capability 項目不會去重；`Settings.#loadProjectSettings()` 按回傳順序對專案項目進行深層合併。因為合併會將後面項目的值覆蓋前面項目的值，有效的覆寫行為取決於 provider 的發送順序，而不僅是 capability key 語義。

---

## 9) 仍然存在的舊版/相容性行為

- `ConfigFile` 針對 YAML 目標檔案的 JSON -> YAML 遷移。
- Settings 從 `settings.json` 和 `agent.db` 遷移至 `config.yml`。
- Settings key 遷移（`queueMode`、`ask.timeout`、扁平 `theme`）。
- Extension manifest 相容性：載入器同時接受 `package.json.xcsh` 和 `package.json.pi` manifest 區段。
- 舊版設定名稱 `skills.enablePiUser` / `skills.enablePiProject` 仍是原生 skill 來源的有效控制閘。

如果這些相容性路徑在程式碼中被移除，請立即更新本文件；目前仍有多項執行時期行為依賴於它們。
