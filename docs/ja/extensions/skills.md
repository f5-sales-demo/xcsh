---
title: スキル
description: コーディングエージェントにおける特殊な機能の登録、発見、呼び出しのためのスキルシステム。
sidebar:
  order: 3
  label: スキル
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# スキル

スキルはファイルベースの機能パックであり、起動時に発見され、以下の形でモデルに公開されます：

- システムプロンプト内の軽量メタデータ（名前 + 説明）
- `read skill://...` によるオンデマンドコンテンツ
- オプションのインタラクティブ `/skill:<name>` コマンド

このドキュメントでは、`src/extensibility/skills.ts`、`src/discovery/builtin.ts`、`src/internal-urls/skill-protocol.ts`、および `src/discovery/agents-md.ts` における現在のランタイム動作について説明します。

## このコードベースにおけるスキルとは

発見されたスキルは以下のように表現されます：

- `name`
- `description`
- `filePath`（`SKILL.md` のパス）
- `baseDir`（スキルディレクトリ）
- ソースメタデータ（`provider`、`level`、パス）

ランタイムが有効性のために必要とするのは `name` と `path` のみです。実際には、マッチングの品質は `description` が意味のある内容であるかどうかに依存します。

## 必須のレイアウトと SKILL.md の要件

### ディレクトリレイアウト

プロバイダーベースの発見（native/Claude/Codex/Agents/plugin プロバイダー）では、スキルは **`skills/` 直下の1階層** として発見されます：

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md` のようなネストされたパターンは、プロバイダーローダーによって発見されません。

`skills.customDirectories` の場合、スキャンは同じ非再帰的レイアウト（`*/SKILL.md`）を使用します。

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### `SKILL.md` フロントマター

スキル型でサポートされるフロントマターフィールド：

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- 追加のキーは不明なメタデータとして保持されます

現在のランタイム動作：

- `name` はデフォルトでスキルディレクトリ名になります
- `description` は以下の場合に必須です：
  - ネイティブ `.xcsh` プロバイダーのスキル発見（`requireDescription: true`）
  - `src/discovery/helpers.ts` の `scanSkillsFromDir` による `skills.customDirectories` スキャン（非再帰的）
- ネイティブ以外のプロバイダーは description なしでスキルをロードできます

## 発見パイプライン

`src/extensibility/skills.ts` の `discoverSkills()` は2つのパスを実行します：

1. `loadCapability("skills")` による**ケイパビリティプロバイダー**
2. `scanSkillsFromDir(..., { requireDescription: true })` による**カスタムディレクトリ**（1階層のディレクトリ列挙）

`skills.enabled` が `false` の場合、発見はスキルを返しません。

### 組み込みスキルプロバイダーと優先順位

プロバイダーの順序は優先度順（高いものが優先）であり、同点の場合は登録順です。

現在登録されているスキルプロバイダー：

1. `native`（優先度 100）— `src/discovery/builtin.ts` による `.xcsh` ユーザー/プロジェクトスキル
2. `claude`（優先度 80）
3. 優先度 70 グループ（登録順）：
   - `claude-plugins`
   - `agents`
   - `codex`

重複排除キーはスキル名です。同じ名前の最初のアイテムが優先されます。

### ソーストグルとフィルタリング

`discoverSkills()` は以下の制御を適用します：

- ソーストグル：`enableCodexUser`、`enableClaudeUser`、`enableClaudeProject`、`enablePiUser`、`enablePiProject`
- スキル名に対する glob フィルター：
  - `ignoredSkills`（除外）
  - `includeSkills`（許可リストによる包含、空の場合はすべて包含）

フィルターの順序：

1. ソースが有効
2. 無視されていない
3. 包含されている（包含リストが存在する場合）

codex/claude/native 以外のプロバイダー（例えば `agents`、`claude-plugins`）の場合、有効化は現在以下にフォールバックします：組み込みソーストグルの**いずれか**が有効であれば有効。

### 衝突と重複の処理

- ケイパビリティの重複排除は、名前ごとに最初のスキル（最高優先度のプロバイダー）を保持します
- `extensibility/skills.ts` はさらに以下を行います：
  - `realpath` による同一ファイルの重複排除（シンボリックリンク対応）
  - 後発のスキル名が競合した場合に衝突警告を発行
  - `scanSkillsFromDir` の薄いアダプターとして `discoverSkillsFromDir({ dir, source })` API を維持
- カスタムディレクトリのスキルはプロバイダースキルの後にマージされ、同じ衝突動作に従います

## ランタイムの使用動作

### システムプロンプトへの公開

システムプロンプトの構築（`src/system-prompt.ts`）は、発見されたスキルを以下のように使用します：

- `read` ツールが利用可能な場合：
  - 発見されたスキルリストをプロンプトに含める
- それ以外の場合：
  - 発見されたリストを省略する

Task ツールのサブエージェントは、通常のセッション作成を通じてセッションの発見済み/提供済みスキルリストを受け取ります。タスクごとのスキル固定オーバーライドはありません。

### インタラクティブ `/skill:<name>` コマンド

`skills.enableSkillCommands` が true の場合、インタラクティブモードは発見されたスキルごとに1つのスラッシュコマンドを登録します。

`/skill:<name> [args]` の動作：

- `filePath` からスキルファイルを直接読み取る
- フロントマターを除去する
- スキル本文をフォローアップカスタムメッセージとして注入する
- メタデータを追加する（`Skill: <path>`、オプションの `User: <args>`）

## `skill://` URL の動作

