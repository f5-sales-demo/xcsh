---
title: ネイティブRustタスクの実行とキャンセル
description: 協調的キャンセルとクリーンアップセマンティクスを持つRust非同期タスク実行モデル。
sidebar:
  order: 5
  label: タスクキャンセル
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# ネイティブRustタスクの実行とキャンセル (`pi-natives`)

このドキュメントでは、`crates/pi-natives` がネイティブワークをどのようにスケジューリングし、JSオプション（`timeoutMs`、`AbortSignal`）からRust実行へキャンセルがどのように伝播するかを説明します。

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

`task.rs` は3つのコア要素を定義しています：

1. `task::blocking(tag, cancel_token, work)`
   - `napi::AsyncTask` / `Task` をラップします。
   - `compute()` はlibuvワーカースレッド上で実行されます（CPU負荷の高い処理やブロッキング/同期システムコール向け）。
   - JS `Promise<T>` を返します。

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)` をラップします。
   - 非同期ワークをTokioランタイム上で実行します。
   - `PromiseRaw<'env, T>` を返します。

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` はデッドラインとオプションの `AbortSignal` を組み合わせます。
   - `CancelToken::heartbeat()` はブロッキングループのための協調的キャンセルです。
   - `CancelToken::wait()` は非同期キャンセル待機です（`Signal` / `Timeout` / `User` Ctrl-C）。
   - `AbortToken` は外部コードがアボートを要求できるようにします（`abort(reason)`）。

## `blocking` vs `future`：実行モデルと選択基準

### `task::blocking` を使用する場合

ワークがCPU負荷が高い、または根本的に同期的/ブロッキングである場合に使用します：

- 正規表現/ファイルスキャン（`grep`、`glob`、`fuzzy_find`）
- 同期PTYループの内部処理（`spawn_blocking` 経由の `run_pty_sync`）
- クリップボード/画像/HTML変換

動作：

- ワーククロージャはクローンされた `CancelToken` を受け取ります。
- キャンセルはコードが `ct.heartbeat()?` をチェックする箇所でのみ検知されます。
- クロージャの `Err(...)` はJSのPromiseをリジェクトします。

### `task::future` を使用する場合

ワークが非同期操作を `await` する必要がある場合に使用します：

- シェルセッションのオーケストレーション（`shell.run`、`executeShell`）
- タスクレーシング（`tokio::select!`）による完了とキャンセルの競合

動作：

- Futureは通常の完了と `ct.wait()` をレースさせることができます。
- キャンセルパスでは、非同期実装は通常、内部サブシステム（例：`tokio_util::CancellationToken`）にキャンセルを伝播し、オプションでグレースタイムアウト後に強制アボートします。

## JS API ↔ Rustエクスポートのマッピング（タスク/キャンセル関連）

| JS向けAPI | Rustエクスポート (`#[napi]`) | スケジューラ | キャンセル接続 |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + フィルタループ内の `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + スコアリングループ内の `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | 実行タスクに対して `ct.wait()` をレース；Tokio `CancellationToken` にブリッジ |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | 上記と同じ |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + 内部 `spawn_blocking` | 同期PTYループ内で `heartbeat()` 経由で `CancelToken` をチェック |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | なし（`()` トークン） |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | なし（`()` トークン） |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | なし（`()` トークン） |

`text.rs` と `ps.rs` は現在 `task::blocking`/`task::future` を使用しておらず、このキャンセルパスには参加しません。

## キャンセルのライフサイクルと状態遷移

### `CancelToken` のライフサイクル

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
  - `task::future` のユーザーが `ct.wait()` でレースする場合、`select!` に入った時点で即座にキャンセルを解決できます。
  - `task::blocking` のユーザーは、クロージャコードが `heartbeat()` に到達した時にのみキャンセルを検知します。クロージャが早い段階でハートビートしない場合、キャンセルは遅延します。

- **実行中**：
  - `blocking`：次の `heartbeat()` が `Err("Aborted: ...")` を返します。
  - `future`：`ct.wait()` ブランチが `select!` で勝利し、その後コードが従属する非同期機構をキャンセルします（シェルの場合：Tokioトークンをキャンセルし、最大2秒待機してからタスクをアボート）。

## 長時間実行ループにおけるハートビートの期待値

`heartbeat()` は、無制限または大規模なワークセットを持つループで予測可能な頻度で実行する必要があります。

観察されるパターン：

