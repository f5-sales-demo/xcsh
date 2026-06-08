---
title: F5 XC コンテキスト
description: xcsh を F5 Distributed Cloud テナントに接続 -- 認証コンテキストの作成、切り替え、管理。
sidebar:
  order: 1
  label: F5 XC コンテキスト
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC コンテキスト

xcsh は**コンテキスト**を通じて F5 Distributed Cloud に接続します。コンテキストとは、テナント URL、API トークン、およびネームスペースを紐づける名前付き資格情報セットです。`kubectl config use-context` や `kubectx` を使ったことがあれば、ワークフローは同じです。コンテキストを作成し、名前で切り替え、`-` で前のコンテキストに戻ります。

## はじめに

### 1. 最初のコンテキストを作成する

F5 XC コンソールから3つの情報が必要です：テナント URL、API トークン、およびオプションでネームスペースです。

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

ステップバイステップのプロンプトを好む場合は、ガイド付きウィザードを使用できます：

```
/context wizard
```

### 2. アクティベートする

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

アクティベートすると、xcsh はテナントの資格情報をセッションに注入します。エージェントは F5 XC API 呼び出しを実行できるようになり、ステータスラインにアクティブなコンテキストが表示されます。

### 3. コンテキストを追加して切り替える

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

名前で切り替えます -- サブコマンドの動詞は不要です：

```
/context staging
```

前のコンテキストに戻ります（`cd -` スタイル）：

```
/context -
```

`/context -` を2回呼び出すと、元の場所に戻ります。

### 4. 現在のコンテキスト一覧を確認する

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*` はアクティブなコンテキストを示します。

## 日常的なコマンド

| コマンド | 説明 |
|---|---|
| `/context` | すべてのコンテキストを一覧表示 |
| `/context <name>` | コンテキストに切り替え |
| `/context -` | 前のコンテキストに切り替え |
| `/context show` | アクティブなコンテキストの詳細を表示（トークンはマスク） |
| `/context status` | 現在の認証ステータスを表示 |

## コンテキストのライフサイクル

| コマンド | 説明 |
|---|---|
| `/context create <name> <url> <token> [namespace]` | コンテキストを作成 |
| `/context delete <name> --confirm` | コンテキストを削除（`--confirm` が必要） |
| `/context rename <old> <new>` | コンテキストの名前を変更 |
| `/context validate <name>` | 切り替えずに資格情報をテスト |
| `/context export [name] [--include-token]` | JSON としてエクスポート（デフォルトでトークンはマスク） |
| `/context import <path-or-json> [--overwrite]` | ファイルまたはインライン JSON からインポート |
| `/context wizard` | ガイド付きインタラクティブセットアップ |

## ネームスペースの切り替え

各コンテキストにはデフォルトのネームスペースがあります。コンテキストを変更せずにネームスペースを切り替えられます：

```
/context namespace system
```

タブ補完でアクティブなテナントのネームスペース名が候補として表示されます。

## コンテキストの環境変数

コンテキストには、アクティベート時にセッションに注入される追加の環境変数を持たせることができます。資格情報セットに含まれないテナントごとの設定に便利です。

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

エイリアス：`add` = `set`、`remove`/`clear` = `unset`。

## タブ補完

`/context ` と入力して Tab キーを押します。ドロップダウンには以下が表示されます：

1. **コンテキスト名** -- テナント URL のヒント付きで、テナントを区別できます
2. **`-`** -- 以前に切り替えたことがある場合に表示され、どのコンテキストに切り替わるかを示します
3. **サブコマンド** -- `list`、`create`、`delete` など

コンテキスト名が最初に表示されます。切り替えが最も一般的な操作だからです。

サブコマンドレベルの補完も機能します：`/context activate <Tab>` はコンテキスト名を補完し、`/context namespace <Tab>` はネームスペースを補完し、`/context unset <Tab>` は既知の環境変数キーを補完します。

## 命名規則

コンテキスト名は1〜64文字で、英字、数字、ハイフン、アンダースコアが使用できます。

サブコマンドと衝突する名前は拒否されます：

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

予約語の完全なセット：`list`、`show`、`status`、`create`、`delete`、`rename`、`namespace`、`env`、`set`、`unset`、`add`、`remove`、`clear`、`activate`、`validate`、`export`、`import`、`wizard`、`help`。比較は大文字・小文字を区別しません。

## 環境変数によるオーバーライド

xcsh を起動する前にシェル環境で `F5XC_API_URL` と `F5XC_API_TOKEN` が設定されている場合、それらはすべてのコンテキストよりも優先されます。これは、永続的なコンテキストを作成したくない CI/CD パイプラインや一回限りのセッションに便利です。

このモードで実行している場合、`/context` は環境変数から取得した資格情報を `(via env vars)` ラベル付きで表示します。

## 前のコンテキストの動作

- **セッションスコープ**：前のコンテキストは xcsh を再起動するとリセットされます。ディスクには永続化されません。
- **ピンポン**：`/context -` を2回実行すると、元の場所に戻ります。
- **変更に対して安全**：前のコンテキストを削除すると、ポインタはクリアされます。名前を変更すると、ポインタは新しい名前に追従します。
- **再アクティベートはノーオペ**：すでに `production` にいるときに `/context production` を実行しても、前のポインタはリセットされません。

## 設計規約

`/context` の UX は以下に倣っています：

- **kubectx**：`kubectx <name>` で切り替え、`kubectx -` で前のコンテキストに戻り、引数なしの `kubectx` で一覧表示
- **kubectl**：`kubectl config use-context` による明示的な形式
- **シェル**：`cd -` / `OLDPWD` による前のディレクトリ追跡
