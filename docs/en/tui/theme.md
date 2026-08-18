---
title: Theming Reference
description: TUI theming reference with color tokens, font settings, and theme customization.
sidebar:
  order: 3
  label: Theming
---

# Theming reference

This document defines color token architecture, theme resolution, terminal color modes, and custom theme creation in xcsh.

## Theme system capabilities

The xcsh theming engine configures visual styling across multiple terminal subsystems:

- Base foreground, background, and accent color tokens.
- Markdown rendering adapters for inline code, blockquotes, headings, and lists (`getMarkdownTheme()`).
- Component styling adapters for selection modals, editors, and configuration lists.
- Symbol glyph presets and character overrides (`unicode`, `nerd`, `ascii`).
- High-performance syntax highlighting palettes powered by native tokenizers (`@f5-sales-demo/pi-natives`).
- Powerline and standard status line segment color definitions.

## Color token taxonomy

Themes define required color tokens under the `colors` object map:

| Token category | Token names | Usage |
| --- | --- | --- |
| **Core accents & text** | `accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText` | Frame borders, primary text, and alert levels |
| **Containers** | `selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg` | Background fills for conversation cards and tool execution boxes |
| **Markdown** | `mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet` | Formatted markdown document elements |
| **Syntax highlighting** | `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation` | Native code block highlighting |
| **Thinking indicators** | `thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh` | Adaptive border colors reflecting active reasoning effort |
| **Status line** | `statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineCost` | Segment text and indicator values |

## Custom theme specification

Custom theme definitions reside in `~/.xcsh/agent/themes/<theme-name>.json`:

```json
{
  "name": "custom-dark",
  "vars": {
    "accentColor": "#7aa2f7",
    "mutedText": 244
  },
  "colors": {
    "accent": "accentColor",
    "chromeAccent": "accentColor",
    "spinnerAccent": "accentColor",
    "contentAccent": "mutedText",
    "border": "#4c566a",
    "borderAccent": "accentColor",
    "borderMuted": "mutedText",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "mutedText",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "mutedText",
    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accentColor",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "mutedText",
    "mdHeading": "accentColor",
    "mdLink": "accentColor",
    "mdLinkUrl": "mutedText",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "mutedText",
    "mdQuote": "mutedText",
    "mdQuoteBorder": "mutedText",
    "mdHr": "mutedText",
    "mdListBullet": "accentColor",
    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "mutedText",
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
    "statusLineProfileXcshBg": "accentColor",
    "statusLineProfileXcshFg": 231
  }
}
```

## Related implementation files

- `src/modes/theme/theme.ts`: Core theme loader, variable resolution, and schema validator.
- `src/modes/theme/theme-schema.json`: Static JSON Schema definition for theme authoring.
- `src/modes/theme/defaults/xcsh-dark.json`: Default dark theme specification.
- `src/modes/theme/defaults/xcsh-light.json`: Default light theme specification.
