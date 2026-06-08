---
title: SDK
description: >-
  SDK for building custom agents and integrations on top of the xcsh coding
  agent runtime.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDKは`@f5xc-salesdemos/xcsh`のプロセス内統合インターフェースです。
自身のBun/Nodeプロセスからエージェントの状態、イベントストリーミング、ツール接続、セッション制御に直接アクセスしたい場合に使用します。

言語間/プロセス間の分離が必要な場合は、代わりにRPCモードを使用してください。

## インストール

```bash
bun add @f5xc-salesdemos/xcsh
```

## エントリポイント

`@f5xc-salesdemos/xcsh`はパッケージルート（および`@f5xc-salesdemos/xcsh/sdk`経由）からSDK APIをエクスポートします。

組み込み向けのコアエクスポート:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- ディスカバリーヘルパー (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- ツールファクトリーインターフェース (`createTools`, `BUILTIN_TOOLS`, ツールクラス)

## クイックスタート（自動検出のデフォルト設定）

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

## `createAgentSession()`がデフォルトで検出するもの

`createAgentSession()`は「オーバーライドする場合は提供し、省略すると自動検出する」方針に従います。

省略された場合、以下を解決します:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent`（`getAgentDir()`経由）
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)`（ファイルバック）
- skills/コンテキストファイル/プロンプトテンプレート/スラッシュコマンド/拡張機能/カスタムTSコマンド
- `createTools(...)`経由のビルトインツール
- MCPツール（デフォルトで有効）
- LSP統合（デフォルトで有効）

### 必須入力とオプション入力

通常、制御したいものだけを提供すれば十分です:

- **必須**: 最小限のセッションであれば何も不要
- **組み込み時に通常明示的に提供するもの**:
    - `sessionManager`（インメモリまたはカスタムの保存場所が必要な場合）
    - `authStorage` + `modelRegistry`（認証情報/モデルのライフサイクルを自身で管理する場合）
    - `model` または `modelPattern`（確定的なモデル選択が重要な場合）
    - `settings`（分離された/テスト用の設定が必要な場合）

## セッションマネージャーの動作（永続化 vs インメモリ）

`AgentSession`は常に`SessionManager`を使用します。動作は使用するファクトリーによって異なります。

### ファイルバック（デフォルト）

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- 会話/メッセージ/状態のデルタをセッションファイルに永続化します。
- 再開/オープン/一覧表示/フォークのワークフローをサポートします。
- `session.sessionFile`が定義されます。

### インメモリ

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ファイルシステムへの永続化なし。
- テスト、一時的なワーカー、リクエストスコープのエージェントに便利です。
- セッションメソッドは引き続き動作しますが、永続化固有の動作（ファイルの再開/フォークパス）は自然に制限されます。

### 再開/オープン/一覧表示ヘルパー

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## モデルと認証の接続

`createAgentSession()`はモデル選択とAPIキーの解決に`ModelRegistry` + `AuthStorage`を使用します。

### 明示的な接続

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

### `model`が省略された場合の選択順序

明示的な`model`/`modelPattern`が提供されない場合:

1. 既存のセッションからモデルを復元（復元可能かつキーが利用可能な場合）
2. 設定のデフォルトモデルロール（`default`）
3. 有効な認証を持つ最初の利用可能なモデル

復元に失敗した場合、`modelFallbackMessage`がフォールバックの理由を説明します。

### 認証の優先順位

`AuthStorage.getApiKey(...)`は以下の順序で解決します:

1. ランタイムオーバーライド（`setRuntimeApiKey`）
2. `agent.db`に保存された認証情報
3. プロバイダーの環境変数
4. カスタムプロバイダーのリゾルバーフォールバック（設定されている場合）

## イベントサブスクリプションモデル

`session.subscribe(listener)`でサブスクライブします。アンサブスクライブ関数が返されます。

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

`AgentSessionEvent`にはコアの`AgentEvent`に加えて、セッションレベルのイベントが含まれます:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## プロンプトのライフサイクル

`session.prompt(text, options?)`が主要なエントリポイントです。

動作:

1. オプションのコマンド/テンプレート展開（`/`コマンド、カスタムコマンド、ファイルスラッシュコマンド、プロンプトテンプレート）
2. 現在ストリーミング中の場合:
    - `streamingBehavior: "steer" | "followUp"`が必要
    - 作業を破棄する代わりにキューに追加
3. アイドル状態の場合:
    - モデル + APIキーを検証
    - ユーザーメッセージを追加
    - エージェントターンを開始

関連API:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## ツールと拡張機能の統合

### ビルトインとフィルタリング

- ビルトインは`createTools(...)`と`BUILTIN_TOOLS`から提供されます。
- `toolNames`はビルトインのための許可リストとして機能します。
- `customTools`と拡張機能で登録されたツールは引き続き含まれます。
- 非表示ツール（例：`submit_result`）はオプションで要求されない限りオプトインです。

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### 拡張機能

- `extensions`: インラインの`ExtensionFactory[]`
- `additionalExtensionPaths`: 追加の拡張機能ファイルを読み込み
- `disableExtensionDiscovery`: 自動的な拡張機能スキャンを無効化
- `preloadedExtensions`: 既に読み込まれた拡張機能セットを再利用

### ランタイムでのツールセット変更

`AgentSession`はランタイムでのアクティベーション更新をサポートします:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

アクティブなツールの変更を反映するためにシステムプロンプトが再構築されます。

## ディスカバリーヘルパー

内部のディスカバリーロジックを再作成せずに部分的な制御が必要な場合に使用します:

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

- `outputSchema`: 構造化された出力期待値をツールコンテキストに渡す
- `requireSubmitResultTool`: `submit_result`ツールの包含を強制
- `taskDepth`: ネストされたタスクセッションの再帰深度コンテキスト
- `parentTaskPrefix`: ネストされたタスク出力のアーティファクト命名プレフィックス

これらは通常の単一エージェントの組み込みではオプションです。

## `createAgentSession()`の戻り値

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

`setToolUIContext(...)`は、ツール/拡張機能が呼び出すべきUI機能を組み込み先が提供する場合にのみ使用してください。

## 最小限の制御された組み込み例

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
