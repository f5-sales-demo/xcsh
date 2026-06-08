---
title: MCPプロトコルとトランスポートの内部構造
description: >-
  MCP protocol implementation with stdio, SSE, and streamable HTTP transport
  layers.
sidebar:
  order: 2
  label: プロトコルとトランスポート
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# MCPプロトコルとトランスポートの内部構造

このドキュメントでは、coding-agentがMCP JSON-RPCメッセージングをどのように実装しているか、およびプロトコルの関心事とトランスポートの関心事がどのように分離されているかについて説明します。

## スコープ

対象範囲：

- JSON-RPCリクエスト/レスポンスと通知フロー
- stdioおよびHTTP/SSEトランスポートにおけるリクエストの相関とライフサイクル
- タイムアウトとキャンセルの動作
- エラー伝播と不正なペイロードの処理
- トランスポート選択の境界（`stdio` vs `http`/`sse`）
- 再接続/リトライの責務がトランスポートレベルかマネージャーレベルか

エクステンション作成のUXやコマンドUIは対象外です。

## 実装ファイル

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## レイヤーの境界

### プロトコルレイヤー（JSON-RPC + MCPメソッド）

- メッセージの形状は`types.ts`で定義されています（`JsonRpcRequest`、`JsonRpcNotification`、`JsonRpcResponse`、`JsonRpcMessage`）。
- MCPクライアントロジック（`client.ts`）がメソッドの順序とセッションハンドシェイクを決定します：
  1. `initialize` リクエスト
  2. `notifications/initialized` 通知
  3. `tools/list`、`tools/call` などのメソッド呼び出し

### トランスポートレイヤー（`MCPTransport`）

`MCPTransport`はデータの配送とライフサイクルを抽象化します：

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- オプションのコールバック：`onClose`、`onError`、`onNotification`

トランスポート実装はフレーミングとI/Oの詳細を管理します：

- `StdioTransport`：サブプロセスのstdioを介した改行区切りJSON
- `HttpTransport`：HTTP POSTを介したJSON-RPC、オプションのSSEレスポンス/リスニング付き

### 現在の重要な注意点

トランスポートコールバック（`onClose`、`onError`、`onNotification`）は実装されていますが、現在の`MCPClient`/`MCPManager`フローではこれらのコールバックに再接続ロジックを接続していません。通知は呼び出し元がハンドラーを登録した場合にのみ消費されます。

## トランスポート選択

`client.ts:createTransport()`が設定からトランスポートを選択します：

- `type`省略または`"stdio"` -> `createStdioTransport`
- `"http"`または`"sse"` -> `createHttpTransport`

`"sse"`はHTTPトランスポートのバリアント（同じクラス）として扱われ、別のトランスポート実装ではありません。

## JSON-RPCメッセージフローと相関

## リクエストID

各トランスポートはリクエストごとにIDを生成します（`Math.random` + タイムスタンプ文字列）。IDはトランスポートローカルな相関トークンです。

## Stdioの相関パス

- 送信リクエストは1つのJSONオブジェクト + `\n`としてシリアライズされます。
- `#pendingRequests: Map<id, {resolve,reject}>`が処理中のリクエストを保持します。
- 読み取りループがstdoutからJSONLをパースし、`#handleMessage`を呼び出します。
- 受信メッセージに一致する`id`がある場合、リクエストはresolve/rejectされます。
- 受信メッセージに`method`があり`id`がない場合、通知として扱われ`onNotification`に送られます。

不明なIDは無視されます（rejectなし、エラーコールバックなし）。

## HTTPの相関パス

- 送信リクエストは生成された`id`を持つJSONボディのHTTP `POST`です。
- 非SSEレスポンスパス：1つのJSON-RPCレスポンスをパースし、`result`を返すか`error`でスローします。
- SSEレスポンスパス（`Content-Type: text/event-stream`）：イベントをストリーミングし、期待するリクエストIDに一致し`result`または`error`を持つ最初のメッセージを返します。
- `method`があり`id`がないSSEメッセージは通知として扱われます。

一致するレスポンスの前にSSEストリームが終了した場合、リクエストは`No response received for request ID ...`で失敗します。

## 通知

クライアントは`transport.notify(...)`を介してJSON-RPC通知を送信します。

