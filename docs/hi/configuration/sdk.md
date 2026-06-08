---
title: SDK
description: >-
  SDK for building custom agents and integrations on top of the xcsh coding
  agent runtime.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK `@f5xc-salesdemos/xcsh` के लिए इन-प्रोसेस इंटीग्रेशन सरफेस है।
इसका उपयोग तब करें जब आप अपने खुद के Bun/Node प्रोसेस से एजेंट स्टेट, इवेंट स्ट्रीमिंग, टूल वायरिंग, और सेशन कंट्रोल तक सीधी पहुँच चाहते हैं।

यदि आपको क्रॉस-लैंग्वेज/प्रोसेस आइसोलेशन की आवश्यकता है, तो इसके बजाय RPC मोड का उपयोग करें।

## इंस्टॉलेशन

```bash
bun add @f5xc-salesdemos/xcsh
```

## एंट्री पॉइंट्स

`@f5xc-salesdemos/xcsh` पैकेज रूट से (और `@f5xc-salesdemos/xcsh/sdk` के माध्यम से भी) SDK APIs को एक्सपोर्ट करता है।

एम्बेडर्स के लिए कोर एक्सपोर्ट्स:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- डिस्कवरी हेल्पर्स (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- टूल फैक्ट्री सरफेस (`createTools`, `BUILTIN_TOOLS`, टूल क्लासेस)

## त्वरित शुरुआत (ऑटो-डिस्कवरी डिफॉल्ट्स)

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## `createAgentSession()` डिफॉल्ट रूप से क्या डिस्कवर करता है

`createAgentSession()` "ओवरराइड करने के लिए प्रदान करें, डिस्कवर करने के लिए छोड़ दें" के सिद्धांत का पालन करता है।

यदि छोड़ दिया जाए, तो यह रिज़ॉल्व करता है:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (`getAgentDir()` के माध्यम से)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (फाइल-बैक्ड)
- skills/context files/prompt templates/slash commands/extensions/custom TS commands
- `createTools(...)` के माध्यम से बिल्ट-इन टूल्स
- MCP टूल्स (डिफॉल्ट रूप से सक्षम)
- LSP इंटीग्रेशन (डिफॉल्ट रूप से सक्षम)

### आवश्यक बनाम वैकल्पिक इनपुट्स

आमतौर पर आपको केवल वही प्रदान करना होगा जिसे आप नियंत्रित करना चाहते हैं:

- **आवश्यक**: न्यूनतम सेशन के लिए कुछ भी नहीं
- **आमतौर पर स्पष्ट रूप से प्रदान करें** एम्बेडर्स में:
    - `sessionManager` (यदि आपको इन-मेमोरी या कस्टम लोकेशन चाहिए)
    - `authStorage` + `modelRegistry` (यदि आप क्रेडेंशियल/मॉडल लाइफसाइकिल के मालिक हैं)
    - `model` या `modelPattern` (यदि डिटर्मिनिस्टिक मॉडल सिलेक्शन महत्वपूर्ण है)
    - `settings` (यदि आपको आइसोलेटेड/टेस्ट कॉन्फ़िग चाहिए)

## सेशन मैनेजर व्यवहार (परसिस्टेंट बनाम इन-मेमोरी)

`AgentSession` हमेशा एक `SessionManager` का उपयोग करता है; व्यवहार इस पर निर्भर करता है कि आप कौन सी फैक्ट्री का उपयोग करते हैं।

### फाइल-बैक्ड (डिफॉल्ट)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- कन्वर्सेशन/मैसेजेस/स्टेट डेल्टा को सेशन फाइलों में परसिस्ट करता है।
- resume/open/list/fork वर्कफ़्लो को सपोर्ट करता है।
- `session.sessionFile` डिफाइन्ड होता है।

### इन-मेमोरी

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- कोई फाइलसिस्टम परसिस्टेंस नहीं।
- टेस्ट, इफेमरल वर्कर्स, रिक्वेस्ट-स्कोप्ड एजेंट्स के लिए उपयोगी।
- सेशन मेथड्स अभी भी काम करते हैं, लेकिन परसिस्टेंस-स्पेसिफिक व्यवहार (फाइल resume/fork पाथ) स्वाभाविक रूप से सीमित हैं।

### Resume/open/list हेल्पर्स

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## मॉडल और ऑथ वायरिंग

`createAgentSession()` मॉडल सिलेक्शन और API की रिज़ॉल्यूशन के लिए `ModelRegistry` + `AuthStorage` का उपयोग करता है।

### स्पष्ट वायरिंग

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### जब `model` छोड़ दिया जाता है तो सिलेक्शन क्रम

जब कोई स्पष्ट `model`/`modelPattern` प्रदान नहीं किया जाता:

1. मौजूदा सेशन से मॉडल रिस्टोर करें (यदि रिस्टोर करने योग्य + की उपलब्ध हो)
2. सेटिंग्स डिफॉल्ट मॉडल रोल (`default`)
3. वैध ऑथ वाला पहला उपलब्ध मॉडल

यदि रिस्टोर विफल होता है, तो `modelFallbackMessage` फॉलबैक की व्याख्या करता है।

### ऑथ प्राथमिकता

`AuthStorage.getApiKey(...)` इस क्रम में रिज़ॉल्व करता है:

1. रनटाइम ओवरराइड (`setRuntimeApiKey`)
2. `agent.db` में स्टोर्ड क्रेडेंशियल्स
3. प्रोवाइडर एनवायरनमेंट वेरिएबल्स
4. कस्टम-प्रोवाइडर रिज़ॉल्वर फॉलबैक (यदि कॉन्फ़िगर किया गया हो)

## इवेंट सब्सक्रिप्शन मॉडल

`session.subscribe(listener)` के साथ सब्सक्राइब करें; यह एक अनसब्सक्राइब फंक्शन रिटर्न करता है।

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent` में कोर `AgentEvent` के साथ-साथ सेशन-लेवल इवेंट्स शामिल हैं:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## प्रॉम्प्ट लाइफसाइकिल

`session.prompt(text, options?)` प्राथमिक एंट्री पॉइंट है।

व्यवहार:

1. वैकल्पिक कमांड/टेम्पलेट एक्सपेंशन (`/` कमांड्स, कस्टम कमांड्स, फाइल स्लैश कमांड्स, प्रॉम्प्ट टेम्पलेट्स)
2. यदि वर्तमान में स्ट्रीमिंग हो रहा है:
    - `streamingBehavior: "steer" | "followUp"` आवश्यक है
    - काम को फेंकने के बजाय क्यू करता है
3. यदि आइडल है:
    - मॉडल + API की को वैलिडेट करता है
    - यूजर मैसेज अपेंड करता है
    - एजेंट टर्न शुरू करता है

संबंधित APIs:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## टूल्स और एक्सटेंशन इंटीग्रेशन

### बिल्ट-इन्स और फ़िल्टरिंग

- बिल्ट-इन्स `createTools(...)` और `BUILTIN_TOOLS` से आते हैं।
- `toolNames` बिल्ट-इन्स के लिए एक अलाउलिस्ट के रूप में कार्य करता है।
- `customTools` और एक्सटेंशन-रजिस्टर्ड टूल्स अभी भी शामिल होते हैं।
- हिडन टूल्स (उदाहरण के लिए `submit_result`) ऑप्ट-इन होते हैं जब तक कि विकल्पों द्वारा आवश्यक न हों।

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### एक्सटेंशन्स

- `extensions`: इनलाइन `ExtensionFactory[]`
- `additionalExtensionPaths`: अतिरिक्त एक्सटेंशन फाइलें लोड करें
- `disableExtensionDiscovery`: ऑटोमैटिक एक्सटेंशन स्कैनिंग अक्षम करें
- `preloadedExtensions`: पहले से लोड किए गए एक्सटेंशन सेट का पुन: उपयोग करें

### रनटाइम टूल सेट परिवर्तन

`AgentSession` रनटाइम एक्टिवेशन अपडेट्स को सपोर्ट करता है:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

एक्टिव टूल परिवर्तनों को दर्शाने के लिए सिस्टम प्रॉम्प्ट पुनर्निर्मित किया जाता है।

## डिस्कवरी हेल्पर्स

इनका उपयोग तब करें जब आप आंतरिक डिस्कवरी लॉजिक को फिर से बनाए बिना आंशिक नियंत्रण चाहते हैं:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## सबएजेंट-ओरिएंटेड विकल्प

ऑर्केस्ट्रेटर बनाने वाले SDK उपभोक्ताओं के लिए (टास्क एक्जीक्यूटर फ्लो के समान):

- `outputSchema`: स्ट्रक्चर्ड आउटपुट अपेक्षा को टूल कॉन्टेक्स्ट में पास करता है
- `requireSubmitResultTool`: `submit_result` टूल इंक्लूजन को बाध्य करता है
- `taskDepth`: नेस्टेड टास्क सेशन्स के लिए रिकर्सन-डेप्थ कॉन्टेक्स्ट
- `parentTaskPrefix`: नेस्टेड टास्क आउटपुट के लिए आर्टिफैक्ट नेमिंग प्रीफिक्स

ये सामान्य सिंगल-एजेंट एम्बेडिंग के लिए वैकल्पिक हैं।

## `createAgentSession()` रिटर्न वैल्यू

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

`setToolUIContext(...)` का उपयोग तभी करें जब आपका एम्बेडर UI क्षमताएँ प्रदान करता हो जिन्हें टूल्स/एक्सटेंशन्स को कॉल करना चाहिए।

## न्यूनतम नियंत्रित एम्बेड उदाहरण

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
