---
title: Python ツールと IPython ランタイム
description: IPython カーネル管理、実行、および出力キャプチャを備えた Python REPL ツールランタイム。
sidebar:
  order: 3
  label: Python と IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python ツールと IPython ランタイム

このドキュメントでは、`packages/coding-agent` における現在の Python 実行スタックについて説明します。
ツールの動作、カーネル/ゲートウェイのライフサイクル、環境処理、実行セマンティクス、出力レンダリング、および運用上の障害モードを扱います。

## スコープと主要ファイル

- ツールサーフェス: `src/tools/python.ts`
- セッション/呼び出しごとのカーネルオーケストレーション: `src/ipy/executor.ts`
- カーネルプロトコル + ゲートウェイ統合: `src/ipy/kernel.ts`
- 共有ローカルゲートウェイコーディネーター: `src/ipy/gateway-coordinator.ts`
- ユーザー起動の Python 実行向けインタラクティブモードレンダラー: `src/modes/components/python-execution.ts`
- ランタイム/環境フィルタリングおよび Python 解決: `src/ipy/runtime.ts`

## Python ツールとは

`python` ツールは、1 つ以上の Python セルを Jupyter Kernel Gateway バックエンドのカーネル経由で実行します（セルごとに `python -c` を直接スポーンするわけではありません）。

