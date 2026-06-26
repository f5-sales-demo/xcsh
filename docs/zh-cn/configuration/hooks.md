---
title: Hooks
description: 编码代理生命周期中用于事件前/后自动化的 Hook 系统。
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

本文档描述 `src/extensibility/hooks/*` 中**当前 Hook 子系统的代码**。

## 运行时的当前状态

Hook 包（`src/extensibility/hooks/`）仍作为 API 接口导出并可正常使用，但默认 CLI 运行时现在初始化的是**扩展运行器**路径。在当前启动流程中：

- `--hook` 被视为 `--extension` 的别名（CLI 路径合并至 `additionalExtensionPaths`）
- 工具由 `ExtensionToolWrapper` 而非 `HookToolWrapper` 进行包装
- 上下文转换和生命周期事件通过 `ExtensionRunner` 发送

因此，本文档描述的是 Hook 子系统的实现本身（类型/加载器/运行器/包装器），包括遗留行为与约束。

## 关键文件

- `src/extensibility/hooks/types.ts` — Hook 上下文、事件类型和结果契约
- `src/extensibility/hooks/loader.ts` — 模块加载与 Hook 发现桥接
- `src/extensibility/hooks/runner.ts` — 事件分发、命令查找、错误信号
- `src/extensibility/hooks/tool-wrapper.ts` — 工具执行前/后拦截包装器
- `src/extensibility/hooks/index.ts` — 导出/重新导出

## Hook 模块是什么

一个 Hook 模块必须默认导出一个工厂函数：

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

该工厂函数可以：

- 通过 `pi.on(...)` 注册事件处理程序
- 通过 `pi.sendMessage(...)` 发送持久化自定义消息
- 通过 `pi.appendEntry(...)` 持久化非 LLM 状态
- 通过 `pi.registerCommand(...)` 注册斜杠命令
- 通过 `pi.registerMessageRenderer(...)` 注册自定义消息渲染器
- 通过 `pi.exec(...)` 运行 Shell 命令

## 发现与加载

`discoverAndLoadHooks(configuredPaths, cwd)` 的执行步骤：

1. 从能力注册表加载已发现的 Hook（`loadCapability("hooks")`）
2. 追加显式配置的路径（按绝对路径去重）
3. 调用 `loadHooks(allPaths, cwd)`

`loadHooks` 随后导入每个路径，并期望其具有 `default` 函数。

### 路径解析

`loader.ts` 对 Hook 路径的解析规则如下：

- 绝对路径：直接使用
- `~` 路径：展开处理
- 相对路径：相对于 `cwd` 进行解析

### 重要的遗留不匹配问题

`hookCapability` 的发现提供者仍以 Shell 风格的前/后 Hook 文件为模型（例如 `.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）。

此处的 Hook 加载器使用动态模块导入，并要求具有默认 JS/TS Hook 工厂函数。若某个已发现的 Hook 路径无法作为模块导入，则加载失败，并记录在 `LoadHooksResult.errors` 中。

## 事件接口

Hook 事件在 `types.ts` 中具有强类型定义。

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

这是 Hook 子系统的核心前/后拦截模型。

```text
Hook 工具拦截流程

tool_call 处理程序
   │
   ├─ 任意 { block: true }？── 是 ──> 抛出异常（工具被阻止）
   │
   └─ 否
      │
      ▼
   执行底层工具
      │
      ├─ 成功 ──> tool_result 处理程序可覆盖 { content, details }
      │
      └─ 错误 ──> 发送 tool_result(isError=true) 后重新抛出原始错误
