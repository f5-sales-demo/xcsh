---
title: MCP सर्वर और टूल ऑथरिंग
description: कोडिंग एजेंट के लिए कस्टम MCP सर्वर बनाने और टूल रजिस्टर करने की गाइड।
sidebar:
  order: 4
  label: सर्वर और टूल ऑथरिंग
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCP सर्वर और टूल ऑथरिंग

यह दस्तावेज़ बताता है कि MCP सर्वर परिभाषाएँ कैसे coding-agent में कॉल करने योग्य `mcp_*` टूल बनती हैं, और जब कॉन्फ़िग अमान्य, डुप्लिकेट, अक्षम, या auth-गेटेड हों तो ऑपरेटर्स को क्या अपेक्षा करनी चाहिए।

## आर्किटेक्चर का संक्षिप्त अवलोकन

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

- `stdio` (जब `type` अनुपस्थित हो तो डिफ़ॉल्ट): `command` आवश्यक, वैकल्पिक `args`, `env`, `cwd`
- `http`: `url` आवश्यक, वैकल्पिक `headers`
- `sse`: `url` आवश्यक, वैकल्पिक `headers` (संगतता के लिए रखा गया)
- साझा फ़ील्ड: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) ट्रांसपोर्ट बेसिक्स लागू करता है:

- उन कॉन्फ़िग को अस्वीकार करता है जो `command` और `url` दोनों सेट करते हैं
- stdio के लिए `command` आवश्यक है
- http/sse के लिए `url` आवश्यक है
- अज्ञात `type` को अस्वीकार करता है

`config-writer.ts` add/update ऑपरेशंस के लिए यह सत्यापन लागू करता है और सर्वर नामों को भी मान्य करता है:

- गैर-रिक्त
- अधिकतम 100 अक्षर
- केवल `[a-zA-Z0-9_.-]`

### ट्रांसपोर्ट संबंधी समस्याएँ

- `type` छोड़ने का अर्थ है stdio। यदि आपका इरादा HTTP/SSE था लेकिन `type` छोड़ दिया, तो `command` अनिवार्य हो जाता है।
- `sse` अभी भी स्वीकार किया जाता है लेकिन आंतरिक रूप से HTTP ट्रांसपोर्ट (`createHttpTransport`) के रूप में व्यवहार किया जाता है।
- सत्यापन संरचनात्मक है, पहुँच योग्यता-आधारित नहीं: एक वाक्यात्मक रूप से मान्य URL भी कनेक्ट समय पर विफल हो सकता है।

## 2) डिस्कवरी, नॉर्मलाइज़ेशन, और प्राथमिकता

### क्षमता-आधारित डिस्कवरी

`loadAllMCPConfigs()` (`src/mcp/config.ts`) `loadCapability(mcpCapability.id)` के माध्यम से कैनोनिकल `MCPServer` आइटम लोड करता है।

क्षमता परत (`src/capability/index.ts`) तब:

1. प्राथमिकता क्रम में प्रोवाइडर्स लोड करती है
2. `server.name` द्वारा डीडुप करती है (पहली जीत = सर्वोच्च प्राथमिकता)
3. डीडुप किए गए आइटम को मान्य करती है

परिणाम: विभिन्न स्रोतों में डुप्लिकेट सर्वर नाम मर्ज नहीं किए जाते। एक परिभाषा जीतती है; निम्न-प्राथमिकता वाले डुप्लिकेट शैडो हो जाते हैं।

### `.mcp.json` और संबंधित फ़ाइलें

`src/discovery/mcp-json.ts` में समर्पित फ़ॉलबैक प्रोवाइडर प्रोजेक्ट-रूट `mcp.json` और `.mcp.json` (निम्न प्राथमिकता) पढ़ता है।

व्यवहार में MCP सर्वर उच्च-प्राथमिकता प्रोवाइडर्स (उदाहरण के लिए नेटिव `.xcsh/...` और टूल-विशिष्ट कॉन्फ़िग डायरेक्टरीज) से भी आते हैं। ऑथरिंग मार्गदर्शन:

