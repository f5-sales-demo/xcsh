---
title: ネイティブアドオンのビルド、リリース、およびデバッグ ランブック
description: Rustネイティブアドオンのクロスプラットフォーム対応のビルド、リリース、およびデバッグに関するランブック。
sidebar:
  order: 8
  label: ビルド、リリース、デバッグ
i18n:
  sourceHash: efe47aa5b466
  translator: machine
---

# ネイティブアドオンのビルド、リリース、およびデバッグ ランブック

このランブックでは、`@f5-sales-demo/pi-natives` ビルドパイプラインが `.node` アドオンを生成する方法、コンパイル済みディストリビューションがそれらを読み込む方法、およびローダー/ビルドの障害をデバッグする方法について説明します。

`docs/natives-architecture.md` のアーキテクチャ用語に従います：

- **ビルド時のアーティファクト生成** (`scripts/build-native.ts`)
- **組み込みアドオンマニフェスト生成** (`scripts/embed-native.ts`)
- **ランタイムのアドオン読み込み + 検証ゲート** (`src/native.ts`)

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
- `bun scripts/build-native.ts --dev` (`dev:native`) → デバッグ/開発プロファイルビルド（同じ出力ファイル名）
- `bun scripts/embed-native.ts` (`embed:native`) → ビルドされたファイルから `src/embedded-addon.ts` を生成

### 2) Rust アーティファクトのビルド

`build-native.ts` は `crates/pi-natives` で Cargo を実行します：

- 基本コマンド: `cargo build`
- `--dev` が渡されない限り、リリースモードでは `--release` を追加
- クロスターゲットの場合は `--target <CROSS_TARGET>` を追加

`crates/pi-natives/Cargo.toml` は `crate-type = ["cdylib"]` を宣言しているため、Cargo は共有ライブラリ (`.so`/`.dylib`/`.dll`) を出力し、その後 `.node` アドオンファイル名にコピー/リネームされます。

### 3) アーティファクトの検出とインストール

Cargo が完了した後、`build-native.ts` は以下の順序で候補出力ディレクトリをスキャンします：

1. `${CARGO_TARGET_DIR}` （設定されている場合）
2. `<repo>/target`
3. `crates/pi-natives/target`

各ルートに対してプロファイルディレクトリを確認します：

- クロスビルド: `<root>/<crossTarget>/<profile>` → `<root>/<profile>`
- ネイティブビルド: `<root>/<profile>`

その後、以下のいずれかを探します：

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

見つかった場合、一時ファイル + リネームのセマンティクスで `packages/natives/native/` にアトミックにインストールします（Windows のフォールバックは、ロックされた DLL の置き換え失敗を明示的に処理します）。

## ターゲット/バリアントモデルと命名規則

## プラットフォームタグ

ビルドとランタイムの両方でプラットフォームタグを使用します：

`<platform>-<arch>` （例: `darwin-arm64`、`linux-x64`）

## バリアントモデル（x64 のみ）

x64 は CPU バリアントをサポートします：

- `modern` （AVX2 対応パス）
- `baseline` （フォールバック）

非 x64 は単一のデフォルトアーティファクトを使用します（バリアントサフィックスなし）。

### 出力ファイル名

リリースビルド：

- x64: `pi_natives.<platform>-<arch>-modern.node` または `...-baseline.node`
- 非 x64: `pi_natives.<platform>-<arch>.node`

開発ビルド (`--dev`)：

- デバッグプロファイルフラグを使用しますが、標準のプラットフォームタグ付き出力命名を維持します

`native.ts` のランタイムローダー候補順序：

- リリース候補
- コンパイルモードでは、パッケージローカルファイルの前に抽出/キャッシュ候補を追加します

## 環境フラグとビルドオプション

## ランタイムフラグ

- `PI_DEV` （ローダー動作）: ローダー診断を有効化
- `PI_NATIVE_VARIANT` （ローダー動作、x64 のみ）: ランタイム時に `modern` または `baseline` の選択を強制
- `PI_COMPILED` （ローダー動作）: コンパイル済みバイナリの候補/抽出動作を有効化

## ビルド時フラグ/オプション

