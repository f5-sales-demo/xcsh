---
title: MCP設定
description: コーディングエージェントランタイムのMCPサーバー設定、バリデーション、および管理。
sidebar:
  order: 1
  label: 設定
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# OMPにおけるMCP設定

このガイドでは、OMPコーディングエージェントのMCPサーバーの追加、編集、およびバリデーションの方法を説明します。

コードにおける情報源:

- ランタイム設定型: `packages/coding-agent/src/mcp/types.ts`
- 設定ライター: `packages/coding-agent/src/mcp/config-writer.ts`
- ローダー + バリデーション: `packages/coding-agent/src/mcp/config.ts`
- スタンドアロン `mcp.json` ディスカバリー: `packages/coding-agent/src/discovery/mcp-json.ts`
- スキーマ: `packages/coding-agent/src/config/mcp-schema.json`

## 推奨される設定ファイルの配置場所

OMPは複数のツール（`.claude/`、`.cursor/`、`.vscode/`、`opencode.json`など）からMCPサーバーを検出できますが、OMPネイティブの設定には通常以下のファイルのいずれかを使用してください:

- プロジェクト: `.xcsh/mcp.json`
- ユーザー: `~/.xcsh/mcp.json`

OMPはプロジェクトルートにあるフォールバック用のスタンドアロンファイルも受け付けます:

- `mcp.json`
- `.mcp.json`

OMPに設定を管理させたい場合は `.xcsh/mcp.json` を使用してください。他のMCPクライアントも読み取れるポータブルなフォールバックファイルが必要な場合のみ、ルートの `mcp.json` / `.mcp.json` を使用してください。

## スキーマ参照の追加

エディターの自動補完とバリデーションのために、ファイルの先頭に以下の行を追加してください:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMPは `/mcp add`、`/mcp enable`、`/mcp disable`、`/mcp reauth`、その他の設定書き込みフローがOMP管理のMCPファイルを作成または更新する際に、これを自動的に書き込むようになりました。

## ファイル構造

OMPは以下のトップレベル構造をサポートしています:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

トップレベルキー:

- `$schema` — ツール用のオプションのJSON Schema URL
- `mcpServers` — サーバー名からサーバー設定へのマップ
- `disabledServers` — 検出されたサーバーを名前で無効にするためのユーザーレベルの拒否リスト

サーバー名は `^[a-zA-Z0-9_.-]{1,100}$` に一致する必要があります。

## サポートされるサーバーフィールド

すべてのトランスポートに共通のフィールド:

- `enabled?: boolean` — `false` の場合、このサーバーをスキップ
- `timeout?: number` — ミリ秒単位の接続タイムアウト
- `auth?: { ... }` — OMPがOAuth/APIキーフローで使用する認証メタデータ
- `oauth?: { ... }` — 認証/再認証時に使用する明示的なOAuthクライアント設定

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
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

これは公式のFilesystem MCPサーバーパッケージ（`@modelcontextprotocol/server-filesystem`）に従っています。

### `http` トランスポート

必須:

- `type: "http"`
- `url: string`

オプション:

- `headers?: Record<string, string>`

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

これはGitHubのホスト型GitHub MCPサーバーエンドポイントに対応しています。

### `sse` トランスポート

必須:

- `type: "sse"`
- `url: string`

オプション:

- `headers?: Record<string, string>`

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` は互換性のためにまだサポートされていますが、MCP仕様では新しいサーバーにはStreamable HTTP（`type: "http"`）を推奨しています。

## 認証フィールド

OMPは2つの認証関連オブジェクトを理解します。

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

OMPがサーバーの資格情報を復元する方法を記憶する必要がある場合に使用します。

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

MCPサーバーが明示的なOAuthクライアント設定を必要とする場合に使用します。

Slackが現在最もわかりやすい例です。SlackのMCPサーバーは `https://mcp.slack.com/mcp` でホストされており、Streamable HTTPを使用し、SlackアプリのクライアントクレデンシャルによるConfidential OAuthを必要とします。

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

Slackのドキュメントに記載されている関連エンドポイント:

- MCPエンドポイント: `https://mcp.slack.com/mcp`
- 認可エンドポイント: `https://slack.com/oauth/v2_user/authorize`
- トークンエンドポイント: `https://slack.com/api/oauth.v2.user.access`

## よく使われるコピー＆ペースト用の例

### stdioによるFilesystemサーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

### HTTP経由のGitHubホスト型サーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Docker経由のGitHubローカルサーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

