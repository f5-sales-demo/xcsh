---
title: TUI Integration for Extensions and Custom Tools
description: 'TUI integration contract for extensions, custom tools, and custom renderers.'
sidebar:
  order: 1
  label: تكامل الإضافات
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# تكامل TUI للإضافات والأدوات المخصصة

يغطي هذا المستند عقد TUI **الحالي** المستخدم من قبل `packages/coding-agent` و `packages/tui` لواجهة المستخدم الخاصة بالإضافات، وواجهة المستخدم الخاصة بالأدوات المخصصة، والعارضات المخصصة.

## ما هو هذا النظام الفرعي

يتكون وقت التشغيل من طبقتين:

- **محرك العرض (`packages/tui`)**: عارض طرفية تفاضلي، إرسال المدخلات، التركيز، الطبقات العلوية، تحديد موضع المؤشر.
- **طبقة التكامل (`packages/coding-agent`)**: تقوم بتركيب مكونات الإضافات/الأدوات المخصصة، وربط اختصارات المفاتيح/السمة، واستعادة حالة المحرر.

## سلوك وقت التشغيل حسب الوضع

| الوضع | توفر `ctx.ui.custom(...)` | ملاحظات |
| --- | --- | --- |
| TUI تفاعلي | مدعوم | يتم تركيب المكون في منطقة المحرر، ويتم التركيز عليه، ويجب استدعاء `done(result)` للحل. |
| خلفي/بدون واجهة | غير تفاعلي | سياق واجهة المستخدم لا يعمل (`hasUI === false`). |
| وضع RPC | غير مدعوم | `custom()` يُرجع `Promise<never>` ولا يقوم بتركيب مكونات TUI. |

إذا كانت إضافتك/أداتك قادرة على العمل في الوضع غير التفاعلي، تحقق باستخدام `ctx.hasUI` / `pi.hasUI`.

## عقد المكون الأساسي (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` يُعرّف:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` منفصل:

```ts
export interface Focusable {
  focused: boolean;
}
```

سلوك المؤشر يستخدم `CURSOR_MARKER` (وليس `getCursorPosition`). المكونات المركّز عليها تبث العلامة في النص المعروض؛ `TUI` يستخرجها ويحدد موضع مؤشر الأجهزة.

## قيود العرض (أمان الطرفية)

يجب أن يكون ناتج `render(width)` آمنًا للطرفية:

1. **لا تتجاوز `width` في أي سطر أبدًا**. يطرح العارض خطأ إذا تجاوز سطر غير صوري الحد.
2. **قِس العرض المرئي**، وليس طول السلسلة النصية: استخدم `visibleWidth()`.
3. **اقتطع/التف النص المتوافق مع ANSI** باستخدام `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **نظّف علامات الجدولة/المحتوى** من المصادر الخارجية باستخدام `replaceTabs()` (والمنظفات عالية المستوى في مسارات عرض coding-agent).

النمط الأدنى:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## معالجة المدخلات واختصارات المفاتيح

### مطابقة المفاتيح الخام

استخدم `matchesKey(data, "...")` لمفاتيح التنقل والتوليفات.

### احترام اختصارات المفاتيح المُعدّة من المستخدم

مصانع واجهة مستخدم الإضافات تستقبل `KeybindingsManager` (في الوضع التفاعلي) حتى تتمكن من احترام الإجراءات المعيّنة بدلاً من ترميز المفاتيح بشكل ثابت:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### أحداث تحرير/تكرار المفاتيح

يتم تصفية أحداث تحرير المفاتيح ما لم يُعيّن مكونك:

```ts
wantsKeyRelease = true;
```

ثم استخدم `isKeyRelease()` / `isKeyRepeat()` عند الحاجة.

## التركيز والطبقات العلوية والمؤشر

- `TUI.setFocus(component)` يوجّه المدخلات إلى ذلك المكون.
- واجهات برمجة الطبقات العلوية موجودة في `TUI` (`showOverlay`, `OverlayHandle`)، لكن تركيب `ctx.ui.custom` للإضافة في الوضع التفاعلي يستبدل حاليًا منطقة مكون المحرر مباشرة.
- خيار `custom(..., options?: { overlay?: boolean })` موجود في أنواع الإضافات؛ تركيب الإضافة التفاعلي يتجاهل هذا الخيار حاليًا.

## نقاط التركيب وعقود الإرجاع

## 1) واجهة مستخدم الإضافة (`ExtensionUIContext`)

التوقيع الحالي (`extensibility/extensions/types.ts`):

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

السلوك في الوضع التفاعلي (`extension-ui-controller.ts`):

- يحفظ نص المحرر.
- يستبدل مكون المحرر بمكونك.
- يركّز على مكونك.
- عند `done(result)`: يستدعي `component.dispose?.()`, يستعيد المحرر + النص، يركّز على المحرر، يحل الوعد.

لذا `done(...)` إلزامي للإكمال.

## 2) سياق واجهة مستخدم الخطاف/الأداة المخصصة (النوع القديم)

`HookUIContext.custom` مُعرّف كـ `(tui, theme, done)` في أنواع الخطاف/الأداة المخصصة.
التنفيذ التفاعلي الأساسي يستدعي المصانع بـ `(tui, theme, keybindings, done)`. مستهلكو JS يمكنهم استخدام المعامل الإضافي؛ التوافق على مستوى الأنواع لا يزال يعكس التوقيع القديم بثلاثة معاملات.

الأدوات المخصصة عادة تستخدم نفس نقطة دخول واجهة المستخدم عبر كائن `pi.ui` المحدد بنطاق المصنع، ثم تُرجع القيمة المختارة في محتوى الأداة العادي:

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

## 3) عارضات استدعاء/نتيجة الأداة المخصصة

يمكن للأدوات المخصصة وأدوات الإضافات إرجاع مكونات من:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` يتضمن حاليًا:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

يتم تركيب هذه العارضات بواسطة `ToolExecutionComponent`.

## دورة الحياة والإلغاء

- `dispose()` اختياري على مستوى النوع لكن يجب تنفيذه عندما تمتلك مؤقتات، عمليات فرعية، مراقبين، مآخذ اتصال، أو طبقات علوية.
- يجب استدعاء `done(...)` مرة واحدة فقط من تدفق مكونك.
- لواجهة المستخدم طويلة التشغيل القابلة للإلغاء، اجمع بين `CancellableLoader` و `AbortSignal` واستدعِ `done(...)` من `onAbort`.

مثال على نمط الإلغاء:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## مثال واقعي لمكون مخصص (أمر إضافة)

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

## ملفات التنفيذ الرئيسية

- `packages/tui/src/tui.ts` — `Component`، `Focusable`، علامة المؤشر، التركيز، الطبقة العلوية، إرسال المدخلات.
- `packages/tui/src/utils.ts` — أساسيات العرض/الاقتطاع/التنظيف.
- `packages/tui/src/keys.ts` / `keybindings.ts` — تحليل المفاتيح وتعيين الإجراءات القابلة للتكوين.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — التركيب/إلغاء التركيب التفاعلي لواجهة مستخدم الإضافة/الخطاف/الأداة المخصصة.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — عقود واجهة مستخدم الإضافة والعارضات.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — عقد واجهة مستخدم الخطاف (توقيع custom القديم).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — عقود تنفيذ/عرض الأداة المخصصة.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — تركيب مكونات `renderCall`/`renderResult` وخيارات الحالة الجزئية.
- `packages/coding-agent/src/tools/context.ts` — نشر سياق واجهة مستخدم الأداة (`hasUI`، `ui`).
