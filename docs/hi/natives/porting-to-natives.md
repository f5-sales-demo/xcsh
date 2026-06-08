---
title: pi-natives (N-API) में पोर्टिंग — फील्ड नोट्स
description: >-
  Node.js child_process और shell कोड को Rust N-API native layer में माइग्रेट
  करने के लिए फील्ड नोट्स।
sidebar:
  order: 9
  label: pi-natives में पोर्टिंग
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# pi-natives (N-API) में पोर्टिंग — फील्ड नोट्स

यह हॉट पाथ्स को `crates/pi-natives` में ले जाने और उन्हें JS बाइंडिंग्स के माध्यम से जोड़ने के लिए एक व्यावहारिक गाइड है। यह इसलिए मौजूद है ताकि एक ही विफलताएँ दोबारा न हों।

## कब पोर्ट करें

जब इनमें से कोई भी सत्य हो तो पोर्ट करें:

- हॉट पाथ रेंडर लूप्स, तेज UI अपडेट्स, या बड़े बैचेस में चलता है।
- JS आवंटन प्रमुख हैं (स्ट्रिंग चर्न, regex बैकट्रैकिंग, बड़े arrays)।
- आपके पास पहले से JS बेसलाइन है और आप दोनों संस्करणों को साथ-साथ बेंचमार्क कर सकते हैं।
- कार्य CPU-बाउंड है या ब्लॉकिंग I/O है जो libuv थ्रेड पूल पर चल सकता है।
- कार्य async I/O है जो Tokio के रनटाइम पर चल सकता है (जैसे, shell execution)।

ऐसे पोर्ट्स से बचें जो JS-only स्टेट या डायनामिक imports पर निर्भर करते हैं। N-API exports शुद्ध, data-in/data-out होने चाहिए। लंबे समय तक चलने वाले कार्य `task::blocking` (CPU-बाउंड/ब्लॉकिंग I/O) या `task::future` (async I/O) के माध्यम से cancellation के साथ जाने चाहिए।

## एक native export की संरचना

**Rust पक्ष:**

- कार्यान्वयन `crates/pi-natives/src/<module>.rs` में होता है। यदि आप एक नया मॉड्यूल जोड़ते हैं, तो इसे `crates/pi-natives/src/lib.rs` में रजिस्टर करें।
- `#[napi]` के साथ एक्सपोर्ट करें; snake_case exports स्वचालित रूप से camelCase में बदल जाते हैं। स्पष्ट `js_name` का उपयोग केवल वास्तविक aliases/गैर-डिफ़ॉल्ट नामों के लिए करें। structs के लिए `#[napi(object)]` का उपयोग करें।
- CPU-बाउंड या ब्लॉकिंग कार्य के लिए `task::blocking(tag, cancel_token, work)` (देखें `crates/pi-natives/src/task.rs`) का उपयोग करें। async कार्य के लिए जिसे Tokio की आवश्यकता है (जैसे, shell sessions) `task::future(env, tag, work)` का उपयोग करें। जब आप `timeoutMs` या `AbortSignal` एक्सपोज़ करते हैं तो `CancelToken` पास करें।

**JS पक्ष:**

- `packages/natives/src/bindings.ts` में बेस `NativeBindings` इंटरफ़ेस होता है।
- `packages/natives/src/<module>/types.ts` TS प्रकार परिभाषित करता है और declaration merging के माध्यम से `NativeBindings` को augment करता है।
- `packages/natives/src/native.ts` declarations को सक्रिय करने के लिए प्रत्येक `<module>/types.ts` फाइल को import करता है।
- `packages/natives/src/<module>/index.ts` `packages/natives/src/native.ts` से `native` बाइंडिंग को wrap करता है।
- `packages/natives/src/native.ts` addon लोड करता है और `validateNative` आवश्यक exports को enforce करता है।
- `packages/natives/src/index.ts` `packages/*` में कॉलर्स के लिए wrapper को re-export करता है।

## पोर्टिंग चेकलिस्ट

1. **Rust कार्यान्वयन जोड़ें**

- मुख्य लॉजिक को एक सामान्य Rust फंक्शन में रखें।
- यदि यह एक नया मॉड्यूल है, तो इसे `crates/pi-natives/src/lib.rs` में जोड़ें।
- इसे `#[napi]` के साथ एक्सपोज़ करें ताकि डिफ़ॉल्ट snake_case -> camelCase मैपिंग सुसंगत रहे।
- सिग्नेचर owned और सरल रखें: `String`, `Vec<String>`, `Uint8Array`, या बड़े string/byte inputs के लिए `Either<JsString, Uint8Array>`।
- CPU-बाउंड या ब्लॉकिंग कार्य के लिए `task::blocking` का उपयोग करें; async कार्य के लिए `task::future` का उपयोग करें। एक `CancelToken` पास करें और लंबे लूप्स के अंदर `heartbeat()` कॉल करें।

