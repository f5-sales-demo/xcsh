---
title: pi-monoからの移植：実践的マージガイド
description: pi-monoモノレポからxcshコードベースへのコード移行に関する実践ガイド。
sidebar:
  order: 9
  label: pi-monoからの移植
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# pi-monoからの移植：実践的マージガイド

このガイドは、pi-monoからこのリポジトリへ変更を移植するための再利用可能なチェックリストです。
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

- 上流の参照（コミット、タグ、またはPR）を特定する。
- 変更対象のパッケージまたはフォルダを一覧化する。
- スコープ内の機能と意図的にスキップする機能を決定する。

## 1) コードを安全に取り込む

- 全体をコピーするのではなく、クリーンで焦点を絞った差分を優先する。
- ビルド成果物や生成ファイルのコピーを避ける。
- 上流で新しいファイルが追加された場合は、明示的に追加して内容をレビューする。

## 2) インポート拡張子の規約に合わせる

ほとんどのランタイムTypeScriptソースは内部インポートで`.js`を省略しますが、一部のテスト/ベンチマークのエントリポイントはESMランタイムの互換性のために`.js`を保持しています。ローカルパッケージの既存のスタイルに従ってください。一律に拡張子を除去しないでください。

- `packages/coding-agent`のランタイムソースでは、非TSアセットをインポートする場合を除き、内部インポートを拡張子なしに保つ。
- `packages/tui/test`と`packages/natives/bench`では、周囲のファイルが既に使用している場合は`.js`を保持する。
- ツールが必要とする場合は実際のファイル拡張子を保持する（例：`.json`、`.css`、`.md`テキスト埋め込み）。
- 例：`import { x } from "./foo.js";` → `import { x } from "./foo";`（パッケージの規約が拡張子なしの場合のみ）。

## 3) インポートスコープを置換する

上流は異なるパッケージスコープを使用しています。一貫して置換してください。

- 古いスコープをここで使用しているローカルスコープに置換する。
- 例（移植する実際のパッケージに合わせて調整してください）：
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Bun APIがNodeを改善する場合はBun APIを使用する

Bun上で動作します。BunがNodeより優れた代替手段を提供する場合のみ、Node APIを置換してください。

**置換すべきもの：**

- プロセス生成：`child_process.spawn` → 単純なコマンドにはBun Shell `$`、ストリーミングや長時間実行の作業には`Bun.spawn`/`Bun.spawnSync`
- ファイルI/O：`fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTPクライアント：`node-fetch`、`axios` → ネイティブ`fetch`
- 暗号ハッシュ：`node:crypto` → Web Cryptoまたは`Bun.hash`
- SQLite：`better-sqlite3` → `bun:sqlite`
- 環境変数読み込み：`dotenv` → Bunは`.env`を自動的に読み込む

**置換してはいけないもの（Bunで問題なく動作する）：**

- `os.homedir()` — `Bun.env.HOME`、`Bun.env.HOME`、またはリテラル`"~"`で置換しないこと
- `os.tmpdir()` — `Bun.env.TMPDIR || "/tmp"`やハードコードされたパスで置換しないこと
- `fs.mkdtempSync()` — 手動のパス構築で置換しないこと
- `path.join()`、`path.resolve()`など — これらは問題なし

**インポートスタイル：** 名前空間インポートのみで`node:`プレフィックスを使用する（`node:fs`や`node:path`からの名前付きインポートは使用しない）。

**その他のBun規約：**

- 短い非ストリーミングコマンドにはBun Shell `$`を優先する。ストリーミングI/Oやプロセス制御が必要な場合のみ`Bun.spawn`を使用する。
- ファイルには`Bun.file()`/`Bun.write()`を、ディレクトリには`node:fs/promises`を使用する。
- `Bun.file().exists()`チェックは避ける。try/catchで`isEnoent`ハンドリングを使用する。
- `setTimeout`ラッパーよりも`Bun.sleep(ms)`を優先する。

**誤り：**

```typescript
// 壊れている: 環境変数がundefinedの可能性があり、"~"は展開されない
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

## 5) Bun埋め込みを優先する（コピー不要）

ビルド時にランタイムアセットやベンダーファイルをコピーしないでください。

