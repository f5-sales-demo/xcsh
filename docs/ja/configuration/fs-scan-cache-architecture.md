---
title: ファイルシステムスキャンキャッシュアーキテクチャ
description: stale-while-revalidateセマンティクスによる高速ファイル検出のためのファイルシステムスキャンキャッシュ規約。
sidebar:
  order: 8
  label: ファイルシステムスキャンキャッシュ
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# ファイルシステムスキャンキャッシュアーキテクチャ規約

このドキュメントでは、Rustで実装された共有ファイルシステムスキャンキャッシュ（`crates/pi-natives/src/fs_cache.rs`）の現在の規約と、`packages/coding-agent`に公開されるネイティブディスカバリ/検索APIでの利用について定義します。

## このキャッシュとは

このキャッシュは、スキャンスコープとトラバーサルポリシーをキーとしたディレクトリスキャンエントリの完全なリスト（`GlobMatch[]`）を保持し、上位レベルの操作（globフィルタリング、ファジースコアリング、grepファイル選択）がキャッシュされたエントリに対して実行できるようにします。

主な目標：

- 繰り返されるディスカバリ/検索呼び出しでのファイルシステムウォークの重複を回避する
- `glob`、`fuzzyFind`、`grep`が同じスキャンポリシーを共有する場合の一貫性を維持する
- 空の結果に対する明示的な陳腐化回復と、ファイル変更後の明示的な無効化を可能にする

## 所有権とパブリックサーフェス

- キャッシュの実装とポリシー: `crates/pi-natives/src/fs_cache.rs`
- ネイティブコンシューマ:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs`（`fuzzyFind`）
  - `crates/pi-natives/src/grep.rs`
- JSバインディング/エクスポート:
  - `packages/natives/src/glob/index.ts`（`invalidateFsScanCache`）
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agentミューテーション無効化ヘルパー:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## キャッシュキーのパーティショニング（厳格な規約）

各エントリは以下をキーとします：

- 正規化された`root`ディレクトリパス
- `include_hidden`ブール値
- `use_gitignore`ブール値

含意：

- 隠しファイル対象と非対象のスキャンはエントリを**共有しません**。
- gitignore準拠と無視無効のスキャンはエントリを**共有しません**。
- コンシューマは隠しファイル/gitignoreの動作に安定したセマンティクスを渡す必要があります。いずれかのフラグを変更すると、異なるキャッシュパーティションが作成されます。

`node_modules`の包含はキャッシュキーに**含まれません**。キャッシュは`node_modules`を含むエントリを保存し、コンシューマごとのフィルタリングは取得後に適用されます。

## スキャン収集の動作

キャッシュの初期化には、`include_hidden`と`use_gitignore`で設定される決定論的ウォーカー（`ignore::WalkBuilder`）を使用します：

- `follow_links(false)`
- ファイルパスでソート
- `.git`は常にスキップ
- `node_modules`はキャッシュスキャン時に常に収集（後でオプションでフィルタリング）
- エントリのファイルタイプ＋`mtime`は`symlink_metadata`を介して取得

検索ルートは`resolve_search_path`で解決されます：

- 相対パスは現在のcwdに対して解決
- ターゲットは既存のディレクトリである必要あり
- ルートは可能な場合に正規化

## 鮮度とエビクションポリシー

グローバルポリシー（環境変数でオーバーライド可能）：

- `FS_SCAN_CACHE_TTL_MS`（デフォルト`1000`）
- `FS_SCAN_EMPTY_RECHECK_MS`（デフォルト`200`）
- `FS_SCAN_CACHE_MAX_ENTRIES`（デフォルト`16`）

動作：

- `get_or_scan(...)`
  - TTLが`0`の場合：キャッシュを完全にバイパスし、常に新規スキャン（`cache_age_ms = 0`）
  - TTL内のキャッシュヒット時：キャッシュされたエントリ＋ゼロでない`cache_age_ms`を返す
  - 期限切れのヒット時：キーをエビクトし、再スキャンし、新しいエントリを保存
- 最大エントリの適用は`created_at`に基づく最古優先のエビクション

## 空結果の高速再チェック（通常のヒットとは別）

通常のキャッシュヒット：

- TTL内のキャッシュヒットはキャッシュされたエントリを返し、それ以外は何もしません。

空結果の高速再チェック：

- これは`ScanResult.cache_age_ms`を使用した**呼び出し元側**のポリシーです
- フィルタリング/クエリ結果が空で、キャッシュされたスキャンの経過時間が少なくとも`empty_recheck_ms()`以上の場合、呼び出し元は`force_rescan(...)`を1回実行してリトライします
- ファイルが最近追加されたがキャッシュがまだTTL内にある場合の陳腐化した否定結果を減らすことを意図しています

現在のコンシューマ：

- `glob`：フィルタリングされたマッチが空でスキャン経過時間がしきい値を超えた場合に再チェック
- `fuzzyFind`（`fd.rs`）：クエリが空でなく、スコアリングされたマッチが空の場合のみ再チェック
- `grep`：選択された候補ファイルリストが空の場合に再チェック

## コンシューマのデフォルトとキャッシュ使用

キャッシュはすべての公開APIでオプトイン方式です（`cache?: boolean`、デフォルト`false`）。

ネイティブAPIの現在のデフォルト：

- `glob`：`hidden=false`、`gitignore=true`、`cache=false`
- `fuzzyFind`：`hidden=false`、`gitignore=true`、`cache=false`
- `grep`：`hidden=true`、`cache=false`、キャッシュスキャンは常に`use_gitignore=true`を使用

現在のCoding-agent呼び出し元：

- 大量のメンション候補ディスカバリはキャッシュを有効化：
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - プロファイル：`hidden=true`、`gitignore=true`、`includeNodeModules=true`、`cache=true`
- ツールレベルの`grep`統合は現在スキャンキャッシュを無効化（`cache: false`）：
  - `packages/coding-agent/src/tools/grep.ts`

## 無効化の規約

ネイティブ無効化エントリポイント：

- `invalidateFsScanCache(path?: string)`
  - `path`あり：ルートがターゲットパスのプレフィックスであるキャッシュエントリを削除
  - `path`なし：すべてのスキャンキャッシュエントリをクリア

パス処理の詳細：

- 相対的な無効化パスはcwdに対して解決
- 無効化は正規化を試行
- ターゲットが存在しない場合（例：削除時）、フォールバックとして親を正規化し、可能な場合はファイル名を再付加
- これにより、一方が存在しない可能性がある作成/削除/リネーム時の無効化動作が維持されます

## Coding-agentミューテーションフローの責任

Coding-agentコードは、ファイルシステムミューテーションが成功した後に無効化を行う必要があります。

中央ヘルパー：

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)`（パスが異なる場合は両側を無効化）

