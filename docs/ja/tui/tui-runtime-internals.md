---
title: TUI ランタイムの内部構造
description: レンダリングパイプライン、入力処理、状態管理を含むターミナル UI ランタイムの内部構造。
sidebar:
  order: 2
  label: ランタイムの内部構造
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI ランタイムの内部構造

このドキュメントでは、インタラクティブモードにおけるターミナル入力からレンダリング出力までの、テーマ以外のランタイムパスをマッピングします。`packages/tui` での動作と、`packages/coding-agent` コントローラーからの統合に焦点を当てています。

## ランタイムレイヤーと所有権

- **`packages/tui` エンジン**: ターミナルライフサイクル、stdin の正規化、フォーカスルーティング、レンダースケジューリング、差分描画、オーバーレイ合成、ハードウェアカーソル配置。
- **`packages/coding-agent` インタラクティブモード**: コンポーネントツリーの構築、エディタコールバックとキーマップのバインド、エージェント/セッションイベントへの反応、ドメイン状態（ストリーミング、ツール実行、リトライ、プランモード）の UI コンポーネントへの変換。

境界ルール: TUI エンジンはメッセージに依存しません。`Component.render(width)`、`handleInput(data)`、フォーカス、オーバーレイのみを認識します。エージェントのセマンティクスはインタラクティブコントローラーに留まります。

## 実装ファイル

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## ブートとコンポーネントツリーの組み立て

`InteractiveMode` は `TUI(new ProcessTerminal(), showHardwareCursor)` を構築し、永続的なコンテナを作成します：

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer`（`CustomEditor` を保持）

`init()` はこの順序でツリーを配線し、エディタにフォーカスし、`InputController` を介して入力ハンドラを登録し、TUI を開始して、強制レンダリングを要求します。

強制レンダリング（`requestRender(true)`）は、再描画前に前回の行キャッシュとカーソルのブックキーピングをリセットします。

## ターミナルライフサイクルと stdin の正規化

`ProcessTerminal.start()`:

1. raw モードとブラケットペーストを有効化。
2. リサイズハンドラをアタッチ。
3. 部分的なエスケープチャンクを完全なシーケンスに分割する `StdinBuffer` を作成。
4. Kitty キーボードプロトコルのサポートを照会（`CSI ? u`）し、サポートされている場合はプロトコルフラグを有効化。
5. Windows では、`kernel32` モードフラグによる VT 入力の有効化を試行。

`StdinBuffer` の動作：

- 断片化されたエスケープシーケンス（CSI/OSC/DCS/APC/SS3）をバッファリング。
- シーケンスが完了するかタイムアウトでフラッシュされた場合にのみ `data` を発行。
- ブラケットペーストを検出し、生のペーストテキストを含む `paste` イベントを発行。

これにより、部分的なエスケープチャンクが通常のキー入力として誤解釈されることを防ぎます。

## 入力ルーティングとフォーカスモデル

入力パス：

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

ルーティングの詳細：

1. TUI は最初に登録済みの入力リスナー（`addInputListener`）を実行し、消費/変換動作を可能にします。
2. TUI はコンポーネントへのディスパッチ前にグローバルデバッグショートカット（`shift+ctrl+d`）を処理します。
3. フォーカスされたコンポーネントが非表示/不可視になったオーバーレイに属している場合、TUI は次の可視オーバーレイまたは保存されたオーバーレイ前のフォーカスにフォーカスを再割り当てします。
4. フォーカスされたコンポーネントが `wantsKeyRelease = true` を設定していない限り、キーリリースイベントはフィルタリングされます。
5. ディスパッチ後、TUI はレンダリングをスケジュールします。

`setFocus()` は `Focusable.focused` も切り替え、これによりコンポーネントがハードウェアカーソル配置のために `CURSOR_MARKER` を発行するかどうかが制御されます。

## キー処理の分離：エディタ vs コントローラー

`CustomEditor` は最初に高優先度のコンボ（escape、ctrl-c/d/z、ctrl-v、ctrl-p のバリアント、ctrl-t、alt-up、拡張カスタムキー）をインターセプトし、残りをベースの `Editor` 動作（テキスト編集、履歴、オートコンプリート、カーソル移動）に委譲します。

`InputController.setupKeyHandlers()` はその後、エディタコールバックをモードアクションにバインドします：

- `Escape` でのキャンセル / モード終了
- ダブル `Ctrl+C` またはエディタ空状態での `Ctrl+D` によるシャットダウン
- `Ctrl+Z` でのサスペンド/レジューム
- スラッシュコマンドとセレクターのホットキー
- フォローアップ/デキューの切り替えと展開の切り替え

これにより、キー解析/エディタメカニクスは `packages/tui` に、モードセマンティクスは coding-agent コントローラーに保持されます。

## レンダーループと差分戦略

`TUI.requestRender()` は `process.nextTick` を使用してティックごとに1回のレンダリングにデバウンスされます。同一ターン内の複数の状態変更は統合されます。

`#doRender()` パイプライン：

