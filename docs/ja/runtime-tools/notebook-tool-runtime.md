---
title: Notebookツールランタイムの内部構造
description: セル実行、カーネルライフサイクル、出力レンダリングを備えたJupyter notebookツールランタイム。
sidebar:
  order: 2
  label: Notebookツール
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Notebookツールランタイムの内部構造

このドキュメントでは、現在の `notebook` ツールの実装と、カーネルベースのPythonランタイムとの関係について説明します。

重要な区別：**`notebook` はJSON notebookエディタであり、notebookエグゼキュータではありません**。`.ipynb` のセルソースを直接編集しますが、Pythonカーネルを起動したり通信したりすることはありません。

## 実装ファイル

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ランタイム境界：編集と実行

## `notebook` ツール (`src/tools/notebook.ts`)

- `.ipynb` ファイルに対する `action: edit | insert | delete` をサポートします。
- セッションCWDに対する相対パスを解決します（`resolveToCwd`）。
- notebook JSONを読み込み、`cells` 配列を検証し、`cell_index` の範囲を検証します。
- メモリ内でソース編集を適用し、`JSON.stringify(notebook, null, 1)` で完全なnotebook JSONを書き戻します。
- テキストサマリー + 構造化された `details`（`action`、`cellIndex`、`cellType`、`totalCells`、`cellSource`）を返します。

このツールにはカーネルライフサイクルは存在しません：

- ゲートウェイの取得なし
- カーネルセッションIDなし
- `execute_request` なし
- カーネルチャネルからのストリームチャンクなし
- リッチディスプレイのキャプチャなし（`image/png`、JSONディスプレイ、ステータスMIME）

## Notebookライクな実行パス (`src/tools/python.ts` + `src/ipy/*`)

エージェントがセルスタイルのPythonコード（連続セル、永続的な状態、リッチディスプレイ）を実行する必要がある場合、それは `notebook` ではなく **`python` ツール** を経由します。

カーネルモード、再起動/キャンセル動作、チャンクストリーミング、出力アーティファクトの切り詰めが存在するのはこのパスです。

## 2) Notebookセル処理のセマンティクス（`notebook` ツール）

## ソースの正規化

`content` は改行を保持した `source: string[]` に分割されます：

- 最終行以外の各行は末尾の `\n` を保持します
- 最終行には強制的な末尾改行はありません

これはnotebook JSONの規約に従い、後続の編集での意図しない行の結合を防ぎます。

## アクションの動作

- `edit`
  - `cells[cell_index].source` を置き換えます
  - 既存の `cell_type` を保持します
- `insert`
  - `[0..cellCount]` の位置に挿入します
  - `cell_type` はデフォルトで `code` です
  - コードセルは `execution_count: null` と `outputs: []` で初期化されます
  - markdownセルは `metadata` + `source` のみで初期化されます
- `delete`
  - `cells[cell_index]` を削除します
  - レンダラープレビュー用に、削除された `source` をdetailsで返します

## エラーサーフェス

以下の場合にハードフェイラーがスローされます：

- notebookファイルが見つからない
- 無効なJSON
- `cells` が存在しない、または配列でない
- 範囲外のインデックス（insertとそれ以外では有効な範囲が異なります）
- `edit`/`insert` で `content` が欠落している

これらは上流で `Error:` ツールレスポンスになります。レンダラーはnotebookパス + フォーマットされたエラーテキストを使用します。

## 3) カーネルセッションのセマンティクス（実際に存在する場所）

カーネルセマンティクスは `executePython` / `PythonKernel` に実装されており、`python` ツールに適用されます。

## モード

`PythonKernelMode`：

- `session`（デフォルト）
  - カーネルは `kernelSessions` マップにキャッシュされます
  - 最大4セッション。オーバーフロー時は最も古いものが退去されます
  - 30秒ごとにアイドル/デッド状態のクリーンアップ、5分後にタイムアウト
  - セッションごとのキューが実行をシリアライズします（`session.queue`）
- `per-call`
  - リクエストごとにカーネルを作成します
  - 実行します
  - `finally` で常にカーネルをシャットダウンします

## リセット動作

`python` ツールは、マルチセル呼び出しの最初のセルに対してのみ `reset` を渡します。それ以降のセルは常に `reset: false` で実行されます。

## カーネルの死亡 / 再起動 / リトライ

セッションモード（`withKernelSession`）の場合：

- カーネルの死亡はハートビート（5秒ごとの `kernel.isAlive()` チェック）または実行失敗で検出されます。
- 実行前のデッド状態は `restartKernelSession` をトリガーします。
- 実行時のクラッシュパスは1回リトライします：カーネルを再起動し、ハンドラーを再実行します。
- 同じセッションで `restartCount > 1` の場合、`Python kernel restarted too many times in this session` がスローされます。

起動リトライの動作：

- 共有ゲートウェイのカーネル作成は、HTTP 5xxの `SharedGatewayCreateError` で1回リトライします。

リソース枯渇の回復：

- `EMFILE`/`ENFILE`/「Too many open files」スタイルの障害を検出します
- 追跡されたセッションをクリアします
- `shutdownSharedGateway()` を呼び出します
- カーネルセッション作成を1回リトライします

