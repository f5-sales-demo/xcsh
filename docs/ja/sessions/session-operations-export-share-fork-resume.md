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

# セッション操作: export、dump、share、fork、resume/continue

このドキュメントでは、現在実装されているセッションのエクスポート/共有/フォーク/再開操作について、オペレーターから見える動作を説明します。

## 実装ファイル

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## 操作マトリクス

| 操作 | エントリパス | セッション変更 | セッションファイルの作成/切り替え | 出力アーティファクト |
|---|---|---|---|---|
| `/dump` | インタラクティブスラッシュコマンド | なし | なし | クリップボードテキスト |
| `/export [path]` | インタラクティブスラッシュコマンド | なし | なし | HTMLファイル |
| `--export <session.jsonl> [outputPath]` | CLIスタートアップファストパス | ランタイムセッション変更なし | アクティブセッションなし、対象ファイルを読み取り | HTMLファイル |
| `/share` | インタラクティブスラッシュコマンド | なし | なし | 一時HTML + 共有URL/gist |
| `/fork` | インタラクティブスラッシュコマンド | あり（アクティブセッションのIDが変更） | 新しいセッションファイルを作成し、現在のセッションをそれに切り替え（永続モードのみ） | アーティファクトディレクトリが存在する場合、新しいセッション名前空間にコピー |
| `/resume` | インタラクティブスラッシュコマンド | あり（アクティブなインメモリ状態が置換） | 選択された既存セッションファイルに切り替え | なし |
| `--resume` | CLIスタートアップ（ピッカー） | セッション作成後にあり | 選択された既存セッションファイルを開く | なし |
| `--resume <id\|path>` | CLIスタートアップ | セッション作成後にあり | 既存セッションを開く。クロスプロジェクトの場合は現在のプロジェクトにフォーク可能 | なし |
| `--continue` | CLIスタートアップ | セッション作成後にあり | ターミナルのブレッドクラムまたは最新セッションを開く。存在しない場合は新規作成 | なし |

## エクスポートとダンプ

### `/export [outputPath]`（インタラクティブ）

フロー:

1. `InputController` が `/export...` を `CommandController.handleExportCommand` にルーティングします。
2. コマンドはホワイトスペースで分割し、`/export` の後の最初の引数のみを `outputPath` として使用します。
3. `AgentSession.exportToHtml()` が `exportSessionToHtml(sessionManager, state, { outputPath, themeName })` を呼び出します。
4. 成功時、UIはパスを表示し、ブラウザでファイルを開きます。

動作の詳細:

- `--copy`、`clipboard`、`copy` 引数は明示的に拒否され、`/dump` を使用するよう警告が表示されます。
- エクスポートにはセッションのヘッダー/エントリ/リーフと、現在の `systemPrompt` およびエージェント状態からのツール説明が埋め込まれます。
- エクスポート中にセッションエントリは追加されません。

注意点:

- 引数の解析はホワイトスペースベース（`text.split(/\s+/)`）であるため、スペースを含むクォートされたパスはこのコマンドパスでは単一のパスとして保持されません。

### `--export <inputSessionFile> [outputPath]`（CLI）

`main.ts` でのフロー:

1. 早期に処理されます（インタラクティブ/セッションスタートアップの前）。
2. `exportFromFile(inputPath, outputPath?)` を呼び出します。
3. `SessionManager.open(inputPath)` がエントリを読み込み、その後HTMLが生成されて書き込まれます。
4. プロセスは `Exported to: ...` と表示して終了します。

動作の詳細:

- 入力ファイルが存在しない場合、`File not found: <path>` としてエラーが表示されます。
- このパスは `AgentSession` を作成せず、実行中のセッションを変更しません。

### `/dump`（インタラクティブクリップボードエクスポート）

フロー:

1. `CommandController.handleDumpCommand()` が `session.formatSessionAsText()` を呼び出します。
2. 空文字列の場合、`No messages to dump yet.` と報告します。
3. それ以外の場合、ネイティブの `copyToClipboard` でクリップボードにコピーします。

ダンプの内容:

- システムプロンプト
- アクティブなモデル/思考レベル
- ツール定義 + パラメータ
- ユーザー/アシスタントメッセージ
- 思考ブロックとツール呼び出し
- ツール結果と実行ブロック（`excludeFromContext` のbash/pythonエントリを除く）
- カスタム/フック/ファイルメンション/ブランチサマリー/コンパクションサマリーエントリ

ダンプによるセッション永続化の変更はありません。

## 共有

`/share` はインタラクティブ専用で、常に現在のセッションを一時HTMLファイルにエクスポートすることから開始します。

### フェーズ1: 一時エクスポート

