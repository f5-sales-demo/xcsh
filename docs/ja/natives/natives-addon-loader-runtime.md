---
title: ネイティブ アドオンローダー ランタイム
description: プラットフォーム検出、フォールバック戦略、モジュール解決を備えたN-APIアドオンローダーランタイム。
sidebar:
  order: 3
  label: アドオンローダー
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# ネイティブ アドオンローダー ランタイム

本ドキュメントでは、`@f5xc-salesdemos/pi-natives` のアドオン読み込み/検証レイヤーについて詳しく説明します。具体的には、`native.ts` がどの `.node` ファイルを読み込むかを決定する方法、埋め込みペイロードの展開が実行されるタイミング、および起動失敗がどのように報告されるかについて解説します。

## 実装ファイル

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## スコープと責務

ローダー/ランタイムの責務は意図的に限定されています：

- プラットフォーム/CPU対応のアドオンファイル名とディレクトリの候補リストを構築する。
- 必要に応じて、埋め込みアドオンをバージョン管理されたユーザーごとのキャッシュディレクトリに実体化する。
- 決定論的な順序で候補を試行する。
- バインディングを公開する前に `validateNative` を通じて古いまたは非互換のアドオンを拒否する。

本ドキュメントのスコープ外：モジュール固有のgrep/テキスト/ハイライト動作。

## ランタイム入力と派生状態

モジュール初期化時（`export const native = loadNative();`）に、`native.ts` は静的コンテキストを計算します：

- **プラットフォームタグ**: ``${process.platform}-${process.arch}``（例：`darwin-arm64`）。
- **パッケージバージョン**: `packages/natives/package.json`（`version` フィールド）より取得。
- **コアディレクトリ**:
  - `nativeDir`: パッケージローカルの `packages/natives/native`。
  - `execDir`: `process.execPath` を含むディレクトリ。
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`。
  - `userDataDir` フォールバック:
    - Windows: `%LOCALAPPDATA%/xcsh`（または `%USERPROFILE%/AppData/Local/xcsh`）。
    - Windows以外: `~/.local/bin`。
- **コンパイル済みバイナリモード**（`isCompiledBinary`）: 以下のいずれかが true の場合に true:
  - 環境変数 `PI_COMPILED` が設定されている、または
  - `import.meta.url` にBun埋め込みマーカーが含まれている（`$bunfs`、`~BUN`、`%7EBUN`）。
- **バリアントオーバーライド**: `PI_NATIVE_VARIANT`（`modern`/`baseline` のみ有効；無効な値は無視される）。
- **選択されたバリアント**: 明示的なオーバーライドが優先、それ以外の場合はx64でのランタイムAVX2検出（AVX2あり: `modern`、なし: `baseline`）。

## プラットフォームサポートとタグ解決

`SUPPORTED_PLATFORMS` は以下に固定されています：

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

動作の詳細：

- サポートされていないプラットフォームは事前には拒否されません。
- ローダーは引き続き計算されたすべての候補を試行します。
- いずれも読み込めない場合、サポート対象タグの一覧を含む明示的な未サポートプラットフォームエラーをスローします。

これにより、真にサポートされていないターゲットに対してはハードフェイルしつつも、近似ケースに対して有用な診断情報を提供します。

## バリアント選択（`modern` / `baseline` / デフォルト）

### x64の動作

1. `PI_NATIVE_VARIANT` が `modern` または `baseline` の場合、その値が優先されます。
2. それ以外の場合はAVX2サポートを検出します：
   - Linux: `/proc/cpuinfo` で `avx2` をスキャン。
   - macOS: `sysctl` をクエリ（`machdep.cpu.leaf7_features`、フォールバックは `machdep.cpu.features`）。
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` を実行。
3. 結果：
   - AVX2利用可能 -> `modern`
   - AVX2利用不可/検出不可 -> `baseline`

### x64以外の動作

- バリアントは使用されません；ローダーはデフォルトのファイル名（`pi_natives.<platform>-<arch>.node`）を使用します。

### ファイル名の構成

`tag = <platform>-<arch>` の場合：

- x64以外またはバリアントなし: `pi_natives.<tag>.node`
- x64 + `modern`: 以下の順で試行
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node`（意図的なフォールバック）
- x64 + `baseline`: `pi_natives.<tag>-baseline.node` のみ

最終エラーメッセージで使用される `addonLabel` は `<tag>` または `<tag> (<variant>)` のいずれかです。

## 候補パスの構成とフォールバック順序

`native.ts` は `require(...)` 呼び出しの前に候補プールを構築します。

### リリース候補

バリアント解決されたファイル名リストから構築され、以下の順序で検索されます：

- **非コンパイルランタイム**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **コンパイル済みランタイム**（`PI_COMPILED` またはBun埋め込みマーカー）:
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` は最初の出現順序を保持しつつ重複を除去します。

### 最終ランタイムシーケンス

読み込み時：

1. 埋め込み展開候補（生成された場合）が先頭に挿入されます。
2. 残りの重複除去された候補が順番に試行されます。
3. `require(...)` に成功し、かつ `validateNative(...)` を通過した最初の候補が採用されます。

