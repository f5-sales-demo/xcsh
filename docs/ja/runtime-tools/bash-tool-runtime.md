---
title: Bashツールランタイム
description: シェルプロセス管理、サンドボックス、タイムアウト、出力ストリーミングを備えたBashツールランタイム。
sidebar:
  order: 1
  label: Bashツール
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bashツールランタイム

このドキュメントでは、エージェントのツール呼び出しで使用される**`bash`ツール**のランタイムパスについて、コマンドの正規化から実行、切り詰め/アーティファクト、レンダリングまでを説明します。

また、インタラクティブTUI、printモード、RPCモード、およびユーザー起動のbang（`!`）シェル実行において、動作が異なる箇所についても言及します。

## スコープとランタイムサーフェス

coding-agentには2つの異なるbash実行サーフェスがあります：

1. **ツール呼び出しサーフェス**（`toolName: "bash"`）：モデルがbashツールを呼び出す際に使用されます。
   - エントリポイント：`BashTool.execute()`。
2. **ユーザーbangコマンドサーフェス**（インタラクティブ入力からの`!cmd`またはRPC `bash`コマンド）：セッションレベルのヘルパーパス。
   - エントリポイント：`AgentSession.executeBash()`。

どちらも最終的に非PTY実行では`src/exec/bash-executor.ts`の`executeBash()`を使用しますが、ツール呼び出しパスのみが正規化/インターセプトおよびツールレンダラーロジックを実行します。

## エンドツーエンドのツール呼び出しパイプライン

## 1) 入力の正規化とパラメータマージ

`BashTool.execute()`はまず`normalizeBashCommand()`を通じて生のコマンドを正規化します：

- 末尾の`| head -n N`、`| head -N`、`| tail -n N`、`| tail -N`を構造化された制限値として抽出、
- 末尾/先頭の空白をトリム、
- 内部の空白はそのまま保持。

次に、抽出された制限値を明示的なツール引数とマージします：

- 明示的な`head`/`tail`引数は抽出された値をオーバーライド、
- 抽出された値はフォールバックとしてのみ使用。

### 注意事項

`bash-normalize.ts`のコメントでは`2>&1`の除去に言及していますが、現在の実装では除去されません。ランタイムの動作は依然として正しいです（stdout/stderrはすでにマージ済み）が、正規化の動作はコメントが示唆するよりも限定的です。

## 2) オプションのインターセプト（ブロックコマンドパス）

`bashInterceptor.enabled`がtrueの場合、`BashTool`は設定からルールを読み込み、正規化されたコマンドに対して`checkBashInterception()`を実行します。

インターセプトの動作：

- コマンドがブロックされるのは以下の**すべて**の条件を満たす場合のみ：
  - 正規表現ルールがマッチし、かつ
  - 提案されたツールが`ctx.toolNames`に存在する。
- 無効な正規表現ルールは暗黙的にスキップされる。
- ブロック時、`BashTool`は`ToolError`をスローし、メッセージは以下を含む：
  - `Blocked: ...`
  - 元のコマンドが含まれる。

デフォルトのルールパターン（コード内で定義）は、一般的な誤用を対象としています：

- ファイルリーダー（`cat`、`head`、`tail`、...）
- 検索ツール（`grep`、`rg`、...）
- ファイルファインダー（`find`、`fd`、...）
- インプレースエディタ（`sed -i`、`perl -i`、`awk -i inplace`）
- シェルリダイレクト書き込み（`echo ... > file`、ヒアドキュメントリダイレクション）

### 注意事項

`InterceptionResult`には`suggestedTool`が含まれていますが、`BashTool`は現在メッセージテキストのみを表面化します（`details`に構造化されたsuggestedToolフィールドはありません）。

## 3) CWDの検証とタイムアウトのクランプ

`cwd`はセッションのcwd（`resolveToCwd`）を基準に解決され、`stat`で検証されます：

