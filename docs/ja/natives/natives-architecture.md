---
title: ネイティブアーキテクチャ
description: TypeScriptとプラットフォーム固有の操作を橋渡しするRust N-APIネイティブアドオンアーキテクチャ。
sidebar:
  order: 1
  label: アーキテクチャ
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# ネイティブアーキテクチャ

`@f5xc-salesdemos/pi-natives` は3層のスタックで構成されています：

1. **TypeScriptラッパー/APIレイヤー** は安定したJS/TSエントリポイントを公開します。
2. **アドオンロード/バリデーションレイヤー** は現在のランタイムに対応する `.node` バイナリを解決・検証します。
3. **Rust N-APIモジュールレイヤー** はJSにエクスポートされるパフォーマンスクリティカルなプリミティブを実装します。

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

## レイヤー1: TypeScriptラッパー/APIレイヤー

`packages/natives/src/index.ts` はパブリックバレルです。機能ドメインごとにエクスポートをグループ化し、生のN-APIバインディングを直接公開するのではなく、型付きラッパーを再エクスポートします。

現在のトップレベルグループ：

- **検索/テキストプリミティブ**: `grep`, `glob`, `text`, `highlight`
- **実行/プロセス/ターミナルプリミティブ**: `shell`, `pty`, `ps`, `keys`
- **システム/メディア/変換プリミティブ**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` は基本的なインターフェースコントラクトを定義します：

- `NativeBindings` は共有メンバー（`cancelWork(id: number)`）から始まります
- モジュール固有のバインディングは各モジュールの `types.ts` からの宣言マージによって追加されます
- `Cancellable` はキャンセル機能を公開するラッパーのタイムアウトおよびアボートシグナルオプションを標準化します

**保証されたコントラクト（API向け）：** コンシューマーは `@f5xc-salesdemos/pi-natives` からインポートし、型付きラッパーを使用します。

**実装の詳細（変更の可能性あり）：** 宣言マージおよび内部ラッパーレイアウト（`src/<module>/index.ts`、`src/<module>/types.ts`）。

## レイヤー2: アドオンのロードとバリデーション

`packages/natives/src/native.ts` はランタイムアドオンの選択、オプションの展開、およびエクスポートのバリデーションを担当します。

### 候補解決モデル

- プラットフォームタグは `"${process.platform}-${process.arch}"` です。
- 現在サポートされているタグ：
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64ではCPUバリアントを使用可能：
  - `modern`（AVX2対応）
  - `baseline`（フォールバック）
- x64以外ではデフォルトのファイル名を使用（バリアントサフィックスなし）。

ファイル名戦略：

- リリース: `pi_natives.<platform>-<arch>.node`
- x64バリアントリリース: `pi_natives.<platform>-<arch>-modern.node` および/または `...-baseline.node`
- `PI_DEV` はローダー診断を有効にしますが、アドオンのファイル名は変更しません

### プラットフォーム固有のバリアント検出

x64の場合、バリアント選択には以下を使用します：

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: `System.Runtime.Intrinsics.X86.Avx2` のPowerShellチェック

`PI_NATIVE_VARIANT` で `modern` または `baseline` を明示的に強制できます。

### バイナリ配布と展開モデル

`packages/natives/package.json` は公開ファイルに `src` と `native` の両方を含みます。`native/` ディレクトリにはプリビルドされたプラットフォームアーティファクトが格納されます。

コンパイル済みバイナリ（`PI_COMPILED` またはBun埋め込みランタイムマーカー）の場合、ローダーの動作は：

1. バージョン付きユーザーキャッシュパスを確認: `<getNativesDir()>/<packageVersion>/...`
2. レガシーコンパイル済みバイナリの場所を確認：
   - Windows: `%LOCALAPPDATA%/xcsh`（フォールバック `%USERPROFILE%/AppData/Local/xcsh`）
   - Windows以外: `~/.local/bin`
3. パッケージ内の `native/` および実行ファイルディレクトリの候補にフォールバック

埋め込みアドオンマニフェストが存在する場合（`scripts/embed-native.ts` によって生成された `embedded-addon.ts`）、`native.ts` はロード前に一致する埋め込みバイナリをバージョン付きキャッシュディレクトリに展開できます。

### バリデーションと障害モード

`require(candidate)` の後、`validateNative(...)` は必要なエクスポート（例: `grep`、`glob`、`highlightCode`、`PtySession`、`Shell`、`getSystemInfo`、`getWorkProfile`、`invalidateFsScanCache`）を検証します。

障害パスは明示的です：

- **サポートされていないプラットフォームタグ**: サポートされているプラットフォームリストと共にスローします
- **ロード可能な候補なし**: すべての試行パスと修正のヒントと共にスローします
- **エクスポートの欠落**: 正確な欠落名とリビルドコマンドと共にスローします
- **埋め込み展開エラー**: ディレクトリ/書き込み失敗を記録し、最終的なロード診断に含めます

**保証されたコントラクト（API向け）：** アドオンのロードは、検証済みバインディングセットで成功するか、対処可能なエラーテキストで即座に失敗します。

**実装の詳細（変更の可能性あり）：** 正確な候補検索順序およびコンパイル済みバイナリのフォールバックパス順序。

## レイヤー3: Rust N-APIモジュールレイヤー

`crates/pi-natives/src/lib.rs` はエクスポートされたモジュールの所有権を宣言するRustエントリモジュールです：

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

これらのモジュールは `native.ts` によって消費・検証されるN-APIシンボルを実装します。JS側の名前は `packages/natives/src` のTSラッパーを通じて公開されます。

**保証されたコントラクト（API向け）：** Rustモジュールのエクスポートは、`validateNative` およびラッパーモジュールが期待するバインディング名と一致する必要があります。

**実装の詳細（変更の可能性あり）：** 内部のRustモジュール分解およびヘルパーモジュールの境界（`glob_util`、`task` など）。

## 所有権の境界

アーキテクチャレベルでの所有権は以下のように分割されています：

- **TSラッパー/APIの所有権（`packages/natives/src`）**
  - パブリックAPIのグループ化、オプションの型付け、安定したJSエルゴノミクス
  - 呼び出し元に公開されるキャンセルサーフェス（`timeoutMs`、`AbortSignal`）
- **ローダーの所有権（`packages/natives/src/native.ts`）**
  - ランタイムバイナリの選択
  - CPUバリアントの選択とオーバーライド処理
  - コンパイル済みバイナリの展開と候補のプロービング
  - 必要なネイティブエクスポートの厳格なバリデーション
- **Rustの所有権（`crates/pi-natives/src`）**
  - アルゴリズムおよびシステムレベルの実装
  - プラットフォームネイティブな動作とパフォーマンスに敏感なロジック
  - TSラッパーが消費するN-APIシンボルの実装

## ランタイムフロー（概要）

1. コンシューマーが `@f5xc-salesdemos/pi-natives` からインポートします。
2. ラッパーモジュールがシングルトン `native` バインディングを呼び出します。
3. `native.ts` がプラットフォーム/アーキテクチャ/バリアントに対応する候補バイナリを選択します。
4. コンパイル済み配布の場合、オプションの埋め込みバイナリ展開が実行されます。
5. アドオンがロードされ、エクスポートセットが検証されます。
6. ラッパーが型付き結果を呼び出し元に返します。

## 用語集

- **ネイティブアドオン**: Node-API（N-API）を介してロードされる `.node` バイナリ。
- **プラットフォームタグ**: ランタイムタプル `platform-arch`（例: `darwin-arm64`）。
- **バリアント**: x64 CPU固有のビルドフレーバー（`modern` AVX2、`baseline` フォールバック）。
- **ラッパー**: 生のネイティブエクスポートに対して型付きAPIを提供するTS関数/クラス。
- **宣言マージ**: モジュールの `types.ts` ファイルが `NativeBindings` を拡張するために使用するTS技法。
- **コンパイル済みバイナリモード**: CLIがバンドルされ、ネイティブアドオンがパッケージローカルパスのみではなく、展開/キャッシュパスから解決されるランタイムモード。
- **埋め込みアドオン**: コンパイル済みバイナリが一致する `.node` ペイロードを展開できるように `embedded-addon.ts` に生成されるビルドアーティファクトのメタデータおよびファイル参照。
- **バリデーションゲート**: 必要なエクスポートが欠落している古い/不一致のバイナリを拒否する `validateNative(...)` チェック。
