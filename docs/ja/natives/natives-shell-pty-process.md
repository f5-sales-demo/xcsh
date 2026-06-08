---
title: ネイティブ Shell、PTY、プロセス、キーの内部構造
description: ネイティブレイヤーにおけるShell実行、PTY管理、プロセスライフサイクル、およびキーイベント処理。
sidebar:
  order: 4
  label: Shell、PTY、プロセス
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# ネイティブ Shell、PTY、プロセス、キーの内部構造

このドキュメントでは、`@f5xc-salesdemos/pi-natives` の**実行/プロセス/ターミナルプリミティブ**である `shell`、`pty`、`ps`、`keys` について、`docs/natives-architecture.md` のアーキテクチャ用語を使用して説明します。

## 実装ファイル

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs`（Windows のみ）
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs`（shell/pty で使用される共有キャンセル動作）
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## レイヤーの責務

- **TS ラッパー/API レイヤー** (`packages/natives/src/*`): 型付きエントリポイント、キャンセルサーフェス（`timeoutMs`、`AbortSignal`）、および JS エルゴノミクス。
- **Rust N-API モジュールレイヤー** (`crates/pi-natives/src/*`): shell/PTY プロセス実行、プロセスツリー走査/終了、およびキーシーケンスのパース。
- **バリデーションゲート** (`native.ts`、アーキテクチャレベル): ラッパーが使用される前に、必要なエクスポート（`Shell`、`executeShell`、`PtySession`、`killTree`、`listDescendants`、キーヘルパー）が存在することを確認します。

## Shell サブシステム (`shell`)

### API モデル

2つの実行モードが公開されています:

1. **ワンショット**: `executeShell(options, onChunk?)` による実行。
2. **永続セッション**: `new Shell(options?)` を作成し、`shell.run(...)` を繰り返し呼び出す実行。

両方ともスレッドセーフなコールバックを通じて出力をストリーミングし、`{ exitCode?, cancelled, timedOut }` を返します。

### セッション作成と環境モデル

Rust は以下の設定で `brush_core::Shell` を作成します:

- 非インタラクティブモード、
- `do_not_inherit_env: true`、
- ホスト環境からの明示的な環境再構築、
- シェルに影響する変数のスキップリスト（`PS1`、`PWD`、`SHLVL`、bash 関数エクスポートなど）。

セッション環境の動作:

- `ShellOptions.sessionEnv` はセッション作成時に一度だけ適用されます。
- `ShellRunOptions.env` はコマンドスコープ（`EnvironmentScope::Command`）で、各実行後にポップされます。
- `PATH` は Windows では大文字小文字を区別しない重複排除により特別にマージされます。

Windows 固有のパスエンリッチメント（`shell/windows.rs`）: 検出された Git-for-Windows のパス（`cmd`、`bin`、`usr/bin`）が、存在し、まだ含まれていない場合に追加されます。

### ランタイムライフサイクルと状態遷移

永続シェル（`Shell.run`）は以下のステートマシンを使用します:

- **Idle/Uninitialized**: `session: None`。
- **Running**: 最初の `run()` でセッションを遅延作成し、`current_abort` トークンを保存してコマンドを実行。
- **Completed + keepalive**: 実行の制御フローが `Normal` の場合、`current_abort` がクリアされ、セッションが再利用されます。
- **Completed + teardown**: 制御フローがループ/スクリプト/シェル終了関連（`BreakLoop`、`ContinueLoop`、`ReturnFromFunctionOrScript`、`ExitShell`）の場合、セッションが破棄されます（`session: None`）。
- **Cancelled/Timed out**: 実行タスクがキャンセルされ、猶予待機（2秒）の後、強制中断されます。セッションは破棄されます。
- **Error**: セッションは破棄されます。

ワンショットシェル（`executeShell`）は、呼び出しごとに常に新しいセッションを作成して破棄します。

### ストリーミング/出力動作

- Stdout/stderr は共有パイプにルーティングされ、並行して読み取られます。
- リーダーは UTF-8 をインクリメンタルにデコードします。無効なバイトシーケンスは `U+FFFD` 置換チャンクを出力します。
- プロセス完了後、出力ドレインにはアイドル/最大ガード（`250ms` アイドル、`2s` 最大）があり、バックグラウンドジョブがディスクリプタを保持し続けることによるハングを防止します。

