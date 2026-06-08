---
title: ネイティブテキストおよび検索パイプライン
description: grep、glob、ripgrep ベースのファイルコンテンツインデックスによるネイティブテキスト検索パイプライン。
sidebar:
  order: 6
  label: テキストと検索パイプライン
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# ネイティブテキスト/検索パイプライン

このドキュメントは、`@f5xc-salesdemos/pi-natives` のテキスト/検索サーフェス（`grep`、`glob`、`text`、`highlight`）について、TypeScript ラッパーから Rust N-API エクスポート、そして JS 結果オブジェクトに戻るまでのマッピングを示します。

用語は `docs/natives-architecture.md` に従います：

- **ラッパー**: `packages/natives/src/*` 内の TS API
- **Rust モジュール層**: `crates/pi-natives/src/*` 内の N-API エクスポート
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

## 1) 正規表現検索（`grep`、`searchContent`、`hasMatch`）

### 入力/オプションフロー

1. TS ラッパーがオプションをネイティブに転送します：
   - `grep/index.ts` は `options` をほぼそのまま渡し、コールバックを `(match) => void` から napi スレッドセーフコールバック形式 `(err, match)` にラップします。
   - `searchContent` と `hasMatch` は文字列/`Uint8Array` を直接渡します。
2. `grep.rs` 内の Rust オプション構造体がキャメルケースフィールド（`ignoreCase`、`maxCount`、`contextBefore`、`contextAfter`、`maxColumns`、`timeoutMs`）をデシリアライズします。
3. `grep` は `timeoutMs` + `AbortSignal` から `CancelToken` を作成し、`task::blocking("grep", ...)` 内で実行します。

### 実行ブランチ

- **インメモリブランチ（純粋なユーティリティ）**
  - `search` → `search_sync` → 提供されたコンテンツバイトに対して `run_search` を実行。
  - ファイルシステムスキャンなし、`fs_cache` なし。
- **単一ファイルブランチ（ファイルシステム依存）**
  - `grep_sync` がパスを解決し、メタデータがファイルであることを確認し、ファイルあたり最大 `MAX_FILE_BYTES`（`4 MiB`）まで ripgrep マッチャーを通してストリーミングします。
- **ディレクトリブランチ（ファイルシステム依存）**
  - `cache: true` の場合、`fs_cache::get_or_scan` によるオプショナルなキャッシュルックアップ。
  - `cache: false` の場合、`fs_cache::force_rescan` によるフレッシュスキャン。
  - キャッシュ経過時間が `empty_recheck_ms()` を超えた場合のオプショナルな空結果再チェック。
  - エントリフィルタリング：ファイルのみ + オプショナルな glob フィルター（`glob_util`）+ オプショナルな型フィルターマッピング（`js`、`ts`、`rust` など）。

### 検索/収集セマンティクス

- 正規表現エンジン：`ignoreCase` と `multiline` を備えた `grep_regex::RegexMatcherBuilder`。
- コンテキスト解決：
  - `contextBefore/contextAfter` がレガシーの `context` をオーバーライドします。
  - 非コンテンツモードではコンテキスト収集がゼロになります。
- 出力モード：
  - `content` => ヒットごとに1つの `GrepMatch`。
  - `count` と `filesWithMatches` はいずれもカウントスタイルのエントリにマッピング（`lineNumber=0`、`line=""`、`matchCount` がセット）。
- 制限：
  - グローバルな `offset` と `maxCount` がファイル全体に適用されます。
  - 並列パスは `maxCount` が未設定かつ `offset == 0` の場合のみ使用されます。それ以外の場合、決定論的なグローバルオフセット/制限セマンティクスを維持するため順次パスが使用されます。

### JS への結果整形

- Rust の `SearchResult`/`GrepResult` フィールドは N-API オブジェクトフィールド変換を通じて TS 型にマッピングされます。
- カウンターは N-API を越える前に `u32` にクランプされます。
- オプショナルなブール値は、一部のパスで true の場合を除き省略されます（`limitReached`）。
- ストリーミングコールバックは整形された各 `GrepMatch`（コンテンツまたはカウントエントリ）を受け取ります。

### 失敗時の動作

- `searchContent` は正規表現/検索の失敗に対してスローではなく `SearchResult.error` を返します。
- `grep` はハードエラー（無効なパス、無効な glob/正規表現、キャンセルタイムアウト/アボート）で reject します。
- `hasMatch` は `Result<bool>` を返し、無効なパターン/UTF-8 デコードエラーでスローします。
- 複数ファイルスキャンにおけるファイルオープン/検索エラーはファイルごとにスキップされ、スキャンは継続します。

