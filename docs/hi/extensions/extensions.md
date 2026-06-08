---
title: Extensions
description: >-
  Extension runtime overview covering types, runner lifecycle, registration, and
  discovery.
sidebar:
  order: 1
  label: Overview
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# एक्सटेंशन

`packages/coding-agent` में रनटाइम एक्सटेंशन लिखने के लिए प्राथमिक गाइड।

यह दस्तावेज़ निम्नलिखित में वर्तमान एक्सटेंशन रनटाइम को कवर करता है:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

डिस्कवरी पथ और फाइलसिस्टम लोडिंग नियमों के लिए, `docs/extension-loading.md` देखें।

## एक्सटेंशन क्या है

एक एक्सटेंशन एक TS/JS मॉड्यूल है जो एक डिफ़ॉल्ट फैक्ट्री एक्सपोर्ट करता है:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

एक्सटेंशन एक ही मॉड्यूल में निम्नलिखित सभी को जोड़ सकते हैं:

- इवेंट हैंडलर (`pi.on(...)`)
- LLM-कॉल करने योग्य टूल (`pi.registerTool(...)`)
- स्लैश कमांड (`pi.registerCommand(...)`)
- कीबोर्ड शॉर्टकट और फ्लैग
- कस्टम मैसेज रेंडरिंग
- सेशन/मैसेज इंजेक्शन API (`sendMessage`, `sendUserMessage`, `appendEntry`)

## रनटाइम मॉडल

1. एक्सटेंशन इम्पोर्ट किए जाते हैं और उनके फैक्ट्री फंक्शन चलाए जाते हैं।
2. उस लोड फेज के दौरान, रजिस्ट्रेशन मेथड वैध हैं; रनटाइम एक्शन मेथड अभी तक इनिशियलाइज़ नहीं हुए होते हैं।
3. `ExtensionRunner.initialize(...)` सक्रिय मोड के लिए लाइव एक्शन/कॉन्टेक्स्ट वायर करता है।
4. सेशन/एजेंट/टूल लाइफसाइकल इवेंट हैंडलर्स को एमिट किए जाते हैं।
5. हर टूल एक्जीक्यूशन एक्सटेंशन इंटरसेप्शन (`tool_call` / `tool_result`) के साथ रैप किया जाता है।

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

`loader.ts` से महत्वपूर्ण बाधा:

- एक्सटेंशन लोड के दौरान `pi.sendMessage()` जैसे एक्शन मेथड कॉल करने पर `ExtensionRuntimeNotInitializedError` थ्रो होता है
- पहले रजिस्टर करें; रनटाइम व्यवहार इवेंट/कमांड/टूल से करें

## त्वरित शुरुआत

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## एक्सटेंशन API सतहें

## 1) रजिस्ट्रेशन और एक्शन (`ExtensionAPI`)

कोर मेथड:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (साझा इवेंट बस)

इंटरैक्टिव मोड में, `input` हैंडलर बिल्ट-इन फर्स्ट-मैसेज ऑटो-टाइटल चेक से पहले चलते हैं। जो एक्सटेंशन `input` से `await pi.setSessionName(...)` कॉल करते हैं, वे पर्सिस्टेड सेशन नाम सेट कर सकते हैं और उस सेशन के लिए डिफ़ॉल्ट ऑटो-जनरेटेड टाइटल को चलने से रोक सकते हैं।

इसके अलावा एक्सपोज़ किए गए:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (पैकेज एक्सपोर्ट्स)

### मैसेज डिलीवरी सेमैंटिक्स

`pi.sendMessage(message, options)` सपोर्ट करता है:

- `deliverAs: "steer"` (डिफ़ॉल्ट) — वर्तमान रन को इंटरप्ट करता है
- `deliverAs: "followUp"` — वर्तमान रन के बाद चलने के लिए क्यू किया जाता है
- `deliverAs: "nextTurn"` — स्टोर किया जाता है और अगले यूज़र प्रॉम्प्ट पर इंजेक्ट किया जाता है
- `triggerTurn: true` — आइडल होने पर टर्न शुरू करता है (`nextTurn` इसे अनदेखा करता है)

