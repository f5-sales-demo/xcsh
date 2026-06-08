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

このドキュメントでは、coding-agentが現在 `/handoff` をどのように実装しているかについて説明します：トリガーパス、生成プロンプト、補完キャプチャ、セッション切り替え、およびコンテキスト再注入。

## スコープ

対象範囲：

- インタラクティブな `/handoff` コマンドディスパッチ
- `AgentSession.handoff()` のライフサイクルと状態遷移
- ハンドオフ出力がアシスタント出力からどのようにキャプチャされるか
- 旧セッション/新セッションがハンドオフデータをどのように異なる方法で永続化するか
- 成功、キャンセル、失敗時のUI動作

対象外：

- 一般的なツリーナビゲーション/ブランチの内部構造
- ハンドオフ以外のセッションコマンド（`/new`、`/fork`、`/resume`）

## 実装ファイル

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## トリガーパス

1. `/handoff` は組み込みスラッシュコマンドメタデータ（`slash-commands.ts`）でオプションのインラインヒント `[focus instructions]` とともに宣言されています。
2. インタラクティブ入力処理（`InputController`）において、`/handoff` または `/handoff ...` に一致する送信テキストは、通常のプロンプト送信の前にインターセプトされます。
3. エディタがクリアされ、`handleHandoffCommand(customInstructions?)` が呼び出されます。
4. `CommandController.handleHandoffCommand` は現在のエントリを使用してプリフライトガードを実行します：
   - `type === "message"` のエントリ数をカウントします。
   - `< 2` の場合、`Nothing to hand off (no messages yet)` と警告して返します。

同じ最小コンテンツガードが `AgentSession.handoff()` 内にも存在し、違反した場合はスローします。これにより、UIレイヤーとセッションレイヤーの両方で安全性が重複して確保されています。

## エンドツーエンドのライフサイクル

### 1) ハンドオフ生成の開始

`AgentSession.handoff(customInstructions?)`：

- 現在のブランチエントリを読み取ります（`sessionManager.getBranch()`）
- 最小メッセージ数を検証します（`>= 2`）
- `#handoffAbortController` を作成します
- 構造化されたハンドオフドキュメントを要求する固定のインラインプロンプトを構築します（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）
- カスタム指示が提供されている場合は `Additional focus: ...` を追加します

プロンプトは以下を通じて送信されます：

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` は、この内部命令ペイロードに対するスラッシュ/プロンプトテンプレートの展開を防止します。

### 2) 補完のキャプチャ

プロンプト送信前に、`handoff()` はセッションイベントをサブスクライブし、`agent_end` を待ちます。

`agent_end` 時に、エージェント状態から後方スキャンして最新の `assistant` メッセージを見つけ、`type === "text"` であるすべての `content` ブロックを `\n` で連結してハンドオフテキストを抽出します。

重要な抽出の前提：

- テキストブロックのみが使用され、テキスト以外のコンテンツは無視されます。
- 最新のアシスタントメッセージがハンドオフ生成に対応していると仮定します。
- マークダウンセクションの解析やフォーマット準拠の検証は行いません。
- アシスタント出力にテキストブロックがない場合、ハンドオフは欠落として扱われます。

### 3) キャンセルチェック

`handoff()` は以下のいずれかの条件が成立する場合に `undefined` を返します：

- キャプチャされたハンドオフテキストがない、または
- `#handoffAbortController.signal.aborted` が true である

`finally` で常に `#handoffAbortController` をクリアします。

### 4) 新セッションの作成

テキストがキャプチャされ、中断されていない場合：

1. 現在のセッションライターをフラッシュ（`sessionManager.flush()`）
2. 新しいセッションを開始（`sessionManager.newSession()`）
3. メモリ内のエージェント状態をリセット（`agent.reset()`）
4. `agent.sessionId` を新しいセッションIDに再バインド
5. キューされたコンテキスト配列をクリア（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. TODOリマインダーカウンターをリセット

`newSession()` は新しいヘッダーと空のエントリリストを作成します（リーフは `null` にリセット）。ハンドオフパスでは、`parentSession` は渡されません。

### 5) ハンドオフコンテキストの注入

生成されたハンドオフドキュメントはラップされ、`custom_message` エントリとして新しいセッションに追加されます：

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
- `display`: `true`（TUI再構築時に表示される）
- エントリタイプ: `custom_message`（LLMコンテキストに参加する）

### 6) アクティブなエージェントコンテキストの再構築

注入後：

1. `sessionManager.buildSessionContext()` が現在のリーフのメッセージリストを解決
2. `agent.replaceMessages(sessionContext.messages)` が注入されたハンドオフメッセージをアクティブコンテキストにする
3. メソッドが `{ document: handoffText }` を返す

この時点で、新しいセッションのアクティブなLLMコンテキストには、古いトランスクリプトではなく、注入されたハンドオフメッセージが含まれています。

## 永続化モデル：旧セッション vs 新セッション

### 旧セッション

