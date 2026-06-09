---
title: ネイティブアドオンのビルド、リリース、デバッグ運用手順書
description: Rustネイティブアドオンのクロスプラットフォームにおけるビルド、リリース、デバッグの運用手順書。
sidebar:
  order: 8
  label: ビルド、リリース、デバッグ
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# ネイティブアドオンのビルド、リリース、デバッグ運用手順書

この運用手順書では、`@f5xc-salesdemos/pi-natives` ビルドパイプラインが `.node` アドオンを生成する方法、コンパイル済みディストリビューションがそれらを読み込む方法、およびローダー/ビルドの障害をデバッグする方法について説明します。

`docs/natives-architecture.md` のアーキテクチャ用語に従っています：

- **ビルド時のアーティファクト生成** (`scripts/build-native.ts`)
- **組み込みアドオンマニフェスト生成** (`scripts/embed-native.ts`)
- **ランタイムアドオンの読み込み + バリデーションゲート** (`src/native.ts`)

## 実装ファイル

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## ビルドパイプラインの概要

### 1) ビルドエントリポイント

`packages/natives/package.json` のスクリプト：

- `bun scripts/build-native.ts` (`build`) → リリースビルド
- `bun scripts/build-native.ts --dev` (`dev:native`) → デバッグ/開発プロファイルビルド（出力名は同じ）
- `bun scripts/embed-native.ts` (`embed:native`) → ビルド済みファイルから `src/embedded-addon.ts` を生成

### 2) Rustアーティファクトのビルド

`build-native.ts` は `crates/pi-natives` でCargoを実行します：

- 基本コマンド: `cargo build`
- `--dev` が渡されない限り、リリースモードでは `--release` を追加
- クロスターゲットの場合は `--target <CROSS_TARGET>` を追加

`crates/pi-natives/Cargo.toml` は `crate-type = ["cdylib"]` を宣言しているため、Cargoは共有ライブラリ（`.so`/`.dylib`/`.dll`）を出力し、それが `.node` アドオンのファイル名にコピー/リネームされます。

### 3) アーティファクトの検出とインストール

Cargoの完了後、`build-native.ts` は以下の順序で候補となる出力ディレクトリをスキャンします：

1. `${CARGO_TARGET_DIR}`（設定されている場合）
2. `<repo>/target`
3. `crates/pi-natives/target`

各ルートに対して、プロファイルディレクトリを確認します：

- クロスビルド: `<root>/<crossTarget>/<profile>` → `<root>/<profile>`
- ネイティブビルド: `<root>/<profile>`

次に、以下のいずれかを探します：

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

見つかった場合、一時ファイル + リネームのセマンティクスで `packages/natives/native/` にアトミックにインストールされます（WindowsのフォールバックではロックされたDLLの置換失敗を明示的に処理します）。

## ターゲット/バリアントモデルと命名規則

## プラットフォームタグ

ビルドとランタイムの両方でプラットフォームタグを使用します：

`<platform>-<arch>`（例: `darwin-arm64`、`linux-x64`）

## バリアントモデル（x64のみ）

x64はCPUバリアントをサポートします：

- `modern`（AVX2対応パス）
- `baseline`（フォールバック）

x64以外では、単一のデフォルトアーティファクトを使用します（バリアントサフィックスなし）。

### 出力ファイル名

リリースビルド：

- x64: `pi_natives.<platform>-<arch>-modern.node` または `...-baseline.node`
- x64以外: `pi_natives.<platform>-<arch>.node`

開発ビルド (`--dev`)：

- デバッグプロファイルフラグを使用しますが、標準的なプラットフォームタグ付きの出力名を維持

`native.ts` でのランタイムローダーの候補順序：

- リリース候補
- コンパイルモードでは、パッケージローカルファイルの前に抽出/キャッシュ候補を追加

## 環境フラグとビルドオプション

## ランタイムフラグ

- `PI_DEV`（ローダー動作）: ローダー診断を有効化
- `PI_NATIVE_VARIANT`（ローダー動作、x64のみ）: ランタイムで `modern` または `baseline` の選択を強制
- `PI_COMPILED`（ローダー動作）: コンパイル済みバイナリの候補/抽出動作を有効化

## ビルド時フラグ/オプション

