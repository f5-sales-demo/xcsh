---
title: ネイティブアドオンローダーランタイム
description: プラットフォーム検出、フォールバック戦略、モジュール解決を備えたN-APIアドオンローダーランタイム。
sidebar:
  order: 3
  label: アドオンローダー
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# ネイティブアドオンローダーランタイム

このドキュメントでは、`@f5xc-salesdemos/pi-natives` のアドオン読み込み/検証レイヤーについて詳しく解説します：`native.ts` がどの `.node` ファイルを読み込むかをどう決定するか、組み込みペイロードの抽出がいつ実行されるか、起動時の失敗がどのように報告されるかを説明します。

## 実装ファイル

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## スコープと責務

ローダー/ランタイムの責務は意図的に限定されています：

- プラットフォーム/CPUを考慮したアドオンファイル名とディレクトリの候補リストを構築する。
- オプションで、組み込みアドオンをバージョン管理されたユーザー毎のキャッシュディレクトリに実体化する。
- 決定論的な順序で候補を試行する。
- バインディングを公開する前に、`validateNative` で古いまたは互換性のないアドオンを拒否する。

ここではスコープ外：モジュール固有のgrep/テキスト/ハイライト動作。

## ランタイム入力と導出状態

モジュール初期化時（`export const native = loadNative();`）に、`native.ts` は静的コンテキストを計算します：

- **プラットフォームタグ**: ``${process.platform}-${process.arch}``（例：`darwin-arm64`）。
- **パッケージバージョン**: `packages/natives/package.json` の `version` フィールドから取得。
- **コアディレクトリ**:
  - `nativeDir`: パッケージローカルの `packages/natives/native`。
  - `execDir`: `process.execPath` を含むディレクトリ。
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`。
  - `userDataDir` フォールバック:
    - Windows: `%LOCALAPPDATA%/xcsh`（または `%USERPROFILE%/AppData/Local/xcsh`）。
    - Windows以外: `~/.local/bin`。
- **コンパイル済みバイナリモード**（`isCompiledBinary`）: 以下のいずれかに該当する場合true：
  - `PI_COMPILED` 環境変数が設定されている、または
  - `import.meta.url` にBun組み込みマーカー（`$bunfs`、`~BUN`、`%7EBUN`）が含まれている。
- **バリアントオーバーライド**: `PI_NATIVE_VARIANT`（`modern`/`baseline` のみ；無効な値は無視される）。
- **選択されたバリアント**: 明示的なオーバーライド、またはx64でのランタイムAVX2検出（AVX2対応なら `modern`、それ以外は `baseline`）。

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
- 何も読み込めない場合、サポートされているタグの一覧を含む明示的なサポート外プラットフォームエラーをスローします。

これにより、本当にサポートされていないターゲットに対してはハードに失敗しつつ、ほぼ該当するケースに対して有用な診断情報を保持します。

## バリアント選択（`modern` / `baseline` / デフォルト）

### x64の動作

1. `PI_NATIVE_VARIANT` が `modern` または `baseline` の場合、その値が優先されます。
2. それ以外の場合、AVX2サポートを検出：
   - Linux: `/proc/cpuinfo` で `avx2` をスキャン。
   - macOS: `sysctl` をクエリ（`machdep.cpu.leaf7_features`、フォールバックとして `machdep.cpu.features`）。
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` を実行。
3. 結果：
   - AVX2利用可能 -> `modern`
   - AVX2利用不可/検出不能 -> `baseline`

### x64以外の動作

- バリアントは使用されません；ローダーはデフォルトのファイル名（`pi_natives.<platform>-<arch>.node`）を使用します。

### ファイル名の構築

`tag = <platform>-<arch>` とすると：

- x64以外またはバリアントなし: `pi_natives.<tag>.node`
- x64 + `modern`: 以下の順序で試行
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node`（意図的なフォールバック）
- x64 + `baseline`: `pi_natives.<tag>-baseline.node` のみ

最終エラーメッセージで使用される `addonLabel` は `<tag>` または `<tag> (<variant>)` です。

## 候補パスの構築とフォールバック順序

`native.ts` は `require(...)` 呼び出しの前に候補プールを構築します。

### リリース候補

バリアント解決済みのファイル名リストから構築され、以下の順序で検索されます：

- **非コンパイルランタイム**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **コンパイルランタイム**（`PI_COMPILED` またはBun組み込みマーカー）:
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` は最初の出現順序を保持しながら重複を除去します。

### 最終ランタイムシーケンス

読み込み時：

