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
ツールの動作、カーネル/ゲートウェイのライフサイクル、環境処理、実行セマンティクス、出力レンダリング、および運用上の障害モードを扱います。

## スコープと主要ファイル

- ツールサーフェス: `src/tools/python.ts`
- セッション/呼び出しごとのカーネルオーケストレーション: `src/ipy/executor.ts`
- カーネルプロトコル + ゲートウェイ統合: `src/ipy/kernel.ts`
- 共有ローカルゲートウェイコーディネーター: `src/ipy/gateway-coordinator.ts`
- ユーザーがトリガーした Python 実行のインタラクティブモードレンダラー: `src/modes/components/python-execution.ts`
- ランタイム/環境フィルタリングと Python 解決: `src/ipy/runtime.ts`

## Python ツールとは

`python` ツールは、Jupyter Kernel Gateway をバックエンドとするカーネルを通じて、1 つ以上の Python セルを実行します（セルごとに `python -c` を直接スポーンするのではありません）。

ツールパラメータ:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // 秒、1..600 にクランプ、デフォルト 30
  cwd?: string;
  reset?: boolean; // 最初のセルの前にのみカーネルをリセット
}
```

このツールはセッションに対して `concurrency = "exclusive"` であるため、呼び出しが重複することはありません。

## ゲートウェイのライフサイクル

### モード

ゲートウェイには 2 つのパスがあります:

1. **外部ゲートウェイ** (`PI_PYTHON_GATEWAY_URL` が設定されている場合)
   - 設定された URL を直接使用します。
   - `PI_PYTHON_GATEWAY_TOKEN` によるオプションの認証。
   - ローカルゲートウェイプロセスはスポーンも管理もされません。

2. **ローカル共有ゲートウェイ** (デフォルトパス)
   - `~/.xcsh/agent/python-gateway` 配下で調整される単一の共有プロセスを使用します。
   - メタデータファイル: `gateway.json`
   - ロックファイル: `gateway.lock`
   - スポーンコマンド:
     - `python -m kernel_gateway`
     - `127.0.0.1:<割り当てポート>` にバインド
     - 起動ヘルスチェック: `GET /api/kernelspecs`

### ローカル共有ゲートウェイの調整

`acquireSharedGateway()`:

- ハートビート付きのファイルロック (`gateway.lock`) を取得します。
- PID が生存しておりヘルスチェックが通過する場合、`gateway.json` を再利用します。
- 必要に応じて古くなった情報/PID をクリーンアップします。
- 正常なゲートウェイが存在しない場合、新しいゲートウェイを起動します。

`releaseSharedGateway()` は現在 no-op です（カーネルシャットダウンは共有ゲートウェイを停止しません）。

`shutdownSharedGateway()` は共有プロセスを明示的に終了し、ゲートウェイメタデータをクリアします。

### 重要な制約

`python.sharedGateway=false` はカーネル起動時に拒否されます:

- エラー: `Shared Python gateway required; local gateways are disabled`
- プロセスごとの非共有ローカルゲートウェイモードは存在しません。

## カーネルのライフサイクル

各実行は、選択されたゲートウェイ上で `POST /api/kernels` を通じて作成されたカーネルを使用します。

カーネル起動シーケンス:

1. 可用性チェック (`checkPythonKernelAvailability`)
2. カーネル作成 (`/api/kernels`)
3. WebSocket オープン (`/api/kernels/:id/channels`)
4. カーネル環境の初期化 (`cwd`、環境変数、`sys.path`)
5. `PYTHON_PRELUDE` の実行
6. 以下から拡張モジュールをロード:
   - ユーザー: `~/.xcsh/agent/modules/*.py`
   - プロジェクト: `<cwd>/.xcsh/modules/*.py` (同名のユーザーモジュールをオーバーライド)

カーネルシャットダウン:

- `DELETE /api/kernels/:id` を通じてリモートカーネルを削除
- WebSocket をクローズ
- 共有ゲートウェイのリリースフックを呼び出し（現在は no-op）

## セッション永続化セマンティクス

`python.kernelMode` はカーネルの再利用を制御します:

- `session` (デフォルト)
  - セッション ID + cwd をキーとしてカーネルセッションを再利用します。
  - セッションごとにキューを通じて実行がシリアライズされます。
  - アイドルセッションは 5 分後にエビクトされます。
  - 最大 4 セッション。オーバーフロー時は最も古いものがエビクトされます。
  - ハートビートチェックでデッドカーネルを検出します。
  - 自動再起動は 1 回許可。繰り返しクラッシュすると完全な障害になります。

- `per-call`
  - 実行リクエストごとに新しいカーネルを作成します。
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
- 拒否リストは一般的な API キー（OpenAI/Anthropic/Gemini など）を除去します。

ランタイム選択順序:

1. アクティブ/検出された venv (`VIRTUAL_ENV`、次に `<cwd>/.venv`、`<cwd>/venv`)
2. `~/.xcsh/python-env` のマネージド venv
3. PATH 上の `python` または `python3`

venv が選択された場合、その bin/Scripts パスが `PATH` の先頭に追加されます。

Python 内部でのカーネル環境初期化も:

- `os.chdir(cwd)`
- 提供された env マップを `os.environ` に注入
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

Python プリフライトが失敗した場合、そのセッションではツール作成が bash-only にフォールバックします。

## 実行フローとキャンセル/タイムアウト

### ツールレベルのタイムアウト

`python` ツールのタイムアウトは秒単位で、デフォルト 30、`1..600` にクランプされます。

ツールは以下を組み合わせます:

- 呼び出し元のアボートシグナル
- タイムアウトのアボートシグナル

`AbortSignal.any(...)` を使用します。

### カーネル実行のキャンセル

アボート/タイムアウト時:

- 実行はキャンセル済みとしてマークされます。
- REST (`POST /interrupt`) およびコントロールチャネルの `interrupt_request` を通じてカーネル割り込みが試行されます。
- 結果に `cancelled=true` が含まれます。
- タイムアウトパスは出力に `Command timed out after <n> seconds` と注釈を付けます。

### stdin の動作

インタラクティブな stdin はサポートされていません。

カーネルが `input_request` を発行した場合:

- ツールは `stdinRequested=true` を記録
- 説明テキストを出力
- 空の `input_reply` を送信
- 実行はエグゼキューターレイヤーで失敗として扱われます

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

さらに構造化出力としてキャプチャ:

- `application/json` -> JSON ツリーデータ
- `image/png` -> 画像ペイロード
- `application/x-xcsh-status` -> ステータスイベント

### ストレージと切り詰め

出力は `OutputSink` を通じてストリーミングされ、アーティファクトストレージに永続化される場合があります。

ツール結果には切り詰めメタデータと、完全な出力復元のための `artifact://<id>` が含まれることがあります。

### レンダラーの動作

- ツールレンダラー (`python.ts`):
  - セルごとのステータス付きでコードセルブロックを表示
  - 折りたたみプレビューはデフォルト 10 行
  - 完全な出力とより詳細なステータスの展開モードをサポート
- インタラクティブレンダラー (`python-execution.ts`):
  - TUI でのユーザーがトリガーした Python 実行に使用
  - 折りたたみプレビューはデフォルト 20 行
  - 表示安全性のために非常に長い個別の行を 4000 文字にクランプ
  - キャンセル/エラー/切り詰め通知を表示

## 外部ゲートウェイサポート

設定:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# オプション:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ローカル共有ゲートウェイとの動作の違い:

- ローカルゲートウェイのロック/情報ファイルなし
- ローカルプロセスのスポーン/終了なし
- ヘルスチェックとカーネル CRUD は外部エンドポイントに対して実行
- 認証失敗は明示的なトークンガイダンスとともに表示

## 運用トラブルシューティング（現在の障害モード）

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
  - これは現在の実装で想定された動作です。

- **外部ゲートウェイの認証/到達性の失敗**
  - 401/403 -> `PI_PYTHON_GATEWAY_TOKEN` を設定してください。
  - タイムアウト/到達不能 -> URL/ネットワークとゲートウェイの正常性を確認してください。

- **実行がハングしてからタイムアウトする**
  - ワークロードが正当な場合、ツールの `timeout` を増やしてください（最大 600 秒）。
  - スタックしたコードの場合、キャンセルはカーネル割り込みをトリガーしますが、ユーザーコードのリファクタリングが必要な場合があります。

- **Python コードでの stdin/入力プロンプト**
  - `input()` はこのランタイムパスではインタラクティブにサポートされていません。データはプログラム的に渡してください。

- **リソース枯渇 (`EMFILE` / オープンファイル過多)**
  - セッションマネージャーが共有ゲートウェイの復旧をトリガーします（セッションの破棄 + 共有ゲートウェイの再起動）。

- **作業ディレクトリエラー**
  - ツールは実行前に `cwd` が存在しディレクトリであることを検証します。

## 関連する環境変数

- `PI_PY` — ツール公開のオーバーライド（上記の `bash-only`/`ipy-only`/`both` マッピング）
- `PI_PYTHON_GATEWAY_URL` — 外部ゲートウェイを使用
- `PI_PYTHON_GATEWAY_TOKEN` — オプションの外部ゲートウェイ認証トークン
- `PI_PYTHON_SKIP_CHECK=1` — Python プリフライト/ウォームチェックをバイパス
- `PI_PYTHON_IPC_TRACE=1` — カーネル IPC の送受信トレースをログ出力
- `PI_DEBUG_STARTUP=1` — 起動ステージのデバッグマーカーを出力
