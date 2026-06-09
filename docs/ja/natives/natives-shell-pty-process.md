---
title: ネイティブ Shell、PTY、プロセス、およびキー内部構造
description: ネイティブレイヤーにおけるシェル実行、PTY管理、プロセスライフサイクル、およびキーイベント処理。
sidebar:
  order: 4
  label: Shell、PTY、プロセス
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# ネイティブ Shell、PTY、プロセス、およびキー内部構造

このドキュメントでは、`@f5xc-salesdemos/pi-natives` における**実行/プロセス/ターミナルプリミティブ**である `shell`、`pty`、`ps`、および `keys` について、`docs/natives-architecture.md` のアーキテクチャ用語を使用して説明します。

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

- **TS ラッパー/API レイヤー**（`packages/natives/src/*`）：型付きエントリポイント、キャンセルサーフェス（`timeoutMs`、`AbortSignal`）、および JS のエルゴノミクス。
- **Rust N-API モジュールレイヤー**（`crates/pi-natives/src/*`）：shell/PTY プロセス実行、プロセスツリーの走査/終了、およびキーシーケンスのパース。
- **バリデーションゲート**（`native.ts`、アーキテクチャレベル）：ラッパーが使用される前に、必要なエクスポート（`Shell`、`executeShell`、`PtySession`、`killTree`、`listDescendants`、キーヘルパー）の存在を保証します。

## Shell サブシステム（`shell`）

### API モデル

2つの実行モードが公開されています：

1. **ワンショット** — `executeShell(options, onChunk?)` 経由。
2. **永続セッション** — `new Shell(options?)` の後に `shell.run(...)` を繰り返し呼び出す。

どちらもスレッドセーフなコールバックを通じて出力をストリーミングし、`{ exitCode?, cancelled, timedOut }` を返します。

### セッション作成と環境モデル

Rust は以下の設定で `brush_core::Shell` を作成します：

- 非インタラクティブモード、
- `do_not_inherit_env: true`、
- ホスト環境からの明示的な環境再構築、
- シェル影響変数のスキップリスト（`PS1`、`PWD`、`SHLVL`、bash 関数エクスポートなど）。

セッション環境の動作：

- `ShellOptions.sessionEnv` はセッション作成時に一度だけ適用されます。
- `ShellRunOptions.env` はコマンドスコープ（`EnvironmentScope::Command`）であり、各実行後にポップされます。
- `PATH` は Windows では大文字小文字を区別しない重複排除で特別にマージされます。

Windows 専用のパス拡張（`shell/windows.rs`）：検出された Git-for-Windows パス（`cmd`、`bin`、`usr/bin`）が、存在しかつ未含の場合に追加されます。

### ランタイムライフサイクルと状態遷移

永続シェル（`Shell.run`）は以下のステートマシンを使用します：

- **アイドル/未初期化**：`session: None`。
- **実行中**：最初の `run()` でセッションを遅延作成し、`current_abort` トークンを保存してコマンドを実行します。
- **完了 + キープアライブ**：実行制御フローが `Normal` の場合、`current_abort` はクリアされセッションが再利用されます。
- **完了 + テアダウン**：制御フローがループ/スクリプト/シェル終了に関連する場合（`BreakLoop`、`ContinueLoop`、`ReturnFromFunctionOrScript`、`ExitShell`）、セッションは破棄されます（`session: None`）。
- **キャンセル/タイムアウト**：実行タスクがキャンセルされ、猶予待機（2秒）の後に強制中断。セッションは破棄されます。
- **エラー**：セッションは破棄されます。

ワンショットシェル（`executeShell`）は、呼び出しごとに常に新しいセッションを作成・破棄します。

### ストリーミング/出力動作

- Stdout/stderr は共有パイプにルーティングされ、並行して読み取られます。
- リーダーは UTF-8 をインクリメンタルにデコードし、無効なバイトシーケンスは `U+FFFD` 置換チャンクとして出力されます。
- プロセス完了後、出力ドレインにはアイドル/最大ガード（`250ms` アイドル、`2s` 最大）があり、バックグラウンドジョブがディスクリプタを開いたままにすることによるハングを防止します。

### キャンセル、タイムアウト、およびバックグラウンドジョブ