- パスが存在しない場合 -> `ToolError("Working directory does not exist: ...")`
- ディレクトリでない場合 -> `ToolError("Working directory is not a directory: ...")`

タイムアウトは`[1, 3600]`秒の範囲にクランプされ、ミリ秒に変換されます。

## 4) アーティファクトの割り当て

実行前に、ツールは切り詰められた出力を保存するためのアーティファクトパス/IDをベストエフォートで割り当てます。

- アーティファクトの割り当て失敗は致命的ではありません（アーティファクトスピルファイルなしで実行が継続される）、
- アーティファクトID/パスは、切り詰め時の完全な出力の永続化のために実行パスに渡されます。

## 5) PTYと非PTYの実行選択

`BashTool`は以下のすべてが真の場合にのみPTY実行を選択します：

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- ツールコンテキストにUIがある（`ctx.hasUI === true`かつ`ctx.ui`が設定されている）

それ以外の場合は非インタラクティブな`executeBash()`を使用します。

つまり、printモードおよび非UI RPC/ツールコンテキストは常に非PTYを使用します。

## 非インタラクティブ実行エンジン（`executeBash`）

## シェルセッション再利用モデル

`executeBash()`はネイティブの`Shell`インスタンスを以下のキーでプロセスグローバルマップにキャッシュします：

- シェルパス、
- 設定されたコマンドプレフィックス、
- スナップショットパス、
- シリアライズされたシェル環境変数、
- オプションのエージェントセッションキー。

セッションレベルの実行では、`AgentSession.executeBash()`が`sessionKey: this.sessionId`を渡し、セッションごとに再利用を分離します。

ツール呼び出しパスは`sessionKey`を渡さ**ない**ため、再利用スコープはシェル設定/スナップショット/環境変数に基づきます。

## シェル設定とスナップショットの動作

各呼び出し時に、エグゼキュータは設定のシェル構成（`shell`、`env`、オプションの`prefix`）を読み込みます。

選択されたシェルに`bash`が含まれている場合、`getOrCreateSnapshot()`を試行します：

- スナップショットはユーザーrcからエイリアス/関数/オプションをキャプチャ、
- スナップショット作成はベストエフォート、
- 失敗した場合はスナップショットなしにフォールバック。

`prefix`が設定されている場合、コマンドは以下のようになります：

```text
<prefix> <command>
```

## ストリーミングとキャンセル

`Shell.run()`はチャンクをコールバックにストリーミングします。エグゼキュータは各チャンクを`OutputSink`とオプションの`onChunk`コールバックにパイプします。

キャンセル：

- abortされたシグナルは`shellSession.abort(...)`をトリガー、
- ネイティブ結果からのタイムアウトは`cancelled: true` + アノテーションテキストにマッピング、
- 明示的なキャンセルも同様に`cancelled: true` + アノテーションを返す。

タイムアウト/キャンセルに対してエグゼキュータ内で例外はスローされません。構造化された`BashResult`を返し、呼び出し側がエラーセマンティクスをマッピングします。

## インタラクティブPTYパス（`runInteractiveBashPty`）

PTYが有効な場合、ツールは`runInteractiveBashPty()`を実行し、オーバーレイコンソールコンポーネントを開いてネイティブの`PtySession`を駆動します。

動作のハイライト：

- xterm-headless仮想端末がオーバーレイでビューポートをレンダリング、
- キーボード入力は正規化される（Kittyシーケンスやアプリケーションカーソルモード処理を含む）、
- 実行中の`esc`はPTYセッションを終了、
- ターミナルリサイズはPTYに伝播（`session.resize(cols, rows)`）。

無人実行のための環境ハードニングデフォルトが注入されます：

- ページャー無効化（`PAGER=cat`、`GIT_PAGER=cat`など）、
- エディタプロンプト無効化（`GIT_EDITOR=true`、`EDITOR=true`、...）、
- ターミナル/認証プロンプトの削減（`GIT_TERMINAL_PROMPT=0`、`SSH_ASKPASS=/usr/bin/false`、`CI=1`）、
- パッケージマネージャー/ツールの非インタラクティブ動作用自動化フラグ。

