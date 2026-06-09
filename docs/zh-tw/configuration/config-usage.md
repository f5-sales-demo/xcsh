---
title: 配置檔探索與解析
description: xcsh 如何從專案、使用者及企業根目錄探索、解析並分層配置。
sidebar:
  order: 1
  label: 配置
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# 配置檔探索與解析

本文件說明 coding-agent 目前如何解析配置：掃描哪些根目錄、優先順序如何運作，以及已解析的配置如何被設定、技能、掛鉤、工具和擴充功能所使用。

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

## 1) 配置根目錄與來源順序

## 標準根目錄

`src/config.ts` 定義了固定的來源優先順序列表：

1. `.xcsh`（原生）
2. `.claude`
3. `.codex`
4. `.gemini`

使用者層級基礎目錄：

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

專案層級基礎目錄：

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

- 使用者層級項目優先（依來源優先順序）
- 接著是專案層級項目（依相同來源優先順序）

選項：

- `user`（預設 `true`）
- `project`（預設 `true`）
- `cwd`（預設 `getProjectDir()`）
- `existingOnly`（預設 `false`）

此 API 用於基於目錄的配置查詢（命令、掛鉤、工具、代理等）。

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

在排序後的基礎目錄中搜尋第一個存在的檔案，回傳第一個匹配結果（僅路徑或路徑+中繼資料）。

## `findAllNearestProjectConfigDirs(subpath, cwd)`

向上遍歷父目錄，回傳**每個來源基礎目錄最近的既存目錄**（`.xcsh`、`.claude`、`.codex`、`.gemini`），然後依來源優先順序排序結果。

當專案配置需要從祖先目錄繼承時使用此函式（單一儲存庫/巢狀工作區行為）。

---

## 3) 檔案配置包裝器（`src/config.ts` 中的 `ConfigFile<T>`）

`ConfigFile<T>` 是用於單一配置檔的結構描述驗證載入器。

支援格式：

- `.yml` / `.yaml`
- `.json` / `.jsonc`

行為：

- 使用 AJV 根據提供的 TypeBox 結構描述驗證解析後的資料。
- 快取載入結果直到呼叫 `invalidate()`。
- 透過 `tryLoad()` 回傳三態結果：
  - `ok`
  - `not-found`
  - `error`（包含結構描述/解析上下文的 `ConfigError`）

仍支援舊版遷移：

- 若目標路徑為 `.yml`/`.yaml`，同級的 `.json` 會自動遷移一次（`migrateJsonToYml`）。

---

## 4) 設定解析模型（`src/config/settings.ts`）

執行時期設定模型是分層的：

1. 全域設定：`~/.xcsh/agent/config.yml`
2. 專案設定：透過設定能力探索（來自提供者的 `settings.json`）
3. 執行時期覆寫：記憶體內，非持久化
4. 結構描述預設值：來自 `SETTINGS_SCHEMA`

有效讀取路徑：

`defaults <- global <- project <- overrides`

寫入行為：

- `settings.set(...)` 寫入**全域**層（`config.yml`）並排入背景儲存佇列。
- 專案設定從能力探索中為唯讀。

## 仍然啟用的遷移行為

啟動時，若 `config.yml` 不存在：

1. 從 `~/.xcsh/agent/settings.json` 遷移（成功後重新命名為 `.bak`）
2. 與來自 `agent.db` 的舊版資料庫設定合併
3. 將合併結果寫入 `config.yml`

`#migrateRawSettings` 中的欄位層級遷移：

- `queueMode` -> `steeringMode`
- `ask.timeout` 毫秒 -> 秒（當舊值看起來像毫秒時，即 `> 1000`）
- 舊版扁平 `theme: "..."` -> `theme.dark/theme.light` 結構

---

## 5) 能力/探索整合

大多數非核心配置載入都透過能力註冊表（`src/capability/index.ts` + `src/discovery/index.ts`）流通。

## 提供者排序

提供者依數值優先順序排序（數值越高越優先）。優先順序範例：

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

## 去重語意

能力定義了 `key(item)`：

- 相同 key => 第一個項目優先（較高優先順序/較早載入的項目）
- 無 key（`undefined`）=> 不去重，保留所有項目

相關 key：