### 不正な正規表現の処理

`grep.rs` は正規表現コンパイル前にブレースをサニタイズします：

- 無効な繰り返しのようなブレースは、`{N}`、`{N,}`、`{N,M}` を形成できない場合にエスケープされます（`{`/`}` -> `\{`/`\}`）。
- これにより、一般的なリテラルテンプレートフラグメント（例：`${platform}`）が不正な繰り返しとして失敗することを防ぎます。
- 残りの無効な正規表現構文は引き続き正規表現エラーを返します。

## 2) ファイルディスカバリー（`glob`）とファジーパス検索（`fuzzyFind`）

`glob` と `fuzzyFind` は `fs_cache` スキャンを共有しますが、マッチングロジックは異なります。

### `glob` フロー

1. TS ラッパー（`glob/index.ts`）：
   - `path.resolve(options.path)`。
   - デフォルト値：`pattern="*"`、`hidden=false`、`gitignore=true`、`recursive=true`。
2. Rust の `glob` が `GlobConfig` を構築し、`glob_util::compile_glob` でパターンをコンパイルします。
3. エントリソース：
   - `cache=true` => `get_or_scan` + オプショナルなステール空結果 `force_rescan`。
   - `cache=false` => `force_rescan(..., store=false)`（フレッシュのみ）。
4. フィルタリング：
   - `.git` は常にスキップ。
   - `node_modules` はリクエストされない限りスキップ（`includeNodeModules` またはパターンに node_modules が含まれる場合）。
   - glob マッチを適用。
   - ファイルタイプフィルターを適用；シンボリックリンクの `file/dir` フィルターはターゲットメタデータを解決。
5. `maxResults` に切り詰める前にオプショナルな mtime 降順ソート（`sortByMtime`）。

### `fuzzyFind` フロー（`fd.rs` で実装）

1. TS ラッパーは `grep` モジュールからエクスポートされますが、Rust 実装は `fd.rs` にあります。
2. 同じキャッシュ/ノーキャッシュ分岐とステール空結果再チェックポリシーを持つ `fs_cache` からの共有スキャンソース。
3. スコアリング：
   - 完全一致 / 前方一致 / 含有 / サブシーケンスベースのファジースコア
   - セパレーター/句読点正規化されたスコアリングパス
   - ディレクトリボーナスと決定論的タイブレーク（`score desc`、次に `path asc`）
4. シンボリックリンクエントリはファジー結果から除外されます。

### 失敗時の動作

- 無効な glob パターン => `glob_util::compile_glob` からのエラー。
- 検索ルートは既存のディレクトリである必要があり（`resolve_search_path`）、そうでなければエラー。
- キャンセル/タイムアウトはループ内の `CancelToken::heartbeat()` チェックを通じてアボートエラーとして伝播します。

### 不正な glob の処理

`glob_util::build_glob_pattern` は寛容です：

