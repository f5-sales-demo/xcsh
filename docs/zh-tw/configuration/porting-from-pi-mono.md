---
title: 從 pi-mono 移植：實用合併指南
description: 從 pi-mono monorepo 遷移程式碼到 xcsh 程式碼庫的實用指南。
sidebar:
  order: 9
  label: 從 pi-mono 移植
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# 從 pi-mono 移植：實用合併指南

本指南是一份可重複使用的檢查清單，用於將 pi-mono 的變更移植到本倉庫。
無論是單一檔案、功能分支或完整版本同步，都可以使用此指南。

## 最後同步點

**Commit：** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**日期：** 2026-03-22

每次同步後請更新此區段；不要重複使用先前的範圍。

開始新的同步時，從此 commit 開始產生補丁：

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) 定義範圍

- 確定上游參考（commit、tag 或 PR）。
- 列出您計劃涉及的套件或資料夾。
- 決定哪些功能在範圍內，哪些是有意略過的。

## 1) 安全地搬移程式碼

- 優先採用乾淨、聚焦的差異，而非整體複製。
- 避免複製建置產物或產生的檔案。
- 如果上游新增了檔案，請明確新增並審查內容。

## 2) 遵循匯入副檔名慣例

大多數執行期 TypeScript 原始碼在內部匯入中省略 `.js`，但部分測試/效能測試進入點保留 `.js` 以確保 ESM
執行期相容性。請遵循本地套件的現有風格；不要一律移除副檔名。

- 在 `packages/coding-agent` 執行期原始碼中，內部匯入不加副檔名，除非匯入非 TS 資源。
- 在 `packages/tui/test` 和 `packages/natives/bench` 中，若周圍檔案已使用 `.js`，則保留 `.js`。
- 當工具鏈需要時，保留真實的副檔名（例如 `.json`、`.css`、`.md` 文字嵌入）。
- 範例：`import { x } from "./foo.js";` → `import { x } from "./foo";`（僅在套件慣例為無副檔名時）。

## 3) 替換匯入範圍

上游使用不同的套件範圍。請一致地替換它們。

- 將舊的範圍替換為此處使用的本地範圍。
- 範例（請根據您實際移植的套件進行調整）：
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) 在 Bun 有更佳替代方案時使用 Bun API

我們運行於 Bun 上。僅在 Bun 提供更好的替代方案時才替換 Node API。

**應該替換：**

- 程序產生：`child_process.spawn` → Bun Shell `$`（適用於簡單指令）、`Bun.spawn`/`Bun.spawnSync`（適用於串流或長時間運行的工作）
- 檔案 I/O：`fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP 用戶端：`node-fetch`、`axios` → 原生 `fetch`
- 加密雜湊：`node:crypto` → Web Crypto 或 `Bun.hash`
- SQLite：`better-sqlite3` → `bun:sqlite`
- 環境變數載入：`dotenv` → Bun 會自動載入 `.env`

**不應替換（這些在 Bun 中正常運作）：**

- `os.homedir()` — 不要替換為 `Bun.env.HOME`、`Bun.env.HOME` 或字面值 `"~"`
- `os.tmpdir()` — 不要替換為 `Bun.env.TMPDIR || "/tmp"` 或硬編碼路徑
- `fs.mkdtempSync()` — 不要替換為手動路徑建構
- `path.join()`、`path.resolve()` 等 — 這些沒問題

**匯入風格：** 使用 `node:` 前綴搭配命名空間匯入（不要從 `node:fs` 或 `node:path` 使用具名匯入）。

**其他 Bun 慣例：**

- 簡短、非串流指令優先使用 Bun Shell `$`；僅在需要串流 I/O 或程序控制時才使用 `Bun.spawn`。
- 檔案使用 `Bun.file()`/`Bun.write()`，目錄使用 `node:fs/promises`。
- 避免 `Bun.file().exists()` 檢查；在 try/catch 中使用 `isEnoent` 處理。
- 優先使用 `Bun.sleep(ms)` 而非 `setTimeout` 包裝。

**錯誤：**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**正確：**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) 優先使用 Bun 嵌入（不複製）

不要在建置時複製執行期資源或供應商檔案。

- 如果上游將資源複製到 dist 資料夾，請替換為 Bun 友善的嵌入方式。
- 提示詞是靜態 `.md` 檔案；使用 Bun 文字匯入（`with { type: "text" }`）和 Handlebars，而非內嵌提示字串。
- 使用 `import.meta.dir` + `Bun.file` 載入相鄰的非文字資源。
- 將資源保留在倉庫中，讓打包器包含它們。
- 除非使用者明確要求，否則消除複製腳本。
- 如果上游在執行期讀取打包的備援檔案，請用 Bun 文字嵌入匯入替換檔案系統讀取。
  - 範例（Codex 指令備援）：
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> 移除
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - 使用 `return FALLBACK_INSTRUCTIONS;` 而非 `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) 謹慎移植 `package.json`