```

## 执行模型与变更语义

### 1) 执行前：`tool_call`

`HookToolWrapper.execute()` 在工具执行前发送 `tool_call`。

- 若任意处理程序返回 `{ block: true }`，则停止执行
- 若处理程序抛出异常，包装器以安全失败方式阻止执行
- 返回的 `reason` 将作为抛出的错误文本

### 2) 工具执行

若未被阻止，底层工具正常执行。

### 3) 执行后：`tool_result`

成功后，包装器发送包含以下内容的 `tool_result`：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

若处理程序返回覆盖值：

- `content` 可替换结果内容
- `details` 可替换结果详情

工具失败时，包装器发送带有 `isError: true` 和错误文本内容的 `tool_result`，然后重新抛出原始错误。

### Hook 可以变更的内容

- 通过 `context` 变更单次调用的 LLM 上下文（`messages` 替换链）
- 通过 `tool_result` 路径变更成功工具调用的输出内容/详情
- 通过 `before_agent_start` 变更代理启动前注入的消息
- 通过 `session_before_*` 和 `session.compacting` 变更取消/自定义压缩/树形行为

### Hook 在此实现中无法变更的内容

- 原始工具输入参数（`tool_call` 只支持阻止/允许）
- 工具错误抛出后的执行续行（错误路径会重新抛出）
- 包装器行为中的最终成功/错误状态（返回的 `isError` 已有类型定义，但 `HookToolWrapper` 不会应用它）

## 顺序与冲突行为

### 发现层面的顺序

能力提供者按优先级排序（高优先级在前）。去重依据是能力键，先到先得。

对于 `hooks`，能力键为 `${type}:${tool}:${name}`。来自较低优先级提供者的重复项将被标记并从有效发现列表中排除。

### 加载顺序

`discoverAndLoadHooks` 构建一个按解析后绝对路径去重的扁平 `allPaths` 列表，然后 `loadHooks` 按该顺序迭代。每个已发现目录中文件的顺序取决于 `readdir` 的输出；Hook 加载器不执行额外排序。

### 运行时处理程序顺序

在 `HookRunner` 内部，顺序由注册序列确定：

1. Hooks 数组顺序
2. 每个 Hook/事件的处理程序注册顺序

按事件类型的冲突行为：

- `tool_call`：最后返回的结果获胜，除非某处理程序阻止；首个阻止操作会立即短路
- `tool_result`：最后返回的覆盖值获胜（无短路）
- `context`：链式处理；每个处理程序接收前一处理程序的消息输出
- `before_agent_start`：第一个返回的消息被保留；后续消息被忽略
- `session_before_*`：跟踪最新返回的结果；`cancel: true` 立即短路
- `session.compacting`：最新返回的结果获胜

命令/渲染器冲突：

- `getCommand(name)` 返回跨 Hook 的第一个匹配项（最先加载的获胜）
- `getMessageRenderer(customType)` 返回第一个匹配项
- `getRegisteredCommands()` 返回所有命令（不去重）

## UI 交互（`HookContext.ui`）

`HookUIContext` 包含：

- `select`、`confirm`、`input`、`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`、`getEditorText`
- `theme` getter

`ctx.hasUI` 表示是否可使用交互式 UI。

在无 UI 的情况下运行时，默认无操作上下文行为如下：

- `select/input/editor` 返回 `undefined`
- `confirm` 返回 `false`
- `notify`、`setStatus`、`setEditorText` 为空操作
- `getEditorText` 返回 `""`

### 状态栏行为

通过 `ctx.ui.setStatus(key, text)` 设置的 Hook 状态文本：

- 按键存储
- 按键名称排序
- 经过清理（`\r`、`\n`、`\t` → 空格；连续空格合并）
- 合并后按宽度截断以供显示

## 错误传播与回退

### 加载时

- 无效模块或缺少默认导出 → 记录在 `LoadHooksResult.errors` 中
- 继续加载其他 Hook

### 事件时

`HookRunner.emit(...)` 对大多数事件捕获处理程序错误，并向监听器发送 `HookError`（包含 `hookPath`、`event`、`error`），然后继续执行。

`emitToolCall(...)` 更为严格：处理程序错误不会被吞掉，而是传播给调用方。在 `HookToolWrapper` 中，这将阻止工具调用（安全失败）。

## 实际 API 示例

### 阻止不安全的 Bash 命令

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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

### 在执行后对工具输出进行脱敏处理

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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

### 在每次 LLM 调用时修改模型上下文

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### 注册带有命令安全上下文方法的斜杠命令

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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
- 所有 Hook 类型
- `execCommand` 重新导出

包根文件（`src/index.ts`）将 Hook **类型**作为遗留兼容性接口重新导出。
