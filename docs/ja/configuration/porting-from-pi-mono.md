---
title: pi-mono からの移植：実践的マージガイド
description: pi-mono モノリポからの xcsh コードベースへのコード移行に関する実践的ガイドです。
sidebar:
  order: 9
  label: pi-mono からの移植
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# pi-mono からの移植：実践的マージガイド

このガイドは、pi-mono からこのリポジトリへ変更を移植するための再利用可能なチェックリストです。
単一ファイル、フィーチャーブランチ、フルリリース同期など、あらゆるマージに使用してください。

## 最終同期ポイント

**コミット:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**日付:** 2026-03-22

各同期の後にこのセクションを更新してください。前回の範囲を再利用しないでください。

新しい同期を開始する際は、このコミットから先のパッチを生成します：

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) スコープを定義する

- アップストリームの参照（コミット、タグ、または PR）を特定する。
- 変更を予定しているパッケージやフォルダをリストアップする。
- どの機能がスコープ内で、どの機能を意図的にスキップするかを決定する。

## 1) コードを安全に持ち込む

- 丸ごとコピーではなく、クリーンで焦点を絞った diff を優先する。
- ビルド成果物や生成ファイルのコピーを避ける。
- アップストリームが新しいファイルを追加した場合は、明示的に追加し内容をレビューする。

## 2) インポート拡張子の規約に合わせる

ほとんどのランタイム TypeScript ソースは内部インポートで `.js` を省略しますが、一部の test/bench エントリーポイントは ESM ランタイム互換性のために `.js` を保持しています。ローカルパッケージの既存スタイルに従い、拡張子を一括で除去しないでください。

- `packages/coding-agent` のランタイムソースでは、非 TS アセットのインポートでない限り、内部インポートは拡張子なしにする。
- `packages/tui/test` と `packages/natives/bench` では、周囲のファイルが既に使用している場合は `.js` を保持する。
- ツールが要求する場合は実際のファイル拡張子を保持する（例：`.json`、`.css`、`.md` テキスト埋め込み）。
- 例：`import { x } from "./foo.js";` → `import { x } from "./foo";`（パッケージの規約が拡張子なしの場合のみ）。

## 3) インポートスコープを置換する

アップストリームは異なるパッケージスコープを使用しています。一貫して置換してください。

- 古いスコープをここで使用されているローカルスコープに置換する。
- 例（移植する実際のパッケージに合わせて調整してください）：
  - `@mariozechner/pi-coding-agent` → `@f5-sales-demo/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5-sales-demo/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5-sales-demo/pi-tui`
  - `@mariozechner/pi-ai` → `@f5-sales-demo/pi-ai`

## 4) Bun API が Node より優れている場合は Bun API を使用する

Bun 上で実行します。Bun がより良い代替手段を提供する場合にのみ Node API を置換してください。

**置換するもの：**

- プロセス生成：`child_process.spawn` → 簡単なコマンドには Bun Shell `$`、ストリーミングや長時間実行には `Bun.spawn`/`Bun.spawnSync`
- ファイル I/O：`fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP クライアント：`node-fetch`、`axios` → ネイティブ `fetch`
- 暗号ハッシュ：`node:crypto` → Web Crypto または `Bun.hash`
- SQLite：`better-sqlite3` → `bun:sqlite`
- Env 読み込み：`dotenv` → Bun は `.env` を自動的に読み込む

**置換しないもの（Bun でも問題なく動作します）：**

- `os.homedir()` — `Bun.env.HOME`、`Bun.env.HOME`、またはリテラル `"~"` に置換しない
- `os.tmpdir()` — `Bun.env.TMPDIR || "/tmp"` やハードコードされたパスに置換しない
- `fs.mkdtempSync()` — 手動パス構築に置換しない
- `path.join()`、`path.resolve()` など — これらは問題ない

**インポートスタイル：** `node:` プレフィックスを名前空間インポートでのみ使用する（`node:fs` や `node:path` からの名前付きインポートは使わない）。

**追加の Bun 規約：**

- 短い非ストリーミングコマンドには Bun Shell `$` を優先する。ストリーミング I/O やプロセス制御が必要な場合にのみ `Bun.spawn` を使用する。
- ファイルには `Bun.file()`/`Bun.write()` を、ディレクトリには `node:fs/promises` を使用する。
- `Bun.file().exists()` チェックを避ける。try/catch で `isEnoent` ハンドリングを使用する。
- `setTimeout` ラッパーより `Bun.sleep(ms)` を優先する。

**誤り：**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**正しい：**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Bun エンベッドを優先する（コピーしない）

ビルド時にランタイムアセットやベンダーファイルをコピーしないでください。

- アップストリームがアセットを dist フォルダにコピーしている場合、Bun フレンドリーなエンベッドに置換する。
- プロンプトは静的な `.md` ファイルです。インラインプロンプト文字列の代わりに Bun テキストインポート（`with { type: "text" }`）と Handlebars を使用する。
- 隣接する非テキストリソースの読み込みには `import.meta.dir` + `Bun.file` を使用する。
- アセットをリポジトリ内に保持し、バンドラーに含めさせる。
- ユーザーが明示的に要求しない限り、コピースクリプトを排除する。
- アップストリームが実行時にバンドルされたフォールバックファイルを読み込んでいる場合、ファイルシステム読み込みを Bun テキストエンベッドインポートに置換する。
  - 例（Codex instructions フォールバック）：
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` → 削除
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - `readFileSync(FALLBACK_PROMPT_PATH, "utf8")` の代わりに `return FALLBACK_INSTRUCTIONS;` を使用

