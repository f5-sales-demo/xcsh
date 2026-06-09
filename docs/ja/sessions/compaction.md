---
title: コンパクションとブランチサマリー
description: 長期セッションにおけるコンテキストウィンドウのコンパクションとブランチサマリー生成。
sidebar:
  order: 5
  label: コンパクション
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# コンパクションとブランチサマリー

コンパクションとブランチサマリーは、過去の作業コンテキストを失うことなく長期セッションを使い続けるための2つのメカニズムです。

- **コンパクション**は、現在のブランチ上で古い履歴をサマリーに書き換えます。
- **ブランチサマリー**は、`/tree` ナビゲーション中に放棄されたブランチのコンテキストをキャプチャします。

どちらもセッションエントリとして永続化され、LLM入力を再構築する際にユーザーコンテキストメッセージに変換されます。

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

コンパクションとブランチサマリーはファーストクラスのセッションエントリであり、通常のassistant/userメッセージではありません。

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

コンテキストが再構築される際（`buildSessionContext`）：

1. アクティブパス上の最新のコンパクションが1つの `compactionSummary` メッセージに変換されます。
2. `firstKeptEntryId` からコンパクションポイントまでの保持されたエントリが再度含まれます。
3. パス上のそれ以降のエントリが追加されます。
4. `branch_summary` エントリが `branchSummary` メッセージに変換されます。
5. `custom_message` エントリが `custom` メッセージに変換されます。

これらのカスタムロールは、`convertToLlm()` で静的テンプレートを使用してLLM向けのuserメッセージに変換されます：

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## コンパクションパイプライン

### トリガー

コンパクションは3つの方法で実行できます：

1. **手動**: `/compact [instructions]` が `AgentSession.compact(...)` を呼び出します。
2. **自動オーバーフローリカバリー**: コンテキストオーバーフローに一致するアシスタントエラーの後。
3. **自動閾値コンパクション**: コンテキストが閾値を超えた際の成功したターンの後。

### コンパクションの形状（図解）

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

### オーバーフローリトライと閾値コンパクション

2つの自動パスは意図的に異なります：

- **オーバーフローリトライコンパクション**
  - トリガー: 現在のモデルのアシスタントエラーがコンテキストオーバーフローとして検出された場合。
  - 失敗したアシスタントエラーメッセージは、リトライ前にアクティブなエージェント状態から削除されます。
  - 自動コンパクションが `reason: "overflow"` および `willRetry: true` で実行されます。
  - 成功すると、コンパクション後にエージェントが自動的に継続します（`agent.continue()`）。

- **閾値コンパクション**
  - トリガー: `contextTokens > contextWindow - compaction.reserveTokens`。
  - `reason: "threshold"` および `willRetry: false` で実行されます。
  - 成功すると、`compaction.autoContinue !== false` の場合、合成プロンプトが注入されます：
    - `"Continue if you have next steps."`

### コンパクション前のプルーニング

コンパクションチェックの前に、ツール結果のプルーニングが実行される場合があります（`pruneToolOutputs`）。

デフォルトのプルーニングポリシー：

- 最新の `40_000` トークンのツール出力を保護。
- 合計推定削減量が少なくとも `20_000` 必要。
- `skill` または `read` のツール結果は決してプルーニングしない。

プルーニングされたツール結果は以下に置き換えられます：

- `[Output truncated - N tokens]`

プルーニングによりエントリが変更された場合、セッションストレージが書き換えられ、コンパクション判断の前にエージェントメッセージ状態がリフレッシュされます。

### 境界とカットポイントのロジック

`prepareCompaction()` は、最後のコンパクションエントリ（存在する場合）以降のエントリのみを考慮します。

1. 前回のコンパクションインデックスを検索。
2. `boundaryStart = prevCompactionIndex + 1` を計算。
3. 利用可能な場合、測定された使用率を使用して `keepRecentTokens` を調整。
4. 境界ウィンドウに対して `findCutPoint()` を実行。

有効なカットポイントには以下が含まれます：

- 以下のロールを持つメッセージエントリ: `user`、`assistant`、`bashExecution`、`hookMessage`、`branchSummary`、`compactionSummary`
- `custom_message` エントリ
- `branch_summary` エントリ

ハードルール: `toolResult` でカットしないこと。

カットポイントの直前に非メッセージメタデータエントリ（`model_change`、`thinking_level_change`、ラベルなど）がある場合、メッセージまたはコンパクション境界に到達するまでカットインデックスを後方に移動して、それらを保持領域に引き込みます。

### スプリットターンの処理

カットポイントがユーザーターンの開始位置にない場合、コンパクションはそれをスプリットターンとして扱います。

