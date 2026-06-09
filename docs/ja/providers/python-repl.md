---
title: Python ツールと IPython ランタイム
description: IPython カーネル管理、実行、出力キャプチャを備えた Python REPL ツールランタイム。
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python ツールと IPython ランタイム

このドキュメントでは、`packages/coding-agent` における現在の Python 実行スタックについて説明します。
ツールの動作、カーネル/ゲートウェイのライフサイクル、環境処理、実行セマンティクス、出力レンダリング、および運用上の障害モードを網羅しています。

## スコープと主要ファイル

- ツールサーフェス: `src/tools/python.ts`
- セッション/呼び出しごとのカーネルオーケストレーション: `src/ipy/executor.ts`
- カーネルプロトコル + ゲートウェイ統合: `src/ipy/kernel.ts`
- 共有ローカルゲートウェイコーディネーター: `src/ipy/gateway-coordinator.ts`
- ユーザートリガーの Python 実行用インタラクティブモードレンダラー: `src/modes/components/python-execution.ts`
- ランタイム/環境フィルタリングと Python 解決: `src/ipy/runtime.ts`

## Python ツールとは

`python` ツールは、Jupyter Kernel Gateway バックエンドのカーネルを介して 1 つ以上の Python セルを実行します（セルごとに `python -c` を直接起動するのではありません）。