- 一時ファイルパス: `${os.tmpdir()}/${Snowflake.next()}.html`
- `session.exportToHtml(tmpFile)` を使用
- エクスポートが失敗した場合（特にインメモリセッション）、共有はエラーで終了します。

### フェーズ2: カスタム共有ハンドラー（存在する場合）

`loadCustomShare()` は `~/.xcsh/agent` で最初に存在する候補をチェックします:

- `share.ts`
- `share.js`
- `share.mjs`

要件:

- モジュールは `(htmlPath) => Promise<CustomShareResult | string | undefined>` 関数をデフォルトエクスポートする必要があります。

存在し、有効な場合:

- UIは `Sharing...` ローダー状態になります。
- ハンドラー結果の解釈:
  - 文字列 => URLとして扱われ、表示されて開かれる
  - オブジェクト => `url` および/または `message` が表示される。`url` が開かれる
  - `undefined`/falsy => 汎用的な `Session shared`
- 完了後、一時ファイルは削除されます。

重要なフォールバック動作:

- カスタムハンドラーが存在するが読み込みに失敗した場合、コマンドはエラーで終了します。
- カスタムハンドラーが実行されて例外をスローした場合、コマンドはエラーで終了します。
- いずれの失敗ケースでも、GitHub gistへの**フォールバックは行われません**。
- Gistフォールバックは、カスタム共有スクリプトが存在しない場合にのみ発生します。

### フェーズ3: デフォルトgistフォールバック

カスタム共有ハンドラーが見つからない場合のみ:

1. `gh auth status` を検証します。
2. `Creating gist...` ローダーを表示します。
3. `gh gist create --public=false <tmpFile>` を実行します。
4. gist URLを解析し、gist idを導出し、プレビューURL `https://gistpreview.github.io/?<id>` を構築します。
5. プレビューURLとgist URLの両方を表示し、プレビューを開きます。

共有でのキャンセル/中断セマンティクス:

- ローダーには、エディターUIを復元して `Share cancelled` と報告する `onAbort` フックがあります。
- このコードパスでは、基盤となる `gh gist create` コマンドにアボートシグナルは渡されません。キャンセルはUIレベルで、コマンドが返された後にチェックされます。

## フォーク

`/fork` は現在のセッションから新しいセッションを作成し、アクティブなセッションのIDを切り替えます。

### 前提条件と即時ガード

- エージェントがストリーミング中の場合、`/fork` は警告付きで拒否されます。
- 操作前にUIステータス/ローディングインジケーターがクリアされます。

### セッションレベルのフロー

`AgentSession.fork()`:

1. `reason: "fork"` で `session_before_switch` を発行します（キャンセル可能）。
2. 保留中の書き込みをフラッシュします。
3. `SessionManager.fork()` を呼び出します。
4. 旧セッション名前空間から新しい名前空間にアーティファクトディレクトリをコピーします（ベストエフォート。ENOENT以外のコピー失敗はログに記録されますが、致命的ではありません）。
5. `agent.sessionId` を更新します。
6. `reason: "fork"` で `session_switch` を発行します。

`SessionManager.fork()` の動作:

- 永続モードと既存のセッションファイルが必要です。
- 新しいセッションIDと新しいJSONLファイルパスを作成します。
- ヘッダーを以下の内容で書き換えます:
  - 新しい `id`
  - 新しいタイムスタンプ
  - `cwd` は変更なし
  - `parentSession` に前のセッションIDを設定
- 新しいファイル内のヘッダー以外のすべてのエントリは変更なし。

### 非永続モードの動作

- インメモリセッションマネージャーは `fork()` から `undefined` を返します。
- `AgentSession.fork()` は `false` を返します。
- UIは `Fork failed (session not persisted or cancelled)` と報告します。

## 再開とコンティニュー

## インタラクティブ `/resume`

フロー:

1. `SessionManager.list(currentCwd, currentSessionDir)` で取得したセッションセレクターを開きます。
2. 選択時、`SelectorController.handleResumeSession(sessionPath)` が `session.switchSession(sessionPath)` を呼び出します。
3. UIはチャットとTodoをクリア/再構築し、`Resumed session` と報告します。

注意:

- このピッカーは現在のセッションディレクトリスコープ内のセッションのみをリストします。
- グローバルなクロスプロジェクト検索は使用しません。

## CLI `--resume`

### `--resume`（値なし）

- `main.ts` が現在のcwd/sessionDirのセッションをリストし、ピッカーを開きます。
- 選択されたパスは、セッション作成前に `SessionManager.open(selectedPath)` で開かれます。

### `--resume <value>`

`createSessionManager()` の解決順序:

