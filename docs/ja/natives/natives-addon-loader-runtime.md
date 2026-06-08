---
title: ネイティブアドオンローダーランタイム
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: アドオンローダー
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# ネイティブアドオンローダーランタイム

このドキュメントでは、`@f5xc-salesdemos/pi-natives` のアドオン読み込み/検証レイヤーについて詳しく解説します。`native.ts` がどの `.node` ファイルを読み込むかをどのように決定するか、埋め込みペイロードの展開がいつ実行されるか、起動時の失敗がどのように報告されるかを説明します。

## 実装ファイル

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## スコープと責務

ローダー/ランタイムの責務は意図的に狭く限定されています：

- プラットフォーム/CPU に対応したアドオンファイル名およびディレクトリの候補リストを構築する。
- オプションで、埋め込みアドオンをバージョン管理されたユーザーごとのキャッシュディレクトリに展開する。
- 候補を決定論的な順序で試行する。
- バインディングを公開する前に、`validateNative` を使用して古いアドオンや互換性のないアドオンを拒否する。

ここではスコープ外：モジュール固有の grep/テキスト/ハイライト動作。

## ランタイム入力と導出された状態

モジュール初期化時（`export const native = loadNative();`）に、`native.ts` は静的なコンテキストを計算します：

- **プラットフォームタグ**: ``${process.platform}-${process.arch}``（例: `darwin-arm64`）。
- **パッケージバージョン**: `packages/natives/package.json` の `version` フィールドから取得。
- **コアディレクトリ**:
  - `nativeDir`: パッケージローカルの `packages/natives/native`。
  - `execDir`: `process.execPath` を含むディレクトリ。
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`。
  - `userDataDir` フォールバック:
    - Windows: `%LOCALAPPDATA%/xcsh`（または `%USERPROFILE%/AppData/Local/xcsh`）。
    - Windows 以外: `~/.local/bin`。
- **コンパイル済みバイナリモード**（`isCompiledBinary`）: 以下のいずれかが true の場合：
  - `PI_COMPILED` 環境変数が設定されている、または
  - `import.meta.url` に Bun 埋め込みマーカー（`$bunfs`、`~BUN`、`%7EBUN`）が含まれている。
- **バリアントオーバーライド**: `PI_NATIVE_VARIANT`（`modern`/`baseline` のみ。無効な値は無視される）。
- **選択されたバリアント**: 明示的なオーバーライドがある場合はそれを使用し、そうでなければ x64 でのランタイム AVX2 検出（AVX2 がある場合は `modern`、なければ `baseline`）。

## プラットフォームサポートとタグの解決

`SUPPORTED_PLATFORMS` は以下に固定されています：

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

動作の詳細：

- サポートされていないプラットフォームは事前に拒否されません。
- ローダーはまず計算されたすべての候補を試行します。
- 何も読み込めない場合、サポートされているタグのリストを含む明示的な未サポートプラットフォームエラーをスローします。

これにより、惜しいケースに対して有用な診断情報が保持されつつ、真にサポートされていないターゲットに対してはハードに失敗します。

## バリアント選択（`modern` / `baseline` / デフォルト）

### x64 の動作

1. `PI_NATIVE_VARIANT` が `modern` または `baseline` の場合、その値が優先されます。
2. それ以外の場合、AVX2 サポートを検出します：
   - Linux: `/proc/cpuinfo` で `avx2` をスキャン。
   - macOS: `sysctl` をクエリ（`machdep.cpu.leaf7_features`、フォールバック `machdep.cpu.features`）。
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` を実行。
3. 結果：
   - AVX2 利用可能 -> `modern`
   - AVX2 利用不可/検出不能 -> `baseline`

### x64 以外の動作

- バリアントは使用されません。ローダーはデフォルトのファイル名（`pi_natives.<platform>-<arch>.node`）のまま動作します。

### ファイル名の構築

`tag = <platform>-<arch>` とすると：

- x64 以外またはバリアントなし: `pi_natives.<tag>.node`
- x64 + `modern`: 以下の順序で試行
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node`（意図的なフォールバック）
- x64 + `baseline`: `pi_natives.<tag>-baseline.node` のみ

最終的なエラーメッセージで使用される `addonLabel` は `<tag>` または `<tag> (<variant>)` です。

## 候補パスの構築とフォールバック順序

`native.ts` は `require(...)` 呼び出しの前に候補プールを構築します。

### リリース候補

バリアント解決されたファイル名リストから構築され、以下の順序で検索されます：

- **非コンパイルランタイム**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **コンパイルランタイム**（`PI_COMPILED` または Bun 埋め込みマーカー）:
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` は最初の出現順序を保持しながら重複を除去します。

### 最終的なランタイムシーケンス

読み込み時：

