---
title: Natives テキスト＆検索パイプライン
description: grep、glob、および ripgrep ベースのファイルコンテンツインデックスによるネイティブテキスト検索パイプライン。
sidebar:
  order: 6
  label: テキスト＆検索パイプライン
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Natives テキスト/検索パイプライン

このドキュメントでは、`@f5-sales-demo/pi-natives` のテキスト/検索サーフェス（`grep`、`glob`、`text`、`highlight`）について、TypeScript ラッパーから Rust N-API エクスポート、そして JS 結果オブジェクトへのマッピングを説明します。

用語は `docs/natives-architecture.md` に従います：

- **Wrapper**: `packages/natives/src/*` 内の TS API
- **Rust モジュールレイヤー**: `crates/pi-natives/src/*` 内の N-API エクスポート
- **共有スキャンキャッシュ**: ディスカバリー/検索フローで使用される `fs_cache` ベースのディレクトリエントリキャッシュ

## 実装ファイル

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## JS API ↔ Rust エクスポートマッピング

| JS ラッパー API | Rust エクスポート (`#[napi]`, snake_case -> camelCase) | Rust モジュール |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## サブシステム別パイプライン概要

## 1) 正規表現検索 (`grep`、`searchContent`、`hasMatch`)

### 入力/オプションフロー

1. TS ラッパーがオプションをネイティブに転送します：
   - `grep/index.ts` は `options` をほぼそのまま渡し、コールバックを `(match) => void` から napi スレッドセーフコールバック形式 `(err, match)` にラップします。
   - `searchContent` と `hasMatch` は文字列/`Uint8Array` を直接渡します。
2. `grep.rs` 内の Rust オプション構造体がキャメルケースフィールド（`ignoreCase`、`maxCount`、`contextBefore`、`contextAfter`、`maxColumns`、`timeoutMs`）をデシリアライズします。
3. `grep` は `timeoutMs` + `AbortSignal` から `CancelToken` を作成し、`task::blocking("grep", ...)` 内で実行します。

### 実行ブランチ

- **インメモリブランチ（純粋ユーティリティ）**
  - `search` → `search_sync` → 提供されたコンテンツバイトに対して `run_search` を実行。
  - ファイルシステムスキャンなし、`fs_cache` なし。
- **単一ファイルブランチ（ファイルシステム依存）**
  - `grep_sync` がパスを解決し、メタデータがファイルであることを確認し、ripgrep マッチャーを通じてファイルごとに最大 `MAX_FILE_BYTES`（`4 MiB`）までストリームします。
- **ディレクトリブランチ（ファイルシステム依存）**
  - `cache: true` の場合、`fs_cache::get_or_scan` によるオプションのキャッシュルックアップ。
  - `cache: false` の場合、`fs_cache::force_rescan` による新規スキャン。
  - キャッシュ経過時間が `empty_recheck_ms()` を超えた場合のオプションの空結果再チェック。
  - エントリフィルタリング：ファイルのみ + オプションの glob フィルター（`glob_util`）+ オプションの型フィルターマッピング（`js`、`ts`、`rust` など）。

### 検索/収集セマンティクス

- 正規表現エンジン：`ignoreCase` と `multiline` を持つ `grep_regex::RegexMatcherBuilder`。
- コンテキスト解決：
  - `contextBefore/contextAfter` がレガシーの `context` をオーバーライド。
  - 非コンテンツモードではコンテキスト収集をゼロに設定。
- 出力モード：
  - `content` => ヒットごとに1つの `GrepMatch`。
  - `count` と `filesWithMatches` はともにカウントスタイルのエントリにマップ（`lineNumber=0`、`line=""`、`matchCount` が設定）。
- 制限：
  - グローバルな `offset` と `maxCount` がファイル全体にわたって適用。
  - `maxCount` が未設定で `offset == 0` の場合のみ並列パスが使用され、それ以外では決定的なグローバルオフセット/リミットセマンティクスを維持するために順次パスが使用されます。

### JS への結果整形

- Rust の `SearchResult`/`GrepResult` フィールドは N-API オブジェクトフィールド変換を通じて TS 型にマップされます。
- カウンターは N-API を越える前に `u32` にクランプされます。
- オプションのブール値は一部のパスで true の場合のみ含まれます（`limitReached`）。
- ストリーミングコールバックは整形された各 `GrepMatch`（コンテンツまたはカウントエントリ）を受け取ります。

### 失敗時の動作

