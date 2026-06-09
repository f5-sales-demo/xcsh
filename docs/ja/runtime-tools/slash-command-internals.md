---
title: スラッシュコマンドの内部構造
description: 登録、引数解析、実行ディスパッチを含むスラッシュコマンドシステムの内部構造。
sidebar:
  order: 5
  label: スラッシュコマンド
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# スラッシュコマンドの内部構造

このドキュメントでは、`coding-agent` においてスラッシュコマンドがどのように検出、重複排除、インタラクティブモードでの表示、およびプロンプト時の展開が行われるかを説明します。

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

## 1) 検出モデル

スラッシュコマンドはケイパビリティ（`id: "slash-commands"`）であり、コマンド名をキー（`key: cmd => cmd.name`）として管理されます。

ケイパビリティレジストリは登録済みの全プロバイダーをプロバイダー優先度の降順でロードし、**先勝ち**のセマンティクスでキーによる重複排除を行います。

### プロバイダーの優先順位

現在のスラッシュコマンドプロバイダーと優先度：

1. `native`（OMP）— 優先度 `100`
2. `claude` — 優先度 `80`
3. `claude-plugins` — 優先度 `70`
4. `codex` — 優先度 `70`

タイの動作：同じ優先度のプロバイダーは登録順序を維持します。現在のインポート順序では `claude-plugins` が `codex` より先に登録されるため、名前衝突時にはプラグインコマンドが codex コマンドに優先します。

### 名前衝突時の動作

`slash-commands` では、衝突はケイパビリティの重複排除によって厳密に解決されます：

- 最も優先度の高い項目が `result.items` に保持される
- 優先度の低い重複は `result.all` にのみ残り、`_shadowed = true` とマークされる

これはプロバイダー間だけでなく、プロバイダー内で重複した名前を返す場合にも適用されます。

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

`getConfigDirs()` はプロジェクトを先に返し、次にユーザーを返すため、名前衝突時には**プロジェクトの native コマンドがユーザーの native コマンドに優先**します。

## `claude` プロバイダー（`claude.ts`）

ロード対象：

- ユーザー：`~/.claude/commands/*.md`
- プロジェクト：`<cwd>/.claude/commands/*.md`

プロバイダーはユーザー項目をプロジェクト項目より先にプッシュするため、このプロバイダー内での同名衝突時には**ユーザーの Claude コマンドがプロジェクトの Claude コマンドに優先**します。

## `codex` プロバイダー（`codex.ts`）

ロード対象：

- ユーザー：`~/.codex/commands/*.md`
- プロジェクト：`<cwd>/.codex/commands/*.md`

両側がロードされ、ユーザー優先の順序でフラット化されるため、衝突時には**ユーザーの Codex コマンドがプロジェクトの Codex コマンドに優先**します。

Codex コマンドのコンテンツはフロントマター除去（`parseFrontmatter`）で解析され、コマンド名はフロントマターの `name` で上書き可能です。指定がない場合はファイル名が使用されます。

## `claude-plugins` プロバイダー（`claude-plugins.ts`）

`~/.claude/plugins/installed_plugins.json` からプラグインコマンドのルートをロードし、`<pluginRoot>/commands/*.md` をスキャンします。

順序はレジストリの反復順序および JSON データからのプラグインごとのエントリ順序に従います。追加のソート手順はありません。

## 3) ランタイム `FileSlashCommand` への具体化

`src/extensibility/slash-commands.ts` の `loadSlashCommands()` は、ケイパビリティ項目をプロンプト時に使用される `FileSlashCommand` オブジェクトに変換します。

各コマンドについて：

1. フロントマター/本文を解析（`parseFrontmatter`）
2. 説明のソース：
   - `frontmatter.description` が存在する場合はそれを使用
   - それ以外は最初の空でない本文行（トリミング済み、最大60文字で `...` 付き）
3. 解析済みの本文を実行可能なテンプレートコンテンツとして保持
4. `via Claude Code Project` のような表示ソース文字列を算出

フロントマター解析の重大度はソースに依存します：

- `native` レベル -> 解析エラーは `fatal`
- `user`/`project` レベル -> 解析エラーは `warn` でフォールバック解析あり

### バンドルされたフォールバックコマンド

ファイルシステム/プロバイダーコマンドの後に、名前がまだ存在しない場合は組み込みコマンドテンプレート（`EMBEDDED_COMMAND_TEMPLATES`）が追加されます。

現在の組み込みセットは `src/task/commands.ts` から提供され、フォールバック（`source: "bundled"`）として使用されます。

## 4) インタラクティブモード：コマンドリストの取得元

インタラクティブモードはオートコンプリートとコマンドルーティングのために複数のコマンドソースを結合します。

構築時に以下から保留コマンドリストを構築します：

- ビルトイン（`BUILTIN_SLASH_COMMANDS`、選択されたコマンドの引数補完やインラインヒントを含む）
- 拡張機能で登録されたスラッシュコマンド（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript カスタムコマンド（`session.customCommands`）、スラッシュコマンドラベルにマッピング
- `skills.enableSkillCommands` が有効な場合のオプションのスキルコマンド（`/skill:<name>`）

その後、`init()` は `refreshSlashCommandState(...)` を呼び出してファイルベースのコマンドをロードし、以下を含む1つの `CombinedAutocompleteProvider` をインストールします：

- 上記の保留コマンド
- 検出されたファイルベースのコマンド

`refreshSlashCommandState(...)` は `session.setSlashCommands(...)` も更新するため、プロンプト展開は同じ検出済みファイルコマンドセットを使用します。

### リフレッシュのライフサイクル

スラッシュコマンドの状態は以下のタイミングでリフレッシュされます：

