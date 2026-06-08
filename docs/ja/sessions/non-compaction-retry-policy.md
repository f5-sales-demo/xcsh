---
title: Non-Compaction Auto-Retry Policy
description: コンパクションパス以外の一時的なAPIエラーに対する自動リトライポリシー。
sidebar:
  order: 6
  label: リトライポリシー
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# 非コンパクション自動リトライポリシー

このドキュメントでは、`AgentSession` における標準的なAPIエラーリトライパスについて説明します。

自動コンパクションによるコンテキストオーバーフロー回復は明示的に除外しています。オーバーフローはコンパクションロジックによって処理され、[`compaction.md`](./compaction.md) で別途ドキュメント化されています。

## 実装ファイル

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## スコープ境界とコンパクション

リトライとコンパクションは同じ `agent_end` パスからチェックされますが、意図的に分離されています：

1. `agent_end` が最後のアシスタントメッセージを検査します。
2. `#isRetryableError(...)` が最初に実行されます。
3. リトライが開始された場合、そのターンではコンパクションチェックはスキップされます。
4. コンテキストオーバーフローエラーはリトライ分類から明確に除外されます（`isContextOverflow(...)` がリトライを短絡させます）。
5. したがって、オーバーフローは標準リトライではなく `#checkCompaction(...)` にフォールスルーします。

つまり、過負荷/レートリミット/サーバー/ネットワーク系の障害はこのリトライポリシーを使用し、コンテキストウィンドウのオーバーフローはコンパクション回復を使用します。

## リトライ分類

`#isRetryableError(...)` は以下のすべてを要求します：

- アシスタントの `stopReason === "error"`
- `errorMessage` が存在する
- メッセージがコンテキストオーバーフロー**ではない**
- `errorMessage` が `#isRetryableErrorMessage(...)` にマッチする

現在のリトライ可能なパターンセット（正規表現ベース）：

- overloaded
- rate limit / usage limit / too many requests
- HTTP系サーバークラス：429、500、502、503、504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay` の文言

これは文字列パターン分類であり、型付きプロバイダーエラーコードではありません。

## リトライのライフサイクルと状態遷移

リトライで使用されるセッション状態：

- `#retryAttempt: number`（`0` はアイドル状態を意味する）
- `#retryPromise: Promise<void> | undefined`（進行中のリトライライフサイクルを追跡）
- `#retryResolve: (() => void) | undefined`（`#retryPromise` を解決する）
- `#retryAbortController: AbortController | undefined`（バックオフスリープをキャンセルする）

フロー（`#handleRetryableError`）：

1. `retry` 設定グループを読み取る。
2. `retry.enabled === false` の場合、即座に停止（`false`、リトライ未開始）。
3. `#retryAttempt` をインクリメント。
4. `#retryPromise` を一度だけ作成（チェーン内の最初の試行時）。
5. 試行回数が `retry.maxRetries` を超えた場合、最終失敗イベントを発行して停止。
6. 遅延を計算：`retry.baseDelayMs * 2^(attempt-1)`。
7. 使用量制限エラーの場合、リトライヒントを解析し、認証ストレージ（`markUsageLimitReached(...)`）を呼び出す。プロバイダー/モデルの切り替えが成功した場合、遅延を `0` に強制する。
8. `auto_retry_start` を発行。
9. エージェントランタイム状態から末尾のアシスタントエラーメッセージを削除（永続化されたセッション履歴には保持）。
10. アボートサポート付きでスリープ。
11. 起床時、`setTimeout(..., 0)` 経由で `agent.continue()` をスケジュール。

### リトライカウンターがリセットされる条件

`#retryAttempt` は以下のケースで `0` にリセットされます：

- リトライ開始後、最初の正常な非エラー・非中断アシスタントメッセージ（`auto_retry_end { success: true }` を発行）
- バックオフスリープ中のリトライキャンセル
- 最大リトライ回数超過パス

`#retryPromise` はリトライチェーンの終了時（成功、キャンセル、または最大回数超過時）に `#resolveRetry()` を通じて解決/クリアされます。

## バックオフと最大試行回数のセマンティクス

設定：

- `retry.enabled`（デフォルト `true`）
- `retry.maxRetries`（デフォルト `3`）
- `retry.baseDelayMs`（デフォルト `2000`）

試行番号：

- 試行カウンターは最大チェックの前にインクリメントされる
- 開始イベントは現在の試行回数を使用（1始まり）
- 最大超過の終了イベントは `attempt: this.#retryAttempt - 1`（最後に試行されたリトライ回数）を報告

