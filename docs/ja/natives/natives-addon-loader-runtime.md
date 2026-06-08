---
title: ネイティブアドオンローダーランタイム
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: Addon loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# ネイティブアドオンローダーランタイム

このドキュメントでは、`@f5xc-salesdemos/pi-natives` におけるアドオンのロード/検証レイヤーについて詳しく解説します。`native.ts` がどの `.node` ファイルをロードするかを決定する方法、埋め込みペイロードの抽出が実行されるタイミング、および起動時の失敗がどのように報告されるかについて説明します。

## 実装ファイル

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## スコープと責務

ローダー/ランタイムの責務は意図的に限定されています：

- プラットフォーム/CPU を考慮したアドオンファイル名およびディレクトリの候補リストを構築する。
- 必要に応じて、埋め込みアドオンをバージョン付きのユーザーごとのキャッシュディレクトリに実体化する。
- 決定論的な順序で候補を試行する。
- バインディングを公開する前に `validateNative` を通じて古いまたは互換性のないアドオンを拒否する。

ここでのスコープ外：モジュール固有の grep/text/highlight 動作。

## ランタイム入力と導出状態

モジュール初期化時（`export const native = loadNative();`）、`native.ts` は静的コンテキストを計算します：

- **プラットフォームタグ**: ``${process.platform}-${process.arch}``（例：`darwin-arm64`）。
- **パッケージバージョン**: `packages/natives/package.json` の `version` フィールドから取得。
- **コアディレクトリ**:
  - `nativeDir`: パッケージローカルの `packages/natives/native`。
  - `execDir`: `process.execPath` を含むディレクトリ。
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`。
  - `userDataDir` フォールバック:
    - Windows: `%LOCALAPPDATA%/xcsh`（または `%USERPROFILE%/AppData/Local/xcsh`）。
    - Windows 以外: `~/.local/bin`。
- **コンパイル済みバイナリモード** (`isCompiledBinary`): 以下のいずれかが真の場合に true：
  - `PI_COMPILED` 環境変数が設定されている、または
  - `import.meta.url` に Bun 埋め込みマーカー（`$bunfs`、`~BUN`、`%7EBUN`）が含まれている。
- **バリアントオーバーライド**: `PI_NATIVE_VARIANT`（`modern`/`baseline` のみ。無効な値は無視される）。
- **選択されたバリアント**: 明示的なオーバーライドがある場合はそれを使用、それ以外は x64 での実行時 AVX2 検出（AVX2 対応なら `modern`、そうでなければ `baseline`）。

## プラットフォームサポートとタグ解決

`SUPPORTED_PLATFORMS` は以下に固定されています：

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

動作の詳細：

- サポートされていないプラットフォームは事前に拒否されません。
- ローダーはまず計算されたすべての候補を試行します。
- 何もロードできない場合、サポートされているタグの一覧を含む明示的な未サポートプラットフォームエラーをスローします。

これにより、惜しいケースに対して有用な診断情報を提供しつつ、真にサポートされていないターゲットに対しては確実に失敗します。

## バリアント選択（`modern` / `baseline` / デフォルト）

### x64 の動作

1. `PI_NATIVE_VARIANT` が `modern` または `baseline` の場合、その値が優先されます。
2. それ以外は AVX2 サポートを検出します：
   - Linux: `/proc/cpuinfo` をスキャンして `avx2` を検索。
   - macOS: `sysctl` をクエリ（`machdep.cpu.leaf7_features`、フォールバックで `machdep.cpu.features`）。
   - Windows: PowerShell で `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` を実行。
3. 結果：
   - AVX2 利用可能 -> `modern`
   - AVX2 利用不可/検出不能 -> `baseline`

### 非 x64 の動作

- バリアントは使用されません。ローダーはデフォルトのファイル名（`pi_natives.<platform>-<arch>.node`）のままです。

### ファイル名の構築

`tag = <platform>-<arch>` が与えられた場合：

- 非 x64 またはバリアントなし: `pi_natives.<tag>.node`
- x64 + `modern`: 以下の順序で試行
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node`（意図的なフォールバック）
- x64 + `baseline`: `pi_natives.<tag>-baseline.node` のみ

最終エラーメッセージで使用される `addonLabel` は `<tag>` または `<tag> (<variant>)` のいずれかです。

## 候補パスの構築とフォールバック順序

`native.ts` は `require(...)` の呼び出し前に候補プールを構築します。

### リリース候補

バリアント解決済みのファイル名リストから構築され、以下の順序で検索されます：

