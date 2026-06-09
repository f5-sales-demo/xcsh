---
title: pi-natives (N-API) में पोर्टिंग — फ़ील्ड नोट्स
description: >-
  Node.js child_process और shell कोड को Rust N-API नेटिव लेयर में माइग्रेट करने
  के लिए फ़ील्ड नोट्स।
sidebar:
  order: 9
  label: pi-natives में पोर्टिंग
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# pi-natives (N-API) में पोर्टिंग — फ़ील्ड नोट्स

यह हॉट पाथ्स को `crates/pi-natives` में स्थानांतरित करने और उन्हें JS बाइंडिंग्स के माध्यम से जोड़ने के लिए एक व्यावहारिक गाइड है। यह इसलिए मौजूद है ताकि एक ही विफलताएं दोबारा न हों।

## कब पोर्ट करें

जब इनमें से कोई भी सत्य हो तो पोर्ट करें:

- हॉट पाथ रेंडर लूप्स, तेज़ UI अपडेट्स, या बड़े बैचों में चलता है।
- JS एलोकेशन हावी हैं (स्ट्रिंग चर्न, regex बैकट्रैकिंग, बड़े ऐरे)।
- आपके पास पहले से JS बेसलाइन है और आप दोनों संस्करणों को साथ-साथ बेंचमार्क कर सकते हैं।
- कार्य CPU-बाउंड या ब्लॉकिंग I/O है जो libuv थ्रेड पूल पर चल सकता है।
- कार्य async I/O है जो Tokio के रनटाइम पर चल सकता है (जैसे, shell एक्ज़ीक्यूशन)।

उन पोर्ट्स से बचें जो JS-ओनली स्टेट या डायनामिक इम्पोर्ट्स पर निर्भर करते हैं। N-API एक्सपोर्ट्स शुद्ध, डेटा-इन/डेटा-आउट होने चाहिए। लंबे समय तक चलने वाले कार्य `task::blocking` (CPU-बाउंड/ब्लॉकिंग I/O) या `task::future` (async I/O) के माध्यम से कैंसलेशन के साथ जाने चाहिए।

## नेटिव एक्सपोर्ट की संरचना

**Rust पक्ष:**

- कार्यान्वयन `crates/pi-natives/src/<module>.rs` में रहता है। यदि आप नया मॉड्यूल जोड़ते हैं, तो इसे `crates/pi-natives/src/lib.rs` में रजिस्टर करें।
- `#[napi]` के साथ एक्सपोर्ट करें; snake_case एक्सपोर्ट्स स्वचालित रूप से camelCase में बदल जाते हैं। स्पष्ट `js_name` का उपयोग केवल वास्तविक एलियास/गैर-डिफ़ॉल्ट नामों के लिए करें। स्ट्रक्ट्स के लिए `#[napi(object)]` का उपयोग करें।
- CPU-बाउंड या ब्लॉकिंग कार्य के लिए `task::blocking(tag, cancel_token, work)` (देखें `crates/pi-natives/src/task.rs`) का उपयोग करें। async कार्य के लिए जिसे Tokio की आवश्यकता है (जैसे, shell सेशन) `task::future(env, tag, work)` का उपयोग करें। जब आप `timeoutMs` या `AbortSignal` एक्सपोज़ करते हैं तो `CancelToken` पास करें।

**JS पक्ष:**

- `packages/natives/src/bindings.ts` में बेस `NativeBindings` इंटरफ़ेस होता है।
- `packages/natives/src/<module>/types.ts` TS टाइप्स को परिभाषित करता है और डिक्लेरेशन मर्जिंग के माध्यम से `NativeBindings` को ऑगमेंट करता है।
- `packages/natives/src/native.ts` डिक्लेरेशन को सक्रिय करने के लिए प्रत्येक `<module>/types.ts` फ़ाइल को इम्पोर्ट करता है।
- `packages/natives/src/<module>/index.ts` `packages/natives/src/native.ts` से `native` बाइंडिंग को रैप करता है।
- `packages/natives/src/native.ts` एडऑन को लोड करता है और `validateNative` आवश्यक एक्सपोर्ट्स को लागू करता है।
- `packages/natives/src/index.ts` `packages/*` में कॉलर्स के लिए रैपर को री-एक्सपोर्ट करता है।

## पोर्टिंग चेकलिस्ट

1. **Rust कार्यान्वयन जोड़ें**

- कोर लॉजिक को एक सामान्य Rust फ़ंक्शन में रखें।
- यदि यह एक नया मॉड्यूल है, तो इसे `crates/pi-natives/src/lib.rs` में जोड़ें।
- इसे `#[napi]` के साथ एक्सपोज़ करें ताकि डिफ़ॉल्ट snake_case -> camelCase मैपिंग सुसंगत रहे।
- सिग्नेचर ओन्ड और सरल रखें: `String`, `Vec<String>`, `Uint8Array`, या बड़े स्ट्रिंग/बाइट इनपुट्स के लिए `Either<JsString, Uint8Array>`।
- CPU-बाउंड या ब्लॉकिंग कार्य के लिए `task::blocking` का उपयोग करें; async कार्य के लिए `task::future` का उपयोग करें। `CancelToken` पास करें और लंबे लूप्स के अंदर `heartbeat()` कॉल करें।

2. **JS बाइंडिंग्स जोड़ें**

