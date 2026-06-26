---
title: ネイティブバインディングコントラクト（TypeScript側）
description: N-API経由でRustネイティブ関数を呼び出すためのTypeScript側バインディングコントラクト。
sidebar:
  order: 2
  label: バインディングコントラクト
i18n:
  sourceHash: 36dc5fed1f0a
  translator: machine
---

# ネイティブバインディングコントラクト（TypeScript側）

このドキュメントでは、`@f5-sales-demo/pi-natives` の呼び出し元とロードされたN-APIアドオンの間に位置するTypeScript側のコントラクトを定義します。

以下の3つの要素に焦点を当てます：

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

`packages/natives/src/bindings.ts` はベースコントラクトを定義します：

- `NativeBindings`（ベースインターフェース、現在は `cancelWork(id: number): void` を含む）
- `Cancellable`（`timeoutMs?: number`、`signal?: AbortSignal`）
- `TsFunc<T>` N-APIスレッドセーフコールバックで使用されるコールバック形状

各モジュールは宣言マージによって独自のフィールドを追加します：

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

これにより、モノリシックな中央型ファイルを必要とせず、1つの集約されたバインディングインターフェースを維持できます。

## 宣言マージのライフサイクルと状態遷移

### 1) コンパイル時の型アセンブリ

- `bindings.ts` がベースとなる `NativeBindings` シンボルを提供します。
- すべての `src/<module>/types.ts` が `NativeBindings` を拡張します。
- `src/native.ts` がすべての `./<module>/types` ファイルを副作用のためにインポートし、`NativeBindings` が使用される場所でマージされたコントラクトがスコープ内に入るようにします。

状態遷移: **ベースコントラクト** → **マージ済みコントラクト**

### 2) ランタイムでのアドオンロードとバリデーションゲート

- `src/native.ts` が候補の `.node` バイナリをロードします。
- ロードされたオブジェクトは `NativeBindings` として扱われ、直ちに `validateNative(...)` に渡されます。
- `validateNative` は `typeof bindings[name] === "function"` により必要なエクスポートキーを検証します。

状態遷移: **信頼されていないアドオンオブジェクト** → **検証済みネイティブバインディングオブジェクト**（またはハードフェイラー）

### 3) ラッパー呼び出し

- `src/<module>/index.ts` のモジュールラッパーが `native.<export>` を呼び出します。
- ラッパーはデフォルト値とコールバック形状を適応させます（`(err, value)` をJS APIでの値のみのコールバックパターンに変換）。
- `src/index.ts` がモジュールラッパー/型をパブリックパッケージAPIとして再エクスポートします。

状態遷移: **検証済みの生バインディング** → **人間工学的なパブリックAPI**

## ラッパーの責務

ラッパーは意図的に薄く設計されており、ネイティブロジックを再実装しません。

主な責務：

- **引数の正規化/デフォルト設定**
  - `glob()` は `options.path` を絶対パスに解決し、`hidden`、`gitignore`、`recursive` のデフォルト値を設定します。
  - `hasMatch()` はネイティブ呼び出し前にデフォルトフラグ（`ignoreCase`、`multiline`）を設定します。
- **コールバックの適応**
  - `grep()`、`glob()`、`executeShell()` は `TsFunc<T>`（`error, value`）を成功した値のみを受け取るユーザーコールバックに変換します。
- **ネイティブ呼び出しに関する環境またはポリシーの振る舞い**
  - クリップボードラッパーはOSC52/Termux/ヘッドレス処理を追加し、コピーをベストエフォートとして扱います。
- **パブリック命名と再エクスポートの管理**
  - `searchContent()` はネイティブエクスポート `search` にマッピングされます。

## パブリックエクスポートサーフェスの構成

`packages/natives/src/index.ts` は正規のパブリックバレルファイルです。機能ドメインごとにエクスポートをグループ化しています：

- 検索/テキスト: `grep`、`glob`、`text`、`highlight`
- 実行/プロセス/ターミナル: `shell`、`pty`、`ps`、`keys`
- システム/メディア/変換: `image`、`html`、`clipboard`、`system-info`、`work`

メンテナールール: ラッパーが `src/index.ts` から再エクスポートされていない場合、それは意図されたパブリックパッケージサーフェスの一部ではありません。

## JS API ↔ ネイティブエクスポートマッピング（代表例）

Rust側はN-APIエクスポート名（通常は `#[napi]` のsnake_case → camelCase変換から、時折明示的なエイリアスを使用）を使用し、これらのバインディングキーと一致する必要があります。

