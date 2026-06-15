---
title: Gemini マニフェスト拡張
description: クロスプラットフォームのスキルおよびエージェント互換性のための Gemini マニフェスト拡張フォーマット。
sidebar:
  order: 7
  label: Gemini マニフェスト
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini マニフェスト拡張 (`gemini-extension.json`)

このドキュメントでは、コーディングエージェントが Gemini スタイルのマニフェスト拡張 (`gemini-extension.json`) を検出し、`extensions` ケーパビリティとしてパースする方法について説明します。

TypeScript/JavaScript 拡張モジュールのロード（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`）については、`extension-loading.md` に記載されており、本ドキュメントでは扱いません。

## 実装ファイル

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 検出対象

Gemini プロバイダー（`id: gemini`、優先度 `60`）は `extensions` ローダーを登録し、2 つの固定ルートをスキャンします。

- ユーザー: `~/.gemini/extensions`
- プロジェクト: `<cwd>/.gemini/extensions`

パス解決は `getUserPath()` / `getProjectPath()` を通じて `ctx.home` および `ctx.cwd` から直接行われます。

重要なスコープルール: プロジェクトのルックアップは **cwd のみ** です。親ディレクトリをたどることはありません。

---

## ディレクトリスキャンのルール

各ルート（`~/.gemini/extensions` および `<cwd>/.gemini/extensions`）に対して、検出処理は以下を行います。

1. `readDirEntries(root)` を実行
2. 直接の子ディレクトリのみを保持（`entry.isDirectory()`）
3. 各子 `<name>` に対して、正確に以下のみを読み取ろうとする:
   - `<root>/<name>/gemini-extension.json`

1 ディレクトリレベルを超えた再帰的スキャンは行いません。

### 隠しディレクトリ

Gemini マニフェスト検出では、ドットプレフィックスのディレクトリ名をフィルタリング**しません**。隠し子ディレクトリが存在し `gemini-extension.json` を含む場合、そのディレクトリは対象として扱われます。

### 欠落または読み取り不能なファイル

`gemini-extension.json` が欠落しているか読み取り不能な場合、そのディレクトリは警告なしにスキップされます（警告なし）。

---

## マニフェストの形式（実装ベース）

ケーパビリティ型はこのマニフェスト形式を定義します。

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

検出時の動作は意図的に緩やかです。

- JSON のパース成功が必須です。
- JSON の構文を超えたフィールドの型や内容に対する実行時スキーマ検証は行いません。
- パースされたオブジェクトはケーパビリティアイテムの `manifest` として保存されます。

### 名前の正規化

`Extension.name` は以下のように設定されます。

1. `manifest.name` が `null`/`undefined` でない場合はその値を使用
2. それ以外の場合は拡張ディレクトリ名を使用

ここでは文字列型の強制は適用されません。

---

## ケーパビリティアイテムへのマテリアライズ

有効にパースされたマニフェストは 1 つの `Extension` ケーパビリティアイテムを生成します。

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // ケーパビリティレジストリによって付与
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

注意事項:

- `_source.path` は `createSourceMeta()` によって絶対パスに正規化されます。
- `extensions` に対するレジストリレベルのケーパビリティ検証では、`name` と `path` の存在のみを確認します。
- マニフェストの内部要素（`mcpServers`、`tools`、`context`）は検出時には検証されません。

---

## エラー処理と警告のセマンティクス

### 警告が発出される場合

- マニフェストファイルに無効な JSON が含まれる場合:
  - 警告フォーマット: `Invalid JSON in <manifestPath>`

### 警告が発出されない場合（サイレントスキップ）

- `extensions` ディレクトリが存在しない
- 子ディレクトリに `gemini-extension.json` がない
- マニフェストファイルが読み取り不能
- マニフェストの JSON が構文的には有効だが意味的に不完全または不規則

つまり、部分的な有効性は受け入れられ、JSON の構文エラーのみが警告を発出します。

---

## 他のソースとの優先順位と重複排除

`extensions` ケーパビリティはケーパビリティレジストリによってプロバイダー横断で集約されます。

このケーパビリティの現在のプロバイダー:

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）優先度 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）優先度 `60`

重複排除キーは `ext.name`（`extensionCapability.key = ext => ext.name`）です。

### クロスプロバイダーの優先順位

重複する拡張名については、優先度の高いプロバイダーが勝ちます。

- `native` と `gemini` の両方が拡張名 `foo` を出力する場合、native のアイテムが保持されます。
- 優先度の低い重複は `_shadowed = true` の状態で `result.all` にのみ保持されます。

### プロバイダー内の順序の影響

重複排除は「最初に見つかったものが優先」であるため、プロバイダーローカルのアイテム順序が重要です。

- Gemini ローダーは **ユーザーを先**に、次に**プロジェクト**を追加します。
- そのため、`~/.gemini/extensions` と `<cwd>/.gemini/extensions` の間で名前が重複する場合、ユーザーのエントリが保持され、プロジェクトのエントリがシャドウされます。

対照的に、native プロバイダーは `getConfigDirs()` において異なる順序（`project` を先に、次に `user`）でコンフィグディレクトリを構築するため、native プロバイダー内でのシャドウイングの方向は逆になります。

---

## ユーザーとプロジェクトの動作まとめ

Gemini マニフェスト固有の動作として:

- ユーザーおよびプロジェクトの両ルートがロードのたびにスキャンされます。
- プロジェクトルートは `<cwd>/.gemini/extensions` に固定されます（祖先ディレクトリへのウォークなし）。
- Gemini ソース内での名前の重複はユーザー優先で解決されます。
- 優先度の高いプロバイダー（特に native）との名前の重複は優先度によって失われます。

---

## 境界: 検出メタデータとランタイム拡張ロード

`gemini-extension.json` の検出は現在、ケーパビリティメタデータ（`Extension` アイテム）にフィードされます。実行可能な TS/JS 拡張モジュールを直接ロードするものでは**ありません**。

ランタイムモジュールロード（`discoverAndLoadExtensions()` / `loadExtensions()`）は `extension-modules` と明示的なパスを使用し、現在は自動検出されたモジュールをプロバイダー `native` のみにフィルタリングしています。

実際的な意味合い:

- Gemini マニフェスト拡張はケーパビリティレコードとして検出可能です。
- それ自体では、拡張ローダーパイプラインによってランタイム拡張モジュールとして実行されることはありません。

この境界は現在の実装において意図的なものであり、マニフェスト検出と実行可能モジュールのロードが乖離する可能性がある理由を説明しています。
