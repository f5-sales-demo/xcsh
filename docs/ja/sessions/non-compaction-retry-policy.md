---
title: コンパクション以外の自動リトライポリシー
description: コンパクションパス外における一時的なAPIエラーの自動リトライポリシー。
sidebar:
  order: 6
  label: リトライポリシー
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# コンパクション以外の自動リトライポリシー

このドキュメントでは、`AgentSession` における標準的なAPIエラーリトライパスについて説明します。

自動コンパクションによるコンテキストオーバーフローの復旧は明示的に除外されています。オーバーフローはコンパクションロジックによって処理され、[`compaction.md`](./compaction.md) に別途ドキュメント化されています。

## 実装ファイル

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## スコープ境界とコンパクションの関係

リトライとコンパクションは同じ `agent_end` パスからチェックされますが、意図的に分離されています：

1. `agent_end` が最後のアシスタントメッセージを検査する。
2. `#isRetryableError(...)` が最初に実行される。
3. リトライが開始された場合、そのターンではコンパクションチェックはスキップされる。
4. コンテキストオーバーフローエラーはリトライ分類からハード除外される（`isContextOverflow(...)` がリトライを短絡する）。
5. そのため、オーバーフローは標準リトライではなく `#checkCompaction(...)` にフォールスルーする。

つまり、過負荷/レート制限/サーバー/ネットワーク系の障害はこのリトライポリシーを使用し、コンテキストウィンドウのオーバーフローはコンパクション復旧を使用します。

## リトライ分類

`#isRetryableError(...)` は以下のすべてを要求します：

- アシスタントの `stopReason === "error"`
- `errorMessage` が存在する
- メッセージがコンテキストオーバーフロー**ではない**
- `errorMessage` が `#isRetryableErrorMessage(...)` にマッチする

現在のリトライ可能パターンセット（正規表現ベース）：

- overloaded
- rate limit / usage limit / too many requests
- HTTP系サーバークラス：429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay` の文言

これは文字列パターン分類であり、型付きプロバイダーエラーコードではありません。

## リトライのライフサイクルと状態遷移

リトライで使用されるセッション状態：

- `#retryAttempt: number`（`0` はアイドル状態を意味する）
- `#retryPromise: Promise<void> | undefined`（進行中のリトライライフサイクルを追跡）
- `#retryResolve: (() => void) | undefined`（`#retryPromise` を解決する）
- `#retryAbortController: AbortController | undefined`（バックオフスリープをキャンセル）

フロー（`#handleRetryableError`）：

1. `retry` 設定グループを読み取る。
2. `retry.enabled === false` の場合、即座に停止（`false`、リトライ開始なし）。
3. `#retryAttempt` をインクリメント。
4. `#retryPromise` を一度作成（チェーンの最初の試行時）。
5. 試行回数が `retry.maxRetries` を超えた場合、最終失敗イベントを発行して停止。
6. 遅延を計算：`retry.baseDelayMs * 2^(attempt-1)`。
7. 使用量制限エラーの場合、リトライヒントを解析し認証ストレージを呼び出す（`markUsageLimitReached(...)`）。プロバイダー/モデルの切り替えが成功した場合、遅延を `0` に強制。
8. `auto_retry_start` を発行。
9. 末尾のアシスタントエラーメッセージをエージェントランタイム状態から削除（永続化されたセッション履歴には保持）。
10. アボートサポート付きでスリープ。
11. ウェイク時に `setTimeout(..., 0)` 経由で `agent.continue()` をスケジュール。

### リトライカウンターがリセットされるタイミング

`#retryAttempt` は以下のケースで `0` にリセットされます：

- リトライ開始後、最初の成功した（エラーでもアボートでもない）アシスタントメッセージ（`auto_retry_end { success: true }` を発行）
- バックオフスリープ中のリトライキャンセル
- 最大リトライ超過パス

`#retryPromise` はリトライチェーンの終了時（成功、キャンセル、または最大超過時）に `#resolveRetry()` を通じて解決/クリアされます。

## バックオフと最大試行回数のセマンティクス

設定：

- `retry.enabled`（デフォルト `true`）
- `retry.maxRetries`（デフォルト `3`）
- `retry.baseDelayMs`（デフォルト `2000`）

試行番号の付与：

- 試行カウンターは最大チェックの前にインクリメントされる
- 開始イベントは現在の試行回数を使用（1ベース）
- 最大超過の終了イベントは `attempt: this.#retryAttempt - 1` を報告（最後に試行されたリトライ回数）

