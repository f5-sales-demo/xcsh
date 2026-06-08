---
title: MCP सर्वर और टूल ऑथरिंग
description: कोडिंग एजेंट के लिए कस्टम MCP सर्वर बनाने और टूल्स पंजीकृत करने की गाइड।
sidebar:
  order: 4
  label: सर्वर और टूल ऑथरिंग
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCP सर्वर और टूल ऑथरिंग

यह दस्तावेज़ बताता है कि MCP सर्वर परिभाषाएँ कैसे coding-agent में कॉल करने योग्य `mcp_*` टूल्स बनती हैं, और जब कॉन्फ़िग अमान्य, डुप्लिकेट, अक्षम, या auth-gated होते हैं तो ऑपरेटर्स को क्या अपेक्षा रखनी चाहिए।

## संक्षिप्त आर्किटेक्चर

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) सर्वर कॉन्फ़िग मॉडल और सत्यापन

`src/mcp/types.ts` MCP कॉन्फ़िग लेखकों और रनटाइम द्वारा उपयोग की जाने वाली ऑथरिंग शेप को परिभाषित करता है:

- `stdio` (डिफ़ॉल्ट जब `type` अनुपस्थित हो): `command` आवश्यक है, `args`, `env`, `cwd` वैकल्पिक हैं
- `http`: `url` आवश्यक है, `headers` वैकल्पिक है
- `sse`: `url` आवश्यक है, `headers` वैकल्पिक है (संगतता के लिए रखा गया)
- साझा फ़ील्ड: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) ट्रांसपोर्ट मूल बातों को लागू करता है:

- उन कॉन्फ़िग को अस्वीकार करता है जो `command` और `url` दोनों सेट करते हैं
- stdio के लिए `command` आवश्यक है
- http/sse के लिए `url` आवश्यक है
- अज्ञात `type` को अस्वीकार करता है

`config-writer.ts` add/update ऑपरेशन के लिए यह सत्यापन लागू करता है और सर्वर नामों को भी मान्य करता है:

- गैर-रिक्त
- अधिकतम 100 अक्षर
- केवल `[a-zA-Z0-9_.-]`

### ट्रांसपोर्ट संबंधी समस्याएँ

- `type` छोड़ने का अर्थ stdio है। यदि आपका इरादा HTTP/SSE था लेकिन `type` छोड़ दिया, तो `command` अनिवार्य हो जाता है।
- `sse` अभी भी स्वीकार किया जाता है लेकिन आंतरिक रूप से HTTP ट्रांसपोर्ट (`createHttpTransport`) के रूप में व्यवहार किया जाता है।
- सत्यापन संरचनात्मक है, पहुँच-योग्यता नहीं: एक वाक्यात्मक रूप से मान्य URL अभी भी कनेक्ट समय पर विफल हो सकता है।

## 2) डिस्कवरी, सामान्यीकरण, और प्राथमिकता

### क्षमता-आधारित डिस्कवरी

`loadAllMCPConfigs()` (`src/mcp/config.ts`) `loadCapability(mcpCapability.id)` के माध्यम से कैनोनिकल `MCPServer` आइटम लोड करता है।

क्षमता परत (`src/capability/index.ts`) तब:

1. प्राथमिकता क्रम में प्रदाताओं को लोड करती है
2. `server.name` द्वारा डिडूप करती है (पहली जीत = सर्वोच्च प्राथमिकता)
3. डिडूप किए गए आइटम को मान्य करती है

परिणाम: स्रोतों में डुप्लिकेट सर्वर नाम मर्ज नहीं होते। एक परिभाषा जीतती है; कम-प्राथमिकता वाले डुप्लिकेट छाया में रह जाते हैं।

### `.mcp.json` और संबंधित फ़ाइलें

`src/discovery/mcp-json.ts` में समर्पित फ़ॉलबैक प्रदाता प्रोजेक्ट-रूट `mcp.json` और `.mcp.json` (कम प्राथमिकता) पढ़ता है।

व्यवहार में MCP सर्वर उच्च-प्राथमिकता प्रदाताओं (उदाहरण के लिए नेटिव `.xcsh/...` और टूल-विशिष्ट कॉन्फ़िग निर्देशिकाएँ) से भी आते हैं। ऑथरिंग मार्गदर्शन:

- स्पष्ट नियंत्रण के लिए `.xcsh/mcp.json` (प्रोजेक्ट) या `~/.xcsh/mcp.json` (उपयोगकर्ता) को प्राथमिकता दें।
- फ़ॉलबैक संगतता की आवश्यकता होने पर रूट `mcp.json` / `.mcp.json` का उपयोग करें।
- एक ही सर्वर नाम को कई स्रोतों में पुन: उपयोग करने से मर्ज नहीं, प्राथमिकता शैडोइंग होती है।

### सामान्यीकरण व्यवहार

`convertToLegacyConfig()` (`src/mcp/config.ts`) कैनोनिकल `MCPServer` को रनटाइम `MCPServerConfig` में मैप करता है।

मुख्य व्यवहार:

- ट्रांसपोर्ट `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")` के रूप में अनुमानित
- अक्षम सर्वर (`enabled === false`) कनेक्शन से पहले हटा दिए जाते हैं
- उपस्थित होने पर वैकल्पिक फ़ील्ड संरक्षित रहते हैं

### डिस्कवरी के दौरान एनवायरनमेंट विस्तार

`mcp-json.ts` `expandEnvVarsDeep()` के साथ स्ट्रिंग फ़ील्ड में env प्लेसहोल्डर्स का विस्तार करता है:

- `${VAR}` और `${VAR:-default}` का समर्थन करता है
- अनसुलझे मान शाब्दिक `${VAR}` स्ट्रिंग्स बने रहते हैं

`mcp-json.ts` उपयोगकर्ता JSON के लिए रनटाइम टाइप जाँच भी करता है और पूरी फ़ाइल को विफल करने के बजाय अमान्य `enabled`/`timeout` मानों के लिए चेतावनी लॉग करता है।

## 3) Auth और रनटाइम मान समाधान

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) अंतिम प्री-कनेक्ट पास है।

### OAuth क्रेडेंशियल इंजेक्शन

यदि कॉन्फ़िग में:

```ts
auth: { type: "oauth", credentialId: "..." }
```

और auth स्टोरेज में क्रेडेंशियल मौजूद है:

- `http`/`sse`: `Authorization: Bearer <access_token>` हेडर इंजेक्ट करता है
- `stdio`: `OAUTH_ACCESS_TOKEN` env वेरिएबल इंजेक्ट करता है

यदि क्रेडेंशियल लुकअप विफल होता है, तो मैनेजर एक चेतावनी लॉग करता है और अनसुलझे auth के साथ जारी रहता है।

### हेडर/env मान समाधान

कनेक्ट से पहले, मैनेजर `resolveConfigValue()` (`src/config/resolve-config-value.ts`) के माध्यम से प्रत्येक हेडर/env मान को रिज़ॉल्व करता है:

- `!` से शुरू होने वाला मान => शेल कमांड निष्पादित करें, ट्रिम किए गए stdout का उपयोग करें (कैश्ड)
- अन्यथा, पहले मान को एनवायरनमेंट वेरिएबल नाम के रूप में मानें (`process.env[name]`), शाब्दिक मान पर फ़ॉलबैक
- अनसुलझे कमांड/env मान अंतिम हेडर/env मैप से हटा दिए जाते हैं

परिचालन चेतावनी: इसका अर्थ है कि गलत टाइप की गई सीक्रेट कमांड/env कुंजी चुपचाप उस हेडर/env प्रविष्टि को हटा सकती है, जिससे डाउनस्ट्रीम 401/403 या सर्वर स्टार्टअप विफलताएँ हो सकती हैं।

## 4) टूल ब्रिज: MCP -> एजेंट-कॉल करने योग्य टूल्स

`src/mcp/tool-bridge.ts` MCP टूल परिभाषाओं को `CustomTool`s में रूपांतरित करता है।

### नामकरण और टकराव डोमेन

टूल नाम इस प्रकार उत्पन्न होते हैं:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

नियम:

- लोअरकेस में बदलता है
- गैर-`[a-z_]` अक्षर `_` बन जाते हैं
- बार-बार आने वाले अंडरस्कोर संकुचित होते हैं
- टूल नाम में अनावश्यक `<server>_` उपसर्ग एक बार हटा दिया जाता है

यह कई टकरावों से बचाता है, लेकिन सभी से नहीं। विभिन्न कच्चे नाम अभी भी एक ही पहचानकर्ता में सैनिटाइज़ हो सकते हैं (उदाहरण के लिए `my-server` और `my.server` दोनों समान रूप से सैनिटाइज़ होते हैं), और रजिस्ट्री प्रविष्टि अंतिम-लिखा-जीता के आधार पर होती है।

### स्कीमा मैपिंग