PTY出力は正規化（`CRLF`/`CR`を`LF`に変換、`sanitizeText`）され、アーティファクトスピルサポートを含めて`OutputSink`に書き込まれます。

PTYの起動/ランタイムエラー時、シンクは`PTY error: ...`行を受信し、コマンドは未定義の終了コードで完了します。

## 出力処理：ストリーミング、切り詰め、アーティファクトスピル

PTYと非PTYの両方のパスで`OutputSink`を使用します。

## OutputSinkのセマンティクス

- メモリ内のUTF-8安全なテールバッファを保持（`DEFAULT_MAX_BYTES`、現在50KB）、
- 処理されたバイト数/行数の合計を追跡、
- アーティファクトパスが存在し出力がオーバーフロー（またはファイルがすでにアクティブ）した場合、完全なストリームをアーティファクトファイルに書き込み、
- メモリ閾値がオーバーフローした場合、メモリ内バッファをテールにトリム（UTF-8境界安全）、
- オーバーフロー/ファイルスピル発生時に`truncated`をマーク。

`dump()`は以下を返します：

- `output`（アノテーション付きプレフィックスの場合あり）、
- `truncated`、
- `totalLines/totalBytes`、
- `outputLines/outputBytes`、
- アーティファクトファイルがアクティブだった場合の`artifactId`。

### 長い出力に関する注意事項

ランタイムの切り詰めは`OutputSink`内でバイト閾値ベース（デフォルト50KB）です。このコードパスでは2000行のハード制限は適用されません。

## ライブツール更新

非PTY実行の場合、`BashTool`は部分的な更新用に別の`TailBuffer`を使用し、コマンド実行中に`onUpdate`スナップショットを発行します。

PTY実行の場合、ライブレンダリングはカスタムUIオーバーレイによって処理され、`onUpdate`テキストチャンクではありません。

## 結果の整形、メタデータ、エラーマッピング

実行後：

1. `cancelled`の処理：
   - abortシグナルがabortされている場合 -> `ToolAbortError`をスロー（abort セマンティクス）、
   - それ以外 -> `ToolError`をスロー（ツール失敗として扱われる）。
2. PTYの`timedOut` -> `ToolError`をスロー。
3. 最終出力テキストにhead/tailフィルターを適用（`applyHeadTail`、headの後にtail）。
4. 空の出力は`(no output)`になる。
5. `toolResult(...).truncationFromSummary(result, { direction: "tail" })`で切り詰めメタデータを付加。
6. 終了コードのマッピング：
   - 終了コードがない場合 -> `ToolError("... missing exit status")`
   - 非ゼロの終了 -> `ToolError("... Command exited with code N")`
   - ゼロの終了 -> 成功結果。

成功ペイロードの構造：

- `content`：テキスト出力、
- 切り詰め時の`details.meta.truncation`、以下を含む：
  - `direction`、`truncatedBy`、合計/出力の行数+バイト数、
  - `shownRange`、
  - 利用可能な場合の`artifactId`。

組み込みツールは`wrapToolWithMetaNotice()`でラップされているため、切り詰め通知テキストは最終テキストコンテンツに自動的に追加されます（例：`Full: artifact://<id>`）。

## レンダリングパス

## ツール呼び出しレンダラー（`bashToolRenderer`）

`bashToolRenderer`はツール呼び出しメッセージ（`toolCall` / `toolResult`）に使用されます：

- 折りたたみモードでは、視覚的な行切り詰めプレビューを表示、
- 展開モードでは、現在利用可能なすべての出力テキストを表示、
- 警告行には切り詰め理由と切り詰め時の`artifact://<id>`を含む、
- タイムアウト値（引数から取得）はフッターのメタデータ行に表示。

### 注意事項：完全なアーティファクト展開

