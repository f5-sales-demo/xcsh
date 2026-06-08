---
title: ファイルシステムスキャンキャッシュアーキテクチャ
description: stale-while-revalidateセマンティクスによる高速ファイル検出のためのファイルシステムスキャンキャッシュコントラクト。
sidebar:
  order: 8
  label: ファイルシステムスキャンキャッシュ
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# ファイルシステムスキャンキャッシュ アーキテクチャコントラクト

このドキュメントでは、Rustで実装された共有ファイルシステムスキャンキャッシュ（`crates/pi-natives/src/fs_cache.rs`）の現在のコントラクトを定義し、`packages/coding-agent` に公開されるネイティブディスカバリー/検索APIによって利用されます。

## このキャッシュとは

キャッシュは、スキャンスコープとトラバーサルポリシーをキーとして完全なディレクトリスキャンエントリリスト（`GlobMatch[]`）を保存し、上位レベルの操作（globフィルタリング、ファジースコアリング、grepファイル選択）がこれらのキャッシュされたエントリに対して実行されるようにします。

主な目標：

- 繰り返しのディスカバリー/検索呼び出しに対するファイルシステムウォークの重複を回避する
- 同じスキャンポリシーを共有する `glob`、`fuzzyFind`、`grep` 間の一貫性を維持する
- 空の結果に対する明示的な陳腐化回復とファイル変更後の明示的な無効化を可能にする

## オーナーシップとパブリックサーフェス

- キャッシュ実装とポリシー: `crates/pi-natives/src/fs_cache.rs`
- ネイティブコンシューマー:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JSバインディング/エクスポート:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agentミューテーション無効化ヘルパー:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## キャッシュキーのパーティショニング（ハードコントラクト）

各エントリは以下をキーとします：

- 正規化された `root` ディレクトリパス
- `include_hidden` ブーリアン
- `use_gitignore` ブーリアン

意味：

- 隠しファイルと非隠しファイルのスキャンはエントリを共有**しません**。
- gitignoreを尊重するスキャンとignoreを無効にしたスキャンはエントリを共有**しません**。
- コンシューマーはhidden/gitignoreの動作に対して安定したセマンティクスを渡す必要があります。いずれかのフラグを変更すると異なるキャッシュパーティションが作成されます。

`node_modules` の包含はキャッシュキーに**含まれません**。キャッシュは `node_modules` を含むエントリを保存し、コンシューマーごとのフィルタリングは取得後に適用されます。

## スキャン収集動作

キャッシュの投入は、`include_hidden` と `use_gitignore` で構成された決定論的ウォーカー（`ignore::WalkBuilder`）を使用します：

- `follow_links(false)`
- ファイルパスでソート
- `.git` は常にスキップ
- `node_modules` はキャッシュスキャン時に常に収集（オプションで後からフィルタリング）
- エントリのファイルタイプ + `mtime` は `symlink_metadata` で取得

検索ルートは `resolve_search_path` で解決されます：

- 相対パスは現在のcwdに対して解決
- ターゲットは既存のディレクトリである必要がある
- ルートは可能な場合正規化される

## 鮮度とエビクションポリシー

グローバルポリシー（環境変数でオーバーライド可能）：

- `FS_SCAN_CACHE_TTL_MS`（デフォルト `1000`）
- `FS_SCAN_EMPTY_RECHECK_MS`（デフォルト `200`）
- `FS_SCAN_CACHE_MAX_ENTRIES`（デフォルト `16`）

動作：

- `get_or_scan(...)`
  - TTLが `0` の場合：キャッシュを完全にバイパスし、常にフレッシュスキャン（`cache_age_ms = 0`）
  - TTL内のキャッシュヒット時：キャッシュされたエントリ + ゼロでない `cache_age_ms` を返す
  - 期限切れヒット時：キーをエビクトし、再スキャンし、フレッシュエントリを保存
- 最大エントリの強制は `created_at` による古い順エビクション

## 空結果の高速再チェック（通常ヒットとは別）

通常のキャッシュヒット：

- TTL内のキャッシュヒットはキャッシュされたエントリを返し、他に何もしません。

空結果の高速再チェック：

- これは `ScanResult.cache_age_ms` を使用する**呼び出し側**のポリシーです
- フィルタリング/クエリ結果が空で、キャッシュされたスキャンの経過時間が `empty_recheck_ms()` 以上の場合、呼び出し側は一度 `force_rescan(...)` を実行してリトライします
- ファイルが最近追加されたがキャッシュがまだTTL内にある場合の、陳腐化したネガティブ結果を減らすことを目的としています

