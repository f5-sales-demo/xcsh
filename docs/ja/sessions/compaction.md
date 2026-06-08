---
title: コンパクションとブランチサマリー
description: 長時間セッションにおけるコンテキストウィンドウのコンパクションとブランチサマリー生成。
sidebar:
  order: 5
  label: コンパクション
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# コンパクションとブランチサマリー

コンパクションとブランチサマリーは、過去の作業コンテキストを失うことなく長時間セッションを使い続けられるようにする2つのメカニズムです。

- **コンパクション**は、現在のブランチ上で古い履歴をサマリーに書き換えます。
- **ブランチサマリー**は、`/tree` ナビゲーション時に放棄されたブランチのコンテキストをキャプチャします。

どちらもセッションエントリとして永続化され、LLM入力の再構築時にユーザーコンテキストメッセージに変換されます。

## 主要な実装ファイル

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## セッションエントリモデル

コンパクションとブランチサマリーは、通常のassistant/userメッセージではなく、ファーストクラスのセッションエントリです。

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`、オプションの `shortSummary`
  - `firstKeptEntryId`（コンパクション境界）
  - `tokensBefore`
  - オプションの `details`、`preserveData`、`fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`、`summary`
  - オプションの `details`、`fromExtension`

コンテキストが再構築される場合（`buildSessionContext`）：

1. アクティブパス上の最新のコンパクションが1つの `compactionSummary` メッセージに変換されます。
2. `firstKeptEntryId` からコンパクションポイントまでの保持されたエントリが再度含まれます。
3. パス上のそれ以降のエントリが追加されます。
4. `branch_summary` エントリが `branchSummary` メッセージに変換されます。
5. `custom_message` エントリが `custom` メッセージに変換されます。

これらのカスタムロールは、`convertToLlm()` で静的テンプレートを使用してLLM向けのユーザーメッセージに変換されます：

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## コンパクションパイプライン

### トリガー

コンパクションは3つの方法で実行できます：

1. **手動**: `/compact [instructions]` が `AgentSession.compact(...)` を呼び出します。
2. **自動オーバーフロー回復**: コンテキストオーバーフローに一致するアシスタントエラーの後。
3. **自動閾値コンパクション**: コンテキストが閾値を超えた場合の成功ターンの後。

### コンパクションの形状（ビジュアル）

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### オーバーフロー再試行と閾値コンパクション

2つの自動パスは意図的に異なります：

- **オーバーフロー再試行コンパクション**
  - トリガー: 現在のモデルのアシスタントエラーがコンテキストオーバーフローとして検出された場合。
  - 失敗したアシスタントエラーメッセージは、再試行前にアクティブなエージェント状態から削除されます。
  - 自動コンパクションが `reason: "overflow"` および `willRetry: true` で実行されます。
  - 成功時、コンパクション後にエージェントが自動的に続行します（`agent.continue()`）。

- **閾値コンパクション**
  - トリガー: `contextTokens > contextWindow - compaction.reserveTokens`。
  - `reason: "threshold"` および `willRetry: false` で実行されます。
  - 成功時、`compaction.autoContinue !== false` の場合、合成プロンプトが注入されます：
    - `"Continue if you have next steps."`

### コンパクション前のプルーニング

コンパクションチェックの前に、ツール結果のプルーニングが実行される場合があります（`pruneToolOutputs`）。

デフォルトのプルーニングポリシー：

- 最新の `40_000` トークンのツール出力を保護します。
- 合計で少なくとも `20_000` トークンの推定節約が必要です。
- `skill` または `read` からのツール結果は絶対にプルーニングしません。

プルーニングされたツール結果は以下に置き換えられます：

- `[Output truncated - N tokens]`

プルーニングによってエントリが変更された場合、セッションストレージが書き換えられ、コンパクション判断の前にエージェントのメッセージ状態がリフレッシュされます。

### 境界とカットポイントのロジック

`prepareCompaction()` は、最後のコンパクションエントリ（存在する場合）以降のエントリのみを考慮します。

1. 前回のコンパクションインデックスを検索します。
2. `boundaryStart = prevCompactionIndex + 1` を計算します。
3. 利用可能な場合、測定された使用率を使用して `keepRecentTokens` を調整します。
4. 境界ウィンドウに対して `findCutPoint()` を実行します。

有効なカットポイントには以下が含まれます：

- ロールが `user`、`assistant`、`bashExecution`、`hookMessage`、`branchSummary`、`compactionSummary` のメッセージエントリ
- `custom_message` エントリ
- `branch_summary` エントリ

ハードルール: `toolResult` でカットすることはありません。

カットポイントの直前にメッセージ以外のメタデータエントリ（`model_change`、`thinking_level_change`、ラベルなど）がある場合、メッセージまたはコンパクション境界に到達するまでカットインデックスを後方に移動して、保持領域に含めます。

### スプリットターン処理

カットポイントがユーザーターンの開始位置でない場合、コンパクションはそれをスプリットターンとして扱います。

ターン開始の検出では、以下をユーザーターンの境界として扱います：

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` エントリ
- `branch_summary` エントリ

スプリットターンコンパクションは2つのサマリーを生成します：

1. 履歴サマリー（`messagesToSummarize`）
2. ターンプレフィックスサマリー（`turnPrefixMessages`）

最終的に保存されるサマリーは以下のように統合されます：

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### サマリー生成

`compact(...)` はシリアライズされた会話テキストからサマリーを構築します：

1. `convertToLlm()` でメッセージを変換します。
2. `serializeConversation()` でシリアライズします。
3. `<conversation>...</conversation>` でラップします。
4. オプションで `<previous-summary>...</previous-summary>` を含めます。
5. オプションでフックコンテキストを `<additional-context>` リストとして注入します。
6. `SUMMARIZATION_SYSTEM_PROMPT` で要約プロンプトを実行します。

