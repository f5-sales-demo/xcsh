---
title: 自定义工具
description: 自定义工具注册、Schema 定义及用于扩展 Agent 的执行管道。
sidebar:
  order: 4
  label: 自定义工具
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# 自定义工具

自定义工具是模型可调用的函数，它们接入与内置工具相同的工具执行管道。

自定义工具是一个 TypeScript/JavaScript 模块，导出一个工厂函数。该工厂函数接收一个宿主 API（`CustomToolAPI`）并返回一个或多个工具。

## 它是什么（以及不是什么）

- **自定义工具**：在一次对话轮次中可被模型调用（`execute` + TypeBox schema）。
- **扩展**：可注册工具并拦截/修改事件的生命周期/事件框架。
- **Hook**：外部的前置/后置命令脚本。
- **Skill**：静态的指导/上下文包，不是可执行的工具代码。

如果您需要模型直接调用代码，请使用自定义工具。

## 当前代码中的集成路径

目前有两种活跃的集成方式：

1. **SDK 提供的自定义工具**（`options.customTools`）
   - 通过 `CustomToolAdapter` 或扩展包装器封装为 Agent 工具。
   - 在 SDK 引导阶段始终包含在初始活跃工具集中。

2. **通过加载器 API 从文件系统发现的模块**（`discoverAndLoadCustomTools` / `loadCustomTools`）
   - 作为库 API 暴露在 `src/extensibility/custom-tools/loader.ts` 中。
   - 宿主代码可以调用这些 API 从配置/提供者/插件路径发现并加载工具模块。

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

## 发现位置（加载器 API）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` 合并以下来源：

1. 能力提供者（`toolCapability`），包括：
   - 原生 OMP 配置（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude 配置（`~/.claude/tools`、`.claude/tools`）
   - Codex 配置（`~/.codex/tools`、`.codex/tools`）
   - Claude 市场插件缓存提供者
2. 已安装的插件清单（`~/.xcsh/plugins/node_modules/*`，通过插件加载器）
3. 传递给加载器的显式配置路径

### 重要行为

- 重复的解析路径会被去重。
- 与内置工具或已加载的自定义工具存在名称冲突时，将被拒绝。
- 某些提供者会发现 `.md` 和 `.json` 文件作为工具元数据，但可执行模块加载器会拒绝将它们作为可运行的工具。
- 相对配置路径从 `cwd` 解析；`~` 会被展开。

## 模块契约

自定义工具模块必须导出一个函数（推荐使用默认导出）：

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

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

工厂函数返回类型：

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## 传递给工厂函数的 API 接口（`CustomToolAPI`）

来自 `types.ts` 和 `loader.ts`：

- `cwd`：宿主工作目录
- `exec(command, args, options?)`：进程执行辅助函数
- `ui`：UI 上下文（在无头模式下可以是空操作）
- `hasUI`：在非交互式流程中为 `false`
- `logger`：共享文件日志器
- `typebox`：注入的 `@sinclair/typebox`
- `pi`：注入的 `@f5-sales-demo/xcsh` 导出
- `pushPendingAction(action)`：为隐藏的 `resolve` 工具注册预览操作（`docs/resolve-tool-runtime.md`）

加载器以空操作 UI 上下文启动，需要宿主代码在真正的 UI 就绪时调用 `setUIContext(...)`。

## 执行契约与类型

`CustomTool.execute` 签名：

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` 通过 `Static<TParams>` 从您的 TypeBox schema 静态类型化。
- 运行时参数验证在 Agent 循环中执行之前进行。
- `onUpdate` 发送部分结果用于 UI 流式传输。
- `ctx` 包含会话/模型状态和 `abort()` 辅助方法。
- `signal` 承载取消信号。

`CustomToolAdapter` 将其桥接到 Agent 工具接口，并以正确的参数顺序转发调用。

## 工具如何暴露给模型

- 工具被封装为 `AgentTool` 实例（`CustomToolAdapter` 或扩展包装器）。
- 它们按名称插入到会话工具注册表中。
- 在 SDK 引导阶段，自定义工具和扩展注册的工具被强制包含在初始活跃集中。
- CLI `--tools` 当前仅验证内置工具名称；自定义工具的包含通过发现/注册路径和 SDK 选项处理。

## 渲染钩子

可选的渲染钩子：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI 中的运行时行为：

- 如果存在钩子，工具输出将在 `Box` 容器内渲染。
- `renderResult` 接收 `{ expanded, isPartial, spinnerFrame? }`。
- 渲染器错误会被捕获并记录；UI 回退到默认文本渲染。

## 会话/状态处理

可选的 `onSession(event, ctx)` 接收会话生命周期事件，包括：

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

当分支/会话上下文变更时，使用 `ctx.sessionManager` 从历史记录重建状态。

## 失败与取消语义

### 同步/异步失败

- 在 `execute` 中抛出异常（或 Promise 被拒绝）将被视为工具失败。
- Agent 运行时将失败转换为带有 `isError: true` 和错误文本内容的工具结果消息。
- 使用扩展包装器时，`tool_result` 处理程序可以进一步重写内容/详情，甚至覆盖错误状态。

### 取消

- Agent 中止通过 `AbortSignal` 传播到 `execute`。
- 将 `signal` 转发给子进程工作（`pi.exec(..., { signal })`）以实现协作式取消。
- `ctx.abort()` 允许工具请求中止当前 Agent 操作。

### onSession 错误

- `onSession` 错误会被捕获并记录为警告；它们不会导致会话崩溃。

## 需要考虑的实际约束

- 工具名称在活跃注册表中必须全局唯一。
- 优先在 `details` 中使用确定性的、符合 schema 结构的输出，以便渲染器/状态重建。
- 使用 `pi.hasUI` 保护 UI 的使用。
- 将工具目录中的 `.md`/`.json` 文件视为元数据，而非可执行模块。
