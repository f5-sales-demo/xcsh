---
title: pi-mono からの移植：実践的なマージガイド
description: pi-mono モノリポからの xcsh コードベースへのコード移行に関する実践ガイド。
sidebar:
  order: 9
  label: pi-mono からの移植
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# pi-mono からの移植：実践的なマージガイド

このガイドは、pi-mono からこのリポジトリに変更を移植するための再利用可能なチェックリストです。
単一ファイル、フィーチャーブランチ、フルリリース同期など、あらゆるマージに使用してください。

## 最終同期ポイント

**コミット:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**日付:** 2026-03-22

各同期後にこのセクションを更新してください。前回の範囲を再利用しないでください。

新しい同期を開始する際は、このコミット以降のパッチを生成します：

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) スコープを定義する

- アップストリームの参照（コミット、タグ、または PR）を特定する。
- 変更予定のパッケージまたはフォルダをリストアップする。
- スコープ内の機能と意図的にスキップする機能を決定する。

## 1) コードを安全に持ち込む

- 丸ごとコピーではなく、クリーンで焦点を絞った差分を優先する。
- ビルド成果物や生成されたファイルのコピーを避ける。
- アップストリームが新しいファイルを追加した場合は、明示的に追加して内容をレビューする。

## 2) インポート拡張子の規約に合わせる

ほとんどのランタイム TypeScript ソースは内部インポートで `.js` を省略しますが、一部のテスト/ベンチマークのエントリポイントでは ESM ランタイム互換性のために `.js` を維持しています。ローカルパッケージの既存のスタイルに従い、拡張子を一律に削除しないでください。

- `packages/coding-agent` のランタイムソースでは、非 TS アセットをインポートする場合を除き、内部インポートを拡張子なしにする。
- `packages/tui/test` と `packages/natives/bench` では、周囲のファイルが既に `.js` を使用している場合はそのまま維持する。
- ツールが要求する場合は実際のファイル拡張子を維持する（例：`.json`、`.css`、`.md` テキスト埋め込み）。
- 例：`import { x } from "./foo.js";` → `import { x } from "./foo";`（パッケージの規約が拡張子なしの場合のみ）。

## 3) インポートスコープを置換する

アップストリームは異なるパッケージスコープを使用しています。一貫して置換してください。

- 古いスコープをここで使用されているローカルスコープに置換する。
- 例（移植する実際のパッケージに合わせて調整）：
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Bun API が Node より優れている場合は使用する

Bun 上で実行しています。Bun がより良い代替手段を提供する場合にのみ Node API を置換してください。

**置換すべきもの：**

- プロセス起動：`child_process.spawn` → 単純なコマンドには Bun Shell `$`、ストリーミングや長時間実行の作業には `Bun.spawn`/`Bun.spawnSync`
- ファイル I/O：`fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP クライアント：`node-fetch`、`axios` → ネイティブ `fetch`
- 暗号ハッシュ：`node:crypto` → Web Crypto または `Bun.hash`
- SQLite：`better-sqlite3` → `bun:sqlite`
- 環境変数読み込み：`dotenv` → Bun は `.env` を自動的に読み込む

**置換してはいけないもの（これらは Bun で問題なく動作する）：**

- `os.homedir()` — `Bun.env.HOME`、`Bun.env.HOME`、またはリテラル `"~"` に置換してはいけない
- `os.tmpdir()` — `Bun.env.TMPDIR || "/tmp"` やハードコードされたパスに置換してはいけない
- `fs.mkdtempSync()` — 手動パス構築に置換してはいけない
- `path.join()`、`path.resolve()` など — これらはそのままで問題ない

**インポートスタイル：** `node:` プレフィックスは名前空間インポートでのみ使用する（`node:fs` や `node:path` からの名前付きインポートは使用しない）。

**追加の Bun 規約：**

- 短い非ストリーミングコマンドには Bun Shell `$` を優先する。ストリーミング I/O やプロセス制御が必要な場合にのみ `Bun.spawn` を使用する。
- ファイルには `Bun.file()`/`Bun.write()`、ディレクトリには `node:fs/promises` を使用する。
- `Bun.file().exists()` チェックは避け、try/catch で `isEnoent` ハンドリングを使用する。
- `setTimeout` ラッパーより `Bun.sleep(ms)` を優先する。

**誤った例：**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**正しい例：**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Bun 埋め込みを優先する（コピーなし）

ビルド時にランタイムアセットやベンダーファイルをコピーしないでください。

- アップストリームがアセットを dist フォルダにコピーしている場合は、Bun フレンドリーな埋め込みに置換する。
- プロンプトは静的な `.md` ファイルです。インラインプロンプト文字列の代わりに、Bun テキストインポート（`with { type: "text" }`）と Handlebars を使用してください。
- 隣接する非テキストリソースの読み込みには `import.meta.dir` + `Bun.file` を使用する。
- アセットをリポジトリ内に保持し、バンドラーに含めさせる。
- ユーザーが明示的に要求しない限り、コピースクリプトを排除する。
- アップストリームがランタイムでバンドルされたフォールバックファイルを読み込む場合、ファイルシステム読み取りを Bun テキスト埋め込みインポートに置換する。
  - 例（Codex instructions のフォールバック）：
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` → 削除
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - `readFileSync(FALLBACK_PROMPT_PATH, "utf8")` の代わりに `return FALLBACK_INSTRUCTIONS;` を使用

