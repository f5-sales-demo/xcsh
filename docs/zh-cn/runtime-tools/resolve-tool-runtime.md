---
title: Resolve 工具运行时内部机制
description: 用于文件路径解析、内容获取和基于 URL 的资源访问的 Resolve 工具运行时。
sidebar:
  order: 3
  label: Resolve 工具
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve 工具运行时内部机制

本文档介绍了 coding-agent 中预览/应用工作流的建模方式，以及自定义工具如何通过 `pushPendingAction` 参与其中。

## 范围和关键文件

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` 的作用

`resolve` 是一个隐藏工具，用于最终确定待处理的预览操作。

- `action: "apply"` 对待处理操作执行 `apply(reason)` 并持久化变更。
- `action: "discard"` 如果提供了 `reject(reason)` 则调用它；否则使用默认的 "Discarded" 消息丢弃该操作。

如果不存在待处理操作，`resolve` 将失败并提示：

- `No pending action to resolve. Nothing to apply or discard.`

## 待处理操作是一个栈（后进先出）

待处理操作以推入/弹出栈的形式存储在 `PendingActionStore` 中：

- `push(action)` 将新的待处理操作推入栈顶。
- `peek()` 查看当前栈顶操作。
- `pop()` 移除并返回栈顶操作。
- `hasPending` 指示栈是否非空。

`resolve` 始终首先消费**最顶部**的待处理操作（`pop()`），因此多个产生预览的工具将按注册的逆序进行解析。

## 内置生产者示例（`ast_edit`）

`ast_edit` 首先预览结构性替换。当预览包含替换内容且尚未应用时，它会推入一个待处理操作，其中包含：

- label（人类可读的摘要）
- `sourceToolName`（`ast_edit`）
- `apply(reason: string)` 回调，以 `dryRun: false` 重新运行 AST 编辑

`resolve(action="apply", reason="...")` 将 `reason` 传递给此回调。

## 自定义工具：`pushPendingAction`

自定义工具可以通过 `CustomToolAPI.pushPendingAction(...)` 注册与 resolve 兼容的待处理操作。

`CustomToolPendingAction`：

- `label: string`（必填）
- `apply(reason: string): Promise<AgentToolResult<unknown>>`（必填）— 在应用时调用；`reason` 是传递给 `resolve` 的字符串
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>`（可选）— 在丢弃时调用；如果提供了返回值，则替换默认的 "Discarded" 消息
- `details?: unknown`（可选）
- `sourceToolName?: string`（可选，默认为 `"custom_tool"`）

### 最小使用示例

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## 运行时可用性和失败情况

`pushPendingAction` 由自定义工具加载器使用活动会话的 `PendingActionStore` 进行连接。

如果运行时没有待处理操作存储，`pushPendingAction` 将抛出异常：

- `Pending action store unavailable for custom tools in this runtime.`

## 工具选择行为

当 `PendingActionStore.hasPending` 为 true 时，代理运行时会将工具选择偏向 `resolve`，以便在正常工具流程继续之前显式完成待处理的预览。

## 开发者指南

- 仅对需要支持显式应用/丢弃的破坏性或高影响操作使用待处理操作。
- 保持 `label` 简洁且具体；它会显示在 resolve 渲染器的输出中。
- 确保 `apply(reason)` 具有足够的确定性和幂等性，适用于一次性执行；`reason` 仅供参考，不应改变行为。
- 当丢弃操作需要清理（临时状态、锁、通知）时实现 `reject(reason)`；对于默认消息即可满足的无状态预览，可以省略它。
- 如果您的工具可以暂存多个预览，请记住后进先出语义：最后推入的操作最先被解析。
