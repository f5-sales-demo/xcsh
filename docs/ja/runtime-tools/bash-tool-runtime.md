---
title: Bash ツールランタイム
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Bash ツール
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash ツールランタイム

このドキュメントでは、エージェントのツール呼び出しで使用される **`bash` ツール** のランタイムパスについて、コマンドの正規化から実行、切り詰め/アーティファクト、レンダリングまでを説明します。

また、インタラクティブ TUI、プリントモード、RPC モード、およびユーザーが開始するバン（`!`）シェル実行でビヘイビアが分岐する箇所についても言及します。

## スコープとランタイムサーフェス

coding-agent には2つの異なる bash 実行サーフェスがあります：

1. **ツール呼び出しサーフェス**（`toolName: "bash"`）：モデルが bash ツールを呼び出す際に使用されます。
   - エントリポイント：`BashTool.execute()`。
2. **ユーザーバンコマンドサーフェス**（インタラクティブ入力からの `!cmd` または RPC `bash` コマンド）：セッションレベルのヘルパーパスです。
   - エントリポイント：`AgentSession.executeBash()`。

両方とも最終的に非 PTY 実行のために `src/exec/bash-executor.ts` の `executeBash()` を使用しますが、正規化/インターセプトおよびツールレンダラーロジックを実行するのはツール呼び出しパスのみです。

## エンドツーエンドのツール呼び出しパイプライン

## 1) 入力の正規化とパラメータマージ

`BashTool.execute()` はまず `normalizeBashCommand()` を介して生のコマンドを正規化します：

- 末尾の `| head -n N`、`| head -N`、`| tail -n N`、`| tail -N` を構造化されたリミットとして抽出します。
- 末尾/先頭の空白をトリムします。
- 内部の空白はそのまま保持します。

次に、抽出されたリミットを明示的なツール引数とマージします：

- 明示的な `head`/`tail` 引数は抽出された値をオーバーライドします。
- 抽出された値はフォールバックとしてのみ使用されます。

### 注意事項

`bash-normalize.ts` のコメントでは `2>&1` の削除について言及していますが、現在の実装では削除していません。ランタイムのビヘイビアは依然として正しいです（stdout/stderr はすでにマージされています）が、正規化のビヘイビアはコメントが示すよりも狭い範囲です。

## 2) オプションのインターセプト（ブロックコマンドパス）

`bashInterceptor.enabled` が true の場合、`BashTool` は設定からルールを読み込み、正規化されたコマンドに対して `checkBashInterception()` を実行します。

インターセプトのビヘイビア：

- コマンドがブロックされるのは、以下の **両方の** 条件を満たす場合のみです：
  - 正規表現ルールがマッチし、かつ
  - 提案されたツールが `ctx.toolNames` に存在する。
- 無効な正規表現ルールはサイレントにスキップされます。
- ブロック時、`BashTool` は以下のメッセージで `ToolError` をスローします：
  - `Blocked: ...`
  - 元のコマンドが含まれます。

デフォルトのルールパターン（コード内で定義）は一般的な誤用を対象としています：

- ファイルリーダー（`cat`、`head`、`tail`、...）
- 検索ツール（`grep`、`rg`、...）
- ファイルファインダー（`find`、`fd`、...）
- インプレースエディタ（`sed -i`、`perl -i`、`awk -i inplace`）
- シェルリダイレクト書き込み（`echo ... > file`、ヒアドキュメントリダイレクション）

### 注意事項

`InterceptionResult` には `suggestedTool` が含まれていますが、`BashTool` は現在メッセージテキストのみを表示します（`details` に構造化された suggested-tool フィールドはありません）。

## 3) CWD の検証とタイムアウトのクランプ

`cwd` はセッション cwd に対して相対的に解決（`resolveToCwd`）され、`stat` で検証されます：

- パスが存在しない場合 -> `ToolError("Working directory does not exist: ...")`
- ディレクトリでない場合 -> `ToolError("Working directory is not a directory: ...")`

