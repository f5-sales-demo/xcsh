---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: スラッシュコマンド
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# スラッシュコマンドの内部構造

このドキュメントでは、`coding-agent` においてスラッシュコマンドがどのように検出、重複排除、インタラクティブモードでの表示、およびプロンプト時に展開されるかを説明します。

## 実装ファイル

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) ディスカバリーモデル

スラッシュコマンドはケイパビリティ（`id: "slash-commands"`）であり、コマンド名でキー付けされます（`key: cmd => cmd.name`）。

ケイパビリティレジストリは登録されたすべてのプロバイダーをプロバイダー優先度の降順でロードし、**先勝ち** のセマンティクスでキーによる重複排除を行います。

### プロバイダーの優先順位

現在のスラッシュコマンドプロバイダーと優先度：

1. `native`（OMP）— 優先度 `100`
2. `claude` — 優先度 `80`
3. `claude-plugins` — 優先度 `70`
4. `codex` — 優先度 `70`

タイの動作：同一優先度のプロバイダーは登録順を維持します。現在のインポート順序では `claude-plugins` が `codex` より先に登録されるため、名前衝突時にはプラグインコマンドが codex コマンドに勝ちます。

### 名前衝突の動作

`slash-commands` の場合、衝突はケイパビリティの重複排除によって厳密に解決されます：

- 最も優先度の高いアイテムが `result.items` に保持される
- 低い優先度の重複は `result.all` にのみ残り、`_shadowed = true` がマークされる

これはプロバイダー間だけでなく、プロバイダーが重複した名前を返す場合にもプロバイダー内で適用されます。

### ファイルスキャンの動作

プロバイダーは主に `loadFilesFromDir(...)` を使用し、現在は以下のように動作します：

- デフォルトで非再帰的なマッチング（`*.md`）
- `gitignore: true`、`hidden: false` でネイティブ glob を使用
- マッチした各ファイルを読み込み、`SlashCommand` に変換

そのため、隠しファイル/ディレクトリはロードされず、無視されたパスはスキップされます。

## 2) プロバイダー固有のソースパスとローカル優先順位

## `native` プロバイダー（`builtin.ts`）

検索ルートは `.xcsh` ディレクトリから取得されます：

- プロジェクト：`<cwd>/.xcsh/commands/*.md`
- ユーザー：`~/.xcsh/agent/commands/*.md`

`getConfigDirs()` はプロジェクトを先に返し、次にユーザーを返すため、名前が衝突した場合 **プロジェクトのネイティブコマンドがユーザーのネイティブコマンドに勝ちます**。

## `claude` プロバイダー（`claude.ts`）

ロード対象：

- ユーザー：`~/.claude/commands/*.md`
- プロジェクト：`<cwd>/.claude/commands/*.md`

プロバイダーはユーザーアイテムをプロジェクトアイテムより先にプッシュするため、このプロバイダー内での同名衝突では **ユーザーの Claude コマンドがプロジェクトの Claude コマンドに勝ちます**。

## `codex` プロバイダー（`codex.ts`）

ロード対象：

- ユーザー：`~/.codex/commands/*.md`
- プロジェクト：`<cwd>/.codex/commands/*.md`

両方がロードされ、ユーザー優先の順序でフラット化されるため、衝突時には **ユーザーの Codex コマンドがプロジェクトの Codex コマンドに勝ちます**。

Codex コマンドのコンテンツはフロントマターの除去（`parseFrontmatter`）でパースされ、コマンド名はフロントマターの `name` で上書きできます。指定がない場合はファイル名が使用されます。

## `claude-plugins` プロバイダー（`claude-plugins.ts`）

`~/.claude/plugins/installed_plugins.json` からプラグインコマンドルートをロードし、`<pluginRoot>/commands/*.md` をスキャンします。

順序はレジストリの反復順序と、その JSON データからのプラグインごとのエントリ順序に従います。追加のソートステップはありません。

## 3) ランタイム `FileSlashCommand` への具体化

