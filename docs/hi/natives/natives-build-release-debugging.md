---
title: 'Natives Build, Release, and Debugging Runbook'
description: >-
  Build, release, and debugging runbook for the Rust native addon across
  platforms.
sidebar:
  order: 8
  label: 'Build, release & debugging'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Natives बिल्ड, रिलीज़ और डिबगिंग रनबुक

यह रनबुक बताती है कि `@f5xc-salesdemos/pi-natives` बिल्ड पाइपलाइन `.node` एडऑन कैसे उत्पन्न करती है, कम्पाइल्ड डिस्ट्रीब्यूशन उन्हें कैसे लोड करते हैं, और लोडर/बिल्ड विफलताओं को कैसे डिबग करें।

यह `docs/natives-architecture.md` से आर्किटेक्चर शब्दावली का अनुसरण करती है:

- **बिल्ड-टाइम आर्टिफैक्ट उत्पादन** (`scripts/build-native.ts`)
- **एम्बेडेड एडऑन मैनिफेस्ट जनरेशन** (`scripts/embed-native.ts`)
- **रनटाइम एडऑन लोडिंग + वैलिडेशन गेट** (`src/native.ts`)

## कार्यान्वयन फ़ाइलें

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## बिल्ड पाइपलाइन अवलोकन

### 1) बिल्ड एंट्रीपॉइंट

`packages/natives/package.json` स्क्रिप्ट्स:

- `bun scripts/build-native.ts` (`build`) → रिलीज़ बिल्ड
- `bun scripts/build-native.ts --dev` (`dev:native`) → डिबग/डेव प्रोफाइल बिल्ड (समान आउटपुट नामकरण)
- `bun scripts/embed-native.ts` (`embed:native`) → बिल्ड की गई फ़ाइलों से `src/embedded-addon.ts` जनरेट करें

### 2) Rust आर्टिफैक्ट बिल्ड

`build-native.ts` `crates/pi-natives` में Cargo चलाता है:

- बेस कमांड: `cargo build`
- रिलीज़ मोड `--release` जोड़ता है जब तक `--dev` पास न किया जाए
- क्रॉस टार्गेट `--target <CROSS_TARGET>` जोड़ता है

`crates/pi-natives/Cargo.toml` में `crate-type = ["cdylib"]` घोषित है, इसलिए Cargo एक शेयर्ड लाइब्रेरी (`.so`/`.dylib`/`.dll`) उत्सर्जित करता है जिसे फिर `.node` एडऑन फ़ाइलनाम में कॉपी/रीनेम किया जाता है।

### 3) आर्टिफैक्ट खोज और इंस्टॉल

Cargo पूरा होने के बाद, `build-native.ts` क्रम में कैंडिडेट आउटपुट डायरेक्टरी स्कैन करता है:

1. `${CARGO_TARGET_DIR}` (यदि सेट हो)
2. `<repo>/target`
3. `crates/pi-natives/target`

प्रत्येक रूट के लिए यह प्रोफाइल डायरेक्टरी जाँचता है:

- क्रॉस बिल्ड: `<root>/<crossTarget>/<profile>` फिर `<root>/<profile>`
- नेटिव बिल्ड: `<root>/<profile>`

फिर यह इनमें से किसी एक की तलाश करता है:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

मिलने पर, यह temp-file + rename सेमांटिक्स के साथ `packages/natives/native/` में एटॉमिक रूप से इंस्टॉल करता है (Windows फ़ॉलबैक लॉक्ड DLL रिप्लेसमेंट विफलताओं को स्पष्ट रूप से हैंडल करता है)।

## टार्गेट/वेरिएंट मॉडल और नामकरण परंपराएँ

## प्लेटफ़ॉर्म टैग

बिल्ड और रनटाइम दोनों प्लेटफ़ॉर्म टैग का उपयोग करते हैं:

`<platform>-<arch>` (उदाहरण: `darwin-arm64`, `linux-x64`)

## वेरिएंट मॉडल (केवल x64)

x64 CPU वेरिएंट सपोर्ट करता है:

- `modern` (AVX2-सक्षम पथ)
- `baseline` (फ़ॉलबैक)

गैर-x64 एक डिफ़ॉल्ट आर्टिफैक्ट का उपयोग करता है (कोई वेरिएंट सफ़िक्स नहीं)।

### आउटपुट फ़ाइलनाम

रिलीज़ बिल्ड:

- x64: `pi_natives.<platform>-<arch>-modern.node` या `...-baseline.node`
- गैर-x64: `pi_natives.<platform>-<arch>.node`