- **非コンパイルランタイム**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **コンパイルランタイム**（`PI_COMPILED` または Bun 埋め込みマーカー）:
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` は最初の出現順序を保持しながら重複を除去します。

### 最終ランタイムシーケンス

ロード時：

1. オプションの埋め込み抽出候補（生成された場合）が先頭に挿入されます。
2. 残りの重複排除された候補が順番に試行されます。
3. `require(...)` と `validateNative(...)` の両方を通過した最初の候補が採用されます。

## 埋め込みアドオン抽出ライフサイクル

`embedded-addon.ts` は生成されたマニフェストの形状を定義します：

- `platformTag`
- `version`
- `files[]`（各エントリは `variant`、`filename`、`filePath` を持つ）

現在チェックインされているデフォルトは `embeddedAddon: null` です。コンパイルされたアーティファクトがこれを実際のメタデータに置き換える場合があります。

### 抽出ステートマシン

抽出（`maybeExtractEmbeddedAddon`）は、すべてのゲートを通過した場合にのみ実行されます：

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. バリアントに適した埋め込みファイルが見つかる

バリアントファイルの選択はランタイムのバリアント意図を反映します：

- 非 x64: `default` を優先し、次に最初に利用可能なファイル。
- x64 + `modern`: `modern` を優先し、`baseline` にフォールバック。
- x64 + `baseline`: `baseline` を要求。

実体化の動作：

1. `<versionedDir>` が存在することを確認（`mkdirSync(..., { recursive: true })`）。
2. `<versionedDir>/<selected filename>` が既に存在する場合、それを再利用（再書き込みなし）。
3. そうでなければ、埋め込みソースの `filePath` を読み取り、ターゲットファイルに書き込む。
4. 最優先のロード試行用にターゲットパスを返す。

失敗時、抽出は即座にクラッシュしません。エラーエントリ（ディレクトリ作成または書き込みの失敗）を追加し、ローダーは通常の候補プロービングに進みます。

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

`validateNative(bindings, source)` は起動時に `NativeBindings` に対する関数のみの契約を強制します。

メカニズム：

- 必要な各エクスポート名に対して、`typeof bindings[name] === "function"` をチェックします。
- 欠落した名前は集約されます。
- いずれかが欠落している場合、ローダーは以下を含むエラーをスローします：
  - ソースアドオンのパス、
  - 欠落しているエクスポートのリスト、
  - リビルドコマンドのヒント。

これは、古いバイナリ、部分的なビルド、およびシンボル/名前のドリフトに対する厳格な互換性ゲートです。

### JS API ↔ ネイティブエクスポートのマッピング（検証ゲート）

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

注意: `bindings.ts` はベースの `cancelWork(id)` メンバーのみを宣言します。モジュールの `types.ts` ファイルの宣言マージにより、`validateNative` が強制する追加のシンボルが追加されます。

## 失敗時の動作と診断

## 未サポートプラットフォーム

すべての候補が失敗し、`platformTag` が `SUPPORTED_PLATFORMS` に含まれていない場合、ローダーは以下をスローします：

- `Unsupported platform: <tag>`
- サポートされているプラットフォームの完全なリスト
- 明示的な問題報告のガイダンス

## 古いバイナリ / ミスマッチの症状

典型的な古いバイナリのミスマッチシグナル：

- `Native addon missing exports (<candidate>). Missing: ...`

一般的な原因：

- 以前のパッケージバージョン/API 形状の古い `.node` バイナリ。
- 誤ったバリアントアーティファクトが選択されている（x64 の場合）。
- ロードされたアーティファクトに新しい Rust エクスポートが存在しない。

ローダーの動作：

- 候補ごとにエクスポート欠落の失敗を記録します。
- 残りの候補のプロービングを継続します。
- どの候補も検証を通過しない場合、最終エラーにはすべての試行パスと各失敗メッセージが含まれます。

## コンパイル済みバイナリの起動失敗

コンパイルモードでの最終診断には以下が含まれます：

- 期待されるバージョン付きキャッシュターゲットパス（`<versionedDir>/<filename>`）、
- 古い `<versionedDir>` を削除して再実行するための改善策、
- 期待される各ファイル名に対する直接のリリースダウンロード `curl` コマンド。

## 非コンパイルの起動失敗

通常のパッケージ/ランタイムモードでの最終診断には以下が含まれます：

- 再インストールのヒント（`bun install @f5xc-salesdemos/pi-natives`）、
- ローカルリビルドコマンド（`bun --cwd=packages/natives run build`）、
- オプションの x64 バリアントビルドのヒント（`TARGET_VARIANT=baseline|modern ...`）。

## ランタイム動作

- ローダーは常にリリース候補チェーンを使用します。
- `PI_DEV` の設定は候補ごとのコンソール診断（`Loaded native addon...` およびロードエラー）のみを有効にします。