`BashRenderContext`には`isFullOutput`がありますが、現在のレンダラーコンテキストビルダーはbashツール結果に対してこれを設定しません。別の呼び出し元が完全なアーティファクトコンテンツを提供しない限り、展開ビューでは結果コンテンツ内のテキスト（テール/切り詰め出力）が引き続き使用されます。

## ユーザーbangコマンドコンポーネント（`BashExecutionComponent`）

`BashExecutionComponent`はインタラクティブモードでのユーザー`!`コマンド用です（モデルのツール呼び出しではありません）：

- チャンクをライブでストリーミング、
- 折りたたみプレビューは最後の20論理行を保持、
- 1行あたり4000文字で行クランプ、
- メタデータが存在する場合、切り詰め + アーティファクト警告を表示、
- キャンセル/エラー/終了状態を個別にマーク。

このコンポーネントは`CommandController.handleBashCommand()`によって接続され、`AgentSession.executeBash()`からデータが供給されます。

## モード固有の動作の違い

| サーフェス                     | エントリパス                                            | PTY対象                                                              | ライブ出力UX                                                              | エラーの表面化                                    |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| インタラクティブツール呼び出し   | `BashTool.execute`                                    | はい、`bash.virtualTerminal=on`かつUIが存在し`PI_NO_PTY!=1`の場合      | PTYオーバーレイ（インタラクティブ）またはストリーミングテール更新              | ツールエラーは`toolResult.isError`になる            |
| printモードツール呼び出し       | `BashTool.execute`                                    | いいえ（UIコンテキストなし）                                           | TUIオーバーレイなし；出力はイベントストリーム/最終アシスタントテキストフローに表示 | 同じツールエラーマッピング                          |
| RPCツール呼び出し（エージェントツーリング） | `BashTool.execute`                              | 通常UIなし -> 非PTY                                                   | 構造化されたツールイベント/結果                                             | 同じツールエラーマッピング                          |
| インタラクティブbangコマンド（`!`）| `AgentSession.executeBash` + `BashExecutionComponent` | いいえ（エグゼキュータを直接使用）                                      | 専用のbash実行コンポーネント                                               | コントローラーが例外をキャッチしUIエラーを表示        |
| RPC `bash`コマンド              | `rpc-mode` -> `session.executeBash`                   | いいえ                                                               | `BashResult`を直接返す                                                    | コンシューマーが返されたフィールドを処理              |

## 運用上の注意事項

- インターセプターは、提案されたツールが現在のコンテキストで利用可能な場合にのみコマンドをブロックします。
- アーティファクトの割り当てが失敗した場合でも切り詰めは発生しますが、`artifact://`の逆参照は利用できません。
- シェルセッションキャッシュにはこのモジュール内で明示的なエビクションがありません。ライフタイムはプロセススコープです。
- PTYと非PTYのタイムアウトサーフェスは異なります：
  - PTYは明示的な`timedOut`結果フィールドを公開、
  - 非PTYはタイムアウトを`cancelled + annotation`サマリーにマッピング。

## 実装ファイル

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — ツールエントリポイント、正規化/インターセプト、PTY/非PTY選択、結果/エラーマッピング、bashツールレンダラー。
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — コマンド正規化と実行後のhead/tailフィルタリング。
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — インターセプタールールマッチングとブロックコマンドメッセージ。
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — 非PTYエグゼキュータ、シェルセッション再利用、キャンセル接続、出力シンク統合。
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTYランタイム、オーバーレイUI、入力正規化、非インタラクティブ環境デフォルト。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink`の切り詰め/アーティファクトスピルとサマリーメタデータ。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — アーティファクト割り当てヘルパーとストリーミングテールバッファ。
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — 切り詰めメタデータの形状 + 通知注入ラッパー。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — セッションレベルの`executeBash`、メッセージ記録、abortライフサイクル。
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — インタラクティブ`!`コマンド実行コンポーネント。
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — インタラクティブ`!`コマンドUIストリーム/更新完了の接続。
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash`および`abort_bash`コマンドサーフェス。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>`の解決。