डेव बिल्ड (`--dev`):

- डिबग प्रोफाइल फ़्लैग का उपयोग करता है लेकिन मानक प्लेटफ़ॉर्म-टैग्ड आउटपुट नामकरण बनाए रखता है

`native.ts` में रनटाइम लोडर कैंडिडेट क्रम:

- रिलीज़ कैंडिडेट
- कम्पाइल्ड मोड पैकेज-लोकल फ़ाइलों से पहले एक्सट्रैक्टेड/कैश कैंडिडेट जोड़ता है

## एनवायरनमेंट फ़्लैग और बिल्ड विकल्प

## रनटाइम फ़्लैग

- `PI_DEV` (लोडर व्यवहार): लोडर डायग्नोस्टिक्स सक्षम करें
- `PI_NATIVE_VARIANT` (लोडर व्यवहार, केवल x64): रनटाइम पर `modern` या `baseline` चयन बाध्य करें
- `PI_COMPILED` (लोडर व्यवहार): कम्पाइल्ड-बाइनरी कैंडिडेट/एक्सट्रैक्शन व्यवहार सक्षम करें

## बिल्ड-टाइम फ़्लैग/विकल्प

- `--dev` (स्क्रिप्ट आर्ग): डिबग प्रोफाइल बिल्ड
- `CROSS_TARGET`: Cargo `--target` को पास किया जाता है
- `TARGET_PLATFORM`: आउटपुट प्लेटफ़ॉर्म टैग नामकरण ओवरराइड
- `TARGET_ARCH`: आउटपुट आर्क नामकरण ओवरराइड
- `TARGET_VARIANT` (केवल x64): आउटपुट फ़ाइलनाम और RUSTFLAGS नीति के लिए `modern` या `baseline` बाध्य करें
- `CARGO_TARGET_DIR`: Cargo आउटपुट खोजते समय अतिरिक्त रूट
- `RUSTFLAGS`:
  - यदि अनसेट है और क्रॉस-कम्पाइलिंग नहीं हो रही, स्क्रिप्ट सेट करती है:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - गैर-x64 / कोई वेरिएंट नहीं: `-C target-cpu=native`
  - यदि पहले से सेट है, स्क्रिप्ट ओवरराइड नहीं करती

## बिल्ड स्टेट/लाइफसाइकल ट्रांज़िशन

### बिल्ड लाइफसाइकल (`build-native.ts`)

1. **Init**: आर्ग/env पार्स करें (`--dev`, टार्गेट ओवरराइड, क्रॉस फ़्लैग)
2. **वेरिएंट रिज़ॉल्व**:
   - गैर-x64 → कोई वेरिएंट नहीं
   - x64 + `TARGET_VARIANT` → स्पष्ट वेरिएंट
   - x64 क्रॉस-बिल्ड बिना `TARGET_VARIANT` → हार्ड एरर
   - x64 लोकल बिल्ड बिना ओवरराइड → होस्ट AVX2 डिटेक्ट करें
3. **कम्पाइल**: रिज़ॉल्व किए गए प्रोफाइल/टार्गेट के साथ Cargo चलाएँ
4. **आर्टिफैक्ट लोकेट**: टार्गेट रूट/प्रोफाइल डायरेक्टरी/लाइब्रेरी नाम स्कैन करें
5. **इंस्टॉल**: `packages/natives/native` में कॉपी + एटॉमिक रीनेम
6. **पूर्ण**: एडऑन लोडर कैंडिडेट के लिए तैयार

स्पष्ट एरर टेक्स्ट (अमान्य वेरिएंट, विफल cargo बिल्ड, गायब आउटपुट लाइब्रेरी, इंस्टॉल/रीनेम विफलता) के साथ किसी भी चरण पर विफलता एग्ज़िट होती है।

### एम्बेड लाइफसाइकल (`embed-native.ts`)

1. **Init**: `TARGET_PLATFORM`/`TARGET_ARCH` या होस्ट मानों से प्लेटफ़ॉर्म टैग की गणना करें
2. **कैंडिडेट सेट**:
   - x64 `modern` और `baseline` दोनों की अपेक्षा करता है
   - गैर-x64 एक डिफ़ॉल्ट फ़ाइल की अपेक्षा करता है
3. `packages/natives/native` में **उपलब्धता सत्यापित करें**
4. Bun `file` इम्पोर्ट और पैकेज वर्शन के साथ **मैनिफेस्ट जनरेट करें** (`src/embedded-addon.ts`)
5. कम्पाइल्ड मोड के लिए **रनटाइम एक्सट्रैक्शन तैयार**

