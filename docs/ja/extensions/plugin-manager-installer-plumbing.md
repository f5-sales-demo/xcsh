---
title: プラグインマネージャーとインストーラーの内部構造
description: インストール、検証、依存関係の解決、ライフサイクル管理を含むプラグインマネージャーの内部仕様。
sidebar:
  order: 5
  label: プラグインマネージャー
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# プラグインマネージャーとインストーラーの内部構造

このドキュメントでは、`xcsh plugin` 操作がディスク上のプラグイン状態をどのように変更するか、およびインストールされたプラグインがランタイム機能（現在はツール、フック/コマンドのパス解決も利用可能）としてどのように機能するかについて説明します。

## スコープとアーキテクチャ

コードベースには2つのプラグイン管理実装があります。

1. **CLI コマンドで使用されるアクティブパス**: `PluginManager`（`src/extensibility/plugins/manager.ts`）
2. **レガシーヘルパーモジュール**: インストーラー関数（`src/extensibility/plugins/installer.ts`）

`xcsh plugin ...` コマンドの実行は `PluginManager` を経由します。

`installer.ts` には重要なセキュリティチェックとファイルシステムの動作が記述されていますが、`src/commands/plugin.ts` + `src/cli/plugin-cli.ts` が使用するパスではありません。

## ライフサイクル: CLI 呼び出しからランタイム利用可能までの流れ

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
- `src/cli/plugin-cli.ts` はサブコマンドを `PluginManager` のメソッドにマッピングします:
  - `install`、`uninstall`、`list`、`link`、`doctor`、`features`、`config`、`enable`、`disable`
- 明示的な `update` アクションは存在しません。更新は新しいパッケージ/バージョン指定で `install` を再実行することで行います。

## ディスク上のモデル

グローバルなプラグイン状態は `~/.xcsh/plugins` 以下に保存されます:

- `package.json` — `bun install`/`bun uninstall` で使用する依存関係マニフェスト
- `node_modules/` — インストール済みプラグインパッケージまたはシンボリックリンク
- `xcsh-plugins.lock.json` — ランタイム状態:
  - プラグインごとの有効/無効状態
  - プラグインごとの選択済みフィーチャーセット
  - 永続化されたプラグイン設定

プロジェクトローカルのオーバーライドは以下に保存されます:

- `<cwd>/.xcsh/plugin-overrides.json`

オーバーライドはマネージャー/ローダーの観点から読み取り専用（書き込みパスなし）であり、このプロジェクトに対してプラグインを無効化したり、フィーチャー/設定をオーバーライドしたりできます。

## プラグイン仕様の解析とメタデータの解釈

## インストール仕様の文法

`parsePluginSpec`（`parser.ts`）がサポートする記法:

- `pkg` -> `features: null`（デフォルト動作）
- `pkg[*]` -> マニフェストの全フィーチャーを有効化
- `pkg[]` -> オプションフィーチャーを有効化しない
- `pkg[a,b]` -> 指定したフィーチャーを有効化
- `@scope/pkg@1.2.3[feat]` -> スコープ付き＋バージョン指定パッケージに明示的なフィーチャー選択

`extractPackageName` はインストール後のディスク上パス検索のためにバージョンサフィックスを除去します。

## マニフェストのソースと必須フィールド

マニフェストは以下の順序で解決されます:

1. `package.json.xcsh`
2. フォールバック `package.json.pi`
3. フォールバック `{ version: package.version }`

影響:

- マネージャー/ローダーには厳密なスキーマ検証が存在しません。
- `xcsh`/`pi` がないパッケージでもインストールおよびリスト表示は可能です。
- ランタイムプラグインローディング（`getEnabledPlugins`）では `xcsh`/`pi` マニフェストがないパッケージはスキップされます。
- `manifest.version` は常にパッケージの `version` で上書きされます。

`package.json` の JSON が不正な場合は読み込み時にハードエラーとなります。マニフェストの構造が不正な場合は、特定のフィールドが参照されたときにのみ失敗する場合があります。

## インストール/更新フロー（`PluginManager.install`）

1. インストール仕様からフィーチャーブラケット構文を解析します。
2. パッケージ名を正規表現＋シェルメタキャラクター拒否リストに対して検証します。
3. プラグインの `package.json` が存在することを確認します（`xcsh-plugins`、プライベート依存関係マップ）。
4. `~/.xcsh/plugins` で `bun install <packageSpec>` を実行します。
5. インストール済みパッケージの `node_modules/<name>/package.json` を読み込みます。
6. マニフェストを解決し `enabledFeatures` を計算します:
   - `[*]`: 宣言済みの全フィーチャー（フィーチャーマップがない場合は `null`）
   - `[a,b]`: マニフェストフィーチャーマップに各フィーチャーが存在することを検証
   - `[]`: 空のフィーチャーリスト
   - ベア仕様: `null`（後でローダーのデフォルトポリシーを使用）
