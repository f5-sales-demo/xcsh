---
title: ネイティブメディアおよびシステムユーティリティ
description: スクリーンショット、画像処理、システム情報のためのネイティブメディア処理ユーティリティ。
sidebar:
  order: 7
  label: メディア & システムユーティリティ
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# ネイティブメディア + システムユーティリティ

このドキュメントは、[`docs/natives-architecture.md`](./natives-architecture.md) で説明されている **system/media/conversion primitives** レイヤーのサブシステム詳細ドキュメントです：`image`、`html`、`clipboard`、および `work` プロファイリング。

## 実装ファイル

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> 注意：`crates/pi-natives/src/work.rs` は存在しません。ワークプロファイリングは `prof.rs` で実装され、`task.rs` のインストルメンテーションからデータが供給されます。

## TS API ↔ Rust エクスポート/モジュールマッピング

| TS エクスポート (packages/natives)          | Rust N-API エクスポート                                                 | Rust モジュール                       |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS フォールバックロジック                         | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## データ形式の境界と変換

### 画像 (`image`)

- **JS 入力境界**：`Uint8Array` でエンコードされた画像バイト。
- **Rust デコード境界**：バイトは `Vec<u8>` にコピーされ、フォーマットは `ImageReader::with_guessed_format()` で推測され、その後 `DynamicImage` にデコードされます。
- **メモリ内状態**：`PhotonImage` は `Arc<DynamicImage>` を保持します。
- **出力境界**：`encode(format, quality)` は `Promise<Uint8Array>`（Rust `Vec<u8>`）を返します。

フォーマット ID は数値です：

- `0`：PNG
- `1`：JPEG
- `2`：WebP（ロスレスエンコーダー）
- `3`：GIF

制約：

- `quality` は JPEG でのみ使用されます。
- PNG/WebP/GIF は `quality` を無視します。
- サポートされていないフォーマット ID は失敗します（`Invalid image format: <id>`）。

### HTML 変換 (`html`)

- **JS 入力境界**：HTML `string` + オプションのオブジェクト `{ cleanContent?: boolean; skipImages?: boolean }`。
- **Rust 変換境界**：`String` 入力は `html_to_markdown_rs::convert` で変換されます。
- **出力境界**：Markdown `string`。

変換動作：

- `cleanContent` のデフォルトは `false`。
- `cleanContent=true` の場合、`PreprocessingPreset::Aggressive` による前処理とナビゲーション/フォームのハード削除フラグが有効になります。
- `skipImages` のデフォルトは `false`。

### クリップボード (`clipboard`)

- **テキストパス**：
  - TS はまず stdout が TTY の場合に OSC 52（`\x1b]52;c;<base64>\x07`）を出力します。
  - 同じテキストはその後、ネイティブクリップボード API（`native.copyToClipboard`）経由でベストエフォートとして試行されます。
  - Termux では、TS は最初に `termux-clipboard-set` を試行します。
- **画像読み取りパス**：
  - Rust は `arboard` から生の画像を読み取ります。
  - Rust はそれを PNG バイトに再エンコードし（`image` クレート）、`{ data: Uint8Array, mimeType: "image/png" }` を返します。
  - TS は Termux またはディスプレイサーバーのない Linux セッション（`DISPLAY`/`WAYLAND_DISPLAY` が未設定）では早期に `null` を返します。

### ワークプロファイリング (`work`)

- **収集境界**：プロファイリングサンプルは `task::blocking` および `task::future` 内の `profile_region(tag)` ガードによって生成されます。
- **ストレージ形式**：スタックパス + 期間（`μs`）+ タイムスタンプ（`プロセス開始からの μs`）を格納する固定サイズのリングバッファ（`MAX_SAMPLES = 10_000`）。
- **出力境界**：`getWorkProfile(lastSeconds)` はオブジェクトを返します：
  - `folded`：フォールドスタックテキスト（flamegraph 入力）
  - `summary`：Markdown テーブルサマリー
  - `svg`：オプションの flamegraph SVG
  - `totalMs`、`sampleCount`

