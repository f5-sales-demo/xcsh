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

SDK は `@f5xc-salesdemos/xcsh` のインプロセス統合インターフェースです。
独自の Bun/Node プロセスからエージェント状態、イベントストリーミング、ツール配線、およびセッション制御に直接アクセスしたい場合に使用します。

クロス言語・プロセス分離が必要な場合は、代わりに RPC モードを使用してください。

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
- ディスカバリーヘルパー (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- ツールファクトリーインターフェース (`createTools`, `BUILTIN_TOOLS`, ツールクラス)

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

`createAgentSession()` は「指定すれば上書き、省略すれば自動検出」の方針に従います。

省略した場合、以下が解決されます:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent`（`getAgentDir()` 経由）
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)`（ファイルバックド）
- スキル / コンテキストファイル / プロンプトテンプレート / スラッシュコマンド / 拡張機能 / カスタム TS コマンド
- `createTools(...)` 経由の組み込みツール
- MCP ツール（デフォルトで有効）
- LSP 統合（デフォルトで有効）

### 必須入力とオプション入力

通常、制御したい内容のみを指定すれば十分です:

- **必須指定**: 最小限のセッションでは何も不要
- **エンベッダーで明示的に指定することが多いもの**:
    - `sessionManager`（インメモリまたはカスタムロケーションが必要な場合）
    - `authStorage` + `modelRegistry`（クレデンシャル / モデルのライフサイクルを自分で管理する場合）
    - `model` または `modelPattern`（モデル選択を確定的にする必要がある場合）
    - `settings`（分離された / テスト用の設定が必要な場合）

## セッションマネージャーの動作（永続化 vs インメモリ）

`AgentSession` は常に `SessionManager` を使用しますが、動作はどのファクトリーを使用するかによって異なります。

### ファイルバックド（デフォルト）

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // 絶対 .jsonl パス
```

- 会話 / メッセージ / 状態差分をセッションファイルに永続化します。
- 再開 / 開く / 一覧表示 / フォークワークフローをサポートします。
- `session.sessionFile` が定義されています。

### インメモリ

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ファイルシステムへの永続化なし。
- テスト、エフェメラルワーカー、リクエストスコープエージェントに有用です。
- セッションメソッドは引き続き動作しますが、永続化固有の動作（ファイルの再開 / フォークパス）は自然と制限されます。

### 再開 / 開く / 一覧表示ヘルパー

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## モデルと認証の配線

`createAgentSession()` はモデル選択と API キー解決に `ModelRegistry` + `AuthStorage` を使用します。

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

### `model` 省略時の選択順序

`model` / `modelPattern` が明示的に指定されていない場合:

1. 既存セッションからモデルを復元（復元可能かつキーが利用可能な場合）
2. 設定のデフォルトモデルロール（`default`）
3. 有効な認証を持つ最初の利用可能なモデル

復元に失敗した場合、`modelFallbackMessage` がフォールバックを説明します。

### 認証の優先順位

`AuthStorage.getApiKey(...)` は以下の順序で解決します:

1. ランタイムオーバーライド（`setRuntimeApiKey`）
2. `agent.db` に保存されたクレデンシャル
3. プロバイダー環境変数
4. カスタムプロバイダーリゾルバーフォールバック（設定されている場合）

## イベントサブスクリプションモデル

`session.subscribe(listener)` でサブスクライブします。購読解除関数が返されます。

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

## プロンプトのライフサイクル

`session.prompt(text, options?)` がプライマリエントリーポイントです。

動作:

1. オプションのコマンド / テンプレート展開（`/` コマンド、カスタムコマンド、ファイルスラッシュコマンド、プロンプトテンプレート）
2. 現在ストリーミング中の場合:
    - `streamingBehavior: "steer" | "followUp"` が必要
    - 作業を破棄せずにキューに追加
3. アイドル状態の場合:
    - モデル + API キーを検証
    - ユーザーメッセージを追加
    - エージェントターンを開始

関連 API:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## ツールと拡張機能の統合

### 組み込みとフィルタリング

- 組み込みツールは `createTools(...)` および `BUILTIN_TOOLS` から提供されます。
- `toolNames` は組み込みツールの許可リストとして機能します。
- `customTools` および拡張機能で登録されたツールは引き続き含まれます。
- 非表示ツール（例: `submit_result`）はオプションで必要とされない限り、オプトインです。

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
- `preloadedExtensions`: 既にロード済みの拡張機能セットを再利用

### ランタイムツールセットの変更

`AgentSession` はランタイムでのアクティベーション更新をサポートします:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

アクティブなツールの変更を反映するためにシステムプロンプトが再構築されます。

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

オーケストレーターを構築する SDK 利用者向け（タスクエグゼキューターフローに類似）:

- `outputSchema`: 構造化出力の期待値をツールコンテキストに渡す
- `requireSubmitResultTool`: `submit_result` ツールの組み込みを強制する
- `taskDepth`: ネストされたタスクセッションの再帰深度コンテキスト
- `parentTaskPrefix`: ネストされたタスク出力のアーティファクト命名プレフィックス

これらは通常のシングルエージェントエンベッディングではオプションです。

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

`setToolUIContext(...)` は、エンベッダーがツール / 拡張機能から呼び出されるべき UI 機能を提供する場合にのみ使用してください。

## 最小限の制御付きエンベッド例

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
