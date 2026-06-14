---
title: हुक्स
description: कोडिंग एजेंट लाइफ़साइकल में pre/post इवेंट स्वचालन के लिए हुक सिस्टम।
sidebar:
  order: 4
  label: हुक्स
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# हुक्स

यह दस्तावेज़ `src/extensibility/hooks/*` में **वर्तमान हुक सबसिस्टम कोड** का वर्णन करता है।

## रनटाइम में वर्तमान स्थिति

हुक पैकेज (`src/extensibility/hooks/`) अभी भी API सर्फेस के रूप में एक्सपोर्ट और उपयोग योग्य है, लेकिन डिफ़ॉल्ट CLI रनटाइम अब **एक्सटेंशन रनर** पाथ को इनिशियलाइज़ करता है। वर्तमान स्टार्टअप फ्लो में:

- `--hook` को `--extension` के लिए एक उपनाम के रूप में माना जाता है (CLI पाथ्स को `additionalExtensionPaths` में मर्ज किया जाता है)
- उपकरणों को `HookToolWrapper` नहीं, बल्कि `ExtensionToolWrapper` द्वारा रैप किया जाता है
- कॉन्टेक्स्ट ट्रांसफॉर्म और लाइफ़साइकल एमिशन `ExtensionRunner` के माध्यम से जाते हैं

अतः यह फ़ाइल हुक सबसिस्टम इम्प्लीमेंटेशन (types/loader/runner/wrapper) को दस्तावेज़ीकृत करती है, जिसमें लेगेसी व्यवहार और बाधाएँ शामिल हैं।

## मुख्य फ़ाइलें

- `src/extensibility/hooks/types.ts` — हुक कॉन्टेक्स्ट, इवेंट टाइप्स, और रिज़ल्ट कॉन्ट्रैक्ट्स
- `src/extensibility/hooks/loader.ts` — मॉड्यूल लोडिंग और हुक डिस्कवरी ब्रिज
- `src/extensibility/hooks/runner.ts` — इवेंट डिस्पैच, कमांड लुकअप, एरर सिग्नलिंग
- `src/extensibility/hooks/tool-wrapper.ts` — pre/post टूल इंटरसेप्शन रैपर
- `src/extensibility/hooks/index.ts` — एक्सपोर्ट्स/रि-एक्सपोर्ट्स

## हुक मॉड्यूल क्या है

एक हुक मॉड्यूल को एक फ़ैक्टरी को डिफ़ॉल्ट-एक्सपोर्ट करना होगा:

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

फ़ैक्टरी यह कर सकती है:

- `pi.on(...)` के साथ इवेंट हैंडलर रजिस्टर करना
- `pi.sendMessage(...)` के साथ पर्सिस्टेंट कस्टम मैसेज भेजना
- `pi.appendEntry(...)` के साथ नॉन-LLM स्टेट को पर्सिस्ट करना
- `pi.registerCommand(...)` के माध्यम से स्लैश कमांड रजिस्टर करना
- `pi.registerMessageRenderer(...)` के माध्यम से कस्टम मैसेज रेंडरर रजिस्टर करना
- `pi.exec(...)` के माध्यम से शेल कमांड चलाना

## डिस्कवरी और लोडिंग

`discoverAndLoadHooks(configuredPaths, cwd)` यह करता है:

1. कैपेबिलिटी रजिस्ट्री से डिस्कवर किए गए हुक्स लोड करना (`loadCapability("hooks")`)
2. स्पष्ट रूप से कॉन्फ़िगर किए गए पाथ्स को अपेंड करना (एब्सोल्यूट पाथ के अनुसार डिडूप्ड)
3. `loadHooks(allPaths, cwd)` को कॉल करना

`loadHooks` फिर प्रत्येक पाथ को इम्पोर्ट करता है और एक `default` फ़ंक्शन की अपेक्षा करता है।

### पाथ रेज़ोल्यूशन

`loader.ts` हुक पाथ्स को इस प्रकार रेज़ॉल्व करता है:

- एब्सोल्यूट पाथ: जैसा है वैसा उपयोग किया जाता है
- `~` पाथ: एक्सपैंड किया जाता है
- रिलेटिव पाथ: `cwd` के विरुद्ध रेज़ॉल्व किया जाता है

### महत्वपूर्ण लेगेसी मिसमैच

`hookCapability` के लिए डिस्कवरी प्रोवाइडर अभी भी pre/post शेल-स्टाइल हुक फ़ाइलों को मॉडल करते हैं (उदाहरण के लिए `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)।

यहाँ हुक लोडर डायनामिक मॉड्यूल इम्पोर्ट का उपयोग करता है और एक डिफ़ॉल्ट JS/TS हुक फ़ैक्टरी की आवश्यकता है। यदि कोई डिस्कवर किया गया हुक पाथ एक मॉड्यूल के रूप में इम्पोर्ट करने योग्य नहीं है, तो लोड विफल हो जाता है और `LoadHooksResult.errors` में रिपोर्ट किया जाता है।

## इवेंट सर्फेसेज़

हुक इवेंट्स `types.ts` में स्ट्रॉन्गली टाइप्ड हैं।

### सेशन इवेंट्स

- `session_start`
- `session_before_switch` → `{ cancel?: boolean }` रिटर्न कर सकता है
- `session_switch`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }` रिटर्न कर सकता है
- `session_branch`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }` रिटर्न कर सकता है
- `session.compacting` → `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` रिटर्न कर सकता है
- `session_compact`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` रिटर्न कर सकता है
- `session_tree`
- `session_shutdown`