- Stdio：通知フレーム（`jsonrpc`、`method`、オプションの`params`）+ 改行をstdinに書き込みます。
- HTTP：`id`なしのPOSTボディを送信します。成功は`2xx`または`202 Accepted`を受け入れます。

サーバー起点の通知はトランスポートの`onNotification`を通じてのみ表面化されます。マネージャー/クライアントにはデフォルトのグローバルサブスクライバーはありません。

## Stdioトランスポートの内部構造

## ライフサイクルと状態遷移

- 初期状態：`connected=false`、`process=null`、pendingマップは空
- `connect()`：
  - 設定されたcommand/args/env/cwdでサブプロセスを生成
  - connectedにマーク
  - stdoutの読み取りループ（`readJsonl`）を開始
  - stderrループを開始（読み取り/破棄、現在はサイレント）
- `close()`：
  - disconnectedにマーク
  - すべてのペンディングリクエストをreject（`Transport closed`）
  - サブプロセスをkill
  - 読み取りループのシャットダウンを待機
  - `onClose`を発行

読み取りループが予期せず終了した場合、`finally`が`#handleClose()`をトリガーし、同じペンディングリクエストのrejectとcloseコールバックを実行します。

## タイムアウトとキャンセル

リクエストごと：

- タイムアウトのデフォルトは`config.timeout ?? 30000`
- 呼び出し元からのオプションの`AbortSignal`
- abortとtimeoutの両方がペンディングプロミスをrejectし、マップエントリをクリーンアップ

キャンセルはローカルのみです：トランスポートはサーバーにプロトコルレベルのキャンセル通知を送信しません。

## 不正なペイロードの処理

読み取りループ内：

- パースされた各JSONL行は`try/catch`内で`#handleMessage`に渡されます
- 不正/無効なメッセージ処理の例外は破棄されます（`Skip malformed lines`コメント）
- ループは継続するため、1つの不正なメッセージでコネクションが停止することはありません

基盤のストリームパーサーがスローした場合、（まだ接続中であれば）`onError`が呼び出され、その後コネクションが閉じられます。

## 切断/障害時の動作

プロセスが終了またはストリームが閉じた場合：

- すべての処理中リクエストが`Transport closed`でrejectされます
- 自動的な再起動や再接続はありません
- 上位レイヤーが新しいトランスポートを作成して再接続する必要があります

## バックプレッシャー/ストリーミングに関する注意

- 送信書き込みは`stdin.write()` + `flush()`を使用し、ドレインセマンティクスを待機しません。
- トランスポート内に明示的なキューやハイウォーターマーク管理はありません。
- 受信処理はストリーム駆動（`readJsonl`を介した`for await`）で、パースされたメッセージを1つずつ処理します。

## HTTP/SSEトランスポートの内部構造

## ライフサイクルと接続セマンティクス

HTTPトランスポートは論理的な接続状態を持ちますが、リクエストパスはHTTP呼び出しごとにステートレスです：

- `connect()`は`connected=true`を設定します（ソケット/セッションのハンドシェイクなし）
- `Mcp-Session-Id`ヘッダーによるオプションのサーバーセッション追跡
- `close()`はオプションで`Mcp-Session-Id`付きの`DELETE`を送信し、SSEリスナーを中止し、`onClose`を発行します

したがって、`connected`は「トランスポートが使用可能」という意味であり、「永続的なストリームが確立されている」という意味ではありません。

## セッションヘッダーの動作

- POSTレスポンスで`Mcp-Session-Id`ヘッダーが存在する場合、トランスポートはそれを保存します。
- 後続のリクエスト/通知には`Mcp-Session-Id`が含まれます。
- `close()`はHTTP DELETEでサーバーセッションの終了を試みます。終了の失敗は無視されます。

## タイムアウトとキャンセル

`request()`と`notify()`の両方について：

- タイムアウトは`AbortController`を使用します（`config.timeout ?? 30000`）
- 外部シグナルが提供された場合、`AbortSignal.any([...])`でマージされます
- AbortErrorの処理は、呼び出し元のabortとタイムアウトを区別します

スローされるエラー：

- タイムアウト：`Request timeout after ...ms`（または`SSE response timeout ...`、`Notify timeout ...`）
- 呼び出し元のabort：外部シグナルが既にabortされている場合、元のAbortErrorが再スローされます

