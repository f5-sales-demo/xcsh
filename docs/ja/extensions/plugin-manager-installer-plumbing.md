---
title: Plugin Manager and Installer Plumbing
description: >-
  Plugin manager internals covering installation, validation, dependency
  resolution, and lifecycle management.
sidebar:
  order: 5
  label: プラグインマネージャー
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# プラグインマネージャーとインストーラーの内部構造

このドキュメントでは、`xcsh plugin` 操作がディスク上のプラグイン状態をどのように変更するか、およびインストールされたプラグインがどのようにランタイム機能（現在はツール、フック/コマンドのパス解決が利用可能）になるかについて説明します。

## スコープとアーキテクチャ

コードベースには2つのプラグイン管理実装があります：

1. **CLIコマンドが使用するアクティブパス**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **レガシーヘルパーモジュール**: インストーラー関数 (`src/extensibility/plugins/installer.ts`)

`xcsh plugin ...` コマンドの実行は `PluginManager` を経由します。

`installer.ts` には重要な安全性チェックとファイルシステムの動作が記述されていますが、`src/commands/plugin.ts` + `src/cli/plugin-cli.ts` が使用するパスではありません。

## ライフサイクル：CLI呼び出しからランタイムでの利用可能状態まで

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
  - `install`、`uninstall`、`list`、`link`、`doctor`、`features`、`config`、`enable`、`disable`
- 明示的な `update` アクションは存在しません。更新は新しいパッケージ/バージョン指定で `install` を再実行することで行います。

## ディスク上のモデル

グローバルなプラグイン状態は `~/.xcsh/plugins` の下に存在します：

- `package.json` — `bun install`/`bun uninstall` が使用する依存関係マニフェスト
- `node_modules/` — インストールされたプラグインパッケージまたはシンボリックリンク
- `xcsh-plugins.lock.json` — ランタイム状態：
  - プラグインごとの有効/無効状態
  - プラグインごとの選択された機能セット
  - 永続化されたプラグイン設定

プロジェクトローカルのオーバーライドは以下に存在します：

- `<cwd>/.xcsh/plugin-overrides.json`

オーバーライドはマネージャー/ローダーの観点では読み取り専用であり（ここに書き込みパスはありません）、このプロジェクトのプラグインの無効化や機能/設定のオーバーライドが可能です。

## プラグイン仕様の解析とメタデータの解釈

## インストール仕様の文法

`parsePluginSpec` (`parser.ts`) は以下をサポートします：

- `pkg` -> `features: null`（デフォルトの動作）
- `pkg[*]` -> すべてのマニフェスト機能を有効化
- `pkg[]` -> オプション機能を有効化しない
- `pkg[a,b]` -> 指定された機能を有効化
- `@scope/pkg@1.2.3[feat]` -> スコープ付き + バージョン指定のパッケージで明示的な機能選択

`extractPackageName` はインストール後のディスク上のパス検索のためにバージョンサフィックスを除去します。

## マニフェストのソースと必須フィールド

マニフェストは以下の順序で解決されます：

1. `package.json.xcsh`
2. フォールバック `package.json.pi`
3. フォールバック `{ version: package.version }`

影響：

- マネージャー/ローダーには厳密なスキーマバリデーションがありません。
- `xcsh`/`pi` がないパッケージでもインストールおよびリスト表示は可能です。
- ランタイムプラグイン読み込み (`getEnabledPlugins`) は `xcsh`/`pi` マニフェストのないパッケージをスキップします。
- `manifest.version` は常にパッケージの `version` で上書きされます。

不正な `package.json` の JSON は読み取り時にハードエラーとなります。不正なマニフェスト構造は、特定のフィールドが使用される際にのみ後から失敗する可能性があります。

## インストール/更新フロー (`PluginManager.install`)

1. インストール仕様から機能のブラケット構文を解析します。
2. 正規表現 + シェルメタ文字の拒否リストに対してパッケージ名を検証します。
3. プラグインの `package.json` が存在することを確認します（`xcsh-plugins`、プライベート依存関係マップ）。
4. `~/.xcsh/plugins` で `bun install <packageSpec>` を実行します。
5. インストールされたパッケージの `node_modules/<name>/package.json` を読み取ります。
6. マニフェストを解決し、`enabledFeatures` を計算します：
   - `[*]`: すべての宣言された機能（機能マップがない場合は `null`）
   - `[a,b]`: マニフェストの機能マップに各機能が存在するかを検証
   - `[]`: 空の機能リスト
   - 素の仕様: `null`（後でローダーでデフォルトポリシーを使用）
