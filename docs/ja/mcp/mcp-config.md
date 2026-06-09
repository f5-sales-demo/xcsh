---
title: MCP 設定
description: コーディングエージェントランタイムにおける MCP サーバーの設定、バリデーション、および管理。
sidebar:
  order: 1
  label: 設定
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# OMP における MCP 設定

このガイドでは、OMP コーディングエージェント用の MCP サーバーの追加、編集、バリデーション方法について説明します。

コード内の正式なソース：

- ランタイム設定の型: `packages/coding-agent/src/mcp/types.ts`
- 設定ライター: `packages/coding-agent/src/mcp/config-writer.ts`
- ローダー + バリデーション: `packages/coding-agent/src/mcp/config.ts`
- スタンドアロン `mcp.json` の検出: `packages/coding-agent/src/discovery/mcp-json.ts`
- スキーマ: `packages/coding-agent/src/config/mcp-schema.json`

## 推奨される設定ファイルの場所

OMP は複数のツール（`.claude/`、`.cursor/`、`.vscode/`、`opencode.json` など）から MCP サーバーを検出できますが、OMP ネイティブの設定には通常、以下のファイルのいずれかを使用してください：

- プロジェクト: `.xcsh/mcp.json`
- ユーザー: `~/.xcsh/mcp.json`

OMP はプロジェクトルートにあるフォールバック用スタンドアロンファイルも受け付けます：

- `mcp.json`
- `.mcp.json`

OMP が設定を管理するようにしたい場合は `.xcsh/mcp.json` を使用してください。他の MCP クライアントも読み取る可能性のあるポータブルなフォールバックファイルが必要な場合にのみ、ルートの `mcp.json` / `.mcp.json` を使用してください。

## スキーマ参照の追加

エディターの自動補完とバリデーションのために、ファイルの先頭に以下の行を追加してください：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP は `/mcp add`、`/mcp enable`、`/mcp disable`、`/mcp reauth`、またはその他の設定書き込みフローが OMP 管理の MCP ファイルを作成または更新する際に、これを自動的に書き込むようになりました。

## ファイル構造

OMP は以下のトップレベル構造をサポートしています：

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

トップレベルのキー：

- `$schema` — ツール向けのオプションの JSON Schema URL
- `mcpServers` — サーバー名からサーバー設定へのマップ
- `disabledServers` — 検出されたサーバーを名前で無効にするためのユーザーレベルの拒否リスト

サーバー名は `^[a-zA-Z0-9_.-]{1,100}$` に一致する必要があります。

## サポートされているサーバーフィールド

すべてのトランスポートで共通のフィールド：

- `enabled?: boolean` — `false` の場合、このサーバーをスキップ
- `timeout?: number` — 接続タイムアウト（ミリ秒）
- `auth?: { ... }` — OMP が OAuth/API キーフローに使用する認証メタデータ
- `oauth?: { ... }` — 認証/再認証時に使用される明示的な OAuth クライアント設定

### `stdio` トランスポート

`type` が省略された場合、`stdio` がデフォルトです。

必須：

- `command: string`

オプション：

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

例：

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

これは公式の Filesystem MCP サーバーパッケージ（`@modelcontextprotocol/server-filesystem`）に準拠しています。

### `http` トランスポート

必須：

- `type: "http"`
- `url: string`

オプション：

- `headers?: Record<string, string>`

例：

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

これは GitHub のホスト型 GitHub MCP サーバーエンドポイントに対応しています。

### `sse` トランスポート

必須：

- `type: "sse"`
- `url: string`

オプション：

- `headers?: Record<string, string>`

例：

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

`sse` は互換性のために引き続きサポートされていますが、MCP 仕様では新しいサーバーには Streamable HTTP（`type: "http"`）を推奨しています。

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

OMP がサーバーの認証情報を復元する方法を記憶する必要がある場合に使用します。

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

Slack が現在最もわかりやすい例です。Slack の MCP サーバーは `https://mcp.slack.com/mcp` でホストされ、Streamable HTTP を使用し、Slack アプリのクライアント認証情報を使用した機密 OAuth を必要とします。

例：

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

Slack のドキュメントから関連する Slack エンドポイント：

- MCP エンドポイント: `https://mcp.slack.com/mcp`
- 認可エンドポイント: `https://slack.com/oauth/v2_user/authorize`
- トークンエンドポイント: `https://slack.com/api/oauth.v2.user.access`

## コピー＆ペースト用の一般的な例

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

