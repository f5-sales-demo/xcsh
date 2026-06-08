---
title: Resolve ツールのランタイム内部構造
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Resolve ツール
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve ツールのランタイム内部構造

このドキュメントでは、coding-agent においてプレビュー/適用ワークフローがどのようにモデル化されているか、また `pushPendingAction` を介してカスタムツールがどのように参加できるかを説明します。

## スコープと主要ファイル

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` の役割

`resolve` は、保留中のプレビューアクションを確定する非公開ツールです。

- `action: "apply"` は保留中のアクションに対して `apply(reason)` を実行し、変更を永続化します。
- `action: "discard"` は提供されている場合 `reject(reason)` を呼び出し、提供されていない場合はデフォルトの "Discarded" メッセージでアクションを破棄します。

保留中のアクションが存在しない場合、`resolve` は以下のエラーで失敗します：

- `No pending action to resolve. Nothing to apply or discard.`

## 保留中のアクションはスタック（LIFO）

保留中のアクションは `PendingActionStore` にプッシュ/ポップスタックとして格納されます：

- `push(action)` は新しい保留中のアクションをスタックの最上部に追加します。
- `peek()` は現在の最上部のアクションを参照します。
- `pop()` は最上部のアクションを削除して返します。
- `hasPending` はスタックが空でないかどうかを示します。

`resolve` は常に**最上部**の保留中のアクションを最初に消費する（`pop()`）ため、複数のプレビューを生成するツールは登録の逆順で解決されます。

## 組み込みプロデューサーの例（`ast_edit`）

`ast_edit` はまず構造的な置換をプレビューします。プレビューに置換があり、まだ適用されていない場合、以下を含む保留中のアクションをプッシュします：

- label（人間が読める要約）
- `sourceToolName`（`ast_edit`）
- `apply(reason: string)` コールバック：`dryRun: false` で AST 編集を再実行します

`resolve(action="apply", reason="...")` はこのコールバックに `reason` を渡します。

## カスタムツール：`pushPendingAction`

カスタムツールは `CustomToolAPI.pushPendingAction(...)` を通じて resolve 互換の保留中のアクションを登録できます。

`CustomToolPendingAction`:

- `label: string`（必須）
- `apply(reason: string): Promise<AgentToolResult<unknown>>`（必須）— 適用時に呼び出されます。`reason` は `resolve` に渡された文字列です
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>`（任意）— 破棄時に呼び出されます。戻り値が提供された場合、デフォルトの "Discarded" メッセージを置き換えます
- `details?: unknown`（任意）
- `sourceToolName?: string`（任意、デフォルトは `"custom_tool"`）

### 最小限の使用例

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

## ランタイムの可用性と障害

`pushPendingAction` はカスタムツールローダーによって、アクティブセッションの `PendingActionStore` を使用して接続されます。

ランタイムに保留中のアクションストアがない場合、`pushPendingAction` は以下のエラーをスローします：

- `Pending action store unavailable for custom tools in this runtime.`

## ツール選択の動作

`PendingActionStore.hasPending` が true の場合、エージェントランタイムはツール選択を `resolve` に偏向させ、通常のツールフローが継続する前に保留中のプレビューが明示的に確定されるようにします。

## 開発者向けガイダンス

- 保留中のアクションは、明示的な適用/破棄をサポートすべき破壊的または影響の大きい操作にのみ使用してください。
- `label` は簡潔かつ具体的にしてください。これは resolve レンダラーの出力に表示されます。
- `apply(reason)` は決定論的であり、ワンショット実行に十分な冪等性を持つようにしてください。`reason` は情報提供目的であり、動作を変更すべきではありません。
- 破棄時にクリーンアップが必要な場合（一時的な状態、ロック、通知など）は `reject(reason)` を実装してください。デフォルトメッセージで十分なステートレスなプレビューの場合は省略してください。
- ツールが複数のプレビューをステージングできる場合、LIFO セマンティクスを覚えておいてください：最後にプッシュされたアクションが最初に解決されます。
