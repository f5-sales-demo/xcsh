---
title: pi-natives (N-API) への移植 — フィールドノート
description: Node.js の child_process やシェルコードを Rust N-API ネイティブレイヤーに移行するためのフィールドノート。
sidebar:
  order: 9
  label: pi-natives への移植
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# pi-natives (N-API) への移植 — フィールドノート

これは、ホットパスを `crates/pi-natives` に移動し、JS バインディングを通じて接続するための実践的なガイドです。同じ失敗を繰り返さないために存在します。

## 移植すべきタイミング

以下のいずれかに該当する場合に移植してください：

- ホットパスがレンダーループ、頻繁な UI 更新、または大量のバッチ処理で実行される。
- JS のアロケーションが支配的（文字列の大量生成、正規表現のバックトラッキング、大きな配列）。
- JS のベースラインが既にあり、両バージョンを並べてベンチマークできる。
- 処理が CPU バウンドであるか、libuv スレッドプールで実行できるブロッキング I/O である。
- 処理が Tokio ランタイムで実行できる非同期 I/O（例：シェル実行）である。

JS のみの状態や動的インポートに依存する移植は避けてください。N-API エクスポートは純粋で、データ入力/データ出力であるべきです。長時間実行される処理は、`task::blocking`（CPU バウンド/ブロッキング I/O）または `task::future`（非同期 I/O）を通じて、キャンセル機能付きで実行すべきです。

## ネイティブエクスポートの構造

**Rust 側：**

- 実装は `crates/pi-natives/src/<module>.rs` に配置します。新しいモジュールを追加する場合は、`crates/pi-natives/src/lib.rs` に登録してください。
- `#[napi]` でエクスポートします。snake_case のエクスポートは自動的に camelCase に変換されます。明示的な `js_name` は、本当のエイリアスやデフォルト以外の名前の場合にのみ使用してください。構造体には `#[napi(object)]` を使用します。
- CPU バウンドまたはブロッキング処理には `task::blocking(tag, cancel_token, work)`（`crates/pi-natives/src/task.rs` を参照）を使用します。Tokio が必要な非同期処理（例：シェルセッション）には `task::future(env, tag, work)` を使用します。`timeoutMs` や `AbortSignal` を公開する場合は `CancelToken` を渡してください。

**JS 側：**

- `packages/natives/src/bindings.ts` にベースの `NativeBindings` インターフェースがあります。
- `packages/natives/src/<module>/types.ts` で TS 型を定義し、宣言マージを通じて `NativeBindings` を拡張します。
- `packages/natives/src/native.ts` が各 `<module>/types.ts` ファイルをインポートして宣言を有効化します。
- `packages/natives/src/<module>/index.ts` が `packages/natives/src/native.ts` の `native` バインディングをラップします。
- `packages/natives/src/native.ts` がアドオンを読み込み、`validateNative` が必要なエクスポートを強制します。
- `packages/natives/src/index.ts` が `packages/*` の呼び出し元向けにラッパーを再エクスポートします。

## 移植チェックリスト

1. **Rust 実装を追加する**

- コアロジックをプレーンな Rust 関数に配置します。
- 新しいモジュールの場合は、`crates/pi-natives/src/lib.rs` に追加します。
- `#[napi]` でエクスポートし、デフォルトの snake_case -> camelCase マッピングの一貫性を保ちます。
- シグネチャはオウンドでシンプルに保ちます：`String`、`Vec<String>`、`Uint8Array`、または大きな文字列/バイト入力には `Either<JsString, Uint8Array>` を使用します。
- CPU バウンドまたはブロッキング処理には `task::blocking` を、非同期処理には `task::future` を使用します。`CancelToken` を渡し、長いループ内では `heartbeat()` を呼び出します。

2. **JS バインディングを接続する**

- `packages/natives/src/<module>/types.ts` に型と `NativeBindings` の拡張を追加します。
- `packages/natives/src/native.ts` で `./<module>/types` をインポートして宣言マージをトリガーします。
- `packages/natives/src/<module>/index.ts` に `native` を呼び出すラッパーを追加します。
- `packages/natives/src/index.ts` から再エクスポートします。