- `CancelToken` は `timeoutMs` とオプションの `AbortSignal` から構築されます。
- キャンセル/タイムアウト時、シェルキャンセルトークンがトリガーされ、タスクには強制中断前に 2 秒の猶予ウィンドウが与えられます。
- キャンセルが発生した場合、バックグラウンドジョブは brush のジョブメタデータを使用して終了されます（`TERM`、その後遅延 `KILL`）。

`Shell.abort()` の動作：

- その `Shell` インスタンスの現在実行中のコマンドのみを中断します、
- 実行中のものがない場合は no-op で成功を返します。

### 障害時の動作

一般的に表面化するエラーには以下が含まれます：

- セッション初期化失敗（`Failed to initialize shell`）、
- cwd エラー（`Failed to set cwd`）、
- env の設定/ポップ失敗、
- スナップショットソース失敗、
- パイプ作成/クローン失敗、
- 実行失敗（`Shell execution failed: ...`）、
- タスクラッパー失敗（`Shell execution task failed: ...`）。

結果レベルのキャンセルフラグ：

- タイムアウト -> `exitCode: undefined`、`timedOut: true`。
- 中断シグナル -> `exitCode: undefined`、`cancelled: true`。

## PTY サブシステム（`pty`）

### API モデル

`new PtySession()` は以下を公開します：

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### ランタイムライフサイクルと状態遷移

`PtySession` のステートマシン：

- **アイドル**：`core: None`。
- **予約済み**：`start()` は非同期処理が開始される前に同期的に制御チャネルをインストール（`core: Some`）するため、`write/resize/kill` は即座に有効になります。
- **実行中**：ブロッキング PTY ループが子プロセスの状態、リーダーイベント、キャンセルハートビート、および制御メッセージを処理します。
- **ターミナルクローズ**：子プロセス終了 + リーダー完了。
- **ファイナライズ**：`core` は start タスク完了後（成功またはエラー）に常に `None` にリセットされます。

並行性ガード：

- 既に実行中に開始すると `PTY session already running` が返されます。

### スポーン/アタッチ/書き込み/読み取り/終了パターン

- PTY は `portable_pty::native_pty_system().openpty(...)` で開かれます。
- コマンドは現在 `sh -lc <command>` として実行され、オプションで `cwd` と env のオーバーライドが可能です。
- `write()` は生バイトを PTY stdin に送信します。
- `resize()` はディメンションをクランプ（`cols 20..400`、`rows 5..200`）し、マスターのリサイズを呼び出します。
- `kill()` は実行をキャンセル済みとしてマークし、子プロセスを kill します。

出力パス：

- 専用のリーダースレッドがマスターストリームを読み取ります、
- 無効バイトに対して `U+FFFD` 置換を行うインクリメンタル UTF-8 デコード、
- チャンクは N-API スレッドセーフコールバックを通じて転送されます。

### キャンセルとタイムアウトのセマンティクス

- `timeoutMs` と `AbortSignal` が `CancelToken` に供給されます。
- ループは定期的に `ct.heartbeat()` を呼び出し、中断は子プロセスの kill をトリガーします。
- タイムアウトの分類は文字列ベースです（ハートビートエラー内の `"Timeout"` 部分文字列）。

### 障害時の動作

エラーサーフェスには以下が含まれます：

- PTY 割り当て/オープン失敗、
- PTY スポーン失敗、
- ライター/リーダー取得失敗、
- 子プロセスの状態確認/待機失敗、
- ロックポイズニング、
- 制御チャネル切断（`PTY session is no longer available`）。

実行中でない場合の制御呼び出し失敗：

- `write/resize/kill` は `PTY session is not running` を返します。

## プロセスツリーサブシステム（`ps`）

### API モデル

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS ラッパーは `setNativeKillTree(native.killTree)` を通じて共有ユーティリティにネイティブ kill-tree 統合も登録します。

### プラットフォーム固有の実装

- **Linux**：`/proc/<pid>/task/<pid>/children` を再帰的に読み取ります。
- **macOS**：`libproc` の `proc_listchildpids` を使用します。
- **Windows**：`CreateToolhelp32Snapshot` でプロセステーブルをスナップショットし、親→子マップを構築し、`OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` で終了します。

