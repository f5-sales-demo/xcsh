---
title: ルールブックマッチングパイプライン
description: エージェントセッションにコンテキスト固有の命令セットを選択・適用するためのルールブックマッチングパイプライン。
sidebar:
  order: 6
  label: ルールブックマッチング
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# ルールブックマッチングパイプライン

このドキュメントでは、coding-agent がサポートされている設定フォーマットからルールを検出し、単一の `Rule` 形式に正規化し、優先順位の競合を解決し、結果を以下に分割する方法について説明します：

- **ルールブックルール**（システムプロンプト + `rule://` URL を介してモデルに利用可能）
- **TTSR ルール**（タイムトラベルストリーム中断ルール）

これは現在の実装を反映しており、パースされるが強制されない部分的なセマンティクスやメタデータを含みます。

## 実装ファイル

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. 正規ルール形式

すべてのプロバイダーはソースファイルを `Rule` に正規化します：

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

ケイパビリティの識別子は `rule.name` です（`ruleCapability.key = rule => rule.name`）。

結果として、優先順位と重複排除は **名前ベースのみ** で行われます。同じ `name` を持つ2つの異なるファイルは、同一の論理ルールとみなされます。

## 2. 検出ソースと正規化

`src/discovery/index.ts` はプロバイダーを自動登録します。`rules` の現在のプロバイダーは以下の通りです：

- `native`（優先度 `100`）
- `cursor`（優先度 `50`）
- `windsurf`（優先度 `50`）
- `cline`（優先度 `40`）

### Native プロバイダー（`builtin.ts`）

`.xcsh` ルールを以下から読み込みます：

- プロジェクト: `<cwd>/.xcsh/rules/*.{md,mdc}`
- ユーザー: `~/.xcsh/agent/rules/*.{md,mdc}`

正規化：

- `name` = `.md`/`.mdc` を除いたファイル名
- フロントマターは `parseFrontmatter` で解析
- `content` = 本文（フロントマター除去後）
- `globs`、`alwaysApply`、`description`、`ttsr_trigger` は直接マッピング

重要な注意点: `globs` はこのプロバイダーでは要素のフィルタリングなしに `string[] | undefined` としてキャストされます。

### Cursor プロバイダー（`cursor.ts`）

以下から読み込みます：

- ユーザー: `~/.cursor/rules/*.{mdc,md}`
- プロジェクト: `<cwd>/.cursor/rules/*.{mdc,md}`

正規化（`transformMDCRule`）：

- `description`: 文字列の場合のみ保持
- `alwaysApply`: `true` のみ保持（`false` は `undefined` になる）
- `globs`: 配列（文字列要素のみ）または単一文字列を受け付ける
- `ttsr_trigger`: 文字列のみ
- `name` は拡張子を除いたファイル名

### Windsurf プロバイダー（`windsurf.ts`）

以下から読み込みます：

- ユーザー: `~/.codeium/windsurf/memories/global_rules.md`（固定ルール名 `global_rules`）
- プロジェクト: `<cwd>/.windsurf/rules/*.md`

正規化：

- `globs`: 文字列の配列または単一文字列
- `alwaysApply`、`description` はフロントマターからキャスト
- `ttsr_trigger`: 文字列のみ
- `name` はプロジェクトルールの場合ファイル名から取得

### Cline プロバイダー（`cline.ts`）

`cwd` から上方向に最も近い `.clinerules` を検索します：

- ディレクトリの場合: その中の `*.md` を読み込む
- ファイルの場合: `clinerules` という名前のルールとして単一ファイルを読み込む

正規化：

- `globs`: 文字列の配列または単一文字列
- `alwaysApply`: ブール値の場合のみ
- `description`: 文字列のみ
- `ttsr_trigger`: 文字列のみ

## 3. フロントマター解析の動作と曖昧性

すべてのプロバイダーは以下のセマンティクスで `parseFrontmatter`（`utils/frontmatter.ts`）を使用します：

1. フロントマターは、コンテンツが `---` で始まり、閉じの `\n---` がある場合のみ解析されます。
2. フロントマター抽出後、本文はトリミングされます。
3. YAML 解析が失敗した場合：
   - 警告がログに記録され、
   - パーサーは単純な `key: value` 行解析（`^(\w+):\s*(.*)$`）にフォールバックします。

曖昧性の影響：

- フォールバックパーサーは、配列、ネストされたオブジェクト、クォーティングルール、ハイフン付きキーをサポートしません。
- フォールバック値は文字列になります（例えば `alwaysApply: true` は文字列 `"true"` になる）ため、ブール値/文字列型を要求するプロバイダーではメタデータが失われる可能性があります。
- `ttsr_trigger` はフォールバックで動作します（アンダースコアキー）。`thinking-level` のようなキーは動作しません。
- 有効なフロントマターのないファイルも、空のメタデータと完全なコンテンツ本文を持つルールとして読み込まれます。

## 4. プロバイダーの優先順位と重複排除

`loadCapability("rules")`（`capability/index.ts`）はプロバイダーの出力をマージし、`rule.name` で重複排除します。

### 優先順位モデル

- プロバイダーは優先度の降順で順序付けられます。
- 同じ優先度の場合は登録順が維持されます（`discovery/index.ts` から `cursor` が `windsurf` より先）。
- 重複排除は先勝ち方式です：最初に見つかったルール名が保持され、後から同名のアイテムは `all` で `_shadowed` としてマークされ、`items` からは除外されます。

