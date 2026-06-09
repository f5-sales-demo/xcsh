---
title: 'セッション操作: エクスポート、ダンプ、共有、フォーク、再開'
description: 会話のエクスポート、共有、フォーク、再開に関するセッション操作。
sidebar:
  order: 3
  label: 操作
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# セッション操作: export, dump, share, fork, resume/continue

このドキュメントでは、現在の実装におけるセッションのエクスポート/共有/フォーク/再開操作について、オペレーターに見える動作を説明します。

## 実装ファイル

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## 操作マトリックス

| 操作 | エントリパス | セッション変更 | セッションファイルの作成/切り替え | 出力アーティファクト |
|---|---|---|---|---|
| `/dump` | インタラクティブスラッシュコマンド | なし | なし | クリップボードテキスト |
| `/export [path]` | インタラクティブスラッシュコマンド | なし | なし | HTMLファイル |
| `--export <session.jsonl> [outputPath]` | CLIスタートアップファストパス | ランタイムセッション変更なし | アクティブセッションなし; 対象ファイルを読み取り | HTMLファイル |
| `/share` | インタラクティブスラッシュコマンド | なし | なし | 一時HTML + 共有URL/gist |
| `/fork` | インタラクティブスラッシュコマンド | あり（アクティブセッションIDが変更） | 新しいセッションファイルを作成し、現在のセッションをそれに切り替え（永続モードのみ） | アーティファクトディレクトリが存在する場合、新しいセッション名前空間にコピー |
| `/resume` | インタラクティブスラッシュコマンド | あり（アクティブなインメモリ状態が置換） | 選択された既存セッションファイルに切り替え | なし |
| `--resume` | CLIスタートアップ（ピッカー） | セッション作成後にあり | 選択された既存セッションファイルを開く | なし |
| `--resume <id\|path>` | CLIスタートアップ | セッション作成後にあり | 既存セッションを開く; クロスプロジェクトの場合は現在のプロジェクトにフォーク可能 | なし |
| `--continue` | CLIスタートアップ | セッション作成後にあり | ターミナルのブレッドクラムまたは最新セッションを開く; 存在しない場合は新規作成 | なし |

## エクスポートとダンプ

### `/export [outputPath]`（インタラクティブ）

フロー:

1. `InputController` が `/export...` を `CommandController.handleExportCommand` にルーティング。
2. コマンドはホワイトスペースで分割し、`/export` の後の最初の引数のみを `outputPath` として使用。
3. `AgentSession.exportToHtml()` が `exportSessionToHtml(sessionManager, state, { outputPath, themeName })` を呼び出し。
4. 成功時、UIがパスを表示し、ブラウザでファイルを開く。

動作の詳細:

- `--copy`、`clipboard`、`copy` 引数は明示的に拒否され、`/dump` を使用するよう警告が表示される。
- エクスポートにはセッションヘッダー/エントリ/リーフに加え、現在の `systemPrompt` とエージェント状態のツール説明が埋め込まれる。
- エクスポート中にセッションエントリは追加されない。

注意事項:

- 引数のパースはホワイトスペースベース（`text.split(/\s+/)`）のため、スペースを含むクォート付きパスは、このコマンドパスでは単一パスとして保持されない。

### `--export <inputSessionFile> [outputPath]`（CLI）

`main.ts` でのフロー:

1. 早期に処理される（インタラクティブ/セッション起動の前）。
2. `exportFromFile(inputPath, outputPath?)` を呼び出し。
3. `SessionManager.open(inputPath)` がエントリを読み込み、HTMLが生成・書き込みされる。
4. プロセスが `Exported to: ...` を出力して終了。

動作の詳細:

- 入力ファイルが見つからない場合、`File not found: <path>` として表示される。
- このパスは `AgentSession` を作成せず、実行中のセッションを変更しない。

### `/dump`（インタラクティブクリップボードエクスポート）

フロー:

1. `CommandController.handleDumpCommand()` が `session.formatSessionAsText()` を呼び出し。
2. 空文字列の場合、`No messages to dump yet.` と報告。
3. それ以外の場合、ネイティブの `copyToClipboard` でクリップボードにコピー。

ダンプ内容:

- システムプロンプト
- アクティブなモデル/思考レベル
- ツール定義 + パラメータ
- ユーザー/アシスタントメッセージ
- 思考ブロックとツールコール
- ツール結果と実行ブロック（`excludeFromContext` のbash/pythonエントリを除く）
- カスタム/フック/ファイルメンション/ブランチサマリー/コンパクション要約エントリ

ダンプによるセッション永続化の変更はない。

## 共有