タイムアウトは `[1, 3600]` 秒にクランプされ、ミリ秒に変換されます。

## 4) アーティファクトの割り当て

実行前に、ツールは切り詰められた出力の保存用にアーティファクトパス/ID をベストエフォートで割り当てます。

- アーティファクト割り当ての失敗は致命的ではありません（アーティファクトスピルファイルなしで実行が継続されます）。
- アーティファクト ID/パスは、切り詰め時の完全な出力の永続化のために実行パスに渡されます。

## 5) PTY vs 非 PTY の実行選択

`BashTool` は以下のすべてが true の場合にのみ PTY 実行を選択します：

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- ツールコンテキストに UI がある（`ctx.hasUI === true` かつ `ctx.ui` が設定されている）

それ以外の場合は非インタラクティブの `executeBash()` を使用します。

つまり、プリントモードおよび非 UI の RPC/ツールコンテキストは常に非 PTY を使用します。

## 非インタラクティブ実行エンジン（`executeBash`）

## シェルセッションの再利用モデル

`executeBash()` はネイティブの `Shell` インスタンスを以下をキーとするプロセスグローバルマップにキャッシュします：

- シェルパス、
- 設定されたコマンドプレフィックス、
- スナップショットパス、
- シリアライズされたシェル環境変数、
- オプションのエージェントセッションキー。

セッションレベルの実行では、`AgentSession.executeBash()` が `sessionKey: this.sessionId` を渡し、セッションごとに再利用を分離します。

ツール呼び出しパスは `sessionKey` を渡さ **ない** ため、再利用スコープはシェル設定/スナップショット/環境変数に基づきます。

## シェル設定とスナップショットのビヘイビア

各呼び出し時に、エグゼキュータは設定のシェル構成（`shell`、`env`、オプションの `prefix`）を読み込みます。

選択されたシェルに `bash` が含まれている場合、`getOrCreateSnapshot()` を試行します：

- スナップショットはユーザー rc からエイリアス/関数/オプションをキャプチャします。
- スナップショットの作成はベストエフォートです。
- 失敗した場合はスナップショットなしにフォールバックします。

`prefix` が設定されている場合、コマンドは以下のようになります：

```text
<prefix> <command>
```

## ストリーミングとキャンセル

`Shell.run()` はチャンクをコールバックにストリーミングします。エグゼキュータは各チャンクを `OutputSink` およびオプションの `onChunk` コールバックにパイプします。

キャンセル：

- アボートシグナルが `shellSession.abort(...)` をトリガーします。
- ネイティブ結果からのタイムアウトは `cancelled: true` + アノテーションテキストにマッピングされます。
- 明示的なキャンセルも同様に `cancelled: true` + アノテーションを返します。

タイムアウト/キャンセルに対してエグゼキュータ内部で例外はスローされません。構造化された `BashResult` を返し、呼び出し元がエラーセマンティクスをマッピングします。

## インタラクティブ PTY パス（`runInteractiveBashPty`）

PTY が有効な場合、ツールは `runInteractiveBashPty()` を実行し、オーバーレイコンソールコンポーネントを開いてネイティブの `PtySession` を駆動します。

ビヘイビアのハイライト：

- xterm-headless 仮想ターミナルがオーバーレイでビューポートをレンダリングします。
- キーボード入力は正規化されます（Kitty シーケンスおよびアプリケーションカーソルモードの処理を含む）。
- 実行中の `esc` は PTY セッションを終了します。
- ターミナルリサイズは PTY に伝播されます（`session.resize(cols, rows)`）。

無人実行向けに環境のハードニングデフォルトが注入されます：

- ページャーの無効化（`PAGER=cat`、`GIT_PAGER=cat` など）、
- エディタプロンプトの無効化（`GIT_EDITOR=true`、`EDITOR=true` ...）、
- ターミナル/認証プロンプトの抑制（`GIT_TERMINAL_PROMPT=0`、`SSH_ASKPASS=/usr/bin/false`、`CI=1`）、
- パッケージマネージャー/ツールの非インタラクティブビヘイビア用自動化フラグ。