現在のミューテーションツール呼び出し箇所：

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts`（hashline/patch/replaceフロー）

ルール：ファイルシステムの内容や場所を変更するフローがこれらのヘルパーをバイパスした場合、キャッシュの陳腐化バグが予想されます。

## 新しいキャッシュコンシューマを安全に追加する

新しいスキャナ/検索パスにキャッシュ使用を導入する場合：

1. **安定したスキャンポリシー入力を使用する**
   - まず隠しファイル/gitignoreのセマンティクスを決定する
   - キャッシュパーティションが意図的になるよう、`get_or_scan`/`force_rescan`に一貫して渡す

2. **キャッシュデータはトラバーサルポリシーによるプレフィルタリングのみと扱う**
   - 取得後にツール固有のフィルタリング（globパターン、タイプフィルタ、node_modulesルール）を適用する
   - キャッシュされたエントリが上位レベルのフィルタを既に反映していると仮定しない

3. **陳腐化した否定結果のリスクがある場合のみ空結果高速再チェックを実装する**
   - `scan.cache_age_ms >= empty_recheck_ms()`を使用する
   - `force_rescan(..., store=true, ...)`で1回リトライする
   - このパスを通常のキャッシュヒットロジックとは分離する

4. **キャッシュ無効モードを明示的に尊重する**
   - 呼び出し元がキャッシュを無効にした場合、`force_rescan(..., store=false, ...)`を呼び出す
   - キャッシュ無効リクエストパスで共有キャッシュを投入しない

5. **新しい書き込みパスにミューテーション無効化を接続する**
   - 書き込み/編集/削除/リネームが成功した後、coding-agentの無効化ヘルパーを呼び出す
   - リネーム/移動の場合、古いパスと新しいパスの両方を無効化する

6. **呼び出しごとのTTLノブを追加しない**
   - 現在の規約はグローバルポリシーのみ（環境変数で設定）、リクエストごとのTTLオーバーライドなし

## 既知の境界

- キャッシュスコープはプロセスローカルのインメモリ（`DashMap`）であり、プロセス再起動をまたいで永続化されません。
- キャッシュはスキャンエントリを保存し、最終的なツール結果は保存しません。
- `glob`/`fuzzyFind`/`grep`は、キーの次元（`root`、`hidden`、`gitignore`）が一致する場合にのみスキャンエントリを共有します。
- `.git`は呼び出し元のオプションに関係なく、スキャン収集時に常に除外されます。