3. **ネイティブバリデーションを更新する**

- `validateNative`（`packages/natives/src/native.ts`）に `checkFn("newExport")` を追加します。

4. **ベンチマークを追加する**

- ベンチマークは所有パッケージの隣に配置します（`packages/tui/bench`、`packages/natives/bench`、または `packages/coding-agent/bench`）。
- 同一の実行内に JS ベースラインとネイティブバージョンの両方を含めます。
- `Bun.nanoseconds()` と固定のイテレーション回数を使用します。
- ベンチマーク入力は小さく現実的に保ちます（ホットパスで実際に見られるデータ）。

5. **ネイティブバイナリをビルドする**

- `bun --cwd=packages/natives run build`
- `bun --cwd=packages/natives run build` を使用し、テスト中にローダーの診断情報が必要な場合は `PI_DEV=1` を設定します。

6. **ベンチマークを実行する**

- `bun run packages/<pkg>/bench/<bench>.ts`（または `bun --cwd=packages/natives run bench`）

7. **使用を決定する**

- ネイティブが遅い場合は、**JS を維持**し、ネイティブエクスポートは未使用のままにします。
- ネイティブが速い場合は、呼び出し箇所をネイティブラッパーに切り替えます。

## 注意点と回避方法

### 1) 古い `pi_natives.node` が新しいエクスポートを妨げる

ローダーは `packages/natives/native` 内のプラットフォームタグ付きバイナリ（`pi_natives.<platform>-<arch>.node`）を優先します。`PI_DEV=1` はローダーの診断情報を有効にするだけで、別の開発用アドオンファイル名に切り替えることはなくなりました。フォールバック `pi_natives.node` もあります。コンパイル済みバイナリは `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` に展開されます。これらのいずれかが古い場合、エクスポートは更新されません。

**修正方法：** リビルド前に古いファイルを削除します。

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

コンパイル済みバイナリを実行している場合は、キャッシュされたアドオンディレクトリを削除します：

```bash
rm -rf ~/.xcsh/natives/<version>
```

その後、バイナリにエクスポートが存在することを確認します：

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) `validateNative` からの「Missing exports」エラー

これは**良いこと**です — サイレントなミスマッチを防ぎます。以下のようなメッセージが表示された場合：

```
Native addon missing exports ... Missing: visibleWidth
```

これは、バイナリが古いか、Rust のエクスポート名（または使用時の明示的エイリアス）が JS の名前と一致していないか、エクスポートがコンパイルされなかったことを意味します。ビルドと命名のミスマッチを修正してください。バリデーションを弱めないでください。

### 3) Rust のシグネチャミスマッチ

シンプルかつオウンドに保ちます。`String`、`Vec<String>`、`Uint8Array` は動作します。パブリックエクスポートでは `&str` のような参照を避けてください。構造化データが必要な場合は、`#[napi(object)]` 構造体でラップしてください。

### 4) ベンチマークの間違い

- 異なる入力やアロケーションを比較しないでください。
- JS とネイティブで同一の入力配列を使用してください。
- スキューを避けるため、同じベンチマークファイル内で両方を実行してください。

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

- `validateNative` が通過する（エクスポートの欠落なし）。
- `NativeBindings` が `packages/natives/src/<module>/types.ts` で拡張され、ラッパーが `packages/natives/src/index.ts` で再エクスポートされている。
- `Object.keys(require(...))` に新しいエクスポートが含まれている。
- ベンチマーク数値が PR/ノートに記録されている。
- 呼び出し箇所は、ネイティブが速いまたは同等の場合**のみ**更新されている。

## 経験則

- ネイティブが遅い場合は、**切り替えないでください**。エクスポートは将来の作業のために残しますが、TUI はより速いパスを維持すべきです。
- ネイティブが速い場合は、呼び出し箇所を切り替え、リグレッションを検出するためにベンチマークを維持してください。
