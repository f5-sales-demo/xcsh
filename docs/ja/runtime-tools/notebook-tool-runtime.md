---
title: Notebook Tool Runtime Internals
description: >-
  Jupyter notebook tool runtime with cell execution, kernel lifecycle, and
  output rendering.
sidebar:
  order: 2
  label: Notebook tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Notebookツールランタイムの内部構造

このドキュメントでは、現在の `notebook` ツールの実装と、カーネルバックエンドのPythonランタイムとの関係について説明します。

重要な違い: **`notebook` はJSON形式のノートブックエディタであり、ノートブックの実行エンジンではありません**。`.ipynb` のセルソースを直接編集するものであり、Pythonカーネルの起動や通信は行いません。

## 実装ファイル

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ランタイムの境界: 編集と実行

## `notebook` ツール (`src/tools/notebook.ts`)

- `.ipynb` ファイルに対する `action: edit | insert | delete` をサポートします。
- セッションのCWDに対する相対パスを解決します（`resolveToCwd`）。
- ノートブックJSONを読み込み、`cells` 配列を検証し、`cell_index` の範囲を検証します。
- メモリ上でソース編集を適用し、`JSON.stringify(notebook, null, 1)` でノートブックJSON全体を書き戻します。
- テキストによるサマリーと構造化された `details`（`action`、`cellIndex`、`cellType`、`totalCells`、`cellSource`）を返します。

このツールにはカーネルのライフサイクルは存在しません:

- ゲートウェイの取得なし
- カーネルセッションIDなし
- `execute_request` なし
- カーネルチャネルからのストリームチャンクなし
- リッチディスプレイのキャプチャなし（`image/png`、JSONディスプレイ、ステータスMIME）

## ノートブック風の実行パス (`src/tools/python.ts` + `src/ipy/*`)

エージェントがセルスタイルのPythonコード（連続セル、永続的な状態、リッチディスプレイ）を実行する必要がある場合、それは `notebook` ではなく **`python` ツール** を経由します。

カーネルモード、再起動/キャンセル動作、チャンクストリーミング、出力アーティファクトの切り詰めが存在するのはこのパスです。

## 2) ノートブックセルの処理セマンティクス（`notebook` ツール）

## ソースの正規化

`content` は改行を保持しながら `source: string[]` に分割されます:

- 最終行以外の各行は末尾の `\n` を保持
- 最終行には強制的な末尾改行なし

これはノートブックJSONの規約に準拠しており、後続の編集時に意図しない行の連結を防ぎます。

## アクションの動作

- `edit`
  - `cells[cell_index].source` を置き換え
  - 既存の `cell_type` を保持
- `insert`
  - `[0..cellCount]` の位置に挿入
  - `cell_type` のデフォルトは `code`
  - コードセルは `execution_count: null` と `outputs: []` で初期化
  - マークダウンセルは `metadata` + `source` のみを初期化
- `delete`
  - `cells[cell_index]` を削除
  - レンダラーのプレビュー用に、削除された `source` を details で返す

## エラーの表面化

以下の場合にハードエラーがスローされます:

- ノートブックファイルが存在しない
- 無効なJSON
- `cells` が存在しない、または配列でない
- 範囲外のインデックス（挿入と非挿入では有効な範囲が異なる）
- `edit`/`insert` に対する `content` の欠落

これらは上流で `Error:` ツールレスポンスになります。レンダラーはノートブックパス + フォーマットされたエラーテキストを使用します。

## 3) カーネルセッションのセマンティクス（実際に存在する場所）

カーネルセマンティクスは `executePython` / `PythonKernel` に実装されており、`python` ツールに適用されます。

## モード

`PythonKernelMode`:

- `session`（デフォルト）
  - カーネルは `kernelSessions` マップにキャッシュ
  - 最大4セッション。オーバーフロー時は最も古いものが退去
  - 30秒ごとにアイドル/デッドのクリーンアップ、5分後にタイムアウト
  - セッションごとのキューが実行をシリアライズ（`session.queue`）
- `per-call`
  - リクエストごとにカーネルを作成
  - 実行
  - `finally` で常にカーネルをシャットダウン

## リセット動作

`python` ツールは複数セル呼び出しの最初のセルに対してのみ `reset` を渡します。以降のセルは常に `reset: false` で実行されます。

## カーネルの死亡 / 再起動 / リトライ

セッションモード（`withKernelSession`）の場合:

- デッドカーネルはハートビート（5秒ごとの `kernel.isAlive()` チェック）または実行失敗で検出。
- 実行前のデッド状態は `restartKernelSession` をトリガー。
- 実行時のクラッシュパスは1回リトライ: カーネルを再起動し、ハンドラを再実行。
- 同一セッション内で `restartCount > 1` の場合、`Python kernel restarted too many times in this session` をスロー。

起動リトライ動作:

- 共有ゲートウェイのカーネル作成は、HTTP 5xxを伴う `SharedGatewayCreateError` で1回リトライ。

リソース枯渇からの回復:

- `EMFILE`/`ENFILE`/"Too many open files" スタイルの障害を検出
- 追跡中のセッションをクリア
- `shutdownSharedGateway()` を呼び出し
- カーネルセッション作成を1回リトライ

