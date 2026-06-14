---
title: تكامل TUI للإضافات والأدوات المخصصة
description: عقد تكامل TUI للإضافات والأدوات المخصصة والمصيّرات المخصصة.
sidebar:
  order: 1
  label: تكامل الإضافات
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# تكامل TUI للإضافات والأدوات المخصصة

تتناول هذه الوثيقة عقد TUI **الحالي** المستخدم من قِبَل `packages/coding-agent` و`packages/tui` لواجهة مستخدم الإضافات، وواجهة مستخدم الأدوات المخصصة، والمصيّرات المخصصة.

## ماهية هذا النظام الفرعي

يتكون وقت التشغيل من طبقتين:

- **محرك التصيير (`packages/tui`)**: مصيّر طرفية تفاضلي، توزيع المدخلات، التركيز، التراكبات، وضع المؤشر.
- **طبقة التكامل (`packages/coding-agent`)**: تثبّت مكونات الإضافات/الأدوات المخصصة، وتوصّل اختصارات لوحة المفاتيح/السمة، وتستعيد حالة المحرر.

## سلوك وقت التشغيل حسب الوضع

| الوضع | إتاحة `ctx.ui.custom(...)` | ملاحظات |
| --- | --- | --- |
| TUI التفاعلي | مدعوم | يُثبَّت المكوّن في منطقة المحرر، ويُركَّز عليه، ويجب أن يستدعي `done(result)` للحل. |
| خلفي/بدون واجهة | غير تفاعلي | سياق واجهة المستخدم لا يؤدي أي وظيفة (`hasUI === false`). |
| وضع RPC | غير مدعوم | تُعيد `custom()` قيمة `Promise<never>` ولا تثبّت مكونات TUI. |

إذا كانت إضافتك/أداتك قادرة على العمل في الوضع غير التفاعلي، فاحرص على التحقق من `ctx.hasUI` / `pi.hasUI`.

## عقد المكوّن الأساسي (`@f5xc-salesdemos/pi-tui`)

يُعرِّف `packages/tui/src/tui.ts`:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` منفصلة:

```ts
export interface Focusable {
  focused: boolean;
}
```

يستخدم سلوك المؤشر `CURSOR_MARKER` (وليس `getCursorPosition`). تُصدر المكونات المُركَّزة عليها العلامة في النص المُصيَّر؛ ويستخرجها `TUI` ويضع مؤشر الأجهزة في موضعه المناسب.

## قيود التصيير (أمان الطرفية)

يجب أن يكون ناتج `render(width)` آمنًا للطرفية:

1. **لا تتجاوز `width` في أي سطر**. يُطلق المصيّر استثناءً إذا تجاوز سطر غير صوري العرض المحدد.
2. **قِس العرض المرئي**، لا طول السلسلة: استخدم `visibleWidth()`.
3. **اقتطع/التف النص المدرك لـ ANSI** باستخدام `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **عقِّم علامات التبويب/المحتوى** من المصادر الخارجية باستخدام `replaceTabs()` (ومعقِّمات ذات مستوى أعلى في مسارات تصيير coding-agent).

النمط الأدنى:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## معالجة المدخلات واختصارات لوحة المفاتيح

### مطابقة المفاتيح الخام

استخدم `matchesKey(data, "...")` لمفاتيح التنقل والتركيبات.

### احترام اختصارات لوحة المفاتيح المهيَّأة من قِبَل المستخدم

تستقبل مصانع واجهة مستخدم الإضافات `KeybindingsManager` (في الوضع التفاعلي) حتى تتمكن من تكريم الإجراءات المعيَّنة بدلًا من ترميز المفاتيح مباشرةً:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### أحداث إفلات/تكرار المفاتيح

تُصفَّى أحداث إفلات المفاتيح ما لم يُعيّن مكوّنك:

```ts
wantsKeyRelease = true;
```

ثم استخدم `isKeyRelease()` / `isKeyRepeat()` عند الحاجة.

## التركيز والتراكبات والمؤشر

- يوجِّه `TUI.setFocus(component)` المدخلات إلى ذلك المكوّن.
- توجد واجهات برمجية للتراكبات في `TUI` (`showOverlay`، `OverlayHandle`)، لكن تثبيت `ctx.ui.custom` للإضافات في الوضع التفاعلي يستبدل منطقة مكوّن المحرر مباشرةً حاليًا.
- يوجد خيار `custom(..., options?: { overlay?: boolean })` في أنواع الإضافات؛ ويتجاهل التثبيت التفاعلي للإضافات هذا الخيار حاليًا.

## نقاط التثبيت وعقود الإرجاع

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
- يركّز على مكوّنك.
- عند `done(result)`: يستدعي `component.dispose?.()` ويستعيد المحرر والنص، ويركّز على المحرر، ويحل الوعد.

لذا فإن `done(...)` إلزامي للإكمال.

## 2) سياق واجهة مستخدم Hook/الأداة المخصصة (الكتابة القديمة)

يكتب `HookUIContext.custom` بالشكل `(tui, theme, done)` في أنواع hook/الأداة المخصصة.
التنفيذ التفاعلي الداخلي يستدعي المصانع بـ `(tui, theme, keybindings, done)`. يمكن للمستهلكين من JavaScript استخدام الوسيطة الإضافية؛ لكن التوافق على مستوى الأنواع لا يزال يعكس توقيع القديم ذا الثلاث وسيطات.

تستخدم الأدوات المخصصة عادةً نقطة دخول واجهة المستخدم نفسها عبر كائن `pi.ui` المحدد بنطاق المصنع، ثم تُعيد القيمة المحددة في محتوى الأداة الاعتيادي:

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

## 3) مصيّرات استدعاء/نتيجة الأداة المخصصة

يمكن للأدوات المخصصة وأدوات الإضافات إرجاع مكونات من:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

تشمل `options` حاليًا:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

يُثبِّت `ToolExecutionComponent` هذه المصيّرات.

## دورة الحياة والإلغاء

- `dispose()` اختيارية على مستوى النوع، لكن ينبغي تنفيذها عندما تمتلك مؤقتات، أو عمليات فرعية، أو مراقبين، أو مآخذ توصيل، أو تراكبات.
- ينبغي استدعاء `done(...)` مرة واحدة بالضبط من تدفق مكوّنك.
- لواجهة المستخدم طويلة الأمد القابلة للإلغاء، قرِن `CancellableLoader` مع `AbortSignal` واستدعِ `done(...)` من `onAbort`.

نمط الإلغاء المثالي:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## مثال واقعي لمكوّن مخصص (أمر إضافة)

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

## الملفات الرئيسية للتنفيذ

- `packages/tui/src/tui.ts` — `Component`، `Focusable`، علامة المؤشر، التركيز، التراكب، توزيع المدخلات.
- `packages/tui/src/utils.ts` — أوليات العرض/الاقتطاع/التعقيم.
- `packages/tui/src/keys.ts` / `keybindings.ts` — تحليل المفاتيح وتعيين الإجراءات القابلة للتهيئة.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — التثبيت/الإلغاء التفاعلي لواجهة مستخدم الإضافات/hooks/الأدوات المخصصة.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — عقود واجهة مستخدم الإضافات والمصيّرات.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — عقد واجهة مستخدم hook (التوقيع المخصص القديم).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — عقود تنفيذ/تصيير الأدوات المخصصة.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — تثبيت مكونات `renderCall`/`renderResult` وخيارات الحالة الجزئية.
- `packages/coding-agent/src/tools/context.ts` — نشر سياق واجهة مستخدم الأداة (`hasUI`، `ui`).
