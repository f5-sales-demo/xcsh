---
title: ルールブックマッチングパイプライン
description: エージェントセッションに対してコンテキスト固有の指示セットを選択・適用するためのルールブックマッチングパイプライン。
sidebar:
  order: 6
  label: ルールブックマッチング
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# ルールブックマッチングパイプライン

このドキュメントでは、coding-agentがサポートされた設定フォーマットからルールを検出し、単一の `Rule` 形状に正規化し、優先順位の競合を解決し、結果を以下に分割する方法について説明します：

- **ルールブックルール**（システムプロンプト + `rule://` URL経由でモデルに提供）
- **TTSRルール**（タイムトラベルストリーム中断ルール）

これは、部分的なセマンティクスや、パースはされるが強制されないメタデータを含む、現在の実装を反映しています。

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

## 1. 正規ルール形状

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

結果として、優先順位と重複排除は**名前ベースのみ**です。同じ `name` を持つ2つの異なるファイルは、同じ論理的ルールとみなされます。

## 2. 検出ソースと正規化

`src/discovery/index.ts` はプロバイダーを自動登録します。`rules` の場合、現在のプロバイダーは：

- `native`（優先度 `100`）
- `cursor`（優先度 `50`）
- `windsurf`（優先度 `50`）
- `cline`（優先度 `40`）

### Nativeプロバイダー（`builtin.ts`）

以下から `.xcsh` ルールを読み込みます：

- プロジェクト: `<cwd>/.xcsh/rules/*.{md,mdc}`
- ユーザー: `~/.xcsh/agent/rules/*.{md,mdc}`

正規化：

- `name` = `.md`/`.mdc` を除いたファイル名
- フロントマターは `parseFrontmatter` でパース
- `content` = 本文（フロントマター除去済み）
- `globs`、`alwaysApply`、`description`、`ttsr_trigger` は直接マッピング

重要な注意点：このプロバイダーでは `globs` は要素フィルタリングなしで `string[] | undefined` にキャストされます。

### Cursorプロバイダー（`cursor.ts`）

以下から読み込みます：

- ユーザー: `~/.cursor/rules/*.{mdc,md}`
- プロジェクト: `<cwd>/.cursor/rules/*.{mdc,md}`

正規化（`transformMDCRule`）：

- `description`: 文字列の場合のみ保持
- `alwaysApply`: `true` のみ保持（`false` は `undefined` になる）
- `globs`: 配列（文字列要素のみ）または単一文字列を受け付け
- `ttsr_trigger`: 文字列のみ
- `name` は拡張子を除いたファイル名から

### Windsurfプロバイダー（`windsurf.ts`）

以下から読み込みます：

- ユーザー: `~/.codeium/windsurf/memories/global_rules.md`（固定ルール名 `global_rules`）
- プロジェクト: `<cwd>/.windsurf/rules/*.md`

正規化：

- `globs`: 文字列の配列または単一文字列
- `alwaysApply`、`description` はフロントマターからキャスト
- `ttsr_trigger`: 文字列のみ
- プロジェクトルールの `name` はファイル名から

### Clineプロバイダー（`cline.ts`）

`cwd` から上方向に最も近い `.clinerules` を検索します：

- ディレクトリの場合：内部の `*.md` を読み込み
- ファイルの場合：`clinerules` という名前のルールとして単一ファイルを読み込み

正規化：

- `globs`: 文字列の配列または単一文字列
- `alwaysApply`: ブーリアンの場合のみ
- `description`: 文字列のみ
- `ttsr_trigger`: 文字列のみ

## 3. フロントマターのパース動作と曖昧性

すべてのプロバイダーは以下のセマンティクスで `parseFrontmatter`（`utils/frontmatter.ts`）を使用します：

1. フロントマターは、コンテンツが `---` で始まり、閉じ `\n---` がある場合にのみパースされます。
2. 本文はフロントマター抽出後にトリムされます。
3. YAMLパースが失敗した場合：
   - 警告がログに記録され、
   - パーサーは単純な `key: value` 行パース（`^(\w+):\s*(.*)$`）にフォールバックします。

曖昧性の影響：

- フォールバックパーサーは配列、ネストされたオブジェクト、クォートルール、ハイフン付きキーをサポートしません。
- フォールバック値は文字列になります（例：`alwaysApply: true` は文字列 `"true"` になる）。そのため、ブーリアン/文字列型を要求するプロバイダーはメタデータを落とす可能性があります。
- `ttsr_trigger` はフォールバックでも機能します（アンダースコアキー）。`thinking-level` のようなキーは機能しません。
- 有効なフロントマターがないファイルも、空のメタデータとコンテンツ本文全体を持つルールとして読み込まれます。

## 4. プロバイダーの優先順位と重複排除

`loadCapability("rules")`（`capability/index.ts`）はプロバイダーの出力をマージし、`rule.name` で重複排除します。

### 優先順位モデル

- プロバイダーは優先度の降順で並べられます。
- 同一優先度の場合は登録順を維持します（`discovery/index.ts` から `cursor` が `windsurf` より前）。
- 重複排除は先勝ちです：最初に見つかったルール名が保持され、後の同名アイテムは `all` で `_shadowed` としてマークされ、`items` からは除外されます。