### キャンセル、タイムアウト、およびバックグラウンドジョブ

- `CancelToken` は `timeoutMs` とオプションの `AbortSignal` から構築されます。
- キャンセル/タイムアウト時、シェルキャンセルトークンがトリガーされ、タスクは強制中断前に2秒の猶予期間を取得します。
- キャンセルが発生した場合、バックグラウンドジョブは brush のジョブメタデータを使用して終了されます（`TERM`、その後遅延 `KILL`）。

`Shell.abort()` の動作:

- その `Shell` インスタンスの現在実行中のコマンドのみを中断します。
- 何も実行されていない場合は、成功として何もしません（no-op）。

### エラー動作

一般的に表面化するエラーには以下が含まれます:

- セッション初期化失敗（`Failed to initialize shell`）、
- cwd エラー（`Failed to set cwd`）、
- 環境変数の設定/ポップ失敗、
- スナップショットソース失敗、
- パイプの作成/クローン失敗、
- 実行失敗（`Shell execution failed: ...`）、
- タスクラッパー失敗（`Shell execution task failed: ...`）。

結果レベルのキャンセルフラグ:

- タイムアウト -> `exitCode: undefined`、`timedOut: true`。
- 中断シグナル -> `exitCode: undefined`、`cancelled: true`。

## PTY サブシステム (`pty`)

### API モデル

`new PtySession()` は以下を公開します:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### ランタイムライフサイクルと状態遷移

`PtySession` のステートマシン:

- **Idle**: `core: None`。
- **Reserved**: `start()` は非同期処理が始まる前に同期的に制御チャネルをインストール（`core: Some`）するため、`write/resize/kill` が即座に有効になります。
- **Running**: ブロッキング PTY ループが子プロセスの状態、リーダーイベント、キャンセルハートビート、および制御メッセージを処理します。
- **Terminal closed**: 子プロセス終了 + リーダー完了。
- **Finalized**: start タスク完了後（成功またはエラーを問わず）、`core` は常に `None` にリセットされます。

並行性ガード:

- 既に実行中の状態で開始しようとすると `PTY session already running` が返されます。

### スポーン/アタッチ/書き込み/読み取り/終了のパターン

- PTY は `portable_pty::native_pty_system().openpty(...)` で開かれます。
- コマンドは現在 `sh -lc <command>` として実行され、オプションで `cwd` と環境変数のオーバーライドが可能です。
- `write()` は生バイトを PTY の stdin に送信します。
- `resize()` はディメンションをクランプ（`cols 20..400`、`rows 5..200`）し、マスターのリサイズを呼び出します。
- `kill()` は実行をキャンセル済みとしてマークし、子プロセスを kill します。

出力パス:

- 専用のリーダースレッドがマスターストリームを読み取ります。
- 無効なバイトに対して `U+FFFD` 置換を行うインクリメンタル UTF-8 デコード。
- チャンクは N-API スレッドセーフコールバックを通じて転送されます。

### キャンセルとタイムアウトのセマンティクス

- `timeoutMs` と `AbortSignal` が `CancelToken` に供給されます。
- ループは定期的に `ct.heartbeat()` を呼び出します。中断は子プロセスの kill をトリガーします。
- タイムアウトの分類は文字列ベースです（ハートビートエラー内の `"Timeout"` サブストリング）。

### エラー動作

エラーサーフェスには以下が含まれます:

- PTY 割り当て/オープン失敗、
- PTY スポーン失敗、
- ライター/リーダーの取得失敗、
- 子プロセスのステータス/待機失敗、
- ロックポイズニング、
- 制御チャネルの切断（`PTY session is no longer available`）。

実行中でない場合の制御呼び出し失敗:

- `write/resize/kill` は `PTY session is not running` を返します。

## プロセスツリーサブシステム (`ps`)

### API モデル

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS ラッパーは `setNativeKillTree(native.killTree)` を通じてネイティブ kill-tree 統合を共有ユーティリティに登録します。

### プラットフォーム固有の実装

- **Linux**: `/proc/<pid>/task/<pid>/children` を再帰的に読み取ります。
- **macOS**: `libproc` の `proc_listchildpids` を使用します。
- **Windows**: `CreateToolhelp32Snapshot` でプロセステーブルをスナップショットし、親→子マップを構築し、`OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` で終了します。

