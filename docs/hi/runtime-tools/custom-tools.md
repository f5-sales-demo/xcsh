---
title: कस्टम टूल्स
description: >-
  एजेंट को विस्तारित करने के लिए कस्टम टूल पंजीकरण, स्कीमा परिभाषा, और निष्पादन
  पाइपलाइन।
sidebar:
  order: 4
  label: कस्टम टूल्स
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# कस्टम टूल्स

कस्टम टूल्स मॉडल-कॉलेबल फंक्शन हैं जो बिल्ट-इन टूल्स के समान टूल निष्पादन पाइपलाइन में प्लग होते हैं।

एक कस्टम टूल एक TypeScript/JavaScript मॉड्यूल है जो एक फैक्ट्री एक्सपोर्ट करता है। फैक्ट्री एक होस्ट API (`CustomToolAPI`) प्राप्त करती है और एक टूल या टूल्स की एक ऐरे लौटाती है।

## यह क्या है (और क्या नहीं है)

- **कस्टम टूल**: एक टर्न के दौरान मॉडल द्वारा कॉल करने योग्य (`execute` + TypeBox स्कीमा)।
- **एक्सटेंशन**: लाइफसाइकल/इवेंट फ्रेमवर्क जो टूल्स पंजीकृत कर सकता है और इवेंट्स को इंटरसेप्ट/संशोधित कर सकता है।
- **हुक**: बाहरी प्री/पोस्ट कमांड स्क्रिप्ट्स।
- **स्किल**: स्टैटिक गाइडेंस/कॉन्टेक्स्ट पैकेज, निष्पादन योग्य टूल कोड नहीं।

यदि आपको मॉडल से सीधे कोड कॉल करवाना है, तो कस्टम टूल का उपयोग करें।

## वर्तमान कोड में एकीकरण पथ

दो सक्रिय एकीकरण शैलियाँ हैं:

1. **SDK-प्रदत्त कस्टम टूल्स** (`options.customTools`)
   - `CustomToolAdapter` या एक्सटेंशन रैपर्स के माध्यम से एजेंट टूल्स में लपेटे जाते हैं।
   - SDK बूटस्ट्रैप में हमेशा प्रारंभिक सक्रिय टूल सेट में शामिल होते हैं।