## 6) `package.json` を慎重に移植する

`package.json` はコントラクトとして扱います。意図的にマージしてください。

- 移植で変更が必要な場合を除き、既存の `name`、`version`、`type`、`exports`、`bin` を保持する。
- npm/node スクリプトを Bun 同等のものに置換する（例：`bun check`、`bun test`）。
- 依存関係が正しいスコープを使用していることを確認する。
- 型エラーを修正するために依存関係をダウングレードしない。代わりにアップグレードする。
- ワークスペースパッケージリンクと `peerDependencies` を検証する。

## 7) コードスタイルとツールを揃える

- 既存のフォーマット規約を保持する。
- 必要でない限り `any` を導入しない。
- 動的インポートやインライン型インポートを避ける。トップレベルインポートのみを使用する。
- コード内でプロンプトを構築しない。プロンプトは Handlebars でレンダリングされる静的な `.md` ファイルです。
- coding-agent では `console.log`/`console.warn`/`console.error` を使用しない。`@f5-sales-demo/pi-utils` の `logger` を使用する。
- `new Promise((resolve, reject) => ...)` の代わりに `Promise.withResolvers()` を使用する。
- **クラスフィールドやメソッドに `private`/`protected`/`public` キーワードを使用しない。** カプセル化には ES `#` プライベートフィールドを使用し、アクセス可能なメンバーはキーワードなし（bare）にする。唯一の例外はコンストラクタパラメータプロパティ（`constructor(private readonly x: T)`）で、TypeScript が要求するためキーワードが必要です。アップストリームコードで `private foo` や `protected bar` を使用している場合、`#foo`（プライベート）または bare `bar`（アクセス可能）に変換する。
- 新しいアドホックコードよりも既存のヘルパーやユーティリティを優先する。
- このリポジトリで既に行われた Bun ファーストのインフラ変更を維持する：
  - ランタイムは Bun（Node エントリーポイントなし）。
  - パッケージマネージャーは Bun（npm ロックファイルなし）。
  - 重い Node API（`child_process`、`readline`）は Bun 同等のものに置換済み。
  - 軽量な Node API（`os.homedir`、`os.tmpdir`、`fs.mkdtempSync`、`path.*`）は保持。
  - CLI の shebang は `bun` を使用（`node` でも `tsx` でもない）。
  - パッケージはソースファイルを直接使用（TypeScript ビルドステップなし）。
  - CI ワークフローはインストール/チェック/テストに Bun を実行。

## 8) 古い互換性レイヤーを削除する

要求されない限り、アップストリームの互換性シムを削除してください。

- 置換された古い API を削除する。
- すべての呼び出し箇所を新しい API に直接更新する。
- `*_v2` や並列バージョンを保持しない。

## 9) ドキュメントと参照を更新する

- 適切な箇所で pi-mono リポジトリのリンクを置換する。
- サンプルを Bun と正しいパッケージスコープを使用するように更新する。
- README の手順が現在のリポジトリの動作と一致していることを確認する。

## 10) 移植を検証する

変更後に標準チェックを実行する：

- `bun check`

変更に関係のない既存の失敗チェックがある場合は、それを明示的に指摘してください。
テストは Bun のランナーを使用します（Vitest ではありません）が、明示的に要求された場合にのみ `bun test` を実行してください。

## 11) 改善された機能を保護する（リグレッショントラップリスト）