1. 値がパスのように見える場合（`/`、`\`、または `.jsonl`）、直接開きます。
2. そうでなければIDプレフィックスとして扱います:
   - 現在のスコープを検索（`SessionManager.list(cwd, sessionDir)`）
   - 見つからず、明示的な `sessionDir` がない場合、グローバル検索（`SessionManager.listAll()`）

クロスプロジェクトID一致の動作:

- 一致したセッションのcwdが現在のcwdと異なる場合、CLIは以下を確認します:
  - `Session found in different project ... Fork into current directory? [y/N]`
- yesの場合: `SessionManager.forkFrom(match.path, cwd, sessionDir)` が新しいローカルフォークファイルを作成します。
- no/非TTYデフォルトの場合: コマンドはエラーになります。

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. 現在のcwdのセッションディレクトリを解決します。
2. まずターミナルスコープのブレッドクラムを読み取ります。
3. 最も最近変更されたセッションファイルにフォールバックします。
4. 見つかったセッションを開きます。存在しない場合は新しいセッションを作成します。

これはスタートアップ時のみの動作です。インタラクティブな `/continue` スラッシュコマンドはありません。

## セッション切り替えが実際にランタイム状態を変更する方法

`AgentSession.switchSession(sessionPath)` は、再開系の操作で使用されるランタイム遷移を実行します:

1. `reason: "resume"` と `targetSessionFile` で `session_before_switch` を発行します（キャンセル可能）。
2. エージェントイベントサブスクリプションを切断し、実行中の作業を中止します。
3. キューに入っているステアリング/フォローアップ/次ターンメッセージをクリアします。
4. 現在のセッションマネージャーの書き込みをフラッシュします。
5. `sessionManager.setSessionFile(sessionPath)` を実行し、`agent.sessionId` を更新します。
6. 読み込まれたエントリからセッションコンテキストを構築します。
7. `reason: "resume"` で `session_switch` を発行します。
8. コンテキストからエージェントメッセージを置換します。
9. モデルを復元します（現在のレジストリで利用可能な場合）。
10. 思考レベルを復元または初期化します。
11. エージェントイベントサブスクリプションを再接続します。

`switchSession()` 自体は新しいセッションファイルを作成しません。

## イベント発行とキャンセルポイント

### 切り替え/フォークのライフサイクルフック

`newSession`、`fork`、`switchSession` の場合:

- Beforeイベント: `session_before_switch`
  - reason: `new`、`fork`、`resume`
  - `{ cancel: true }` を返すことでキャンセル可能
- Afterイベント: `session_switch`
  - 同じreasonセット
  - `previousSessionFile` を含む

`ExtensionRunner.emit()` は、最初のキャンセルするbeforeイベント結果で早期リターンします。

### カスタムツールの `onSession` 動作

SDKブリッジが拡張セッションイベントをカスタムツールの `onSession` コールバックに接続します:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

これらのコールバックは監視用であり、切り替え/フォークをキャンセルしません。

### このドキュメントに関連するその他のキャンセルサーフェス

- `/fork` はストリーミング中はブロックされます（ユーザーは現在のレスポンスを待つか中止する必要があります）。
- `/resume` セレクターはユーザーがセレクターを閉じることでキャンセルできます。
- クロスプロジェクトの `--resume <id>` はフォークプロンプトを拒否することでキャンセルできます。
- `/share` にはgistフローのUIアボートパス（`Share cancelled`）がありますが、このコードパスでは `gh gist create` に対するプロセスキルセマンティクスは接続されていません。

## 非永続（インメモリ）セッションの動作

セッションマネージャーが `SessionManager.inMemory()`（`--no-session`）で作成された場合:

- セッションファイルパスは存在しません。
- `/export` と `/share` は `Cannot export in-memory session to HTML` で失敗します（コマンドエラーUIに伝播）。
- `/fork` は `SessionManager.fork()` が永続性を必要とするため失敗します。
- `/dump` はインメモリのエージェント状態をシリアライズするため、引き続き動作します。
- `--no-session` が設定されている場合、マネージャー作成が即座にインメモリを返すため、CLI resume/continueセマンティクスはバイパスされます。

## 既知の実装上の注意点（現在のコード時点）

- `SelectorController.handleResumeSession()` は `session.switchSession(...)` のブール値の結果をチェックしません。フックでキャンセルされた切り替えでも、UI上の「Resumed session」再描画/ステータスパスを通過する可能性があります。
- `/share` のカスタム共有の失敗は、デフォルトのgistフォールバックには降格せず、エラーでコマンドを終了します。
- `/export` の引数トークン化は簡素であり、スペースを含むクォートされたパスを保持しません。
