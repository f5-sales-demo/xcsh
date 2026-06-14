---
title: ノートブックツールランタイム内部実装
description: セル実行、カーネルライフサイクル、出力レンダリングを含む Jupyter ノートブックツールランタイム。
sidebar:
  order: 2
  label: ノートブックツール
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# ノートブックツールランタイム内部実装

本ドキュメントでは、現在の `notebook` ツール実装と、カーネルベースの Python ランタイムとの関係について説明します。

重要な区別: **`notebook` は JSON ノートブックエディターであり、ノートブック実行エンジンではありません**。`.ipynb` のセルソースを直接編集するものであり、Python カーネルの起動や通信は行いません。

## 実装ファイル

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ランタイム境界: 編集と実行

## `notebook` ツール (`src/tools/notebook.ts`)

- `.ipynb` ファイルに対して `action: edit | insert | delete` をサポートします。
- セッション CWD を基準としてパスを解決します (`resolveToCwd`)。
- ノートブック JSON を読み込み、`cells` 配列を検証し、`cell_index` の範囲を検証します。
- ソースの編集をメモリ内で適用し、`JSON.stringify(notebook, null, 1)` でノートブック JSON 全体を書き戻します。
- テキスト形式のサマリーと構造化された `details` (`action`、`cellIndex`、`cellType`、`totalCells`、`cellSource`) を返します。

このツールにはカーネルライフサイクルは存在しません:

- ゲートウェイの取得なし
- カーネルセッション ID なし
- `execute_request` なし
- カーネルチャンネルからのストリームチャンクなし
- リッチディスプレイキャプチャなし (`image/png`、JSON ディスプレイ、ステータス MIME)

## ノートブックライクな実行パス (`src/tools/python.ts` + `src/ipy/*`)

エージェントがセルスタイルの Python コードを実行する必要がある場合（順次実行されるセル、永続状態、リッチディスプレイ）、それは `notebook` ではなく **`python` ツール** を経由します。

カーネルモード、再起動/キャンセルの動作、チャンクストリーミング、出力アーティファクトの切り捨てが存在するのは、こちらのパスです。

## 2) ノートブックセル処理のセマンティクス (`notebook` ツール)

## ソースの正規化

`content` は `source: string[]` に分割され、改行は保持されます:

- 最終行以外の各行は末尾の `\n` を保持します
- 最終行には末尾の改行を強制しません

これはノートブック JSON の慣例に準拠しており、後続の編集時に意図しない行の連結が発生するのを防ぎます。

## アクションの動作

- `edit`
  - `cells[cell_index].source` を置き換えます
  - 既存の `cell_type` を保持します
- `insert`
  - `[0..cellCount]` の位置に挿入します
  - `cell_type` のデフォルトは `code` です
  - コードセルは `execution_count: null` と `outputs: []` で初期化されます
  - マークダウンセルは `metadata` と `source` のみで初期化されます
- `delete`
  - `cells[cell_index]` を削除します
  - レンダラープレビュー用に削除された `source` を details に返します

## エラーの種類

以下の場合はハードエラーがスローされます:

- ノートブックファイルが見つからない場合
- JSON が無効な場合
- `cells` が存在しないか配列でない場合
- インデックスが範囲外の場合 (insert と非 insert では有効な範囲が異なります)
- `edit`/`insert` で `content` が欠落している場合

これらは上流で `Error:` ツールレスポンスとなり、レンダラーはノートブックパスとフォーマットされたエラーテキストを使用します。

## 3) カーネルセッションのセマンティクス (実際に存在する場所)

カーネルのセマンティクスは `executePython` / `PythonKernel` に実装されており、`python` ツールに適用されます。

## モード

`PythonKernelMode`:

- `session` (デフォルト)
  - カーネルは `kernelSessions` マップにキャッシュされます
  - 最大 4 セッション; オーバーフロー時は最も古いものが削除されます
  - アイドル/デッドのクリーンアップは 30 秒ごと、5 分後にタイムアウト
  - セッションごとのキューが実行を直列化します (`session.queue`)
- `per-call`
  - リクエストごとにカーネルを作成します
  - 実行します
  - `finally` で常にカーネルをシャットダウンします

## リセット動作

`python` ツールはマルチセル呼び出しの最初のセルにのみ `reset` を渡します。以降のセルは常に `reset: false` で実行されます。

## カーネルの停止 / 再起動 / リトライ

セッションモード (`withKernelSession`) において:

- デッドカーネルはハートビート (5 秒ごとの `kernel.isAlive()` チェック) または実行失敗によって検出されます。
- 実行前にデッド状態が検出された場合は `restartKernelSession` がトリガーされます。
- 実行時のクラッシュパスは 1 回リトライします: カーネルを再起動し、ハンドラーを再実行します。
- 同一セッション内で `restartCount > 1` の場合は `Python kernel restarted too many times in this session` をスローします。

起動リトライ動作:

- 共有ゲートウェイのカーネル作成は、HTTP 5xx を伴う `SharedGatewayCreateError` に対して 1 回リトライします。

リソース枯渇からの回復:

- `EMFILE`/`ENFILE`/"Too many open files" スタイルの失敗を検出します
- 追跡中のセッションをクリアします
- `shutdownSharedGateway()` を呼び出します
- カーネルセッションの作成を 1 回リトライします

