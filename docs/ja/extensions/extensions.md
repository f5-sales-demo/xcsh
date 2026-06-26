---
title: 拡張機能
description: 拡張機能ランタイムの概要：タイプ、ランナーライフサイクル、登録、および検出について説明します。
sidebar:
  order: 1
  label: 概要
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# 拡張機能

`packages/coding-agent` におけるランタイム拡張機能の作成に関する主要ガイドです。

このドキュメントでは、以下に含まれる現在の拡張機能ランタイムについて説明します：

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

検出パスおよびファイルシステムの読み込みルールについては、`docs/extension-loading.md` を参照してください。

## 拡張機能とは

拡張機能とは、デフォルトファクトリーをエクスポートする TS/JS モジュールです：

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // handlers/tools/commands/renderers を登録する
}
```

拡張機能は、以下のすべてを1つのモジュールに組み合わせることができます：

- イベントハンドラー（`pi.on(...)`）
- LLM 呼び出し可能ツール（`pi.registerTool(...)`）
- スラッシュコマンド（`pi.registerCommand(...)`）
- キーボードショートカットおよびフラグ
- カスタムメッセージレンダリング
- セッション/メッセージ注入 API（`sendMessage`、`sendUserMessage`、`appendEntry`）

## ランタイムモデル

1. 拡張機能がインポートされ、ファクトリー関数が実行されます。
2. このロードフェーズ中、登録メソッドは有効ですが、ランタイムアクションメソッドはまだ初期化されていません。
3. `ExtensionRunner.initialize(...)` が、アクティブモードのライブアクション/コンテキストを接続します。
4. セッション/エージェント/ツールのライフサイクルイベントがハンドラーに送出されます。
5. すべてのツール実行は、拡張機能インターセプション（`tool_call` / `tool_result`）でラップされます。

```text
拡張機能ライフサイクル（簡略版）

読み込みパス
   │
   ▼
モジュールのインポート + ファクトリー実行（登録のみ）
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ セッション/エージェントイベントをハンドラーに送出
   ├─ ツール実行をラップ（tool_call/tool_result）
   └─ ランタイムアクションを公開（sendMessage, setActiveTools, ...）
```

`loader.ts` の重要な制約：

- 拡張機能のロード中に `pi.sendMessage()` などのアクションメソッドを呼び出すと、`ExtensionRuntimeNotInitializedError` がスローされます
- まず登録を行い、ランタイムの動作はイベント/コマンド/ツールから実行してください

## クイックスタート

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

## 拡張機能 API サーフェス

## 1) 登録とアクション（`ExtensionAPI`）

コアメソッド：

- `on(event, handler)`
- `registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`
- `registerMessageRenderer`
- `sendMessage`、`sendUserMessage`、`appendEntry`
- `getActiveTools`、`getAllTools`、`setActiveTools`
- `getSessionName`、`setSessionName`
- `setModel`、`getThinkingLevel`、`setThinkingLevel`
- `registerProvider`
- `events`（共有イベントバス）

インタラクティブモードでは、`input` ハンドラーは組み込みの最初のメッセージ自動タイトルチェックよりも前に実行されます。`input` から `await pi.setSessionName(...)` を呼び出す拡張機能は、永続化されたセッション名を設定し、そのセッションに対してデフォルトの自動生成タイトルが実行されないようにすることができます。

また、以下も公開されています：

- `pi.logger`
- `pi.typebox`
- `pi.pi`（パッケージエクスポート）

### メッセージ配信セマンティクス

`pi.sendMessage(message, options)` は以下をサポートします：

- `deliverAs: "steer"`（デフォルト）— 現在の実行を中断する
- `deliverAs: "followUp"` — 現在の実行後にキューに追加される
- `deliverAs: "nextTurn"` — 次のユーザープロンプト時に保存して注入される
- `triggerTurn: true` — アイドル時にターンを開始する（`nextTurn` はこれを無視する）

`pi.sendUserMessage(content, { deliverAs })` は常にプロンプトフローを経由します。ストリーミング中は steer/follow-up としてキューに追加されます。

## 2) ハンドラーコンテキスト（`ExtensionContext`）

ハンドラーおよびツールの `execute` は、以下を含む `ctx` を受け取ります：

- `ui`
- `hasUI`
- `cwd`
- `sessionManager`（読み取り専用）
- `modelRegistry`、`model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`、`hasPendingMessages()`、`abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) コマンドコンテキスト（`ExtensionCommandContext`）

コマンドハンドラーはさらに以下を取得します：

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

セッション制御フローにはコマンドコンテキストを使用してください。これらのメソッドは意図的に一般的なイベントハンドラーから分離されています。

## イベントサーフェス（現在の名前と動作）

標準的なイベントユニオンとペイロードタイプは `types.ts` に記載されています。

### セッションライフサイクル

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

キャンセル可能な事前イベント：

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### プロンプトおよびターンライフサイクル

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### ツールライフサイクル