デフォルト設定でのバックオフシーケンス：

- 試行1：2000 ms
- 試行2：4000 ms
- 試行3：8000 ms

遅延オーバーライド入力は使用量制限処理パスでのみ使用され、認証ストレージのモデル/アカウント切り替え判断に影響を与えるためだけのものです。メインの非コンパクションリトライパスでは、切り替えが成功しない限り（`delayMs = 0`）、バックオフはローカルの指数遅延のままです。

## アボートメカニクス

### 明示的なリトライアボート

`abortRetry()`：

- `#retryAbortController` をアボート（存在する場合）
- リトライPromiseを解決（`#resolveRetry()`）し、待機者をアンブロック

スリープ中にアボートが発生した場合、catchパスは以下を発行します：

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- 試行回数/コントローラーをリセット

### グローバル操作アボートとの相互作用

`abort()` はアクティブなエージェントストリームをアボートする前に `abortRetry()` を呼び出します。これにより、ユーザーが一般的なアボートを発行した際にリトライバックオフが確実にキャンセルされます。

### TUIとの相互作用

`auto_retry_start` 時、EventControllerは：

- `Esc` ハンドラーを `session.abortRetry()` に切り替え
- ローダーテキストを表示：`Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

`auto_retry_end` 時、以前の `Esc` ハンドラーを復元し、ローダー状態をクリアします。

## ストリーミングとプロンプト完了の動作

`prompt()` は最終的に `agent.prompt(...)` が返った後、`#waitForRetry()` を待機します。

効果：

- プロンプト呼び出しは、開始されたリトライチェーンが完了（成功/失敗/キャンセル）するまで完全には解決されない
- リトライライフサイクルは1つの論理的なプロンプト実行境界の一部である

これにより、呼び出し元がリトライ中のターンを早期に完了したものとして扱うことを防ぎます。

## コントロール：設定とRPC

### 設定ノブ

設定スキーマのretryグループで定義：

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

セッションのプログラム的トグル：

- `setAutoRetryEnabled(enabled)` が `retry.enabled` を書き込む
- `autoRetryEnabled` が `retry.enabled` を読み取る
- `isRetrying` がリトライライフサイクルPromiseがアクティブかどうかを報告する

### RPCコントロール

RPCコマンドサーフェス：

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

クライアントヘルパー：

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

両方のコマンドは成功レスポンスを返します。リトライの進捗/失敗の詳細はコマンドレスポンスペイロードではなく、ストリーミングされたセッションイベントから取得されます。

## イベント発行と失敗の可視化

セッションレベルのリトライイベント：

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

伝播：

- `AgentSession.subscribe(...)` を通じて発行される
- 拡張ランナーに拡張イベントとして転送される
- RPCモードでは、JSONイベントオブジェクトとして直接転送される（`session.subscribe(event => output(event))`）
- TUIでは、`EventController` がローダー/エラーUIのために消費する

最終失敗の可視化：

- 最大超過またはキャンセル時、`auto_retry_end.success === false`
- TUIは表示：`Retry failed after N attempts: <finalError>`
- 拡張/フックは同じフィールドの `auto_retry_end` を受信
- RPCコンシューマーはstdoutストリームで同じイベントオブジェクトを受信

## 永続的な停止条件

以下のいずれかが発生すると、リトライは停止し自動継続しません：

- `retry.enabled` が false
- エラーがリトライ分類されていない
- エラーがコンテキストオーバーフロー（コンパクションパスに委譲）
- 最大リトライ回数超過
- ユーザーがリトライをキャンセル（リトライローダー中の `abort_retry` または `Esc`）
- グローバルアボート（`abort`）がリトライを先にキャンセル

カウンターがリセットされた後、将来のリトライ可能なエラーで新しいリトライチェーンを開始できます。

## 運用上の注意点

- 分類は正規表現テキストマッチングです。プロバイダー固有の構造化エラーはここでは使用されません。
- リトライは再continuの前に**ランタイムコンテキスト**から失敗したアシスタントエラーを削除しますが、セッション履歴にはそのエラーエントリが保持されます。
- `RpcSessionState` は現在 `autoCompactionEnabled` を公開していますが、`autoRetryEnabled` フィールドは公開していません。RPCの呼び出し元は自身のトグル状態を追跡するか、他のAPIを通じて設定を照会する必要があります。