## 4) 環境/セッション変数のインジェクション

カーネル起動時に、エグゼキューターからオプションの環境変数マップが渡されます:

- `PI_SESSION_FILE` (セッション状態ファイルパス)
- `ARTIFACTS` (アーティファクトディレクトリ)

`PythonKernel.#initializeKernelEnvironment(...)` はその後、カーネル内で初期化スクリプトを実行します:

- `os.chdir(cwd)`
- `os.environ` に環境変数エントリを注入します
- cwd が存在しない場合は `sys.path` の先頭に追加します

影響:

- セッションやアーティファクトのコンテキストを読み取るプレリュードヘルパーは、Python プロセス状態にあるこれらの環境変数に依存しています。

## 5) ストリーミング/チャンクおよびディスプレイ処理 (カーネルバックドパス)

カーネルクライアントは実行ごとに Jupyter プロトコルメッセージを処理します:

- `stream` -> テキストチャンクを `onChunk` に渡します
- `execute_result` / `display_data` ->
  - MIME の優先順位でディスプレイテキストを選択: `text/markdown` > `text/plain` > 変換済み `text/html`
  - 構造化された出力は別途キャプチャされます:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (テキスト出力なし)
- `error` -> トレースバックテキストをチャンクストリームに追加し、構造化されたエラーメタデータを記録します
- `input_request` -> stdin 警告テキストを出力し、空の `input_reply` を送信し、stdin がリクエストされたことをマークします
- 完了は `execute_reply` とカーネルの `status=idle` の両方を待機します

キャンセル/タイムアウト:

- アボートシグナルにより `interrupt()` がトリガーされます (REST `/interrupt` + コントロールチャンネル `interrupt_request`)
- 結果は `cancelled=true` とマークされます
- タイムアウトパスは出力に `Command timed out after <n> seconds` を付加します

## 6) 切り捨てとアーティファクトの動作

`src/session/streaming-output.ts` の `OutputSink` はカーネル実行パス (`executeWithKernel`) で使用されます:

- すべてのチャンクをサニタイズします (`sanitizeText`)
- 合計/出力の行数とバイト数を追跡します
- オプションのアーティファクトスピルファイル (`artifactPath`、`artifactId`)
- メモリ内バッファが閾値 (`DEFAULT_MAX_BYTES`、オーバーライド可能) を超えた場合:
  - 切り捨てフラグをマークします
  - テールバイトをメモリに保持します (UTF-8 安全境界)
  - アーティファクトシンクにフルストリームをスピルできます

`dump()` が返すもの:

- 表示可能な出力テキスト (テールが切り捨てられる場合あり)
- 切り捨てフラグ + カウント
- アーティファクト ID (`artifact://<id>` 参照用)

`python` ツールはこのメタデータを結果の切り捨て通知と TUI 警告に変換します。

`notebook` ツールは `OutputSink` を**使用しません**。コードを実行しないため、ストリーム/アーティファクトの切り捨てパイプラインが存在しません。

## 7) レンダラーの前提とフォーマット

## ノートブックレンダラー (`notebookToolRenderer`)

- 呼び出しビュー: アクション + ノートブックパス + セル/タイプメタデータを含むステータス行
- 結果ビュー:
  - `details` から導出されたサクセスサマリー
  - `cellSource` は `renderCodeCell` でレンダリングされます
  - マークダウンセルは言語ヒントに `markdown` を設定し、その他のセルには明示的な言語オーバーライドなし
  - 折りたたまれたコードプレビューの上限は `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 共有レンダーオプションによる展開モードをサポートします
  - 幅 + 展開状態をキーとするレンダーキャッシュを使用します

エラーレンダリングの前提:

- 最初のテキストコンテンツが `Error:` で始まる場合、レンダラーはノートブックエラーブロックとしてフォーマットします。

## Python レンダラー (実際の実行出力用)

カーネルバックドの実行レンダリングが期待するもの:

- セルごとのステータス遷移 (`pending/running/complete/error`)
- オプションの構造化ステータスイベントセクション
- オプションの JSON 出力ツリー
- 切り捨て警告 + オプションの `artifact://<id>` ポインター

このレンダラーの動作は `notebook` の JSON 編集結果とは無関係ですが、両者とも共有 TUI プリミティブを再利用します。

## 8) プレーン Python ツール動作との相違点

「プレーン Python ツール」が `python` 実行パスを意味する場合:

- `python` はカーネル内でコードを実行し、モードに応じて状態を永続化し、チャンクをストリーミングし、リッチディスプレイをキャプチャし、割り込み/タイムアウトを処理し、出力の切り捨て/アーティファクトをサポートします。
- `notebook` は決定論的なノートブック JSON の変更のみを実行します。実行なし、カーネル状態なし、チャンクストリームなし、ディスプレイ出力なし、アーティファクトパイプラインなし。

ワークフローで両方が必要な場合:

1. `notebook` でノートブックソースを編集します
2. `notebook` を経由せず、`python` でコードセルを実行します (コードを手動で渡す)

現在の実装では、`.ipynb` の変更とカーネルコンテキストを通じたノートブックセルの実行の両方を行う単一のツールは提供されていません。
