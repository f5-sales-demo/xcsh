---
title: Gemini मैनिफेस्ट एक्सटेंशन
description: >-
  क्रॉस-प्लेटफ़ॉर्म स्किल और एजेंट संगतता के लिए Gemini मैनिफेस्ट एक्सटेंशन
  प्रारूप।
sidebar:
  order: 7
  label: Gemini मैनिफेस्ट
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini मैनिफेस्ट एक्सटेंशन (`gemini-extension.json`)

यह दस्तावेज़ बताता है कि कोडिंग-एजेंट Gemini-स्टाइल मैनिफेस्ट एक्सटेंशन (`gemini-extension.json`) को कैसे खोजता और पार्स करता है, और उन्हें `extensions` क्षमता में कैसे रूपांतरित करता है।

यह TypeScript/JavaScript एक्सटेंशन मॉड्यूल लोडिंग (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) को **नहीं** कवर करता, जिसे `extension-loading.md` में प्रलेखित किया गया है।

## कार्यान्वयन फ़ाइलें

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## क्या खोजा जाता है

Gemini प्रोवाइडर (`id: gemini`, प्राथमिकता `60`) एक `extensions` लोडर पंजीकृत करता है जो दो निश्चित रूट्स को स्कैन करता है:

- उपयोगकर्ता: `~/.gemini/extensions`
- प्रोजेक्ट: `<cwd>/.gemini/extensions`

पाथ रेज़ॉल्यूशन `ctx.home` और `ctx.cwd` से `getUserPath()` / `getProjectPath()` के माध्यम से सीधे होता है।

महत्वपूर्ण स्कोप नियम: प्रोजेक्ट लुकअप **केवल cwd** तक सीमित है। यह पैरेंट डायरेक्ट्री में नहीं जाता।

---

## डायरेक्ट्री स्कैन नियम

प्रत्येक रूट (`~/.gemini/extensions` और `<cwd>/.gemini/extensions`) के लिए, डिस्कवरी निम्नलिखित करती है:

1. `readDirEntries(root)`
2. केवल प्रत्यक्ष चाइल्ड डायरेक्ट्री रखें (`entry.isDirectory()`)
3. प्रत्येक चाइल्ड `<name>` के लिए, ठीक यही पढ़ने का प्रयास करें:
   - `<root>/<name>/gemini-extension.json`

एक डायरेक्ट्री स्तर से आगे कोई पुनरावर्ती स्कैन नहीं होती।

### छुपी हुई डायरेक्ट्री

Gemini मैनिफेस्ट डिस्कवरी डॉट-प्रीफिक्स्ड डायरेक्ट्री नामों को **फ़िल्टर नहीं** करती। यदि कोई छुपी हुई चाइल्ड डायरेक्ट्री मौजूद है और उसमें `gemini-extension.json` है, तो उसे भी शामिल किया जाता है।

### अनुपस्थित/अपठनीय फ़ाइलें

यदि `gemini-extension.json` अनुपस्थित या अपठनीय है, तो उस डायरेक्ट्री को चुपचाप छोड़ दिया जाता है (कोई चेतावनी नहीं)।

---

## मैनिफेस्ट आकार (जैसा कार्यान्वित किया गया है)

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

डिस्कवरी-टाइम व्यवहार जानबूझकर शिथिल है:

- JSON पार्स सफलता आवश्यक है।
- JSON सिंटैक्स से परे फ़ील्ड प्रकार/सामग्री के लिए कोई रनटाइम स्कीमा सत्यापन नहीं है।
- पार्स किया गया ऑब्जेक्ट क्षमता आइटम पर `manifest` के रूप में संग्रहीत होता है।

### नाम सामान्यीकरण

`Extension.name` इस प्रकार सेट होता है:

1. `manifest.name` यदि यह `null`/`undefined` नहीं है
2. अन्यथा एक्सटेंशन डायरेक्ट्री का नाम

यहाँ कोई स्ट्रिंग-प्रकार प्रवर्तन लागू नहीं किया जाता।

---

## क्षमता आइटम में मटेरियलाइज़ेशन

एक वैध पार्स किया गया मैनिफेस्ट एक `Extension` क्षमता आइटम बनाता है:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // capability registry द्वारा संलग्न
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

टिप्पणियाँ:

- `_source.path` को `createSourceMeta()` द्वारा एब्सोल्यूट पाथ में सामान्यीकृत किया जाता है।
- `extensions` के लिए रजिस्ट्री-स्तरीय क्षमता सत्यापन केवल `name` और `path` की उपस्थिति जाँचता है।
- मैनिफेस्ट इंटर्नल (`mcpServers`, `tools`, `context`) डिस्कवरी के दौरान सत्यापित नहीं होते।

---

## एरर हैंडलिंग और चेतावनी अर्थशास्त्र

### चेतावनी दी जाती है

