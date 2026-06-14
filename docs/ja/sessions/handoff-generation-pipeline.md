---
title: ハンドオフ生成パイプライン
description: チームコラボレーションのためのポータブルなセッションサマリーを作成するハンドオフ生成パイプライン。
sidebar:
  order: 8
  label: ハンドオフパイプライン
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 生成パイプライン

このドキュメントでは、コーディングエージェントが現時点で `/handoff` を実装する方法について説明します。トリガーパス、生成プロンプト、補完のキャプチャ、セッション切り替え、コンテキスト再注入を対象としています。

## スコープ

対象範囲:

- インタラクティブな `/handoff` コマンドのディスパッチ
- `AgentSession.handoff()` のライフサイクルと状態遷移
- ハンドオフ出力をアシスタント出力からキャプチャする方法
- 旧セッションと新セッションでハンドオフデータの永続化方法が異なる点
- 成功、キャンセル、失敗時の UI 動作

対象外:

- 汎用ツリーナビゲーション/ブランチ内部処理
- ハンドオフ以外のセッションコマンド（`/new`、`/fork`、`/resume`）

## 実装ファイル

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## トリガーパス

1. `/handoff` はビルトインスラッシュコマンドのメタデータ（`slash-commands.ts`）にオプションのインラインヒント付きで宣言されています: `[focus instructions]`。
2. インタラクティブな入力処理（`InputController`）では、`/handoff` または `/handoff ...` に一致するサブミットテキストが通常のプロンプトサブミット前にインターセプトされます。
3. エディターがクリアされ、`handleHandoffCommand(customInstructions?)` が呼び出されます。
4. `CommandController.handleHandoffCommand` は現在のエントリーを使用してプリフライトガードを実行します:
   - `type === "message"` のエントリー数をカウントします。
   - `< 2` の場合、警告を表示します: `Nothing to hand off (no messages yet)` として返ります。

同じ最小コンテンツガードが `AgentSession.handoff()` の内部にも存在し、条件を満たしていない場合にスローします。これにより、UI 層とセッション層の両方で安全性が重複して確保されています。

## エンドツーエンドのライフサイクル

### 1) ハンドオフ生成の開始

`AgentSession.handoff(customInstructions?)`:

- 現在のブランチエントリーを読み取ります（`sessionManager.getBranch()`）
- 最小メッセージ数を検証します（`>= 2`）
- `#handoffAbortController` を作成します
- 構造化されたハンドオフドキュメント（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）を要求する固定インラインプロンプトを構築します
- カスタム指示が提供された場合、`Additional focus: ...` を追加します

プロンプトは以下を通じて送信されます:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` は、この内部命令ペイロードに対するスラッシュ/プロンプトテンプレートの展開を防ぎます。

### 2) 補完のキャプチャ

プロンプト送信前に、`handoff()` はセッションイベントをサブスクライブし、`agent_end` を待機します。

`agent_end` の発生時、エージェント状態から最新の `assistant` メッセージを後方からスキャンして特定し、`type === "text"` のすべての `content` ブロックを `\n` で連結してハンドオフテキストを抽出します。

重要な抽出の前提:

- テキストブロックのみが使用されます。テキスト以外のコンテンツは無視されます。
- 最新のアシスタントメッセージがハンドオフ生成に対応すると仮定します。
- Markdown セクションの解析やフォーマット準拠の検証は行いません。
- アシスタント出力にテキストブロックがない場合、ハンドオフは欠落として扱われます。

### 3) キャンセルチェック

以下のいずれかの条件が成立した場合、`handoff()` は `undefined` を返します:

- キャプチャされたハンドオフテキストがない、または
- `#handoffAbortController.signal.aborted` が true である

`finally` では常に `#handoffAbortController` をクリアします。

### 4) 新規セッションの作成

テキストがキャプチャされ、かつアボートされていない場合:

1. 現在のセッションライターをフラッシュします（`sessionManager.flush()`）
2. 新しいセッションを開始します（`sessionManager.newSession()`）
3. インメモリのエージェント状態をリセットします（`agent.reset()`）
4. `agent.sessionId` を新しいセッション ID に再バインドします
5. キューに積まれたコンテキスト配列をクリアします（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. TODO リマインダーカウンターをリセットします

`newSession()` は新しいヘッダーと空のエントリーリストを作成します（リーフを `null` にリセット）。ハンドオフパスでは、`parentSession` は渡されません。

### 5) ハンドオフコンテキストの注入

生成されたハンドオフドキュメントはラップされ、`custom_message` エントリーとして新しいセッションに追加されます:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

挿入呼び出し:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

セマンティクス:

- `customType`: `"handoff"`
- `display`: `true`（TUI の再構築で表示される）
- エントリータイプ: `custom_message`（LLM コンテキストに参加する）

### 6) アクティブなエージェントコンテキストの再構築

注入後:

1. `sessionManager.buildSessionContext()` が現在のリーフのメッセージリストを解決します
2. `agent.replaceMessages(sessionContext.messages)` により注入されたハンドオフメッセージがアクティブコンテキストになります
3. メソッドは `{ document: handoffText }` を返します

この時点で、新しいセッション内のアクティブな LLM コンテキストには、古いトランスクリプトではなく注入されたハンドオフメッセージが含まれています。