將 `package.json` 視為契約。有意識地合併。

- 保留現有的 `name`、`version`、`type`、`exports` 和 `bin`，除非移植需要變更。
- 將 npm/node 腳本替換為 Bun 等效項（例如 `bun check`、`bun test`）。
- 確保依賴項使用正確的範圍。
- 不要為了修復型別錯誤而降級依賴項；請改為升級。
- 驗證工作區套件連結和 `peerDependencies`。

## 7) 對齊程式碼風格與工具

- 保留現有的格式慣例。
- 除非必要，不要引入 `any`。
- 避免動態匯入和內嵌型別匯入；僅使用頂層匯入。
- 永遠不要在程式碼中建構提示詞；提示詞是使用 Handlebars 渲染的靜態 `.md` 檔案。
- 在 coding-agent 中，永遠不要使用 `console.log`/`console.warn`/`console.error`；使用來自 `@f5xc-salesdemos/pi-utils` 的 `logger`。
- 使用 `Promise.withResolvers()` 而非 `new Promise((resolve, reject) => ...)`。
- **不要在類別欄位或方法上使用 `private`/`protected`/`public` 關鍵字。** 使用 ES `#` 私有欄位進行封裝；可存取的成員保持無關鍵字。唯一的例外是建構函式參數屬性（`constructor(private readonly x: T)`），其中 TypeScript 要求使用關鍵字。移植使用 `private foo` 或 `protected bar` 的上游程式碼時，將其轉換為 `#foo`（私有）或裸 `bar`（可存取）。
- 優先使用現有的輔助工具和公用程式，而非新的臨時程式碼。
- 保留本倉庫中已做出的 Bun 優先基礎設施變更：
  - 執行期為 Bun（無 Node 進入點）。
  - 套件管理器為 Bun（無 npm 鎖定檔）。
  - 重量級 Node API（`child_process`、`readline`）已替換為 Bun 等效項。
  - 輕量級 Node API（`os.homedir`、`os.tmpdir`、`fs.mkdtempSync`、`path.*`）予以保留。
  - CLI shebang 使用 `bun`（非 `node`、非 `tsx`）。
  - 套件直接使用原始碼檔案（無 TypeScript 建置步驟）。
  - CI 工作流程使用 Bun 進行安裝/檢查/測試。

## 8) 移除舊的相容層

除非被要求，否則移除上游的相容墊片。

- 刪除已被替換的舊 API。
- 直接更新所有呼叫點以使用新 API。
- 不要保留 `*_v2` 或並行版本。

## 9) 更新文件和參考

- 適當地替換 pi-mono 倉庫連結。
- 更新範例以使用 Bun 和正確的套件範圍。
- 確保 README 說明仍然符合目前的倉庫行為。

## 10) 驗證移植結果

變更後執行標準檢查：

- `bun check`

如果倉庫已有與您的變更無關的失敗檢查，請指出。
測試使用 Bun 的測試執行器（非 Vitest），但僅在明確要求時才執行 `bun test`。

## 11) 保護已改進的功能（迴歸陷阱清單）

如果您已在本地改進了行為，請將其視為**不可妥協的**。在移植之前，寫下
改進項目並新增明確檢查，以確保它們不會在合併中遺失。

