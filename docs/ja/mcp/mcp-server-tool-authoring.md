---
title: MCPサーバーとツールのオーサリング
description: カスタムMCPサーバーの構築とコーディングエージェントへのツール登録に関するガイド。
sidebar:
  order: 4
  label: サーバーとツールのオーサリング
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCPサーバーとツールのオーサリング

このドキュメントでは、MCPサーバー定義がcoding-agentで呼び出し可能な`mcp_*`ツールになる仕組みと、設定が無効・重複・無効化・認証制限されている場合にオペレーターが想定すべき事項について説明します。

## アーキテクチャの概要

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) サーバー設定モデルとバリデーション

`src/mcp/types.ts`は、MCP設定の作成者とランタイムが使用するオーサリング形式を定義しています：

- `stdio`（`type`が未指定の場合のデフォルト）：`command`が必須、`args`、`env`、`cwd`はオプション
- `http`：`url`が必須、`headers`はオプション
- `sse`：`url`が必須、`headers`はオプション（互換性のために維持）
- 共通フィールド：`enabled`、`timeout`、`auth`

`validateServerConfig()`（`src/mcp/config.ts`）はトランスポートの基本を検証します：

- `command`と`url`の両方が設定されている場合は拒否
- stdioには`command`が必須
- http/sseには`url`が必須
- 不明な`type`は拒否

`config-writer.ts`は追加/更新操作にこのバリデーションを適用し、サーバー名も検証します：

- 空でないこと
- 最大100文字
- `[a-zA-Z0-9_.-]`のみ使用可能

### トランスポートの落とし穴

- `type`を省略するとstdioになります。HTTP/SSEを意図していて`type`を省略した場合、`command`が必須になります。
- `sse`は引き続き受け入れられますが、内部的にはHTTPトランスポートとして扱われます（`createHttpTransport`）。
- バリデーションは構造的なものであり、到達可能性は検証しません：構文的に有効なURLでも接続時に失敗する可能性があります。

## 2) ディスカバリ、正規化、優先順位

### ケイパビリティベースのディスカバリ

`loadAllMCPConfigs()`（`src/mcp/config.ts`）は`loadCapability(mcpCapability.id)`を通じて正規の`MCPServer`アイテムを読み込みます。

ケイパビリティレイヤー（`src/capability/index.ts`）は以下を実行します：

1. プロバイダーを優先順位順に読み込み
2. `server.name`で重複排除（最初の一致 = 最高優先順位が勝利）
3. 重複排除されたアイテムを検証

結果：異なるソース間で重複するサーバー名はマージされません。1つの定義が勝ち、優先順位の低い重複はシャドウイングされます。

### `.mcp.json`および関連ファイル

`src/discovery/mcp-json.ts`の専用フォールバックプロバイダーは、プロジェクトルートの`mcp.json`と`.mcp.json`を読み取ります（低優先順位）。

実際には、MCPサーバーはより高い優先順位のプロバイダーからも提供されます（例：ネイティブの`.xcsh/...`やツール固有の設定ディレクトリ）。オーサリングのガイダンス：

- 明示的な制御には`.xcsh/mcp.json`（プロジェクト）または`~/.xcsh/mcp.json`（ユーザー）を推奨します。
- フォールバック互換性が必要な場合はルートの`mcp.json` / `.mcp.json`を使用してください。
- 複数のソースで同じサーバー名を再利用すると、マージではなく優先順位によるシャドウイングが発生します。

### 正規化の動作

`convertToLegacyConfig()`（`src/mcp/config.ts`）は正規の`MCPServer`をランタイムの`MCPServerConfig`にマッピングします。

主な動作：

- トランスポートは`server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`として推論
- 無効なサーバー（`enabled === false`）は接続前に除外
- オプションフィールドは存在する場合に保持

### ディスカバリ時の環境変数展開

`mcp-json.ts`は`expandEnvVarsDeep()`を使用して文字列フィールドの環境変数プレースホルダーを展開します：

- `${VAR}`および`${VAR:-default}`をサポート
- 未解決の値はリテラル文字列`${VAR}`のまま残ります

`mcp-json.ts`はまた、ユーザーJSONに対してランタイムの型チェックを実行し、無効な`enabled`/`timeout`値についてはファイル全体をハードフェイルさせるのではなく警告をログに記録します。

## 3) 認証とランタイム値の解決

`MCPManager.prepareConfig()`/`#resolveAuthConfig()`（`src/mcp/manager.ts`）は接続前の最終パスです。

### OAuth資格情報の注入

設定に以下がある場合：

```ts
auth: { type: "oauth", credentialId: "..." }
```

かつ認証ストレージに資格情報が存在する場合：

- `http`/`sse`：`Authorization: Bearer <access_token>`ヘッダーを注入
- `stdio`：`OAUTH_ACCESS_TOKEN`環境変数を注入