## 埋め込みアドオン展開のライフサイクル

`embedded-addon.ts` は生成されたマニフェスト形状を定義します：

- `platformTag`
- `version`
- `files[]`（各エントリは `variant`、`filename`、`filePath` を持つ）

現在チェックインされているデフォルトは `embeddedAddon: null` です；コンパイル済みアーティファクトは実際のメタデータに置き換える場合があります。

### 展開ステートマシン

展開（`maybeExtractEmbeddedAddon`）はすべてのゲートを通過した場合にのみ実行されます：

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. バリアントに適した埋め込みファイルが見つかる

バリアントファイルの選択はランタイムバリアントの意図を反映します：

- x64以外: `default` を優先、次に最初の利用可能なファイル。
- x64 + `modern`: `modern` を優先、`baseline` にフォールバック。
- x64 + `baseline`: `baseline` を要求。

実体化の動作：

1. `<versionedDir>` が存在することを確認（`mkdirSync(..., { recursive: true })`）。
2. `<versionedDir>/<selected filename>` がすでに存在する場合は再利用（再書き込みなし）。
3. それ以外の場合は埋め込みソース `filePath` を読み込み、ターゲットファイルに書き込む。
4. 最高優先度の読み込み試行のためにターゲットパスを返す。

失敗時、展開は即座にクラッシュしません；エラーエントリ（ディレクトリ作成または書き込み失敗）を追記し、ローダーは通常の候補プローブに進みます。

## ライフサイクルと状態遷移

```text
Init
  -> プラットフォーム/バージョン/バリアント/候補リストを計算
  -> (コンパイル済み + 埋め込みマニフェストが一致する?)
       yes -> versionedDir に埋め込みを展開試行（エラーを記録して続行）
       no  -> 展開をスキップ
  -> 順番に各ランタイム候補について:
       require(candidate)
       -> 成功: validateNative
            -> 通過: バインディングを返す (READY)
            -> 失敗: エラーを記録して続行
       -> 失敗: エラーを記録して続行
  -> いずれも読み込めない場合:
       if 未サポートプラットフォームタグ -> Unsupported platform をスロー
       else -> Failed to load をスロー（試行パス全体の診断情報 + ヒント）
```

## `validateNative` コントラクトチェック

`validateNative(bindings, source)` は起動時に `NativeBindings` に対して関数のみのコントラクトを強制します。

メカニズム：

- 必要な各エクスポート名について、`typeof bindings[name] === "function"` をチェックします。
- 不足している名前は集約されます。
- 不足しているものがある場合、ローダーは以下をスローします：
  - ソースアドオンパス、
  - 不足しているエクスポートの一覧、
  - 再ビルドコマンドのヒント。

これは、古いバイナリ、部分的なビルド、およびシンボル/名前のドリフトに対するハード互換性ゲートです。

### JS API ↔ ネイティブエクスポートマッピング（検証ゲート）

| `validateNative` でチェックされるJS バインディング名 | 期待されるネイティブエクスポート名 |
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

注意：`bindings.ts` はベースの `cancelWork(id)` メンバーのみを宣言します；モジュールの `types.ts` ファイルは `validateNative` が強制する追加シンボルを宣言マージします。

## 失敗動作と診断

## 未サポートプラットフォーム

すべての候補が失敗し、`platformTag` が `SUPPORTED_PLATFORMS` に含まれていない場合、ローダーは以下をスローします：

- `Unsupported platform: <tag>`
- サポートされているプラットフォームの完全な一覧
- 明示的な問題報告ガイダンス

## 古いバイナリ/不一致の症状

典型的な古いバイナリ不一致のシグナル：

- `Native addon missing exports (<candidate>). Missing: ...`

一般的な原因：

- 以前のパッケージバージョン/API形状からの古い `.node` バイナリ。
- x64で誤ったバリアントアーティファクトが選択された。
- 読み込まれたアーティファクトに存在しない新しいRustエクスポート。

ローダーの動作：

- 候補ごとのエクスポート不足の失敗を記録します。
- 残りの候補のプローブを続行します。
- いずれの候補も検証されない場合、最終エラーにはすべての試行パスとそれぞれの失敗メッセージが含まれます。

## コンパイル済みバイナリの起動失敗

コンパイル済みモードの最終診断には以下が含まれます：

- 期待されるバージョン管理キャッシュのターゲットパス（`<versionedDir>/<filename>`）、
- 古い `<versionedDir>` を削除して再実行するための修復手順、
- 期待される各ファイル名に対する直接リリースダウンロード `curl` コマンド。

## 非コンパイルの起動失敗

通常のパッケージ/ランタイムモードの最終診断には以下が含まれます：

- 再インストールのヒント（`bun install @f5xc-salesdemos/pi-natives`）、
- ローカル再ビルドコマンド（`bun --cwd=packages/natives run build`）、
- オプションのx64バリアントビルドヒント（`TARGET_VARIANT=baseline|modern ...`）。

## ランタイムの動作

- ローダーは常にリリース候補チェーンを使用します。
- `PI_DEV` の設定は、候補ごとのコンソール診断のみを有効にします（`Loaded native addon...` および読み込みエラー）。
