---
title: कस्टम उपकरण
description: >-
  एजेंट को विस्तारित करने के लिए कस्टम टूल पंजीकरण, स्कीमा परिभाषा और निष्पादन
  पाइपलाइन।
sidebar:
  order: 4
  label: कस्टम उपकरण
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# कस्टम उपकरण

कस्टम उपकरण मॉडल-कॉल करने योग्य फ़ंक्शन हैं जो बिल्ट-इन उपकरणों के समान टूल एक्जीक्यूशन पाइपलाइन में प्लग होते हैं।

एक कस्टम टूल एक TypeScript/JavaScript मॉड्यूल होता है जो एक फ़ैक्टरी एक्सपोर्ट करता है। फ़ैक्टरी एक होस्ट API (`CustomToolAPI`) प्राप्त करती है और एक टूल या टूल्स की एक सरणी लौटाती है।

## यह क्या है (और क्या नहीं है)

- **कस्टम टूल**: एक टर्न के दौरान मॉडल द्वारा कॉल करने योग्य (`execute` + TypeBox स्कीमा)।
- **एक्सटेंशन**: लाइफ़साइकिल/इवेंट फ्रेमवर्क जो टूल्स पंजीकृत कर सकता है और इवेंट को इंटरसेप्ट/संशोधित कर सकता है।
- **हुक**: बाहरी प्री/पोस्ट कमांड स्क्रिप्ट।
- **स्किल**: स्थैतिक मार्गदर्शन/संदर्भ पैकेज, निष्पादन योग्य टूल कोड नहीं।

यदि आपको मॉडल को सीधे कोड कॉल करने की आवश्यकता है, तो कस्टम टूल का उपयोग करें।

## वर्तमान कोड में एकीकरण पथ

दो सक्रिय एकीकरण शैलियाँ हैं:

1. **SDK-प्रदत्त कस्टम उपकरण** (`options.customTools`)
   - `CustomToolAdapter` या एक्सटेंशन रैपर्स के माध्यम से एजेंट टूल्स में लपेटे जाते हैं।
   - SDK बूटस्ट्रैप में हमेशा प्रारंभिक सक्रिय टूल सेट में शामिल होते हैं।

2. **लोडर API के माध्यम से फाइलसिस्टम-खोजे गए मॉड्यूल** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - `src/extensibility/custom-tools/loader.ts` में लाइब्रेरी API के रूप में एक्सपोज़ किए गए।
   - होस्ट कोड कॉन्फ़िग/प्रोवाइडर/प्लगइन पथों से टूल मॉड्यूल खोजने और लोड करने के लिए इन्हें कॉल कर सकता है।

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## खोज स्थान (लोडर API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` निम्नलिखित को मर्ज करता है:

1. क्षमता प्रोवाइडर (`toolCapability`), जिनमें शामिल हैं:
   - नेटिव OMP कॉन्फ़िग (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude कॉन्फ़िग (`~/.claude/tools`, `.claude/tools`)
   - Codex कॉन्फ़िग (`~/.codex/tools`, `.codex/tools`)
   - Claude मार्केटप्लेस प्लगइन कैश प्रोवाइडर
2. इंस्टॉल किए गए प्लगइन मैनिफेस्ट (`~/.xcsh/plugins/node_modules/*` प्लगइन लोडर के माध्यम से)
3. लोडर को पास किए गए स्पष्ट कॉन्फ़िगर किए गए पथ

### महत्वपूर्ण व्यवहार

- डुप्लिकेट रिज़ॉल्व किए गए पथों को डीडुप्लिकेट किया जाता है।
- टूल नाम के संघर्षों को बिल्ट-इन और पहले से लोड किए गए कस्टम टूल्स के विरुद्ध अस्वीकार किया जाता है।
- `.md` और `.json` फाइलें कुछ प्रोवाइडर्स द्वारा टूल मेटाडेटा के रूप में खोजी जाती हैं, लेकिन एक्जीक्यूटेबल मॉड्यूल लोडर उन्हें रन करने योग्य टूल के रूप में अस्वीकार करता है।
- सापेक्ष कॉन्फ़िगर किए गए पथ `cwd` से रिज़ॉल्व होते हैं; `~` का विस्तार किया जाता है।

## मॉड्यूल अनुबंध

एक कस्टम टूल मॉड्यूल को एक फ़ंक्शन एक्सपोर्ट करना होगा (डिफ़ॉल्ट एक्सपोर्ट पसंदीदा):

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

फ़ैक्टरी रिटर्न टाइप:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## फ़ैक्टरियों को पास की गई API सर्फेस (`CustomToolAPI`)

`types.ts` और `loader.ts` से:

- `cwd`: होस्ट वर्किंग डायरेक्टरी
- `exec(command, args, options?)`: प्रोसेस एक्जीक्यूशन हेल्पर
- `ui`: UI संदर्भ (हेडलेस मोड में नो-ऑप हो सकता है)
- `hasUI`: गैर-इंटरएक्टिव फ्लो में `false`
- `logger`: साझा फ़ाइल लॉगर
- `typebox`: इंजेक्टेड `@sinclair/typebox`
- `pi`: इंजेक्टेड `@f5xc-salesdemos/xcsh` एक्सपोर्ट्स
- `pushPendingAction(action)`: हिडन `resolve` टूल के लिए प्रीव्यू एक्शन पंजीकृत करें (`docs/resolve-tool-runtime.md`)

लोडर एक नो-ऑप UI संदर्भ के साथ शुरू होता है और होस्ट कोड को वास्तविक UI तैयार होने पर `setUIContext(...)` कॉल करने की आवश्यकता होती है।

## एक्जीक्यूशन अनुबंध और टाइपिंग

`CustomTool.execute` सिग्नेचर:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` TypeBox स्कीमा के माध्यम से `Static<TParams>` से स्टैटिकली टाइप किया गया है।
- रनटाइम आर्गुमेंट वैलिडेशन एजेंट लूप में एक्जीक्यूशन से पहले होती है।
- `onUpdate` UI स्ट्रीमिंग के लिए आंशिक परिणाम उत्सर्जित करता है।
- `ctx` में सेशन/मॉडल स्टेट और एक `abort()` हेल्पर शामिल है।
- `signal` कैंसलेशन वहन करता है।

`CustomToolAdapter` इसे एजेंट टूल इंटरफेस से जोड़ता है और सही आर्गुमेंट क्रम में कॉल फॉरवर्ड करता है।

## मॉडल को उपकरण कैसे एक्सपोज़ किए जाते हैं

- उपकरणों को `AgentTool` इंस्टेंस में लपेटा जाता है (`CustomToolAdapter` या एक्सटेंशन रैपर्स)।
- उन्हें नाम से सेशन टूल रजिस्ट्री में डाला जाता है।
- SDK बूटस्ट्रैप में, कस्टम और एक्सटेंशन-पंजीकृत उपकरणों को प्रारंभिक सक्रिय सेट में जबरदस्ती शामिल किया जाता है।
- CLI `--tools` वर्तमान में केवल बिल्ट-इन टूल नामों को वैलिडेट करता है; कस्टम टूल समावेश डिस्कवरी/पंजीकरण पथों और SDK विकल्पों के माध्यम से संभाला जाता है।

## रेंडरिंग हुक

वैकल्पिक रेंडरिंग हुक:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI में रनटाइम व्यवहार:

- यदि हुक मौजूद हैं, तो टूल आउटपुट एक `Box` कंटेनर के अंदर रेंडर होता है।
- `renderResult` को `{ expanded, isPartial, spinnerFrame? }` प्राप्त होता है।
- रेंडरर त्रुटियाँ पकड़ी जाती हैं और लॉग की जाती हैं; UI डिफ़ॉल्ट टेक्स्ट रेंडरिंग पर वापस आता है।

## सेशन/स्टेट हैंडलिंग

वैकल्पिक `onSession(event, ctx)` सेशन लाइफ़साइकिल इवेंट प्राप्त करता है, जिनमें शामिल हैं:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

ब्रांच/सेशन संदर्भ बदलने पर इतिहास से स्टेट पुनर्निर्माण करने के लिए `ctx.sessionManager` का उपयोग करें।

## विफलताएँ और कैंसलेशन सिमेंटिक्स

### सिंक्रोनस/एसिंक्रोनस विफलताएँ

- `execute` में थ्रोइंग (या रिजेक्टेड प्रॉमिस) को टूल विफलता के रूप में माना जाता है।
- एजेंट रनटाइम विफलताओं को `isError: true` और एरर टेक्स्ट कंटेंट के साथ टूल रिजल्ट मैसेज में परिवर्तित करता है।
- एक्सटेंशन रैपर्स के साथ, `tool_result` हैंडलर कंटेंट/डिटेल्स को और अधिक पुनः लिख सकते हैं और यहाँ तक कि एरर स्टेटस को ओवरराइड कर सकते हैं।

### कैंसलेशन

- एजेंट अबोर्ट `execute` को `AbortSignal` के माध्यम से प्रचारित होता है।
- सहकारी कैंसलेशन के लिए सबप्रोसेस कार्य को `signal` फॉरवर्ड करें (`pi.exec(..., { signal })`)।
- `ctx.abort()` एक टूल को वर्तमान एजेंट ऑपरेशन को अबोर्ट करने का अनुरोध करने देता है।

### onSession त्रुटियाँ

- `onSession` त्रुटियाँ पकड़ी जाती हैं और चेतावनियों के रूप में लॉग की जाती हैं; वे सेशन क्रैश नहीं करतीं।

## डिज़ाइन के लिए वास्तविक बाधाएँ

- टूल नाम सक्रिय रजिस्ट्री में विश्व स्तर पर अद्वितीय होने चाहिए।
- रेंडरर/स्टेट पुनर्निर्माण के लिए `details` में नियतात्मक, स्कीमा-आकारित आउटपुट को प्राथमिकता दें।
- `pi.hasUI` के साथ UI उपयोग की सुरक्षा करें।
- टूल डायरेक्टरी में `.md`/`.json` को मेटाडेटा के रूप में मानें, निष्पादन योग्य मॉड्यूल के रूप में नहीं।
