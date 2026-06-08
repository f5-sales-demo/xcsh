---
title: pi-natives (N-API) への移植 — フィールドノート
description: Node.js の child_process およびシェルコードを Rust N-API ネイティブレイヤーに移行するためのフィールドノート。
sidebar:
  order: 9
  label: pi-natives への移植
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# pi-natives (N-API) への移植 — フィールドノート

これはホットパスを `crates/pi-natives` に移動し、JS バインディングを通じて接続するための実践的なガイドです。同じ失敗を繰り返さないために存在します。

## 移植するタイミング

以下のいずれかに該当する場合に移植します：

- ホットパスがレンダーループ、頻繁な UI 更新、または大量のバッチ処理で実行される。
- JS のメモリ割り当てが支配的である（文字列の大量生成、正規表現のバックトラッキング、大きな配列）。
- JS のベースラインが既にあり、両バージョンを並行してベンチマークできる。
- 作業が CPU バウンドまたはブロッキング I/O であり、libuv スレッドプールで実行可能。
- 作業が非同期 I/O であり、Tokio のランタイムで実行可能（例：シェル実行）。

JS のみの状態や動的インポートに依存する移植は避けてください。N-API エクスポートは純粋で、データ入力/データ出力であるべきです。長時間実行される作業は、`task::blocking`（CPU バウンド/ブロッキング I/O）または `task::future`（非同期 I/O）を通じてキャンセル付きで実行する必要があります。

## ネイティブエクスポートの構造

**Rust 側：**

- 実装は `crates/pi-natives/src/<module>.rs` に配置します。新しいモジュールを追加する場合は、`crates/pi-natives/src/lib.rs` に登録します。
- `#[napi]` でエクスポートします。snake_case のエクスポートは自動的に camelCase に変換されます。明示的な `js_name` は、真のエイリアスやデフォルトでない名前の場合にのみ使用します。構造体には `#[napi(object)]` を使用します。
- CPU バウンドまたはブロッキング作業には `task::blocking(tag, cancel_token, work)`（`crates/pi-natives/src/task.rs` を参照）を使用します。Tokio が必要な非同期作業（例：シェルセッション）には `task::future(env, tag, work)` を使用します。`timeoutMs` や `AbortSignal` を公開する場合は `CancelToken` を渡します。

**JS 側：**

- `packages/natives/src/bindings.ts` にベースの `NativeBindings` インターフェースがあります。
- `packages/natives/src/<module>/types.ts` で TS 型を定義し、宣言マージを通じて `NativeBindings` を拡張します。
- `packages/natives/src/native.ts` が各 `<module>/types.ts` ファイルをインポートして宣言を有効化します。
- `packages/natives/src/<module>/index.ts` が `packages/natives/src/native.ts` からの `native` バインディングをラップします。
- `packages/natives/src/native.ts` がアドオンをロードし、`validateNative` が必要なエクスポートを検証します。
- `packages/natives/src/index.ts` が `packages/*` の呼び出し元向けにラッパーを再エクスポートします。

## 移植チェックリスト

1. **Rust 実装を追加する**

- コアロジックを通常の Rust 関数に記述します。
- 新しいモジュールの場合は、`crates/pi-natives/src/lib.rs` に追加します。
- `#[napi]` でエクスポートし、デフォルトの snake_case -> camelCase マッピングの一貫性を保ちます。
- シグネチャは所有型でシンプルに保ちます：`String`、`Vec<String>`、`Uint8Array`、または大きな文字列/バイト入力には `Either<JsString, Uint8Array>` を使用します。
- CPU バウンドまたはブロッキング作業には `task::blocking` を、非同期作業には `task::future` を使用します。`CancelToken` を渡し、長いループ内では `heartbeat()` を呼び出します。

2. **JS バインディングを接続する**

- `packages/natives/src/<module>/types.ts` に型と `NativeBindings` 拡張を追加します。
- 宣言マージをトリガーするために `packages/natives/src/native.ts` で `./<module>/types` をインポートします。
- `packages/natives/src/<module>/index.ts` に `native` を呼び出すラッパーを追加します。
- `packages/natives/src/index.ts` から再エクスポートします。

