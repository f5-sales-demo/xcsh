---
title: एक्सटेंशन और कस्टम टूल्स के लिए TUI इंटीग्रेशन
description: 'एक्सटेंशन, कस्टम टूल्स और कस्टम रेंडरर्स के लिए TUI इंटीग्रेशन कॉन्ट्रैक्ट।'
sidebar:
  order: 1
  label: एक्सटेंशन इंटीग्रेशन
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# एक्सटेंशन और कस्टम टूल्स के लिए TUI इंटीग्रेशन

यह दस्तावेज़ **वर्तमान** TUI कॉन्ट्रैक्ट को कवर करता है जो `packages/coding-agent` और `packages/tui` द्वारा एक्सटेंशन UI, कस्टम टूल UI, और कस्टम रेंडरर्स के लिए उपयोग किया जाता है।

## यह सबसिस्टम क्या है

रनटाइम में दो लेयर हैं:

- **रेंडरिंग इंजन (`packages/tui`)**: डिफरेंशियल टर्मिनल रेंडरर, इनपुट डिस्पैच, फोकस, ओवरले, कर्सर प्लेसमेंट।
- **इंटीग्रेशन लेयर (`packages/coding-agent`)**: एक्सटेंशन/कस्टम-टूल कंपोनेंट्स को माउंट करता है, कीबाइंडिंग्स/थीम को वायर करता है, और एडिटर स्टेट को रिस्टोर करता है।

## मोड के अनुसार रनटाइम व्यवहार

| मोड | `ctx.ui.custom(...)` उपलब्धता | नोट्स |
| --- | --- | --- |
| इंटरैक्टिव TUI | समर्थित | कंपोनेंट एडिटर एरिया में माउंट होता है, फोकस होता है, और रिज़ॉल्व करने के लिए `done(result)` कॉल करना अनिवार्य है। |
| बैकग्राउंड/हेडलेस | इंटरैक्टिव नहीं | UI कॉन्टेक्स्ट नो-ऑप है (`hasUI === false`)। |
| RPC मोड | समर्थित नहीं | `custom()` `Promise<never>` रिटर्न करता है और TUI कंपोनेंट्स माउंट नहीं करता। |

यदि आपका एक्सटेंशन/टूल नॉन-इंटरैक्टिव मोड में चल सकता है, तो `ctx.hasUI` / `pi.hasUI` से गार्ड करें।

## कोर कंपोनेंट कॉन्ट्रैक्ट (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` में परिभाषित है:

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

कर्सर व्यवहार `CURSOR_MARKER` का उपयोग करता है (`getCursorPosition` का नहीं)। फोकस्ड कंपोनेंट्स रेंडर किए गए टेक्स्ट में मार्कर एमिट करते हैं; `TUI` इसे एक्सट्रैक्ट करता है और हार्डवेयर कर्सर को पोज़िशन करता है।

## रेंडरिंग बाधाएँ (टर्मिनल सेफ्टी)

आपका `render(width)` आउटपुट टर्मिनल-सेफ होना चाहिए:

1. **किसी भी लाइन पर `width` से अधिक न हो**। रेंडरर एरर थ्रो करता है यदि कोई नॉन-इमेज लाइन ओवरफ्लो होती है।
2. **विज़ुअल विड्थ मापें**, स्ट्रिंग लेंथ नहीं: `visibleWidth()` का उपयोग करें।
3. **ANSI-अवेयर टेक्स्ट को ट्रंकेट/रैप करें** `truncateToWidth()` / `wrapTextWithAnsi()` से।
4. **बाहरी स्रोतों से टैब्स/कंटेंट को सैनिटाइज़ करें** `replaceTabs()` का उपयोग करके (और coding-agent रेंडर पाथ्स में हायर-लेवल सैनिटाइज़र्स)।

न्यूनतम पैटर्न:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## इनपुट हैंडलिंग और कीबाइंडिंग्स

### रॉ की मैचिंग

नेविगेशन कीज़ और कॉम्बोस के लिए `matchesKey(data, "...")` का उपयोग करें।

### यूज़र-कॉन्फ़िगर्ड ऐप कीबाइंडिंग्स का सम्मान करें

एक्सटेंशन UI फैक्ट्रीज़ को एक `KeybindingsManager` (इंटरैक्टिव मोड) प्राप्त होता है ताकि आप कीज़ को हार्डकोड करने के बजाय मैप्ड एक्शन्स का सम्मान कर सकें:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### की रिलीज़/रिपीट इवेंट्स

की रिलीज़ इवेंट्स फ़िल्टर हो जाते हैं जब तक आपका कंपोनेंट यह सेट नहीं करता:

```ts
wantsKeyRelease = true;
```

फिर आवश्यकता होने पर `isKeyRelease()` / `isKeyRepeat()` का उपयोग करें।