- 上流がアセットをdistフォルダにコピーしている場合は、Bunフレンドリーな埋め込みに置換する。
- プロンプトは静的な`.md`ファイルです。インラインプロンプト文字列ではなく、Bunテキストインポート（`with { type: "text" }`）とHandlebarsを使用する。
- 隣接する非テキストリソースの読み込みには`import.meta.dir` + `Bun.file`を使用する。
- アセットをリポジトリ内に保持し、バンドラーに含めさせる。
- ユーザーが明示的に要求しない限り、コピースクリプトを排除する。
- 上流がランタイム時にバンドルされたフォールバックファイルを読み込んでいる場合は、ファイルシステム読み取りをBunテキスト埋め込みインポートに置換する。
  - 例（Codex instructionsフォールバック）：
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` → 削除
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`の代わりに`return FALLBACK_INSTRUCTIONS;`を使用

## 6) `package.json`を慎重に移植する

`package.json`は契約として扱ってください。意図的にマージしてください。

- 移植で変更が必要でない限り、既存の`name`、`version`、`type`、`exports`、`bin`を保持する。
- npm/nodeスクリプトをBun相当のものに置換する（例：`bun check`、`bun test`）。
- 依存関係が正しいスコープを使用していることを確認する。
- 型エラーを修正するために依存関係をダウングレードしない。代わりにアップグレードする。
- ワークスペースパッケージリンクと`peerDependencies`を検証する。

## 7) コードスタイルとツールを統一する

- 既存のフォーマット規約を保持する。
- 必要でない限り`any`を導入しない。
- 動的インポートとインライン型インポートを避ける。トップレベルインポートのみを使用する。
- コード内でプロンプトを構築しない。プロンプトはHandlebarsでレンダリングされる静的な`.md`ファイルです。
- coding-agentでは`console.log`/`console.warn`/`console.error`を使用しない。`@f5xc-salesdemos/pi-utils`の`logger`を使用する。
- `new Promise((resolve, reject) => ...)`の代わりに`Promise.withResolvers()`を使用する。
- **クラスフィールドやメソッドに`private`/`protected`/`public`キーワードを使用しない。** カプセル化にはES `#`プライベートフィールドを使用し、アクセス可能なメンバーはキーワードなしにする。唯一の例外はコンストラクタパラメータプロパティ（`constructor(private readonly x: T)`）で、TypeScriptではキーワードが必須です。上流のコードが`private foo`や`protected bar`を使用している場合は、`#foo`（プライベート）またはキーワードなしの`bar`（アクセス可能）に変換する。
- 新しいアドホックコードよりも既存のヘルパーやユーティリティを優先する。
- このリポジトリで既に行われているBunファーストのインフラストラクチャ変更を保持する：
  - ランタイムはBun（Nodeエントリポイントなし）。
  - パッケージマネージャーはBun（npmロックファイルなし）。
  - 重いNode API（`child_process`、`readline`）はBun相当のものに置換済み。
  - 軽量なNode API（`os.homedir`、`os.tmpdir`、`fs.mkdtempSync`、`path.*`）は保持。
  - CLIのshebangは`bun`を使用（`node`や`tsx`ではない）。
  - パッケージはソースファイルを直接使用（TypeScriptビルドステップなし）。
  - CIワークフローはインストール/チェック/テストにBunを実行。

## 8) 古い互換性レイヤーを削除する

要求されない限り、上流の互換性シムを削除してください。

- 置換された古いAPIを削除する。
- すべての呼び出し箇所を新しいAPIに直接更新する。
- `*_v2`や並行バージョンを保持しない。

## 9) ドキュメントと参照を更新する

- 適切な箇所でpi-monoリポジトリリンクを置換する。
- 例をBunと正しいパッケージスコープを使用するように更新する。
- READMEの手順が現在のリポジトリの動作と一致していることを確認する。

## 10) 移植を検証する

変更後に標準チェックを実行する：

- `bun check`

変更に関係のない既存のチェック失敗がリポジトリにある場合は、それを明示してください。
テストはBunのランナー（Vitestではない）を使用しますが、`bun test`は明示的に要求された場合のみ実行してください。

## 11) 改善された機能を保護する（リグレッショントラップリスト）

ローカルで既に動作を改善している場合は、それらを**妥協不可**として扱ってください。移植前に改善点を書き留め、マージで失われないよう明示的なチェックを追加してください。

