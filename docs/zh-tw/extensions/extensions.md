---
title: Extensions
description: >-
  Extension runtime overview covering types, runner lifecycle, registration, and
  discovery.
sidebar:
  order: 1
  label: 概觀
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# 擴充功能

在 `packages/coding-agent` 中撰寫執行時期擴充功能的主要指南。

本文件涵蓋以下位置中的當前擴充功能執行時期：

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

有關探索路徑和檔案系統載入規則，請參閱 `docs/extension-loading.md`。

## 什麼是擴充功能

擴充功能是一個匯出預設工廠函式的 TS/JS 模組：

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

擴充功能可以在一個模組中結合以下所有功能：

- 事件處理器 (`pi.on(...)`)
- LLM 可呼叫的工具 (`pi.registerTool(...)`)
- 斜線命令 (`pi.registerCommand(...)`)
- 鍵盤快捷鍵和旗標
- 自訂訊息渲染
- 工作階段/訊息注入 API (`sendMessage`、`sendUserMessage`、`appendEntry`)

## 執行時期模型

1. 擴充功能被匯入，其工廠函式被執行。
2. 在載入階段，註冊方法是有效的；執行時期動作方法尚未初始化。
3. `ExtensionRunner.initialize(...)` 為活躍模式連接即時動作/上下文。
4. 工作階段/代理/工具生命週期事件被發送到處理器。
5. 每次工具執行都會被擴充功能攔截包裝 (`tool_call` / `tool_result`)。

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

來自 `loader.ts` 的重要限制：

- 在擴充功能載入期間呼叫動作方法（如 `pi.sendMessage()`）會拋出 `ExtensionRuntimeNotInitializedError`
- 先註冊；從事件/命令/工具中執行執行時期行為

## 快速開始

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## 擴充功能 API 介面

## 1) 註冊與動作 (`ExtensionAPI`)

核心方法：

- `on(event, handler)`
- `registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`
- `registerMessageRenderer`
- `sendMessage`、`sendUserMessage`、`appendEntry`
- `getActiveTools`、`getAllTools`、`setActiveTools`
- `getSessionName`、`setSessionName`
- `setModel`、`getThinkingLevel`、`setThinkingLevel`
- `registerProvider`
- `events`（共享事件匯流排）

在互動模式中，`input` 處理器在內建的首次訊息自動標題檢查之前執行。從 `input` 呼叫 `await pi.setSessionName(...)` 的擴充功能可以設定持久化的工作階段名稱，並防止該工作階段執行預設的自動產生標題。

同樣暴露的：

- `pi.logger`
- `pi.typebox`
- `pi.pi`（套件匯出）

### 訊息傳遞語義

`pi.sendMessage(message, options)` 支援：

- `deliverAs: "steer"`（預設）— 中斷當前執行
- `deliverAs: "followUp"` — 排入佇列，在當前執行結束後執行
- `deliverAs: "nextTurn"` — 儲存並在下次使用者提示時注入
- `triggerTurn: true` — 在閒置時啟動一個回合（`nextTurn` 忽略此選項）

`pi.sendUserMessage(content, { deliverAs })` 始終通過提示流程；在串流期間會以 steer/follow-up 方式排入佇列。

## 2) 處理器上下文 (`ExtensionContext`)

處理器和工具的 `execute` 接收 `ctx`，包含：

- `ui`
- `hasUI`
- `cwd`
- `sessionManager`（唯讀）
- `modelRegistry`、`model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`、`hasPendingMessages()`、`abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) 命令上下文 (`ExtensionCommandContext`)

命令處理器額外取得：

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

使用命令上下文進行工作階段控制流程；這些方法被刻意與一般事件處理器分離。

## 事件介面（當前名稱與行為）

規範的事件聯合型別和酬載型別在 `types.ts` 中。

### 工作階段生命週期

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

可取消的前置事件：

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### 提示與回合生命週期

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### 工具生命週期

- `tool_call`（執行前，可阻擋）
- `tool_result`（執行後，可修補 content/details/isError）
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`（可觀測性）

`tool_result` 是中介軟體風格的：處理器依擴充功能順序執行，每個都能看到先前的修改。

### 可靠性/執行時期訊號

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 使用者命令攔截

- `user_bash`（以 `{ result }` 覆寫）
- `user_python`（以 `{ result }` 覆寫）

