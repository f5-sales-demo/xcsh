---
title: MCPランタイムライフサイクル
description: 初期化からツール登録、ヘルスモニタリング、シャットダウンまでのMCPサーバープロセスのライフサイクル。
sidebar:
  order: 3
  label: ランタイムライフサイクル
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCPランタイムライフサイクル

このドキュメントでは、MCPサーバーがcoding-agentランタイムにおいてどのように検出、接続、ツールとして公開、リフレッシュ、および終了されるかを説明します。

## ライフサイクルの概要

1. **SDK起動時**に `discoverAndLoadMCPTools()` を呼び出します（MCPが無効でない場合）。
2. **ディスカバリ**（`loadAllMCPConfigs`）がケーパビリティソースからMCPサーバー設定を解決し、無効化されたエントリ、プロジェクトエントリ、Exaエントリをフィルタリングし、ソースメタデータを保持します。
3. **マネージャー接続フェーズ**（`MCPManager.connectServers`）がサーバーごとの接続 + `tools/list` を並列で開始します。
4. **高速起動ゲート**が最大250ms待機した後、以下を返す場合があります：
   - 完全にロードされた `MCPTool`、
   - サーバーごとの失敗情報、
   - またはまだ保留中のサーバー向けのキャッシュされた `DeferredMCPTool`。
5. **SDKワイヤリング**がMCPツールをセッションのランタイムツールレジストリにマージします。
6. **ライブセッション**では `/mcp` フロー（`disconnectAll` + 再ディスカバリ + `session.refreshMCPTools`）を介してMCPツールをリフレッシュできます。
7. **ティアダウン**は呼び出し元が `disconnectServer`/`disconnectAll` を実行した時に発生します。マネージャーは切断されたサーバーのMCPツール登録もクリアします。

## ディスカバリとロードフェーズ

### SDKからのエントリパス

`src/sdk.ts` の `createAgentSession()` は、`enableMCP` が true（デフォルト）の場合にMCP起動を実行します：

- `discoverAndLoadMCPTools(cwd, { ... })` を呼び出し、
- `authStorage`、キャッシュストレージ、および `mcp.enableProjectConfig` 設定を渡し、
- 常に `filterExa: true` を設定し、
- サーバーごとのロード/接続エラーをログに記録し、
- 返されたマネージャーを `toolSession.mcpManager` とセッション結果に格納します。

`enableMCP` が false の場合、MCPディスカバリは完全にスキップされます。

### 設定のディスカバリとフィルタリング

`loadAllMCPConfigs()`（`src/mcp/config.ts`）は、ケーパビリティディスカバリを通じて正規のMCPサーバーアイテムをロードし、レガシーの `MCPServerConfig` に変換します。

フィルタリングの動作：

- `enableProjectConfig: false` はプロジェクトレベルのエントリ（`_source.level === "project"`）を除外します。
- `enabled: false` のサーバーは接続試行前にスキップされます。
- Exaサーバーはデフォルトでフィルタリングされ、APIキーはネイティブExaツール統合用に抽出されます。

結果には `configs` と `sources`（後でプロバイダーラベリングに使用されるメタデータ）の両方が含まれます。

### ディスカバリレベルの失敗動作

`discoverAndLoadMCPTools()` は2つの失敗クラスを区別します：

- **ディスカバリのハード障害**（`manager.discoverAndConnect` からの例外、通常は設定ディスカバリからのもの）：空のツールセットと1つの合成エラー `{ path: ".mcp.json", error }` を返します。
- **サーバーごとのランタイム/接続障害**：マネージャーは `errors` マップ付きの部分的成功を返し、他のサーバーは継続します。

そのため、個別のMCPサーバーが失敗してもエージェントセッション全体が失敗することはありません。

## マネージャーの状態モデル

`MCPManager` は個別のレジストリでランタイムライフサイクルを追跡します：

- `#connections: Map<string, MCPServerConnection>` — 完全に接続されたサーバー。
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — ハンドシェイク進行中。
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — 接続済みだがツールがまだロード中。
- `#tools: CustomTool[]` — 呼び出し元に公開される現在のMCPツールビュー。
- `#sources: Map<string, SourceMeta>` — 接続完了前でもプロバイダー/ソースのメタデータ。

