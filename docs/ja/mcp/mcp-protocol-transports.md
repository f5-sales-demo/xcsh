---
title: MCPプロトコルとトランスポート内部構造
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

# MCPプロトコルとトランスポート内部構造

このドキュメントでは、coding-agentがMCP JSON-RPCメッセージングをどのように実装しているか、またプロトコルの関心事がトランスポートの関心事からどのように分離されているかについて説明します。

## スコープ

対象範囲：

- JSON-RPCのリクエスト/レスポンスおよび通知フロー
- stdioおよびHTTP/SSEトランスポートにおけるリクエストの相関とライフサイクル
- タイムアウトとキャンセルの動作
- エラーの伝搬と不正なペイロードの処理
- トランスポート選択の境界（`stdio` vs `http`/`sse`）
- 再接続/リトライの責任がトランスポートレベルかマネージャーレベルか

エクステンション作成のUXやコマンドUIは対象外です。

## 実装ファイル

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## レイヤー境界

### プロトコルレイヤー（JSON-RPC + MCPメソッド）

- メッセージの形状は`types.ts`で定義されています（`JsonRpcRequest`、`JsonRpcNotification`、`JsonRpcResponse`、`JsonRpcMessage`）。
- MCPクライアントロジック（`client.ts`）がメソッドの順序とセッションハンドシェイクを決定します：
  1. `initialize` リクエスト
  2. `notifications/initialized` 通知
  3. `tools/list`、`tools/call` などのメソッド呼び出し

### トランスポートレイヤー（`MCPTransport`）

`MCPTransport`は配信とライフサイクルを抽象化します：

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- オプションのコールバック：`onClose`、`onError`、`onNotification`

トランスポート実装はフレーミングとI/Oの詳細を担当します：

- `StdioTransport`：サブプロセスのstdioを介した改行区切りJSON
- `HttpTransport`：HTTP POSTを介したJSON-RPC、オプションのSSEレスポンス/リスニング付き

### 現在の重要な注意事項

トランスポートコールバック（`onClose`、`onError`、`onNotification`）は実装されていますが、現在の`MCPClient`/`MCPManager`フローではこれらのコールバックに再接続ロジックが接続されていません。通知は呼び出し元がハンドラーを登録した場合のみ消費されます。

## トランスポートの選択

`client.ts:createTransport()`が設定からトランスポートを選択します：

- `type`が省略または`"stdio"` -> `createStdioTransport`
- `"http"`または`"sse"` -> `createHttpTransport`

`"sse"`はHTTPトランスポートのバリアント（同じクラス）として扱われ、別個のトランスポート実装ではありません。

## JSON-RPCメッセージフローと相関

## リクエストID

各トランスポートはリクエストごとにIDを生成します（`Math.random` + タイムスタンプ文字列）。IDはトランスポートローカルの相関トークンです。

## Stdioの相関パス

- 送信リクエストは1つのJSONオブジェクト + `\n`としてシリアライズされます。
- `#pendingRequests: Map<id, {resolve,reject}>`がインフライトリクエストを格納します。
- 読み取りループがstdoutからJSONLをパースし、`#handleMessage`を呼び出します。
- 受信メッセージに一致する`id`がある場合、リクエストはresolve/rejectされます。
- 受信メッセージに`method`があり`id`がない場合、通知として扱われ`onNotification`に送信されます。

不明なIDは無視されます（rejectもエラーコールバックもありません）。

## HTTPの相関パス

- 送信リクエストは生成された`id`を含むJSONボディのHTTP `POST`です。
- 非SSEレスポンスパス：1つのJSON-RPCレスポンスをパースし、`result`を返すか`error`でスローします。
- SSEレスポンスパス（`Content-Type: text/event-stream`）：イベントをストリーミングし、期待するリクエストIDに一致し`result`または`error`を持つ最初のメッセージを返します。
- `method`があり`id`がないSSEメッセージは通知として扱われます。

一致するレスポンスの前にSSEストリームが終了した場合、リクエストは`No response received for request ID ...`で失敗します。

## 通知

クライアントは`transport.notify(...)`を介してJSON-RPC通知を送信します。

