---
title: नेटिव्स बाइंडिंग कॉन्ट्रैक्ट (TypeScript पक्ष)
description: >-
  Rust नेटिव फ़ंक्शन में N-API के माध्यम से कॉल करने के लिए TypeScript-पक्षीय
  बाइंडिंग कॉन्ट्रैक्ट।
sidebar:
  order: 2
  label: बाइंडिंग कॉन्ट्रैक्ट
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# नेटिव्स बाइंडिंग कॉन्ट्रैक्ट (TypeScript पक्ष)

यह दस्तावेज़ TypeScript-पक्षीय कॉन्ट्रैक्ट को परिभाषित करता है जो `@f5-sales-demo/pi-natives` कॉलर्स और लोड किए गए N-API addon के बीच स्थित होता है।

यह तीन भागों पर केंद्रित है:

1. कॉन्ट्रैक्ट आकार (`NativeBindings` + मॉड्यूल ऑगमेंटेशन),
2. रैपर व्यवहार (`src/<module>/index.ts`),
3. पब्लिक एक्सपोर्ट सतह (`src/index.ts`)।

## इम्प्लीमेंटेशन फ़ाइलें

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

- `NativeBindings` (बेस इंटरफेस, वर्तमान में `cancelWork(id: number): void` शामिल है)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` कॉलबैक आकार जो N-API थ्रेडसेफ कॉलबैक द्वारा उपयोग किया जाता है

प्रत्येक मॉड्यूल डिक्लेरेशन मर्जिंग द्वारा अपने स्वयं के फ़ील्ड जोड़ता है:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

यह एक मोनोलिथिक केंद्रीय टाइप फ़ाइल के बिना एकल समग्र बाइंडिंग इंटरफेस बनाए रखता है।

## डिक्लेरेशन-मर्जिंग लाइफसाइकिल और स्टेट ट्रांज़िशन

### 1) कम्पाइल-टाइम टाइप असेंबली

- `bindings.ts` बेस `NativeBindings` सिंबल प्रदान करता है।
- प्रत्येक `src/<module>/types.ts` `NativeBindings` को ऑगमेंट करता है।
- `src/native.ts` सभी `./<module>/types` फ़ाइलों को साइड इफेक्ट्स के लिए इम्पोर्ट करता है ताकि मर्ज किया गया कॉन्ट्रैक्ट वहाँ स्कोप में हो जहाँ `NativeBindings` का उपयोग किया जाता है।

स्टेट ट्रांज़िशन: **बेस कॉन्ट्रैक्ट** → **मर्ज किया गया कॉन्ट्रैक्ट**।

### 2) रनटाइम addon लोड और वैलिडेशन गेट

- `src/native.ts` कैंडिडेट `.node` बाइनरी लोड करता है।
- लोड किए गए ऑब्जेक्ट को `NativeBindings` के रूप में माना जाता है और तुरंत `validateNative(...)` के माध्यम से पास किया जाता है।
- `validateNative` `typeof bindings[name] === "function"` द्वारा आवश्यक एक्सपोर्ट कीज़ को वेरीफाई करता है।

स्टेट ट्रांज़िशन: **अनट्रस्टेड addon ऑब्जेक्ट** → **वैलिडेटेड नेटिव बाइंडिंग ऑब्जेक्ट** (या हार्ड फेलियर)।

### 3) रैपर इनवोकेशन

- `src/<module>/index.ts` में मॉड्यूल रैपर `native.<export>` को कॉल करते हैं।
- रैपर डिफ़ॉल्ट और कॉलबैक आकार को अनुकूलित करते हैं (JS APIs में `(err, value)` से केवल-वैल्यू कॉलबैक पैटर्न)।
- `src/index.ts` मॉड्यूल रैपर/टाइप्स को पब्लिक पैकेज API के रूप में री-एक्सपोर्ट करता है।

स्टेट ट्रांज़िशन: **वैलिडेटेड रॉ बाइंडिंग** → **एर्गोनोमिक पब्लिक API**।

## रैपर की जिम्मेदारियाँ

रैपर जानबूझकर पतले होते हैं; वे नेटिव लॉजिक को फिर से इम्प्लीमेंट नहीं करते।

प्राथमिक जिम्मेदारियाँ:

- **आर्ग्युमेंट नॉर्मलाइज़ेशन/डिफ़ॉल्टिंग**
  - `glob()` `options.path` को ऐब्सोल्यूट पाथ पर रिज़ॉल्व करता है और `hidden`, `gitignore`, `recursive` को डिफ़ॉल्ट करता है।
  - `hasMatch()` नेटिव कॉल से पहले डिफ़ॉल्ट फ्लैग्स (`ignoreCase`, `multiline`) भरता है।
- **कॉलबैक अडैप्टेशन**
  - `grep()`, `glob()`, `executeShell()` `TsFunc<T>` (`error, value`) को केवल सफल मान प्राप्त करने वाले यूज़र कॉलबैक में कनवर्ट करते हैं।
- **नेटिव कॉल के आसपास एनवायरनमेंट या पॉलिसी व्यवहार**
  - क्लिपबोर्ड रैपर OSC52/Termux/हेडलेस हैंडलिंग जोड़ता है और कॉपी को बेस्ट एफर्ट मानता है।
- **पब्लिक नामकरण और री-एक्सपोर्ट क्यूरेशन**
  - `searchContent()` नेटिव एक्सपोर्ट `search` से मैप होता है।

## पब्लिक एक्सपोर्ट सतह संगठन

`packages/natives/src/index.ts` कैनोनिकल पब्लिक बैरल है। यह एक्सपोर्ट को क्षमता डोमेन के अनुसार समूहित करता है:

- सर्च/टेक्स्ट: `grep`, `glob`, `text`, `highlight`
- एक्ज़ीक्यूशन/प्रोसेस/टर्मिनल: `shell`, `pty`, `ps`, `keys`
- सिस्टम/मीडिया/कनवर्ज़न: `image`, `html`, `clipboard`, `system-info`, `work`

मेंटेनर नियम: यदि कोई रैपर `src/index.ts` से री-एक्सपोर्ट नहीं किया गया है, तो वह इच्छित पब्लिक पैकेज सतह का हिस्सा नहीं है।

## JS API ↔ नेटिव एक्सपोर्ट मैपिंग (प्रतिनिधि)

Rust पक्ष N-API एक्सपोर्ट नामों का उपयोग करता है (आमतौर पर `#[napi]` snake_case -> camelCase रूपांतरण से, और कभी-कभी स्पष्ट एलियास के साथ) जो इन बाइंडिंग कीज़ से मेल खाने चाहिए।

