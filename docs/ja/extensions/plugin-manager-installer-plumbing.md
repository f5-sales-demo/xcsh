---
title: プラグインマネージャーとインストーラーの内部構造
description: インストール、バリデーション、依存関係解決、ライフサイクル管理を含むプラグインマネージャーの内部動作について説明します。
sidebar:
  order: 5
  label: プラグインマネージャー
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# プラグインマネージャーとインストーラーの内部構造

このドキュメントでは、`xcsh plugin` 操作がディスク上のプラグイン状態をどのように変更するか、およびインストールされたプラグインがどのようにランタイムの機能（現時点ではツール、フック/コマンドのパス解決も利用可能）になるかについて説明します。

## スコープとアーキテクチャ

コードベースには2つのプラグイン管理実装があります。

1. **CLI コマンドで使用されるアクティブなパス**: `PluginManager`（`src/extensibility/plugins/manager.ts`）
2. **レガシーヘルパーモジュール**: インストーラー関数（`src/extensibility/plugins/installer.ts`）

`xcsh plugin ...` コマンドの実行は `PluginManager` を経由します。

`installer.ts` は重要な安全チェックとファイルシステムの動作を文書化していますが、`src/commands/plugin.ts` + `src/cli/plugin-cli.ts` が使用するパスではありません。

## ライフサイクル: CLI 呼び出しからランタイム利用可能状態まで

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

### コマンドのエントリーポイント

- `src/commands/plugin.ts` はコマンド/フラグを定義し、`runPluginCommand` に転送します。
- `src/cli/plugin-cli.ts` はサブコマンドを `PluginManager` のメソッドにマッピングします:
  - `install`、`uninstall`、`list`、`link`、`doctor`、`features`、`config`、`enable`、`disable`
- 明示的な `update` アクションは存在しません。更新は新しいパッケージ/バージョン仕様で `install` を再実行することで行います。

## ディスク上のモデル

グローバルなプラグイン状態は `~/.xcsh/plugins` 以下に保存されます。

- `package.json` — `bun install`/`bun uninstall` で使用される依存関係マニフェスト
- `node_modules/` — インストールされたプラグインパッケージまたはシンボリックリンク
- `xcsh-plugins.lock.json` — ランタイム状態:
  - プラグインごとの有効/無効状態
  - プラグインごとの選択された機能セット
  - 永続化されたプラグイン設定

プロジェクトローカルのオーバーライドは以下に保存されます。

- `<cwd>/.xcsh/plugin-overrides.json`

オーバーライドはマネージャー/ローダーの観点では読み取り専用（書き込みパスなし）であり、このプロジェクトに対してプラグインを無効化したり、機能/設定をオーバーライドしたりできます。

## プラグイン仕様の解析とメタデータの解釈

## インストール仕様の文法

`parsePluginSpec`（`parser.ts`）がサポートする構文:

- `pkg` -> `features: null`（デフォルトの動作）
- `pkg[*]` -> マニフェストの全機能を有効化
- `pkg[]` -> オプション機能を有効化しない
- `pkg[a,b]` -> 名前付き機能を有効化
- `@scope/pkg@1.2.3[feat]` -> スコープ付き + バージョン指定パッケージと明示的な機能選択

`extractPackageName` はインストール後のディスク上のパス検索のためにバージョンサフィックスを除去します。

## マニフェストのソースと必須フィールド

マニフェストは以下の順序で解決されます。

1. `package.json.xcsh`
2. フォールバック `package.json.pi`
3. フォールバック `{ version: package.version }`

影響:

- マネージャー/ローダーには厳密なスキーマバリデーションがありません。
- `xcsh`/`pi` がないパッケージもインストール・一覧表示が可能です。
- ランタイムのプラグイン読み込み（`getEnabledPlugins`）は `xcsh`/`pi` マニフェストのないパッケージをスキップします。
- `manifest.version` は常にパッケージの `version` で上書きされます。

`package.json` の JSON が不正な場合は読み取り時にハードエラーとなります。マニフェストの形式が不正な場合は、特定のフィールドが使用された時点で初めてエラーが発生することがあります。

## インストール/更新フロー（`PluginManager.install`）

1. インストール仕様から機能ブラケット構文を解析します。
2. 正規表現 + シェルメタキャラクターの拒否リストに対してパッケージ名を検証します。
3. プラグインの `package.json` が存在することを確認します（`xcsh-plugins`、プライベート依存関係マップ）。
4. `~/.xcsh/plugins` で `bun install <packageSpec>` を実行します。
5. インストールされたパッケージの `node_modules/<name>/package.json` を読み込みます。
6. マニフェストを解決し、`enabledFeatures` を計算します:
   - `[*]`: 宣言されたすべての機能（機能マップがない場合は `null`）
   - `[a,b]`: マニフェストの機能マップに各機能が存在することを検証
   - `[]`: 空の機能リスト
   - ベア仕様: `null`（ローダーの後段でデフォルトポリシーを使用）