## 6) `package.json` は慎重に移植する

`package.json` はコントラクトとして扱ってください。意図的にマージしてください。

- 移植で変更が必要でない限り、既存の `name`、`version`、`type`、`exports`、`bin` を維持する。
- npm/node スクリプトを Bun 等価物に置換する（例：`bun check`、`bun test`）。
- 依存関係が正しいスコープを使用していることを確認する。
- 型エラーを修正するために依存関係をダウングレードしない。代わりにアップグレードする。
- ワークスペースパッケージリンクと `peerDependencies` を検証する。

## 7) コードスタイルとツールを統一する

- 既存のフォーマット規約を維持する。
- 必要でない限り `any` を導入しない。
- 動的インポートやインライン型インポートを避け、トップレベルインポートのみを使用する。
- コード内でプロンプトを構築しない。プロンプトは Handlebars でレンダリングされる静的な `.md` ファイルです。
- coding-agent では `console.log`/`console.warn`/`console.error` を使用しない。`@f5xc-salesdemos/pi-utils` の `logger` を使用する。
- `new Promise((resolve, reject) => ...)` の代わりに `Promise.withResolvers()` を使用する。
- **クラスフィールドやメソッドに `private`/`protected`/`public` キーワードを使用しない。** カプセル化には ES `#` プライベートフィールドを使用し、アクセス可能なメンバーはキーワードなし（bare）のままにする。唯一の例外はコンストラクタパラメータプロパティ（`constructor(private readonly x: T)`）で、TypeScript が必要とする場合です。アップストリームコードが `private foo` や `protected bar` を使用している場合、`#foo`（プライベート）または bare の `bar`（アクセス可能）に変換してください。
- 新しいアドホックコードよりも既存のヘルパーやユーティリティを優先する。
- このリポジトリで既に行われている Bun ファーストのインフラストラクチャ変更を保持する：
  - ランタイムは Bun（Node エントリポイントなし）。
  - パッケージマネージャは Bun（npm ロックファイルなし）。
  - 重い Node API（`child_process`、`readline`）は Bun 等価物に置換済み。
  - 軽量な Node API（`os.homedir`、`os.tmpdir`、`fs.mkdtempSync`、`path.*`）は維持。
  - CLI shebang は `bun` を使用（`node` や `tsx` ではない）。
  - パッケージはソースファイルを直接使用（TypeScript ビルドステップなし）。
  - CI ワークフローはインストール/チェック/テストに Bun を実行。

## 8) 古い互換レイヤーを削除する

要求されない限り、アップストリームの互換シムを削除してください。

- 置換された古い API を削除する。
- すべての呼び出し箇所を新しい API に直接更新する。
- `*_v2` や並列バージョンを維持しない。

## 9) ドキュメントと参照を更新する

- 適切な箇所で pi-mono リポジトリのリンクを置換する。
- 例を Bun と正しいパッケージスコープを使用するように更新する。
- README の説明が現在のリポジトリの動作と一致していることを確認する。

## 10) 移植を検証する

変更後に標準チェックを実行する：

- `bun check`

リポジトリに変更とは無関係な既存の失敗チェックがある場合は、それを指摘してください。
テストは Bun のランナーを使用しますが（Vitest ではない）、`bun test` は明示的に要求された場合にのみ実行してください。

## 11) 改善された機能を保護する（リグレッショントラップリスト）

ローカルで既に動作を改善している場合、それらを**交渉の余地なし**として扱ってください。移植前に改善点を書き留め、マージで失われないよう明示的なチェックを追加してください。