- `searchContent` は正規表現/検索の失敗に対してスローする代わりに `SearchResult.error` を返します。
- `grep` はハードエラー（無効なパス、無効な glob/正規表現、キャンセルタイムアウト/アボート）で reject します。
- `hasMatch` は `Result<bool>` を返し、無効なパターン/UTF-8 デコードエラーでスローします。
- 複数ファイルスキャンでのファイルオープン/検索エラーはファイルごとにスキップされ、スキャンは続行します。

### 不正な正規表現の処理

`grep.rs` は正規表現コンパイル前に波括弧をサニタイズします：

- 無効な繰り返しのような波括弧は、`{N}`、`{N,}`、`{N,M}` を形成できない場合にエスケープされます（`{`/`}` -> `\{`/`\}`）。
- これにより、一般的なリテラルテンプレートフラグメント（例：`${platform}`）が不正な繰り返しとして失敗することを防ぎます。
- 残りの無効な正規表現構文は正規表現エラーを返します。

## 2) ファイルディスカバリー (`glob`) とファジーパス検索 (`fuzzyFind`)

`glob` と `fuzzyFind` は `fs_cache` スキャンを共有しますが、マッチングロジックは異なります。

### `glob` フロー

1. TS ラッパー（`glob/index.ts`）：
   - `path.resolve(options.path)`。
   - デフォルト値：`pattern="*"`、`hidden=false`、`gitignore=true`、`recursive=true`。
2. Rust の `glob` が `GlobConfig` を構築し、`glob_util::compile_glob` を通じてパターンをコンパイル。
3. エントリソース：
   - `cache=true` => `get_or_scan` + オプションの stale-empty `force_rescan`。
   - `cache=false` => `force_rescan(..., store=false)`（新規のみ）。
4. フィルタリング：
   - `.git` は常にスキップ。
   - リクエストされない限り `node_modules` をスキップ（`includeNodeModules` または node_modules を含むパターン）。
   - glob マッチを適用。
   - ファイルタイプフィルターを適用；シンボリックリンクの `file/dir` フィルターはターゲットメタデータを解決。
5. `maxResults` で切り捨てる前に、mtime 降順によるオプションのソート（`sortByMtime`）。

### `fuzzyFind` フロー（`fd.rs` に実装）

1. TS ラッパーは `grep` モジュールからエクスポートされますが、Rust の実装は `fd.rs` にあります。
2. `fs_cache` からの共有スキャンソースで、同じキャッシュ/非キャッシュ分岐と stale-empty 再チェックポリシー。
3. スコアリング：
   - 完全一致 / 前方一致 / 部分一致 / サブシーケンスベースのファジースコア
   - セパレーター/句読点で正規化されたスコアリングパス
   - ディレクトリボーナスと決定的なタイブレーク（`score desc`、次に `path asc`）
4. シンボリックリンクエントリはファジー結果から除外されます。

### 失敗時の動作

- 無効な glob パターン => `glob_util::compile_glob` からのエラー。
- 検索ルートは既存のディレクトリである必要があります（`resolve_search_path`）。そうでない場合はエラー。
- キャンセル/タイムアウトはループ内の `CancelToken::heartbeat()` チェックを通じてアボートエラーとして伝播します。

### 不正な glob の処理

`glob_util::build_glob_pattern` は寛容です：

