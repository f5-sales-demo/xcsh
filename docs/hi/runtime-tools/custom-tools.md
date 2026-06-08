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

कस्टम टूल्स मॉडल-कॉल करने योग्य फ़ंक्शन हैं जो बिल्ट-इन टूल्स के समान टूल निष्पादन पाइपलाइन में प्लग होते हैं।

एक कस्टम टूल एक TypeScript/JavaScript मॉड्यूल है जो एक फ़ैक्टरी एक्सपोर्ट करता है। फ़ैक्टरी एक होस्ट API (`CustomToolAPI`) प्राप्त करती है और एक टूल या टूल्स की एक सरणी लौटाती है।

## यह क्या है (और क्या नहीं है)

- **कस्टम टूल**: एक टर्न के दौरान मॉडल द्वारा कॉल करने योग्य (`execute` + TypeBox स्कीमा)।
- **एक्सटेंशन**: लाइफ़साइकल/इवेंट फ़्रेमवर्क जो टूल्स पंजीकृत कर सकता है और इवेंट्स को इंटरसेप्ट/संशोधित कर सकता है।
- **हुक**: बाहरी प्री/पोस्ट कमांड स्क्रिप्ट।
- **स्किल**: स्थिर मार्गदर्शन/संदर्भ पैकेज, निष्पादन योग्य टूल कोड नहीं।

यदि आपको मॉडल से सीधे कोड कॉल करवाना है, तो कस्टम टूल का उपयोग करें।

## वर्तमान कोड में एकीकरण पथ

दो सक्रिय एकीकरण शैलियाँ हैं:

1. **SDK-प्रदत्त कस्टम टूल्स** (`options.customTools`)
   - `CustomToolAdapter` या एक्सटेंशन रैपर के माध्यम से एजेंट टूल्स में लपेटे जाते हैं।
   - SDK बूटस्ट्रैप में हमेशा प्रारंभिक सक्रिय टूल सेट में शामिल किए जाते हैं।

