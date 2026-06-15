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

本ドキュメントでは、`coding-agent` においてスラッシュコマンドがどのように検出され、重複排除され、インタラクティブモードで表示され、プロンプト時に展開されるかを説明します。

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

スラッシュコマンドはケイパビリティ（`id: "slash-commands"`）であり、コマンド名をキーとして（`key: cmd => cmd.name`）管理されます。

ケイパビリティレジストリは登録済みのすべてのプロバイダーを読み込み、プロバイダーの優先度の降順でソートし、**先着優先**のセマンティクスでキーの重複を排除します。

### プロバイダーの優先順位

現在のスラッシュコマンドプロバイダーと優先度：

1. `native`（OMP）— 優先度 `100`
2. `claude` — 優先度 `80`
3. `claude-plugins` — 優先度 `70`
4. `codex` — 優先度 `70`

同一優先度の挙動：同じ優先度のプロバイダーは登録順を保持します。現在のインポート順では `claude-plugins` が `codex` より先に登録されるため、名前が衝突した場合はプラグインコマンドが codex コマンドより優先されます。

### 名前衝突時の挙動

`slash-commands` における衝突は、ケイパビリティの重複排除によって厳密に解決されます：

- 最も優先度の高いアイテムが `result.items` に保持される
- 低優先度の重複は `result.all` にのみ残り、`_shadowed = true` としてマークされる

これはプロバイダー間の衝突だけでなく、1 つのプロバイダーが重複する名前を返した場合にも適用されます。

### ファイルスキャンの挙動

プロバイダーはほとんどの場合 `loadFilesFromDir(...)` を使用し、現在の挙動は以下のとおりです：

- デフォルトは非再帰的マッチング（`*.md`）
- `gitignore: true`、`hidden: false` でネイティブ glob を使用
- マッチした各ファイルを読み込み、`SlashCommand` に変換する

そのため、隠しファイルやディレクトリは読み込まれず、無視パスはスキップされます。

## 2) プロバイダー固有のソースパスとローカル優先度

## `native` プロバイダー（`builtin.ts`）

検索ルートは `.xcsh` ディレクトリに由来します：