### Kill-tree の動作

- 子孫プロセスは再帰的に収集されます。
- kill の順序はボトムアップ（最も深い子孫が先）で、孤児の再親付けを減らします。
- ルート pid は最後に kill されます。
- 戻り値は成功した終了の件数です。

シグナルの動作:

- POSIX: 提供された `signal` が `kill` に渡されます。
- Windows: `signal` は無視されます。終了は無条件のプロセス終了です。

### エラー動作

このモジュールは API サーフェスで意図的に例外をスローしません:

- 欠落/アクセス不可能なプロセスツリーブランチはスキップされます。
- pid ごとの kill 失敗は不成功としてカウントされます（エラーではありません）。
- 検索ミスは通常、`listDescendants` から `[]` を、`killTree` から `0` を返します。

## キーパースサブシステム (`keys`)

### API モデル

公開されるヘルパー:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### パースモデル

パーサーは以下を組み合わせます:

- 直接的な単一バイトマッピング（`enter`、`tab`、`ctrl+<letter>`、印刷可能 ASCII）、
- O(1) レガシーエスケープシーケンスルックアップ（PHF マップ）、
- xterm `modifyOtherKeys` パース、
- Kitty プロトコルパース（`CSI u`、`CSI ~`、`CSI 1;...<letter>`）、
- キー ID への正規化（`ctrl+c`、`shift+tab`、`pageUp`、`f5` など）。

修飾キーの処理:

- キーマッチングでは shift/alt/ctrl ビットのみが比較されます。
- ロックビットは比較前にマスクされます。

レイアウトの動作:

- ベースレイアウトフォールバックは意図的に制約されており、再マップされたレイアウトが ASCII 文字/記号に対して誤一致を生じないようにしています。

### エラー動作

- 認識できないまたは無効なシーケンスは、パース関数から `null` を生成します。
- マッチ関数はパース失敗または不一致時に `false` を返します。
- 不正なキー入力に対してスローされるエラーサーフェスはありません。

## JS ラッパー API ↔ Rust エクスポートマッピング

### Shell + PTY + プロセス

| TS ラッパー API | Rust N-API エクスポート | 備考 |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | ワンショットシェル実行 |
| `new Shell(options?)` | `Shell` class | 永続シェルセッション |
| `shell.run(options, onChunk?)` | `Shell::run` | keepalive 制御フローでセッションを再利用 |
| `shell.abort()` | `Shell::abort` | そのシェルインスタンスのアクティブな実行を中断 |
| `new PtySession()` | `PtySession` class | ステートフル PTY セッション |
| `pty.start(options, onChunk?)` | `PtySession::start` | インタラクティブ PTY 実行 |
| `pty.write(data)` | `PtySession::write` | 生 stdin パススルー |
| `pty.resize(cols, rows)` | `PtySession::resize` | クランプされたターミナルディメンション |
| `pty.kill()` | `PtySession::kill` | アクティブな PTY 子プロセスを強制終了 |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | 子プロセスから先にプロセスツリーを終了 |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | 再帰的な子孫リスト取得 |

### キー

| TS ラッパー API | Rust N-API エクスポート | 備考 |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty コードポイント+修飾キーのマッチ |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | 正規化されたキー ID パーサー |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | 正確なレガシーシーケンスマップチェック |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | 構造化された Kitty パース結果 |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | 高レベルキーマッチャー |

## 放棄されたセッションのクリーンアップとファイナライゼーションに関する注記

- **Shell 永続セッション**: 実行がキャンセル/タイムアウト/エラー/非 keepalive 制御フローの場合、Rust は内部セッション状態を明示的に破棄します。正常に成功した実行は再利用のためにセッションを保持します。
- **PTY セッション**: 失敗パスを含め、`start()` 完了後に `core` は常にクリアされます。
- ラッパーによる**明示的な JS ファイナライザ駆動の kill コントラクトは公開されていません**。クリーンアップは主に実行完了/キャンセルパスに紐付けられています。決定的なティアダウンには、呼び出し側が `timeoutMs`、`AbortSignal`、`shell.abort()`、または `pty.kill()` を使用する必要があります。
