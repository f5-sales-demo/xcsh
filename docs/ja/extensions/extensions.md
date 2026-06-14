---
title: 拡張機能
description: 拡張機能ランタイムの概要（種類、ランナーのライフサイクル、登録、ディスカバリーを含む）。
sidebar:
  order: 1
  label: 概要
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# 拡張機能

`packages/coding-agent` におけるランタイム拡張機能のオーサリングに関する主要ガイドです。

このドキュメントでは、以下のファイルに含まれる現在の拡張機能ランタイムについて説明します：

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

ディスカバリーパスおよびファイルシステムの読み込みルールについては、`docs/extension-loading.md` を参照してください。

## 拡張機能とは

拡張機能とは、デフォルトのファクトリーをエクスポートする TS/JS モジュールです：

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // ハンドラー/ツール/コマンド/レンダラーを登録する
}
```

拡張機能は、1つのモジュールで以下のすべてを組み合わせることができます：

- イベントハンドラー（`pi.on(...)`）
- LLM 呼び出し可能なツール（`pi.registerTool(...)`）
- スラッシュコマンド（`pi.registerCommand(...)`）
- キーボードショートカットとフラグ
- カスタムメッセージレンダリング
- セッション/メッセージインジェクション API（`sendMessage`、`sendUserMessage`、`appendEntry`）

## ランタイムモデル

1. 拡張機能がインポートされ、ファクトリー関数が実行されます。
2. このロードフェーズ中、登録メソッドは有効ですが、ランタイムアクションメソッドはまだ初期化されていません。
3. `ExtensionRunner.initialize(...)` がアクティブモードのライブアクション/コンテキストを接続します。
4. セッション/エージェント/ツールのライフサイクルイベントがハンドラーに送出されます。
5. すべてのツール実行は拡張機能のインターセプション（`tool_call` / `tool_result`）でラップされます。

```text
拡張機能のライフサイクル（簡略版）

ロードパス
   │
   ▼
モジュールのインポート + ファクトリーの実行（登録のみ）
   │
   ▼
ExtensionRunner.initialize(モード/セッション/ツールレジストリ)
   │
   ├─ セッション/エージェントイベントをハンドラーに送出
   ├─ ツール実行をラップ (tool_call/tool_result)
   └─ ランタイムアクションを公開 (sendMessage, setActiveTools, ...)
```

`loader.ts` からの重要な制約：

- 拡張機能のロード中に `pi.sendMessage()` のようなアクションメソッドを呼び出すと、`ExtensionRuntimeNotInitializedError` がスローされます。
- まず登録を行い、イベント/コマンド/ツールからランタイムの動作を実行してください。

## クイックスタート

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
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

主要なメソッド：

- `on(event, handler)`
- `registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`
- `registerMessageRenderer`
- `sendMessage`、`sendUserMessage`、`appendEntry`
- `getActiveTools`、`getAllTools`、`setActiveTools`
- `getSessionName`、`setSessionName`
- `setModel`、`getThinkingLevel`、`setThinkingLevel`
- `registerProvider`
- `events`（共有イベントバス）

インタラクティブモードでは、`input` ハンドラーは組み込みの最初のメッセージ自動タイトル確認の前に実行されます。`input` から `await pi.setSessionName(...)` を呼び出す拡張機能は、永続化されたセッション名を設定し、そのセッションでデフォルトの自動生成タイトルが実行されるのを防ぐことができます。

また、以下も公開されています：

- `pi.logger`
- `pi.typebox`
- `pi.pi`（パッケージエクスポート）

### メッセージ配信のセマンティクス

`pi.sendMessage(message, options)` は以下をサポートします：

- `deliverAs: "steer"`（デフォルト）— 現在の実行を中断する
- `deliverAs: "followUp"` — 現在の実行後にキューイングされる
- `deliverAs: "nextTurn"` — 保存され、次のユーザープロンプト時に注入される
- `triggerTurn: true` — アイドル時にターンを開始する（`nextTurn` はこれを無視する）

`pi.sendUserMessage(content, { deliverAs })` は常にプロンプトフローを通じて処理されます。ストリーミング中はステアー/フォローアップとしてキューイングされます。

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

セッション制御フローにはコマンドコンテキストを使用してください。これらのメソッドは汎用イベントハンドラーから意図的に分離されています。

## イベントサーフェス（現在の名前と動作）

標準的なイベントユニオンとペイロード型は `types.ts` にあります。

### セッションライフサイクル

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

キャンセル可能なプリイベント：

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
- `tool_result`（実行後、コンテンツ/詳細/isError のパッチ適用可能）
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`（オブザーバビリティ）

`tool_result` はミドルウェアスタイルです。ハンドラーは拡張機能の順序で実行され、それぞれが以前の変更を参照できます。

