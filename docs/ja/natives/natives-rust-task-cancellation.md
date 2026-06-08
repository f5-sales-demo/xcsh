---
title: ネイティブ Rust タスク実行とキャンセル
description: 協調的キャンセルとクリーンアップセマンティクスを備えた Rust 非同期タスク実行モデル。
sidebar:
  order: 5
  label: タスクキャンセル
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# ネイティブ Rust タスク実行とキャンセル (`pi-natives`)

このドキュメントでは、`crates/pi-natives` がネイティブワークをどのようにスケジューリングし、JS オプション（`timeoutMs`、`AbortSignal`）からのキャンセルがどのように Rust 実行に伝播するかを説明します。

## 実装ファイル

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## コアプリミティブ (`task.rs`)

`task.rs` は3つのコア要素を定義します：

1. `task::blocking(tag, cancel_token, work)`
   - `napi::AsyncTask` / `Task` をラップします。
   - `compute()` は libuv ワーカースレッド上で実行されます（CPU バウンドまたはブロッキング/同期システムコール向け）。
   - JS `Promise<T>` を返します。

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)` をラップします。
   - Tokio ランタイム上で非同期ワークを実行します。
   - `PromiseRaw<'env, T>` を返します。

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` はデッドラインとオプションの `AbortSignal` を組み合わせます。
   - `CancelToken::heartbeat()` はブロッキングループ向けの協調的キャンセルです。
   - `CancelToken::wait()` は非同期キャンセル待機です（`Signal` / `Timeout` / `User` Ctrl-C）。
   - `AbortToken` は外部コードがアボートを要求できるようにします（`abort(reason)`）。

## `blocking` vs `future`：実行モデルと選択基準

### `task::blocking` を使用する場合

ワークが CPU ヘビーまたは根本的に同期/ブロッキングである場合に使用します：

- 正規表現/ファイルスキャン（`grep`、`glob`、`fuzzy_find`）
- 同期 PTY ループ内部（`spawn_blocking` 経由の `run_pty_sync`）
- クリップボード/画像/HTML 変換

動作：

- ワーククロージャはクローンされた `CancelToken` を受け取ります。
- キャンセルはコードが `ct.heartbeat()?` をチェックする箇所でのみ検知されます。
- クロージャの `Err(...)` は JS Promise を reject します。

### `task::future` を使用する場合

ワークが非同期操作を `await` する必要がある場合に使用します：

- シェルセッションオーケストレーション（`shell.run`、`executeShell`）
- タスクレース（`tokio::select!`）による完了とキャンセルの競合

動作：

- Future は通常の完了と `ct.wait()` をレースさせることができます。
- キャンセルパスでは、非同期実装は通常、内部サブシステムにキャンセルを伝播し（例：`tokio_util::CancellationToken`）、オプションで猶予タイムアウト後に強制アボートします。

## JS API ↔ Rust エクスポートマッピング（タスク/キャンセル関連）

| JS 向け API | Rust エクスポート (`#[napi]`) | スケジューラ | キャンセル接続 |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + フィルタループ内の `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + スコアリングループ内の `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | 実行タスクに対して `ct.wait()` をレース；Tokio `CancellationToken` にブリッジ |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | 上記と同様 |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + 内部 `spawn_blocking` | 同期 PTY ループ内で `heartbeat()` 経由の `CancelToken` チェック |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | なし（`()` トークン） |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | なし（`()` トークン） |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | なし（`()` トークン） |

`text.rs` と `ps.rs` は現在 `task::blocking`/`task::future` を使用していないため、このキャンセルパスには参加しません。

## キャンセルライフサイクルと状態遷移

### `CancelToken` ライフサイクル

`CancelToken` は協調的かつステートフルです：

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### 開始前 vs 実行中のキャンセル

- **開始前 / 最初のキャンセルチェック前**：
  - `ct.wait()` でレースする `task::future` ユーザーは、`select!` に入った時点で即座にキャンセルを解決できます。
  - `task::blocking` ユーザーは、クロージャコードが `heartbeat()` に到達した時点でのみキャンセルを検知します。クロージャが早期にハートビートしない場合、キャンセルは遅延します。

- **実行中**：
  - `blocking`：次の `heartbeat()` が `Err("Aborted: ...")` を返します。
  - `future`：`ct.wait()` ブランチが `select!` に勝利し、コードが従属する非同期機構をキャンセルします（シェルの場合：Tokio トークンをキャンセルし、最大2秒待機後にタスクをアボート）。

## 長時間実行ループにおけるハートビートの期待値

`heartbeat()` は、無制限または大規模なワークセットを持つループにおいて、予測可能なケイデンスで実行される必要があります。

観測されるパターン：

