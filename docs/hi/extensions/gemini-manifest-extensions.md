---
title: Gemini मैनिफेस्ट एक्सटेंशन
description: >-
  क्रॉस-प्लेटफॉर्म स्किल और एजेंट संगतता के लिए Gemini मैनिफेस्ट एक्सटेंशन
  प्रारूप।
sidebar:
  order: 7
  label: Gemini मैनिफेस्ट
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini मैनिफेस्ट एक्सटेंशन (`gemini-extension.json`)

यह दस्तावेज़ बताता है कि coding-agent कैसे Gemini-शैली मैनिफेस्ट एक्सटेंशन (`gemini-extension.json`) को खोजता और पार्स करके `extensions` क्षमता में परिवर्तित करता है।

यह TypeScript/JavaScript एक्सटेंशन मॉड्यूल लोडिंग (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) को कवर **नहीं** करता, जो `extension-loading.md` में प्रलेखित है।

## कार्यान्वयन फ़ाइलें

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## क्या खोजा जाता है

Gemini प्रदाता (`id: gemini`, प्राथमिकता `60`) एक `extensions` लोडर पंजीकृत करता है जो दो निश्चित मूल स्थानों को स्कैन करता है:

- उपयोगकर्ता: `~/.gemini/extensions`
- प्रोजेक्ट: `<cwd>/.gemini/extensions`

पथ समाधान `ctx.home` और `ctx.cwd` से `getUserPath()` / `getProjectPath()` के माध्यम से सीधे किया जाता है।

महत्वपूर्ण स्कोप नियम: प्रोजेक्ट खोज **केवल cwd** तक सीमित है। यह पैरेंट डायरेक्टरी में नहीं जाता।

---

## डायरेक्टरी स्कैन नियम

प्रत्येक मूल (`~/.gemini/extensions` और `<cwd>/.gemini/extensions`) के लिए, खोज यह करती है:

1. `readDirEntries(root)`
2. केवल प्रत्यक्ष चाइल्ड डायरेक्टरी रखें (`entry.isDirectory()`)
3. प्रत्येक चाइल्ड `<name>` के लिए, ठीक यह पढ़ने का प्रयास करें:
   - `<root>/<name>/gemini-extension.json`

एक डायरेक्टरी स्तर से आगे कोई रिकर्सिव स्कैन नहीं है।

### छिपी डायरेक्टरी

Gemini मैनिफेस्ट खोज डॉट-प्रीफिक्स्ड डायरेक्टरी नामों को फ़िल्टर **नहीं** करती। यदि कोई छिपी चाइल्ड डायरेक्टरी मौजूद है और उसमें `gemini-extension.json` है, तो उसे माना जाता है।

### गायब/अपठनीय फ़ाइलें

यदि `gemini-extension.json` गायब या अपठनीय है, तो वह डायरेक्टरी चुपचाप छोड़ दी जाती है (कोई चेतावनी नहीं)।

---

## मैनिफेस्ट आकार (जैसा कार्यान्वित है)

क्षमता प्रकार इस मैनिफेस्ट आकार को परिभाषित करता है:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

खोज-समय व्यवहार जानबूझकर शिथिल है:

- JSON पार्स सफलता आवश्यक है।
- JSON सिंटैक्स के अलावा फ़ील्ड प्रकारों/सामग्री के लिए कोई रनटाइम स्कीमा सत्यापन नहीं है।
- पार्स किया गया ऑब्जेक्ट क्षमता आइटम पर `manifest` के रूप में संग्रहीत किया जाता है।

### नाम सामान्यीकरण

`Extension.name` इस प्रकार सेट किया जाता है:

1. `manifest.name` यदि यह `null`/`undefined` नहीं है
2. अन्यथा एक्सटेंशन डायरेक्टरी का नाम

यहाँ कोई स्ट्रिंग-प्रकार प्रवर्तन लागू नहीं किया गया है।

---

## क्षमता आइटम में भौतिकीकरण

एक वैध पार्स किया गया मैनिफेस्ट एक `Extension` क्षमता आइटम बनाता है:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // capability registry द्वारा जोड़ा गया
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

नोट्स:

- `_source.path` को `createSourceMeta()` द्वारा एक पूर्ण पथ में सामान्यीकृत किया जाता है।
- `extensions` के लिए रजिस्ट्री-स्तरीय क्षमता सत्यापन केवल `name` और `path` की उपस्थिति जाँचता है।
- मैनिफेस्ट आंतरिक (`mcpServers`, `tools`, `context`) खोज के दौरान सत्यापित नहीं किए जाते।

---

## त्रुटि हैंडलिंग और चेतावनी शब्दार्थ

