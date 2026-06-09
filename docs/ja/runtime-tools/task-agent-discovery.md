---
title: タスクエージェントの検出と選択
description: 特化したサブエージェントタイプへの作業ルーティングのためのタスクエージェント検出と選択ロジック。
sidebar:
  order: 6
  label: タスクエージェントの検出
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# タスクエージェントの検出と選択

本ドキュメントでは、タスクサブシステムがエージェント定義を検出し、複数のソースをマージし、実行時にリクエストされたエージェントを解決する方法について説明します。

優先順位、無効な定義の処理、エージェントを実質的に利用不可にするspawn/深度制約を含む、現在実装されているランタイムの動作をカバーします。

## 実装ファイル

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## エージェント定義の形状

タスクエージェントは `AgentDefinition`（`src/task/types.ts`）に正規化されます：

- `name`、`description`、`systemPrompt`（有効なロード済みエージェントに必須）
- オプションの `tools`、`spawns`、`model`、`thinkingLevel`、`output`
- `source`: `"bundled" | "user" | "project"`
- オプションの `filePath`

パースは `parseAgentFields()`（`src/discovery/helpers.ts`）を介したフロントマターから行われます：

- `name` または `description` の欠落 => 無効（`null`）、呼び出し元はパース失敗として扱う
- `tools` はCSVまたは配列を受け入れ、提供された場合は `submit_result` が自動追加される
- `spawns` は `*`、CSV、または配列を受け入れる
- 後方互換動作：`spawns` が欠落しているが `tools` に `task` が含まれる場合、`spawns` は `*` になる
- `output` は不透明なスキーマデータとしてそのまま渡される

## バンドルエージェント

バンドルエージェントはビルド時にテキストインポートを使用して埋め込まれます（`src/task/agents.ts`）。

`EMBEDDED_AGENT_DEFS` は以下を定義します：

- プロンプトファイルからの `explore`、`plan`、`designer`、`reviewer`
- 共有の `task.md` 本文と注入されたフロントマターからの `task` と `quick_task`

ロードパス：

1. `loadBundledAgents()` は `parseAgent(..., "bundled", "fatal")` で埋め込みマークダウンをパースする
2. 結果はインメモリにキャッシュされる（`bundledAgentsCache`）
3. `clearBundledAgentsCache()` はテスト専用のキャッシュリセット

バンドルパースは `level: "fatal"` を使用するため、不正なバンドルフロントマターはスローされ、検出全体が失敗する可能性があります。

## ファイルシステムとプラグインの検出

`discoverAgents(cwd, home)`（`src/task/discovery.ts`）は、バンドル定義を追加する前に複数のソースからエージェントをマージします。

### 検出の入力

1. `getConfigDirs("agents", { project: false })` からのユーザー設定エージェントディレクトリ
2. `findAllNearestProjectConfigDirs("agents", cwd)` からの最も近いプロジェクトエージェントディレクトリ
3. `agents/` サブディレクトリを持つClaudeプラグインルート（`listClaudePluginRoots(home)`）
4. バンドルエージェント（`loadBundledAgents()`）

### 実際のソース順序

ソースファミリーの順序は `getConfigDirs("", { project: false })` から来ており、これは `src/config.ts` の `priorityList` に由来します：

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

各ソースファミリーについて、検出順序は：

1. そのソースの最も近いプロジェクトディレクトリ（見つかった場合）
2. そのソースのユーザーディレクトリ

すべてのソースファミリーディレクトリの後に、プラグインの `agents/` ディレクトリが追加されます（プロジェクトスコープのプラグインが先、次にユーザースコープ）。

バンドルエージェントは最後に追加されます。

### 重要な注意点：古いコメントと現在のコード

`discovery.ts` のヘッダーコメントはまだ `.pi` に言及しており、`.codex`/`.gemini` には言及していません。実際のランタイム順序は `src/config.ts` によって駆動され、現在 `.xcsh`、`.claude`、`.codex`、`.gemini` を使用しています。

## マージと衝突ルール

検出は正確な `agent.name` による先勝ち重複排除を使用します：

- `Set<string>` が既出の名前を追跡します。
- ロードされたエージェントはディレクトリ順にフラット化され、名前が未出の場合のみ保持されます。
- バンドルエージェントは同じセットに対してフィルタリングされ、まだ未出の場合のみ追加されます。

含意：

- 同じソースファミリーでは、プロジェクトがユーザーをオーバーライドします。
- 優先度の高いソースファミリーが低いものをオーバーライドします（`.xcsh` が `.claude` より先、など）。
- 非バンドルエージェントは同じ名前のバンドルエージェントをオーバーライドします。
- 名前の一致は大文字小文字を区別します（`Task` と `task` は別物です）。
- 1つのディレクトリ内では、重複排除の前にマークダウンファイルがファイル名の辞書順で読み込まれます。