`/share` はインタラクティブ専用で、常に現在のセッションを一時HTMLファイルにエクスポートすることから開始される。

### フェーズ1: 一時エクスポート

- 一時ファイルパス: `${os.tmpdir()}/${Snowflake.next()}.html`
- `session.exportToHtml(tmpFile)` を使用
- エクスポートが失敗した場合（特にインメモリセッション）、共有はエラーで終了。

### フェーズ2: カスタム共有ハンドラー（存在する場合）

`loadCustomShare()` は `~/.xcsh/agent` で最初に存在する候補をチェック:

- `share.ts`
- `share.js`
- `share.mjs`

要件:

- モジュールは `(htmlPath) => Promise<CustomShareResult | string | undefined>` 関数をデフォルトエクスポートする必要がある。

存在し、有効な場合:

- UIが `Sharing...` ローダー状態に入る。
- ハンドラー結果の解釈:
  - 文字列 => URLとして扱われ、表示・開かれる
  - オブジェクト => `url` と/または `message` が表示される; `url` が開かれる
  - `undefined`/falsy => 汎用的な `Session shared`
- 完了後、一時ファイルは削除される。

重要なフォールバック動作:

- カスタムハンドラーが存在するが読み込みに失敗した場合、コマンドはエラーで返る。
- カスタムハンドラーが実行されて例外をスローした場合、コマンドはエラーで返る。
- どちらの失敗ケースでも、GitHub gistへのフォールバックは**行われない**。
- Gistフォールバックは、カスタム共有スクリプトが存在しない場合にのみ発生する。

### フェーズ3: デフォルトgistフォールバック

カスタム共有ハンドラーが見つからない場合のみ:

1. `gh auth status` を検証。
2. `Creating gist...` ローダーを表示。
3. `gh gist create --public=false <tmpFile>` を実行。
4. Gist URLをパースし、gist idを導出、プレビューURL `https://gistpreview.github.io/?<id>` を構築。
5. プレビューURLとgist URLの両方を表示; プレビューを開く。

共有におけるキャンセル/中断のセマンティクス:

- ローダーにはエディターUIを復元し `Share cancelled` と報告する `onAbort` フックがある。
- このコードパスでは、基盤の `gh gist create` コマンドに中断シグナルは渡されない; キャンセルはUIレベルで、コマンド返却後にチェックされる。

## フォーク

`/fork` は現在のセッションから新しいセッションを作成し、アクティブなセッションIDを切り替える。

### 前提条件と即時ガード

- エージェントがストリーミング中の場合、`/fork` は警告付きで拒否される。
- 操作前にUIステータス/ローディングインジケーターがクリアされる。

### セッションレベルのフロー

`AgentSession.fork()`:

1. `reason: "fork"` で `session_before_switch` を発行（キャンセル可能）。
2. 保留中の書き込みをフラッシュ。
3. `SessionManager.fork()` を呼び出し。
4. 旧セッション名前空間から新しい名前空間にアーティファクトディレクトリをコピー（ベストエフォート; ENOENT以外のコピー失敗はログに記録されるが致命的ではない）。
5. `agent.sessionId` を更新。
6. `reason: "fork"` で `session_switch` を発行。

`SessionManager.fork()` の動作:

- 永続モードと既存のセッションファイルが必要。
- 新しいセッションIDと新しいJSONLファイルパスを作成。
- ヘッダーを以下の内容で書き換え:
  - 新しい `id`
  - 新しいタイムスタンプ
  - `cwd` は変更なし
  - `parentSession` に前のセッションIDを設定
- 新しいファイルでヘッダー以外の全エントリは変更なし。

### 非永続的動作

- インメモリセッションマネージャーは `fork()` から `undefined` を返す。
- `AgentSession.fork()` は `false` を返す。
- UIが `Fork failed (session not persisted or cancelled)` と報告。

## 再開とコンティニュー

## インタラクティブ `/resume`

フロー:

1. `SessionManager.list(currentCwd, currentSessionDir)` で取得されたセッションセレクターを開く。
2. 選択時、`SelectorController.handleResumeSession(sessionPath)` が `session.switchSession(sessionPath)` を呼び出し。
3. UIがチャットとTodoをクリア/再構築し、`Resumed session` と報告。

注意:

- このピッカーは現在のセッションディレクトリスコープ内のセッションのみをリスト表示する。
- グローバルなクロスプロジェクト検索は使用しない。

## CLI `--resume`

### `--resume`（値なし）

- `main.ts` が現在のcwd/sessionDirのセッションをリストし、ピッカーを開く。
- 選択されたパスはセッション作成前に `SessionManager.open(selectedPath)` で開かれる。

### `--resume <value>`