2. **JS बाइंडिंग्स जोड़ें**

- `packages/natives/src/<module>/types.ts` में types और `NativeBindings` augmentation जोड़ें।
- Declaration merging ट्रिगर करने के लिए `packages/natives/src/native.ts` में `./<module>/types` import करें।
- `packages/natives/src/<module>/index.ts` में एक wrapper जोड़ें जो `native` को कॉल करता है।
- `packages/natives/src/index.ts` से re-export करें।

3. **Native validation अपडेट करें**

- `validateNative` (`packages/natives/src/native.ts`) में `checkFn("newExport")` जोड़ें।

4. **बेंचमार्क जोड़ें**

- बेंचमार्क को स्वामी पैकेज के पास रखें (`packages/tui/bench`, `packages/natives/bench`, या `packages/coding-agent/bench`)।
- एक ही रन में JS बेसलाइन और native संस्करण दोनों शामिल करें।
- `Bun.nanoseconds()` और एक निश्चित iteration count का उपयोग करें।
- बेंचमार्क inputs छोटे और यथार्थवादी रखें (हॉट पाथ में दिखने वाला वास्तविक डेटा)।

5. **Native बाइनरी बिल्ड करें**

- `bun --cwd=packages/natives run build`
- `bun --cwd=packages/natives run build` का उपयोग करें और यदि आप टेस्टिंग के दौरान loader diagnostics चाहते हैं तो `PI_DEV=1` सेट करें।

6. **बेंचमार्क चलाएं**

- `bun run packages/<pkg>/bench/<bench>.ts` (या `bun --cwd=packages/natives run bench`)

7. **उपयोग पर निर्णय लें**

- यदि native धीमा है, तो **JS रखें** और native export को अप्रयुक्त छोड़ दें।
- यदि native तेज है, तो कॉल साइट्स को native wrapper पर स्विच करें।

## समस्या बिंदु और उनसे बचने के तरीके

### 1) पुराना `pi_natives.node` नए exports को रोकता है

लोडर `packages/natives/native` में प्लेटफॉर्म-टैग्ड बाइनरी (`pi_natives.<platform>-<arch>.node`) को प्राथमिकता देता है। `PI_DEV=1` अब केवल loader diagnostics सक्षम करता है; यह अब एक अलग dev addon फ़ाइलनाम पर स्विच नहीं करता। एक फ़ॉलबैक `pi_natives.node` भी है। संकलित बाइनरी `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` में extract होती हैं। यदि इनमें से कोई भी पुरानी है, तो exports अपडेट नहीं होंगे।

**समाधान:** रीबिल्ड करने से पहले पुरानी फ़ाइल हटाएं।

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

यदि आप एक संकलित बाइनरी चला रहे हैं, तो कैश्ड addon डायरेक्टरी हटाएं:

```bash
rm -rf ~/.xcsh/natives/<version>
```

फिर सत्यापित करें कि export बाइनरी में मौजूद है:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) `validateNative` से "Missing exports" त्रुटियाँ

यह **अच्छी बात है** — यह मूक बेमेलों को रोकता है। जब आप यह देखें:

```
Native addon missing exports ... Missing: visibleWidth
```

इसका मतलब है कि आपकी बाइनरी पुरानी है, Rust export नाम (या उपयोग किए जाने पर स्पष्ट alias) JS नाम से मेल नहीं खाता, या export कभी compile नहीं हुआ। बिल्ड और नामकरण बेमेल को ठीक करें, validation को कमजोर न करें।

### 3) Rust सिग्नेचर बेमेल

इसे सरल और owned रखें। `String`, `Vec<String>`, और `Uint8Array` काम करते हैं। पब्लिक exports में `&str` जैसे references से बचें। यदि आपको स्ट्रक्चर्ड डेटा चाहिए, तो इसे `#[napi(object)]` structs में wrap करें।

### 4) बेंचमार्किंग गलतियाँ

- विभिन्न inputs या allocations की तुलना न करें।
- JS और native दोनों को समान input arrays का उपयोग करने दें।
- दोनों को एक ही बेंचमार्क फ़ाइल में चलाएं ताकि विषमता से बचा जा सके।

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
- `NativeBindings` `packages/natives/src/<module>/types.ts` में augment किया गया है और wrapper `packages/natives/src/index.ts` में re-export किया गया है।
- `Object.keys(require(...))` में आपका नया export शामिल है।
- PR/नोट्स में बेंच नंबर दर्ज हैं।
- कॉल साइट **केवल तभी** अपडेट किया गया जब native तेज या बराबर हो।

## अंगूठे का नियम

- यदि native धीमा है, तो **स्विच न करें**। भविष्य के कार्य के लिए export रखें, लेकिन TUI को तेज पाथ पर रहना चाहिए।
- यदि native तेज है, तो कॉल साइट स्विच करें और regressions पकड़ने के लिए बेंचमार्क बनाए रखें।
