---
title: 主题参考
description: TUI 主题参考，包含颜色令牌、字体设置和主题自定义。
sidebar:
  order: 3
  label: 主题
i18n:
  sourceHash: 7132374bd51e
  translator: machine
---

# 主题参考

本文档描述了 coding-agent 中主题系统的工作原理：模式定义、加载机制、运行时行为和故障模式。

## 主题系统控制的内容

主题系统驱动以下内容：

- TUI 中使用的前景/背景颜色令牌
- markdown 样式适配器（`getMarkdownTheme()`）
- 选择器/编辑器/设置列表适配器（`getSelectListTheme()`、`getEditorTheme()`、`getSettingsListTheme()`）
- 符号预设 + 符号覆盖（`unicode`、`nerd`、`ascii`）
- 原生高亮器使用的语法高亮颜色（`@f5-sales-demo/pi-natives`）
- 状态栏分段颜色

主要实现：`src/modes/theme/theme.ts`。

## 主题 JSON 结构

主题文件是 JSON 对象，根据 `theme.ts` 中的运行时模式（`ThemeJsonSchema`）进行验证，并镜像到 `src/modes/theme/theme-schema.json`。

顶层字段：

- `name`（必需）
- `colors`（必需；所有颜色令牌均为必需）
- `vars`（可选；可复用的颜色变量）
- `export`（可选；HTML 导出颜色）
- `symbols`（可选）
  - `preset`（可选：`unicode | nerd | ascii`）
  - `overrides`（可选：`SymbolKey` 的键/值覆盖）

颜色值接受：

- 十六进制字符串（`"#RRGGBB"`）
- 256 色索引（`0..255`）
- 变量引用字符串（通过 `vars` 解析）
- 空字符串（`""`）表示终端默认值（前景 `\x1b[39m`，背景 `\x1b[49m`）

## 必需的颜色令牌（当前）

以下所有令牌在 `colors` 中均为必需。

### 核心文本和边框 (11)

`accent`、`border`、`borderAccent`、`borderMuted`、`success`、`error`、`warning`、`muted`、`dim`、`text`、`thinkingText`

### 背景块 (7)

`selectedBg`、`userMessageBg`、`customMessageBg`、`toolPendingBg`、`toolSuccessBg`、`toolErrorBg`、`statusLineBg`

### 消息/工具文本 (5)

`userMessageText`、`customMessageText`、`customMessageLabel`、`toolTitle`、`toolOutput`

### Markdown (10)

`mdHeading`、`mdLink`、`mdLinkUrl`、`mdCode`、`mdCodeBlock`、`mdCodeBlockBorder`、`mdQuote`、`mdQuoteBorder`、`mdHr`、`mdListBullet`

### 工具差异 + 语法高亮 (12)

`toolDiffAdded`、`toolDiffRemoved`、`toolDiffContext`、
`syntaxComment`、`syntaxKeyword`、`syntaxFunction`、`syntaxVariable`、`syntaxString`、`syntaxNumber`、`syntaxType`、`syntaxOperator`、`syntaxPunctuation`

### 模式/思考边框 (8)

`thinkingOff`、`thinkingMinimal`、`thinkingLow`、`thinkingMedium`、`thinkingHigh`、`thinkingXhigh`、`bashMode`、`pythonMode`

### 状态栏分段颜色 (14)

`statusLineSep`、`statusLineModel`、`statusLinePath`、`statusLineGitClean`、`statusLineGitDirty`、`statusLineContext`、`statusLineSpend`、`statusLineStaged`、`statusLineDirty`、`statusLineUntracked`、`statusLineOutput`、`statusLineCost`、`statusLineSubagents`

## 可选令牌

### `export` 部分（可选）

用于 HTML 导出主题辅助功能：

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

如果省略，导出代码会从已解析的主题颜色中派生默认值。

### `symbols` 部分（可选）

- `symbols.preset` 设置主题级别的默认符号集。
- `symbols.overrides` 可以覆盖单个 `SymbolKey` 值。

运行时优先级：

1. 设置中的 `symbolPreset` 覆盖（如果已设置）
2. 主题 JSON 中的 `symbols.preset`
3. 回退到 `"unicode"`

无效的覆盖键会被忽略并记录日志（`logger.debug`）。

## 内置主题与自定义主题来源

主题查找顺序（`loadThemeJson`）：

1. 内置嵌入式主题（编译到 `defaultThemes` 中的 `defaults/xcsh-dark.json` 和 `defaults/xcsh-light.json`）
2. 自定义主题文件：`<customThemesDir>/<name>.json`

自定义主题目录来自 `getCustomThemesDir()`：

- 默认值：`~/.xcsh/agent/themes`
- 可通过 `PI_CODING_AGENT_DIR` 覆盖（`$PI_CODING_AGENT_DIR/themes`）

`getAvailableThemes()` 返回合并后的内置 + 自定义名称，已排序，名称冲突时内置主题优先。

## 加载、验证和解析

对于自定义主题文件：

1. 读取 JSON
2. 解析 JSON
3. 根据 `ThemeJsonSchema` 验证
4. 递归解析 `vars` 引用
5. 根据终端能力模式将解析后的值转换为 ANSI

