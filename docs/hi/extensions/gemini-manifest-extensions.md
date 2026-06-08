---
title: Gemini Manifest Extensions
description: >-
  क्रॉस-प्लेटफ़ॉर्म स्किल और एजेंट संगतता के लिए Gemini मैनिफ़ेस्ट एक्सटेंशन
  प्रारूप।
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini मैनिफ़ेस्ट एक्सटेंशन (`gemini-extension.json`)

यह दस्तावेज़ बताता है कि coding-agent कैसे Gemini-शैली मैनिफ़ेस्ट एक्सटेंशन (`gemini-extension.json`) को खोजता और पार्स करके `extensions` क्षमता में परिवर्तित करता है।

यह TypeScript/JavaScript एक्सटेंशन मॉड्यूल लोडिंग (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) को **कवर नहीं करता**, जो `extension-loading.md` में प्रलेखित है।

## कार्यान्वयन फ़ाइलें

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## क्या खोजा जाता है

Gemini प्रदाता (`id: gemini`, प्राथमिकता `60`) एक `extensions` लोडर पंजीकृत करता है जो दो निश्चित रूट्स को स्कैन करता है:

- उपयोगकर्ता: `~/.gemini/extensions`
- प्रोजेक्ट: `<cwd>/.gemini/extensions`

पाथ रिज़ॉल्यूशन `ctx.home` और `ctx.cwd` से `getUserPath()` / `getProjectPath()` के माध्यम से सीधे किया जाता है।

महत्वपूर्ण स्कोप नियम: प्रोजेक्ट लुकअप **केवल cwd** तक सीमित है। यह पैरेंट डायरेक्ट्रीज़ में नहीं जाता।

---

## डायरेक्ट्री स्कैन नियम

प्रत्येक रूट (`~/.gemini/extensions` और `<cwd>/.gemini/extensions`) के लिए, डिस्कवरी निम्न कार्य करती है:

1. `readDirEntries(root)`
2. केवल प्रत्यक्ष चाइल्ड डायरेक्ट्रीज़ रखें (`entry.isDirectory()`)
3. प्रत्येक चाइल्ड `<name>` के लिए, ठीक यह पढ़ने का प्रयास करें:
   - `<root>/<name>/gemini-extension.json`

एक डायरेक्ट्री स्तर से आगे कोई रिकर्सिव स्कैन नहीं होता।

### छिपी डायरेक्ट्रीज़

Gemini मैनिफ़ेस्ट डिस्कवरी डॉट-प्रीफ़िक्स्ड डायरेक्ट्री नामों को फ़िल्टर **नहीं** करती। यदि कोई छिपी चाइल्ड डायरेक्ट्री मौजूद है और उसमें `gemini-extension.json` है, तो उसे विचार में लिया जाता है।

### गुम/अपठनीय फ़ाइलें

यदि `gemini-extension.json` गुम या अपठनीय है, तो उस डायरेक्ट्री को चुपचाप छोड़ दिया जाता है (कोई चेतावनी नहीं)।

---

## मैनिफ़ेस्ट संरचना (कार्यान्वयन अनुसार)

क्षमता प्रकार इस मैनिफ़ेस्ट संरचना को परिभाषित करता है:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

डिस्कवरी-समय व्यवहार जानबूझकर ढीला है:

- JSON पार्स सफलता आवश्यक है।
- JSON सिंटैक्स के अलावा फ़ील्ड प्रकारों/सामग्री के लिए कोई रनटाइम स्कीमा सत्यापन नहीं है।
- पार्स किया गया ऑब्जेक्ट क्षमता आइटम पर `manifest` के रूप में संग्रहित किया जाता है।

### नाम सामान्यीकरण

`Extension.name` इस प्रकार सेट किया जाता है:

1. `manifest.name` यदि यह `null`/`undefined` नहीं है
2. अन्यथा एक्सटेंशन डायरेक्ट्री का नाम

यहाँ कोई स्ट्रिंग-प्रकार प्रवर्तन लागू नहीं किया जाता।

---

## क्षमता आइटम में मटीरियलाइज़ेशन

एक वैध पार्स किया गया मैनिफ़ेस्ट एक `Extension` क्षमता आइटम बनाता है:

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

- `_source.path` को `createSourceMeta()` द्वारा एब्सोल्यूट पाथ में सामान्यीकृत किया जाता है।
- `extensions` के लिए रजिस्ट्री-स्तर क्षमता सत्यापन केवल `name` और `path` की उपस्थिति जाँचता है।
- मैनिफ़ेस्ट आंतरिक तत्वों (`mcpServers`, `tools`, `context`) को डिस्कवरी के दौरान सत्यापित नहीं किया जाता।

---

## त्रुटि प्रबंधन और चेतावनी शब्दार्थ

### चेतावनी दी जाती है