- `--dev`（スクリプト引数）: デバッグプロファイルでビルド
- `CROSS_TARGET`: Cargoの `--target` に渡される
- `TARGET_PLATFORM`: 出力プラットフォームタグの命名をオーバーライド
- `TARGET_ARCH`: 出力アーキテクチャの命名をオーバーライド
- `TARGET_VARIANT`（x64のみ）: 出力ファイル名とRUSTFLAGSポリシーに対して `modern` または `baseline` を強制
- `CARGO_TARGET_DIR`: Cargo出力を検索する際の追加ルート
- `RUSTFLAGS`:
  - 未設定でクロスコンパイルでない場合、スクリプトは以下を設定：
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - x64以外 / バリアントなし: `-C target-cpu=native`
  - すでに設定されている場合、スクリプトはオーバーライドしない

## ビルドの状態/ライフサイクル遷移

### ビルドライフサイクル (`build-native.ts`)

1. **初期化**: 引数/環境変数の解析（`--dev`、ターゲットオーバーライド、クロスフラグ）
2. **バリアント解決**:
   - x64以外 → バリアントなし
   - x64 + `TARGET_VARIANT` → 明示的バリアント
   - `TARGET_VARIANT` なしのx64クロスビルド → ハードエラー
   - オーバーライドなしのx64ローカルビルド → ホストのAVX2を検出
3. **コンパイル**: 解決されたプロファイル/ターゲットでCargoを実行
4. **アーティファクト検出**: ターゲットルート/プロファイルディレクトリ/ライブラリ名をスキャン
5. **インストール**: `packages/natives/native` にコピー + アトミックリネーム
6. **完了**: ローダー候補用のアドオン準備完了

いずれの段階でも、明示的なエラーテキスト（無効なバリアント、cargoビルド失敗、出力ライブラリの欠落、インストール/リネーム失敗）とともに異常終了が発生します。

### 組み込みライフサイクル (`embed-native.ts`)

1. **初期化**: `TARGET_PLATFORM`/`TARGET_ARCH` またはホスト値からプラットフォームタグを計算
2. **候補セット**:
   - x64は `modern` と `baseline` の両方を期待
   - x64以外は1つのデフォルトファイルを期待
3. **可用性の検証**: `packages/natives/native` 内を確認
4. **マニフェスト生成**: Bunの `file` インポートとパッケージバージョンを含む `src/embedded-addon.ts` を生成
5. **ランタイム抽出準備完了**: コンパイルモード用

`--reset` はバリデーションをバイパスし、nullマニフェストスタブ（`embeddedAddon = null`）を書き込みます。

## 開発ワークフローと出荷/コンパイル済み動作の比較

## ローカル開発ワークフロー

一般的なローカル開発ループ：

1. アドオンをビルド：
   - リリース: `bun --cwd=packages/natives run build`
   - デバッグプロファイル: `bun --cwd=packages/natives run dev:native`
2. ローダー診断をテストする場合は `PI_DEV=1` を設定
3. `native.ts` のローダーがパッケージローカルの `native/`（および実行ファイルディレクトリのフォールバック）候補を解決
4. `validateNative` がエクスポートの互換性を確認してから、ラッパーがバインディングを使用

## 出荷/コンパイル済みバイナリワークフロー

コンパイルモード（`PI_COMPILED` またはBun組み込みマーカー）の場合：

1. ローダーがバージョン付きキャッシュディレクトリを計算: `<getNativesDir()>/<packageVersion>`（運用上は `~/.xcsh/natives/<version>`）
2. 組み込みマニフェストが現在のプラットフォーム+バージョンに一致する場合、ローダーは選択された組み込みファイルをそのバージョン付きディレクトリに抽出する可能性がある
3. ランタイム候補の順序：
   - バージョン付きキャッシュディレクトリ
   - レガシーコンパイル済みバイナリディレクトリ（Windowsでは `%LOCALAPPDATA%/xcsh`、その他では `~/.local/bin`）
   - パッケージ/実行ファイルディレクトリ
4. 最初に正常にロードされたアドオンは依然として `validateNative` を通過する必要がある

これが、パッケージングとランタイムローダーの期待値を一致させる必要がある理由です：ファイル名、プラットフォームタグ、エクスポートされたシンボルは、`native.ts` がプローブおよびバリデーションするものと一致する必要があります。

## JS API ↔ Rustエクスポートのマッピング（バリデーションゲートのサブセット）