### 信頼性/ランタイムシグナル

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### ユーザーコマンドのインターセプション

- `user_bash`（`{ result }` でオーバーライド）
- `user_python`（`{ result }` でオーバーライド）

### `resources_discover`

`resources_discover` は拡張機能の型および `ExtensionRunner` に存在します。
現在のランタイムに関する注記：`ExtensionRunner.emitResourcesDiscover(...)` は実装されていますが、現在のコードベースにはそれを呼び出す `AgentSession` のコールサイトは存在しません。

## ツールのオーサリング詳細

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
  // 理由: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // オプションの TUI レンダー
 },
 renderResult(result, options, theme, args) {
  // オプションの TUI レンダー
 },
});
```

`tool_call`/`tool_result` は、`sdk.ts` でレジストリがラップされると、組み込みツールや拡張機能/カスタムツールを含むすべてのツールをインターセプトします。

## UI 統合ポイント

`ctx.ui` は `ExtensionUIContext` インターフェースを実装します。サポート内容はモードによって異なります。

### インタラクティブモード（`extension-ui-controller.ts`）

サポート対象：

- ダイアログ：`select`、`confirm`、`input`、`editor`
- 通知/ステータス/エディターテキスト/ターミナル入力/カスタムオーバーレイ
- テーマの一覧表示/名前による読み込み（`setTheme` は文字列名をサポート）
- ツール展開トグル

このコントローラーで現在 no-op なメソッド：

- `setFooter`
- `setHeader`
- `setEditorComponent`

また、`setWidget` は現在 `setHookWidget(...)` 経由でステータスライン テキストにルーティングされることに注意してください。

### RPC モード（`rpc-mode.ts`）

`ctx.ui` は RPC `extension_ui_request` イベントによってバックされています：

- ダイアログメソッド（`select`、`confirm`、`input`、`editor`）はクライアントレスポンスへのラウンドトリップを行います。
- ファイアーアンドフォーゲットメソッドはリクエストを送出します（`notify`、`setStatus`、文字列配列向けの `setWidget`、`setTitle`、`setEditorText`）。

RPC 実装でサポートされていない/no-op：

- `onTerminalInput`
- `custom`
- `setFooter`、`setHeader`、`setEditorComponent`
- `setWorkingMessage`
- テーマの切り替え/読み込み（`setTheme` は失敗を返す）
- ツール展開コントロールは無効

### プリント/ヘッドレス/サブエージェントパス

ランナー初期化に UI コンテキストが提供されない場合、`ctx.hasUI` は `false` となり、メソッドは no-op/デフォルト返却になります。

### バックグラウンドインタラクティブモード

バックグラウンドモードは非インタラクティブな UI コンテキストオブジェクトをインストールします。現在の実装では、インタラクティブダイアログがデフォルト/no-op の動作を返す間も、`ctx.hasUI` が `true` のままになる場合があります。

## セッションと状態パターン

永続的な拡張機能の状態のために：

1. `pi.appendEntry(customType, data)` で永続化します。
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
 // pi-tui コンポーネントを返す
});
```

カスタムメッセージが表示される際のインタラクティブレンダリングで使用されます。

## ツールコール/結果レンダラー

TUI でのカスタムツール視覚化のために、`registerTool` の定義に `renderCall` / `renderResult` を提供します。

## 制約と落とし穴

- ランタイムアクションは拡張機能のロード中は使用できません。
- `tool_call` のエラーは実行をブロックします（フェイルクローズド）。
- 組み込みコマンドとの名前の競合は、診断情報とともにスキップされます。
- 予約済みショートカットは無視されます（`ctrl+c`、`ctrl+d`、`ctrl+z`、`ctrl+k`、`ctrl+p`、`ctrl+l`、`ctrl+o`、`ctrl+t`、`ctrl+g`、`shift+tab`、`shift+ctrl+p`、`alt+enter`、`escape`、`enter`）。
- `ctx.reload()` は現在のコマンドハンドラーフレームにとって終端処理として扱ってください。

## 拡張機能 vs フック vs カスタムツール

適切なサーフェスを使用してください：

- **拡張機能**（`src/extensibility/extensions/*`）：統合システム（イベント + ツール + コマンド + レンダラー + プロバイダー登録）。
- **フック**（`src/extensibility/hooks/*`）：別個のレガシーイベント API。
- **カスタムツール**（`src/extensibility/custom-tools/*`）：ツール中心のモジュール。拡張機能と並行して読み込まれると、アダプターが適用され、引き続き拡張機能インターセプションラッパーを通過します。

ポリシー、ツール、コマンド UX、およびレンダリングをまとめて所有するパッケージが必要な場合は、拡張機能を使用してください。
