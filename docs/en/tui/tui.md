---
title: TUI Integration for Extensions and Custom Tools
description: TUI integration contract for extensions, custom tools, and custom renderers.
sidebar:
  order: 1
  label: Extension integration
---

This document defines the user interface contracts for extensions and custom tools building interactive terminal experiences in xcsh.

## Component interface contract

All custom interactive widgets implement the `Component` interface from `@f5-sales-demo/pi-tui`:

```typescript
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

### Terminal output constraints

1. **Strict width boundaries**: Every line returned by `render(width)` must have a visual width less than or equal to `width`. Use `visibleWidth()` and `truncateToWidth()` to enforce line limits.
2. **Tab replacement**: Sanitize tab characters using `replaceTabs()` to prevent visual misalignment.
3. **Hardware cursor**: Emit `CURSOR_MARKER` within the rendered string where the terminal cursor should reside.

## Extension interactive modals (`ctx.ui.custom`)

Extensions can take over the primary editor area to render selection lists, confirmations, or wizards:

```typescript
export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("select-item", {
    description: "Launch interactive item picker",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const choice = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
        const picker = new SelectList(
          [
            { value: "item1", label: "First Option" },
            { value: "item2", label: "Second Option" },
          ],
          8,
          getSelectListTheme(),
        );

        picker.onSelect = (item) => done(item.value);
        picker.onCancel = () => done(undefined);
        return picker;
      });

      if (choice) {
        ctx.ui.notify(`Selected: ${choice}`, "info");
      }
    },
  });
}
```

## Custom tool renderers

Custom tools customize how tool arguments and results render in the conversation stream by implementing `renderCall` and `renderResult`:

```typescript
export interface CustomTool<TParams, TResult> {
  name: string;
  renderCall?(params: TParams, theme: Theme): Component;
  renderResult?(result: TResult, options: RenderResultOptions, theme: Theme): Component;
}
```

## Related implementation files

- `packages/tui/src/tui.ts`: `Component`, `Focusable`, and renderer engine types.
- `packages/tui/src/utils.ts`: Terminal string truncation, visual width measurement, and tab normalization.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts`: Modal mounting and editor restoration.
- `packages/coding-agent/src/modes/components/tool-execution.ts`: Tool call and result widget container.
