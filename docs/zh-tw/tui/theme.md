---
title: 主題設定參考
description: TUI 主題設定參考，包含顏色標記、字型設定與主題自訂。
sidebar:
  order: 3
  label: 主題設定
i18n:
  sourceHash: 7e962a7da157
  translator: machine
---

# 主題設定參考

本文件說明編碼代理程式中主題系統目前的運作方式：結構描述、載入機制、執行期行為以及失敗模式。

## 主題系統控制的範圍

主題系統驅動：

- 整個 TUI 中使用的前景/背景顏色標記
- markdown 樣式適配器（`getMarkdownTheme()`）
- 選擇器/編輯器/設定列表適配器（`getSelectListTheme()`、`getEditorTheme()`、`getSettingsListTheme()`）
- 符號預設集 + 符號覆寫（`unicode`、`nerd`、`ascii`）
- 原生高亮器（`@f5-sales-demo/pi-natives`）使用的語法高亮顏色
- 狀態列區段顏色

主要實作位置：`src/modes/theme/theme.ts`。

## 主題 JSON 結構

主題檔案是 JSON 物件，透過 `theme.ts` 中的執行期結構描述（`ThemeJsonSchema`）進行驗證，並映射至 `src/modes/theme/theme-schema.json`。

頂層欄位：

- `name`（必填）
- `colors`（必填；所有顏色標記皆為必填）
- `vars`（選填；可重複使用的顏色變數）
- `export`（選填；HTML 匯出顏色）
- `symbols`（選填）
  - `preset`（選填：`unicode | nerd | ascii`）
  - `overrides`（選填：`SymbolKey` 的鍵值對覆寫）

顏色值接受：

- 十六進位字串（`"#RRGGBB"`）
- 256 色索引（`0..255`）
- 變數參考字串（透過 `vars` 解析）
- 空字串（`""`）表示終端機預設值（前景 `\x1b[39m`，背景 `\x1b[49m`）

## 必填顏色標記（目前版本）

以下所有標記在 `colors` 中皆為必填。

### 核心文字與邊框（11 個）

`accent`、`border`、`borderAccent`、`borderMuted`、`success`、`error`、`warning`、`muted`、`dim`、`text`、`thinkingText`

### 背景區塊（7 個）

`selectedBg`、`userMessageBg`、`customMessageBg`、`toolPendingBg`、`toolSuccessBg`、`toolErrorBg`、`statusLineBg`

### 訊息/工具文字（5 個）

`userMessageText`、`customMessageText`、`customMessageLabel`、`toolTitle`、`toolOutput`

### Markdown（10 個）

`mdHeading`、`mdLink`、`mdLinkUrl`、`mdCode`、`mdCodeBlock`、`mdCodeBlockBorder`、`mdQuote`、`mdQuoteBorder`、`mdHr`、`mdListBullet`

### 工具差異比對 + 語法高亮（12 個）

`toolDiffAdded`、`toolDiffRemoved`、`toolDiffContext`、
`syntaxComment`、`syntaxKeyword`、`syntaxFunction`、`syntaxVariable`、`syntaxString`、`syntaxNumber`、`syntaxType`、`syntaxOperator`、`syntaxPunctuation`

### 模式/思考邊框（8 個）

`thinkingOff`、`thinkingMinimal`、`thinkingLow`、`thinkingMedium`、`thinkingHigh`、`thinkingXhigh`、`bashMode`、`pythonMode`

### 狀態列區段顏色（14 個）

`statusLineSep`、`statusLineModel`、`statusLinePath`、`statusLineGitClean`、`statusLineGitDirty`、`statusLineContext`、`statusLineSpend`、`statusLineStaged`、`statusLineDirty`、`statusLineUntracked`、`statusLineOutput`、`statusLineCost`、`statusLineSubagents`

## 選填標記

### `export` 區段（選填）

用於 HTML 匯出的主題輔助功能：

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

若省略，匯出程式碼會從已解析的主題顏色推導預設值。

### `symbols` 區段（選填）

- `symbols.preset` 設定主題層級的預設符號集。
- `symbols.overrides` 可覆寫個別的 `SymbolKey` 值。

執行期優先順序：

1. 設定中的 `symbolPreset` 覆寫（若已設定）
2. 主題 JSON 中的 `symbols.preset`
3. 回退預設值 `"unicode"`

無效的覆寫鍵會被忽略並記錄（`logger.debug`）。

## 內建與自訂主題來源

主題查詢順序（`loadThemeJson`）：

1. 內建嵌入主題（`defaults/xcsh-dark.json` 和 `defaults/xcsh-light.json`，編譯進 `defaultThemes`）
2. 自訂主題檔案：`<customThemesDir>/<name>.json`

自訂主題目錄來自 `getCustomThemesDir()`：

- 預設：`~/.xcsh/agent/themes`
- 可透過 `PI_CODING_AGENT_DIR` 覆寫（`$PI_CODING_AGENT_DIR/themes`）

`getAvailableThemes()` 回傳合併後的內建 + 自訂名稱，已排序，名稱衝突時內建主題優先。

## 載入、驗證與解析

對於自訂主題檔案：

1. 讀取 JSON
2. 解析 JSON
3. 依據 `ThemeJsonSchema` 進行驗證
4. 遞迴解析 `vars` 參考
5. 依終端機色彩能力模式將已解析的值轉換為 ANSI

