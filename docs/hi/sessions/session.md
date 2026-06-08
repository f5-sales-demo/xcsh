---
title: सत्र संग्रहण और प्रविष्टि मॉडल
description: >-
  Append-only सत्र संग्रहण मॉडल जिसमें प्रविष्टि प्रकार, स्थायित्व, और प्रारूपों
  के बीच माइग्रेशन शामिल है।
sidebar:
  order: 1
  label: संग्रहण और प्रविष्टि मॉडल
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# सत्र संग्रहण और प्रविष्टि मॉडल

यह दस्तावेज़ इस बात का आधिकारिक स्रोत है कि कोडिंग-एजेंट सत्रों को रनटाइम पर कैसे प्रदर्शित, स्थायी, माइग्रेट और पुनर्निर्मित किया जाता है।

## दायरा

इसमें शामिल है:

- सत्र JSONL प्रारूप और संस्करणीकरण
- प्रविष्टि वर्गीकरण और ट्री सेमैंटिक्स (`id`/`parentId` + लीफ पॉइंटर)
- पुरानी या दोषपूर्ण फाइलें लोड करते समय माइग्रेशन/संगतता व्यवहार
- कॉन्टेक्स्ट पुनर्निर्माण (`buildSessionContext`)
- स्थायित्व गारंटी, विफलता व्यवहार, ट्रंकेशन/ब्लॉब बाह्यकरण
- संग्रहण अमूर्तन (`FileSessionStorage`, `MemorySessionStorage`) और संबंधित उपयोगिताएं

इसमें शामिल नहीं है: `/tree` UI रेंडरिंग व्यवहार, सिवाय उन सेमैंटिक्स के जो सत्र डेटा को प्रभावित करते हैं।

## कार्यान्वयन फाइलें

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## डिस्क पर लेआउट

डिफ़ॉल्ट सत्र फाइल स्थान:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` कार्यशील निर्देशिका से व्युत्पन्न होता है जिसमें अग्रणी स्लैश हटाकर `/`, `\\`, और `:` को `-` से बदला जाता है।

ब्लॉब स्टोर स्थान:

```text
~/.xcsh/agent/blobs/<sha256>
```

टर्मिनल ब्रेडक्रंब फाइलें यहाँ लिखी जाती हैं:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

ब्रेडक्रंब सामग्री दो पंक्तियाँ होती हैं: मूल cwd, फिर सत्र फाइल पथ। `continueRecent()` सबसे हाल के mtime को स्कैन करने से पहले इस टर्मिनल-स्कोप्ड पॉइंटर को प्राथमिकता देता है।

## फाइल प्रारूप

सत्र फाइलें JSONL हैं: प्रति पंक्ति एक JSON ऑब्जेक्ट।

- पंक्ति 1 हमेशा सत्र हेडर (`type: "session"`) होती है।
- शेष पंक्तियाँ `SessionEntry` मान होती हैं।
- प्रविष्टियाँ रनटाइम पर केवल-जोड़ें (append-only) होती हैं; शाखा नेविगेशन मौजूदा प्रविष्टियों को बदलने के बजाय एक पॉइंटर (`leafId`) को स्थानांतरित करता है।

### हेडर (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

नोट्स:

- v1 फाइलों में `version` वैकल्पिक है; अनुपस्थिति का अर्थ v1 है।
- `parentSession` एक अपारदर्शी वंशावली स्ट्रिंग है। वर्तमान कोड प्रवाह (`fork`, `forkFrom`, `createBranchedSession`, या स्पष्ट `newSession({ parentSession })`) के आधार पर या तो सत्र id या सत्र पथ लिखता है। इसे मेटाडेटा के रूप में मानें, टाइप्ड फॉरेन की के रूप में नहीं।

### प्रविष्टि आधार (`SessionEntryBase`)

सभी गैर-हेडर प्रविष्टियों में शामिल है:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` मूल प्रविष्टि (पहला जोड़, या `resetLeaf()` के बाद) के लिए `null` हो सकता है।

## प्रविष्टि वर्गीकरण

`SessionEntry` निम्नलिखित का यूनियन है:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

