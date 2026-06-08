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

このドキュメントでは、coding-agent におけるプレビュー/適用ワークフローのモデリング方法と、カスタムツールが `pushPendingAction` を通じて参加する方法について説明します。

## スコープと主要ファイル

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` の機能

`resolve` は、保留中のプレビューアクションを確定する隠しツールです。

- `action: "apply"` は保留中のアクションに対して `apply(reason)` を実行し、変更を永続化します。
- `action: "discard"` は、`reject(reason)` が提供されていればそれを呼び出し、提供されていなければデフォルトの「Discarded」メッセージでアクションを破棄します。

保留中のアクションが存在しない場合、`resolve` は以下のエラーで失敗します：

- `No pending action to resolve. Nothing to apply or discard.`

## 保留アクションはスタック（LIFO）

保留アクションは `PendingActionStore` にプッシュ/ポップのスタックとして格納されます：

- `push(action)` は新しい保留アクションをスタックの最上部に追加します。
- `peek()` は現在の最上部のアクションを確認します。
- `pop()` は最上部のアクションを取り出して返します。
- `hasPending` はスタックが空でないかどうかを示します。

`resolve` は常に**最上部**の保留アクションを最初に消費します（`pop()`）。そのため、複数のプレビュー生成ツールは登録の逆順で解決されます。

## 組み込みプロデューサーの例（`ast_edit`）

`ast_edit` はまず構造的な置換をプレビューします。プレビューに置換が含まれ、まだ適用されていない場合、以下を含む保留アクションをプッシュします：

- label（人間が読める要約）
- `sourceToolName`（`ast_edit`）
- `apply(reason: string)` コールバック — `dryRun: false` で AST 編集を再実行します

`resolve(action="apply", reason="...")` はこのコールバックに `reason` を渡します。

## カスタムツール：`pushPendingAction`

カスタムツールは `CustomToolAPI.pushPendingAction(...)` を通じて resolve 互換の保留アクションを登録できます。

`CustomToolPendingAction`：

- `label: string`（必須）
- `apply(reason: string): Promise<AgentToolResult<unknown>>`（必須）— 適用時に呼び出されます。`reason` は `resolve` に渡される文字列です
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>`（オプション）— 破棄時に呼び出されます。戻り値が提供された場合、デフォルトの「Discarded」メッセージを置き換えます
- `details?: unknown`（オプション）
- `sourceToolName?: string`（オプション、デフォルトは `"custom_tool"`）

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

## ランタイムの利用可能性と障害

`pushPendingAction` は、アクティブセッションの `PendingActionStore` を使用してカスタムツールローダーによって接続されます。

ランタイムに保留アクションストアがない場合、`pushPendingAction` は以下のエラーをスローします：

- `Pending action store unavailable for custom tools in this runtime.`

## ツール選択の動作

`PendingActionStore.hasPending` が true の場合、エージェントランタイムはツール選択を `resolve` に偏向させ、通常のツールフローが続行される前に保留中のプレビューが明示的に確定されるようにします。

## 開発者向けガイダンス

- 保留アクションは、明示的な適用/破棄をサポートすべき破壊的または影響度の高い操作にのみ使用してください。
- `label` は簡潔かつ具体的にしてください。resolve レンダラーの出力に表示されます。
- `apply(reason)` は決定論的であり、ワンショット実行に十分な冪等性を持つようにしてください。`reason` は情報提供目的であり、動作を変更すべきではありません。
- 破棄時にクリーンアップが必要な場合（一時的な状態、ロック、通知など）は `reject(reason)` を実装してください。デフォルトメッセージで十分なステートレスプレビューの場合は省略してください。
- ツールが複数のプレビューをステージングできる場合、LIFO セマンティクスを意識してください：最後にプッシュされたアクションが最初に解決されます。