验证行为：

- 缺少必需的颜色令牌：显示明确的分组错误消息
- 错误的令牌类型/值：带有 JSON 路径的验证错误
- 未知主题文件：`Theme not found: <name>`

变量引用行为：

- 支持嵌套引用
- 缺少变量引用时抛出异常
- 循环引用时抛出异常

## 终端颜色模式行为

颜色模式检测（`detectColorMode`）：

- `COLORTERM=truecolor|24bit` => 真彩色
- `WT_SESSION` => 真彩色
- `TERM` 为 `dumb`、`linux` 或空 => 256 色
- 其他情况 => 真彩色

转换行为：

- 十六进制 -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- 数值 -> `38;5` / `48;5` ANSI
- `""` -> 默认前景/背景重置

## 运行时切换行为

### 初始主题（`initTheme`）

`main.ts` 使用以下设置初始化主题：

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

自动主题槽位选择使用 `COLORFGBG` 背景检测：

- 从 `COLORFGBG` 解析背景索引
- `< 8` => 暗色槽位（`theme.dark`）
- `>= 8` => 亮色槽位（`theme.light`）
- 解析失败 => 暗色槽位

设置模式中的当前默认值：

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### 显式切换（`setTheme`）

- 加载选定的主题
- 更新全局 `theme` 单例
- 可选地启动文件监视器
- 触发 `onThemeChange` 回调

失败时：

- 回退到内置 `dark` 主题
- 返回 `{ success: false, error }`

### 预览切换（`previewTheme`）

- 将临时预览主题应用到全局 `theme`
- **不会**自行更改持久化设置
- 返回成功/错误，不进行回退替换

设置界面使用此功能进行实时预览，取消时恢复之前的主题。

## 文件监视器和热重载

当文件监视器启用时（`setTheme(..., true)` / 交互式初始化）：

- 仅监视自定义文件路径 `<customThemesDir>/<currentTheme>.json`
- 内置主题实际上不会被监视
- 文件 `change`：尝试重新加载（已防抖）
- 文件 `rename`/删除：回退到 `dark`，关闭监视器

自动模式还会安装 `SIGWINCH` 监听器，当终端状态变化时可以重新评估暗色/亮色槽位映射。

## 色盲模式行为

`colorBlindMode` 在运行时仅更改一个令牌：

- `toolDiffAdded` 会进行 HSV 调整（绿色偏移向蓝色）
- 仅当解析后的值为十六进制字符串时才应用调整

其他令牌不受影响。

## 主题设置的持久化位置

与主题相关的设置由 `Settings` 持久化到全局配置 YAML 中：

- 路径：`<agentDir>/config.yml`
- 默认代理目录：`~/.xcsh/agent`
- 有效默认文件：`~/.xcsh/agent/config.yml`

持久化的键：

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

存在旧版迁移功能：旧的扁平 `theme: "name"` 格式会根据亮度检测迁移为嵌套的 `theme.dark` 或 `theme.light`。

## 创建自定义主题（实践）

1. 在自定义主题目录中创建文件，例如 `~/.xcsh/agent/themes/my-theme.json`。
2. 包含 `name`、可选的 `vars` 以及**所有必需的** `colors` 令牌。
3. 可选地包含 `symbols` 和 `export`。
4. 根据您想要的自动槽位，在设置中选择主题（`Display -> Dark theme` 或 `Display -> Light theme`）。

最小骨架。`colors` 中的每个键都是必需的——运行时验证器
（`additionalProperties: false`）会拒绝缺少的键和未知的键。
有关已发布的参考实现，请参阅
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
和 [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)。

状态栏有两个并行的颜色系统，记录在 issue #242 中：

- 十六进制文本颜色（`statusLinePath`、`statusLineGitClean`、`statusLineGitDirty`、
  `statusLineStaged`、`statusLineDirty`、`statusLineUntracked`）驱动非 powerline
  渲染。
- 256 色调色板索引（`statusLine<Segment>Bg` / `statusLine<Segment>Fg`）
  驱动 powerline 分段填充。它们独立于上述十六进制键——
  两者都必须设置。

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

## 测试自定义主题

使用以下工作流程：

1. 启动交互模式（启动时自动启用文件监视器）。
2. 打开设置并预览主题值（实时 `previewTheme`）。
3. 对于自定义主题文件，在运行时编辑 JSON 并确认保存后自动重载。
4. 测试关键界面：
   - markdown 渲染
   - 工具块（待处理/成功/错误）
   - 差异渲染（新增/删除/上下文）
   - 状态栏可读性
   - 思考级别边框变化
   - bash/python 模式边框颜色
5. 如果您的主题依赖于字形宽度/外观，请验证两种符号预设。

## 实际约束和注意事项

- 自定义主题需要所有 `colors` 令牌。
- `export` 和 `symbols` 是可选的。
- 主题 JSON 中的 `$schema` 仅为参考信息；运行时验证由代码中编译的 TypeBox 模式强制执行。
- `setTheme` 失败时回退到 `dark`；`previewTheme` 失败时不会替换当前主题。
- 文件监视器重载错误时会保持当前已加载的主题，直到成功重载或触发回退路径。