`--reset` वैलिडेशन को बायपास करता है और एक null मैनिफेस्ट स्टब (`embeddedAddon = null`) लिखता है।

## डेव वर्कफ़्लो बनाम शिप्ड/कम्पाइल्ड व्यवहार

## लोकल डेवलपमेंट वर्कफ़्लो

सामान्य लोकल लूप:

1. एडऑन बिल्ड करें:
   - रिलीज़: `bun --cwd=packages/natives run build`
   - डिबग प्रोफाइल: `bun --cwd=packages/natives run dev:native`
2. लोडर डायग्नोस्टिक्स टेस्ट करते समय `PI_DEV=1` सेट करें
3. `native.ts` में लोडर पैकेज-लोकल `native/` (और executable-dir फ़ॉलबैक) कैंडिडेट रिज़ॉल्व करता है
4. `validateNative` रैपर्स द्वारा बाइंडिंग का उपयोग करने से पहले एक्सपोर्ट संगतता लागू करता है

## शिप्ड/कम्पाइल्ड बाइनरी वर्कफ़्लो

कम्पाइल्ड मोड (`PI_COMPILED` या Bun एम्बेडेड मार्कर) में:

1. लोडर वर्शन्ड कैश डायरेक्टरी की गणना करता है: `<getNativesDir()>/<packageVersion>` (ऑपरेशनली `~/.xcsh/natives/<version>`)
2. यदि एम्बेडेड मैनिफेस्ट वर्तमान प्लेटफ़ॉर्म+वर्शन से मेल खाता है, लोडर चयनित एम्बेडेड फ़ाइल को उस वर्शन्ड डायरेक्टरी में एक्सट्रैक्ट कर सकता है
3. रनटाइम कैंडिडेट क्रम में शामिल हैं:
   - वर्शन्ड कैश डायरेक्टरी
   - लीगेसी कम्पाइल्ड-बाइनरी डायरेक्टरी (Windows पर `%LOCALAPPDATA%/xcsh`, अन्यत्र `~/.local/bin`)
   - पैकेज/executable डायरेक्टरी
4. पहले सफलतापूर्वक लोड किए गए एडऑन को भी `validateNative` पास करना होगा

इसीलिए पैकेजिंग + रनटाइम लोडर अपेक्षाओं का संरेखित होना आवश्यक है: फ़ाइलनाम, प्लेटफ़ॉर्म टैग, और एक्सपोर्टेड सिंबल `native.ts` द्वारा प्रोब और वैलिडेट किए जाने वाले से मेल खाने चाहिए।

## JS API ↔ Rust एक्सपोर्ट मैपिंग (वैलिडेशन गेट सबसेट)

`native.ts` के लिए आवश्यक है कि ये JS-विजिबल एक्सपोर्ट लोड किए गए एडऑन पर मौजूद हों। ये `crates/pi-natives/src` में Rust N-API एक्सपोर्ट से मैप होते हैं:

| `validateNative` द्वारा आवश्यक JS नाम | Rust एक्सपोर्ट डिक्लेरेशन | Rust स्रोत फ़ाइल |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (camel-cased export) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

यदि कोई आवश्यक सिंबल गायब है, लोडर रीबिल्ड संकेत के साथ तुरंत विफल हो जाता है।

## विफलता व्यवहार और डायग्नोस्टिक्स

## बिल्ड-टाइम विफलताएँ

- अमान्य वेरिएंट कॉन्फ़िगरेशन:
  - गैर-x64 पर `TARGET_VARIANT` सेट → तत्काल एरर
  - स्पष्ट `TARGET_VARIANT` के बिना x64 क्रॉस-बिल्ड → तत्काल एरर
- Cargo बिल्ड विफलता:
  - स्क्रिप्ट नॉन-ज़ीरो एग्ज़िट और stderr दिखाती है
- आर्टिफैक्ट नहीं मिला:
  - स्क्रिप्ट हर जाँची गई प्रोफाइल डायरेक्टरी प्रिंट करती है
- इंस्टॉल विफलता:
  - स्पष्ट संदेश; Windows में लॉक्ड-फ़ाइल संकेत शामिल

## रनटाइम लोडर विफलताएँ (`native.ts`)

- असमर्थित प्लेटफ़ॉर्म टैग:
  - समर्थित प्लेटफ़ॉर्म सूची के साथ throw करता है
- कोई कैंडिडेट लोड नहीं हो सका:
  - पूर्ण कैंडिडेट एरर सूची और मोड-विशिष्ट उपचार संकेतों के साथ throw करता है