### चेतावनी दी जाती है

- मैनिफेस्ट फ़ाइल में अमान्य JSON:
  - चेतावनी प्रारूप: `Invalid JSON in <manifestPath>`

### चेतावनी नहीं दी जाती (मौन छोड़ना)

- `extensions` डायरेक्टरी गायब है
- चाइल्ड डायरेक्टरी में `gemini-extension.json` नहीं है
- अपठनीय मैनिफेस्ट फ़ाइल
- मैनिफेस्ट JSON सिंटैक्स रूप से वैध है लेकिन शब्दार्थ रूप से विषम/अपूर्ण है

इसका अर्थ है कि आंशिक वैधता स्वीकार की जाती है: केवल सिंटैक्टिक JSON विफलता चेतावनी उत्सर्जित करती है।

---

## अन्य स्रोतों के साथ प्राथमिकता और डीडुप्लीकेशन

`extensions` क्षमता को capability registry द्वारा प्रदाताओं में एकत्रित किया जाता है।

इस क्षमता के वर्तमान प्रदाता:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) प्राथमिकता `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) प्राथमिकता `60`

डीडुप कुंजी `ext.name` है (`extensionCapability.key = ext => ext.name`)।

### क्रॉस-प्रदाता प्राथमिकता

डुप्लीकेट एक्सटेंशन नामों पर उच्च-प्राथमिकता वाला प्रदाता जीतता है।

- यदि `native` और `gemini` दोनों एक्सटेंशन नाम `foo` उत्सर्जित करते हैं, तो native आइटम रखा जाता है।
- निम्न-प्राथमिकता वाला डुप्लीकेट केवल `result.all` में `_shadowed = true` के साथ बनाए रखा जाता है।

### इंट्रा-प्रदाता क्रम प्रभाव

चूँकि डीडुप "पहले दिखा जीता" है, प्रदाता-स्थानीय आइटम क्रम मायने रखता है।

- Gemini लोडर **पहले उपयोगकर्ता**, फिर **प्रोजेक्ट** जोड़ता है।
- इसलिए, `~/.gemini/extensions` और `<cwd>/.gemini/extensions` के बीच डुप्लीकेट नाम उपयोगकर्ता प्रविष्टि रखते हैं और प्रोजेक्ट प्रविष्टि को छायांकित करते हैं।

इसके विपरीत, native प्रदाता कॉन्फ़िग डिर क्रम अलग तरह से बनाता है (`getConfigDirs()` में `project` फिर `user`), इसलिए native इंट्रा-प्रदाता छायांकन विपरीत दिशा में है।

---

## उपयोगकर्ता बनाम प्रोजेक्ट व्यवहार सारांश

विशेष रूप से Gemini मैनिफेस्ट के लिए:

- प्रत्येक लोड में उपयोगकर्ता और प्रोजेक्ट दोनों मूल स्कैन किए जाते हैं।
- प्रोजेक्ट मूल `<cwd>/.gemini/extensions` पर निश्चित है (कोई पूर्वज खोज नहीं)।
- Gemini स्रोत के अंदर डुप्लीकेट नाम उपयोगकर्ता-पहले हल होते हैं।
- उच्च-प्राथमिकता प्रदाताओं (विशेष रूप से native) के विरुद्ध डुप्लीकेट नाम प्राथमिकता से हारते हैं।

---

## सीमा: खोज मेटाडेटा बनाम रनटाइम एक्सटेंशन लोडिंग

`gemini-extension.json` खोज वर्तमान में क्षमता मेटाडेटा (`Extension` आइटम) को फीड करती है। यह सीधे रनयोग्य TS/JS एक्सटेंशन मॉड्यूल **लोड नहीं** करती।

रनटाइम मॉड्यूल लोडिंग (`discoverAndLoadExtensions()` / `loadExtensions()`) `extension-modules` और स्पष्ट पथों का उपयोग करती है, और वर्तमान में स्वचालित-खोजे गए मॉड्यूल को केवल प्रदाता `native` तक फ़िल्टर करती है।

व्यावहारिक निहितार्थ:

- Gemini मैनिफेस्ट एक्सटेंशन क्षमता रिकॉर्ड के रूप में खोजे जा सकते हैं।
- वे अपने आप में एक्सटेंशन लोडर पाइपलाइन द्वारा रनटाइम एक्सटेंशन मॉड्यूल के रूप में निष्पादित नहीं होते।

यह सीमा वर्तमान कार्यान्वयन में जानबूझकर है और बताती है कि मैनिफेस्ट खोज और निष्पादन योग्य मॉड्यूल लोडिंग क्यों भिन्न हो सकते हैं।
