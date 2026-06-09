---
title: TTSR インジェクションライフサイクル
description: コンテキスト管理のための TTSR（tool-use、tool-result、system-reminder）インジェクションライフサイクル。
sidebar:
  order: 9
  label: TTSR インジェクション
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSR インジェクションライフサイクル

本ドキュメントでは、Time Traveling Stream Rules（TTSR）の現在のランタイムパスについて、ルールの検出からストリーム中断、リトライインジェクション、拡張機能通知、セッション状態の処理までを解説します。

## 実装ファイル

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. 検出フィードとルール登録

セッション作成時、`createAgentSession()` は検出されたすべてのルールを読み込み、`TtsrManager` を構築します：

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### 登録前の重複排除動作

`loadCapability("rules")` は `rule.name` で重複排除を行い、先勝ちのセマンティクスを適用します（優先度の高いプロバイダーが先）。シャドウされた重複はTTSR登録前に削除されます。

### `TtsrManager.addRule()` の動作

以下の場合、登録はスキップされます：

- `rule.ttsrTrigger` が存在しない
- 同じ `rule.name` のルールが既にこのマネージャーに登録されている
- 正規表現のコンパイルに失敗する（`new RegExp(rule.ttsrTrigger)` がスローする）

無効な正規表現トリガーは警告としてログに記録され、無視されます。セッションの起動は続行されます。

### 設定に関する注意事項

`TtsrSettings.enabled` はマネージャーに読み込まれますが、現在ランタイムのゲーティングではチェックされていません。ルールが存在する場合、マッチングは引き続き実行されます。

## 2. ストリーミングモニターのライフサイクル

TTSR検出は `AgentSession.#handleAgentEvent` 内で実行されます。

### ターン開始

`turn_start` 時、ストリームバッファがリセットされます：

- `ttsrManager.resetBuffer()`

### ストリーム中（`message_update`）

アシスタントの更新が到着し、ルールが存在する場合：

- `text_delta` と `toolcall_delta` を監視
- デルタをマネージャーバッファに追加
- `check(buffer)` を呼び出し

`check()` は登録されたルールを反復処理し、リピートポリシー（`#canTrigger`）を通過するすべてのマッチングルールを返します。

## 3. トリガー判定と即時中止パス

1つ以上のルールがマッチした場合：

1. `markInjected(matches)` がマネージャーのインジェクション状態にルール名を記録する。
2. マッチしたルールが `#pendingTtsrInjections` にキューイングされる。
3. `#ttsrAbortPending = true` に設定される。
4. `agent.abort()` が即座に呼び出される。
5. `ttsr_triggered` イベントが非同期で発行される（ファイア・アンド・フォーゲット）。
6. リトライ処理が `setTimeout(..., 50)` でスケジュールされる。

中止は拡張機能のコールバックをブロックしません。

## 4. リトライスケジューリング、コンテキストモード、リマインダーインジェクション

50msのタイムアウト後：

1. `#ttsrAbortPending = false`
2. `ttsrManager.getSettings().contextMode` を読み取る
3. `contextMode === "discard"` の場合、`agent.popMessage()` で部分的なアシスタント出力を破棄する
4. `ttsr-interrupt.md` テンプレートを使用して保留中のルールからインジェクションコンテンツを構築する
5. ルールごとに1つの `<system-interrupt ...>` ブロックを含む合成ユーザーメッセージを追加する
6. `agent.continue()` を呼び出して生成をリトライする

テンプレートのペイロードは以下の通りです：

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

保留中のインジェクションはコンテンツ生成後にクリアされます。

### 部分出力に対する `contextMode` の動作

- `discard`：部分的/中止されたアシスタントメッセージはリトライ前に削除されます。
- `keep`：部分的なアシスタント出力は会話状態に残り、リマインダーはその後に追加されます。

## 5. リピートポリシーとギャップロジック

`TtsrManager` は `#messageCount` とルールごとの `lastInjectedAt` を追跡します。

### `repeatMode: "once"`

ルールはインジェクション記録を持った後、一度のみトリガーできます。

### `repeatMode: "after-gap"`

ルールは以下の条件を満たす場合のみ再トリガーできます：

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` は `turn_end` でインクリメントされるため、ギャップはストリームチャンクではなく完了したターン数で測定されます。

## 6. イベント発行と拡張機能/フックのインターフェース

### セッションイベント

`AgentSessionEvent` には以下が含まれます：

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### 拡張機能ランナー

`#emitSessionEvent()` はイベントを以下にルーティングします：

- 拡張機能リスナー（`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`）
- ローカルセッションサブスクライバー

### フックとカスタムツールの型定義

- 拡張機能APIは `on("ttsr_triggered", ...)` を公開
- フックAPIは `on("ttsr_triggered", ...)` を公開
- カスタムツールは `onSession({ reason: "ttsr_triggered", rules })` を受信

### インタラクティブモードでのレンダリングの違い

インタラクティブモードでは、TTSR中断時に中止されたアシスタントの停止理由が可視的なエラーとして表示されるのを抑制するために `session.isTtsrAbortPending` を使用し、イベント到着時に `TtsrNotificationComponent` をレンダリングします。

## 7. 永続化と再開状態（現在の実装）

`SessionManager` はインジェクトされたルールの永続化に対する完全なスキーマサポートを備えています：

- エントリタイプ：`ttsr_injection`
- 追加API：`appendTtsrInjection(ruleNames)`
- クエリAPI：`getInjectedTtsrRules()`
- コンテキスト再構築には `SessionContext.injectedTtsrRules` が含まれる

`TtsrManager` も `restoreInjected(ruleNames)` による復元をサポートしています。

### 現在の配線状況

現在のランタイムパスでは：

- `AgentSession` はTTSRトリガー時に `ttsr_injection` エントリを追加しません。
- `createAgentSession()` は `existingSession.injectedTtsrRules` を `ttsrManager` に復元しません。

実質的な影響：インジェクトされたルールの抑制はライブプロセスのインメモリで適用されますが、このパスではセッションのリロード/再開時に永続化/復元は現在行われていません。

## 8. 競合の境界と順序の保証

### 中止 vs リトライコールバック

- 中止はTTSRハンドラーの視点からは同期的（`agent.abort()` が即座に呼び出される）
- リトライはタイマーにより遅延される（`50ms`）
- 拡張機能通知は非同期であり、中止/リトライスケジューリング前に意図的にawaitされない

### 同一ストリームウィンドウ内での複数マッチ

`check()` は現在マッチしている適格なルールをすべて返します。それらは次のリトライメッセージでバッチとしてインジェクトされます。

### 中止と続行の間

タイマーウィンドウ中、状態が変化する可能性があります（ユーザー中断、モードアクション、追加イベント）。リトライ呼び出しはベストエフォートです：`agent.continue().catch(() => {})` が後続のエラーを吸収します。

## 9. エッジケースのまとめ

- 無効な `ttsr_trigger` 正規表現：警告付きでスキップされ、他のルールは続行されます。
- ケイパビリティレイヤーでのルール名の重複：優先度の低い重複は登録前にシャドウされます。
- マネージャーレイヤーでの名前の重複：2回目の登録は無視されます。
- `contextMode: "keep"`：部分的な違反出力がリマインダーリトライ前のコンテキストに残る可能性があります。
- リピートアフターギャップは `turn_end` でのターンカウントインクリメントに依存します。ターン途中のチャンクではギャップカウンターは進みません。
