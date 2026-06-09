---
title: 拡張機能の読み込み（TypeScript/JavaScript モジュール）
description: 解決、検証、キャッシュを備えた拡張機能向けの TypeScript および JavaScript モジュール読み込みパイプライン。
sidebar:
  order: 2
  label: 拡張機能の読み込み
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# 拡張機能の読み込み（TypeScript/JavaScript モジュール）

このドキュメントでは、コーディングエージェントが起動時に**拡張モジュール**（`.ts`/`.js`）を検出し読み込む方法について説明します。

`gemini-extension.json` マニフェスト拡張機能については扱い**ません**（別途ドキュメント化されています）。

## このサブシステムの役割

拡張機能の読み込みは、モジュールエントリファイルのリストを構築し、各モジュールを Bun でインポートし、そのファクトリを実行して、以下を返します：

- 読み込まれた拡張機能の定義
- パスごとの読み込みエラー（全体の読み込みを中断しない）
- 後に `ExtensionRunner` で使用される共有拡張機能ランタイムオブジェクト

## 主要な実装ファイル

- `src/extensibility/extensions/loader.ts` — パス検出 + インポート/実行
- `src/extensibility/extensions/index.ts` — パブリックエクスポート
- `src/extensibility/extensions/runner.ts` — 読み込み後のランタイム/イベント実行
- `src/discovery/builtin.ts` — 拡張モジュール用のネイティブ自動検出プロバイダー
- `src/config/settings.ts` — マージされた `extensions` / `disabledExtensions` 設定の読み込み

---

## 拡張機能読み込みへの入力

### 1) 自動検出されたネイティブ拡張モジュール

`discoverAndLoadExtensions()` は、まず検出プロバイダーに `extension-module` ケイパビリティ項目を問い合わせ、その後プロバイダー `native` の項目のみを保持します。

有効なネイティブロケーション：

- プロジェクト: `<cwd>/.xcsh/extensions`
- ユーザー: `~/.xcsh/agent/extensions`

パスルートはネイティブプロバイダー（`SOURCE_PATHS.native`）から取得されます。

注意点：

- ネイティブ自動検出は現在 `.xcsh` ベースです。
- レガシーの `.pi` は `package.json` マニフェストキー（`pi.extensions`）では引き続き受け入れられますが、ここではネイティブルートとしては使用されません。

### 2) 明示的に設定されたパス

自動検出の後、設定されたパスが追加・解決されます。

メインセッション起動パス（`sdk.ts`）における設定パスのソース：

1. CLI で指定されたパス（`--extension/-e`、および `--hook` も拡張パスとして扱われます）
2. 設定の `extensions` 配列（グローバル + プロジェクト設定のマージ）

グローバル設定ファイル：

- `~/.xcsh/agent/config.yml`（または `PI_CODING_AGENT_DIR` によるカスタムエージェントディレクトリ）

プロジェクト設定ファイル：

- `<cwd>/.xcsh/settings.json`

例：

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## 有効化/無効化の制御

### 検出の無効化

- CLI: `--no-extensions`
- SDK オプション: `disableExtensionDiscovery`

動作の違い：

- SDK: `disableExtensionDiscovery=true` の場合でも、`loadExtensions()` 経由で `additionalExtensionPaths` は読み込まれます。
- CLI パス構築（`main.ts`）では、`--no-extensions` が設定されると CLI 拡張パスがクリアされるため、明示的な `-e/--hook` はそのモードでは転送されません。

### 特定の拡張モジュールの無効化

`disabledExtensions` 設定は拡張機能 ID 形式でフィルタリングします：

- `extension-module:<derivedName>`

`derivedName` はエントリパスに基づきます（`getExtensionNameFromPath`）。例：

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

例：

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## パスとエントリの解決

### パスの正規化

設定されたパスに対して：

1. Unicode スペースの正規化
2. `~` の展開
3. 相対パスの場合、現在の `cwd` に対して解決

### 設定パスがファイルの場合

モジュールエントリ候補として直接使用されます。

### 設定パスがディレクトリの場合

解決順序：

1. そのディレクトリ内の `package.json` に `xcsh.extensions`（またはレガシーの `pi.extensions`）がある場合 -> 宣言されたエントリを使用
2. `index.ts`
3. `index.js`
4. それ以外の場合、1 階層分の拡張エントリをスキャン：
   - 直接の `*.ts` / `*.js`
   - サブディレクトリの `index.ts` / `index.js`
   - サブディレクトリの `package.json` に `xcsh.extensions` / `pi.extensions`

ルールと制約：

- 1 つのサブディレクトリレベルを超える再帰的な検出は行われない
- 宣言された `extensions` マニフェストエントリは、そのパッケージディレクトリを基準に解決される
- 宣言されたエントリは、ファイルが存在し/アクセスが許可されている場合のみ含まれる
- `*/index.{ts,js}` ペアでは、TypeScript が JavaScript より優先される
- シンボリックリンクは有効なファイル/ディレクトリとして扱われる

### ソースによって無視動作が異なる

- ネイティブ自動検出（検出ヘルパーの `discoverExtensionModulePaths`）は、`gitignore: true` および `hidden: false` でネイティブ glob を使用します。
- `loader.ts` における明示的に設定されたディレクトリスキャンは `readdir` ルールを使用し、gitignore フィルタリングは**適用しません**。

---

## 読み込み順序と優先度

`discoverAndLoadExtensions()` は 1 つの順序付きリストを構築し、その後 `loadExtensions()` を呼び出します。

順序：

1. ネイティブ自動検出されたモジュール
2. 明示的に設定されたパス（指定された順序で）

`sdk.ts` では、設定順序は以下のとおりです：

1. CLI 追加パス
2. 設定の `extensions`

重複排除：

- 絶対パスベース
- 最初に見つかったパスが優先
- 後の重複は無視される

含意：同じモジュールパスが自動検出と明示的設定の両方にある場合、最初の位置（自動検出段階）で 1 回だけ読み込まれます。

---

## モジュールのインポートとファクトリ契約

各候補パスは動的インポートで読み込まれます：

- `await import(resolvedPath)`
- ファクトリは `module.default ?? module`
- ファクトリは関数（`ExtensionFactory`）でなければならない

エクスポートが関数でない場合、そのパスは構造化エラーで失敗し、読み込みは続行されます。

---

## 失敗処理と分離

### 読み込み中

拡張パスごとに、失敗は `{ path, error }` としてキャプチャされ、他のパスの読み込みを停止しません。

一般的なケース：

- インポート失敗 / ファイルが見つからない
- 無効なファクトリエクスポート（非関数）
- ファクトリ実行中にスローされた例外

### ランタイム分離モデル

- 拡張機能は**サンドボックス化されていません**（同一プロセス/ランタイム）。
- 1 つの `EventBus` と 1 つの `ExtensionRuntime` インスタンスを共有します。
- 読み込み中、ランタイムアクションメソッドは意図的に `ExtensionRuntimeNotInitializedError` をスローします。アクションの配線は後に `ExtensionRunner.initialize()` で行われます。

### 読み込み後

`ExtensionRunner` を通じてイベントが実行される際、ハンドラの例外はキャッチされ、ランナーループをクラッシュさせる代わりに拡張エラーとして発行されます。

---

## 最小限のユーザー/プロジェクトレイアウト例

### ユーザーレベル

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### プロジェクトレベル

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`：

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

レガシーマニフェストキーも引き続き受け入れられます：

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