PTY 出力は正規化され（`CRLF`/`CR` を `LF` に変換、`sanitizeText`）、アーティファクトスピルサポートを含めて `OutputSink` に書き込まれます。

PTY の起動/ランタイムエラー時、シンクは `PTY error: ...` 行を受け取り、コマンドは未定義の終了コードで完了します。

## 出力処理：ストリーミング、切り詰め、アーティファクトスピル

PTY と非 PTY の両方のパスが `OutputSink` を使用します。

## OutputSink のセマンティクス

- メモリ内の UTF-8 セーフなテールバッファを保持します（`DEFAULT_MAX_BYTES`、現在 50KB）。
- 参照された合計バイト数/行数を追跡します。
- アーティファクトパスが存在し、出力がオーバーフローする（またはファイルがすでにアクティブな）場合、完全なストリームをアーティファクトファイルに書き込みます。
- メモリしきい値がオーバーフローした場合、メモリ内バッファを末尾にトリムします（UTF-8 境界セーフ）。
- オーバーフロー/ファイルスピルが発生した場合に `truncated` をマークします。

`dump()` は以下を返します：

- `output`（アノテーション付きプレフィックスの可能性あり）、
- `truncated`、
- `totalLines/totalBytes`、
- `outputLines/outputBytes`、
- アーティファクトファイルがアクティブな場合の `artifactId`。

### 長い出力に関する注意事項

ランタイムの切り詰めは `OutputSink` 内のバイトしきい値ベースです（デフォルト 50KB）。このコードパスでは2000行のハードキャップは強制されません。

## ライブツール更新

非 PTY 実行では、`BashTool` はパーシャル更新用に別の `TailBuffer` を使用し、コマンド実行中に `onUpdate` スナップショットを発行します。

PTY 実行では、ライブレンダリングはカスタム UI オーバーレイによって処理され、`onUpdate` テキストチャンクによるものではありません。

## 結果の整形、メタデータ、エラーマッピング

実行後：

1. `cancelled` の処理：
   - アボートシグナルがアボートされた場合 -> `ToolAbortError` をスロー（アボートセマンティクス）。
   - それ以外 -> `ToolError` をスロー（ツール失敗として扱われる）。
2. PTY の `timedOut` -> `ToolError` をスロー。
3. 最終出力テキストに head/tail フィルターを適用（`applyHeadTail`、head の後に tail）。
4. 空の出力は `(no output)` になります。
5. `toolResult(...).truncationFromSummary(result, { direction: "tail" })` を介して切り詰めメタデータを付加します。
6. 終了コードのマッピング：
   - 終了コードがない場合 -> `ToolError("... missing exit status")`
   - 非ゼロの終了 -> `ToolError("... Command exited with code N")`
   - ゼロの終了 -> 成功結果。

成功時のペイロード構造：

- `content`：テキスト出力、
- 切り詰め時の `details.meta.truncation`、以下を含む：
  - `direction`、`truncatedBy`、合計/出力の行数+バイト数、
  - `shownRange`、
  - 利用可能な場合の `artifactId`。

ビルトインツールは `wrapToolWithMetaNotice()` でラップされているため、切り詰め通知テキストは最終テキストコンテンツに自動的に追加されます（例：`Full: artifact://<id>`）。

## レンダリングパス

## ツール呼び出しレンダラー（`bashToolRenderer`）

`bashToolRenderer` はツール呼び出しメッセージ（`toolCall` / `toolResult`）に使用されます：

- 折りたたみモードでは視覚的行切り詰めのプレビューを表示します。
- 展開モードでは現在利用可能な全出力テキストを表示します。
- 警告行には切り詰め理由と、切り詰め時の `artifact://<id>` が含まれます。
- タイムアウト値（引数から）はフッターのメタデータ行に表示されます。

### 注意事項：完全なアーティファクト展開