सीधे एक `AgentMessage` संग्रहित करता है।

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` वैकल्पिक है; अनुपस्थित होने पर कॉन्टेक्स्ट पुनर्निर्माण में `default` के रूप में माना जाता है।

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

यदि मूल (root) से शाखा बनाई जा रही है (`branchFromId === null`), तो `fromId` शाब्दिक स्ट्रिंग `"root"` होता है।

### `custom`

एक्सटेंशन स्थिति स्थायित्व; `buildSessionContext` द्वारा अनदेखा किया जाता है।

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

एक्सटेंशन-प्रदत्त संदेश जो LLM कॉन्टेक्स्ट में भाग लेता है।

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` `targetId` के लिए लेबल को साफ करता है।

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## संस्करणीकरण और माइग्रेशन

वर्तमान सत्र संस्करण: `3`।

### v1 -> v2

तब लागू होता है जब हेडर `version` अनुपस्थित हो या `< 2`:

- प्रत्येक गैर-हेडर प्रविष्टि में `id` और `parentId` जोड़ता है।
- फाइल क्रम का उपयोग करके एक रैखिक पैरेंट चेन पुनर्निर्मित करता है।
- उपस्थित होने पर कंपैक्शन फील्ड `firstKeptEntryIndex` -> `firstKeptEntryId` माइग्रेट करता है।
- हेडर `version = 2` सेट करता है।

### v2 -> v3

तब लागू होता है जब हेडर `version < 3`:

- `message` प्रविष्टियों के लिए: लीगेसी `message.role === "hookMessage"` को `"custom"` में फिर से लिखता है।
- हेडर `version = 3` सेट करता है।

### माइग्रेशन ट्रिगर और स्थायित्व

- माइग्रेशन सत्र लोड (`setSessionFile`) के दौरान चलते हैं।
- यदि कोई माइग्रेशन चला, तो पूरी फाइल तुरंत डिस्क पर फिर से लिखी जाती है।
- माइग्रेशन पहले इन-मेमोरी प्रविष्टियों को बदलता है, फिर पुनर्लिखित JSONL को स्थायी करता है।

## लोड और संगतता व्यवहार

`loadEntriesFromFile(path)` व्यवहार:

- अनुपस्थित फाइल (`ENOENT`) -> `[]` लौटाता है।
- गैर-पार्स करने योग्य पंक्तियों को उदार JSONL पार्सर (`parseJsonlLenient`) द्वारा संभाला जाता है।
- यदि पहली पार्स की गई प्रविष्टि एक वैध सत्र हेडर नहीं है (`type !== "session"` या स्ट्रिंग `id` अनुपस्थित) -> `[]` लौटाता है।

`SessionManager.setSessionFile()` व्यवहार:

- लोडर से `[]` को खाली/अस्तित्वहीन सत्र माना जाता है और उस पथ पर एक नई आरंभिकृत सत्र फाइल से बदल दिया जाता है।
- वैध फाइलें लोड की जाती हैं, आवश्यकता होने पर माइग्रेट की जाती हैं, ब्लॉब रेफ हल किए जाते हैं, फिर अनुक्रमित किए जाते हैं।

## ट्री और लीफ सेमैंटिक्स

अंतर्निहित मॉडल केवल-जोड़ें ट्री + परिवर्तनशील लीफ पॉइंटर है:

- प्रत्येक एपेंड विधि ठीक एक नई प्रविष्टि बनाती है जिसका `parentId` वर्तमान `leafId` होता है।
- नई प्रविष्टि नया `leafId` बन जाती है।
- `branch(entryId)` केवल `leafId` को स्थानांतरित करता है; मौजूदा प्रविष्टियाँ अपरिवर्तित रहती हैं।
- `resetLeaf()` `leafId = null` सेट करता है; अगला एपेंड एक नई मूल प्रविष्टि (`parentId: null`) बनाता है।
- `branchWithSummary()` लीफ को शाखा लक्ष्य पर सेट करता है और एक `branch_summary` प्रविष्टि जोड़ता है।

`getEntries()` सभी गैर-हेडर प्रविष्टियों को सम्मिलन क्रम में लौटाता है। सामान्य संचालन में मौजूदा प्रविष्टियाँ हटाई नहीं जाती; पुनर्लेखन प्रतिनिधित्व को अपडेट करते हुए तार्किक इतिहास को संरक्षित करते हैं (माइग्रेशन, मूव, लक्षित पुनर्लेखन सहायक)।