生成中、通常のメッセージ永続化はアクティブなままです。アシスタントのハンドオフ応答は、`message_end` 時に通常の `message` エントリとして永続化されます。

結果：元のセッションには、生成されたハンドオフが履歴トランスクリプトの一部として表示可能な状態で含まれます。

### 新セッション

セッションリセット後、ハンドオフは `customType: "handoff"` の `custom_message` として永続化されます。

`buildSessionContext()` はこのエントリを `createCustomMessage(...)` を介してランタイムのカスタム/ユーザーコンテキストメッセージに変換するため、新しいセッションからの将来のプロンプトに含まれます。

## コントローラー/UI動作

`CommandController.handleHandoffCommand` の動作：

- `await session.handoff(customInstructions)` を呼び出す
- 結果が `undefined` の場合：`showError("Handoff cancelled")`
- 成功時：
  - `rebuildChatFromMessages()`（注入されたハンドオフを含む新しいセッションコンテキストを読み込む）
  - ステータスラインとエディタ上部ボーダーを無効化
  - TODOを再読み込み
  - 成功チャットラインを追加：`New session started with handoff context`
- 例外発生時：
  - メッセージが `"Handoff cancelled"` またはエラー名が `AbortError` の場合：`showError("Handoff cancelled")`
  - それ以外：`showError("Handoff failed: <message>")`
- 最後にレンダリングを要求

## キャンセルセマンティクス（現在の動作）

### セッションレベルのキャンセルプリミティブ

`AgentSession` は以下を公開します：

- `abortHandoff()` → `#handoffAbortController` を中断
- `isGeneratingHandoff` → コントローラーが存在する間は true

この中断パスが使用されると、ハンドオフサブスクライバーは `Error("Handoff cancelled")` でリジェクトし、コマンドコントローラーはそれをキャンセルUIにマッピングします。

### インタラクティブな `/handoff` パスの制限

現在のインタラクティブコントローラーの配線では、`/handoff` は `abortHandoff()` を呼び出す専用のEscapeハンドラーをインストールしません（一時的に `editor.onEscape` をオーバーライドするコンパクション/ブランチサマリーパスとは異なります）。

実際の影響：

- セッションレベルのキャンセルサポートはありますが、`/handoff` コマンドパスにはハンドオフ固有のキーバインディングフックがありません。
- ユーザーの中断は、より広範なエージェント中断パスを通じて発生する可能性がありますが、それは `abortHandoff()` が使用する明示的なキャンセルチャネルとは異なります。

## 中断 vs 失敗したハンドオフ

現在のUI分類：

- **中断/キャンセル**
  - `abortHandoff()` パスが `"Handoff cancelled"` をトリガー、または
  - `AbortError` がスローされた場合
  - UIに `Handoff cancelled` を表示

- **失敗**
  - `handoff()` / プロンプトパイプラインからのその他のスローされたエラー（モデル/APIバリデーションエラー、ランタイム例外など）
  - UIに `Handoff failed: ...` を表示

追加の注意点：生成が完了したがテキストが抽出されなかった場合、`handoff()` は `undefined` を返し、コントローラーは現在 **失敗** ではなく **キャンセル** として報告します。

## 短いセッションと最小コンテンツのガードレール

2つのガードが低信号のハンドオフを防止します：

- UIレイヤー（`handleHandoffCommand`）：`< 2` メッセージエントリの場合に警告して早期リターン
- セッションレイヤー（`handoff()`）：同じ条件をエラーとしてスロー

これにより、空または空に近いハンドオフコンテキストで新しいセッションが作成されることを回避します。

## 状態遷移の概要

高レベルの状態フロー：

1. インタラクティブスラッシュコマンドがインターセプトされる
2. プリフライトメッセージ数ガード
3. `#handoffAbortController` が作成される（`isGeneratingHandoff = true`）
4. 内部ハンドオフプロンプトが送信される（通常のアシスタント生成としてチャットに表示される）
5. `agent_end` 時に、最後のアシスタントテキストが抽出される
6. 欠落/中断の場合 → `undefined` を返すかキャンセルエラーパスへ
7. 存在する場合：
   - 旧セッションをフラッシュ
   - 新しい空のセッションを作成
   - ランタイムキュー/カウンターをリセット
   - `custom_message(handoff)` を追加
   - アクティブなエージェントメッセージを再構築して置換
8. コントローラーがチャットUIを再構築し、成功を通知
9. `#handoffAbortController` がクリアされる（`isGeneratingHandoff = false`）

## 既知の前提と制限事項

- ハンドオフ抽出はヒューリスティック：「最後のアシスタントテキストブロック」であり、構造的な検証はありません。
- 生成されたマークダウンが要求されたセクションフォーマットに従っているかのハードチェックはありません。
- 抽出テキストの欠落は、コントローラーUXではキャンセルとして報告されます。
- `/handoff` インタラクティブフローには、現在 Escape→`abortHandoff()` の専用バインディングがありません。
- 新しいセッションの系譜メタデータ（`parentSession`）はこのパスでは設定されません。
