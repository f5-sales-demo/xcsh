---
title: एक्सटेंशन
description: >-
  एक्सटेंशन रनटाइम का अवलोकन जिसमें प्रकार, रनर लाइफसाइकिल, पंजीकरण और डिस्कवरी
  शामिल हैं।
sidebar:
  order: 1
  label: अवलोकन
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# एक्सटेंशन

`packages/coding-agent` में रनटाइम एक्सटेंशन लिखने के लिए प्राथमिक मार्गदर्शिका।

यह दस्तावेज़ वर्तमान एक्सटेंशन रनटाइम को कवर करता है:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

डिस्कवरी पथों और फाइलसिस्टम लोडिंग नियमों के लिए, `docs/extension-loading.md` देखें।

## एक्सटेंशन क्या है

एक एक्सटेंशन एक TS/JS मॉड्यूल है जो एक डिफ़ॉल्ट फ़ैक्टरी निर्यात करता है:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

एक्सटेंशन एक ही मॉड्यूल में निम्नलिखित सभी को संयोजित कर सकते हैं:

- इवेंट हैंडलर (`pi.on(...)`)
- LLM-callable उपकरण (`pi.registerTool(...)`)
- स्लैश कमांड (`pi.registerCommand(...)`)
- कीबोर्ड शॉर्टकट और फ्लैग
- कस्टम मैसेज रेंडरिंग
- सेशन/मैसेज इंजेक्शन API (`sendMessage`, `sendUserMessage`, `appendEntry`)

## रनटाइम मॉडल

1. एक्सटेंशन इम्पोर्ट किए जाते हैं और उनके फ़ैक्टरी फ़ंक्शन चलाए जाते हैं।
2. उस लोड फ़ेज़ के दौरान, पंजीकरण विधियाँ मान्य हैं; रनटाइम एक्शन विधियाँ अभी तक प्रारंभ नहीं हुई हैं।
3. `ExtensionRunner.initialize(...)` सक्रिय मोड के लिए लाइव एक्शन/कॉन्टेक्स्ट को जोड़ता है।
4. सेशन/एजेंट/टूल लाइफसाइकिल इवेंट हैंडलर को भेजे जाते हैं।
5. हर टूल एक्जीक्यूशन को एक्सटेंशन इंटरसेप्शन के साथ लपेटा जाता है (`tool_call` / `tool_result`)।

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

- एक्सटेंशन लोड के दौरान `pi.sendMessage()` जैसी एक्शन विधियों को कॉल करने पर `ExtensionRuntimeNotInitializedError` फेंकता है
- पहले पंजीकृत करें; इवेंट/कमांड/टूल से रनटाइम व्यवहार करें

## त्वरित प्रारंभ

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
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

## 1) पंजीकरण और एक्शन (`ExtensionAPI`)

मुख्य विधियाँ:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (साझा इवेंट बस)

इंटरेक्टिव मोड में, `input` हैंडलर बिल्ट-इन पहले-मैसेज ऑटो-टाइटल जाँच से पहले चलते हैं। एक्सटेंशन जो `input` से `await pi.setSessionName(...)` कॉल करते हैं, वे सतत सेशन नाम सेट कर सकते हैं और उस सेशन के लिए डिफ़ॉल्ट ऑटो-जेनरेटेड टाइटल को चलने से रोक सकते हैं।

यह भी उजागर है:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (पैकेज निर्यात)

### मैसेज डिलीवरी सेमेंटिक्स

`pi.sendMessage(message, options)` समर्थन करता है:

- `deliverAs: "steer"` (डिफ़ॉल्ट) — वर्तमान रन को बाधित करता है
- `deliverAs: "followUp"` — वर्तमान रन के बाद चलने के लिए कतारबद्ध
- `deliverAs: "nextTurn"` — संग्रहीत और अगले उपयोगकर्ता प्रॉम्प्ट पर इंजेक्ट किया गया
- `triggerTurn: true` — निष्क्रिय होने पर एक टर्न शुरू करता है (`nextTurn` इसे अनदेखा करता है)