1. オプションの組み込み抽出候補（生成された場合）が先頭に挿入されます。
2. 残りの重複除去された候補が順番に試行されます。
3. `require(...)` と `validateNative(...)` の両方に合格した最初の候補が採用されます。

## 組み込みアドオン抽出ライフサイクル

`embedded-addon.ts` は生成されたマニフェストの形状を定義します：

- `platformTag`
- `version`
- `files[]`（各エントリに `variant`、`filename`、`filePath` を含む）

現在チェックインされているデフォルトは `embeddedAddon: null` です；コンパイル済みアーティファクトはこれを実際のメタデータに置き換える場合があります。

### 抽出ステートマシン

抽出（`maybeExtractEmbeddedAddon`）はすべてのゲートを通過した場合にのみ実行されます：

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. バリアントに適した組み込みファイルが見つかる

バリアントファイルの選択はランタイムのバリアント意図を反映します：

- x64以外: `default` を優先、次に最初の利用可能なファイル。
- x64 + `modern`: `modern` を優先、`baseline` にフォールバック。
- x64 + `baseline`: `baseline` を要求。

実体化の動作：

1. `<versionedDir>` が存在することを確認（`mkdirSync(..., { recursive: true })`）。
2. `<versionedDir>/<selected filename>` が既に存在する場合、それを再利用（再書き込みなし）。
3. そうでなければ、組み込みソースの `filePath` を読み取り、ターゲットファイルに書き込む。
4. 最優先の読み込み試行用にターゲットパスを返す。

失敗時、抽出は即座にクラッシュしません；エラーエントリ（ディレクトリ作成または書き込み失敗）を追加し、ローダーは通常の候補探索に進みます。

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

## `validateNative` 契約チェック

`validateNative(bindings, source)` は起動時に `NativeBindings` に対する関数のみの契約を強制します。

メカニズム：

- 各必須エクスポート名について、`typeof bindings[name] === "function"` をチェックします。
- 欠落した名前は集約されます。
- いずれかが欠落している場合、ローダーは以下をスローします：
  - ソースアドオンのパス、
  - 欠落エクスポートリスト、
  - リビルドコマンドのヒント。

これは、古いバイナリ、部分的なビルド、シンボル/名前のドリフトに対するハードな互換性ゲートです。

### JS API ↔ ネイティブエクスポートマッピング（検証ゲート）

| `validateNative` でチェックされるJSバインディング名 | 期待されるネイティブエクスポート名 |
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

注意: `bindings.ts` はベースの `cancelWork(id)` メンバーのみを宣言しています；モジュールの `types.ts` ファイルが宣言マージで `validateNative` が強制する追加シンボルを追加します。

## 失敗時の動作と診断

## サポート外プラットフォーム

すべての候補が失敗し、`platformTag` が `SUPPORTED_PLATFORMS` に含まれていない場合、ローダーは以下をスローします：

- `Unsupported platform: <tag>`
- サポートされているプラットフォームの完全なリスト
- 明示的な問題報告ガイダンス

## 古いバイナリ / ミスマッチの症状

典型的な古いミスマッチのシグナル：

- `Native addon missing exports (<candidate>). Missing: ...`

一般的な原因：

- 以前のパッケージバージョン/APIシェイプからの古い `.node` バイナリ。
- 誤ったバリアントアーティファクトが選択された（x64の場合）。
- 新しいRustエクスポートが読み込まれたアーティファクトに存在しない。

ローダーの動作：

- 候補ごとの欠落エクスポート失敗を記録する。
- 残りの候補の探索を継続する。
- いずれの候補も検証に合格しない場合、最終エラーには試行されたすべてのパスと各失敗メッセージが含まれます。

## コンパイル済みバイナリの起動失敗

コンパイルモードでの最終診断には以下が含まれます：

- 期待されるバージョン管理されたキャッシュターゲットパス（`<versionedDir>/<filename>`）、
- 古い `<versionedDir>` を削除して再実行する修復方法、
- 各期待されるファイル名の直接リリースダウンロード `curl` コマンド。

## 非コンパイル時の起動失敗

通常のパッケージ/ランタイムモードでの最終診断には以下が含まれます：

- 再インストールのヒント（`bun install @f5xc-salesdemos/pi-natives`）、
- ローカルリビルドコマンド（`bun --cwd=packages/natives run build`）、
- オプションのx64バリアントビルドヒント（`TARGET_VARIANT=baseline|modern ...`）。

## ランタイム動作

- ローダーは常にリリース候補チェーンを使用します。
- `PI_DEV` を設定すると、候補ごとのコンソール診断（`Loaded native addon...` および読み込みエラー）のみが有効になります。
