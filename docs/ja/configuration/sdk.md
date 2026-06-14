---
title: SDK
description: xcsh コーディングエージェントランタイム上でカスタムエージェントおよびインテグレーションを構築するための SDK。
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK は `@f5xc-salesdemos/xcsh` のインプロセス統合インターフェイスです。
独自の Bun/Node プロセスからエージェントの状態、イベントストリーミング、ツールの配線、およびセッション制御に直接アクセスしたい場合に使用します。

言語をまたぐ分離やプロセス分離が必要な場合は、代わりに RPC モードを使用してください。

## インストール

```bash
bun add @f5xc-salesdemos/xcsh
```

## エントリーポイント

`@f5xc-salesdemos/xcsh` はパッケージルート（および `@f5xc-salesdemos/xcsh/sdk` 経由）から SDK API をエクスポートします。

エンベッダー向けのコアエクスポート:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- ディスカバリーヘルパー（`discoverExtensions`、`discoverSkills`、`discoverContextFiles`、`discoverPromptTemplates`、`discoverSlashCommands`、`discoverCustomTSCommands`、`discoverMCPServers`）
- ツールファクトリーサーフェス（`createTools`、`BUILTIN_TOOLS`、ツールクラス）

## クイックスタート（自動ディスカバリーのデフォルト）

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## `createAgentSession()` がデフォルトで検出する内容

`createAgentSession()` は「提供すればオーバーライド、省略すれば自動検出」の方針に従います。

省略した場合、以下が解決されます:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent`（`getAgentDir()` 経由）
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)`（ファイルバック）
- スキル / コンテキストファイル / プロンプトテンプレート / スラッシュコマンド / 拡張機能 / カスタム TS コマンド
- `createTools(...)` 経由の組み込みツール
- MCP ツール（デフォルトで有効）
- LSP インテグレーション（デフォルトで有効）

### 必須入力とオプション入力

通常、制御したい部分のみ指定する必要があります:

- **必須**: 最小限のセッションでは何も不要
- **エンベッダーで明示的に指定することが多いもの**:
    - `sessionManager`（インメモリまたはカスタムロケーションが必要な場合）
    - `authStorage` + `modelRegistry`（クレデンシャル / モデルのライフサイクルを自身で管理する場合）
    - `model` または `modelPattern`（モデル選択を決定論的に行いたい場合）
    - `settings`（分離された / テスト用の設定が必要な場合）

## セッションマネージャーの動作（永続 vs インメモリ）

`AgentSession` は常に `SessionManager` を使用します。動作は使用するファクトリーによって異なります。

### ファイルバック（デフォルト）

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // 絶対 .jsonl パス
```

- 会話 / メッセージ / 状態デルタをセッションファイルに永続化します。
- 再開 / オープン / リスト / フォークのワークフローをサポートします。
- `session.sessionFile` が定義されます。

### インメモリ

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ファイルシステムへの永続化なし。
- テスト、エフェメラルワーカー、リクエストスコープのエージェントに有用です。
- セッションメソッドは引き続き動作しますが、永続化固有の動作（ファイル再開 / フォークパス）は自然に制限されます。

### 再開 / オープン / リストヘルパー

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## モデルと認証の配線

`createAgentSession()` はモデル選択と API キー解決のために `ModelRegistry` と `AuthStorage` を使用します。

### 明示的な配線

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### `model` を省略した場合の選択順序

`model` / `modelPattern` が明示的に指定されていない場合:

1. 既存セッションからモデルを復元（復元可能かつキーが利用可能な場合）
2. 設定のデフォルトモデルロール（`default`）
3. 有効な認証を持つ最初の利用可能なモデル

復元に失敗した場合、`modelFallbackMessage` がフォールバックを説明します。

### 認証の優先順位

`AuthStorage.getApiKey(...)` は以下の順序で解決します:

1. ランタイムオーバーライド（`setRuntimeApiKey`）
2. `agent.db` に保存されたクレデンシャル
3. プロバイダーの環境変数
4. カスタムプロバイダーリゾルバーのフォールバック（設定されている場合）

## イベントサブスクリプションモデル

`session.subscribe(listener)` でサブスクライブします。戻り値はアンサブスクライブ関数です。

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent` にはコアの `AgentEvent` に加え、セッションレベルのイベントが含まれます:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## プロンプトのライフサイクル

`session.prompt(text, options?)` が主要なエントリーポイントです。

動作:

1. オプションのコマンド / テンプレート展開（`/` コマンド、カスタムコマンド、ファイルスラッシュコマンド、プロンプトテンプレート）
2. 現在ストリーミング中の場合:
    - `streamingBehavior: "steer" | "followUp"` が必要
    - 処理を破棄するのではなくキューに追加
3. アイドル状態の場合:
    - モデルと API キーを検証
    - ユーザーメッセージを追加
    - エージェントターンを開始

関連 API:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## ツールと拡張機能のインテグレーション

### 組み込みとフィルタリング

- 組み込みは `createTools(...)` と `BUILTIN_TOOLS` から提供されます。
- `toolNames` は組み込みの許可リストとして機能します。
- `customTools` および拡張機能で登録されたツールは引き続き含まれます。
- 非表示ツール（例: `submit_result`）は、オプションで必要とされない限りオプトインです。

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### 拡張機能

- `extensions`: インライン `ExtensionFactory[]`
- `additionalExtensionPaths`: 追加の拡張ファイルを読み込む
- `disableExtensionDiscovery`: 自動拡張スキャンを無効化
- `preloadedExtensions`: 既に読み込まれた拡張セットを再利用

### ランタイムのツールセット変更

`AgentSession` はランタイムのアクティベーション更新をサポートします:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

システムプロンプトはアクティブなツールの変更を反映して再構築されます。

## ディスカバリーヘルパー

内部のディスカバリーロジックを再実装せずに部分的な制御が必要な場合に使用します:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## サブエージェント向けオプション

オーケストレーターを構築する SDK 利用者向け（タスク実行フローに類似）:

- `outputSchema`: 構造化された出力期待をツールコンテキストに渡す
- `requireSubmitResultTool`: `submit_result` ツールの強制的な組み込み
- `taskDepth`: ネストされたタスクセッションの再帰深度コンテキスト
- `parentTaskPrefix`: ネストされたタスク出力のアーティファクト命名プレフィックス

これらは通常の単一エージェント埋め込みではオプションです。

## `createAgentSession()` の戻り値

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

`setToolUIContext(...)` は、ツール / 拡張機能が呼び出す UI 機能をエンベッダーが提供する場合にのみ使用してください。

## 最小限の制御された埋め込み例

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
