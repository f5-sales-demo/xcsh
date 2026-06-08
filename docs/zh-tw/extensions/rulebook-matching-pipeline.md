---
title: 規則手冊匹配管線
description: 用於選擇並套用情境特定指令集到代理工作階段的規則手冊匹配管線。
sidebar:
  order: 6
  label: 規則手冊匹配
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# 規則手冊匹配管線

本文件描述 coding-agent 如何從支援的設定格式中發現規則、將其正規化為單一的 `Rule` 形狀、解決優先順序衝突，並將結果拆分為：

- **規則手冊規則**（透過系統提示詞 + `rule://` URL 提供給模型使用）
- **TTSR 規則**（時間旅行串流中斷規則）

本文反映了目前的實作，包括部分語義以及已解析但未強制執行的中繼資料。

## 實作檔案

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. 標準規則形狀

所有提供者將來源檔案正規化為 `Rule`：

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

能力識別為 `rule.name`（`ruleCapability.key = rule => rule.name`）。

結果：優先順序與去重**僅基於名稱**。兩個不同檔案若具有相同的 `name`，則被視為同一邏輯規則。

## 2. 發現來源與正規化

`src/discovery/index.ts` 自動註冊提供者。對於 `rules`，目前的提供者為：

- `native`（優先順序 `100`）
- `cursor`（優先順序 `50`）
- `windsurf`（優先順序 `50`）
- `cline`（優先順序 `40`）

### Native 提供者（`builtin.ts`）

從以下位置載入 `.xcsh` 規則：

- 專案：`<cwd>/.xcsh/rules/*.{md,mdc}`
- 使用者：`~/.xcsh/agent/rules/*.{md,mdc}`

正規化：

- `name` = 不含 `.md`/`.mdc` 的檔案名稱
- 前置資料透過 `parseFrontmatter` 解析
- `content` = 本文（前置資料已移除）
- `globs`、`alwaysApply`、`description`、`ttsr_trigger` 直接對應

重要注意事項：在此提供者中，`globs` 被轉型為 `string[] | undefined`，不會對元素進行過濾。

### Cursor 提供者（`cursor.ts`）

從以下位置載入：

- 使用者：`~/.cursor/rules/*.{mdc,md}`
- 專案：`<cwd>/.cursor/rules/*.{mdc,md}`

正規化（`transformMDCRule`）：

- `description`：僅在為字串時保留
- `alwaysApply`：僅保留 `true`（`false` 變為 `undefined`）
- `globs`：接受陣列（僅字串元素）或單一字串
- `ttsr_trigger`：僅限字串
- `name` 取自不含副檔名的檔案名稱

### Windsurf 提供者（`windsurf.ts`）

從以下位置載入：

- 使用者：`~/.codeium/windsurf/memories/global_rules.md`（固定規則名稱 `global_rules`）
- 專案：`<cwd>/.windsurf/rules/*.md`

正規化：

- `globs`：字串陣列或單一字串
- `alwaysApply`、`description` 從前置資料轉型
- `ttsr_trigger`：僅限字串
- 專案規則的 `name` 取自檔案名稱

### Cline 提供者（`cline.ts`）

從 `cwd` 向上搜尋最近的 `.clinerules`：

- 若為目錄：載入其中的 `*.md`
- 若為檔案：載入單一檔案作為名稱為 `clinerules` 的規則

正規化：

- `globs`：字串陣列或單一字串
- `alwaysApply`：僅在為布林值時保留
- `description`：僅限字串
- `ttsr_trigger`：僅限字串

## 3. 前置資料解析行為與歧義

所有提供者使用 `parseFrontmatter`（`utils/frontmatter.ts`），具有以下語義：

1. 僅當內容以 `---` 開頭且有結尾的 `\n---` 時才解析前置資料。
2. 前置資料擷取後會修剪本文。
3. 若 YAML 解析失敗：
   - 記錄警告，
   - 解析器退回至簡單的 `key: value` 逐行解析（`^(\w+):\s*(.*)$`）。

歧義後果：

- 退回解析器不支援陣列、巢狀物件、引號規則或含連字號的鍵。
- 退回值變為字串（例如 `alwaysApply: true` 變為字串 `"true"`），因此需要布林/字串型別的提供者可能會丟棄中繼資料。
- `ttsr_trigger` 在退回模式中可運作（底線鍵）；像 `thinking-level` 這樣的鍵則不行。
- 沒有有效前置資料的檔案仍會作為具有空中繼資料和完整內容本文的規則載入。

## 4. 提供者優先順序與去重

`loadCapability("rules")`（`capability/index.ts`）合併提供者輸出，然後依 `rule.name` 去重。

### 優先順序模型

- 提供者按優先順序降序排列。
- 相同優先順序保持註冊順序（在 `discovery/index.ts` 中 `cursor` 在 `windsurf` 之前）。
- 去重採先到先得：首先遇到的規則名稱被保留；後續同名項目在 `all` 中標記為 `_shadowed`，並從 `items` 中排除。

