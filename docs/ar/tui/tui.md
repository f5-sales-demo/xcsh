---
title: تكامل TUI للإضافات والأدوات المخصصة
description: عقد تكامل TUI للإضافات والأدوات المخصصة ومعالجات العرض المخصصة.
sidebar:
  order: 1
  label: تكامل الإضافات
i18n:
  sourceHash: 47f8f2b2045e
  translator: machine
---

# تكامل TUI للإضافات والأدوات المخصصة

تغطي هذه الوثيقة عقد TUI **الحالي** المستخدم من قِبَل `packages/coding-agent` و`packages/tui` لواجهة مستخدم الإضافات، وواجهة مستخدم الأدوات المخصصة، ومعالجات العرض المخصصة.

## ما هو هذا النظام الفرعي

يتكون وقت التشغيل من طبقتين:

- **محرك العرض (`packages/tui`)**: معالج طرفية تفاضلي، إرسال المدخلات، التركيز، الطبقات العلوية، وضع المؤشر.
- **طبقة التكامل (`packages/coding-agent`)**: تركيب مكونات الإضافات/الأدوات المخصصة، وربط اختصارات المفاتيح/السمة، واستعادة حالة المحرر.

## سلوك وقت التشغيل حسب الوضع

| الوضع | توافر `ctx.ui.custom(...)` | ملاحظات |
| --- | --- | --- |
| TUI تفاعلي | مدعوم | يُركَّب المكوّن في منطقة المحرر، ويُركَّز عليه، ويجب أن يستدعي `done(result)` للحل. |
| خلفي/بدون رأس | غير تفاعلي | سياق واجهة المستخدم بلا تأثير (`hasUI === false`). |
| وضع RPC | غير مدعوم | يُعيد `custom()` القيمة `Promise<never>` ولا يركّب مكونات TUI. |

إذا كانت إضافتك/أداتك قادرة على العمل في الوضع غير التفاعلي، استخدم `ctx.hasUI` / `pi.hasUI` كحارس.

## عقد المكوّن الأساسي (`@f5-sales-demo/pi-tui`)

يُعرِّف `packages/tui/src/tui.ts`:

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

يستخدم سلوك المؤشر `CURSOR_MARKER` (وليس `getCursorPosition`). تُصدر المكونات المُركَّزة العلامة في النص المعروض؛ يستخرجها `TUI` ويضع مؤشر الأجهزة.

## قيود العرض (أمان الطرفية)

يجب أن يكون مخرج `render(width)` آمناً للطرفية:

1. **لا تتجاوز `width` في أي سطر أبداً**. يُطلق المعالج استثناءً إذا تجاوز سطر غير صوري الحد.
2. **قِس العرض المرئي**، وليس طول السلسلة: استخدم `visibleWidth()`.
3. **اقطع/التف النص المدرك لـ ANSI** باستخدام `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **عقّم الجداول/المحتوى** من المصادر الخارجية باستخدام `replaceTabs()` (ومعقّمات المستوى الأعلى في مسارات عرض coding-agent).

النمط الأدنى:

```ts
import { replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## معالجة المدخلات واختصارات المفاتيح

### مطابقة المفاتيح الخام

استخدم `matchesKey(data, "...")` لمفاتيح التنقل والتركيبات.

### احترام اختصارات مفاتيح التطبيق التي يضبطها المستخدم

تستقبل مصانع واجهة مستخدم الإضافة `KeybindingsManager` (في الوضع التفاعلي) حتى تتمكن من مراعاة الإجراءات المعيّنة بدلاً من ترميز المفاتيح:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### أحداث تحرير المفاتيح/التكرار

تُصفَّى أحداث تحرير المفاتيح ما لم يضبط مكوّنك:

```ts
wantsKeyRelease = true;
```

عندها استخدم `isKeyRelease()` / `isKeyRepeat()` عند الحاجة.

## التركيز والطبقات العلوية والمؤشر

- يوجّه `TUI.setFocus(component)` المدخلات إلى ذلك المكوّن.
- توجد واجهات برمجية للطبقات العلوية في `TUI` (`showOverlay`، `OverlayHandle`)، لكن تركيب `ctx.ui.custom` في الوضع التفاعلي يستبدل منطقة مكوّن المحرر مباشرةً حالياً.
- يوجد الخيار `custom(..., options?: { overlay?: boolean })` في أنواع الإضافات؛ يتجاهل تركيب الإضافات التفاعلي هذا الخيار حالياً.

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
- يستبدل مكوّن المحرر بمكوّنك.
- يُركّز على مكوّنك.
- عند `done(result)`: يستدعي `component.dispose?.()` ويستعيد المحرر والنص، ويُركّز على المحرر، ويحل الوعد.

لذا فإن `done(...)` إلزامي للإتمام.

## 2) سياق واجهة مستخدم الخطاف/الأداة المخصصة (كتابة قديمة)

`HookUIContext.custom` مكتوب بصيغة `(tui, theme, done)` في أنواع الخطاف/الأداة المخصصة.
الاستجابة التفاعلية الأساسية تستدعي المصانع بـ `(tui, theme, keybindings, done)`. يمكن لمستهلكي JS استخدام الوسيطة الإضافية؛ لا تزال التوافقية على مستوى الأنواع تعكس التوقيع القديم المكوّن من 3 وسيطات.

تستخدم الأدوات المخصصة عادةً نقطة دخول واجهة المستخدم ذاتها عبر كائن `pi.ui` المحدد للمصنع، ثم تُعيد القيمة المحددة في محتوى الأداة العادي:

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

## 3) معالجات عرض استدعاء/نتيجة الأداة المخصصة

يمكن للأدوات المخصصة وأدوات الإضافات إرجاع المكونات من:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

يتضمن `options` حالياً:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

تُركَّب هذه المعالجات بواسطة `ToolExecutionComponent`.

## دورة الحياة والإلغاء

- `dispose()` اختياري على مستوى الأنواع، لكن ينبغي تنفيذه عندما تمتلك مؤقتات أو عمليات فرعية أو مراقبين أو مقابس أو طبقات علوية.
- ينبغي استدعاء `done(...)` مرة واحدة بالضبط من تدفق مكوّنك.
- لواجهة مستخدم طويلة الأمد قابلة للإلغاء، اقرن `CancellableLoader` بـ `AbortSignal` واستدع `done(...)` من `onAbort`.

مثال على نمط الإلغاء:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## مثال واقعي لمكوّن مخصص (أمر إضافة)

```ts
import type { Component } from "@f5-sales-demo/pi-tui";
import { SelectList, matchesKey, replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@f5-sales-demo/xcsh";

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
- `packages/tui/src/utils.ts` — أساسيات العرض/القطع/التعقيم.
- `packages/tui/src/keys.ts` / `keybindings.ts` — تحليل المفاتيح وتعيين الإجراءات القابلة للضبط.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — التركيب/الفك التفاعلي لواجهة مستخدم الإضافة/الخطاف/الأداة المخصصة.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — عقود واجهة مستخدم الإضافة ومعالج العرض.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — عقد واجهة مستخدم الخطاف (التوقيع المخصص القديم).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — عقود تنفيذ/عرض الأداة المخصصة.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — تركيب مكونات `renderCall`/`renderResult` وخيارات الحالة الجزئية.
- `packages/coding-agent/src/tools/context.ts` — نشر سياق واجهة مستخدم الأداة (`hasUI`، `ui`).
