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

本ドキュメントでは、`coding-agent` においてスラッシュコマンドがどのように検出され、重複除去され、インタラクティブモードで表示され、プロンプト時に展開されるかを説明します。

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

スラッシュコマンドはコマンド名をキー（`key: cmd => cmd.name`）とするケイパビリティ（`id: "slash-commands"`）です。

ケイパビリティレジストリは登録済みのすべてのプロバイダーをプロバイダー優先度の降順で読み込み、**先勝ち**のセマンティクスでキーによる重複除去を行います。

### プロバイダーの優先順位

現在のスラッシュコマンドプロバイダーと優先度:

1. `native` (OMP) — 優先度 `100`
2. `claude` — 優先度 `80`
3. `claude-plugins` — 優先度 `70`
4. `codex` — 優先度 `70`

同順位の動作: 優先度が同じプロバイダーは登録順が維持されます。現在のインポート順では `claude-plugins` が `codex` より先に登録されるため、名前の衝突時はプラグインコマンドが codex コマンドより優先されます。

### 名前衝突時の動作

`slash-commands` における衝突はケイパビリティの重複除去によって厳密に解決されます:

- 最高優先度のアイテムが `result.items` に保持されます
- 優先度の低い重複は `result.all` にのみ残り、`_shadowed = true` がマークされます

これはプロバイダー間だけでなく、プロバイダーが重複した名前を返す場合にも適用されます。

### ファイルスキャンの動作

プロバイダーは主に `loadFilesFromDir(...)` を使用しており、現在の動作は以下のとおりです:

- デフォルトで非再帰的なマッチング（`*.md`）
- `gitignore: true`、`hidden: false` でネイティブグロブを使用
- マッチした各ファイルを読み込み、`SlashCommand` に変換

そのため、隠しファイル/ディレクトリは読み込まれず、無視されたパスはスキップされます。

## 2) プロバイダー固有のソースパスとローカルの優先順位

## `native` プロバイダー（`builtin.ts`）

検索ルートは `.xcsh` ディレクトリから取得されます:

- プロジェクト: `<cwd>/.xcsh/commands/*.md`
- ユーザー: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` はプロジェクトを先に返し、その後ユーザーを返すため、名前が衝突した場合は**プロジェクトのネイティブコマンドがユーザーのネイティブコマンドより優先**されます。

## `claude` プロバイダー（`claude.ts`）

以下を読み込みます:

- ユーザー: `~/.claude/commands/*.md`
- プロジェクト: `<cwd>/.claude/commands/*.md`

プロバイダーはユーザーアイテムをプロジェクトアイテムより先にプッシュするため、このプロバイダー内での同名衝突では**ユーザーの Claude コマンドがプロジェクトの Claude コマンドより優先**されます。

## `codex` プロバイダー（`codex.ts`）

以下を読み込みます:

- ユーザー: `~/.codex/commands/*.md`
- プロジェクト: `<cwd>/.codex/commands/*.md`

両方を読み込み、ユーザー優先の順序でフラット化するため、衝突時は**ユーザーの Codex コマンドがプロジェクトの Codex コマンドより優先**されます。

Codex コマンドのコンテンツはフロントマターの除去（`parseFrontmatter`）によって解析され、フロントマターの `name` でコマンド名を上書きできます。指定がない場合はファイル名が使用されます。

## `claude-plugins` プロバイダー（`claude-plugins.ts`）

`~/.claude/plugins/installed_plugins.json` からプラグインコマンドのルートを読み込み、`<pluginRoot>/commands/*.md` をスキャンします。

順序はレジストリのイテレーション順と、その JSON データのプラグインごとのエントリ順に従います。追加のソートステップはありません。

## 3) ランタイム `FileSlashCommand` へのマテリアライズ

`src/extensibility/slash-commands.ts` の `loadSlashCommands()` は、ケイパビリティアイテムをプロンプト時に使用される `FileSlashCommand` オブジェクトに変換します。

各コマンドについて:

1. フロントマター/本文の解析（`parseFrontmatter`）
2. 説明のソース:
   - 存在する場合は `frontmatter.description`
   - それ以外は最初の空でない本文行（トリミング済み、最大60文字で `...` を付加）
3. 解析済みの本文を実行可能なテンプレートコンテンツとして保持
4. `via Claude Code Project` のような表示ソース文字列を計算

フロントマター解析の重大度はソースに依存します:

- `native` レベル → 解析エラーは `fatal`
- `user`/`project` レベル → 解析エラーは `warn` でフォールバック解析

### バンドル済みフォールバックコマンド

ファイルシステム/プロバイダーコマンドの後、埋め込みコマンドテンプレート（`EMBEDDED_COMMAND_TEMPLATES`）は、その名前がまだ存在しない場合に追加されます。

現在の埋め込みセットは `src/task/commands.ts` から取得され、フォールバック（`source: "bundled"`）として使用されます。

## 4) インタラクティブモード: コマンドリストの取得元

インタラクティブモードは、オートコンプリートとコマンドルーティングのために複数のコマンドソースを組み合わせます。

構築時に以下から保留中のコマンドリストを作成します:

- 組み込みコマンド（`BUILTIN_SLASH_COMMANDS`、選択されたコマンドの引数補完とインラインヒントを含む）
- 拡張機能で登録されたスラッシュコマンド（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript カスタムコマンド（`session.customCommands`）、スラッシュコマンドラベルにマッピング
- `skills.enableSkillCommands` が有効な場合のオプションのスキルコマンド（`/skill:<name>`）

次に `init()` が `refreshSlashCommandState(...)` を呼び出してファイルベースのコマンドを読み込み、以下を含む1つの `CombinedAutocompleteProvider` をインストールします:

- 上記の保留中のコマンド
- 検出されたファイルベースのコマンド

`refreshSlashCommandState(...)` は `session.setSlashCommands(...)` も更新するため、プロンプト展開では同じ検出済みファイルコマンドセットが使用されます。

### リフレッシュのライフサイクル

スラッシュコマンドの状態は以下のタイミングでリフレッシュされます:

- インタラクティブ初期化中
- `/move` で作業ディレクトリが変更された後（`handleMoveCommand` が `resetCapabilities()` を呼び出し、次に `refreshSlashCommandState(newCwd)` を呼び出す）

コマンドディレクトリに対する継続的なファイルウォッチャーはありません。

### その他の表示箇所

Extensions ダッシュボードも `slash-commands` ケイパビリティを読み込み、`_shadowed` の重複を含むアクティブ/シャドウされたコマンドエントリを表示します。

## 5) プロンプトパイプラインの配置

`AgentSession.prompt(...)` のスラッシュ処理順序（`expandPromptTemplates !== false` の場合）:

1. **拡張機能コマンド**（`#tryExecuteExtensionCommand`）  
   `/name` が拡張機能で登録されたコマンドと一致する場合、ハンドラーが即座に実行されてプロンプトが返ります。
2. **TypeScript カスタムコマンド**（`#tryExecuteCustomCommand`）  
   境界のみ: 一致した場合、実行されて以下を返す可能性があります:
   - `string` → プロンプトテキストをその文字列で置き換え
   - `void/undefined` → 処理済みとして扱われ、LLM プロンプトなし
3. **ファイルベースのスラッシュコマンド**（`expandSlashCommand`）  
   テキストが引き続き `/` で始まる場合、マークダウンコマンドの展開を試みます。
4. **プロンプトテンプレート**（`expandPromptTemplate`）  
   スラッシュ/カスタム処理の後に適用されます。
5. **デリバリー**
   - アイドル: プロンプトは即座にエージェントに送信されます
   - ストリーミング: `streamingBehavior` に応じてプロンプトはステア/フォローアップとしてキューに入れられます

これが、スラッシュコマンド展開がプロンプトテンプレート展開より前に行われる理由であり、カスタムコマンドがファイルコマンドマッチングの前に先頭のスラッシュを変換できる理由です。

## 6) ファイルベースのスラッシュコマンドの展開セマンティクス

`expandSlashCommand(text, fileCommands)` の動作:

- テキストが `/` で始まる場合にのみ実行されます
- `/` の後の最初のトークンからコマンド名を解析します
- `parseCommandArgs` を通じて残りのテキストから引数を解析します
- 読み込み済みの `fileCommands` で完全名前一致を検索します
- 一致した場合、以下を適用します:
  - 位置による置換: `$1`、`$2`、...
  - 集約置換: `$ARGUMENTS` および `$@`
  - 次に `{ args, ARGUMENTS, arguments }` を使用した `prompt.render` によるテンプレートレンダリング
- 一致しない場合、元のテキストを変更せずに返します

### `parseCommandArgs` の注意事項

パーサーは単純なクォート対応の分割を行います:

- スペースを維持するために `'シングル'` と `"ダブル"` クォートをサポート
- クォートの区切り文字を除去します
- バックスラッシュエスケープルールを実装していません
- 対応していないクォートはエラーになりません。パーサーは末尾まで読み込みます

## 7) 不明な `/...` の動作

不明なスラッシュ入力はコアのスラッシュロジックによって**拒否されません**。

コマンドが拡張機能/カスタム/ファイルのいずれのレイヤーでも処理されない場合、`expandSlashCommand` は元のテキストを返し、そのままの `/...` プロンプトは通常のプロンプトテンプレート展開と LLM デリバリーを経由します。

インタラクティブモードでは、`InputController` 内で多くの組み込みコマンド（例: `/settings`、`/model`、`/mcp`、`/move`、`/exit`）が個別にハードハンドリングされます。これらは `session.prompt(...)` より前に消費されるため、そのパスではファイルコマンド展開に到達しません。

## 8) ストリーミング時とアイドル時の違い

## アイドルパス

- `session.prompt("/x ...")` がコマンドパイプラインを実行し、コマンドを即座に実行するか、展開済みテキストを直接送信します。

## ストリーミングパス（`session.isStreaming === true`）

- `prompt(...)` は引き続き拡張機能/カスタム/ファイル/テンプレートの変換を先に実行します
- その後、`streamingBehavior` が必要です:
  - `"steer"` → 割り込みメッセージをキューに入れます（`agent.steer`）
  - `"followUp"` → ターン後のメッセージをキューに入れます（`agent.followUp`）
- `streamingBehavior` が省略された場合、プロンプトはエラーをスローします

### コマンド固有の重要なストリーミング動作

- 拡張機能コマンドはストリーミング中でも即座に実行されます（テキストとしてキューに入れられません）。
- `steer(...)`/`followUp(...)` ヘルパーメソッドは拡張機能コマンドを拒否します（`#throwIfExtensionCommand`）。これは、同期的に実行しなければならないハンドラーのためにコマンドテキストがキューに入れられないようにするためです。
- コンパクションキューのリプレイは `isKnownSlashCommand(...)` を使用して、キューに入れられたエントリを `session.prompt(...)` 経由でリプレイするか（既知のスラッシュコマンドの場合）、生のステア/フォローアップメソッドを使用するかを決定します。

## 9) エラー処理と障害の発生箇所

- プロバイダーの読み込み失敗は分離されており、レジストリは警告を収集して他のプロバイダーの処理を続行します。
- 無効なスラッシュコマンドアイテム（名前/パス/コンテンツの欠落、または無効なレベル）はケイパビリティの検証によってドロップされます。
- フロントマター解析の失敗:
  - ネイティブコマンド: 致命的な解析エラーがバブルします
  - 非ネイティブコマンド: 警告 + フォールバックキー/バリュー解析
- 拡張機能/カスタムコマンドのハンドラー例外はキャッチされ、拡張機能エラーチャネル経由で報告されます（拡張機能ランナーのないカスタムコマンドの場合はロガーフォールバック）。処理済みとして扱われ、意図しないフォールバック実行は行われません。
