---
title: हुक्स
description: कोडिंग एजेंट जीवनचक्र में प्री/पोस्ट इवेंट स्वचालन के लिए हुक सिस्टम।
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

हुक पैकेज (`src/extensibility/hooks/`) अभी भी एक API सतह के रूप में निर्यातित और उपयोग योग्य है, लेकिन डिफ़ॉल्ट CLI रनटाइम अब **एक्सटेंशन रनर** पथ को प्रारंभ करता है। वर्तमान स्टार्टअप प्रवाह में:

- `--hook` को `--extension` के लिए एक उपनाम के रूप में माना जाता है (CLI पथ `additionalExtensionPaths` में मर्ज किए जाते हैं)
- उपकरण `HookToolWrapper` से नहीं, बल्कि `ExtensionToolWrapper` द्वारा लपेटे जाते हैं
- संदर्भ रूपांतरण और जीवनचक्र उत्सर्जन `ExtensionRunner` के माध्यम से होते हैं

अतः यह फ़ाइल हुक सबसिस्टम कार्यान्वयन (types/loader/runner/wrapper) का दस्तावेज़ीकरण करती है, जिसमें लीगेसी व्यवहार और बाधाएं शामिल हैं।

## मुख्य फ़ाइलें

- `src/extensibility/hooks/types.ts` — हुक संदर्भ, इवेंट प्रकार, और परिणाम अनुबंध
- `src/extensibility/hooks/loader.ts` — मॉड्यूल लोडिंग और हुक डिस्कवरी ब्रिज
- `src/extensibility/hooks/runner.ts` — इवेंट डिस्पैच, कमांड लुकअप, एरर सिग्नलिंग
- `src/extensibility/hooks/tool-wrapper.ts` — प्री/पोस्ट टूल इंटरसेप्शन रैपर
- `src/extensibility/hooks/index.ts` — निर्यात/पुनः-निर्यात

## हुक मॉड्यूल क्या होता है

एक हुक मॉड्यूल को एक फ़ैक्टरी डिफ़ॉल्ट-एक्सपोर्ट करनी होती है:

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

- `pi.on(...)` के साथ इवेंट हैंडलर पंजीकृत करना
- `pi.sendMessage(...)` से स्थायी कस्टम संदेश भेजना
- `pi.appendEntry(...)` से गैर-LLM स्थिति बनाए रखना
- `pi.registerCommand(...)` के माध्यम से स्लैश कमांड पंजीकृत करना
- `pi.registerMessageRenderer(...)` के माध्यम से कस्टम संदेश रेंडरर पंजीकृत करना
- `pi.exec(...)` के माध्यम से शेल कमांड चलाना

## डिस्कवरी और लोडिंग

`discoverAndLoadHooks(configuredPaths, cwd)` निम्नलिखित करता है:

1. क्षमता रजिस्ट्री से खोजे गए हुक लोड करता है (`loadCapability("hooks")`)
2. स्पष्ट रूप से कॉन्फ़िगर किए गए पथ जोड़ता है (पूर्ण पथ द्वारा डीडुप्ड)
3. `loadHooks(allPaths, cwd)` को कॉल करता है

`loadHooks` फिर प्रत्येक पथ को आयात करता है और एक `default` फ़ंक्शन की अपेक्षा करता है।

### पथ समाधान

`loader.ts` हुक पथों को इस प्रकार हल करता है:

- पूर्ण पथ: जैसा है वैसा उपयोग किया जाता है
- `~` पथ: विस्तारित किया जाता है
- सापेक्ष पथ: `cwd` के सापेक्ष हल किया जाता है

### महत्वपूर्ण लीगेसी बेमेल

`hookCapability` के लिए डिस्कवरी प्रोवाइडर अभी भी प्री/पोस्ट शेल-स्टाइल हुक फ़ाइलों को मॉडल करते हैं (उदाहरण के लिए `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)।

यहाँ हुक लोडर डायनामिक मॉड्यूल इम्पोर्ट का उपयोग करता है और एक डिफ़ॉल्ट JS/TS हुक फ़ैक्टरी की आवश्यकता होती है। यदि कोई खोजा गया हुक पथ मॉड्यूल के रूप में आयात योग्य नहीं है, तो लोड विफल हो जाता है और `LoadHooksResult.errors` में रिपोर्ट किया जाता है।

## इवेंट सतहें

हुक इवेंट `types.ts` में दृढ़ता से टाइप किए गए हैं।

### सत्र इवेंट

- `session_start`
- `session_before_switch` → `{ cancel?: boolean }` लौटा सकता है
- `session_switch`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }` लौटा सकता है
- `session_branch`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }` लौटा सकता है
- `session.compacting` → `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` लौटा सकता है
- `session_compact`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` लौटा सकता है
- `session_tree`
- `session_shutdown`

