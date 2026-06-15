---
title: 非コンパクションの自動リトライポリシー
description: コンパクションパス外の一時的なAPIエラーに対する自動リトライポリシー。
sidebar:
  order: 6
  label: リトライポリシー
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# 非コンパクションの自動リトライポリシー

このドキュメントでは、`AgentSession` における標準的なAPIエラーのリトライパスについて説明します。

自動コンパクションによるコンテキストオーバーフローの回復は明示的に対象外とします。オーバーフローはコンパクションロジックによって処理され、[`compaction.md`](./compaction.md) で別途ドキュメント化されています。

## 実装ファイル

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## コンパクションとのスコープ境界

リトライとコンパクションは同じ `agent_end` パスから確認されますが、意図的に分離されています：

1. `agent_end` が最後のアシスタントメッセージを検査します。
2. `#isRetryableError(...)` が最初に実行されます。
3. リトライが開始された場合、そのターンのコンパクション確認はスキップされます。
4. コンテキストオーバーフローエラーはリトライ分類からハード除外されます（`isContextOverflow(...)` がリトライを短絡させます）。
5. オーバーフローは標準リトライではなく `#checkCompaction(...)` にフォールスルーします。

つまり、過負荷/レート制限/サーバー/ネットワーク系のエラーはこのリトライポリシーを使用し、コンテキストウィンドウのオーバーフローはコンパクション回復を使用します。

## リトライ分類

`#isRetryableError(...)` は以下のすべてを要件とします：

- アシスタントの `stopReason === "error"`
- `errorMessage` が存在する
- メッセージが**コンテキストオーバーフローではない**
- `errorMessage` が `#isRetryableErrorMessage(...)` と一致する

現在のリトライ可能なパターンセット（正規表現ベース）：

- overloaded
- rate limit / usage limit / too many requests
- HTTP系サーバークラス: 429、500、502、503、504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay` の文言

これは型付きプロバイダーエラーコードではなく、文字列パターン分類です。

## リトライのライフサイクルと状態遷移

リトライで使用されるセッション状態：

- `#retryAttempt: number`（`0` はアイドル状態を意味します）
- `#retryPromise: Promise<void> | undefined`（進行中のリトライライフサイクルを追跡）
- `#retryResolve: (() => void) | undefined`（`#retryPromise` を解決）
- `#retryAbortController: AbortController | undefined`（バックオフスリープをキャンセル）

フロー（`#handleRetryableError`）：

1. `retry` 設定グループを読み取ります。
2. `retry.enabled === false` の場合、即座に停止します（`false`、リトライは開始されません）。
3. `#retryAttempt` をインクリメントします。
4. `#retryPromise` を一度作成します（チェーン内の最初の試行）。
5. 試行回数が `retry.maxRetries` を超えた場合、最終失敗イベントを発行して停止します。
6. 遅延を計算します：`retry.baseDelayMs * 2^(attempt-1)`。
7. usage-limit エラーの場合、リトライヒントを解析して認証ストレージ（`markUsageLimitReached(...)`）を呼び出します。プロバイダー/モデルの切り替えが成功した場合、遅延を `0` に強制します。
8. `auto_retry_start` を発行します。
9. エージェントランタイム状態から末尾のアシスタントエラーメッセージを削除します（永続化されたセッション履歴には保持されます）。
10. 中止サポート付きでスリープします。
11. 起床時に `setTimeout(..., 0)` を介して `agent.continue()` をスケジュールします。

### リトライカウンターのリセット条件

`#retryAttempt` は以下の場合に `0` にリセットされます：

- リトライ開始後の最初の成功した非エラー・非中断アシスタントメッセージ（`auto_retry_end { success: true }` を発行）
- バックオフスリープ中のリトライキャンセル
- 最大リトライ回数超過パス

`#retryPromise` は、リトライチェーンが終了したとき（成功、キャンセル、または最大回数超過）に `#resolveRetry()` を介して解決/クリアされます。

## バックオフと最大試行回数のセマンティクス

設定：

- `retry.enabled`（デフォルト `true`）
- `retry.maxRetries`（デフォルト `3`）
- `retry.baseDelayMs`（デフォルト `2000`）

試行回数の採番：

- 試行カウンターは最大値チェックの前にインクリメントされます
- 開始イベントは現在の試行回数を使用します（1始まり）
- 最大回数超過の終了イベントは `attempt: this.#retryAttempt - 1` を報告します（最後に試みたリトライ回数）

