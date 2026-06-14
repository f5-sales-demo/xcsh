---
title: SDK
description: 'कस्टम एजेंट और इंटीग्रेशन बनाने के लिए SDK, xcsh कोडिंग एजेंट रनटाइम के ऊपर।'
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK, `@f5xc-salesdemos/xcsh` के लिए इन-प्रोसेस इंटीग्रेशन सरफेस है।
इसका उपयोग तब करें जब आप अपने Bun/Node प्रोसेस से सीधे एजेंट स्टेट, इवेंट स्ट्रीमिंग, टूल वायरिंग, और सेशन कंट्रोल तक पहुँचना चाहते हों।

यदि आपको क्रॉस-लैंग्वेज/प्रोसेस आइसोलेशन की आवश्यकता है, तो इसके बजाय RPC मोड का उपयोग करें।

## इंस्टॉलेशन

```bash
bun add @f5xc-salesdemos/xcsh
```

## एंट्री पॉइंट्स

`@f5xc-salesdemos/xcsh` पैकेज रूट से SDK APIs एक्सपोर्ट करता है (और `@f5xc-salesdemos/xcsh/sdk` के माध्यम से भी)।

एम्बेडर्स के लिए कोर एक्सपोर्ट:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- डिस्कवरी हेल्पर्स (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- टूल फैक्ट्री सरफेस (`createTools`, `BUILTIN_TOOLS`, टूल क्लासेस)

## क्विक स्टार्ट (ऑटो-डिस्कवरी डिफ़ॉल्ट)

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

## `createAgentSession()` डिफ़ॉल्ट रूप से क्या डिस्कवर करता है

`createAgentSession()` "ओवरराइड के लिए प्रदान करें, डिस्कवरी के लिए छोड़ें" के सिद्धांत का पालन करता है।

यदि छोड़ा जाए, तो यह निम्नलिखित को रिज़ॉल्व करता है:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (`getAgentDir()` के माध्यम से)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (फ़ाइल-बैक्ड)
- स्किल्स/कॉन्टेक्स्ट फ़ाइलें/प्रॉम्प्ट टेम्पलेट्स/स्लैश कमांड्स/एक्सटेंशन्स/कस्टम TS कमांड्स
- `createTools(...)` के माध्यम से बिल्ट-इन टूल्स
- MCP टूल्स (डिफ़ॉल्ट रूप से सक्षम)
- LSP इंटीग्रेशन (डिफ़ॉल्ट रूप से सक्षम)

### आवश्यक बनाम वैकल्पिक इनपुट

आमतौर पर आपको केवल वही प्रदान करना होता है जिसे आप नियंत्रित करना चाहते हैं:

- **प्रदान करना आवश्यक**: न्यूनतम सेशन के लिए कुछ नहीं
- **एम्बेडर्स में आमतौर पर स्पष्ट रूप से प्रदान करें**:
    - `sessionManager` (यदि आपको इन-मेमोरी या कस्टम लोकेशन की आवश्यकता है)
    - `authStorage` + `modelRegistry` (यदि आप क्रेडेंशियल/मॉडल लाइफसाइकिल के स्वामी हैं)
    - `model` या `modelPattern` (यदि निर्धारक मॉडल चयन महत्वपूर्ण है)
    - `settings` (यदि आपको आइसोलेटेड/टेस्ट कॉन्फ़िग की आवश्यकता है)

## सेशन मैनेजर व्यवहार (स्थायी बनाम इन-मेमोरी)

`AgentSession` हमेशा एक `SessionManager` का उपयोग करता है; व्यवहार इस बात पर निर्भर करता है कि आप किस फैक्ट्री का उपयोग करते हैं।

### फ़ाइल-बैक्ड (डिफ़ॉल्ट)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- कन्वर्सेशन/मैसेजेस/स्टेट डेल्टास को सेशन फ़ाइलों में सुरक्षित रखता है।
- रिज़्यूम/ओपन/लिस्ट/फोर्क वर्कफ्लो को सपोर्ट करता है।
- `session.sessionFile` परिभाषित है।

### इन-मेमोरी

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- कोई फाइलसिस्टम पर्सिस्टेंस नहीं।
- टेस्ट, एफेमेरल वर्कर्स, रिक्वेस्ट-स्कोप्ड एजेंट्स के लिए उपयोगी।
- सेशन मेथड्स अभी भी काम करते हैं, लेकिन पर्सिस्टेंस-विशिष्ट व्यवहार (फ़ाइल रिज़्यूम/फोर्क पाथ्स) स्वाभाविक रूप से सीमित हैं।

### रिज़्यूम/ओपन/लिस्ट हेल्पर्स

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## मॉडल और ऑथ वायरिंग

`createAgentSession()` मॉडल चयन और API key रिज़ॉल्यूशन के लिए `ModelRegistry` + `AuthStorage` का उपयोग करता है।

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

### `model` छोड़ने पर चयन क्रम

जब कोई स्पष्ट `model`/`modelPattern` प्रदान नहीं किया जाता:

1. मौजूदा सेशन से मॉडल रिस्टोर करें (यदि रिस्टोर करने योग्य + key उपलब्ध है)
2. सेटिंग्स डिफ़ॉल्ट मॉडल रोल (`default`)
3. वैध ऑथ के साथ पहला उपलब्ध मॉडल

यदि रिस्टोर विफल हो जाता है, तो `modelFallbackMessage` फॉलबैक की व्याख्या करता है।

### ऑथ प्राथमिकता

`AuthStorage.getApiKey(...)` इस क्रम में रिज़ॉल्व करता है:

1. रनटाइम ओवरराइड (`setRuntimeApiKey`)
2. `agent.db` में संग्रहीत क्रेडेंशियल्स
3. प्रोवाइडर एनवायरनमेंट वेरिएबल्स
4. कस्टम-प्रोवाइडर रिज़ॉल्वर फॉलबैक (यदि कॉन्फ़िगर किया गया हो)

## इवेंट सब्सक्रिप्शन मॉडल

`session.subscribe(listener)` से सब्सक्राइब करें; यह एक अनसब्सक्राइब फ़ंक्शन लौटाता है।

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

1. वैकल्पिक कमांड/टेम्पलेट एक्सपेंशन (`/` कमांड्स, कस्टम कमांड्स, फ़ाइल स्लैश कमांड्स, प्रॉम्प्ट टेम्पलेट्स)
2. यदि वर्तमान में स्ट्रीमिंग हो:
    - `streamingBehavior: "steer" | "followUp"` की आवश्यकता है
    - काम को फेंकने के बजाय क्यू करता है
3. यदि idle हो:
    - मॉडल + API key वैलिडेट करता है
    - यूज़र मैसेज अपेंड करता है
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
- `toolNames` बिल्ट-इन्स के लिए अलाउलिस्ट के रूप में कार्य करता है।
- `customTools` और एक्सटेंशन-रजिस्टर्ड टूल्स अभी भी शामिल हैं।
- हिडन टूल्स (उदाहरण के लिए `submit_result`) ऑप्ट-इन हैं जब तक कि विकल्पों द्वारा आवश्यक न हो।

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### एक्सटेंशन्स

- `extensions`: इनलाइन `ExtensionFactory[]`
- `additionalExtensionPaths`: अतिरिक्त एक्सटेंशन फ़ाइलें लोड करें
- `disableExtensionDiscovery`: स्वचालित एक्सटेंशन स्कैनिंग अक्षम करें
- `preloadedExtensions`: पहले से लोड किए गए एक्सटेंशन सेट का पुन: उपयोग करें

### रनटाइम टूल सेट परिवर्तन

`AgentSession` रनटाइम एक्टिवेशन अपडेट को सपोर्ट करता है:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

एक्टिव टूल परिवर्तनों को दर्शाने के लिए सिस्टम प्रॉम्प्ट पुनः निर्मित किया जाता है।

## डिस्कवरी हेल्पर्स

इनका उपयोग तब करें जब आप आंतरिक डिस्कवरी लॉजिक को दोबारा बनाए बिना आंशिक नियंत्रण चाहते हों:

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

SDK उपभोक्ताओं के लिए जो ऑर्केस्ट्रेटर बना रहे हैं (टास्क एक्जीक्यूटर फ्लो के समान):

- `outputSchema`: स्ट्रक्चर्ड आउटपुट अपेक्षा को टूल कॉन्टेक्स्ट में पास करता है
- `requireSubmitResultTool`: `submit_result` टूल इंक्लूज़न को बाध्य करता है
- `taskDepth`: नेस्टेड टास्क सेशन्स के लिए रिकर्सन-डेप्थ कॉन्टेक्स्ट
- `parentTaskPrefix`: नेस्टेड टास्क आउटपुट के लिए आर्टिफैक्ट नामकरण प्रीफिक्स

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

`setToolUIContext(...)` का उपयोग केवल तभी करें जब आपका एम्बेडर UI क्षमताएँ प्रदान करता हो जिन्हें टूल्स/एक्सटेंशन्स को कॉल करना चाहिए।

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
