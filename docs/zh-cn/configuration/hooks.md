---
title: 钩子系统
description: 编码代理生命周期中用于事件前/后自动化的钩子系统。
sidebar:
  order: 4
  label: 钩子系统
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# 钩子系统

本文档描述了 `src/extensibility/hooks/*` 中**当前钩子子系统的代码**。

## 运行时的当前状态

钩子包（`src/extensibility/hooks/`）仍然作为 API 接口导出并可使用，但默认的 CLI 运行时现在初始化的是**扩展运行器**路径。在当前的启动流程中：

- `--hook` 被视为 `--extension` 的别名（CLI 路径被合并到 `additionalExtensionPaths` 中）
- 工具由 `ExtensionToolWrapper` 包装，而非 `HookToolWrapper`
- 上下文转换和生命周期事件发射通过 `ExtensionRunner` 进行

因此本文档记录的是钩子子系统实现本身（类型/加载器/运行器/包装器），包括遗留行为和约束。

## 关键文件

- `src/extensibility/hooks/types.ts` — 钩子上下文、事件类型和结果契约
- `src/extensibility/hooks/loader.ts` — 模块加载和钩子发现桥接
- `src/extensibility/hooks/runner.ts` — 事件分发、命令查找、错误信号
- `src/extensibility/hooks/tool-wrapper.ts` — 工具执行前/后拦截包装器
- `src/extensibility/hooks/index.ts` — 导出/重新导出

## 什么是钩子模块

钩子模块必须默认导出一个工厂函数：

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

该工厂函数可以：

- 使用 `pi.on(...)` 注册事件处理程序
- 使用 `pi.sendMessage(...)` 发送持久化的自定义消息
- 使用 `pi.appendEntry(...)` 持久化非 LLM 状态
- 通过 `pi.registerCommand(...)` 注册斜杠命令
- 通过 `pi.registerMessageRenderer(...)` 注册自定义消息渲染器
- 通过 `pi.exec(...)` 运行 shell 命令

## 发现和加载

`discoverAndLoadHooks(configuredPaths, cwd)` 执行以下操作：

1. 从能力注册表加载已发现的钩子（`loadCapability("hooks")`）
2. 追加显式配置的路径（按绝对路径去重）
3. 调用 `loadHooks(allPaths, cwd)`

`loadHooks` 然后导入每个路径并期望一个 `default` 函数。

### 路径解析

`loader.ts` 按如下方式解析钩子路径：

- 绝对路径：直接使用
- `~` 路径：展开处理
- 相对路径：相对于 `cwd` 解析

### 重要的遗留不匹配问题

`hookCapability` 的发现提供者仍然建模为 shell 风格的前/后钩子文件（例如 `.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）。

此处的钩子加载器使用动态模块导入，并要求一个默认的 JS/TS 钩子工厂函数。如果发现的钩子路径无法作为模块导入，加载将失败并在 `LoadHooksResult.errors` 中报告。

## 事件接口

钩子事件在 `types.ts` 中是强类型的。

### 会话事件

- `session_start`
- `session_before_switch` → 可返回 `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → 可返回 `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → 可返回 `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → 可返回 `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → 可返回 `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### 代理/上下文事件

- `context` → 可返回 `{ messages?: Message[] }`
- `before_agent_start` → 可返回 `{ message?: { customType; content; display; details } }`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 工具事件（前/后模型）

- `tool_call`（执行前）→ 可返回 `{ block?: boolean; reason?: string }`
- `tool_result`（执行后）→ 可返回 `{ content?; details?; isError? }`

这是钩子子系统的核心前/后拦截模型。

```text
钩子工具拦截流程

tool_call 处理程序
   │
   ├─ 有 { block: true }? ── 是 ──> 抛出异常（工具被阻止）
   │
   └─ 否
      │
      ▼
   执行底层工具
      │
      ├─ 成功 ──> tool_result 处理程序可覆盖 { content, details }
      │
      └─ 错误   ──> 发射 tool_result(isError=true) 然后重新抛出原始错误
```

## 执行模型和变更语义

### 1) 执行前：`tool_call`

`HookToolWrapper.execute()` 在工具执行前发射 `tool_call`。

- 如果任何处理程序返回 `{ block: true }`，执行停止
- 如果处理程序抛出异常，包装器采用故障安全模式阻止执行
- 返回的 `reason` 成为抛出的错误文本

### 2) 工具执行

如果未被阻止，底层工具正常执行。