## फोकस, ओवरले, और कर्सर

- `TUI.setFocus(component)` उस कंपोनेंट को इनपुट रूट करता है।
- ओवरले API `TUI` में मौजूद हैं (`showOverlay`, `OverlayHandle`), लेकिन इंटरैक्टिव मोड में एक्सटेंशन `ctx.ui.custom` माउंटिंग वर्तमान में एडिटर कंपोनेंट एरिया को सीधे रिप्लेस करती है।
- `custom(..., options?: { overlay?: boolean })` विकल्प एक्सटेंशन टाइप्स में मौजूद है; इंटरैक्टिव एक्सटेंशन माउंटिंग वर्तमान में इस विकल्प को अनदेखा करती है।

## माउंट पॉइंट्स और रिटर्न कॉन्ट्रैक्ट्स

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
- एडिटर कंपोनेंट को आपके कंपोनेंट से रिप्लेस करता है।
- आपके कंपोनेंट को फोकस करता है।
- `done(result)` पर: `component.dispose?.()` कॉल करता है, एडिटर + टेक्स्ट रिस्टोर करता है, एडिटर को फोकस करता है, प्रॉमिस रिज़ॉल्व करता है।

इसलिए `done(...)` पूर्णता के लिए अनिवार्य है।

## 2) हुक/कस्टम-टूल UI कॉन्टेक्स्ट (लेगेसी टाइपिंग)

`HookUIContext.custom` को हुक/कस्टम-टूल टाइप्स में `(tui, theme, done)` के रूप में टाइप किया गया है।
अंतर्निहित इंटरैक्टिव इम्प्लीमेंटेशन फैक्ट्रीज़ को `(tui, theme, keybindings, done)` के साथ कॉल करता है। JS कंज़्यूमर्स अतिरिक्त आर्ग का उपयोग कर सकते हैं; टाइप-लेवल कम्पैटिबिलिटी अभी भी 3-आर्ग लेगेसी सिग्नेचर को रिफ्लेक्ट करती है।

कस्टम टूल्स आमतौर पर फैक्ट्री-स्कोप्ड `pi.ui` ऑब्जेक्ट के माध्यम से उसी UI एंट्रीपॉइंट का उपयोग करते हैं, फिर सामान्य टूल कंटेंट में चयनित मान रिटर्न करते हैं:

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

## 3) कस्टम टूल कॉल/रिज़ल्ट रेंडरर्स

कस्टम टूल्स और एक्सटेंशन टूल्स इनसे कंपोनेंट्स रिटर्न कर सकते हैं:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` में वर्तमान में शामिल है:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

ये रेंडरर्स `ToolExecutionComponent` द्वारा माउंट किए जाते हैं।

## लाइफसाइकल और कैंसिलेशन

- `dispose()` टाइप लेवल पर वैकल्पिक है लेकिन जब आपके पास टाइमर्स, सबप्रोसेसेज़, वॉचर्स, सॉकेट्स, या ओवरले हों तो इसे इम्प्लीमेंट करना चाहिए।
- `done(...)` को आपके कंपोनेंट फ्लो से ठीक एक बार कॉल किया जाना चाहिए।
- कैंसिल करने योग्य लंबे समय तक चलने वाले UI के लिए, `CancellableLoader` को `AbortSignal` के साथ जोड़ें और `onAbort` से `done(...)` कॉल करें।

कैंसिलेशन पैटर्न का उदाहरण:

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

## प्रमुख इम्प्लीमेंटेशन फ़ाइलें

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, कर्सर मार्कर, फोकस, ओवरले, इनपुट डिस्पैच।
- `packages/tui/src/utils.ts` — विड्थ/ट्रंकेशन/सैनिटाइज़ेशन प्रिमिटिव्स।
- `packages/tui/src/keys.ts` / `keybindings.ts` — की पार्सिंग और कॉन्फ़िगर करने योग्य एक्शन मैपिंग।
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — एक्सटेंशन/हुक/कस्टम-टूल UI के लिए इंटरैक्टिव माउंटिंग/अनमाउंटिंग।
- `packages/coding-agent/src/extensibility/extensions/types.ts` — एक्सटेंशन UI और रेंडरर कॉन्ट्रैक्ट्स।
- `packages/coding-agent/src/extensibility/hooks/types.ts` — हुक UI कॉन्ट्रैक्ट (लेगेसी कस्टम सिग्नेचर)।
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — कस्टम टूल execute/render कॉन्ट्रैक्ट्स।
- `packages/coding-agent/src/modes/components/tool-execution.ts` — `renderCall`/`renderResult` कंपोनेंट्स और पार्शियल-स्टेट विकल्पों को माउंट करना।
- `packages/coding-agent/src/tools/context.ts` — टूल UI कॉन्टेक्स्ट प्रोपेगेशन (`hasUI`, `ui`)।
