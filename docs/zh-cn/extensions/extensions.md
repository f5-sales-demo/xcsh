---
title: Extensions
description: 扩展运行时概述，涵盖类型、运行器生命周期、注册和发现。
sidebar:
  order: 1
  label: 概述
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# 扩展

在 `packages/coding-agent` 中编写运行时扩展的主要指南。

本文档涵盖以下文件中的当前扩展运行时：

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

有关发现路径和文件系统加载规则，请参阅 `docs/extension-loading.md`。

## 什么是扩展

扩展是一个导出默认工厂函数的 TS/JS 模块：

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

扩展可以在一个模块中组合以下所有功能：

- 事件处理器 (`pi.on(...)`)
- LLM 可调用工具 (`pi.registerTool(...)`)
- 斜杠命令 (`pi.registerCommand(...)`)
- 键盘快捷键和标志
- 自定义消息渲染
- 会话/消息注入 API (`sendMessage`, `sendUserMessage`, `appendEntry`)

## 运行时模型

1. 扩展被导入并执行其工厂函数。
2. 在加载阶段，注册方法可用；运行时操作方法尚未初始化。
3. `ExtensionRunner.initialize(...)` 为活动模式连接实时操作/上下文。
4. 会话/代理/工具生命周期事件被发射到处理器。
5. 每次工具执行都通过扩展拦截进行包装 (`tool_call` / `tool_result`)。

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

来自 `loader.ts` 的重要约束：

- 在扩展加载期间调用 `pi.sendMessage()` 等操作方法会抛出 `ExtensionRuntimeNotInitializedError`
- 先注册；从事件/命令/工具中执行运行时行为

## 快速入门

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

## 扩展 API 接口

## 1) 注册和操作 (`ExtensionAPI`)

核心方法：

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events`（共享事件总线）

在交互模式下，`input` 处理器在内置的首条消息自动标题检查之前运行。从 `input` 中调用 `await pi.setSessionName(...)` 的扩展可以设置持久化的会话名称，并阻止该会话的默认自动生成标题运行。

同时暴露的还有：

- `pi.logger`
- `pi.typebox`
- `pi.pi`（包导出）

### 消息投递语义

`pi.sendMessage(message, options)` 支持：

- `deliverAs: "steer"`（默认）— 中断当前运行
- `deliverAs: "followUp"` — 排队在当前运行之后执行
- `deliverAs: "nextTurn"` — 存储并在下一次用户提示时注入
- `triggerTurn: true` — 在空闲时启动一个回合（`nextTurn` 忽略此选项）

`pi.sendUserMessage(content, { deliverAs })` 始终通过提示流程；在流式传输期间它会作为 steer/follow-up 排队。

## 2) 处理器上下文 (`ExtensionContext`)

处理器和工具 `execute` 接收的 `ctx` 包含：

- `ui`
- `hasUI`
- `cwd`
- `sessionManager`（只读）
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) 命令上下文 (`ExtensionCommandContext`)

命令处理器额外获得：

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

使用命令上下文进行会话控制流程；这些方法有意与通用事件处理器分离。

## 事件接口（当前名称和行为）

规范的事件联合类型和载荷类型在 `types.ts` 中。

### 会话生命周期

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

### 提示和回合生命周期

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### 工具生命周期

- `tool_call`（执行前，可阻止）
- `tool_result`（执行后，可修补 content/details/isError）
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`（可观测性）

`tool_result` 是中间件风格的：处理器按扩展顺序运行，每个都能看到之前的修改。

### 可靠性/运行时信号

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 用户命令拦截

- `user_bash`（通过 `{ result }` 覆盖）
- `user_python`（通过 `{ result }` 覆盖）

### `resources_discover`

`resources_discover` 存在于扩展类型和 `ExtensionRunner` 中。
当前运行时说明：`ExtensionRunner.emitResourcesDiscover(...)` 已实现，但当前代码库中没有 `AgentSession` 调用点调用它。

## 工具编写详情

`registerTool` 使用 `types.ts` 中的 `ToolDefinition`。

当前 `execute` 签名：

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

模板：

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

`tool_call`/`tool_result` 在注册表通过 `sdk.ts` 包装后拦截所有工具，包括内置工具和扩展/自定义工具。

## UI 集成点

`ctx.ui` 实现了 `ExtensionUIContext` 接口。不同模式的支持程度不同。

### 交互模式 (`extension-ui-controller.ts`)

已支持：

- 对话框：`select`, `confirm`, `input`, `editor`
- 通知/状态/编辑器文本/终端输入/自定义覆盖层
- 主题列表/按名称加载（`setTheme` 支持字符串名称）
- 工具展开切换

此控制器中当前的空操作方法：

- `setFooter`
- `setHeader`
- `setEditorComponent`

另请注意：`setWidget` 当前通过 `setHookWidget(...)` 路由到状态栏文本。

### RPC 模式 (`rpc-mode.ts`)

`ctx.ui` 由 RPC `extension_ui_request` 事件支持：

- 对话框方法（`select`, `confirm`, `input`, `editor`）通过往返客户端响应实现
- 即发即忘方法发出请求（`notify`, `setStatus`, `setWidget` 用于字符串数组, `setTitle`, `setEditorText`）

RPC 实现中不支持/空操作的：

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- 主题切换/加载（`setTheme` 返回失败）
- 工具展开控制无效

### 打印/无头/子代理路径

当运行器初始化时未提供 UI 上下文，`ctx.hasUI` 为 `false`，方法为空操作/返回默认值。

### 后台交互模式

后台模式安装了一个非交互式 UI 上下文对象。在当前实现中，`ctx.hasUI` 可能仍为 `true`，但交互式对话框返回默认值/空操作行为。

## 会话和状态模式

对于持久化扩展状态：

1. 使用 `pi.appendEntry(customType, data)` 进行持久化。
2. 在 `session_start`、`session_branch`、`session_tree` 时从 `ctx.sessionManager.getBranch()` 重建状态。
3. 当状态应该从工具结果历史中可见/可重建时，保持工具结果 `details` 结构化。

状态重建模式示例：

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

## 渲染扩展点

## 自定义消息渲染器

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

在交互式渲染显示自定义消息时使用。

## 工具调用/结果渲染器

在 `registerTool` 定义中提供 `renderCall` / `renderResult` 以在 TUI 中实现自定义工具可视化。

## 约束和注意事项

- 运行时操作在扩展加载期间不可用。
- `tool_call` 错误会阻止执行（失败即关闭）。
- 与内置命令名称冲突的命令会被跳过并输出诊断信息。
- 保留快捷键会被忽略（`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`）。
- 将 `ctx.reload()` 视为当前命令处理器帧的终止操作。

## 扩展 vs 钩子 vs 自定义工具

使用正确的接口：

- **扩展** (`src/extensibility/extensions/*`)：统一系统（事件 + 工具 + 命令 + 渲染器 + 提供者注册）。
- **钩子** (`src/extensibility/hooks/*`)：独立的遗留事件 API。
- **自定义工具** (`src/extensibility/custom-tools/*`)：以工具为中心的模块；当与扩展一起加载时，它们会被适配，并且仍然通过扩展拦截包装器。

如果您需要一个同时拥有策略、工具、命令 UX 和渲染的包，请使用扩展。
