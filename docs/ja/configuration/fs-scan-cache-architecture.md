---
title: ファイルシステムスキャンキャッシュアーキテクチャ
description: >-
  Filesystem scan cache contract for fast file discovery with
  stale-while-revalidate semantics.
sidebar:
  order: 8
  label: ファイルシステムスキャンキャッシュ
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# ファイルシステムスキャンキャッシュ アーキテクチャ契約

このドキュメントは、Rust（`crates/pi-natives/src/fs_cache.rs`）で実装され、`packages/coding-agent` に公開されるネイティブのディスカバリ/検索 API が利用する共有ファイルシステムスキャンキャッシュの現行契約を定義します。

## このキャッシュとは

キャッシュは、スキャンスコープとトラバーサルポリシーをキーとして、完全なディレクトリスキャンエントリリスト（`GlobMatch[]`）を保存し、上位レベルの操作（globフィルタリング、ファジースコアリング、grepファイル選択）がこれらのキャッシュされたエントリに対して実行できるようにします。

主な目標：

- 繰り返しのディスカバリ/検索呼び出しに対する重複したファイルシステムウォークの回避
- `glob`、`fuzzyFind`、`grep` が同じスキャンポリシーを共有する場合の一貫性の維持
- 空の結果に対する明示的な陳腐化回復と、ファイル変更後の明示的な無効化の許可

## 所有権と公開サーフェス

- キャッシュの実装とポリシー: `crates/pi-natives/src/fs_cache.rs`
- ネイティブコンシューマー:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs`（`fuzzyFind`）
  - `crates/pi-natives/src/grep.rs`
- JSバインディング/エクスポート:
  - `packages/natives/src/glob/index.ts`（`invalidateFsScanCache`）
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agent の変更時無効化ヘルパー:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## キャッシュキーのパーティショニング（厳格な契約）

各エントリは以下をキーとします：

- 正規化された `root` ディレクトリパス
- `include_hidden` ブール値
- `use_gitignore` ブール値

影響：

- 隠しファイル対象と非対象のスキャンはエントリを **共有しません**。
- gitignore 準拠と無視無効のスキャンはエントリを **共有しません**。
- コンシューマーは hidden/gitignore の動作について安定したセマンティクスを渡す必要があります。いずれかのフラグを変更すると、異なるキャッシュパーティションが作成されます。

`node_modules` の包含はキャッシュキーに **含まれません**。キャッシュは `node_modules` を含むエントリを保存し、コンシューマーごとのフィルタリングは取得後に適用されます。

## スキャン収集の動作

キャッシュの作成には、`include_hidden` と `use_gitignore` で設定される決定論的ウォーカー（`ignore::WalkBuilder`）を使用します：

- `follow_links(false)`
- ファイルパスでソート
- `.git` は常にスキップ
- `node_modules` はキャッシュスキャン時に常に収集（後でオプションでフィルタリング）
- エントリのファイルタイプ + `mtime` は `symlink_metadata` を介して取得

検索ルートは `resolve_search_path` で解決されます：

- 相対パスは現在の cwd に対して解決
- ターゲットは既存のディレクトリである必要がある
- ルートは可能な場合に正規化される

## 鮮度とエビクションポリシー

グローバルポリシー（環境変数でオーバーライド可能）：

- `FS_SCAN_CACHE_TTL_MS`（デフォルト `1000`）
- `FS_SCAN_EMPTY_RECHECK_MS`（デフォルト `200`）
- `FS_SCAN_CACHE_MAX_ENTRIES`（デフォルト `16`）

動作：

- `get_or_scan(...)`
  - TTL が `0` の場合：キャッシュを完全にバイパスし、常にフレッシュスキャン（`cache_age_ms = 0`）
  - TTL 内のキャッシュヒット時：キャッシュされたエントリ + 非ゼロの `cache_age_ms` を返す
  - 期限切れのヒット時：キーをエビクト、再スキャン、フレッシュエントリを保存
- 最大エントリ数の強制は `created_at` による最古優先エビクション

## 空の結果の高速再チェック（通常のヒットとは別）

通常のキャッシュヒット：

- TTL 内のキャッシュヒットはキャッシュされたエントリを返し、他に何もしません。

空の結果の高速再チェック：

- これは `ScanResult.cache_age_ms` を使用する **呼び出し側** のポリシーです
- フィルタ/クエリ結果が空で、キャッシュスキャンの経過時間が少なくとも `empty_recheck_ms()` の場合、呼び出し側は1回の `force_rescan(...)` を実行してリトライします
- ファイルが最近追加されたがキャッシュがまだ TTL 内である場合の、陳腐化したネガティブ結果を減らすことを目的としています

現在のコンシューマー：

- `glob`：フィルタされたマッチが空でスキャン経過時間がしきい値を超えた場合に再チェック
- `fuzzyFind`（`fd.rs`）：クエリが空でなく、スコアリングされたマッチが空の場合のみ再チェック
- `grep`：選択された候補ファイルリストが空の場合に再チェック

## コンシューマーのデフォルトとキャッシュの使用

キャッシュは公開されるすべての API でオプトイン方式です（`cache?: boolean`、デフォルト `false`）。

ネイティブ API の現在のデフォルト：

- `glob`：`hidden=false`、`gitignore=true`、`cache=false`
- `fuzzyFind`：`hidden=false`、`gitignore=true`、`cache=false`
- `grep`：`hidden=true`、`cache=false`、キャッシュスキャンは常に `use_gitignore=true` を使用

現在の Coding-agent の呼び出し側：

- 大量のメンション候補ディスカバリではキャッシュを有効化：
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - プロファイル：`hidden=true`、`gitignore=true`、`includeNodeModules=true`、`cache=true`
- ツールレベルの `grep` 統合は現在スキャンキャッシュを無効化（`cache: false`）：
  - `packages/coding-agent/src/tools/grep.ts`

## 無効化の契約

ネイティブの無効化エントリポイント：

- `invalidateFsScanCache(path?: string)`
  - `path` あり：ルートがターゲットパスのプレフィックスであるキャッシュエントリを削除
  - `path` なし：すべてのスキャンキャッシュエントリをクリア

パス処理の詳細：

- 相対的な無効化パスは cwd に対して解決
- 無効化は正規化を試行
- ターゲットが存在しない場合（例：削除）、フォールバックとして親を正規化し、可能な場合はファイル名を再付加
- これにより、一方が存在しない可能性のある作成/削除/リネームでの無効化動作が保持される

## Coding-agent の変更フローの責任

Coding-agent のコードは、ファイルシステムの変更が成功した後にキャッシュを無効化する必要があります。

中央ヘルパー：

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)`（パスが異なる場合は両方を無効化）