- `--dev` （スクリプト引数）: デバッグプロファイルでビルド
- `CROSS_TARGET`: Cargo の `--target` に渡される
- `TARGET_PLATFORM`: 出力プラットフォームタグの命名をオーバーライド
- `TARGET_ARCH`: 出力アーキテクチャの命名をオーバーライド
- `TARGET_VARIANT` （x64 のみ）: 出力ファイル名と RUSTFLAGS ポリシーに対して `modern` または `baseline` を強制
- `CARGO_TARGET_DIR`: Cargo 出力を検索する際の追加ルート
- `RUSTFLAGS`:
  - 未設定かつクロスコンパイルでない場合、スクリプトは以下を設定:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - 非 x64 / バリアントなし: `-C target-cpu=native`
  - すでに設定されている場合、スクリプトはオーバーライドしません

## ビルドの状態/ライフサイクル遷移

### ビルドライフサイクル (`build-native.ts`)

1. **初期化**: 引数/環境変数の解析（`--dev`、ターゲットオーバーライド、クロスフラグ）
2. **バリアント解決**:
   - 非 x64 → バリアントなし
   - x64 + `TARGET_VARIANT` → 明示的バリアント
   - x64 クロスビルドで `TARGET_VARIANT` なし → ハードエラー
   - x64 ローカルビルドでオーバーライドなし → ホストの AVX2 を検出
3. **コンパイル**: 解決されたプロファイル/ターゲットで Cargo を実行
4. **アーティファクト検出**: ターゲットルート/プロファイルディレクトリ/ライブラリ名をスキャン
5. **インストール**: `packages/natives/native` にコピー + アトミックリネーム
6. **完了**: ローダー候補として準備されたアドオンを出力

障害発生時は、明示的なエラーテキスト（無効なバリアント、Cargo ビルド失敗、出力ライブラリの欠落、インストール/リネーム失敗）とともにいずれのステージでも終了します。

### 組み込みライフサイクル (`embed-native.ts`)

1. **初期化**: `TARGET_PLATFORM`/`TARGET_ARCH` またはホスト値からプラットフォームタグを計算
2. **候補セット**:
   - x64 は `modern` と `baseline` の両方を期待
   - 非 x64 は 1 つのデフォルトファイルを期待
3. `packages/natives/native` での**可用性を検証**
4. Bun の `file` インポートとパッケージバージョンを含む**マニフェストを生成** (`src/embedded-addon.ts`)
5. コンパイルモード用の**ランタイム抽出準備完了**

`--reset` は検証をバイパスし、null マニフェストスタブ (`embeddedAddon = null`) を書き込みます。

## 開発ワークフローと出荷/コンパイル済み動作

## ローカル開発ワークフロー

典型的なローカルループ：

1. アドオンをビルド:
   - リリース: `bun --cwd=packages/natives run build`
   - デバッグプロファイル: `bun --cwd=packages/natives run dev:native`
2. ローダー診断をテストする場合は `PI_DEV=1` を設定
3. `native.ts` のローダーがパッケージローカルの `native/`（および実行ファイルディレクトリのフォールバック）候補を解決
4. `validateNative` がラッパーがバインディングを使用する前にエクスポートの互換性を検証

## 出荷/コンパイル済みバイナリワークフロー

コンパイルモード（`PI_COMPILED` または Bun 組み込みマーカー）の場合：

1. ローダーがバージョン付きキャッシュディレクトリを計算: `<getNativesDir()>/<packageVersion>` （運用上は `~/.xcsh/natives/<version>`）
2. 組み込みマニフェストが現在のプラットフォーム + バージョンと一致する場合、ローダーは選択された組み込みファイルをそのバージョン付きディレクトリに抽出する可能性あり
3. ランタイム候補の順序は以下を含む:
   - バージョン付きキャッシュディレクトリ
   - レガシーコンパイル済みバイナリディレクトリ（Windows では `%LOCALAPPDATA%/xcsh`、その他では `~/.local/bin`）
   - パッケージ/実行ファイルディレクトリ
4. 最初に正常に読み込まれたアドオンは引き続き `validateNative` を通過する必要あり

これが、パッケージングとランタイムローダーの期待値が一致する必要がある理由です：ファイル名、プラットフォームタグ、およびエクスポートされたシンボルは、`native.ts` がプローブおよび検証するものと一致する必要があります。

## JS API ↔ Rust エクスポートマッピング（検証ゲートのサブセット）

`native.ts` は、読み込まれたアドオンにこれらの JS 可視エクスポートが存在することを要求します。これらは `crates/pi-natives/src` の Rust N-API エクスポートにマッピングされます：

