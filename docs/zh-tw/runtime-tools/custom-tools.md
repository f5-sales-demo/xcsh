---
title: 自訂工具
description: 自訂工具的註冊、結構定義與執行管線，用於擴展代理程式功能。
sidebar:
  order: 4
  label: 自訂工具
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# 自訂工具

自訂工具是可供模型呼叫的函式，與內建工具共用相同的工具執行管線。

自訂工具是一個 TypeScript/JavaScript 模組，需匯出一個工廠函式。該工廠函式接收主機 API（`CustomToolAPI`），並回傳一個工具或工具陣列。

## 本功能的適用範圍

- **自訂工具**：模型可在回合中呼叫（`execute` + TypeBox 結構描述）。
- **擴充功能**：生命週期／事件框架，可註冊工具並攔截／修改事件。
- **Hook**：外部前置／後置命令腳本。
- **技能（Skill）**：靜態指引／情境套件，非可執行的工具程式碼。

若需要模型直接呼叫程式碼，請使用自訂工具。

## 目前程式碼中的整合方式

目前有兩種有效的整合方式：

1. **SDK 提供的自訂工具**（`options.customTools`）
   - 透過 `CustomToolAdapter` 或擴充功能包裝器，封裝為代理程式工具。
   - 在 SDK 啟動時，始終包含於初始的啟用工具集合中。

2. **透過載入器 API 從檔案系統探索的模組**（`discoverAndLoadCustomTools` / `loadCustomTools`）
   - 以函式庫 API 形式公開於 `src/extensibility/custom-tools/loader.ts`。
   - 主機程式碼可呼叫這些 API，從設定／提供者／外掛路徑中探索並載入工具模組。

```text
模型工具呼叫流程

LLM 工具呼叫
   │
   ▼
工具註冊表（內建工具 + 自訂工具介面卡）
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> 串流傳輸的部分結果
   └─ return result  -> 最終工具內容／詳細資訊
```

## 探索位置（載入器 API）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` 合併以下來源：

1. 能力提供者（`toolCapability`），包含：
   - 原生 OMP 設定（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude 設定（`~/.claude/tools`、`.claude/tools`）
   - Codex 設定（`~/.codex/tools`、`.codex/tools`）
   - Claude 市集外掛快取提供者
2. 已安裝的外掛清單（`~/.xcsh/plugins/node_modules/*`，透過外掛載入器）
3. 傳遞給載入器的明確設定路徑

### 重要行為說明

- 重複的解析路徑將被去重。
- 工具名稱衝突會在與內建工具及已載入自訂工具比對後被拒絕。
- 部分提供者會將 `.md` 與 `.json` 檔案探索為工具後設資料，但可執行模組載入器會拒絕將其作為可執行工具。
- 相對設定路徑會從 `cwd` 解析；`~` 會自動展開。

## 模組契約

自訂工具模組必須匯出一個函式（建議使用預設匯出）：

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

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

工廠函式回傳型別：

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## 傳遞給工廠函式的 API 介面（`CustomToolAPI`）

來源為 `types.ts` 與 `loader.ts`：

- `cwd`：主機工作目錄
- `exec(command, args, options?)`：程序執行輔助函式
- `ui`：UI 情境（在無介面模式下可為空操作）
- `hasUI`：在非互動式流程中為 `false`
- `logger`：共用檔案日誌記錄器
- `typebox`：注入的 `@sinclair/typebox`
- `pi`：注入的 `@f5xc-salesdemos/xcsh` 匯出
- `pushPendingAction(action)`：為隱藏的 `resolve` 工具註冊預覽動作（`docs/resolve-tool-runtime.md`）

載入器以空操作 UI 情境啟動，需要主機程式碼在真實 UI 就緒時呼叫 `setUIContext(...)`。

## 執行契約與型別

`CustomTool.execute` 簽名：

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` 透過 `Static<TParams>` 從您的 TypeBox 結構描述靜態推導型別。
- 在代理程式迴圈執行前，會對執行期參數進行驗證。
- `onUpdate` 發出部分結果，供 UI 串流使用。
- `ctx` 包含工作階段／模型狀態以及 `abort()` 輔助函式。
- `signal` 傳遞取消訊號。

`CustomToolAdapter` 將其橋接至代理程式工具介面，並以正確的參數順序轉發呼叫。

## 工具如何公開給模型

- 工具會被封裝為 `AgentTool` 實例（`CustomToolAdapter` 或擴充功能包裝器）。
- 依名稱插入工作階段工具註冊表。
- 在 SDK 啟動時，自訂工具與擴充功能已註冊的工具會被強制加入初始啟用集合。
- CLI `--tools` 目前僅驗證內建工具名稱；自訂工具的加入是透過探索／註冊路徑與 SDK 選項處理。

## 渲染 Hook

選用的渲染 Hook：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI 中的執行期行為：

- 若 Hook 存在，工具輸出會在 `Box` 容器內渲染。
- `renderResult` 接收 `{ expanded, isPartial, spinnerFrame? }`。
- 渲染器錯誤會被捕捉並記錄；UI 會退回至預設文字渲染。

## 工作階段／狀態處理

選用的 `onSession(event, ctx)` 可接收工作階段生命週期事件，包括：

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

當分支／工作階段情境變更時，可使用 `ctx.sessionManager` 從歷史記錄重建狀態。

## 失敗與取消語意

### 同步／非同步失敗

- 在 `execute` 中拋出例外（或 Promise 被拒絕）視為工具失敗。
- 代理程式執行期會將失敗轉換為含有 `isError: true` 與錯誤文字內容的工具結果訊息。
- 使用擴充功能包裝器時，`tool_result` 處理器可進一步改寫內容／詳細資訊，甚至覆寫錯誤狀態。

### 取消

- 代理程式的中止會透過 `AbortSignal` 傳播至 `execute`。
- 將 `signal` 轉送至子程序工作（`pi.exec(..., { signal })`）以實現協作式取消。
- `ctx.abort()` 可讓工具請求中止目前的代理程式操作。

### onSession 錯誤

- `onSession` 錯誤會被捕捉並以警告形式記錄；不會導致工作階段崩潰。

## 設計時的實際限制

- 工具名稱在啟用的註冊表中必須全域唯一。
- 在 `details` 中優先使用具確定性、符合結構描述的輸出，以利渲染器／狀態重建。
- 使用 UI 功能前，請以 `pi.hasUI` 進行防護。
- 將工具目錄中的 `.md`／`.json` 檔案視為後設資料，而非可執行模組。
