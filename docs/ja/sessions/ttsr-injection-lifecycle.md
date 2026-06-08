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

このドキュメントでは、現在の Time Traveling Stream Rules (TTSR) のランタイムパスについて、ルールの検出からストリーム中断、リトライインジェクション、拡張機能の通知、セッション状態の管理までを説明します。

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

セッション作成時に、`createAgentSession()` は検出されたすべてのルールを読み込み、`TtsrManager` を構築します：

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### 登録前の重複排除の動作

`loadCapability("rules")` は `rule.name` に基づいて先着優先のセマンティクス（プロバイダーの優先度が高いものが先）で重複排除を行います。シャドウされた重複はTTSR登録前に削除されます。

### `TtsrManager.addRule()` の動作

以下の場合、登録はスキップされます：

- `rule.ttsrTrigger` が存在しない
- 同じ `rule.name` のルールがこのマネージャーに既に登録されている
- 正規表現のコンパイルに失敗する（`new RegExp(rule.ttsrTrigger)` がスローする）

無効な正規表現トリガーは警告としてログに記録され、無視されます。セッションの起動は継続されます。

### 設定に関する注意事項

`TtsrSettings.enabled` はマネージャーに読み込まれますが、現在のランタイムのゲーティングではチェックされていません。ルールが存在する場合、マッチングは引き続き実行されます。

## 2. ストリーミングモニターのライフサイクル

TTSR検出は `AgentSession.#handleAgentEvent` 内で実行されます。

### ターン開始

`turn_start` 時に、ストリームバッファがリセットされます：

- `ttsrManager.resetBuffer()`

### ストリーミング中（`message_update`）

アシスタントの更新が到着し、ルールが存在する場合：

- `text_delta` と `toolcall_delta` を監視する
- デルタをマネージャーバッファに追加する
- `check(buffer)` を呼び出す

`check()` は登録されたルールを反復処理し、リピートポリシー（`#canTrigger`）を通過するすべてのマッチしたルールを返します。

## 3. トリガー判定と即時中断パス

1つ以上のルールがマッチした場合：

1. `markInjected(matches)` がマネージャーのインジェクション状態にルール名を記録する。
2. マッチしたルールが `#pendingTtsrInjections` にキューイングされる。
3. `#ttsrAbortPending = true` が設定される。
4. `agent.abort()` が即座に呼び出される。
5. `ttsr_triggered` イベントが非同期で発行される（ファイア・アンド・フォーゲット）。
6. リトライ処理が `setTimeout(..., 50)` でスケジュールされる。

中断は拡張機能のコールバックでブロックされません。

## 4. リトライスケジューリング、コンテキストモード、リマインダーインジェクション

50msのタイムアウト後：

1. `#ttsrAbortPending = false` が設定される
2. `ttsrManager.getSettings().contextMode` を読み取る
3. `contextMode === "discard"` の場合、`agent.popMessage()` で部分的なアシスタント出力を破棄する
4. `ttsr-interrupt.md` テンプレートを使用して、保留中のルールからインジェクションコンテンツを構築する
5. ルールごとに1つの `<system-interrupt ...>` ブロックを含む合成ユーザーメッセージを追加する
6. `agent.continue()` を呼び出して生成をリトライする

テンプレートのペイロード：

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

保留中のインジェクションはコンテンツ生成後にクリアされます。

### 部分出力に対する `contextMode` の動作

- `discard`：部分的/中断されたアシスタントメッセージはリトライ前に削除されます。
- `keep`：部分的なアシスタント出力は会話状態に残り、リマインダーがその後に追加されます。

## 5. リピートポリシーとギャップロジック

`TtsrManager` は `#messageCount` とルールごとの `lastInjectedAt` を追跡します。

### `repeatMode: "once"`

ルールはインジェクション記録を持った後、一度だけトリガーできます。

### `repeatMode: "after-gap"`

ルールは以下の条件を満たした場合にのみ再トリガーできます：

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` は `turn_end` でインクリメントされるため、ギャップはストリームチャンクではなく、完了したターン数で計測されます。

## 6. イベント発行と拡張機能/フックのサーフェス

### セッションイベント

`AgentSessionEvent` は以下を含みます：

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### 拡張機能ランナー

`#emitSessionEvent()` はイベントを以下にルーティングします：

- 拡張機能リスナー（`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`）
- ローカルセッションサブスクライバー

### フックおよびカスタムツールの型定義

- 拡張機能APIは `on("ttsr_triggered", ...)` を公開します
- フックAPIは `on("ttsr_triggered", ...)` を公開します
- カスタムツールは `onSession({ reason: "ttsr_triggered", rules })` を受け取ります

### インタラクティブモードでのレンダリングの違い

インタラクティブモードでは、`session.isTtsrAbortPending` を使用して、TTSR中断中に中断されたアシスタントの停止理由を可視的な失敗として表示することを抑制し、イベント到着時に `TtsrNotificationComponent` をレンダリングします。

## 7. 永続化とリジュームの状態（現在の実装）

`SessionManager` はインジェクトされたルールの永続化に対する完全なスキーマサポートを備えています：

- エントリタイプ：`ttsr_injection`
- 追加API：`appendTtsrInjection(ruleNames)`
- クエリAPI：`getInjectedTtsrRules()`
- コンテキスト再構築には `SessionContext.injectedTtsrRules` が含まれます

`TtsrManager` は `restoreInjected(ruleNames)` による復元もサポートしています。

### 現在の接続状況

現在のランタイムパスでは：

- `AgentSession` はTTSRトリガー時に `ttsr_injection` エントリを追加しません。
- `createAgentSession()` は `existingSession.injectedTtsrRules` を `ttsrManager` に復元しません。

実質的な影響：インジェクトされたルールの抑制は、ライブプロセスのメモリ内では適用されますが、このパスではセッションのリロード/リジューム時に永続化/復元は現在行われていません。

## 8. 競合境界と順序保証

### 中断 vs リトライコールバック

- 中断はTTSRハンドラーの観点からは同期的です（`agent.abort()` が即座に呼び出されます）
- リトライはタイマーで遅延されます（`50ms`）
- 拡張機能通知は非同期であり、中断/リトライのスケジューリング前に意図的にawaitされません

### 同一ストリームウィンドウ内の複数マッチ

`check()` は現在マッチしている適格なルールをすべて返します。それらは次のリトライメッセージでバッチとしてインジェクトされます。

### 中断と続行の間

タイマーウィンドウ中に、状態が変化する可能性があります（ユーザーの中断、モードアクション、追加イベント）。リトライ呼び出しはベストエフォートです：`agent.continue().catch(() => {})` で後続のエラーを吸収します。

## 9. エッジケースのまとめ

- 無効な `ttsr_trigger` 正規表現：警告付きでスキップされ、他のルールは継続します。
- ケイパビリティレイヤーでのルール名の重複：優先度の低い重複は登録前にシャドウされます。
- マネージャーレイヤーでの名前の重複：2回目の登録は無視されます。
- `contextMode: "keep"`：部分的な違反出力がリマインダーリトライの前にコンテキストに残る可能性があります。
- after-gap リピートは `turn_end` でのターンカウントのインクリメントに依存します。ターン途中のチャンクではギャップカウンターは進みません。
