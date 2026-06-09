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

हुक पैकेज (`src/extensibility/hooks/`) अभी भी एक API सतह के रूप में निर्यात और उपयोग योग्य है, लेकिन डिफ़ॉल्ट CLI रनटाइम अब **एक्सटेंशन रनर** पथ को इनिशियलाइज़ करता है। वर्तमान स्टार्टअप फ्लो में:

- `--hook` को `--extension` के उपनाम के रूप में माना जाता है (CLI पथ `additionalExtensionPaths` में मर्ज किए जाते हैं)
- टूल्स `ExtensionToolWrapper` द्वारा रैप किए जाते हैं, `HookToolWrapper` द्वारा नहीं
- कॉन्टेक्स्ट ट्रांसफ़ॉर्म और लाइफसाइकल एमिशन `ExtensionRunner` के माध्यम से जाते हैं

अतः यह फ़ाइल हुक सबसिस्टम कार्यान्वयन (types/loader/runner/wrapper) का दस्तावेज़ीकरण करती है, जिसमें लेगेसी व्यवहार और बाधाएं शामिल हैं।

## प्रमुख फ़ाइलें

- `src/extensibility/hooks/types.ts` — हुक कॉन्टेक्स्ट, इवेंट प्रकार, और परिणाम अनुबंध
- `src/extensibility/hooks/loader.ts` — मॉड्यूल लोडिंग और हुक डिस्कवरी ब्रिज
- `src/extensibility/hooks/runner.ts` — इवेंट डिस्पैच, कमांड लुकअप, एरर सिग्नलिंग
- `src/extensibility/hooks/tool-wrapper.ts` — प्री/पोस्ट टूल इंटरसेप्शन रैपर
- `src/extensibility/hooks/index.ts` — एक्सपोर्ट/री-एक्सपोर्ट

## हुक मॉड्यूल क्या है

एक हुक मॉड्यूल को एक फैक्ट्री डिफ़ॉल्ट-एक्सपोर्ट करनी होगी:

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

फैक्ट्री ये कर सकती है:

- `pi.on(...)` के साथ इवेंट हैंडलर पंजीकृत करना
- `pi.sendMessage(...)` के साथ स्थायी कस्टम संदेश भेजना
- `pi.appendEntry(...)` के साथ नॉन-LLM स्टेट को स्थायी बनाना
- `pi.registerCommand(...)` के माध्यम से स्लैश कमांड पंजीकृत करना
- `pi.registerMessageRenderer(...)` के माध्यम से कस्टम संदेश रेंडरर पंजीकृत करना
- `pi.exec(...)` के माध्यम से शेल कमांड चलाना

## डिस्कवरी और लोडिंग

`discoverAndLoadHooks(configuredPaths, cwd)` यह करता है:

1. कैपेबिलिटी रजिस्ट्री से खोजे गए हुक्स लोड करना (`loadCapability("hooks")`)
2. स्पष्ट रूप से कॉन्फ़िगर किए गए पथ जोड़ना (ऐब्सोल्यूट पथ द्वारा डीडुप्लिकेट)
3. `loadHooks(allPaths, cwd)` कॉल करना

`loadHooks` फिर प्रत्येक पथ को इम्पोर्ट करता है और एक `default` फ़ंक्शन की अपेक्षा करता है।

### पथ रिज़ॉल्यूशन

`loader.ts` हुक पथों को इस प्रकार रिज़ॉल्व करता है:

- ऐब्सोल्यूट पथ: जैसा है वैसा उपयोग होता है
- `~` पथ: विस्तारित किया जाता है
- सापेक्ष पथ: `cwd` के विरुद्ध रिज़ॉल्व किया जाता है

### महत्वपूर्ण लेगेसी असंगतता

