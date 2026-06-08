---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Handoff pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 生成パイプライン

このドキュメントでは、coding-agentが現在 `/handoff` をどのように実装しているかを説明します：トリガーパス、生成プロンプト、完了キャプチャ、セッション切り替え、およびコンテキスト再注入。

## スコープ

対象：

- インタラクティブな `/handoff` コマンドのディスパッチ
- `AgentSession.handoff()` のライフサイクルと状態遷移
- ハンドオフ出力がアシスタント出力からどのようにキャプチャされるか
- 旧/新セッションがハンドオフデータをどのように異なる方法で永続化するか
- 成功、キャンセル、失敗時のUI動作

対象外：

- 汎用的なツリーナビゲーション/ブランチの内部構造
- ハンドオフ以外のセッションコマンド（`/new`、`/fork`、`/resume`）

## 実装ファイル

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## トリガーパス

1. `/handoff` はビルトインのスラッシュコマンドメタデータ（`slash-commands.ts`）でオプションのインラインヒント `[focus instructions]` 付きで宣言されています。
2. インタラクティブな入力処理（`InputController`）では、`/handoff` または `/handoff ...` に一致する送信テキストが通常のプロンプト送信前にインターセプトされます。
3. エディタがクリアされ、`handleHandoffCommand(customInstructions?)` が呼び出されます。
4. `CommandController.handleHandoffCommand` は現在のエントリを使用してプリフライトガードを実行します：
   - `type === "message"` のエントリをカウントします。
   - `< 2` の場合、`Nothing to hand off (no messages yet)` と警告して返します。

同じ最小コンテンツガードが `AgentSession.handoff()` 内にも存在し、違反時にはスローします。これにより、UIとセッションの両方のレイヤーで安全性が重複しています。

## エンドツーエンドのライフサイクル

### 1) ハンドオフ生成の開始

`AgentSession.handoff(customInstructions?)`：

- 現在のブランチエントリを読み取ります（`sessionManager.getBranch()`）
- 最小メッセージ数を検証します（`>= 2`）
- `#handoffAbortController` を作成します
- 構造化されたハンドオフドキュメントを要求する固定のインラインプロンプトを構築します（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）
- カスタム指示が提供された場合、`Additional focus: ...` を追加します

プロンプトは以下を通じて送信されます：

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` により、この内部命令ペイロードのスラッシュ/プロンプトテンプレート展開が防止されます。

### 2) 完了のキャプチャ

プロンプト送信前に、`handoff()` はセッションイベントにサブスクライブし、`agent_end` を待機します。

`agent_end` 時に、エージェント状態から最新の `assistant` メッセージを逆方向にスキャンしてハンドオフテキストを抽出し、`type === "text"` のすべての `content` ブロックを `\n` で連結します。

重要な抽出に関する前提：

- テキストブロックのみが使用されます。テキスト以外のコンテンツは無視されます。
- 最新のアシスタントメッセージがハンドオフ生成に対応していると仮定します。
- Markdownセクションの解析やフォーマット準拠の検証は行いません。
- アシスタント出力にテキストブロックがない場合、ハンドオフは欠落として扱われます。

### 3) キャンセルチェック

`handoff()` は以下のいずれかの条件が成立した場合に `undefined` を返します：

- キャプチャされたハンドオフテキストがない、または
- `#handoffAbortController.signal.aborted` が true

`finally` で常に `#handoffAbortController` をクリアします。

### 4) 新しいセッションの作成

テキストがキャプチャされ、中断されていない場合：

1. 現在のセッションライターをフラッシュします（`sessionManager.flush()`）
2. 新しいセッションを開始します（`sessionManager.newSession()`）
3. メモリ内のエージェント状態をリセットします（`agent.reset()`）
4. `agent.sessionId` を新しいセッションIDに再バインドします
5. キュー済みのコンテキスト配列をクリアします（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. todoリマインダーカウンターをリセットします

`newSession()` は新しいヘッダーと空のエントリリストを作成します（leafは `null` にリセット）。ハンドオフパスでは、`parentSession` は渡されません。

### 5) ハンドオフコンテキストの注入

生成されたハンドオフドキュメントはラップされ、新しいセッションに `custom_message` エントリとして追加されます：

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

挿入呼び出し：

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

セマンティクス：

- `customType`: `"handoff"`
- `display`: `true`（TUI再構築で表示可能）
- エントリタイプ: `custom_message`（LLMコンテキストに参加）

### 6) アクティブなエージェントコンテキストの再構築

注入後：

1. `sessionManager.buildSessionContext()` が現在のleafのメッセージリストを解決します
2. `agent.replaceMessages(sessionContext.messages)` が注入されたハンドオフメッセージをアクティブコンテキストにします
3. メソッドは `{ document: handoffText }` を返します

この時点で、新しいセッションのアクティブなLLMコンテキストには、旧トランスクリプトではなく注入されたハンドオフメッセージが含まれています。

## 永続化モデル：旧セッション vs 新セッション

### 旧セッション