7. ロックファイルのランタイム状態をアップサート: `{ version, enabledFeatures, enabled: true }`

### 更新のセマンティクス

更新はインストールによって行われるため:

- `xcsh plugin install pkg@newVersion` は依存関係とロックファイルのバージョンを更新します。
- 既存の設定は保持されます。バージョン/フィーチャー/有効状態のエントリーは上書きされます。
- 個別の「更新チェック」やトランザクション型マイグレーションロジックは存在しません。

## 削除フロー（`PluginManager.uninstall`）

1. パッケージ名を検証します。
2. プラグインディレクトリで `bun uninstall <name>` を実行します。
3. ロックファイルからプラグインのランタイム状態を削除します:
   - `config.plugins[name]`
   - `config.settings[name]`

アンインストールコマンドが失敗した場合、ランタイム状態は変更されません。

## リストフロー（`PluginManager.list`）

1. `~/.xcsh/plugins/package.json` からプラグイン依存関係マップを読み込みます。
2. ロックファイルのランタイム設定を読み込みます（ファイルが存在しない場合は空のデフォルト値）。
3. プロジェクトオーバーライドを読み込みます（`<cwd>/.xcsh/plugin-overrides.json`、解析/読み取りエラーの場合は警告を出して空オブジェクト）。
4. `package.json` が解決可能な各依存関係に対して:
   - `InstalledPlugin` レコードを構築
   - フィーチャー/有効状態をマージ:
     - ベースはロックファイルから（またはデフォルト値）
     - プロジェクトオーバーライドでフィーチャー選択を置き換え可能
     - プロジェクトの `disabled` リストによりプラグインが無効としてマスクされる

これが CLI のステータス出力および設定/フィーチャー操作で使用される実効状態です。

## リンクフロー（`PluginManager.link`）

`link` はローカルパッケージを `~/.xcsh/plugins/node_modules/<pkg.name>` にシンボリックリンクすることで、ローカルプラグイン開発をサポートします。

動作:

1. マネージャーの cwd に対して `localPath` を解決します。
2. ローカルの `package.json` と `name` フィールドの存在を要求します。
3. プラグインディレクトリが存在することを確認します。
4. スコープ付き名の場合、スコープディレクトリを作成します。
5. リンクターゲットの既存パスを削除します。
6. シンボリックリンクを作成します。
7. デフォルトフィーチャー（`null`）で有効なロックファイルエントリーを追加します。

注意点: 現在の `PluginManager.link` は、レガシーの `installer.ts` に存在する `cwd` パス境界チェック（`normalizedPath.startsWith(normalizedCwd)`）を強制しないため、信頼は呼び出し元の責任となります。

## ランタイムローディング: インストール済みプラグインから呼び出し可能な機能まで

## ディスカバリーゲート

`getEnabledPlugins(cwd)`（`plugins/loader.ts`）が読み込む内容:

- プラグイン依存関係マニフェスト（`package.json`）
- ロックファイルのランタイム状態
- `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })` 経由のプロジェクトオーバーライド

フィルタリング:

- プラグインの `package.json` がない場合はスキップ
- マニフェスト（`xcsh`/`pi`）がない場合はスキップ
- ロックファイルでグローバルに無効化されている場合はスキップ
- プロジェクトで無効化されている場合はスキップ

## 機能パスの解決

有効な各プラグインに対して:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

各リゾルバーはベースエントリーとフィーチャーエントリーを含みます:

- 明示的なフィーチャーリスト -> 選択したフィーチャーのみ
- `enabledFeatures === null` -> `default: true` とマークされたフィーチャーを有効化

存在しないファイルはサイレントにスキップされます（`existsSync` ガード）。

## 現在のランタイム配線の違い

- **ツールは現在ランタイムに配線されています**: `discoverAndLoadCustomTools`（`custom-tools/loader.ts`）経由で、`getAllPluginToolPaths(cwd)` を呼び出します。
- パスはカスタムツールディスカバリー内で解決済み絶対パスによって重複排除されます（`seen` セット、最初のパスが優先）。
- **フック/コマンドリゾルバーは存在**してエクスポートされていますが、このコードパスは現在ツールと同じ方法でランタイムレジストリに配線されていません。

## ロック/状態管理の詳細

`PluginManager` はランタイム設定をインスタンスごとにメモリ内（`#runtimeConfig`）にキャッシュし、初回アクセス時に遅延読み込みします。