### एजेंट/कॉन्टेक्स्ट इवेंट्स

- `context` → `{ messages?: Message[] }` रिटर्न कर सकता है
- `before_agent_start` → `{ message?: { customType; content; display; details } }` रिटर्न कर सकता है
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### टूल इवेंट्स (pre/post मॉडल)

- `tool_call` (pre-execution) → `{ block?: boolean; reason?: string }` रिटर्न कर सकता है
- `tool_result` (post-execution) → `{ content?; details?; isError? }` रिटर्न कर सकता है

यह हुक सबसिस्टम का मुख्य pre/post इंटरसेप्शन मॉडल है।

```text
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## एक्ज़ीक्यूशन मॉडल और म्यूटेशन सेमेंटिक्स

### 1) Pre-execution: `tool_call`

`HookToolWrapper.execute()` टूल एक्ज़ीक्यूशन से पहले `tool_call` एमिट करता है।

- यदि कोई हैंडलर `{ block: true }` रिटर्न करता है, तो एक्ज़ीक्यूशन रुक जाता है
- यदि हैंडलर थ्रो करता है, तो रैपर फेल क्लोज़ड होता है और एक्ज़ीक्यूशन ब्लॉक करता है
- रिटर्न किया गया `reason` थ्रोन एरर टेक्स्ट बन जाता है

### 2) टूल एक्ज़ीक्यूशन

अंडरलाइंग टूल सामान्य रूप से एक्ज़ीक्यूट होता है यदि ब्लॉक नहीं किया गया।

### 3) Post-execution: `tool_result`

सफलता के बाद, रैपर `tool_result` को इनके साथ एमिट करता है:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

यदि हैंडलर ओवरराइड रिटर्न करता है:

- `content` रिज़ल्ट कंटेंट को रिप्लेस कर सकता है
- `details` रिज़ल्ट डिटेल्स को रिप्लेस कर सकता है

टूल विफलता पर, रैपर `isError: true` और एरर टेक्स्ट कंटेंट के साथ `tool_result` एमिट करता है, फिर ओरिजिनल एरर को रीथ्रो करता है।

### हुक्स क्या म्यूटेट कर सकते हैं

- `context` के माध्यम से एकल कॉल के लिए LLM कॉन्टेक्स्ट (`messages` रिप्लेसमेंट चेन)
- सफल टूल कॉल्स पर टूल आउटपुट कंटेंट/डिटेल्स (`tool_result` पाथ)
- `before_agent_start` के माध्यम से pre-agent इंजेक्टेड मैसेज
- `session_before_*` और `session.compacting` के माध्यम से कैंसलेशन/कस्टम कॉम्पैक्शन/ट्री बिहेवियर

### इस इम्प्लीमेंटेशन में हुक्स क्या म्यूटेट नहीं कर सकते

- इन-प्लेस रॉ टूल इनपुट पैरामीटर्स (`tool_call` पर केवल ब्लॉक/अलाउ)
- थ्रोन टूल एरर्स के बाद एक्ज़ीक्यूशन कंटिन्यूएशन (एरर पाथ रीथ्रो करता है)
- रैपर बिहेवियर में फाइनल सक्सेस/एरर स्टेटस (रिटर्न किया गया `isError` टाइप्ड है लेकिन `HookToolWrapper` द्वारा लागू नहीं किया गया)

## ऑर्डरिंग और कॉन्फ्लिक्ट बिहेवियर

### डिस्कवरी-लेवल ऑर्डरिंग

कैपेबिलिटी प्रोवाइडर्स प्रायोरिटी-सॉर्टेड होते हैं (पहले उच्चतर)। डिडूप कैपेबिलिटी की के अनुसार होता है, पहला जीतता है।

`hooks` के लिए, कैपेबिलिटी की है `${type}:${tool}:${name}`। निम्न-प्रायोरिटी प्रोवाइडर्स से शैडोड डुप्लीकेट्स को मार्क किया जाता है और प्रभावी डिस्कवर्ड लिस्ट से बाहर रखा जाता है।

### लोड ऑर्डर

`discoverAndLoadHooks` एक फ्लैट `allPaths` लिस्ट बनाता है, रेज़ॉल्व्ड एब्सोल्यूट पाथ द्वारा डिडूप्ड, फिर `loadHooks` उस क्रम में इटरेट करता है।
प्रत्येक डिस्कवर्ड डायरेक्टरी के भीतर फ़ाइल ऑर्डर `readdir` आउटपुट पर निर्भर करता है; हुक लोडर अतिरिक्त सॉर्ट नहीं करता।

### रनटाइम हैंडलर ऑर्डर

`HookRunner` के अंदर, ऑर्डर रजिस्ट्रेशन सीक्वेंस द्वारा डिटर्मिनिस्टिक है:

1. हुक्स एरे ऑर्डर
2. प्रति हुक/इवेंट हैंडलर रजिस्ट्रेशन ऑर्डर

इवेंट टाइप के अनुसार कॉन्फ्लिक्ट बिहेवियर:

- `tool_call`: लास्ट रिटर्न्ड रिज़ल्ट जीतता है जब तक कोई हैंडलर ब्लॉक न करे; पहला ब्लॉक शॉर्ट-सर्किट करता है
- `tool_result`: लास्ट रिटर्न्ड ओवरराइड जीतता है (कोई शॉर्ट-सर्किट नहीं)
- `context`: चेन्ड; प्रत्येक हैंडलर पूर्व हैंडलर का मैसेज आउटपुट प्राप्त करता है
- `before_agent_start`: पहला रिटर्न्ड मैसेज रखा जाता है; बाद के मैसेज इग्नोर किए जाते हैं
- `session_before_*`: लेटेस्ट रिटर्न्ड रिज़ल्ट ट्रैक किया जाता है; `cancel: true` तुरंत शॉर्ट-सर्किट करता है
- `session.compacting`: लेटेस्ट रिटर्न्ड रिज़ल्ट जीतता है

कमांड/रेंडरर कॉन्फ्लिक्ट्स:

- `getCommand(name)` हुक्स में पहला मैच रिटर्न करता है (पहला लोडेड जीतता है)
- `getMessageRenderer(customType)` पहला मैच रिटर्न करता है
- `getRegisteredCommands()` सभी कमांड रिटर्न करता है (कोई डिडूप नहीं)

## UI इंटरैक्शन्स (`HookContext.ui`)

`HookUIContext` में शामिल हैं:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme` गेटर