7. ロックファイルのランタイム状態をアップサートします: `{ version, enabledFeatures, enabled: true }`。

### 更新のセマンティクス

更新はインストール駆動のため:

- `xcsh plugin install pkg@newVersion` は依存関係とロックファイルのバージョンを更新します。
- 既存の設定は保持されます。バージョン/機能/有効状態の状態エントリは上書きされます。
- 「更新確認」や「トランザクション的なマイグレーション」ロジックは存在しません。

## 削除フロー（`PluginManager.uninstall`）

1. パッケージ名を検証します。
2. プラグインディレクトリで `bun uninstall <name>` を実行します。
3. ロックファイルからプラグインのランタイム状態を削除します:
   - `config.plugins[name]`
   - `config.settings[name]`

アンインストールコマンドが失敗した場合、ランタイム状態は変更されません。

## 一覧表示フロー（`PluginManager.list`）

1. `~/.xcsh/plugins/package.json` からプラグインの依存関係マップを読み込みます。
2. ロックファイルのランタイム設定を読み込みます（ファイルが存在しない場合は空のデフォルト値）。
3. プロジェクトのオーバーライドを読み込みます（`<cwd>/.xcsh/plugin-overrides.json`、解析/読み取りエラーの場合は警告付きで空オブジェクト）。
4. 解決可能な `package.json` を持つ各依存関係に対して:
   - `InstalledPlugin` レコードを作成
   - 機能/有効化状態をマージ:
     - ロックファイルからのベース（またはデフォルト値）
     - プロジェクトのオーバーライドで機能選択を上書き可能
     - プロジェクトの `disabled` リストでプラグインを無効としてマスク

これが CLI のステータス出力および設定/機能操作で使用される有効な状態です。

## リンクフロー（`PluginManager.link`）

`link` はローカルパッケージを `~/.xcsh/plugins/node_modules/<pkg.name>` にシンボリックリンクすることで、ローカルプラグイン開発をサポートします。

動作:

1. マネージャーの cwd に対して `localPath` を解決します。
2. ローカルの `package.json` と `name` フィールドを必須とします。
3. プラグインディレクトリが存在することを確認します。
4. スコープ付き名の場合、スコープディレクトリを作成します。
5. ターゲットリンク場所の既存パスを削除します。
6. シンボリックリンクを作成します。
7. デフォルト機能（`null`）で有効化されたランタイムロックファイルエントリを追加します。

注意: 現在の `PluginManager.link` は、レガシーの `installer.ts` にある `cwd` パス境界チェック（`normalizedPath.startsWith(normalizedCwd)`）を実装していないため、信頼性は呼び出し元の責任となります。

## ランタイム読み込み: インストールされたプラグインから呼び出し可能な機能へ

## ディスカバリーゲート

`getEnabledPlugins(cwd)`（`plugins/loader.ts`）が読み込む内容:

- プラグインの依存関係マニフェスト（`package.json`）
- ロックファイルのランタイム状態
- `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })` 経由のプロジェクトオーバーライド

フィルタリング:

- プラグインの `package.json` がない場合はスキップ
- マニフェスト（`xcsh`/`pi`）がない場合はスキップ
- ロックファイルでグローバルに無効化されている場合はスキップ
- プロジェクトで無効化されている場合はスキップ

## 機能パスの解決

有効化された各プラグインに対して:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

各リゾルバーにはベースエントリと機能エントリが含まれます:

- 明示的な機能リスト -> 選択された機能のみ
- `enabledFeatures === null` -> `default: true` とマークされた機能を有効化

存在しないファイルは暗黙的にスキップされます（`existsSync` ガード）。

## 現在のランタイム配線の違い

- **ツールは現在ランタイムに配線されています**: `discoverAndLoadCustomTools`（`custom-tools/loader.ts`）経由で、`getAllPluginToolPaths(cwd)` を呼び出します。
- パスはカスタムツールディスカバリーで解決済み絶対パスによって重複排除されます（`seen` セット、最初のパスが優先）。
- **フック/コマンドリゾルバーは存在**しており、エクスポートされていますが、このコードパスは現在ツールと同じ方法ではランタイムレジストリに配線されていません。

## ロック/状態管理の詳細

