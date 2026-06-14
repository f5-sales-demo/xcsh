---
title: ノートブックツールランタイム内部構造
description: セル実行、カーネルライフサイクル、出力レンダリングを備えた Jupyter ノートブックツールランタイム。
sidebar:
  order: 2
  label: ノートブックツール
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# ノートブックツールランタイム内部構造

本ドキュメントでは、現在の `notebook` ツールの実装と、カーネルが基盤となる Python ランタイムとの関係について説明します。

重要な区別として、**`notebook` は JSON ノートブックエディターであり、ノートブックの実行エンジンではありません**。`.ipynb` のセルソースを直接編集するものであり、Python カーネルの起動やカーネルとの通信は行いません。

## 実装ファイル

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ランタイム境界：編集と実行

## `notebook` ツール（`src/tools/notebook.ts`）

- `.ipynb` ファイルに対して `action: edit | insert | delete` をサポートします。
- セッションの CWD（`resolveToCwd`）を基準にパスを解決します。
- ノートブック JSON を読み込み、`cells` 配列を検証し、`cell_index` の範囲を検証します。
- ソースの編集をメモリ内で適用し、`JSON.stringify(notebook, null, 1)` を使用してノートブック JSON 全体を書き戻します。
- テキスト形式のサマリーと構造化された `details`（`action`、`cellIndex`、`cellType`、`totalCells`、`cellSource`）を返します。

このツールにはカーネルライフサイクルが存在しません：

- ゲートウェイの取得なし
- カーネルセッション ID なし
- `execute_request` なし
- カーネルチャンネルからのストリームチャンクなし
- リッチディスプレイのキャプチャなし（`image/png`、JSON ディスプレイ、ステータス MIME）

## ノートブック的な実行パス（`src/tools/python.ts` + `src/ipy/*`）

エージェントがセルスタイルの Python コード（シーケンシャルなセル、永続的な状態、リッチディスプレイ）を実行する必要がある場合、それは `notebook` ではなく **`python` ツール** を経由します。

カーネルモード、リスタート・キャンセル動作、チャンクストリーミング、出力アーティファクトの切り捨てが存在するのは、このパスです。

## 2) ノートブックセル処理のセマンティクス（`notebook` ツール）

## ソースの正規化

`content` は `source: string[]` に分割され、改行が保持されます：

- 最終行以外の各行は末尾の `\n` を保持します
- 最終行には末尾の改行は強制されません

これはノートブック JSON の規則に従っており、後続の編集時における意図しない行の連結を防ぎます。

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
  - レンダラーのプレビュー用に、削除された `source` を details に返します

## エラーの発生条件

以下の場合にハードエラーがスローされます：

- ノートブックファイルが存在しない
- 無効な JSON
- `cells` が存在しないか配列でない
- インデックスが範囲外（insert と非 insert では有効な範囲が異なります）
- `edit`/`insert` に `content` がない

これらは上流で `Error:` ツールレスポンスとなり、レンダラーはノートブックパスとフォーマットされたエラーテキストを使用します。

## 3) カーネルセッションのセマンティクス（実際に存在する場所）

カーネルのセマンティクスは `executePython` / `PythonKernel` に実装されており、`python` ツールに適用されます。

## モード

`PythonKernelMode`：

- `session`（デフォルト）
  - カーネルは `kernelSessions` マップにキャッシュされます
  - 最大 4 セッション；超過時は最も古いものが削除されます
  - 30 秒ごとにアイドル・デッドのクリーンアップ、5 分後にタイムアウト
  - セッションごとのキューが実行をシリアライズします（`session.queue`）
- `per-call`
  - リクエストごとにカーネルを作成します
  - 実行します
  - `finally` 内で常にカーネルをシャットダウンします

## リセット動作

`python` ツールは、複数セルの呼び出しにおける最初のセルにのみ `reset` を渡します。それ以降のセルは常に `reset: false` で実行されます。

## カーネルの死亡・リスタート・リトライ

セッションモード（`withKernelSession`）において：

- デッドカーネルはハートビート（5 秒ごとの `kernel.isAlive()` チェック）または実行失敗によって検出されます。
- 実行前のデッド状態は `restartKernelSession` をトリガーします。
- 実行時のクラッシュパスは一度リトライします：カーネルをリスタートし、ハンドラーを再実行します。
- 同一セッション内で `restartCount > 1` になると `Python kernel restarted too many times in this session` がスローされます。

起動時のリトライ動作：

- 共有ゲートウェイのカーネル作成は、HTTP 5xx を伴う `SharedGatewayCreateError` に対して一度リトライします。

リソース枯渇からの回復：

- `EMFILE`/`ENFILE`/"Too many open files" スタイルの失敗を検出します
- 追跡中のセッションをクリアします
- `shutdownSharedGateway()` を呼び出します
- カーネルセッションの作成を一度リトライします

## 4) 環境・セッション変数の注入

カーネル起動時にエグゼキューターからオプションの環境マップを受け取ります：

