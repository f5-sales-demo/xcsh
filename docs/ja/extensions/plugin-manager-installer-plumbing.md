---
title: プラグインマネージャーとインストーラーの内部構造
description: インストール、検証、依存関係の解決、ライフサイクル管理を含むプラグインマネージャーの内部実装。
sidebar:
  order: 5
  label: プラグインマネージャー
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# プラグインマネージャーとインストーラーの内部構造

このドキュメントでは、`xcsh plugin` の各操作がディスク上のプラグイン状態をどのように変更するか、およびインストールされたプラグインがどのようにランタイム機能（現在はツール、フック/コマンドのパス解決は利用可能な状態）になるかについて説明します。

## スコープとアーキテクチャ

コードベースには2つのプラグイン管理実装があります：

1. **CLIコマンドで使用されるアクティブパス**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **レガシーヘルパーモジュール**: インストーラー関数 (`src/extensibility/plugins/installer.ts`)

`xcsh plugin ...` コマンドの実行は `PluginManager` を経由します。

`installer.ts` には重要な安全性チェックとファイルシステムの動作が記述されていますが、`src/commands/plugin.ts` + `src/cli/plugin-cli.ts` で使用されるパスではありません。

## ライフサイクル: CLI呼び出しからランタイム利用可能まで

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### コマンドエントリーポイント

- `src/commands/plugin.ts` はコマンド/フラグを定義し、`runPluginCommand` に転送します。
- `src/cli/plugin-cli.ts` はサブコマンドを `PluginManager` のメソッドにマッピングします：
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- 明示的な `update` アクションは存在しません。更新は新しいパッケージ/バージョン指定で `install` を再実行することで行います。

## ディスク上のモデル

グローバルなプラグイン状態は `~/.xcsh/plugins` 配下に格納されます：

- `package.json` — `bun install`/`bun uninstall` で使用される依存関係マニフェスト
- `node_modules/` — インストールされたプラグインパッケージまたはシンボリックリンク
- `xcsh-plugins.lock.json` — ランタイム状態：
  - プラグインごとの有効/無効
  - プラグインごとの選択されたフィーチャーセット
  - 永続化されたプラグイン設定

プロジェクトローカルのオーバーライドは以下に格納されます：

- `<cwd>/.xcsh/plugin-overrides.json`

オーバーライドはマネージャー/ローダーの観点からは読み取り専用（ここには書き込みパスなし）で、プロジェクト単位でプラグインを無効化したり、フィーチャー/設定を上書きしたりできます。

## プラグイン仕様の解析とメタデータの解釈

## インストール仕様の文法

`parsePluginSpec` (`parser.ts`) は以下をサポートします：

- `pkg` -> `features: null`（デフォルトの動作）
- `pkg[*]` -> すべてのマニフェストフィーチャーを有効化
- `pkg[]` -> オプションのフィーチャーを有効化しない
- `pkg[a,b]` -> 名前付きフィーチャーを有効化
- `@scope/pkg@1.2.3[feat]` -> スコープ付き + バージョン指定パッケージで明示的なフィーチャー選択

`extractPackageName` はインストール後のディスク上のパス検索のためにバージョンサフィックスを除去します。

## マニフェストのソースと必須フィールド

マニフェストは以下の順序で解決されます：

1. `package.json.xcsh`
2. フォールバック `package.json.pi`
3. フォールバック `{ version: package.version }`

含意：

- マネージャー/ローダーには厳密なスキーマ検証がありません。
- `xcsh`/`pi` が欠けているパッケージでもインストール・一覧表示は可能です。
- ランタイムのプラグイン読み込み (`getEnabledPlugins`) は `xcsh`/`pi` マニフェストのないパッケージをスキップします。
- `manifest.version` は常にパッケージの `version` で上書きされます。

不正な `package.json` の JSON は読み取り時にハードエラーとなります。不正なマニフェスト構造は、特定のフィールドが消費される時点で初めて失敗する可能性があります。

## インストール/更新フロー (`PluginManager.install`)

1. インストール仕様からフィーチャーブラケット構文を解析。
2. 正規表現 + シェルメタ文字の拒否リストに対してパッケージ名を検証。
3. プラグイン `package.json` の存在を確認（`xcsh-plugins`、プライベート依存関係マップ）。
4. `~/.xcsh/plugins` で `bun install <packageSpec>` を実行。
5. インストールされたパッケージの `node_modules/<name>/package.json` を読み取り。
6. マニフェストを解決し `enabledFeatures` を計算：
   - `[*]`: 宣言されたすべてのフィーチャー（フィーチャーマップがない場合は `null`）
   - `[a,b]`: マニフェストのフィーチャーマップに各フィーチャーが存在することを検証
   - `[]`: 空のフィーチャーリスト
   - ベア指定: `null`（後でローダーでデフォルトポリシーを使用）
