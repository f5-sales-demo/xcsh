---
title: 扩展
description: 扩展运行时概述，涵盖类型、运行器生命周期、注册与发现。
sidebar:
  order: 1
  label: 概述
i18n:
  sourceHash: 14cc16dbd98b
  translator: machine
---

# 扩展

`packages/coding-agent` 中运行时扩展的主要编写指南。

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
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

扩展可以在一个模块中组合以下所有功能：

- 事件处理器（`pi.on(...)`）
- 可被 LLM 调用的工具（`pi.registerTool(...)`）
- 斜杠命令（`pi.registerCommand(...)`）
- 键盘快捷键和标志
- 自定义消息渲染
- 会话/消息注入 API（`sendMessage`、`sendUserMessage`、`appendEntry`）

## 运行时模型

1. 扩展被导入，其工厂函数随即运行。
2. 在加载阶段，注册方法有效；运行时动作方法尚未初始化。
3. `ExtensionRunner.initialize(...)` 为当前模式连接实时动作/上下文。
4. 会话/代理/工具生命周期事件被发送至处理器。
5. 每次工具执行均通过扩展拦截进行包装（`tool_call` / `tool_result`）。

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

- 在扩展加载期间调用 `pi.sendMessage()` 等动作方法会抛出 `ExtensionRuntimeNotInitializedError`
- 请先注册；再从事件/命令/工具中执行运行时行为

## 快速入门

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

## 扩展 API 接口

## 1) 注册与动作（`ExtensionAPI`）

核心方法：

- `on(event, handler)`
- `registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`
- `registerMessageRenderer`
- `sendMessage`、`sendUserMessage`、`appendEntry`
- `getActiveTools`、`getAllTools`、`setActiveTools`
- `getSessionName`、`setSessionName`
- `setModel`、`getThinkingLevel`、`setThinkingLevel`
- `registerProvider`
- `events`（共享事件总线）

在交互模式下，`input` 处理器在内置的首条消息自动标题检查之前运行。在 `input` 中调用 `await pi.setSessionName(...)` 的扩展可以设置持久化会话名称，并阻止该会话运行默认的自动生成标题逻辑。

此外还暴露：

- `pi.logger`
- `pi.typebox`
- `pi.pi`（包导出）

### 消息投递语义

`pi.sendMessage(message, options)` 支持：

- `deliverAs: "steer"`（默认）——中断当前运行
- `deliverAs: "followUp"`——在当前运行完成后排队执行
- `deliverAs: "nextTurn"`——存储并在下一次用户提示时注入
- `triggerTurn: true`——在空闲时启动一个轮次（`nextTurn` 会忽略此选项）

`pi.sendUserMessage(content, { deliverAs })` 始终通过提示流程；在流式传输期间，其作为 steer/follow-up 排队。

## 2) 处理器上下文（`ExtensionContext`）

处理器和工具 `execute` 接收包含以下内容的 `ctx`：

- `ui`
- `hasUI`
- `cwd`
- `sessionManager`（只读）
- `modelRegistry`、`model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`、`hasPendingMessages()`、`abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) 命令上下文（`ExtensionCommandContext`）

命令处理器额外获得：

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

将命令上下文用于会话控制流程；这些方法有意与通用事件处理器分离。

## 事件接口（当前名称与行为）

规范的事件联合类型和载荷类型定义于 `types.ts`。

### 会话生命周期

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

可取消的预事件：

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### 提示与轮次生命周期

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

`tool_result` 为中间件风格：处理器按扩展顺序运行，每个处理器均可看到之前的修改。

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
当前运行时说明：`ExtensionRunner.emitResourcesDiscover(...)` 已实现，但当前代码库中没有 `AgentSession` 调用点对其进行调用。

## 工具编写详情

`registerTool` 使用来自 `types.ts` 的 `ToolDefinition`。

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

`tool_call`/`tool_result` 在 `sdk.ts` 中将注册表包装后，会拦截所有工具，包括内置工具和扩展/自定义工具。

## UI 集成点

`ctx.ui` 实现了 `ExtensionUIContext` 接口。不同模式下的支持情况有所差异。

### 交互模式（`extension-ui-controller.ts`）

支持：

- 对话框：`select`、`confirm`、`input`、`editor`
- 通知/状态/编辑器文本/终端输入/自定义覆盖层
- 按名称列出/加载主题（`setTheme` 支持字符串名称）
- 工具展开切换

此控制器中当前为空操作的方法：

- `setFooter`
- `setHeader`
- `setEditorComponent`

另请注意：`setWidget` 当前通过 `setHookWidget(...)` 路由至状态栏文本。

### RPC 模式（`rpc-mode.ts`）

`ctx.ui` 由 RPC `extension_ui_request` 事件驱动：

- 对话框方法（`select`、`confirm`、`input`、`editor`）往返于客户端响应
- 即发即忘方法发出请求（`notify`、`setStatus`、字符串数组的 `setWidget`、`setTitle`、`setEditorText`）

RPC 实现中不支持/为空操作的方法：

- `onTerminalInput`
- `custom`
- `setFooter`、`setHeader`、`setEditorComponent`
- `setWorkingMessage`
- 主题切换/加载（`setTheme` 返回失败）
- 工具展开控件无效

### 打印/无头/子代理路径

当运行器初始化时未提供 UI 上下文，`ctx.hasUI` 为 `false`，方法为空操作/返回默认值。

### 后台交互模式

后台模式安装非交互式 UI 上下文对象。在当前实现中，`ctx.hasUI` 仍可能为 `true`，而交互式对话框返回默认值/空操作行为。

## 会话与状态模式

对于持久化扩展状态：

1. 使用 `pi.appendEntry(customType, data)` 进行持久化。
2. 在 `session_start`、`session_branch`、`session_tree` 时，通过 `ctx.sessionManager.getBranch()` 重建状态。
3. 当状态需要从工具结果历史中可见/可重建时，保持工具结果 `details` 的结构化。

状态重建示例模式：

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

在显示自定义消息时由交互式渲染使用。

## 工具调用/结果渲染器

在 `registerTool` 定义上提供 `renderCall` / `renderResult`，用于在 TUI 中自定义工具可视化。

## 约束与注意事项

- 运行时动作在扩展加载期间不可用。
- `tool_call` 错误会阻止执行（失败关闭）。
- 与内置命令名称冲突的命令会被跳过并输出诊断信息。
- 保留的快捷键会被忽略（`ctrl+c`、`ctrl+d`、`ctrl+z`、`ctrl+k`、`ctrl+p`、`ctrl+l`、`ctrl+o`、`ctrl+t`、`ctrl+g`、`shift+tab`、`shift+ctrl+p`、`alt+enter`、`escape`、`enter`）。
- 将 `ctx.reload()` 视为当前命令处理器帧的终止操作。

## 扩展 vs 钩子 vs 自定义工具

请使用正确的接口：

- **扩展**（`src/extensibility/extensions/*`）：统一系统（事件 + 工具 + 命令 + 渲染器 + 提供者注册）。
- **钩子**（`src/extensibility/hooks/*`）：独立的旧版事件 API。
- **自定义工具**（`src/extensibility/custom-tools/*`）：以工具为中心的模块；与扩展一同加载时，它们会被适配，并仍通过扩展拦截包装器。

如果您需要一个统一管理策略、工具、命令 UX 和渲染的包，请使用扩展。
