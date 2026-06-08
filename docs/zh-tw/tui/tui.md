---
title: 擴充功能與自訂工具的 TUI 整合
description: 擴充功能、自訂工具與自訂渲染器的 TUI 整合契約。
sidebar:
  order: 1
  label: 擴充功能整合
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# 擴充功能與自訂工具的 TUI 整合

本文件涵蓋 `packages/coding-agent` 和 `packages/tui` 用於擴充功能 UI、自訂工具 UI 及自訂渲染器的**目前** TUI 契約。

## 此子系統是什麼

執行環境有兩個層級：

- **渲染引擎（`packages/tui`）**：差異化終端機渲染器、輸入分派、焦點、覆疊層、游標放置。
- **整合層（`packages/coding-agent`）**：掛載擴充功能/自訂工具元件，連接快捷鍵/主題，並恢復編輯器狀態。

## 各模式的執行行為

| 模式 | `ctx.ui.custom(...)` 可用性 | 備註 |
| --- | --- | --- |
| 互動式 TUI | 支援 | 元件會掛載在編輯器區域並取得焦點，必須呼叫 `done(result)` 來完成解析。 |
| 背景/無介面模式 | 非互動式 | UI 上下文為空操作（`hasUI === false`）。 |
| RPC 模式 | 不支援 | `custom()` 回傳 `Promise<never>` 且不會掛載 TUI 元件。 |

如果您的擴充功能/工具可在非互動模式下執行，請使用 `ctx.hasUI` / `pi.hasUI` 進行防護檢查。

## 核心元件契約（`@f5xc-salesdemos/pi-tui`）

`packages/tui/src/tui.ts` 定義：

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` 是獨立的：

```ts
export interface Focusable {
  focused: boolean;
}
```

游標行為使用 `CURSOR_MARKER`（而非 `getCursorPosition`）。取得焦點的元件在渲染文字中發出標記；`TUI` 會擷取它並定位硬體游標。

## 渲染限制（終端機安全性）

您的 `render(width)` 輸出必須是終端機安全的：

1. **任何行都不得超過 `width`**。若非圖片行溢出，渲染器會拋出錯誤。
2. **測量視覺寬度**，而非字串長度：使用 `visibleWidth()`。
3. **使用 ANSI 感知的方式截斷/換行文字**，使用 `truncateToWidth()` / `wrapTextWithAnsi()`。
4. **清理來自外部來源的 Tab 字元/內容**，使用 `replaceTabs()`（以及 coding-agent 渲染路徑中的高階清理器）。

最小模式：

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## 輸入處理與快捷鍵

### 原始按鍵比對

使用 `matchesKey(data, "...")` 來處理導航鍵和組合鍵。

### 遵守使用者設定的應用程式快捷鍵

擴充功能 UI 工廠會接收一個 `KeybindingsManager`（互動模式），因此您可以遵照映射的動作，而非硬編碼按鍵：

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### 按鍵釋放/重複事件

按鍵釋放事件會被過濾，除非您的元件設定了：

```ts
wantsKeyRelease = true;
```

然後在需要時使用 `isKeyRelease()` / `isKeyRepeat()`。

## 焦點、覆疊層與游標

- `TUI.setFocus(component)` 將輸入路由到該元件。
- `TUI` 中存在覆疊層 API（`showOverlay`、`OverlayHandle`），但互動模式下的擴充功能 `ctx.ui.custom` 掛載目前是直接替換編輯器元件區域。
- `custom(..., options?: { overlay?: boolean })` 選項存在於擴充功能類型中；互動式擴充功能掛載目前會忽略此選項。

## 掛載點與回傳契約

## 1）擴充功能 UI（`ExtensionUIContext`）

目前的簽章（`extensibility/extensions/types.ts`）：

```ts
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>
```

互動模式下的行為（`extension-ui-controller.ts`）：

- 儲存編輯器文字。
- 將編輯器元件替換為您的元件。
- 聚焦您的元件。
- 當 `done(result)` 被呼叫時：呼叫 `component.dispose?.()`，恢復編輯器 + 文字，聚焦編輯器，解析 Promise。

因此 `done(...)` 是完成操作的必要條件。

## 2）Hook/自訂工具 UI 上下文（舊版型別）

`HookUIContext.custom` 在 hook/自訂工具類型中被定義為 `(tui, theme, done)`。
底層互動式實作以 `(tui, theme, keybindings, done)` 呼叫工廠函式。JS 使用者可以使用額外的參數；型別層級的相容性仍反映 3 個參數的舊版簽章。

自訂工具通常透過工廠範圍的 `pi.ui` 物件使用相同的 UI 進入點，然後在正常的工具內容中回傳選取的值：

```ts
async execute(toolCallId, params, onUpdate, ctx, signal) {
  if (!pi.hasUI) {
    return { content: [{ type: "text", text: "UI unavailable" }] };
  }

  const picked = await pi.ui.custom<string | undefined>((tui, theme, done) => {
    const component = new MyPickerComponent(done, signal);
    return component;
  });

  return { content: [{ type: "text", text: picked ? `Picked: ${picked}` : "Cancelled" }] };
}
```

## 3）自訂工具呼叫/結果渲染器

自訂工具和擴充功能工具可以從以下方法回傳元件：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` 目前包含：

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