`convertSchema()` MCP JSON Schema को अधिकतर यथावत रखता है लेकिन प्रदाता संगतता के लिए `properties` अनुपस्थित ऑब्जेक्ट स्कीमा को `{}` से पैच करता है।

### निष्पादन मैपिंग

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- MCP `tools/call` कॉल करता है
- MCP कंटेंट को प्रदर्शन योग्य टेक्स्ट में फ़्लैटन करता है
- संरचित विवरण लौटाता है (`serverName`, `mcpToolName`, प्रदाता मेटाडेटा)
- सर्वर-रिपोर्टेड `isError` को `Error: ...` टेक्स्ट परिणाम में मैप करता है
- थ्रोन ट्रांसपोर्ट/रनटाइम विफलताओं को `MCP error: ...` में मैप करता है
- AbortError को `ToolAbortError` में अनुवादित करके abort सिमेंटिक्स को संरक्षित करता है

## 5) ऑपरेटर जीवनचक्र: जोड़ें/संपादित करें/हटाएँ और लाइव अपडेट

इंटरैक्टिव मोड `src/modes/controllers/mcp-command-controller.ts` में `/mcp` प्रदान करता है।

समर्थित ऑपरेशन:

- `add` (विज़ार्ड या क्विक-ऐड)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

कॉन्फ़िग लेखन एटॉमिक है (`writeMCPConfigFile`: अस्थायी फ़ाइल + नाम बदलें)।

परिवर्तनों के बाद, कंट्रोलर `#reloadMCP()` कॉल करता है:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` सभी `mcp_` रजिस्ट्री प्रविष्टियों को बदलता है और तुरंत नवीनतम MCP टूल सेट को पुनः सक्रिय करता है, इसलिए परिवर्तन सत्र को पुनरारंभ किए बिना प्रभावी होते हैं।

### मोड अंतर

- **इंटरैक्टिव/TUI मोड**: `/mcp` इन-ऐप UX देता है (विज़ार्ड, OAuth प्रवाह, कनेक्शन स्थिति टेक्स्ट, तत्काल रनटाइम रीबाइंडिंग)।
- **SDK/हेडलेस इंटीग्रेशन**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) लोड किए गए टूल्स + प्रति-सर्वर त्रुटियाँ लौटाता है; कोई `/mcp` कमांड UX नहीं।

## 6) उपयोगकर्ता-दृश्यमान त्रुटि सतहें

सामान्य त्रुटि स्ट्रिंग्स जो उपयोगकर्ता/ऑपरेटर देखते हैं:

- add/update सत्यापन विफलताएँ:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- क्विक-ऐड तर्क समस्याएँ:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- कनेक्ट/टेस्ट विफलताएँ:
  - `Failed to connect to "<name>": <message>`
  - टाइमआउट सहायता टेक्स्ट टाइमआउट बढ़ाने का सुझाव देता है
  - `401/403` के लिए auth सहायता टेक्स्ट
- auth/OAuth प्रवाह:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- अक्षम सर्वर उपयोग:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

डिस्कवरी में खराब स्रोत JSON को आम तौर पर चेतावनियों/लॉग के रूप में संभाला जाता है; config-writer पथ स्पष्ट त्रुटियाँ फेंकते हैं।

## 7) व्यावहारिक ऑथरिंग मार्गदर्शन

इस कोडबेस में मजबूत MCP ऑथरिंग के लिए:

1. सभी MCP-सक्षम कॉन्फ़िग स्रोतों में सर्वर नाम विश्व स्तर पर अद्वितीय रखें।
2. उत्पन्न `mcp_*` टूल नामों में सैनिटाइज़्ड-नाम टकराव से बचने के लिए अल्फ़ान्यूमेरिक/अंडरस्कोर नाम पसंद करें।
3. आकस्मिक stdio डिफ़ॉल्ट से बचने के लिए स्पष्ट `type` का उपयोग करें।
4. `enabled: false` को हार्ड-ऑफ़ मानें: सर्वर रनटाइम कनेक्ट सेट से बाहर हो जाता है।
5. OAuth कॉन्फ़िग के लिए, एक मान्य `credentialId` स्टोर करें; अन्यथा auth इंजेक्शन छोड़ दिया जाता है।
6. यदि कमांड-आधारित सीक्रेट रिज़ॉल्यूशन (`!cmd`) का उपयोग कर रहे हैं, तो सत्यापित करें कि कमांड आउटपुट स्थिर और गैर-रिक्त है।

## कार्यान्वयन फ़ाइलें

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