### Kill-tree の動作

- 子孫は再帰的に収集されます。
- Kill 順序はボトムアップ（最も深い子孫が先）であり、孤立プロセスの再ペアレントを軽減します。
- ルート pid は最後に kill されます。
- 戻り値は成功した終了の数です。

シグナルの動作：

- POSIX：提供された `signal` が `kill` に渡されます。
- Windows：`signal` は無視され、終了は無条件のプロセス終了です。

### 障害時の動作

このモジュールは API サーフェスで意図的に例外をスローしません：

- 欠損/アクセス不可能なプロセスツリーブランチはスキップされます、
- pid ごとの kill 失敗は不成功としてカウントされます（エラーではありません）、
- ルックアップミスは通常 `listDescendants` から `[]`、`killTree` から `0` を返します。

## キーパースサブシステム（`keys`）

### API モデル

公開されるヘルパー：

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### パースモデル

パーサーは以下を組み合わせます：

- 直接単一バイトマッピング（`enter`、`tab`、`ctrl+<letter>`、印字可能 ASCII）、
- O(1) レガシーエスケープシーケンスルックアップ（PHF マップ）、
- xterm `modifyOtherKeys` パース、
- Kitty プロトコルパース（`CSI u`、`CSI ~`、`CSI 1;...<letter>`）、
- キー ID への正規化（`ctrl+c`、`shift+tab`、`pageUp`、`f5` など）。

修飾キーの処理：

- キーマッチングでは shift/alt/ctrl ビットのみが比較されます、
- ロックビットは比較前にマスクアウトされます。

レイアウトの動作：

- ベースレイアウトフォールバックは意図的に制約されており、リマップされたレイアウトが ASCII 文字/記号に対して誤ったマッチを生成しないようにしています。

### 障害時の動作

- 認識できないまたは無効なシーケンスはパース関数から `null` を生成します。
- マッチ関数はパース失敗またはミスマッチ時に `false` を返します。
- 不正なキー入力に対してエラーがスローされるサーフェスはありません。

## JS ラッパー API ↔ Rust エクスポートマッピング

### Shell + PTY + プロセス

| TS ラッパー API | Rust N-API エクスポート | 備考 |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | ワンショットシェル実行 |
| `new Shell(options?)` | `Shell` クラス | 永続シェルセッション |
| `shell.run(options, onChunk?)` | `Shell::run` | キープアライブ制御フローでセッションを再利用 |
| `shell.abort()` | `Shell::abort` | そのシェルインスタンスのアクティブな実行を中断 |
| `new PtySession()` | `PtySession` クラス | ステートフル PTY セッション |
| `pty.start(options, onChunk?)` | `PtySession::start` | インタラクティブ PTY 実行 |
| `pty.write(data)` | `PtySession::write` | 生 stdin パススルー |
| `pty.resize(cols, rows)` | `PtySession::resize` | クランプされたターミナルサイズ |
| `pty.kill()` | `PtySession::kill` | アクティブな PTY 子プロセスを強制 kill |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | 子プロセス優先のプロセスツリー終了 |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | 再帰的子孫リスト取得 |

### キー

| TS ラッパー API | Rust N-API エクスポート | 備考 |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty コードポイント+修飾キーマッチ |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | 正規化されたキー ID パーサー |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | 正確なレガシーシーケンスマップチェック |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | 構造化された Kitty パース結果 |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | 高レベルキーマッチャー |

## 放棄されたセッションのクリーンアップとファイナライゼーションに関する注記

- **Shell 永続セッション**：実行がキャンセル/タイムアウト/エラー/非キープアライブ制御フローの場合、Rust は内部セッション状態を明示的に破棄します。正常に成功した実行はセッションを再利用のために保持します。
- **PTY セッション**：`core` は `start()` 完了後、失敗パスを含めて常にクリアされます。
- **明示的な JS ファイナライザー駆動の kill 契約**はラッパーによって公開されていません。クリーンアップは主に実行完了/キャンセルパスに紐付けられています。確定的なテアダウンのために、呼び出し側は `timeoutMs`、`AbortSignal`、`shell.abort()`、または `pty.kill()` を使用すべきです。