`BashRenderContext` には `isFullOutput` がありますが、現在のレンダラーコンテキストビルダーは bash ツールの結果に対してこれを設定しません。展開ビューは、別の呼び出し元が完全なアーティファクトコンテンツを提供しない限り、結果コンテンツ内のテキスト（末尾/切り詰め出力）をそのまま使用します。

## ユーザーバンコマンドコンポーネント（`BashExecutionComponent`）

`BashExecutionComponent` はインタラクティブモードでのユーザー `!` コマンド用です（モデルのツール呼び出しではありません）：

- チャンクをリアルタイムでストリーミングします。
- 折りたたみプレビューは最後の20論理行を保持します。
- 1行あたり4000文字で行クランプします。
- メタデータが存在する場合、切り詰め + アーティファクトの警告を表示します。
- キャンセル/エラー/終了状態を個別にマークします。

このコンポーネントは `CommandController.handleBashCommand()` によってワイヤリングされ、`AgentSession.executeBash()` からフィードされます。

## モード固有のビヘイビアの違い

| サーフェス | エントリパス | PTY 対象 | ライブ出力 UX | エラーの表示 |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| インタラクティブツール呼び出し | `BashTool.execute` | はい、`bash.virtualTerminal=on` かつ UI が存在し `PI_NO_PTY!=1` の場合 | PTY オーバーレイ（インタラクティブ）またはストリーミングテール更新 | ツールエラーは `toolResult.isError` になる |
| プリントモードツール呼び出し | `BashTool.execute` | いいえ（UI コンテキストなし） | TUI オーバーレイなし。出力はイベントストリーム/最終アシスタントテキストフローに表示 | 同じツールエラーマッピング |
| RPC ツール呼び出し（エージェントツーリング） | `BashTool.execute` | 通常 UI なし -> 非 PTY | 構造化されたツールイベント/結果 | 同じツールエラーマッピング |
| インタラクティブバンコマンド（`!`） | `AgentSession.executeBash` + `BashExecutionComponent` | いいえ（エグゼキュータを直接使用） | 専用の bash 実行コンポーネント | コントローラーが例外をキャッチし UI エラーを表示 |
| RPC `bash` コマンド | `rpc-mode` -> `session.executeBash` | いいえ | `BashResult` を直接返す | コンシューマーが返されたフィールドを処理 |

## 運用上の注意事項

- インターセプターは、提案されたツールがコンテキストで現在利用可能な場合にのみコマンドをブロックします。
- アーティファクトの割り当てが失敗した場合、切り詰めは依然として発生しますが、`artifact://` の逆参照は利用できません。
- シェルセッションキャッシュにはこのモジュール内で明示的な退避がありません。ライフタイムはプロセススコープです。
- PTY と非 PTY のタイムアウトサーフェスは異なります：
  - PTY は明示的な `timedOut` 結果フィールドを公開します。
  - 非 PTY はタイムアウトを `cancelled + annotation` サマリーにマッピングします。

## 実装ファイル

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — ツールエントリポイント、正規化/インターセプト、PTY/非 PTY 選択、結果/エラーマッピング、bash ツールレンダラー。
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — コマンドの正規化と実行後の head/tail フィルタリング。
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — インターセプタールールマッチングとブロックコマンドメッセージ。
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — 非 PTY エグゼキュータ、シェルセッション再利用、キャンセルワイヤリング、出力シンク統合。
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY ランタイム、オーバーレイ UI、入力正規化、非インタラクティブ環境デフォルト。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` の切り詰め/アーティファクトスピルとサマリーメタデータ。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — アーティファクト割り当てヘルパーとストリーミングテールバッファ。
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — 切り詰めメタデータの形状 + 通知注入ラッパー。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — セッションレベルの `executeBash`、メッセージ記録、アボートライフサイクル。
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — インタラクティブ `!` コマンド実行コンポーネント。
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — インタラクティブ `!` コマンドの UI ストリーム/更新完了のワイヤリング。
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash` および `abort_bash` コマンドサーフェス。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>` の解決。