- Stdio：通知フレーム（`jsonrpc`、`method`、オプションの`params`）と改行をstdinに書き込みます。
- HTTP：`id`なしのPOSTボディを送信します。成功は`2xx`または`202 Accepted`を受け入れます。

サーバー起点の通知はトランスポートの`onNotification`を通じてのみ表面化されます。マネージャー/クライアントにはデフォルトのグローバルサブスクライバーはありません。

## Stdioトランスポートの内部構造

## ライフサイクルと状態遷移

- 初期状態：`connected=false`、`process=null`、pendingマップは空
- `connect()`：
  - 設定されたcommand/args/env/cwdでサブプロセスを生成
  - connectedをマーク
  - stdoutの読み取りループを開始（`readJsonl`）
  - stderrのループを開始（読み取り/破棄；現在はサイレント）
- `close()`：
  - disconnectedをマーク
  - すべての保留中リクエストをreject（`Transport closed`）
  - サブプロセスをkill
  - 読み取りループのシャットダウンを待機
  - `onClose`を発行

読み取りループが予期せず終了した場合、`finally`が`#handleClose()`をトリガーし、同じ保留中リクエストのrejectとcloseコールバックを実行します。

## タイムアウトとキャンセル

リクエストごとに：

- タイムアウトのデフォルトは`config.timeout ?? 30000`
- 呼び出し元からのオプションの`AbortSignal`
- abortとtimeoutの両方が保留中のPromiseをrejectしマップエントリをクリーンアップ

キャンセルはローカルのみです：トランスポートはプロトコルレベルのキャンセル通知をサーバーに送信しません。

## 不正なペイロードの処理

読み取りループ内：

- パースされた各JSONL行は`try/catch`内の`#handleMessage`に渡されます
- 不正/無効なメッセージ処理の例外は破棄されます（`Skip malformed lines`コメント）
- ループは継続するため、1つの不正メッセージで接続が切断されることはありません

基盤となるストリームパーサーがスローした場合、`onError`が呼び出され（まだ接続中の場合）、その後接続が閉じます。

## 切断/障害時の動作

プロセスの終了またはストリームの閉鎖時：

- すべてのインフライトリクエストは`Transport closed`でrejectされます
- 自動再起動や再接続はありません
- 上位レイヤーが新しいトランスポートを作成して再接続する必要があります

## バックプレッシャー/ストリーミングに関する注意事項

- 送信書き込みは`stdin.write()` + `flush()`を使用し、drainセマンティクスを待機しません。
- トランスポートには明示的なキューやhigh-watermark管理がありません。
- 受信処理は（`readJsonl`に対する`for await`による）ストリーム駆動で、パースされたメッセージを1つずつ処理します。

## HTTP/SSEトランスポートの内部構造

## ライフサイクルと接続セマンティクス

HTTPトランスポートは論理的な接続状態を持ちますが、リクエストパスはHTTP呼び出しごとにステートレスです：

- `connect()`は`connected=true`を設定（ソケット/セッションハンドシェイクなし）
- `Mcp-Session-Id`ヘッダーによるオプションのサーバーセッション追跡
- `close()`はオプションで`Mcp-Session-Id`付きの`DELETE`を送信し、SSEリスナーを中断し、`onClose`を発行

したがって`connected`は「トランスポートが使用可能」を意味し、「永続ストリームが確立済み」を意味しません。

## セッションヘッダーの動作

- POSTレスポンスで`Mcp-Session-Id`ヘッダーが存在する場合、トランスポートがそれを保存します。
- 後続のリクエスト/通知に`Mcp-Session-Id`が含まれます。
- `close()`はHTTP DELETEでサーバーセッションの終了を試みます。終了の失敗は無視されます。

## タイムアウトとキャンセル

`request()`と`notify()`の両方について：

- タイムアウトは`AbortController`を使用（`config.timeout ?? 30000`）
- 外部シグナルが提供された場合、`AbortSignal.any([...])`でマージされます
- AbortErrorの処理は呼び出し元のabortとタイムアウトを区別します

スローされるエラー：

- タイムアウト：`Request timeout after ...ms`（または`SSE response timeout ...`、`Notify timeout ...`）
- 呼び出し元のabort：外部シグナルが既にabortされている場合、元のAbortErrorが再スローされます