- `tool_call`（実行前、ブロック可能）
- `tool_result`（実行後、content/details/isError のパッチ適用可能）
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`（オブザーバビリティ）

`tool_result` はミドルウェアスタイルです：ハンドラーは拡張機能の順序で実行され、それぞれが以前の変更を参照します。

### 信頼性/ランタイムシグナル

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### ユーザーコマンドインターセプション

- `user_bash`（`{ result }` でオーバーライド）
- `user_python`（`{ result }` でオーバーライド）

### `resources_discover`

`resources_discover` は拡張機能タイプおよび `ExtensionRunner` に存在します。
現在のランタイム注記：`ExtensionRunner.emitResourcesDiscover(...)` は実装されていますが、現在のコードベースにはそれを呼び出す `AgentSession` のコールサイトが存在しません。

## ツール作成の詳細

`registerTool` は `types.ts` の `ToolDefinition` を使用します。

現在の `execute` シグネチャ：

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

テンプレート：

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
  // オプションの TUI レンダリング
 },
 renderResult(result, options, theme, args) {
  // オプションの TUI レンダリング
 },
});
```

`tool_call`/`tool_result` は、`sdk.ts` でレジストリがラップされると、組み込みおよび拡張機能/カスタムツールを含むすべてのツールをインターセプトします。

## UI 統合ポイント

`ctx.ui` は `ExtensionUIContext` インターフェースを実装します。サポート状況はモードによって異なります。

### インタラクティブモード（`extension-ui-controller.ts`）

サポート対象：

- ダイアログ：`select`、`confirm`、`input`、`editor`
- 通知/ステータス/エディターテキスト/ターミナル入力/カスタムオーバーレイ
- 名前によるテーマ一覧/読み込み（`setTheme` は文字列名をサポート）
- ツール展開トグル

このコントローラーで現在 no-op となっているメソッド：

- `setFooter`
- `setHeader`
- `setEditorComponent`

また、`setWidget` は現在 `setHookWidget(...)` 経由でステータスライン テキストにルーティングされます。

### RPC モード（`rpc-mode.ts`）

`ctx.ui` は RPC `extension_ui_request` イベントでバックアップされます：

- ダイアログメソッド（`select`、`confirm`、`input`、`editor`）はクライアントレスポンスへのラウンドトリップを実行
- Fire-and-forget メソッドはリクエストを送出（`notify`、`setStatus`、文字列配列の `setWidget`、`setTitle`、`setEditorText`）

RPC 実装でサポートされていない/no-op：

- `onTerminalInput`
- `custom`
- `setFooter`、`setHeader`、`setEditorComponent`
- `setWorkingMessage`
- テーマの切り替え/読み込み（`setTheme` は失敗を返す）
- ツール展開コントロールは無効

### Print/ヘッドレス/サブエージェントパス

ランナーの初期化に UI コンテキストが提供されない場合、`ctx.hasUI` は `false` となり、メソッドは no-op/デフォルト返却となります。

### バックグラウンドインタラクティブモード

バックグラウンドモードは非インタラクティブな UI コンテキストオブジェクトをインストールします。現在の実装では、インタラクティブなダイアログがデフォルト/no-op の動作を返す一方、`ctx.hasUI` が `true` のままになる場合があります。

## セッションと状態のパターン

拡張機能の永続的な状態のために：

1. `pi.appendEntry(customType, data)` を使用して永続化します。
2. `session_start`、`session_branch`、`session_tree` で `ctx.sessionManager.getBranch()` から状態を再構築します。
3. ツール結果の `details` は、状態がツール結果履歴から参照/再構築可能である必要がある場合に構造化して保持します。

再構築パターンの例：

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // latest から復元する
});
```

## レンダリング拡張ポイント

## カスタムメッセージレンダラー

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // pi-tui Component を返す
});
```

カスタムメッセージが表示される際のインタラクティブレンダリングで使用されます。

## ツールコール/結果レンダラー

TUI でのカスタムツール可視化のために、`registerTool` 定義に `renderCall` / `renderResult` を指定します。

## 制約と落とし穴

- ランタイムアクションは拡張機能のロード中は使用できません。
- `tool_call` のエラーは実行をブロックします（フェールクローズド）。
- 組み込みとのコマンド名の競合は、診断とともにスキップされます。
- 予約済みショートカットは無視されます（`ctrl+c`、`ctrl+d`、`ctrl+z`、`ctrl+k`、`ctrl+p`、`ctrl+l`、`ctrl+o`、`ctrl+t`、`ctrl+g`、`shift+tab`、`shift+ctrl+p`、`alt+enter`、`escape`、`enter`）。
- `ctx.reload()` は、現在のコマンドハンドラーフレームの終端として扱ってください。

## 拡張機能 vs フック vs カスタムツール

適切なサーフェスを使用してください：

- **拡張機能**（`src/extensibility/extensions/*`）：統合システム（イベント + ツール + コマンド + レンダラー + プロバイダー登録）。
- **フック**（`src/extensibility/hooks/*`）：別個のレガシーイベント API。
- **カスタムツール**（`src/extensibility/custom-tools/*`）：ツール中心のモジュール。拡張機能と共に読み込まれる場合、適合されて拡張機能インターセプションラッパーを通過します。

ポリシー、ツール、コマンド UX、およびレンダリングを一括して管理する1つのパッケージが必要な場合は、拡張機能を使用してください。
