---
title: Natives Binding Contract (TypeScript Side)
description: >-
  N-API के माध्यम से Rust नेटिव फंक्शंस को कॉल करने के लिए TypeScript-साइड
  बाइंडिंग कॉन्ट्रैक्ट।
sidebar:
  order: 2
  label: Binding contract
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# Natives Binding Contract (TypeScript साइड)

यह दस्तावेज़ TypeScript-साइड कॉन्ट्रैक्ट को परिभाषित करता है जो `@f5xc-salesdemos/pi-natives` कॉलर्स और लोड किए गए N-API addon के बीच स्थित होता है।

यह तीन भागों पर केंद्रित है:

1. कॉन्ट्रैक्ट आकार (`NativeBindings` + मॉड्यूल ऑगमेंटेशन),
2. रैपर व्यवहार (`src/<module>/index.ts`),
3. पब्लिक एक्सपोर्ट सरफेस (`src/index.ts`)।

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
- `TsFunc<T>` कॉलबैक शेप जो N-API threadsafe कॉलबैक्स द्वारा उपयोग किया जाता है

प्रत्येक मॉड्यूल डिक्लेरेशन मर्जिंग के माध्यम से अपने फ़ील्ड जोड़ता है:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

यह एक एकीकृत बाइंडिंग इंटरफेस बनाए रखता है बिना किसी मोनोलिथिक सेंट्रल टाइप फ़ाइल के।

## डिक्लेरेशन-मर्जिंग जीवनचक्र और स्टेट ट्रांजिशन

### 1) कंपाइल-टाइम टाइप असेंबली

- `bindings.ts` बेस `NativeBindings` सिंबल प्रदान करता है।
- प्रत्येक `src/<module>/types.ts` `NativeBindings` को ऑगमेंट करता है।
- `src/native.ts` साइड इफेक्ट्स के लिए सभी `./<module>/types` फ़ाइलों को इम्पोर्ट करता है ताकि मर्ज किया गया कॉन्ट्रैक्ट उस स्कोप में हो जहाँ `NativeBindings` का उपयोग किया जाता है।

स्टेट ट्रांजिशन: **बेस कॉन्ट्रैक्ट** → **मर्ज्ड कॉन्ट्रैक्ट**।

### 2) रनटाइम addon लोड और वैलिडेशन गेट

- `src/native.ts` कैंडिडेट `.node` बाइनरीज़ लोड करता है।
- लोड किए गए ऑब्जेक्ट को `NativeBindings` के रूप में माना जाता है और तुरंत `validateNative(...)` के माध्यम से पास किया जाता है।
- `validateNative` `typeof bindings[name] === "function"` द्वारा आवश्यक एक्सपोर्ट कीज़ की जाँच करता है।

स्टेट ट्रांजिशन: **अविश्वसनीय addon ऑब्जेक्ट** → **वैलिडेटेड नेटिव बाइंडिंग ऑब्जेक्ट** (या हार्ड फेल्योर)।

### 3) रैपर इनवोकेशन

- `src/<module>/index.ts` में मॉड्यूल रैपर्स `native.<export>` को कॉल करते हैं।
- रैपर्स डिफॉल्ट्स और कॉलबैक शेप को अनुकूलित करते हैं (`(err, value)` से JS APIs में केवल-वैल्यू कॉलबैक पैटर्न)।
- `src/index.ts` पब्लिक पैकेज API के रूप में मॉड्यूल रैपर्स/टाइप्स को री-एक्सपोर्ट करता है।

स्टेट ट्रांजिशन: **वैलिडेटेड रॉ बाइंडिंग्स** → **एर्गोनोमिक पब्लिक API**।

## रैपर की ज़िम्मेदारियाँ

रैपर्स जानबूझकर पतले हैं; वे नेटिव लॉजिक को पुनः लागू नहीं करते।

प्राथमिक ज़िम्मेदारियाँ:

- **आर्गुमेंट नॉर्मलाइज़ेशन/डिफॉल्टिंग**
  - `glob()` `options.path` को एब्सोल्यूट पाथ में रिज़ॉल्व करता है और `hidden`, `gitignore`, `recursive` को डिफॉल्ट करता है।
  - `hasMatch()` नेटिव कॉल से पहले डिफॉल्ट फ्लैग्स (`ignoreCase`, `multiline`) भरता है।