- मैनिफेस्ट फ़ाइल में अमान्य JSON:
  - चेतावनी प्रारूप: `Invalid JSON in <manifestPath>`

### चेतावनी नहीं दी जाती (मूक स्किप)

- `extensions` डायरेक्ट्री अनुपस्थित
- चाइल्ड डायरेक्ट्री में `gemini-extension.json` नहीं है
- अपठनीय मैनिफेस्ट फ़ाइल
- मैनिफेस्ट JSON वाक्यात्मक रूप से वैध लेकिन अर्थात्मक रूप से अजीब/अपूर्ण

इसका अर्थ है कि आंशिक वैधता स्वीकार की जाती है: केवल वाक्यात्मक JSON विफलता पर चेतावनी उत्सर्जित होती है।

---

## अन्य स्रोतों के साथ प्राथमिकता और डुप्लीकेशन निष्कासन

`extensions` क्षमता को क्षमता रजिस्ट्री द्वारा प्रोवाइडरों में एकत्रित किया जाता है।

इस क्षमता के लिए वर्तमान प्रोवाइडर:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) प्राथमिकता `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) प्राथमिकता `60`

डुप्लीकेशन निष्कासन कुंजी `ext.name` है (`extensionCapability.key = ext => ext.name`)।

### क्रॉस-प्रोवाइडर प्राथमिकता

डुप्लीकेट एक्सटेंशन नामों पर उच्च-प्राथमिकता प्रोवाइडर जीतता है।

- यदि `native` और `gemini` दोनों एक्सटेंशन नाम `foo` उत्सर्जित करते हैं, तो native आइटम रखा जाता है।
- निम्न-प्राथमिकता डुप्लीकेट केवल `result.all` में `_shadowed = true` के साथ बरकरार रहता है।

### इंट्रा-प्रोवाइडर क्रम प्रभाव

चूँकि डुप्लीकेशन निष्कासन "पहले दिखा वह जीता" के आधार पर है, प्रोवाइडर-स्थानीय आइटम क्रम महत्वपूर्ण है।

- Gemini लोडर **पहले उपयोगकर्ता**, फिर **प्रोजेक्ट** जोड़ता है।
- इसलिए, `~/.gemini/extensions` और `<cwd>/.gemini/extensions` के बीच डुप्लीकेट नाम उपयोगकर्ता प्रविष्टि को बनाए रखते हैं और प्रोजेक्ट प्रविष्टि को शैडो करते हैं।

इसके विपरीत, native प्रोवाइडर `getConfigDirs()` में भिन्न क्रम से config dir बनाता है (`project` फिर `user`), इसलिए native इंट्रा-प्रोवाइडर शैडोइंग विपरीत दिशा में होती है।

---

## उपयोगकर्ता बनाम प्रोजेक्ट व्यवहार सारांश

Gemini मैनिफेस्ट के लिए विशेष रूप से:

- प्रत्येक लोड पर दोनों उपयोगकर्ता और प्रोजेक्ट रूट्स स्कैन किए जाते हैं।
- प्रोजेक्ट रूट `<cwd>/.gemini/extensions` तक निश्चित है (कोई पूर्वज वॉक नहीं)।
- Gemini स्रोत के भीतर डुप्लीकेट नाम उपयोगकर्ता-प्रथम के आधार पर हल होते हैं।
- उच्च-प्राथमिकता प्रोवाइडरों (विशेष रूप से native) के विरुद्ध डुप्लीकेट नाम प्राथमिकता से हार जाते हैं।

---

## सीमा: डिस्कवरी मेटाडेटा बनाम रनटाइम एक्सटेंशन लोडिंग

`gemini-extension.json` डिस्कवरी वर्तमान में क्षमता मेटाडेटा (`Extension` आइटम) को फ़ीड करती है। यह सीधे रन करने योग्य TS/JS एक्सटेंशन मॉड्यूल **लोड नहीं करती**।

रनटाइम मॉड्यूल लोडिंग (`discoverAndLoadExtensions()` / `loadExtensions()`) `extension-modules` और स्पष्ट पाथ का उपयोग करती है, और वर्तमान में ऑटो-डिस्कवर्ड मॉड्यूल को केवल प्रोवाइडर `native` तक फ़िल्टर करती है।

व्यावहारिक निहितार्थ:

- Gemini मैनिफेस्ट एक्सटेंशन क्षमता रिकॉर्ड के रूप में खोजे जा सकते हैं।
- वे स्वयं एक्सटेंशन लोडर पाइपलाइन द्वारा रनटाइम एक्सटेंशन मॉड्यूल के रूप में निष्पादित नहीं होते।

यह सीमा वर्तमान कार्यान्वयन में जानबूझकर है और बताती है कि मैनिफेस्ट डिस्कवरी और निष्पादन योग्य मॉड्यूल लोडिंग अलग क्यों हो सकती है।