デフォルト設定でのバックオフシーケンス：

- 試行1：2000 ms
- 試行2：4000 ms
- 試行3：8000 ms

遅延オーバーライド入力は使用量制限処理パスでのみ使用され、認証ストレージのモデル/アカウント切り替え判断に影響を与えるためだけに使用されます。メインのコンパクション以外のリトライパスでは、切り替えが成功しない限り（`delayMs = 0`）、バックオフはローカルの指数遅延のままです。

## アボートメカニクス

### 明示的なリトライアボート

`abortRetry()`：

- `#retryAbortController` をアボート（存在する場合）
- リトライプロミスを解決（`#resolveRetry()`）し、待機者をアンブロック

スリープ中にアボートが発生した場合、キャッチパスは以下を発行：

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- 試行回数/コントローラーをリセット

### グローバルオペレーションアボートとの相互作用

`abort()` はアクティブなエージェントストリームをアボートする前に `abortRetry()` を呼び出します。これにより、ユーザーが汎用アボートを発行した際にリトライバックオフがキャンセルされることが保証されます。

### TUIとの相互作用

`auto_retry_start` 時、EventController は：

- `Esc` ハンドラーを `session.abortRetry()` に切り替え
- ローダーテキストを表示：`Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

`auto_retry_end` 時、以前の `Esc` ハンドラーを復元し、ローダー状態をクリアします。

## ストリーミングとプロンプト完了の動作

`prompt()` は最終的に `agent.prompt(...)` が返った後、`#waitForRetry()` で待機します。

効果：

- プロンプト呼び出しは、開始されたリトライチェーンが完了（成功/失敗/キャンセル）するまで完全には解決されない
- リトライライフサイクルは1つの論理的なプロンプト実行境界の一部

これにより、呼び出し元がリトライ中のターンを早すぎるタイミングで完了と見なすことを防ぎます。

## コントロール：設定とRPC

### 設定ノブ

設定スキーマのretryグループで定義：

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

セッション内のプログラマティックトグル：

- `setAutoRetryEnabled(enabled)` が `retry.enabled` に書き込む
- `autoRetryEnabled` が `retry.enabled` を読み取る
- `isRetrying` がリトライライフサイクルプロミスがアクティブかどうかを報告する

### RPCコントロール

RPCコマンドサーフェス：

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

クライアントヘルパー：

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

両方のコマンドは成功レスポンスを返します。リトライの進捗/失敗の詳細は、コマンドレスポンスペイロードではなく、ストリーミングされたセッションイベントから提供されます。

## イベント発行と失敗の表面化

セッションレベルのリトライイベント：

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

伝播：

- `AgentSession.subscribe(...)` を通じて発行
- 拡張ランナーに拡張イベントとして転送
- RPCモードでは、JSONイベントオブジェクトとして直接転送（`session.subscribe(event => output(event))`）
- TUIでは、`EventController` がローダー/エラーUIのために消費

最終失敗の表面化：

- 最大超過またはキャンセル時、`auto_retry_end.success === false`
- TUIは表示：`Retry failed after N attempts: <finalError>`
- 拡張/フックは同じフィールドの `auto_retry_end` を受信
- RPCコンシューマーはstdoutストリームで同じイベントオブジェクトを受信

## 永続的な停止条件

以下のいずれかが発生すると、リトライは停止し自動継続しません：

- `retry.enabled` がfalse
- エラーがリトライ分類されない
- エラーがコンテキストオーバーフロー（コンパクションパスに委任）
- 最大リトライ回数超過
- ユーザーがリトライをキャンセル（リトライローダー中の `abort_retry` または `Esc`）
- グローバルアボート（`abort`）が先にリトライをキャンセル

カウンターリセット後、将来のリトライ可能エラーで新しいリトライチェーンを開始できます。

## 運用上の注意事項

- 分類は正規表現テキストマッチングであり、プロバイダー固有の構造化エラーはここでは使用されません。
- リトライは再継続前に失敗したアシスタントエラーを**ランタイムコンテキスト**から除去しますが、セッション履歴にはそのエラーエントリが保持されます。
- `RpcSessionState` は現在 `autoCompactionEnabled` を公開していますが、`autoRetryEnabled` フィールドは公開していません。RPCの呼び出し元は、自身のトグル状態を追跡するか、他のAPIを通じて設定を照会する必要があります。