- **凍結預期行為**：為每項改進新增簡短的「前/後」備註（輸入、輸出、
  預設值、邊界情況）。這可以防止靜默回退。
- **對應舊 → 新 API**：如果上游重新命名了概念（hooks → extensions、custom tools → tools 等），
  確保每個舊的進入點仍然正確連接。一個遺漏的旗標或匯出就等於功能遺失。
- **驗證匯出**：檢查 `package.json` `exports`、公開型別和 barrel 檔案。上游移植常常
  忘記重新匯出本地新增項。
- **覆蓋非快樂路徑**：如果您修復了錯誤處理、逾時或備援邏輯，請新增測試或至少
  一份手動檢查清單來驗證這些路徑。
- **檢查預設值和設定合併順序**：改進通常存在於預設值中。確認新的預設值
  沒有被還原（例如新的設定優先順序、停用的功能、工具列表）。
- **稽核環境/shell 行為**：如果您修復了執行或沙箱機制，驗證新路徑仍然使用您
  清理過的環境，且不會重新引入別名/函式覆寫。
- **重新執行針對性範例**：保留一組最小的「已知正確」範例，並在移植後執行它們
  （CLI 旗標、擴充註冊、工具執行）。

## 12) 偵測並處理重構的程式碼

在移植檔案之前，檢查上游是否顯著重構了它：

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

如果差異顯示檔案被**重構**（不僅僅是修補）：

- 新的抽象、重新命名的概念、合併的模組、變更的資料流

那麼您必須在移植前**徹底閱讀新的實作**。盲目合併重構的程式碼會遺失功能，因為：

注意：互動模式最近被拆分為 controllers/utils/types。回溯移植相關變更時，請將更新移植到我們建立的個別檔案中，並確保 `interactive-mode.ts` 的接線保持同步。

1. **預設值會靜默變更** - 新變數 `defaultFoo = [a, b]` 可能取代了原本回傳 `[a, b, c, d, e]` 的舊 `getAllFoo()`。

2. **API 選項被丟棄** - 當系統合併時（例如 `hooks` + `customTools` → `extensions`），舊選項可能無法連接到新的實作。

3. **程式碼路徑變得過時** - 重新命名的概念（例如 `hookMessage` → `custom`）需要在每個 switch 陳述式、型別守衛和處理器中更新——不僅僅是定義。

4. **上下文/能力縮減** - 舊 API 可能暴露了 `{ logger, typebox, pi }`，而新 API 忘記包含它們。

### 語意移植流程

當上游重構了一個模組時：

1. **閱讀舊的實作** - 了解它做了什麼、接受什麼選項、暴露了什麼。

2. **閱讀新的實作** - 了解新的抽象以及它們如何對應舊的行為。

3. **驗證功能對等** - 對於舊程式碼中的每項能力，確認新程式碼保留了它或明確移除了它。

4. **搜尋遺漏項** - 搜尋可能在 switch 陳述式、處理器、UI 元件中被遺漏的舊名稱/概念。

5. **測試邊界** - CLI 旗標、SDK 選項、事件處理器、預設值——這些是迴歸隱藏的地方。

### 快速檢查

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) 快速稽核檢查清單

在完成前將此作為最終檢查：

- [ ] 匯入副檔名遵循本地套件慣例（不一律移除 `.js`）
- [ ] 新增/移植的程式碼中沒有 Node 專用 API
- [ ] 所有套件範圍已更新
- [ ] `package.json` 腳本使用 Bun
- [ ] 提示詞為 `.md` 文字匯入（無內嵌提示字串）
- [ ] coding-agent 中沒有 `console.*`（使用 `logger`）
- [ ] 資源透過 Bun 嵌入模式載入（無複製腳本）
- [ ] 測試或檢查可執行（或明確註明被阻擋）
- [ ] 無功能迴歸（參見第 11-12 節）

## 14) Commit 訊息格式

提交回溯移植時，遵循倉庫格式 `<type>(scope): <past-tense description>` 並在標題中保留 commit
範圍。

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**範例：**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**規則：**

