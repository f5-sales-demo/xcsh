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

このドキュメントでは、`coding-agent` においてスラッシュコマンドがどのように検出、重複排除、インタラクティブモードでの表示、およびプロンプト時の展開が行われるかについて説明します。

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

## 1) ディスカバリモデル

スラッシュコマンドはケイパビリティ（`id: "slash-commands"`）であり、コマンド名でキー付けされています（`key: cmd => cmd.name`）。

ケイパビリティレジストリは登録されたすべてのプロバイダーをプロバイダー優先度の降順でロードし、キーによる重複排除を**先勝ち**のセマンティクスで行います。

### プロバイダーの優先順位

現在のスラッシュコマンドプロバイダーとその優先度：

1. `native`（OMP）— 優先度 `100`
2. `claude` — 優先度 `80`
3. `claude-plugins` — 優先度 `70`
4. `codex` — 優先度 `70`

同順位の動作：同じ優先度のプロバイダーは登録順序を維持します。現在のインポート順序では `claude-plugins` が `codex` より先に登録されるため、名前が衝突した場合はプラグインコマンドが codex コマンドに優先します。

### 名前衝突時の動作

`slash-commands` の場合、衝突はケイパビリティの重複排除によって厳密に解決されます：

- 最も優先度の高い項目が `result.items` に保持されます
- より低い優先度の重複は `result.all` にのみ残り、`_shadowed = true` がマークされます

これはプロバイダー間だけでなく、同一プロバイダーが重複する名前を返した場合にも適用されます。

### ファイルスキャンの動作

プロバイダーは主に `loadFilesFromDir(...)` を使用しており、現在の動作は以下の通りです：

- デフォルトで非再帰的マッチング（`*.md`）
- `gitignore: true`、`hidden: false` でネイティブ glob を使用
- マッチしたファイルをそれぞれ読み込み、`SlashCommand` に変換

そのため、隠しファイル/ディレクトリはロードされず、無視パスはスキップされます。

## 2) プロバイダー固有のソースパスとローカル優先順位

## `native` プロバイダー（`builtin.ts`）

検索ルートは `.xcsh` ディレクトリから取得されます：

- プロジェクト：`<cwd>/.xcsh/commands/*.md`
- ユーザー：`~/.xcsh/agent/commands/*.md`

`getConfigDirs()` はプロジェクトを先に、次にユーザーを返すため、名前が衝突した場合は**プロジェクトのネイティブコマンドがユーザーのネイティブコマンドに優先**します。

## `claude` プロバイダー（`claude.ts`）

ロード対象：

- ユーザー：`~/.claude/commands/*.md`
- プロジェクト：`<cwd>/.claude/commands/*.md`

プロバイダーはユーザー項目をプロジェクト項目より先にプッシュするため、このプロバイダー内で同名の衝突が発生した場合は**ユーザーの Claude コマンドがプロジェクトの Claude コマンドに優先**します。

## `codex` プロバイダー（`codex.ts`）

ロード対象：

- ユーザー：`~/.codex/commands/*.md`
- プロジェクト：`<cwd>/.codex/commands/*.md`

両方がロードされてユーザー優先の順序でフラット化されるため、衝突時は**ユーザーの Codex コマンドがプロジェクトの Codex コマンドに優先**します。

Codex コマンドのコンテンツはフロントマターの除去（`parseFrontmatter`）でパースされ、コマンド名はフロントマターの `name` で上書きできます。指定がない場合はファイル名が使用されます。

## `claude-plugins` プロバイダー（`claude-plugins.ts`）

`~/.claude/plugins/installed_plugins.json` からプラグインコマンドのルートをロードし、`<pluginRoot>/commands/*.md` をスキャンします。

順序はレジストリの反復順序と、その JSON データからのプラグインごとのエントリ順序に従います。追加のソートステップはありません。

## 3) ランタイム `FileSlashCommand` への変換

`src/extensibility/slash-commands.ts` の `loadSlashCommands()` は、ケイパビリティ項目をプロンプト時に使用される `FileSlashCommand` オブジェクトに変換します。