### `resources_discover`

`resources_discover` 存在於擴充功能型別和 `ExtensionRunner` 中。
當前執行時期注意事項：`ExtensionRunner.emitResourcesDiscover(...)` 已實作，但在當前程式碼庫中沒有 `AgentSession` 呼叫點調用它。

## 工具撰寫細節

`registerTool` 使用 `types.ts` 中的 `ToolDefinition`。

當前 `execute` 簽章：

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

範本：

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` 在 `sdk.ts` 中包裝註冊表後會攔截所有工具，包括內建工具和擴充功能/自訂工具。

## UI 整合點

`ctx.ui` 實作了 `ExtensionUIContext` 介面。不同模式的支援程度不同。

### 互動模式 (`extension-ui-controller.ts`)

支援：

- 對話框：`select`、`confirm`、`input`、`editor`
- 通知/狀態/編輯器文字/終端機輸入/自訂覆蓋層
- 佈景主題列表/依名稱載入（`setTheme` 支援字串名稱）
- 工具展開切換

此控制器中當前的空操作方法：

- `setFooter`
- `setHeader`
- `setEditorComponent`

另外注意：`setWidget` 當前透過 `setHookWidget(...)` 路由到狀態列文字。

### RPC 模式 (`rpc-mode.ts`)

`ctx.ui` 由 RPC `extension_ui_request` 事件支援：

- 對話框方法（`select`、`confirm`、`input`、`editor`）與客戶端回應進行往返通訊
- 即發即忘方法發送請求（`notify`、`setStatus`、字串陣列的 `setWidget`、`setTitle`、`setEditorText`）

在 RPC 實作中不支援/空操作的：

- `onTerminalInput`
- `custom`
- `setFooter`、`setHeader`、`setEditorComponent`
- `setWorkingMessage`
- 佈景主題切換/載入（`setTheme` 回傳失敗）
- 工具展開控制無效

### 列印/無頭/子代理路徑

當執行器初始化時未提供 UI 上下文，`ctx.hasUI` 為 `false`，方法為空操作/回傳預設值。

### 背景互動模式

背景模式安裝一個非互動式 UI 上下文物件。在當前實作中，`ctx.hasUI` 可能仍為 `true`，而互動式對話框回傳預設值/空操作行為。

## 工作階段與狀態模式

對於持久化的擴充功能狀態：

1. 使用 `pi.appendEntry(customType, data)` 進行持久化。
2. 在 `session_start`、`session_branch`、`session_tree` 時從 `ctx.sessionManager.getBranch()` 重建狀態。
3. 當狀態應該可從工具結果歷史中可見/可重建時，保持工具結果的 `details` 結構化。

狀態重建模式範例：

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## 渲染擴充點

## 自訂訊息渲染器

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

在互動式渲染中顯示自訂訊息時使用。

## 工具呼叫/結果渲染器

在 `registerTool` 定義上提供 `renderCall` / `renderResult`，以便在 TUI 中進行自訂工具視覺化。

## 限制與陷阱

- 執行時期動作在擴充功能載入期間不可用。
- `tool_call` 錯誤會阻擋執行（失敗即關閉）。
- 與內建命令名稱衝突的命令會被跳過並產生診斷訊息。
- 保留的快捷鍵會被忽略（`ctrl+c`、`ctrl+d`、`ctrl+z`、`ctrl+k`、`ctrl+p`、`ctrl+l`、`ctrl+o`、`ctrl+t`、`ctrl+g`、`shift+tab`、`shift+ctrl+p`、`alt+enter`、`escape`、`enter`）。
- 將 `ctx.reload()` 視為當前命令處理器框架的終止操作。

## 擴充功能 vs 掛鉤 vs 自訂工具

使用正確的介面：

- **擴充功能** (`src/extensibility/extensions/*`)：統一系統（事件 + 工具 + 命令 + 渲染器 + 提供者註冊）。
- **掛鉤** (`src/extensibility/hooks/*`)：獨立的舊版事件 API。
- **自訂工具** (`src/extensibility/custom-tools/*`)：以工具為中心的模組；當與擴充功能一起載入時，它們會被適配，仍然通過擴充功能攔截包裝器。

如果您需要一個套件同時擁有策略、工具、命令使用者體驗和渲染，請使用擴充功能。