7. ロックファイルのランタイム状態を upsert: `{ version, enabledFeatures, enabled: true }`。

### 更新セマンティクス

更新はインストール駆動であるため：

- `xcsh plugin install pkg@newVersion` は依存関係とロックファイルのバージョンを更新します。
- 既存の設定は保持されます。状態エントリはバージョン/機能/有効状態について上書きされます。
- 個別の「更新チェック」やトランザクション的なマイグレーションロジックは存在しません。

## 削除フロー (`PluginManager.uninstall`)

1. パッケージ名を検証します。
2. プラグインディレクトリで `bun uninstall <name>` を実行します。
3. ロックファイルからプラグインのランタイム状態を削除します：
   - `config.plugins[name]`
   - `config.settings[name]`

アンインストールコマンドが失敗した場合、ランタイム状態は変更されません。

## リストフロー (`PluginManager.list`)

1. `~/.xcsh/plugins/package.json` からプラグイン依存関係マップを読み取ります。
2. ロックファイルのランタイム設定を読み込みます（ファイルがない場合は空のデフォルト）。
3. プロジェクトオーバーライドを読み込みます（`<cwd>/.xcsh/plugin-overrides.json`、解析/読み取りエラーの場合は警告付きで空オブジェクト）。
4. 解決可能な package.json を持つ各依存関係について：
   - `InstalledPlugin` レコードを構築
   - 機能/有効状態をマージ：
     - ベースはロックファイルから（またはデフォルト）
     - プロジェクトオーバーライドで機能選択を置換可能
     - プロジェクトの `disabled` リストでプラグインを無効としてマスク

これはCLIのステータス出力と設定/機能操作で使用される有効状態です。

## リンクフロー (`PluginManager.link`)

`link` はローカルパッケージを `~/.xcsh/plugins/node_modules/<pkg.name>` にシンボリックリンクすることで、ローカルプラグイン開発をサポートします。

動作：

1. マネージャーの cwd に対して `localPath` を解決します。
2. ローカルの `package.json` と `name` フィールドを要求します。
3. プラグインディレクトリの存在を確認します。
4. スコープ付き名前の場合、スコープディレクトリを作成します。
5. ターゲットリンク位置の既存パスを削除します。
6. シンボリックリンクを作成します。
7. デフォルト機能（`null`）で有効なランタイムロックファイルエントリを追加します。

注意: 現在の `PluginManager.link` は、レガシーの `installer.ts` に存在する `cwd` パス境界チェック（`normalizedPath.startsWith(normalizedCwd)`）を強制しないため、信頼は呼び出し側の責任です。

## ランタイム読み込み：インストールされたプラグインから呼び出し可能な機能へ

## ディスカバリーゲート

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) は以下を読み取ります：

- プラグイン依存関係マニフェスト (`package.json`)
- ロックファイルのランタイム状態
- `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })` によるプロジェクトオーバーライド

フィルタリング：

- プラグインの package.json がない場合はスキップ
- マニフェスト (`xcsh`/`pi`) がない場合はスキップ
- ロックファイルでグローバルに無効化されている場合はスキップ
- プロジェクトで無効化されている場合はスキップ

## 機能パスの解決

有効な各プラグインについて：

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

各リゾルバーはベースエントリと機能エントリを含みます：

- 明示的な機能リスト -> 選択された機能のみ
- `enabledFeatures === null` -> `default: true` とマークされた機能を有効化

見つからないファイルはサイレントにスキップされます（`existsSync` ガード）。

## 現在のランタイム接続の違い

- **ツールは現在ランタイムに接続されています** - `discoverAndLoadCustomTools` (`custom-tools/loader.ts`) 経由で、`getAllPluginToolPaths(cwd)` を呼び出します。
- パスはカスタムツールのディスカバリーで解決済み絶対パスにより重複排除されます（`seen` セット、最初のパスが優先）。
- **フック/コマンドリゾルバーは存在し**エクスポートされていますが、このコードパスは現在、ツールと同じ方法でランタイムレジストリに接続されていません。

## ロック/状態管理の詳細

`PluginManager` はインスタンスごとにランタイム設定をメモリにキャッシュし（`#runtimeConfig`）、遅延的に一度だけ読み込みます。

読み込み動作：

