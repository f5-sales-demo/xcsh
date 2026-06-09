---
title: नेटिव्स बाइंडिंग कॉन्ट्रैक्ट (TypeScript पक्ष)
description: >-
  N-API के माध्यम से Rust नेटिव फ़ंक्शन्स को कॉल करने के लिए TypeScript-पक्ष
  बाइंडिंग कॉन्ट्रैक्ट।
sidebar:
  order: 2
  label: बाइंडिंग कॉन्ट्रैक्ट
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# नेटिव्स बाइंडिंग कॉन्ट्रैक्ट (TypeScript पक्ष)

यह दस्तावेज़ TypeScript-पक्ष कॉन्ट्रैक्ट को परिभाषित करता है जो `@f5xc-salesdemos/pi-natives` कॉलर्स और लोडेड N-API एडऑन के बीच स्थित है।

यह तीन भागों पर केंद्रित है:

1. कॉन्ट्रैक्ट आकार (`NativeBindings` + मॉड्यूल ऑग्मेंटेशन),
2. रैपर व्यवहार (`src/<module>/index.ts`),
3. सार्वजनिक एक्सपोर्ट सरफ़ेस (`src/index.ts`)।

## कार्यान्वयन फ़ाइलें

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## कॉन्ट्रैक्ट मॉडल

`packages/natives/src/bindings.ts` बेस कॉन्ट्रैक्ट को परिभाषित करता है:

- `NativeBindings` (बेस इंटरफ़ेस, वर्तमान में `cancelWork(id: number): void` शामिल है)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` कॉलबैक शेप जिसका उपयोग N-API थ्रेडसेफ़ कॉलबैक्स द्वारा किया जाता है

प्रत्येक मॉड्यूल डिक्लेरेशन मर्जिंग द्वारा अपने स्वयं के फ़ील्ड जोड़ता है:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

यह एक एकीकृत बाइंडिंग इंटरफ़ेस बनाए रखता है बिना किसी मोनोलिथिक केंद्रीय टाइप फ़ाइल के।

## डिक्लेरेशन-मर्जिंग जीवनचक्र और स्टेट ट्रांज़िशन

### 1) कंपाइल-टाइम टाइप असेंबली

- `bindings.ts` बेस `NativeBindings` सिंबल प्रदान करता है।
- प्रत्येक `src/<module>/types.ts` `NativeBindings` को ऑग्मेंट करता है।
- `src/native.ts` सभी `./<module>/types` फ़ाइलों को साइड इफ़ेक्ट्स के लिए इम्पोर्ट करता है ताकि मर्ज्ड कॉन्ट्रैक्ट वहाँ स्कोप में हो जहाँ `NativeBindings` का उपयोग किया जाता है।

स्टेट ट्रांज़िशन: **बेस कॉन्ट्रैक्ट** → **मर्ज्ड कॉन्ट्रैक्ट**।

### 2) रनटाइम एडऑन लोड और वैलिडेशन गेट

- `src/native.ts` कैंडिडेट `.node` बाइनरीज़ को लोड करता है।
- लोडेड ऑब्जेक्ट को `NativeBindings` के रूप में ट्रीट किया जाता है और तुरंत `validateNative(...)` से गुज़ारा जाता है।
- `validateNative` `typeof bindings[name] === "function"` द्वारा आवश्यक एक्सपोर्ट कीज़ की जाँच करता है।

स्टेट ट्रांज़िशन: **अविश्वसनीय एडऑन ऑब्जेक्ट** → **वैलिडेटेड नेटिव बाइंडिंग ऑब्जेक्ट** (या हार्ड विफलता)।

### 3) रैपर इनवोकेशन

- `src/<module>/index.ts` में मॉड्यूल रैपर्स `native.<export>` को कॉल करते हैं।
- रैपर्स डिफ़ॉल्ट्स और कॉलबैक शेप को अनुकूलित करते हैं (JS APIs में `(err, value)` से केवल-वैल्यू कॉलबैक पैटर्न में)।
- `src/index.ts` मॉड्यूल रैपर्स/टाइप्स को सार्वजनिक पैकेज API के रूप में री-एक्सपोर्ट करता है।

स्टेट ट्रांज़िशन: **वैलिडेटेड रॉ बाइंडिंग्स** → **सुगम सार्वजनिक API**।

## रैपर ज़िम्मेदारियाँ

रैपर्स जानबूझकर पतले हैं; वे नेटिव लॉजिक को पुनः कार्यान्वित नहीं करते।

प्राथमिक ज़िम्मेदारियाँ:

- **आर्गुमेंट नॉर्मलाइज़ेशन/डिफ़ॉल्टिंग**
  - `glob()` `options.path` को एब्सोल्यूट पाथ में रिज़ॉल्व करता है और `hidden`, `gitignore`, `recursive` के लिए डिफ़ॉल्ट सेट करता है।
  - `hasMatch()` नेटिव कॉल से पहले डिफ़ॉल्ट फ़्लैग्स (`ignoreCase`, `multiline`) भरता है।
- **कॉलबैक अनुकूलन**
  - `grep()`, `glob()`, `executeShell()` `TsFunc<T>` (`error, value`) को केवल सफल वैल्यूज़ प्राप्त करने वाले यूज़र कॉलबैक में बदलते हैं।
- **नेटिव कॉल्स के आसपास एनवायरनमेंट या पॉलिसी व्यवहार**
  - क्लिपबोर्ड रैपर OSC52/Termux/हेडलेस हैंडलिंग जोड़ता है और कॉपी को बेस्ट एफ़र्ट के रूप में ट्रीट करता है।
- **सार्वजनिक नामकरण और री-एक्सपोर्ट क्यूरेशन**
  - `searchContent()` नेटिव एक्सपोर्ट `search` से मैप होता है।

## सार्वजनिक एक्सपोर्ट सरफ़ेस संगठन

`packages/natives/src/index.ts` कैनोनिकल सार्वजनिक बैरल है। यह एक्सपोर्ट्स को क्षमता डोमेन के अनुसार समूहित करता है:

- खोज/टेक्स्ट: `grep`, `glob`, `text`, `highlight`
- निष्पादन/प्रोसेस/टर्मिनल: `shell`, `pty`, `ps`, `keys`
- सिस्टम/मीडिया/कन्वर्शन: `image`, `html`, `clipboard`, `system-info`, `work`

मेंटेनर नियम: यदि कोई रैपर `src/index.ts` से री-एक्सपोर्ट नहीं किया गया है, तो वह इच्छित सार्वजनिक पैकेज सरफ़ेस का हिस्सा नहीं है।

## JS API ↔ नेटिव एक्सपोर्ट मैपिंग (प्रतिनिधि)

Rust पक्ष N-API एक्सपोर्ट नाम (आमतौर पर `#[napi]` snake_case -> camelCase कन्वर्शन से, कभी-कभी स्पष्ट एलियास के साथ) का उपयोग करता है जो इन बाइंडिंग कीज़ से मेल खाने चाहिए।