- `glob::filter_entries`：フィルタリング/マッチング前に各エントリをチェック。
- `fd::score_entries`：スキャンされた各候補をチェック。
- `grep_sync`：重い検索フェーズの前に明示的なキャンセルチェック、さらにトークンを受け取る fs-cache 呼び出し。
- `run_pty_sync`：各ループティック（約16msスリープケイデンス）でチェックし、キャンセル時に子プロセスを kill。

実用的なルール：外部サイズの入力に対するループは、ハートビートなしに短い制限付き間隔を超えるべきではありません。

## 失敗動作と JS へのエラー伝播

### ブロッキングタスク

エラーパス：

1. クロージャが `Err(napi::Error)` を返す（`heartbeat()` アボートを含む）。
2. `Task::compute()` が `Err` を返す。
3. `AsyncTask` が JS Promise を reject する。

典型的なエラー文字列：

- `Aborted: Timeout`
- `Aborted: Signal`
- ドメインエラー（`Failed to decode image: ...`、`Conversion error: ...` など）

### Future タスク

エラーパス：

1. 非同期ボディが `Err(napi::Error)` を返すか、join 失敗がマッピングされる（`... task failed: {err}`）。
2. `task::future` で生成された Promise が reject される。
3. 一部の API は reject ではなく、構造化されたキャンセル結果を意図的に返します（`cancelled`/`timed_out` フラグと `exit_code: None` を持つ `ShellRunResult`/`ShellExecuteResult`）。

### キャンセル報告の分類

- **エラーとしてのアボート**：`heartbeat()?` を使用するほとんどのブロッキングエクスポート。
- **型付き結果としてのアボート**：結果構造体でキャンセルをモデル化するシェル/PTY スタイルのコマンド API。

API ごとに1つのモデルを選択し、明示的にドキュメント化してください。

## よくある落とし穴

1. **ブロッキングループでのハートビート欠落**
   - 症状：タイムアウト/シグナルがループ終了まで無視されるように見える。
   - 修正：ループの先頭と高コストなアイテムごとのステップの前に `ct.heartbeat()?` を追加する。

2. **長いキャンセル不可セクション**
   - 症状：単一の大きな呼び出し（デコード、ソート、圧縮など）中にキャンセルレイテンシがスパイクする。
   - 修正：ハートビート境界を持つチャンクにワークを分割する。不可能な場合はレイテンシをドキュメント化する。

3. **非同期エグゼキュータのブロッキング**
   - 症状：同期ヘビーなコードが Future 内で直接実行された場合に非同期 API がストールする。
   - 修正：CPU/同期ブロックを `task::blocking` または `tokio::task::spawn_blocking` に移動する。

4. **一貫性のないキャンセルセマンティクス**
   - 症状：ある API はキャンセル時に reject し、別の API はフラグ付きで resolve する、呼び出し元が混乱する。
   - 修正：ドメインごとに標準化し、ラッパーのドキュメントを整合させる。

5. **ネストされた非同期タスクでのキャンセルブリッジ忘れ**
   - 症状：外部トークンはキャンセルされたが、内部のリーダー/サブプロセスタスクが実行し続ける。
   - 修正：内部トークン/シグナルにキャンセルをブリッジし、猶予タイムアウト + 強制アボートフォールバックを強制する。

## 新しいキャンセル可能エクスポートのためのチェックリスト

1. ワークを正しく分類する：
   - CPU バウンドまたは同期ブロッキング -> `task::blocking`
   - 非同期 I/O / `await` オーケストレーション -> `task::future`

2. 必要に応じてキャンセル入力を公開する：
   - `#[napi(object)]` オプションに `timeoutMs` と `signal` を含める
   - `let ct = task::CancelToken::new(timeout_ms, signal);` を作成する

3. すべてのレイヤーにキャンセルを配線する：
   - ブロッキングループ：安定した間隔で `ct.heartbeat()?`
   - 非同期オーケストレーション：`ct.wait()` とレースし、サブタスク/トークンをキャンセルする

4. キャンセル契約を決定する：
   - アボートエラーで Promise を reject する、または
   - 型付きの `{ cancelled, timedOut, ... }` で resolve する
   - この契約を API ファミリー内で一貫して維持する

5. コンテキスト付きで失敗を伝播する：
   - `Error::from_reason(format!("...: {err}"))` 経由でエラーをマッピングする
   - ステージ固有のプレフィックスを含める（`spawn`、`decode`、`wait` など）

6. 開始前と実行中のキャンセルを処理する：
   - キャンセルチェック/await は高コストなボディの前と長時間実行中に行う必要がある

7. エグゼキュータの誤用がないことを検証する：
   - `spawn_blocking`/ブロッキングタスクラッパーなしで非同期 Future 内で長い同期ワークを直接実行しない
