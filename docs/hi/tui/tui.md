---
title: एक्सटेंशन और कस्टम टूल के लिए TUI एकीकरण
description: 'एक्सटेंशन, कस्टम टूल, और कस्टम रेंडरर के लिए TUI एकीकरण अनुबंध।'
sidebar:
  order: 1
  label: एक्सटेंशन एकीकरण
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# एक्सटेंशन और कस्टम टूल के लिए TUI एकीकरण

यह दस्तावेज़ **वर्तमान** TUI अनुबंध को कवर करता है जिसका उपयोग `packages/coding-agent` और `packages/tui` द्वारा एक्सटेंशन UI, कस्टम टूल UI, और कस्टम रेंडरर के लिए किया जाता है।

## यह सबसिस्टम क्या है

रनटाइम में दो परतें हैं:

- **रेंडरिंग इंजन (`packages/tui`)**: डिफरेंशियल टर्मिनल रेंडरर, इनपुट डिस्पैच, फोकस, ओवरले, कर्सर प्लेसमेंट।
- **एकीकरण परत (`packages/coding-agent`)**: एक्सटेंशन/कस्टम-टूल कंपोनेंट माउंट करती है, कीबाइंडिंग/थीम वायर करती है, और एडिटर स्टेट पुनर्स्थापित करती है।

## मोड के अनुसार रनटाइम व्यवहार

| मोड | `ctx.ui.custom(...)` उपलब्धता | नोट्स |
| --- | --- | --- |
| इंटरैक्टिव TUI | समर्थित | कंपोनेंट एडिटर क्षेत्र में माउंट किया जाता है, फोकस किया जाता है, और रिज़ॉल्व करने के लिए `done(result)` कॉल करना आवश्यक है। |
| बैकग्राउंड/हेडलेस | इंटरैक्टिव नहीं | UI कॉन्टेक्स्ट नो-ऑप है (`hasUI === false`)। |
| RPC मोड | समर्थित नहीं | `custom()` `Promise<never>` लौटाता है और TUI कंपोनेंट माउंट नहीं करता। |

यदि आपका एक्सटेंशन/टूल नॉन-इंटरैक्टिव मोड में चल सकता है, तो `ctx.hasUI` / `pi.hasUI` से गार्ड करें।

## कोर कंपोनेंट अनुबंध (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` परिभाषित करता है:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` अलग है:

```ts
export interface Focusable {
  focused: boolean;
}
```

कर्सर व्यवहार `CURSOR_MARKER` का उपयोग करता है (`getCursorPosition` नहीं)। फोकस्ड कंपोनेंट रेंडर किए गए टेक्स्ट में मार्कर उत्सर्जित करते हैं; `TUI` इसे निकालता है और हार्डवेयर कर्सर को स्थित करता है।

## रेंडरिंग बाधाएं (टर्मिनल सुरक्षा)

आपका `render(width)` आउटपुट टर्मिनल-सुरक्षित होना चाहिए:

1. **किसी भी लाइन पर `width` से अधिक न हो**। रेंडरर त्रुटि देता है यदि कोई नॉन-इमेज लाइन ओवरफ्लो करती है।
2. **विज़ुअल चौड़ाई मापें**, स्ट्रिंग लंबाई नहीं: `visibleWidth()` का उपयोग करें।
3. **ANSI-अवेयर टेक्स्ट को ट्रंकेट/रैप करें** `truncateToWidth()` / `wrapTextWithAnsi()` के साथ।
4. **बाहरी स्रोतों से टैब/कंटेंट को सैनिटाइज़ करें** `replaceTabs()` का उपयोग करके (और coding-agent रेंडर पाथ में उच्च-स्तरीय सैनिटाइज़र)।

न्यूनतम पैटर्न:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## इनपुट हैंडलिंग और कीबाइंडिंग

### रॉ की मैचिंग

नेविगेशन कीज़ और कॉम्बो के लिए `matchesKey(data, "...")` का उपयोग करें।

### उपयोगकर्ता-कॉन्फ़िगर्ड ऐप कीबाइंडिंग का सम्मान करें

एक्सटेंशन UI फैक्ट्रियां एक `KeybindingsManager` (इंटरैक्टिव मोड) प्राप्त करती हैं ताकि आप कीज़ हार्डकोड करने के बजाय मैप की गई एक्शन का सम्मान कर सकें:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### की रिलीज़/रिपीट इवेंट्स

की रिलीज़ इवेंट्स फ़िल्टर किए जाते हैं जब तक आपका कंपोनेंट सेट न करे:

```ts
wantsKeyRelease = true;
```

फिर आवश्यकतानुसार `isKeyRelease()` / `isKeyRepeat()` का उपयोग करें।

## फोकस, ओवरले, और कर्सर

