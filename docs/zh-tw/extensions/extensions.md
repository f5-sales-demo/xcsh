---
title: 擴充功能
description: 擴充功能執行時期概覽，涵蓋類型、執行器生命週期、註冊與探索。
sidebar:
  order: 1
  label: 概覽
i18n:
  sourceHash: 14cc16dbd98b
  translator: machine
---

# 擴充功能

`packages/coding-agent` 中撰寫執行時期擴充功能的主要指南。

本文件涵蓋以下檔案中的現行擴充功能執行時期：

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

關於探索路徑與檔案系統載入規則，請參閱 `docs/extension-loading.md`。

## 什麼是擴充功能

擴充功能是一個匯出預設工廠函式的 TS/JS 模組：

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

擴充功能可以在單一模組中組合以下所有功能：

- 事件處理器（`pi.on(...)`）
- 可供 LLM 呼叫的工具（`pi.registerTool(...)`）
- 斜線命令（`pi.registerCommand(...)`）
- 鍵盤快捷鍵與旗標
- 自訂訊息渲染
- 工作階段/訊息注入 API（`sendMessage`、`sendUserMessage`、`appendEntry`）

## 執行時期模型

1. 擴充功能被匯入，其工廠函式隨即執行。
2. 在載入階段期間，註冊方法有效；執行時期動作方法尚未初始化。
3. `ExtensionRunner.initialize(...)` 為當前模式連接即時動作/上下文。
4. 工作階段/代理程式/工具生命週期事件會發送至處理器。
5. 每次工具執行都會以擴充功能攔截方式包裝（`tool_call` / `tool_result`）。

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

- 在擴充功能載入期間呼叫 `pi.sendMessage()` 等動作方法會拋出 `ExtensionRuntimeNotInitializedError`
- 請先進行註冊；再從事件/命令/工具中執行執行時期行為

## 快速開始

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
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

## 1) 註冊與動作（`ExtensionAPI`）

核心方法：

- `on(event, handler)`
- `registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`
- `registerMessageRenderer`
- `sendMessage`、`sendUserMessage`、`appendEntry`
- `getActiveTools`、`getAllTools`、`setActiveTools`
- `getSessionName`、`setSessionName`
- `setModel`、`getThinkingLevel`、`setThinkingLevel`
- `registerProvider`
- `events`（共用事件匯流排）

在互動模式中，`input` 處理器會在內建的首次訊息自動標題檢查之前執行。從 `input` 呼叫 `await pi.setSessionName(...)` 的擴充功能可以設定持久化的工作階段名稱，並防止預設自動產生的標題在該工作階段中執行。

另外公開：

- `pi.logger`
- `pi.typebox`
- `pi.pi`（套件匯出）

### 訊息傳送語意

`pi.sendMessage(message, options)` 支援：

- `deliverAs: "steer"`（預設）— 中斷當前執行
- `deliverAs: "followUp"` — 排隊於當前執行結束後執行
- `deliverAs: "nextTurn"` — 儲存並在下一次使用者提示時注入
- `triggerTurn: true` — 在閒置時啟動一個回合（`nextTurn` 會忽略此項）

`pi.sendUserMessage(content, { deliverAs })` 始終通過提示流程；串流期間會以 steer/follow-up 方式排隊。

## 2) 處理器上下文（`ExtensionContext`）

處理器與工具 `execute` 會接收包含以下內容的 `ctx`：

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

## 3) 命令上下文（`ExtensionCommandContext`）

命令處理器額外提供：

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

將命令上下文用於工作階段控制流程；這些方法刻意與一般事件處理器分離。

## 事件介面（現行名稱與行為）

標準事件聯合型別與載荷類型位於 `types.ts`。

### 工作階段生命週期

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

可取消的預備事件：

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