生成中は、通常のメッセージ永続化が引き続きアクティブです。アシスタントのハンドオフ応答は `message_end` で通常の `message` エントリとして永続化されます。

結果：元のセッションには、生成されたハンドオフが履歴トランスクリプトの一部として表示されます。

### 新セッション

セッションリセット後、ハンドオフは `customType: "handoff"` の `custom_message` として永続化されます。

`buildSessionContext()` はこのエントリを `createCustomMessage(...)` を通じてランタイムのカスタム/ユーザーコンテキストメッセージに変換するため、新しいセッションからの将来のプロンプトに含まれます。

## コントローラー/UI動作

`CommandController.handleHandoffCommand` の動作：

- `await session.handoff(customInstructions)` を呼び出します
- 結果が `undefined` の場合：`showError("Handoff cancelled")`
- 成功時：
  - `rebuildChatFromMessages()`（注入されたハンドオフを含む新しいセッションコンテキストを読み込み）
  - ステータスラインとエディタ上部ボーダーを無効化
  - todosを再読み込み
  - 成功チャットラインを追加：`New session started with handoff context`
- 例外発生時：
  - メッセージが `"Handoff cancelled"` またはエラー名が `AbortError` の場合：`showError("Handoff cancelled")`
  - それ以外：`showError("Handoff failed: <message>")`
- 終了時にレンダリングを要求

## キャンセルセマンティクス（現在の動作）

### セッションレベルのキャンセルプリミティブ

`AgentSession` は以下を公開しています：

- `abortHandoff()` → `#handoffAbortController` を中断
- `isGeneratingHandoff` → コントローラーが存在する間 true

この中断パスが使用されると、ハンドオフサブスクライバーは `Error("Handoff cancelled")` でリジェクトし、コマンドコントローラーはそれをキャンセルUIにマッピングします。

### インタラクティブ `/handoff` パスの制限

現在のインタラクティブコントローラーの配線では、`/handoff` は `abortHandoff()` を呼び出す専用のEscapeハンドラーをインストールしません（一時的に `editor.onEscape` をオーバーライドするコンパクション/ブランチサマリーパスとは異なります）。

実際の影響：

- セッションレベルのキャンセルサポートはありますが、`/handoff` コマンドパスにはハンドオフ固有のキーバインディングフックがありません。
- より広範なエージェント中断パスを通じてユーザー中断が発生する可能性はありますが、それは `abortHandoff()` が使用する明示的なキャンセルチャネルとは異なります。

## 中断 vs 失敗したハンドオフ

現在のUI分類：

- **中断/キャンセル**
  - `abortHandoff()` パスが `"Handoff cancelled"` をトリガー、または
  - `AbortError` がスローされた場合
  - UIは `Handoff cancelled` を表示

- **失敗**
  - `handoff()` / プロンプトパイプラインからのその他のスローエラー（モデル/APIバリデーションエラー、ランタイム例外など）
  - UIは `Handoff failed: ...` を表示

追加の注意点：生成が完了してもテキストが抽出されなかった場合、`handoff()` は `undefined` を返し、コントローラーは現在 **失敗** ではなく **キャンセル** として報告します。

## ショートセッションと最小コンテンツガードレール

2つのガードが低シグナルのハンドオフを防止します：

- UIレイヤー（`handleHandoffCommand`）：`< 2` のメッセージエントリに対して警告して早期リターン
- セッションレイヤー（`handoff()`）：同じ条件をエラーとしてスロー

これにより、空または空に近いハンドオフコンテキストで新しいセッションが作成されることを回避します。

## 状態遷移の要約

高レベルの状態フロー：

1. インタラクティブなスラッシュコマンドがインターセプトされる
2. プリフライトのメッセージ数ガード
3. `#handoffAbortController` が作成される（`isGeneratingHandoff = true`）
4. 内部ハンドオフプロンプトが送信される（通常のアシスタント生成としてチャットに表示）
5. `agent_end` 時に、最後のアシスタントテキストが抽出される
6. 欠落/中断の場合 → `undefined` を返すかキャンセルエラーパス
7. 存在する場合：
   - 旧セッションをフラッシュ
   - 新しい空のセッションを作成
   - ランタイムキュー/カウンターをリセット
   - `custom_message(handoff)` を追加
   - アクティブなエージェントメッセージを再構築して置換
8. コントローラーがチャットUIを再構築し、成功をアナウンス
9. `#handoffAbortController` がクリアされる（`isGeneratingHandoff = false`）

## 既知の前提と制限

- ハンドオフ抽出はヒューリスティック：「最後のアシスタントテキストブロック」であり、構造的な検証はありません。
- 生成されたMarkdownが要求されたセクションフォーマットに従っているかのハードチェックはありません。
- 抽出テキストの欠落は、コントローラーのUXではキャンセルとして報告されます。
- `/handoff` のインタラクティブフローには現在、専用のEscape→`abortHandoff()` バインディングがありません。
- 新しいセッションの系統メタデータ（`parentSession`）はこのパスでは設定されません。