## ライフサイクルと状態遷移

### 画像ライフサイクル

1. `PhotonImage.parse(bytes)` はブロッキングデコードタスク（`image.decode`）をスケジュールします。
2. 成功すると、ネイティブ `PhotonImage` ハンドルが JS に存在します。
3. `resize(...)` は新しいネイティブハンドル（`image.resize`）を作成し、古いハンドルと新しいハンドルは共存できます。
4. `encode(...)` は画像のディメンションを変更せずにバイトを具現化します（`image.encode`）。

失敗時の遷移：

- フォーマット検出/デコード失敗は parse プロミスを reject します。
- エンコード失敗は encode プロミスを reject します。
- 無効なフォーマット ID は encode プロミスを reject します。

### HTML ライフサイクル

1. `htmlToMarkdown(html, options)` はブロッキング変換タスクをスケジュールします。
2. 変換は、指定されない限りデフォルトオプション（`cleanContent=false`、`skipImages=false`）で実行されます。
3. Markdown 文字列を返すか reject します。

失敗時の遷移：

- コンバーター失敗は reject されたプロミスを返します（`Conversion error: ...`）。

### クリップボードライフサイクル

`copyToClipboard(text)` は意図的にベストエフォートかつマルチパスです：

1. TTY の場合：OSC 52 書き込み（base64 ペイロード）を試行。
2. `TERMUX_VERSION` が設定されている場合は Termux コマンドを試行。
3. ネイティブ `arboard` テキストコピーを試行。
4. TS レイヤーでエラーを抑制。

`readImageFromClipboard()` の厳密性はステージによって異なります：

1. TS はサポートされていないランタイムコンテキスト（Termux/ヘッドレス Linux）を `null` にハードゲートします。
2. Rust `arboard` 読み取りは TS が許可した場合のみ実行されます。
3. `ContentNotAvailable` は `null` にマップされます。
4. その他の Rust エラーは reject します。

### ワークプロファイリングライフサイクル

1. 明示的な開始なし：タスクヘルパーが実行されると常にプロファイリングがオンになります。
2. インストルメントされた各タスクスコープは、ガードドロップ時に 1 つのサンプルを記録します。
3. サンプルはバッファ容量に達した後、最も古いエントリを上書きします。
4. `getWorkProfile(lastSeconds)` は時間ウィンドウを読み取り、folded/summary/svg アーティファクトを導出します。

失敗時の遷移：

- SVG 生成失敗はソフトフェイル（`svg: null`）ですが、folded と summary は引き続き返されます。
- 空のサンプルウィンドウは空の folded データと `svg: null` を返し、エラーではありません。

## サポートされていない操作とエラー伝播

### 画像

- サポートされていないデコード入力または破損したバイト：厳密な失敗（プロミス reject）。
- サポートされていないエンコードフォーマット ID：厳密な失敗。
- TS ラッパーにベストエフォートフォールバックパスなし。

### HTML

- 変換エラーは厳密な失敗（reject）。
- オプション省略はベストエフォートのデフォルト設定であり、失敗ではありません。

### クリップボード

- テキストコピーは TS レイヤーでベストエフォート：操作の失敗は抑制されます。
- 画像読み取りは「画像なし」（`null`）と操作の失敗（reject）を区別します。
- Termux/ヘッドレス Linux は画像読み取りでサポートされていないコンテキストとして扱われます（`null`）。

### ワークプロファイリング

- 取得は関数呼び出し自体については厳密ですが、アーティファクト生成は部分的にベストエフォートです（`svg` は nullable）。
- バッファの切り捨ては予期される動作（リングバッファ）であり、データ損失バグではありません。

## プラットフォームの注意事項

- **クリップボードテキスト**：OSC 52 はターミナルのサポートに依存します。ネイティブクリップボードアクセスはデスクトップ環境/セッションに依存します。
- **クリップボード画像読み取り**：TS で Termux およびディスプレイサーバーのない Linux ではブロックされます。