- **期待される動作を固定する**：各改善について短い「変更前/変更後」のメモを追加する（入力、出力、デフォルト、エッジケース）。これにより暗黙のロールバックを防止する。
- **旧→新APIのマッピング**：上流が概念をリネームした場合（hooks → extensions、custom tools → toolsなど）、すべての古いエントリポイントが正しく接続されていることを確認する。1つのフラグやエクスポートの見落としが機能喪失につながる。
- **エクスポートを検証する**：`package.json`の`exports`、公開型、バレルファイルを確認する。上流の移植ではローカルの追加を再エクスポートし忘れることが多い。
- **非正常パスをカバーする**：エラーハンドリング、タイムアウト、またはフォールバックロジックを修正した場合は、テストまたは少なくともそれらのパスを実行する手動チェックリストを追加する。
- **デフォルトと設定のマージ順序を確認する**：改善はデフォルトに存在することが多い。新しいデフォルトが元に戻っていないことを確認する（例：新しい設定の優先順位、無効化された機能、ツールリスト）。
- **env/shell動作を監査する**：実行やサンドボックスを修正した場合は、新しいパスがサニタイズされたenvを引き続き使用し、エイリアス/関数のオーバーライドを再導入していないことを確認する。
- **対象サンプルを再実行する**：「既知の正常動作」の最小限の例セットを保持し、移植後に実行する（CLIフラグ、エクステンション登録、ツール実行）。

## 12) リワークされたコードを検出して処理する

ファイルを移植する前に、上流が大幅にリファクタリングしていないか確認してください：

```bash
# 移植しようとしているファイルをローカルのものと比較する
git diff HEAD upstream/main -- path/to/file.ts
```

差分がファイルが**リワーク**されたことを示している場合（単なるパッチではなく）：

- 新しい抽象化、リネームされた概念、マージされたモジュール、変更されたデータフロー

その場合、移植前に**新しい実装を徹底的に読む**必要があります。リワークされたコードの盲目的なマージは、以下の理由で機能を失います：

注意：インタラクティブモードは最近controllers/utils/typesに分割されました。関連する変更をバックポートする際は、作成した個別のファイルに更新を移植し、`interactive-mode.ts`の配線が同期されていることを確認してください。

1. **デフォルトが暗黙的に変更される** - 新しい変数`defaultFoo = [a, b]`が、`[a, b, c, d, e]`を返していた古い`getAllFoo()`を置き換える可能性がある。

2. **APIオプションが脱落する** - システムがマージされる場合（例：`hooks` + `customTools` → `extensions`）、古いオプションが新しい実装に接続されない可能性がある。

3. **コードパスが古くなる** - リネームされた概念（例：`hookMessage` → `custom`）は、定義だけでなく、すべてのswitch文、型ガード、ハンドラーで更新が必要。

4. **コンテキスト/機能が縮小する** - 古いAPIが公開していた`{ logger, typebox, pi }`を新しいAPIが含め忘れている可能性がある。

### セマンティック移植プロセス

上流がモジュールをリワークした場合：

1. **古い実装を読む** - 何をしていたか、どのオプションを受け付けていたか、何を公開していたかを理解する。

2. **新しい実装を読む** - 新しい抽象化と、それが古い動作にどのようにマッピングされるかを理解する。

3. **機能の同等性を検証する** - 古いコードの各機能について、新しいコードがそれを保持しているか、明示的に削除しているかを確認する。

4. **残存物をgrepする** - switch文、ハンドラー、UIコンポーネントで見落とされた可能性のある古い名前/概念を検索する。

5. **境界をテストする** - CLIフラグ、SDKオプション、イベントハンドラー、デフォルト値—これらがリグレッションの潜む場所です。

### クイックチェック

```bash
# 更新が必要な可能性のある古い概念のすべての使用箇所を検索
rg "oldConceptName" --type ts

# バージョン間のデフォルト値を比較
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# すべてのenum/union値にハンドラーがあるか確認
rg "case \"" path/to/file.ts
```

## 13) クイック監査チェックリスト

完了前の最終パスとしてこれを使用してください：

- [ ] インポート拡張子がローカルパッケージの規約に従っている（一律`.js`除去なし）
- [ ] 新規/移植コードにNode専用APIがない
- [ ] すべてのパッケージスコープが更新されている
- [ ] `package.json`スクリプトがBunを使用している
- [ ] プロンプトが`.md`テキストインポートである（インラインプロンプト文字列なし）
- [ ] coding-agentに`console.*`がない（`logger`を使用）
- [ ] アセットがBun埋め込みパターンで読み込まれている（コピースクリプトなし）
- [ ] テストまたはチェックが実行される（またはブロックされていると明示的に記載）
- [ ] 機能リグレッションなし（セクション11-12を参照）

