---
title: スキル
description: コーディングエージェントにおける特化した機能の登録、検出、呼び出しのためのスキルシステム。
sidebar:
  order: 3
  label: スキル
i18n:
  sourceHash: 3e062cc13851
  translator: machine
---

# スキル

スキルはファイルベースの機能パックであり、起動時に検出され、以下の形式でモデルに公開されます：

- システムプロンプト内の軽量メタデータ（名前 + 説明）
- `read skill://...` によるオンデマンドコンテンツ
- オプションのインタラクティブ `/skill:<name>` コマンド

このドキュメントでは、`src/extensibility/skills.ts`、`src/discovery/builtin.ts`、`src/internal-urls/skill-protocol.ts`、および `src/discovery/agents-md.ts` における現在のランタイム動作を説明します。

## このコードベースにおけるスキルとは

検出されたスキルは以下で表現されます：

- `name`
- `description`
- `filePath`（`SKILL.md` のパス）
- `baseDir`（スキルディレクトリ）
- ソースメタデータ（`provider`、`level`、パス）

ランタイムが有効性のために必要とするのは `name` と `path` のみです。実際には、マッチングの品質は `description` が意味のあるものであるかどうかに依存します。

## 必須のレイアウトと SKILL.md の要件

### ディレクトリレイアウト

プロバイダーベースの検出（native/Claude/Codex/Agents/plugin プロバイダー）では、スキルは **`skills/` の1階層下** として検出されます：

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md` のようなネストされたパターンは、プロバイダーローダーでは検出されません。

`skills.customDirectories` の場合、スキャンは同じ非再帰的なレイアウト（`*/SKILL.md`）を使用します。

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
  - ネイティブ `.xcsh` プロバイダーのスキル検出（`requireDescription: true`）
  - `src/discovery/helpers.ts` の `scanSkillsFromDir` 経由の `skills.customDirectories` スキャン（非再帰的）
- ネイティブ以外のプロバイダーは説明なしでスキルをロードできます

## 検出パイプライン

`src/extensibility/skills.ts` の `discoverSkills()` は2つのパスを実行します：

1. `loadCapability("skills")` 経由の **機能プロバイダー**
2. `scanSkillsFromDir(..., { requireDescription: true })` 経由の **カスタムディレクトリ**（1階層のディレクトリ列挙）

`skills.enabled` が `false` の場合、検出はスキルを返しません。

### 組み込みスキルプロバイダーと優先順位

プロバイダーの順序は優先度優先（高い方が勝つ）で、同順位の場合は登録順です。

現在登録されているスキルプロバイダー：

1. `native`（優先度 100）— `src/discovery/builtin.ts` 経由の `.xcsh` ユーザー/プロジェクトスキル
2. `claude`（優先度 80）
3. 優先度 70 グループ（登録順）：
   - `claude-plugins`
   - `agents`
   - `codex`

重複排除キーはスキル名です。指定された名前の最初のアイテムが優先されます。

### ソーストグルとフィルタリング

`discoverSkills()` は以下の制御を適用します：

- ソーストグル：`enableCodexUser`、`enableClaudeUser`、`enableClaudeProject`、`enablePiUser`、`enablePiProject`
- スキル名に対する glob フィルター：
  - `ignoredSkills`（除外）
  - `includeSkills`（許可リストへの包含；空の場合はすべてを含む）

フィルター順序：

1. ソースが有効
2. 無視されていない
3. 包含されている（包含リストがある場合）

codex/claude/native 以外のプロバイダー（例：`agents`、`claude-plugins`）では、有効化は現在のところ次のフォールバックに従います：**いずれかの**組み込みソーストグルが有効であれば有効。

### 衝突と重複の処理

- 機能の重複排除は、名前ごとに最初のスキルを保持します（最高優先度のプロバイダー）
- `extensibility/skills.ts` はさらに：
  - `realpath` による同一ファイルの重複排除（シンボリックリンク対応）
  - 後続のスキル名が競合する場合に衝突警告を発行
  - `scanSkillsFromDir` のシンアダプターとして便利な `discoverSkillsFromDir({ dir, source })` API を保持
- カスタムディレクトリのスキルはプロバイダースキルの後にマージされ、同じ衝突動作に従います

## ランタイム使用動作

### システムプロンプトへの公開

システムプロンプトの構築（`src/system-prompt.ts`）は、検出されたスキルを以下のように使用します：

- `read` ツールが利用可能な場合：
  - 検出されたスキルリストをプロンプトに含める
- それ以外の場合：
  - 検出されたリストを省略

Task ツールのサブエージェントは、通常のセッション作成を通じてセッションの検出/提供されたスキルリストを受け取ります。タスクごとのスキル固定オーバーライドはありません。

### インタラクティブ `/skill:<name>` コマンド

`skills.enableSkillCommands` が true の場合、インタラクティブモードは検出されたスキルごとに1つのスラッシュコマンドを登録します。

`/skill:<name> [args]` の動作：

- `filePath` からスキルファイルを直接読み取る
- フロントマターを除去
- スキル本文をフォローアップカスタムメッセージとして挿入
- メタデータを追加（`Skill: <path>`、オプションで `User: <args>`）

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

存在しないアセットに対するフォールバック検索は実行されません。

## スキル vs XCSH.md、コマンド、ツール、フック

### スキル vs XCSH.md

- **スキル**：タスクコンテキストによって選択されるか、明示的に要求される名前付きのオプション機能パック
- **XCSH.md/コンテキストファイル**：コンテキストファイル機能としてロードされ、レベル/深度ルールによってマージされる永続的な指示ファイル

`src/discovery/agents-md.ts` は、`cwd` から親ディレクトリを上方にたどり、スタンドアロンの `XCSH.md` ファイルを検出します（深度 20 まで）。隠しディレクトリセグメントは除外されます。

### スキル vs スラッシュコマンド

- **スキル**：モデルが読み取り可能なナレッジ/ワークフローコンテンツ
- **スラッシュコマンド**：ユーザーが呼び出すコマンドエントリポイント
- `/skill:<name>` はスキルテキストを挿入する便利なラッパーです。スキル検出のセマンティクスは変更しません

### スキル vs カスタムツール

- **スキル**：プロンプトコンテキストと `read` を通じてロードされるドキュメント/ワークフローコンテンツ
- **カスタムツール**：スキーマとランタイム副作用を持つ、モデルが呼び出し可能な実行可能ツール API

### スキル vs フック

- **スキル**：パッシブコンテンツ
- **フック**：実行中に動作をブロック/変更できるイベント駆動のランタイムインターセプター

## 検出ロジックに基づく実践的なオーサリングガイダンス

- 各スキルを独自のディレクトリに配置する：`<skills-root>/<skill-name>/SKILL.md`
- 常に明示的な `name` と `description` フロントマターを含める
- 参照されるアセットは同じスキルディレクトリ下に置き、`skill://<name>/...` でアクセスする
- ネストされた分類体系（`team/domain/skill`）の場合は、`skills.customDirectories` をネストされた親ディレクトリに指定する。スキャン自体は非再帰的のまま
- ソース間でスキル名が重複しないようにする。プロバイダーの優先順位により最初のマッチが優先されます