現在の実効的なルールプロバイダーの順序は以下の通りです：

1. `native`（100）
2. `cursor`（50）
3. `windsurf`（50）
4. `cline`（40）

### プロバイダー内の順序に関する注意点

プロバイダー内では、アイテムの順序は `loadFilesFromDir` の glob 結果の順序と明示的な push 順序に由来します。通常の使用では十分に決定論的ですが、コード上で明示的にソートされているわけではありません。

ソース順序の主な違い：

- `native` はプロジェクトの後にユーザー設定ディレクトリを追加します。
- `cursor` はユーザーの後にプロジェクトの結果を追加します。
- `windsurf` はユーザーの `global_rules` を最初に追加し、次にプロジェクトルールを追加します。
- `cline` は最も近い `.clinerules` ソースのみを読み込みます。

## 5. ルールブック、常時適用、TTSR バケットへの分割

`createAgentSession`（`sdk.ts`）でのルール検出後：

1. 検出されたすべてのルールがスキャンされます。
2. `condition`（フロントマターキー、フォールバックとして `ttsr_trigger` / `ttsrTrigger` も受け付ける）を持つルールは `TtsrManager` に登録されます。
3. 以下の述語で別途 `rulebookRules` リストが構築されます：

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. `alwaysApplyRules` リストが構築されます：

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### バケットの動作

- **TTSR バケット**: `condition` を持つ任意のルール（description は不要）。他のバケットより優先されます。
- **常時適用バケット**: `alwaysApply === true` で、TTSR ではないもの。コンテンツ全体がシステムプロンプトに注入されます。`rule://` で解決可能です。
- **ルールブックバケット**: description が必須、TTSR でなく、`alwaysApply` でないもの。システムプロンプトに名前と説明で一覧表示され、コンテンツは `rule://` を介してオンデマンドで読み取られます。
- `condition` と `alwaysApply` の両方を持つルールは TTSR のみに振り分けられます（TTSR が優先）。
- `alwaysApply` と `description` の両方を持つルールは常時適用のみに振り分けられます（ルールブックには含まれません）。

## 6. メタデータがランタイムサーフェスに与える影響

### `description`

- ルールブックへの包含に必須です。
- システムプロンプトの `<rules>` ブロックにレンダリングされます。
- description がない場合、ルールは `rule://` で利用できず、システムプロンプトのルール一覧にも表示されません。

### `globs`

- `Rule` に引き継がれます。
- システムプロンプトのルールブロックに `<glob>...</glob>` エントリとしてレンダリングされます。
- ルール UI 状態（`extensions` モードリスト）に公開されます。
- **このパイプラインでは自動マッチングは強制されません。** 現在のファイル/ツールターゲットによってルールを選択するランタイム glob マッチャーは存在しません。

### `alwaysApply`

- プロバイダーによって解析・保持されます。
- UI 表示で使用されます（拡張機能状態マネージャーでの `"always"` トリガーラベル）。
- `rulebookRules` からの除外条件として使用されます。
- **ルールのコンテンツ全体がシステムプロンプトに自動注入されます**（ルールブックルールセクションの前に）。
- ルールは再読み取りのために `rule://<name>` でもアドレス指定可能です。

### `ttsr_trigger`

- `rule.ttsrTrigger` にマッピングされます。
- 存在する場合、ルールはルールブックではなく TTSR マネージャーにルーティングされます。

## 7. システムプロンプトへの組み込みパス

`buildSystemPromptInternal` は `rules`（ルールブック）と `alwaysApplyRules` の両方を受け取ります。

常時適用ルールが最初にレンダリングされ、その生のコンテンツがプロンプトに直接注入されます。

ルールブックルールは `# Rules` セクションに以下の形式でレンダリングされます：

- `Read rule://<name> when working in matching domain`
- 各ルールの `name`、`description`、およびオプションの `<glob>` リスト

これは助言的/コンテキスト的なものです：プロンプトテキストはモデルに適用可能なルールを読むよう求めますが、コードは glob の適用可能性を強制しません。

## 8. `rule://` 内部 URL の動作

`RuleProtocolHandler` は以下で登録されます：

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

影響：

- `rule://<name>` は **rulebookRules** と **alwaysApplyRules** の両方に対して解決されます。
- TTSR のみのルール、および description も `alwaysApply` もないルールは `rule://` でアドレス指定できません。
- 解決は正確な名前一致です。
- 不明な名前の場合、利用可能なルール名のリストを含むエラーが返されます。
- 返されるコンテンツは生の `rule.content`（フロントマター除去済み）で、コンテンツタイプは `text/markdown` です。

## 9. 既知の部分的/未強制のセマンティクス

1. プロバイダーの説明ではレガシーファイル（`.cursorrules`、`.windsurfrules`）に言及していますが、現在のローダーコードパスでは実際にはそれらのファイルを読み取りません。
2. `globs` メタデータはプロンプト/UI に表示されますが、ルール選択ロジックでは強制されません。
3. `rule://` のルール選択にはルールブックと常時適用ルールが含まれますが、TTSR のみのルールは含まれません。
4. 検出警告（`loadCapability("rules").warnings`）は生成されますが、`createAgentSession` は現在このパスでそれらを表示/ログ出力しません。