- ロックファイルが存在しない場合 -> `{ plugins: {}, settings: {} }`
- ロックファイルの読み取り/解析失敗 -> 警告 + 同じ空のデフォルト

保存動作：

- 各変更時にロックファイルの完全な JSON をプリティプリントで書き込み

プロセス間ロックやマージ戦略は存在しません。同時書き込みにより互いの内容が上書きされる可能性があります。

## 安全性チェックと信頼境界

## 入力/パッケージのバリデーション

アクティブマネージャーパスはパッケージ名のバリデーションを強制します：

- スコープ付き/スコープなしパッケージ仕様の正規表現（オプションでバージョン付き）
- 明示的なシェルメタ文字の拒否リスト (`[;&|`$(){}[]<>\\]`)

これにより `bun install/uninstall` 呼び出し時のコマンドインジェクションリスクが制限されます。

## ファイルシステムの信頼境界

- プラグインコードは、カスタムツールモジュールがインポートされる際にインプロセスで実行されます。サンドボックスはありません。
- マニフェストの相対パスはプラグインパッケージディレクトリに対して結合され、存在チェックのみが行われます。
- プラグインパッケージ自体は、インストールされた時点で信頼されたコードです。

## レガシーインストーラーのみのチェック

`installer.ts` には `PluginManager.link` にミラーリングされていない追加のリンク時チェックが含まれています：

- ローカルパスはプロジェクトの cwd 内に解決される必要がある
- シンボリックリンクターゲットの命名に対する追加のパッケージ名/パストラバーサルガード

CLIは `PluginManager` を使用するため、これらのより厳格なリンクガードは現在メインパスには存在しません。

## 失敗、部分的な成功、およびロールバック動作

プラグインマネージャーはトランザクショナルではありません。

| 操作ステージ | 失敗時の動作 | ロールバック |
| --- | --- | --- |
| `bun install` が失敗 | stderr でインストールが中断 | N/A（まだ状態書き込みなし） |
| インストール成功後、マニフェスト/機能のバリデーションが失敗 | コマンドが失敗 | アンインストールのロールバックなし。依存関係が `node_modules`/`package.json` に残る可能性あり |
| インストール成功後、ロックファイルの書き込みが失敗 | コマンドが失敗 | インストールされたパッケージのロールバックなし |
| `bun uninstall` 成功後、ロックファイルの書き込みが失敗 | コマンドが失敗 | パッケージは削除済み、古いランタイム状態が残る可能性あり |
| `link` が古いターゲットを削除後、シンボリックリンク作成が失敗 | コマンドが失敗 | 以前のリンク/ディレクトリの復元なし |

運用上、`doctor --fix` は一部のドリフトを修復できます（`bun install`、孤立した設定のクリーンアップ、無効な機能のクリーンアップ）が、ベストエフォートです。

## 不正/欠落マニフェストの動作まとめ

- `xcsh`/`pi` フィールドの欠落：
  - install/list: 許容（最小限のマニフェスト）
  - ランタイムの有効プラグインディスカバリー: 非プラグインとしてスキップ
- インストール仕様または `features --set/--enable` で参照された機能が欠落: 利用可能な機能リスト付きのハードエラー
- 無効な `plugin-overrides.json`: マネージャーとローダーの両方のパスで `{}` へのフォールバックで無視
- マニフェストで参照されたツール/フック/コマンドファイルパスの欠落: リゾルバーの展開中はサイレントに無視。`doctor` によってのみエラーとしてフラグ付け

## モードの違いと優先順位

- `--dry-run`（install）: 合成インストール結果を返し、ファイルシステム/ネットワーク/状態の書き込みは行いません。
- `--json`: 出力フォーマットのみで、動作変更なし。
- プロジェクトオーバーライドは常に機能/設定ビューにおいてグローバルロックファイルより優先されます。
- 有効な有効化状態は `runtimeEnabled && !projectDisabled` です。

## 実装ファイル

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLIコマンド宣言とフラグマッピング
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — アクションディスパッチ、ユーザー向けコマンドハンドラー
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — アクティブなインストール/削除/リスト/リンク/状態/doctor の実装
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — レガシーインストーラーヘルパーと追加のリンク安全性チェック
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 有効プラグインのディスカバリーとツール/フック/コマンドパスの解決
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — インストール仕様とパッケージ名の解析ヘルパー
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — マニフェスト/ランタイム/オーバーライドの型契約
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — プラグイン提供ツールモジュールのランタイム接続
