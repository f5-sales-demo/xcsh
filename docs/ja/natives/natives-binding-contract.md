---
title: ネイティブバインディングコントラクト（TypeScript側）
description: N-APIを介してRustネイティブ関数を呼び出すためのTypeScript側バインディングコントラクト。
sidebar:
  order: 2
  label: バインディングコントラクト
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# ネイティブバインディングコントラクト（TypeScript側）

このドキュメントでは、`@f5xc-salesdemos/pi-natives` の呼び出し元とロードされたN-APIアドオンの間に位置するTypeScript側のコントラクトを定義します。

以下の3つの要素に焦点を当てています：

1. コントラクトの形状（`NativeBindings` + モジュール拡張）
2. ラッパーの振る舞い（`src/<module>/index.ts`）
3. パブリックエクスポートサーフェス（`src/index.ts`）

## 実装ファイル

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## コントラクトモデル

`packages/natives/src/bindings.ts` は基本コントラクトを定義します：

- `NativeBindings`（基本インターフェース、現在は `cancelWork(id: number): void` を含む）
- `Cancellable`（`timeoutMs?: number`, `signal?: AbortSignal`）
- `TsFunc<T>` N-APIスレッドセーフコールバックで使用されるコールバックの形状

各モジュールは宣言マージにより独自のフィールドを追加します：

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

これにより、モノリシックな中央型ファイルなしに、1つの集約されたバインディングインターフェースが維持されます。

## 宣言マージのライフサイクルと状態遷移

### 1) コンパイル時の型組み立て

- `bindings.ts` が基本の `NativeBindings` シンボルを提供します。
- すべての `src/<module>/types.ts` が `NativeBindings` を拡張します。
- `src/native.ts` はすべての `./<module>/types` ファイルを副作用のためにインポートし、`NativeBindings` が使用される箇所でマージされたコントラクトがスコープ内に含まれるようにします。

状態遷移：**基本コントラクト** → **マージされたコントラクト**

### 2) ランタイムアドオンのロードとバリデーションゲート

- `src/native.ts` が候補となる `.node` バイナリをロードします。
- ロードされたオブジェクトは `NativeBindings` として扱われ、即座に `validateNative(...)` を通じて検証されます。
- `validateNative` は `typeof bindings[name] === "function"` により必要なエクスポートキーを検証します。

状態遷移：**信頼されていないアドオンオブジェクト** → **検証済みネイティブバインディングオブジェクト**（またはハードフェイル）

### 3) ラッパーの呼び出し

- `src/<module>/index.ts` のモジュールラッパーが `native.<export>` を呼び出します。
- ラッパーはデフォルト値やコールバックの形状を適応させます（`(err, value)` から JS API における値のみのコールバックパターンへ）。
- `src/index.ts` がモジュールラッパー/型をパブリックパッケージAPIとして再エクスポートします。

状態遷移：**検証済み生バインディング** → **使いやすいパブリックAPI**

## ラッパーの責務

ラッパーは意図的に薄く設計されており、ネイティブロジックを再実装しません。

主な責務：

- **引数の正規化/デフォルト設定**
  - `glob()` は `options.path` を絶対パスに解決し、`hidden`、`gitignore`、`recursive` のデフォルト値を設定します。
  - `hasMatch()` はネイティブ呼び出しの前にデフォルトフラグ（`ignoreCase`、`multiline`）を設定します。
- **コールバックの適応**
  - `grep()`、`glob()`、`executeShell()` は `TsFunc<T>`（`error, value`）を成功値のみを受け取るユーザーコールバックに変換します。
- **ネイティブ呼び出しに関する環境またはポリシーの振る舞い**
  - クリップボードラッパーはOSC52/Termux/ヘッドレスの処理を追加し、コピーをベストエフォートとして扱います。
- **パブリック命名と再エクスポートのキュレーション**
  - `searchContent()` はネイティブエクスポート `search` にマッピングされます。

## パブリックエクスポートサーフェスの構成

`packages/natives/src/index.ts` が正規のパブリックバレルです。機能ドメインごとにエクスポートをグループ化しています：

- 検索/テキスト：`grep`、`glob`、`text`、`highlight`
- 実行/プロセス/ターミナル：`shell`、`pty`、`ps`、`keys`
- システム/メディア/変換：`image`、`html`、`clipboard`、`system-info`、`work`

メンテナールール：ラッパーが `src/index.ts` から再エクスポートされていない場合、それは意図されたパブリックパッケージサーフェスの一部ではありません。

## JS API ↔ ネイティブエクスポートのマッピング（代表例）

Rust側は N-API エクスポート名（通常は `#[napi]` による snake_case → camelCase 変換、場合によっては明示的なエイリアス付き）を使用し、これらのバインディングキーと一致する必要があります。

