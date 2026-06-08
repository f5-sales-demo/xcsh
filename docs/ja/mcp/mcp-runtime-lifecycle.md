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

このドキュメントでは、MCPサーバーがcoding-agentランタイムにおいてどのように検出、接続、ツールとして公開、更新、および終了されるかを説明します。

## ライフサイクルの概要

1. **SDK起動時**に `discoverAndLoadMCPTools()` を呼び出します（MCPが無効でない場合）。
2. **ディスカバリ**（`loadAllMCPConfigs`）がケーパビリティソースからMCPサーバー設定を解決し、無効化されたエントリ/プロジェクトエントリ/Exaエントリをフィルタリングし、ソースメタデータを保持します。
3. **マネージャー接続フェーズ**（`MCPManager.connectServers`）がサーバーごとの接続と `tools/list` を並列で開始します。
4. **高速起動ゲート**が最大250msまで待機し、以下を返す可能性があります：
   - 完全にロードされた `MCPTool`、
   - サーバーごとの失敗情報、
   - またはまだ保留中のサーバーに対するキャッシュ済み `DeferredMCPTool`。
5. **SDKワイヤリング**がMCPツールをセッションのランタイムツールレジストリに統合します。
6. **ライブセッション**は `/mcp` フロー（`disconnectAll` + 再ディスカバリ + `session.refreshMCPTools`）を介してMCPツールを更新できます。
7. **ティアダウン**は呼び出し元が `disconnectServer`/`disconnectAll` を実行した際に発生します。マネージャーは切断されたサーバーのMCPツール登録もクリアします。

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

`loadAllMCPConfigs()`（`src/mcp/config.ts`）はケーパビリティディスカバリを通じて正規のMCPサーバーアイテムをロードし、レガシー `MCPServerConfig` に変換します。

フィルタリング動作：

- `enableProjectConfig: false` はプロジェクトレベルのエントリ（`_source.level === "project"`）を除外します。
- `enabled: false` のサーバーは接続試行前にスキップされます。
- Exaサーバーはデフォルトでフィルタリングされ、APIキーはネイティブExaツール統合用に抽出されます。

結果には `configs` と `sources`（後でプロバイダーラベリングに使用されるメタデータ）の両方が含まれます。

### ディスカバリレベルの失敗動作

`discoverAndLoadMCPTools()` は2つの失敗クラスを区別します：

- **ディスカバリのハード失敗**（`manager.discoverAndConnect` からの例外、通常は設定ディスカバリに起因）：空のツールセットと1つの合成エラー `{ path: ".mcp.json", error }` を返します。
- **サーバーごとのランタイム/接続失敗**：マネージャーが `errors` マップ付きの部分的な成功を返し、他のサーバーは継続します。

そのため、個々のMCPサーバーが失敗してもエージェントセッション全体は失敗しません。

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

## 接続確立と起動タイミング

## サーバーごとの接続パイプライン

`connectServers()` で検出されたサーバーごとに：

1. ソースメタデータを保存/更新、
2. すでに接続済み/保留中の場合はスキップ、
3. トランスポートフィールドの検証（`validateServerConfig`）、
4. 認証/シェル置換の解決（`#resolveAuthConfig`）、
5. `connectToServer(name, resolvedConfig)` を呼び出し、
6. `listTools(connection)` を呼び出し、
7. ツール定義をベストエフォートでキャッシュ（`MCPToolCache.set`）。

`connectToServer()` の動作（`src/mcp/client.ts`）：

- stdioまたはHTTP/SSEトランスポートを作成、
- MCP `initialize` + `notifications/initialized` を実行、
- タイムアウトを使用（`config.timeout` または30秒のデフォルト）、
- 初期化失敗時にトランスポートを閉じる。

### 高速起動ゲート + 遅延フォールバック

`connectServers()` は以下のレースを待機します：

- すべての接続/ツールロードタスクの完了、
- `STARTUP_TIMEOUT_MS = 250`。

250ms後：

- 完了したタスクはライブ `MCPTool` になり、
- 拒否されたタスクはサーバーごとのエラーを生成し、
- まだ保留中のタスクは：
  - キャッシュされたツール定義が利用可能な場合（`MCPToolCache.get`）、`DeferredMCPTool` を作成、
  - それ以外の場合、保留中のタスクが完了するまでブロック。

これはハイブリッド起動モデルです：キャッシュが利用可能な場合は高速リターン、キャッシュがない場合は正確性のための待機。

### バックグラウンド完了動作

保留中の各 `toolsPromise` にはバックグラウンド継続もあり、最終的に：

- `#replaceServerTools` を介してマネージャー状態のそのサーバーのツールスライスを置換、
- キャッシュを書き込み、
- 起動後にのみ遅延失敗をログ記録（`allowBackgroundLogging`）。

## ツールの公開とライブセッションでの利用可能性

### 起動時の登録