### एजेंट/संदर्भ इवेंट

- `context` → `{ messages?: Message[] }` लौटा सकता है
- `before_agent_start` → `{ message?: { customType; content; display; details } }` लौटा सकता है
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

### टूल इवेंट (प्री/पोस्ट मॉडल)

- `tool_call` (पूर्व-निष्पादन) → `{ block?: boolean; reason?: string }` लौटा सकता है
- `tool_result` (पश्च-निष्पादन) → `{ content?; details?; isError? }` लौटा सकता है

यह हुक सबसिस्टम का मूल प्री/पोस्ट इंटरसेप्शन मॉडल है।

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

## निष्पादन मॉडल और म्यूटेशन सिमेंटिक्स

### 1) पूर्व-निष्पादन: `tool_call`

`HookToolWrapper.execute()` टूल निष्पादन से पहले `tool_call` उत्सर्जित करता है।

- यदि कोई भी हैंडलर `{ block: true }` लौटाता है, तो निष्पादन रुक जाता है
- यदि हैंडलर थ्रो करता है, तो रैपर विफल हो जाता है और निष्पादन को ब्लॉक करता है
- लौटाया गया `reason` थ्रो किए गए एरर टेक्स्ट बन जाता है

### 2) टूल निष्पादन

यदि ब्लॉक नहीं किया गया है तो अंतर्निहित टूल सामान्य रूप से निष्पादित होता है।

### 3) पश्च-निष्पादन: `tool_result`

सफलता के बाद, रैपर `tool_result` उत्सर्जित करता है:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

यदि हैंडलर ओवरराइड लौटाता है:

- `content` परिणाम सामग्री को प्रतिस्थापित कर सकता है
- `details` परिणाम विवरण को प्रतिस्थापित कर सकता है

टूल विफलता पर, रैपर `isError: true` और एरर टेक्स्ट सामग्री के साथ `tool_result` उत्सर्जित करता है, फिर मूल एरर को पुनः थ्रो करता है।

### हुक क्या म्यूटेट कर सकते हैं

- `context` के माध्यम से एकल कॉल के लिए LLM संदर्भ (`messages` प्रतिस्थापन श्रृंखला)
- सफल टूल कॉल पर टूल आउटपुट content/details (`tool_result` पथ)
- `before_agent_start` के माध्यम से प्री-एजेंट इंजेक्टेड संदेश
- `session_before_*` और `session.compacting` के माध्यम से रद्दीकरण/कस्टम कॉम्पैक्शन/ट्री व्यवहार

### इस कार्यान्वयन में हुक क्या म्यूटेट नहीं कर सकते

- कच्चे टूल इनपुट पैरामीटर इन-प्लेस (केवल `tool_call` पर ब्लॉक/अनुमति)
- थ्रो किए गए टूल एरर के बाद निष्पादन जारी रखना (एरर पथ पुनः थ्रो करता है)
- रैपर व्यवहार में अंतिम सफलता/एरर स्थिति (लौटाया गया `isError` टाइप किया गया है लेकिन `HookToolWrapper` द्वारा लागू नहीं किया जाता)

## क्रम और टकराव व्यवहार

### डिस्कवरी-स्तर क्रम

क्षमता प्रोवाइडर प्राथमिकता-क्रमबद्ध होते हैं (पहले उच्च)। डीडुप्लीकेशन क्षमता कुंजी द्वारा होती है, पहले वाला जीतता है।

`hooks` के लिए, क्षमता कुंजी `${type}:${tool}:${name}` है। निम्न-प्राथमिकता प्रोवाइडरों से छाया किए गए डुप्लीकेट चिह्नित किए जाते हैं और प्रभावी खोजी गई सूची से बाहर किए जाते हैं।

### लोड क्रम

`discoverAndLoadHooks` एक फ्लैट `allPaths` सूची बनाता है, हल किए गए पूर्ण पथ द्वारा डीडुप्ड, फिर `loadHooks` उस क्रम में पुनरावृत्त करता है।
प्रत्येक खोजी गई डायरेक्टरी के भीतर फ़ाइल क्रम `readdir` आउटपुट पर निर्भर करता है; हुक लोडर अतिरिक्त सॉर्टिंग नहीं करता।