- `packages/natives/src/<module>/types.ts` में टाइप्स और `NativeBindings` ऑगमेंटेशन जोड़ें।
- डिक्लेरेशन मर्जिंग ट्रिगर करने के लिए `packages/natives/src/native.ts` में `./<module>/types` इम्पोर्ट करें।
- `packages/natives/src/<module>/index.ts` में एक रैपर जोड़ें जो `native` को कॉल करता है।
- `packages/natives/src/index.ts` से री-एक्सपोर्ट करें।

3. **नेटिव वैलिडेशन अपडेट करें**

- `validateNative` (`packages/natives/src/native.ts`) में `checkFn("newExport")` जोड़ें।

4. **बेंचमार्क जोड़ें**

- बेंचमार्क को संबंधित पैकेज के बगल में रखें (`packages/tui/bench`, `packages/natives/bench`, या `packages/coding-agent/bench`)।
- एक ही रन में JS बेसलाइन और नेटिव संस्करण दोनों शामिल करें।
- `Bun.nanoseconds()` और एक निश्चित इटरेशन काउंट का उपयोग करें।
- बेंचमार्क इनपुट्स छोटे और यथार्थवादी रखें (हॉट पाथ में देखा गया वास्तविक डेटा)।

5. **नेटिव बाइनरी बिल्ड करें**

- `bun --cwd=packages/natives run build`
- `bun --cwd=packages/natives run build` का उपयोग करें और टेस्टिंग के दौरान लोडर डायग्नोस्टिक्स चाहिए तो `PI_DEV=1` सेट करें।

6. **बेंचमार्क चलाएं**

- `bun run packages/<pkg>/bench/<bench>.ts` (या `bun --cwd=packages/natives run bench`)

7. **उपयोग पर निर्णय लें**

- यदि नेटिव धीमा है, तो **JS रखें** और नेटिव एक्सपोर्ट को अप्रयुक्त छोड़ दें।
- यदि नेटिव तेज़ है, तो कॉल साइट्स को नेटिव रैपर पर स्विच करें।

## समस्याएं और उनसे बचने के तरीके

### 1) पुरानी `pi_natives.node` नए एक्सपोर्ट्स को रोकती है

लोडर `packages/natives/native` (`pi_natives.<platform>-<arch>.node`) में प्लेटफ़ॉर्म-टैग्ड बाइनरी को प्राथमिकता देता है। `PI_DEV=1` अब केवल लोडर डायग्नोस्टिक्स सक्षम करता है; यह अब अलग dev एडऑन फ़ाइलनाम पर स्विच नहीं करता। एक फ़ॉलबैक `pi_natives.node` भी है। कंपाइल्ड बाइनरीज़ `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` में एक्सट्रैक्ट होती हैं। यदि इनमें से कोई भी पुरानी है, तो एक्सपोर्ट्स अपडेट नहीं होंगे।

**समाधान:** रीबिल्ड करने से पहले पुरानी फ़ाइल हटाएं।

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

यदि आप कंपाइल्ड बाइनरी चला रहे हैं, तो कैश्ड एडऑन डायरेक्टरी हटाएं:

```bash
rm -rf ~/.xcsh/natives/<version>
```

फिर सत्यापित करें कि एक्सपोर्ट बाइनरी में मौजूद है:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) `validateNative` से "Missing exports" त्रुटियां

यह **अच्छा** है — यह साइलेंट मिसमैच को रोकता है। जब आप यह देखते हैं:

```
Native addon missing exports ... Missing: visibleWidth
```

इसका मतलब है आपकी बाइनरी पुरानी है, Rust एक्सपोर्ट नाम (या उपयोग किया गया स्पष्ट एलियास) JS नाम से मेल नहीं खाता, या एक्सपोर्ट कभी कंपाइल ही नहीं हुआ। बिल्ड और नामकरण मिसमैच को ठीक करें, वैलिडेशन को कमजोर न करें।

### 3) Rust सिग्नेचर मिसमैच

इसे सरल और ओन्ड रखें। `String`, `Vec<String>`, और `Uint8Array` काम करते हैं। पब्लिक एक्सपोर्ट्स में `&str` जैसे रेफरेंस से बचें। यदि आपको स्ट्रक्चर्ड डेटा चाहिए, तो इसे `#[napi(object)]` स्ट्रक्ट्स में रैप करें।

### 4) बेंचमार्किंग गलतियां

- अलग-अलग इनपुट्स या एलोकेशन की तुलना न करें।
- JS और नेटिव में समान इनपुट ऐरे का उपयोग करें।
- स्क्यू से बचने के लिए दोनों को एक ही बेंचमार्क फ़ाइल में चलाएं।

## बेंचमार्क टेम्पलेट

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## सत्यापन चेकलिस्ट

- `validateNative` पास होता है (कोई मिसिंग एक्सपोर्ट्स नहीं)।
- `NativeBindings` को `packages/natives/src/<module>/types.ts` में ऑगमेंट किया गया है और रैपर `packages/natives/src/index.ts` में री-एक्सपोर्ट किया गया है।
- `Object.keys(require(...))` में आपका नया एक्सपोर्ट शामिल है।
- बेंच नंबर PR/नोट्स में रिकॉर्ड किए गए हैं।
- कॉल साइट **केवल तभी** अपडेट किया गया जब नेटिव तेज़ या बराबर हो।

## अंगूठे का नियम

- यदि नेटिव धीमा है, तो **स्विच न करें**। भविष्य के कार्य के लिए एक्सपोर्ट रखें, लेकिन TUI को तेज़ पाथ पर ही रहना चाहिए।
- यदि नेटिव तेज़ है, तो कॉल साइट स्विच करें और रिग्रेशन पकड़ने के लिए बेंचमार्क बनाए रखें।