| カテゴリ | パブリックJS API（ラッパー） | ネイティブバインディングキー | 戻り値の型 | 非同期？ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | はい |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | いいえ |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | いいえ |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | はい |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | はい |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | いいえ |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | はい |
| Shell | `Shell` | `Shell` | クラスコンストラクタ | N/A |
| PTY | `PtySession` | `PtySession` | クラスコンストラクタ | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | いいえ |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | いいえ |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | いいえ |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | いいえ |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | はい |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | いいえ |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | いいえ |
| Process | `killTree(pid, signal)` | `killTree` | `number` | いいえ |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | いいえ |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>`（ベストエフォートラッパー動作） | はい |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | はい |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | いいえ |

## 同期 vs 非同期のコントラクトの違い

コントラクトは同期と非同期のAPIを混在させています。ラッパーは1つのモデルを強制するのではなく、ネイティブの呼び出しスタイルを維持します：

- **Promiseベースの非同期エクスポート** — I/Oまたは長時間実行の処理向け（`grep`、`glob`、`htmlToMarkdown`、`executeShell`、クリップボード、画像操作）。
- **同期エクスポート** — 決定論的なインメモリ変換/パーサー向け（`search`、`hasMatch`、ハイライト、テキスト幅/スライス、キーパース、プロセスクエリ）。
- **コンストラクタエクスポート** — ステートフルなランタイムオブジェクト向け（`Shell`、`PtySession`、`PhotonImage`）。

メンテナーへの注意: 既存のエクスポートの同期↔非同期を変更することは、ラッパーと呼び出し元全体にわたる破壊的なAPIおよびコントラクトの変更となります。

## オブジェクトと列挙型の型付けパターン

### オブジェクトパターン（`#[napi(object)]` スタイルのJSオブジェクト）

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

呼び出し元は名前付きの列挙型メンバーを参照しますが、バインディング境界では数値が渡されます。

## 不一致の検出方法

不一致の検出は2つのレイヤーで行われます：

1. **コンパイル時のTypeScriptコントラクトチェック**
   - ラッパーはマージ済みの `NativeBindings` に対して `native.<name>` を呼び出します。
   - バインディングキーが欠落/名前変更されるとラッパーのTS型チェックが失敗します。

2. **`validateNative` によるランタイムバリデーション**
   - ロード後、`native.ts` が必要なエクスポートをチェックし、欠落があればスローします。
   - エラーメッセージには欠落しているキーとリビルド手順が含まれます。

これにより、ラッパー/型は存在するがロードされた `.node` にエクスポートがないという、よくある古いバイナリのドリフトを検出できます。

## 失敗時の振る舞いと注意事項

### ロード/バリデーション失敗（ハードフェイラー）

- アドオンのロード失敗またはサポートされていないプラットフォームの場合、`native.ts` のモジュール初期化時にスローされます。
- 必要なエクスポートの欠落は、ラッパーが使用可能になる前にスローされます。

効果: パッケージは最初の呼び出しまで失敗を遅延させるのではなく、即座に失敗します。

### ラッパーレベルの動作の違い

- 一部のラッパーは意図的に失敗を軽減します（`copyToClipboard` はベストエフォートであり、ネイティブの失敗を握りつぶします）。
- ストリーミングコールバックはコールバックのエラーペイロードを無視し、成功した値イベントのみを転送します。

### 型レベルの注意事項（ランタイムはTSより厳格）

- TSのオプショナルフィールドはセマンティックな妥当性を保証しません。ネイティブレイヤーは不正な値を拒否する可能性があります。
- `const enum` の型付けは、ランタイムで型付けされていない呼び出し元からの範囲外の数値を防止しません。
- `validateNative` は必要なエクスポートの存在/関数であることのみをチェックし、引数/戻り値の形状の深い互換性はチェックしません。
- `bindings.ts` はベースインターフェースに `cancelWork(id)` を含んでいますが、現在のランタイムバリデーションリストはそのキーを強制していません。

## バインディング変更時のメンテナーチェックリスト

エクスポートを追加/変更する際は、以下のすべてを更新してください：

1. `src/<module>/types.ts`（拡張 + コントラクト型）
2. `src/<module>/index.ts`（ラッパーの振る舞い）
3. `src/native.ts` のモジュール型のインポート（新規モジュールの場合）
4. `validateNative` の必要なエクスポートチェック
5. `src/index.ts` のパブリック再エクスポート

いずれかのステップをスキップすると、コンパイル時のドリフトまたはランタイムのロード時失敗が発生します。