`getConnectionStatus(name)` はこれらのマップからステータスを導出します：

- `#connections` にある場合は `connected`、
- 保留中の接続または保留中のツールロードがある場合は `connecting`、
- それ以外は `disconnected`。

## 接続の確立と起動タイミング

## サーバーごとの接続パイプライン

`connectServers()` で検出された各サーバーに対して：

1. ソースメタデータを格納/更新し、
2. 既に接続済み/保留中の場合はスキップし、
3. トランスポートフィールドを検証し（`validateServerConfig`）、
4. 認証/シェル置換を解決し（`#resolveAuthConfig`）、
5. `connectToServer(name, resolvedConfig)` を呼び出し、
6. `listTools(connection)` を呼び出し、
7. ツール定義をベストエフォートでキャッシュします（`MCPToolCache.set`）。

`connectToServer()` の動作（`src/mcp/client.ts`）：

- stdioまたはHTTP/SSEトランスポートを作成し、
- MCP `initialize` + `notifications/initialized` を実行し、
- タイムアウト（`config.timeout` またはデフォルト30秒）を使用し、
- 初期化失敗時にトランスポートを閉じます。

### 高速起動ゲート + 遅延フォールバック

`connectServers()` は以下の間のレースで待機します：

- すべての接続/ツールロードタスクの完了、および
- `STARTUP_TIMEOUT_MS = 250`。

250ms後：

- 完了したタスクはライブの `MCPTool` になり、
- 拒否されたタスクはサーバーごとのエラーを生成し、
- まだ保留中のタスク：
  - キャッシュされたツール定義が利用可能な場合（`MCPToolCache.get`）、`DeferredMCPTool` を作成し、
  - そうでなければ、保留中のタスクが完了するまでブロックします。

これはハイブリッド起動モデルです：キャッシュが利用可能な場合は高速リターン、キャッシュがない場合は正確性のための待機です。

### バックグラウンド完了動作

各保留中の `toolsPromise` には、最終的に以下を行うバックグラウンド継続処理もあります：

- `#replaceServerTools` を介してマネージャー状態のそのサーバーのツールスライスを置き換え、
- キャッシュを書き込み、
- 起動後にのみ遅延障害をログに記録します（`allowBackgroundLogging`）。

## ツールの公開とライブセッションでの可用性

### 起動時の登録

`discoverAndLoadMCPTools()` はマネージャーのツールを `LoadedCustomTool[]` に変換し、パスを装飾します（既知の場合は `mcp:<server> via <providerName>`）。

`createAgentSession()` はその後、これらのツールを `customTools` にプッシュし、`mcp_<server>_<tool>` のような名前でラップしてランタイムツールレジストリに追加します。

### ツール呼び出し

- `MCPTool` は既に接続された `MCPServerConnection` を通じてツールを呼び出します。
- `DeferredMCPTool` は呼び出し前に `waitForConnection(server)` を待機します。これにより、接続の準備ができる前にキャッシュされたツールが存在できます。

両方とも構造化されたツール出力を返し、トランスポート/ツールエラーを `MCP error: ...` ツールコンテンツに変換します（アボートはアボートのままです）。

## リフレッシュ/リロードパス（起動時 vs ライブリロード）

### 初期起動パス

- `sdk.ts` での一度限りのディスカバリ/ロード、
- ツールは初期セッションのツールレジストリに登録されます。

### インタラクティブリロードパス

`/mcp reload` パス（`src/modes/controllers/mcp-command-controller.ts`）は以下を実行します：

1. `mcpManager.disconnectAll()`、
2. `mcpManager.discoverAndConnect()`、
3. `session.refreshMCPTools(mcpManager.getTools())`。

`session.refreshMCPTools()`（`src/session/agent-session.ts`）はすべての `mcp_` ツールを削除し、最新のMCPツールを再ラップし、ツールセットを再アクティブ化することで、セッションを再起動せずにMCPの変更を適用します。

