---
title: エクステンション
description: エクステンションランタイムの概要。タイプ、ランナーのライフサイクル、登録、およびディスカバリーについて説明します。
sidebar:
  order: 1
  label: 概要
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# エクステンション

`packages/coding-agent` におけるランタイムエクステンションの作成に関する主要ガイドです。

このドキュメントでは、以下のファイルにおける現在のエクステンションランタイムについて説明します：

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

ディスカバリーパスとファイルシステムのロードルールについては、`docs/extension-loading.md` を参照してください。

## エクステンションとは

エクステンションは、デフォルトファクトリをエクスポートする TS/JS モジュールです：

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

エクステンションは、以下のすべてを1つのモジュールに組み合わせることができます：

- イベントハンドラー (`pi.on(...)`)
- LLM 呼び出し可能なツール (`pi.registerTool(...)`)
- スラッシュコマンド (`pi.registerCommand(...)`)
- キーボードショートカットとフラグ
- カスタムメッセージレンダリング
- セッション/メッセージインジェクション API (`sendMessage`, `sendUserMessage`, `appendEntry`)

## ランタイムモデル

1. エクステンションがインポートされ、ファクトリ関数が実行されます。
2. ロードフェーズ中は、登録メソッドのみが有効です。ランタイムアクションメソッドはまだ初期化されていません。
3. `ExtensionRunner.initialize(...)` がアクティブモードのライブアクション/コンテキストを接続します。
4. セッション/エージェント/ツールのライフサイクルイベントがハンドラーに送信されます。
5. すべてのツール実行は、エクステンションのインターセプション（`tool_call` / `tool_result`）でラップされます。

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

`loader.ts` からの重要な制約：

- エクステンションのロード中に `pi.sendMessage()` のようなアクションメソッドを呼び出すと `ExtensionRuntimeNotInitializedError` がスローされます
- まず登録を行い、ランタイムの動作はイベント/コマンド/ツールから実行してください

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

## エクステンション API サーフェス

## 1) 登録とアクション (`ExtensionAPI`)

コアメソッド：

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (共有イベントバス)

インタラクティブモードでは、`input` ハンドラーは組み込みの初回メッセージ自動タイトルチェックの前に実行されます。`input` から `await pi.setSessionName(...)` を呼び出すエクステンションは、永続化されるセッション名を設定し、そのセッションでデフォルトの自動生成タイトルの実行を防ぐことができます。

その他の公開項目：

- `pi.logger`
- `pi.typebox`
- `pi.pi` (パッケージエクスポート)

### メッセージ配信セマンティクス

`pi.sendMessage(message, options)` は以下をサポートします：

- `deliverAs: "steer"` (デフォルト) — 現在の実行を中断します
- `deliverAs: "followUp"` — 現在の実行完了後に実行するようキューに入れられます
- `deliverAs: "nextTurn"` — 保存され、次のユーザープロンプト時にインジェクションされます
- `triggerTurn: true` — アイドル時にターンを開始します（`nextTurn` はこれを無視します）

`pi.sendUserMessage(content, { deliverAs })` は常にプロンプトフローを経由します。ストリーミング中は steer/follow-up としてキューに入れられます。

## 2) ハンドラーコンテキスト (`ExtensionContext`)

ハンドラーとツールの `execute` は以下を含む `ctx` を受け取ります：

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (読み取り専用)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) コマンドコンテキスト (`ExtensionCommandContext`)

コマンドハンドラーは追加で以下を取得します：

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

セッション制御フローにはコマンドコンテキストを使用してください。これらのメソッドは一般的なイベントハンドラーから意図的に分離されています。

## イベントサーフェス（現在の名前と動作）

正規のイベントユニオンとペイロード型は `types.ts` にあります。

### セッションライフサイクル

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

キャンセル可能なプレイベント：

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### プロンプトとターンのライフサイクル

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### ツールライフサイクル

- `tool_call` (実行前、ブロック可能)
- `tool_result` (実行後、content/details/isError のパッチ可能)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (オブザーバビリティ)

`tool_result` はミドルウェアスタイルです：ハンドラーはエクステンションの順序で実行され、それぞれが前の変更を参照できます。

### 信頼性/ランタイムシグナル

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### ユーザーコマンドのインターセプション