各コマンドについて：

1. フロントマター/本文をパース（`parseFrontmatter`）
2. 説明のソース：
   - `frontmatter.description` が存在する場合はそれを使用
   - それ以外は最初の空でない本文行（トリムされ、最大60文字で `...` 付き）
3. パースされた本文を実行可能なテンプレートコンテンツとして保持
4. `via Claude Code Project` のような表示ソース文字列を計算

フロントマターのパース深刻度はソースに依存します：

- `native` レベル -> パースエラーは `fatal`
- `user`/`project` レベル -> パースエラーは `warn` でフォールバックパース付き

### バンドルされたフォールバックコマンド

ファイルシステム/プロバイダーコマンドの後に、名前がまだ存在しない場合は埋め込みコマンドテンプレート（`EMBEDDED_COMMAND_TEMPLATES`）が追加されます。

現在の埋め込みセットは `src/task/commands.ts` から取得され、フォールバック（`source: "bundled"`）として使用されます。

## 4) インタラクティブモード：コマンドリストの取得元

インタラクティブモードは、オートコンプリートとコマンドルーティングのために複数のコマンドソースを組み合わせます。

構築時に以下から保留コマンドリストを構築します：

- ビルトイン（`BUILTIN_SLASH_COMMANDS`、選択されたコマンドの引数補完やインラインヒントを含む）
- 拡張機能で登録されたスラッシュコマンド（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript カスタムコマンド（`session.customCommands`）、スラッシュコマンドラベルにマッピング
- `skills.enableSkillCommands` が有効な場合のオプションのスキルコマンド（`/skill:<name>`）

その後 `init()` が `refreshSlashCommandState(...)` を呼び出してファイルベースのコマンドをロードし、以下を含む1つの `CombinedAutocompleteProvider` をインストールします：

- 上記の保留コマンド
- 検出されたファイルベースのコマンド

`refreshSlashCommandState(...)` は `session.setSlashCommands(...)` も更新するため、プロンプト展開時に同じ検出済みファイルコマンドセットが使用されます。

### リフレッシュのライフサイクル

スラッシュコマンドの状態がリフレッシュされるタイミング：

- インタラクティブ初期化時
- `/move` で作業ディレクトリを変更した後（`handleMoveCommand` が `resetCapabilities()` を呼び出し、次に `refreshSlashCommandState(newCwd)` を呼び出す）

コマンドディレクトリの継続的なファイルウォッチャーはありません。

### その他の表示

Extensions ダッシュボードも `slash-commands` ケイパビリティをロードし、`_shadowed` の重複を含むアクティブ/シャドウされたコマンドエントリを表示します。

## 5) プロンプトパイプラインでの配置

`AgentSession.prompt(...)` のスラッシュ処理順序（`expandPromptTemplates !== false` の場合）：

1. **拡張機能コマンド**（`#tryExecuteExtensionCommand`）  
   `/name` が拡張機能で登録されたコマンドに一致する場合、ハンドラーが即座に実行され、プロンプトは戻ります。
2. **TypeScript カスタムコマンド**（`#tryExecuteCustomCommand`）  
   境界のみ：一致した場合、実行されて以下を返す可能性があります：
   - `string` -> プロンプトテキストをその文字列に置換
   - `void/undefined` -> 処理済みとして扱われ、LLM プロンプトなし
3. **ファイルベースのスラッシュコマンド**（`expandSlashCommand`）  
   テキストがまだ `/` で始まる場合、マークダウンコマンドの展開を試みます。
4. **プロンプトテンプレート**（`expandPromptTemplate`）  
   スラッシュ/カスタム処理の後に適用されます。
5. **配信**
   - アイドル時：プロンプトは即座にエージェントに送信されます
   - ストリーミング時：プロンプトは `streamingBehavior` に応じて steer/follow-up としてキューに入ります

