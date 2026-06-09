---
title: 設定の検出と解決
description: xcshがプロジェクト、ユーザー、エンタープライズルートから設定をどのように検出、解決、レイヤー化するかについて。
sidebar:
  order: 1
  label: 設定
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# 設定の検出と解決

このドキュメントでは、coding-agentが現在どのように設定を解決するかを説明します：スキャンされるルート、優先順位の仕組み、および解決された設定がsettings、skills、hooks、tools、extensionsによってどのように消費されるかを記述します。

## スコープ

主要な実装：

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

主要な統合ポイント：

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## 解決フロー（ビジュアル）

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

`src/config.ts`は固定のソース優先順位リストを定義します：

1. `.xcsh`（ネイティブ）
2. `.claude`
3. `.codex`
4. `.gemini`

ユーザーレベルのベース：

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

プロジェクトレベルのベース：

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME`は`.xcsh`です（`packages/utils/src/dirs.ts`）。

## 重要な制約

`src/config.ts`の汎用ヘルパーは、ソース検出順序に`.pi`を**含みません**。

---

## 2) コア検出ヘルパー（`src/config.ts`）

## `getConfigDirs(subpath, options)`

順序付きエントリを返します：

- ユーザーレベルのエントリが最初（ソース優先順位順）
- 次にプロジェクトレベルのエントリ（同じソース優先順位順）

オプション：

- `user`（デフォルト `true`）
- `project`（デフォルト `true`）
- `cwd`（デフォルト `getProjectDir()`）
- `existingOnly`（デフォルト `false`）

このAPIはディレクトリベースの設定ルックアップ（commands、hooks、tools、agentsなど）に使用されます。

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

順序付きベース全体で最初に存在するファイルを検索し、最初の一致を返します（パスのみ、またはパス+メタデータ）。

## `findAllNearestProjectConfigDirs(subpath, cwd)`

親ディレクトリを上方に辿り、**ソースベースごとの最も近い既存ディレクトリ**（`.xcsh`、`.claude`、`.codex`、`.gemini`）を返し、結果をソース優先順位でソートします。

プロジェクト設定を祖先ディレクトリから継承する必要がある場合に使用します（モノリポ/ネストされたワークスペースの動作）。

---

## 3) ファイル設定ラッパー（`src/config.ts`の`ConfigFile<T>`）

`ConfigFile<T>`は、単一設定ファイル用のスキーマ検証付きローダーです。

サポートされるフォーマット：

- `.yml` / `.yaml`
- `.json` / `.jsonc`

動作：

- 提供されたTypeBoxスキーマに対してAJVで解析データを検証します。
- `invalidate()`まで読み込み結果をキャッシュします。
- `tryLoad()`で三状態の結果を返します：
  - `ok`
  - `not-found`
  - `error`（スキーマ/解析コンテキスト付きの`ConfigError`）

レガシーマイグレーションは引き続きサポートされています：

- ターゲットパスが`.yml`/`.yaml`の場合、兄弟の`.json`が一度だけ自動マイグレーションされます（`migrateJsonToYml`）。

---

## 4) 設定解決モデル（`src/config/settings.ts`）

ランタイム設定モデルはレイヤー化されています：

1. グローバル設定：`~/.xcsh/agent/config.yml`
2. プロジェクト設定：settings capability経由で検出（プロバイダーからの`settings.json`）
3. ランタイムオーバーライド：インメモリ、非永続
4. スキーマデフォルト：`SETTINGS_SCHEMA`から

有効な読み取りパス：

`defaults <- global <- project <- overrides`

書き込み動作：

- `settings.set(...)`は**グローバル**レイヤー（`config.yml`）に書き込み、バックグラウンド保存をキューに入れます。
- プロジェクト設定はcapability検出からの読み取り専用です。

## マイグレーション動作はまだアクティブ

起動時に`config.yml`が見つからない場合：

1. `~/.xcsh/agent/settings.json`からマイグレーション（成功時に`.bak`にリネーム）
2. `agent.db`のレガシーDB設定とマージ
3. マージ結果を`config.yml`に書き込み

`#migrateRawSettings`でのフィールドレベルマイグレーション：

- `queueMode` -> `steeringMode`
- `ask.timeout`のミリ秒から秒への変換（古い値がミリ秒に見える場合、`> 1000`）
- レガシーのフラット`theme: "..."` -> `theme.dark/theme.light`構造

---

## 5) Capability/discovery統合

ほとんどの非コア設定読み込みは、capabilityレジストリ（`src/capability/index.ts` + `src/discovery/index.ts`）を通じて行われます。

## プロバイダーの順序

プロバイダーは数値優先度でソートされます（高い方が先）。優先度の例：

