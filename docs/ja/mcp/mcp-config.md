---
title: MCP 設定
description: コーディングエージェントランタイムのための MCP サーバー設定、バリデーション、および管理。
sidebar:
  order: 1
  label: 設定
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# OMP における MCP 設定

このガイドでは、OMP コーディングエージェントの MCP サーバーの追加、編集、およびバリデーション方法について説明します。

コード内の信頼できる情報源:

- ランタイム設定の型: `packages/coding-agent/src/mcp/types.ts`
- 設定ライター: `packages/coding-agent/src/mcp/config-writer.ts`
- ローダー + バリデーション: `packages/coding-agent/src/mcp/config.ts`
- スタンドアロン `mcp.json` ディスカバリ: `packages/coding-agent/src/discovery/mcp-json.ts`
- スキーマ: `packages/coding-agent/src/config/mcp-schema.json`

## 推奨される設定ファイルの場所

OMP は複数のツール（`.claude/`、`.cursor/`、`.vscode/`、`opencode.json` など）から MCP サーバーを検出できますが、OMP ネイティブの設定には通常以下のいずれかのファイルを使用してください:

- プロジェクト: `.xcsh/mcp.json`
- ユーザー: `~/.xcsh/mcp.json`

OMP はプロジェクトルートにあるフォールバック用スタンドアロンファイルも受け付けます:

- `mcp.json`
- `.mcp.json`

OMP に設定を管理させたい場合は `.xcsh/mcp.json` を使用してください。他の MCP クライアントも読み取る可能性のあるポータブルなフォールバックファイルが必要な場合にのみ、ルートの `mcp.json` / `.mcp.json` を使用してください。

## スキーマ参照の追加

エディターの自動補完とバリデーションのために、ファイルの先頭に以下の行を追加します:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP は `/mcp add`、`/mcp enable`、`/mcp disable`、`/mcp reauth`、またはその他の設定書き込みフローが OMP 管理の MCP ファイルを作成または更新する際に、これを自動的に書き込むようになりました。

## ファイル構造

OMP は以下のトップレベル構造をサポートしています:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

トップレベルのキー:

- `$schema` — ツール向けのオプションの JSON Schema URL
- `mcpServers` — サーバー名からサーバー設定へのマップ
- `disabledServers` — 検出されたサーバーを名前で無効にするためのユーザーレベルの拒否リスト

サーバー名は `^[a-zA-Z0-9_.-]{1,100}$` にマッチする必要があります。

## サポートされるサーバーフィールド

すべてのトランスポートで共通のフィールド:

- `enabled?: boolean` — `false` の場合、このサーバーをスキップ
- `timeout?: number` — ミリ秒単位の接続タイムアウト
- `auth?: { ... }` — OMP が OAuth/API キーフローに使用する認証メタデータ
- `oauth?: { ... }` — 認証/再認証時に使用される明示的な OAuth クライアント設定

### `stdio` トランスポート

`type` が省略された場合、`stdio` がデフォルトです。

必須:

- `command: string`

オプション:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

これは公式の Filesystem MCP サーバーパッケージ（`@modelcontextprotocol/server-filesystem`）に従っています。

### `http` トランスポート

必須:

- `type: "http"`
- `url: string`

オプション:

- `headers?: Record<string, string>`

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

これは GitHub のホスティングされた GitHub MCP サーバーエンドポイントに対応しています。

### `sse` トランスポート

必須:

- `type: "sse"`
- `url: string`

オプション:

- `headers?: Record<string, string>`

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` は互換性のためにまだサポートされていますが、MCP 仕様では新しいサーバーには Streamable HTTP（`type: "http"`）が推奨されています。

## 認証フィールド

OMP は 2 つの認証関連オブジェクトを理解します。

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

OMP がサーバーの資格情報を復元する方法を記憶する必要がある場合に使用します。

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

MCP サーバーが明示的な OAuth クライアント設定を必要とする場合に使用します。

Slack が現在最もわかりやすい例です。Slack の MCP サーバーは `https://mcp.slack.com/mcp` でホスティングされ、Streamable HTTP を使用し、Slack アプリのクライアント資格情報を使用した機密 OAuth を必要とします。

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

Slack のドキュメントに記載されている関連エンドポイント:

- MCP エンドポイント: `https://mcp.slack.com/mcp`
- 認可エンドポイント: `https://slack.com/oauth/v2_user/authorize`
- トークンエンドポイント: `https://slack.com/api/oauth.v2.user.access`

## よく使うコピペ用の例

### stdio 経由のファイルシステムサーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### HTTP 経由の GitHub ホスティングサーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Docker 経由の GitHub ローカルサーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