これはGitHubの公式ローカルDockerイメージ `ghcr.io/github/github-mcp-server` に対応しています。

### OAuth経由のSlackホスト型サーバー

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

この部分は多くの人がつまずくところです。

### `.xcsh/mcp.json` と `~/.xcsh/mcp.json` の場合

OMPがサーバーを起動したりHTTPリクエストを行う前に、`env` と `headers` の値を以下のように解決します:

1. 値が `!` で始まる場合、OMPはそれをシェルコマンドとして実行し、トリムされたstdoutを使用します。
2. それ以外の場合、OMPはまず値が環境変数名に一致するかどうかを確認します。
3. その環境変数が設定されていない場合、OMPは文字列をそのまま使用します。

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

つまり、以下のようにローカルシークレットに対して有効かつ便利です:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → 現在のシェル環境からコピー
- `"Authorization": "Bearer hardcoded-token"` → リテラル値を使用
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → コマンドからヘッダーを構築

### ルートの `mcp.json` と `.mcp.json` の場合

スタンドアロンのフォールバックローダーは、ディスカバリー時に文字列内の `${VAR}` と `${VAR:-default}` も展開します。

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

最も予想外の動作が少ないOMPの挙動を望む場合は、`.xcsh/mcp.json` を優先し、明示的なenv/header値を使用してください。

## `disabledServers`

`disabledServers` は、主にユーザー設定ファイル（`~/.xcsh/mcp.json`）において、他のソースから検出されたサーバーを、そのツールの設定を編集せずにOMPに無視させたい場合に便利です。

例:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` とJSON直接編集の比較

ガイド付きセットアップが必要な場合は `/mcp add` を使用してください。

以下の場合はJSON直接編集を使用してください:

- ウィザードがまだプロンプトしないトランスポートまたは認証オプションが必要な場合
- 別のMCPクライアントからサーバー定義を貼り付けたい場合
- エディターでスキーマベースのバリデーションを使用したい場合

編集後は以下を使用してください:

- `/mcp reload` で現在のセッションでサーバーを再検出して再接続
- `/mcp list` でサーバーがどの設定ファイルから来たかを確認
- `/mcp test <name>` で単一のサーバーをテスト

## OMPが適用するバリデーションルール

`packages/coding-agent/src/mcp/config.ts` の `validateServerConfig()` より:

- `stdio` は `command` を必要とする
- `http` と `sse` は `url` を必要とする
- サーバーは `command` と `url` の両方を設定できない
- 不明な `type` 値は拒否される

実際の影響:

- `type` を省略すると `stdio` になる
- リモートサーバーの設定を貼り付けて `"type": "http"` を忘れると、OMPはそれを `stdio` として扱い、`command` がないと警告する
- `sse` は互換性のために有効だが、新しいホスト型サーバーは通常 `http` として設定すべき

## ディスカバリーと優先順位

OMPはファイル間で重複するサーバー定義をマージしません。ディスカバリープロバイダーには優先順位があり、より高い優先順位の定義が優先されます。

実際の運用では:

- OMP固有のオーバーライドが必要な場合は `.xcsh/mcp.json` または `~/.xcsh/mcp.json` を優先
- 可能であればツール間でサーバー名を一意に保つ
- サードパーティの設定が不要なサーバーを再度追加し続ける場合は、ユーザー設定で `disabledServers` を使用

## トラブルシューティング

### `Server "name": stdio server requires "command" field`

リモートサーバーに `type: "http"` を指定し忘れている可能性があります。

### `Server "name": both "command" and "url" are set`

トランスポートを1つ選択してください。OMPは `command` をstdioとして、`url` をhttp/sseとして扱います。

### `/mcp add` は成功したがサーバーが接続されない

JSONは有効ですが、サーバーに到達できない可能性があります。`/mcp test <name>` を使用して以下を確認してください:

- バイナリまたはDockerイメージが存在するか
- 必要な環境変数が設定されているか
- リモートURLに到達可能か
- OAuthまたはAPIトークンが有効か

### サーバーが他のツールの設定には存在するがOMPにはない

`/mcp list` を実行してください。OMPは多くのサードパーティMCPファイルを検出しますが、プロジェクトレベルの読み込みは `mcp.enableProjectConfig` 設定で無効にすることもできます。

## 参考資料

- MCPトランスポート仕様: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Filesystemサーバーパッケージ: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCPサーバー: <https://github.com/github/github-mcp-server>
- Slack MCPサーバードキュメント: <https://docs.slack.dev/ai/slack-mcp-server/>