遅延接続のためのフォローアップパスもあります：特定のサーバーを待機した後、ステータスが `connected` になった場合、`session.refreshMCPTools(...)` を再実行して、新しく利用可能になったツールをセッション内で再バインドします。

## ヘルス、再接続、および部分障害の動作

現在のランタイム動作は意図的に最小限です：

- マネージャー/クライアントに**自律的なヘルスモニターはありません**。
- トランスポートが切断された場合の**自動再接続ループはありません**。
- マネージャーはトランスポートの `onClose`/`onError` をサブスクライブしません。ステータスはレジストリ駆動です。
- 再接続は明示的です：リロードフローまたは直接の `connectServers()` 呼び出し。

運用上：

- 1つのサーバーが失敗しても、正常なサーバーのツールは削除されません、
- 接続/リストの障害はサーバーごとに分離されます、
- ツールキャッシュとバックグラウンド更新はベストエフォートです（警告/エラーはログに記録され、ハードストップはありません）。

## ティアダウンのセマンティクス

### サーバーレベルのティアダウン

`disconnectServer(name)`：

- 保留中のエントリ/ソースメタデータを削除し、
- 接続済みの場合はトランスポートを閉じ、
- マネージャー状態からそのサーバーの `mcp_` ツールを削除します。

### グローバルティアダウン

`disconnectAll()`：

- `Promise.allSettled` ですべてのアクティブなトランスポートを閉じ、
- 保留中のマップ、ソース、接続、およびマネージャーのツールリストをクリアします。

現在のワイヤリングでは、明示的なティアダウンはMCPコマンドフロー（リロード/削除/無効化用）で使用されます。起動パス自体には個別の自動マネージャー破棄フックはありません。呼び出し元は、確定的なMCPシャットダウンが必要な場合にマネージャーの切断メソッドを呼び出す責任があります。

## 障害モードと保証

| シナリオ | 動作 | ハード障害 vs ベストエフォート |
| --- | --- | --- |
| ディスカバリがスロー（ケーパビリティ/設定ロードパス） | ローダーが空のツール + 合成 `.mcp.json` エラーを返す | ベストエフォートのセッション起動 |
| 無効なサーバー設定 | バリデーションエラーエントリでサーバーがスキップされる | サーバーごとのベストエフォート |
| 接続タイムアウト/初期化障害 | サーバーエラーが記録される。他のサーバーは継続 | サーバーごとのベストエフォート |
| 起動時に `tools/list` がまだ保留中でキャッシュヒットあり | 遅延ツールが即座に返される | ベストエフォートの高速起動 |
| 起動時に `tools/list` がまだ保留中でキャッシュなし | 起動が保留中の完了を待機 | 正確性のためのハード待機 |
| 遅延バックグラウンドツールロード障害 | 起動ゲート後にログ記録 | ベストエフォートのログ記録 |
| ランタイムでのトランスポート切断 | 自動再接続なし。再接続/リロードまで以降の呼び出しが失敗 | 手動アクションによるベストエフォートリカバリ |

## パブリックAPIサーフェス

`src/mcp/index.ts` は外部呼び出し元向けにローダー/マネージャー/クライアントAPIを再エクスポートします。`src/sdk.ts` は同じローダー結果の形状を返すコンビニエンスラッパーとして `discoverMCPServers()` を公開します。

## 実装ファイル

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — ローダーファサード、ディスカバリエラーの正規化、`LoadedCustomTool` 変換。
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — ライフサイクル状態レジストリ、並列接続/リストフロー、リフレッシュ/切断。
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — トランスポートセットアップ、初期化ハンドシェイク、リスト/呼び出し/切断。
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCPモジュールAPIエクスポート。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — セッション/ツールレジストリへの起動ワイヤリング。
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — マネージャーが使用する設定のディスカバリ/フィルタリング/バリデーション。
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — `MCPTool` と `DeferredMCPTool` のランタイム動作。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` ライブ再バインディング。
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — インタラクティブリロード/再接続フロー。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 親マネージャー接続を介したサブエージェントMCPプロキシ。