これは GitHub の公式ローカル Docker イメージ `ghcr.io/github/github-mcp-server` に対応しています。

### OAuth 経由の Slack ホスティングサーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## シークレットと変数の解決

ここが多くの人がつまずくポイントです。

### `.xcsh/mcp.json` および `~/.xcsh/mcp.json` の場合

OMP がサーバーを起動したり HTTP リクエストを行う前に、`env` と `headers` の値を以下のように解決します:

1. 値が `!` で始まる場合、OMP はそれをシェルコマンドとして実行し、トリムされた stdout を使用します。
2. それ以外の場合、OMP はまず値が環境変数名に一致するかどうかを確認します。
3. その環境変数が設定されていない場合、OMP は文字列をそのまま使用します。

例:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

これは、ローカルシークレットに対して以下のように有効で便利であることを意味します:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → 現在のシェル環境からコピー
- `"Authorization": "Bearer hardcoded-token"` → リテラル値を使用
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → コマンドからヘッダーを構築

### ルートの `mcp.json` および `.mcp.json` の場合

スタンドアロンのフォールバックローダーは、ディスカバリ中に文字列内の `${VAR}` および `${VAR:-default}` も展開します。

例:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

最も予測しやすい OMP の動作を求める場合は、`.xcsh/mcp.json` を使用し、明示的な env/header 値を使用してください。

## `disabledServers`

`disabledServers` は主にユーザー設定ファイル（`~/.xcsh/mcp.json`）で、他のソースから検出されたサーバーを、そのツールの設定を編集せずに OMP に無視させたい場合に便利です。

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` と JSON の直接編集

ガイド付きセットアップが必要な場合は `/mcp add` を使用してください。

以下の場合は JSON の直接編集を使用してください:

- ウィザードがまだプロンプトしないトランスポートや認証オプションが必要な場合
- 他の MCP クライアントからサーバー定義を貼り付けたい場合
- エディターでスキーマベースのバリデーションを利用したい場合

編集後は以下を使用してください:

- `/mcp reload` で現在のセッションでサーバーを再検出して再接続
- `/mcp list` でサーバーがどの設定ファイルから来たかを確認
- `/mcp test <name>` で単一のサーバーをテスト

## OMP が適用するバリデーションルール

`packages/coding-agent/src/mcp/config.ts` の `validateServerConfig()` より:

- `stdio` は `command` を必要とする
- `http` と `sse` は `url` を必要とする
- サーバーは `command` と `url` の両方を設定できない
- 不明な `type` 値は拒否される

実用的な影響:

- `type` を省略すると `stdio` になる
- リモートサーバーの設定を貼り付けて `"type": "http"` を忘れると、OMP はそれを `stdio` として扱い、`command` がないことについてエラーを出す
- `sse` は互換性のために有効だが、新しいホスティングサーバーは通常 `http` として設定すべき

## ディスカバリと優先順位

OMP はファイル間で重複するサーバー定義をマージしません。ディスカバリプロバイダーには優先順位があり、より高い優先順位の定義が優先されます。

実際には:

- OMP 固有のオーバーライドが必要な場合は `.xcsh/mcp.json` または `~/.xcsh/mcp.json` を使用する
- 可能な限りツール間でサーバー名を一意に保つ
- サードパーティの設定が不要なサーバーを繰り返し導入する場合は、ユーザー設定の `disabledServers` を使用する

## トラブルシューティング

### `Server "name": stdio server requires "command" field`

リモートサーバーに `type: "http"` を付け忘れている可能性があります。

### `Server "name": both "command" and "url" are set`

トランスポートを 1 つ選択してください。OMP は `command` を stdio として、`url` を http/sse として扱います。

### `/mcp add` は成功したがサーバーにまだ接続できない

JSON は有効ですが、サーバーに到達できない可能性があります。`/mcp test <name>` を使用して以下を確認してください:

- バイナリまたは Docker イメージが存在するか
- 必要な環境変数が設定されているか
- リモート URL に到達可能か
- OAuth または API トークンが有効か

### サーバーが他のツールの設定に存在するが OMP には表示されない

`/mcp list` を実行してください。OMP は多くのサードパーティの MCP ファイルを検出しますが、プロジェクトレベルのロードは `mcp.enableProjectConfig` 設定で無効にすることもできます。

## 参考資料

- MCP トランスポート仕様: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Filesystem サーバーパッケージ: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP サーバー: <https://github.com/github/github-mcp-server>
- Slack MCP サーバーのドキュメント: <https://docs.slack.dev/ai/slack-mcp-server/>
