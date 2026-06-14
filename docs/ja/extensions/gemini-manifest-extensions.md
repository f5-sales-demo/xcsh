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

このドキュメントでは、コーディングエージェントが Gemini スタイルのマニフェスト拡張 (`gemini-extension.json`) を検出し、`extensions` ケイパビリティとして解析する方法について説明します。

TypeScript/JavaScript 拡張モジュールのロード (`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`) については、本ドキュメントの対象外です。これらは `extension-loading.md` に記載されています。

## 実装ファイル

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 検出対象

Gemini プロバイダー (`id: gemini`、優先度 `60`) は `extensions` ローダーを登録し、以下の 2 つの固定ルートをスキャンします。

- ユーザー: `~/.gemini/extensions`
- プロジェクト: `<cwd>/.gemini/extensions`

パスの解決は、`getUserPath()` / `getProjectPath()` を通じて `ctx.home` および `ctx.cwd` から直接行われます。

スコープに関する重要なルール: プロジェクトのルックアップは **cwd のみ** です。親ディレクトリを遡ることはありません。

---

## ディレクトリスキャンのルール

各ルート (`~/.gemini/extensions` および `<cwd>/.gemini/extensions`) に対して、検出処理は以下を行います。

1. `readDirEntries(root)`
2. 直下の子ディレクトリのみを保持 (`entry.isDirectory()`)
3. 各子 `<name>` に対して、以下のファイルのみを読み取ろうとする:
   - `<root>/<name>/gemini-extension.json`

ディレクトリ 1 階層を超えた再帰的スキャンは行いません。

### 隠しディレクトリ

Gemini マニフェストの検出では、ドット始まりのディレクトリ名をフィルタリング **しません**。隠し子ディレクトリが存在し、`gemini-extension.json` を含む場合、対象として扱われます。

### ファイルが存在しない/読み取れない場合

`gemini-extension.json` が存在しないか読み取れない場合、そのディレクトリは警告なしにスキップされます。

---

## マニフェストの形式（実装に基づく）

ケイパビリティ型は以下のマニフェスト形式を定義しています。

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

- JSON の解析成功が必要です。
- JSON 構文以外のフィールドの型や内容に対する実行時スキーマ検証は行いません。
- 解析されたオブジェクトは、ケイパビリティアイテムの `manifest` として格納されます。

### 名前の正規化

`Extension.name` は以下のように設定されます。

1. `manifest.name` が `null`/`undefined` でない場合はその値
2. それ以外の場合は拡張ディレクトリ名

ここでは文字列型の強制適用は行いません。

---

## ケイパビリティアイテムへのマテリアライズ

有効な解析済みマニフェストにより、1 つの `Extension` ケイパビリティアイテムが作成されます。

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

備考:

- `_source.path` は `createSourceMeta()` によって絶対パスに正規化されます。
- `extensions` に対するレジストリレベルのケイパビリティ検証では、`name` と `path` の存在のみを確認します。
- マニフェストの内部 (`mcpServers`、`tools`、`context`) は検出時に検証されません。

---

## エラー処理と警告のセマンティクス

### 警告あり

- マニフェストファイルの JSON が無効な場合:
  - 警告フォーマット: `Invalid JSON in <manifestPath>`

### 警告なし（サイレントスキップ）

- `extensions` ディレクトリが存在しない
- 子ディレクトリに `gemini-extension.json` がない
- マニフェストファイルが読み取れない
- マニフェストの JSON が構文的には有効だが意味的に不完全または異常

これは部分的な有効性が受け入れられることを意味します。JSON の構文エラーのみが警告を発します。

---

## 他のソースとの優先度と重複排除

`extensions` ケイパビリティはケイパビリティレジストリによってプロバイダー間で集約されます。

このケイパビリティの現在のプロバイダー:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) 優先度 `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) 優先度 `60`

重複排除キーは `ext.name` (`extensionCapability.key = ext => ext.name`) です。

### プロバイダー間の優先度

優先度が高いプロバイダーが、拡張名の重複時に優先されます。

- `native` と `gemini` の両方が拡張名 `foo` を発行した場合、ネイティブのアイテムが保持されます。
- 優先度が低い重複アイテムは `result.all` にのみ保持され、`_shadowed = true` が付与されます。

### プロバイダー内の順序による影響

重複排除は「最初に見つかったものが優先」であるため、プロバイダー内のアイテム順序が重要です。

- Gemini ローダーは **ユーザーを先に**、次に **プロジェクト** を追加します。
- したがって、`~/.gemini/extensions` と `<cwd>/.gemini/extensions` の間で名前が重複した場合、ユーザーエントリが保持され、プロジェクトエントリはシャドウされます。

対照的に、ネイティブプロバイダーは `getConfigDirs()` で異なる設定ディレクトリの順序 (`project` の後に `user`) でビルドするため、ネイティブプロバイダー内のシャドウ方向は逆になります。

---

## ユーザーとプロジェクトの動作まとめ

Gemini マニフェストに固有の動作として:

- ユーザーとプロジェクトの両方のルートが毎回のロード時にスキャンされます。
- プロジェクトルートは `<cwd>/.gemini/extensions` に固定されます（祖先ディレクトリの探索なし）。
- Gemini ソース内での名前の重複はユーザー優先で解決されます。
- 優先度の高いプロバイダー（特にネイティブ）との名前の重複は、優先度により負けます。

---

## 境界: 検出メタデータとランタイム拡張ロード

`gemini-extension.json` の検出は現在、ケイパビリティメタデータ (`Extension` アイテム) を提供します。実行可能な TS/JS 拡張モジュールを直接ロードするわけでは **ありません**。

ランタイムモジュールのロード (`discoverAndLoadExtensions()` / `loadExtensions()`) は `extension-modules` と明示的なパスを使用し、現在は自動検出されたモジュールをプロバイダー `native` のみにフィルタリングします。

実際的な意味合い:

- Gemini マニフェスト拡張はケイパビリティレコードとして検出可能です。
- それ自体は、拡張ローダーパイプラインによってランタイム拡張モジュールとして実行されません。

この境界は現在の実装において意図的なものであり、マニフェスト検出と実行可能モジュールのロードが乖離しうる理由を説明しています。
