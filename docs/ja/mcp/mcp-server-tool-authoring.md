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

このドキュメントでは、MCPサーバー定義がコーディングエージェントで呼び出し可能な `mcp_*` ツールになる仕組みと、設定が無効、重複、無効化、または認証ゲートされている場合にオペレーターが想定すべきことについて説明します。

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

`src/mcp/types.ts` は、MCP設定作成者とランタイムが使用するオーサリングシェイプを定義しています：

- `stdio`（`type` が未指定の場合のデフォルト）：`command` が必須、`args`、`env`、`cwd` はオプション
- `http`：`url` が必須、`headers` はオプション
- `sse`：`url` が必須、`headers` はオプション（互換性のために維持）
- 共通フィールド：`enabled`、`timeout`、`auth`

`validateServerConfig()`（`src/mcp/config.ts`）はトランスポートの基本を検証します：

- `command` と `url` の両方を設定している設定を拒否
- stdio には `command` が必須
- http/sse には `url` が必須
- 不明な `type` を拒否

`config-writer.ts` は追加/更新操作にこのバリデーションを適用し、サーバー名も検証します：

- 空でないこと
- 最大100文字
- `[a-zA-Z0-9_.-]` のみ使用可能

### トランスポートの落とし穴

- `type` を省略するとstdioになります。HTTP/SSEを意図していたのに `type` を省略した場合、`command` が必須になります。
- `sse` は引き続き受け入れられますが、内部的にはHTTPトランスポートとして扱われます（`createHttpTransport`）。
- バリデーションは構造的なものであり、到達可能性を検証するものではありません：構文的に正しいURLでも接続時に失敗する可能性があります。

## 2) ディスカバリ、正規化、および優先順位

### ケイパビリティベースのディスカバリ

`loadAllMCPConfigs()`（`src/mcp/config.ts`）は `loadCapability(mcpCapability.id)` を通じて正規の `MCPServer` アイテムを読み込みます。

ケイパビリティレイヤー（`src/capability/index.ts`）は次の処理を行います：

1. 優先順位の順にプロバイダーを読み込む
2. `server.name` で重複を排除（最初の一致 = 最高優先順位）
3. 重複排除されたアイテムを検証

結果：ソース間で重複するサーバー名はマージされません。1つの定義が採用され、優先度の低い重複はシャドウイングされます。

### `.mcp.json` と関連ファイル

`src/discovery/mcp-json.ts` の専用フォールバックプロバイダーは、プロジェクトルートの `mcp.json` と `.mcp.json`（低優先度）を読み取ります。

実際には、MCPサーバーはより高い優先度のプロバイダー（例えばネイティブの `.xcsh/...` やツール固有の設定ディレクトリ）からも提供されます。オーサリングのガイダンス：

- 明示的な制御には `.xcsh/mcp.json`（プロジェクト）または `~/.xcsh/mcp.json`（ユーザー）を推奨します。
- フォールバック互換性が必要な場合は、ルートの `mcp.json` / `.mcp.json` を使用してください。
- 複数のソースで同じサーバー名を再利用すると、マージではなく優先順位によるシャドウイングが発生します。

### 正規化の動作

`convertToLegacyConfig()`（`src/mcp/config.ts`）は正規の `MCPServer` をランタイムの `MCPServerConfig` にマッピングします。

主要な動作：

- トランスポートは `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")` として推論
- 無効化されたサーバー（`enabled === false`）は接続前にドロップ
- オプションフィールドは存在する場合に保持

### ディスカバリ時の環境変数展開

`mcp-json.ts` は `expandEnvVarsDeep()` を使用して文字列フィールド内の環境変数プレースホルダーを展開します：

- `${VAR}` と `${VAR:-default}` をサポート
- 未解決の値はリテラルの `${VAR}` 文字列のまま残る

`mcp-json.ts` はユーザーJSONに対してランタイム型チェックも実行し、無効な `enabled`/`timeout` 値についてはファイル全体をハードフェイルさせるのではなく警告をログに記録します。

## 3) 認証とランタイム値の解決

`MCPManager.prepareConfig()`/`#resolveAuthConfig()`（`src/mcp/manager.ts`）は接続前の最終パスです。

### OAuthクレデンシャルの注入

設定に以下がある場合：

```ts
auth: { type: "oauth", credentialId: "..." }
```

かつ認証ストレージにクレデンシャルが存在する場合：

- `http`/`sse`：`Authorization: Bearer <access_token>` ヘッダーを注入
- `stdio`：`OAUTH_ACCESS_TOKEN` 環境変数を注入

クレデンシャルの検索に失敗した場合、マネージャーは警告をログに記録し、未解決の認証のまま処理を続行します。

### ヘッダー/環境変数の値解決