ツールパラメーター:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // 秒単位、1..600 にクランプ、デフォルト 30
  cwd?: string;
  reset?: boolean; // 最初のセルのみカーネルをリセット
}
```

ツールはセッションに対して `concurrency = "exclusive"` であるため、呼び出しは重複しません。

## ゲートウェイのライフサイクル

### モード

ゲートウェイのパスは 2 つあります:

1. **外部ゲートウェイ** (`PI_PYTHON_GATEWAY_URL` が設定されている場合)
   - 設定された URL を直接使用します。
   - `PI_PYTHON_GATEWAY_TOKEN` によるオプション認証。
   - ローカルゲートウェイプロセスはスポーンまたは管理されません。

2. **ローカル共有ゲートウェイ** (デフォルトパス)
   - `~/.xcsh/agent/python-gateway` 配下でコーディネートされる単一の共有プロセスを使用します。
   - メタデータファイル: `gateway.json`
   - ロックファイル: `gateway.lock`
   - スポーンコマンド:
     - `python -m kernel_gateway`
     - `127.0.0.1:<allocated-port>` にバインド
     - 起動ヘルスチェック: `GET /api/kernelspecs`

### ローカル共有ゲートウェイの調整

`acquireSharedGateway()`:

- ハートビート付きのファイルロック (`gateway.lock`) を取得します。
- PID が生存しておりヘルスチェックが通過する場合は `gateway.json` を再利用します。
- 必要に応じて古い情報/PID をクリーンアップします。
- 正常なゲートウェイが存在しない場合は新しいゲートウェイを起動します。

`releaseSharedGateway()` は現在 no-op です（カーネルのシャットダウンは共有ゲートウェイを停止しません）。

`shutdownSharedGateway()` は共有プロセスを明示的に終了し、ゲートウェイメタデータをクリアします。

### 重要な制約

`python.sharedGateway=false` はカーネル起動時に拒否されます:

- エラー: `Shared Python gateway required; local gateways are disabled`
- プロセスごとの非共有ローカルゲートウェイモードは存在しません。

## カーネルのライフサイクル

各実行は、選択したゲートウェイで `POST /api/kernels` を介して作成されたカーネルを使用します。

カーネル起動シーケンス:

1. 可用性チェック (`checkPythonKernelAvailability`)
2. カーネル作成 (`/api/kernels`)
3. WebSocket のオープン (`/api/kernels/:id/channels`)
4. カーネル環境の初期化 (`cwd`、環境変数、`sys.path`)
5. `PYTHON_PRELUDE` の実行
6. 以下からの拡張モジュールの読み込み:
   - ユーザー: `~/.xcsh/agent/modules/*.py`
   - プロジェクト: `<cwd>/.xcsh/modules/*.py` (同名のユーザーモジュールを上書き)

カーネルのシャットダウン:

- `DELETE /api/kernels/:id` でリモートカーネルを削除
- WebSocket を閉じる
- 共有ゲートウェイのリリースフックを呼び出す (現在は no-op)

## セッション永続化のセマンティクス

`python.kernelMode` はカーネルの再利用を制御します:

- `session` (デフォルト)
  - セッション ID と cwd をキーとしてカーネルセッションを再利用します。
  - 実行はキューを介してセッションごとに直列化されます。
  - アイドルセッションは 5 分後に削除されます。
  - 最大 4 セッション。オーバーフロー時は最も古いものが削除されます。
  - ハートビートチェックにより死んだカーネルを検出します。
  - 自動再起動は 1 回許可されます。繰り返しクラッシュするとハード障害になります。

- `per-call`
  - 各実行リクエストに対して新しいカーネルを作成します。
  - リクエスト後にカーネルをシャットダウンします。
  - 呼び出し間の状態の永続化はありません。

### 単一ツール呼び出しにおけるマルチセルの動作

セルは、そのツール呼び出しの同一カーネルインスタンス内で順次実行されます。

中間セルが失敗した場合:

- 以前のセルの状態はメモリに残ります。
- ツールはどのセルが失敗したかを示す対象を絞ったエラーを返します。
- 後続のセルは実行されません。

`reset=true` はその呼び出しの最初のセル実行にのみ適用されます。

## 環境フィルタリングとランタイム解決

ゲートウェイ/カーネルランタイムを起動する前に環境がフィルタリングされます:

- 許可リストには `PATH`、`HOME`、ロケール変数、`VIRTUAL_ENV`、`PYTHONPATH` などのコア変数が含まれます。
- 許可プレフィックス: `LC_`、`XDG_`、`PI_`
- 拒否リストは一般的な API キー (OpenAI/Anthropic/Gemini など) を除外します。

ランタイム選択順序:

1. アクティブ/検出済み venv (`VIRTUAL_ENV`、次に `<cwd>/.venv`、`<cwd>/venv`)
2. `~/.xcsh/python-env` の管理済み venv
3. PATH 上の `python` または `python3`

venv が選択された場合、その bin/Scripts パスが `PATH` の先頭に追加されます。

Python 内部でのカーネル環境初期化も以下を行います:

- `os.chdir(cwd)`
- 提供された環境マップを `os.environ` に注入
- cwd が `sys.path` に含まれることを確認

## ツールの可用性とモード選択

`python.toolMode` (デフォルト `both`) + オプションの `PI_PY` オーバーライドで公開を制御します:

- `ipy-only`
- `bash-only`
- `both`

`PI_PY` の受け付ける値:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Python プリフライトが失敗した場合、そのセッションはツール作成が bash-only にデグレードします。

## 実行フローとキャンセル/タイムアウト

### ツールレベルのタイムアウト

`python` ツールのタイムアウトは秒単位で、デフォルトは 30、`1..600` にクランプされます。

ツールは以下を組み合わせます:

- 呼び出し元の中断シグナル
- タイムアウト中断シグナル

`AbortSignal.any(...)` で結合されます。

### カーネル実行のキャンセル

中断/タイムアウト時:

- 実行はキャンセル済みとしてマークされます。
- REST (`POST /interrupt`) およびコントロールチャンネルの `interrupt_request` を介してカーネル割り込みが試みられます。
- 結果には `cancelled=true` が含まれます。
- タイムアウトパスは出力に `Command timed out after <n> seconds` と注釈を付けます。

### stdin の動作

インタラクティブな stdin はサポートされていません。

カーネルが `input_request` を発行した場合:

- ツールは `stdinRequested=true` を記録します。
- 説明テキストを出力します。
- 空の `input_reply` を送信します。
- 実行はエグゼキュータ層で失敗として扱われます。

## 出力キャプチャとレンダリング

### キャプチャされる出力クラス

カーネルメッセージから:

- `stream` -> プレーンテキストチャンク
- `display_data`/`execute_result` -> リッチディスプレイ処理
- `error` -> トレースバックテキスト
- カスタム MIME `application/x-xcsh-status` -> 構造化ステータスイベント

ディスプレイ MIME の優先順位:

1. `text/markdown`
2. `text/plain`
3. `text/html` (基本的な Markdown に変換)

構造化出力として追加キャプチャ:

- `application/json` -> JSON ツリーデータ
- `image/png` -> 画像ペイロード
- `application/x-xcsh-status` -> ステータスイベント

### ストレージとトランケーション

出力は `OutputSink` を通じてストリーミングされ、アーティファクトストレージに永続化される場合があります。

ツールの結果にはトランケーションメタデータと、完全な出力復元のための `artifact://<id>` が含まれる場合があります。

### レンダラーの動作

- ツールレンダラー (`python.ts`):
  - セルごとのステータスを持つコードセルブロックを表示
  - 折りたたみプレビューのデフォルトは 10 行
  - 完全な出力とより詳細なステータス詳細のための展開モードをサポート
- インタラクティブレンダラー (`python-execution.ts`):
  - TUI でのユーザー起動の Python 実行に使用
  - 折りたたみプレビューのデフォルトは 20 行
  - 表示の安全のために非常に長い個々の行を 4000 文字にクランプ
  - キャンセル/エラー/トランケーション通知を表示

## 外部ゲートウェイのサポート

以下を設定します:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# オプション:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ローカル共有ゲートウェイとの動作の違い:

- ローカルゲートウェイのロック/情報ファイルなし
- ローカルプロセスのスポーン/終了なし
- ヘルスチェックとカーネルの CRUD は外部エンドポイントに対して実行
- 認証エラーは明示的なトークンガイダンスとともに表示

## 運用上のトラブルシューティング (現在の障害モード)

- **Python ツールが利用できない**
  - `python.toolMode` / `PI_PY` を確認してください。
  - プリフライトが失敗した場合、ランタイムは bash-only にフォールバックします。

- **カーネル可用性エラー**
  - ローカルモードでは、解決された Python ランタイムで `kernel_gateway` と `ipykernel` の両方がインポート可能である必要があります。
  - 以下でインストールします:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` による起動失敗**
  - 現在の実装では想定された動作です。

- **外部ゲートウェイの認証/到達可能性エラー**
  - 401/403 -> `PI_PYTHON_GATEWAY_TOKEN` を設定してください。
  - タイムアウト/到達不能 -> URL/ネットワークとゲートウェイの健全性を確認してください。

- **実行がハングしてタイムアウトになる**
  - ワークロードが正当な場合はツールの `timeout` を増やします (最大 600 秒)。
  - スタックしたコードの場合、キャンセルによりカーネル割り込みがトリガーされますが、ユーザーコードのリファクタリングが必要な場合もあります。

- **Python コードの stdin/input プロンプト**
  - `input()` はこのランタイムパスではインタラクティブにサポートされていません。データはプログラム的に渡してください。

- **リソース枯渇 (`EMFILE` / オープンファイルが多すぎる)**
  - セッションマネージャーは共有ゲートウェイの回復をトリガーします (セッションの解体 + 共有ゲートウェイの再起動)。

- **作業ディレクトリエラー**
  - ツールは実行前に `cwd` が存在し、ディレクトリであることを検証します。

## 関連する環境変数

- `PI_PY` — ツール公開オーバーライド (上記の `bash-only`/`ipy-only`/`both` マッピング)
- `PI_PYTHON_GATEWAY_URL` — 外部ゲートウェイを使用
- `PI_PYTHON_GATEWAY_TOKEN` — オプションの外部ゲートウェイ認証トークン
- `PI_PYTHON_SKIP_CHECK=1` — Python プリフライト/ウォームチェックをバイパス
- `PI_PYTHON_IPC_TRACE=1` — カーネル IPC の送受信トレースをログ記録
- `PI_DEBUG_STARTUP=1` — 起動ステージのデバッグマーカーを出力
