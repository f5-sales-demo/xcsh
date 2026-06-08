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

यह हॉट पाथ्स को `crates/pi-natives` में ले जाने और उन्हें JS बाइंडिंग्स के माध्यम से वायर करने के लिए एक व्यावहारिक गाइड है। यह इसलिए मौजूद है ताकि एक ही विफलताएं दोबारा न हों।

## कब पोर्ट करें

जब इनमें से कोई भी सत्य हो तब पोर्ट करें:

- हॉट पाथ रेंडर लूप्स, तेज़ UI अपडेट्स, या बड़े बैचेस में चलता है।
- JS एलोकेशन्स हावी हों (स्ट्रिंग चर्न, regex बैकट्रैकिंग, बड़े arrays)।
- आपके पास पहले से JS बेसलाइन है और आप दोनों वर्शन्स की साथ-साथ बेंचमार्किंग कर सकते हैं।
- कार्य CPU-बाउंड है या ब्लॉकिंग I/O है जो libuv थ्रेड पूल पर चल सकता है।
- कार्य async I/O है जो Tokio के रनटाइम पर चल सकता है (उदा., shell एक्सीक्यूशन)।

उन पोर्ट्स से बचें जो JS-ओनली स्टेट या डायनामिक इम्पोर्ट्स पर निर्भर करते हैं। N-API एक्सपोर्ट्स प्योर होने चाहिए, data-in/data-out। लंबे समय तक चलने वाले कार्य को `task::blocking` (CPU-बाउंड/ब्लॉकिंग I/O) या `task::future` (async I/O) के माध्यम से कैंसिलेशन के साथ भेजा जाना चाहिए।

## नेटिव एक्सपोर्ट की संरचना

**Rust साइड:**

- इम्प्लीमेंटेशन `crates/pi-natives/src/<module>.rs` में रहता है। यदि आप नया मॉड्यूल जोड़ते हैं, तो इसे `crates/pi-natives/src/lib.rs` में रजिस्टर करें।
- `#[napi]` के साथ एक्सपोर्ट करें; snake_case एक्सपोर्ट्स स्वचालित रूप से camelCase में बदल जाते हैं। स्पष्ट `js_name` केवल वास्तविक aliases/गैर-डिफ़ॉल्ट नामों के लिए उपयोग करें। स्ट्रक्ट्स के लिए `#[napi(object)]` उपयोग करें।
- CPU-बाउंड या ब्लॉकिंग कार्य के लिए `task::blocking(tag, cancel_token, work)` उपयोग करें (देखें `crates/pi-natives/src/task.rs`)। Async कार्य के लिए जिसे Tokio की आवश्यकता है (उदा., shell sessions) `task::future(env, tag, work)` उपयोग करें। जब आप `timeoutMs` या `AbortSignal` एक्सपोज़ करें तो `CancelToken` पास करें।

**JS साइड:**

- `packages/natives/src/bindings.ts` में बेस `NativeBindings` इंटरफ़ेस होता है।
- `packages/natives/src/<module>/types.ts` TS टाइप्स परिभाषित करता है और declaration merging के माध्यम से `NativeBindings` को ऑगमेंट करता है।
- `packages/natives/src/native.ts` declarations को सक्रिय करने के लिए प्रत्येक `<module>/types.ts` फ़ाइल इम्पोर्ट करता है।
- `packages/natives/src/<module>/index.ts` `packages/natives/src/native.ts` से `native` बाइंडिंग को रैप करता है।
- `packages/natives/src/native.ts` addon लोड करता है और `validateNative` आवश्यक एक्सपोर्ट्स को लागू करता है।
- `packages/natives/src/index.ts` `packages/*` में कॉलर्स के लिए रैपर को री-एक्सपोर्ट करता है।

## पोर्टिंग चेकलिस्ट

1. **Rust इम्प्लीमेंटेशन जोड़ें**

- कोर लॉजिक को एक सादे Rust फ़ंक्शन में रखें।
- यदि यह नया मॉड्यूल है, तो इसे `crates/pi-natives/src/lib.rs` में जोड़ें।
- `#[napi]` के साथ एक्सपोज़ करें ताकि डिफ़ॉल्ट snake_case -> camelCase मैपिंग सुसंगत रहे।
- सिग्नेचर्स को owned और सरल रखें: `String`, `Vec<String>`, `Uint8Array`, या बड़े string/byte इनपुट्स के लिए `Either<JsString, Uint8Array>`।
- CPU-बाउंड या ब्लॉकिंग कार्य के लिए `task::blocking` उपयोग करें; async कार्य के लिए `task::future` उपयोग करें। `CancelToken` पास करें और लंबे लूप्स के अंदर `heartbeat()` कॉल करें।

2. **JS बाइंडिंग्स वायर करें**

- `packages/natives/src/<module>/types.ts` में टाइप्स और `NativeBindings` ऑगमेंटेशन जोड़ें।
- Declaration merging ट्रिगर करने के लिए `packages/natives/src/native.ts` में `./<module>/types` इम्पोर्ट करें।
- `packages/natives/src/<module>/index.ts` में एक रैपर जोड़ें जो `native` को कॉल करे।
- `packages/natives/src/index.ts` से री-एक्सपोर्ट करें।