これが、スラッシュコマンドの展開がプロンプトテンプレートの展開の前に位置する理由であり、カスタムコマンドがファイルコマンドのマッチング前に先頭のスラッシュを変換できる理由です。

## 6) ファイルベースのスラッシュコマンドの展開セマンティクス

`expandSlashCommand(text, fileCommands)` の動作：

- テキストが `/` で始まる場合のみ実行
- `/` の後の最初のトークンからコマンド名をパース
- 残りのテキストから `parseCommandArgs` で引数をパース
- ロード済みの `fileCommands` から正確な名前一致を検索
- 一致した場合、以下を適用：
  - 位置引数の置換：`$1`、`$2`、...
  - 集約置換：`$ARGUMENTS` と `$@`
  - その後 `prompt.render` によるテンプレートレンダリング（`{ args, ARGUMENTS, arguments }` を使用）
- 一致しない場合、元のテキストをそのまま返す

### `parseCommandArgs` の注意点

パーサーはシンプルなクォート対応の分割です：

- スペースを保持するための `'シングル'` と `"ダブル"` クォートをサポート
- クォートの区切り文字を除去
- バックスラッシュエスケープルールは実装されていません
- 閉じられていないクォートはエラーにならず、パーサーは末尾まで消費します

## 7) 不明な `/...` の動作

不明なスラッシュ入力はコアのスラッシュロジックによって**拒否されません**。

コマンドが拡張機能/カスタム/ファイルレイヤーで処理されない場合、`expandSlashCommand` は元のテキストを返し、リテラルの `/...` プロンプトは通常のプロンプトテンプレート展開と LLM 配信を経て処理されます。

インタラクティブモードは `InputController` で多くのビルトインを個別にハードハンドリングします（例：`/settings`、`/model`、`/mcp`、`/move`、`/exit`）。これらは `session.prompt(...)` の前に消費されるため、そのパスでファイルコマンドの展開に到達することはありません。

## 8) ストリーミング時とアイドル時の違い

## アイドルパス

- `session.prompt("/x ...")` はコマンドパイプラインを実行し、コマンドを即座に実行するか、展開されたテキストを直接送信します。

## ストリーミングパス（`session.isStreaming === true`）

- `prompt(...)` は引き続き拡張機能/カスタム/ファイル/テンプレートの変換を最初に実行します
- その後 `streamingBehavior` が必要です：
  - `"steer"` -> 割り込みメッセージをキュー（`agent.steer`）
  - `"followUp"` -> ターン後メッセージをキュー（`agent.followUp`）
- `streamingBehavior` が省略された場合、プロンプトはエラーをスローします

### 重要なコマンド固有のストリーミング動作

- 拡張機能コマンドはストリーミング中でも即座に実行されます（テキストとしてキューに入りません）。
- `steer(...)`/`followUp(...)` ヘルパーメソッドは拡張機能コマンドを拒否し（`#throwIfExtensionCommand`）、同期的に実行する必要があるハンドラーにコマンドテキストがキューに入るのを防ぎます。
- コンパクションキューのリプレイは `isKnownSlashCommand(...)` を使用して、キューに入ったエントリを `session.prompt(...)` 経由でリプレイするか（既知のスラッシュコマンドの場合）、生の steer/follow-up メソッドを使用するかを決定します。

## 9) エラーハンドリングと失敗箇所

- プロバイダーのロード失敗は隔離されます。レジストリは警告を収集し、他のプロバイダーで処理を継続します。
- 無効なスラッシュコマンド項目（名前/パス/コンテンツの欠落または無効なレベル）はケイパビリティバリデーションによって除外されます。
- フロントマターのパース失敗：
  - ネイティブコマンド：致命的なパースエラーが伝播
  - 非ネイティブコマンド：警告 + フォールバックのキー/値パース
- 拡張機能/カスタムコマンドハンドラーの例外はキャッチされ、拡張機能エラーチャネル（または拡張機能ランナーのないカスタムコマンドの場合はロガーフォールバック）を通じて報告され、処理済みとして扱われます（意図しないフォールバック実行は発生しません）。
