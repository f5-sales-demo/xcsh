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

TypeScript/JavaScript 拡張モジュールの読み込み（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`）については **扱いません**。それらは `extension-loading.md` に文書化されています。

## 実装ファイル

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 検出される内容

Gemini プロバイダー（`id: gemini`、優先度 `60`）は、2 つの固定ルートをスキャンする `extensions` ローダーを登録します：

- ユーザー: `~/.gemini/extensions`
- プロジェクト: `<cwd>/.gemini/extensions`

パス解決は `ctx.home` と `ctx.cwd` から `getUserPath()` / `getProjectPath()` を通じて直接行われます。

重要なスコープルール: プロジェクトの検索は **cwd のみ** です。親ディレクトリを遡ることはありません。

---

## ディレクトリスキャンルール

各ルート（`~/.gemini/extensions` と `<cwd>/.gemini/extensions`）について、検出は以下を行います：

1. `readDirEntries(root)`
2. 直下の子ディレクトリのみを保持（`entry.isDirectory()`）
3. 各子ディレクトリ `<name>` について、以下のファイルの読み取りを試行：
   - `<root>/<name>/gemini-extension.json`

1 階層を超える再帰的なスキャンは行われません。

### 隠しディレクトリ

Gemini マニフェストの検出では、ドットプレフィックスのディレクトリ名をフィルタリング **しません**。隠し子ディレクトリが存在し、`gemini-extension.json` を含む場合、それは検出対象となります。

### 欠落/読み取り不能なファイル

`gemini-extension.json` が欠落しているか読み取り不能な場合、そのディレクトリは警告なしでスキップされます。

---

## マニフェストの形状（実装に基づく）

ケイパビリティ型は以下のマニフェスト形状を定義します：

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
- JSON 構文以外のフィールド型/内容に対するランタイムスキーマ検証はありません。
- パースされたオブジェクトは、ケイパビリティアイテムの `manifest` として保存されます。

### 名前の正規化

`Extension.name` は以下のように設定されます：

1. `manifest.name` が `null`/`undefined` でない場合は `manifest.name`
2. それ以外の場合は拡張ディレクトリ名

ここでは文字列型の強制は適用されません。

---

## ケイパビリティアイテムへの具現化

有効にパースされたマニフェストは、1 つの `Extension` ケイパビリティアイテムを作成します：

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

注意事項：

- `_source.path` は `createSourceMeta()` によって絶対パスに正規化されます。
- `extensions` に対するレジストリレベルのケイパビリティ検証は、`name` と `path` の存在のみをチェックします。
- マニフェストの内部（`mcpServers`、`tools`、`context`）は検出時に検証されません。

---

## エラーハンドリングと警告のセマンティクス

### 警告が発生するケース

- マニフェストファイルの無効な JSON：
  - 警告フォーマット: `Invalid JSON in <manifestPath>`

### 警告なし（サイレントスキップ）

- `extensions` ディレクトリが存在しない
- 子ディレクトリに `gemini-extension.json` がない
- 読み取り不能なマニフェストファイル
- マニフェスト JSON が構文的には有効だが、意味的に不適切/不完全

これは部分的な妥当性が受け入れられることを意味します：構文的な JSON 失敗のみが警告を発生させます。

---

## 他のソースとの優先順位と重複排除

`extensions` ケイパビリティは、ケイパビリティレジストリによってプロバイダー間で集約されます。

このケイパビリティの現在のプロバイダー：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）優先度 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）優先度 `60`

重複排除キーは `ext.name`（`extensionCapability.key = ext => ext.name`）です。

### プロバイダー間の優先順位

重複する拡張名では、優先度の高いプロバイダーが優先されます。

- `native` と `gemini` の両方が拡張名 `foo` を出力した場合、native のアイテムが保持されます。
- 優先度の低い重複は `result.all` にのみ `_shadowed = true` として保持されます。

### プロバイダー内の順序の影響

重複排除は「先に検出された方が優先」であるため、プロバイダーローカルのアイテム順序が重要です。

- Gemini ローダーは **ユーザーを先に**、次に **プロジェクト** を追加します。
- したがって、`~/.gemini/extensions` と `<cwd>/.gemini/extensions` の間で名前が重複した場合、ユーザーのエントリが保持され、プロジェクトのエントリがシャドウされます。

対照的に、native プロバイダーは設定ディレクトリの順序が異なり（`getConfigDirs()` で `project` の後に `user`）、native のプロバイダー内シャドウイングは逆方向になります。

---

## ユーザー vs プロジェクトの動作まとめ

Gemini マニフェストに特有の挙動：

- 各読み込み時にユーザーとプロジェクトの両方のルートがスキャンされます。
- プロジェクトルートは `<cwd>/.gemini/extensions` に固定されます（祖先ディレクトリの遡りなし）。
- Gemini ソース内の重複名はユーザー優先で解決されます。
- 優先度の高いプロバイダー（特に native）に対する重複名は優先度により敗北します。

---

## 境界：検出メタデータ vs ランタイム拡張の読み込み

`gemini-extension.json` の検出は、現在ケイパビリティメタデータ（`Extension` アイテム）を供給します。実行可能な TS/JS 拡張モジュールを直接読み込むことは **ありません**。

ランタイムモジュールの読み込み（`discoverAndLoadExtensions()` / `loadExtensions()`）は `extension-modules` と明示的なパスを使用し、現在は自動検出されたモジュールをプロバイダー `native` のみにフィルタリングしています。

実用上の意味：

- Gemini マニフェスト拡張はケイパビリティレコードとして検出可能です。
- それ自体では、拡張ローダーパイプラインによってランタイム拡張モジュールとして実行されることはありません。

この境界は現在の実装において意図的なものであり、マニフェストの検出と実行可能なモジュールの読み込みが乖離しうる理由を説明しています。