- `\` を `/` に正規化します。
- `recursive=true` の場合、単純な再帰パターンに `**/` を自動プレフィックスします。
- コンパイル前にバランスのとれていない `{...` 交替グループを自動的に閉じます。

## 3) 共有スキャン/キャッシュライフサイクル（`fs_cache`）

`fs_cache` はスキャン結果を正規化された相対エントリ（`path`、`fileType`、オプショナルな `mtime`）として以下のキーで保存します：

- 正規化された検索ルート
- `include_hidden`
- `use_gitignore`

### キャッシュ状態遷移

1. **ミス / 無効**
   - TTL が `0` またはキーが存在しない/期限切れ -> フレッシュな `collect_entries`。
2. **ヒット**
   - エントリ経過時間 `< cache_ttl_ms()` -> キャッシュされたエントリ + `cache_age_ms` を返す。
3. **ステール空結果再チェック**（`glob`/`grep`/`fd` 内の呼び出し側ポリシー）
   - クエリがゼロマッチを返し、`cache_age_ms >= empty_recheck_ms()` の場合、1回再スキャンを強制。
4. **無効化**
   - `invalidateFsScanCache(path?)`：
     - 引数なし：すべてのキーをクリア
     - パス引数あり：ルートがそのターゲットパスのプレフィックスであるキーを削除

### ステール結果のトレードオフ

- キャッシュは即時の一貫性よりも低レイテンシーの繰り返しスキャンを優先します。
- TTL ウィンドウはステールな正結果/負結果を返す可能性があります。
- 空結果再チェックは、追加の1回のスキャンのコストで、古いキャッシュスキャンのステールな負結果を削減します。
- 明示的な無効化は、ファイル変更後の正確性フックとして意図されています。

## 4) ANSI テキストユーティリティ（`text`）

これらは純粋なインメモリユーティリティです（ファイルシステムスキャンなし）。

### 境界と責務

- **`text.rs` はターミナルセルセマンティクスを担当**：
  - ANSI シーケンスパース
  - 書記素認識の幅とスライシング
  - ラップ/切り詰め/サニタイズ動作
- **`grep.rs` の行切り詰め（`maxColumns`）は別物**：
  - `...` を伴うマッチ行の単純な文字境界切り詰め
  - ANSI 状態保持なし、ターミナルセル幅認識なし

### 主要な動作

- `wrapTextWithAnsi`：可視幅でラップし、ラップされた行間でアクティブな SGR コードを引き継ぎます。
- `truncateToWidth`：省略記号ポリシー（`Unicode`、`Ascii`、`Omit`）による可視セル切り詰め、オプショナルな右パディング、変更がない場合に元の JS 文字列を返すファストパス。
- `sliceWithWidth`：オプショナルな厳密幅強制付きカラムスライシング。
- `extractSegments`：`after` セグメントの ANSI 状態を復元しながら、オーバーレイ周辺の before/after セグメントを抽出します。
- `sanitizeText`：ANSI エスケープ + 制御文字を除去し、孤立サロゲートを削除し、`\r` を除去して CR/LF を正規化します。
- `visibleWidth`：可視ターミナルセルをカウントします（タブは Rust 実装の固定 `TAB_WIDTH` を使用）。

### 失敗時の動作

テキスト関数は一般に決定論的な変換出力を返します。エラーは JS 文字列変換境界（N-API 引数変換の失敗）に限定されます。

## 5) シンタックスハイライト（`highlight`）

`highlight.rs` は純粋な変換です（FS なし、キャッシュなし）。

### フロー

1. ラッパーが `code`、オプショナルな `lang`、および ANSI カラーパレットを転送します。
2. Rust は以下の方法でシンタックスを解決します：
   - トークン/名前ルックアップ
   - 拡張子ルックアップ
   - エイリアステーブルフォールバック（`ts/tsx/js -> JavaScript` など）
   - 未解決の場合はプレーンテキストシンタックスにフォールバック
3. syntect の `ParseState` とスコープスタックで各行をパースします。
4. スコープを 11 のセマンティックカラーカテゴリにマッピングし、ANSI カラーコードを挿入/リセットします。

### 失敗時の動作

- 行ごとのパース失敗は呼び出しを失敗させません：その行はハイライトなしで追加され、処理は継続します。
- 未知/未サポートの言語はプレーンテキストシンタックスにフォールバックします。

## 純粋ユーティリティ vs ファイルシステム依存フロー

| フロー | ファイルシステムアクセス | 共有キャッシュ | 備考 |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | なし | なし | 提供されたバイト/文字列に対する正規表現のみ |
| `text` モジュール関数 | なし | なし | ANSI/幅/サニタイズのみ |
| `highlight` モジュール関数 | なし | なし | シンタックス + ANSI カラーリングのみ |
| `glob` | あり | オプショナル | ディレクトリスキャン + glob フィルタリング |
| `fuzzyFind` | あり | オプショナル | ディレクトリスキャン + ファジースコアリング |
| `grep`（ファイル/ディレクトリパス） | あり | オプショナル（ディレクトリモード） | ファイルに対する ripgrep、オプショナルなフィルター/コールバック |

## エンドツーエンドライフサイクルの要約

1. 呼び出し側が型付きオプションで TS ラッパーを呼び出します。
2. ラッパーがデフォルト値を正規化し（特に `glob`）、`native.*` エクスポートに転送します。
3. Rust がオプションを検証/正規化し、マッチャー/検索設定を構築します。
4. ファイルシステムフローの場合、エントリがスキャンされ（キャッシュヒット/ミス/再スキャン）、フィルタリング/スコアリングされます。
5. ワーカーループが定期的にキャンセルハートビートを呼び出し、タイムアウト/アボートが実行を終了できます。
6. Rust が出力を N-API オブジェクト（`lineNumber`、`matchCount`、`limitReached` など）に整形します。
7. TS ラッパーが型付き JS オブジェクト（および `grep`/`glob` 用のオプショナルなマッチごとのコールバック）を返します。
