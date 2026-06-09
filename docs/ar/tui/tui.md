---
title: تكامل واجهة المستخدم النصية للإضافات والأدوات المخصصة
description: >-
  عقد تكامل واجهة المستخدم النصية للإضافات والأدوات المخصصة ومُصيِّرات العرض
  المخصصة.
sidebar:
  order: 1
  label: تكامل الإضافات
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# تكامل واجهة المستخدم النصية للإضافات والأدوات المخصصة

يغطي هذا المستند عقد واجهة المستخدم النصية **الحالي** المستخدم من قِبل `packages/coding-agent` و `packages/tui` لواجهة مستخدم الإضافات، وواجهة مستخدم الأدوات المخصصة، ومُصيِّرات العرض المخصصة.

## ما هو هذا النظام الفرعي

يتكون وقت التشغيل من طبقتين:

- **محرك التصيير (`packages/tui`)**: مُصيِّر طرفية تفاضلي، إرسال المدخلات، التركيز، الطبقات العلوية، تحديد موضع المؤشر.
- **طبقة التكامل (`packages/coding-agent`)**: تقوم بتحميل مكونات الإضافات/الأدوات المخصصة، وتربط اختصارات المفاتيح/السمة، وتستعيد حالة المحرر.

## سلوك وقت التشغيل حسب الوضع

| الوضع | توفر `ctx.ui.custom(...)` | ملاحظات |
| --- | --- | --- |
| واجهة المستخدم النصية التفاعلية | مدعوم | يتم تحميل المكون في منطقة المحرر، ويُركَّز عليه، ويجب استدعاء `done(result)` للحل. |
| الخلفية/بدون واجهة | غير تفاعلي | سياق واجهة المستخدم لا يعمل (`hasUI === false`). |
| وضع RPC | غير مدعوم | `custom()` تُرجع `Promise<never>` ولا تُحمِّل مكونات واجهة المستخدم النصية. |

إذا كانت الإضافة/الأداة الخاصة بك قادرة على العمل في الوضع غير التفاعلي، استخدم الحماية بـ `ctx.hasUI` / `pi.hasUI`.

## عقد المكون الأساسي (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` يُعرِّف:

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

يستخدم سلوك المؤشر `CURSOR_MARKER` (وليس `getCursorPosition`). المكونات المُركَّز عليها تُصدر العلامة في النص المُصيَّر؛ `TUI` يستخرجها ويُحدد موضع مؤشر الأجهزة.

## قيود التصيير (أمان الطرفية)

يجب أن يكون ناتج `render(width)` آمنًا للطرفية:

1. **لا تتجاوز أبدًا `width` في أي سطر**. المُصيِّر يُلقي خطأ إذا تجاوز سطر غير صوري الحد.
2. **قِس العرض المرئي**، وليس طول السلسلة النصية: استخدم `visibleWidth()`.
3. **اقطع/لُفّ النصوص المتوافقة مع ANSI** باستخدام `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **نظِّف علامات الجدولة/المحتوى** من المصادر الخارجية باستخدام `replaceTabs()` (والمُنظِّفات ذات المستوى الأعلى في مسارات تصيير coding-agent).

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

### احترام اختصارات المفاتيح المُعدَّة من المستخدم

تتلقى مصانع واجهة مستخدم الإضافات `KeybindingsManager` (في الوضع التفاعلي) حتى تتمكن من احترام الإجراءات المُعيَّنة بدلاً من ترميز المفاتيح بشكل ثابت:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### أحداث تحرير/تكرار المفاتيح

يتم تصفية أحداث تحرير المفاتيح ما لم يُعيِّن المكون الخاص بك:

```ts
wantsKeyRelease = true;
```

ثم استخدم `isKeyRelease()` / `isKeyRepeat()` عند الحاجة.

## التركيز والطبقات العلوية والمؤشر

- `TUI.setFocus(component)` يوجه المدخلات إلى ذلك المكون.
- توجد واجهات برمجة الطبقات العلوية في `TUI` (`showOverlay`، `OverlayHandle`)، لكن تحميل `ctx.ui.custom` للإضافات في الوضع التفاعلي يستبدل حاليًا منطقة مكون المحرر مباشرة.
- يوجد خيار `custom(..., options?: { overlay?: boolean })` في أنواع الإضافات؛ التحميل التفاعلي للإضافات يتجاهل هذا الخيار حاليًا.

## نقاط التحميل وعقود الإرجاع

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
- يُركِّز على مكونك.
- عند `done(result)`: يستدعي `component.dispose?.()`, يستعيد المحرر + النص، يُركِّز على المحرر، يحل الوعد.

لذلك `done(...)` إلزامي للإكمال.

## 2) سياق واجهة مستخدم الخطاف/الأداة المخصصة (التنميط القديم)

`HookUIContext.custom` مُنمَّط كـ `(tui, theme, done)` في أنواع الخطاف/الأداة المخصصة.
التطبيق التفاعلي الأساسي يستدعي المصانع بـ `(tui, theme, keybindings, done)`. يمكن لمستهلكي JS استخدام المعامل الإضافي؛ التوافق على مستوى الأنواع لا يزال يعكس التوقيع القديم ذو 3 معاملات.

تستخدم الأدوات المخصصة عادةً نفس نقطة دخول واجهة المستخدم عبر كائن `pi.ui` المُحدَّد بنطاق المصنع، ثم تُرجع القيمة المُختارة في محتوى الأداة العادي:

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

## 3) مُصيِّرات استدعاء/نتيجة الأداة المخصصة

يمكن للأدوات المخصصة وأدوات الإضافات إرجاع مكونات من:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` يتضمن حاليًا:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

يتم تحميل هذه المُصيِّرات بواسطة `ToolExecutionComponent`.

## دورة الحياة والإلغاء

- `dispose()` اختياري على مستوى الأنواع ولكن يجب تطبيقه عندما تمتلك مؤقتات أو عمليات فرعية أو مراقبين أو مقابس أو طبقات علوية.
- يجب استدعاء `done(...)` مرة واحدة فقط من تدفق المكون الخاص بك.
- لواجهة المستخدم القابلة للإلغاء طويلة التشغيل، اربط `CancellableLoader` مع `AbortSignal` واستدعِ `done(...)` من `onAbort`.

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

## ملفات التطبيق الرئيسية

- `packages/tui/src/tui.ts` — `Component`، `Focusable`، علامة المؤشر، التركيز، الطبقة العلوية، إرسال المدخلات.
- `packages/tui/src/utils.ts` — أدوات العرض/القطع/التنظيف الأساسية.
- `packages/tui/src/keys.ts` / `keybindings.ts` — تحليل المفاتيح وتعيين الإجراءات القابلة للتكوين.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — التحميل/إلغاء التحميل التفاعلي لواجهة مستخدم الإضافة/الخطاف/الأداة المخصصة.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — عقود واجهة مستخدم الإضافة ومُصيِّر العرض.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — عقد واجهة مستخدم الخطاف (التوقيع المخصص القديم).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — عقود تنفيذ/تصيير الأداة المخصصة.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — تحميل مكونات `renderCall`/`renderResult` وخيارات الحالة الجزئية.
- `packages/coding-agent/src/tools/context.ts` — نشر سياق واجهة مستخدم الأداة (`hasUI`، `ui`).