| `validateNative` が要求する JS 名 | Rust エクスポート宣言 | Rust ソースファイル |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` （キャメルケースエクスポート） | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

必要なシンボルが欠落している場合、ローダーはリビルドヒントとともに即座に失敗します。

## 障害動作と診断

## ビルド時の障害

- 無効なバリアント設定:
  - 非 x64 で `TARGET_VARIANT` が設定されている → 即座にエラー
  - x64 クロスビルドで明示的な `TARGET_VARIANT` がない → 即座にエラー
- Cargo ビルドの失敗:
  - スクリプトが非ゼロ終了と stderr を表示
- アーティファクトが見つからない:
  - スクリプトがチェックしたすべてのプロファイルディレクトリを出力
- インストールの失敗:
  - 明示的なメッセージ; Windows ではロックされたファイルのヒントを含む

## ランタイムローダーの障害 (`native.ts`)

- サポートされていないプラットフォームタグ:
  - サポートされているプラットフォームリストとともにスロー
- どの候補も読み込めない:
  - 完全な候補エラーリストとモード固有の修正ヒントとともにスロー
- エクスポートの欠落:
  - 正確な欠落シンボル名とリビルドコマンドとともにスロー
- 組み込み抽出の問題:
  - 抽出の mkdir/write エラーが記録され、最終診断に含まれる

## トラブルシューティングマトリクス

| 症状 | 考えられる原因 | 確認方法 | 修正方法 |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | 古い `.node` バイナリ、Rust エクスポート名の不一致、または間違ったバイナリが読み込まれた | `PI_DEV=1` で実行して読み込まれたパスを確認; そのファイルのエクスポートリストを検査 | `build` を再ビルド; Rust の `#[napi]` エクスポート名（または必要に応じて明示的エイリアス）が JS キーと一致することを確認; 古いキャッシュ/バージョン付きファイルを削除 |
| x64 マシンで modern が期待されるのに baseline が読み込まれる | `PI_NATIVE_VARIANT=baseline`、AVX2 が検出されない、または baseline ファイルのみ存在 | `PI_NATIVE_VARIANT` を確認; `native/` の `-modern` ファイルを検査 | modern バリアントをビルド（`TARGET_VARIANT=modern ... build`）し、ファイルが同梱されていることを確認 |
| クロスビルドが使用不可/ラベル不一致のバイナリを生成 | `CROSS_TARGET` と `TARGET_PLATFORM`/`TARGET_ARCH` の不一致、または x64 で `TARGET_VARIANT` が欠落 | 環境変数のタプルと出力ファイル名を確認 | 一貫した環境変数値と明示的な x64 `TARGET_VARIANT` で再実行 |
| アップグレード後にコンパイル済みバイナリが失敗 | 古い抽出キャッシュ（`~/.xcsh/natives/<old-or-mismatched-version>`）または組み込みマニフェストの不一致 | バージョン付き natives ディレクトリとローダーエラーリストを検査 | パッケージバージョンのバージョン付き natives キャッシュを削除して再実行; パッケージング時に組み込みマニフェストを再生成 |
| ローダーが多くのパスをプローブするがどれも動作しない | プラットフォームの不一致またはパッケージの `native/` にリリースアーティファクトが欠落 | `platformTag` と実際のファイル名を確認 | ビルドされたファイル名が `pi_natives.<platform>-<arch>(-variant).node` の規則と正確に一致し、パッケージに `native/` が含まれていることを確認 |
| `embed:native` が "Incomplete native addons" で失敗 | 組み込み前に必要なバリアントファイルがビルドされていない | エラーテキストの期待値と検出リストを確認 | 必要なファイルを先にビルド（x64: modern+baseline の両方; 非 x64: デフォルト）してから `embed:native` を再実行 |

## 運用コマンド

```bash
# 現在のホスト用リリースアーティファクト
bun --cwd=packages/natives run build

# デバッグプロファイルのアーティファクトビルド
bun --cwd=packages/natives run dev:native

# 明示的な x64 バリアントをビルド
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# ビルドされたネイティブファイルから組み込みアドオンマニフェストを生成
bun --cwd=packages/natives run embed:native

# 組み込みマニフェストを null スタブにリセット
bun --cwd=packages/natives run embed:native -- --reset
```