這些渲染器由 `ToolExecutionComponent` 掛載。

## 生命週期與取消

- `dispose()` 在型別層級是可選的，但當您擁有計時器、子程序、監視器、Socket 或覆疊層時應該實作它。
- `done(...)` 應該在您的元件流程中恰好呼叫一次。
- 對於可取消的長時間執行 UI，將 `CancellableLoader` 與 `AbortSignal` 配對，並從 `onAbort` 呼叫 `done(...)`。

取消模式範例：

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## 實際的自訂元件範例（擴充功能指令）

```ts
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { SelectList, matchesKey, replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@f5xc-salesdemos/xcsh";

class Picker implements Component {
  list: SelectList;
  keybindings: any;
  done: (value: string | undefined) => void;

  constructor(
    items: Array<{ value: string; label: string }>,
    keybindings: any,
    done: (value: string | undefined) => void,
  ) {
    this.list = new SelectList(items, 8, getSelectListTheme());
    this.keybindings = keybindings;
    this.done = done;
    this.list.onSelect = item => this.done(item.value);
    this.list.onCancel = () => this.done(undefined);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "interrupt")) {
      this.done(undefined);
      return;
    }
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    return this.list.render(width).map(line => truncateToWidth(replaceTabs(line), width));
  }

  invalidate(): void {
    this.list.invalidate();
  }
}

export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("pick-model", {
    description: "Pick a model profile",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const selected = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
        const items = [
          { value: "fast", label: theme.fg("accent", "Fast") },
          { value: "balanced", label: "Balanced" },
          { value: "quality", label: "Quality" },
        ];
        return new Picker(items, keybindings, done);
      });

      if (selected) ctx.ui.notify(`Selected profile: ${selected}`, "info");
    },
  });
}
```

## 關鍵實作檔案

- `packages/tui/src/tui.ts` — `Component`、`Focusable`、游標標記、焦點、覆疊層、輸入分派。
- `packages/tui/src/utils.ts` — 寬度/截斷/清理原始工具函式。
- `packages/tui/src/keys.ts` / `keybindings.ts` — 按鍵解析與可設定的動作映射。
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — 擴充功能/hook/自訂工具 UI 的互動式掛載/卸載。
- `packages/coding-agent/src/extensibility/extensions/types.ts` — 擴充功能 UI 與渲染器契約。
- `packages/coding-agent/src/extensibility/hooks/types.ts` — Hook UI 契約（舊版自訂簽章）。
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — 自訂工具執行/渲染契約。
- `packages/coding-agent/src/modes/components/tool-execution.ts` — 掛載 `renderCall`/`renderResult` 元件與部分狀態選項。
- `packages/coding-agent/src/tools/context.ts` — 工具 UI 上下文傳播（`hasUI`、`ui`）。