- **कॉलबैक अनुकूलन**
  - `grep()`, `glob()`, `executeShell()` `TsFunc<T>` (`error, value`) को केवल सफल वैल्यूज़ प्राप्त करने वाले यूज़र कॉलबैक में बदलते हैं।
- **नेटिव कॉल्स के आसपास एनवायरनमेंट या पॉलिसी व्यवहार**
  - क्लिपबोर्ड रैपर OSC52/Termux/हेडलेस हैंडलिंग जोड़ता है और कॉपी को बेस्ट एफर्ट के रूप में मानता है।
- **पब्लिक नेमिंग और री-एक्सपोर्ट क्यूरेशन**
  - `searchContent()` नेटिव एक्सपोर्ट `search` पर मैप होता है।

## पब्लिक एक्सपोर्ट सरफेस संगठन

`packages/natives/src/index.ts` कैनोनिकल पब्लिक बैरल है। यह एक्सपोर्ट्स को क्षमता डोमेन के अनुसार समूहित करता है:

- सर्च/टेक्स्ट: `grep`, `glob`, `text`, `highlight`
- एक्ज़ीक्यूशन/प्रोसेस/टर्मिनल: `shell`, `pty`, `ps`, `keys`
- सिस्टम/मीडिया/कन्वर्शन: `image`, `html`, `clipboard`, `system-info`, `work`

मेंटेनर नियम: यदि कोई रैपर `src/index.ts` से री-एक्सपोर्ट नहीं किया गया है, तो वह इच्छित पब्लिक पैकेज सरफेस का हिस्सा नहीं है।

## JS API ↔ नेटिव एक्सपोर्ट मैपिंग (प्रतिनिधि)

Rust साइड N-API एक्सपोर्ट नामों का उपयोग करता है (आमतौर पर `#[napi]` snake_case -> camelCase कन्वर्शन से, कभी-कभी स्पष्ट एलियास के साथ) जो इन बाइंडिंग कीज़ से मेल खाने चाहिए।

| श्रेणी | पब्लिक JS API (रैपर) | नेटिव बाइंडिंग कुंजी | रिटर्न टाइप | एसिंक? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | हाँ |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | नहीं |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | नहीं |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | हाँ |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | हाँ |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | नहीं |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | हाँ |
| Shell | `Shell` | `Shell` | class constructor | N/A |
| PTY | `PtySession` | `PtySession` | class constructor | N/A |
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

## सिंक बनाम एसिंक कॉन्ट्रैक्ट अंतर

कॉन्ट्रैक्ट सिंक और एसिंक APIs को मिलाता है; रैपर्स एक मॉडल को बलपूर्वक लागू करने के बजाय नेटिव कॉल शैली को संरक्षित करते हैं:

- **Promise-आधारित एसिंक एक्सपोर्ट्स** I/O या लंबे समय तक चलने वाले कार्यों के लिए (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, क्लिपबोर्ड, इमेज ऑपरेशंस)।
- **सिंक्रोनस एक्सपोर्ट्स** निर्धारणात्मक इन-मेमोरी ट्रांसफॉर्म्स/पार्सर्स के लिए (`search`, `hasMatch`, हाइलाइटिंग, टेक्स्ट चौड़ाई/स्लाइसिंग, कुंजी पार्सिंग, प्रोसेस क्वेरीज़)।
- **कंस्ट्रक्टर एक्सपोर्ट्स** स्टेटफुल रनटाइम ऑब्जेक्ट्स के लिए (`Shell`, `PtySession`, `PhotonImage`)।

मेंटेनर्स के लिए निहितार्थ: किसी मौजूदा एक्सपोर्ट के लिए सिंक ↔ एसिंक बदलना रैपर्स और कॉलर्स दोनों में एक ब्रेकिंग API और कॉन्ट्रैक्ट परिवर्तन है।

## ऑब्जेक्ट और enum टाइपिंग पैटर्न

### ऑब्जेक्ट पैटर्न (`#[napi(object)]`-शैली JS ऑब्जेक्ट्स)

TS ऑब्जेक्ट-आकार के नेटिव वैल्यूज़ को इंटरफेस के रूप में मॉडल करता है, उदाहरण के लिए:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

ये कंपाइल टाइम पर स्ट्रक्चरल कॉन्ट्रैक्ट्स हैं; रनटाइम शेप शुद्धता नेटिव इम्प्लीमेंटेशन के स्वामित्व में है।