- गायब एक्सपोर्ट:
  - सटीक गायब सिंबल नाम और रीबिल्ड कमांड के साथ throw करता है
- एम्बेडेड एक्सट्रैक्शन समस्याएँ:
  - एक्सट्रैक्शन mkdir/write एरर रिकॉर्ड की जाती हैं और अंतिम डायग्नोस्टिक्स में शामिल होती हैं

## समस्या निवारण मैट्रिक्स

| लक्षण | संभावित कारण | सत्यापन | समाधान |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | पुरानी `.node` बाइनरी, Rust एक्सपोर्ट नाम बेमेल, या गलत बाइनरी लोड हुई | लोड किया गया पथ देखने के लिए `PI_DEV=1` के साथ चलाएँ; उस फ़ाइल की एक्सपोर्ट सूची जाँचें | `build` रीबिल्ड करें; सुनिश्चित करें कि Rust `#[napi]` एक्सपोर्ट नाम (या आवश्यक होने पर स्पष्ट एलियास) JS कुंजी से मेल खाता है; पुरानी कैश्ड/वर्शन्ड फ़ाइलें हटाएँ |
| x64 मशीन modern अपेक्षित होने पर baseline लोड करती है | `PI_NATIVE_VARIANT=baseline`, कोई AVX2 डिटेक्ट नहीं हुआ, या केवल baseline फ़ाइल मौजूद है | `PI_NATIVE_VARIANT` जाँचें; `native/` में `-modern` फ़ाइल देखें | modern वेरिएंट बिल्ड करें (`TARGET_VARIANT=modern ... build`) और सुनिश्चित करें कि फ़ाइल शिप की गई है |
| क्रॉस-बिल्ड अनुपयोगी/गलत-लेबल वाली बाइनरी उत्पन्न करता है | `CROSS_TARGET` और `TARGET_PLATFORM`/`TARGET_ARCH` के बीच बेमेल, या x64 के लिए `TARGET_VARIANT` गायब | env ट्यूपल और आउटपुट फ़ाइलनाम की पुष्टि करें | सुसंगत env मानों और स्पष्ट x64 `TARGET_VARIANT` के साथ पुनः चलाएँ |
| अपग्रेड के बाद कम्पाइल्ड बाइनरी विफल | पुरानी एक्सट्रैक्टेड कैश (`~/.xcsh/natives/<old-or-mismatched-version>`) या एम्बेडेड मैनिफेस्ट बेमेल | वर्शन्ड natives डायरेक्टरी और लोडर एरर सूची जाँचें | पैकेज वर्शन के लिए वर्शन्ड natives कैश हटाएँ और पुनः चलाएँ; पैकेजिंग के दौरान एम्बेडेड मैनिफेस्ट पुनर्जनित करें |
| लोडर कई पथ प्रोब करता है और कोई काम नहीं करता | प्लेटफ़ॉर्म बेमेल या पैकेज `native/` में रिलीज़ आर्टिफैक्ट गायब | `platformTag` बनाम वास्तविक फ़ाइलनाम जाँचें | सुनिश्चित करें कि बिल्ड किया गया फ़ाइलनाम `pi_natives.<platform>-<arch>(-variant).node` परंपरा से बिल्कुल मेल खाता है और पैकेज में `native/` शामिल है |
| `embed:native` "Incomplete native addons" के साथ विफल | एम्बेडिंग से पहले आवश्यक वेरिएंट फ़ाइलें बिल्ड नहीं हुईं | एरर टेक्स्ट में अपेक्षित बनाम पाई गई सूची जाँचें | पहले आवश्यक फ़ाइलें बिल्ड करें (x64: modern+baseline दोनों; गैर-x64: डिफ़ॉल्ट), फिर `embed:native` पुनः चलाएँ |

## ऑपरेशनल कमांड

```bash
# वर्तमान होस्ट के लिए रिलीज़ आर्टिफैक्ट
bun --cwd=packages/natives run build

# डिबग प्रोफाइल आर्टिफैक्ट बिल्ड
bun --cwd=packages/natives run dev:native

# स्पष्ट x64 वेरिएंट बिल्ड करें
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# बिल्ड की गई native फ़ाइलों से एम्बेडेड एडऑन मैनिफेस्ट जनरेट करें
bun --cwd=packages/natives run embed:native

# एम्बेडेड मैनिफेस्ट को null स्टब में रीसेट करें
bun --cwd=packages/natives run embed:native -- --reset
```
