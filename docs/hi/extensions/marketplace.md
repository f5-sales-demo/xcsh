---
title: मार्केटप्लेस प्लगइन सिस्टम
description: >-
  क्यूरेटेड प्लगइन संग्रह की खोज, इंस्टॉलेशन और प्रबंधन के लिए मार्केटप्लेस
  प्लगइन सिस्टम।
sidebar:
  order: 4
  label: मार्केटप्लेस
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# मार्केटप्लेस प्लगइन सिस्टम

मार्केटप्लेस सिस्टम आपको Git-होस्टेड कैटलॉग से प्लगइन खोजने, इंस्टॉल करने और प्रबंधित करने की सुविधा देता है। यह Claude Code प्लगइन रजिस्ट्री फ़ॉर्मेट के साथ संगत है।

## त्वरित शुरुआत

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

या बिना किसी तर्क के बस `/marketplace` टाइप करें और इंटरेक्टिव प्लगइन ब्राउज़र खोलें।

## अवधारणाएँ

एक **मार्केटप्लेस** एक Git रिपॉज़िटरी (या स्थानीय डायरेक्टरी) होती है जिसमें `.xcsh-plugin/marketplace.json` पर एक कैटलॉग फ़ाइल होती है। कैटलॉग उपलब्ध प्लगइन को उनके स्रोत, विवरण और मेटाडेटा के साथ सूचीबद्ध करता है।

एक **प्लगइन** एक डायरेक्टरी है जिसमें स्किल्स, कमांड, हुक, MCP सर्वर, या LSP सर्वर होते हैं। प्लगइन को `name@marketplace` (जैसे `code-review@f5xc-salesdemos-marketplace`) द्वारा पहचाना जाता है।

**स्कोप**: प्लगइन को दो स्कोप पर इंस्टॉल किया जा सकता है:

- **user** (डिफ़ॉल्ट) -- सभी प्रोजेक्ट में उपलब्ध, `~/.xcsh/plugins/installed_plugins.json` में संग्रहीत
- **project** -- केवल वर्तमान प्रोजेक्ट में उपलब्ध, `.xcsh/installed_plugins.json` में संग्रहीत

प्रोजेक्ट-स्कोप्ड इंस्टॉल, उसी प्लगइन के user-स्कोप्ड इंस्टॉल को ओवरराइड करते हैं।

## कमांड

### इंटरेक्टिव मोड

| कमांड | प्रभाव |
|---|---|
| `/marketplace` | इंटरेक्टिव प्लगइन ब्राउज़र खोलें (इंस्टॉल) |

### मार्केटप्लेस प्रबंधन

| कमांड | प्रभाव |
|---|---|
| `/marketplace add <source>` | एक मार्केटप्लेस स्रोत जोड़ें |
| `/marketplace remove <name>` | एक मार्केटप्लेस हटाएँ |
| `/marketplace update [name]` | कैटलॉग पुनः प्राप्त करें; सभी अपडेट करने के लिए नाम छोड़ें |
| `/marketplace list` | कॉन्फ़िगर किए गए मार्केटप्लेस सूचीबद्ध करें |

### प्लगइन संचालन

| कमांड | प्रभाव |
|---|---|
| `/marketplace discover [marketplace]` | उपलब्ध प्लगइन ब्राउज़ करें |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | एक प्लगइन इंस्टॉल करें |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | एक प्लगइन अनइंस्टॉल करें |
| `/marketplace installed` | इंस्टॉल किए गए मार्केटप्लेस प्लगइन सूचीबद्ध करें |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | एक या सभी प्लगइन अपग्रेड करें |

### CLI समकक्ष

वही संचालन कमांड लाइन से भी उपलब्ध हैं:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## मार्केटप्लेस स्रोत

जब आप `/marketplace add <source>` चलाते हैं, तो सिस्टम स्रोत को वर्गीकृत करता है:

| स्रोत फ़ॉर्मेट | प्रकार | उदाहरण |
|---|---|---|
| `owner/repo` | GitHub शॉर्टहैंड | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | डायरेक्ट कैटलॉग URL | `https://example.com/marketplace.json` |
| `https://...*.git` या `git@...` | Git रिपॉज़िटरी | `https://github.com/org/repo.git` |
| `./path` या `~/path` या `/path` | स्थानीय डायरेक्टरी | `./my-marketplace` |

सिस्टम रिपॉज़िटरी क्लोन करता है (या स्थानीय डायरेक्टरी पढ़ता है), `.xcsh-plugin/marketplace.json` ढूँढता है, उसे सत्यापित करता है, और कैटलॉग को स्थानीय रूप से कैश करता है।

## कैटलॉग फ़ॉर्मेट (marketplace.json)

एक मार्केटप्लेस कैटलॉग रिपॉज़िटरी रूट में `.xcsh-plugin/marketplace.json` पर स्थित होता है:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### आवश्यक फ़ील्ड

| फ़ील्ड | विवरण |
|---|---|
| `name` | मार्केटप्लेस का नाम। लोअरकेस अल्फ़ान्यूमेरिक, हाइफ़न और डॉट। अल्फ़ान्यूमेरिक से शुरू और समाप्त होना चाहिए। अधिकतम 64 अक्षर। |
| `owner.name` | मार्केटप्लेस स्वामी का नाम |
| `plugins` | प्लगइन एंट्री की सरणी |

### प्लगइन एंट्री फ़ील्ड

| फ़ील्ड | आवश्यक | विवरण |
|---|---|---|
| `name` | हाँ | प्लगइन का नाम (मार्केटप्लेस नाम के समान नियम) |
| `source` | हाँ | प्लगइन कहाँ खोजें (नीचे देखें) |
| `description` | नहीं | संक्षिप्त विवरण |
| `version` | नहीं | संस्करण स्ट्रिंग |
| `author` | नहीं | `{ name, email? }` |
| `homepage` | नहीं | URL |
| `category` | नहीं | श्रेणी स्ट्रिंग (जैसे `development`, `productivity`, `security`) |
| `tags` | नहीं | स्ट्रिंग टैग की सरणी |
| `strict` | नहीं | बूलियन |
| `commands` | नहीं | प्रदान किए गए स्लैश कमांड |
| `agents` | नहीं | प्रदान किए गए एजेंट |
| `hooks` | नहीं | हुक परिभाषाएँ |
| `mcpServers` | नहीं | MCP सर्वर परिभाषाएँ |
| `lspServers` | नहीं | LSP सर्वर परिभाषाएँ |

### प्लगइन स्रोत फ़ॉर्मेट

`source` फ़ील्ड कई फ़ॉर्मेट का समर्थन करता है:

**सापेक्ष पथ** (मार्केटप्लेस रेपो के भीतर):

```json
"source": "./plugins/my-plugin"
```

**Git रिपॉज़िटरी URL**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub शॉर्टहैंड**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Git सबडायरेक्टरी** (मोनोरेपो):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**npm पैकेज**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## डिस्क पर लेआउट

```
~/.xcsh/
  config/
    marketplaces.json          # जोड़े गए मार्केटप्लेस की रजिस्ट्री
  plugins/
    installed_plugins.json     # User-स्कोप्ड इंस्टॉल किए गए प्लगइन
    cache/
      marketplaces/            # कैश किए गए मार्केटप्लेस कैटलॉग
      plugins/                 # कैश की गई प्लगइन डायरेक्टरी

<project>/.xcsh/
  installed_plugins.json       # Project-स्कोप्ड इंस्टॉल किए गए प्लगइन
```

## नामकरण नियम

मार्केटप्लेस और प्लगइन नाम:

- लोअरकेस अक्षर या अंक से शुरू और समाप्त होने चाहिए
- केवल लोअरकेस अक्षर, अंक, हाइफ़न और डॉट हो सकते हैं
- अधिकतम 64 अक्षर के होने चाहिए

प्लगइन ID (`name@marketplace`) कुल अधिकतम 128 अक्षर होने चाहिए।

मान्य उदाहरण: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
अमान्य उदाहरण: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
