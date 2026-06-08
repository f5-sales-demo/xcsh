---
title: マーケットプレイスプラグインシステム
description: 厳選されたプラグインコレクションの検出、インストール、管理のためのマーケットプレイスプラグインシステム。
sidebar:
  order: 4
  label: マーケットプレイス
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# マーケットプレイスプラグインシステム

マーケットプレイスシステムを使用すると、Gitでホストされたカタログからプラグインを検出、インストール、管理できます。Claude Codeプラグインレジストリ形式と互換性があります。

## クイックスタート

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

または、引数なしで `/marketplace` と入力するだけで、インタラクティブなプラグインブラウザが開きます。

## コンセプト

**マーケットプレイス**とは、`.xcsh-plugin/marketplace.json` にカタログファイルを含むGitリポジトリ（またはローカルディレクトリ）です。カタログには、利用可能なプラグインとそのソース、説明、メタデータが一覧されています。

**プラグイン**とは、スキル、コマンド、フック、MCPサーバー、またはLSPサーバーを含むディレクトリです。プラグインは `name@marketplace` で識別されます（例: `code-review@f5xc-salesdemos-marketplace`）。

**スコープ**: プラグインは2つのスコープでインストールできます:

- **user**（デフォルト）-- すべてのプロジェクトで利用可能、`~/.xcsh/plugins/installed_plugins.json` に保存
- **project** -- 現在のプロジェクトでのみ利用可能、`.xcsh/installed_plugins.json` に保存

プロジェクトスコープのインストールは、同じプラグインのユーザースコープのインストールをシャドウ（上書き）します。

## コマンド

### インタラクティブモード

| コマンド | 効果 |
|---|---|
| `/marketplace` | インタラクティブなプラグインブラウザを開く（インストール） |

### マーケットプレイス管理

| コマンド | 効果 |
|---|---|
| `/marketplace add <source>` | マーケットプレイスソースを追加 |
| `/marketplace remove <name>` | マーケットプレイスを削除 |
| `/marketplace update [name]` | カタログを再取得。名前を省略するとすべて更新 |
| `/marketplace list` | 設定済みのマーケットプレイスを一覧表示 |

### プラグイン操作

| コマンド | 効果 |
|---|---|
| `/marketplace discover [marketplace]` | 利用可能なプラグインを閲覧 |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | プラグインをインストール |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | プラグインをアンインストール |
| `/marketplace installed` | インストール済みのマーケットプレイスプラグインを一覧表示 |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | 1つまたはすべてのプラグインをアップグレード |

### CLI相当コマンド

同じ操作はコマンドラインからも利用できます:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## マーケットプレイスソース

`/marketplace add <source>` を実行すると、システムがソースを分類します:

| ソース形式 | タイプ | 例 |
|---|---|---|
| `owner/repo` | GitHub省略形 | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | カタログ直接URL | `https://example.com/marketplace.json` |
| `https://...*.git` or `git@...` | Gitリポジトリ | `https://github.com/org/repo.git` |
| `./path` or `~/path` or `/path` | ローカルディレクトリ | `./my-marketplace` |

システムはリポジトリをクローン（またはローカルディレクトリを読み取り）し、`.xcsh-plugin/marketplace.json` を見つけて検証し、カタログをローカルにキャッシュします。

## カタログ形式（marketplace.json）

マーケットプレイスカタログは、リポジトリルートの `.xcsh-plugin/marketplace.json` に配置されます:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### 必須フィールド

| フィールド | 説明 |
|---|---|
| `name` | マーケットプレイス名。小文字の英数字、ハイフン、ドットが使用可能。英数字で開始・終了する必要があります。最大64文字。 |
| `owner.name` | マーケットプレイスオーナー名 |
| `plugins` | プラグインエントリの配列 |

### プラグインエントリフィールド

| フィールド | 必須 | 説明 |
|---|---|---|
| `name` | はい | プラグイン名（マーケットプレイス名と同じルール） |
| `source` | はい | プラグインの取得元（下記参照） |
| `description` | いいえ | 短い説明 |
| `version` | いいえ | バージョン文字列 |
| `author` | いいえ | `{ name, email? }` |
| `homepage` | いいえ | URL |
| `category` | いいえ | カテゴリ文字列（例: `development`、`productivity`、`security`） |
| `tags` | いいえ | 文字列タグの配列 |
| `strict` | いいえ | ブール値 |
| `commands` | いいえ | 提供するスラッシュコマンド |
| `agents` | いいえ | 提供するエージェント |
| `hooks` | いいえ | フック定義 |
| `mcpServers` | いいえ | MCPサーバー定義 |
| `lspServers` | いいえ | LSPサーバー定義 |

### プラグインソース形式

`source` フィールドはいくつかの形式をサポートしています:

**相対パス**（マーケットプレイスリポジトリ内）:

```json
"source": "./plugins/my-plugin"
```

**GitリポジトリURL**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub省略形**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Gitサブディレクトリ**（モノレポ）:

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**npmパッケージ**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## ディスク上のレイアウト

```
~/.xcsh/
  config/
    marketplaces.json          # 追加されたマーケットプレイスのレジストリ
  plugins/
    installed_plugins.json     # ユーザースコープのインストール済みプラグイン
    cache/
      marketplaces/            # キャッシュされたマーケットプレイスカタログ
      plugins/                 # キャッシュされたプラグインディレクトリ

<project>/.xcsh/
  installed_plugins.json       # プロジェクトスコープのインストール済みプラグイン
```

## 命名規則

マーケットプレイス名とプラグイン名は以下の条件を満たす必要があります:

- 小文字の英字または数字で開始・終了すること
- 小文字の英字、数字、ハイフン、ドットのみを含むこと
- 最大64文字であること

プラグインID（`name@marketplace`）は合計で最大128文字です。

有効な例: `my-plugin`、`code-review`、`wordpress.com`、`ai-firstify`
無効な例: `-bad`、`bad-`、`.bad`、`Bad`、`under_score`