2. **लोडर API के माध्यम से फ़ाइलसिस्टम-खोजे गए मॉड्यूल** (`discoverAndLoadCustomTools` / `loadCustomTools`)
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

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` निम्नलिखित को मर्ज करता है:

1. क्षमता प्रदाता (`toolCapability`), जिसमें शामिल हैं:
   - नेटिव OMP कॉन्फ़िग (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude कॉन्फ़िग (`~/.claude/tools`, `.claude/tools`)
   - Codex कॉन्फ़िग (`~/.codex/tools`, `.codex/tools`)
   - Claude मार्केटप्लेस प्लगइन कैश प्रदाता
2. इंस्टॉल किए गए प्लगइन मैनिफ़ेस्ट (`~/.xcsh/plugins/node_modules/*` प्लगइन लोडर के माध्यम से)
3. लोडर को पास किए गए स्पष्ट कॉन्फ़िगर किए गए पथ

### महत्वपूर्ण व्यवहार

- डुप्लिकेट रिज़ॉल्व किए गए पथ डीडुप्लिकेट किए जाते हैं।
- टूल नाम विरोध बिल्ट-इन और पहले से लोड किए गए कस्टम टूल्स के विरुद्ध अस्वीकार किए जाते हैं।
- `.md` और `.json` फ़ाइलें कुछ प्रदाताओं द्वारा टूल मेटाडेटा के रूप में खोजी जाती हैं, लेकिन निष्पादन योग्य मॉड्यूल लोडर उन्हें रन करने योग्य टूल्स के रूप में अस्वीकार करता है।
- सापेक्ष कॉन्फ़िगर किए गए पथ `cwd` से रिज़ॉल्व किए जाते हैं; `~` का विस्तार किया जाता है।

## मॉड्यूल अनुबंध

एक कस्टम टूल मॉड्यूल को एक फ़ंक्शन एक्सपोर्ट करना आवश्यक है (डिफ़ॉल्ट एक्सपोर्ट प्राथमिक):

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

## फ़ैक्टरियों को पास की जाने वाली API सतह (`CustomToolAPI`)

`types.ts` और `loader.ts` से:

- `cwd`: होस्ट कार्यशील निर्देशिका
- `exec(command, args, options?)`: प्रोसेस निष्पादन सहायक
- `ui`: UI संदर्भ (हेडलेस मोड में नो-ऑप हो सकता है)
- `hasUI`: गैर-इंटरैक्टिव प्रवाह में `false`
- `logger`: साझा फ़ाइल लॉगर
- `typebox`: इंजेक्ट किया गया `@sinclair/typebox`
- `pi`: इंजेक्ट किए गए `@f5xc-salesdemos/xcsh` एक्सपोर्ट
- `pushPendingAction(action)`: छिपे हुए `resolve` टूल के लिए प्रीव्यू एक्शन पंजीकृत करें (`docs/resolve-tool-runtime.md`)

लोडर एक नो-ऑप UI संदर्भ के साथ शुरू होता है और जब वास्तविक UI तैयार हो तो होस्ट कोड को `setUIContext(...)` कॉल करने की आवश्यकता होती है।

## निष्पादन अनुबंध और टाइपिंग

`CustomTool.execute` सिग्नेचर:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` आपके TypeBox स्कीमा से `Static<TParams>` के माध्यम से स्थैतिक रूप से टाइप किया जाता है।
- रनटाइम आर्गुमेंट सत्यापन एजेंट लूप में निष्पादन से पहले होता है।
- `onUpdate` UI स्ट्रीमिंग के लिए आंशिक परिणाम उत्सर्जित करता है।
- `ctx` में सत्र/मॉडल स्थिति और एक `abort()` सहायक शामिल है।
- `signal` रद्दीकरण वहन करता है।

`CustomToolAdapter` इसे एजेंट टूल इंटरफ़ेस से जोड़ता है और सही आर्गुमेंट क्रम में कॉल अग्रेषित करता है।

## टूल्स मॉडल को कैसे उपलब्ध कराए जाते हैं

- टूल्स `AgentTool` इंस्टेंस में लपेटे जाते हैं (`CustomToolAdapter` या एक्सटेंशन रैपर)।
- उन्हें नाम से सत्र टूल रजिस्ट्री में डाला जाता है।
- SDK बूटस्ट्रैप में, कस्टम और एक्सटेंशन-पंजीकृत टूल्स प्रारंभिक सक्रिय सेट में बलपूर्वक शामिल किए जाते हैं।
- CLI `--tools` वर्तमान में केवल बिल्ट-इन टूल नामों को मान्य करता है; कस्टम टूल समावेश खोज/पंजीकरण पथों और SDK विकल्पों के माध्यम से संभाला जाता है।

## रेंडरिंग हुक

वैकल्पिक रेंडरिंग हुक:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI में रनटाइम व्यवहार:

- यदि हुक मौजूद हैं, तो टूल आउटपुट एक `Box` कंटेनर के अंदर रेंडर किया जाता है।
- `renderResult` को `{ expanded, isPartial, spinnerFrame? }` प्राप्त होता है।
- रेंडरर त्रुटियाँ पकड़ी और लॉग की जाती हैं; UI डिफ़ॉल्ट टेक्स्ट रेंडरिंग पर वापस आ जाता है।

## सत्र/स्थिति प्रबंधन

वैकल्पिक `onSession(event, ctx)` सत्र जीवनचक्र इवेंट प्राप्त करता है, जिसमें शामिल हैं:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

जब शाखा/सत्र संदर्भ बदलता है तो इतिहास से स्थिति पुनर्निर्माण के लिए `ctx.sessionManager` का उपयोग करें।

## विफलताएँ और रद्दीकरण शब्दार्थ

### सिंक्रोनस/एसिंक्रोनस विफलताएँ

- `execute` में थ्रो करना (या अस्वीकृत प्रॉमिस) टूल विफलता के रूप में माना जाता है।
- एजेंट रनटाइम विफलताओं को `isError: true` और त्रुटि टेक्स्ट सामग्री के साथ टूल परिणाम संदेशों में परिवर्तित करता है।
- एक्सटेंशन रैपर के साथ, `tool_result` हैंडलर सामग्री/विवरण को और पुनर्लिखित कर सकते हैं और त्रुटि स्थिति को भी ओवरराइड कर सकते हैं।

### रद्दीकरण

- एजेंट एबॉर्ट `AbortSignal` के माध्यम से `execute` तक प्रसारित होता है।
- सहकारी रद्दीकरण के लिए `signal` को सबप्रोसेस कार्य (`pi.exec(..., { signal })`) में अग्रेषित करें।
- `ctx.abort()` एक टूल को वर्तमान एजेंट ऑपरेशन का एबॉर्ट अनुरोध करने देता है।

### onSession त्रुटियाँ

- `onSession` त्रुटियाँ पकड़ी जाती हैं और चेतावनी के रूप में लॉग की जाती हैं; वे सत्र को क्रैश नहीं करतीं।

## डिज़ाइन के लिए वास्तविक बाधाएँ

- टूल नाम सक्रिय रजिस्ट्री में वैश्विक रूप से अद्वितीय होने चाहिए।
- रेंडरर/स्थिति पुनर्निर्माण के लिए `details` में नियतात्मक, स्कीमा-आकार के आउटपुट को प्राथमिकता दें।
- `pi.hasUI` के साथ UI उपयोग की सुरक्षा करें।
- टूल निर्देशिकाओं में `.md`/`.json` को मेटाडेटा के रूप में मानें, निष्पादन योग्य मॉड्यूल के रूप में नहीं।
