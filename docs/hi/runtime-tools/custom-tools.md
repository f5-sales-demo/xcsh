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

कस्टम उपकरण मॉडल-कॉल करने योग्य फ़ंक्शन हैं जो बिल्ट-इन उपकरणों की तरह उसी टूल निष्पादन पाइपलाइन में जुड़ते हैं।

एक कस्टम टूल एक TypeScript/JavaScript मॉड्यूल है जो एक फ़ैक्टरी एक्सपोर्ट करता है। फ़ैक्टरी को एक होस्ट API (`CustomToolAPI`) प्राप्त होती है और वह एक टूल या टूल्स की एक सरणी लौटाती है।

## यह क्या है (और क्या नहीं है)

- **कस्टम टूल**: एक टर्न के दौरान मॉडल द्वारा कॉल करने योग्य (`execute` + TypeBox स्कीमा)।
- **एक्सटेंशन**: लाइफसाइकिल/इवेंट फ्रेमवर्क जो उपकरण पंजीकृत कर सकता है और इवेंट को इंटरसेप्ट/संशोधित कर सकता है।
- **हुक**: बाहरी प्री/पोस्ट कमांड स्क्रिप्ट।
- **स्किल**: स्थिर मार्गदर्शन/संदर्भ पैकेज, निष्पादन योग्य टूल कोड नहीं।

यदि आपको मॉडल को सीधे कोड कॉल करने की आवश्यकता है, तो कस्टम टूल का उपयोग करें।

## वर्तमान कोड में एकीकरण पथ

दो सक्रिय एकीकरण शैलियाँ हैं:

1. **SDK-प्रदत्त कस्टम उपकरण** (`options.customTools`)
   - `CustomToolAdapter` या एक्सटेंशन रैपर के माध्यम से एजेंट टूल्स में लपेटे जाते हैं।
   - SDK बूटस्ट्रैप में हमेशा प्रारंभिक सक्रिय टूल सेट में शामिल।

2. **लोडर API के माध्यम से फ़ाइलसिस्टम-खोजे गए मॉड्यूल** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - `src/extensibility/custom-tools/loader.ts` में लाइब्रेरी API के रूप में उपलब्ध।
   - होस्ट कोड config/provider/plugin पथों से टूल मॉड्यूल खोजने और लोड करने के लिए इन्हें कॉल कर सकता है।

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