## HTTPエラー伝播

非OKレスポンスの場合：

- レスポンステキストがスローされるエラーに含まれます（`HTTP <status>: <text>`）
- 存在する場合、`WWW-Authenticate`と`Mcp-Auth-Server`からの認証ヒントが追加されます

JSON-RPCエラーオブジェクトの場合：

- `MCP error <code>: <message>`をスローします

不正なJSONボディ（`response.json()`の失敗）はパース例外として伝播されます。

## SSEの動作とモード

2つのSSEパスが存在します：

1. **リクエストごとのSSEレスポンス**（`#parseSSEResponse`）
   - POSTレスポンスのContent-Typeが`text/event-stream`の場合に使用
   - 一致するレスポンスIDが見つかるまでストリームを消費
   - 同じストリーム内でインターリーブされた通知を処理可能

2. **バックグラウンドSSEリスナー**（`startSSEListener()`）
   - サーバー起点の通知用のオプションのGETリスナー
   - 現在MCPマネージャー/クライアントによって自動的には開始されません
   - GETが`405`を返した場合、リスナーはサイレントに無効化されます（サーバーがこのモードをサポートしていない）

## 不正なペイロードと切断の処理

SSEのJSONパースエラーは`readSseJson`からバブルアップし、リクエスト/リスナーをrejectします。

- リクエストSSEのパースエラーはアクティブなリクエストをrejectします。
- バックグラウンドリスナーのエラーは`onError`をトリガーします（AbortErrorを除く）。
- バックグラウンドリスナーの自動再接続はありません。

## `json-rpc.ts`ユーティリティとトランスポート抽象化の対比

`src/mcp/json-rpc.ts`は、`MCPClient`/`MCPManager`が使用する`MCPTransport`抽象化ではなく、直接的なHTTP MCP呼び出し用の`callMCP()`と`parseSSE()`ヘルパーを提供します（Exa統合で使用）。

`HttpTransport`との主な違い：

- レスポンステキスト全体を先にパースし、次に最初の`data:`行を抽出します（`parseSSE`）、JSONフォールバック付き
- リクエストタイムアウト管理、abort API、session-idハンドリング、トランスポートライフサイクルなし
- 生のJSON-RPCエンベロープオブジェクトを返します

このパスは軽量ですが、完全なトランスポート実装ほど堅牢ではありません。

## リトライ/再接続の責務

## トランスポートレベル

現在のトランスポート実装は以下を**行いません**：

- 失敗したリクエストのリトライ
- stdioプロセス終了後の再接続
- SSEリスナーの再接続
- 切断後の処理中リクエストの再送信

即座に失敗し、エラーを伝播します。

## マネージャー/クライアントレベル

`MCPManager`はディスカバリー/初期接続のオーケストレーションを処理し、接続フローを再実行することでのみ再接続できます（`connectToServer`/`discoverAndConnect`パス）。ランタイムの障害コールバック時に既に接続されたトランスポートを自動修復することはありません。

`MCPManager`は低速なサーバー向けの起動時フォールバック動作（キャッシュからの遅延ツール）を持っていますが、これはツールの可用性フォールバックであり、トランスポートのリトライではありません。

## 障害シナリオのまとめ

- **不正なstdioメッセージ行**：破棄されます。ストリームは継続します。
- **Stdioストリーム/プロセスの終了**：トランスポートが閉じられます。ペンディングリクエストは`Transport closed`でrejectされます。
- **HTTPの非2xx**：リクエスト/通知がHTTPエラーをスローします。
- **無効なJSONレスポンス**：パース例外が伝播されます。
- **一致するIDなしにSSEが終了**：リクエストは`No response received for request ID ...`で失敗します。
- **タイムアウト**：トランスポート固有のタイムアウトエラー。
- **呼び出し元のabort**：呼び出し元のシグナルからAbortError/reasonが伝播されます。

## 実用的な境界ルール

メッセージの形状、IDの相関、またはMCPメソッドの順序に関する関心事は、プロトコル/クライアントロジックに属します。

フレーミング（JSONL vs HTTP/SSE）、ストリームパース、fetch/spawnのライフサイクル、タイムアウトクロック、または接続の切断に関する関心事は、トランスポート実装に属します。