### HTTP 経由の GitHub ホスト型サーバー

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

### OAuth 経由の Slack ホスト型サーバー

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

ここが通常、人々がつまずく部分です。

### `.xcsh/mcp.json` および `~/.xcsh/mcp.json` の場合

OMP がサーバーを起動したり HTTP リクエストを送信したりする前に、`env` および `headers` の値を以下のように解決します：

1. 値が `!` で始まる場合、OMP はそれをシェルコマンドとして実行し、トリムされた stdout を使用します。
2. それ以外の場合、OMP はまず値が環境変数名と一致するかどうかを確認します。
3. その環境変数が設定されていない場合、OMP は文字列をそのまま使用します。

例：

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

これにより、以下のことがローカルシークレットに対して有効かつ便利になります：

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → 現在のシェル環境からコピー
- `"Authorization": "Bearer hardcoded-token"` → リテラル値を使用
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → コマンドからヘッダーを構築

### ルートの `mcp.json` および `.mcp.json` の場合

スタンドアロンのフォールバックローダーは、検出時に文字列内の `${VAR}` および `${VAR:-default}` も展開します。

例：

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

OMP の動作を最も予測しやすくしたい場合は、`.xcsh/mcp.json` を使用し、明示的な env/header 値を使用することを推奨します。

## `disabledServers`

`disabledServers` は主に、他のソースからサーバーが検出されているが、そのツールの設定を編集せずに OMP にそれを無視させたい場合に、ユーザー設定ファイル（`~/.xcsh/mcp.json`）で使用すると便利です。

例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` と JSON の直接編集

ガイド付きセットアップが必要な場合は `/mcp add` を使用してください。

以下の場合は JSON を直接編集してください：

- ウィザードがまだプロンプトしていないトランスポートまたは認証オプションが必要な場合
- 他の MCP クライアントからサーバー定義を貼り付けたい場合
- エディターでスキーマに基づくバリデーションを使用したい場合

編集後は以下を使用してください：

- `/mcp reload` — 現在のセッションでサーバーを再検出し再接続
- `/mcp list` — サーバーがどの設定ファイルから来たかを確認
- `/mcp test <name>` — 単一のサーバーをテスト

## OMP が適用するバリデーションルール

`packages/coding-agent/src/mcp/config.ts` の `validateServerConfig()` より：

- `stdio` には `command` が必要
- `http` と `sse` には `url` が必要
- サーバーは `command` と `url` の両方を設定できない
- 不明な `type` 値は拒否される

実用上の注意点：

- `type` を省略すると `stdio` になる
- リモートサーバーの設定を貼り付けて `"type": "http"` を忘れた場合、OMP はそれを `stdio` として扱い、`command` がないとエラーを出す
- `sse` は互換性のために有効なままだが、新しいホスト型サーバーは通常 `http` として設定すべき

## 検出と優先順位

OMP はファイル間で重複するサーバー定義をマージしません。検出プロバイダーには優先順位が付けられ、優先順位の高い定義が優先されます。

実際の運用において：

- OMP 固有のオーバーライドが必要な場合は `.xcsh/mcp.json` または `~/.xcsh/mcp.json` を使用
- 可能な限りツール間でサーバー名を一意に保つ
- サードパーティの設定が不要なサーバーを繰り返し導入する場合は、ユーザー設定で `disabledServers` を使用

## トラブルシューティング

### `Server "name": stdio server requires "command" field`

リモートサーバーで `type: "http"` を省略した可能性があります。

### `Server "name": both "command" and "url" are set`

トランスポートを 1 つ選択してください。OMP は `command` を stdio、`url` を http/sse として扱います。

### `/mcp add` は成功したがサーバーに接続できない

JSON は有効ですが、サーバーにまだ到達できない可能性があります。`/mcp test <name>` を使用して以下を確認してください：

- バイナリまたは Docker イメージが存在するか
- 必要な環境変数が設定されているか
- リモート URL に到達可能か
- OAuth または API トークンが有効か

### サーバーが他のツールの設定には存在するが OMP には表示されない

`/mcp list` を実行してください。OMP は多くのサードパーティ MCP ファイルを検出しますが、プロジェクトレベルの読み込みは `mcp.enableProjectConfig` 設定で無効にすることもできます。

## 参考資料

- MCP トランスポート仕様: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Filesystem サーバーパッケージ: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP サーバー: <https://github.com/github/github-mcp-server>
- Slack MCP サーバードキュメント: <https://docs.slack.dev/ai/slack-mcp-server/>