驗證行為：

- 缺少必填顏色標記：明確的分組錯誤訊息
- 錯誤的標記類型/值：包含 JSON 路徑的驗證錯誤
- 未知的主題檔案：`Theme not found: <name>`

變數參考行為：

- 支援巢狀參考
- 缺少變數參考時拋出例外
- 循環參考時拋出例外

## 終端機色彩模式行為

色彩模式偵測（`detectColorMode`）：

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` 為 `dumb`、`linux` 或空值 => 256color
- 其他情況 => truecolor

轉換行為：

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- 數值 -> `38;5` / `48;5` ANSI
- `""` -> 預設前景/背景重設

## 執行期切換行為

### 初始主題（`initTheme`）

`main.ts` 使用以下設定初始化主題：

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

自動主題插槽選擇使用 `COLORFGBG` 背景偵測：

- 從 `COLORFGBG` 解析背景索引
- `< 8` => 深色插槽（`theme.dark`）
- `>= 8` => 淺色插槽（`theme.light`）
- 解析失敗 => 深色插槽

目前設定結構描述的預設值：

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### 明確切換（`setTheme`）

- 載入選定的主題
- 更新全域 `theme` 單例
- 可選擇性啟動監視器
- 觸發 `onThemeChange` 回呼

失敗時：

- 回退至內建 `dark`
- 回傳 `{ success: false, error }`

### 預覽切換（`previewTheme`）

- 將暫時的預覽主題套用至全域 `theme`
- **不會**自行變更已持久化的設定
- 回傳成功/錯誤，不進行回退替換

設定介面使用此功能進行即時預覽，取消時還原先前的主題。

## 監視器與即時重新載入

當監視器啟用時（`setTheme(..., true)` / 互動式初始化）：

- 僅監視自訂檔案路徑 `<customThemesDir>/<currentTheme>.json`
- 內建主題實際上不會被監視
- 檔案 `change`：嘗試重新載入（防抖處理）
- 檔案 `rename`/刪除：回退至 `dark`，關閉監視器

自動模式也會安裝 `SIGWINCH` 監聽器，在終端機狀態變更時可重新評估深色/淺色插槽對應。

## 色盲模式行為

`colorBlindMode` 在執行期僅變更一個標記：

- `toolDiffAdded` 會進行 HSV 調整（綠色偏移向藍色）
- 僅當已解析的值為十六進位字串時才會套用調整

其他標記不受影響。

## 主題設定的持久化位置

與主題相關的設定透過 `Settings` 持久化至全域設定 YAML：

- 路徑：`<agentDir>/config.yml`
- 預設代理目錄：`~/.xcsh/agent`
- 實際預設檔案：`~/.xcsh/agent/config.yml`

持久化的鍵：

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

存在舊版遷移機制：舊的扁平格式 `theme: "name"` 會根據亮度偵測遷移至巢狀的 `theme.dark` 或 `theme.light`。

## 建立自訂主題（實務操作）

1. 在自訂主題目錄中建立檔案，例如 `~/.xcsh/agent/themes/my-theme.json`。
2. 包含 `name`、選填的 `vars`，以及**所有必填的** `colors` 標記。
3. 可選擇性包含 `symbols` 和 `export`。
4. 在設定中選擇主題（`Display -> Dark theme` 或 `Display -> Light theme`），取決於您想要使用哪個自動插槽。

最小骨架範例。`colors` 中的每個鍵都是必填的——執行期驗證器
（`additionalProperties: false`）會同時拒絕缺少的鍵和未知的鍵。
如需參考已發佈的實作範例，請參閱
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
和 [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)。

狀態列有兩套平行的顏色系統，記錄在 issue #242 中：

- 十六進位文字顏色（`statusLinePath`、`statusLineGitClean`、`statusLineGitDirty`、
  `statusLineStaged`、`statusLineDirty`、`statusLineUntracked`）驅動非 powerline
  的渲染。
- 256 色調色盤索引（`statusLine<Segment>Bg` / `statusLine<Segment>Fg`）
  驅動 powerline 區段填充。它們與上述十六進位鍵是獨立的——
  兩者都必須設定。

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

## 測試自訂主題

使用以下工作流程：

1. 啟動互動模式（監視器從啟動時即啟用）。
2. 開啟設定並預覽主題值（即時 `previewTheme`）。
3. 對於自訂主題檔案，在執行中編輯 JSON 並確認儲存時自動重新載入。
4. 測試關鍵介面：
   - markdown 渲染
   - 工具區塊（等待中/成功/錯誤）
   - 差異比對渲染（新增/移除/上下文）
   - 狀態列可讀性
   - 思考層級邊框變化
   - bash/python 模式邊框顏色
5. 如果您的主題依賴字形寬度/外觀，請驗證兩種符號預設集。

## 實際限制與注意事項

- 自訂主題中所有 `colors` 標記皆為必填。
- `export` 和 `symbols` 為選填。
- 主題 JSON 中的 `$schema` 僅供參考；執行期驗證由程式碼中已編譯的 TypeBox 結構描述強制執行。
- `setTheme` 失敗時回退至 `dark`；`previewTheme` 失敗時不會替換目前主題。
- 檔案監視器重新載入錯誤會保持目前已載入的主題，直到成功重新載入或觸發回退路徑為止。