3. **नेटिव वैलिडेशन अपडेट करें**

- `validateNative` (`packages/natives/src/native.ts`) में `checkFn("newExport")` जोड़ें।

4. **बेंचमार्क जोड़ें**

- बेंचमार्क्स को ओनिंग पैकेज के बगल में रखें (`packages/tui/bench`, `packages/natives/bench`, या `packages/coding-agent/bench`)।
- एक ही रन में JS बेसलाइन और नेटिव वर्शन दोनों शामिल करें।
- `Bun.nanoseconds()` और एक निश्चित इटरेशन काउंट का उपयोग करें।
- बेंचमार्क इनपुट्स को छोटा और यथार्थवादी रखें (हॉट पाथ में देखा गया वास्तविक डेटा)।

5. **नेटिव बाइनरी बिल्ड करें**

- `bun --cwd=packages/natives run build`
- `bun --cwd=packages/natives run build` उपयोग करें और टेस्टिंग के दौरान लोडर डायग्नोस्टिक्स चाहिए तो `PI_DEV=1` सेट करें।

6. **बेंचमार्क चलाएं**

- `bun run packages/<pkg>/bench/<bench>.ts` (या `bun --cwd=packages/natives run bench`)

7. **उपयोग पर निर्णय लें**

- यदि नेटिव धीमा है, तो **JS रखें** और नेटिव एक्सपोर्ट को अनुपयुक्त छोड़ दें।
- यदि नेटिव तेज़ है, तो कॉल साइट्स को नेटिव रैपर पर स्विच करें।

## समस्या बिंदु और उनसे कैसे बचें

### 1) पुराना `pi_natives.node` नए एक्सपोर्ट्स को रोकता है

लोडर `packages/natives/native` में प्लेटफ़ॉर्म-टैग्ड बाइनरी (`pi_natives.<platform>-<arch>.node`) को प्राथमिकता देता है। `PI_DEV=1` अब केवल लोडर डायग्नोस्टिक्स सक्षम करता है; यह अब अलग dev addon फ़ाइलनाम पर स्विच नहीं करता। एक फ़ॉलबैक `pi_natives.node` भी है। कम्पाइल्ड बाइनरीज़ `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` में एक्सट्रैक्ट होती हैं। यदि इनमें से कोई भी पुराना है, तो एक्सपोर्ट्स अपडेट नहीं होंगे।

**समाधान:** रीबिल्ड करने से पहले पुरानी फ़ाइल हटाएं।

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

यदि आप कम्पाइल्ड बाइनरी चला रहे हैं, तो कैश्ड addon डायरेक्टरी हटाएं:

```bash
rm -rf ~/.xcsh/natives/<version>
```

फिर सत्यापित करें कि एक्सपोर्ट बाइनरी में मौजूद है:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) `validateNative` से "Missing exports" एरर

यह **अच्छी बात** है — यह साइलेंट मिसमैच को रोकता है। जब आप यह देखें:

```
Native addon missing exports ... Missing: visibleWidth
```

इसका मतलब है कि आपकी बाइनरी पुरानी है, Rust एक्सपोर्ट नाम (या उपयोग किए जाने पर स्पष्ट alias) JS नाम से मेल नहीं खाता, या एक्सपोर्ट कभी कम्पाइल ही नहीं हुआ। बिल्ड और नामकरण मिसमैच ठीक करें, वैलिडेशन को कमज़ोर न करें।

### 3) Rust सिग्नेचर मिसमैच

इसे सरल और owned रखें। `String`, `Vec<String>`, और `Uint8Array` काम करते हैं। पब्लिक एक्सपोर्ट्स में `&str` जैसे रेफ़रेंसेज़ से बचें। यदि आपको स्ट्रक्चर्ड डेटा चाहिए, तो इसे `#[napi(object)]` स्ट्रक्ट्स में रैप करें।

### 4) बेंचमार्किंग गलतियां

- अलग-अलग इनपुट्स या एलोकेशन्स की तुलना न करें।
- JS और नेटिव दोनों को समान इनपुट arrays का उपयोग करने दें।
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

- `validateNative` पास होता है (कोई missing exports नहीं)।
- `NativeBindings` `packages/natives/src/<module>/types.ts` में ऑगमेंट किया गया है और रैपर `packages/natives/src/index.ts` में री-एक्सपोर्ट किया गया है।
- `Object.keys(require(...))` में आपका नया एक्सपोर्ट शामिल है।
- बेंच नंबर्स PR/नोट्स में रिकॉर्ड किए गए हैं।
- कॉल साइट **केवल तभी** अपडेट की गई जब नेटिव तेज़ या बराबर हो।

## अंगूठे का नियम

- यदि नेटिव धीमा है, तो **स्विच न करें**। भविष्य के कार्य के लिए एक्सपोर्ट रखें, लेकिन TUI को तेज़ पाथ पर ही रहना चाहिए।
- यदि नेटिव तेज़ है, तो कॉल साइट स्विच करें और रिग्रेशन पकड़ने के लिए बेंचमार्क यथास्थान रखें।