- `\` を `/` に正規化。
- `recursive=true` の場合、単純な再帰パターンに `**/` を自動プレフィックス。
- コンパイル前に未閉じの `{...` 代替グループを自動的に閉じます。

## 3) 共有スキャン/キャッシュライフサイクル (`fs_cache`)

`fs_cache` はスキャン結果を正規化された相対エントリ（`path`、`fileType`、オプションの `mtime`）として以下のキーで保存します：

- 正規化された検索ルート
- `include_hidden`
- `use_gitignore`

### キャッシュ状態遷移

1. **ミス / 無効**
   - TTL が `0` またはキーが存在しない/期限切れ -> 新規 `collect_entries`。
2. **ヒット**
   - エントリ経過時間が `cache_ttl_ms()` 未満 -> キャッシュされたエントリ + `cache_age_ms` を返す。
3. **Stale-empty 再チェック**（`glob`/`grep`/`fd` での呼び出し側ポリシー）
   - クエリがゼロマッチで `cache_age_ms >= empty_recheck_ms()` の場合、1回の再スキャンを強制。
4. **無効化**
   - `invalidateFsScanCache(path?)`：
     - 引数なし：すべてのキーをクリア
     - パス引数：ルートがそのターゲットパスのプレフィックスであるキーを削除

### Stale 結果のトレードオフ

- キャッシュは即座の一貫性よりも低レイテンシの繰り返しスキャンを優先します。
- TTL ウィンドウは stale な正/偽の結果を返す可能性があります。
- 空結果の再チェックは、追加の1回のスキャンコストで古いキャッシュスキャンの stale な偽陰性を削減します。
- 明示的な無効化は、ファイル変更後の正確性フックとして意図されています。

## 4) ANSI テキストユーティリティ (`text`)

これらは純粋なインメモリユーティリティです（ファイルシステムスキャンなし）。

### 境界と責任

- **`text.rs` がターミナルセルセマンティクスを担当**：
  - ANSI シーケンスの解析
  - 書記素対応の幅とスライシング
  - ラップ/切り捨て/サニタイズ動作
- **`grep.rs` の行切り捨て（`maxColumns`）は別**：
  - マッチした行の `...` を伴う単純な文字境界切り捨て
  - ANSI 状態を維持せず、ターミナルセル幅を考慮しない

### 主要な動作

- `wrapTextWithAnsi`：可視幅で折り返し、アクティブな SGR コードを折り返された行に引き継ぎます。
- `truncateToWidth`：省略記号ポリシー（`Unicode`、`Ascii`、`Omit`）、オプションの右パディング、変更がない場合に元の JS 文字列を返すファストパスを持つ可視セル切り捨て。
- `sliceWithWidth`：オプションの厳密な幅制約を持つ列スライシング。
- `extractSegments`：オーバーレイの前後のセグメントを抽出し、`after` セグメントの ANSI 状態を復元します。
- `sanitizeText`：ANSI エスケープ + 制御文字を除去し、孤立サロゲートを削除し、`\r` を除去して CR/LF を正規化します。
- `visibleWidth`：可視ターミナルセルをカウントします（タブは Rust 実装の固定 `TAB_WIDTH` を使用）。

### 失敗時の動作

テキスト関数は一般的に決定的な変換された出力を返します。エラーは JS 文字列変換境界（N-API 引数変換の失敗）に限定されます。

## 5) シンタックスハイライト (`highlight`)

`highlight.rs` は純粋な変換です（FS なし、キャッシュなし）。

### フロー

1. ラッパーが `code`、オプションの `lang`、および ANSI カラーパレットを転送。
2. Rust が以下の方法でシンタックスを解決：
   - トークン/名前ルックアップ
   - 拡張子ルックアップ
   - エイリアステーブルフォールバック（`ts/tsx/js -> JavaScript` など）
   - 未解決時はプレーンテキストシンタックスにフォールバック
3. syntect の `ParseState` とスコープスタックで各行を解析。
4. スコープを 11 のセマンティックカラーカテゴリにマップし、ANSI カラーコードを注入/リセット。

### 失敗時の動作

- 行ごとの解析失敗は呼び出しを失敗させません：その行はハイライトされずに追加され、処理は続行します。
- 不明/サポートされていない言語はプレーンテキストシンタックスにフォールバックします。

## 純粋ユーティリティ vs ファイルシステム依存フロー

| フロー | ファイルシステムアクセス | 共有キャッシュ | 備考 |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | なし | なし | 提供されたバイト/文字列に対する正規表現のみ |
| `text` モジュール関数 | なし | なし | ANSI/幅/サニタイズのみ |
| `highlight` モジュール関数 | なし | なし | シンタックス + ANSI カラーリングのみ |
| `glob` | あり | オプション | ディレクトリスキャン + glob フィルタリング |
| `fuzzyFind` | あり | オプション | ディレクトリスキャン + ファジースコアリング |
| `grep`（ファイル/ディレクトリパス） | あり | オプション（ディレクトリモード） | ファイルに対する ripgrep、オプションのフィルター/コールバック |

## エンドツーエンドライフサイクルサマリー

1. 呼び出し元が型付きオプションで TS ラッパーを呼び出す。
2. ラッパーがデフォルト値（特に `glob`）を正規化し、`native.*` エクスポートに転送。
3. Rust がオプションを検証/正規化し、マッチャー/検索設定を構築。
4. ファイルシステムフローでは、エントリがスキャンされ（キャッシュヒット/ミス/再スキャン）、フィルタリング/スコアリングされる。
5. ワーカーループが定期的にキャンセルハートビートを呼び出し、タイムアウト/アボートで実行を終了可能。
6. Rust が出力を N-API オブジェクト（`lineNumber`、`matchCount`、`limitReached` など）に整形。
7. TS ラッパーが型付き JS オブジェクト（および `grep`/`glob` 用のオプションのマッチごとのコールバック）を返す。