`src/extensibility/slash-commands.ts` の `loadSlashCommands()` は、ケイパビリティアイテムをプロンプト時に使用される `FileSlashCommand` オブジェクトに変換します。

各コマンドについて：

1. フロントマター/本文をパース（`parseFrontmatter`）
2. 説明のソース：
   - `frontmatter.description` がある場合はそれを使用
   - それ以外は最初の空でない本文行（トリムされ、最大60文字で `...` 付き）
3. パースされた本文を実行可能なテンプレートコンテンツとして保持
4. `via Claude Code Project` のような表示ソース文字列を計算

フロントマターのパースの厳格度はソースに依存します：

- `native` レベル → パースエラーは `fatal`
- `user`/`project` レベル → パースエラーは `warn` でフォールバックパースあり

### バンドルされたフォールバックコマンド

ファイルシステム/プロバイダーのコマンドの後に、埋め込みコマンドテンプレート（`EMBEDDED_COMMAND_TEMPLATES`）がその名前がまだ存在しない場合に追加されます。

現在の埋め込みセットは `src/task/commands.ts` から来ており、フォールバック（`source: "bundled"`）として使用されます。

## 4) インタラクティブモード：コマンドリストの取得元

インタラクティブモードは、オートコンプリートとコマンドルーティングのために複数のコマンドソースを組み合わせます。

構築時に、以下からペンディングコマンドリストを構築します：

- ビルトイン（`BUILTIN_SLASH_COMMANDS`、選択されたコマンドの引数補完とインラインヒントを含む）
- 拡張登録されたスラッシュコマンド（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript カスタムコマンド（`session.customCommands`）、スラッシュコマンドラベルにマッピング
- `skills.enableSkillCommands` が有効な場合のオプションのスキルコマンド（`/skill:<name>`）

その後 `init()` は `refreshSlashCommandState(...)` を呼び出してファイルベースのコマンドをロードし、以下を含む1つの `CombinedAutocompleteProvider` をインストールします：

- 上記のペンディングコマンド
- 検出されたファイルベースのコマンド

`refreshSlashCommandState(...)` はまた `session.setSlashCommands(...)` を更新し、プロンプト展開が同じ検出されたファイルコマンドセットを使用するようにします。

### リフレッシュライフサイクル

スラッシュコマンドの状態は以下のタイミングでリフレッシュされます：

- インタラクティブモードの初期化時
- `/move` がワーキングディレクトリを変更した後（`handleMoveCommand` が `resetCapabilities()` を呼び出し、次に `refreshSlashCommandState(newCwd)` を呼び出す）

コマンドディレクトリに対する継続的なファイルウォッチャーはありません。

### その他の表示

Extensions ダッシュボードも `slash-commands` ケイパビリティをロードし、`_shadowed` の重複を含むアクティブ/シャドウされたコマンドエントリを表示します。

## 5) プロンプトパイプラインでの配置

`AgentSession.prompt(...)` のスラッシュ処理順序（`expandPromptTemplates !== false` の場合）：

1. **拡張コマンド**（`#tryExecuteExtensionCommand`）
   `/name` が拡張登録されたコマンドに一致する場合、ハンドラーが即座に実行され、prompt が返ります。
2. **TypeScript カスタムコマンド**（`#tryExecuteCustomCommand`）
   バウンダリのみ：一致した場合、実行され以下を返す可能性があります：
   - `string` → プロンプトテキストをその文字列で置換
   - `void/undefined` → 処理済みとして扱われ、LLM プロンプトは送信されない
3. **ファイルベースのスラッシュコマンド**（`expandSlashCommand`）
   テキストがまだ `/` で始まる場合、マークダウンコマンドの展開を試みます。
4. **プロンプトテンプレート**（`expandPromptTemplate`）
   スラッシュ/カスタム処理の後に適用されます。
5. **配信**
   - アイドル：プロンプトはエージェントに即座に送信される
   - ストリーミング：プロンプトは `streamingBehavior` に応じて steer/follow-up としてキューに入れられる

