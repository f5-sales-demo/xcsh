---
title: Skills
description: コーディングエージェントにおける特殊な能力の登録、発見、呼び出しのためのスキルシステム。
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# スキル

スキルはファイルベースの能力パックであり、起動時に発見され、以下の形でモデルに公開されます：

- システムプロンプト内の軽量メタデータ（名前 + 説明）
- `read skill://...` によるオンデマンドコンテンツ
- オプションのインタラクティブ `/skill:<name>` コマンド

このドキュメントでは、`src/extensibility/skills.ts`、`src/discovery/builtin.ts`、`src/internal-urls/skill-protocol.ts`、および `src/discovery/agents-md.ts` における現在のランタイム動作について説明します。

## このコードベースにおけるスキルの定義

発見されたスキルは以下のように表現されます：

- `name`
- `description`
- `filePath`（`SKILL.md` のパス）
- `baseDir`（スキルディレクトリ）
- ソースメタデータ（`provider`、`level`、パス）

ランタイムが有効性のために必要とするのは `name` と `path` のみです。実際には、マッチング品質は `description` が意味のあるものであるかどうかに依存します。

## 必須レイアウトと SKILL.md の要件

### ディレクトリレイアウト

プロバイダーベースの発見（native/Claude/Codex/Agents/plugin プロバイダー）では、スキルは **`skills/` の直下1階層** で発見されます：

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md` のようなネストされたパターンは、プロバイダーローダーでは発見されません。

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

スキルタイプでサポートされるフロントマターフィールド：

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- 追加のキーは不明なメタデータとして保持されます

現在のランタイム動作：

- `name` はスキルディレクトリ名がデフォルトになります
- `description` は以下の場合に必須です：
  - ネイティブ `.xcsh` プロバイダーのスキル発見（`requireDescription: true`）
  - `src/discovery/helpers.ts` の `scanSkillsFromDir` による `skills.customDirectories` スキャン（非再帰）
- 非ネイティブプロバイダーは説明なしでスキルをロードできます

## 発見パイプライン

`src/extensibility/skills.ts` の `discoverSkills()` は2つのパスを実行します：

1. **能力プロバイダー** - `loadCapability("skills")` 経由
2. **カスタムディレクトリ** - `scanSkillsFromDir(..., { requireDescription: true })` 経由（1階層のディレクトリ列挙）

`skills.enabled` が `false` の場合、発見はスキルを返しません。

### 組み込みスキルプロバイダーと優先順位

プロバイダーの順序は優先度順（高い方が優先）で、同順位の場合は登録順です。

現在登録されているスキルプロバイダー：

1. `native`（優先度 100）— `src/discovery/builtin.ts` 経由の `.xcsh` ユーザー/プロジェクトスキル
2. `claude`（優先度 80）
3. 優先度 70 グループ（登録順）：
   - `claude-plugins`
   - `agents`
   - `codex`

重複排除キーはスキル名です。指定された名前を持つ最初のアイテムが優先されます。

### ソーストグルとフィルタリング

`discoverSkills()` は以下の制御を適用します：

- ソーストグル：`enableCodexUser`、`enableClaudeUser`、`enableClaudeProject`、`enablePiUser`、`enablePiProject`
- スキル名に対する glob フィルター：
  - `ignoredSkills`（除外）
  - `includeSkills`（許可リストに含める；空の場合はすべてを含む）

フィルターの順序：

1. ソースが有効
2. 無視されていない
3. 含まれている（含むリストが存在する場合）

codex/claude/native 以外のプロバイダー（例：`agents`、`claude-plugins`）の場合、有効化は現在以下にフォールバックします：**いずれかの** 組み込みソーストグルが有効であれば有効。

### 衝突と重複の処理

- 能力の重複排除は、名前ごとに最初のスキル（最も優先度の高いプロバイダー）を保持します
- `extensibility/skills.ts` は追加で以下を行います：
  - `realpath` による同一ファイルの重複排除（シンボリックリンク対応）
  - 後のスキル名が競合する場合に衝突警告を出力
  - `scanSkillsFromDir` の薄いアダプターとして `discoverSkillsFromDir({ dir, source })` API を維持
- カスタムディレクトリのスキルはプロバイダースキルの後にマージされ、同じ衝突動作に従います

## ランタイム使用動作

### システムプロンプトへの公開

システムプロンプトの構築（`src/system-prompt.ts`）は、発見されたスキルを以下のように使用します：

- `read` ツールが利用可能な場合：
  - 発見されたスキルリストをプロンプトに含める
- それ以外の場合：
  - 発見されたリストを省略する

タスクツールのサブエージェントは、通常のセッション作成を通じてセッションの発見済み/提供済みスキルリストを受け取ります。タスクごとのスキル固定オーバーライドはありません。

### インタラクティブ `/skill:<name>` コマンド

`skills.enableSkillCommands` が true の場合、インタラクティブモードは発見されたスキルごとに1つのスラッシュコマンドを登録します。

`/skill:<name> [args]` の動作：

- `filePath` からスキルファイルを直接読み取る
- フロントマターを除去する
- スキル本文をフォローアップカスタムメッセージとして注入する
- メタデータを追加する（`Skill: <path>`、オプションで `User: <args>`）

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

- スキル名は完全一致が必要
- 相対パスは URL デコードされる
- 絶対パスは拒否される
- パストラバーサル（`..`）は拒否される
- 解決されたパスは `baseDir` 内に留まる必要がある
- 存在しないファイルは明示的な `File not found` エラーを返す

コンテンツタイプ：

- `.md` => `text/markdown`
- その他すべて => `text/plain`

存在しないアセットに対するフォールバック検索は行われません。

## スキルと AGENTS.md、コマンド、ツール、フックの比較

### スキルと AGENTS.md

- **スキル**：タスクコンテキストによって選択されるか、明示的に要求される、名前付きのオプション能力パック
- **AGENTS.md/コンテキストファイル**：コンテキストファイル能力としてロードされ、レベル/深度ルールによってマージされる永続的な指示ファイル

`src/discovery/agents-md.ts` は具体的に `cwd` から親ディレクトリを遡ってスタンドアロンの `AGENTS.md` ファイルを発見します（最大深度 20）。隠しディレクトリセグメントは除外されます。

### スキルとスラッシュコマンド

- **スキル**：モデルが読み取り可能な知識/ワークフローコンテンツ
- **スラッシュコマンド**：ユーザーが呼び出すコマンドエントリポイント
- `/skill:<name>` はスキルテキストを注入する便利なラッパーであり、スキル発見のセマンティクスを変更しません

### スキルとカスタムツール

- **スキル**：プロンプトコンテキストと `read` を通じてロードされるドキュメント/ワークフローコンテンツ
- **カスタムツール**：スキーマとランタイム副作用を持つ、モデルが呼び出し可能な実行可能ツール API

### スキルとフック

- **スキル**：受動的なコンテンツ
- **フック**：実行中に動作をブロック/変更できるイベント駆動のランタイムインターセプター

## 発見ロジックに基づく実用的なオーサリングガイダンス

- 各スキルを独自のディレクトリに配置する：`<skills-root>/<skill-name>/SKILL.md`
- 常に明示的な `name` と `description` フロントマターを含める
- 参照アセットは同じスキルディレクトリ下に配置し、`skill://<name>/...` でアクセスする
- ネストされた分類（`team/domain/skill`）の場合、`skills.customDirectories` をネストされた親ディレクトリに向ける。スキャン自体は非再帰のまま
- ソース間でのスキル名の重複を避ける。プロバイダーの優先順位により最初のマッチが優先される
