---
title: テーマリファレンス
description: カラートークン、フォント設定、テーマカスタマイズに関するTUIテーマリファレンス。
sidebar:
  order: 3
  label: テーマ
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# テーマリファレンス

このドキュメントでは、現在のコーディングエージェントにおけるテーマの仕組みについて説明します：スキーマ、読み込み、ランタイムの動作、および障害モードについて記載しています。

## テーマシステムが制御するもの

テーマシステムは以下を制御します：

- TUI全体で使用される前景色/背景色のカラートークン
- Markdownスタイルアダプター（`getMarkdownTheme()`）
- セレクター/エディター/設定リストアダプター（`getSelectListTheme()`、`getEditorTheme()`、`getSettingsListTheme()`）
- シンボルプリセット＋シンボルオーバーライド（`unicode`、`nerd`、`ascii`）
- ネイティブハイライター（`@f5xc-salesdemos/pi-natives`）が使用する構文ハイライトカラー
- ステータスラインセグメントの色

主な実装：`src/modes/theme/theme.ts`

## テーマJSONの構造

テーマファイルは、`theme.ts`のランタイムスキーマ（`ThemeJsonSchema`）に対して検証され、`src/modes/theme/theme-schema.json`にミラーリングされたJSONオブジェクトです。

トップレベルフィールド：

- `name`（必須）
- `colors`（必須；すべてのカラートークンが必須）
- `vars`（任意；再利用可能なカラー変数）
- `export`（任意；HTMLエクスポートの色）
- `symbols`（任意）
  - `preset`（任意：`unicode | nerd | ascii`）
  - `overrides`（任意：`SymbolKey`のキー/値オーバーライド）

カラー値は以下を受け付けます：

- 16進文字列（`"#RRGGBB"`）
- 256色インデックス（`0..255`）
- 変数参照文字列（`vars`を通じて解決）
- 空文字列（`""`）はターミナルデフォルト（前景は`\x1b[39m`、背景は`\x1b[49m`）を意味します

## 必須カラートークン（現行）

以下のトークンはすべて`colors`で必須です。

### コアテキストとボーダー（11）

`accent`、`border`、`borderAccent`、`borderMuted`、`success`、`error`、`warning`、`muted`、`dim`、`text`、`thinkingText`

### 背景ブロック（7）

`selectedBg`、`userMessageBg`、`customMessageBg`、`toolPendingBg`、`toolSuccessBg`、`toolErrorBg`、`statusLineBg`

### メッセージ/ツールテキスト（5）

`userMessageText`、`customMessageText`、`customMessageLabel`、`toolTitle`、`toolOutput`

### Markdown（10）

`mdHeading`、`mdLink`、`mdLinkUrl`、`mdCode`、`mdCodeBlock`、`mdCodeBlockBorder`、`mdQuote`、`mdQuoteBorder`、`mdHr`、`mdListBullet`

### ツールdiff＋構文ハイライト（12）

`toolDiffAdded`、`toolDiffRemoved`、`toolDiffContext`、
`syntaxComment`、`syntaxKeyword`、`syntaxFunction`、`syntaxVariable`、`syntaxString`、`syntaxNumber`、`syntaxType`、`syntaxOperator`、`syntaxPunctuation`

### モード/思考ボーダー（8）

`thinkingOff`、`thinkingMinimal`、`thinkingLow`、`thinkingMedium`、`thinkingHigh`、`thinkingXhigh`、`bashMode`、`pythonMode`

### ステータスラインセグメントの色（14）

`statusLineSep`、`statusLineModel`、`statusLinePath`、`statusLineGitClean`、`statusLineGitDirty`、`statusLineContext`、`statusLineSpend`、`statusLineStaged`、`statusLineDirty`、`statusLineUntracked`、`statusLineOutput`、`statusLineCost`、`statusLineSubagents`

## 任意トークン

### `export`セクション（任意）

HTMLエクスポートのテーマヘルパーに使用されます：

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

省略した場合、エクスポートコードは解決済みテーマカラーからデフォルトを導出します。

### `symbols`セクション（任意）

- `symbols.preset`はテーマレベルのデフォルトシンボルセットを設定します。
- `symbols.overrides`は個別の`SymbolKey`値をオーバーライドできます。

ランタイムの優先順位：

1. 設定の`symbolPreset`オーバーライド（設定されている場合）
2. テーマJSONの`symbols.preset`
3. フォールバック `"unicode"`

無効なオーバーライドキーは無視され、ログに記録されます（`logger.debug`）。

## ビルトインテーマとカスタムテーマのソース

テーマの検索順序（`loadThemeJson`）：

1. ビルトイン埋め込みテーマ（`defaults/xcsh-dark.json`と`defaults/xcsh-light.json`が`defaultThemes`にコンパイル済み）
2. カスタムテーマファイル：`<customThemesDir>/<name>.json`

カスタムテーマディレクトリは`getCustomThemesDir()`から取得されます：

- デフォルト：`~/.xcsh/agent/themes`
- `PI_CODING_AGENT_DIR`でオーバーライド（`$PI_CODING_AGENT_DIR/themes`）

`getAvailableThemes()`はビルトイン＋カスタムのマージされた名前をソートして返し、名前が衝突した場合はビルトインが優先されます。

## 読み込み、検証、および解決

カスタムテーマファイルの場合：

1. JSONを読み取り
2. JSONをパース
3. `ThemeJsonSchema`に対して検証
4. `vars`参照を再帰的に解決
5. 解決された値をターミナルのカラーモードに応じてANSIに変換

検証の動作：

- 必須カラートークンの欠落：明示的なグループ化されたエラーメッセージ
- 不正なトークンの型/値：JSONパス付きの検証エラー
- 不明なテーマファイル：`Theme not found: <name>`