`createSessionManager()` の解決順序:

1. 値がパスのように見える場合（`/`、`\`、または `.jsonl`）、直接開く。
2. それ以外はIDプレフィックスとして扱う:
   - 現在のスコープを検索（`SessionManager.list(cwd, sessionDir)`）
   - 見つからず、明示的な `sessionDir` がない場合、グローバルを検索（`SessionManager.listAll()`）

クロスプロジェクトIDマッチの動作:

- マッチしたセッションのcwdが現在のcwdと異なる場合、CLIが問い合わせる:
  - `Session found in different project ... Fork into current directory? [y/N]`
- yesの場合: `SessionManager.forkFrom(match.path, cwd, sessionDir)` がローカルにフォークされた新しいファイルを作成。
- no/非TTYデフォルトの場合: コマンドはエラーになる。

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. 現在のcwdのセッションディレクトリを解決。
2. まずターミナルスコープのブレッドクラムを読み取り。
3. 最も最近変更されたセッションファイルにフォールバック。
4. 見つかったセッションを開く; 存在しない場合は新しいセッションを作成。

これはスタートアップ専用の動作であり、インタラクティブな `/continue` スラッシュコマンドは存在しない。

## セッション切り替えが実際にランタイム状態をどのように変更するか

`AgentSession.switchSession(sessionPath)` は、resume系の操作で使用されるランタイム遷移を行う:

1. `reason: "resume"` と `targetSessionFile` で `session_before_switch` を発行（キャンセル可能）。
2. エージェントイベントサブスクリプションを切断し、実行中の作業を中断。
3. キューされたステアリング/フォローアップ/次ターンメッセージをクリア。
4. 現在のセッションマネージャーの書き込みをフラッシュ。
5. `sessionManager.setSessionFile(sessionPath)` で `agent.sessionId` を更新。
6. 読み込まれたエントリからセッションコンテキストを構築。
7. `reason: "resume"` で `session_switch` を発行。
8. コンテキストからエージェントメッセージを置換。
9. モデルを復元（現在のレジストリで利用可能な場合）。
10. 思考レベルを復元または初期化。
11. エージェントイベントサブスクリプションを再接続。

`switchSession()` 自体は新しいセッションファイルを作成しない。

## イベント発行とキャンセルポイント

### 切り替え/フォークのライフサイクルフック

`newSession`、`fork`、`switchSession` について:

- beforeイベント: `session_before_switch`
  - reason: `new`、`fork`、`resume`
  - `{ cancel: true }` を返すことでキャンセル可能
- afterイベント: `session_switch`
  - 同じreasonセット
  - `previousSessionFile` を含む

`ExtensionRunner.emit()` は最初のキャンセルするbeforeイベント結果で早期リターンする。

### カスタムツール `onSession` の動作

SDKブリッジは拡張機能のセッションイベントをカスタムツールの `onSession` コールバックに接続する:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

これらのコールバックは観測用であり、切り替え/フォークをキャンセルしない。

### このドキュメントに関連するその他のキャンセルサーフェス

- `/fork` はストリーミング中はブロックされる（ユーザーは現在のレスポンスを待つか中断する必要がある）。
- `/resume` セレクターはユーザーがセレクターを閉じることでキャンセルできる。
- クロスプロジェクトの `--resume <id>` はフォークプロンプトを拒否することでキャンセルできる。
- `/share` はgistフローに対してUI中断パス（`Share cancelled`）を持つ; このコードパスでは `gh gist create` に対してプロセスキルセマンティクスは実装されていない。

## 非永続（インメモリ）セッションの動作

セッションマネージャーが `SessionManager.inMemory()`（`--no-session`）で作成された場合:

- セッションファイルパスは存在しない。
- `/export` と `/share` は `Cannot export in-memory session to HTML`（コマンドエラーUIに伝播）で失敗する。
- `/fork` は `SessionManager.fork()` が永続化を必要とするため失敗する。
- `/dump` はインメモリのエージェント状態をシリアライズするため引き続き動作する。
- `--no-session` が設定されている場合、マネージャー作成が即座にインメモリを返すため、CLIのresume/continueセマンティクスはバイパスされる。

## 既知の実装上の注意事項（現在のコード時点）

- `SelectorController.handleResumeSession()` は `session.switchSession(...)` のブール結果をチェックしない; フックでキャンセルされた切り替えでも、UIの「Resumed session」再描画/ステータスパスが進行する可能性がある。
- `/share` のカスタム共有失敗はデフォルトのgistフォールバックに降格しない; エラーでコマンドを終了する。
- `/export` の引数トークン化は単純で、スペースを含むクォート付きパスを保持しない。