- `tool_call`（執行前，可封鎖）
- `tool_result`（執行後，可修補 content/details/isError）
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`（可觀測性）

`tool_result` 採用中介軟體風格：處理器依擴充功能順序執行，每個處理器都能看到先前的修改。

### 可靠性/執行時期訊號

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 使用者命令攔截

- `user_bash`（以 `{ result }` 覆寫）
- `user_python`（以 `{ result }` 覆寫）

### `resources_discover`

`resources_discover` 存在於擴充功能類型與 `ExtensionRunner` 中。
現行執行時期注意事項：`ExtensionRunner.emitResourcesDiscover(...)` 已實作，但目前程式碼庫中沒有任何 `AgentSession` 呼叫點會呼叫它。

## 工具撰寫詳情

`registerTool` 使用來自 `types.ts` 的 `ToolDefinition`。

現行 `execute` 簽章：

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

`tool_call`/`tool_result` 一旦在 `sdk.ts` 中將登錄包裝，即會攔截所有工具，包括內建工具及擴充功能/自訂工具。

## UI 整合點

`ctx.ui` 實作 `ExtensionUIContext` 介面。各模式的支援程度有所不同。

### 互動模式（`extension-ui-controller.ts`）

支援的功能：

- 對話框：`select`、`confirm`、`input`、`editor`
- 通知/狀態/編輯器文字/終端機輸入/自訂覆蓋層
- 主題列表/依名稱載入（`setTheme` 支援字串名稱）
- 工具展開切換

此控制器中目前為無操作的方法：

- `setFooter`
- `setHeader`
- `setEditorComponent`

另請注意：`setWidget` 目前透過 `setHookWidget(...)` 路由至狀態列文字。

### RPC 模式（`rpc-mode.ts`）

`ctx.ui` 由 RPC `extension_ui_request` 事件支援：

- 對話框方法（`select`、`confirm`、`input`、`editor`）往返於客戶端回應
- 即發即忘方法會發出請求（`notify`、`setStatus`、字串陣列的 `setWidget`、`setTitle`、`setEditorText`）

RPC 實作中不支援/無操作的功能：

- `onTerminalInput`
- `custom`
- `setFooter`、`setHeader`、`setEditorComponent`
- `setWorkingMessage`
- 主題切換/載入（`setTheme` 回傳失敗）
- 工具展開控制無效

### 列印/無介面/子代理程式路徑

當沒有 UI 上下文提供給執行器初始化時，`ctx.hasUI` 為 `false`，且方法為無操作/回傳預設值。

### 背景互動模式

背景模式會安裝非互動式 UI 上下文物件。在現行實作中，`ctx.hasUI` 可能仍為 `true`，而互動式對話框則回傳預設值/無操作行為。

## 工作階段與狀態模式

若要持久化擴充功能狀態：

1. 以 `pi.appendEntry(customType, data)` 進行持久化。
2. 在 `session_start`、`session_branch`、`session_tree` 時，從 `ctx.sessionManager.getBranch()` 重建狀態。
3. 當狀態應可從工具結果歷史中看見/重建時，保持工具結果 `details` 的結構化。

重建範例模式：

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

在顯示自訂訊息時，由互動渲染使用。

## 工具呼叫/結果渲染器

在 `registerTool` 定義上提供 `renderCall` / `renderResult`，以在 TUI 中自訂工具視覺化呈現。

## 限制與常見陷阱

- 執行時期動作在擴充功能載入期間無法使用。
- `tool_call` 錯誤會封鎖執行（封閉式失敗）。
- 與內建命令名稱衝突的命令會被略過並記錄診斷資訊。
- 保留的快捷鍵會被忽略（`ctrl+c`、`ctrl+d`、`ctrl+z`、`ctrl+k`、`ctrl+p`、`ctrl+l`、`ctrl+o`、`ctrl+t`、`ctrl+g`、`shift+tab`、`shift+ctrl+p`、`alt+enter`、`escape`、`enter`）。
- 將 `ctx.reload()` 視為當前命令處理器框架的終止操作。

## 擴充功能 vs 掛鉤 vs 自訂工具

選用正確的介面：

- **擴充功能**（`src/extensibility/extensions/*`）：統一系統（事件 + 工具 + 命令 + 渲染器 + 提供者註冊）。
- **掛鉤**（`src/extensibility/hooks/*`）：獨立的舊版事件 API。
- **自訂工具**（`src/extensibility/custom-tools/*`）：以工具為主的模組；與擴充功能一起載入時，會被適配並仍通過擴充功能攔截包裝器。

如果您需要一個統一管理政策、工具、命令 UX 與渲染的套件，請使用擴充功能。