- 按套件分組變更
- 使用慣例 commit 類型（`fix`、`feat`、`refactor`、`perf`、`docs`）
- 外部貢獻者的變更要包含上游 issue/PR 編號和貢獻者署名
- 標題中的 commit 範圍有助於追蹤同步點

## 15) 有意的分歧

我們的分支有與上游不同的架構決策。**不要移植這些上游模式：**

### UI 架構

| 上游                                        | 我們的分支                                                | 原因                                                                  |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` 類別                   | `StatusLineComponent`                                     | 更簡單、整合的狀態列                                                  |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | 非 TUI 模式下為 Stub                                     | 在 TUI 中實作，其他地方為 no-op                                       |
| `ctx.ui.setEditorComponent()`               | 非 TUI 模式下為 Stub                                     | 在 TUI 中實作，其他地方為 no-op                                       |
| `InteractiveModeOptions` 選項物件           | 位置建構函式參數（選項型別仍然匯出）                      | 保留建構函式簽章；上游新增欄位時更新型別                              |

### 元件命名

| 上游                         | 我們的分支              |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API 命名

| 上游                                     | 我們的分支                               | 備註                                      |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | 我們全程使用 `sessionName`                |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | 相同（我們統一以符合上游的 RPC）          |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | 相同                                      |

### 檔案整合

| 上游                                               | 我們的分支                              | 原因                                    |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts`（工具檔案）  | `@f5xc-salesdemos/pi-natives` 剪貼簿模組 | 合併到 N-API 原生實作中                 |

### 測試框架

| 上游                      | 我們的分支                    |
| ------------------------- | ----------------------------- |
| `vitest` 搭配 `vi.mock()` | `bun:test` 搭配 bun 的 `vi`  |
| `node:test` 斷言          | `expect()` 匹配器            |

### 工具架構

| 上游                                | 我們的分支                                                        | 備註                                                      |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` 透過 `BUILTIN_TOOLS` 登錄    | 工具工廠接受 `ToolSession` 且可回傳 `null`                |
| 各工具 `*Operations` 介面          | 各工具介面保留（`FindOperations`、`GrepOperations`）              | 用於 SSH/遠端覆寫                                         |
| 全面使用 Node.js `fs/promises`      | 檔案用 `Bun.file()`/`Bun.write()`；目錄用 `node:fs/promises`    | 在 Bun API 能簡化時優先使用                               |

### 認證儲存

| 上游                            | 我們的分支                                  | 備註                                         |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db`（bun:sqlite）                    | 認證資訊專門儲存在 `agent.db` 中             |
| 每個提供者單一認證              | 多重認證搭配輪詢選擇                       | 會話親和性和退避邏輯予以保留                 |

### 擴充

| 上游                          | 我們的分支                                 |
| ----------------------------- | ------------------------------------------ |
| `jiti` 用於 TypeScript 載入  | 原生 Bun `import()`                        |
| `pkg.pi` 清單欄位            | `pkg.xcsh ?? pkg.pi`（優先使用我們的命名空間） |

### 跳過這些上游功能

移植時，**完全跳過**這些檔案/功能：

- `footer-data-provider.ts` — 我們使用 StatusLineComponent
- `clipboard-image.ts` — 剪貼簿功能在 `@f5xc-salesdemos/pi-natives` N-API 模組中
- GitHub 工作流程檔案 — 我們有自己的 CI
- `models.generated.ts` — 自動產生的，請在本地重新產生（改為 models.json）

### 我們新增的功能（請保留）

這些存在於我們的分支中但不在上游。**永遠不要覆寫：**

- 互動模式中的 `StatusLineComponent`
- 多重認證搭配會話親和性
- 基於能力的探索系統（`defineCapability`、`registerProvider`、`loadCapability`、`skillCapability` 等）
- MCP/Exa/SSH 整合
- LSP 直寫用於儲存時格式化
- Bash 攔截（`checkBashInterception`）
- 讀取工具中的模糊路徑建議