1. オプションの埋め込み展開候補（生成された場合）が先頭に挿入されます。
2. 残りの重複排除された候補が順番に試行されます。
3. `require(...)` と `validateNative(...)` の両方をパスした最初の候補が採用されます。

## 埋め込みアドオン展開のライフサイクル

`embedded-addon.ts` は以下の生成マニフェスト形式を定義します：

- `platformTag`
- `version`
- `files[]`（各エントリは `variant`、`filename`、`filePath` を持つ）

現在チェックインされているデフォルトは `embeddedAddon: null` です。コンパイル済みアーティファクトはこれを実際のメタデータに置き換えることがあります。

### 展開ステートマシン

展開（`maybeExtractEmbeddedAddon`）は、すべてのゲートをパスした場合にのみ実行されます：

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. バリアントに適した埋め込みファイルが見つかる

バリアントファイルの選択はランタイムバリアントの意図を反映します：

- x64 以外: `default` を優先し、次に最初に利用可能なファイル。
- x64 + `modern`: `modern` を優先し、`baseline` にフォールバック。
- x64 + `baseline`: `baseline` を必須とする。

展開の動作：

1. `<versionedDir>` が存在することを確認（`mkdirSync(..., { recursive: true })`）。
2. `<versionedDir>/<選択されたファイル名>` が既に存在する場合、それを再利用（再書き込みなし）。
3. そうでなければ、埋め込みソース `filePath` を読み取り、ターゲットファイルに書き込む。
4. 最高優先度の読み込み試行用にターゲットパスを返す。

失敗時、展開は即座にクラッシュしません。エラーエントリ（ディレクトリ作成または書き込みの失敗）を追加し、ローダーは通常の候補探索に進みます。

## ライフサイクルと状態遷移

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## `validateNative` の契約チェック

`validateNative(bindings, source)` は起動時に `NativeBindings` に対して関数のみの契約を強制します。

メカニズム：

- 各必須エクスポート名について、`typeof bindings[name] === "function"` をチェックします。
- 欠落した名前は集約されます。
- いずれかが欠落している場合、ローダーは以下をスローします：
  - ソースアドオンパス、
  - 欠落エクスポートリスト、
  - リビルドコマンドのヒント。

これは古いバイナリ、部分的なビルド、シンボル/名前の不整合に対するハードな互換性ゲートです。

### JS API ↔ ネイティブエクスポートマッピング（検証ゲート）

| `validateNative` でチェックされる JS バインディング名 | 期待されるネイティブエクスポート名 |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

注意: `bindings.ts` はベースの `cancelWork(id)` メンバーのみを宣言しています。モジュールの `types.ts` ファイルは `validateNative` が強制する追加シンボルを宣言マージします。

## 失敗時の動作と診断情報

## 未サポートプラットフォーム

すべての候補が失敗し、`platformTag` が `SUPPORTED_PLATFORMS` に含まれていない場合、ローダーは以下をスローします：

- `Unsupported platform: <tag>`
- サポートされているプラットフォームの完全なリスト
- 明示的な問題報告のガイダンス

## 古いバイナリ / 不一致の症状

典型的な古いバイナリの不一致シグナル：

- `Native addon missing exports (<candidate>). Missing: ...`

一般的な原因：

- 以前のパッケージバージョン/API 形状の古い `.node` バイナリ。
- 間違ったバリアントアーティファクトが選択されている（x64 の場合）。
- 読み込まれたアーティファクトに新しい Rust エクスポートが存在しない。

ローダーの動作：

- 候補ごとの欠落エクスポートの失敗を記録します。
- 残りの候補の探索を続行します。
- どの候補も検証をパスしない場合、最終エラーには試行されたすべてのパスと各失敗メッセージが含まれます。

## コンパイル済みバイナリの起動失敗

コンパイルモードでの最終診断情報には以下が含まれます：

- 期待されるバージョン管理されたキャッシュターゲットパス（`<versionedDir>/<filename>`）、
- 古い `<versionedDir>` を削除して再実行するための修復手順、
- 期待される各ファイル名の直接リリースダウンロード `curl` コマンド。

## 非コンパイル時の起動失敗

通常のパッケージ/ランタイムモードでの最終診断情報には以下が含まれます：

- 再インストールのヒント（`bun install @f5xc-salesdemos/pi-natives`）、
- ローカルリビルドコマンド（`bun --cwd=packages/natives run build`）、
- オプションの x64 バリアントビルドのヒント（`TARGET_VARIANT=baseline|modern ...`）。

## ランタイムの動作

- ローダーは常にリリース候補チェーンを使用します。
- `PI_DEV` を設定すると、候補ごとのコンソール診断情報（`Loaded native addon...` および読み込みエラー）のみが有効になります。
