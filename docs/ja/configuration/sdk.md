---
title: SDK
description: xcshコーディングエージェントランタイム上にカスタムエージェントおよびインテグレーションを構築するためのSDK。
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDKは `@f5-sales-demo/xcsh` のインプロセスインテグレーションサーフェスです。
自身のBun/Nodeプロセスからエージェントの状態、イベントストリーミング、ツールの接続、セッション制御に直接アクセスしたい場合に使用します。

言語をまたいだ分離やプロセス分離が必要な場合は、RPCモードを使用してください。

## インストール

```bash
bun add @f5-sales-demo/xcsh
```

## エントリポイント

`@f5-sales-demo/xcsh` はパッケージルート（および `@f5-sales-demo/xcsh/sdk` 経由）からSDK APIをエクスポートします。

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
import { createAgentSession } from "@f5-sales-demo/xcsh";

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

## `createAgentSession()` がデフォルトで検出するもの

`createAgentSession()` は「指定すれば上書き、省略すれば自動検出」の方針に従います。

省略した場合、以下が解決されます:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent`（`getAgentDir()` 経由）
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)`（ファイルバック）
- スキル / コンテキストファイル / プロンプトテンプレート / スラッシュコマンド / 拡張機能 / カスタムTSコマンド
- `createTools(...)` 経由の組み込みツール
- MCPツール（デフォルトで有効）
- LSPインテグレーション（デフォルトで有効）

### 必須入力とオプション入力

通常、制御したいものだけを指定すれば十分です:

- **必須**: 最小限のセッションには何も不要
- **エンベッダーで明示的に指定することが多いもの**:
    - `sessionManager`（インメモリまたはカスタムロケーションが必要な場合）
    - `authStorage` + `modelRegistry`（認証情報やモデルのライフサイクルを自分で管理する場合）
    - `model` または `modelPattern`（決定論的なモデル選択が重要な場合）
    - `settings`（分離された設定やテスト用設定が必要な場合）

## セッションマネージャーの動作（永続化 vs インメモリ）

`AgentSession` は常に `SessionManager` を使用します。動作は使用するファクトリーによって異なります。

### ファイルバック（デフォルト）

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // 絶対パスの .jsonl ファイル
```

- 会話 / メッセージ / 状態デルタをセッションファイルに永続化します。
- 再開 / オープン / 一覧 / フォークのワークフローをサポートします。
- `session.sessionFile` が定義されます。

### インメモリ

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ファイルシステムへの永続化なし。
- テスト、エフェメラルワーカー、リクエストスコープのエージェントに有用です。
- セッションメソッドは引き続き動作しますが、永続化固有の動作（ファイルの再開 / フォークパス）は当然ながら制限されます。

### 再開 / オープン / 一覧ヘルパー

```ts
import { SessionManager } from "@f5-sales-demo/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## モデルと認証の接続

`createAgentSession()` はモデル選択とAPIキーの解決に `ModelRegistry` と `AuthStorage` を使用します。

### 明示的な接続

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5-sales-demo/xcsh";

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

### `model` が省略された場合の選択順序

`model` / `modelPattern` が明示的に指定されていない場合:

1. 既存セッションからモデルを復元（復元可能かつキーが利用可能な場合）
2. 設定のデフォルトモデルロール（`default`）
3. 有効な認証を持つ最初の利用可能なモデル

復元に失敗した場合、`modelFallbackMessage` がフォールバック理由を説明します。

### 認証の優先順位

`AuthStorage.getApiKey(...)` は以下の順序で解決します:

1. ランタイムオーバーライド（`setRuntimeApiKey`）
2. `agent.db` に保存された認証情報
3. プロバイダー環境変数
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

`AgentSessionEvent` にはコアの `AgentEvent` に加えてセッションレベルのイベントが含まれます:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## プロンプトライフサイクル

`session.prompt(text, options?)` が主要なエントリポイントです。

動作:

1. オプションのコマンド / テンプレート展開（`/` コマンド、カスタムコマンド、ファイルスラッシュコマンド、プロンプトテンプレート）
2. 現在ストリーミング中の場合:
    - `streamingBehavior: "steer" | "followUp"` が必要
    - 処理を破棄せずにキューに追加
3. アイドル状態の場合:
    - モデルとAPIキーを検証
    - ユーザーメッセージを追加
    - エージェントターンを開始

関連API:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## ツールと拡張機能のインテグレーション

### 組み込みとフィルタリング

- 組み込みツールは `createTools(...)` と `BUILTIN_TOOLS` から提供されます。
- `toolNames` は組み込みツールのアローリストとして機能します。
- `customTools` および拡張機能で登録されたツールは引き続き含まれます。
- 隠しツール（例: `submit_result`）は、オプションで必要とされない限りオプトインです。

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### 拡張機能

- `extensions`: インライン `ExtensionFactory[]`
- `additionalExtensionPaths`: 追加の拡張機能ファイルを読み込む
- `disableExtensionDiscovery`: 自動拡張機能スキャンを無効化
- `preloadedExtensions`: すでに読み込まれた拡張機能セットを再利用

### ランタイムツールセットの変更

`AgentSession` はランタイムアクティベーションの更新をサポートします:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

アクティブツールの変更を反映するためにシステムプロンプトが再構築されます。

## ディスカバリーヘルパー

内部ディスカバリーロジックを再実装せずに部分的な制御が必要な場合に使用します:

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

オーケストレーターを構築するSDKコンシューマー向け（タスクエグゼキューターフローに類似）:

- `outputSchema`: 構造化出力の期待値をツールコンテキストに渡す
- `requireSubmitResultTool`: `submit_result` ツールの組み込みを強制する
- `taskDepth`: ネストされたタスクセッションの再帰深度コンテキスト
- `parentTaskPrefix`: ネストされたタスク出力のアーティファクト命名プレフィックス

これらは通常の単一エージェントへの組み込みでは任意です。

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

`setToolUIContext(...)` は、エンベッダーがツールや拡張機能から呼び出されるUI機能を提供する場合にのみ使用してください。

## 最小限の制御されたエンベッド例

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5-sales-demo/xcsh";

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