## 14) コミットメッセージのフォーマット

バックポートをコミットする際は、リポジトリのフォーマット`<type>(scope): <過去形の説明>`に従い、タイトルにコミット範囲を含めてください。

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
- conventional commitタイプを使用する（`fix`、`feat`、`refactor`、`perf`、`docs`）
- 外部コントリビューションには上流のissue/PR番号とコントリビューター帰属を含める
- タイトルのコミット範囲は同期ポイントの追跡に役立つ

## 15) 意図的な差異

私たちのフォークには上流と異なるアーキテクチャ上の決定があります。**以下の上流パターンは移植しないでください：**

### UIアーキテクチャ

| 上流                                        | 私たちのフォーク                                              | 理由                                                                  |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider`クラス                   | `StatusLineComponent`                                     | よりシンプルで統合されたステータスライン                                       |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | 非TUIモードではスタブ                                        | TUIで実装、それ以外ではno-op                                             |
| `ctx.ui.setEditorComponent()`               | 非TUIモードではスタブ                                        | TUIで実装、それ以外ではno-op                                             |
| `InteractiveModeOptions`オプションオブジェクト  | 位置引数コンストラクタ（オプション型はエクスポートされたまま）     | コンストラクタシグネチャを保持、上流がフィールドを追加した際に型を更新              |

### コンポーネント命名

| 上流                         | 私たちのフォーク            |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API命名

| 上流                                     | 私たちのフォーク                                 | 備考                                      |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | 全体で`sessionName`を使用                   |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | 同一（上流のRPCに合わせて統一済み）            |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | 同一                                      |

### ファイル統合

| 上流                                               | 私たちのフォーク                            | 理由                                    |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts`（ツールファイル） | `@f5xc-salesdemos/pi-natives`クリップボードモジュール | N-APIネイティブ実装に統合                   |

### テストフレームワーク

| 上流                      | 私たちのフォーク                  |
| ------------------------- | ----------------------------- |
| `vitest`と`vi.mock()`      | `bun:test`とbunの`vi`          |
| `node:test`アサーション     | `expect()`マッチャー            |

### ツールアーキテクチャ

| 上流                                | 私たちのフォーク                                                          | 備考                                                      |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `BUILTIN_TOOLS`レジストリ経由の`createTools(session: ToolSession)`      | ツールファクトリは`ToolSession`を受け取り`null`を返せる          |
| ツールごとの`*Operations`インターフェース | ツールごとのインターフェースを維持（`FindOperations`、`GrepOperations`）   | SSH/リモートオーバーライドに使用                               |
| あらゆる箇所でNode.js `fs/promises`    | ファイルには`Bun.file()`/`Bun.write()`、ディレクトリには`node:fs/promises` | 簡素化できる場合はBun APIを優先                               |

### 認証ストレージ

| 上流                            | 私たちのフォーク                                | 備考                                         |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db`（bun:sqlite）                     | 認証情報は`agent.db`にのみ保存                   |
| プロバイダーごとに単一の認証情報     | ラウンドロビン選択によるマルチ認証情報              | セッションアフィニティとバックオフロジックを保持      |

### エクステンション

| 上流                          | 私たちのフォーク                               |
| ----------------------------- | ------------------------------------------ |
| TypeScript読み込みに`jiti`      | ネイティブBun `import()`                     |
| `pkg.pi`マニフェストフィールド   | `pkg.xcsh ?? pkg.pi`（私たちの名前空間を優先）  |

### スキップすべき上流機能

移植時に以下のファイル/機能は**完全にスキップ**してください：

- `footer-data-provider.ts` — StatusLineComponentを使用しているため
- `clipboard-image.ts` — クリップボードは`@f5xc-salesdemos/pi-natives` N-APIモジュールにあるため
- GitHubワークフローファイル — 独自のCIがあるため
- `models.generated.ts` — 自動生成、ローカルで再生成（models.jsonとして）

### 追加した機能（これらを保持すること）

以下は私たちのフォークに存在し、上流にはありません。**絶対に上書きしないでください：**

- インタラクティブモードの`StatusLineComponent`
- セッションアフィニティ付きマルチ認証情報認証
- 機能ベースのディスカバリーシステム（`defineCapability`、`registerProvider`、`loadCapability`、`skillCapability`など）
- MCP/Exa/SSH統合
- フォーマット保存時のLSPライトスルー
- Bashインターセプション（`checkBashInterception`）
- readツールのファジーパス候補