`discoverAndLoadMCPTools()` はマネージャーのツールを `LoadedCustomTool[]` に変換し、パスを装飾します（既知の場合 `mcp:<server> via <providerName>`）。

`createAgentSession()` はこれらのツールを `customTools` にプッシュし、`mcp_<server>_<tool>` のような名前でラップしてランタイムツールレジストリに追加します。

### ツール呼び出し

- `MCPTool` はすでに接続された `MCPServerConnection` を通じてツールを呼び出します。
- `DeferredMCPTool` は呼び出し前に `waitForConnection(server)` を待機します。これにより、接続が準備できる前にキャッシュされたツールを存在させることができます。

どちらも構造化されたツール出力を返し、トランスポート/ツールエラーを `MCP error: ...` ツールコンテンツに変換します（アボートはアボートのまま）。

## リフレッシュ/リロードパス（起動時 vs ライブリロード）

### 初期起動パス

- `sdk.ts` での一回限りのディスカバリ/ロード、
- ツールは初期セッションツールレジストリに登録。

### インタラクティブリロードパス

`/mcp reload` パス（`src/modes/controllers/mcp-command-controller.ts`）は以下を実行します：

1. `mcpManager.disconnectAll()`、
2. `mcpManager.discoverAndConnect()`、
3. `session.refreshMCPTools(mcpManager.getTools())`。

`session.refreshMCPTools()`（`src/session/agent-session.ts`）はすべての `mcp_` ツールを削除し、最新のMCPツールを再ラップし、ツールセットを再アクティベートして、セッションを再起動せずにMCPの変更を適用します。

遅延接続のためのフォローアップパスもあります：特定のサーバーを待機した後、ステータスが `connected` になった場合、`session.refreshMCPTools(...)` を再実行して、新しく利用可能になったツールをセッション内で再バインドします。

## ヘルス、再接続、および部分的な失敗動作

現在のランタイム動作は意図的にミニマルです：

- マネージャー/クライアントに**自律的なヘルスモニターはありません**。
- トランスポートが切断された際の**自動再接続ループはありません**。
- マネージャーはトランスポートの `onClose`/`onError` をサブスクライブしません。ステータスはレジストリ駆動です。
- 再接続は明示的です：リロードフローまたは直接の `connectServers()` 呼び出し。

運用上：

- 1つのサーバーの失敗が正常なサーバーからツールを削除することはありません、
- 接続/リスト失敗はサーバーごとに分離されます、
- ツールキャッシュとバックグラウンド更新はベストエフォートです（警告/エラーはログ記録、ハードストップなし）。

## ティアダウンのセマンティクス

### サーバーレベルのティアダウン

`disconnectServer(name)`:

- 保留中のエントリ/ソースメタデータを削除、
- 接続されている場合はトランスポートを閉じる、
- マネージャー状態からそのサーバーの `mcp_` ツールを削除。

### グローバルティアダウン

`disconnectAll()`:

- `Promise.allSettled` ですべてのアクティブなトランスポートを閉じる、
- 保留中のマップ、ソース、接続、およびマネージャーのツールリストをクリア。

現在のワイヤリングでは、明示的なティアダウンはMCPコマンドフロー（リロード/削除/無効化）で使用されます。起動パス自体に別の自動マネージャー破棄フックはありません。呼び出し元は、確定的なMCPシャットダウンが必要な場合にマネージャーの切断メソッドを呼び出す責任があります。

## 失敗モードと保証

| シナリオ | 動作 | ハード失敗 vs ベストエフォート |
| --- | --- | --- |
| ディスカバリがスロー（ケーパビリティ/設定ロードパス） | ローダーが空のツール + 合成 `.mcp.json` エラーを返す | ベストエフォートでのセッション起動 |
| 無効なサーバー設定 | バリデーションエラーエントリでサーバーをスキップ | サーバーごとのベストエフォート |
| 接続タイムアウト/初期化失敗 | サーバーエラーを記録、他は継続 | サーバーごとのベストエフォート |
| 起動時にキャッシュヒットで `tools/list` がまだ保留中 | 遅延ツールを即座に返す | ベストエフォートの高速起動 |
| 起動時にキャッシュなしで `tools/list` がまだ保留中 | 起動は保留中の完了を待機 | 正確性のためのハード待機 |
| 遅延バックグラウンドツールロード失敗 | 起動ゲート後にログ記録 | ベストエフォートのログ記録 |
| ランタイムでのトランスポート切断 | 自動再接続なし、再接続/リロードまで以降の呼び出しは失敗 | 手動アクションによるベストエフォートのリカバリ |

## パブリックAPIサーフェス

`src/mcp/index.ts` はローダー/マネージャー/クライアントAPIを外部呼び出し元向けに再エクスポートします。`src/sdk.ts` は同じローダー結果のシェイプを返すコンビニエンスラッパーとして `discoverMCPServers()` を公開します。

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