7. ロックファイルのランタイム状態を更新/挿入: `{ version, enabledFeatures, enabled: true }`。

### 更新のセマンティクス

更新はインストール駆動であるため：

- `xcsh plugin install pkg@newVersion` は依存関係とロックファイルのバージョンを更新します。
- 既存の設定は保持されます。状態エントリはバージョン/フィーチャー/有効化について上書きされます。
- 個別の「更新チェック」やトランザクショナルなマイグレーションロジックは存在しません。

## 削除フロー (`PluginManager.uninstall`)

1. パッケージ名を検証。
2. プラグインディレクトリで `bun uninstall <name>` を実行。
3. ロックファイルからプラグインのランタイム状態を削除：
   - `config.plugins[name]`
   - `config.settings[name]`

アンインストールコマンドが失敗した場合、ランタイム状態は変更されません。

## 一覧フロー (`PluginManager.list`)

1. `~/.xcsh/plugins/package.json` からプラグイン依存関係マップを読み取り。
2. ロックファイルのランタイム設定を読み込み（ファイルがない場合 -> 空のデフォルト）。
3. プロジェクトオーバーライドを読み込み（`<cwd>/.xcsh/plugin-overrides.json`、解析/読み取りエラー -> 警告付きの空オブジェクト）。
4. 解決可能な package.json を持つ各依存関係について：
   - `InstalledPlugin` レコードを構築
   - フィーチャー/有効化状態をマージ：
     - ベースはロックファイルから（またはデフォルト）
     - プロジェクトオーバーライドがフィーチャー選択を置換可能
     - プロジェクトの `disabled` リストがプラグインを無効としてマスク

これはCLIのステータス出力および設定/フィーチャー操作で使用される実効状態です。

## リンクフロー (`PluginManager.link`)

`link` はローカルパッケージを `~/.xcsh/plugins/node_modules/<pkg.name>` にシンボリックリンクすることで、ローカルプラグイン開発をサポートします。

動作：

1. マネージャーの cwd に対して `localPath` を解決。
2. ローカルの `package.json` と `name` フィールドを要求。
3. プラグインディレクトリの存在を確保。
4. スコープ付き名前の場合、スコープディレクトリを作成。
5. ターゲットリンク位置の既存パスを削除。
6. シンボリックリンクを作成。
7. デフォルトフィーチャー（`null`）で有効化されたランタイムロックファイルエントリを追加。

注意事項: 現在の `PluginManager.link` はレガシーの `installer.ts` に存在する `cwd` パス境界チェック（`normalizedPath.startsWith(normalizedCwd)`）を強制しないため、信頼性は呼び出し側の責任です。

## ランタイム読み込み: インストール済みプラグインから呼び出し可能な機能へ

## ディスカバリーゲート

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) は以下を読み取ります：

- プラグイン依存関係マニフェスト (`package.json`)
- ロックファイルのランタイム状態
- `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })` 経由のプロジェクトオーバーライド

フィルタリング：

- プラグイン package.json がない場合はスキップ
- マニフェスト (`xcsh`/`pi`) がない場合はスキップ
- ロックファイルでグローバルに無効化されている場合はスキップ
- プロジェクトで無効化されている場合はスキップ

## 機能パスの解決

有効化された各プラグインについて：

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

各リゾルバはベースエントリとフィーチャーエントリを含みます：

- 明示的なフィーチャーリスト -> 選択されたフィーチャーのみ
- `enabledFeatures === null` -> `default: true` とマークされたフィーチャーを有効化

存在しないファイルは暗黙的にスキップされます（`existsSync` ガード）。

## 現在のランタイム接続の差異

- **ツールは現在ランタイムに接続されています**: `discoverAndLoadCustomTools` (`custom-tools/loader.ts`) 経由で、`getAllPluginToolPaths(cwd)` を呼び出します。
- パスはカスタムツールのディスカバリーで解決済み絶対パスによって重複排除されます（`seen` セット、最初のパスが優先）。
- **フック/コマンドリゾルバは存在し**エクスポートされていますが、このコードパスは現在、ツールがランタイムに接続されているのと同じ方法でランタイムレジストリに接続されていません。

## ロック/状態管理の詳細