1. ルートコンポーネントツリーを `newLines` にレンダリング。
2. 可視オーバーレイ（存在する場合）を合成。
3. 可視ビューポート行から `CURSOR_MARKER` を抽出して除去。
4. 非画像行にセグメントリセットサフィックスを追加。
5. 完全再描画か差分パッチかを選択：
   - 最初のフレーム
   - 幅の変更
   - `clearOnShrink` が有効でオーバーレイがない場合の縮小
   - 前回のビューポート上方での編集
6. 差分更新の場合、変更された行範囲のみをパッチし、必要に応じて古い末尾行をクリア。
7. IME サポートのためにハードウェアカーソルを再配置。

レンダリング書き込みは同期出力モード（`CSI ? 2026 h/l`）を使用してフリッカー/ティアリングを低減します。

## レンダリングの安全性制約

`TUI` における重要な安全性チェック：

- 非画像のレンダリング行はターミナル幅を超えてはなりません。オーバーフローが発生すると例外がスローされ、クラッシュ診断が書き込まれます。
- オーバーレイ合成には防御的な切り詰めと合成後の幅検証が含まれます。
- 幅の変更は完全再描画を強制します。折り返しセマンティクスが変わるためです。
- カーソル位置は移動前にクランプされます。

これらの制約はランタイムの強制であり、単なる慣例ではありません。

## リサイズ処理

リサイズイベントは `ProcessTerminal` から `TUI.requestRender()` へのイベント駆動です。

効果：

- 幅の変更は完全再描画をトリガーします。
- ビューポート/トップトラッキング（`#previousViewportTop`、`#maxLinesRendered`）は、コンテンツやターミナルサイズが変更された際の無効な相対カーソル計算を回避します。
- オーバーレイの可視性はターミナルの寸法に依存する場合があります（`OverlayOptions.visible`）。リサイズ後にオーバーレイが非可視になった場合、フォーカスは修正されます。

## ストリーミングとインクリメンタル UI 更新

`EventController` は `AgentSessionEvent` をサブスクライブし、UI をインクリメンタルに更新します：

- `agent_start`: `statusContainer` でローダーを開始。
- `message_start` assistant: `streamingComponent` を作成してマウント。
- `message_update`: ストリーミング中のアシスタントコンテンツを更新。ツール呼び出しが現れるとツール実行コンポーネントを作成/更新。
- `tool_execution_update/end`: ツール結果コンポーネントと完了状態を更新。
- `message_end`: アシスタントストリームをファイナライズし、中断/エラーアノテーションを処理し、通常停止時に保留中のツール引数を完了としてマーク。
- `agent_end`: ローダーを停止し、一時的なストリーム状態をクリアし、遅延モデル切り替えをフラッシュし、バックグラウンド化されている場合は完了通知を発行。

読み取りツールのグループ化は意図的にステートフルです（`#lastReadGroup`）。連続する読み取りツール呼び出しは、非読み取りのブレークが発生するまで1つのビジュアルブロックに統合されます。