| श्रेणी | सार्वजनिक JS API (रैपर) | नेटिव बाइंडिंग की | रिटर्न टाइप | एसिंक? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | हाँ |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | नहीं |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | नहीं |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | हाँ |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | हाँ |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | नहीं |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | हाँ |
| Shell | `Shell` | `Shell` | क्लास कंस्ट्रक्टर | लागू नहीं |
| PTY | `PtySession` | `PtySession` | क्लास कंस्ट्रक्टर | लागू नहीं |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | नहीं |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | नहीं |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | नहीं |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | नहीं |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | हाँ |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | नहीं |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | नहीं |
| Process | `killTree(pid, signal)` | `killTree` | `number` | नहीं |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | नहीं |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (बेस्ट एफ़र्ट रैपर व्यवहार) | हाँ |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | हाँ |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | नहीं |

## सिंक बनाम एसिंक कॉन्ट्रैक्ट अंतर

कॉन्ट्रैक्ट सिंक और एसिंक APIs को मिलाता है; रैपर्स एक मॉडल को बाध्य करने के बजाय नेटिव कॉल शैली को संरक्षित करते हैं:

- **Promise-आधारित एसिंक एक्सपोर्ट्स** I/O या लंबे समय तक चलने वाले कार्यों के लिए (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, क्लिपबोर्ड, इमेज ऑपरेशन्स)।
- **सिंक्रोनस एक्सपोर्ट्स** निर्धारक इन-मेमोरी ट्रांसफ़ॉर्म्स/पार्सर्स के लिए (`search`, `hasMatch`, हाइलाइटिंग, टेक्स्ट विड्थ/स्लाइसिंग, की पार्सिंग, प्रोसेस क्वेरीज़)।
- **कंस्ट्रक्टर एक्सपोर्ट्स** स्टेटफ़ुल रनटाइम ऑब्जेक्ट्स के लिए (`Shell`, `PtySession`, `PhotonImage`)।

मेंटेनर्स के लिए निहितार्थ: किसी मौजूदा एक्सपोर्ट के लिए सिंक ↔ एसिंक बदलना रैपर्स और कॉलर्स दोनों में एक ब्रेकिंग API और कॉन्ट्रैक्ट परिवर्तन है।

## ऑब्जेक्ट और एनम टाइपिंग पैटर्न

### ऑब्जेक्ट पैटर्न (`#[napi(object)]`-शैली JS ऑब्जेक्ट्स)

