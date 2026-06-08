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

يغطي هذا المستند عقد TUI **الحالي** المستخدم بواسطة `packages/coding-agent` و `packages/tui` لواجهة مستخدم الإضافات، وواجهة مستخدم الأدوات المخصصة، والعارضات المخصصة.

## ما هو هذا النظام الفرعي

يتكون وقت التشغيل من طبقتين:

- **محرك العرض (`packages/tui`)**: عارض طرفي تفاضلي، إرسال المدخلات، التركيز، الطبقات العلوية، تحديد موضع المؤشر.
- **طبقة التكامل (`packages/coding-agent`)**: تثبيت مكونات الإضافات/الأدوات المخصصة، ربط اختصارات المفاتيح/السمات، واستعادة حالة المحرر.

## سلوك وقت التشغيل حسب الوضع

| الوضع | توفر `ctx.ui.custom(...)` | ملاحظات |
| --- | --- | --- |
| TUI تفاعلي | مدعوم | يتم تثبيت المكون في منطقة المحرر، ويتم التركيز عليه، ويجب استدعاء `done(result)` للحل. |
| خلفي/بدون واجهة | غير تفاعلي | سياق واجهة المستخدم لا يفعل شيئاً (`hasUI === false`). |
| وضع RPC | غير مدعوم | `custom()` يُرجع `Promise<never>` ولا يثبّت مكونات TUI. |

إذا كانت إضافتك/أداتك قادرة على العمل في الوضع غير التفاعلي، استخدم الحارس `ctx.hasUI` / `pi.hasUI`.

## عقد المكون الأساسي (`@f5xc-salesdemos/pi-tui`)

يُعرّف `packages/tui/src/tui.ts`:

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

سلوك المؤشر يستخدم `CURSOR_MARKER` (وليس `getCursorPosition`). المكونات المركّزة تبث العلامة في النص المعروض؛ يقوم `TUI` باستخراجها وتحديد موضع مؤشر الأجهزة.

## قيود العرض (سلامة الطرفية)

يجب أن يكون ناتج `render(width)` آمناً للطرفية:

1. **لا تتجاوز أبداً `width` في أي سطر**. يطرح العارض خطأً إذا تجاوز سطر غير صوري العرض المحدد.
2. **قس العرض المرئي**، وليس طول السلسلة النصية: استخدم `visibleWidth()`.
3. **اقتطع/التف النص المدرك لـ ANSI** باستخدام `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **عقّم علامات التبويب/المحتوى** من المصادر الخارجية باستخدام `replaceTabs()` (والمعقّمات عالية المستوى في مسارات عرض coding-agent).

النمط الأدنى:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## معالجة المدخلات واختصارات المفاتيح

### مطابقة المفاتيح الخام

استخدم `matchesKey(data, "...")` لمفاتيح التنقل والتركيبات.

### احترم اختصارات مفاتيح التطبيق المُعدّة من المستخدم

مصانع واجهة مستخدم الإضافات تتلقى `KeybindingsManager` (الوضع التفاعلي) لتتمكن من احترام الإجراءات المعيّنة بدلاً من ترميز المفاتيح ثابتاً:

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
- واجهات الطبقات العلوية موجودة في `TUI` (`showOverlay`، `OverlayHandle`)، لكن تثبيت `ctx.ui.custom` للإضافات في الوضع التفاعلي حالياً يستبدل منطقة مكون المحرر مباشرة.
- الخيار `custom(..., options?: { overlay?: boolean })` موجود في أنواع الإضافات؛ تثبيت الإضافات التفاعلي حالياً يتجاهل هذا الخيار.

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
- يستبدل مكون المحرر بمكونك.
- يركّز على مكونك.
- عند `done(result)`: يستدعي `component.dispose?.()`, يستعيد المحرر + النص، يركّز على المحرر، يحل الوعد.

لذا `done(...)` إلزامي للإكمال.

## 2) سياق واجهة مستخدم الخطافات/الأدوات المخصصة (التنميط القديم)

`HookUIContext.custom` مُنمّط كـ `(tui, theme, done)` في أنواع الخطافات/الأدوات المخصصة.
التنفيذ التفاعلي الأساسي يستدعي المصانع بـ `(tui, theme, keybindings, done)`. مستهلكو JS يمكنهم استخدام الوسيط الإضافي؛ التوافق على مستوى الأنواع لا يزال يعكس التوقيع القديم بثلاثة وسائط.

الأدوات المخصصة عادةً تستخدم نفس نقطة دخول واجهة المستخدم عبر كائن `pi.ui` المحدد نطاقه بالمصنع، ثم تُرجع القيمة المحددة في محتوى الأداة العادي:

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

الأدوات المخصصة وأدوات الإضافات يمكنها إرجاع مكونات من:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` يتضمن حالياً:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

هذه العارضات يتم تثبيتها بواسطة `ToolExecutionComponent`.

## دورة الحياة والإلغاء

- `dispose()` اختياري على مستوى الأنواع لكن يجب تنفيذه عندما تمتلك مؤقتات، عمليات فرعية، مراقبين، مقابس، أو طبقات علوية.
- `done(...)` يجب استدعاؤه مرة واحدة بالضبط من تدفق مكونك.
- لواجهة المستخدم طويلة التشغيل القابلة للإلغاء، اقرن `CancellableLoader` مع `AbortSignal` واستدعِ `done(...)` من `onAbort`.

نمط الإلغاء كمثال:

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

- `packages/tui/src/tui.ts` — `Component`، `Focusable`، علامة المؤشر، التركيز، الطبقات العلوية، إرسال المدخلات.
- `packages/tui/src/utils.ts` — أوليات العرض/الاقتطاع/التعقيم.
- `packages/tui/src/keys.ts` / `keybindings.ts` — تحليل المفاتيح وتعيين الإجراءات القابل للتكوين.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — التثبيت/إزالة التثبيت التفاعلي لواجهة مستخدم الإضافات/الخطافات/الأدوات المخصصة.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — عقود واجهة مستخدم الإضافات والعارضات.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — عقد واجهة مستخدم الخطافات (توقيع custom القديم).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — عقود تنفيذ/عرض الأدوات المخصصة.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — تثبيت مكونات `renderCall`/`renderResult` وخيارات الحالة الجزئية.
- `packages/coding-agent/src/tools/context.ts` — نشر سياق واجهة مستخدم الأداة (`hasUI`، `ui`).