## ステータスとローダーのオーケストレーション

ステータスレーンの所有権：

- `statusContainer` は一時的なローダー（`loadingAnimation`、`autoCompactionLoader`、`retryLoader`）を保持。
- `statusLine` は永続的なステータス/フック/プランインジケーターをレンダリングし、エディタの上部ボーダー更新を駆動。

ローダーの動作：

- `Loader` はインターバルで 80ms ごとに更新し、各フレームでレンダリングを要求。
- 自動コンパクションと自動リトライ中は、エスケープハンドラが一時的にオーバーライドされ、それらの操作をキャンセルできるようになります。
- 終了/キャンセルパスでは、コントローラーは以前のエスケープハンドラを復元し、ローダーコンポーネントを停止/クリアします。

## モード遷移とバックグラウンド化

### Bash/Python 入力モード

入力テキストのプレフィックスによりエディタボーダーのモードフラグが切り替わります：

- `!` -> bash モード
- `$`（テンプレートリテラルプレフィックス以外）-> python モード

Escape は非アクティブモードを終了し、エディタテキストをクリアしてボーダーカラーを復元します。実行がアクティブな場合、escape は代わりに実行中のタスクを中断します。

### プランモード

`InteractiveMode` はプランモードフラグ、ステータスライン状態、アクティブなツール、モデル切り替えを追跡します。開始/終了はセッションモードエントリとステータス/UI 状態を更新し、ストリーミングがアクティブな場合は遅延モデル切り替えを含みます。

### サスペンド/レジューム（`Ctrl+Z`）

`InputController.handleCtrlZ()`:

1. TUI を再起動して強制レンダリングするワンショット `SIGCONT` ハンドラを登録。
2. サスペンド前に TUI を停止。
3. プロセスグループに `SIGTSTP` を送信。

### バックグラウンドモード（`/background` または `/bg`）

`handleBackgroundCommand()`:

- アイドル時は拒否。
- ツール UI コンテキストを非インタラクティブ（`hasUI=false`）に切り替え、インタラクティブ UI ツールがフェイルファストするようにします。
- ローダー/ステータスラインを停止し、フォアグラウンドイベントハンドラをアンサブスクライブ。
- バックグラウンドイベントハンドラをサブスクライブ（主に `agent_end` を待機）。
- TUI を停止し、`SIGTSTP` を送信（POSIX ジョブ制御パス）。

キュー待ちの作業がない状態でバックグラウンドで `agent_end` が発生すると、コントローラーは完了通知を送信してシャットダウンします。

## キャンセルパス

主要なキャンセル入力：

- アクティブなストリームローダー中の `Escape`: キュー待ちメッセージをエディタに復元し、エージェントを中断。
- bash/python 実行中の `Escape`: 実行中のコマンドを中断。
- 自動コンパクション/リトライ中の `Escape`: 一時的なエスケープハンドラを通じて専用の中断メソッドを呼び出し。
- `Ctrl+C` 単押し: エディタをクリア。500ms 以内のダブル押し: シャットダウン。

キャンセルは状態条件付きです。同じキーが、ランタイムの状態に応じて中断、モード終了、セレクタートリガー、または何もしないことを意味する場合があります。

## イベント駆動 vs スロットル動作

イベント駆動の更新：

- エージェントセッションイベント（`EventController`）
- キー入力コールバック（`InputController`）
- ターミナルリサイズコールバック
- `InteractiveMode` でのテーマ/ブランチウォッチャー

スロットル/デバウンスパス：

- TUI レンダリングはティックデバウンス（`requestRender` 統合）。
- ローダーアニメーションは固定インターバル（80ms）で、各フレームがレンダリングを要求。
- エディタのオートコンプリート更新（`Editor` 内部）はデバウンスタイマーを使用し、タイピング中の再計算チャーンを低減。

したがって、ランタイムはイベント駆動の状態遷移と制限付きレンダーケイデンスを混合し、再描画ストームなしにインタラクティビティの応答性を維持します。
