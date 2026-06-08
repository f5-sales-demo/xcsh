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

# Notebookツールのランタイム内部構造

このドキュメントでは、現在の`notebook`ツールの実装と、カーネルベースのPythonランタイムとの関係について説明します。

重要な区別：**`notebook`はJSON notebookエディターであり、notebookエグゼキューターではありません**。`.ipynb`のセルソースを直接編集しますが、Pythonカーネルの起動や通信は行いません。

## 実装ファイル

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ランタイム境界：編集と実行

## `notebook`ツール（`src/tools/notebook.ts`）

- `.ipynb`ファイルに対する`action: edit | insert | delete`をサポートします。
- セッションCWDに対する相対パスを解決します（`resolveToCwd`）。
- notebook JSONを読み込み、`cells`配列を検証し、`cell_index`の範囲を検証します。
- メモリ内でソース編集を適用し、`JSON.stringify(notebook, null, 1)`で完全なnotebook JSONを書き戻します。
- テキスト要約と構造化された`details`（`action`、`cellIndex`、`cellType`、`totalCells`、`cellSource`）を返します。

このツールにはカーネルライフサイクルが存在しません：

- ゲートウェイの取得なし
- カーネルセッションIDなし
- `execute_request`なし
- カーネルチャネルからのストリームチャンクなし
- リッチ表示キャプチャなし（`image/png`、JSON表示、ステータスMIME）

## Notebook風の実行パス（`src/tools/python.ts` + `src/ipy/*`）

エージェントがセルスタイルのPythonコード（シーケンシャルセル、永続状態、リッチ表示）を実行する必要がある場合、それは`notebook`ではなく**`python`ツール**を通じて処理されます。

カーネルモード、再起動/キャンセル動作、チャンクストリーミング、出力アーティファクトの切り詰めが存在するのはこのパスです。

## 2) Notebookセル処理のセマンティクス（`notebook`ツール）

## ソースの正規化

`content`は改行を保持した`source: string[]`に分割されます：

- 最終行以外の各行は末尾の`\n`を保持
- 最終行には強制的な末尾改行なし

これはnotebook JSONの慣例を反映し、後続の編集での意図しない行結合を防ぎます。

## アクション動作

- `edit`
  - `cells[cell_index].source`を置換
  - 既存の`cell_type`を保持
- `insert`
  - `[0..cellCount]`の位置に挿入
  - `cell_type`のデフォルトは`code`
  - コードセルは`execution_count: null`と`outputs: []`で初期化
  - マークダウンセルは`metadata` + `source`のみで初期化
- `delete`
  - `cells[cell_index]`を削除
  - レンダラープレビュー用にdetailsで削除された`source`を返す

## エラー表面

以下の場合にハードフェイルがスローされます：

- notebookファイルが見つからない
- 無効なJSON
- `cells`が存在しない、または配列でない
- 範囲外のインデックス（insertとnon-insertで有効範囲が異なる）
- `edit`/`insert`に`content`がない

これらは上流で`Error:`ツールレスポンスとなり、レンダラーはnotebookパスとフォーマットされたエラーテキストを使用します。

## 3) カーネルセッションのセマンティクス（実際に存在する場所）

カーネルセマンティクスは`executePython` / `PythonKernel`で実装されており、`python`ツールに適用されます。

## モード

`PythonKernelMode`:

- `session`（デフォルト）
  - カーネルは`kernelSessions`マップにキャッシュ
  - 最大4セッション；オーバーフロー時に最古のものが退去
  - 30秒ごとにアイドル/デッドクリーンアップ、5分後にタイムアウト
  - セッションごとのキューが実行を直列化（`session.queue`）
- `per-call`
  - リクエストごとにカーネルを作成
  - 実行
  - `finally`で常にカーネルをシャットダウン

## リセット動作

`python`ツールは複数セル呼び出しの最初のセルに対してのみ`reset`を渡します。後続のセルは常に`reset: false`で実行されます。

## カーネルの死亡 / 再起動 / リトライ

セッションモード（`withKernelSession`）では：

- 死んだカーネルはハートビート（5秒ごとの`kernel.isAlive()`チェック）または実行失敗によって検出されます。
- 実行前の死亡状態は`restartKernelSession`をトリガーします。
- 実行時のクラッシュパスは1回リトライします：カーネルを再起動し、ハンドラーを再実行します。
- 同一セッションで`restartCount > 1`の場合、`Python kernel restarted too many times in this session`をスローします。

起動リトライ動作：

- 共有ゲートウェイのカーネル作成はHTTP 5xxの`SharedGatewayCreateError`で1回リトライします。

リソース枯渇からの回復：

- `EMFILE`/`ENFILE`/"Too many open files"スタイルの失敗を検出
- 追跡されたセッションをクリア
- `shutdownSharedGateway()`を呼び出し
- カーネルセッション作成を1回リトライ

## 4) 環境/セッション変数の注入