### Enum पैटर्न

न्यूमेरिक नेटिव enums को TS में `const enum` वैल्यूज़ के रूप में दर्शाया जाता है:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

कॉलर्स नामित enum सदस्यों को देखते हैं; बाइंडिंग सीमा नंबर पास करती है।

## मिसमैच कैसे पकड़े जाते हैं

मिसमैच डिटेक्शन दो स्तरों पर होता है:

1. **कंपाइल-टाइम TypeScript कॉन्ट्रैक्ट जाँच**
   - रैपर्स मर्ज किए गए `NativeBindings` के विरुद्ध `native.<name>` कॉल करते हैं।
   - गायब/पुनर्नामित बाइंडिंग कीज़ रैपर्स में TS टाइप-चेकिंग को तोड़ते हैं।

2. **`validateNative` में रनटाइम वैलिडेशन**
   - लोड के बाद, `native.ts` आवश्यक एक्सपोर्ट्स की जाँच करता है और कोई भी गायब होने पर थ्रो करता है।
   - त्रुटि संदेश में गायब कीज़ और रीबिल्ड निर्देश शामिल होते हैं।

यह सामान्य स्टेल-बाइनरी ड्रिफ्ट को पकड़ता है: रैपर/टाइप मौजूद है लेकिन लोड किए गए `.node` में एक्सपोर्ट नहीं है।

## विफलता व्यवहार और चेतावनियाँ

### लोड/वैलिडेशन विफलताएँ (हार्ड विफलताएँ)

- Addon लोड विफलता या असमर्थित प्लेटफॉर्म `native.ts` में मॉड्यूल इनिट के दौरान थ्रो करता है।
- गायब आवश्यक एक्सपोर्ट्स रैपर्स के उपयोग योग्य होने से पहले थ्रो करते हैं।

प्रभाव: पैकेज पहली कॉल तक विफलता को स्थगित करने के बजाय तेज़ी से विफल होता है।

### रैपर-स्तरीय व्यवहार अंतर

- कुछ रैपर्स जानबूझकर विफलताओं को नरम करते हैं (`copyToClipboard` बेस्ट एफर्ट है और नेटिव विफलता को निगल जाता है)।
- स्ट्रीमिंग कॉलबैक्स कॉलबैक एरर पेलोड को अनदेखा करते हैं और केवल सफल वैल्यू इवेंट्स को फॉरवर्ड करते हैं।

### टाइप-स्तरीय चेतावनियाँ (रनटाइम TS से अधिक सख्त)

- TS वैकल्पिक फ़ील्ड सिमेंटिक वैधता की गारंटी नहीं देते; नेटिव लेयर अभी भी विकृत वैल्यूज़ को अस्वीकार कर सकता है।
- `const enum` टाइपिंग रनटाइम पर अनटाइप्ड कॉलर्स से आउट-ऑफ-रेंज न्यूमेरिक वैल्यूज़ को नहीं रोकती।
- `validateNative` केवल आवश्यक एक्सपोर्ट्स की उपस्थिति/फंक्शन-नेस की जाँच करता है, गहरे आर्गुमेंट/रिटर्न-शेप संगतता की नहीं।
- `bindings.ts` बेस इंटरफेस में `cancelWork(id)` शामिल है, लेकिन वर्तमान रनटाइम वैलिडेशन सूची उस कुंजी को लागू नहीं करती।

## बाइंडिंग परिवर्तनों के लिए मेंटेनर चेकलिस्ट

कोई एक्सपोर्ट जोड़ते/बदलते समय, इन सभी को अपडेट करें:

1. `src/<module>/types.ts` (ऑगमेंटेशन + कॉन्ट्रैक्ट टाइप्स)
2. `src/<module>/index.ts` (रैपर व्यवहार)
3. `src/native.ts` मॉड्यूल टाइप्स के लिए इम्पोर्ट्स (यदि नया मॉड्यूल है)
4. `validateNative` आवश्यक एक्सपोर्ट जाँच
5. `src/index.ts` पब्लिक री-एक्सपोर्ट्स

किसी भी चरण को छोड़ने से या तो कंपाइल-टाइम ड्रिफ्ट या रनटाइम लोड-टाइम विफलता उत्पन्न होती है।