- `user_bash` (`{ result }` でオーバーライド)
- `user_python` (`{ result }` でオーバーライド)

### `resources_discover`

`resources_discover` はエクステンション型と `ExtensionRunner` に存在します。
現在のランタイムに関する注記：`ExtensionRunner.emitResourcesDiscover(...)` は実装されていますが、現在のコードベースでこれを呼び出す `AgentSession` のコールサイトはありません。

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
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` は、`sdk.ts` でレジストリがラップされた後、ビルトインおよびエクステンション/カスタムツールを含むすべてのツールをインターセプトします。

## UI 統合ポイント

`ctx.ui` は `ExtensionUIContext` インターフェースを実装します。サポート状況はモードによって異なります。

### インタラクティブモード (`extension-ui-controller.ts`)

サポートされているもの：

- ダイアログ: `select`, `confirm`, `input`, `editor`
- 通知/ステータス/エディターテキスト/ターミナル入力/カスタムオーバーレイ
- テーマの一覧表示/名前によるロード（`setTheme` は文字列名をサポート）
- ツール展開トグル

このコントローラーにおける現在の no-op メソッド：

- `setFooter`
- `setHeader`
- `setEditorComponent`

また注意：`setWidget` は現在 `setHookWidget(...)` を介してステータスラインテキストにルーティングされます。

### RPC モード (`rpc-mode.ts`)

`ctx.ui` は RPC `extension_ui_request` イベントによってバッキングされています：

- ダイアログメソッド (`select`, `confirm`, `input`, `editor`) はクライアントレスポンスとのラウンドトリップ
- ファイア・アンド・フォーゲットメソッドはリクエストを送信 (`notify`, `setStatus`, `setWidget` (文字列配列用), `setTitle`, `setEditorText`)

RPC 実装で未サポート/no-op のもの：

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- テーマの切り替え/ロード（`setTheme` は失敗を返します）
- ツール展開コントロールは無効

### Print/ヘッドレス/サブエージェントパス

ランナー初期化時に UI コンテキストが提供されない場合、`ctx.hasUI` は `false` となり、メソッドは no-op/デフォルト値を返します。

### バックグラウンドインタラクティブモード

バックグラウンドモードは非インタラクティブな UI コンテキストオブジェクトをインストールします。現在の実装では、インタラクティブダイアログがデフォルト/no-op 動作を返す一方で、`ctx.hasUI` は `true` のままになることがあります。

## セッションと状態のパターン

永続的なエクステンション状態のために：

1. `pi.appendEntry(customType, data)` で永続化します。
2. `session_start`, `session_branch`, `session_tree` で `ctx.sessionManager.getBranch()` から状態を再構築します。
3. ツール結果の `details` は、ツール結果履歴から状態が参照/再構築可能であるべき場合、構造化された形で保持します。

状態再構築パターンの例：

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## レンダリングエクステンションポイント

## カスタムメッセージレンダラー

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

カスタムメッセージが表示される際にインタラクティブレンダリングで使用されます。

## ツール呼び出し/結果レンダラー

TUI でのカスタムツール可視化のために、`registerTool` 定義で `renderCall` / `renderResult` を提供します。

## 制約と注意点

- ランタイムアクションはエクステンションのロード中に利用できません。
- `tool_call` のエラーは実行をブロックします（フェイルクローズ）。
- ビルトインとのコマンド名の競合は、診断情報とともにスキップされます。
- 予約済みショートカットは無視されます（`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`）。
- `ctx.reload()` は現在のコマンドハンドラーフレームの終端として扱ってください。

## エクステンション vs フック vs カスタムツール

適切なサーフェスを使用してください：

- **エクステンション** (`src/extensibility/extensions/*`)：統合システム（イベント + ツール + コマンド + レンダラー + プロバイダー登録）。
- **フック** (`src/extensibility/hooks/*`)：分離されたレガシーイベント API。
- **カスタムツール** (`src/extensibility/custom-tools/*`)：ツールに特化したモジュール。エクステンションと並行してロードされた場合、アダプターされ、エクステンションのインターセプションラッパーを引き続き通過します。

ポリシー、ツール、コマンド UX、レンダリングを1つのパッケージで管理する必要がある場合は、エクステンションを使用してください。