## 4) 環境/セッション変数の注入

カーネル起動時にエグゼキューターからオプションの環境変数マップを受け取ります:

- `PI_SESSION_FILE`（セッション状態ファイルのパス）
- `ARTIFACTS`（アーティファクトディレクトリ）

`PythonKernel.#initializeKernelEnvironment(...)` はカーネル内で初期化スクリプトを実行し:

- `os.chdir(cwd)`
- 環境変数エントリを `os.environ` に注入
- cwdが存在しない場合は `sys.path` の先頭に追加

含意:

- セッションまたはアーティファクトコンテキストを読み取るプリリュードヘルパーは、Pythonプロセス状態のこれらの環境変数に依存します。

## 5) ストリーミング/チャンクとディスプレイの処理（カーネルバックエンドパス）

カーネルクライアントは実行ごとにJupyterプロトコルメッセージを処理します:

- `stream` -> テキストチャンクを `onChunk` へ
- `execute_result` / `display_data` ->
  - 表示テキストはMIME優先順位で選択: `text/markdown` > `text/plain` > 変換された `text/html`
  - 構造化出力は別途キャプチャ:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }`（テキスト出力なし）
- `error` -> トレースバックテキストをチャンクストリームにプッシュ + 構造化エラーメタデータ
- `input_request` -> stdin警告テキストを出力し、空の `input_reply` を送信、stdin要求フラグをマーク
- 完了は `execute_reply` とカーネルの `status=idle` の両方を待機

キャンセル/タイムアウト:

- 中止シグナルは `interrupt()`（REST `/interrupt` + コントロールチャネルの `interrupt_request`）をトリガー
- 結果は `cancelled=true` をマーク
- タイムアウトパスは出力に `Command timed out after <n> seconds` を付加

## 6) 切り詰めとアーティファクトの動作

`src/session/streaming-output.ts` の `OutputSink` はカーネル実行パス（`executeWithKernel`）で使用されます:

- すべてのチャンクをサニタイズ（`sanitizeText`）
- 合計/出力行数とバイト数を追跡
- オプションのアーティファクトスピルファイル（`artifactPath`、`artifactId`）
- メモリ内バッファがしきい値（オーバーライドされない限り `DEFAULT_MAX_BYTES`）を超えた場合:
  - 切り詰めフラグをマーク
  - 末尾バイトをメモリに保持（UTF-8安全な境界）
  - 完全なストリームをアーティファクトシンクにスピル可能

`dump()` の戻り値:

- 表示可能な出力テキスト（末尾切り詰めの可能性あり）
- 切り詰めフラグ + カウント
- アーティファクトID（`artifact://<id>` 参照用）

`python` ツールはこのメタデータを結果の切り詰め通知とTUI警告に変換します。

`notebook` ツールは `OutputSink` を **使用しません**。コードを実行しないため、ストリーム/アーティファクトの切り詰めパイプラインを持ちません。

## 7) レンダラーの前提とフォーマット

## ノートブックレンダラー（`notebookToolRenderer`）

- 呼び出しビュー: アクション + ノートブックパス + セル/タイプメタデータを含むステータス行
- 結果ビュー:
  - 成功サマリーは `details` から導出
  - `cellSource` は `renderCodeCell` 経由でレンダリング
  - マークダウンセルは言語ヒント `markdown` を設定。その他のセルには明示的な言語オーバーライドなし
  - 折りたたみ時のコードプレビュー制限は `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 共有レンダーオプションによる展開モードをサポート
  - 幅 + 展開状態をキーとするレンダーキャッシュを使用

エラーレンダリングの前提:

- 最初のテキストコンテンツが `Error:` で始まる場合、レンダラーはノートブックエラーブロックとしてフォーマットします。

## Pythonレンダラー（実際の実行出力用）

カーネルバックエンドの実行レンダリングが期待するもの:

- セルごとのステータス遷移（`pending/running/complete/error`）
- オプションの構造化ステータスイベントセクション
- オプションのJSON出力ツリー
- 切り詰め警告 + オプションの `artifact://<id>` ポインタ

このレンダラーの動作は、両者が共有TUIプリミティブを再利用する点を除いて、`notebook` のJSON編集結果とは無関係です。

## 8) 通常のPythonツールの動作との差異

「通常のPythonツール」が `python` 実行パスを意味する場合:

- `python` はカーネルでコードを実行し、モードに応じて状態を永続化し、チャンクをストリーミングし、リッチディスプレイをキャプチャし、割り込み/タイムアウトを処理し、出力の切り詰め/アーティファクトをサポートします。
- `notebook` は決定論的なノートブックJSONの変更のみを実行します。実行なし、カーネル状態なし、チャンクストリームなし、ディスプレイ出力なし、アーティファクトパイプラインなし。

両方が必要なワークフローの場合:

1. `notebook` でノートブックソースを編集
2. `python`（手動でコードを渡す）を介してコードセルを実行。`notebook` 経由ではない

現在の実装では、`.ipynb` の変更とカーネルコンテキストを通じたノートブックセルの実行の両方を行う単一のツールは提供されていません。
