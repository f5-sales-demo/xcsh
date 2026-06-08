---
title: Tree コマンドリファレンス
description: セッション履歴と会話ブランチを視覚化するための /tree コマンドリファレンス。
sidebar:
  order: 4
  label: /tree コマンド
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree` コマンドリファレンス

`/tree` はインタラクティブな**セッションツリー**ナビゲーターを開きます。現在のセッションファイル内の任意のエントリにジャンプし、そのポイントから続行できます。

これはファイル内のリーフ移動であり、新しいセッションのエクスポートではありません。

## `/tree` の機能

- 現在のセッションエントリからツリーを構築します（`SessionManager.getTree()`）
- キーボードナビゲーション、フィルター、検索機能を持つ `TreeSelectorComponent` を開きます
- 選択時に `AgentSession.navigateTree(targetId, { summarize, customInstructions })` を呼び出します
- 新しいリーフパスから表示チャットを再構築します
- ユーザー/カスタムメッセージを選択した場合、オプションでエディターテキストをプリフィルします

主な実装：

- `src/modes/controllers/input-controller.ts`（`/tree`、キーバインドの配線、ダブルエスケープの動作）
- `src/modes/controllers/selector-controller.ts`（ツリー UI の起動 + サマリープロンプトフロー）
- `src/modes/components/tree-selector.ts`（ナビゲーション、フィルター、検索、ラベル、レンダリング）
- `src/session/agent-session.ts`（`navigateTree` リーフ切り替え + オプションのサマリー）
- `src/session/session-manager.ts`（`getTree`、`branch`、`branchWithSummary`、`resetLeaf`、ラベルの永続化）

## 開き方

以下のいずれかで同じセレクターが開きます：

- `/tree`
- 設定されたキーバインドアクション `tree`
- `doubleEscapeAction = "tree"`（デフォルト）の場合、空のエディターでダブルエスケープ
- `doubleEscapeAction = "tree"` の場合の `/branch`（ユーザー専用ブランチピッカーの代わりにツリーセレクターにルーティングされます）

## ツリー UI モデル

ツリーはセッションエントリの親ポインター（`id` / `parentId`）からレンダリングされます。

- 子はタイムスタンプの昇順でソートされます（古いものが先、新しいものが下）
- アクティブブランチ（ルートから現在のリーフまでのパス）はバレットでマークされます
- ラベル（存在する場合）はノードテキストの前に `[label]` としてレンダリングされます
- 複数のルートが存在する場合（孤立した/壊れた親チェーン）、仮想分岐ルートの下に表示されます

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

セレクターは現在の選択を中心に再配置し、最大で以下の行数を表示します：

- `max(5, floor(terminalHeight / 2))` 行

## ツリーセレクター内のキーバインド

- `Up` / `Down`：選択を移動（ラップあり）
- `Left` / `Right`：ページアップ / ページダウン
- `Enter`：ノードを選択
- `Esc`：検索がアクティブな場合はクリア、それ以外はセレクターを閉じる
- `Ctrl+C`：セレクターを閉じる
- `Type`：検索クエリに追加
- `Backspace`：検索文字を削除
- `Shift+L`：選択されたエントリのラベルを編集/クリア
- `Ctrl+O`：フィルターを前方にサイクル
- `Shift+Ctrl+O`：フィルターを後方にサイクル
- `Alt+D/T/U/L/A`：特定のフィルターモードに直接ジャンプ

## フィルターと検索のセマンティクス

フィルターモード（`TreeList`）：

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

ほとんどの会話ノードを表示しますが、以下の管理用エントリタイプは非表示にします：

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

`default` と同じですが、さらに `toolResult` メッセージを非表示にします。

### `user-only`

ロールが `user` の `message` エントリのみ。

### `labeled-only`

現在ラベルに解決されるエントリのみ。

### `all`

管理/カスタムエントリを含む、セッションツリー内のすべて。

### ツールのみのアシスタントノードの動作

**ツール呼び出しのみ**（テキストなし）を含むアシスタントメッセージは、以下の場合を除き、すべてのフィルタービューでデフォルトで非表示になります：

- メッセージがエラー/中断である場合（`stopReason` が `stop`/`toolUse` でない）、または
- 現在のリーフである場合（常に表示を維持）

### 検索動作

- クエリはスペースでトークン化されます
- マッチングは大文字小文字を区別しません
- すべてのトークンが一致する必要があります（AND セマンティクス）
- 検索対象テキストには、ラベル、ロール、タイプ固有のコンテンツ（メッセージテキスト、ブランチサマリーテキスト、カスタムタイプ、ツールコマンドスニペットなど）が含まれます

## 選択の結果（重要）

`navigateTree` は選択されたエントリタイプから新しいリーフの動作を計算します：

### `user` メッセージの選択

- 新しいリーフは選択されたエントリの `parentId` になります
- 親が `null` の場合（ルートユーザーメッセージ）、リーフはルートにリセットされます（`resetLeaf()`）
- 選択されたメッセージテキストは編集/再送信のためにエディターにコピーされます

### `custom_message` の選択

- ユーザーメッセージと同じリーフルール（`parentId`）
- テキストコンテンツが抽出されてエディターにコピーされます

### 非ユーザーノードの選択（assistant/tool/summary/compaction/カスタム管理/など）

- 新しいリーフは選択されたノード ID になります
- エディターはプリフィルされません

### 現在のリーフの選択

- 何も起こりません。セレクターは「Already at this point」で閉じます

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## 切り替え時のサマリーフロー

サマリープロンプトは `branchSummary.enabled`（デフォルト：`false`）で制御されます。

有効な場合、ノードを選択した後に UI が以下を尋ねます：

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

フローの詳細：

- サマリープロンプトでエスケープするとツリーセレクターが再度開きます
- カスタムプロンプトのキャンセルはサマリー選択ループに戻ります
- サマリー作成中、UI はローダーを表示し `Esc` を `abortBranchSummary()` にバインドします
- サマリー作成が中断された場合、ツリーセレクターが再度開き、移動は適用されません

`navigateTree` の内部：

- 古いリーフから共通祖先までの放棄されたブランチエントリを収集します
- `session_before_tree` を発行します（拡張機能がキャンセルまたはサマリーを注入可能）
- リクエストされ必要な場合のみデフォルトのサマライザーを使用します
- 以下で移動を適用します：
  - サマリーが存在する場合は `branchWithSummary(...)`
  - サマリーなしの非ルート移動の場合は `branch(newLeafId)`
  - サマリーなしのルート移動の場合は `resetLeaf()`
- エージェントの会話を再構築されたセッションコンテキストで置換します
- `session_tree` を発行します

注意：ユーザーがサマリーをリクエストしても要約するものがない場合、サマリーエントリを作成せずにナビゲーションが進行します。

## ラベル

ツリー UI でのラベル編集は `appendLabelChange(targetId, label)` を呼び出します。

- 空でないラベルは解決されたラベルを設定/更新します
- 空のラベルはクリアします
- ラベルは追記専用の `label` エントリとして保存されます
- ツリーノードは生のラベルエントリ履歴ではなく、解決されたラベル状態を表示します

## `/tree` と隣接操作の比較

| 操作 | スコープ | 結果 |
|---|---|---|
| `/tree` | 現在のセッションファイル | 選択したポイントにリーフを移動（同じファイル） |
| `/branch` | 通常は現在のセッションファイル -> 新しいセッションファイル | デフォルトでは選択した**ユーザー**メッセージから新しいセッションファイルにブランチ。`doubleEscapeAction = "tree"` の場合、`/branch` は代わりにツリーナビゲーション UI を開きます |
| `/fork` | 現在のセッション全体 | セッションを新しい永続化されたセッションファイルに複製 |
| `/resume` | セッションリスト | 別のセッションファイルに切り替え |

重要な違い：`/tree` は1つのセッションファイル内のナビゲーション/再配置ツールです。`/branch`、`/fork`、`/resume` はすべてセッションファイルのコンテキストを変更します。

## オペレーターワークフロー

### 現在のブランチを失わずに以前のユーザープロンプトから再実行

1. `/tree`
2. 以前のユーザーメッセージを検索/選択
3. `No summary` を選択（必要に応じてサマリーを選択）
4. エディターのプリフィルされたテキストを編集
5. 送信

効果：同じセッションファイル内で選択したポイントから新しいブランチが成長します。

### コンテキストのブレッドクラムを残して現在のブランチから離脱

1. `branchSummary.enabled` を有効にする
2. `/tree` でターゲットノードを選択
3. `Summarize`（またはカスタムプロンプト）を選択

効果：続行する前にターゲット位置に `branch_summary` エントリが追加されます。

### 非表示の管理用エントリを調査

1. `/tree`
2. `Alt+A`（all）を押す
3. `model`、`thinking`、`custom`、またはラベルを検索

効果：会話ノードだけでなく、完全な内部タイムラインを確認できます。

### 後でジャンプするためにピボットポイントをブックマーク

1. `/tree`
2. エントリに移動
3. `Shift+L` でラベルを設定
4. 後で `Alt+L`（`labeled-only`）を使って素早くジャンプ

効果：永続的なブランチランドマーク間の高速ナビゲーション。