`ctx.hasUI` इंगित करता है कि इंटरैक्टिव UI उपलब्ध है या नहीं।

जब UI के बिना चलाया जाता है, तो डिफ़ॉल्ट नो-ऑप कॉन्टेक्स्ट बिहेवियर है:

- `select/input/editor` `undefined` रिटर्न करते हैं
- `confirm` `false` रिटर्न करता है
- `notify`, `setStatus`, `setEditorText` नो-ऑप्स हैं
- `getEditorText` `""` रिटर्न करता है

### स्टेटस लाइन बिहेवियर

`ctx.ui.setStatus(key, text)` के माध्यम से सेट किया गया हुक स्टेटस टेक्स्ट:

- प्रति की स्टोर किया जाता है
- की नाम द्वारा सॉर्ट किया जाता है
- सैनिटाइज़ किया जाता है (`\r`, `\n`, `\t` → स्पेसेज़; बार-बार आने वाले स्पेसेज़ कोलैप्स्ड)
- डिस्प्ले के लिए जॉइन और विड्थ-ट्रंकेटेड किया जाता है

## एरर प्रोपेगेशन और फॉलबैक

### लोड-टाइम

- अमान्य मॉड्यूल या गायब डिफ़ॉल्ट एक्सपोर्ट → `LoadHooksResult.errors` में कैप्चर किया जाता है
- अन्य हुक्स के लिए लोडिंग जारी रहती है

### इवेंट-टाइम

`HookRunner.emit(...)` अधिकतर इवेंट्स के लिए हैंडलर एरर्स को कैच करता है और `HookError` को लिसनर्स (`hookPath`, `event`, `error`) को एमिट करता है, फिर जारी रहता है।

`emitToolCall(...)` अधिक सख्त है: हैंडलर एरर्स वहाँ निगले नहीं जाते; वे कॉलर तक प्रोपेगेट होते हैं। `HookToolWrapper` में, यह टूल कॉल को ब्लॉक करता है (फेल-सेफ)।

## यथार्थवादी API उदाहरण

### असुरक्षित bash कमांड्स ब्लॉक करें

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### post-execution पर टूल आउटपुट रिडैक्ट करें

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### प्रति LLM कॉल मॉडल कॉन्टेक्स्ट संशोधित करें

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### कमांड-सेफ कॉन्टेक्स्ट मेथड्स के साथ स्लैश कमांड रजिस्टर करें

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## एक्सपोर्ट सर्फेस

`src/extensibility/hooks/index.ts` एक्सपोर्ट करता है:

- लोडिंग APIs (`discoverAndLoadHooks`, `loadHooks`)
- रनर और रैपर (`HookRunner`, `HookToolWrapper`)
- सभी हुक टाइप्स
- `execCommand` रि-एक्सपोर्ट

और पैकेज रूट (`src/index.ts`) हुक **टाइप्स** को लेगेसी कम्पेटिबिलिटी सर्फेस के रूप में रि-एक्सपोर्ट करता है।