## 無効/欠落エージェントファイルの動作

ディレクトリごと（`loadAgentsFromDir`）：

- 読み取り不可/欠落ディレクトリ：空として扱われる（`readdir(...).catch(() => [])`）
- ファイル読み取りまたはパース失敗：警告がログされ、ファイルはスキップされる
- パースパスは `parseAgent(..., level: "warn")` を使用する

フロントマター失敗の動作は `parseFrontmatter` に由来します：

- `warn` レベルでのパースエラーは警告をログする
- パーサーはシンプルな `key: value` 行パーサーにフォールバックする
- 必須フィールドがまだ欠落している場合、`parseAgentFields` が失敗し、`AgentParsingError` がスローされ呼び出し元でキャッチされる（ファイルはスキップされる）

実質的な効果：1つの不正なカスタムエージェントファイルが他のファイルの検出を中断することはありません。

## エージェントのルックアップと選択

ルックアップは正確な名前による線形検索です：

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

タスク実行時（`TaskTool.execute`）：

1. 呼び出し時にエージェントが再検出される（`discoverAgents(this.session.cwd)`）
2. リクエストされた `params.agent` が `getAgent` を通じて解決される
3. エージェントが見つからない場合は即時ツールレスポンスが返される：
   - `Unknown agent "...". Available: ...`
   - サブプロセスは実行されない

### 説明と実行時検出の違い

`TaskTool.create()` は初期化時の検出結果からツールの説明を構築します（`buildDescription`）。

`execute()` はエージェントを再度検出します。そのため、セッション中にエージェントファイルが変更された場合、ランタイムのセットは先にツールの説明に記載されたものと異なる可能性があります。

## 構造化出力のガードレールとスキーマの優先順位

`TaskTool.execute` でのランタイム出力スキーマの優先順位：

1. エージェントフロントマターの `output`
2. タスク呼び出しの `params.schema`
3. 親セッションの `outputSchema`

（`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`）

`src/prompts/tools/task.md` のプロンプト時ガードレールテキストは、構造化出力エージェント（`explore`、`reviewer`）の不一致動作について警告します：文章中の出力形式の指示がビルトインスキーマと競合し、`null` 出力を生成する可能性があります。

これはガイダンスであり、`discoverAgents` における厳密なランタイム検証ロジックではありません。

## コマンド検出との相互作用

`src/task/commands.ts` はワークフローコマンド（エージェント定義ではない）のための並行インフラストラクチャですが、全体的に同じパターンに従います：

- まずケイパビリティプロバイダーから検出する
- 名前による先勝ちで重複排除する
- まだ未出の場合はバンドルコマンドを追加する
- `getCommand` による正確な名前でのルックアップ

`src/task/index.ts` では、コマンドヘルパーがエージェント検出ヘルパーとともに再エクスポートされます。エージェント検出自体はランタイムでコマンド検出に依存しません。

## 検出を超えた可用性の制約

エージェントは検出可能であっても、実行ガードレールのために実行できない場合があります。

### 親のspawnポリシー

`TaskTool.execute` は `session.getSessionSpawns()` をチェックします：

- `"*"` => すべて許可
- `""` => すべて拒否
- CSVリスト => リストされた名前のみ許可

拒否された場合：即時 `Cannot spawn '...'. Allowed: ...` レスポンス。

### 自己再帰ブロックの環境変数ガード

`PI_BLOCKED_AGENT` はツール構築時に読み取られます。リクエストが一致した場合、再帰防止メッセージで実行が拒否されます。

### 再帰深度ゲーティング（子セッション内のタスクツールの可用性）

`runSubprocess`（`src/task/executor.ts`）内：

- 深度は `taskDepth` から計算される
- `task.maxRecursionDepth` がカットオフを制御する
- 最大深度に達した場合：
  - `task` ツールが子のツールリストから削除される
  - 子の `spawns` 環境変数が空に設定される

そのため、エージェント定義に `spawns` が含まれていても、より深いレベルではさらなるタスクをspawnすることはできません。

## プランモードの注意点（現在の実装）

`TaskTool.execute` はプランモード用の `effectiveAgent` を計算します（プランモードプロンプトを先頭に追加、読み取り専用ツールサブセットを強制、spawnsをクリア）が、`runSubprocess` は `effectiveAgent` ではなく `agent` で呼び出されます。

現在の影響：

- モデルオーバーライド / 思考レベル / 出力スキーマは `effectiveAgent` から導出される
- `effectiveAgent` からのシステムプロンプトとツール/spawn制約はこの呼び出しパスでは渡されない

これはプランモードの動作期待値を読む際に知っておくべき実装上の注意点です。
