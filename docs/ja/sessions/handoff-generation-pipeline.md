---
title: ハンドオフ生成パイプライン
description: チームコラボレーション用のポータブルなセッションサマリーを作成するためのハンドオフ生成パイプライン。
sidebar:
  order: 8
  label: ハンドオフパイプライン
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 生成パイプライン

このドキュメントでは、coding-agentが現在 `/handoff` をどのように実装しているかについて説明します：トリガーパス、生成プロンプト、完了キャプチャ、セッション切り替え、コンテキスト再注入。

## スコープ

対象範囲：

- インタラクティブな `/handoff` コマンドディスパッチ
- `AgentSession.handoff()` のライフサイクルと状態遷移
- ハンドオフ出力がアシスタント出力からどのようにキャプチャされるか
- 新旧セッションでハンドオフデータがどのように異なる方法で永続化されるか
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

1. `/handoff` はビルトインスラッシュコマンドメタデータ（`slash-commands.ts`）でオプションのインラインヒント `[focus instructions]` と共に宣言されています。
2. インタラクティブ入力処理（`InputController`）において、`/handoff` または `/handoff ...` にマッチする送信テキストは、通常のプロンプト送信前にインターセプトされます。
3. エディタがクリアされ、`handleHandoffCommand(customInstructions?)` が呼び出されます。
4. `CommandController.handleHandoffCommand` は現在のエントリを使用してプリフライトガードを実行します：
   - `type === "message"` のエントリ数をカウントします。
   - `2未満` の場合、`Nothing to hand off (no messages yet)` と警告して戻ります。

同じ最小コンテンツガードが `AgentSession.handoff()` 内にも存在し、違反時にスローします。これはUIとセッション両方のレイヤーで安全性を重複して確保しています。

## エンドツーエンドのライフサイクル

### 1) ハンドオフ生成の開始

`AgentSession.handoff(customInstructions?)`：

- 現在のブランチエントリを読み取り（`sessionManager.getBranch()`）
- 最小メッセージ数を検証（`>= 2`）
- `#handoffAbortController` を作成
- 構造化されたハンドオフドキュメント（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）を要求する固定のインラインプロンプトを構築
- カスタム指示が提供された場合、`Additional focus: ...` を追加

プロンプトは以下を通じて送信されます：

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` は、この内部指示ペイロードのスラッシュ/プロンプトテンプレート展開を防止します。

### 2) 完了のキャプチャ

プロンプト送信前に、`handoff()` はセッションイベントをサブスクライブし、`agent_end` を待機します。

`agent_end` 時に、エージェント状態から最新の `assistant` メッセージを後方スキャンしてハンドオフテキストを抽出し、`type === "text"` のすべての `content` ブロックを `\n` で連結します。

重要な抽出の前提条件：

- テキストブロックのみが使用され、テキスト以外のコンテンツは無視されます。
- 最新のアシスタントメッセージがハンドオフ生成に対応すると仮定しています。
- Markdownセクションの解析やフォーマット準拠の検証は行いません。
- アシスタント出力にテキストブロックがない場合、ハンドオフは欠落として扱われます。

### 3) キャンセルチェック

`handoff()` は以下のいずれかの条件が成立した場合に `undefined` を返します：

- キャプチャされたハンドオフテキストがない場合、または
- `#handoffAbortController.signal.aborted` が true の場合

`finally` で常に `#handoffAbortController` をクリアします。

### 4) 新しいセッションの作成

テキストがキャプチャされ、中断されていない場合：

1. 現在のセッションライターをフラッシュ（`sessionManager.flush()`）
2. 新しいセッションを開始（`sessionManager.newSession()`）
3. インメモリのエージェント状態をリセット（`agent.reset()`）
4. `agent.sessionId` を新しいセッションIDに再バインド
5. キューに入れられたコンテキスト配列をクリア（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. Todoリマインダーカウンターをリセット

`newSession()` は新しいヘッダーと空のエントリリストを作成します（leafは `null` にリセット）。ハンドオフパスでは、`parentSession` は渡されません。

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
- `display`: `true`（TUI再構築時に表示）
- エントリタイプ: `custom_message`（LLMコンテキストに参加）

### 6) アクティブなエージェントコンテキストの再構築

注入後：

1. `sessionManager.buildSessionContext()` が現在のリーフのメッセージリストを解決
2. `agent.replaceMessages(sessionContext.messages)` が注入されたハンドオフメッセージをアクティブコンテキストにする
3. メソッドが `{ document: handoffText }` を返す

この時点で、新しいセッションのアクティブなLLMコンテキストには、古いトランスクリプトではなく、注入されたハンドオフメッセージが含まれています。

## 永続化モデル：旧セッション vs 新セッション

### 旧セッション

生成中、通常のメッセージ永続化は引き続きアクティブです。アシスタントのハンドオフ応答は、`message_end` 時に通常の `message` エントリとして永続化されます。