ローカルで既に動作を改善している場合、それらを**交渉不可**として扱ってください。移植前に改善点を書き出し、マージで失われないように明示的なチェックを追加してください。

- **期待される動作を凍結する**：各改善点について短い「移植前/移植後」のメモを追加する（入力、出力、デフォルト値、エッジケース）。これにより暗黙のロールバックを防止します。
- **旧 → 新 API をマッピングする**：アップストリームが概念名を変更した場合（hooks → extensions、custom tools → tools など）、すべての古いエントリーポイントが正しく接続されていることを確認する。1 つのフラグやエクスポートの見落としが機能喪失を意味します。
- **エクスポートを検証する**：`package.json` の `exports`、公開型、バレルファイルを確認する。アップストリームからの移植では、ローカルの追加機能の再エクスポートを忘れがちです。
- **非ハッピーパスをカバーする**：エラーハンドリング、タイムアウト、フォールバックロジックを修正した場合、テストまたは少なくともそれらのパスを実行する手動チェックリストを追加する。
- **デフォルト値と設定マージ順序を確認する**：改善はデフォルト値に存在することが多い。新しいデフォルトが元に戻っていないことを確認する（例：新しい設定の優先順位、無効化された機能、ツールリスト）。
- **env/shell 動作を監査する**：実行やサンドボックスを修正した場合、新しいパスが依然としてサニタイズされた env を使用し、エイリアス/関数オーバーライドを再導入していないことを確認する。
- **対象サンプルを再実行する**：「正常動作確認済み」のサンプルの最小セットを保持し、移植後にそれらを実行する（CLI フラグ、拡張機能の登録、ツールの実行）。

## 12) リワークされたコードを検出して対処する

ファイルを移植する前に、アップストリームが大幅にリファクタリングしたかどうかを確認してください：

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

diff がファイルが**リワーク**された（単なるパッチではない）ことを示している場合：

- 新しい抽象化、名前変更された概念、統合されたモジュール、変更されたデータフロー

移植前に**新しい実装を徹底的に読む**必要があります。リワークされたコードのブラインドマージは機能を失います。理由は以下の通りです：

注意：インタラクティブモードは最近 controllers/utils/types に分割されました。関連する変更をバックポートする際は、作成した個別ファイルに更新を移植し、`interactive-mode.ts` の配線が同期していることを確認してください。

1. **デフォルトが暗黙的に変更される** - 新しい変数 `defaultFoo = [a, b]` が、`[a, b, c, d, e]` を返していた古い `getAllFoo()` を置換する可能性があります。

2. **API オプションが欠落する** - システムが統合される場合（例：`hooks` + `customTools` → `extensions`）、古いオプションが新しい実装に接続されない可能性があります。

3. **コードパスが陳腐化する** - 名前変更された概念（例：`hookMessage` → `custom`）は、定義だけでなく、すべての switch 文、型ガード、ハンドラーでの更新が必要です。

4. **コンテキスト/ケイパビリティが縮小する** - 古い API が公開していた `{ logger, typebox, pi }` を新しい API が含め忘れている可能性があります。

### セマンティック移植プロセス

アップストリームがモジュールをリワークした場合：

1. **古い実装を読む** - 何をしていたか、どのオプションを受け入れていたか、何を公開していたかを理解する。

2. **新しい実装を読む** - 新しい抽象化と、それが古い動作にどのようにマッピングされるかを理解する。

3. **機能パリティを検証する** - 古いコードの各ケイパビリティについて、新しいコードがそれを保持しているか、明示的に削除しているかを確認する。

4. **残存を grep する** - switch 文、ハンドラー、UI コンポーネントで見落とされた可能性のある古い名前/概念を検索する。

5. **境界をテストする** - CLI フラグ、SDK オプション、イベントハンドラー、デフォルト値 — これらがリグレッションの潜伏場所です。

### クイックチェック

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) クイック監査チェックリスト

完了前の最終パスとして使用してください：

- [ ] インポート拡張子がローカルパッケージの規約に従っている（`.js` の一括除去なし）
- [ ] 新規/移植コードに Node 専用 API がない
- [ ] すべてのパッケージスコープが更新されている
- [ ] `package.json` スクリプトが Bun を使用している
- [ ] プロンプトが `.md` テキストインポートである（インラインプロンプト文字列なし）
- [ ] coding-agent に `console.*` がない（`logger` を使用）
- [ ] アセットが Bun エンベッドパターンで読み込まれている（コピースクリプトなし）
- [ ] テストまたはチェックが実行される（またはブロックされていることが明示的に記載されている）
- [ ] 機能リグレッションがない（セクション 11-12 を参照）

