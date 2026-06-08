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

このドキュメントでは、coding-agent がサポートされている設定形式からルールを検出し、それらを単一の `Rule` 形状に正規化し、優先度の競合を解決し、結果を以下に分割する方法を説明します：

- **ルールブックルール**（システムプロンプト + `rule://` URL を通じてモデルに提供されるもの）
- **TTSR ルール**（タイムトラベルストリーム中断ルール）

これは、部分的なセマンティクスや解析はされるが強制されないメタデータを含む、現在の実装を反映しています。

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

結果として：優先度と重複排除は**名前のみに基づきます**。異なるファイルでも同じ `name` を持つ場合、同一の論理ルールとみなされます。

## 2. 検出ソースと正規化

`src/discovery/index.ts` はプロバイダーを自動登録します。`rules` の現在のプロバイダーは：

- `native`（優先度 `100`）
- `cursor`（優先度 `50`）
- `windsurf`（優先度 `50`）
- `cline`（優先度 `40`）

### Native プロバイダー（`builtin.ts`）

以下から `.xcsh` ルールを読み込みます：

- プロジェクト：`<cwd>/.xcsh/rules/*.{md,mdc}`
- ユーザー：`~/.xcsh/agent/rules/*.{md,mdc}`

正規化：

- `name` = `.md`/`.mdc` を除いたファイル名
- フロントマターは `parseFrontmatter` で解析
- `content` = 本文（フロントマター除去済み）
- `globs`、`alwaysApply`、`description`、`ttsr_trigger` は直接マッピング

重要な注意点：`globs` はこのプロバイダーでは要素のフィルタリングなしで `string[] | undefined` としてキャストされます。

### Cursor プロバイダー（`cursor.ts`）

以下から読み込みます：

- ユーザー：`~/.cursor/rules/*.{mdc,md}`
- プロジェクト：`<cwd>/.cursor/rules/*.{mdc,md}`

正規化（`transformMDCRule`）：

- `description`：文字列の場合のみ保持
- `alwaysApply`：`true` のみ保持（`false` は `undefined` になる）
- `globs`：配列（文字列要素のみ）または単一の文字列を受け入れる
- `ttsr_trigger`：文字列のみ
- `name` は拡張子を除いたファイル名から

### Windsurf プロバイダー（`windsurf.ts`）

以下から読み込みます：

- ユーザー：`~/.codeium/windsurf/memories/global_rules.md`（固定ルール名 `global_rules`）
- プロジェクト：`<cwd>/.windsurf/rules/*.md`

正規化：

- `globs`：文字列の配列または単一の文字列
- `alwaysApply`、`description` はフロントマターからキャスト
- `ttsr_trigger`：文字列のみ
- プロジェクトルールの `name` はファイル名から

### Cline プロバイダー（`cline.ts`）

`cwd` から上方向に最も近い `.clinerules` を検索します：

- ディレクトリの場合：その中の `*.md` を読み込む
- ファイルの場合：`clinerules` という名前のルールとして単一ファイルを読み込む

正規化：

- `globs`：文字列の配列または単一の文字列
- `alwaysApply`：ブール値の場合のみ
- `description`：文字列のみ
- `ttsr_trigger`：文字列のみ

## 3. フロントマター解析の動作と曖昧性

すべてのプロバイダーは以下のセマンティクスで `parseFrontmatter`（`utils/frontmatter.ts`）を使用します：

1. フロントマターはコンテンツが `---` で始まり、閉じる `\n---` がある場合のみ解析される。
2. 本文はフロントマター抽出後にトリムされる。
3. YAML 解析が失敗した場合：
   - 警告がログに記録される、
   - パーサーは単純な `key: value` 行解析（`^(\w+):\s*(.*)$`）にフォールバックする。

曖昧性の影響：

- フォールバックパーサーは配列、ネストされたオブジェクト、引用規則、ハイフン付きキーをサポートしない。
- フォールバック値は文字列になる（例えば `alwaysApply: true` は文字列 `"true"` になる）ため、ブール値/文字列型を必要とするプロバイダーはメタデータを破棄する可能性がある。
- `ttsr_trigger` はフォールバックで動作する（アンダースコアキー）が、`thinking-level` のようなキーは動作しない。
- 有効なフロントマターのないファイルも、空のメタデータと完全なコンテンツ本文を持つルールとして読み込まれる。

## 4. プロバイダーの優先度と重複排除

`loadCapability("rules")`（`capability/index.ts`）はプロバイダーの出力をマージし、`rule.name` で重複排除します。

### 優先度モデル

- プロバイダーは優先度の降順で並べられる。
- 同じ優先度の場合、登録順が維持される（`discovery/index.ts` より `cursor` が `windsurf` の前）。
- 重複排除は先勝ち：最初に見つかったルール名が保持され、後の同名アイテムは `all` で `_shadowed` マークされ、`items` からは除外される。

現在の実効的なルールプロバイダー順序は：

1. `native`（100）
2. `cursor`（50）
3. `windsurf`（50）
4. `cline`（40）