- स्पष्ट नियंत्रण के लिए `.xcsh/mcp.json` (प्रोजेक्ट) या `~/.xcsh/mcp.json` (उपयोगकर्ता) को प्राथमिकता दें।
- जब आपको फ़ॉलबैक संगतता चाहिए तो रूट `mcp.json` / `.mcp.json` का उपयोग करें।
- एकाधिक स्रोतों में एक ही सर्वर नाम का पुन: उपयोग प्राथमिकता शैडोइंग का कारण बनता है, मर्ज नहीं।

### नॉर्मलाइज़ेशन व्यवहार

`convertToLegacyConfig()` (`src/mcp/config.ts`) कैनोनिकल `MCPServer` को रनटाइम `MCPServerConfig` में मैप करता है।

मुख्य व्यवहार:

- ट्रांसपोर्ट इस प्रकार अनुमानित: `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- अक्षम सर्वर (`enabled === false`) कनेक्शन से पहले हटा दिए जाते हैं
- वैकल्पिक फ़ील्ड उपस्थित होने पर संरक्षित रहते हैं

### डिस्कवरी के दौरान एनवायरनमेंट विस्तार

`mcp-json.ts` स्ट्रिंग फ़ील्ड में env प्लेसहोल्डर्स को `expandEnvVarsDeep()` के साथ विस्तारित करता है:

- `${VAR}` और `${VAR:-default}` का समर्थन करता है
- अनसुलझे मान शाब्दिक `${VAR}` स्ट्रिंग बने रहते हैं

`mcp-json.ts` उपयोगकर्ता JSON के लिए रनटाइम टाइप चेक भी करता है और पूरी फ़ाइल को विफल करने के बजाय अमान्य `enabled`/`timeout` मानों के लिए चेतावनियाँ लॉग करता है।

## 3) Auth और रनटाइम मान रिज़ॉल्यूशन

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) अंतिम प्री-कनेक्ट पास है।

### OAuth क्रेडेंशियल इंजेक्शन

यदि कॉन्फ़िग में है:

```ts
auth: { type: "oauth", credentialId: "..." }
```

और क्रेडेंशियल auth स्टोरेज में मौजूद है:

- `http`/`sse`: `Authorization: Bearer <access_token>` हेडर इंजेक्ट करता है
- `stdio`: `OAUTH_ACCESS_TOKEN` env वेरिएबल इंजेक्ट करता है

यदि क्रेडेंशियल लुकअप विफल होता है, तो मैनेजर एक चेतावनी लॉग करता है और अनसुलझे auth के साथ जारी रहता है।

### हेडर/env मान रिज़ॉल्यूशन

कनेक्ट करने से पहले, मैनेजर `resolveConfigValue()` (`src/config/resolve-config-value.ts`) के माध्यम से प्रत्येक हेडर/env मान को रिज़ॉल्व करता है:

- `!` से शुरू होने वाला मान => शेल कमांड निष्पादित करें, ट्रिम किया हुआ stdout उपयोग करें (कैश्ड)
- अन्यथा, मान को पहले एनवायरनमेंट वेरिएबल नाम (`process.env[name]`) के रूप में मानें, शाब्दिक मान पर फ़ॉलबैक
- अनसुलझे कमांड/env मान अंतिम headers/env मैप से हटा दिए जाते हैं

संचालन संबंधी चेतावनी: इसका अर्थ है कि गलत टाइप किया गया सीक्रेट कमांड/env कुंजी चुपचाप उस हेडर/env प्रविष्टि को हटा सकती है, जिससे डाउनस्ट्रीम 401/403 या सर्वर स्टार्टअप विफलताएँ हो सकती हैं।

## 4) टूल ब्रिज: MCP -> एजेंट-कॉल करने योग्य टूल

`src/mcp/tool-bridge.ts` MCP टूल परिभाषाओं को `CustomTool` में परिवर्तित करता है।

### नामकरण और टकराव डोमेन

टूल नाम इस प्रकार जेनरेट किए जाते हैं:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

नियम:

- लोअरकेस में परिवर्तित
- गैर-`[a-z_]` अक्षर `_` बन जाते हैं
- दोहराए गए अंडरस्कोर संक्षिप्त हो जाते हैं
- टूल नाम में अनावश्यक `<server>_` उपसर्ग एक बार हटा दिया जाता है

यह कई टकरावों से बचाता है, लेकिन सभी से नहीं। विभिन्न कच्चे नाम अभी भी एक ही पहचानकर्ता में सैनिटाइज़ हो सकते हैं (उदाहरण के लिए `my-server` और `my.server` दोनों समान रूप से सैनिटाइज़ होते हैं), और रजिस्ट्री प्रविष्टि last-write-wins है।

### स्कीमा मैपिंग

`convertSchema()` MCP JSON Schema को मोटे तौर पर यथावत रखता है लेकिन प्रोवाइडर संगतता के लिए `properties` गुम ऑब्जेक्ट स्कीमा को `{}` से पैच करता है।

### निष्पादन मैपिंग

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- MCP `tools/call` कॉल करता है
- MCP सामग्री को प्रदर्शन योग्य टेक्स्ट में समतल करता है
- संरचित विवरण लौटाता है (`serverName`, `mcpToolName`, प्रोवाइडर मेटाडेटा)
- सर्वर-रिपोर्टेड `isError` को `Error: ...` टेक्स्ट परिणाम में मैप करता है
- फेंकी गई ट्रांसपोर्ट/रनटाइम विफलताओं को `MCP error: ...` में मैप करता है
- AbortError को `ToolAbortError` में अनुवादित करके abort सेमेंटिक्स संरक्षित करता है

## 5) ऑपरेटर जीवनचक्र: add/edit/remove और लाइव अपडेट

इंटरैक्टिव मोड `src/modes/controllers/mcp-command-controller.ts` में `/mcp` को उजागर करता है।

समर्थित ऑपरेशन:

- `add` (विज़ार्ड या त्वरित-जोड़)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

कॉन्फ़िग लेखन एटॉमिक है (`writeMCPConfigFile`: temp file + rename)।

परिवर्तनों के बाद, कंट्रोलर `#reloadMCP()` कॉल करता है:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` सभी `mcp_` रजिस्ट्री प्रविष्टियों को बदलता है और नवीनतम MCP टूल सेट को तुरंत पुनः सक्रिय करता है, इसलिए परिवर्तन सत्र पुनः आरंभ किए बिना प्रभावी होते हैं।

