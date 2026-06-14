---
title: Hooks
description: 编码代理生命周期中用于事件前后自动化的 Hook 系统。
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

本文档描述 `src/extensibility/hooks/*` 中的**当前 Hook 子系统代码**。

## 运行时的当前状态

Hook 包（`src/extensibility/hooks/`）仍作为 API 接口导出并可使用，但默认 CLI 运行时现在初始化的是**扩展运行器**路径。在当前启动流程中：

- `--hook` 被视为 `--extension` 的别名（CLI 路径合并至 `additionalExtensionPaths`）
- 工具由 `ExtensionToolWrapper` 包装，而非 `HookToolWrapper`
- 上下文转换和生命周期事件发射通过 `ExtensionRunner` 处理

因此，本文档记录的是 Hook 子系统的实现本身（类型/加载器/运行器/包装器），包括历史遗留行为和约束。

## 关键文件

- `src/extensibility/hooks/types.ts` — Hook 上下文、事件类型和结果契约
- `src/extensibility/hooks/loader.ts` — 模块加载与 Hook 发现桥接
- `src/extensibility/hooks/runner.ts` — 事件分发、命令查找、错误信号
- `src/extensibility/hooks/tool-wrapper.ts` — 工具执行前后的拦截包装器
- `src/extensibility/hooks/index.ts` — 导出/重导出

## Hook 模块的定义

一个 Hook 模块必须默认导出一个工厂函数：

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

- 通过 `pi.on(...)` 注册事件处理器
- 通过 `pi.sendMessage(...)` 发送持久性自定义消息
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
- `~` 路径：展开后使用
- 相对路径：相对于 `cwd` 解析

### 重要的历史遗留不匹配问题

`hookCapability` 的发现提供者仍然以 Shell 风格的前/后置 Hook 文件为模型（例如 `.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）。

此处的 Hook 加载器使用动态模块导入，并要求具有默认导出的 JS/TS Hook 工厂函数。若发现的 Hook 路径无法作为模块导入，则加载失败，错误信息记录于 `LoadHooksResult.errors`。

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

### 工具事件（前/后置模型）

- `tool_call`（执行前）→ 可返回 `{ block?: boolean; reason?: string }`
- `tool_result`（执行后）→ 可返回 `{ content?; details?; isError? }`

这是 Hook 子系统的核心前/后置拦截模型。

```text
Hook 工具拦截流程

tool_call 处理器
   │
   ├─ 任意处理器返回 { block: true }？── 是 ──> 抛出异常（工具被拦截）
   │
   └─ 否
      │
      ▼
   执行底层工具
      │
      ├─ 成功 ──> tool_result 处理器可覆盖 { content, details }
      │
      └─ 错误   ──> 发射 tool_result(isError=true) 后重新抛出原始错误
```

## 执行模型与变更语义

### 1) 执行前：`tool_call`

`HookToolWrapper.execute()` 在工具执行前发射 `tool_call`。

- 若任意处理器返回 `{ block: true }`，则停止执行
- 若处理器抛出异常，包装器以安全失败方式阻止执行
- 返回的 `reason` 将作为抛出的错误文本

### 2) 工具执行

若未被拦截，底层工具正常执行。

### 3) 执行后：`tool_result`

执行成功后，包装器发射 `tool_result`，携带：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

若处理器返回覆盖值：

- `content` 可替换结果内容
- `details` 可替换结果详情

工具失败时，包装器发射携带 `isError: true` 和错误文本内容的 `tool_result`，随后重新抛出原始错误。

### Hook 可变更的内容

- 单次调用的 LLM 上下文（通过 `context` 进行 `messages` 替换链）
- 工具调用成功时的输出内容/详情（`tool_result` 路径）
- 代理启动前注入的消息（通过 `before_agent_start`）
- 取消/自定义压缩/树形行为（通过 `session_before_*` 和 `session.compacting`）

### Hook 在此实现中无法变更的内容

- 原始工具输入参数（`tool_call` 上只能拦截/放行）
- 工具错误抛出后的执行续行（错误路径会重新抛出）
- 包装器行为中的最终成功/错误状态（返回的 `isError` 有类型定义，但 `HookToolWrapper` 不予应用）

## 排序与冲突行为

### 发现层面的排序

能力提供者按优先级排序（优先级高者在前）。去重依据为能力键，先出现者优先。

对于 `hooks`，能力键为 `${type}:${tool}:${name}`。来自低优先级提供者的重复项将被标记并从有效发现列表中排除。

### 加载顺序

`discoverAndLoadHooks` 构建一个扁平的 `allPaths` 列表，按解析后的绝对路径去重，然后 `loadHooks` 按此顺序迭代。每个发现目录中的文件顺序取决于 `readdir` 的输出；Hook 加载器不执行额外的排序。

### 运行时处理器顺序

在 `HookRunner` 内部，顺序由注册序列确定：

1. Hook 数组顺序
2. 每个 Hook/事件的处理器注册顺序

各事件类型的冲突行为：

- `tool_call`：最后返回的结果生效，除非某处理器进行拦截；第一个拦截立即短路
- `tool_result`：最后返回的覆盖值生效（不短路）
- `context`：链式处理；每个处理器接收上一个处理器的消息输出
- `before_agent_start`：第一个返回的消息被保留；后续消息被忽略
- `session_before_*`：追踪最新返回的结果；`cancel: true` 立即短路
- `session.compacting`：最新返回的结果生效

命令/渲染器冲突：

- `getCommand(name)` 返回跨 Hook 的第一个匹配（先加载者优先）
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

`ctx.hasUI` 指示是否存在可交互的 UI。

在无 UI 的环境中运行时，默认空操作上下文的行为为：

- `select/input/editor` 返回 `undefined`
- `confirm` 返回 `false`
- `notify`、`setStatus`、`setEditorText` 为空操作
- `getEditorText` 返回 `""`

### 状态栏行为

通过 `ctx.ui.setStatus(key, text)` 设置的 Hook 状态文本将：

- 按键存储
- 按键名排序
- 经过净化处理（`\r`、`\n`、`\t` 替换为空格；重复空格合并）
- 合并后截断至显示宽度

## 错误传播与回退

### 加载时

- 无效模块或缺少默认导出 → 捕获于 `LoadHooksResult.errors`
- 其他 Hook 继续加载

### 事件时

`HookRunner.emit(...)` 捕获大多数事件的处理器错误，并向监听器发射 `HookError`（包含 `hookPath`、`event`、`error`），然后继续执行。

`emitToolCall(...)` 更为严格：其中的处理器错误不会被吞噬，而是向调用方传播。在 `HookToolWrapper` 中，这将阻止工具调用（安全失败）。

## 实际 API 示例

### 拦截不安全的 Bash 命令

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

### 在执行后对工具输出进行脱敏处理

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

### 在每次 LLM 调用时修改模型上下文

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### 注册斜杠命令并使用命令安全的上下文方法

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
- 所有 Hook 类型
- `execCommand` 重导出

包根目录（`src/index.ts`）将 Hook **类型**作为历史兼容接口重导出。
