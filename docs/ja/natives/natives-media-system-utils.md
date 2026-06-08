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

このドキュメントは、[`docs/natives-architecture.md`](./natives-architecture.md) で説明されている**システム/メディア/変換プリミティブ**レイヤーのサブシステム詳細解説です: `image`、`html`、`clipboard`、および `work` プロファイリング。

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

> 注: `crates/pi-natives/src/work.rs` は存在しません。ワークプロファイリングは `prof.rs` で実装され、`task.rs` のインストルメンテーションからデータが供給されます。

## TS API ↔ Rust エクスポート/モジュールマッピング

| TS エクスポート (packages/natives)           | Rust N-API エクスポート                                                  | Rust モジュール                        |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS フォールバックロジック                            | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## データフォーマット境界と変換

### 画像 (`image`)

- **JS 入力境界**: `Uint8Array` エンコード済み画像バイト。
- **Rust デコード境界**: バイトは `Vec<u8>` にコピーされ、`ImageReader::with_guessed_format()` でフォーマットが推測された後、`DynamicImage` にデコードされます。
- **インメモリ状態**: `PhotonImage` は `Arc<DynamicImage>` を保持します。
- **出力境界**: `encode(format, quality)` は `Promise<Uint8Array>` (Rust `Vec<u8>`) を返します。

フォーマット ID は数値です:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (ロスレスエンコーダー)
- `3`: GIF

制約:

- `quality` は JPEG でのみ使用されます。
- PNG/WebP/GIF は `quality` を無視します。
- サポートされていないフォーマット ID は失敗します (`Invalid image format: <id>`)。

### HTML 変換 (`html`)

- **JS 入力境界**: HTML `string` + オプションのオブジェクト `{ cleanContent?: boolean; skipImages?: boolean }`。
- **Rust 変換境界**: `String` 入力は `html_to_markdown_rs::convert` によって変換されます。
- **出力境界**: Markdown `string`。

変換の動作:

- `cleanContent` のデフォルトは `false` です。
- `cleanContent=true` の場合、`PreprocessingPreset::Aggressive` による前処理とナビゲーション/フォームのハード削除フラグが有効になります。
- `skipImages` のデフォルトは `false` です。

### クリップボード (`clipboard`)

- **テキストパス**:
  - TS はまず stdout が TTY の場合に OSC 52 (`\x1b]52;c;<base64>\x07`) を出力します。
  - 同じテキストがベストエフォートとしてネイティブクリップボード API (`native.copyToClipboard`) 経由でも試行されます。
  - Termux では、TS はまず `termux-clipboard-set` を試行します。
- **画像読み取りパス**:
  - Rust は `arboard` から生の画像を読み取ります。
  - Rust はそれを PNG バイトに再エンコードし (`image` クレート)、`{ data: Uint8Array, mimeType: "image/png" }` を返します。
  - TS は Termux またはディスプレイサーバーのない Linux セッション (`DISPLAY`/`WAYLAND_DISPLAY` が未設定) では早期に `null` を返します。

### ワークプロファイリング (`work`)

- **収集境界**: プロファイリングサンプルは `task::blocking` と `task::future` 内の `profile_region(tag)` ガードによって生成されます。
- **ストレージフォーマット**: スタックパス + 期間 (`μs`) + タイムスタンプ (`プロセス開始からの μs`) を格納する固定サイズのリングバッファ (`MAX_SAMPLES = 10_000`)。
- **出力境界**: `getWorkProfile(lastSeconds)` はオブジェクトを返します:
  - `folded`: フォールドスタックテキスト (フレームグラフ入力)
  - `summary`: マークダウンテーブルのサマリー
  - `svg`: オプションのフレームグラフ SVG
  - `totalMs`、`sampleCount`

## ライフサイクルと状態遷移

### 画像のライフサイクル