## कॉन्टेक्स्ट पुनर्निर्माण (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` यह निर्धारित करता है कि मॉडल को क्या भेजा जाता है।

एल्गोरिथम:

1. लीफ निर्धारित करें:
   - `leafId === null` -> खाली कॉन्टेक्स्ट लौटाएं।
   - स्पष्ट `leafId` -> यदि मिले तो उस प्रविष्टि का उपयोग करें।
   - अन्यथा अंतिम प्रविष्टि पर फॉलबैक।
2. लीफ से मूल तक `parentId` चेन पर चलें और मूल->लीफ पथ के लिए उलट दें।
3. पथ भर में रनटाइम स्थिति व्युत्पन्न करें:
   - नवीनतम `thinking_level_change` से `thinkingLevel` (डिफ़ॉल्ट `"off"`)
   - `model_change` प्रविष्टियों से मॉडल मैप (`role ?? "default"`)
   - यदि कोई स्पष्ट मॉडल परिवर्तन नहीं है तो सहायक संदेश provider/model से फॉलबैक `models.default`
   - सभी `ttsr_injection` प्रविष्टियों से डी-डुप्लिकेट किए गए `injectedTtsrRules`
   - नवीनतम `mode_change` से mode/modeData (डिफ़ॉल्ट मोड `"none"`)
4. संदेश सूची बनाएं:
   - `message` प्रविष्टियाँ सीधे पास होती हैं
   - `custom_message` प्रविष्टियाँ `createCustomMessage` के माध्यम से `custom` AgentMessages बनती हैं
   - `branch_summary` प्रविष्टियाँ `createBranchSummaryMessage` के माध्यम से `branchSummary` AgentMessages बनती हैं
   - यदि पथ पर कोई `compaction` मौजूद है:
     - पहले कंपैक्शन सारांश उत्सर्जित करें (`createCompactionSummaryMessage`)
     - `firstKeptEntryId` से कंपैक्शन सीमा तक पथ प्रविष्टियाँ उत्सर्जित करें
     - कंपैक्शन सीमा के बाद की प्रविष्टियाँ उत्सर्जित करें

`custom` और `session_init` प्रविष्टियाँ सीधे मॉडल कॉन्टेक्स्ट में इंजेक्ट नहीं करती हैं।

## स्थायित्व गारंटी और विफलता मॉडल

### स्थायी बनाम इन-मेमोरी

- `SessionManager.create/open/continueRecent/forkFrom` -> स्थायी मोड (`persist = true`)।
- `SessionManager.inMemory` -> गैर-स्थायी मोड (`persist = false`) `MemorySessionStorage` के साथ।

### लेखन पाइपलाइन

लेखन एक आंतरिक प्रॉमिस चेन (`#persistChain`) और `NdjsonFileWriter` के माध्यम से क्रमबद्ध होते हैं।

- `append*` तुरंत इन-मेमोरी स्थिति अपडेट करता है।
- स्थायित्व तब तक स्थगित रहता है जब तक कम से कम एक सहायक संदेश मौजूद न हो।
  - पहले सहायक से पहले: प्रविष्टियाँ मेमोरी में बनी रहती हैं; कोई फाइल एपेंड नहीं होता।
  - जब पहला सहायक मौजूद हो: पूरा इन-मेमोरी सत्र फाइल में फ्लश किया जाता है।
  - उसके बाद: नई प्रविष्टियाँ वृद्धिशील रूप से जोड़ी जाती हैं।

कोड में तर्क: उन सत्रों को स्थायी करने से बचें जिन्होंने कभी सहायक प्रतिक्रिया उत्पन्न नहीं की।

### टिकाऊपन संचालन

- `flush()` राइटर को फ्लश करता है और `fsync()` कॉल करता है।
- परमाणु पूर्ण पुनर्लेखन (`#rewriteFile`) अस्थायी फाइल में लिखता है, flush+fsync करता है, बंद करता है, फिर लक्ष्य पर नाम बदलता है।
- माइग्रेशन, `setSessionName`, `rewriteEntries`, मूव संचालन, और टूल-कॉल arg पुनर्लेखन के लिए उपयोग किया जाता है।