現在のコンシューマー：

- `glob`：フィルタリングされたマッチが空で、スキャン経過時間がしきい値を超えた場合に再チェック
- `fuzzyFind`（`fd.rs`）：クエリが空でなく、スコアリングされたマッチが空の場合にのみ再チェック
- `grep`：選択された候補ファイルリストが空の場合に再チェック

## コンシューマーのデフォルトとキャッシュの使用

キャッシュは公開されたすべてのAPIでオプトイン（`cache?: boolean`、デフォルト `false`）です。

ネイティブAPIの現在のデフォルト：

- `glob`：`hidden=false`、`gitignore=true`、`cache=false`
- `fuzzyFind`：`hidden=false`、`gitignore=true`、`cache=false`
- `grep`：`hidden=true`、`cache=false`、キャッシュスキャンは常に `use_gitignore=true` を使用

現在のCoding-agent呼び出し元：

- 大量のメンション候補ディスカバリーはキャッシュを有効化：
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - プロファイル：`hidden=true`、`gitignore=true`、`includeNodeModules=true`、`cache=true`
- ツールレベルの `grep` 統合は現在スキャンキャッシュを無効化（`cache: false`）：
  - `packages/coding-agent/src/tools/grep.ts`

## 無効化コントラクト

ネイティブ無効化エントリポイント：

- `invalidateFsScanCache(path?: string)`
  - `path` あり：ルートがターゲットパスのプレフィックスであるキャッシュエントリを削除
  - `path` なし：すべてのスキャンキャッシュエントリをクリア

パス処理の詳細：

- 相対無効化パスはcwdに対して解決
- 無効化は正規化を試行
- ターゲットが存在しない場合（例：削除）、フォールバックとして親を正規化し、可能な場合はファイル名を再付加
- これにより、一方が存在しない可能性がある作成/削除/名前変更の無効化動作が保持される

## Coding-agentミューテーションフローの責務

Coding-agentコードは、ファイルシステムのミューテーションが成功した後に無効化する必要があります。

中央ヘルパー：

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)`（パスが異なる場合、両方を無効化）

現在のミューテーションツールの呼び出し箇所：

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts`（hashline/patch/replaceフロー）

ルール：フローがファイルシステムのコンテンツまたは場所を変更し、これらのヘルパーをバイパスする場合、キャッシュの陳腐化バグが発生することが予想されます。

## 新しいキャッシュコンシューマーを安全に追加する

新しいスキャナー/検索パスでキャッシュの使用を導入する場合：

1. **安定したスキャンポリシー入力を使用する**
   - まずhidden/gitignoreのセマンティクスを決定する
   - キャッシュパーティションが意図的になるよう、`get_or_scan`/`force_rescan` に一貫して渡す

2. **キャッシュデータをトラバーサルポリシーによるプリフィルタリングのみとして扱う**
   - ツール固有のフィルタリング（globパターン、タイプフィルター、node_modulesルール）は取得後に適用する
   - キャッシュされたエントリが上位レベルのフィルターを既に反映していると仮定しない

3. **陳腐化ネガティブリスクに対してのみ空結果の高速再チェックを実装する**
   - `scan.cache_age_ms >= empty_recheck_ms()` を使用する
   - `force_rescan(..., store=true, ...)` で一度リトライする
   - このパスを通常のキャッシュヒットロジックとは別に保つ

4. **キャッシュ無効モードを明示的に尊重する**
   - 呼び出し側がキャッシュを無効にした場合、`force_rescan(..., store=false, ...)` を呼び出す
   - キャッシュ無効リクエストパスで共有キャッシュを投入しない

5. **新しい書き込みパスに対してミューテーション無効化を組み込む**
   - 書き込み/編集/削除/名前変更が成功した後、coding-agent無効化ヘルパーを呼び出す
   - 名前変更/移動の場合、古いパスと新しいパスの両方を無効化する

6. **呼び出しごとのTTLノブを追加しない**
   - 現在のコントラクトはグローバルポリシーのみ（環境変数で設定）、リクエストごとのTTLオーバーライドなし

## 既知の境界

- キャッシュスコープはプロセスローカルのインメモリ（`DashMap`）であり、プロセス再起動をまたいで永続化されません。
- キャッシュはスキャンエントリを保存し、最終的なツール結果は保存しません。
- `glob`/`fuzzyFind`/`grep` は、キーの次元（`root`、`hidden`、`gitignore`）が一致する場合にのみスキャンエントリを共有します。
- `.git` は呼び出し側のオプションに関係なく、スキャン収集時に常に除外されます。