- インタラクティブモードの初期化時
- `/move` で作業ディレクトリが変更された後（`handleMoveCommand` が `resetCapabilities()` を呼び出し、次に `refreshSlashCommandState(newCwd)` を呼び出す）

コマンドディレクトリに対する継続的なファイルウォッチャーはありません。

### その他の表示

Extensions ダッシュボードも `slash-commands` ケイパビリティをロードし、`_shadowed` の重複を含むアクティブ/シャドウされたコマンドエントリを表示します。

## 5) プロンプトパイプラインでの配置

`AgentSession.prompt(...)` のスラッシュ処理順序（`expandPromptTemplates !== false` の場合）：

1. **拡張コマンド**（`#tryExecuteExtensionCommand`）  
   `/name` が拡張機能登録済みコマンドに一致する場合、ハンドラーが即座に実行され、prompt は返ります。
2. **TypeScript カスタムコマンド**（`#tryExecuteCustomCommand`）  
   境界のみ：一致した場合、実行され以下を返す可能性があります：
   - `string` -> プロンプトテキストをその文字列で置換
   - `void/undefined` -> 処理済みとして扱われ、LLM プロンプトなし
3. **ファイルベースのスラッシュコマンド**（`expandSlashCommand`）  
   テキストがまだ `/` で始まる場合、マークダウンコマンドの展開を試みます。
4. **プロンプトテンプレート**（`expandPromptTemplate`）  
   スラッシュ/カスタム処理の後に適用されます。
5. **配信**
   - アイドル：プロンプトは即座にエージェントに送信
   - ストリーミング：`streamingBehavior` に応じてステア/フォローアップとしてキューイング

これが、スラッシュコマンドの展開がプロンプトテンプレートの展開より前に位置する理由であり、カスタムコマンドがファイルコマンドのマッチング前に先頭のスラッシュを変換できる理由です。

## 6) ファイルベースのスラッシュコマンドの展開セマンティクス

`expandSlashCommand(text, fileCommands)` の動作：

- テキストが `/` で始まる場合のみ実行
- `/` の後の最初のトークンからコマンド名を解析
- 残りのテキストから `parseCommandArgs` で引数を解析
- ロード済みの `fileCommands` で正確な名前一致を検索
- 一致した場合、以下を適用：
  - 位置引数の置換：`$1`、`$2`、...
  - 集約引数の置換：`$ARGUMENTS` および `$@`
  - その後、`{ args, ARGUMENTS, arguments }` を使用した `prompt.render` によるテンプレートレンダリング
- 一致しない場合、元のテキストをそのまま返す

### `parseCommandArgs` の注意事項

パーサーはシンプルなクォート認識型の分割です：

- スペースを保持するために `'single'` および `"double"` クォーティングをサポート
- クォート区切り文字を除去
- バックスラッシュのエスケープルールは実装していない
- 閉じられていないクォートはエラーにならず、パーサーは末尾まで消費する

## 7) 不明な `/...` の動作

不明なスラッシュ入力はコアのスラッシュロジックによって**拒否されません**。

コマンドが拡張/カスタム/ファイルレイヤーで処理されない場合、`expandSlashCommand` は元のテキストを返し、リテラルの `/...` プロンプトは通常のプロンプトテンプレート展開と LLM 配信を通じて処理されます。

インタラクティブモードは `InputController` で多くのビルトインを個別にハード処理します（例：`/settings`、`/model`、`/mcp`、`/move`、`/exit`）。これらは `session.prompt(...)` の前に消費されるため、そのパスでファイルコマンド展開に到達することはありません。

## 8) ストリーミング時とアイドル時の違い

## アイドルパス

- `session.prompt("/x ...")` はコマンドパイプラインを実行し、コマンドを即座に実行するか、展開されたテキストを直接送信します。

## ストリーミングパス（`session.isStreaming === true`）

- `prompt(...)` は依然として拡張/カスタム/ファイル/テンプレート変換を最初に実行
- その後、`streamingBehavior` が必要：
  - `"steer"` -> 割り込みメッセージをキューイング（`agent.steer`）
  - `"followUp"` -> ターン後メッセージをキューイング（`agent.followUp`）
- `streamingBehavior` が省略された場合、prompt はエラーをスローする

### 重要なコマンド固有のストリーミング動作

- 拡張コマンドはストリーミング中でも即座に実行されます（テキストとしてキューイングされません）。
- `steer(...)`/`followUp(...)` ヘルパーメソッドは拡張コマンドを拒否し（`#throwIfExtensionCommand`）、同期的に実行されるべきハンドラーのコマンドテキストがキューイングされることを防ぎます。
- コンパクションキューのリプレイは `isKnownSlashCommand(...)` を使用して、キューイングされたエントリを `session.prompt(...)` 経由でリプレイすべきか（既知のスラッシュコマンドの場合）、生のステア/フォローアップメソッドを使用すべきかを判断します。

## 9) エラー処理と障害表面

- プロバイダーのロード失敗は分離されます。レジストリは警告を収集し、他のプロバイダーで処理を続行します。
- 無効なスラッシュコマンド項目（名前/パス/コンテンツの欠落または無効なレベル）はケイパビリティのバリデーションによって除外されます。
- フロントマターの解析失敗：
  - native コマンド：致命的な解析エラーが伝播
  - 非 native コマンド：警告 + フォールバックのキー/バリュー解析
- 拡張/カスタムコマンドハンドラーの例外はキャッチされ、拡張エラーチャネル経由で報告されます（拡張ランナーのないカスタムコマンドの場合はロガーフォールバック）。これらは処理済みとして扱われます（意図しないフォールバック実行は発生しません）。