変数参照の動作：

- ネストされた参照をサポート
- 存在しない変数参照でスロー
- 循環参照でスロー

## ターミナルカラーモードの動作

カラーモード検出（`detectColorMode`）：

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM`が`dumb`、`linux`、または空 => 256color
- それ以外 => truecolor

変換の動作：

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numeric -> `38;5` / `48;5` ANSI
- `""` -> デフォルトfg/bgリセット

## ランタイム切り替えの動作

### 初期テーマ（`initTheme`）

`main.ts`は以下の設定でテーマを初期化します：

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

自動テーマスロット選択は`COLORFGBG`の背景検出を使用します：

- `COLORFGBG`から背景インデックスをパース
- `< 8` => ダークスロット（`theme.dark`）
- `>= 8` => ライトスロット（`theme.light`）
- パース失敗 => ダークスロット

設定スキーマの現在のデフォルト：

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### 明示的な切り替え（`setTheme`）

- 選択されたテーマを読み込み
- グローバル`theme`シングルトンを更新
- オプションでウォッチャーを開始
- `onThemeChange`コールバックをトリガー

失敗時：

- ビルトイン`dark`にフォールバック
- `{ success: false, error }`を返却

### プレビュー切り替え（`previewTheme`）

- 一時的なプレビューテーマをグローバル`theme`に適用
- それ自体は永続化された設定を変更**しません**
- フォールバック置換なしでsuccess/errorを返却

設定UIはこれをライブプレビューに使用し、キャンセル時に以前のテーマを復元します。

## ウォッチャーとライブリロード

ウォッチャーが有効な場合（`setTheme(..., true)` / インタラクティブ初期化）：

- カスタムファイルパス`<customThemesDir>/<currentTheme>.json`のみを監視
- ビルトインは実質的に監視されない
- ファイル`change`：リロードを試行（デバウンス付き）
- ファイル`rename`/削除：`dark`にフォールバックし、ウォッチャーを閉じる

自動モードは`SIGWINCH`リスナーもインストールし、ターミナルの状態が変化したときにダーク/ライトスロットのマッピングを再評価できます。

## 色覚多様性モードの動作

`colorBlindMode`はランタイムで1つのトークンのみ変更します：

- `toolDiffAdded`がHSV調整されます（緑が青方向にシフト）
- 調整は解決された値が16進文字列の場合にのみ適用されます

その他のトークンは変更されません。

## テーマ設定の永続化場所

テーマ関連の設定は`Settings`によってグローバル設定YAMLに永続化されます：

- パス：`<agentDir>/config.yml`
- デフォルトのエージェントディレクトリ：`~/.xcsh/agent`
- 実効デフォルトファイル：`~/.xcsh/agent/config.yml`

永続化されるキー：

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

レガシー移行が存在します：古いフラットな`theme: "name"`は、輝度検出に基づいてネストされた`theme.dark`または`theme.light`に移行されます。

## カスタムテーマの作成（実践編）

1. カスタムテーマディレクトリにファイルを作成します（例：`~/.xcsh/agent/themes/my-theme.json`）。
2. `name`、任意の`vars`、および**すべての必須**`colors`トークンを含めます。
3. オプションで`symbols`と`export`を含めます。
4. どの自動スロットに割り当てるかに応じて、設定（`Display -> Dark theme`または`Display -> Light theme`）でテーマを選択します。

最小限のスケルトン。`colors`のすべてのキーが必須です — ランタイムバリデーター
（`additionalProperties: false`）は、欠落キーと不明なキーの両方を拒否します。
出荷済みのリファレンス実装については
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
および[`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)を参照してください。

ステータスラインには、issue #242で文書化された2つの並列カラーシステムがあります：

- 16進テキストカラー（`statusLinePath`、`statusLineGitClean`、`statusLineGitDirty`、
  `statusLineStaged`、`statusLineDirty`、`statusLineUntracked`）は非powerline
  レンダリングを駆動します。
- 256色パレットインデックス（`statusLine<Segment>Bg` / `statusLine<Segment>Fg`）は
  powerlineセグメントの塗りつぶしを駆動します。これらは上記の16進キーとは独立しており、
  両方を設定する必要があります。

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileXcshBg": "accent",
    "statusLineProfileXcshFg": 231
  }
}
```

## カスタムテーマのテスト

以下のワークフローを使用してください：

1. インタラクティブモードで起動します（起動時にウォッチャーが有効）。
2. 設定を開き、テーマの値をプレビューします（ライブ`previewTheme`）。
3. カスタムテーマファイルの場合、実行中にJSONを編集し、保存時の自動リロードを確認します。
4. 重要な画面を検証します：
   - Markdownレンダリング
   - ツールブロック（保留中/成功/エラー）
   - diffレンダリング（追加/削除/コンテキスト）
   - ステータスラインの可読性
   - 思考レベルのボーダー変更
   - bash/pythonモードのボーダー色
5. テーマがグリフの幅/外観に依存する場合は、両方のシンボルプリセットを検証してください。

## 実際の制約と注意事項

- カスタムテーマでは、すべての`colors`トークンが必須です。
- `export`と`symbols`は任意です。
- テーマJSON内の`$schema`は情報提供のみです。ランタイム検証はコード内のコンパイル済みTypeBoxスキーマによって実施されます。
- `setTheme`の失敗は`dark`にフォールバックします。`previewTheme`の失敗は現在のテーマを置換しません。
- ファイルウォッチャーのリロードエラーが発生した場合、リロードが成功するかフォールバックパスがトリガーされるまで、現在読み込まれているテーマが維持されます。