| श्रेणी | पब्लिक JS API (रैपर) | नेटिव बाइंडिंग की | रिटर्न टाइप | Async? |
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
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (बेस्ट एफर्ट रैपर व्यवहार) | हाँ |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | हाँ |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | नहीं |

## Sync बनाम async कॉन्ट्रैक्ट अंतर

कॉन्ट्रैक्ट sync और async APIs को मिश्रित करता है; रैपर एक मॉडल थोपने के बजाय नेटिव कॉल स्टाइल को संरक्षित करते हैं:

- **Promise-आधारित async एक्सपोर्ट** I/O या लंबे समय तक चलने वाले कार्य के लिए (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, क्लिपबोर्ड, इमेज ऑपरेशन)।
- **सिंक्रोनस एक्सपोर्ट** निर्धारक इन-मेमोरी ट्रांसफॉर्म/पार्सर के लिए (`search`, `hasMatch`, हाइलाइटिंग, टेक्स्ट विड्थ/स्लाइसिंग, की पार्सिंग, प्रोसेस क्वेरी)।
- **कंस्ट्रक्टर एक्सपोर्ट** स्टेटफुल रनटाइम ऑब्जेक्ट के लिए (`Shell`, `PtySession`, `PhotonImage`)।

मेंटेनर के लिए निहितार्थ: किसी मौजूदा एक्सपोर्ट के लिए sync ↔ async बदलना रैपर और कॉलर्स में एक ब्रेकिंग API और कॉन्ट्रैक्ट परिवर्तन है।

## ऑब्जेक्ट और enum टाइपिंग पैटर्न

### ऑब्जेक्ट पैटर्न (`#[napi(object)]`-स्टाइल JS ऑब्जेक्ट)

TS ऑब्जेक्ट-आकार के नेटिव मानों को इंटरफेस के रूप में मॉडल करता है, उदाहरण के लिए:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