`pi.sendUserMessage(content, { deliverAs })` हमेशा प्रॉम्प्ट फ्लो से गुज़रता है; स्ट्रीमिंग के दौरान यह steer/follow-up के रूप में क्यू होता है।

## 2) हैंडलर कॉन्टेक्स्ट (`ExtensionContext`)

हैंडलर और टूल `execute` को `ctx` प्राप्त होता है जिसमें:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (रीड-ओनली)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) कमांड कॉन्टेक्स्ट (`ExtensionCommandContext`)

कमांड हैंडलर को अतिरिक्त रूप से मिलता है:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

सेशन-कंट्रोल फ्लो के लिए कमांड कॉन्टेक्स्ट का उपयोग करें; ये मेथड जानबूझकर सामान्य इवेंट हैंडलर से अलग रखे गए हैं।

## इवेंट सतह (वर्तमान नाम और व्यवहार)

कैनोनिकल इवेंट यूनियन और पेलोड टाइप `types.ts` में हैं।

### सेशन लाइफसाइकल

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

रद्द करने योग्य प्री-इवेंट:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### प्रॉम्प्ट और टर्न लाइफसाइकल

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### टूल लाइफसाइकल

- `tool_call` (प्री-एक्जीक्यूशन, ब्लॉक कर सकता है)
- `tool_result` (पोस्ट-एक्जीक्यूशन, content/details/isError को पैच कर सकता है)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (ऑब्ज़र्वेबिलिटी)

`tool_result` मिडलवेयर-स्टाइल है: हैंडलर एक्सटेंशन क्रम में चलते हैं और प्रत्येक पूर्व संशोधनों को देखता है।

### रिलायबिलिटी/रनटाइम सिग्नल

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### यूज़र कमांड इंटरसेप्शन

- `user_bash` (`{ result }` के साथ ओवरराइड)
- `user_python` (`{ result }` के साथ ओवरराइड)

### `resources_discover`

`resources_discover` एक्सटेंशन टाइप और `ExtensionRunner` में मौजूद है।
वर्तमान रनटाइम नोट: `ExtensionRunner.emitResourcesDiscover(...)` इम्प्लीमेंट किया गया है, लेकिन वर्तमान कोडबेस में इसे इनवोक करने वाली कोई `AgentSession` कॉलसाइट नहीं है।

## टूल ऑथरिंग विवरण

`registerTool` `types.ts` से `ToolDefinition` का उपयोग करता है।

वर्तमान `execute` सिग्नेचर:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

