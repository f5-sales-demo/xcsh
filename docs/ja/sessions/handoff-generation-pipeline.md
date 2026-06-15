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

本ドキュメントでは、コーディングエージェントが現時点で `/handoff` を実装する方法について説明します。トリガーパス、生成プロンプト、補完キャプチャ、セッション切り替え、コンテキスト再注入を対象とします。

## 対象範囲

対象:

- インタラクティブな `/handoff` コマンドディスパッチ
- `AgentSession.handoff()` のライフサイクルと状態遷移
- ハンドオフ出力がアシスタント出力からキャプチャされる方法
- 旧セッションと新セッションがハンドオフデータを永続化する際の違い
- 成功・キャンセル・失敗時のUI動作

対象外:

- 汎用ツリーナビゲーション／ブランチ内部
- ハンドオフ以外のセッションコマンド（`/new`、`/fork`、`/resume`）

## 実装ファイル

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## トリガーパス

1. `/handoff` はビルトインのスラッシュコマンドメタデータ（`slash-commands.ts`）にオプションのインラインヒント `[focus instructions]` 付きで宣言されます。
2. インタラクティブな入力処理（`InputController`）において、`/handoff` または `/handoff ...` に一致する送信テキストが通常のプロンプト送信前にインターセプトされます。
3. エディターがクリアされ、`handleHandoffCommand(customInstructions?)` が呼び出されます。
4. `CommandController.handleHandoffCommand` は現在のエントリーを使用してプリフライトガードを実行します:
   - `type === "message"` のエントリー数をカウントします。
   - `< 2` の場合、`Nothing to hand off (no messages yet)` と警告して返ります。

同じ最小コンテンツガードが `AgentSession.handoff()` 内にも存在し、違反時はスローされます。これによりUIとセッション両レイヤーで安全性が二重化されます。

## エンドツーエンドのライフサイクル

### 1) ハンドオフ生成の開始

`AgentSession.handoff(customInstructions?)`:

- 現在のブランチエントリーを読み込む（`sessionManager.getBranch()`）
- 最小メッセージ数を検証する（`>= 2`）
- `#handoffAbortController` を作成する
- 構造化されたハンドオフドキュメント（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）を要求する固定のインラインプロンプトを構築する
- カスタム指示が指定されている場合は `Additional focus: ...` を追加する

プロンプトは以下の方法で送信されます:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` により、この内部指示ペイロードに対するスラッシュ／プロンプトテンプレート展開が防止されます。

### 2) 補完のキャプチャ

プロンプト送信前に、`handoff()` がセッションイベントをサブスクライブして `agent_end` を待機します。

`agent_end` 時に、エージェントの状態から最新の `assistant` メッセージを逆順でスキャンし、`type === "text"` のすべての `content` ブロックを `\n` で連結することでハンドオフテキストを抽出します。

抽出に関する重要な前提条件:

- テキストブロックのみが使用され、非テキストコンテンツは無視されます。
- 最新のアシスタントメッセージがハンドオフ生成に対応していることを前提としています。
- マークダウンセクションのパースやフォーマット適合性の検証は行いません。
- アシスタント出力にテキストブロックがない場合、ハンドオフは欠損として扱われます。

### 3) キャンセルチェック

以下のいずれかの条件が成立した場合、`handoff()` は `undefined` を返します:

- キャプチャされたハンドオフテキストがない、または
- `#handoffAbortController.signal.aborted` が true である

`finally` 内で常に `#handoffAbortController` がクリアされます。

### 4) 新セッションの作成

テキストがキャプチャされ、かつ中断されていない場合:

1. 現在のセッションライターをフラッシュする（`sessionManager.flush()`）
2. 新しいセッションを開始する（`sessionManager.newSession()`）
3. インメモリのエージェント状態をリセットする（`agent.reset()`）
4. `agent.sessionId` を新しいセッションIDに再バインドする
5. キューに入ったコンテキスト配列をクリアする（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. Todoリマインダーカウンターをリセットする

`newSession()` は新しいヘッダーと空のエントリーリスト（リーフを `null` にリセット）を作成します。ハンドオフパスでは `parentSession` は渡されません。

### 5) ハンドオフコンテキストの注入

生成されたハンドオフドキュメントはラップされ、新しいセッションに `custom_message` エントリーとして追加されます:

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
- `display`: `true`（TUIリビルドで表示される）
- エントリータイプ: `custom_message`（LLMコンテキストに参加する）

### 6) アクティブなエージェントコンテキストの再構築

注入後:

1. `sessionManager.buildSessionContext()` が現在のリーフのメッセージリストを解決する
2. `agent.replaceMessages(sessionContext.messages)` により注入されたハンドオフメッセージがアクティブコンテキストになる
3. メソッドが `{ document: handoffText }` を返す

この時点で、新しいセッションのアクティブなLLMコンテキストには、旧セッションのトランスクリプトではなく、注入されたハンドオフメッセージが含まれます。

## 永続化モデル: 旧セッションと新セッション

### 旧セッション