カーネル起動時にエグゼキューターからオプションのenvマップを受け取ります：

- `PI_SESSION_FILE`（セッション状態ファイルパス）
- `ARTIFACTS`（アーティファクトディレクトリ）

`PythonKernel.#initializeKernelEnvironment(...)`は次にカーネル内で初期化スクリプトを実行します：

- `os.chdir(cwd)`
- `os.environ`にenv エントリを注入
- cwdが存在しない場合は`sys.path`の先頭に追加

含意：

- セッションやアーティファクトコンテキストを読み取るプレリュードヘルパーは、Pythonプロセス状態のこれらの環境変数に依存しています。

## 5) ストリーミング/チャンクと表示の処理（カーネルベースパス）

カーネルクライアントは実行ごとにJupyterプロトコルメッセージを処理します：

- `stream` -> テキストチャンクを`onChunk`へ
- `execute_result` / `display_data` ->
  - 表示テキストはMIME優先順位で選択：`text/markdown` > `text/plain` > 変換された`text/html`
  - 構造化出力は別途キャプチャ：
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }`（テキスト出力なし）
- `error` -> トレースバックテキストをチャンクストリームにプッシュ + 構造化エラーメタデータ
- `input_request` -> stdin警告テキストを出力し、空の`input_reply`を送信し、stdin要求済みをマーク
- 完了は`execute_reply`とカーネルの`status=idle`の両方を待機

キャンセル/タイムアウト：

- アボートシグナルは`interrupt()`をトリガー（REST `/interrupt` + コントロールチャネル`interrupt_request`）
- 結果は`cancelled=true`をマーク
- タイムアウトパスは出力に`Command timed out after <n> seconds`を付加

## 6) 切り詰めとアーティファクト動作

`src/session/streaming-output.ts`の`OutputSink`はカーネル実行パス（`executeWithKernel`）で使用されます：

- 各チャンクをサニタイズ（`sanitizeText`）
- 合計/出力行数とバイト数を追跡
- オプションのアーティファクトスピルファイル（`artifactPath`、`artifactId`）
- メモリ内バッファがしきい値（オーバーライドされない限り`DEFAULT_MAX_BYTES`）を超えた場合：
  - 切り詰め済みをマーク
  - メモリ内に末尾バイトを保持（UTF-8安全境界）
  - フルストリームをアーティファクトシンクにスピル可能

`dump()`は以下を返します：

- 可視出力テキスト（末尾切り詰めの可能性あり）
- 切り詰めフラグ + カウント
- アーティファクトID（`artifact://<id>`参照用）

`python`ツールはこのメタデータを結果の切り詰め通知とTUI警告に変換します。

`notebook`ツールは`OutputSink`を**使用しません**。コードを実行しないため、ストリーム/アーティファクト切り詰めパイプラインがありません。

## 7) レンダラーの前提とフォーマット

## Notebookレンダラー（`notebookToolRenderer`）

- 呼び出しビュー：アクション + notebookパス + セル/タイプメタデータを含むステータス行
- 結果ビュー：
  - `details`から導出された成功サマリー
  - `cellSource`は`renderCodeCell`経由でレンダリング
  - マークダウンセルは言語ヒント`markdown`を設定；他のセルには明示的な言語オーバーライドなし
  - 折りたたみコードプレビューの制限は`PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 共有レンダーオプションによる展開モードをサポート
  - 幅 + 展開状態をキーとしたレンダーキャッシュを使用

エラーレンダリングの前提：

- 最初のテキストコンテンツが`Error:`で始まる場合、レンダラーはnotebookエラーブロックとしてフォーマットします。

## Pythonレンダラー（実際の実行出力用）

カーネルベースの実行レンダリングは以下を期待します：

- セルごとのステータス遷移（`pending/running/complete/error`）
- オプションの構造化ステータスイベントセクション
- オプションのJSON出力ツリー
- 切り詰め警告 + オプションの`artifact://<id>`ポインター

このレンダラー動作は、両方が共有TUIプリミティブを再利用することを除き、`notebook` JSON編集結果とは無関係です。

## 8) プレーンPythonツール動作との相違点

「プレーンPythonツール」が`python`実行パスを意味する場合：

- `python`はカーネル内でコードを実行し、モードによって状態を永続化し、チャンクをストリーミングし、リッチ表示をキャプチャし、割り込み/タイムアウトを処理し、出力の切り詰め/アーティファクトをサポートします。
- `notebook`は決定論的なnotebook JSONミューテーションのみを実行します。実行なし、カーネル状態なし、チャンクストリームなし、表示出力なし、アーティファクトパイプラインなし。

ワークフローで両方が必要な場合：

1. `notebook`でnotebookソースを編集
2. `notebook`を通じてではなく、`python`でコードセルを実行（手動でコードを渡す）

現在の実装では、`.ipynb`の変更とカーネルコンテキストを通じたnotebookセルの実行の両方を行う単一のツールは提供されていません。