これが、スラッシュコマンドの展開がプロンプトテンプレートの展開の前に位置する理由であり、カスタムコマンドがファイルコマンドのマッチングの前に先頭のスラッシュを変換できる理由です。

## 6) ファイルベースのスラッシュコマンドの展開セマンティクス

`expandSlashCommand(text, fileCommands)` の動作：

- テキストが `/` で始まる場合のみ実行される
- `/` の後の最初のトークンからコマンド名をパース
- 残りのテキストから `parseCommandArgs` で引数をパース
- ロードされた `fileCommands` で正確な名前一致を検索
- 一致した場合、以下を適用：
  - 位置パラメータの置換：`$1`、`$2`、...
  - 集約置換：`$ARGUMENTS` と `$@`
  - その後 `prompt.render` によるテンプレートレンダリング（`{ args, ARGUMENTS, arguments }` を使用）
- 一致しない場合、元のテキストをそのまま返す

### `parseCommandArgs` の注意点

パーサーはシンプルなクォート認識分割です：

- スペースを保持するための `'シングル'` と `"ダブル"` クォートをサポート
- クォート区切り文字を除去
- バックスラッシュエスケープルールは実装していない
- 閉じられていないクォートはエラーにならず、パーサーは末尾まで消費する

## 7) 不明な `/...` の動作

不明なスラッシュ入力はコアのスラッシュロジックによって **拒否されません**。

コマンドが拡張/カスタム/ファイルレイヤーで処理されない場合、`expandSlashCommand` は元のテキストを返し、リテラルの `/...` プロンプトは通常のプロンプトテンプレート展開と LLM 配信を経て処理されます。

インタラクティブモードは `InputController` で多くのビルトインを個別にハードハンドリングします（例：`/settings`、`/model`、`/mcp`、`/move`、`/exit`）。これらは `session.prompt(...)` の前に消費されるため、そのパスではファイルコマンドの展開に到達しません。

## 8) ストリーミング時とアイドル時の違い

## アイドルパス

- `session.prompt("/x ...")` はコマンドパイプラインを実行し、コマンドを即座に実行するか、展開されたテキストを直接送信します。

## ストリーミングパス（`session.isStreaming === true`）

- `prompt(...)` は依然として拡張/カスタム/ファイル/テンプレート変換を最初に実行する
- その後 `streamingBehavior` を要求する：
  - `"steer"` → 割り込みメッセージをキューに入れる（`agent.steer`）
  - `"followUp"` → ターン後メッセージをキューに入れる（`agent.followUp`）
- `streamingBehavior` が省略された場合、prompt はエラーをスローする

### 重要なコマンド固有のストリーミング動作

- 拡張コマンドはストリーミング中でも即座に実行されます（テキストとしてキューに入れられません）。
- `steer(...)`/`followUp(...)` ヘルパーメソッドは拡張コマンドを拒否します（`#throwIfExtensionCommand`）。これは、同期的に実行する必要があるハンドラーのためにコマンドテキストをキューに入れることを防ぐためです。
- コンパクションキューのリプレイは `isKnownSlashCommand(...)` を使用して、キューに入れられたエントリを `session.prompt(...)`（既知のスラッシュコマンドの場合）経由でリプレイすべきか、生の steer/follow-up メソッド経由でリプレイすべきかを判断します。

## 9) エラー処理と障害サーフェス

- プロバイダーのロード失敗は分離されます。レジストリは警告を収集し、他のプロバイダーで続行します。
- 無効なスラッシュコマンドアイテム（名前/パス/コンテンツの欠落または無効なレベル）は、ケイパビリティのバリデーションによって除外されます。
- フロントマターのパース失敗：
  - ネイティブコマンド：致命的なパースエラーがバブルアップする
  - 非ネイティブコマンド：警告 + フォールバックのキー/バリューパース
- 拡張/カスタムコマンドハンドラーの例外はキャッチされ、拡張エラーチャネル（または拡張ランナーがないカスタムコマンドの場合はロガーフォールバック）経由で報告され、処理済みとして扱われます（意図しないフォールバック実行は発生しません）。