生成中は通常のメッセージ永続化が有効なままです。アシスタントのハンドオフレスポンスは `message_end` 時に通常の `message` エントリーとして永続化されます。

結果: 元のセッションには、履歴トランスクリプトの一部として生成されたハンドオフが表示されます。

### 新セッション

セッションリセット後、ハンドオフは `customType: "handoff"` の `custom_message` として永続化されます。

`buildSessionContext()` はこのエントリーを `createCustomMessage(...)` 経由でランタイムのカスタム／ユーザーコンテキストメッセージに変換するため、新セッションの以降のプロンプトに含まれます。

## コントローラー／UI動作

`CommandController.handleHandoffCommand` の動作:

- `await session.handoff(customInstructions)` を呼び出す
- 結果が `undefined` の場合: `showError("Handoff cancelled")`
- 成功時:
  - `rebuildChatFromMessages()`（注入されたハンドオフを含む新しいセッションコンテキストを読み込む）
  - ステータスラインとエディタートップボーダーを無効化する
  - Todoをリロードする
  - 成功チャットラインを追加する: `New session started with handoff context`
- 例外発生時:
  - メッセージが `"Handoff cancelled"` またはエラー名が `AbortError` の場合: `showError("Handoff cancelled")`
  - それ以外: `showError("Handoff failed: <message>")`
- 最後にレンダリングを要求する

## キャンセルセマンティクス（現在の動作）

### セッションレベルのキャンセルプリミティブ

`AgentSession` が公開するもの:

- `abortHandoff()` → `#handoffAbortController` を中断する
- `isGeneratingHandoff` → コントローラーが存在する間は true

この中断パスが使用された場合、ハンドオフサブスクライバーは `Error("Handoff cancelled")` で拒否され、コマンドコントローラーがキャンセルUIにマッピングします。

### インタラクティブな `/handoff` パスの制限

現在のインタラクティブコントローラーの配線では、`/handoff` は `abortHandoff()` を呼び出す専用のEscapeハンドラーをインストールしません（コンパクション／ブランチサマリーパスが一時的に `editor.onEscape` をオーバーライドするのとは異なります）。

実際の影響:

- セッションレベルのキャンセルサポートは存在しますが、`/handoff` コマンドパスにはハンドオフ専用のキーバインドフックがありません。
- ユーザーの中断は広範なエージェント中断パスを通じて発生する可能性がありますが、それは `abortHandoff()` が使用する明示的なキャンセルチャンネルとは異なります。

## 中断と失敗の違い

現在のUI分類:

- **中断／キャンセル**
  - `abortHandoff()` パスが `"Handoff cancelled"` をトリガーする、または
  - `AbortError` がスローされる
  - UIには `Handoff cancelled` と表示される

- **失敗**
  - `handoff()` ／プロンプトパイプライン（モデル／API検証エラー、ランタイム例外など）からスローされるその他のエラー
  - UIには `Handoff failed: ...` と表示される

追加の注意点: 生成が完了してもテキストが抽出されなかった場合、`handoff()` は `undefined` を返し、コントローラーは現在**失敗**ではなく**キャンセル**として報告します。

## 短セッションおよび最小コンテンツのガードレール

低シグナルなハンドオフを防ぐための2つのガード:

- UIレイヤー（`handleHandoffCommand`）: `< 2` のメッセージエントリーに対して警告し早期リターンする
- セッションレイヤー（`handoff()`）: 同じ条件をエラーとしてスローする

これにより、空または空に近いハンドオフコンテキストで新しいセッションが作成されることを防ぎます。

## 状態遷移サマリー

高レベルの状態フロー:

1. インタラクティブなスラッシュコマンドがインターセプトされる
2. プリフライトのメッセージ数ガード
3. `#handoffAbortController` が作成される（`isGeneratingHandoff = true`）
4. 内部ハンドオフプロンプトが送信される（通常のアシスタント生成としてチャットに表示される）
5. `agent_end` 時に最新のアシスタントテキストが抽出される
6. 欠損または中断の場合 → `undefined` を返すかキャンセルエラーパスへ
7. 存在する場合:
   - 旧セッションをフラッシュする
   - 新しい空のセッションを作成する
   - ランタイムキュー／カウンターをリセットする
   - `custom_message(handoff)` を追加する
   - アクティブなエージェントメッセージを再構築して置き換える
8. コントローラーがチャットUIを再構築して成功を通知する
9. `#handoffAbortController` がクリアされる（`isGeneratingHandoff = false`）

## 既知の前提条件と制限事項

- ハンドオフ抽出はヒューリスティック（「最後のアシスタントテキストブロック」）であり、構造的な検証は行われません。
- 生成されたマークダウンが要求されたセクションフォーマットに従っているかどうかのハードチェックはありません。
- 抽出されたテキストが欠損している場合、コントローラーのUXではキャンセルとして報告されます。
- `/handoff` のインタラクティブフローには現在、専用のEscape→`abortHandoff()` バインディングがありません。
- このパスでは新セッションの系譜メタデータ（`parentSession`）は設定されません。
