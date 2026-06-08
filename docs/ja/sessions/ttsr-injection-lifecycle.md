---
title: TTSRインジェクションライフサイクル
description: コンテキスト管理のためのTTSR（tool-use、tool-result、system-reminder）インジェクションライフサイクル。
sidebar:
  order: 9
  label: TTSRインジェクション
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSRインジェクションライフサイクル

このドキュメントでは、Time Traveling Stream Rules（TTSR）の現在のランタイムパスについて、ルールの検出からストリーム中断、リトライインジェクション、拡張通知、セッション状態の処理までを説明します。

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

## 1. ディスカバリーフィードとルール登録

セッション作成時に、`createAgentSession()` は検出されたすべてのルールを読み込み、`TtsrManager` を構築します：

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### 登録前の重複排除動作

`loadCapability("rules")` は `rule.name` に基づいて重複排除を行い、先勝ちセマンティクス（優先度の高いプロバイダーが先）を適用します。シャドウされた重複はTTSR登録前に除去されます。

### `TtsrManager.addRule()` の動作

以下の場合、登録はスキップされます：

- `rule.ttsrTrigger` が存在しない
- 同じ `rule.name` を持つルールが既にこのマネージャーに登録されている
- 正規表現のコンパイルに失敗する（`new RegExp(rule.ttsrTrigger)` がスローする）

無効な正規表現トリガーは警告としてログに記録され、無視されます。セッションの起動は継続します。

### 設定に関する注意事項

`TtsrSettings.enabled` はマネージャーに読み込まれますが、現在ランタイムのゲーティングではチェックされていません。ルールが存在する場合、マッチングは引き続き実行されます。

## 2. ストリーミングモニターのライフサイクル

TTSR検出は `AgentSession.#handleAgentEvent` 内で実行されます。

### ターン開始

`turn_start` 時に、ストリームバッファがリセットされます：

- `ttsrManager.resetBuffer()`

### ストリーム中（`message_update`）

アシスタントの更新が到着し、ルールが存在する場合：

- `text_delta` と `toolcall_delta` を監視
- デルタをマネージャーバッファに追加
- `check(buffer)` を呼び出し

`check()` は登録されたルールを反復し、リピートポリシー（`#canTrigger`）を通過するすべてのマッチルールを返します。

## 3. トリガー判定と即時中断パス

1つ以上のルールがマッチした場合：

1. `markInjected(matches)` がマネージャーのインジェクション状態にルール名を記録
2. マッチしたルールが `#pendingTtsrInjections` にキューイング
3. `#ttsrAbortPending = true`
4. `agent.abort()` が即座に呼び出される
5. `ttsr_triggered` イベントが非同期で発行される（ファイア・アンド・フォーゲット）
6. リトライ処理が `setTimeout(..., 50)` でスケジュールされる

中断は拡張コールバックの完了を待ちません。

## 4. リトライスケジューリング、コンテキストモード、リマインダーインジェクション

50msタイムアウト後：

1. `#ttsrAbortPending = false`
2. `ttsrManager.getSettings().contextMode` を読み取り
3. `contextMode === "discard"` の場合、`agent.popMessage()` で部分的なアシスタント出力を破棄
4. 保留中のルールから `ttsr-interrupt.md` テンプレートを使用してインジェクションコンテンツを構築
5. ルールごとに1つの `<system-interrupt ...>` ブロックを含む合成ユーザーメッセージを追加
6. `agent.continue()` を呼び出して生成をリトライ

テンプレートのペイロード：

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

保留中のインジェクションはコンテンツ生成後にクリアされます。

### 部分出力に対する `contextMode` の動作

- `discard`: 部分的/中断されたアシスタントメッセージはリトライ前に除去されます。
- `keep`: 部分的なアシスタント出力は会話状態に残り、リマインダーはその後に追加されます。

## 5. リピートポリシーとギャップロジック

`TtsrManager` は `#messageCount` とルールごとの `lastInjectedAt` を追跡します。

### `repeatMode: "once"`

ルールはインジェクション記録が存在した後、1回のみトリガーできます。

### `repeatMode: "after-gap"`

ルールは以下の条件でのみ再トリガーできます：

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` は `turn_end` 時にインクリメントされるため、ギャップはストリームチャンクではなく完了したターン数で測定されます。

## 6. イベント発行と拡張/フックサーフェス

### セッションイベント

`AgentSessionEvent` には以下が含まれます：

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### 拡張ランナー

`#emitSessionEvent()` はイベントを以下にルーティングします：

- 拡張リスナー（`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`）
- ローカルセッションサブスクライバー

### フックとカスタムツールの型定義

- 拡張APIは `on("ttsr_triggered", ...)` を公開
- フックAPIは `on("ttsr_triggered", ...)` を公開
- カスタムツールは `onSession({ reason: "ttsr_triggered", rules })` を受信

### インタラクティブモードのレンダリングの違い

インタラクティブモードでは、`session.isTtsrAbortPending` を使用して、TTSR中断中に中断されたアシスタントの停止理由が可視的な失敗として表示されることを抑制し、イベント到着時に `TtsrNotificationComponent` をレンダリングします。

## 7. 永続化と再開状態（現在の実装）

`SessionManager` はインジェクトされたルールの永続化に対する完全なスキーマサポートを備えています：

- エントリタイプ: `ttsr_injection`
- 追加API: `appendTtsrInjection(ruleNames)`
- クエリAPI: `getInjectedTtsrRules()`
- コンテキスト再構築には `SessionContext.injectedTtsrRules` が含まれる

`TtsrManager` も `restoreInjected(ruleNames)` による復元をサポートしています。

### 現在の接続状態

現在のランタイムパスでは：

- `AgentSession` はTTSRトリガー時に `ttsr_injection` エントリを追加しません。
- `createAgentSession()` は `existingSession.injectedTtsrRules` を `ttsrManager` に復元しません。

結果として：インジェクトされたルールの抑制はライブプロセスのインメモリで適用されますが、このパスによるセッションのリロード/再開時の永続化/復元は現在行われていません。

## 8. 競合境界と順序保証

### 中断 vs リトライコールバック

- 中断はTTSRハンドラーの観点から同期的（`agent.abort()` が即座に呼び出される）
- リトライはタイマーにより遅延（`50ms`）
- 拡張通知は非同期であり、中断/リトライのスケジューリング前に意図的にawaitされない

### 同一ストリームウィンドウ内の複数マッチ

`check()` は現在マッチしているすべての適格なルールを返します。それらは次のリトライメッセージでバッチとしてインジェクトされます。

### 中断と続行の間

タイマーウィンドウ中に状態が変化する可能性があります（ユーザー中断、モードアクション、追加イベント）。リトライ呼び出しはベストエフォートです：`agent.continue().catch(() => {})` は後続のエラーを飲み込みます。

## 9. エッジケースの要約

- 無効な `ttsr_trigger` 正規表現：警告付きでスキップされ、他のルールは継続します。
- ケイパビリティレイヤーでのルール名の重複：優先度の低い重複は登録前にシャドウされます。
- マネージャーレイヤーでの名前の重複：2番目の登録は無視されます。
- `contextMode: "keep"`: リマインダーリトライの前に、部分的な違反出力がコンテキストに残る可能性があります。
- after-gapリピートは `turn_end` でのターンカウントのインクリメントに依存します。ターン途中のチャンクはギャップカウンターを進めません。
