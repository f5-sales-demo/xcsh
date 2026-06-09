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

このドキュメントは、`@f5xc-salesdemos/pi-natives` の呼び出し元とロードされたN-APIアドオンの間に位置するTypeScript側のコントラクトを定義します。

以下の3つの要素に焦点を当てています：

1. コントラクトの形状（`NativeBindings` + モジュール拡張）、
2. ラッパーの動作（`src/<module>/index.ts`）、
3. 公開エクスポートサーフェス（`src/index.ts`）。

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

これにより、モノリシックな中央型ファイルなしに、1つの集約されたバインディングインターフェースが維持されます。

## 宣言マージのライフサイクルと状態遷移

### 1) コンパイル時の型アセンブリ

- `bindings.ts` が基本の `NativeBindings` シンボルを提供します。
- すべての `src/<module>/types.ts` が `NativeBindings` を拡張します。
- `src/native.ts` はすべての `./<module>/types` ファイルを副作用のためにインポートし、マージされたコントラクトが `NativeBindings` の使用箇所でスコープ内にあるようにします。

状態遷移: **基本コントラクト** → **マージ済みコントラクト**。

### 2) ランタイムのアドオンロードと検証ゲート

- `src/native.ts` が候補の `.node` バイナリをロードします。
- ロードされたオブジェクトは `NativeBindings` として扱われ、即座に `validateNative(...)` に渡されます。
- `validateNative` は `typeof bindings[name] === "function"` によって必要なエクスポートキーを検証します。

状態遷移: **未検証のアドオンオブジェクト** → **検証済みネイティブバインディングオブジェクト**（またはハードエラー）。

### 3) ラッパー呼び出し

- `src/<module>/index.ts` のモジュールラッパーが `native.<export>` を呼び出します。
- ラッパーはデフォルト値とコールバック形状を適応させます（`(err, value)` から JS API でのvalue-onlyコールバックパターンへ）。
- `src/index.ts` はモジュールラッパー/型をパッケージの公開APIとして再エクスポートします。

状態遷移: **検証済みの生バインディング** → **人間工学的な公開API**。

## ラッパーの責務

ラッパーは意図的に薄く設計されており、ネイティブロジックを再実装しません。

主な責務：

- **引数の正規化/デフォルト値設定**
  - `glob()` は `options.path` を絶対パスに解決し、`hidden`、`gitignore`、`recursive` のデフォルト値を設定します。
  - `hasMatch()` はネイティブ呼び出し前にデフォルトフラグ（`ignoreCase`、`multiline`）を埋めます。
- **コールバック適応**
  - `grep()`、`glob()`、`executeShell()` は `TsFunc<T>`（`error, value`）を、成功した値のみを受け取るユーザーコールバックに変換します。
- **ネイティブ呼び出し周辺の環境・ポリシー動作**
  - クリップボードラッパーはOSC52/Termux/ヘッドレス処理を追加し、コピーをベストエフォートとして扱います。
- **公開名の設定と再エクスポートのキュレーション**
  - `searchContent()` はネイティブエクスポート `search` にマッピングされます。

## 公開エクスポートサーフェスの構成

`packages/natives/src/index.ts` は正規の公開バレルです。エクスポートを機能ドメインごとにグループ化しています：

- 検索/テキスト: `grep`、`glob`、`text`、`highlight`
- 実行/プロセス/ターミナル: `shell`、`pty`、`ps`、`keys`
- システム/メディア/変換: `image`、`html`、`clipboard`、`system-info`、`work`

メンテナールール: ラッパーが `src/index.ts` から再エクスポートされていない場合、意図された公開パッケージサーフェスの一部ではありません。

## JS API ↔ ネイティブエクスポートマッピング（代表例）

Rust側はN-APIエクスポート名（通常は `#[napi]` のsnake_case → camelCase変換、時折明示的なエイリアスあり）を使用し、これらのバインディングキーと一致する必要があります。