デフォルト設定でのバックオフシーケンス：

- 試行1: 2000 ms
- 試行2: 4000 ms
- 試行3: 8000 ms

遅延オーバーライドの入力は usage-limit 処理パスでのみ使用され、認証ストレージのモデル/アカウント切り替えの判断に影響を与えるためだけに使用されます。メインの非コンパクションリトライパスでは、切り替えが成功した場合（`delayMs = 0`）を除き、バックオフはローカルの指数遅延のままです。

## 中止メカニクス

### 明示的なリトライ中止

`abortRetry()`：

- `#retryAbortController` を中止します（存在する場合）
- リトライPromiseを解決します（`#resolveRetry()`）。これにより待機者のブロックが解除されます。

スリープ中に中止が発生した場合、catchパスは以下を発行します：

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- 試行回数/コントローラーをリセットします

### グローバルオペレーション中止との相互作用

`abort()` はアクティブなエージェントストリームを中止する前に `abortRetry()` を呼び出します。これにより、ユーザーが全体的な中止を発行したときにリトライバックオフが確実にキャンセルされます。

### TUIとの相互作用

`auto_retry_start` 時、EventController は以下を行います：

- `Esc` ハンドラーを `session.abortRetry()` に切り替えます
- ローダーテキストをレンダリングします：`Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

`auto_retry_end` 時、以前の `Esc` ハンドラーを復元してローダー状態をクリアします。

## ストリーミングとプロンプト完了の動作

`prompt()` は最終的に `agent.prompt(...)` が返った後に `#waitForRetry()` を待機します。

効果：

- プロンプト呼び出しは、開始されたリトライチェーンが終了するまで（成功/失敗/キャンセル）完全に解決されません
- リトライのライフサイクルは1つの論理的なプロンプト実行境界の一部です

これにより、呼び出し元がリトライ中のターンを早まって完了と判断することを防ぎます。

## 制御: 設定とRPC

### 設定ノブ

設定スキーマのリトライグループ下で定義されます：

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

セッションのプログラム的な切り替え：

- `setAutoRetryEnabled(enabled)` は `retry.enabled` を書き込みます
- `autoRetryEnabled` は `retry.enabled` を読み取ります
- `isRetrying` はリトライライフサイクルのPromiseがアクティブかどうかを報告します

### RPC制御

RPCコマンドサーフェス：

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

クライアントヘルパー：

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

どちらのコマンドも成功レスポンスを返します。リトライの進捗/失敗の詳細はコマンドレスポンスのペイロードではなく、ストリーミングされたセッションイベントから取得されます。

## イベント発行と失敗のサーフェシング

セッションレベルのリトライイベント：

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

伝播：

- `AgentSession.subscribe(...)` を通じて発行されます
- 拡張機能イベントとして拡張機能ランナーに転送されます
- RPCモードでは、JSONイベントオブジェクトとして直接転送されます（`session.subscribe(event => output(event))`）
- TUIでは、ローダー/エラーUIのために `EventController` によって消費されます

最終失敗のサーフェシング：

- 最大回数超過またはキャンセル時、`auto_retry_end.success === false`
- TUIに表示：`Retry failed after N attempts: <finalError>`
- 拡張機能/フックは同じフィールドを持つ `auto_retry_end` を受信します
- RPCコンシューマーはstdoutストリームで同じイベントオブジェクトを受信します

## 永続的な停止条件

以下のいずれかが発生した場合、リトライは停止し自動継続しません：

- `retry.enabled` が false
- エラーがリトライ分類されていない
- エラーがコンテキストオーバーフロー（コンパクションパスに委譲）
- 最大リトライ回数超過
- ユーザーがリトライをキャンセル（リトライローダー中の `abort_retry` または `Esc`）
- グローバル中止（`abort`）が最初にリトライをキャンセル

カウンターがリセットされた後、将来のリトライ可能なエラーに対して新しいリトライチェーンを開始することができます。

## 運用上の注意事項

- 分類は正規表現によるテストマッチングです。プロバイダー固有の構造化エラーはここでは使用されません。
- リトライは再継続前に**ランタイムコンテキスト**から失敗したアシスタントエラーを除去しますが、セッション履歴にはそのエラーエントリーが保持されます。
- `RpcSessionState` は現在 `autoCompactionEnabled` を公開していますが、`autoRetryEnabled` フィールドは公開していません。RPCの呼び出し元は独自のトグル状態を追跡するか、他のAPIを通じて設定を照会する必要があります。