### 3) 执行后：`tool_result`

成功后，包装器发射 `tool_result`，包含：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

如果处理程序返回覆盖值：

- `content` 可替换结果内容
- `details` 可替换结果详情

工具执行失败时，包装器发射带有 `isError: true` 和错误文本内容的 `tool_result`，然后重新抛出原始错误。

### 钩子可以变更的内容

- 通过 `context` 变更单次调用的 LLM 上下文（`messages` 替换链）
- 成功工具调用时的工具输出内容/详情（`tool_result` 路径）
- 通过 `before_agent_start` 注入代理前消息
- 通过 `session_before_*` 和 `session.compacting` 实现取消/自定义压缩/树行为

### 在此实现中钩子无法变更的内容

- 就地修改原始工具输入参数（`tool_call` 只能阻止/允许）
- 工具错误抛出后继续执行（错误路径会重新抛出）
- 包装器行为中的最终成功/错误状态（返回的 `isError` 有类型定义但 `HookToolWrapper` 不会应用）

## 排序和冲突行为

### 发现级排序

能力提供者按优先级排序（高优先级在前）。去重按能力键进行，先到先得。

对于 `hooks`，能力键为 `${type}:${tool}:${name}`。来自低优先级提供者的被遮蔽的重复项会被标记并从有效发现列表中排除。

### 加载顺序

`discoverAndLoadHooks` 构建一个扁平的 `allPaths` 列表，按解析后的绝对路径去重，然后 `loadHooks` 按该顺序迭代。
每个已发现目录中的文件顺序取决于 `readdir` 的输出；钩子加载器不会执行额外的排序。

### 运行时处理程序顺序

在 `HookRunner` 内部，顺序由注册顺序确定：

1. hooks 数组顺序
2. 每个钩子/事件的处理程序注册顺序

按事件类型的冲突行为：

- `tool_call`：最后返回的结果生效，除非某个处理程序阻止；第一个阻止会短路
- `tool_result`：最后返回的覆盖值生效（无短路）
- `context`：链式调用；每个处理程序接收前一个处理程序的消息输出
- `before_agent_start`：保留第一个返回的消息；后续消息被忽略
- `session_before_*`：跟踪最后返回的结果；`cancel: true` 立即短路
- `session.compacting`：最后返回的结果生效

命令/渲染器冲突：

- `getCommand(name)` 返回跨钩子的第一个匹配（先加载的优先）
- `getMessageRenderer(customType)` 返回第一个匹配
- `getRegisteredCommands()` 返回所有命令（不去重）

## UI 交互（`HookContext.ui`）

`HookUIContext` 包含：

- `select`、`confirm`、`input`、`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`、`getEditorText`
- `theme` getter

`ctx.hasUI` 表示交互式 UI 是否可用。

在没有 UI 的情况下运行时，默认的空操作上下文行为为：

- `select/input/editor` 返回 `undefined`
- `confirm` 返回 `false`
- `notify`、`setStatus`、`setEditorText` 为空操作
- `getEditorText` 返回 `""`

### 状态行行为

通过 `ctx.ui.setStatus(key, text)` 设置的钩子状态文本：

- 按键存储
- 按键名排序
- 经过清理处理（`\r`、`\n`、`\t` → 空格；重复空格合并）
- 拼接后截断宽度以供显示

## 错误传播和回退

### 加载时

- 无效模块或缺少默认导出 → 捕获到 `LoadHooksResult.errors` 中
- 其他钩子继续加载

### 事件时

`HookRunner.emit(...)` 捕获大多数事件的处理程序错误，并向监听器发射 `HookError`（`hookPath`、`event`、`error`），然后继续执行。

`emitToolCall(...)` 更为严格：处理程序错误不会被吞没，而是传播给调用者。在 `HookToolWrapper` 中，这会阻止工具调用（故障安全）。

## 实际 API 示例

### 阻止不安全的 bash 命令

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### 在执行后编辑工具输出

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### 按每次 LLM 调用修改模型上下文

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### 使用命令安全上下文方法注册斜杠命令

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## 导出接口

`src/extensibility/hooks/index.ts` 导出：

- 加载 API（`discoverAndLoadHooks`、`loadHooks`）
- 运行器和包装器（`HookRunner`、`HookToolWrapper`）
- 所有钩子类型
- `execCommand` 重新导出

包根目录（`src/index.ts`）重新导出钩子**类型**作为遗留兼容接口。