- `TUI.setFocus(component)` उस कंपोनेंट को इनपुट रूट करता है।
- ओवरले API `TUI` में मौजूद हैं (`showOverlay`, `OverlayHandle`), लेकिन इंटरैक्टिव मोड में एक्सटेंशन `ctx.ui.custom` माउंटिंग वर्तमान में एडिटर कंपोनेंट क्षेत्र को सीधे प्रतिस्थापित करती है।
- `custom(..., options?: { overlay?: boolean })` विकल्प एक्सटेंशन टाइप्स में मौजूद है; इंटरैक्टिव एक्सटेंशन माउंटिंग वर्तमान में इस विकल्प को अनदेखा करती है।

## माउंट पॉइंट और रिटर्न अनुबंध

## 1) एक्सटेंशन UI (`ExtensionUIContext`)

वर्तमान सिग्नेचर (`extensibility/extensions/types.ts`):

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

इंटरैक्टिव मोड में व्यवहार (`extension-ui-controller.ts`):

- एडिटर टेक्स्ट सेव करता है।
- आपके कंपोनेंट से एडिटर कंपोनेंट को प्रतिस्थापित करता है।
- आपके कंपोनेंट को फोकस करता है।
- `done(result)` पर: `component.dispose?.()` कॉल करता है, एडिटर + टेक्स्ट पुनर्स्थापित करता है, एडिटर को फोकस करता है, प्रॉमिस रिज़ॉल्व करता है।

इसलिए पूर्णता के लिए `done(...)` अनिवार्य है।

## 2) हुक/कस्टम-टूल UI कॉन्टेक्स्ट (लेगेसी टाइपिंग)

`HookUIContext.custom` हुक/कस्टम-टूल टाइप्स में `(tui, theme, done)` के रूप में टाइप किया गया है।
अंतर्निहित इंटरैक्टिव कार्यान्वयन फैक्ट्रियों को `(tui, theme, keybindings, done)` के साथ कॉल करता है। JS उपभोक्ता अतिरिक्त arg का उपयोग कर सकते हैं; टाइप-लेवल संगतता अभी भी 3-arg लेगेसी सिग्नेचर को दर्शाती है।

कस्टम टूल आमतौर पर फैक्ट्री-स्कोप्ड `pi.ui` ऑब्जेक्ट के माध्यम से उसी UI एंट्रीपॉइंट का उपयोग करते हैं, फिर सामान्य टूल कंटेंट में चयनित मान लौटाते हैं:

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

## 3) कस्टम टूल कॉल/रिज़ल्ट रेंडरर

कस्टम टूल और एक्सटेंशन टूल इनसे कंपोनेंट लौटा सकते हैं:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` में वर्तमान में शामिल है:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

ये रेंडरर `ToolExecutionComponent` द्वारा माउंट किए जाते हैं।

## जीवनचक्र और रद्दीकरण

- `dispose()` टाइप स्तर पर वैकल्पिक है लेकिन जब आपके पास टाइमर, सबप्रोसेस, वॉचर, सॉकेट, या ओवरले हों तो इसे कार्यान्वित किया जाना चाहिए।
- `done(...)` को आपके कंपोनेंट फ्लो से ठीक एक बार कॉल किया जाना चाहिए।
- रद्द करने योग्य लंबे समय तक चलने वाले UI के लिए, `CancellableLoader` को `AbortSignal` के साथ जोड़ें और `onAbort` से `done(...)` कॉल करें।

रद्दीकरण पैटर्न उदाहरण:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## यथार्थवादी कस्टम कंपोनेंट उदाहरण (एक्सटेंशन कमांड)

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

## प्रमुख कार्यान्वयन फ़ाइलें

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, कर्सर मार्कर, फोकस, ओवरले, इनपुट डिस्पैच।
- `packages/tui/src/utils.ts` — चौड़ाई/ट्रंकेशन/सैनिटाइज़ेशन प्रिमिटिव।
- `packages/tui/src/keys.ts` / `keybindings.ts` — की पार्सिंग और कॉन्फ़िगर करने योग्य एक्शन मैपिंग।
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — एक्सटेंशन/हुक/कस्टम-टूल UI के लिए इंटरैक्टिव माउंटिंग/अनमाउंटिंग।
- `packages/coding-agent/src/extensibility/extensions/types.ts` — एक्सटेंशन UI और रेंडरर अनुबंध।
- `packages/coding-agent/src/extensibility/hooks/types.ts` — हुक UI अनुबंध (लेगेसी कस्टम सिग्नेचर)।
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — कस्टम टूल एक्ज़ीक्यूट/रेंडर अनुबंध।
- `packages/coding-agent/src/modes/components/tool-execution.ts` — `renderCall`/`renderResult` कंपोनेंट और पार्शियल-स्टेट विकल्प माउंट करना।
- `packages/coding-agent/src/tools/context.ts` — टूल UI कॉन्टेक्स्ट प्रसार (`hasUI`, `ui`)।
