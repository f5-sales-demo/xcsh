---
title: 非コンパクション自動リトライポリシー
description: コンパクションパス外の一時的なAPIエラーに対する自動リトライポリシー。
sidebar:
  order: 6
  label: リトライポリシー
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# 非コンパクション自動リトライポリシー

このドキュメントでは、`AgentSession` における標準的なAPIエラーリトライパスについて説明します。

自動コンパクションによるコンテキストオーバーフロー回復は明示的に対象外とします。オーバーフローはコンパクションロジックによって処理され、[`compaction.md`](./compaction.md) に別途ドキュメント化されています。

## 実装ファイル

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## コンパクションとのスコープ境界

リトライとコンパクションは同一の `agent_end` パスから確認されますが、意図的に分離されています。

1. `agent_end` が最後のアシスタントメッセージを検査します。
2. `#isRetryableError(...)` が最初に実行されます。
3. リトライが開始された場合、そのターンのコンパクション確認はスキップされます。
4. コンテキストオーバーフローエラーはリトライ分類からハード除外されます（`isContextOverflow(...)` がリトライをショートサーキットします）。
5. オーバーフローは標準リトライではなく `#checkCompaction(...)` へフォールスルーします。

つまり、過負荷・レート制限・サーバー・ネットワーク系のエラーにはこのリトライポリシーが使用され、コンテキストウィンドウオーバーフローにはコンパクション回復が使用されます。

## リトライ分類

`#isRetryableError(...)` には以下のすべてが必要です。

- アシスタントの `stopReason === "error"`
- `errorMessage` が存在する
- メッセージが**コンテキストオーバーフローでない**こと
- `errorMessage` が `#isRetryableErrorMessage(...)` に一致する

現在のリトライ可能パターンセット（正規表現ベース）：

- overloaded（過負荷）
- rate limit / usage limit / too many requests（レート制限・使用量制限・リクエスト過多）
- HTTPライクなサーバークラス：429、500、502、503、504
- service unavailable / server error / internal error（サービス利用不可・サーバーエラー・内部エラー）
- connection error / fetch failed（接続エラー・フェッチ失敗）
- `retry delay` という文言

これは型付きプロバイダーエラーコードではなく、文字列パターン分類です。

## リトライライフサイクルと状態遷移

リトライで使用されるセッション状態：

- `#retryAttempt: number`（`0` はアイドル状態を意味します）
- `#retryPromise: Promise<void> | undefined`（進行中のリトライライフサイクルを追跡します）
- `#retryResolve: (() => void) | undefined`（`#retryPromise` を解決します）
- `#retryAbortController: AbortController | undefined`（バックオフスリープをキャンセルします）

フロー（`#handleRetryableError`）：

1. `retry` 設定グループを読み込みます。
2. `retry.enabled === false` の場合、即座に停止します（`false`、リトライ未開始）。
3. `#retryAttempt` をインクリメントします。
4. `#retryPromise` を一度作成します（チェーン内の最初の試行時）。
5. 試行回数が `retry.maxRetries` を超えた場合、最終失敗イベントを発行して停止します。
6. 遅延を計算します：`retry.baseDelayMs * 2^(attempt-1)`。
7. 使用量制限エラーの場合、リトライヒントを解析して認証ストレージ（`markUsageLimitReached(...)`）を呼び出します。プロバイダー・モデルの切り替えが成功した場合、遅延を強制的に `0` にします。
8. `auto_retry_start` を発行します。
9. エージェントランタイム状態から末尾のアシスタントエラーメッセージを削除します（永続化されたセッション履歴には保持されます）。
10. アボートサポート付きでスリープします。
11. 起床時、`setTimeout(..., 0)` 経由で `agent.continue()` をスケジュールします。

### リトライカウンターがリセットされる条件

`#retryAttempt` は以下の場合に `0` へリセットされます。

- リトライ開始後、最初の成功した（エラーでなく、アボートされていない）アシスタントメッセージの受信時（`auto_retry_end { success: true }` を発行）
- バックオフスリープ中のリトライキャンセル時
- 最大リトライ回数超過パスの通過時

`#retryPromise` は `#resolveRetry()` によって、リトライチェーンが終了したとき（成功・キャンセル・最大回数超過）に解決・クリアされます。

## バックオフと最大試行回数のセマンティクス

設定：

- `retry.enabled`（デフォルト `true`）
- `retry.maxRetries`（デフォルト `3`）
- `retry.baseDelayMs`（デフォルト `2000`）

試行番号付け：

