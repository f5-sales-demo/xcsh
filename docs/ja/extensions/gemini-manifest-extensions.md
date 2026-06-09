---
title: Geminiマニフェスト拡張
description: クロスプラットフォームのスキルおよびエージェント互換性のためのGeminiマニフェスト拡張フォーマット。
sidebar:
  order: 7
  label: Geminiマニフェスト
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Geminiマニフェスト拡張 (`gemini-extension.json`)

このドキュメントでは、コーディングエージェントがGeminiスタイルのマニフェスト拡張（`gemini-extension.json`）を検出し、`extensions` ケーパビリティにパースする方法について説明します。

TypeScript/JavaScript拡張モジュールのロード（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`）については**扱いません**。それらは `extension-loading.md` に記載されています。

## 実装ファイル

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 検出される内容

Geminiプロバイダー（`id: gemini`、優先度 `60`）は、2つの固定ルートをスキャンする `extensions` ローダーを登録します：

- ユーザー: `~/.gemini/extensions`
- プロジェクト: `<cwd>/.gemini/extensions`

パス解決は `ctx.home` および `ctx.cwd` から `getUserPath()` / `getProjectPath()` を介して直接行われます。

重要なスコープルール：プロジェクトの検索は**cwdのみ**です。親ディレクトリを遡って探索することはありません。

---

## ディレクトリスキャンルール

各ルート（`~/.gemini/extensions` および `<cwd>/.gemini/extensions`）に対して、検出は以下を行います：

1. `readDirEntries(root)`
2. 直接の子ディレクトリのみを保持（`entry.isDirectory()`）
3. 各子 `<name>` に対して、正確に以下の読み取りを試行：
   - `<root>/<name>/gemini-extension.json`

1ディレクトリレベルを超える再帰的スキャンはありません。

### 隠しディレクトリ

Geminiマニフェスト検出では、ドットプレフィックスのディレクトリ名をフィルタリング**しません**。隠し子ディレクトリが存在し、`gemini-extension.json` を含む場合、それは検出対象となります。

### 欠損/読み取り不能なファイル

`gemini-extension.json` が欠損しているか読み取り不能な場合、そのディレクトリは警告なしでスキップされます。

---

## マニフェスト形状（実装通り）

ケーパビリティ型は以下のマニフェスト形状を定義します：

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

検出時の動作は意図的に緩くなっています：

- JSONパースの成功が必須です。
- JSON構文以外のフィールド型/内容に対するランタイムスキーマ検証はありません。
- パースされたオブジェクトはケーパビリティアイテムに `manifest` として格納されます。

### 名前の正規化

`Extension.name` は以下のように設定されます：

1. `manifest.name` が `null`/`undefined` でない場合はその値
2. それ以外の場合は拡張ディレクトリ名

ここでは文字列型の強制は適用されません。

---

## ケーパビリティアイテムへの具体化

有効にパースされたマニフェストは1つの `Extension` ケーパビリティアイテムを作成します：

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // ケーパビリティレジストリによって付加
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

注意事項：

- `_source.path` は `createSourceMeta()` によって絶対パスに正規化されます。
- `extensions` に対するレジストリレベルのケーパビリティ検証は、`name` と `path` の存在のみをチェックします。
- マニフェスト内部（`mcpServers`、`tools`、`context`）は検出時に検証されません。

---

## エラーハンドリングと警告セマンティクス

### 警告が出る場合

- マニフェストファイル内の無効なJSON：
  - 警告フォーマット: `Invalid JSON in <manifestPath>`

### 警告なし（サイレントスキップ）

- `extensions` ディレクトリが存在しない
- 子ディレクトリに `gemini-extension.json` がない
- 読み取り不能なマニフェストファイル
- マニフェストJSONが構文的には有効だが意味的に異常/不完全

これは部分的な有効性が受け入れられることを意味します：構文的なJSON失敗のみが警告を出します。

---

## 他のソースとの優先順位と重複排除

`extensions` ケーパビリティはケーパビリティレジストリによってプロバイダー間で集約されます。

このケーパビリティの現在のプロバイダー：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）優先度 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）優先度 `60`

重複排除キーは `ext.name` です（`extensionCapability.key = ext => ext.name`）。

### プロバイダー間の優先順位

重複する拡張名では、優先度が高いプロバイダーが勝ちます。

- `native` と `gemini` の両方が拡張名 `foo` を出力した場合、nativeアイテムが保持されます。
- 優先度が低い重複は `result.all` にのみ `_shadowed = true` で保持されます。

### プロバイダー内の順序の影響

重複排除は「先に見つかったものが勝つ」ため、プロバイダーローカルのアイテム順序が重要です。

- Geminiローダーは**ユーザーを先に**、次に**プロジェクト**を追加します。
- そのため、`~/.gemini/extensions` と `<cwd>/.gemini/extensions` 間の重複名はユーザーエントリが保持され、プロジェクトエントリがシャドウされます。

対照的に、nativeプロバイダーは設定ディレクトリの順序を異なる方法で構築し（`getConfigDirs()` で `project` が先、次に `user`）、nativeのプロバイダー内シャドウイングは逆方向になります。

---

## ユーザー vs プロジェクトの動作まとめ

Geminiマニフェストに特化した内容：

- ユーザーとプロジェクトの両方のルートが毎回のロードでスキャンされます。
- プロジェクトルートは `<cwd>/.gemini/extensions` に固定されています（祖先探索なし）。
- Geminiソース内の重複名はユーザー優先で解決されます。
- 優先度が高いプロバイダー（特にnative）との重複名は優先度により負けます。

---

## 境界：検出メタデータ vs ランタイム拡張ロード

`gemini-extension.json` の検出は現在、ケーパビリティメタデータ（`Extension` アイテム）を提供します。実行可能なTS/JS拡張モジュールを直接ロードすることは**ありません**。

ランタイムモジュールロード（`discoverAndLoadExtensions()` / `loadExtensions()`）は `extension-modules` と明示的なパスを使用し、現在、自動検出されたモジュールをプロバイダー `native` のみにフィルタリングしています。

実用的な意味：

- Geminiマニフェスト拡張はケーパビリティレコードとして検出可能です。
- それ自体では、拡張ローダーパイプラインによってランタイム拡張モジュールとして実行されません。

この境界は現在の実装では意図的なものであり、マニフェスト検出と実行可能モジュールロードが乖離しうる理由を説明しています。