目前有效的規則提供者順序為：

1. `native`（100）
2. `cursor`（50）
3. `windsurf`（50）
4. `cline`（40）

### 提供者內部排序注意事項

在提供者內部，項目順序來自 `loadFilesFromDir` glob 結果排序加上明確的 push 順序。這對於一般使用而言足夠確定性，但程式碼中並未明確排序。

值得注意的來源順序差異：

- `native` 先附加專案目錄，再附加使用者設定目錄。
- `cursor` 先附加使用者結果，再附加專案結果。
- `windsurf` 先附加使用者 `global_rules`，再附加專案規則。
- `cline` 僅載入最近的 `.clinerules` 來源。

## 5. 拆分為規則手冊、永遠套用和 TTSR 分類

在 `createAgentSession`（`sdk.ts`）中規則發現之後：

1. 掃描所有已發現的規則。
2. 具有 `condition`（前置資料鍵；`ttsr_trigger` / `ttsrTrigger` 作為退回接受）的規則被註冊到 `TtsrManager`。
3. 使用以下條件建立單獨的 `rulebookRules` 列表：

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. 建立 `alwaysApplyRules` 列表：

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### 分類行為

- **TTSR 分類**：任何具有 `condition` 的規則（不需要 description）。優先於其他分類。
- **永遠套用分類**：`alwaysApply === true`，非 TTSR。完整內容注入系統提示詞。可透過 `rule://` 解析。
- **規則手冊分類**：必須有 description，不能是 TTSR，不能是 `alwaysApply`。在系統提示詞中以名稱+描述列出；內容透過 `rule://` 按需讀取。
- 同時具有 `condition` 和 `alwaysApply` 的規則僅進入 TTSR（TTSR 優先）。
- 同時具有 `alwaysApply` 和 `description` 的規則僅進入永遠套用（非規則手冊）。

## 6. 中繼資料如何影響執行時期介面

### `description`

- 納入規則手冊的必要條件。
- 在系統提示詞 `<rules>` 區塊中呈現。
- 缺少 description 表示規則無法透過 `rule://` 取得，也不會列在系統提示詞規則中。

### `globs`

- 在 `Rule` 上攜帶傳遞。
- 在系統提示詞規則區塊中以 `<glob>...</glob>` 條目呈現。
- 在規則 UI 狀態中公開（`extensions` 模式列表）。
- **在此管線中不會強制執行自動匹配。** 沒有執行時期 glob 匹配器依據目前檔案/工具目標選擇規則。

### `alwaysApply`

- 由提供者解析並保留。
- 用於 UI 顯示（擴充功能狀態管理器中的 `"always"` 觸發標籤）。
- 用作從 `rulebookRules` 排除的條件。
- **完整規則內容會自動注入系統提示詞**（在規則手冊規則區段之前）。
- 規則也可透過 `rule://<name>` 重新讀取。

### `ttsr_trigger`

- 對應至 `rule.ttsrTrigger`。
- 若存在，規則會路由至 TTSR 管理器，而非規則手冊。

## 7. 系統提示詞包含路徑

`buildSystemPromptInternal` 接收 `rules`（規則手冊）和 `alwaysApplyRules`。

永遠套用規則先呈現，將其原始內容直接注入提示詞。

規則手冊規則在 `# Rules` 區段中呈現，包含：

- `Read rule://<name> when working in matching domain`
- 每個規則的 `name`、`description` 和選用的 `<glob>` 列表

這是建議性/情境性的：提示詞文字要求模型讀取適用的規則，但程式碼不會強制執行 glob 適用性。

## 8. `rule://` 內部 URL 行為

`RuleProtocolHandler` 以下列方式註冊：

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

影響：

- `rule://<name>` 會同時解析 **rulebookRules** 和 **alwaysApplyRules**。
- 僅限 TTSR 的規則以及沒有 description 且沒有 `alwaysApply` 的規則無法透過 `rule://` 存取。
- 解析採精確名稱匹配。
- 未知名稱會傳回錯誤，列出可用的規則名稱。
- 傳回的內容為原始 `rule.content`（前置資料已移除），內容類型為 `text/markdown`。

## 9. 已知的部分/未強制執行語義

1. 提供者描述中提到舊版檔案（`.cursorrules`、`.windsurfrules`），但目前的載入器程式碼路徑實際上並不讀取這些檔案。
2. `globs` 中繼資料會呈現至提示詞/UI，但規則選擇邏輯並未強制執行。
3. `rule://` 的規則選擇包含規則手冊和永遠套用規則，但不包含僅限 TTSR 的規則。
4. 發現警告（`loadCapability("rules").warnings`）會產生，但 `createAgentSession` 目前在此路徑中並未呈現/記錄它們。
