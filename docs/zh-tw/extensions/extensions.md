---
title: 擴充套件
description: 擴充套件執行階段概覽，涵蓋類型、執行器生命週期、註冊與探索。
sidebar:
  order: 1
  label: 概覽
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# 擴充套件

`packages/coding-agent` 中撰寫執行階段擴充套件的主要指南。

本文件涵蓋以下檔案中的當前擴充套件執行階段：

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

關於探索路徑與檔案系統載入規則，請參閱 `docs/extension-loading.md`。

## 什麼是擴充套件

擴充套件是匯出預設工廠函式的 TS/JS 模組：

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

擴充套件可在單一模組中組合以下所有功能：

- 事件處理器（`pi.on(...)`）
- LLM 可呼叫工具（`pi.registerTool(...)`）
- 斜線指令（`pi.registerCommand(...)`）
- 鍵盤快捷鍵與旗標
- 自訂訊息渲染
- 工作階段/訊息注入 API（`sendMessage`、`sendUserMessage`、`appendEntry`）

## 執行階段模型

1. 擴充套件被匯入，其工廠函式隨之執行。
2. 在載入階段期間，註冊方法有效；執行階段動作方法尚未初始化。
3. `ExtensionRunner.initialize(...)` 為作用中模式連接即時動作/情境。
4. 工作階段/代理程式/工具生命週期事件被發射給處理器。
5. 每次工具執行都以擴充套件攔截包裝（`tool_call` / `tool_result`）。

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

- 在擴充套件載入期間呼叫 `pi.sendMessage()` 等動作方法會拋出 `ExtensionRuntimeNotInitializedError`
- 先進行註冊；從事件/指令/工具執行執行階段行為

## 快速入門

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

## 擴充套件 API 介面

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
- `events`（共享事件匯流排）

在互動模式中，`input` 處理器在內建的首次訊息自動標題檢查之前執行。從 `input` 呼叫 `await pi.setSessionName(...)` 的擴充套件可以設定持久化的工作階段名稱，並防止該工作階段的預設自動生成標題執行。

另外公開：

- `pi.logger`
- `pi.typebox`
- `pi.pi`（套件匯出）

### 訊息傳遞語意

`pi.sendMessage(message, options)` 支援：

- `deliverAs: "steer"`（預設）— 中斷當前執行
- `deliverAs: "followUp"` — 排隊在當前執行後執行
- `deliverAs: "nextTurn"` — 儲存並在下一次使用者提示時注入
- `triggerTurn: true` — 閒置時啟動輪次（`nextTurn` 忽略此項）

`pi.sendUserMessage(content, { deliverAs })` 始終通過提示流程；串流期間會排隊為 steer/follow-up。

## 2) 處理器情境（`ExtensionContext`）

處理器與工具 `execute` 接收包含以下內容的 `ctx`：

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

## 3) 指令情境（`ExtensionCommandContext`）

指令處理器額外取得：

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

對工作階段控制流程使用指令情境；這些方法有意與一般事件處理器分開。

## 事件介面（當前名稱與行為）

規範的事件聯合類型與酬載類型位於 `types.ts`。

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

### 提示與輪次生命週期

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

`tool_result` 為中介軟體風格：處理器按擴充套件順序執行，每個處理器都能看到先前的修改。

### 可靠性/執行階段訊號

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 使用者指令攔截

- `user_bash`（以 `{ result }` 覆寫）
- `user_python`（以 `{ result }` 覆寫）

### `resources_discover`

`resources_discover` 存在於擴充套件類型與 `ExtensionRunner` 中。
當前執行階段備注：`ExtensionRunner.emitResourcesDiscover(...)` 已實作，但當前程式碼庫中沒有任何 `AgentSession` 呼叫點調用它。

## 工具撰寫詳情

`registerTool` 使用來自 `types.ts` 的 `ToolDefinition`。

當前 `execute` 簽名：

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

`tool_call`/`tool_result` 在 `sdk.ts` 中工具登錄檔被包裝後攔截所有工具，包括內建工具和擴充套件/自訂工具。

## UI 整合點

`ctx.ui` 實作 `ExtensionUIContext` 介面。支援程度因模式而異。

### 互動模式（`extension-ui-controller.ts`）

支援：

- 對話框：`select`、`confirm`、`input`、`editor`
- 通知/狀態/編輯器文字/終端輸入/自訂疊加層
- 依名稱列出/載入主題（`setTheme` 支援字串名稱）
- 工具展開切換

此控制器中當前為無操作的方法：

- `setFooter`
- `setHeader`
- `setEditorComponent`

另請注意：`setWidget` 目前透過 `setHookWidget(...)` 路由至狀態列文字。

### RPC 模式（`rpc-mode.ts`）

`ctx.ui` 由 RPC `extension_ui_request` 事件支援：

- 對話框方法（`select`、`confirm`、`input`、`editor`）往返至用戶端回應
- 一發即忘方法發射請求（`notify`、`setStatus`、針對字串陣列的 `setWidget`、`setTitle`、`setEditorText`）

RPC 實作中不支援/無操作：

- `onTerminalInput`
- `custom`
- `setFooter`、`setHeader`、`setEditorComponent`
- `setWorkingMessage`
- 主題切換/載入（`setTheme` 回傳失敗）
- 工具展開控制項無作用

### 列印/無頭/子代理程式路徑

當執行器初始化未提供 UI 情境時，`ctx.hasUI` 為 `false`，且方法為無操作/回傳預設值。

### 背景互動模式

背景模式安裝非互動式 UI 情境物件。在當前實作中，`ctx.hasUI` 在互動式對話框回傳預設值/無操作行為時仍可能為 `true`。

## 工作階段與狀態模式

對於持久化擴充套件狀態：

1. 以 `pi.appendEntry(customType, data)` 持久化。
2. 在 `session_start`、`session_branch`、`session_tree` 時從 `ctx.sessionManager.getBranch()` 重建狀態。
3. 當狀態應可從工具結果歷史中查看/重建時，保持工具結果 `details` 結構化。

重建模式範例：

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

在顯示自訂訊息時由互動式渲染使用。

## 工具呼叫/結果渲染器

在 `registerTool` 定義中提供 `renderCall` / `renderResult`，用於在 TUI 中自訂工具視覺化。

## 限制與陷阱

- 執行階段動作在擴充套件載入期間不可用。
- `tool_call` 錯誤會封鎖執行（fail-closed）。
- 與內建指令名稱衝突的指令會被略過並輸出診斷資訊。
- 保留的快捷鍵會被忽略（`ctrl+c`、`ctrl+d`、`ctrl+z`、`ctrl+k`、`ctrl+p`、`ctrl+l`、`ctrl+o`、`ctrl+t`、`ctrl+g`、`shift+tab`、`shift+ctrl+p`、`alt+enter`、`escape`、`enter`）。
- 將 `ctx.reload()` 視為當前指令處理器框架的終止點。

## 擴充套件 vs 掛勾 vs 自訂工具

使用正確的介面：

- **擴充套件**（`src/extensibility/extensions/*`）：統一系統（事件 + 工具 + 指令 + 渲染器 + 提供者註冊）。
- **掛勾**（`src/extensibility/hooks/*`）：獨立的舊版事件 API。
- **自訂工具**（`src/extensibility/custom-tools/*`）：以工具為中心的模組；與擴充套件一同載入時會被適配，並仍通過擴充套件攔截包裝器。

若您需要一個同時掌管政策、工具、指令 UX 與渲染的套件，請使用擴充套件。