- 技能：`name`
- 工具：`name`
- 掛鉤：`${type}:${tool}:${name}`
- 擴充模組：`name`
- 擴充功能：`name`
- 設定：不去重（保留所有項目）

---

## 6) 原生 `.xcsh` 提供者行為（`src/discovery/builtin.ts`）

原生提供者（`id: native`）從以下位置讀取：

- 專案：`<cwd>/.xcsh/...`
- 使用者：`~/.xcsh/agent/...`

### 目錄准入規則

`builtin.ts` 僅在目錄存在**且非空**（`ifNonEmptyDir`）時才納入配置根目錄。

### 範圍特定載入

- 技能：`skills/*/SKILL.md`
- 斜線命令：`commands/*.md`
- 規則：`rules/*.{md,mdc}`
- 提示詞：`prompts/*.md`
- 指令：`instructions/*.md`
- 掛鉤：`hooks/pre/*`、`hooks/post/*`
- 工具：`tools/*.json|*.md` 和 `tools/<name>/index.ts`
- 擴充模組：在 `extensions/` 下探索（+ 舊版 `settings.json.extensions` 字串陣列）
- 擴充功能：`extensions/<name>/gemini-extension.json`
- 設定能力：`settings.json`

### 最近專案查詢的細微差異

對於 `SYSTEM.md` 和 `AGENTS.md`，原生提供者使用最近祖先專案 `.xcsh` 目錄搜尋（向上遍歷），但仍要求 `.xcsh` 目錄為非空。

---

## 7) 主要子系統如何消費配置

## 設定子系統

- `Settings.init()` 載入全域 `config.yml` + 已探索的專案 `settings.json` 能力項目。
- 僅 `level === "project"` 的能力項目會合併至專案層。

## 技能子系統

- `extensibility/skills.ts` 透過 `loadCapability(skillCapability.id, { cwd })` 載入。
- 套用來源開關和篩選器（`ignoredSkills`、`includeSkills`、自訂目錄）。
- 舊版命名的開關仍然存在（`skills.enablePiUser`、`skills.enablePiProject`），但它們控制原生提供者（`provider === "native"`）。

## 掛鉤子系統

- `discoverAndLoadHooks()` 從掛鉤能力 + 明確配置的路徑解析掛鉤路徑。
- 然後透過 Bun import 載入模組。

## 工具子系統

- `discoverAndLoadCustomTools()` 從工具能力 + 外掛工具路徑 + 明確配置的路徑解析工具路徑。
- 宣告式 `.md/.json` 工具檔案僅為中繼資料；可執行載入需要程式碼模組。

## 擴充功能子系統

- `discoverAndLoadExtensions()` 從擴充模組能力加上明確路徑解析擴充模組。
- 目前實作在載入前刻意僅保留 `_source.provider === "native"` 的能力項目。

---

## 8) 可依賴的優先順序規則

請使用此心智模型：

1. `config.ts` 的來源目錄排序決定候選路徑順序。
2. 能力提供者優先順序決定跨提供者的優先順序。
3. 能力 key 去重決定衝突行為（對於有 key 的能力，第一個優先）。
4. 子系統特定的合併邏輯可以進一步改變有效優先順序（特別是設定）。

### 設定特定注意事項

設定能力項目不會被去重；`Settings.#loadProjectSettings()` 依回傳順序深度合併專案項目。由於合併會以較後項目的值覆蓋較前項目的值，有效的覆寫行為取決於提供者的發出順序，而非僅取決於能力 key 語意。

---

## 9) 仍然存在的舊版/相容性行為

- `ConfigFile` 針對 YAML 目標檔案的 JSON -> YAML 遷移。
- 從 `settings.json` 和 `agent.db` 遷移設定至 `config.yml`。
- 設定 key 遷移（`queueMode`、`ask.timeout`、扁平 `theme`）。
- 擴充功能清單相容性：載入器同時接受 `package.json.xcsh` 和 `package.json.pi` 清單區段。
- 舊版設定名稱 `skills.enablePiUser` / `skills.enablePiProject` 仍然是原生技能來源的啟用閘門。

若這些相容性路徑在程式碼中被移除，請立即更新本文件；目前有數個執行時期行為仍依賴它們。