TS ऑब्जेक्ट-शेप्ड नेटिव वैल्यूज़ को इंटरफ़ेस के रूप में मॉडल करता है, उदाहरण के लिए:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

ये कंपाइल टाइम पर स्ट्रक्चरल कॉन्ट्रैक्ट्स हैं; रनटाइम शेप शुद्धता नेटिव कार्यान्वयन के स्वामित्व में है।

### एनम पैटर्न

न्यूमेरिक नेटिव एनम्स को TS में `const enum` वैल्यूज़ के रूप में दर्शाया जाता है:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

कॉलर्स नामित एनम सदस्य देखते हैं; बाइंडिंग सीमा संख्याएँ पास करती है।

## विसंगतियाँ कैसे पकड़ी जाती हैं

विसंगति पहचान दो स्तरों पर होती है:

1. **कंपाइल-टाइम TypeScript कॉन्ट्रैक्ट जाँच**
   - रैपर्स मर्ज्ड `NativeBindings` के विरुद्ध `native.<name>` कॉल करते हैं।
   - गायब/नाम बदले गए बाइंडिंग कीज़ रैपर्स में TS टाइप-चेकिंग को तोड़ देते हैं।

2. **`validateNative` में रनटाइम वैलिडेशन**
   - लोड के बाद, `native.ts` आवश्यक एक्सपोर्ट्स की जाँच करता है और यदि कोई गायब है तो एरर थ्रो करता है।
   - एरर संदेश में गायब कीज़ और रीबिल्ड निर्देश शामिल हैं।

यह सामान्य स्टेल-बाइनरी ड्रिफ़्ट को पकड़ता है: रैपर/टाइप मौजूद है लेकिन लोडेड `.node` में एक्सपोर्ट नहीं है।

## विफलता व्यवहार और चेतावनियाँ

### लोड/वैलिडेशन विफलताएँ (हार्ड विफलताएँ)

- एडऑन लोड विफलता या असमर्थित प्लेटफ़ॉर्म `native.ts` में मॉड्यूल इनिट के दौरान एरर थ्रो करता है।
- गायब आवश्यक एक्सपोर्ट्स रैपर्स के उपयोग योग्य होने से पहले एरर थ्रो करते हैं।

प्रभाव: पैकेज पहली कॉल तक विफलता को टालने के बजाय तेज़ी से विफल होता है।

### रैपर-स्तर व्यवहार अंतर

- कुछ रैपर्स जानबूझकर विफलताओं को नरम करते हैं (`copyToClipboard` बेस्ट एफ़र्ट है और नेटिव विफलता को निगल लेता है)।
- स्ट्रीमिंग कॉलबैक्स कॉलबैक एरर पेलोड्स को अनदेखा करते हैं और केवल सफल वैल्यू इवेंट्स को फ़ॉरवर्ड करते हैं।

### टाइप-स्तर चेतावनियाँ (रनटाइम TS से अधिक सख्त)

- TS ऑप्शनल फ़ील्ड्स सिमैंटिक वैलिडिटी की गारंटी नहीं देते; नेटिव लेयर अभी भी गलत फ़ॉर्मेट वाली वैल्यूज़ को रिजेक्ट कर सकती है।
- `const enum` टाइपिंग रनटाइम पर अनटाइप्ड कॉलर्स से आउट-ऑफ़-रेंज न्यूमेरिक वैल्यूज़ को नहीं रोकती।
- `validateNative` केवल आवश्यक एक्सपोर्ट्स की उपस्थिति/फ़ंक्शन होने की जाँच करता है, गहरी आर्गुमेंट/रिटर्न-शेप संगतता की नहीं।
- `bindings.ts` बेस इंटरफ़ेस में `cancelWork(id)` शामिल करता है, लेकिन वर्तमान रनटाइम वैलिडेशन सूची उस की को लागू नहीं करती।

## बाइंडिंग परिवर्तनों के लिए मेंटेनर चेकलिस्ट

किसी एक्सपोर्ट को जोड़ते/बदलते समय, इन सभी को अपडेट करें:

1. `src/<module>/types.ts` (ऑग्मेंटेशन + कॉन्ट्रैक्ट टाइप्स)
2. `src/<module>/index.ts` (रैपर व्यवहार)
3. `src/native.ts` मॉड्यूल टाइप्स के लिए इम्पोर्ट्स (यदि नया मॉड्यूल है)
4. `validateNative` आवश्यक एक्सपोर्ट जाँचें
5. `src/index.ts` सार्वजनिक री-एक्सपोर्ट्स

किसी भी चरण को छोड़ने से या तो कंपाइल-टाइम ड्रिफ़्ट या रनटाइम लोड-टाइम विफलता उत्पन्न होती है।