### プロバイダー内の順序に関する注意点

プロバイダー内では、アイテムの順序は `loadFilesFromDir` の glob 結果の順序と明示的な push 順序に基づきます。これは通常の使用では十分に決定的ですが、コード内で明示的にソートされているわけではありません。

注目すべきソース順序の違い：

- `native` はプロジェクトの後にユーザー設定ディレクトリを追加する。
- `cursor` はユーザーの後にプロジェクトの結果を追加する。
- `windsurf` はユーザーの `global_rules` を最初に追加し、次にプロジェクトルールを追加する。
- `cline` は最も近い `.clinerules` ソースのみを読み込む。

## 5. ルールブック、常時適用、TTSR バケットへの分割

`createAgentSession`（`sdk.ts`）でのルール検出後：

1. 検出されたすべてのルールがスキャンされる。
2. `condition`（フロントマターキー；フォールバックとして `ttsr_trigger` / `ttsrTrigger` も受け入れ）を持つルールが `TtsrManager` に登録される。
3. 以下の述語で別の `rulebookRules` リストが構築される：

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. `alwaysApplyRules` リストが構築される：

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### バケットの動作

- **TTSR バケット**：`condition` を持つすべてのルール（description は不要）。他のバケットより優先される。
- **常時適用バケット**：`alwaysApply === true`、TTSR ではないもの。完全なコンテンツがシステムプロンプトに注入される。`rule://` 経由で解決可能。
- **ルールブックバケット**：description が必須、TTSR でないこと、`alwaysApply` でないこと。システムプロンプトに名前+説明でリストされ、コンテンツは `rule://` 経由でオンデマンドで読み取られる。
- `condition` と `alwaysApply` の両方を持つルールは TTSR のみに分類される（TTSR が優先）。
- `alwaysApply` と `description` の両方を持つルールは常時適用のみに分類される（ルールブックではない）。

## 6. メタデータがランタイムサーフェスに与える影響

### `description`

- ルールブックへの包含に必須。
- システムプロンプトの `<rules>` ブロックに表示される。
- description が欠落している場合、ルールは `rule://` 経由で利用できず、システムプロンプトのルールにリストされない。

### `globs`

- `Rule` 上で保持される。
- システムプロンプトのルールブロックに `<glob>...</glob>` エントリとして表示される。
- ルール UI 状態（`extensions` モードリスト）で公開される。
- **このパイプラインでは自動マッチングとして強制されない。** 現在のファイル/ツールターゲットによってルールを選択するランタイム glob マッチャーは存在しない。

### `alwaysApply`

- プロバイダーによって解析・保持される。
- UI 表示で使用される（拡張機能状態マネージャーでの `"always"` トリガーラベル）。
- `rulebookRules` からの除外条件として使用される。
- **ルールの完全なコンテンツがシステムプロンプトに自動注入される**（ルールブックルールセクションの前）。
- ルールは再読み取りのために `rule://<name>` でもアドレス可能。

### `ttsr_trigger`

- `rule.ttsrTrigger` にマッピングされる。
- 存在する場合、ルールはルールブックではなく TTSR マネージャーにルーティングされる。

## 7. システムプロンプトへの組み込みパス

`buildSystemPromptInternal` は `rules`（ルールブック）と `alwaysApplyRules` の両方を受け取ります。

常時適用ルールが最初にレンダリングされ、その生のコンテンツがプロンプトに直接注入されます。

ルールブックルールは `# Rules` セクションに以下の形式でレンダリングされます：

- `Read rule://<name> when working in matching domain`
- 各ルールの `name`、`description`、およびオプションの `<glob>` リスト

これは助言的/コンテキスト的なものです：プロンプトテキストはモデルに適用可能なルールを読むよう求めますが、コードが glob の適用可能性を強制するわけではありません。

## 8. `rule://` 内部 URL の動作

`RuleProtocolHandler` は以下で登録されます：

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

含意：

- `rule://<name>` は **rulebookRules** と **alwaysApplyRules** の両方に対して解決される。
- TTSR のみのルール、および description も `alwaysApply` もないルールは `rule://` 経由でアドレスできない。
- 解決は完全一致。
- 不明な名前の場合、利用可能なルール名のリストを含むエラーが返される。
- 返されるコンテンツは生の `rule.content`（フロントマター除去済み）で、コンテンツタイプは `text/markdown`。

## 9. 既知の部分的/非強制セマンティクス

1. プロバイダーの説明ではレガシーファイル（`.cursorrules`、`.windsurfrules`）に言及しているが、現在のローダーコードパスでは実際にはそれらのファイルを読み取らない。
2. `globs` メタデータはプロンプト/UI に表示されるが、ルール選択ロジックでは強制されない。
3. `rule://` のルール選択にはルールブックと常時適用ルールが含まれるが、TTSR のみのルールは含まれない。
4. 検出警告（`loadCapability("rules").warnings`）は生成されるが、`createAgentSession` は現在このパスでそれらを表示/ログ記録しない。