- プロジェクト: `<cwd>/.xcsh/commands/*.md`
- ユーザー: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` はプロジェクトを先に返し、次にユーザーを返すため、**名前が衝突した場合はプロジェクトのネイティブコマンドがユーザーのネイティブコマンドより優先**されます。

## `claude` プロバイダー（`claude.ts`）

以下を読み込みます：

- ユーザー: `~/.claude/commands/*.md`
- プロジェクト: `<cwd>/.claude/commands/*.md`

プロバイダーはユーザーアイテムをプロジェクトアイテムより先に追加するため、このプロバイダー内での同名衝突では**ユーザーの Claude コマンドがプロジェクトの Claude コマンドより優先**されます。

## `codex` プロバイダー（`codex.ts`）

以下を読み込みます：

- ユーザー: `~/.codex/commands/*.md`
- プロジェクト: `<cwd>/.codex/commands/*.md`

両側が読み込まれ、ユーザー優先の順序でフラット化されるため、衝突時は**ユーザーの Codex コマンドがプロジェクトの Codex コマンドより優先**されます。

Codex コマンドのコンテンツはフロントマター除去（`parseFrontmatter`）によって解析され、コマンド名はフロントマターの `name` で上書きできます。指定がない場合はファイル名が使用されます。

## `claude-plugins` プロバイダー（`claude-plugins.ts`）

`~/.claude/plugins/installed_plugins.json` からプラグインコマンドのルートを読み込み、`<pluginRoot>/commands/*.md` をスキャンします。

順序はレジストリの反復順と、その JSON データ内のプラグインエントリの順序に従います。追加のソートステップはありません。

## 3) ランタイム `FileSlashCommand` へのマテリアライズ

`src/extensibility/slash-commands.ts` の `loadSlashCommands()` は、ケイパビリティアイテムをプロンプト時に使用される `FileSlashCommand` オブジェクトに変換します。

各コマンドに対して：

1. フロントマター/ボディの解析（`parseFrontmatter`）
2. 説明のソース：
   - `frontmatter.description` が存在する場合はそれを使用
   - それ以外の場合は最初の空でないボディ行（トリミング済み、最大 60 文字で `...`）
3. 解析済みボディを実行可能テンプレートコンテンツとして保持
4. `via Claude Code Project` のような表示ソース文字列を計算

フロントマター解析の重大度はソースに依存します：

- `native` レベル -> 解析エラーは `fatal`
- `user`/`project` レベル -> 解析エラーは `warn` でフォールバック解析あり

### バンドル済みフォールバックコマンド

ファイルシステム/プロバイダーコマンドの後、埋め込みコマンドテンプレート（`EMBEDDED_COMMAND_TEMPLATES`）がその名前がまだ存在しない場合に追加されます。

現在の埋め込みセットは `src/task/commands.ts` に由来し、フォールバック（`source: "bundled"`）として使用されます。

## 4) インタラクティブモード：コマンドリストの取得元

インタラクティブモードは、オートコンプリートとコマンドルーティングのために複数のコマンドソースを組み合わせます。

構築時に以下から保留中のコマンドリストを構築します：

- 組み込みコマンド（`BUILTIN_SLASH_COMMANDS`。選択されたコマンドの引数補完とインラインヒントを含む）
- 拡張登録済みスラッシュコマンド（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript カスタムコマンド（`session.customCommands`）。スラッシュコマンドラベルにマッピング
- `skills.enableSkillCommands` が有効な場合のオプションのスキルコマンド（`/skill:<name>`）

その後、`init()` は `refreshSlashCommandState(...)` を呼び出してファイルベースのコマンドを読み込み、以下を含む 1 つの `CombinedAutocompleteProvider` をインストールします：

- 上記の保留中のコマンド
- 検出されたファイルベースのコマンド

`refreshSlashCommandState(...)` は `session.setSlashCommands(...)` も更新するため、プロンプト展開でも同じ検出済みファイルコマンドセットが使用されます。

### リフレッシュのライフサイクル

スラッシュコマンドの状態は以下のタイミングでリフレッシュされます：

- インタラクティブ初期化中
- `/move` で作業ディレクトリが変更された後（`handleMoveCommand` が `resetCapabilities()` を呼び出し、その後 `refreshSlashCommandState(newCwd)` を呼び出す）

コマンドディレクトリの継続的なファイルウォッチャーはありません。

### その他の表示箇所

Extensions ダッシュボードも `slash-commands` ケイパビリティを読み込み、`_shadowed` の重複を含む、アクティブ/シャドウされたコマンドエントリを表示します。

## 5) プロンプトパイプラインの配置

`AgentSession.prompt(...)` のスラッシュ処理順序（`expandPromptTemplates !== false` の場合）：

1. **拡張コマンド**（`#tryExecuteExtensionCommand`）  
   `/name` が拡張登録済みコマンドに一致した場合、ハンドラーが即座に実行されプロンプトが返ります。
2. **TypeScript カスタムコマンド**（`#tryExecuteCustomCommand`）  
   境界のみ：一致した場合、実行されて以下を返す可能性があります：
   - `string` -> プロンプトテキストをその文字列で置換
   - `void/undefined` -> 処理済みとして扱われる。LLM プロンプトなし
3. **ファイルベースのスラッシュコマンド**（`expandSlashCommand`）  
   テキストがまだ `/` で始まる場合、マークダウンコマンド展開を試みる。
4. **プロンプトテンプレート**（`expandPromptTemplate`）  
   スラッシュ/カスタム処理の後に適用される。
5. **デリバリー**
   - アイドル: プロンプトは即座にエージェントに送信される
   - ストリーミング: プロンプトは `streamingBehavior` に応じて steer/フォローアップとしてキューに入れられる

これがスラッシュコマンド展開がプロンプトテンプレート展開より前に位置する理由であり、カスタムコマンドがファイルコマンドマッチングの前に先頭のスラッシュを変換できる理由でもあります。

## 6) ファイルベースのスラッシュコマンドの展開セマンティクス

`expandSlashCommand(text, fileCommands)` の挙動：

- テキストが `/` で始まる場合のみ実行
- `/` の後の最初のトークンからコマンド名を解析
- `parseCommandArgs` で残りのテキストから引数を解析
- 読み込まれた `fileCommands` で完全一致を検索
- 一致した場合、以下を適用：
  - 位置指定置換: `$1`、`$2`、...
  - 集約置換: `$ARGUMENTS` および `$@`
  - その後 `{ args, ARGUMENTS, arguments }` で `prompt.render` によるテンプレートレンダリング
- 一致しない場合、元のテキストをそのまま返す

### `parseCommandArgs` の注意事項

パーサーは単純なクォート対応の分割処理です：

- スペースを保持するための `'シングル'` および `"ダブル"` クォートをサポート
- クォートの区切り文字を除去
- バックスラッシュエスケープルールは実装されていない
- 未対応クォートはエラーにならず、パーサーは末尾まで消費する

## 7) 未知の `/...` の挙動

未知のスラッシュ入力はコアのスラッシュロジックによって**拒否されません**。

コマンドが拡張/カスタム/ファイルの各レイヤーで処理されない場合、`expandSlashCommand` は元のテキストを返し、リテラルの `/...` プロンプトは通常のプロンプトテンプレート展開と LLM デリバリーを経由します。

インタラクティブモードは `InputController` 内で多くの組み込みコマンドを個別に処理します（例: `/settings`、`/model`、`/mcp`、`/move`、`/exit`）。これらは `session.prompt(...)` の前に消費されるため、そのパスではファイルコマンド展開に到達しません。

## 8) ストリーミング時とアイドル時の違い

## アイドルパス

- `session.prompt("/x ...")` はコマンドパイプラインを実行し、コマンドを即座に実行するか、展開されたテキストを直接送信します。

## ストリーミングパス（`session.isStreaming === true`）

- `prompt(...)` は拡張/カスタム/ファイル/テンプレートの変換を先に実行
- その後 `streamingBehavior` が必要：
  - `"steer"` -> 割り込みメッセージをキューに追加（`agent.steer`）
  - `"followUp"` -> ターン後メッセージをキューに追加（`agent.followUp`）
- `streamingBehavior` が省略された場合、プロンプトはエラーをスロー

### コマンド固有の重要なストリーミング挙動

- 拡張コマンドはストリーミング中でも即座に実行されます（テキストとしてキューに入れられません）。
- `steer(...)`/`followUp(...)` ヘルパーメソッドは拡張コマンドを拒否します（`#throwIfExtensionCommand`）。同期的に実行する必要があるハンドラーにコマンドテキストがキューイングされることを防ぐためです。
- コンパクションキューのリプレイは `isKnownSlashCommand(...)` を使用して、キューに入ったエントリを `session.prompt(...)` 経由でリプレイするか（既知のスラッシュコマンドの場合）、生の steer/フォローアップメソッド経由でリプレイするかを判断します。

## 9) エラー処理と障害の表面化

- プロバイダーの読み込み失敗は分離されます。レジストリは警告を収集し、他のプロバイダーの処理を継続します。
- 無効なスラッシュコマンドアイテム（name/path/content が欠如しているか、level が無効）はケイパビリティ検証によってドロップされます。
- フロントマター解析の失敗：
  - ネイティブコマンド: 致命的な解析エラーがバブルアップ
  - 非ネイティブコマンド: 警告 + フォールバックのキー/値解析
- 拡張/カスタムコマンドハンドラーの例外はキャッチされ、拡張エラーチャネル経由で報告されます（または拡張ランナーのないカスタムコマンドの場合はロガーフォールバック）。処理済みとして扱われ、意図しないフォールバック実行は行われません。