| カテゴリ | パブリック JS API（ラッパー） | ネイティブバインディングキー | 戻り値の型 | 非同期？ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | Yes |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | No |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | No |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | Yes |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | Yes |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | No |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | Yes |
| Shell | `Shell` | `Shell` | class constructor | N/A |
| PTY | `PtySession` | `PtySession` | class constructor | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | No |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | No |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | No |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | No |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | Yes |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | No |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | No |
| Process | `killTree(pid, signal)` | `killTree` | `number` | No |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | No |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>`（ベストエフォートのラッパー動作） | Yes |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | Yes |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | No |

## 同期 vs 非同期のコントラクトの違い

コントラクトは同期APIと非同期APIが混在しています。ラッパーは1つのモデルを強制するのではなく、ネイティブの呼び出しスタイルを保持します：

- **Promiseベースの非同期エクスポート**：I/Oまたは長時間実行される処理向け（`grep`、`glob`、`htmlToMarkdown`、`executeShell`、クリップボード、画像操作）。
- **同期エクスポート**：決定論的なインメモリ変換/パーサー向け（`search`、`hasMatch`、ハイライト、テキスト幅/スライス、キー解析、プロセスクエリ）。
- **コンストラクタエクスポート**：ステートフルなランタイムオブジェクト向け（`Shell`、`PtySession`、`PhotonImage`）。

メンテナーへの影響：既存エクスポートの同期 ↔ 非同期の変更は、ラッパーと呼び出し元全体にわたる破壊的なAPIおよびコントラクトの変更となります。

## オブジェクトと列挙型の型付けパターン

### オブジェクトパターン（`#[napi(object)]` スタイルの JS オブジェクト）

TSはオブジェクト形状のネイティブ値をインターフェースとしてモデル化します。例：

- `GrepResult`、`SearchResult`、`GlobResult`
- `SystemInfo`、`WorkProfile`
- `ClipboardImage`、`ParsedKittyResult`

これらはコンパイル時の構造的コントラクトであり、ランタイムの形状の正しさはネイティブ実装が担保します。

### 列挙型パターン

数値のネイティブ列挙型はTSでは `const enum` 値として表現されます：

- `FileType`（`1=file`、`2=dir`、`3=symlink`）
- `ImageFormat`（`0=PNG`、`1=JPEG`、`2=WEBP`、`3=GIF`）
- `SamplingFilter`、`Ellipsis`、`KeyEventType`

呼び出し元は名前付き列挙型メンバーを参照しますが、バインディング境界では数値が渡されます。

## 不一致の検出方法

不一致の検出は2つのレイヤーで行われます：

1. **コンパイル時のTypeScriptコントラクトチェック**
   - ラッパーはマージされた `NativeBindings` に対して `native.<name>` を呼び出します。
   - 欠落/リネームされたバインディングキーはラッパーのTS型チェックで失敗します。

2. **`validateNative` でのランタイムバリデーション**
   - ロード後、`native.ts` が必要なエクスポートをチェックし、欠落している場合はスローします。
   - エラーメッセージには欠落しているキーとリビルド手順が含まれます。

これにより、一般的な古いバイナリのドリフトを検出できます：ラッパー/型は存在するが、ロードされた `.node` にエクスポートが欠落している場合です。

## 障害時の振る舞いと注意事項

### ロード/バリデーションの失敗（ハードフェイル）

- アドオンのロード失敗またはサポートされていないプラットフォームの場合、`native.ts` のモジュール初期化時にスローされます。
- 必要なエクスポートが欠落している場合、ラッパーが使用可能になる前にスローされます。

効果：パッケージは最初の呼び出しまで障害を遅延させるのではなく、即座に失敗します。

### ラッパーレベルの振る舞いの違い

- 一部のラッパーは意図的に障害を緩和します（`copyToClipboard` はベストエフォートであり、ネイティブの障害を無視します）。
- ストリーミングコールバックはコールバックのエラーペイロードを無視し、成功した値イベントのみを転送します。

### 型レベルの注意事項（ランタイムはTSより厳格）

- TSのオプショナルフィールドは意味的な妥当性を保証しません。ネイティブレイヤーは不正な値を拒否する可能性があります。
- `const enum` の型付けは、ランタイムで型付けされていない呼び出し元からの範囲外の数値を防止しません。
- `validateNative` は必要なエクスポートの存在と関数であることのみをチェックし、深い引数/戻り値の形状の互換性はチェックしません。
- `bindings.ts` は基本インターフェースに `cancelWork(id)` を含みますが、現在のランタイムバリデーションリストはそのキーを強制していません。

## バインディング変更時のメンテナーチェックリスト

エクスポートを追加/変更する場合、以下のすべてを更新してください：

1. `src/<module>/types.ts`（拡張 + コントラクト型）
2. `src/<module>/index.ts`（ラッパーの振る舞い）
3. `src/native.ts` のモジュール型インポート（新規モジュールの場合）
4. `validateNative` の必須エクスポートチェック
5. `src/index.ts` のパブリック再エクスポート

いずれかのステップを省略すると、コンパイル時のドリフトまたはランタイムのロード時障害が発生します。