- `PI_SESSION_FILE`（セッション状態ファイルのパス）
- `ARTIFACTS`（アーティファクトディレクトリ）

`PythonKernel.#initializeKernelEnvironment(...)` は、カーネル内で初期化スクリプトを実行して以下を行います：

- `os.chdir(cwd)`
- 環境エントリを `os.environ` に注入します
- cwd が存在しない場合、`sys.path` の先頭に追加します

意味合いとして：

- セッションやアーティファクトのコンテキストを読み取るプレリュードヘルパーは、Python プロセスの状態内のこれらの環境変数に依存します。

## 5) ストリーミング・チャンクおよびディスプレイ処理（カーネルバックドパス）

カーネルクライアントは実行ごとに Jupyter プロトコルメッセージを処理します：

- `stream` -> テキストチャンクを `onChunk` へ
- `execute_result` / `display_data` ->
  - MIME の優先順位に基づいてディスプレイテキストを選択：`text/markdown` > `text/plain` > 変換済み `text/html`
  - 構造化出力を個別にキャプチャ：
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }`（テキスト出力なし）
- `error` -> トレースバックテキストをチャンクストリームにプッシュ + 構造化エラーメタデータ
- `input_request` -> stdin 警告テキストを発行し、空の `input_reply` を送信し、stdin リクエスト済みとしてマーク
- 完了は `execute_reply` とカーネルの `status=idle` の両方を待ちます

キャンセル・タイムアウト：

- 中止シグナルは `interrupt()` をトリガーします（REST `/interrupt` + コントロールチャンネルの `interrupt_request`）
- 結果は `cancelled=true` でマークされます
- タイムアウトパスは出力に `Command timed out after <n> seconds` のアノテーションを付けます

## 6) 切り捨てとアーティファクトの動作

`src/session/streaming-output.ts` の `OutputSink` は、カーネル実行パス（`executeWithKernel`）で使用されます：

- すべてのチャンクをサニタイズします（`sanitizeText`）
- 総行数・出力行数・バイト数を追跡します
- オプションのアーティファクトスピルファイル（`artifactPath`、`artifactId`）
- メモリ内バッファがしきい値（特に指定がない場合は `DEFAULT_MAX_BYTES`）を超えた場合：
  - 切り捨て済みとしてマークします
  - 末尾バイトをメモリに保持します（UTF-8 安全境界）
  - フルストリームをアーティファクトシンクにスピルできます

`dump()` は以下を返します：

- 表示可能な出力テキスト（末尾が切り捨てられている場合があります）
- 切り捨てフラグ + カウント
- アーティファクト ID（`artifact://<id>` 参照用）

`python` ツールはこのメタデータを結果の切り捨て通知と TUI 警告に変換します。

`notebook` ツールは `OutputSink` を**使用しません**。コードを実行しないため、ストリーム・アーティファクトの切り捨てパイプラインがありません。

## 7) レンダラーの前提条件とフォーマット

## ノートブックレンダラー（`notebookToolRenderer`）

- 呼び出しビュー：アクション + ノートブックパス + セル・タイプメタデータを含むステータス行
- 結果ビュー：
  - `details` から導出されたサクセスサマリー
  - `renderCodeCell` を介してレンダリングされた `cellSource`
  - マークダウンセルは言語ヒントに `markdown` を設定；その他のセルには明示的な言語オーバーライドなし
  - 折り畳まれたコードプレビューの上限は `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 共有レンダーオプションを介した展開モードをサポートします
  - 幅 + 展開状態をキーとするレンダーキャッシュを使用します

エラーレンダリングの前提：

- 最初のテキストコンテンツが `Error:` で始まる場合、レンダラーはノートブックエラーブロックとしてフォーマットします。

## Python レンダラー（実際の実行出力用）

カーネルバックドの実行レンダリングは以下を期待します：

- セルごとのステータス遷移（`pending/running/complete/error`）
- オプションの構造化ステータスイベントセクション
- オプションの JSON 出力ツリー
- 切り捨て警告 + オプションの `artifact://<id>` ポインター

このレンダラーの動作は、両者が共有 TUI プリミティブを再利用することを除き、`notebook` JSON 編集結果とは無関係です。

## 8) プレーン Python ツールの動作との相違点

「プレーン Python ツール」が `python` 実行パスを意味する場合：

- `python` はカーネル内でコードを実行し、モードによって状態を永続化し、チャンクをストリームし、リッチディスプレイをキャプチャし、割り込み・タイムアウトを処理し、出力の切り捨て・アーティファクトをサポートします。
- `notebook` は確定的なノートブック JSON の変更のみを実行します；実行なし、カーネル状態なし、チャンクストリームなし、ディスプレイ出力なし、アーティファクトパイプラインなし。

ワークフローで両方が必要な場合：

1. `notebook` でノートブックソースを編集します
2. `notebook` を経由せず、`python` を通じてコードセルを実行します（コードを手動で渡します）

現在の実装では、`.ipynb` の変更とカーネルコンテキストを通じたノートブックセルの実行の両方を行う単一のツールは提供されていません。
