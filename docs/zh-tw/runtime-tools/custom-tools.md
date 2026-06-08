---
title: 自訂工具
description: 自訂工具註冊、結構定義與執行管線，用於擴展代理功能。
sidebar:
  order: 4
  label: 自訂工具
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# 自訂工具

自訂工具是模型可呼叫的函式，它們整合到與內建工具相同的工具執行管線中。

自訂工具是一個 TypeScript/JavaScript 模組，匯出一個工廠函式。該工廠函式接收主機 API（`CustomToolAPI`）並回傳一個工具或一組工具陣列。

## 這是什麼（以及不是什麼）

- **自訂工具**：在一個回合中可由模型呼叫（`execute` + TypeBox 結構定義）。
- **擴充功能**：生命週期/事件框架，可註冊工具並攔截/修改事件。
- **Hook**：外部的前置/後置命令腳本。
- **技能**：靜態的指引/上下文套件，不是可執行的工具程式碼。

如果您需要模型直接呼叫程式碼，請使用自訂工具。

## 目前程式碼中的整合路徑

目前有兩種活躍的整合方式：

1. **SDK 提供的自訂工具**（`options.customTools`）
   - 透過 `CustomToolAdapter` 或擴充功能包裝器封裝為代理工具。
   - 在 SDK 啟動引導時始終包含在初始活躍工具集中。

2. **透過載入器 API 的檔案系統探索模組**（`discoverAndLoadCustomTools` / `loadCustomTools`）
   - 作為程式庫 API 公開於 `src/extensibility/custom-tools/loader.ts`。
   - 主機程式碼可呼叫這些 API，從設定/提供者/外掛路徑探索並載入工具模組。

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## 探索位置（載入器 API）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` 合併以下來源：

1. 能力提供者（`toolCapability`），包括：
   - 原生 OMP 設定（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude 設定（`~/.claude/tools`、`.claude/tools`）
   - Codex 設定（`~/.codex/tools`、`.codex/tools`）
   - Claude marketplace 外掛快取提供者
2. 已安裝的外掛清單（透過外掛載入器從 `~/.xcsh/plugins/node_modules/*` 載入）
3. 傳遞給載入器的明確設定路徑

### 重要行為

- 重複的已解析路徑會被去重。
- 工具名稱衝突會與內建工具及已載入的自訂工具進行比對並拒絕。
- `.md` 和 `.json` 檔案會被某些提供者探索為工具中繼資料，但可執行模組載入器會拒絕將它們作為可執行工具。
- 相對的設定路徑會從 `cwd` 解析；`~` 會被展開。

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

工廠回傳型別：

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## 傳遞給工廠的 API 介面（`CustomToolAPI`）

來自 `types.ts` 和 `loader.ts`：

- `cwd`：主機工作目錄
- `exec(command, args, options?)`：程序執行輔助函式
- `ui`：UI 上下文（在無頭模式下可為空操作）
- `hasUI`：在非互動式流程中為 `false`
- `logger`：共用檔案記錄器
- `typebox`：注入的 `@sinclair/typebox`
- `pi`：注入的 `@f5xc-salesdemos/xcsh` 匯出
- `pushPendingAction(action)`：為隱藏的 `resolve` 工具註冊預覽動作（`docs/resolve-tool-runtime.md`）

載入器以空操作 UI 上下文啟動，需要主機程式碼在真正的 UI 就緒時呼叫 `setUIContext(...)`。

## 執行契約與型別

`CustomTool.execute` 簽名：

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` 透過 `Static<TParams>` 從您的 TypeBox 結構定義靜態定型。
- 執行時期的參數驗證在代理迴圈中的執行之前進行。
- `onUpdate` 發出部分結果以供 UI 串流。
- `ctx` 包含會話/模型狀態以及一個 `abort()` 輔助函式。
- `signal` 攜帶取消訊號。

`CustomToolAdapter` 將此橋接到代理工具介面，並以正確的參數順序轉發呼叫。

## 工具如何暴露給模型

- 工具被封裝為 `AgentTool` 實例（`CustomToolAdapter` 或擴充功能包裝器）。
- 它們按名稱插入到會話工具註冊表中。
- 在 SDK 啟動引導中，自訂工具和擴充功能註冊的工具會被強制包含在初始活躍集中。
- CLI `--tools` 目前僅驗證內建工具名稱；自訂工具的包含透過探索/註冊路徑和 SDK 選項處理。

## 渲染鉤子

可選的渲染鉤子：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI 中的執行時期行為：

- 如果鉤子存在，工具輸出會在 `Box` 容器內渲染。
- `renderResult` 接收 `{ expanded, isPartial, spinnerFrame? }`。
- 渲染器錯誤會被捕獲並記錄；UI 會回退到預設的文字渲染。

## 會話/狀態處理

可選的 `onSession(event, ctx)` 接收會話生命週期事件，包括：

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

當分支/會話上下文變更時，使用 `ctx.sessionManager` 從歷史記錄重建狀態。

## 失敗與取消語義

### 同步/非同步失敗

- 在 `execute` 中拋出例外（或被拒絕的 Promise）會被視為工具失敗。
- 代理執行時期將失敗轉換為帶有 `isError: true` 和錯誤文字內容的工具結果訊息。
- 使用擴充功能包裝器時，`tool_result` 處理器可以進一步改寫內容/細節，甚至覆蓋錯誤狀態。

### 取消

- 代理中止透過 `AbortSignal` 傳播到 `execute`。
- 將 `signal` 轉發到子程序工作（`pi.exec(..., { signal })`）以實現協作式取消。
- `ctx.abort()` 讓工具可以請求中止當前的代理操作。

### onSession 錯誤

- `onSession` 錯誤會被捕獲並記錄為警告；它們不會導致會話崩潰。

## 設計時需考慮的實際限制

- 工具名稱在活躍註冊表中必須全域唯一。
- 建議在 `details` 中使用確定性的、符合結構定義的輸出，以利渲染器/狀態重建。
- 使用 `pi.hasUI` 保護 UI 的使用。
- 將工具目錄中的 `.md`/`.json` 視為中繼資料，而非可執行模組。