現在の有効なルールプロバイダー順序は：

1. `native`（100）
2. `cursor`（50）
3. `windsurf`（50）
4. `cline`（40）

### プロバイダー内の順序に関する注意点

プロバイダー内では、アイテムの順序は `loadFilesFromDir` のglob結果の順序と明示的なpush順序に由来します。これは通常の使用には十分な決定性がありますが、コード内で明示的にソートされていません。

注目すべきソース順序の違い：

- `native` はプロジェクト、次にユーザー設定ディレクトリを追加します。
- `cursor` はユーザー、次にプロジェクトの結果を追加します。
- `windsurf` はユーザーの `global_rules` を最初に、次にプロジェクトルールを追加します。
- `cline` は最も近い `.clinerules` ソースのみを読み込みます。

## 5. ルールブック、常時適用、TTSRバケットへの分割

`createAgentSession`（`sdk.ts`）でのルール検出後：

1. 検出されたすべてのルールがスキャンされます。
2. `condition`（フロントマターキー；`ttsr_trigger` / `ttsrTrigger` がフォールバックとして受け付けられる）を持つルールは `TtsrManager` に登録されます。
3. 以下の述語で個別の `rulebookRules` リストが構築されます：

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. `alwaysApplyRules` リストが構築されます：

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### バケットの動作

- **TTSRバケット**: `condition` を持つすべてのルール（descriptionは不要）。他のバケットより優先されます。
- **常時適用バケット**: `alwaysApply === true` で、TTSRではないもの。完全なコンテンツがシステムプロンプトに注入されます。`rule://` 経由で解決可能です。
- **ルールブックバケット**: descriptionが必須、TTSRでないこと、`alwaysApply` でないこと。システムプロンプトに名前+説明でリストされ、コンテンツは `rule://` 経由でオンデマンドで読み取られます。
- `condition` と `alwaysApply` の両方を持つルールはTTSRのみに入ります（TTSRが優先）。
- `alwaysApply` と `description` の両方を持つルールは常時適用のみに入ります（ルールブックではない）。

## 6. メタデータがランタイムサーフェスに与える影響

### `description`

- ルールブックに含まれるために必須です。
- システムプロンプトの `<rules>` ブロックにレンダリングされます。
- descriptionがない場合、ルールは `rule://` 経由で利用できず、システムプロンプトのルールにもリストされません。

### `globs`

- `Rule` に保持されます。
- システムプロンプトのルールブロックで `<glob>...</glob>` エントリとしてレンダリングされます。
- ルールUIの状態（`extensions` モードリスト）で公開されます。
- **このパイプラインでは自動マッチングに強制されません。** 現在のファイル/ツール対象でルールを選択するランタイムglobマッチャーは存在しません。

### `alwaysApply`

- プロバイダーによってパースおよび保持されます。
- UI表示で使用されます（拡張機能状態マネージャーの `"always"` トリガーラベル）。
- `rulebookRules` からの除外条件として使用されます。
- **ルールの完全なコンテンツがシステムプロンプトに自動注入されます**（ルールブックルールセクションの前）。
- ルールは再読み取りのために `rule://<name>` 経由でもアドレス可能です。

### `ttsr_trigger`

- `rule.ttsrTrigger` にマッピングされます。
- 存在する場合、ルールはルールブックではなくTTSRマネージャーにルーティングされます。

## 7. システムプロンプトへの組み込みパス

`buildSystemPromptInternal` は `rules`（ルールブック）と `alwaysApplyRules` の両方を受け取ります。

常時適用ルールが最初にレンダリングされ、その生のコンテンツがプロンプトに直接注入されます。

ルールブックルールは `# Rules` セクションに以下の内容でレンダリングされます：

- `Read rule://<name> when working in matching domain`
- 各ルールの `name`、`description`、およびオプションの `<glob>` リスト

これは助言的/文脈的なものです：プロンプトテキストはモデルに適用可能なルールを読むよう求めますが、コードはglobの適用可能性を強制しません。

## 8. `rule://` 内部URLの動作

`RuleProtocolHandler` は以下で登録されます：

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

影響：

- `rule://<name>` は **rulebookRules** と **alwaysApplyRules** の両方に対して解決されます。
- TTSRのみのルール、およびdescriptionも `alwaysApply` もないルールは `rule://` 経由でアドレスできません。
- 解決は完全名一致です。
- 不明な名前の場合、利用可能なルール名をリストしたエラーが返されます。
- 返されるコンテンツは生の `rule.content`（フロントマター除去済み）で、コンテンツタイプは `text/markdown` です。

## 9. 既知の部分的/非強制セマンティクス

1. プロバイダーの説明ではレガシーファイル（`.cursorrules`、`.windsurfrules`）に言及していますが、現在のローダーコードパスは実際にはそれらのファイルを読み取りません。
2. `globs` メタデータはプロンプト/UIに表示されますが、ルール選択ロジックでは強制されません。
3. `rule://` のルール選択にはルールブックと常時適用ルールが含まれますが、TTSRのみのルールは含まれません。
4. 検出の警告（`loadCapability("rules").warnings`）は生成されますが、`createAgentSession` は現在このパスでそれらを表示/ログに記録しません。