### त्रुटि व्यवहार

- स्थायित्व त्रुटियाँ लैच की जाती हैं (`#persistError`) और बाद के संचालन पर पुनः फेंकी जाती हैं।
- पहली त्रुटि सत्र फाइल संदर्भ के साथ एक बार लॉग की जाती है।
- राइटर बंद करना सर्वश्रेष्ठ-प्रयास है लेकिन पहली सार्थक त्रुटि को प्रसारित करता है।

## डेटा आकार नियंत्रण और ब्लॉब बाह्यकरण

प्रविष्टियों को स्थायी करने से पहले:

- बड़ी स्ट्रिंग्स `MAX_PERSIST_CHARS` (500,000 वर्ण) तक सूचना सहित ट्रंकेट की जाती हैं:
  - `"[Session persistence truncated large content]"`
- क्षणिक फील्ड `partialJson` और `jsonlEvents` हटा दिए जाते हैं।
- यदि ऑब्जेक्ट में `content` और `lineCount` दोनों हैं, तो ट्रंकेशन के बाद लाइन काउंट पुनर्गणना की जाती है।
- `content` ऐरे में base64 लंबाई >= 1024 वाले इमेज ब्लॉक्स को ब्लॉब रेफ में बाह्यकृत किया जाता है:
  - `blob:sha256:<hash>` के रूप में संग्रहित
  - कच्चे बाइट्स ब्लॉब स्टोर (`BlobStore.put`) में लिखे जाते हैं

लोड पर, message/custom_message इमेज ब्लॉक्स के लिए ब्लॉब रेफ को वापस base64 में हल किया जाता है।

## संग्रहण अमूर्तन

`SessionStorage` इंटरफेस `SessionManager` द्वारा उपयोग किए जाने वाले सभी फाइलसिस्टम संचालन प्रदान करता है:

- sync: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- async: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

कार्यान्वयन:

- `FileSessionStorage`: वास्तविक फाइलसिस्टम (Bun + node fs)
- `MemorySessionStorage`: परीक्षणों/गैर-स्थायी सत्रों के लिए मैप-समर्थित इन-मेमोरी कार्यान्वयन

`SessionStorageWriter` `writeLine`, `flush`, `fsync`, `close`, `getError` प्रकट करता है।

## सत्र खोज उपयोगिताएं

`session-manager.ts` में परिभाषित:

- `getRecentSessions(sessionDir, limit)` -> UI/सत्र चयनकर्ता के लिए हल्का मेटाडेटा
- `findMostRecentSession(sessionDir)` -> mtime के अनुसार नवीनतम
- `list(cwd, sessionDir?)` -> एक प्रोजेक्ट स्कोप में सत्र
- `listAll()` -> `~/.xcsh/agent/sessions` के अंतर्गत सभी प्रोजेक्ट स्कोप में सत्र

मेटाडेटा निष्कर्षण जहाँ संभव हो केवल एक उपसर्ग (`readTextPrefix(..., 4096)`) पढ़ता है।

## संबंधित लेकिन भिन्न: प्रॉम्प्ट इतिहास संग्रहण

`HistoryStorage` (`history-storage.ts`) प्रॉम्प्ट स्मरण/खोज के लिए एक अलग SQLite उपप्रणाली है, सत्र रीप्ले के लिए नहीं।

- DB: `~/.xcsh/agent/history.db`
- टेबल: `history(id, prompt, created_at, cwd)`
- FTS5 इंडेक्स: ट्रिगर-अनुरक्षित सिंक के साथ `history_fts`
- इन-मेमोरी अंतिम-प्रॉम्प्ट कैश का उपयोग करके क्रमागत समान प्रॉम्प्ट्स को डी-डुप्लिकेट करता है
- एसिंक्रोनस सम्मिलन (`setImmediate`) ताकि प्रॉम्प्ट कैप्चर टर्न निष्पादन को अवरुद्ध न करे

वार्तालाप ग्राफ/स्थिति रीप्ले के लिए सत्र फाइलों का उपयोग करें; प्रॉम्प्ट इतिहास UX के लिए `HistoryStorage` का उपयोग करें।