プロンプトの選択：

- 初回コンパクション: `compaction-summary.md`
- 前回のサマリーがある反復コンパクション: `compaction-update-summary.md`
- スプリットターンの2回目パス: `compaction-turn-prefix.md`
- 短いUIサマリー: `compaction-short-summary.md`

リモート要約モード：

- `compaction.remoteEndpoint` が設定されている場合、コンパクションは以下をPOSTします：
  - `{ systemPrompt, prompt }`
- 少なくとも `{ summary }` を含むJSONが期待されます。

### サマリーにおけるファイル操作コンテキスト

コンパクションは、アシスタントのツール呼び出しを使用して累積的なファイルアクティビティを追跡します：

- `read(path)` → 読み取りセット
- `write(path)` → 変更セット
- `edit(path)` → 変更セット

累積動作：

- 前回のエントリがpi生成（`fromExtension !== true`）の場合のみ、前回のコンパクション詳細を含めます。
- スプリットターンでは、ターンプレフィックスのファイル操作も含めます。
- `readFiles` は変更されたファイルを除外します。

サマリーテキストには、プロンプトテンプレート経由でファイルタグが追加されます：

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### 永続化と再読み込み

サマリー生成（またはフック提供のサマリー）の後、エージェントセッションは：

1. `appendCompaction(...)` で `CompactionEntry` を追加します。
2. `buildSessionContext()` でコンテキストを再構築します。
3. ライブエージェントメッセージを再構築されたコンテキストに置き換えます。
4. `session_compact` フックイベントを発行します。

## ブランチ要約パイプライン

ブランチ要約はトークンオーバーフローではなく、ツリーナビゲーションに関連付けられています。

### トリガー

`navigateTree(...)` 中：

1. `collectEntriesForBranchSummary(...)` を使用して、古いリーフから共通祖先までの放棄されたエントリを計算します。
2. 呼び出し元がサマリーを要求した場合（`options.summarize`）、リーフを切り替える前にサマリーを生成します。
3. サマリーが存在する場合、`branchWithSummary(...)` を使用してナビゲーションターゲットに添付します。

これは通常、`branchSummary.enabled` が有効な場合に `/tree` フローによって駆動されます。

### ブランチ切り替えの形状（ビジュアル）

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### 準備とトークンバジェット

`generateBranchSummary(...)` は以下のようにバジェットを計算します：

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` は以下を実行します：

1. 最初のパス: 前回のpi生成 `branch_summary` の詳細を含む、すべての要約対象エントリから累積ファイル操作を収集します。
2. 2回目のパス: 最新→最古の順にウォークし、トークンバジェットに達するまでメッセージを追加します。
3. 最近のコンテキストの保持を優先します。
4. 継続性のために、バジェット境界付近の大きなサマリーエントリを含める場合があります。

コンパクションエントリは、ブランチ要約入力時にメッセージ（`compactionSummary`）として含まれます。

### サマリー生成と永続化

ブランチ要約は：

1. 選択されたメッセージを変換およびシリアライズします。
2. `<conversation>` でラップします。
3. カスタム指示が提供されている場合はそれを使用し、そうでなければ `branch-summary.md` を使用します。
4. `SUMMARIZATION_SYSTEM_PROMPT` で要約モデルを呼び出します。
5. `branch-summary-preamble.md` を先頭に追加します。
6. ファイル操作タグを追加します。

結果はオプションの詳細（`readFiles`、`modifiedFiles`）を持つ `BranchSummaryEntry` として保存されます。

## 拡張機能とフックのタッチポイント

### `session_before_compact`

コンパクション前のフック。

以下が可能です：

- コンパクションのキャンセル（`{ cancel: true }`）
- 完全なカスタムコンパクションペイロードの提供（`{ compaction: CompactionResult }`）

### `session.compacting`

デフォルトコンパクションのプロンプト/コンテキストカスタマイズフック。

以下を返すことができます：

- `prompt`（基本サマリープロンプトのオーバーライド）
- `context`（`<additional-context>` に注入される追加コンテキスト行）
- `preserveData`（コンパクションエントリに保存される）

### `session_compact`

保存された `compactionEntry` と `fromExtension` フラグを含むコンパクション後の通知。

### `session_before_tree`

デフォルトのブランチサマリー生成前に、ツリーナビゲーション時に実行されます。

以下が可能です：

- ナビゲーションのキャンセル
- ユーザーが要約を要求した場合に使用されるカスタム `{ summary: { summary, details } }` の提供

### `session_tree`

新しい/古いリーフとオプションのサマリーエントリを公開するナビゲーション後のイベント。

## ランタイムの動作と障害セマンティクス

- 手動コンパクションは、最初に現在のエージェント操作を中止します。
- `abortCompaction()` は、手動と自動の両方のコンパクションコントローラーをキャンセルします。
- 自動コンパクションは、UI/状態更新のために開始/終了セッションイベントを発行します。
- 自動コンパクションは、複数のモデル候補を試行し、一時的な障害を再試行できます。
- オーバーフローエラーは、コンパクションによって処理されるため、汎用的な再試行パスから除外されます。
- 自動コンパクションが失敗した場合：
  - オーバーフローパスは `Context overflow recovery failed: ...` を発行します
  - 閾値パスは `Auto-compaction failed: ...` を発行します
- ブランチ要約は、中止シグナル（例：Escape）によりキャンセルでき、キャンセル/中止されたナビゲーション結果を返します。

## 設定とデフォルト値

`settings-schema.ts` より：

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

これらの値は、`AgentSession` およびコンパクション/ブランチ要約モジュールによって実行時に使用されます。