टेम्प्लेट:

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` `sdk.ts` में रजिस्ट्री रैप होने के बाद सभी टूल्स को इंटरसेप्ट करते हैं, जिसमें बिल्ट-इन और एक्सटेंशन/कस्टम टूल शामिल हैं।

## UI इंटीग्रेशन पॉइंट

`ctx.ui` `ExtensionUIContext` इंटरफेस को इम्प्लीमेंट करता है। सपोर्ट मोड के अनुसार भिन्न होता है।

### इंटरैक्टिव मोड (`extension-ui-controller.ts`)

सपोर्टेड:

- डायलॉग: `select`, `confirm`, `input`, `editor`
- नोटिफिकेशन/स्टेटस/एडिटर टेक्स्ट/टर्मिनल इनपुट/कस्टम ओवरले
- नाम द्वारा थीम लिस्टिंग/लोडिंग (`setTheme` स्ट्रिंग नामों को सपोर्ट करता है)
- टूल्स एक्सपैंडेड टॉगल

इस कंट्रोलर में वर्तमान नो-ऑप मेथड:

- `setFooter`
- `setHeader`
- `setEditorComponent`

यह भी नोट करें: `setWidget` वर्तमान में `setHookWidget(...)` के माध्यम से स्टेटस-लाइन टेक्स्ट पर रूट करता है।

### RPC मोड (`rpc-mode.ts`)

`ctx.ui` RPC `extension_ui_request` इवेंट द्वारा बैक किया जाता है:

- डायलॉग मेथड (`select`, `confirm`, `input`, `editor`) क्लाइंट रिस्पॉन्स तक राउंड-ट्रिप करते हैं
- फायर-एंड-फॉरगेट मेथड रिक्वेस्ट एमिट करते हैं (`notify`, `setStatus`, स्ट्रिंग एरे के लिए `setWidget`, `setTitle`, `setEditorText`)

RPC इम्प्लीमेंटेशन में असपोर्टेड/नो-ऑप:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- थीम स्विचिंग/लोडिंग (`setTheme` विफलता रिटर्न करता है)
- टूल एक्सपेंशन कंट्रोल निष्क्रिय हैं

### प्रिंट/हेडलेस/सबएजेंट पथ

जब रनर इनिट को कोई UI कॉन्टेक्स्ट नहीं दिया जाता, तो `ctx.hasUI` `false` होता है और मेथड नो-ऑप/डिफ़ॉल्ट-रिटर्निंग होते हैं।

### बैकग्राउंड इंटरैक्टिव मोड

बैकग्राउंड मोड एक नॉन-इंटरैक्टिव UI कॉन्टेक्स्ट ऑब्जेक्ट इंस्टॉल करता है। वर्तमान इम्प्लीमेंटेशन में, `ctx.hasUI` अभी भी `true` हो सकता है जबकि इंटरैक्टिव डायलॉग डिफ़ॉल्ट/नो-ऑप व्यवहार रिटर्न करते हैं।

## सेशन और स्टेट पैटर्न

टिकाऊ एक्सटेंशन स्टेट के लिए:

1. `pi.appendEntry(customType, data)` के साथ पर्सिस्ट करें।
2. `session_start`, `session_branch`, `session_tree` पर `ctx.sessionManager.getBranch()` से स्टेट पुनर्निर्माण करें।
3. जब स्टेट टूल रिज़ल्ट हिस्ट्री से दिखाई देने योग्य/पुनर्निर्मित करने योग्य हो, तो टूल रिज़ल्ट `details` को स्ट्रक्चर्ड रखें।

उदाहरण पुनर्निर्माण पैटर्न:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## रेंडरिंग एक्सटेंशन पॉइंट

## कस्टम मैसेज रेंडरर

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

इंटरैक्टिव रेंडरिंग द्वारा उपयोग किया जाता है जब कस्टम मैसेज प्रदर्शित किए जाते हैं।

## टूल कॉल/रिज़ल्ट रेंडरर

TUI में कस्टम टूल विज़ुअलाइज़ेशन के लिए `registerTool` डेफिनिशन पर `renderCall` / `renderResult` प्रदान करें।

## बाधाएँ और समस्याएँ

- एक्सटेंशन लोड के दौरान रनटाइम एक्शन उपलब्ध नहीं हैं।
- `tool_call` त्रुटियाँ एक्जीक्यूशन को ब्लॉक करती हैं (फेल-क्लोज़्ड)।
- बिल्ट-इन के साथ कमांड नाम कॉन्फ्लिक्ट डायग्नोस्टिक्स के साथ स्किप किए जाते हैं।
- रिज़र्व्ड शॉर्टकट अनदेखा किए जाते हैं (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`)।
- वर्तमान कमांड हैंडलर फ्रेम के लिए `ctx.reload()` को टर्मिनल मानें।

## एक्सटेंशन बनाम हुक्स बनाम कस्टम-टूल्स

सही सतह का उपयोग करें:

- **एक्सटेंशन** (`src/extensibility/extensions/*`): एकीकृत सिस्टम (इवेंट + टूल + कमांड + रेंडरर + प्रोवाइडर रजिस्ट्रेशन)।
- **हुक्स** (`src/extensibility/hooks/*`): अलग लीगेसी इवेंट API।
- **कस्टम-टूल्स** (`src/extensibility/custom-tools/*`): टूल-केंद्रित मॉड्यूल; जब एक्सटेंशन के साथ लोड किए जाते हैं तो ये अनुकूलित होते हैं और फिर भी एक्सटेंशन इंटरसेप्शन रैपर से गुज़रते हैं।

यदि आपको एक पैकेज चाहिए जो पॉलिसी, टूल्स, कमांड UX, और रेंडरिंग को एक साथ रखता हो, तो एक्सटेंशन का उपयोग करें।