## 4) 環境/セッション変数の注入

カーネル起動時にエグゼキュータからオプションのenvマップを受け取ります：

- `PI_SESSION_FILE`（セッション状態ファイルのパス）
- `ARTIFACTS`（アーティファクトディレクトリ）

`PythonKernel.#initializeKernelEnvironment(...)` は、カーネル内で初期化スクリプトを実行して：

- `os.chdir(cwd)`
- `os.environ` にenv エントリを注入
- cwdが `sys.path` にない場合は先頭に追加

影響：

- セッションやアーティファクトのコンテキストを読み取るプレリュードヘルパーは、Pythonプロセス状態のこれらの環境変数に依存しています。

## 5) ストリーミング/チャンクとディスプレイ処理（カーネルベースのパス）

カーネルクライアントは、実行ごとにJupyterプロトコルメッセージを処理します：

- `stream` -> テキストチャンクを `onChunk` へ
- `execute_result` / `display_data` ->
  - ディスプレイテキストはMIME優先順位で選択：`text/markdown` > `text/plain` > 変換された `text/html`
  - 構造化出力は別途キャプチャ：
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }`（テキスト出力なし）
- `error` -> トレースバックテキストがチャンクストリームにプッシュ + 構造化エラーメタデータ
- `input_request` -> stdin警告テキストを出力し、空の `input_reply` を送信し、stdin要求済みをマーク
- 完了は `execute_reply` とカーネルの `status=idle` の両方を待機

キャンセル/タイムアウト：

- アボートシグナルが `interrupt()` をトリガー（REST `/interrupt` + コントロールチャネル `interrupt_request`）
- 結果に `cancelled=true` をマーク
- タイムアウトパスは出力に `Command timed out after <n> seconds` を付記

## 6) 切り詰めとアーティファクトの動作

`src/session/streaming-output.ts` の `OutputSink` はカーネル実行パス（`executeWithKernel`）で使用されます：

- すべてのチャンクをサニタイズ（`sanitizeText`）
- 合計/出力行数とバイト数を追跡
- オプションのアーティファクトスピルファイル（`artifactPath`、`artifactId`）
- メモリ内バッファがしきい値（オーバーライドされない限り `DEFAULT_MAX_BYTES`）を超えた場合：
  - 切り詰め済みをマーク
  - メモリ内に末尾バイトを保持（UTF-8安全な境界）
  - フルストリームをアーティファクトシンクにスピル可能

`dump()` は以下を返します：

- 表示可能な出力テキスト（末尾が切り詰められている可能性あり）
- 切り詰めフラグ + カウント
- アーティファクトID（`artifact://<id>` 参照用）

`python` ツールはこのメタデータを結果の切り詰め通知とTUI警告に変換します。

`notebook` ツールは `OutputSink` を**使用しません**。コードを実行しないため、ストリーム/アーティファクト切り詰めパイプラインはありません。

## 7) レンダラーの前提とフォーマット

## Notebookレンダラー (`notebookToolRenderer`)

- 呼び出しビュー：アクション + notebookパス + セル/タイプメタデータを含むステータスライン
- 結果ビュー：
  - `details` から導出された成功サマリー
  - `cellSource` は `renderCodeCell` でレンダリング
  - markdownセルは言語ヒント `markdown` を設定。その他のセルには明示的な言語オーバーライドなし
  - 折りたたみコードプレビューの制限は `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 共有レンダーオプションによる展開モードをサポート
  - 幅 + 展開状態をキーとするレンダーキャッシュを使用

エラーレンダリングの前提：

- 最初のテキストコンテンツが `Error:` で始まる場合、レンダラーはnotebookエラーブロックとしてフォーマットします。

## Pythonレンダラー（実際の実行出力用）

カーネルベースの実行レンダリングは以下を期待します：

- セルごとのステータス遷移（`pending/running/complete/error`）
- オプションの構造化ステータスイベントセクション
- オプションのJSON出力ツリー
- 切り詰め警告 + オプションの `artifact://<id>` ポインタ

このレンダラーの動作は、共有TUIプリミティブを再利用する点を除いて、`notebook` JSON編集結果とは無関係です。

## 8) プレーンPythonツールの動作との差異

「プレーンPythonツール」が `python` 実行パスを意味する場合：

- `python` はカーネルでコードを実行し、モードに応じて状態を永続化し、チャンクをストリーミングし、リッチディスプレイをキャプチャし、割り込み/タイムアウトを処理し、出力の切り詰め/アーティファクトをサポートします。
- `notebook` は決定論的なnotebook JSONの変更のみを実行します。実行なし、カーネル状態なし、チャンクストリームなし、ディスプレイ出力なし、アーティファクトパイプラインなし。

ワークフローで両方が必要な場合：

1. `notebook` でnotebookソースを編集
2. `notebook` ではなく `python` でコードセルを実行（手動でコードを渡す）

現在の実装では、`.ipynb` の変更とカーネルコンテキストを通じたnotebookセルの実行の両方を行う単一のツールは提供されていません。