### मोड अंतर

- **इंटरैक्टिव/TUI मोड**: `/mcp` इन-ऐप UX प्रदान करता है (विज़ार्ड, OAuth फ़्लो, कनेक्शन स्थिति टेक्स्ट, तत्काल रनटाइम रीबाइंडिंग)।
- **SDK/हेडलेस एकीकरण**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) लोड किए गए टूल + प्रति-सर्वर त्रुटियाँ लौटाता है; कोई `/mcp` कमांड UX नहीं।

## 6) उपयोगकर्ता-दृश्य त्रुटि सतहें

सामान्य त्रुटि स्ट्रिंग जो उपयोगकर्ता/ऑपरेटर देखते हैं:

- add/update सत्यापन विफलताएँ:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- त्वरित-जोड़ आर्गुमेंट समस्याएँ:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- कनेक्ट/परीक्षण विफलताएँ:
  - `Failed to connect to "<name>": <message>`
  - timeout सहायता टेक्स्ट timeout बढ़ाने का सुझाव देता है
  - `401/403` के लिए auth सहायता टेक्स्ट
- auth/OAuth फ़्लो:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- अक्षम सर्वर उपयोग:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

डिस्कवरी में खराब स्रोत JSON को सामान्यतः चेतावनियों/लॉग के रूप में संभाला जाता है; config-writer पथ स्पष्ट त्रुटियाँ फेंकते हैं।

## 7) व्यावहारिक ऑथरिंग मार्गदर्शन

इस कोडबेस में मजबूत MCP ऑथरिंग के लिए:

1. सभी MCP-सक्षम कॉन्फ़िग स्रोतों में सर्वर नाम वैश्विक रूप से अद्वितीय रखें।
2. जेनरेट किए गए `mcp_*` टूल नामों में सैनिटाइज़्ड-नाम टकरावों से बचने के लिए अल्फ़ान्यूमेरिक/अंडरस्कोर नामों को प्राथमिकता दें।
3. आकस्मिक stdio डिफ़ॉल्ट से बचने के लिए स्पष्ट `type` का उपयोग करें।
4. `enabled: false` को हार्ड-ऑफ़ मानें: सर्वर रनटाइम कनेक्ट सेट से हटा दिया जाता है।
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