## HTTPエラーの伝搬

非OKレスポンスの場合：

- レスポンステキストがスローされるエラーに含まれます（`HTTP <status>: <text>`）
- 存在する場合、`WWW-Authenticate`と`Mcp-Auth-Server`からの認証ヒントが追加されます

JSON-RPCエラーオブジェクトの場合：

- `MCP error <code>: <message>`をスローします

不正なJSONボディ（`response.json()`の失敗）はパース例外として伝搬します。

## SSEの動作とモード

2つのSSEパスが存在します：

1. **リクエストごとのSSEレスポンス**（`#parseSSEResponse`）
   - POSTレスポンスのContent Typeが`text/event-stream`の場合に使用
   - 一致するレスポンスIDが見つかるまでストリームを消費
   - 同じストリーム内のインターリーブされた通知を処理可能

2. **バックグラウンドSSEリスナー**（`startSSEListener()`）
   - サーバー起点の通知用のオプションのGETリスナー
   - 現在MCPマネージャー/クライアントによって自動的に開始されません
   - GETが`405`を返した場合、リスナーはサイレントに自身を無効化します（サーバーがこのモードをサポートしていません）

## 不正なペイロードと切断の処理

SSE JSONパースエラーは`readSseJson`から浮上し、リクエスト/リスナーをrejectします。

- リクエストSSEのパースエラーはアクティブなリクエストをrejectします。
- バックグラウンドリスナーのエラーは`onError`をトリガーします（AbortErrorを除く）。
- バックグラウンドリスナーの自動再接続はありません。

## `json-rpc.ts`ユーティリティとトランスポート抽象化

`src/mcp/json-rpc.ts`は、`MCPClient`/`MCPManager`が使用する`MCPTransport`抽象化ではなく、直接的なHTTP MCP呼び出し（Exa統合で使用）のための`callMCP()`と`parseSSE()`ヘルパーを提供します。

`HttpTransport`との主な違い：

- まずレスポンステキスト全体をパースし、次に最初の`data:`行を抽出（`parseSSE`）、JSONフォールバック付き
- リクエストタイムアウト管理、abort API、session-id処理、トランスポートライフサイクルなし
- 生のJSON-RPCエンベロープオブジェクトを返す

このパスは軽量ですが、完全なトランスポート実装ほど堅牢ではありません。

## リトライ/再接続の責任

## トランスポートレベル

現在のトランスポート実装は以下を**行いません**：

- 失敗したリクエストのリトライ
- stdioプロセス終了後の再接続
- SSEリスナーの再接続
- 切断後のインフライトリクエストの再送信

即座に失敗し、エラーを伝搬します。

## マネージャー/クライアントレベル

`MCPManager`はディスカバリー/初期接続のオーケストレーションを処理し、接続フローを再実行することでのみ再接続できます（`connectToServer`/`discoverAndConnect`パス）。ランタイム障害コールバック時に既に接続済みのトランスポートを自動修復することはしません。

`MCPManager`には遅いサーバー向けの起動時フォールバック動作（キャッシュからの遅延ツール）がありますが、これはツール可用性のフォールバックであり、トランスポートのリトライではありません。

## 障害シナリオまとめ

- **不正なstdioメッセージ行**：破棄されます。ストリームは継続します。
- **stdioストリーム/プロセスの終了**：トランスポートが閉じます。保留中のリクエストは`Transport closed`でrejectされます。
- **HTTP非2xx**：リクエスト/notifyがHTTPエラーをスローします。
- **無効なJSONレスポンス**：パース例外が伝搬されます。
- **一致するIDなしでSSEが終了**：リクエストが`No response received for request ID ...`で失敗します。
- **タイムアウト**：トランスポート固有のタイムアウトエラー。
- **呼び出し元のabort**：呼び出し元のシグナルからAbortError/reasonが伝搬されます。

## 実用的な境界ルール

関心事がメッセージの形状、ID相関、またはMCPメソッドの順序であれば、プロトコル/クライアントロジックに属します。

関心事がフレーミング（JSONL vs HTTP/SSE）、ストリームパース、fetch/spawnのライフサイクル、タイムアウトクロック、または接続のティアダウンであれば、トランスポート実装に属します。