### रनटाइम हैंडलर क्रम

`HookRunner` के अंदर, क्रम पंजीकरण अनुक्रम द्वारा निर्धारक होता है:

1. हुक्स सरणी क्रम
2. हुक/इवेंट प्रति हैंडलर पंजीकरण क्रम

इवेंट प्रकार के अनुसार टकराव व्यवहार:

- `tool_call`: अंतिम लौटाया गया परिणाम जीतता है जब तक कोई हैंडलर ब्लॉक न करे; पहला ब्लॉक शॉर्ट-सर्किट करता है
- `tool_result`: अंतिम लौटाया गया ओवरराइड जीतता है (कोई शॉर्ट-सर्किट नहीं)
- `context`: श्रृंखलाबद्ध; प्रत्येक हैंडलर पूर्व हैंडलर का संदेश आउटपुट प्राप्त करता है
- `before_agent_start`: पहला लौटाया गया संदेश रखा जाता है; बाद के संदेश अनदेखे किए जाते हैं
- `session_before_*`: नवीनतम लौटाया गया परिणाम ट्रैक किया जाता है; `cancel: true` तुरंत शॉर्ट-सर्किट करता है
- `session.compacting`: नवीनतम लौटाया गया परिणाम जीतता है

कमांड/रेंडरर टकराव:

- `getCommand(name)` हुक्स में पहला मेल लौटाता है (पहले लोड किया गया जीतता है)
- `getMessageRenderer(customType)` पहला मेल लौटाता है
- `getRegisteredCommands()` सभी कमांड लौटाता है (कोई डीडुप्लीकेशन नहीं)

## UI इंटरेक्शन (`HookContext.ui`)

`HookUIContext` में शामिल हैं:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme` गेटर

`ctx.hasUI` इंगित करता है कि इंटरैक्टिव UI उपलब्ध है या नहीं।

बिना UI के चलाते समय, डिफ़ॉल्ट नो-ऑप संदर्भ व्यवहार है:

- `select/input/editor` `undefined` लौटाते हैं
- `confirm` `false` लौटाता है
- `notify`, `setStatus`, `setEditorText` नो-ऑप हैं
- `getEditorText` `""` लौटाता है

### स्टेटस लाइन व्यवहार

`ctx.ui.setStatus(key, text)` के माध्यम से सेट किया गया हुक स्टेटस टेक्स्ट:

- प्रति कुंजी संग्रहीत होता है
- कुंजी नाम द्वारा क्रमबद्ध होता है
- सैनिटाइज़ किया जाता है (`\r`, `\n`, `\t` → स्पेस; बार-बार आने वाले स्पेस संकुचित होते हैं)
- प्रदर्शन के लिए जोड़ा और चौड़ाई-छंटनी किया जाता है

## एरर प्रसार और फ़ॉलबैक

### लोड-समय

- अमान्य मॉड्यूल या गुम डिफ़ॉल्ट एक्सपोर्ट → `LoadHooksResult.errors` में कैप्चर किया जाता है
- अन्य हुक्स के लिए लोडिंग जारी रहती है

### इवेंट-समय

`HookRunner.emit(...)` अधिकांश इवेंट के लिए हैंडलर एरर को पकड़ता है और श्रोताओं को `HookError` (`hookPath`, `event`, `error`) उत्सर्जित करता है, फिर जारी रहता है।

`emitToolCall(...)` अधिक सख्त है: हैंडलर एरर वहाँ निगले नहीं जाते; वे कॉलर तक प्रसारित होते हैं। `HookToolWrapper` में, यह टूल कॉल को ब्लॉक करता है (फेल-सेफ)।

## वास्तविक API उदाहरण

### असुरक्षित बैश कमांड ब्लॉक करें

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

### पश्च-निष्पादन पर टूल आउटपुट रिडैक्ट करें

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

### प्रति LLM कॉल मॉडल संदर्भ संशोधित करें

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### कमांड-सेफ संदर्भ विधियों के साथ स्लैश कमांड पंजीकृत करें

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

## निर्यात सतह

`src/extensibility/hooks/index.ts` निर्यात करता है:

- लोडिंग API (`discoverAndLoadHooks`, `loadHooks`)
- रनर और रैपर (`HookRunner`, `HookToolWrapper`)
- सभी हुक प्रकार
- `execCommand` पुनः-निर्यात

और पैकेज रूट (`src/index.ts`) लीगेसी संगतता सतह के रूप में हुक **प्रकार** पुनः-निर्यात करता है।