現在の変更ツールの呼び出し箇所：

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts`（hashline/patch/replace フロー）

ルール：フローがファイルシステムのコンテンツまたは場所を変更し、これらのヘルパーをバイパスする場合、キャッシュの陳腐化バグが発生することが想定されます。

## 新しいキャッシュコンシューマーを安全に追加する

新しいスキャナー/検索パスでキャッシュの使用を導入する場合：

1. **安定したスキャンポリシー入力を使用する**
   - まず hidden/gitignore のセマンティクスを決定する
   - キャッシュパーティションが意図的になるよう、`get_or_scan`/`force_rescan` に一貫して渡す

2. **キャッシュデータはトラバーサルポリシーによるプレフィルタリングのみと扱う**
   - ツール固有のフィルタリング（globパターン、タイプフィルタ、node_modulesルール）は取得後に適用する
   - キャッシュされたエントリが上位レベルのフィルタをすでに反映していると想定しない

3. **陳腐化したネガティブリスクに対してのみ空の結果の高速再チェックを実装する**
   - `scan.cache_age_ms >= empty_recheck_ms()` を使用する
   - `force_rescan(..., store=true, ...)` で1回リトライする
   - このパスは通常のキャッシュヒットロジックとは分離する

4. **キャッシュ無効モードを明示的に尊重する**
   - 呼び出し側がキャッシュを無効にした場合、`force_rescan(..., store=false, ...)` を呼び出す
   - キャッシュ無効のリクエストパスで共有キャッシュを作成しない

5. **新しい書き込みパスに対して変更時無効化を接続する**
   - 書き込み/編集/削除/リネームが成功した後、coding-agent の無効化ヘルパーを呼び出す
   - リネーム/移動の場合、古いパスと新しいパスの両方を無効化する

6. **呼び出しごとの TTL 調整を追加しない**
   - 現在の契約はグローバルポリシーのみ（環境変数で設定）、リクエストごとの TTL オーバーライドなし

## 既知の境界

- キャッシュスコープはプロセスローカルのインメモリ（`DashMap`）であり、プロセスの再起動をまたいで永続化されません。
- キャッシュはスキャンエントリを保存し、最終的なツールの結果は保存しません。
- `glob`/`fuzzyFind`/`grep` は、キーの次元（`root`、`hidden`、`gitignore`）が一致する場合のみスキャンエントリを共有します。
- `.git` は呼び出し側のオプションに関係なく、スキャン収集時に常に除外されます。