読み込み動作:

- ロックファイルが存在しない場合 -> `{ plugins: {}, settings: {} }`
- ロックファイルの読み込み/解析に失敗した場合 -> 警告＋同じ空のデフォルト値

保存動作:

- ミューテーションのたびにロックファイル全体を JSON プリティプリント形式で書き込みます

クロスプロセスのロックやマージ戦略は存在しません。並行した書き込みは互いに上書きする可能性があります。

## セキュリティチェックと信頼境界

## 入力/パッケージの検証

アクティブなマネージャーパスではパッケージ名の検証を強制します:

- スコープ付き/スコープなしパッケージ仕様（オプションのバージョン付き）の正規表現
- 明示的なシェルメタキャラクター拒否リスト（`[;&|`$(){}[]<>\\]`）

これにより、`bun install/uninstall` を呼び出す際のコマンドインジェクションリスクが制限されます。

## ファイルシステムの信頼境界

- プラグインコードはカスタムツールモジュールのインポート時にインプロセスで実行されます。サンドボックス化はありません。
- マニフェストの相対パスはプラグインパッケージディレクトリに対して結合され、存在チェックのみが行われます。
- プラグインパッケージ自体はインストール後は信頼されたコードとして扱われます。

## レガシーインストーラー専用のチェック

`installer.ts` には `PluginManager.link` に反映されていない追加のリンク時チェックが含まれます:

- ローカルパスはプロジェクトの cwd 内に解決される必要があります
- シンボリックリンクターゲットの命名に関する追加のパッケージ名/パストラバーサルガード

CLI は `PluginManager` を使用しているため、これらの厳格なリンクガードは現在メインパスには存在しません。

## 失敗、部分的成功、ロールバックの動作

プラグインマネージャーはトランザクション処理を行いません。

| 操作ステージ | 失敗時の動作 | ロールバック |
| --- | --- | --- |
| `bun install` が失敗 | stderr でインストール中断 | 該当なし（状態の書き込みはまだ行われていない） |
| インストール成功後、マニフェスト/フィーチャー検証が失敗 | コマンド失敗 | アンインストールのロールバックなし。依存関係が `node_modules`/`package.json` に残る場合あり |
| インストール成功後、ロックファイルの書き込みが失敗 | コマンド失敗 | インストール済みパッケージのロールバックなし |
| `bun uninstall` 成功後、ロックファイルの書き込みが失敗 | コマンド失敗 | パッケージは削除済み、古いランタイム状態が残る場合あり |
| `link` が古いターゲットを削除後、シンボリックリンクの作成に失敗 | コマンド失敗 | 以前のリンク/ディレクトリの復元なし |

運用上、`doctor --fix` は一部のドリフトを修復できます（`bun install`、孤立した設定のクリーンアップ、無効なフィーチャーのクリーンアップ）が、ベストエフォートです。

## 不正/欠損マニフェストの動作まとめ

- `xcsh`/`pi` フィールドが欠損している場合:
  - インストール/リスト: 許容（最小限のマニフェスト）
  - ランタイムの有効プラグインディスカバリー: 非プラグインとしてスキップ
- インストール仕様または `features --set/--enable` で参照されているフィーチャーが存在しない場合: 利用可能なフィーチャーリストとともにハードエラー
- `plugin-overrides.json` が不正な場合: マネージャーとローダーの両パスで `{}` にフォールバックして無視（警告あり）
- マニフェストで参照されているツール/フック/コマンドのファイルパスが存在しない場合: リゾルバーの展開時にサイレントに無視。`doctor` によってのみエラーとして報告

## モードの違いと優先順位

- `--dry-run`（インストール）: 合成されたインストール結果を返し、ファイルシステム/ネットワーク/状態への書き込みは行いません。
- `--json`: 出力フォーマットのみ、動作の変更なし。
- プロジェクトオーバーライドは常にグローバルロックファイルよりフィーチャー/設定の表示で優先されます。
- 実効的な有効状態は `runtimeEnabled && !projectDisabled` です。

## 実装ファイル

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI コマンド宣言とフラグマッピング
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — アクションディスパッチ、ユーザー向けコマンドハンドラー
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — アクティブなインストール/削除/リスト/リンク/状態/doctor 実装
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — レガシーインストーラーヘルパーと追加のリンクセキュリティチェック
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 有効プラグインのディスカバリーとツール/フック/コマンドのパス解決
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — インストール仕様とパッケージ名の解析ヘルパー
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — マニフェスト/ランタイム/オーバーライドの型定義
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — プラグイン提供のツールモジュールのランタイム配線
