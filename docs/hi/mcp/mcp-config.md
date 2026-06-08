---
title: MCP कॉन्फ़िगरेशन
description: 'कोडिंग एजेंट रनटाइम के लिए MCP सर्वर कॉन्फ़िगरेशन, वैलिडेशन और प्रबंधन।'
sidebar:
  order: 1
  label: कॉन्फ़िगरेशन
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# OMP में MCP कॉन्फ़िगरेशन

यह गाइड बताती है कि OMP कोडिंग एजेंट के लिए MCP सर्वर कैसे जोड़ें, संपादित करें और वैलिडेट करें।

कोड में सत्य का स्रोत:

- रनटाइम कॉन्फ़िग टाइप्स: `packages/coding-agent/src/mcp/types.ts`
- कॉन्फ़िग राइटर: `packages/coding-agent/src/mcp/config-writer.ts`
- लोडर + वैलिडेशन: `packages/coding-agent/src/mcp/config.ts`
- स्टैंडअलोन `mcp.json` डिस्कवरी: `packages/coding-agent/src/discovery/mcp-json.ts`
- स्कीमा: `packages/coding-agent/src/config/mcp-schema.json`

## पसंदीदा कॉन्फ़िग स्थान

OMP कई टूल्स (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json`, और अधिक) से MCP सर्वर खोज सकता है, लेकिन OMP-नेटिव कॉन्फ़िगरेशन के लिए आपको आमतौर पर इनमें से किसी एक फ़ाइल का उपयोग करना चाहिए:

- प्रोजेक्ट: `.xcsh/mcp.json`
- उपयोगकर्ता: `~/.xcsh/mcp.json`

OMP प्रोजेक्ट रूट में फ़ॉलबैक स्टैंडअलोन फ़ाइलें भी स्वीकार करता है:

- `mcp.json`
- `.mcp.json`

`.xcsh/mcp.json` का उपयोग करें जब आप चाहते हैं कि OMP कॉन्फ़िगरेशन का स्वामी हो। रूट `mcp.json` / `.mcp.json` का उपयोग केवल तब करें जब आप एक पोर्टेबल फ़ॉलबैक फ़ाइल चाहते हैं जिसे अन्य MCP क्लाइंट भी पढ़ सकें।

## स्कीमा संदर्भ जोड़ें

एडिटर ऑटोकम्पलीट और वैलिडेशन के लिए फ़ाइल के शीर्ष पर यह लाइन जोड़ें:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP अब इसे स्वचालित रूप से लिखता है जब `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth`, या अन्य कॉन्फ़िग-लेखन फ़्लो OMP-प्रबंधित MCP फ़ाइल बनाते या अपडेट करते हैं।

## फ़ाइल संरचना

OMP इस शीर्ष-स्तरीय संरचना का समर्थन करता है:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

शीर्ष-स्तरीय कीज़:

- `$schema` — टूलिंग के लिए वैकल्पिक JSON स्कीमा URL
- `mcpServers` — सर्वर नाम से सर्वर कॉन्फ़िग का मैप
- `disabledServers` — उपयोगकर्ता-स्तरीय डिनाइलिस्ट जो नाम से खोजे गए सर्वरों को बंद करने के लिए उपयोग की जाती है

सर्वर नाम `^[a-zA-Z0-9_.-]{1,100}$` से मेल खाने चाहिए।

## समर्थित सर्वर फ़ील्ड

हर ट्रांसपोर्ट के लिए साझा फ़ील्ड:

- `enabled?: boolean` — `false` होने पर इस सर्वर को छोड़ दें
- `timeout?: number` — मिलीसेकंड में कनेक्शन टाइमआउट
- `auth?: { ... }` — OMP द्वारा OAuth/API-key फ़्लो के लिए उपयोग किया जाने वाला auth मेटाडेटा
- `oauth?: { ... }` — auth/reauth के दौरान उपयोग की जाने वाली स्पष्ट OAuth क्लाइंट सेटिंग्स

### `stdio` ट्रांसपोर्ट

जब `type` छोड़ दिया जाता है तो `stdio` डिफ़ॉल्ट होता है।

आवश्यक:

- `command: string`

वैकल्पिक:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

उदाहरण:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

यह आधिकारिक Filesystem MCP सर्वर पैकेज (`@modelcontextprotocol/server-filesystem`) का अनुसरण करता है।

### `http` ट्रांसपोर्ट

आवश्यक:

- `type: "http"`
- `url: string`

वैकल्पिक:

- `headers?: Record<string, string>`

उदाहरण:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

यह GitHub के होस्टेड GitHub MCP सर्वर एंडपॉइंट से मेल खाता है।

### `sse` ट्रांसपोर्ट

आवश्यक:

- `type: "sse"`
- `url: string`

वैकल्पिक:

- `headers?: Record<string, string>`

उदाहरण:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` अभी भी संगतता के लिए समर्थित है, लेकिन MCP स्पेक अब नए सर्वरों के लिए Streamable HTTP (`type: "http"`) को प्राथमिकता देता है।

## Auth फ़ील्ड

OMP दो auth-संबंधित ऑब्जेक्ट्स को समझता है।

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

इसका उपयोग तब करें जब OMP को यह याद रखना चाहिए कि किसी सर्वर के लिए क्रेडेंशियल्स कैसे रीहाइड्रेट करें।

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

इसका उपयोग तब करें जब MCP सर्वर को स्पष्ट OAuth क्लाइंट सेटिंग्स की आवश्यकता हो।

Slack वर्तमान में सबसे स्पष्ट उदाहरण है। Slack का MCP सर्वर `https://mcp.slack.com/mcp` पर होस्ट किया गया है, Streamable HTTP का उपयोग करता है, और आपके Slack ऐप के क्लाइंट क्रेडेंशियल्स के साथ कॉन्फिडेंशियल OAuth की आवश्यकता होती है।

उदाहरण:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

Slack के डॉक्स से प्रासंगिक Slack एंडपॉइंट्स:

- MCP एंडपॉइंट: `https://mcp.slack.com/mcp`
- ऑथराइज़ेशन एंडपॉइंट: `https://slack.com/oauth/v2_user/authorize`
- टोकन एंडपॉइंट: `https://slack.com/api/oauth.v2.user.access`

## सामान्य कॉपी-पेस्ट उदाहरण

### stdio के माध्यम से Filesystem सर्वर

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### HTTP के माध्यम से GitHub होस्टेड सर्वर

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Docker के माध्यम से GitHub लोकल सर्वर

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

यह GitHub की आधिकारिक लोकल Docker इमेज `ghcr.io/github/github-mcp-server` से मेल खाता है।

### OAuth के माध्यम से Slack होस्टेड सर्वर

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## सीक्रेट्स और वेरिएबल रिज़ॉल्यूशन

यह वह हिस्सा है जो आमतौर पर लोगों को भ्रमित करता है।

### `.xcsh/mcp.json` और `~/.xcsh/mcp.json` में

OMP सर्वर लॉन्च करने या HTTP रिक्वेस्ट करने से पहले, `env` और `headers` मानों को इस प्रकार रिज़ॉल्व करता है:

1. यदि कोई मान `!` से शुरू होता है, तो OMP इसे शेल कमांड के रूप में चलाता है और ट्रिम किए गए stdout का उपयोग करता है।
2. अन्यथा OMP पहले जाँचता है कि क्या मान किसी एनवायरनमेंट वेरिएबल नाम से मेल खाता है।
3. यदि वह एनवायरनमेंट वेरिएबल सेट नहीं है, तो OMP स्ट्रिंग को शाब्दिक रूप से उपयोग करता है।

उदाहरण:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

इसका मतलब है कि यह लोकल सीक्रेट्स के लिए वैध और सुविधाजनक है:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → वर्तमान शेल एनवायरनमेंट से कॉपी करें
- `"Authorization": "Bearer hardcoded-token"` → शाब्दिक मान का उपयोग करें
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → कमांड से हेडर बनाएं

### रूट `mcp.json` और `.mcp.json` में

स्टैंडअलोन फ़ॉलबैक लोडर डिस्कवरी के दौरान स्ट्रिंग्स के अंदर `${VAR}` और `${VAR:-default}` को भी विस्तारित करता है।

उदाहरण:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

यदि आप OMP का सबसे कम आश्चर्यजनक व्यवहार चाहते हैं, तो `.xcsh/mcp.json` को प्राथमिकता दें और स्पष्ट env/header मानों का उपयोग करें।

## `disabledServers`

`disabledServers` मुख्य रूप से उपयोगकर्ता कॉन्फ़िग फ़ाइल (`~/.xcsh/mcp.json`) में तब उपयोगी है जब किसी सर्वर को किसी अन्य स्रोत से खोजा जाता है और आप चाहते हैं कि OMP उस अन्य टूल के कॉन्फ़िग को संपादित किए बिना उसे अनदेखा करे।

उदाहरण:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` बनाम JSON को सीधे संपादित करना

जब आप गाइडेड सेटअप चाहते हैं तो `/mcp add` का उपयोग करें।

सीधे JSON संपादन का उपयोग करें जब:

- आपको ऐसे ट्रांसपोर्ट या auth विकल्प की आवश्यकता है जिसके लिए विज़ार्ड अभी तक प्रॉम्प्ट नहीं करता
- आप किसी अन्य MCP क्लाइंट से सर्वर डेफिनिशन पेस्ट करना चाहते हैं
- आप अपने एडिटर में स्कीमा-समर्थित वैलिडेशन चाहते हैं

संपादन के बाद, उपयोग करें:

- `/mcp reload` वर्तमान सत्र में सर्वरों को फिर से खोजने और पुनः कनेक्ट करने के लिए
- `/mcp list` यह देखने के लिए कि कोई सर्वर किस कॉन्फ़िग फ़ाइल से आया है
- `/mcp test <name>` किसी एकल सर्वर का परीक्षण करने के लिए

## OMP द्वारा लागू किए जाने वाले वैलिडेशन नियम

`packages/coding-agent/src/mcp/config.ts` में `validateServerConfig()` से:

- `stdio` के लिए `command` आवश्यक है
- `http` और `sse` के लिए `url` आवश्यक है
- एक सर्वर `command` और `url` दोनों सेट नहीं कर सकता
- अज्ञात `type` मान अस्वीकार किए जाते हैं

व्यावहारिक प्रभाव:

- `type` छोड़ने का अर्थ है `stdio`
- यदि आप रिमोट सर्वर कॉन्फ़िग पेस्ट करते हैं और `"type": "http"` भूल जाते हैं, तो OMP इसे `stdio` के रूप में मानेगा और शिकायत करेगा कि `command` गायब है
- `sse` संगतता के लिए वैध रहता है, लेकिन नए होस्टेड सर्वरों को आमतौर पर `http` के रूप में कॉन्फ़िगर किया जाना चाहिए

## डिस्कवरी और प्राथमिकता

OMP फ़ाइलों में डुप्लिकेट सर्वर डेफिनिशन को मर्ज नहीं करता। डिस्कवरी प्रोवाइडर्स को प्राथमिकता दी जाती है, और उच्च-प्राथमिकता वाली डेफिनिशन जीतती है।

व्यवहार में:

- जब आप OMP-विशिष्ट ओवरराइड चाहते हैं तो `.xcsh/mcp.json` या `~/.xcsh/mcp.json` को प्राथमिकता दें
- जब संभव हो तो टूल्स में सर्वर नाम अद्वितीय रखें
- जब कोई तृतीय-पक्ष कॉन्फ़िग ऐसा सर्वर बार-बार पेश करता रहे जो आप नहीं चाहते, तो उपयोगकर्ता कॉन्फ़िग में `disabledServers` का उपयोग करें

## समस्या निवारण

### `Server "name": stdio server requires "command" field`

आपने संभवतः रिमोट सर्वर पर `type: "http"` छोड़ दिया है।

### `Server "name": both "command" and "url" are set`

एक ट्रांसपोर्ट चुनें। OMP `command` को stdio और `url` को http/sse के रूप में मानता है।

### `/mcp add` काम कर गया लेकिन सर्वर अभी भी कनेक्ट नहीं हो रहा

JSON वैध है, लेकिन सर्वर अभी भी अनुपलब्ध हो सकता है। `/mcp test <name>` का उपयोग करें और जाँचें कि:

- बाइनरी या Docker इमेज मौजूद है
- आवश्यक एनवायरनमेंट वेरिएबल सेट हैं
- रिमोट URL पहुँच योग्य है
- OAuth या API टोकन वैध है

### सर्वर किसी अन्य टूल के कॉन्फ़िग में मौजूद है लेकिन OMP में नहीं

`/mcp list` चलाएं। OMP कई तृतीय-पक्ष MCP फ़ाइलों को खोजता है, लेकिन प्रोजेक्ट-स्तरीय लोडिंग को `mcp.enableProjectConfig` सेटिंग के माध्यम से भी अक्षम किया जा सकता है।

## संदर्भ

- MCP ट्रांसपोर्ट स्पेक: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Filesystem सर्वर पैकेज: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP सर्वर: <https://github.com/github/github-mcp-server>
- Slack MCP सर्वर डॉक्स: <https://docs.slack.dev/ai/slack-mcp-server/>