2. **लोडर API के माध्यम से फाइलसिस्टम-खोजे गए मॉड्यूल** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - `src/extensibility/custom-tools/loader.ts` में लाइब्रेरी API के रूप में उपलब्ध।
   - होस्ट कोड इन्हें config/provider/plugin पथों से टूल मॉड्यूल खोजने और लोड करने के लिए कॉल कर सकता है।

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

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` मर्ज करता है:

1. क्षमता प्रदाता (`toolCapability`), जिसमें शामिल हैं:
   - नेटिव OMP कॉन्फिग (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude कॉन्फिग (`~/.claude/tools`, `.claude/tools`)
   - Codex कॉन्फिग (`~/.codex/tools`, `.codex/tools`)
   - Claude मार्केटप्लेस प्लगइन कैश प्रदाता
2. इंस्टॉल किए गए प्लगइन मैनिफेस्ट (`~/.xcsh/plugins/node_modules/*` प्लगइन लोडर के माध्यम से)
3. लोडर को पास किए गए स्पष्ट कॉन्फिगर्ड पथ

### महत्वपूर्ण व्यवहार

- डुप्लीकेट रिज़ॉल्व्ड पथ डीडुप्लीकेट किए जाते हैं।
- टूल नाम विरोध बिल्ट-इन और पहले से लोड किए गए कस्टम टूल्स के विरुद्ध अस्वीकार किए जाते हैं।
- कुछ प्रदाताओं द्वारा `.md` और `.json` फाइलें टूल मेटाडेटा के रूप में खोजी जाती हैं, लेकिन निष्पादन योग्य मॉड्यूल लोडर उन्हें चलाने योग्य टूल्स के रूप में अस्वीकार करता है।
- सापेक्ष कॉन्फिगर्ड पथ `cwd` से रिज़ॉल्व किए जाते हैं; `~` विस्तारित किया जाता है।

## मॉड्यूल अनुबंध

एक कस्टम टूल मॉड्यूल को एक फंक्शन एक्सपोर्ट करना होगा (डिफ़ॉल्ट एक्सपोर्ट वरीय):

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

फैक्ट्री रिटर्न टाइप:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## फैक्ट्रियों को पास की जाने वाली API सतह (`CustomToolAPI`)

`types.ts` और `loader.ts` से:

- `cwd`: होस्ट वर्किंग डायरेक्टरी
- `exec(command, args, options?)`: प्रोसेस निष्पादन हेल्पर
- `ui`: UI कॉन्टेक्स्ट (हेडलेस मोड में no-op हो सकता है)
- `hasUI`: नॉन-इंटरैक्टिव फ्लो में `false`
- `logger`: शेयर्ड फाइल लॉगर
- `typebox`: इंजेक्टेड `@sinclair/typebox`
- `pi`: इंजेक्टेड `@f5xc-salesdemos/xcsh` एक्सपोर्ट्स
- `pushPendingAction(action)`: छिपे हुए `resolve` टूल के लिए प्रीव्यू एक्शन पंजीकृत करें (`docs/resolve-tool-runtime.md`)

लोडर एक no-op UI कॉन्टेक्स्ट से शुरू होता है और होस्ट कोड को वास्तविक UI तैयार होने पर `setUIContext(...)` कॉल करना आवश्यक है।

## निष्पादन अनुबंध और टाइपिंग

`CustomTool.execute` सिग्नेचर:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` आपके TypeBox स्कीमा से `Static<TParams>` के माध्यम से स्टैटिकली टाइप्ड है।
- रनटाइम आर्गुमेंट वैलिडेशन एजेंट लूप में निष्पादन से पहले होता है।
- `onUpdate` UI स्ट्रीमिंग के लिए आंशिक परिणाम उत्सर्जित करता है।
- `ctx` में सेशन/मॉडल स्टेट और एक `abort()` हेल्पर शामिल है।
- `signal` रद्दीकरण वहन करता है।

`CustomToolAdapter` इसे एजेंट टूल इंटरफेस से ब्रिज करता है और सही आर्गुमेंट क्रम में कॉल्स फॉरवर्ड करता है।

## टूल्स मॉडल को कैसे उपलब्ध कराए जाते हैं

- टूल्स को `AgentTool` इंस्टेंस में लपेटा जाता है (`CustomToolAdapter` या एक्सटेंशन रैपर्स)।
- उन्हें नाम के अनुसार सेशन टूल रजिस्ट्री में डाला जाता है।
- SDK बूटस्ट्रैप में, कस्टम और एक्सटेंशन-पंजीकृत टूल्स प्रारंभिक सक्रिय सेट में बलपूर्वक शामिल किए जाते हैं।
- CLI `--tools` वर्तमान में केवल बिल्ट-इन टूल नामों को मान्य करता है; कस्टम टूल समावेशन खोज/पंजीकरण पथों और SDK विकल्पों के माध्यम से संभाला जाता है।

## रेंडरिंग हुक्स

वैकल्पिक रेंडरिंग हुक्स:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI में रनटाइम व्यवहार:

- यदि हुक्स मौजूद हैं, तो टूल आउटपुट एक `Box` कंटेनर के अंदर रेंडर किया जाता है।
- `renderResult` को `{ expanded, isPartial, spinnerFrame? }` प्राप्त होता है।
- रेंडरर त्रुटियाँ पकड़ी और लॉग की जाती हैं; UI डिफ़ॉल्ट टेक्स्ट रेंडरिंग पर फॉलबैक करता है।

## सेशन/स्टेट हैंडलिंग

वैकल्पिक `onSession(event, ctx)` सेशन लाइफसाइकल इवेंट्स प्राप्त करता है, जिसमें शामिल हैं:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

जब ब्रांच/सेशन कॉन्टेक्स्ट बदलता है तो हिस्ट्री से स्टेट पुनर्निर्माण के लिए `ctx.sessionManager` का उपयोग करें।

## विफलताएँ और रद्दीकरण शब्दार्थ

### सिंक्रोनस/एसिंक्रोनस विफलताएँ

- `execute` में थ्रो करना (या अस्वीकृत प्रॉमिस) टूल विफलता के रूप में माना जाता है।
- एजेंट रनटाइम विफलताओं को `isError: true` और एरर टेक्स्ट कंटेंट के साथ टूल रिज़ल्ट मैसेज में परिवर्तित करता है।
- एक्सटेंशन रैपर्स के साथ, `tool_result` हैंडलर्स कंटेंट/डिटेल्स को और पुनर्लेखित कर सकते हैं और एरर स्टेटस को भी ओवरराइड कर सकते हैं।

### रद्दीकरण

- एजेंट एबॉर्ट `AbortSignal` के माध्यम से `execute` तक प्रसारित होता है।
- सहकारी रद्दीकरण के लिए `signal` को सबप्रोसेस कार्य (`pi.exec(..., { signal })`) में फॉरवर्ड करें।
- `ctx.abort()` एक टूल को वर्तमान एजेंट ऑपरेशन के एबॉर्ट का अनुरोध करने देता है।

### onSession त्रुटियाँ

- `onSession` त्रुटियाँ पकड़ी जाती हैं और चेतावनियों के रूप में लॉग की जाती हैं; वे सेशन को क्रैश नहीं करतीं।

## डिज़ाइन के लिए वास्तविक बाधाएँ

- टूल नाम सक्रिय रजिस्ट्री में वैश्विक रूप से अद्वितीय होने चाहिए।
- रेंडरर/स्टेट पुनर्निर्माण के लिए `details` में नियतात्मक, स्कीमा-आकार वाले आउटपुट को प्राथमिकता दें।
- `pi.hasUI` के साथ UI उपयोग को सुरक्षित करें।
- टूल डायरेक्टरी में `.md`/`.json` को मेटाडेटा मानें, निष्पादन योग्य मॉड्यूल नहीं।
