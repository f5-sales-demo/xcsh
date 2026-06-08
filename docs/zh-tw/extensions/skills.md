---
title: 技能
description: 用於註冊、發現和呼叫編碼代理中專門能力的技能系統。
sidebar:
  order: 3
  label: 技能
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# 技能

技能是基於檔案的能力套件，在啟動時被發現並以下列方式暴露給模型：

- 系統提示詞中的輕量級中繼資料（名稱 + 描述）
- 透過 `read skill://...` 按需取得的內容
- 可選的互動式 `/skill:<name>` 命令

本文件涵蓋 `src/extensibility/skills.ts`、`src/discovery/builtin.ts`、`src/internal-urls/skill-protocol.ts` 和 `src/discovery/agents-md.ts` 中的當前執行時行為。

## 本程式碼庫中技能的定義

一個被發現的技能表示為：

- `name`
- `description`
- `filePath`（`SKILL.md` 路徑）
- `baseDir`（技能目錄）
- 來源中繼資料（`provider`、`level`、路徑）

執行時僅要求 `name` 和 `path` 為有效值。實際上，匹配品質取決於 `description` 是否有意義。

## 必要的佈局和 SKILL.md 預期

### 目錄佈局

對於基於提供者的發現（native/Claude/Codex/Agents/plugin 提供者），技能被發現為 **`skills/` 下的一層**：

- `<skills-root>/<skill-name>/SKILL.md`

像 `<skills-root>/group/<skill>/SKILL.md` 這樣的巢狀模式不會被提供者載入器發現。

對於 `skills.customDirectories`，掃描使用相同的非遞迴佈局（`*/SKILL.md`）。

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### `SKILL.md` 前置資料

技能類型上支援的前置資料欄位：

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- 額外的鍵會作為未知中繼資料保留

當前執行時行為：

- `name` 預設為技能目錄名稱
- `description` 在以下情況是必需的：
  - 原生 `.xcsh` 提供者技能發現（`requireDescription: true`）
  - `skills.customDirectories` 透過 `src/discovery/helpers.ts` 中的 `scanSkillsFromDir` 掃描（非遞迴）
- 非原生提供者可以載入沒有描述的技能

## 發現管線

`src/extensibility/skills.ts` 中的 `discoverSkills()` 執行兩個階段：

1. **能力提供者** 透過 `loadCapability("skills")`
2. **自訂目錄** 透過 `scanSkillsFromDir(..., { requireDescription: true })`（單層目錄列舉）

如果 `skills.enabled` 為 `false`，發現不會回傳任何技能。

### 內建技能提供者和優先順序

提供者排序以優先順序為主（較高者優先），相同優先順序時依註冊順序。

目前已註冊的技能提供者：

1. `native`（優先順序 100）— 透過 `src/discovery/builtin.ts` 的 `.xcsh` 使用者/專案技能
2. `claude`（優先順序 80）
3. 優先順序 70 群組（依註冊順序）：
   - `claude-plugins`
   - `agents`
   - `codex`

去重鍵為技能名稱。具有相同名稱的第一個項目優先。

### 來源開關和過濾

`discoverSkills()` 套用以下控制：

- 來源開關：`enableCodexUser`、`enableClaudeUser`、`enableClaudeProject`、`enablePiUser`、`enablePiProject`
- 基於技能名稱的 glob 過濾器：
  - `ignoredSkills`（排除）
  - `includeSkills`（包含允許清單；空值表示包含全部）

過濾順序為：

1. 來源已啟用
2. 未被忽略
3. 已包含（如果存在包含清單）

對於 codex/claude/native 以外的提供者（例如 `agents`、`claude-plugins`），啟用狀態目前回退為：如果**任何**內建來源開關已啟用則啟用。

### 衝突和重複處理

- 能力去重已經保留每個名稱的第一個技能（最高優先順序的提供者）
- `extensibility/skills.ts` 額外：
  - 透過 `realpath` 去重相同檔案（符號連結安全）
  - 當後續技能名稱衝突時發出衝突警告
  - 保留便利的 `discoverSkillsFromDir({ dir, source })` API 作為 `scanSkillsFromDir` 的薄封裝
- 自訂目錄技能在提供者技能之後合併，遵循相同的衝突行為

## 執行時使用行為

### 系統提示詞暴露

系統提示詞建構（`src/system-prompt.ts`）如下使用已發現的技能：

- 如果 `read` 工具可用：
  - 在提示詞中包含已發現的技能清單
- 否則：
  - 省略已發現的清單

任務工具子代理透過正常的工作階段建立接收工作階段的已發現/提供的技能清單；沒有按任務的技能固定覆蓋。

### 互動式 `/skill:<name>` 命令

如果 `skills.enableSkillCommands` 為 true，互動模式會為每個已發現的技能註冊一個斜線命令。

`/skill:<name> [args]` 行為：

- 直接從 `filePath` 讀取技能檔案
- 移除前置資料
- 將技能內容作為後續自訂訊息注入
- 附加中繼資料（`Skill: <path>`，可選的 `User: <args>`）

## `skill://` URL 行為

`src/internal-urls/skill-protocol.ts` 支援：

- `skill://<name>` → 解析為該技能的 `SKILL.md`
- `skill://<name>/<relative-path>` → 解析為該技能目錄內的路徑

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

解析細節：

- 技能名稱必須完全匹配
- 相對路徑經過 URL 解碼
- 絕對路徑會被拒絕
- 路徑遍歷（`..`）會被拒絕
- 解析後的路徑必須保持在 `baseDir` 內
- 缺少的檔案會回傳明確的 `File not found` 錯誤

內容類型：

- `.md` => `text/markdown`
- 其他所有 => `text/plain`

對於缺少的資源不會執行回退搜尋。

## 技能 vs AGENTS.md、命令、工具、鉤子

### 技能 vs AGENTS.md

- **技能**：具名的、可選的能力套件，依任務上下文選擇或明確請求
- **AGENTS.md/上下文檔案**：持久性的指令檔案，作為上下文檔案能力載入並依層級/深度規則合併

`src/discovery/agents-md.ts` 特別從 `cwd` 向上遍歷祖先目錄以發現獨立的 `AGENTS.md` 檔案（最多深度 20），排除隱藏目錄段。

### 技能 vs 斜線命令

- **技能**：模型可讀的知識/工作流程內容
- **斜線命令**：使用者呼叫的命令進入點
- `/skill:<name>` 是一個便利封裝，注入技能文字；它不會改變技能發現語義

### 技能 vs 自訂工具

- **技能**：透過提示詞上下文和 `read` 載入的文件/工作流程內容
- **自訂工具**：模型可呼叫的可執行工具 API，具有結構描述和執行時副作用

### 技能 vs 鉤子

- **技能**：被動內容
- **鉤子**：事件驅動的執行時攔截器，可在執行期間阻止/修改行為

## 與發現邏輯相關的實用撰寫指南

- 將每個技能放在自己的目錄中：`<skills-root>/<skill-name>/SKILL.md`
- 始終包含明確的 `name` 和 `description` 前置資料
- 將參考資源放在相同的技能目錄下，並使用 `skill://<name>/...` 存取
- 對於巢狀分類（`team/domain/skill`），將 `skills.customDirectories` 指向巢狀父目錄；掃描本身仍然是非遞迴的
- 避免跨來源的重複技能名稱；依提供者優先順序第一個匹配者優先