`hookCapability` के लिए डिस्कवरी प्रोवाइडर अभी भी प्री/पोस्ट शेल-स्टाइल हुक फ़ाइलों को मॉडल करते हैं (उदाहरण के लिए `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)।

यहाँ का हुक लोडर डायनामिक मॉड्यूल इम्पोर्ट का उपयोग करता है और एक डिफ़ॉल्ट JS/TS हुक फैक्ट्री की आवश्यकता होती है। यदि कोई खोजा गया हुक पथ मॉड्यूल के रूप में इम्पोर्ट करने योग्य नहीं है, तो लोड विफल हो जाता है और `LoadHooksResult.errors` में रिपोर्ट किया जाता है।

## इवेंट सतहें

हुक इवेंट `types.ts` में सख्ती से टाइप किए गए हैं।

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

### एजेंट/कॉन्टेक्स्ट इवेंट

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

- `tool_call` (प्री-एक्ज़ीक्यूशन) → `{ block?: boolean; reason?: string }` लौटा सकता है
- `tool_result` (पोस्ट-एक्ज़ीक्यूशन) → `{ content?; details?; isError? }` लौटा सकता है

यह हुक सबसिस्टम का मुख्य प्री/पोस्ट इंटरसेप्शन मॉडल है।

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

### 1) प्री-एक्ज़ीक्यूशन: `tool_call`

`HookToolWrapper.execute()` टूल निष्पादन से पहले `tool_call` एमिट करता है।

- यदि कोई भी हैंडलर `{ block: true }` लौटाता है, तो निष्पादन रुक जाता है
- यदि हैंडलर थ्रो करता है, तो रैपर फेल-क्लोज़ होता है और निष्पादन को ब्लॉक करता है
- लौटाया गया `reason` थ्रो की गई एरर टेक्स्ट बन जाता है

### 2) टूल निष्पादन

यदि ब्लॉक नहीं किया गया तो अंतर्निहित टूल सामान्य रूप से निष्पादित होता है।

### 3) पोस्ट-एक्ज़ीक्यूशन: `tool_result`

सफलता के बाद, रैपर `tool_result` एमिट करता है जिसमें:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

यदि हैंडलर ओवरराइड लौटाता है:

- `content` परिणाम सामग्री को बदल सकता है
- `details` परिणाम विवरण को बदल सकता है

टूल विफलता पर, रैपर `tool_result` एमिट करता है `isError: true` और एरर टेक्स्ट कंटेंट के साथ, फिर मूल एरर को रीथ्रो करता है।

### हुक्स क्या म्यूटेट कर सकते हैं

- `context` के माध्यम से एकल कॉल के लिए LLM कॉन्टेक्स्ट (`messages` रिप्लेसमेंट चेन)
- सफल टूल कॉल पर टूल आउटपुट कंटेंट/विवरण (`tool_result` पथ)
- `before_agent_start` के माध्यम से प्री-एजेंट इंजेक्टेड संदेश
- `session_before_*` और `session.compacting` के माध्यम से रद्दीकरण/कस्टम कॉम्पैक्शन/ट्री व्यवहार

### इस कार्यान्वयन में हुक्स क्या म्यूटेट नहीं कर सकते

- कच्चे टूल इनपुट पैरामीटर इन-प्लेस (केवल `tool_call` पर ब्लॉक/अनुमति)
- थ्रो की गई टूल एरर के बाद निष्पादन जारी रखना (एरर पथ रीथ्रो करता है)
- रैपर व्यवहार में अंतिम सफलता/एरर स्थिति (लौटाया गया `isError` टाइप किया गया है लेकिन `HookToolWrapper` द्वारा लागू नहीं किया जाता)

## क्रमबद्धता और विरोध व्यवहार

### डिस्कवरी-स्तर क्रमबद्धता

कैपेबिलिटी प्रोवाइडर प्राथमिकता-क्रमित होते हैं (उच्च पहले)। डीडुप्लिकेशन कैपेबिलिटी कुंजी द्वारा होता है, पहला जीतता है।

`hooks` के लिए, कैपेबिलिटी कुंजी `${type}:${tool}:${name}` है। निम्न-प्राथमिकता प्रोवाइडर से शैडो किए गए डुप्लिकेट चिह्नित किए जाते हैं और प्रभावी खोजी गई सूची से बाहर रखे जाते हैं।

### लोड क्रम

`discoverAndLoadHooks` एक सपाट `allPaths` सूची बनाता है, रिज़ॉल्व किए गए ऐब्सोल्यूट पथ द्वारा डीडुप्लिकेट, फिर `loadHooks` उस क्रम में इटरेट करता है।
प्रत्येक खोजी गई डायरेक्टरी के भीतर फ़ाइल क्रम `readdir` आउटपुट पर निर्भर करता है; हुक लोडर अतिरिक्त सॉर्ट नहीं करता।

### रनटाइम हैंडलर क्रम

`HookRunner` के अंदर, क्रम पंजीकरण अनुक्रम द्वारा निर्धारक है:

1. हुक्स ऐरे क्रम
2. प्रति हुक/इवेंट हैंडलर पंजीकरण क्रम

इवेंट प्रकार द्वारा विरोध व्यवहार:

- `tool_call`: अंतिम लौटाया गया परिणाम जीतता है जब तक कोई हैंडलर ब्लॉक न करे; पहला ब्लॉक शॉर्ट-सर्किट करता है
- `tool_result`: अंतिम लौटाया गया ओवरराइड जीतता है (कोई शॉर्ट-सर्किट नहीं)
- `context`: चेन्ड; प्रत्येक हैंडलर पूर्व हैंडलर के संदेश आउटपुट को प्राप्त करता है
- `before_agent_start`: पहला लौटाया गया संदेश रखा जाता है; बाद के संदेश अनदेखे
- `session_before_*`: नवीनतम लौटाया गया परिणाम ट्रैक किया जाता है; `cancel: true` तुरंत शॉर्ट-सर्किट करता है
- `session.compacting`: नवीनतम लौटाया गया परिणाम जीतता है

कमांड/रेंडरर विरोध:

- `getCommand(name)` हुक्स में पहला मैच लौटाता है (पहले लोड किया गया जीतता है)
- `getMessageRenderer(customType)` पहला मैच लौटाता है
- `getRegisteredCommands()` सभी कमांड लौटाता है (कोई डीडुप्लिकेशन नहीं)

## UI इंटरैक्शन (`HookContext.ui`)

`HookUIContext` में शामिल हैं:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme` गेटर

`ctx.hasUI` इंगित करता है कि इंटरैक्टिव UI उपलब्ध है या नहीं।

जब बिना UI के चल रहा हो, तो डिफ़ॉल्ट नो-ऑप कॉन्टेक्स्ट व्यवहार है:

- `select/input/editor` `undefined` लौटाते हैं
- `confirm` `false` लौटाता है
- `notify`, `setStatus`, `setEditorText` नो-ऑप हैं
- `getEditorText` `""` लौटाता है

### स्टेटस लाइन व्यवहार

`ctx.ui.setStatus(key, text)` के माध्यम से सेट किया गया हुक स्टेटस टेक्स्ट:

- प्रति कुंजी संग्रहीत होता है
- कुंजी नाम द्वारा क्रमबद्ध होता है
- सैनिटाइज़ किया जाता है (`\r`, `\n`, `\t` → स्पेस; दोहराए गए स्पेस संक्षिप्त)
- जोड़ा जाता है और प्रदर्शन के लिए चौड़ाई-ट्रंकेट किया जाता है

## एरर प्रसार और फ़ॉलबैक

### लोड-समय

- अमान्य मॉड्यूल या गायब डिफ़ॉल्ट एक्सपोर्ट → `LoadHooksResult.errors` में कैप्चर किया जाता है
- अन्य हुक्स के लिए लोडिंग जारी रहती है

### इवेंट-समय

`HookRunner.emit(...)` अधिकांश इवेंट के लिए हैंडलर एरर कैच करता है और श्रोताओं को `HookError` एमिट करता है (`hookPath`, `event`, `error`), फिर जारी रहता है।

`emitToolCall(...)` अधिक सख्त है: हैंडलर एरर वहाँ निगले नहीं जाते; वे कॉलर तक प्रसारित होते हैं। `HookToolWrapper` में, यह टूल कॉल को ब्लॉक करता है (फेल-सेफ)।

## व्यावहारिक API उदाहरण

### असुरक्षित bash कमांड ब्लॉक करें

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

### पोस्ट-एक्ज़ीक्यूशन पर टूल आउटपुट रीडैक्ट करें

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

### कमांड-सुरक्षित कॉन्टेक्स्ट विधियों के साथ स्लैश कमांड पंजीकृत करें

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

## एक्सपोर्ट सतह

`src/extensibility/hooks/index.ts` एक्सपोर्ट करता है:

- लोडिंग APIs (`discoverAndLoadHooks`, `loadHooks`)
- रनर और रैपर (`HookRunner`, `HookToolWrapper`)
- सभी हुक टाइप्स
- `execCommand` री-एक्सपोर्ट

और पैकेज रूट (`src/index.ts`) लेगेसी संगतता सतह के रूप में हुक **टाइप्स** को री-एक्सपोर्ट करता है।
