---
title: セッション切り替えと最近のセッション一覧
description: セッション切り替えの仕組みと、検索・フィルタリング機能を備えた最近のセッション一覧表示。
sidebar:
  order: 4
  label: 切り替えと最近のセッション
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# セッション切り替えと最近のセッション一覧

このドキュメントでは、coding-agent が最近のセッションを検出し、`--resume` ターゲットを解決し、セッションピッカーを表示し、アクティブなランタイムセッションを切り替える方法について説明します。

現在の実装の動作に焦点を当てており、フォールバックパスや注意事項も含みます。

## 実装ファイル

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## 最近のセッションの検出

### ディレクトリスコープ

`SessionManager` はデフォルトで cwd スコープのディレクトリにセッションを保存します：

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` は、明示的な `sessionDir` が提供されない限り、そのディレクトリのみを読み取ります。

### ペイロードが異なる2つの一覧取得パイプライン

2つの異なる一覧取得パイプラインがあります：

1. `getRecentSessions(sessionDir, limit)`（ウェルカム/サマリービュー）
   - 各ファイルから 4KB のプレフィックス（`readTextPrefix(..., 4096)`）のみを読み取ります。
   - ヘッダーと最初のユーザーテキストプレビューを解析します。
   - 遅延評価の `name` と `timeAgo` ゲッターを持つ軽量な `RecentSessionInfo` を返します。
   - ファイルの `mtime` 降順でソートします。

2. `SessionManager.list(...)` / `SessionManager.listAll()`（再開ピッカーと ID マッチング）
   - セッションファイル全体を読み取ります。
   - `SessionInfo` オブジェクト（`id`、`cwd`、`title`、`messageCount`、`firstMessage`、`allMessagesText`、タイムスタンプ）を構築します。
   - `message` エントリがゼロのセッションは除外します。
   - `modified` 降順でソートします。

### メタデータのフォールバック動作

最近のサマリー（`RecentSessionInfo`）の場合：

- 表示名の優先順位：`header.title` -> 最初のユーザープロンプト -> `header.id` -> ファイル名
- コンパクト表示では名前は 40 文字に切り詰められます
- タイトル由来の名前から制御文字/改行は除去/サニタイズされます

`SessionInfo` の一覧エントリの場合：

- `title` は `header.title` または最新のコンパクション `shortSummary` です
- `firstMessage` は最初のユーザーメッセージテキストまたは `"(no messages)"` です

## `--continue` の解決とターミナルブレッドクラムの優先

`SessionManager.continueRecent(cwd, sessionDir?)` は以下の順序でターゲットを解決します：

1. ターミナルスコープのブレッドクラムを読み取る（`~/.xcsh/agent/terminal-sessions/<terminal-id>`）
2. ブレッドクラムを検証する：
   - 現在のターミナルが識別可能であること
   - ブレッドクラムの cwd が現在の cwd と一致すること（解決済みパスの比較）
   - 参照されているファイルがまだ存在すること
3. ブレッドクラムが無効/存在しない場合、セッションディレクトリ内の mtime が最新のファイルにフォールバック（`findMostRecentSession`）
4. 見つからない場合、新しいセッションを作成

ターミナル ID の導出は TTY パスを優先し、環境変数ベースの識別子（`KITTY_WINDOW_ID`、`TMUX_PANE`、`TERM_SESSION_ID`、`WT_SESSION`）にフォールバックします。

ブレッドクラムの書き込みはベストエフォートであり、致命的ではありません。

## 起動時の再開ターゲット解決（`main.ts`）

### `--resume <value>`

`createSessionManager(...)` は文字列値の `--resume` を2つのモードで処理します：

1. パス風の値（`/`、`\\` を含む、または `.jsonl` で終わる）
   - `SessionManager.open(sessionArg, parsed.sessionDir)` で直接オープン

2. ID プレフィックス値
   - `SessionManager.list(cwd, sessionDir)` で `id.startsWith(sessionArg)` による一致を検索
   - ローカルに一致がなく `sessionDir` が強制されていない場合、`SessionManager.listAll()` を試行
   - 最初の一致が使用されます（曖昧さの解消プロンプトなし）

クロスプロジェクトの一致動作：

- 一致したセッションの cwd が現在の cwd と異なる場合、CLI は現在のプロジェクトにフォークするかどうかをプロンプトします
- はい -> `SessionManager.forkFrom(...)`
- いいえ -> エラーをスロー（`Session "..." is in another project (...)`）

一致なし -> エラーをスロー（`Session "..." not found.`）。

### `--resume`（値なし）

初期のセッションマネージャー構築後に処理されます：

1. `SessionManager.list(cwd, parsed.sessionDir)` でローカルセッションを一覧取得
2. 空の場合：`No sessions found` を表示して早期終了
3. TUI ピッカーを開く（`selectSession`）
4. キャンセルされた場合：`No session selected` を表示して早期終了
5. 選択された場合：`SessionManager.open(selectedPath)`

### `--continue`

`SessionManager.continueRecent(...)` を直接使用します（上記のブレッドクラム優先の動作）。

## ピッカーベースの選択の内部構造

## CLI ピッカー（`src/cli/session-picker.ts`）

`selectSession(sessions)` は `SessionSelectorComponent` を持つスタンドアロン TUI を作成し、正確に1回だけ解決します：

- 選択 -> 選択されたパスで解決
- キャンセル（Esc）-> `null` で解決
- 強制終了（Ctrl+C パス）-> TUI を停止して `process.exit(0)`

## インタラクティブなセッション内ピッカー（`SelectorController.showSessionSelector`）

フロー：

1. `SessionManager.list(currentCwd, currentSessionDir)` で現在のセッションディレクトリからセッションを取得
2. エディターエリアに `SessionSelectorComponent` をマウント（`showSelector(...)` を使用）
3. コールバック：
   - 選択 -> セレクターを閉じて `handleResumeSession(sessionPath)` を呼び出す
   - キャンセル -> エディターを復元してリレンダリング
   - 終了 -> `ctx.shutdown()`

## セッションセレクターコンポーネントの動作

`SessionList` がサポートする機能：

- 矢印/ページナビゲーション
- Enter で選択
- Esc でキャンセル
- Ctrl+C で終了
- セッション id/title/cwd/最初のメッセージ/全メッセージ/パスを横断したファジー検索

空のリストのレンダリング動作：

- クラッシュする代わりにメッセージを表示
- 空の状態で Enter を押しても何も起きない（コールバックなし）
- Esc/Ctrl+C は引き続き動作

注意事項：UI テキストには `Press Tab to view all` と表示されますが、このコンポーネントには現在 Tab ハンドラーがなく、現在の配線では現在のスコープのセッションのみを一覧表示します。

## ランタイム切り替えの実行（`AgentSession.switchSession`）

`switchSession(sessionPath)` はプロセス内切り替えの中核パスです。

ライフサイクル/状態遷移：

1. `previousSessionFile` をキャプチャ
2. `session_before_switch` フックイベントを発行（`reason: "resume"`、キャンセル可能）
3. キャンセルされた場合 -> 切り替えなしで `false` を返す
4. 現在のエージェントイベントストリームから切断
5. アクティブな生成/ツールフローを中止
6. キューに入っているステアリング/フォローアップ/次ターンのメッセージバッファをクリア
7. セッションライターをフラッシュ（`sessionManager.flush()`）して保留中の書き込みを永続化
8. `sessionManager.setSessionFile(sessionPath)`
   - セッションファイルポインターを更新
   - ターミナルブレッドクラムを書き込み
   - エントリの読み込み / マイグレーション / blob 解決 / 再インデックスを実行
   - ファイルデータが欠落/無効な場合：そのパスで新しいセッションを初期化してヘッダーを書き換え
9. `agent.sessionId` を更新
10. `buildSessionContext()` でコンテキストを再構築
11. `session_switch` フックイベントを発行（`reason: "resume"`、`previousSessionFile`）
12. エージェントメッセージを再構築されたコンテキストで置き換え
13. `sessionContext.models.default` が利用可能でモデルレジストリに存在する場合、デフォルトモデルを復元
14. thinking レベルを復元：
    - ブランチに既に `thinking_level_change` がある場合、保存されたセッションレベルを適用
    - それ以外の場合、設定からデフォルトの thinking レベルを導出し、モデルの機能に合わせてクランプして設定し、新しい `thinking_level_change` エントリを追加
15. エージェントリスナーを再接続して `true` を返す

## インタラクティブ切り替え後の UI 状態の再構築

`SelectorController.handleResumeSession` は `switchSession` の前後で UI リセットを実行します：

- ローディングアニメーションを停止
- ステータスコンテナをクリア
- 保留中のメッセージ UI と保留中のツールマップをクリア
- ストリーミングコンポーネント/メッセージ参照をリセット
- `session.switchSession(...)` を呼び出す
- チャットコンテナをクリアしてセッションコンテキストからリレンダリング（`renderInitialMessages`）
- 新しいセッションのアーティファクトから todo をリロード
- `Resumed session` を表示

したがって、表示される会話/todo の状態は新しいセッションファイルから再構築されます。

## 起動時の再開とセッション内切り替えの比較

### 起動時の再開（`--continue`、`--resume`、直接オープン）

- セッションファイルは `createAgentSession(...)` の前に選択されます。
- `sdk.ts` が `existingSession = sessionManager.buildSessionContext()` を構築します。
- エージェントメッセージはセッション作成時に一度だけ復元されます。
- モデル/thinking は作成時に選択されます（復元/フォールバックロジックを含む）。
- その後、インタラクティブモードが `#restoreModeFromSession()` を実行して永続化されたモード状態（現在は plan/plan_paused）に再入します。