## 永続化モデル: 旧セッション vs 新セッション

### 旧セッション

生成中、通常のメッセージ永続化はアクティブなままです。アシスタントのハンドオフレスポンスは `message_end` 時に通常の `message` エントリーとして永続化されます。

結果: 元のセッションには、生成された可視ハンドオフが履歴トランスクリプトの一部として含まれます。

### 新セッション

セッションリセット後、ハンドオフは `customType: "handoff"` の `custom_message` として永続化されます。

`buildSessionContext()` はこのエントリーを `createCustomMessage(...)` を通じてランタイムのカスタム/ユーザーコンテキストメッセージに変換するため、新セッションの将来のプロンプトに含まれます。

## コントローラー/UI の動作

`CommandController.handleHandoffCommand` の動作:

- `await session.handoff(customInstructions)` を呼び出します
- 結果が `undefined` の場合: `showError("Handoff cancelled")`
- 成功時:
  - `rebuildChatFromMessages()`（注入されたハンドオフを含む新セッションコンテキストを読み込む）
  - ステータスラインとエディタートップボーダーを無効化します
  - TODO をリロードします
  - 成功チャットラインを追加します: `New session started with handoff context`
- 例外発生時:
  - メッセージが `"Handoff cancelled"` またはエラー名が `AbortError` の場合: `showError("Handoff cancelled")`
  - それ以外: `showError("Handoff failed: <message>")`
- 最後にレンダリングをリクエストします

## キャンセルのセマンティクス（現在の動作）

### セッションレベルのキャンセルプリミティブ

`AgentSession` は以下を公開しています:

- `abortHandoff()` → `#handoffAbortController` をアボートします
- `isGeneratingHandoff` → コントローラーが存在している間は true

このアボートパスが使用されると、ハンドオフサブスクライバーは `Error("Handoff cancelled")` でリジェクトし、コマンドコントローラーはそれをキャンセル UI にマッピングします。

### インタラクティブな `/handoff` パスの制限

現在のインタラクティブコントローラーの配線では、`/handoff` は `abortHandoff()` を呼び出す専用の Escape ハンドラーをインストールしません（コンパクション/ブランチサマリーパスが一時的に `editor.onEscape` をオーバーライドするのとは異なります）。

実際の影響:

- セッションレベルのキャンセルサポートは存在しますが、`/handoff` コマンドパスにはハンドオフ専用のキーバインドフックがありません。
- ユーザーの割り込みはより広範なエージェントアボートパスを通じて発生する可能性がありますが、それは `abortHandoff()` が使用する明示的なキャンセルチャネルとは異なります。

## アボートされたハンドオフと失敗したハンドオフ

現在の UI の分類:

- **アボート/キャンセル**
  - `abortHandoff()` パスが `"Handoff cancelled"` をトリガーする、または
  - `AbortError` がスローされる
  - UI は `Handoff cancelled` を表示します

- **失敗**
  - `handoff()` / プロンプトパイプラインからスローされたその他のエラー（モデル/API バリデーションエラー、ランタイム例外など）
  - UI は `Handoff failed: ...` を表示します

追加の注意点: 生成が完了してもテキストが抽出されない場合、`handoff()` は `undefined` を返し、コントローラーは現在、**失敗**ではなく**キャンセル**として報告します。

## 短いセッションと最小コンテンツのガードレール

低シグナルなハンドオフを防ぐために 2 つのガードが設けられています:

- UI 層（`handleHandoffCommand`）: `< 2` のメッセージエントリーに対して警告を表示し、早期にリターンします
- セッション層（`handoff()`）: 同じ条件をエラーとしてスローします

これにより、空またはほぼ空のハンドオフコンテキストを持つ新セッションの作成を防ぎます。

## 状態遷移のサマリー

高レベルの状態フロー:

1. インタラクティブなスラッシュコマンドがインターセプトされる
2. プリフライトのメッセージカウントガード
3. `#handoffAbortController` が作成される（`isGeneratingHandoff = true`）
4. 内部ハンドオフプロンプトが送信される（通常のアシスタント生成としてチャットに表示される）
5. `agent_end` 時に最後のアシスタントテキストが抽出される
6. 欠落/アボートの場合 → `undefined` を返すか、キャンセルエラーパスへ
7. 存在する場合:
   - 旧セッションをフラッシュする
   - 新しい空のセッションを作成する
   - ランタイムキュー/カウンターをリセットする
   - `custom_message(handoff)` を追加する
   - アクティブなエージェントメッセージを再構築して置き換える
8. コントローラーがチャット UI を再構築し、成功を通知する
9. `#handoffAbortController` がクリアされる（`isGeneratingHandoff = false`）

## 既知の前提と制限事項

- ハンドオフの抽出はヒューリスティックです: 「最後のアシスタントテキストブロック」であり、構造的な検証は行われません。
- 生成された Markdown が要求されたセクションフォーマットに従っているかの厳密なチェックはありません。
- 抽出されたテキストが欠落している場合、コントローラーの UX ではキャンセルとして報告されます。
- `/handoff` インタラクティブフローには現在、専用の Escape→`abortHandoff()` バインディングがありません。
- 新セッションの系譜メタデータ（`parentSession`）はこのパスでは設定されません。