`PluginManager` はインスタンスごとにランタイム設定をメモリにキャッシュし（`#runtimeConfig`）、遅延読み込みを一度だけ行います。

読み込み動作：

- ロックファイルが存在しない場合 -> `{ plugins: {}, settings: {} }`
- ロックファイルの読み取り/解析失敗 -> 警告 + 同じ空のデフォルト

保存動作：

- 各変更時にロックファイル全体を整形されたJSONで書き込み

クロスプロセスロックやマージ戦略は存在しません。並行書き込みにより互いに上書きされる可能性があります。

## 安全性チェックと信頼境界

## 入力/パッケージの検証

アクティブなマネージャーパスはパッケージ名の検証を強制します：

- スコープ付き/スコープなしパッケージ仕様の正規表現（オプションでバージョン付き）
- 明示的なシェルメタ文字の拒否リスト (`[;&|`$(){}[]<>\\]`)

これにより `bun install/uninstall` 呼び出し時のコマンドインジェクションリスクが制限されます。

## ファイルシステムの信頼境界

- プラグインコードはカスタムツールモジュールがインポートされる際にインプロセスで実行されます。サンドボックスはありません。
- マニフェストの相対パスはプラグインパッケージディレクトリに対して結合され、存在チェックのみが行われます。
- プラグインパッケージ自体はインストールされた時点で信頼されたコードとなります。

## レガシーインストーラーのみのチェック

`installer.ts` には `PluginManager.link` にはミラーされていない追加のリンク時チェックが含まれています：

- ローカルパスはプロジェクトの cwd 内に解決される必要がある
- シンボリックリンクターゲットの命名に対する追加のパッケージ名/パストラバーサルガード

CLIは `PluginManager` を使用するため、これらのより厳格なリンクガードは現在メインパスにありません。

## 失敗、部分的成功、およびロールバックの動作

プラグインマネージャーはトランザクショナルではありません。

| 操作段階 | 失敗時の動作 | ロールバック |
| --- | --- | --- |
| `bun install` 失敗 | stderrでインストール中断 | N/A（まだ状態の書き込みなし） |
| インストール成功後、マニフェスト/フィーチャー検証失敗 | コマンド失敗 | アンインストールのロールバックなし。依存関係が `node_modules`/`package.json` に残る可能性あり |
| インストール成功後、ロックファイル書き込み失敗 | コマンド失敗 | インストール済みパッケージのロールバックなし |
| `bun uninstall` 成功後、ロックファイル書き込み失敗 | コマンド失敗 | パッケージは削除済み、古いランタイム状態が残る可能性あり |
| `link` で古いターゲット削除後、シンボリックリンク作成失敗 | コマンド失敗 | 以前のリンク/ディレクトリの復元なし |

運用上、`doctor --fix` は一部の不整合を修復できます（`bun install`、孤立した設定のクリーンアップ、無効なフィーチャーのクリーンアップ）が、ベストエフォートです。

## 不正/欠落マニフェストの動作まとめ

- `xcsh`/`pi` フィールドの欠落：
  - インストール/一覧: 許容（最小マニフェスト）
  - ランタイムの有効プラグインディスカバリー: 非プラグインとしてスキップ
- インストール仕様または `features --set/--enable` で参照された欠落フィーチャー: 利用可能なフィーチャーリスト付きのハードエラー
- 無効な `plugin-overrides.json`: マネージャーとローダー両方のパスで `{}` へのフォールバックで無視
- マニフェストで参照されたツール/フック/コマンドファイルパスの欠落: リゾルバ展開時に暗黙的に無視。`doctor` でのみエラーとしてフラグ付け

## モードの差異と優先順位

- `--dry-run` (install): 合成的なインストール結果を返し、ファイルシステム/ネットワーク/状態の書き込みなし。
- `--json`: 出力フォーマットのみ、動作変更なし。
- プロジェクトオーバーライドはフィーチャー/設定ビューにおいて常にグローバルロックファイルより優先。
- 実効的な有効化は `runtimeEnabled && !projectDisabled`。

## 実装ファイル

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLIコマンド宣言とフラグマッピング
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — アクションディスパッチ、ユーザー向けコマンドハンドラー
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — アクティブなインストール/削除/一覧/リンク/状態/doctor実装
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — レガシーインストーラーヘルパーと追加のリンク安全性チェック
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 有効プラグインのディスカバリーとツール/フック/コマンドパス解決
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — インストール仕様とパッケージ名の解析ヘルパー
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — マニフェスト/ランタイム/オーバーライドの型契約
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — プラグイン提供ツールモジュールのランタイム接続