ツールパラメータ:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // 秒単位、1..600 にクランプ、デフォルト 30
  cwd?: string;
  reset?: boolean; // 最初のセルの実行前にのみカーネルをリセット
}
```

このツールはセッションに対して `concurrency = "exclusive"` であるため、呼び出しが重複することはありません。

## ゲートウェイのライフサイクル

### モード

ゲートウェイには 2 つのパスがあります:

1. **外部ゲートウェイ** (`PI_PYTHON_GATEWAY_URL` が設定されている場合)
   - 設定された URL を直接使用します。
   - `PI_PYTHON_GATEWAY_TOKEN` によるオプションの認証。
   - ローカルゲートウェイプロセスの起動や管理は行われません。

2. **ローカル共有ゲートウェイ** (デフォルトパス)
   - `~/.xcsh/agent/python-gateway` 配下で調整された単一の共有プロセスを使用します。
   - メタデータファイル: `gateway.json`
   - ロックファイル: `gateway.lock`
   - 起動コマンド:
     - `python -m kernel_gateway`
     - `127.0.0.1:<割り当てポート>` にバインド
     - 起動ヘルスチェック: `GET /api/kernelspecs`

### ローカル共有ゲートウェイの調整

`acquireSharedGateway()`:

- ハートビート付きのファイルロック (`gateway.lock`) を取得します。
- PID が生存しておりヘルスチェックが通れば `gateway.json` を再利用します。
- 必要に応じて古い情報/PID をクリーンアップします。
- 正常なゲートウェイが存在しない場合は新しいゲートウェイを起動します。

`releaseSharedGateway()` は現在 no-op です（カーネルのシャットダウンでは共有ゲートウェイは停止されません）。

`shutdownSharedGateway()` は共有プロセスを明示的に終了し、ゲートウェイのメタデータをクリアします。

### 重要な制約

`python.sharedGateway=false` はカーネル起動時に拒否されます:

- エラー: `Shared Python gateway required; local gateways are disabled`
- プロセスごとの非共有ローカルゲートウェイモードは存在しません。

## カーネルのライフサイクル

各実行は、選択されたゲートウェイ上で `POST /api/kernels` によって作成されたカーネルを使用します。

カーネル起動シーケンス:

1. 可用性チェック (`checkPythonKernelAvailability`)
2. カーネル作成 (`/api/kernels`)
3. WebSocket 接続 (`/api/kernels/:id/channels`)
4. カーネル環境の初期化 (`cwd`、環境変数、`sys.path`)
5. `PYTHON_PRELUDE` の実行
6. 拡張モジュールのロード:
   - ユーザー: `~/.xcsh/agent/modules/*.py`
   - プロジェクト: `<cwd>/.xcsh/modules/*.py` (同名のユーザーモジュールをオーバーライド)

カーネルのシャットダウン:

- `DELETE /api/kernels/:id` によりリモートカーネルを削除
- WebSocket を閉じる
- 共有ゲートウェイのリリースフックを呼び出す (現在は no-op)

## セッション永続化セマンティクス

`python.kernelMode` がカーネルの再利用を制御します:

- `session` (デフォルト)
  - セッション ID + cwd をキーとしてカーネルセッションを再利用します。
  - セッションごとにキューを介して実行がシリアライズされます。
  - アイドルセッションは 5 分後にエビクトされます。
  - 最大 4 セッション。オーバーフロー時は最も古いものがエビクトされます。
  - ハートビートチェックでカーネルの死活を検出します。
  - 自動再起動は 1 回許可。繰り返しクラッシュすると致命的エラーになります。

- `per-call`
  - 各実行リクエストごとに新しいカーネルを作成します。
  - リクエスト後にカーネルをシャットダウンします。
  - 呼び出し間の状態永続化はありません。

### 単一ツール呼び出し内のマルチセル動作

セルはそのツール呼び出しの同一カーネルインスタンス内で順次実行されます。

中間セルが失敗した場合:

- それ以前のセルの状態はメモリに残ります。
- ツールはどのセルが失敗したかを示すターゲットエラーを返します。
- 後続のセルは実行されません。

`reset=true` はその呼び出しの最初のセル実行にのみ適用されます。

## 環境フィルタリングとランタイム解決

ゲートウェイ/カーネルランタイムの起動前に環境がフィルタリングされます:

- 許可リストには `PATH`、`HOME`、ロケール変数、`VIRTUAL_ENV`、`PYTHONPATH` などのコア変数が含まれます。
- 許可プレフィックス: `LC_`、`XDG_`、`PI_`
- 拒否リストは一般的な API キー (OpenAI/Anthropic/Gemini など) を除去します。

ランタイム選択順序:

1. アクティブ/検出された venv (`VIRTUAL_ENV`、次に `<cwd>/.venv`、`<cwd>/venv`)
2. `~/.xcsh/python-env` のマネージド venv
3. PATH 上の `python` または `python3`

venv が選択された場合、その bin/Scripts パスが `PATH` の先頭に追加されます。

Python 内部でのカーネル環境初期化も行われます:

- `os.chdir(cwd)`
- 提供された環境マップを `os.environ` に注入
- cwd が `sys.path` に含まれることを保証

## ツールの可用性とモード選択

`python.toolMode` (デフォルト `both`) + オプションの `PI_PY` オーバーライドが公開を制御します:

- `ipy-only`
- `bash-only`
- `both`

`PI_PY` の受け入れ値:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Python のプリフライトチェックが失敗した場合、そのセッションではツール作成が bash-only にフォールバックします。

## 実行フローとキャンセル/タイムアウト

### ツールレベルのタイムアウト

`python` ツールのタイムアウトは秒単位で、デフォルト 30、`1..600` にクランプされます。

ツールは以下を組み合わせます:

- 呼び出し元のアボートシグナル
- タイムアウトアボートシグナル

`AbortSignal.any(...)` を使用します。

### カーネル実行のキャンセル

アボート/タイムアウト時:

- 実行がキャンセル済みとしてマークされます。
- REST (`POST /interrupt`) とコントロールチャネルの `interrupt_request` を介してカーネルの中断が試みられます。
- 結果に `cancelled=true` が含まれます。
- タイムアウトパスでは出力に `Command timed out after <n> seconds` と注釈が付きます。

### stdin の動作

インタラクティブな stdin はサポートされていません。

カーネルが `input_request` を発行した場合:

- ツールは `stdinRequested=true` を記録
- 説明テキストを出力
- 空の `input_reply` を送信
- executor レイヤーで実行が失敗として扱われる

## 出力キャプチャとレンダリング

### キャプチャされる出力クラス

カーネルメッセージから:

- `stream` -> プレーンテキストチャンク
- `display_data`/`execute_result` -> リッチ表示処理
- `error` -> トレースバックテキスト
- カスタム MIME `application/x-xcsh-status` -> 構造化ステータスイベント

表示 MIME の優先順位:

1. `text/markdown`
2. `text/plain`
3. `text/html` (基本的な markdown に変換)

さらに構造化出力としてキャプチャされるもの:

- `application/json` -> JSON ツリーデータ
- `image/png` -> 画像ペイロード
- `application/x-xcsh-status` -> ステータスイベント

### ストレージと切り詰め

出力は `OutputSink` を通じてストリーミングされ、アーティファクトストレージに永続化される場合があります。

ツールの結果には切り詰めメタデータと、完全な出力を復元するための `artifact://<id>` が含まれることがあります。

### レンダラーの動作

- ツールレンダラー (`python.ts`):
  - セルごとのステータス付きコードセルブロックを表示
  - 折りたたみプレビューはデフォルトで 10 行
  - 展開モードでは完全な出力とより詳細なステータスをサポート
- インタラクティブレンダラー (`python-execution.ts`):
  - TUI でのユーザートリガーの Python 実行に使用
  - 折りたたみプレビューはデフォルトで 20 行
  - 表示の安全性のため、非常に長い個別行を 4000 文字にクランプ
  - キャンセル/エラー/切り詰め通知を表示

## 外部ゲートウェイサポート

設定:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# オプション:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ローカル共有ゲートウェイとの動作の違い:

- ローカルのゲートウェイロック/情報ファイルなし
- ローカルプロセスの起動/終了なし
- ヘルスチェックとカーネル CRUD は外部エンドポイントに対して実行
- 認証エラーは明示的なトークンガイダンスとともに表示

## 運用トラブルシューティング (現在の障害モード)

- **Python ツールが利用できない**
  - `python.toolMode` / `PI_PY` を確認してください。
  - プリフライトが失敗した場合、ランタイムは bash-only にフォールバックします。

- **カーネル可用性エラー**
  - ローカルモードでは、解決された Python ランタイムで `kernel_gateway` と `ipykernel` の両方がインポート可能である必要があります。
  - 以下でインストール:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` が起動失敗を引き起こす**
  - これは現在の実装では想定された動作です。

- **外部ゲートウェイの認証/到達性の失敗**
  - 401/403 -> `PI_PYTHON_GATEWAY_TOKEN` を設定してください。
  - タイムアウト/到達不能 -> URL/ネットワークとゲートウェイの正常性を確認してください。

- **実行がハングしてタイムアウトする**
  - ワークロードが正当な場合はツールの `timeout` を増やしてください (最大 600 秒)。
  - スタックしたコードの場合、キャンセルはカーネルの中断をトリガーしますが、ユーザーコードのリファクタリングが必要な場合もあります。

- **Python コードでの stdin/入力プロンプト**
  - `input()` はこのランタイムパスではインタラクティブにサポートされていません。データはプログラム的に渡してください。

- **リソース枯渇 (`EMFILE` / オープンファイル数が多すぎる)**
  - セッションマネージャーが共有ゲートウェイの復旧をトリガーします (セッション破棄 + 共有ゲートウェイの再起動)。

- **作業ディレクトリエラー**
  - ツールは実行前に `cwd` が存在しディレクトリであることを検証します。

## 関連する環境変数

- `PI_PY` — ツール公開のオーバーライド (上記の `bash-only`/`ipy-only`/`both` マッピング)
- `PI_PYTHON_GATEWAY_URL` — 外部ゲートウェイを使用
- `PI_PYTHON_GATEWAY_TOKEN` — オプションの外部ゲートウェイ認証トークン
- `PI_PYTHON_SKIP_CHECK=1` — Python のプリフライト/ウォームチェックをバイパス
- `PI_PYTHON_IPC_TRACE=1` — カーネル IPC 送受信トレースをログ出力
- `PI_DEBUG_STARTUP=1` — 起動ステージのデバッグマーカーを出力