接続前に、マネージャーは `resolveConfigValue()`（`src/config/resolve-config-value.ts`）を通じて各ヘッダー/環境変数の値を解決します：

- `!` で始まる値 => シェルコマンドを実行し、トリムされたstdoutを使用（キャッシュ）
- それ以外の場合、まず環境変数名として扱い（`process.env[name]`）、フォールバックとしてリテラル値を使用
- 未解決のコマンド/環境変数の値は最終的なヘッダー/環境変数マップから省略される

運用上の注意：これは、誤ったシークレットコマンド/環境変数キーがそのヘッダー/環境変数エントリを暗黙的に削除する可能性があることを意味し、ダウンストリームの401/403やサーバー起動の失敗を引き起こす可能性があります。

## 4) ツールブリッジ：MCP -> エージェント呼び出し可能ツール

`src/mcp/tool-bridge.ts` はMCPツール定義を `CustomTool` に変換します。

### 命名と衝突ドメイン

ツール名は以下の形式で生成されます：

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

ルール：

- 小文字化
- `[a-z_]` 以外の文字は `_` に変換
- 連続するアンダースコアは1つに集約
- ツール名内の冗長な `<server>_` プレフィックスは1回除去

これにより多くの衝突が回避されますが、すべてではありません。異なる元の名前が同じ識別子にサニタイズされる可能性があります（例えば `my-server` と `my.server` はどちらも同様にサニタイズされます）。レジストリへの挿入は後勝ち（last-write-wins）です。

### スキーママッピング

`convertSchema()` はMCP JSON Schemaをほぼそのまま保持しますが、`properties` が欠落しているオブジェクトスキーマにプロバイダー互換性のため `{}` をパッチします。

### 実行マッピング

`MCPTool.execute()` / `DeferredMCPTool.execute()`：

- MCP `tools/call` を呼び出す
- MCPコンテンツを表示可能なテキストにフラット化
- 構造化された詳細を返す（`serverName`、`mcpToolName`、プロバイダーメタデータ）
- サーバーが報告する `isError` を `Error: ...` テキスト結果にマッピング
- スローされたトランスポート/ランタイムの障害を `MCP error: ...` にマッピング
- AbortErrorを `ToolAbortError` に変換してアボートセマンティクスを保持

## 5) オペレーターのライフサイクル：追加/編集/削除とライブ更新

インタラクティブモードは `src/modes/controllers/mcp-command-controller.ts` で `/mcp` を公開します。

サポートされる操作：

- `add`（ウィザードまたはクイック追加）
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

設定の書き込みはアトミックです（`writeMCPConfigFile`：一時ファイル + リネーム）。

変更後、コントローラーは `#reloadMCP()` を呼び出します：

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` はすべての `mcp_` レジストリエントリを置換し、最新のMCPツールセットを即座に再アクティブ化するため、セッションを再起動せずに変更が反映されます。

### モードの違い

- **インタラクティブ/TUIモード**：`/mcp` はアプリ内UX（ウィザード、OAuthフロー、接続ステータステキスト、即座のランタイム再バインディング）を提供します。
- **SDK/ヘッドレス統合**：`discoverAndLoadMCPTools()`（`src/mcp/loader.ts`）は読み込まれたツール + サーバーごとのエラーを返します。`/mcp` コマンドUXはありません。

## 6) ユーザーに表示されるエラー面

ユーザー/オペレーターが目にする一般的なエラー文字列：

- 追加/更新のバリデーション失敗：
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- クイック追加の引数の問題：
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- 接続/テストの失敗：
  - `Failed to connect to "<name>": <message>`
  - タイムアウトのヘルプテキストはタイムアウトの増加を提案
  - `401/403` の認証ヘルプテキスト
- 認証/OAuthフロー：
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- 無効化されたサーバーの使用：
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

ディスカバリでの不正なソースJSONは一般的に警告/ログとして処理されます。config-writerのパスは明示的なエラーをスローします。

## 7) 実践的なオーサリングガイダンス

このコードベースでの堅牢なMCPオーサリングのために：

1. すべてのMCP対応設定ソース間でサーバー名をグローバルに一意に保つ。
2. 生成される `mcp_*` ツール名でのサニタイズ名の衝突を避けるため、英数字/アンダースコアの名前を推奨。
3. 意図しないstdioデフォルトを避けるため、明示的な `type` を使用する。
4. `enabled: false` はハードオフとして扱う：サーバーはランタイム接続セットから除外される。
5. OAuth設定の場合、有効な `credentialId` を保存する。そうしないと認証の注入はスキップされる。
6. コマンドベースのシークレット解決（`!cmd`）を使用する場合、コマンド出力が安定しており空でないことを確認する。

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