- मैनिफ़ेस्ट फ़ाइल में अमान्य JSON:
  - चेतावनी प्रारूप: `Invalid JSON in <manifestPath>`

### चेतावनी नहीं दी जाती (चुपचाप छोड़ दिया जाता है)

- `extensions` डायरेक्ट्री गुम है
- चाइल्ड डायरेक्ट्री में `gemini-extension.json` नहीं है
- अपठनीय मैनिफ़ेस्ट फ़ाइल
- मैनिफ़ेस्ट JSON सिंटैक्टिक रूप से वैध है लेकिन शब्दार्थ रूप से विचित्र/अपूर्ण है

इसका अर्थ है कि आंशिक वैधता स्वीकार की जाती है: केवल सिंटैक्टिक JSON विफलता पर चेतावनी उत्सर्जित होती है।

---

## अन्य स्रोतों के साथ प्राथमिकता और डीडुप्लिकेशन

`extensions` क्षमता को क्षमता रजिस्ट्री द्वारा प्रदाताओं के बीच एकत्रित किया जाता है।

इस क्षमता के वर्तमान प्रदाता:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) प्राथमिकता `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) प्राथमिकता `60`

डीडुप कुंजी `ext.name` है (`extensionCapability.key = ext => ext.name`)।

### क्रॉस-प्रदाता प्राथमिकता

डुप्लिकेट एक्सटेंशन नामों पर उच्च-प्राथमिकता प्रदाता जीतता है।

- यदि `native` और `gemini` दोनों एक्सटेंशन नाम `foo` उत्सर्जित करते हैं, तो native आइटम रखा जाता है।
- कम-प्राथमिकता वाला डुप्लिकेट केवल `result.all` में `_shadowed = true` के साथ रखा जाता है।

### इंट्रा-प्रदाता क्रम प्रभाव

चूँकि डीडुप "पहले देखा गया जीतता है" है, प्रदाता-स्थानीय आइटम क्रम मायने रखता है।

- Gemini लोडर **पहले उपयोगकर्ता**, फिर **प्रोजेक्ट** जोड़ता है।
- इसलिए, `~/.gemini/extensions` और `<cwd>/.gemini/extensions` के बीच डुप्लिकेट नाम उपयोगकर्ता प्रविष्टि रखते हैं और प्रोजेक्ट प्रविष्टि को शैडो करते हैं।

इसके विपरीत, native प्रदाता कॉन्फ़िग डायरेक्ट्री क्रम अलग तरह से बनाता है (`getConfigDirs()` में `project` फिर `user`), इसलिए native इंट्रा-प्रदाता शैडोइंग विपरीत दिशा में होती है।

---

## उपयोगकर्ता बनाम प्रोजेक्ट व्यवहार सारांश

विशेष रूप से Gemini मैनिफ़ेस्ट के लिए:

- प्रत्येक लोड पर उपयोगकर्ता और प्रोजेक्ट दोनों रूट्स स्कैन किए जाते हैं।
- प्रोजेक्ट रूट `<cwd>/.gemini/extensions` पर निश्चित है (कोई पूर्वज वॉक नहीं)।
- Gemini स्रोत के अंदर डुप्लिकेट नाम उपयोगकर्ता-पहले के अनुसार हल होते हैं।
- उच्च-प्राथमिकता प्रदाताओं (विशेषकर native) के विरुद्ध डुप्लिकेट नाम प्राथमिकता से हारते हैं।

---

## सीमा: डिस्कवरी मेटाडेटा बनाम रनटाइम एक्सटेंशन लोडिंग

`gemini-extension.json` डिस्कवरी वर्तमान में क्षमता मेटाडेटा (`Extension` आइटम) को फ़ीड करती है। यह सीधे रन करने योग्य TS/JS एक्सटेंशन मॉड्यूल **लोड नहीं** करती।

रनटाइम मॉड्यूल लोडिंग (`discoverAndLoadExtensions()` / `loadExtensions()`) `extension-modules` और स्पष्ट पाथ का उपयोग करती है, और वर्तमान में ऑटो-डिस्कवर्ड मॉड्यूल को केवल प्रदाता `native` तक फ़िल्टर करती है।

व्यावहारिक निहितार्थ:

- Gemini मैनिफ़ेस्ट एक्सटेंशन क्षमता रिकॉर्ड के रूप में खोजे जा सकते हैं।
- वे अपने आप में, एक्सटेंशन लोडर पाइपलाइन द्वारा रनटाइम एक्सटेंशन मॉड्यूल के रूप में निष्पादित नहीं किए जाते।

यह सीमा वर्तमान कार्यान्वयन में जानबूझकर है और बताती है कि मैनिफ़ेस्ट डिस्कवरी और निष्पादन योग्य मॉड्यूल लोडिंग क्यों भिन्न हो सकते हैं।