結果：元のセッションには、履歴トランスクリプトの一部として表示可能な生成済みハンドオフが含まれます。

### 新セッション

セッションリセット後、ハンドオフは `customType: "handoff"` の `custom_message` として永続化されます。

`buildSessionContext()` はこのエントリを `createCustomMessage(...)` を通じてランタイムのカスタム/ユーザーコンテキストメッセージに変換し、新しいセッションからの将来のプロンプトに含まれるようにします。

## コントローラー/UI動作

`CommandController.handleHandoffCommand` の動作：

- `await session.handoff(customInstructions)` を呼び出す
- 結果が `undefined` の場合：`showError("Handoff cancelled")`
- 成功時：
  - `rebuildChatFromMessages()`（注入されたハンドオフを含む新しいセッションコンテキストを読み込み）
  - ステータスラインとエディタ上部ボーダーを無効化
  - Todoを再読み込み
  - 成功チャットラインを追加：`New session started with handoff context`
- 例外発生時：
  - メッセージが `"Handoff cancelled"` またはエラー名が `AbortError` の場合：`showError("Handoff cancelled")`
  - それ以外：`showError("Handoff failed: <message>")`
- 終了時にレンダリングを要求

## キャンセルセマンティクス（現在の動作）

### セッションレベルのキャンセルプリミティブ

`AgentSession` は以下を公開します：

- `abortHandoff()` → `#handoffAbortController` を中断
- `isGeneratingHandoff` → コントローラーが存在する間 true

この中断パスが使用されると、ハンドオフサブスクライバーは `Error("Handoff cancelled")` でリジェクトし、コマンドコントローラーがキャンセルUIにマッピングします。

### インタラクティブ `/handoff` パスの制限

現在のインタラクティブコントローラーの配線では、`/handoff` は `abortHandoff()` を呼び出す専用のEscapeハンドラーをインストールしません（一時的に `editor.onEscape` をオーバーライドするコンパクション/ブランチサマリーパスとは異なります）。

実際の影響：

- セッションレベルのキャンセルサポートはありますが、`/handoff` コマンドパスにはハンドオフ固有のキーバインディングフックがありません。
- ユーザーの中断はより広範なエージェント中断パスを通じて発生する可能性がありますが、それは `abortHandoff()` が使用する明示的なキャンセルチャネルとは異なります。

## 中断 vs 失敗のハンドオフ

現在のUI分類：

- **中断/キャンセル**
  - `abortHandoff()` パスが `"Handoff cancelled"` をトリガー、または
  - スローされた `AbortError`
  - UIに `Handoff cancelled` と表示

- **失敗**
  - `handoff()` / プロンプトパイプラインからのその他のスローされたエラー（モデル/APIバリデーションエラー、ランタイム例外など）
  - UIに `Handoff failed: ...` と表示

追加の注意点：生成が完了してもテキストが抽出されない場合、`handoff()` は `undefined` を返し、コントローラーは現在 **失敗** ではなく **キャンセル** として報告します。

## ショートセッションと最小コンテンツガードレール

2つのガードがシグナルの少ないハンドオフを防止します：

- UIレイヤー（`handleHandoffCommand`）：`2未満` のメッセージエントリに対して警告し、早期リターン
- セッションレイヤー（`handoff()`）：同じ条件をエラーとしてスロー

これにより、空または準空のハンドオフコンテキストで新しいセッションが作成されることを回避します。

## 状態遷移のまとめ

高レベルの状態フロー：

1. インタラクティブスラッシュコマンドのインターセプト
2. プリフライトメッセージ数ガード
3. `#handoffAbortController` の作成（`isGeneratingHandoff = true`）
4. 内部ハンドオフプロンプトの送信（チャットに通常のアシスタント生成として表示）
5. `agent_end` 時に、最後のアシスタントテキストを抽出
6. 欠落/中断の場合 → `undefined` を返すかキャンセルエラーパス
7. 存在する場合：
   - 旧セッションをフラッシュ
   - 新しい空のセッションを作成
   - ランタイムキュー/カウンターをリセット
   - `custom_message(handoff)` を追加
   - アクティブなエージェントメッセージを再構築・置換
8. コントローラーがチャットUIを再構築し、成功を通知
9. `#handoffAbortController` のクリア（`isGeneratingHandoff = false`）

## 既知の前提条件と制限事項

- ハンドオフ抽出はヒューリスティックです：「最後のアシスタントテキストブロック」を使用し、構造的な検証はありません。
- 生成されたMarkdownが要求されたセクションフォーマットに従っているかのハードチェックはありません。
- 抽出テキストの欠落は、コントローラーUXではキャンセルとして報告されます。
- `/handoff` インタラクティブフローには現在、専用のEscape→`abortHandoff()` バインディングがありません。
- 新しいセッションのリネージメタデータ（`parentSession`）はこのパスでは設定されません。