- ネイティブOMP（`builtin.ts`）：`100`
- Claude：`80`
- Codex / agents / Claude marketplace：`70`
- Gemini：`60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## 重複排除セマンティクス

Capabilityは`key(item)`を定義します：

- 同じkey => 最初のアイテムが勝利（より高い優先度/より早く読み込まれたアイテム）
- keyなし（`undefined`） => 重複排除なし、すべてのアイテムが保持される

関連するkey：

- skills：`name`
- tools：`name`
- hooks：`${type}:${tool}:${name}`
- extension modules：`name`
- extensions：`name`
- settings：重複排除なし（すべてのアイテムが保持される）

---

## 6) ネイティブ`.xcsh`プロバイダーの動作（`src/discovery/builtin.ts`）

ネイティブプロバイダー（`id: native`）は以下から読み取ります：

- プロジェクト：`<cwd>/.xcsh/...`
- ユーザー：`~/.xcsh/agent/...`

### ディレクトリ受け入れルール

`builtin.ts`は、ディレクトリが存在し**かつ空でない**場合にのみ設定ルートを含めます（`ifNonEmptyDir`）。

### スコープ固有の読み込み

- Skills：`skills/*/SKILL.md`
- スラッシュコマンド：`commands/*.md`
- Rules：`rules/*.{md,mdc}`
- Prompts：`prompts/*.md`
- Instructions：`instructions/*.md`
- Hooks：`hooks/pre/*`、`hooks/post/*`
- Tools：`tools/*.json|*.md`および`tools/<name>/index.ts`
- Extension modules：`extensions/`配下で検出（+ レガシー`settings.json.extensions`文字列配列）
- Extensions：`extensions/<name>/gemini-extension.json`
- Settings capability：`settings.json`

### 最寄りプロジェクトルックアップの注意点

`SYSTEM.md`と`AGENTS.md`については、ネイティブプロバイダーは最寄りの祖先プロジェクト`.xcsh`ディレクトリ検索（上方走査）を使用しますが、`.xcsh`ディレクトリが空でないことを依然として要求します。

---

## 7) 主要サブシステムが設定を消費する方法

## Settingsサブシステム

- `Settings.init()`はグローバル`config.yml` + 検出されたプロジェクト`settings.json` capabilityアイテムを読み込みます。
- `level === "project"`のcapabilityアイテムのみがプロジェクトレイヤーにマージされます。

## Skillsサブシステム

- `extensibility/skills.ts`は`loadCapability(skillCapability.id, { cwd })`経由で読み込みます。
- ソーストグルとフィルターを適用します（`ignoredSkills`、`includeSkills`、カスタムディレクトリ）。
- レガシー名のトグルはまだ存在します（`skills.enablePiUser`、`skills.enablePiProject`）が、ネイティブプロバイダー（`provider === "native"`）をゲートします。

## Hooksサブシステム

- `discoverAndLoadHooks()`はhook capabilityと明示的に設定されたパスからフックパスを解決します。
- その後、Bun importを介してモジュールを読み込みます。

## Toolsサブシステム

- `discoverAndLoadCustomTools()`はtool capability + プラグインツールパス + 明示的に設定されたパスからツールパスを解決します。
- 宣言的な`.md/.json`ツールファイルはメタデータのみです。実行可能なロードにはコードモジュールが期待されます。

## Extensionsサブシステム

- `discoverAndLoadExtensions()`はextension-module capabilityと明示的なパスからextensionモジュールを解決します。
- 現在の実装では、ロード前に`_source.provider === "native"`のcapabilityアイテムのみを意図的に保持します。

---

## 8) 依存すべき優先順位ルール

以下のメンタルモデルを使用してください：

1. `config.ts`のソースディレクトリ順序が候補パスの順序を決定します。
2. Capabilityプロバイダーの優先度がクロスプロバイダーの優先順位を決定します。
3. Capability keyの重複排除が衝突動作を決定します（keyありcapabilityでは最初のものが勝利）。
4. サブシステム固有のマージロジックが有効な優先順位をさらに変更する場合があります（特にsettings）。

### Settings固有の注意事項

Settings capabilityアイテムは重複排除されません。`Settings.#loadProjectSettings()`は返された順序でプロジェクトアイテムをディープマージします。マージは後のアイテムの値を前のアイテムの値に上書き適用するため、有効なオーバーライド動作はcapability keyセマンティクスだけでなく、プロバイダーの出力順序に依存します。

---

## 9) まだ存在するレガシー/互換性動作

- `ConfigFile`のYAML対象ファイルに対するJSON -> YAMLマイグレーション。
- `settings.json`および`agent.db`から`config.yml`への設定マイグレーション。
- 設定キーマイグレーション（`queueMode`、`ask.timeout`、フラット`theme`）。
- Extensionマニフェスト互換性：ローダーは`package.json.xcsh`と`package.json.pi`の両方のマニフェストセクションを受け入れます。
- レガシー設定名`skills.enablePiUser` / `skills.enablePiProject`はネイティブスキルソースのアクティブなゲートとして引き続き機能します。

これらの互換性パスがコードから削除された場合は、このドキュメントを直ちに更新してください。現在、いくつかのランタイム動作がこれらに依存しています。