1. `PhotonImage.parse(bytes)` はブロッキングデコードタスク (`image.decode`) をスケジュールします。
2. 成功時、ネイティブの `PhotonImage` ハンドルが JS に存在します。
3. `resize(...)` は新しいネイティブハンドル (`image.resize`) を作成し、古いハンドルと新しいハンドルは共存できます。
4. `encode(...)` は画像の寸法を変更せずにバイトを具体化します (`image.encode`)。

失敗時の遷移:

- フォーマット検出/デコードの失敗は parse プロミスを拒否します。
- エンコードの失敗は encode プロミスを拒否します。
- 無効なフォーマット ID は encode プロミスを拒否します。

### HTML のライフサイクル

1. `htmlToMarkdown(html, options)` はブロッキング変換タスクをスケジュールします。
2. 変換は指定がない限りデフォルトのオプション (`cleanContent=false`、`skipImages=false`) で実行されます。
3. マークダウン文字列を返すか、拒否します。

失敗時の遷移:

- コンバーターの失敗は拒否されたプロミスを返します (`Conversion error: ...`)。

### クリップボードのライフサイクル

`copyToClipboard(text)` は意図的にベストエフォートかつマルチパスです:

1. TTY の場合: OSC 52 書き込み (base64 ペイロード) を試行します。
2. `TERMUX_VERSION` が設定されている場合、Termux コマンドを試行します。
3. ネイティブの `arboard` テキストコピーを試行します。
4. TS レイヤーでエラーを吸収します。

`readImageFromClipboard()` はステージによって厳格さが異なります:

1. TS はサポートされていないランタイムコンテキスト (Termux/ヘッドレス Linux) を `null` にハードゲートします。
2. Rust の `arboard` 読み取りは TS が許可した場合のみ実行されます。
3. `ContentNotAvailable` は `null` にマップされます。
4. その他の Rust エラーは拒否されます。

### ワークプロファイリングのライフサイクル

1. 明示的な開始はありません: タスクヘルパーが実行される際にプロファイリングは常にオンです。
2. インストルメンテーションされたすべてのタスクスコープは、ガードのドロップ時に1つのサンプルを記録します。
3. バッファ容量に達した後、サンプルは最も古いエントリを上書きします。
4. `getWorkProfile(lastSeconds)` は時間ウィンドウを読み取り、フォールド/サマリー/SVG アーティファクトを生成します。

失敗時の遷移:

- SVG 生成の失敗はソフトフェイルです (`svg: null`)。フォールドとサマリーは引き続き返されます。
- 空のサンプルウィンドウは空のフォールドデータと `svg: null` を返し、エラーにはなりません。

## サポートされていない操作とエラー伝播

### 画像

- サポートされていないデコード入力または破損したバイト: 厳格な失敗 (プロミスの拒否)。
- サポートされていないエンコードフォーマット ID: 厳格な失敗。
- TS ラッパーにベストエフォートのフォールバックパスはありません。

### HTML

- 変換エラーは厳格な失敗 (拒否) です。
- オプションの省略はベストエフォートのデフォルト設定であり、失敗ではありません。

### クリップボード

- テキストコピーは TS レイヤーでベストエフォートです: 操作上の失敗は抑制されます。
- 画像読み取りは「画像なし」(`null`) と操作上の失敗 (拒否) を区別します。
- Termux/ヘッドレス Linux は画像読み取りのサポートされていないコンテキストとして扱われます (`null`)。

### ワークプロファイリング

- 取得は関数呼び出し自体に対しては厳格ですが、アーティファクト生成は部分的にベストエフォートです (`svg` は null 許容)。
- バッファの切り捨ては期待される動作 (リングバッファ) であり、データ損失のバグではありません。

## プラットフォームの注意事項

- **クリップボードテキスト**: OSC 52 はターミナルのサポートに依存します。ネイティブクリップボードアクセスはデスクトップ環境/セッションに依存します。
- **クリップボード画像読み取り**: Termux およびディスプレイサーバーのない Linux では TS でブロックされます。