- **期待される動作を固定する**：各改善点について短い「前/後」のメモを追加する（入力、出力、デフォルト、エッジケース）。これによりサイレントなロールバックを防止します。
- **旧 → 新 API をマッピングする**：アップストリームがコンセプトの名前を変更した場合（hooks → extensions、custom tools → tools など）、すべての古いエントリポイントが引き続き機能することを確認する。フラグやエクスポートを1つ見逃すだけで機能が失われます。
- **エクスポートを検証する**：`package.json` の `exports`、パブリック型、バレルファイルを確認する。アップストリームの移植ではローカルの追加を再エクスポートし忘れることがよくあります。
- **ハッピーパス以外をカバーする**：エラーハンドリング、タイムアウト、フォールバックロジックを修正した場合、テストまたは少なくともそれらのパスを実行する手動チェックリストを追加する。
- **デフォルトと設定マージ順序を確認する**：改善はしばしばデフォルトに存在します。新しいデフォルトが元に戻っていないことを確認する（例：新しい設定の優先順位、無効化された機能、ツールリスト）。
- **環境/シェルの動作を監査する**：実行やサンドボックスを修正した場合、新しいパスがサニタイズされた環境を使用し、エイリアス/関数のオーバーライドを再導入していないことを確認する。
- **ターゲットサンプルを再実行する**：「正常動作確認済み」の最小限の例セットを維持し、移植後にそれらを実行する（CLI フラグ、エクステンション登録、ツール実行）。

## 12) リワークされたコードを検出して処理する

ファイルを移植する前に、アップストリームが大幅にリファクタリングしたかどうかを確認する：

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

差分がファイルが**リワークされた**（単なるパッチではない）ことを示している場合：

- 新しい抽象化、名前変更されたコンセプト、統合されたモジュール、変更されたデータフロー

その場合、移植前に**新しい実装を徹底的に読む**必要があります。リワークされたコードのブラインドマージは、以下の理由で機能を失います：

注意：インタラクティブモードは最近コントローラー/ユーティリティ/型に分割されました。関連する変更をバックポートする際は、作成した個別のファイルに更新を移植し、`interactive-mode.ts` の配線が同期していることを確認してください。

1. **デフォルトがサイレントに変更される** - 新しい変数 `defaultFoo = [a, b]` が、`[a, b, c, d, e]` を返していた古い `getAllFoo()` を置換する可能性があります。

2. **API オプションが削除される** - システムが統合される場合（例：`hooks` + `customTools` → `extensions`）、古いオプションが新しい実装に配線されない可能性があります。

3. **コードパスが陳腐化する** - 名前が変更されたコンセプト（例：`hookMessage` → `custom`）は、定義だけでなく、すべての switch 文、型ガード、ハンドラーで更新が必要です。

4. **コンテキスト/機能が縮小する** - 古い API は `{ logger, typebox, pi }` を公開していたかもしれませんが、新しい API はそれを含め忘れている可能性があります。

### セマンティック移植プロセス

アップストリームがモジュールをリワークした場合：

1. **古い実装を読む** - 何をしていたか、どのオプションを受け入れていたか、何を公開していたかを理解する。

2. **新しい実装を読む** - 新しい抽象化と、それらが古い動作にどうマッピングされるかを理解する。

3. **機能パリティを検証する** - 古いコードの各機能について、新しいコードがそれを保持しているか、明示的に削除しているかを確認する。

4. **残存物を検索する** - switch 文、ハンドラー、UI コンポーネントで見逃された可能性のある古い名前/コンセプトを検索する。

5. **境界をテストする** - CLI フラグ、SDK オプション、イベントハンドラー、デフォルト値 — これらがリグレッションが隠れる場所です。

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

- [ ] インポート拡張子がローカルパッケージの規約に従っている（一律の `.js` 削除なし）
- [ ] 新規/移植コードに Node 専用 API がない
- [ ] すべてのパッケージスコープが更新済み
- [ ] `package.json` スクリプトが Bun を使用
- [ ] プロンプトが `.md` テキストインポートである（インラインプロンプト文字列なし）
- [ ] coding-agent に `console.*` がない（`logger` を使用）
- [ ] アセットが Bun 埋め込みパターンで読み込まれる（コピースクリプトなし）
- [ ] テストまたはチェックが実行される（またはブロックされていることが明示的に記載）
- [ ] 機能のリグレッションがない（セクション 11-12 を参照）

## 14) コミットメッセージ形式