資格情報の検索に失敗した場合、マネージャーは警告をログに記録し、未解決の認証のまま続行します。

### ヘッダー/環境変数値の解決

接続前に、マネージャーは`resolveConfigValue()`（`src/config/resolve-config-value.ts`）を使用して各ヘッダー/環境変数値を解決します：

- `!`で始まる値 => シェルコマンドを実行し、トリムされたstdoutを使用（キャッシュあり）
- それ以外の場合、まず環境変数名として扱い（`process.env[name]`）、フォールバックとしてリテラル値を使用
- 未解決のコマンド/環境変数値は最終的なヘッダー/環境変数マップから省略

運用上の注意事項：これは、誤って入力されたシークレットコマンド/環境変数キーがそのヘッダー/環境変数エントリを暗黙的に削除し、下流で401/403やサーバー起動失敗を引き起こす可能性があることを意味します。

## 4) ツールブリッジ：MCP -> エージェント呼び出し可能ツール

`src/mcp/tool-bridge.ts`はMCPツール定義を`CustomTool`に変換します。

### 命名と衝突ドメイン

ツール名は以下の形式で生成されます：

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

ルール：

- 小文字化
- `[a-z_]`以外の文字は`_`に変換
- 連続するアンダースコアは折りたたみ
- ツール名内の冗長な`<server>_`プレフィックスは1回除去

これにより多くの衝突は回避されますが、すべてではありません。異なる元の名前が同じ識別子にサニタイズされる可能性があり（例：`my-server`と`my.server`は同様にサニタイズされる）、レジストリへの挿入は後勝ちです。

### スキーママッピング

`convertSchema()`はMCP JSON Schemaをほぼそのまま保持しますが、プロバイダーの互換性のために`properties`が欠けているオブジェクトスキーマに`{}`をパッチします。

### 実行マッピング

`MCPTool.execute()` / `DeferredMCPTool.execute()`：

- MCP `tools/call`を呼び出し
- MCPコンテンツを表示可能なテキストにフラット化
- 構造化された詳細（`serverName`、`mcpToolName`、プロバイダーメタデータ）を返却
- サーバーが報告した`isError`を`Error: ...`テキスト結果にマッピング
- スローされたトランスポート/ランタイム障害を`MCP error: ...`にマッピング
- AbortErrorを`ToolAbortError`に変換してアボートセマンティクスを保持

## 5) オペレーターのライフサイクル：追加/編集/削除とライブ更新

インタラクティブモードでは`src/modes/controllers/mcp-command-controller.ts`で`/mcp`が公開されています。

サポートされる操作：

- `add`（ウィザードまたはクイック追加）
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

設定の書き込みはアトミックです（`writeMCPConfigFile`：一時ファイル + リネーム）。

変更後、コントローラーは`#reloadMCP()`を呼び出します：

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()`はすべての`mcp_`レジストリエントリを置き換え、最新のMCPツールセットを即座に再有効化するため、セッションを再起動せずに変更が反映されます。

### モードの違い

- **インタラクティブ/TUIモード**：`/mcp`がアプリ内UX（ウィザード、OAuthフロー、接続ステータステキスト、即時ランタイムバインディング）を提供します。
- **SDK/ヘッドレス統合**：`discoverAndLoadMCPTools()`（`src/mcp/loader.ts`）が読み込まれたツール + サーバーごとのエラーを返します。`/mcp`コマンドUXはありません。

## 6) ユーザーに表示されるエラー画面

ユーザー/オペレーターに表示される一般的なエラー文字列：

- 追加/更新のバリデーション失敗：
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- クイック追加の引数の問題：
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- 接続/テストの失敗：
  - `Failed to connect to "<name>": <message>`
  - タイムアウトのヘルプテキストはタイムアウト値の増加を提案
  - `401/403`に対する認証ヘルプテキスト
- 認証/OAuthフロー：
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- 無効化されたサーバーの使用：
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

ディスカバリ時の不正なソースJSONは一般的に警告/ログとして処理されます。config-writerのパスは明示的なエラーをスローします。

## 7) 実践的なオーサリングガイダンス

このコードベースで堅牢なMCPオーサリングを行うために：

1. すべてのMCP対応設定ソース間でサーバー名をグローバルにユニークに保ちます。
2. 生成される`mcp_*`ツール名でのサニタイズ名の衝突を避けるため、英数字/アンダースコアの名前を推奨します。
3. 意図しないstdioデフォルトを避けるために、明示的な`type`を使用します。
4. `enabled: false`はハードオフとして扱われます：サーバーはランタイムの接続セットから除外されます。
5. OAuth設定には有効な`credentialId`を保存します。そうしないと認証注入がスキップされます。
6. コマンドベースのシークレット解決（`!cmd`）を使用する場合、コマンド出力が安定していて空でないことを確認します。

## 実装ファイル

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