`native.ts` は、ロードされたアドオンにこれらのJS可視エクスポートが存在することを要求します。これらは `crates/pi-natives/src` のRust N-APIエクスポートにマッピングされます：

| `validateNative` が要求するJS名 | Rustエクスポート宣言 | Rustソースファイル |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (キャメルケースエクスポート) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

必要なシンボルが欠落している場合、ローダーはリビルドのヒントとともに即座に失敗します。

## 障害時の動作と診断

## ビルド時の障害

- 無効なバリアント設定：
  - x64以外で `TARGET_VARIANT` が設定されている → 即時エラー
  - 明示的な `TARGET_VARIANT` なしのx64クロスビルド → 即時エラー
- Cargoビルドの失敗：
  - スクリプトが非ゼロの終了コードとstderrを表示
- アーティファクトが見つからない：
  - スクリプトが確認したすべてのプロファイルディレクトリを出力
- インストール失敗：
  - 明示的なメッセージ; Windowsではロックされたファイルのヒントを含む

## ランタイムローダーの障害 (`native.ts`)

- サポートされていないプラットフォームタグ：
  - サポートされているプラットフォームリストとともにスロー
- どの候補もロードできなかった：
  - 完全な候補エラーリストとモード別の修復ヒントとともにスロー
- エクスポートの欠落：
  - 正確な欠落シンボル名とリビルドコマンドとともにスロー
- 組み込み抽出の問題：
  - 抽出時のmkdir/書き込みエラーが記録され、最終診断に含まれる

## トラブルシューティングマトリクス

| 症状 | 考えられる原因 | 確認方法 | 修正方法 |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | 古い `.node` バイナリ、Rustエクスポート名の不一致、または誤ったバイナリのロード | `PI_DEV=1` で実行してロードされたパスを確認; そのファイルのエクスポートリストを検査 | `build` を再実行; Rustの `#[napi]` エクスポート名（必要に応じて明示的エイリアス）がJSキーと一致することを確認; 古いキャッシュ/バージョン付きファイルを削除 |
| x64マシンでmodernが期待されるのにbaselineがロードされる | `PI_NATIVE_VARIANT=baseline`、AVX2が検出されない、またはbaselineファイルのみ存在 | `PI_NATIVE_VARIANT` を確認; `native/` で `-modern` ファイルを検査 | modernバリアントをビルド（`TARGET_VARIANT=modern ... build`）し、ファイルが同梱されていることを確認 |
| クロスビルドで使用不能/ラベル誤りのバイナリが生成される | `CROSS_TARGET` と `TARGET_PLATFORM`/`TARGET_ARCH` の不一致、またはx64用の `TARGET_VARIANT` の欠落 | 環境変数のタプルと出力ファイル名を確認 | 一貫した環境変数値と明示的なx64 `TARGET_VARIANT` で再実行 |
| アップグレード後にコンパイル済みバイナリが失敗 | 古い抽出キャッシュ（`~/.xcsh/natives/<old-or-mismatched-version>`）または組み込みマニフェストの不一致 | バージョン付きnativesディレクトリとローダーエラーリストを検査 | パッケージバージョンのバージョン付きnativesキャッシュを削除して再実行; パッケージング時に組み込みマニフェストを再生成 |
| ローダーが多くのパスをプローブするがどれも機能しない | プラットフォームの不一致またはパッケージの `native/` にリリースアーティファクトがない | `platformTag` と実際のファイル名を確認 | ビルドされたファイル名が `pi_natives.<platform>-<arch>(-variant).node` の規則に正確に一致し、パッケージに `native/` が含まれていることを確認 |
| `embed:native` が "Incomplete native addons" で失敗 | 組み込み前に必要なバリアントファイルがビルドされていない | エラーテキストの期待値と検出値のリストを確認 | 必要なファイルを先にビルド（x64: modernとbaselineの両方; x64以外: デフォルト）してから `embed:native` を再実行 |

## 運用コマンド

```bash
# 現在のホスト用リリースアーティファクト
bun --cwd=packages/natives run build

# デバッグプロファイルのアーティファクトビルド
bun --cwd=packages/natives run dev:native

# 明示的なx64バリアントのビルド
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# ビルド済みネイティブファイルから組み込みアドオンマニフェストを生成
bun --cwd=packages/natives run embed:native

# 組み込みマニフェストをnullスタブにリセット
bun --cwd=packages/natives run embed:native -- --reset
```