ターン開始の検出では、以下をユーザーターンの境界として扱います：

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` エントリ
- `branch_summary` エントリ

スプリットターンコンパクションは2つのサマリーを生成します：

1. 履歴サマリー（`messagesToSummarize`）
2. ターンプレフィックスサマリー（`turnPrefixMessages`）

最終的に保存されるサマリーは以下のようにマージされます：

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### サマリー生成

`compact(...)` はシリアライズされた会話テキストからサマリーを構築します：

1. `convertToLlm()` でメッセージを変換。
2. `serializeConversation()` でシリアライズ。
3. `<conversation>...</conversation>` でラップ。
4. オプションで `<previous-summary>...</previous-summary>` を含める。
5. オプションでフックコンテキストを `<additional-context>` リストとして注入。
6. `SUMMARIZATION_SYSTEM_PROMPT` で要約プロンプトを実行。

プロンプトの選択：

- 初回コンパクション: `compaction-summary.md`
- 前回のサマリーがある反復コンパクション: `compaction-update-summary.md`
- スプリットターンの2回目のパス: `compaction-turn-prefix.md`
- 短いUI用サマリー: `compaction-short-summary.md`

リモート要約モード：

- `compaction.remoteEndpoint` が設定されている場合、コンパクションは以下をPOSTします：
  - `{ systemPrompt, prompt }`
- 少なくとも `{ summary }` を含むJSONを期待します。

### サマリー内のファイル操作コンテキスト

コンパクションは、アシスタントのツール呼び出しを使用して累積的なファイルアクティビティを追跡します：

- `read(path)` → 読み取りセット
- `write(path)` → 変更セット
- `edit(path)` → 変更セット

累積的な動作：

- 前回のエントリがpi生成（`fromExtension !== true`）の場合のみ、前回のコンパクション詳細を含めます。
- スプリットターンでは、ターンプレフィックスのファイル操作も含めます。
- `readFiles` は変更されたファイルを除外します。

サマリーテキストには、プロンプトテンプレートを通じてファイルタグが追加されます：

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### 永続化とリロード

サマリー生成（またはフック提供のサマリー）の後、エージェントセッションは：

1. `appendCompaction(...)` で `CompactionEntry` を追加。
2. `buildSessionContext()` でコンテキストを再構築。
3. ライブエージェントメッセージを再構築されたコンテキストで置換。
4. `session_compact` フックイベントを発行。

## ブランチ要約パイプライン

ブランチ要約はトークンオーバーフローではなく、ツリーナビゲーションに紐づいています。

### トリガー

`navigateTree(...)` の実行中：

1. `collectEntriesForBranchSummary(...)` を使用して、古いリーフから共通祖先までの放棄されたエントリを計算。
2. 呼び出し元がサマリーを要求した場合（`options.summarize`）、リーフを切り替える前にサマリーを生成。
3. サマリーが存在する場合、`branchWithSummary(...)` を使用してナビゲーションターゲットに添付。

これは通常、`branchSummary.enabled` が有効な場合に `/tree` フローによって駆動されます。

### ブランチ切り替えの形状（図解）

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

`generateBranchSummary(...)` はバジェットを以下のように計算します：

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` は以下を行います：

1. 第1パス: 前回のpi生成 `branch_summary` の詳細を含め、すべての要約対象エントリから累積的なファイル操作を収集。
2. 第2パス: 最新から最古へ走査し、トークンバジェットに達するまでメッセージを追加。
3. 最近のコンテキストの保持を優先。
4. 継続性のために、バジェット境界付近の大きなサマリーエントリを含める場合あり。

コンパクションエントリは、ブランチ要約の入力時にメッセージ（`compactionSummary`）として含まれます。

### サマリー生成と永続化

ブランチ要約は：

1. 選択されたメッセージを変換してシリアライズ。
2. `<conversation>` でラップ。
3. 提供された場合はカスタム指示を使用、それ以外は `branch-summary.md` を使用。
4. `SUMMARIZATION_SYSTEM_PROMPT` で要約モデルを呼び出し。
5. `branch-summary-preamble.md` を先頭に追加。
6. ファイル操作タグを追加。

結果はオプションの詳細（`readFiles`、`modifiedFiles`）付きの `BranchSummaryEntry` として保存されます。

## 拡張機能とフックの接点

### `session_before_compact`

コンパクション前のフック。

以下が可能：

- コンパクションのキャンセル（`{ cancel: true }`）
- 完全なカスタムコンパクションペイロードの提供（`{ compaction: CompactionResult }`）

### `session.compacting`

デフォルトコンパクションのプロンプト/コンテキストカスタマイズフック。

以下を返すことが可能：

- `prompt`（ベースサマリープロンプトのオーバーライド）
- `context`（`<additional-context>` に注入される追加コンテキスト行）
- `preserveData`（コンパクションエントリに保存されるデータ）

### `session_compact`

保存された `compactionEntry` と `fromExtension` フラグを含むコンパクション後の通知。

### `session_before_tree`

デフォルトのブランチサマリー生成の前に、ツリーナビゲーション時に実行されます。

以下が可能：

- ナビゲーションのキャンセル
- ユーザーが要約を要求した際に使用されるカスタム `{ summary: { summary, details } }` の提供

### `session_tree`

新旧のリーフとオプションのサマリーエントリを公開するナビゲーション後のイベント。

## ランタイム動作と失敗セマンティクス

- 手動コンパクションは、最初に現在のエージェント操作を中断します。
- `abortCompaction()` は手動・自動コンパクション両方のコントローラーをキャンセルします。
- 自動コンパクションは、UI/状態更新のために開始/終了セッションイベントを発行します。
- 自動コンパクションは複数のモデル候補を試し、一時的な失敗をリトライできます。
- オーバーフローエラーはコンパクションによって処理されるため、汎用リトライパスから除外されます。
- 自動コンパクションが失敗した場合：
  - オーバーフローパスは `Context overflow recovery failed: ...` を発行
  - 閾値パスは `Auto-compaction failed: ...` を発行
- ブランチ要約はアボートシグナル（例：Escape）でキャンセルでき、キャンセル/中断のナビゲーション結果を返します。

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
