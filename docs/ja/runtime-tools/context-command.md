---
title: F5 XC コンテキスト
description: xcsh を F5 Distributed Cloud テナントに接続 -- 認証コンテキストの作成、切り替え、管理。
sidebar:
  order: 1
  label: F5 XC コンテキスト
i18n:
  sourceHash: a9cccbc338f0
  translator: machine
---

# F5 XC コンテキスト

xcsh は **コンテキスト** を通じて F5 Distributed Cloud に接続します。コンテキストとは、テナント URL、API トークン、およびネームスペースを紐づけた名前付きの認証情報セットです。`kubectl config use-context` や `kubectx` を使ったことがあれば、ワークフローは同じです。コンテキストを作成し、名前で切り替え、`-` で前のコンテキストに戻ります。

## はじめに

### 1. 最初のコンテキストを作成する

F5 XC コンソールから次の3つの情報が必要です：テナント URL、API トークン、およびオプションでネームスペース。

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

### 2. コンテキストをアクティブにする

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ XCSH_TENANT     acme                                         │
│ XCSH_API_URL    https://acme.console.ves.volterra.io         │
│ XCSH_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ XCSH_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

アクティブにすると、xcsh はテナントの認証情報をセッションに注入します。エージェントは F5 XC API 呼び出しを行えるようになり、ステータスラインにアクティブなコンテキストが表示されます。

### 3. コンテキストを追加して切り替える

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

名前で切り替えます -- サブコマンド動詞は不要です：

```
/context staging
```

前のコンテキストに戻ります（`cd -` スタイル）：

```
/context -
```

`/context -` を2回呼び出すと、元の場所に戻ります。

### 4. 現在の状態を確認する

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*` がアクティブなコンテキストを示します。

## 日常的なコマンド

| コマンド | 動作 |
|---|---|
| `/context` | すべてのコンテキストを一覧表示 |
| `/context <name>` | コンテキストを切り替え |
| `/context -` | 前のコンテキストに切り替え |
| `/context show` | アクティブなコンテキストの詳細を表示（トークンはマスク） |
| `/context status` | 現在の認証ステータスを表示 |

## コンテキストのライフサイクル

| コマンド | 動作 |
|---|---|
| `/context create <name> <url> <token> [namespace]` | コンテキストを作成 |
| `/context delete <name> --confirm` | コンテキストを削除（`--confirm` が必要） |
| `/context rename <old> <new>` | コンテキストの名前を変更 |
| `/context validate <name>` | 切り替えずに認証情報をテスト |
| `/context export [name] [--include-token]` | JSON としてエクスポート（デフォルトでトークンはマスク） |
| `/context import <path-or-json> [--overwrite]` | ファイルまたはインライン JSON からインポート |
| `/context wizard` | ガイド付きインタラクティブセットアップ |

## ネームスペースの切り替え

各コンテキストにはデフォルトのネームスペースがあります。コンテキストを変更せずにネームスペースを切り替えます：

```
/context namespace system
```

タブ補完でアクティブなテナントのネームスペース名が候補として表示されます。

## コンテキストの環境変数

コンテキストには追加の環境変数を設定でき、アクティブ化時にセッションに注入されます。認証情報セットには含まれないテナント固有の設定に便利です。

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

エイリアス：`add` = `set`、`remove`/`clear` = `unset`。

## タブ補完

`/context ` と入力して Tab キーを押します。ドロップダウンに以下が表示されます：

1. **コンテキスト名** -- テナント URL のヒント付きで、テナントを区別できます
2. **`-`** -- 以前に切り替えたことがある場合に表示され、どのコンテキストに戻るかを示します
3. **サブコマンド** -- `list`、`create`、`delete` など

切り替えが最も一般的な操作であるため、コンテキスト名が最初に表示されます。

サブコマンドレベルの補完も動作します：`/context activate <Tab>` でコンテキスト名を補完、`/context namespace <Tab>` でネームスペースを補完、`/context unset <Tab>` で既知の環境変数キーを補完します。

## 命名規則

コンテキスト名は1〜64文字で、英字、数字、ハイフン、アンダースコアが使用できます。

サブコマンドと衝突する名前は拒否されます：

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

予約語の完全なセット：`list`、`show`、`status`、`create`、`delete`、`rename`、`namespace`、`env`、`set`、`unset`、`add`、`remove`、`clear`、`activate`、`validate`、`export`、`import`、`wizard`、`help`。比較は大文字小文字を区別しません。

## 環境変数によるオーバーライド

xcsh 起動前にシェル環境で `XCSH_API_URL` と `XCSH_API_TOKEN` が設定されている場合、それらはすべてのコンテキストより優先されます。これは CI/CD パイプラインや、永続的なコンテキストを作成したくない一回限りのセッションに便利です。

このモードで実行している場合、`/context` は環境変数から取得した認証情報を `(via env vars)` ラベル付きで表示します。

## 前のコンテキストの動作

- **セッションスコープ**：前のコンテキストは xcsh の再起動時にリセットされます。ディスクには永続化されません。
- **ピンポン**：`/context -` を2回実行すると、元の場所に戻ります。
- **変更に対して安全**：前のコンテキストを削除すると、ポインタはクリアされます。名前を変更すると、ポインタは新しい名前に追従します。
- **再アクティブ化はノーオペレーション**：すでに `production` にいるときに `/context production` を実行しても、前のポインタはリセットされません。

## デザイン規約

`/context` の UX は以下に準拠しています：

- **kubectx**：`kubectx <name>` で切り替え、`kubectx -` で前に戻る、引数なしの `kubectx` で一覧表示
- **kubectl**：`kubectl config use-context` による明示的な形式
- **シェル**：`cd -` / `OLDPWD` による前のディレクトリ追跡
