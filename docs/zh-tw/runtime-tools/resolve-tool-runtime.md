---
title: Resolve 工具執行期內部機制
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Resolve 工具
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve 工具執行期內部機制

本文件說明 coding-agent 中如何建構預覽/套用工作流程模型，以及自訂工具如何透過 `pushPendingAction` 參與其中。

## 範圍與關鍵檔案

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` 的功能

`resolve` 是一個隱藏工具，用於完成待處理的預覽動作。

- `action: "apply"` 會對待處理動作執行 `apply(reason)` 並持久化變更。
- `action: "discard"` 會呼叫 `reject(reason)`（若有提供）；否則以預設的「Discarded」訊息丟棄該動作。

若不存在待處理動作，`resolve` 將會失敗並顯示：

- `No pending action to resolve. Nothing to apply or discard.`

## 待處理動作是堆疊結構（後進先出）

待處理動作儲存於 `PendingActionStore` 中，以推入/彈出堆疊的方式管理：

- `push(action)` 將新的待處理動作推入堆疊頂部。
- `peek()` 檢視當前堆疊頂部的動作。
- `pop()` 移除並回傳堆疊頂部的動作。
- `hasPending` 指示堆疊是否為非空。

`resolve` 總是先消費**最頂部**的待處理動作（`pop()`），因此多個產生預覽的工具會按照註冊的反向順序進行解析。

## 內建生產者範例（`ast_edit`）

`ast_edit` 首先預覽結構性替換。當預覽包含替換內容且尚未套用時，它會推入一個待處理動作，其中包含：

- label（人類可讀的摘要）
- `sourceToolName`（`ast_edit`）
- `apply(reason: string)` 回呼函式，以 `dryRun: false` 重新執行 AST 編輯

`resolve(action="apply", reason="...")` 會將 `reason` 傳入此回呼函式。

## 自訂工具：`pushPendingAction`

自訂工具可以透過 `CustomToolAPI.pushPendingAction(...)` 註冊與 resolve 相容的待處理動作。

`CustomToolPendingAction`：

- `label: string`（必填）
- `apply(reason: string): Promise<AgentToolResult<unknown>>`（必填）— 套用時呼叫；`reason` 是傳給 `resolve` 的字串
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>`（選填）— 丟棄時呼叫；若有提供回傳值則取代預設的「Discarded」訊息
- `details?: unknown`（選填）
- `sourceToolName?: string`（選填，預設為 `"custom_tool"`）

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

## 執行期可用性與失敗情況

`pushPendingAction` 由自訂工具載入器使用作用中會話的 `PendingActionStore` 進行連接。

若執行期沒有待處理動作存儲，`pushPendingAction` 會拋出例外：

- `Pending action store unavailable for custom tools in this runtime.`

## 工具選擇行為

當 `PendingActionStore.hasPending` 為 true 時，代理執行期會偏向選擇 `resolve` 工具，以確保待處理的預覽在正常工具流程繼續之前被明確地完成。

## 開發者指引

- 僅在具有破壞性或高影響性的操作中使用待處理動作，這些操作應支援明確的套用/丟棄機制。
- 保持 `label` 簡潔且具體；它會顯示在 resolve 渲染器的輸出中。
- 確保 `apply(reason)` 具有足夠的確定性和冪等性，以供一次性執行；`reason` 僅為參考資訊，不應改變行為。
- 當丟棄操作需要清理（暫存狀態、鎖定、通知）時，請實作 `reject(reason)`；對於預設訊息已足夠的無狀態預覽，可省略此方法。
- 如果您的工具可以暫存多個預覽，請記住後進先出的語意：最後推入的動作會最先被解析。
