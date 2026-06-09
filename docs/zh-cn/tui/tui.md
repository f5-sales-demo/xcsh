---
title: 扩展和自定义工具的 TUI 集成
description: 面向扩展、自定义工具和自定义渲染器的 TUI 集成契约。
sidebar:
  order: 1
  label: 扩展集成
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# 扩展和自定义工具的 TUI 集成

本文档涵盖了 `packages/coding-agent` 和 `packages/tui` 用于扩展 UI、自定义工具 UI 和自定义渲染器的**当前** TUI 契约。

## 该子系统是什么

运行时包含两个层级：

- **渲染引擎 (`packages/tui`)**：差异化终端渲染器、输入分发、焦点管理、覆盖层、光标定位。
- **集成层 (`packages/coding-agent`)**：挂载扩展/自定义工具组件，连接快捷键/主题，并恢复编辑器状态。

## 各模式下的运行时行为

| 模式 | `ctx.ui.custom(...)` 可用性 | 备注 |
| --- | --- | --- |
| 交互式 TUI | 支持 | 组件挂载在编辑器区域，获得焦点，且必须调用 `done(result)` 来完成解析。 |
| 后台/无头模式 | 非交互式 | UI 上下文为空操作（`hasUI === false`）。 |
| RPC 模式 | 不支持 | `custom()` 返回 `Promise<never>`，不会挂载 TUI 组件。 |

如果您的扩展/工具可以在非交互模式下运行，请使用 `ctx.hasUI` / `pi.hasUI` 进行条件判断。

## 核心组件契约 (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` 定义了：

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` 是独立的接口：

```ts
export interface Focusable {
  focused: boolean;
}
```

光标行为使用 `CURSOR_MARKER`（而非 `getCursorPosition`）。获得焦点的组件在渲染文本中输出该标记；`TUI` 提取标记并定位硬件光标。

## 渲染约束（终端安全）

您的 `render(width)` 输出必须是终端安全的：

1. **任何行都不得超过 `width`**。如果非图像行溢出，渲染器会抛出异常。
2. **测量可视宽度**，而非字符串长度：使用 `visibleWidth()`。
3. **对 ANSI 感知文本进行截断/换行**，使用 `truncateToWidth()` / `wrapTextWithAnsi()`。
4. **清理外部来源的制表符/内容**，使用 `replaceTabs()`（以及 coding-agent 渲染路径中的更高级清理器）。

最小化模式：

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## 输入处理和快捷键绑定

### 原始按键匹配

使用 `matchesKey(data, "...")` 匹配导航键和组合键。

### 尊重用户配置的应用快捷键

扩展 UI 工厂在交互模式下会接收 `KeybindingsManager`，以便您可以使用映射的操作而非硬编码按键：

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### 按键释放/重复事件

除非您的组件设置了以下属性，否则按键释放事件会被过滤：

```ts
wantsKeyRelease = true;
```

然后根据需要使用 `isKeyRelease()` / `isKeyRepeat()`。

## 焦点、覆盖层和光标

- `TUI.setFocus(component)` 将输入路由到该组件。
- `TUI` 中存在覆盖层 API（`showOverlay`、`OverlayHandle`），但交互模式下扩展的 `ctx.ui.custom` 挂载目前直接替换编辑器组件区域。
- 扩展类型中存在 `custom(..., options?: { overlay?: boolean })` 选项；交互式扩展挂载目前忽略此选项。

## 挂载点和返回契约

## 1) 扩展 UI (`ExtensionUIContext`)

当前签名（`extensibility/extensions/types.ts`）：

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

交互模式下的行为（`extension-ui-controller.ts`）：

- 保存编辑器文本。
- 用您的组件替换编辑器组件。
- 聚焦您的组件。
- 调用 `done(result)` 时：调用 `component.dispose?.()`，恢复编辑器和文本，聚焦编辑器，解析 promise。

因此 `done(...)` 是完成操作的必需调用。

## 2) Hook/自定义工具 UI 上下文（遗留类型）

`HookUIContext.custom` 在 hook/自定义工具类型中的签名为 `(tui, theme, done)`。
底层交互实现使用 `(tui, theme, keybindings, done)` 调用工厂。JS 使用者可以使用额外的参数；类型层面的兼容性仍然反映 3 参数的遗留签名。

自定义工具通常通过工厂作用域的 `pi.ui` 对象使用相同的 UI 入口点，然后在普通工具内容中返回选择的值：

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

## 3) 自定义工具调用/结果渲染器

自定义工具和扩展工具可以从以下方法返回组件：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` 当前包括：

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

这些渲染器由 `ToolExecutionComponent` 挂载。

## 生命周期和取消

- `dispose()` 在类型层面是可选的，但当您拥有定时器、子进程、监听器、套接字或覆盖层时应当实现。
- `done(...)` 应在组件流程中恰好调用一次。
- 对于可取消的长时间运行 UI，将 `CancellableLoader` 与 `AbortSignal` 配对使用，并从 `onAbort` 中调用 `done(...)`。

取消模式示例：

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## 实际自定义组件示例（扩展命令）

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

## 关键实现文件

- `packages/tui/src/tui.ts` — `Component`、`Focusable`、光标标记、焦点管理、覆盖层、输入分发。
- `packages/tui/src/utils.ts` — 宽度/截断/清理基础工具。
- `packages/tui/src/keys.ts` / `keybindings.ts` — 按键解析和可配置的操作映射。
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — 扩展/hook/自定义工具 UI 的交互式挂载/卸载。
- `packages/coding-agent/src/extensibility/extensions/types.ts` — 扩展 UI 和渲染器契约。
- `packages/coding-agent/src/extensibility/hooks/types.ts` — hook UI 契约（遗留 custom 签名）。
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — 自定义工具执行/渲染契约。
- `packages/coding-agent/src/modes/components/tool-execution.ts` — 挂载 `renderCall`/`renderResult` 组件和部分状态选项。
- `packages/coding-agent/src/tools/context.ts` — 工具 UI 上下文传播（`hasUI`、`ui`）。