ये कम्पाइल टाइम पर स्ट्रक्चरल कॉन्ट्रैक्ट हैं; रनटाइम आकार की शुद्धता नेटिव इम्प्लीमेंटेशन की जिम्मेदारी है।

### Enum पैटर्न

न्यूमेरिक नेटिव enum TS में `const enum` मानों के रूप में प्रदर्शित किए जाते हैं:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

कॉलर नामित enum सदस्य देखते हैं; बाइंडिंग बाउंड्री संख्याएँ पास करती है।

## मिसमैच कैसे पकड़े जाते हैं

मिसमैच डिटेक्शन दो परतों पर होती है:

1. **कम्पाइल-टाइम TypeScript कॉन्ट्रैक्ट चेक**
   - रैपर मर्ज किए गए `NativeBindings` के विरुद्ध `native.<name>` को कॉल करते हैं।
   - गायब/नाम बदले हुए बाइंडिंग कीज़ रैपर में TS टाइप-चेकिंग को तोड़ते हैं।

2. **`validateNative` में रनटाइम वैलिडेशन**
   - लोड के बाद, `native.ts` आवश्यक एक्सपोर्ट की जाँच करता है और यदि कोई गायब हो तो थ्रो करता है।
   - एरर मैसेज में गायब कीज़ और रिबिल्ड निर्देश शामिल हैं।

यह सामान्य स्टेल-बाइनरी ड्रिफ्ट को पकड़ता है: रैपर/टाइप मौजूद है लेकिन लोड किए गए `.node` में एक्सपोर्ट का अभाव है।

## फेलियर व्यवहार और चेतावनियाँ

### लोड/वैलिडेशन फेलियर (हार्ड फेलियर)

- Addon लोड फेलियर या असमर्थित प्लेटफ़ॉर्म `native.ts` में मॉड्यूल इनिट के दौरान थ्रो करता है।
- गायब आवश्यक एक्सपोर्ट रैपर उपयोग योग्य होने से पहले थ्रो करते हैं।

प्रभाव: पैकेज पहली कॉल तक फेलियर को स्थगित करने के बजाय तुरंत विफल होता है।

### रैपर-स्तर व्यवहार अंतर

- कुछ रैपर जानबूझकर फेलियर को नरम करते हैं (`copyToClipboard` बेस्ट एफर्ट है और नेटिव फेलियर को निगल लेता है)।
- स्ट्रीमिंग कॉलबैक कॉलबैक एरर पेलोड को नजरअंदाज करते हैं और केवल सफल वैल्यू इवेंट फॉरवर्ड करते हैं।

### टाइप-स्तर चेतावनियाँ (रनटाइम TS से अधिक सख्त)

- TS के ऑप्शनल फ़ील्ड सेमेंटिक वैलिडिटी की गारंटी नहीं देते; नेटिव परत अभी भी खराब रूप से गठित मानों को अस्वीकार कर सकती है।
- `const enum` टाइपिंग रनटाइम पर अनटाइप्ड कॉलर्स से रेंज से बाहर न्यूमेरिक मानों को नहीं रोकती।
- `validateNative` केवल आवश्यक एक्सपोर्ट की उपस्थिति/फ़ंक्शन-नेस की जाँच करता है, न कि गहरे आर्ग्युमेंट/रिटर्न-शेप कम्पैटिबिलिटी की।
- `bindings.ts` बेस इंटरफेस में `cancelWork(id)` शामिल करता है, लेकिन वर्तमान रनटाइम वैलिडेशन लिस्ट उस की को एनफोर्स नहीं करती।

## बाइंडिंग परिवर्तनों के लिए मेंटेनर चेकलिस्ट

कोई एक्सपोर्ट जोड़ते/बदलते समय, इन सभी को अपडेट करें:

1. `src/<module>/types.ts` (ऑगमेंटेशन + कॉन्ट्रैक्ट टाइप्स)
2. `src/<module>/index.ts` (रैपर व्यवहार)
3. मॉड्यूल टाइप्स के लिए `src/native.ts` इम्पोर्ट (यदि नया मॉड्यूल है)
4. `validateNative` आवश्यक एक्सपोर्ट चेक
5. `src/index.ts` पब्लिक री-एक्सपोर्ट

किसी भी चरण को छोड़ने से कम्पाइल-टाइम ड्रिफ्ट या रनटाइम लोड-टाइम फेलियर होता है।