バックポートをコミットする際は、リポジトリ形式 `<type>(scope): <past-tense description>` に従い、コミット範囲をタイトルに含めてください。

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

- 変更をパッケージごとにグループ化する
- コンベンショナルコミットタイプを使用する（`fix`、`feat`、`refactor`、`perf`、`docs`）
- 外部コントリビューションにはアップストリームの issue/PR 番号とコントリビューターの帰属を含める
- タイトルのコミット範囲は同期ポイントの追跡に役立つ

## 15) 意図的な差異

私たちのフォークにはアップストリームとは異なるアーキテクチャ上の決定があります。**以下のアップストリームパターンは移植しないでください：**

### UI アーキテクチャ

| アップストリーム                                    | 私たちのフォーク                                                  | 理由                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` クラス                  | `StatusLineComponent`                                     | よりシンプルな統合ステータスライン                                       |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | 非 TUI モードではスタブ                                     | TUI で実装済み、その他では no-op                                   |
| `ctx.ui.setEditorComponent()`               | 非 TUI モードではスタブ                                     | TUI で実装済み、その他では no-op                                   |
| `InteractiveModeOptions` オプションオブジェクト     | 位置引数のコンストラクタ（オプション型はエクスポート維持） | コンストラクタシグネチャを維持。アップストリームがフィールドを追加した場合は型を更新 |

### コンポーネント命名

| アップストリーム                     | 私たちのフォーク                |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API 命名

| アップストリーム                                 | 私たちのフォーク                                 | 備考                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | 全体で `sessionName` を使用           |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | 同じ（アップストリームの RPC に合わせて統一） |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | 同じ                                      |

### ファイル統合

| アップストリーム                                           | 私たちのフォーク                                | 理由                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts`（ツールファイル） | `@f5xc-salesdemos/pi-natives` clipboard モジュール | N-API ネイティブ実装に統合 |

### テストフレームワーク

| アップストリーム                  | 私たちのフォーク                      |
| ------------------------- | ----------------------------- |
| `vitest` と `vi.mock()` | `bun:test` と bun の `vi` |
| `node:test` アサーション    | `expect()` マッチャー           |

### ツールアーキテクチャ

| アップストリーム                            | 私たちのフォーク                                                          | 備考                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` via `BUILTIN_TOOLS` レジストリ  | ツールファクトリは `ToolSession` を受け取り `null` を返すことが可能 |
| ツールごとの `*Operations` インターフェース   | ツールごとのインターフェースは維持（`FindOperations`、`GrepOperations`）   | SSH/リモートオーバーライドに使用                             |
| あらゆる箇所で Node.js `fs/promises`    | ファイルには `Bun.file()`/`Bun.write()`、ディレクトリには `node:fs/promises` | 簡素化できる場合は Bun API を優先                        |

### 認証ストレージ

| アップストリーム                        | 私たちのフォーク                                    | 備考                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | 認証情報は `agent.db` に排他的に保存 |
| プロバイダーごとに単一の認証情報  | ラウンドロビン選択による複数認証情報 | セッションアフィニティとバックオフロジックを保持 |

### エクステンション

| アップストリーム                      | 私たちのフォーク                                   |
| ----------------------------- | ------------------------------------------ |
| TypeScript 読み込みに `jiti` | ネイティブ Bun `import()`                      |
| `pkg.pi` マニフェストフィールド       | `pkg.xcsh ?? pkg.pi`（私たちの名前空間を優先） |

### スキップすべきアップストリーム機能

移植時に、以下のファイル/機能は**完全にスキップ**してください：

- `footer-data-provider.ts` — StatusLineComponent を使用しているため
- `clipboard-image.ts` — clipboard は `@f5xc-salesdemos/pi-natives` N-API モジュールにあるため
- GitHub ワークフローファイル — 独自の CI があるため
- `models.generated.ts` — 自動生成されるため、ローカルで再生成する（代わりに models.json として）

### 私たちが追加した機能（これらを保持する）

以下は私たちのフォークに存在するがアップストリームにはない機能です。**絶対に上書きしないでください：**

- インタラクティブモードの `StatusLineComponent`
- セッションアフィニティ付き複数認証情報
- ケイパビリティベースのディスカバリーシステム（`defineCapability`、`registerProvider`、`loadCapability`、`skillCapability` など）
- MCP/Exa/SSH 統合
- フォーマットオンセーブの LSP ライトスルー
- Bash インターセプション（`checkBashInterception`）
- read ツールのファジーパスサジェスション
