---
title: ネイティブ アドオンローダー ランタイム
description: プラットフォーム検出、フォールバック戦略、モジュール解決を備えた N-API アドオンローダーランタイム。
sidebar:
  order: 3
  label: アドオンローダー
i18n:
  sourceHash: 743ea3e32c7c
  translator: machine
---

# ネイティブ アドオンローダー ランタイム

本ドキュメントでは、`@f5-sales-demo/pi-natives` におけるアドオンのロード・検証レイヤーを詳しく解説します。具体的には、`native.ts` がどの `.node` ファイルをロードするかを決定する方法、埋め込みペイロードの展開が実行されるタイミング、および起動時の障害がどのように報告されるかを説明します。

## 実装ファイル

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## スコープと責任範囲

ローダー/ランタイムの責任範囲は意図的に限定されています：

- プラットフォーム/CPU を考慮したアドオンファイル名およびディレクトリの候補リストを構築する。
- オプションとして、埋め込みアドオンをバージョン管理されたユーザーごとのキャッシュディレクトリに展開する。
- 候補を決定論的な順序で試行する。
- バインディングを公開する前に `validateNative` を介して古いまたは互換性のないアドオンを拒否する。

モジュール固有の grep/テキスト/ハイライト動作については本ドキュメントの対象外です。

## ランタイム入力と導出状態

モジュール初期化時（`export const native = loadNative();`）に、`native.ts` は静的コンテキストを計算します：

- **プラットフォームタグ**: ``${process.platform}-${process.arch}``（例：`darwin-arm64`）。
- **パッケージバージョン**: `packages/natives/package.json`（`version` フィールド）から取得。
- **コアディレクトリ**:
  - `nativeDir`: パッケージローカルの `packages/natives/native`。
  - `execDir`: `process.execPath` を含むディレクトリ。
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`。
  - `userDataDir` フォールバック:
    - Windows: `%LOCALAPPDATA%/xcsh`（または `%USERPROFILE%/AppData/Local/xcsh`）。
    - 非 Windows: `~/.local/bin`。
- **コンパイル済みバイナリモード**（`isCompiledBinary`）: 以下のいずれかが true の場合に true:
  - `PI_COMPILED` 環境変数が設定されている、または
  - `import.meta.url` に Bun 埋め込みマーカー（`$bunfs`、`~BUN`、`%7EBUN`）が含まれる。
- **バリアントオーバーライド**: `PI_NATIVE_VARIANT`（`modern`/`baseline` のみ有効；無効な値は無視される）。
- **選択されたバリアント**: 明示的なオーバーライドがある場合はそれを使用、それ以外は x64 での実行時 AVX2 検出（AVX2 の場合は `modern`、そうでない場合は `baseline`）。

## プラットフォームサポートとタグ解決

`SUPPORTED_PLATFORMS` は以下に固定されています：

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

動作の詳細：

- サポートされていないプラットフォームは最初の段階で拒否されません。
- ローダーは計算されたすべての候補を最初に試行します。
- 何もロードできない場合、サポートされているタグの一覧を含む明示的なサポート外プラットフォームエラーをスローします。

これにより、真にサポートされていないターゲットではハード失敗しながら、ニアミスのケースに対して有用な診断情報を提供します。

## バリアント選択（`modern` / `baseline` / デフォルト）

### x64 の動作

1. `PI_NATIVE_VARIANT` が `modern` または `baseline` の場合、その値が優先されます。
2. それ以外は AVX2 サポートを検出します：
   - Linux: `/proc/cpuinfo` で `avx2` をスキャン。
   - macOS: `sysctl` を照会（`machdep.cpu.leaf7_features`、フォールバックとして `machdep.cpu.features`）。
   - Windows: PowerShell で `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` を実行。
3. 結果:
   - AVX2 利用可能 -> `modern`
   - AVX2 利用不可/検出不可 -> `baseline`

### 非 x64 の動作

- バリアントは使用されません。ローダーはデフォルトのファイル名（`pi_natives.<platform>-<arch>.node`）を使用します。

### ファイル名の構築

`tag = <platform>-<arch>` とした場合：

- 非 x64 またはバリアントなし: `pi_natives.<tag>.node`
- x64 + `modern`: 以下の順で試行
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node`（意図的なフォールバック）
- x64 + `baseline`: `pi_natives.<tag>-baseline.node` のみ

最終エラーメッセージで使用される `addonLabel` は `<tag>` または `<tag> (<variant>)` のいずれかです。

## 候補パスの構築とフォールバック順序

`native.ts` は `require(...)` 呼び出しの前に候補プールを構築します。

### リリース候補

バリアント解決済みのファイル名リストから構築され、以下の順で検索されます：