| カテゴリ | 公開JS API（ラッパー） | ネイティブバインディングキー | 戻り値型 | 非同期？ |
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
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>`（ベストエフォートのラッパー動作） | はい |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | はい |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | いいえ |

## 同期と非同期のコントラクトの違い

コントラクトは同期と非同期のAPIを混在させており、ラッパーは1つのモデルを強制するのではなく、ネイティブの呼び出しスタイルを保持します：

- **Promiseベースの非同期エクスポート**: I/Oまたは長時間実行の処理用（`grep`、`glob`、`htmlToMarkdown`、`executeShell`、クリップボード、画像操作）。
- **同期エクスポート**: 決定論的なインメモリ変換/パーサー用（`search`、`hasMatch`、ハイライト、テキスト幅/スライス、キー解析、プロセスクエリ）。
- **コンストラクタエクスポート**: ステートフルなランタイムオブジェクト用（`Shell`、`PtySession`、`PhotonImage`）。

メンテナーへの意味: 既存のエクスポートの同期↔非同期の変更は、ラッパーと呼び出し元全体にわたる破壊的なAPIおよびコントラクトの変更です。

## オブジェクトと列挙型の型付けパターン

### オブジェクトパターン（`#[napi(object)]` スタイルのJSオブジェクト）

TSはオブジェクト形状のネイティブ値をインターフェースとしてモデル化します。例：

- `GrepResult`、`SearchResult`、`GlobResult`
- `SystemInfo`、`WorkProfile`
- `ClipboardImage`、`ParsedKittyResult`

これらはコンパイル時の構造的コントラクトであり、ランタイムの形状の正確性はネイティブ実装が所有します。

### 列挙型パターン

数値ネイティブ列挙型はTSでは `const enum` 値として表現されます：

- `FileType`（`1=file`、`2=dir`、`3=symlink`）
- `ImageFormat`（`0=PNG`、`1=JPEG`、`2=WEBP`、`3=GIF`）
- `SamplingFilter`、`Ellipsis`、`KeyEventType`

呼び出し元は名前付きenum メンバーを見ますが、バインディング境界では数値が渡されます。

## ミスマッチの検出方法

ミスマッチの検出は2つのレイヤーで行われます：

1. **コンパイル時のTypeScriptコントラクトチェック**
   - ラッパーはマージ済みの `NativeBindings` に対して `native.<name>` を呼び出します。
   - バインディングキーの欠落や名前変更は、ラッパー内のTS型チェックを破壊します。

2. **`validateNative` でのランタイム検証**
   - ロード後、`native.ts` が必要なエクスポートをチェックし、欠落している場合はスローします。
   - エラーメッセージには欠落しているキーとリビルド手順が含まれます。

これにより、一般的な古いバイナリのドリフトを検出します：ラッパー/型は存在するが、ロードされた `.node` にエクスポートがない場合です。

## 障害動作と注意点

### ロード/検証の失敗（ハード障害）

- アドオンのロード失敗またはサポートされていないプラットフォームは、`native.ts` のモジュール初期化中にスローします。
- 必要なエクスポートの欠落は、ラッパーが使用可能になる前にスローします。

効果: パッケージは最初の呼び出しまで障害を遅延させるのではなく、早期に失敗します。

### ラッパーレベルの動作の違い

- 一部のラッパーは意図的に障害を緩和します（`copyToClipboard` はベストエフォートであり、ネイティブの障害を抑制します）。
- ストリーミングコールバックはコールバックのエラーペイロードを無視し、成功した値イベントのみを転送します。

### 型レベルの注意点（ランタイムはTSより厳密）

- TSのオプショナルフィールドは意味的な妥当性を保証しません。ネイティブレイヤーは不正な値を拒否する可能性があります。
- `const enum` の型付けは、ランタイムで型なしの呼び出し元からの範囲外の数値を防止しません。
- `validateNative` は必要なエクスポートの存在/関数であることのみをチェックし、深い引数/戻り値の形状の互換性はチェックしません。
- `bindings.ts` は基本インターフェースに `cancelWork(id)` を含んでいますが、現在のランタイム検証リストはそのキーを強制していません。

## バインディング変更時のメンテナーチェックリスト

エクスポートを追加/変更する際は、以下のすべてを更新してください：

1. `src/<module>/types.ts`（拡張 + コントラクト型）
2. `src/<module>/index.ts`（ラッパーの動作）
3. `src/native.ts` のモジュール型インポート（新しいモジュールの場合）
4. `validateNative` の必須エクスポートチェック
5. `src/index.ts` の公開再エクスポート

いずれかのステップをスキップすると、コンパイル時のドリフトまたはランタイムのロード時障害が発生します。