### セッション内切り替え（`/resume` スタイルのセレクターパス）

- 既に実行中の `AgentSession` 上で `AgentSession.switchSession(...)` を使用します。
- メッセージ/モデル/thinking はその場で即座に再構築されます。
- フック `session_before_switch`/`session_switch` イベントが発行されます。
- UI のチャット/todo がリフレッシュされます。
- セレクターフローでは専用の切り替え後モード復元呼び出しは行われません。モード再入の動作は起動時の `#restoreModeFromSession()` と対称的ではありません。

## 失敗およびエッジケースの動作

### キャンセルパス

- CLI ピッカーのキャンセル -> `null` を返し、呼び出し元が `No session selected` を表示、プロセスが早期終了。
- インタラクティブピッカーのキャンセル -> エディターが復元され、セッション変更なし。
- フックのキャンセル（`session_before_switch`）-> `switchSession()` が `false` を返す。

### 空のリストパス

- CLI `--resume`（値なし）：空のリストは `No sessions found` を表示して終了。
- インタラクティブセレクター：空のリストはメッセージを表示し、キャンセル可能なまま維持。

### ターゲットセッションファイルが存在しない/無効な場合

特定のパスでオープン/切り替えする場合（`setSessionFile`）：

- ENOENT -> 空として扱われる -> その正確なパスで新しいセッションが初期化され永続化される。
- 不正/無効なヘッダー（または実質的に読み取り不能な解析済みエントリ）-> 空として扱われる -> 新しいセッションが初期化され永続化される。

これはリカバリー動作であり、ハードエラーではありません。

### ハードエラー

切り替え/オープンは、真の I/O エラー（権限エラー、書き換えエラーなど）の場合にスローする可能性があり、呼び出し元に伝播します。

### ID プレフィックスマッチングの注意事項

- ID マッチングは `startsWith` を使用し、ソート済みリストの最初の一致を取得します。
- 複数のセッションがプレフィックスを共有している場合でも、曖昧さ解消の UI はありません。
- `SessionManager.list(...)` はメッセージがゼロのセッションを除外するため、それらのセッションは ID マッチ/リストピッカーでは再開できません。
