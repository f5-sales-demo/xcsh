---
title: Marketplace Plugin System
description: >-
  Marketplace plugin system for discovering, installing, and managing curated
  plugin collections.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# मार्केटप्लेस प्लगइन सिस्टम

मार्केटप्लेस सिस्टम आपको Git-होस्टेड कैटलॉग से प्लगइन खोजने, इंस्टॉल करने और प्रबंधित करने की सुविधा देता है। यह Claude Code प्लगइन रजिस्ट्री फॉर्मेट के साथ संगत है।

## त्वरित शुरुआत

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

या बिना किसी आर्गुमेंट के बस `/marketplace` टाइप करें ताकि इंटरैक्टिव प्लगइन ब्राउज़र खुले।

## अवधारणाएँ

एक **मार्केटप्लेस** एक Git रिपॉजिटरी (या लोकल डायरेक्टरी) है जिसमें `.xcsh-plugin/marketplace.json` पर एक कैटलॉग फ़ाइल होती है। कैटलॉग उपलब्ध प्लगइन को उनके स्रोतों, विवरणों और मेटाडेटा के साथ सूचीबद्ध करता है।

एक **प्लगइन** एक डायरेक्टरी है जिसमें स्किल्स, कमांड, हुक्स, MCP सर्वर, या LSP सर्वर होते हैं। प्लगइन की पहचान `name@marketplace` से होती है (उदा. `code-review@f5xc-salesdemos-marketplace`)।

**स्कोप**: प्लगइन दो स्कोप पर इंस्टॉल किए जा सकते हैं:

- **user** (डिफ़ॉल्ट) -- सभी प्रोजेक्ट में उपलब्ध, `~/.xcsh/plugins/installed_plugins.json` में संग्रहीत
- **project** -- केवल वर्तमान प्रोजेक्ट में उपलब्ध, `.xcsh/installed_plugins.json` में संग्रहीत

प्रोजेक्ट-स्कोप्ड इंस्टॉल उसी प्लगइन के यूज़र-स्कोप्ड इंस्टॉल को शैडो करते हैं।

## कमांड

### इंटरैक्टिव मोड

| कमांड | प्रभाव |
|---|---|
| `/marketplace` | इंटरैक्टिव प्लगइन ब्राउज़र खोलें (इंस्टॉल) |

### मार्केटप्लेस प्रबंधन

| कमांड | प्रभाव |
|---|---|
| `/marketplace add <source>` | एक मार्केटप्लेस स्रोत जोड़ें |
| `/marketplace remove <name>` | एक मार्केटप्लेस हटाएँ |
| `/marketplace update [name]` | कैटलॉग को दोबारा फ़ेच करें; सभी को अपडेट करने के लिए नाम छोड़ दें |
| `/marketplace list` | कॉन्फ़िगर किए गए मार्केटप्लेस की सूची देखें |

### प्लगइन ऑपरेशन

| कमांड | प्रभाव |
|---|---|
| `/marketplace discover [marketplace]` | उपलब्ध प्लगइन ब्राउज़ करें |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | एक प्लगइन इंस्टॉल करें |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | एक प्लगइन अनइंस्टॉल करें |
| `/marketplace installed` | इंस्टॉल किए गए मार्केटप्लेस प्लगइन की सूची देखें |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | एक या सभी प्लगइन अपग्रेड करें |

### CLI समकक्ष

वही ऑपरेशन कमांड लाइन से भी उपलब्ध हैं:

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

| स्रोत फॉर्मेट | प्रकार | उदाहरण |
|---|---|---|
| `owner/repo` | GitHub शॉर्टहैंड | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | डायरेक्ट कैटलॉग URL | `https://example.com/marketplace.json` |
| `https://...*.git` या `git@...` | Git रिपॉजिटरी | `https://github.com/org/repo.git` |
| `./path` या `~/path` या `/path` | लोकल डायरेक्टरी | `./my-marketplace` |

सिस्टम रिपॉजिटरी को क्लोन करता है (या लोकल डायरेक्टरी पढ़ता है), `.xcsh-plugin/marketplace.json` का पता लगाता है, उसे मान्य करता है, और कैटलॉग को स्थानीय रूप से कैश करता है।

## कैटलॉग फॉर्मेट (marketplace.json)

एक मार्केटप्लेस कैटलॉग रिपॉजिटरी रूट में `.xcsh-plugin/marketplace.json` पर स्थित होता है:

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
| `name` | मार्केटप्लेस नाम। लोअरकेस अल्फ़ान्यूमेरिक, हाइफ़न और डॉट। अल्फ़ान्यूमेरिक से शुरू और समाप्त होना चाहिए। अधिकतम 64 अक्षर। |
| `owner.name` | मार्केटप्लेस स्वामी का नाम |
| `plugins` | प्लगइन प्रविष्टियों की ऐरे |

### प्लगइन प्रविष्टि फ़ील्ड

| फ़ील्ड | आवश्यक | विवरण |
|---|---|---|
| `name` | हाँ | प्लगइन नाम (मार्केटप्लेस नाम जैसे ही नियम) |
| `source` | हाँ | प्लगइन कहाँ खोजें (नीचे देखें) |
| `description` | नहीं | संक्षिप्त विवरण |
| `version` | नहीं | संस्करण स्ट्रिंग |
| `author` | नहीं | `{ name, email? }` |
| `homepage` | नहीं | URL |
| `category` | नहीं | श्रेणी स्ट्रिंग (उदा. `development`, `productivity`, `security`) |
| `tags` | नहीं | स्ट्रिंग टैग की ऐरे |
| `strict` | नहीं | बूलियन |
| `commands` | नहीं | प्रदान किए गए स्लैश कमांड |
| `agents` | नहीं | प्रदान किए गए एजेंट |
| `hooks` | नहीं | हुक परिभाषाएँ |
| `mcpServers` | नहीं | MCP सर्वर परिभाषाएँ |
| `lspServers` | नहीं | LSP सर्वर परिभाषाएँ |

### प्लगइन स्रोत फॉर्मेट

`source` फ़ील्ड कई फॉर्मेट का समर्थन करती है:

**रिलेटिव पाथ** (मार्केटप्लेस रिपो के भीतर):

```json
"source": "./plugins/my-plugin"
```

**Git रिपॉजिटरी URL**:

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

**Git सबडायरेक्टरी** (मोनोरिपो):

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
    installed_plugins.json     # यूज़र-स्कोप्ड इंस्टॉल किए गए प्लगइन
    cache/
      marketplaces/            # कैश किए गए मार्केटप्लेस कैटलॉग
      plugins/                 # कैश की गई प्लगइन डायरेक्टरी

<project>/.xcsh/
  installed_plugins.json       # प्रोजेक्ट-स्कोप्ड इंस्टॉल किए गए प्लगइन
```

## नामकरण नियम

मार्केटप्लेस और प्लगइन नामों में होना चाहिए:

- लोअरकेस अक्षर या अंक से शुरू और समाप्त होना
- केवल लोअरकेस अक्षर, अंक, हाइफ़न और डॉट शामिल होने चाहिए
- अधिकतम 64 अक्षर

प्लगइन ID (`name@marketplace`) कुल मिलाकर अधिकतम 128 अक्षर होने चाहिए।

मान्य उदाहरण: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
अमान्य उदाहरण: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
