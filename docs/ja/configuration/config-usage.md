---
title: 設定の探索と解決
description: xcsh がプロジェクト、ユーザー、およびエンタープライズルートから設定を探索、解決、および階層化する方法。
sidebar:
  order: 1
  label: 設定
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# 設定の探索と解決

このドキュメントでは、coding-agent が現在どのように設定を解決しているかについて説明します。スキャンされるルート、優先順位の仕組み、そして解決された設定が settings、skills、hooks、tools、および extensions によってどのように使用されるかを記載しています。

## スコープ

主要な実装:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

主要な統合ポイント:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## 解決フロー（視覚的表現）

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) 設定ルートとソース順序

## 正規ルート

`src/config.ts` は固定のソース優先順位リストを定義しています:

1. `.xcsh` (ネイティブ)
2. `.claude`
3. `.codex`
4. `.gemini`

ユーザーレベルのベース:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

プロジェクトレベルのベース:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` は `.xcsh` です（`packages/utils/src/dirs.ts`）。

## 重要な制約

`src/config.ts` の汎用ヘルパーは、ソース探索順序に `.pi` を含み**ません**。

---

## 2) コア探索ヘルパー（`src/config.ts`）

## `getConfigDirs(subpath, options)`

順序付きエントリを返します:

- まずユーザーレベルのエントリ（ソース優先順位順）
- 次にプロジェクトレベルのエントリ（同じソース優先順位順）

オプション:

- `user`（デフォルト `true`）
- `project`（デフォルト `true`）
- `cwd`（デフォルト `getProjectDir()`）
- `existingOnly`（デフォルト `false`）

この API は、ディレクトリベースの設定検索（commands、hooks、tools、agents など）に使用されます。

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

順序付きベース全体で最初に存在するファイルを検索し、最初にマッチしたもの（パスのみ、またはパス+メタデータ）を返します。

## `findAllNearestProjectConfigDirs(subpath, cwd)`

親ディレクトリを上方向にたどり、**ソースベースごとに最も近い既存ディレクトリ**（`.xcsh`、`.claude`、`.codex`、`.gemini`）を返し、結果をソース優先順位でソートします。

プロジェクト設定が祖先ディレクトリから継承されるべき場合（モノレポ/ネストされたワークスペースの動作）に使用します。

---

## 3) ファイル設定ラッパー（`src/config.ts` の `ConfigFile<T>`）

`ConfigFile<T>` は、単一設定ファイルのスキーマ検証付きローダーです。

サポートされるフォーマット:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

動作:

- 提供された TypeBox スキーマに対して AJV でパースされたデータを検証します。
- `invalidate()` が呼ばれるまでロード結果をキャッシュします。
- `tryLoad()` 経由で三状態の結果を返します:
  - `ok`
  - `not-found`
  - `error`（スキーマ/パースコンテキスト付きの `ConfigError`）

レガシーマイグレーションは引き続きサポートされています:

- ターゲットパスが `.yml`/`.yaml` の場合、兄弟の `.json` が一度だけ自動マイグレーションされます（`migrateJsonToYml`）。

---

## 4) Settings 解決モデル（`src/config/settings.ts`）

ランタイム設定モデルは階層化されています:

1. グローバル設定: `~/.xcsh/agent/config.yml`
2. プロジェクト設定: settings ケーパビリティ経由で探索（プロバイダーからの `settings.json`）
3. ランタイムオーバーライド: インメモリ、非永続
4. スキーマデフォルト: `SETTINGS_SCHEMA` から

実効的な読み取りパス:

`defaults <- global <- project <- overrides`

書き込みの動作:

- `settings.set(...)` は**グローバル**レイヤー（`config.yml`）に書き込み、バックグラウンド保存をキューに入れます。
- プロジェクト設定はケーパビリティ探索からの読み取り専用です。

## マイグレーション動作は引き続きアクティブ

起動時に `config.yml` が存在しない場合:

1. `~/.xcsh/agent/settings.json` からマイグレーション（成功時に `.bak` にリネーム）
2. `agent.db` からのレガシー DB 設定とマージ
3. マージ結果を `config.yml` に書き込み

`#migrateRawSettings` のフィールドレベルマイグレーション:

- `queueMode` -> `steeringMode`
- `ask.timeout` ミリ秒 -> 秒（古い値がミリ秒のように見える場合 (`> 1000`)）
- レガシーのフラット `theme: "..."` -> `theme.dark/theme.light` 構造

---

## 5) ケーパビリティ/探索の統合

コア以外のほとんどの設定ロードフローは、ケーパビリティレジストリ（`src/capability/index.ts` + `src/discovery/index.ts`）を通じて行われます。

## プロバイダー順序

プロバイダーは数値の優先度でソートされます（高い方が優先）。優先度の例:

- ネイティブ OMP（`builtin.ts`）: `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## 重複排除のセマンティクス

ケーパビリティは `key(item)` を定義します:

- 同じキー => 最初のアイテムが優先（より高い優先度/先にロードされたアイテム）
- キーなし（`undefined`）=> 重複排除なし、すべてのアイテムが保持される

関連するキー:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: 重複排除なし（すべてのアイテムが保持される）

---

## 6) ネイティブ `.xcsh` プロバイダーの動作（`src/discovery/builtin.ts`）

ネイティブプロバイダー（`id: native`）は以下から読み取ります:

- プロジェクト: `<cwd>/.xcsh/...`
- ユーザー: `~/.xcsh/agent/...`

### ディレクトリ許可ルール

`builtin.ts` は、ディレクトリが存在し**かつ空でない**場合（`ifNonEmptyDir`）のみ設定ルートを含めます。

### スコープ固有のロード

- Skills: `skills/*/SKILL.md`
- スラッシュコマンド: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` および `tools/<name>/index.ts`
- Extension modules: `extensions/` 配下で探索（+ レガシー `settings.json.extensions` 文字列配列）
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings ケーパビリティ: `settings.json`

### nearest-project 検索のニュアンス

`SYSTEM.md` と `XCSH.md` について、ネイティブプロバイダーは最も近い祖先のプロジェクト `.xcsh` ディレクトリ検索（上方向へのたどり）を使用しますが、`.xcsh` ディレクトリが空でないことを引き続き要求します。

---

## 7) 主要サブシステムが設定を使用する方法

## Settings サブシステム

- `Settings.init()` はグローバル `config.yml` + 探索されたプロジェクト `settings.json` ケーパビリティアイテムをロードします。
- `level === "project"` のケーパビリティアイテムのみがプロジェクトレイヤーにマージされます。

## Skills サブシステム

- `extensibility/skills.ts` は `loadCapability(skillCapability.id, { cwd })` 経由でロードします。
- ソーストグルとフィルター（`ignoredSkills`、`includeSkills`、カスタムディレクトリ）を適用します。
- レガシー名のトグルがまだ存在します（`skills.enablePiUser`、`skills.enablePiProject`）が、これらはネイティブプロバイダー（`provider === "native"`）をゲートします。

## Hooks サブシステム

- `discoverAndLoadHooks()` は hook ケーパビリティ + 明示的に設定されたパスからフックパスを解決します。
- その後、Bun import 経由でモジュールをロードします。

## Tools サブシステム

- `discoverAndLoadCustomTools()` は tool ケーパビリティ + プラグインツールパス + 明示的に設定されたパスからツールパスを解決します。
- 宣言的な `.md/.json` ツールファイルはメタデータのみです。実行可能なロードはコードモジュールを期待します。

## Extensions サブシステム

- `discoverAndLoadExtensions()` は extension-module ケーパビリティ + 明示的なパスからエクステンションモジュールを解決します。
- 現在の実装は、ロード前に `_source.provider === "native"` のケーパビリティアイテムのみを意図的に保持します。

---

## 8) 依拠すべき優先順位ルール

以下のメンタルモデルを使用してください:

1. `config.ts` のソースディレクトリ順序が候補パスの順序を決定します。
2. ケーパビリティプロバイダーの優先度がプロバイダー間の優先順位を決定します。
3. ケーパビリティキーの重複排除が衝突時の動作を決定します（キー付きケーパビリティでは最初のものが優先）。
4. サブシステム固有のマージロジックが実効的な優先順位をさらに変更する場合があります（特に settings）。

### Settings 固有の注意事項

Settings ケーパビリティアイテムは重複排除されません。`Settings.#loadProjectSettings()` は返された順序でプロジェクトアイテムをディープマージします。マージは後のアイテムの値を前のアイテムの値に上書き適用するため、実効的なオーバーライド動作はケーパビリティキーのセマンティクスだけでなく、プロバイダーの出力順序に依存します。

---

## 9) 現在も存在するレガシー/互換性動作

- `ConfigFile` の YAML 対象ファイルに対する JSON -> YAML マイグレーション。
- `settings.json` および `agent.db` から `config.yml` への Settings マイグレーション。
- Settings キーのマイグレーション（`queueMode`、`ask.timeout`、フラット `theme`）。
- エクステンションマニフェストの互換性: ローダーは `package.json.xcsh` と `package.json.pi` の両方のマニフェストセクションを受け入れます。
- レガシー設定名 `skills.enablePiUser` / `skills.enablePiProject` は、ネイティブスキルソースのアクティブなゲートとして引き続き機能しています。

これらの互換性パスがコードから削除された場合は、このドキュメントを直ちに更新してください。現在、いくつかのランタイム動作がこれらに依存しています。