## 14) コミットメッセージフォーマット

バックポートをコミットする際は、リポジトリフォーマット `<type>(scope): <past-tense description>` に従い、コミット範囲をタイトルに含めてください。

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**例：**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**ルール：**

- パッケージごとに変更をグループ化する
- Conventional Commit のタイプを使用する（`fix`、`feat`、`refactor`、`perf`、`docs`）
- 外部コントリビューションにはアップストリームの issue/PR 番号とコントリビューターの帰属を含める
- タイトルのコミット範囲は同期ポイントの追跡に役立つ

## 15) 意図的な分岐

当フォークにはアップストリームと異なるアーキテクチャ上の決定があります。**以下のアップストリームパターンは移植しないでください：**

### UI アーキテクチャ

| アップストリーム                                    | 当フォーク                                                  | 理由                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` クラス                  | `StatusLineComponent`                                     | よりシンプルで統合されたステータスライン                                       |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | 非 TUI モードではスタブ                                     | TUI で実装済み、それ以外では no-op                                   |
| `ctx.ui.setEditorComponent()`               | 非 TUI モードではスタブ                                     | TUI で実装済み、それ以外では no-op                                   |
| `InteractiveModeOptions` オプションオブジェクト     | 位置引数コンストラクタ（options 型はエクスポート維持） | コンストラクタシグネチャを維持。アップストリームがフィールド追加時に型を更新 |

### コンポーネント命名

| アップストリーム                     | 当フォーク                |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API 命名

| アップストリーム                                 | 当フォーク                                 | 備考                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | 全体で `sessionName` を使用           |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | 同じ（アップストリームの RPC に合わせて統一済み） |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | 同じ                                      |

### ファイル統合

| アップストリーム                                           | 当フォーク                                | 理由                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts`（ツールファイル） | `@f5-sales-demo/pi-natives` clipboard モジュール | N-API ネイティブ実装に統合 |

### テストフレームワーク

| アップストリーム                  | 当フォーク                      |
| ------------------------- | ----------------------------- |
| `vitest` と `vi.mock()` | `bun:test` と bun の `vi` |
| `node:test` アサーション    | `expect()` マッチャー           |

### ツールアーキテクチャ

| アップストリーム                            | 当フォーク                                                          | 備考                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` via `BUILTIN_TOOLS` レジストリ  | ツールファクトリは `ToolSession` を受け取り `null` を返せる |
| ツールごとの `*Operations` インターフェース   | ツールごとのインターフェースは維持（`FindOperations`、`GrepOperations`）   | SSH/リモートオーバーライドに使用                             |
| Node.js `fs/promises` を全面使用    | ファイルには `Bun.file()`/`Bun.write()`、ディレクトリには `node:fs/promises` | 簡素化できる場合は Bun API を優先                        |

### 認証ストレージ

| アップストリーム                        | 当フォーク                                    | 備考                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | 認証情報は `agent.db` に排他的に保存 |
| プロバイダーごとに単一認証情報  | ラウンドロビン選択による複数認証情報 | セッションアフィニティとバックオフロジックは維持 |

### エクステンション

| アップストリーム                      | 当フォーク                                   |
| ----------------------------- | ------------------------------------------ |
| TypeScript 読み込みに `jiti` | ネイティブ Bun `import()`                      |
| `pkg.pi` マニフェストフィールド       | `pkg.xcsh ?? pkg.pi`（当名前空間を優先） |

### スキップすべきアップストリーム機能

移植時に、以下のファイル/機能は**完全にスキップ**してください：

- `footer-data-provider.ts` — StatusLineComponent を使用しています
- `clipboard-image.ts` — clipboard は `@f5-sales-demo/pi-natives` N-API モジュールにあります
- GitHub ワークフローファイル — 独自の CI があります
- `models.generated.ts` — 自動生成のため、ローカルで再生成（代わりに models.json として）

### 当フォークで追加した機能（これらを保持する）

以下は当フォークに存在しますがアップストリームには存在しません。**絶対に上書きしないでください：**

- インタラクティブモードの `StatusLineComponent`
- セッションアフィニティ付き複数認証情報
- ケイパビリティベースのディスカバリシステム（`defineCapability`、`registerProvider`、`loadCapability`、`skillCapability` など）
- MCP/Exa/SSH 統合
- フォーマット・オン・セーブの LSP ライトスルー
- Bash インターセプション（`checkBashInterception`）
- read ツールでのファジーパスサジェスチョン
