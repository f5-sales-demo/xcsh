---
title: 自訂工具
description: 用於擴展代理程式的自訂工具註冊、架構定義與執行管線。
sidebar:
  order: 4
  label: 自訂工具
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# 自訂工具

自訂工具是可由模型呼叫的函式，插入與內建工具相同的工具執行管線。

自訂工具是一個 TypeScript/JavaScript 模組，匯出一個工廠函式。工廠函式接收一個宿主 API（`CustomToolAPI`），並回傳單一工具或工具陣列。

## 這是什麼（以及不是什麼）

- **自訂工具**：可在一個回合中由模型呼叫（`execute` + TypeBox 架構）。
- **擴充功能**：生命週期/事件框架，可以註冊工具並攔截/修改事件。
- **鉤子**：外部前置/後置命令腳本。
- **技能**：靜態指引/情境套件，非可執行的工具程式碼。

若需要模型直接呼叫程式碼，請使用自訂工具。

## 目前程式碼中的整合路徑

目前有兩種活躍的整合方式：

1. **SDK 提供的自訂工具**（`options.customTools`）
   - 透過 `CustomToolAdapter` 或擴充功能包裝器封裝為代理程式工具。
   - 在 SDK 啟動時，一律包含於初始啟用工具集中。

2. **透過載入器 API 進行檔案系統探索的模組**（`discoverAndLoadCustomTools` / `loadCustomTools`）
   - 以程式庫 API 形式公開於 `src/extensibility/custom-tools/loader.ts`。
   - 宿主程式碼可呼叫這些 API，從設定/提供者/外掛路徑中探索並載入工具模組。

```text
模型工具呼叫流程

LLM 工具呼叫
   │
   ▼
工具登錄檔（內建工具 + 自訂工具轉接器）
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> 串流部分結果
   └─ return result  -> 最終工具內容/詳情
```

## 探索位置（載入器 API）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` 合併以下來源：

1. 功能提供者（`toolCapability`），包含：
   - 原生 OMP 設定（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude 設定（`~/.claude/tools`、`.claude/tools`）
   - Codex 設定（`~/.codex/tools`、`.codex/tools`）
   - Claude 市集外掛快取提供者
2. 已安裝的外掛清單（透過外掛載入器從 `~/.xcsh/plugins/node_modules/*`）
3. 傳遞給載入器的明確設定路徑

### 重要行為

- 重複的已解析路徑會被去重複。
- 工具名稱衝突會針對內建工具及已載入的自訂工具進行拒絕。
- `.md` 與 `.json` 檔案會被某些提供者作為工具元資料探索，但可執行模組載入器會拒絕將其作為可執行工具。
- 相對設定路徑從 `cwd` 解析；`~` 會展開。

## 模組契約

自訂工具模組必須匯出一個函式（建議使用預設匯出）：

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

工廠回傳型別：

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## 傳遞給工廠的 API 介面（`CustomToolAPI`）

來自 `types.ts` 與 `loader.ts`：

- `cwd`：宿主工作目錄
- `exec(command, args, options?)`：程序執行輔助函式
- `ui`：UI 情境（在無頭模式下可為空操作）
- `hasUI`：在非互動式流程中為 `false`
- `logger`：共用檔案記錄器
- `typebox`：注入的 `@sinclair/typebox`
- `pi`：注入的 `@f5-sales-demo/xcsh` 匯出
- `pushPendingAction(action)`：為隱藏的 `resolve` 工具註冊預覽動作（`docs/resolve-tool-runtime.md`）

載入器以空操作 UI 情境啟動，並要求宿主程式碼在真實 UI 就緒時呼叫 `setUIContext(...)`。

## 執行契約與型別定義

`CustomTool.execute` 簽名：

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` 透過 `Static<TParams>` 從您的 TypeBox 架構靜態定型。
- 執行前，代理程式迴圈會進行執行期參數驗證。
- `onUpdate` 發出部分結果以供 UI 串流。
- `ctx` 包含 session/模型狀態及 `abort()` 輔助函式。
- `signal` 傳遞取消訊號。

`CustomToolAdapter` 將此橋接至代理程式工具介面，並以正確的引數順序轉發呼叫。

## 工具如何暴露給模型

- 工具被封裝為 `AgentTool` 實例（`CustomToolAdapter` 或擴充功能包裝器）。
- 它們按名稱插入 session 工具登錄檔。
- 在 SDK 啟動時，自訂及擴充功能所註冊的工具會強制包含於初始啟用集合。
- CLI `--tools` 目前僅驗證內建工具名稱；自訂工具的包含由探索/註冊路徑及 SDK 選項處理。

## 渲染鉤子

選用的渲染鉤子：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI 中的執行期行為：

- 若鉤子存在，工具輸出會在 `Box` 容器內渲染。
- `renderResult` 接收 `{ expanded, isPartial, spinnerFrame? }`。
- 渲染器錯誤會被捕捉並記錄；UI 會退回預設文字渲染。

## Session/狀態處理

選用的 `onSession(event, ctx)` 接收 session 生命週期事件，包括：

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

使用 `ctx.sessionManager` 在分支/session 情境變更時從歷史記錄重建狀態。

## 失敗與取消語義

### 同步/非同步失敗

- 在 `execute` 中拋出例外（或被拒絕的 Promise）會被視為工具失敗。
- 代理程式執行期將失敗轉換為帶有 `isError: true` 及錯誤文字內容的工具結果訊息。
- 使用擴充功能包裝器時，`tool_result` 處理器可進一步改寫內容/詳情，甚至覆寫錯誤狀態。

### 取消

- 代理程式中止透過 `AbortSignal` 傳播至 `execute`。
- 將 `signal` 轉發至子程序工作（`pi.exec(..., { signal })`）以實現協作式取消。
- `ctx.abort()` 讓工具可請求中止目前的代理程式操作。

### onSession 錯誤

- `onSession` 錯誤會被捕捉並記錄為警告；它們不會導致 session 崩潰。

## 需要納入設計的實際限制

- 工具名稱在啟用的登錄檔中必須是全域唯一的。
- 建議在 `details` 中使用確定性、符合架構的輸出，以利渲染器/狀態重建。
- 使用 `pi.hasUI` 防護 UI 用法。
- 將工具目錄中的 `.md`/`.json` 視為元資料，而非可執行模組。