3. **ネイティブバリデーションを更新する**

- `validateNative`（`packages/natives/src/native.ts`）に `checkFn("newExport")` を追加します。

4. **ベンチマークを追加する**

- ベンチマークは所有するパッケージの横に配置します（`packages/tui/bench`、`packages/natives/bench`、または `packages/coding-agent/bench`）。
- 同一の実行で JS ベースラインとネイティブバージョンの両方を含めます。
- `Bun.nanoseconds()` と固定イテレーション回数を使用します。
- ベンチマーク入力は小さく現実的に保ちます（ホットパスで実際に見られるデータ）。

5. **ネイティブバイナリをビルドする**

- `bun --cwd=packages/natives run build`
- テスト中にローダー診断を有効にしたい場合は、`bun --cwd=packages/natives run build` を使用して `PI_DEV=1` を設定します。

6. **ベンチマークを実行する**

- `bun run packages/<pkg>/bench/<bench>.ts`（または `bun --cwd=packages/natives run bench`）

7. **使用を判断する**

- ネイティブが遅い場合は、**JS を維持** し、ネイティブエクスポートは未使用のままにします。
- ネイティブが速い場合は、呼び出し元をネイティブラッパーに切り替えます。

## 問題点とその回避方法

### 1) 古い `pi_natives.node` が新しいエクスポートを妨げる

ローダーは `packages/natives/native` 内のプラットフォームタグ付きバイナリ（`pi_natives.<platform>-<arch>.node`）を優先します。`PI_DEV=1` はローダー診断を有効にするだけで、別の開発用アドオンファイル名に切り替えることはなくなりました。`pi_natives.node` のフォールバックもあります。コンパイルされたバイナリは `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` に展開されます。これらのいずれかが古い場合、エクスポートは更新されません。

**修正方法：** 再ビルド前に古いファイルを削除します。

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

コンパイルされたバイナリを実行している場合は、キャッシュされたアドオンディレクトリを削除します：

```bash
rm -rf ~/.xcsh/natives/<version>
```

その後、バイナリにエクスポートが存在することを確認します：

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) `validateNative` からの「Missing exports」エラー

これは**良いこと**です — サイレントなミスマッチを防いでくれます。以下のようなメッセージが表示された場合：

```
Native addon missing exports ... Missing: visibleWidth
```

これはバイナリが古いか、Rust のエクスポート名（または使用している明示的なエイリアス）が JS の名前と一致しないか、エクスポートがコンパイルされていないことを意味します。ビルドと名前のミスマッチを修正してください。バリデーションを弱めないでください。

### 3) Rust のシグネチャミスマッチ

シンプルで所有型に保ちます。`String`、`Vec<String>`、`Uint8Array` は動作します。パブリックエクスポートでは `&str` のような参照を避けてください。構造化データが必要な場合は、`#[napi(object)]` 構造体でラップします。

### 4) ベンチマークの誤り

- 異なる入力やメモリ割り当てを比較しないでください。
- JS とネイティブで同一の入力配列を使用してください。
- スキューを避けるために、両方を同じベンチマークファイルで実行してください。

## ベンチマークテンプレート

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## 検証チェックリスト

- `validateNative` がパスする（missing exports なし）。
- `NativeBindings` が `packages/natives/src/<module>/types.ts` で拡張され、ラッパーが `packages/natives/src/index.ts` で再エクスポートされている。
- `Object.keys(require(...))` に新しいエクスポートが含まれている。
- ベンチマーク結果が PR/ノートに記録されている。
- 呼び出し元はネイティブが速いまたは同等の場合**のみ**更新されている。

## 経験則

- ネイティブが遅い場合は、**切り替えない**。エクスポートは将来の作業のために残しますが、TUI はより高速なパスのままにします。
- ネイティブが速い場合は、呼び出し元を切り替え、リグレッションを検出するためにベンチマークを維持します。