`src/internal-urls/skill-protocol.ts` は以下をサポートします：

- `skill://<name>` → そのスキルの `SKILL.md` に解決
- `skill://<name>/<relative-path>` → そのスキルディレクトリ内に解決

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

解決の詳細：

- スキル名は完全一致する必要があります
- 相対パスは URL デコードされます
- 絶対パスは拒否されます
- パストラバーサル（`..`）は拒否されます
- 解決されたパスは `baseDir` 内に留まる必要があります
- 存在しないファイルは明示的な `File not found` エラーを返します

コンテンツタイプ：

- `.md` => `text/markdown`
- その他すべて => `text/plain`

存在しないアセットに対するフォールバック検索は行われません。

## スキルと AGENTS.md、コマンド、ツール、フックの比較

### スキルと AGENTS.md

- **スキル**: 名前付きのオプションの機能パックで、タスクコンテキストによって選択されるか、明示的にリクエストされる
- **AGENTS.md/コンテキストファイル**: コンテキストファイルケイパビリティとしてロードされ、レベル/深さルールによってマージされる永続的な指示ファイル

`src/discovery/agents-md.ts` は、`cwd` から親ディレクトリを走査してスタンドアロンの `AGENTS.md` ファイルを発見します（最大深さ 20）。隠しディレクトリセグメントは除外されます。

### スキルとスラッシュコマンド

- **スキル**: モデルが読み取り可能な知識/ワークフローコンテンツ
- **スラッシュコマンド**: ユーザーが呼び出すコマンドエントリポイント
- `/skill:<name>` はスキルテキストを注入する便利なラッパーです。スキル発見のセマンティクスは変更しません

### スキルとカスタムツール

- **スキル**: プロンプトコンテキストと `read` を通じてロードされるドキュメント/ワークフローコンテンツ
- **カスタムツール**: スキーマとランタイムの副作用を持つ、モデルが呼び出し可能な実行可能ツール API

### スキルとフック

- **スキル**: パッシブなコンテンツ
- **フック**: 実行中に動作をブロック/変更できるイベント駆動のランタイムインターセプター

## 発見ロジックに基づく実践的なオーサリングガイダンス

- 各スキルを独自のディレクトリに配置する：`<skills-root>/<skill-name>/SKILL.md`
- 常に明示的な `name` と `description` フロントマターを含める
- 参照するアセットは同じスキルディレクトリ配下に置き、`skill://<name>/...` でアクセスする
- ネストされた分類（`team/domain/skill`）の場合は、`skills.customDirectories` をネストされた親ディレクトリに向ける。スキャン自体は非再帰的のまま
- ソース間でスキル名の重複を避ける。プロバイダーの優先順位により最初の一致が優先される