- 試行カウンターは最大値チェック前にインクリメントされます
- 開始イベントは現在の試行回数（1始まり）を使用します
- 最大回数超過の終了イベントは `attempt: this.#retryAttempt - 1`（最後に試みたリトライ回数）を報告します

デフォルト設定でのバックオフシーケンス：

- 試行 1：2000 ms
- 試行 2：4000 ms
- 試行 3：8000 ms

遅延オーバーライドの入力は使用量制限処理パスでのみ使用され、認証ストレージのモデル・アカウント切り替え判断に影響を与えるためにのみ用いられます。メインの非コンパクションリトライパスでは、切り替えが成功しない限り（`delayMs = 0`）、バックオフはローカルの指数遅延のままです。

## アボートの仕組み

### 明示的なリトライアボート

`abortRetry()`：

- `#retryAbortController` をアボートします（存在する場合）
- リトライプロミスを解決します（`#resolveRetry()`）ので、待機中の処理がブロック解除されます

スリープ中にアボートが発生した場合、キャッチパスは以下を発行します。

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- 試行回数・コントローラーをリセットします

### グローバル操作アボートとの連携

`abort()` はアクティブなエージェントストリームをアボートする前に `abortRetry()` を呼び出します。これにより、ユーザーがグローバルアボートを発行したときにリトライバックオフが確実にキャンセルされます。

### TUI との連携

`auto_retry_start` 時、EventController は以下を行います。

- `Esc` ハンドラーを `session.abortRetry()` に切り替えます
- ローダーテキストを表示します：`Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

`auto_retry_end` 時、以前の `Esc` ハンドラーを復元し、ローダー状態をクリアします。

## ストリーミングとプロンプト完了の動作

`prompt()` は `agent.prompt(...)` が返った後、最終的に `#waitForRetry()` を待機します。

効果：

- プロンプト呼び出しは、開始されたリトライチェーンが終了する（成功・失敗・キャンセル）まで完全には解決されません
- リトライライフサイクルは1つの論理的なプロンプト実行境界の一部です

これにより、呼び出し元がリトライ中のターンを早期に完了として扱うことを防ぎます。

## 制御：設定と RPC

### 設定ノブ

設定スキーマの retry グループ下で定義されています。

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

セッション内のプログラマティックトグル：

- `setAutoRetryEnabled(enabled)` が `retry.enabled` を書き込みます
- `autoRetryEnabled` が `retry.enabled` を読み取ります
- `isRetrying` がリトライライフサイクルプロミスがアクティブかどうかを報告します

### RPC 制御

RPC コマンドサーフェス：

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

クライアントヘルパー：

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

どちらのコマンドも成功レスポンスを返します。リトライの進行状況・失敗の詳細はコマンドレスポンスペイロードではなく、ストリーミングされたセッションイベントから得られます。

## イベント発行と失敗の通知

セッションレベルのリトライイベント：

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

伝播：

- `AgentSession.subscribe(...)` を通じて発行されます
- 拡張機能イベントとして拡張機能ランナーへ転送されます
- RPC モードでは、JSON イベントオブジェクトとして直接転送されます（`session.subscribe(event => output(event))`）
- TUI では、ローダー・エラー UI のために `EventController` が消費します

最終失敗の通知：

- 最大回数超過またはキャンセル時、`auto_retry_end.success === false`
- TUI は以下を表示します：`Retry failed after N attempts: <finalError>`
- 拡張機能・フックは同一フィールドを持つ `auto_retry_end` を受信します
- RPC コンシューマーは標準出力ストリームで同一イベントオブジェクトを受信します

## 永続的な停止条件

以下のいずれかが発生した場合、リトライは停止し自動継続されません。

- `retry.enabled` が false
- エラーがリトライ分類されていない
- エラーがコンテキストオーバーフロー（コンパクションパスに委譲）
- 最大リトライ回数超過
- ユーザーがリトライをキャンセルした（リトライローダー中に `abort_retry` または `Esc`）
- グローバルアボート（`abort`）が先にリトライをキャンセルする

カウンターリセット後の将来のリトライ可能なエラー発生時には、新しいリトライチェーンが開始される場合があります。

## 運用上の注意事項

- 分類は正規表現テキストマッチングです。プロバイダー固有の構造化エラーはここでは使用されません。
- リトライは再継続前に失敗したアシスタントエラーを**ランタイムコンテキスト**から削除しますが、セッション履歴にはそのエラーエントリーが保持されます。
- `RpcSessionState` は現在 `autoCompactionEnabled` を公開していますが、`autoRetryEnabled` フィールドは公開していません。RPC 呼び出し元は独自のトグル状態を追跡するか、他のAPIを通じて設定を照会する必要があります。