- `glob::filter_entries`：フィルタリング/マッチング前に各エントリをチェック。
- `fd::score_entries`：スキャンされた各候補をチェック。
- `grep_sync`：重い検索フェーズ前の明示的なキャンセルチェック、およびトークンを受け取るfs-cache呼び出し。
- `run_pty_sync`：毎ループティック（約16msのスリープ間隔）でチェックし、キャンセル時に子プロセスをkill。

実用的なルール：外部サイズの入力に対するループは、ハートビートなしに短い制限された間隔を超えてはなりません。

## 失敗動作とJSへのエラー伝播

### ブロッキングタスク

エラーパス：

1. クロージャが `Err(napi::Error)` を返す（`heartbeat()` のアボートを含む）。
2. `Task::compute()` が `Err` を返す。
3. `AsyncTask` がJSのPromiseをリジェクトする。

典型的なエラー文字列：

- `Aborted: Timeout`
- `Aborted: Signal`
- ドメインエラー（`Failed to decode image: ...`、`Conversion error: ...` など）

### Futureタスク

エラーパス：

1. 非同期ボディが `Err(napi::Error)` を返すか、join失敗がマッピングされる（`... task failed: {err}`）。
2. `task::future` で生成されたPromiseがリジェクトされる。
3. 一部のAPIは、リジェクトではなく構造化されたキャンセル結果を意図的に返す（`ShellRunResult`/`ShellExecuteResult` の `cancelled`/`timed_out` フラグと `exit_code: None`）。

### キャンセル報告の分類

- **エラーとしてのアボート**：`heartbeat()?` を使用するほとんどのブロッキングエクスポート。
- **型付き結果としてのアボート**：結果構造体でキャンセルをモデル化するシェル/PTYスタイルのコマンドAPI。

API毎に1つのモデルを選択し、明示的にドキュメント化してください。

## よくある落とし穴

1. **ブロッキングループでのハートビートの欠落**
   - 症状：ループが終了するまでtimeout/signalが無視されているように見える。
   - 修正：ループの先頭と高コストなアイテムごとのステップ前に `ct.heartbeat()?` を追加する。

2. **長いキャンセル不可セクション**
   - 症状：単一の大きな呼び出し（デコード、ソート、圧縮など）中にキャンセルレイテンシが急増する。
   - 修正：ハートビート境界でワークをチャンクに分割する。不可能な場合はレイテンシをドキュメント化する。

3. **非同期エグゼキュータのブロッキング**
   - 症状：同期的に重いコードがfuture内で直接実行されると非同期APIが停止する。
   - 修正：CPU/同期ブロックを `task::blocking` または `tokio::task::spawn_blocking` に移動する。

4. **一貫性のないキャンセルセマンティクス**
   - 症状：あるAPIはキャンセル時にリジェクトし、別のAPIはフラグ付きでリゾルブするため、呼び出し側が混乱する。
   - 修正：ドメインごとに標準化し、ラッパーのドキュメントを整合させる。

5. **ネストされた非同期タスクでのキャンセルブリッジの忘れ**
   - 症状：外部トークンがキャンセルされても内部リーダー/サブプロセスタスクが実行を継続する。
   - 修正：内部トークン/シグナルにキャンセルをブリッジし、グレースタイムアウト + 強制アボートフォールバックを適用する。

## 新しいキャンセル可能エクスポートのチェックリスト

1. ワークを正しく分類する：
   - CPU負荷が高いまたは同期ブロッキング -> `task::blocking`
   - 非同期I/O / `await` オーケストレーション -> `task::future`

2. 必要に応じてキャンセル入力を公開する：
   - `#[napi(object)]` オプションに `timeoutMs` と `signal` を含める
   - `let ct = task::CancelToken::new(timeout_ms, signal);` を作成する

3. すべてのレイヤーにキャンセルを接続する：
   - ブロッキングループ：安定した間隔で `ct.heartbeat()?` を実行
   - 非同期オーケストレーション：`ct.wait()` とレースし、サブタスク/トークンをキャンセル

4. キャンセルの契約を決定する：
   - アボートエラーでPromiseをリジェクトする、または
   - 型付き `{ cancelled, timedOut, ... }` でリゾルブする
   - この契約をAPIファミリ全体で一貫させる

5. コンテキスト付きで失敗を伝播する：
   - `Error::from_reason(format!("...: {err}"))` でエラーをマッピングする
   - ステージ固有のプレフィックスを含める（`spawn`、`decode`、`wait` など）

6. 開始前および実行中のキャンセルを処理する：
   - キャンセルチェック/awaitは、高コストなボディの前と長時間実行中に行う必要がある

7. エグゼキュータの誤用がないことを検証する：
   - `spawn_blocking`/ブロッキングタスクラッパーなしで、非同期future内に長い同期ワークを直接配置しない
