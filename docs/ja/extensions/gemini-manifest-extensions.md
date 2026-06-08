---
title: Gemini Manifest Extensions
description: >-
  Gemini manifest extension format for cross-platform skill and agent
  compatibility.
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini マニフェスト拡張 (`gemini-extension.json`)

このドキュメントでは、coding-agent が Gemini スタイルのマニフェスト拡張（`gemini-extension.json`）を検出し、`extensions` ケイパビリティにパースする方法について説明します。

TypeScript/JavaScript 拡張モジュールのロード（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`）については扱って**いません**。それらは `extension-loading.md` に文書化されています。

## 実装ファイル

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 検出対象

Gemini プロバイダー（`id: gemini`、優先度 `60`）は、2つの固定ルートをスキャンする `extensions` ローダーを登録します：

- ユーザー: `~/.gemini/extensions`
- プロジェクト: `<cwd>/.gemini/extensions`

パス解決は `ctx.home` と `ctx.cwd` から `getUserPath()` / `getProjectPath()` を介して直接行われます。

重要なスコープルール: プロジェクトの検索は **cwd のみ**です。親ディレクトリを遡ることはありません。

---

## ディレクトリスキャンルール

各ルート（`~/.gemini/extensions` および `<cwd>/.gemini/extensions`）に対して、検出は以下を行います：

1. `readDirEntries(root)`
2. 直下の子ディレクトリのみを保持（`entry.isDirectory()`）
3. 各子 `<name>` に対して、正確に以下を読み取ろうとする：
   - `<root>/<name>/gemini-extension.json`

1階層を超えた再帰スキャンは行われません。

### 隠しディレクトリ

Gemini マニフェスト検出では、ドットプレフィックス付きのディレクトリ名をフィルタリング**しません**。隠し子ディレクトリが存在し `gemini-extension.json` を含んでいる場合、それは検出対象となります。

### ファイルが存在しない/読み取り不能な場合

`gemini-extension.json` が存在しないか読み取り不能な場合、そのディレクトリは警告なしでスキップされます。

---

## マニフェスト構造（実装に基づく）

ケイパビリティ型は以下のマニフェスト構造を定義しています：

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

検出時の動作は意図的に緩やかです：

- JSON パースの成功が必要です。
- JSON 構文を超えたフィールドの型/内容に対するランタイムスキーマ検証はありません。
- パースされたオブジェクトはケイパビリティアイテムの `manifest` として格納されます。

### 名前の正規化

`Extension.name` は以下のように設定されます：

1. `manifest.name` が `null`/`undefined` でない場合はその値
2. それ以外の場合は拡張ディレクトリ名

ここでは文字列型の強制は適用されません。

---

## ケイパビリティアイテムへの実体化

有効にパースされたマニフェストは1つの `Extension` ケイパビリティアイテムを作成します：

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // ケイパビリティレジストリによって付与
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

注意事項：

- `_source.path` は `createSourceMeta()` によって絶対パスに正規化されます。
- `extensions` に対するレジストリレベルのケイパビリティ検証は、`name` と `path` の存在のみを確認します。
- マニフェストの内部構造（`mcpServers`、`tools`、`context`）は検出時に検証されません。

---

## エラーハンドリングと警告のセマンティクス

### 警告あり

- マニフェストファイル内の無効な JSON：
  - 警告フォーマット: `Invalid JSON in <manifestPath>`

### 警告なし（サイレントスキップ）

- `extensions` ディレクトリが存在しない
- 子ディレクトリに `gemini-extension.json` がない
- マニフェストファイルが読み取り不能
- マニフェスト JSON が構文的には有効だが意味的に不完全/異常

これは、部分的な妥当性が受け入れられることを意味します：構文的な JSON の失敗のみが警告を発します。

---

## 他のソースとの優先順位と重複排除

`extensions` ケイパビリティはケイパビリティレジストリによってプロバイダー間で集約されます。

このケイパビリティの現在のプロバイダー：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）優先度 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）優先度 `60`

重複排除キーは `ext.name` です（`extensionCapability.key = ext => ext.name`）。

### プロバイダー間の優先順位

重複する拡張名では、優先度の高いプロバイダーが優先されます。

- `native` と `gemini` の両方が拡張名 `foo` を出力した場合、native のアイテムが保持されます。
- 低優先度の重複は `result.all` に `_shadowed = true` として保持されるのみです。

### プロバイダー内の順序の影響

重複排除は「最初に検出されたものが優先」であるため、プロバイダーローカルのアイテム順序が重要です。

- Gemini ローダーは**ユーザーを先に**追加し、次に**プロジェクト**を追加します。
- したがって、`~/.gemini/extensions` と `<cwd>/.gemini/extensions` の間で名前が重複した場合、ユーザーエントリが保持され、プロジェクトエントリはシャドウされます。

対照的に、native プロバイダーは設定ディレクトリの順序を異なる方法で構築し（`getConfigDirs()` では `project` が先、次に `user`）、native のプロバイダー内シャドウイングは逆方向になります。

---

## ユーザー vs プロジェクトの動作まとめ

Gemini マニフェストについて具体的に：

- ユーザーとプロジェクトの両方のルートが毎回のロードでスキャンされます。
- プロジェクトルートは `<cwd>/.gemini/extensions` に固定されます（祖先の遡りなし）。
- Gemini ソース内での重複名はユーザー優先で解決されます。
- より高い優先度のプロバイダー（特に native）との重複名は、優先度により負けます。

---

## 境界：検出メタデータ vs ランタイム拡張ロード

`gemini-extension.json` の検出は現在、ケイパビリティメタデータ（`Extension` アイテム）を供給します。実行可能な TS/JS 拡張モジュールを直接ロードすること**はありません**。

ランタイムモジュールのロード（`discoverAndLoadExtensions()` / `loadExtensions()`）は `extension-modules` と明示的なパスを使用し、現在は自動検出されたモジュールをプロバイダー `native` のみにフィルタリングしています。

実用上の意味：

- Gemini マニフェスト拡張はケイパビリティレコードとして検出可能です。
- それら単体では、拡張ローダーパイプラインによってランタイム拡張モジュールとして実行されることはありません。

この境界は現在の実装において意図的なものであり、マニフェスト検出と実行可能モジュールのロードが異なる動作をし得る理由を説明しています。