`pi.sendUserMessage(content, { deliverAs })` हमेशा प्रॉम्प्ट प्रवाह से गुजरता है; स्ट्रीमिंग के दौरान यह steer/follow-up के रूप में कतारबद्ध होता है।

## 2) हैंडलर कॉन्टेक्स्ट (`ExtensionContext`)

हैंडलर और टूल `execute` को `ctx` मिलता है जिसमें:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (केवल-पढ़ने योग्य)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) कमांड कॉन्टेक्स्ट (`ExtensionCommandContext`)

कमांड हैंडलर को अतिरिक्त मिलता है:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

सेशन-नियंत्रण प्रवाह के लिए कमांड कॉन्टेक्स्ट का उपयोग करें; ये विधियाँ जानबूझकर सामान्य इवेंट हैंडलर से अलग की गई हैं।

## इवेंट सतह (वर्तमान नाम और व्यवहार)

कैनोनिकल इवेंट यूनियन और पेलोड प्रकार `types.ts` में हैं।

### सेशन लाइफसाइकिल

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

### प्रॉम्प्ट और टर्न लाइफसाइकिल

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### टूल लाइफसाइकिल

- `tool_call` (पूर्व-निष्पादन, ब्लॉक कर सकता है)
- `tool_result` (पश्च-निष्पादन, content/details/isError को पैच कर सकता है)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (अवलोकनीयता)

`tool_result` मिडलवेयर-स्टाइल है: हैंडलर एक्सटेंशन क्रम में चलते हैं और हर एक पूर्व संशोधन देखता है।

### विश्वसनीयता/रनटाइम संकेत

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### उपयोगकर्ता कमांड इंटरसेप्शन

- `user_bash` (`{ result }` के साथ ओवरराइड करें)
- `user_python` (`{ result }` के साथ ओवरराइड करें)

### `resources_discover`

`resources_discover` एक्सटेंशन प्रकारों और `ExtensionRunner` में मौजूद है।
वर्तमान रनटाइम नोट: `ExtensionRunner.emitResourcesDiscover(...)` लागू किया गया है, लेकिन वर्तमान कोडबेस में इसे कॉल करने वाला कोई `AgentSession` कॉलसाइट नहीं है।

## टूल लेखन विवरण

`registerTool` `types.ts` से `ToolDefinition` का उपयोग करता है।

वर्तमान `execute` हस्ताक्षर:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

टेम्पलेट:

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

`tool_call`/`tool_result` `sdk.ts` में रजिस्ट्री को रैप किए जाने के बाद सभी उपकरणों को इंटरसेप्ट करता है, जिसमें बिल्ट-इन और एक्सटेंशन/कस्टम उपकरण शामिल हैं।

## UI एकीकरण बिंदु

`ctx.ui` `ExtensionUIContext` इंटरफेस को लागू करता है। समर्थन मोड के अनुसार भिन्न होता है।

### इंटरेक्टिव मोड (`extension-ui-controller.ts`)

समर्थित:

- डायलॉग: `select`, `confirm`, `input`, `editor`
- नोटिफिकेशन/स्टेटस/एडिटर टेक्स्ट/टर्मिनल इनपुट/कस्टम ओवरले
- नाम से थीम लिस्टिंग/लोडिंग (`setTheme` स्ट्रिंग नाम समर्थन करता है)
- उपकरण विस्तारित टॉगल

इस कंट्रोलर में वर्तमान नो-ऑप विधियाँ:

- `setFooter`
- `setHeader`
- `setEditorComponent`

यह भी नोट करें: `setWidget` वर्तमान में `setHookWidget(...)` के माध्यम से स्टेटस-लाइन टेक्स्ट पर रूट करता है।

### RPC मोड (`rpc-mode.ts`)

`ctx.ui` RPC `extension_ui_request` इवेंट द्वारा समर्थित है:

- डायलॉग विधियाँ (`select`, `confirm`, `input`, `editor`) क्लाइंट प्रतिक्रियाओं तक राउंड-ट्रिप करती हैं
- फायर-एंड-फॉरगेट विधियाँ अनुरोध भेजती हैं (`notify`, `setStatus`, `setWidget` स्ट्रिंग सरणियों के लिए, `setTitle`, `setEditorText`)

RPC कार्यान्वयन में असमर्थित/नो-ऑप:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- थीम स्विचिंग/लोडिंग (`setTheme` विफलता लौटाता है)
- टूल विस्तार नियंत्रण निष्क्रिय हैं

### प्रिंट/हेडलेस/सबएजेंट पथ

जब रनर init को कोई UI कॉन्टेक्स्ट नहीं दिया जाता, तो `ctx.hasUI` `false` है और विधियाँ नो-ऑप/डिफ़ॉल्ट-रिटर्निंग हैं।

### बैकग्राउंड इंटरेक्टिव मोड

बैकग्राउंड मोड एक गैर-इंटरेक्टिव UI कॉन्टेक्स्ट ऑब्जेक्ट स्थापित करता है। वर्तमान कार्यान्वयन में, `ctx.hasUI` अभी भी `true` हो सकता है जबकि इंटरेक्टिव डायलॉग डिफ़ॉल्ट/नो-ऑप व्यवहार लौटाते हैं।

## सेशन और स्थिति पैटर्न

टिकाऊ एक्सटेंशन स्थिति के लिए:

1. `pi.appendEntry(customType, data)` के साथ सतत रखें।
2. `session_start`, `session_branch`, `session_tree` पर `ctx.sessionManager.getBranch()` से स्थिति पुनर्निर्माण करें।
3. टूल रिजल्ट `details` को संरचित रखें जब स्थिति टूल रिजल्ट इतिहास से दृश्यमान/पुनर्निर्माण योग्य होनी चाहिए।

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

## रेंडरिंग एक्सटेंशन बिंदु

## कस्टम मैसेज रेंडरर

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

कस्टम मैसेज प्रदर्शित होने पर इंटरेक्टिव रेंडरिंग द्वारा उपयोग किया जाता है।

## टूल कॉल/रिजल्ट रेंडरर

TUI में कस्टम टूल विज़ुअलाइज़ेशन के लिए `registerTool` परिभाषाओं पर `renderCall` / `renderResult` प्रदान करें।

## बाधाएँ और नुकसान

- एक्सटेंशन लोड के दौरान रनटाइम एक्शन अनुपलब्ध हैं।
- `tool_call` त्रुटियाँ निष्पादन को ब्लॉक करती हैं (fail-closed)।
- बिल्ट-इन के साथ कमांड नाम संघर्ष डायग्नोस्टिक्स के साथ छोड़ दिए जाते हैं।
- आरक्षित शॉर्टकट अनदेखे किए जाते हैं (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`)।
- `ctx.reload()` को वर्तमान कमांड हैंडलर फ्रेम के लिए टर्मिनल मानें।

## एक्सटेंशन बनाम हुक बनाम कस्टम-टूल

सही सतह का उपयोग करें:

- **एक्सटेंशन** (`src/extensibility/extensions/*`): एकीकृत प्रणाली (इवेंट + उपकरण + कमांड + रेंडरर + प्रोवाइडर पंजीकरण)।
- **हुक** (`src/extensibility/hooks/*`): अलग लेगेसी इवेंट API।
- **कस्टम-टूल** (`src/extensibility/custom-tools/*`): टूल-केंद्रित मॉड्यूल; एक्सटेंशन के साथ लोड होने पर वे अनुकूलित होते हैं और एक्सटेंशन इंटरसेप्शन रैपर से गुजरते हैं।

यदि आपको एक ऐसे पैकेज की आवश्यकता है जो नीति, उपकरण, कमांड UX और रेंडरिंग को एक साथ संभाले, तो एक्सटेंशन का उपयोग करें।