- **非コンパイルランタイム**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **コンパイル済みランタイム**（`PI_COMPILED` または Bun 埋め込みマーカー）:
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` は最初の出現順を保持しながら重複を除去します。

### 最終ランタイムシーケンス

ロード時：

1. オプションの埋め込み展開候補（生成された場合）が先頭に挿入されます。
2. 残りの重複除去済み候補が順番に試行されます。
3. `require(...)` に成功し、かつ `validateNative(...)` を通過した最初の候補が採用されます。

## 埋め込みアドオン展開のライフサイクル

`embedded-addon.ts` は以下の生成済みマニフェスト形状を定義します：

- `platformTag`
- `version`
- `files[]`（各エントリには `variant`、`filename`、`filePath` がある）

チェックイン済みのデフォルトは `embeddedAddon: null` です。コンパイル済みアーティファクトはこれを実際のメタデータに置き換える場合があります。

### 展開ステートマシン

展開（`maybeExtractEmbeddedAddon`）はすべてのゲートが通過した場合にのみ実行されます：

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. バリアントに適した埋め込みファイルが見つかる

バリアントファイルの選択はランタイムのバリアント意図を反映します：

- 非 x64: `default` を優先し、次に最初に利用可能なファイル。
- x64 + `modern`: `modern` を優先し、`baseline` にフォールバック。
- x64 + `baseline`: `baseline` を必須とする。

展開動作：

1. `<versionedDir>` が存在することを確認（`mkdirSync(..., { recursive: true })`）。
2. `<versionedDir>/<selected filename>` が既に存在する場合は再利用（再書き込みなし）。
3. 存在しない場合は埋め込みソース `filePath` を読み込み、ターゲットファイルに書き込む。
4. 最優先ロード試行のためにターゲットパスを返す。

失敗時、展開は即座にクラッシュしません。ディレクトリ作成または書き込みの失敗をエラーエントリとして追加し、ローダーは通常の候補探索を続行します。

## ライフサイクルと状態遷移

```text
Init
  -> プラットフォーム/バージョン/バリアント/候補リストを計算
  -> (コンパイル済み + 埋め込みマニフェストが一致するか？)
       yes -> 埋め込みを versionedDir に展開を試みる（エラーを記録し続行）
       no  -> 展開をスキップ
  -> 順番に各ランタイム候補について:
       require(candidate)
       -> 成功: validateNative
            -> 通過: バインディングを返す（READY）
            -> 失敗: エラーを記録し続行
       -> 失敗: エラーを記録し続行
  -> 何もロードされなかった場合:
       プラットフォームタグが未サポートの場合 -> Unsupported platform をスロー
       それ以外 -> Failed to load をスロー（全試行パスの診断情報 + ヒント付き）
```

## `validateNative` コントラクトチェック

`validateNative(bindings, source)` は起動時に `NativeBindings` に対して関数のみのコントラクトを強制します。

仕組み：

- 必須エクスポート名それぞれについて、`typeof bindings[name] === "function"` をチェックします。
- 欠落している名前は集約されます。
- 欠落がある場合、ローダーは以下をスローします：
  - ソースアドオンパス、
  - 欠落エクスポートの一覧、
  - 再ビルドコマンドのヒント。

これは古いバイナリ、不完全なビルド、シンボル/名前のドリフトに対するハード互換性ゲートです。

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

## 障害動作と診断

## サポートされていないプラットフォーム

すべての候補が失敗し、`platformTag` が `SUPPORTED_PLATFORMS` に含まれていない場合、ローダーは以下をスローします：

- `Unsupported platform: <tag>`
- サポートされているプラットフォームの完全な一覧
- 明示的な問題報告ガイダンス

## 古いバイナリ / 不一致の症状

典型的な古いバイナリの不一致シグナル：

- `Native addon missing exports (<candidate>). Missing: ...`

よくある原因：

- 以前のパッケージバージョン/API 形状の古い `.node` バイナリ。
- 誤ったバリアントアーティファクトが選択された（x64 の場合）。
- ロードされたアーティファクトに新しい Rust エクスポートが存在しない。

ローダーの動作：

- 候補ごとの欠落エクスポート失敗を記録します。
- 残りの候補の探索を続行します。
- 候補が検証を通過しない場合、最終エラーには試行されたすべてのパスと各失敗メッセージが含まれます。

## コンパイル済みバイナリの起動失敗

コンパイル済みモードの最終診断には以下が含まれます：

- 期待されるバージョン管理キャッシュのターゲットパス（`<versionedDir>/<filename>`）、
- 古い `<versionedDir>` を削除して再実行するための修復手順、
- 期待される各ファイル名の直接リリースダウンロード `curl` コマンド。

## 非コンパイルの起動失敗

通常のパッケージ/ランタイムモードの最終診断には以下が含まれます：

- 再インストールのヒント（`bun install @f5-sales-demo/pi-natives`）、
- ローカル再ビルドコマンド（`bun --cwd=packages/natives run build`）、
- オプションの x64 バリアントビルドヒント（`TARGET_VARIANT=baseline|modern ...`）。

## ランタイム動作

- ローダーは常にリリース候補チェーンを使用します。
- `PI_DEV` を設定すると、候補ごとのコンソール診断（`Loaded native addon...` およびロードエラー）のみが有効になります。