`PluginManager` はランタイム設定をインスタンスごとにメモリ内にキャッシュし（`#runtimeConfig`）、遅延読み込みします。

読み込み動作:

- ロックファイルが存在しない場合 -> `{ plugins: {}, settings: {} }`
- ロックファイルの読み込み/解析に失敗した場合 -> 警告 + 同じ空のデフォルト値

保存動作:

- 変更のたびにロックファイル JSON を整形して全体を書き込みます

クロスプロセスのロックやマージ戦略は存在しません。同時に書き込みを行うと互いに上書きされる可能性があります。

## 安全チェックと信頼境界

## 入力/パッケージのバリデーション

アクティブなマネージャーパスはパッケージ名のバリデーションを実施します:

- スコープ付き/スコープなしパッケージ仕様の正規表現（オプションでバージョン付き）
- 明示的なシェルメタキャラクターの拒否リスト（`[;&|`$(){}[]<>\\]`）

これにより、`bun install/uninstall` 呼び出し時のコマンドインジェクションリスクを軽減します。

## ファイルシステムの信頼境界

- プラグインコードはカスタムツールモジュールがインポートされるときにインプロセスで実行されます。サンドボックスはありません。
- マニフェストの相対パスはプラグインパッケージディレクトリに対して結合され、存在チェックのみが行われます。
- インストール済みのプラグインパッケージ自体は信頼されたコードとして扱われます。

## レガシーインストーラー固有のチェック

`installer.ts` には `PluginManager.link` に反映されていない追加のリンク時チェックが含まれています:

- ローカルパスはプロジェクトの cwd 内で解決される必要があります
- シンボリックリンクのターゲット名付けのための追加のパッケージ名/パストラバーサルガード

CLI は `PluginManager` を使用するため、これらのより厳格なリンクガードは現在メインパスには存在しません。

## 失敗、部分的成功、およびロールバックの動作

プラグインマネージャーはトランザクション的ではありません。

| 操作ステージ | 失敗時の動作 | ロールバック |
| --- | --- | --- |
| `bun install` が失敗 | インストールが stderr とともに中断 | N/A（まだ状態の書き込みなし） |
| インストール成功後、マニフェスト/機能のバリデーションが失敗 | コマンドが失敗 | アンインストールのロールバックなし。依存関係が `node_modules`/`package.json` に残る可能性あり |
| インストール成功後、ロックファイルの書き込みが失敗 | コマンドが失敗 | インストールされたパッケージのロールバックなし |
| `bun uninstall` 成功後、ロックファイルの書き込みが失敗 | コマンドが失敗 | パッケージは削除済み、古いランタイム状態が残る可能性あり |
| `link` が古いターゲットを削除後、シンボリックリンク作成が失敗 | コマンドが失敗 | 以前のリンク/ディレクトリの復元なし |

運用上、`doctor --fix` は一部のドリフトを修復できます（`bun install`、孤立した設定のクリーンアップ、無効な機能のクリーンアップ）が、ベストエフォートです。

## 不正/欠損マニフェストの動作まとめ

- `xcsh`/`pi` フィールドが欠損:
  - インストール/一覧表示: 許容される（最小限のマニフェスト）
  - ランタイムの有効プラグインディスカバリー: 非プラグインとしてスキップ
- インストール仕様または `features --set/--enable` で参照された機能が存在しない: 利用可能な機能リストとともにハードエラー
- 不正な `plugin-overrides.json`: マネージャーとローダーの両パスで `{}` へのフォールバックとして無視
- マニフェストで参照されているツール/フック/コマンドファイルパスが存在しない: リゾルバー展開中に暗黙的に無視され、`doctor` によってのみエラーとしてフラグ付け

## モードの違いと優先順位

- `--dry-run`（インストール）: 合成インストール結果を返し、ファイルシステム/ネットワーク/状態の書き込みなし。
- `--json`: 出力フォーマットのみ、動作変更なし。
- プロジェクトのオーバーライドは機能/設定のビューにおいてグローバルロックファイルより常に優先されます。
- 有効化の実効値は `runtimeEnabled && !projectDisabled` です。

## 実装ファイル

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI コマンド宣言とフラグマッピング
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — アクションディスパッチ、ユーザー向けコマンドハンドラー
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — アクティブなインストール/削除/一覧表示/リンク/状態/doctor の実装
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — レガシーインストーラーヘルパーと追加のリンク安全チェック
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 有効プラグインのディスカバリーとツール/フック/コマンドのパス解決
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — インストール仕様とパッケージ名解析ヘルパー
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — マニフェスト/ランタイム/オーバーライドの型定義
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — プラグインが提供するツールモジュールのランタイム配線
