---
title: Natives アーキテクチャ
description: Rust N-API ネイティブアドオンアーキテクチャ。TypeScript とプラットフォーム固有操作を橋渡しします。
sidebar:
  order: 1
  label: アーキテクチャ
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Natives アーキテクチャ

`@f5xc-salesdemos/pi-natives` は3層スタックで構成されています：

1. **TypeScript ラッパー/API 層** は安定した JS/TS エントリポイントを公開します。
2. **アドオンロード/バリデーション層** は現在のランタイムに対応する `.node` バイナリを解決・検証します。
3. **Rust N-API モジュール層** はパフォーマンスクリティカルなプリミティブを実装し、JS にエクスポートします。

このドキュメントは、より詳細なモジュールレベルのドキュメントの基盤となります。

## 実装ファイル

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## 第1層: TypeScript ラッパー/API 層

`packages/natives/src/index.ts` はパブリックバレルです。エクスポートを機能ドメインごとにグループ化し、生の N-API バインディングを直接公開するのではなく、型付きラッパーを再エクスポートします。

現在のトップレベルグループ：

- **検索/テキストプリミティブ**: `grep`, `glob`, `text`, `highlight`
- **実行/プロセス/ターミナルプリミティブ**: `shell`, `pty`, `ps`, `keys`
- **システム/メディア/変換プリミティブ**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` はベースとなるインターフェースコントラクトを定義します：

- `NativeBindings` は共有メンバー（`cancelWork(id: number)`）から始まります
- モジュール固有のバインディングは各モジュールの `types.ts` からの宣言マージによって追加されます
- `Cancellable` はキャンセレーション機能を公開するラッパーのタイムアウトおよびアボートシグナルオプションを標準化します

**保証されたコントラクト（API 向け）：** コンシューマーは `@f5xc-salesdemos/pi-natives` からインポートし、型付きラッパーを使用します。

**実装詳細（変更の可能性あり）：** 宣言マージおよび内部ラッパーレイアウト（`src/<module>/index.ts`、`src/<module>/types.ts`）。

## 第2層: アドオンのロードとバリデーション

`packages/natives/src/native.ts` はランタイムアドオンの選択、オプションの抽出、およびエクスポートのバリデーションを担当します。

### 候補解決モデル

- プラットフォームタグは `"${process.platform}-${process.arch}"` です。
- 現在サポートされているタグは以下の通りです：
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 では CPU バリアントを使用できます：
  - `modern`（AVX2 対応）
  - `baseline`（フォールバック）
- x64 以外ではデフォルトのファイル名を使用します（バリアントサフィックスなし）。

ファイル名戦略：

- リリース: `pi_natives.<platform>-<arch>.node`
- x64 バリアントリリース: `pi_natives.<platform>-<arch>-modern.node` および/または `...-baseline.node`
- `PI_DEV` はローダー診断を有効にしますが、アドオンのファイル名は変更しません

### プラットフォーム固有のバリアント検出

x64 の場合、バリアント選択は以下を使用します：

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: PowerShell による `System.Runtime.Intrinsics.X86.Avx2` チェック

`PI_NATIVE_VARIANT` で `modern` または `baseline` を明示的に強制できます。

### バイナリ配布と抽出モデル

`packages/natives/package.json` は公開ファイルに `src` と `native` の両方を含みます。`native/` ディレクトリにはプリビルドされたプラットフォームアーティファクトが格納されます。

コンパイル済みバイナリ（`PI_COMPILED` または Bun 組み込みランタイムマーカー）の場合、ローダーの動作は以下の通りです：

1. バージョン付きユーザーキャッシュパスを確認: `<getNativesDir()>/<packageVersion>/...`
2. レガシーコンパイル済みバイナリの場所を確認：
   - Windows: `%LOCALAPPDATA%/xcsh`（フォールバック `%USERPROFILE%/AppData/Local/xcsh`）
   - Windows 以外: `~/.local/bin`
3. パッケージ内の `native/` および実行ファイルディレクトリの候補にフォールバック

組み込みアドオンマニフェストが存在する場合（`scripts/embed-native.ts` によって生成された `embedded-addon.ts`）、`native.ts` はロード前に一致する組み込みバイナリをバージョン付きキャッシュディレクトリに展開できます。

### バリデーションと障害モード

`require(candidate)` の後、`validateNative(...)` は必要なエクスポート（例：`grep`、`glob`、`highlightCode`、`PtySession`、`Shell`、`getSystemInfo`、`getWorkProfile`、`invalidateFsScanCache`）を検証します。

障害パスは明示的です：

- **サポートされていないプラットフォームタグ**: サポートされているプラットフォームのリストとともにスローされます
- **ロード可能な候補がない**: 試行されたすべてのパスと修復のヒントとともにスローされます
- **エクスポートの欠落**: 欠落している正確な名前とリビルドコマンドとともにスローされます
- **組み込み抽出エラー**: ディレクトリ/書き込みの障害を記録し、最終的なロード診断に含めます

**保証されたコントラクト（API 向け）：** アドオンのロードは、検証済みバインディングセットで成功するか、実行可能なエラーテキストで即座に失敗します。

**実装詳細（変更の可能性あり）：** 正確な候補検索順序およびコンパイル済みバイナリのフォールバックパスの順序。

## 第3層: Rust N-API モジュール層

`crates/pi-natives/src/lib.rs` はエクスポートされたモジュールの所有権を宣言する Rust エントリモジュールです：

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

これらのモジュールは `native.ts` によって消費・検証される N-API シンボルを実装します。JS レベルの名前は `packages/natives/src` 内の TS ラッパーを通じて公開されます。

**保証されたコントラクト（API 向け）：** Rust モジュールのエクスポートは `validateNative` およびラッパーモジュールが期待するバインディング名と一致する必要があります。

**実装詳細（変更の可能性あり）：** 内部の Rust モジュール分解およびヘルパーモジュールの境界（`glob_util`、`task` など）。

## 所有権の境界

アーキテクチャレベルでの所有権は以下のように分割されます：

- **TS ラッパー/API の所有権（`packages/natives/src`）**
  - パブリック API のグルーピング、オプションの型付け、および安定した JS エルゴノミクス
  - 呼び出し元に公開されるキャンセレーションサーフェス（`timeoutMs`、`AbortSignal`）
- **ローダーの所有権（`packages/natives/src/native.ts`）**
  - ランタイムバイナリの選択
  - CPU バリアントの選択とオーバーライドの処理
  - コンパイル済みバイナリの抽出と候補のプロービング
  - 必要なネイティブエクスポートの厳密なバリデーション
- **Rust の所有権（`crates/pi-natives/src`）**
  - アルゴリズムおよびシステムレベルの実装
  - プラットフォームネイティブな動作とパフォーマンスセンシティブなロジック
  - TS ラッパーが消費する N-API シンボルの実装

## ランタイムフロー（高レベル）

1. コンシューマーが `@f5xc-salesdemos/pi-natives` からインポートします。
2. ラッパーモジュールがシングルトン `native` バインディングを呼び出します。
3. `native.ts` がプラットフォーム/アーキテクチャ/バリアントに対応する候補バイナリを選択します。
4. コンパイル済みディストリビューションの場合、オプションの組み込みバイナリ抽出が行われます。
5. アドオンがロードされ、エクスポートセットが検証されます。
6. ラッパーが型付き結果を呼び出し元に返します。

## 用語集

- **ネイティブアドオン**: Node-API（N-API）経由でロードされる `.node` バイナリ。
- **プラットフォームタグ**: ランタイムタプル `platform-arch`（例：`darwin-arm64`）。
- **バリアント**: x64 CPU 固有のビルドフレーバー（`modern` AVX2、`baseline` フォールバック）。
- **ラッパー**: 生のネイティブエクスポートに対して型付き API を提供する TS 関数/クラス。
- **宣言マージ**: モジュールの `types.ts` ファイルが `NativeBindings` を拡張するために使用する TS テクニック。
- **コンパイル済みバイナリモード**: CLI がバンドルされ、ネイティブアドオンがパッケージローカルパスのみではなく、抽出/キャッシュパスから解決されるランタイムモード。
- **組み込みアドオン**: コンパイル済みバイナリが一致する `.node` ペイロードを抽出できるよう、`embedded-addon.ts` に生成されるビルドアーティファクトのメタデータおよびファイル参照。
- **バリデーションゲート**: 必要なエクスポートが欠落している古い/不一致のバイナリを拒否する `validateNative(...)` チェック。