1. क्षमता प्रदाता (`toolCapability`), जिनमें शामिल हैं:
   - नेटिव OMP config (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude config (`~/.claude/tools`, `.claude/tools`)
   - Codex config (`~/.codex/tools`, `.codex/tools`)
   - Claude मार्केटप्लेस प्लगइन कैश प्रदाता
2. इंस्टॉल किए गए प्लगइन मेनिफेस्ट (`~/.xcsh/plugins/node_modules/*` प्लगइन लोडर के माध्यम से)
3. लोडर को पास किए गए स्पष्ट कॉन्फ़िगर किए गए पथ

### महत्वपूर्ण व्यवहार

- डुप्लीकेट हल किए गए पथ डीडुप्लीकेट किए जाते हैं।
- टूल नाम संघर्षों को बिल्ट-इन और पहले से लोड किए गए कस्टम टूल्स के विरुद्ध अस्वीकार किया जाता है।
- `.md` और `.json` फ़ाइलें कुछ प्रदाताओं द्वारा टूल मेटाडेटा के रूप में खोजी जाती हैं, लेकिन निष्पादन योग्य मॉड्यूल लोडर उन्हें चलाने योग्य टूल के रूप में अस्वीकार करता है।
- सापेक्ष कॉन्फ़िगर किए गए पथ `cwd` से हल किए जाते हैं; `~` का विस्तार किया जाता है।

## मॉड्यूल अनुबंध

एक कस्टम टूल मॉड्यूल को एक फ़ंक्शन एक्सपोर्ट करना होगा (डिफ़ॉल्ट एक्सपोर्ट प्राथमिक):

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

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

फ़ैक्टरी रिटर्न प्रकार:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## फ़ैक्टरियों को पास किया गया API सरफेस (`CustomToolAPI`)

`types.ts` और `loader.ts` से:

- `cwd`: होस्ट कार्यशील निर्देशिका
- `exec(command, args, options?)`: प्रोसेस निष्पादन सहायक
- `ui`: UI संदर्भ (हेडलेस मोड में no-op हो सकता है)
- `hasUI`: गैर-इंटरैक्टिव प्रवाह में `false`
- `logger`: साझा फ़ाइल लॉगर
- `typebox`: इंजेक्टेड `@sinclair/typebox`
- `pi`: इंजेक्टेड `@f5-sales-demo/xcsh` एक्सपोर्ट
- `pushPendingAction(action)`: छुपे हुए `resolve` टूल के लिए प्रीव्यू एक्शन पंजीकृत करें (`docs/resolve-tool-runtime.md`)

लोडर नो-ऑप UI संदर्भ के साथ शुरू होता है और होस्ट कोड को वास्तविक UI तैयार होने पर `setUIContext(...)` कॉल करने की आवश्यकता होती है।

## निष्पादन अनुबंध और टाइपिंग

`CustomTool.execute` सिग्नेचर:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` TypeBox स्कीमा से `Static<TParams>` के माध्यम से स्टेटिकली टाइप किया गया है।
- रनटाइम तर्क सत्यापन एजेंट लूप में निष्पादन से पहले होता है।
- `onUpdate` UI स्ट्रीमिंग के लिए आंशिक परिणाम उत्सर्जित करता है।
- `ctx` में सेशन/मॉडल स्थिति और एक `abort()` सहायक शामिल है।
- `signal` रद्दीकरण वहन करता है।

`CustomToolAdapter` इसे एजेंट टूल इंटरफेस से जोड़ता है और सही तर्क क्रम में कॉल अग्रेषित करता है।

## मॉडल को उपकरण कैसे उजागर किए जाते हैं

- उपकरणों को `AgentTool` इंस्टेंस (`CustomToolAdapter` या एक्सटेंशन रैपर) में लपेटा जाता है।
- उन्हें नाम के अनुसार सेशन टूल रजिस्ट्री में डाला जाता है।
- SDK बूटस्ट्रैप में, कस्टम और एक्सटेंशन-पंजीकृत उपकरण प्रारंभिक सक्रिय सेट में बलपूर्वक शामिल किए जाते हैं।
- CLI `--tools` वर्तमान में केवल बिल्ट-इन टूल नामों को सत्यापित करता है; कस्टम टूल समावेश खोज/पंजीकरण पथों और SDK विकल्पों के माध्यम से संभाला जाता है।

## रेंडरिंग हुक

वैकल्पिक रेंडरिंग हुक:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI में रनटाइम व्यवहार:

- यदि हुक मौजूद हैं, तो टूल आउटपुट एक `Box` कंटेनर के अंदर रेंडर किया जाता है।
- `renderResult` को `{ expanded, isPartial, spinnerFrame? }` प्राप्त होता है।
- रेंडरर त्रुटियाँ पकड़ी जाती हैं और लॉग की जाती हैं; UI डिफ़ॉल्ट टेक्स्ट रेंडरिंग पर वापस जाता है।

## सेशन/स्थिति प्रबंधन

वैकल्पिक `onSession(event, ctx)` सेशन लाइफसाइकिल इवेंट प्राप्त करता है, जिनमें शामिल हैं:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

ब्रांच/सेशन संदर्भ बदलने पर इतिहास से स्थिति पुनर्निर्माण के लिए `ctx.sessionManager` का उपयोग करें।

## विफलताएँ और रद्दीकरण शब्दार्थ

### सिंक्रोनस/एसिंक्रोनस विफलताएँ

- `execute` में थ्रो करना (या अस्वीकृत प्रॉमिस) टूल विफलता के रूप में माना जाता है।
- एजेंट रनटाइम विफलताओं को `isError: true` और त्रुटि टेक्स्ट सामग्री के साथ टूल परिणाम संदेशों में परिवर्तित करता है।
- एक्सटेंशन रैपर के साथ, `tool_result` हैंडलर सामग्री/विवरण को पुनः लिख सकते हैं और यहाँ तक कि त्रुटि स्थिति को ओवरराइड कर सकते हैं।

### रद्दीकरण

- एजेंट अबॉर्ट `AbortSignal` के माध्यम से `execute` तक प्रसारित होता है।
- सहकारी रद्दीकरण के लिए सबप्रोसेस कार्य को `signal` अग्रेषित करें (`pi.exec(..., { signal })`)।
- `ctx.abort()` एक टूल को वर्तमान एजेंट ऑपरेशन के अबॉर्ट का अनुरोध करने देता है।

### onSession त्रुटियाँ

- `onSession` त्रुटियाँ पकड़ी जाती हैं और चेतावनी के रूप में लॉग की जाती हैं; वे सेशन को क्रैश नहीं करती हैं।

## डिज़ाइन के लिए वास्तविक बाधाएँ

- टूल नाम सक्रिय रजिस्ट्री में वैश्विक रूप से अद्वितीय होने चाहिए।
- रेंडरर/स्थिति पुनर्निर्माण के लिए `details` में निर्धारक, स्कीमा-आकारित आउटपुट को प्राथमिकता दें।
- `pi.hasUI` के साथ UI उपयोग की सुरक्षा करें।
- टूल निर्देशिकाओं में `.md`/`.json` को मेटाडेटा मानें, निष्पादन योग्य मॉड्यूल नहीं।
