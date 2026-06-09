---
title: Resolve 工具執行時期內部機制
description: Resolve 工具執行時期，用於檔案路徑解析、內容擷取及基於 URL 的資源存取。
sidebar:
  order: 3
  label: Resolve 工具
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve 工具執行時期內部機制

本文件說明預覽/套用工作流程在 coding-agent 中的建模方式，以及自訂工具如何透過 `pushPendingAction` 參與其中。

## 範圍與關鍵檔案

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` 的功能

`resolve` 是一個隱藏工具，用於完成待處理的預覽操作。

- `action: "apply"` 對待處理操作執行 `apply(reason)` 並持久化變更。
- `action: "discard"` 呼叫 `reject(reason)`（若有提供）；否則以預設的「Discarded」訊息捨棄該操作。

若不存在待處理操作，`resolve` 會失敗並顯示：

- `No pending action to resolve. Nothing to apply or discard.`

## 待處理操作是一個堆疊（LIFO）

待處理操作以推入/彈出堆疊的方式儲存在 `PendingActionStore` 中：

- `push(action)` 將新的待處理操作推入堆疊頂端。
- `peek()` 檢視目前堆疊頂端的操作。
- `pop()` 移除並回傳堆疊頂端的操作。
- `hasPending` 表示堆疊是否為非空。

`resolve` 總是先消耗**最頂端**的待處理操作（`pop()`），因此多個產生預覽的工具會依註冊的反序進行解析。

## 內建生產者範例（`ast_edit`）

`ast_edit` 會先預覽結構性替換。當預覽包含替換且尚未套用時，它會推入一個待處理操作，其中包含：

- label（人類可讀的摘要）
- `sourceToolName`（`ast_edit`）
- `apply(reason: string)` 回呼函式，以 `dryRun: false` 重新執行 AST 編輯

`resolve(action="apply", reason="...")` 會將 `reason` 傳入此回呼函式。

## 自訂工具：`pushPendingAction`

自訂工具可以透過 `CustomToolAPI.pushPendingAction(...)` 註冊與 resolve 相容的待處理操作。

`CustomToolPendingAction`：

- `label: string`（必要）
- `apply(reason: string): Promise<AgentToolResult<unknown>>`（必要）— 在套用時呼叫；`reason` 是傳遞給 `resolve` 的字串
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>`（選用）— 在捨棄時呼叫；若有提供回傳值，則取代預設的「Discarded」訊息
- `details?: unknown`（選用）
- `sourceToolName?: string`（選用，預設為 `"custom_tool"`）

### 最小使用範例

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

## 執行時期可用性與失敗情況

`pushPendingAction` 由自訂工具載入器使用活躍工作階段的 `PendingActionStore` 進行連接。

若執行時期沒有待處理操作儲存區，`pushPendingAction` 會拋出例外：

- `Pending action store unavailable for custom tools in this runtime.`

## 工具選擇行為

當 `PendingActionStore.hasPending` 為 true 時，代理程式執行時期會偏向選擇 `resolve` 工具，以確保待處理預覽在正常工具流程繼續之前被明確地完成。

## 開發者指南

- 僅對具有破壞性或高影響力的操作使用待處理操作，這些操作應支援明確的套用/捨棄機制。
- 保持 `label` 簡潔且具體；它會顯示在 resolve 渲染器的輸出中。
- 確保 `apply(reason)` 具有足夠的確定性和冪等性，可供一次性執行；`reason` 僅供參考，不應改變行為。
- 當捨棄操作需要清理工作（暫存狀態、鎖定、通知）時，請實作 `reject(reason)`；對於無狀態的預覽，預設訊息已足夠，可省略此實作。
- 若您的工具可以暫存多個預覽，請記住 LIFO 語意：最後推入的操作會最先被解析。
