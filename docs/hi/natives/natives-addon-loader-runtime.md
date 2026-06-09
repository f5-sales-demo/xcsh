---
title: नेटिव Addon Loader Runtime
description: >-
  N-API addon loader runtime जिसमें प्लेटफ़ॉर्म डिटेक्शन, फ़ॉलबैक रणनीतियाँ, और
  मॉड्यूल रिज़ॉल्यूशन शामिल है।
sidebar:
  order: 3
  label: Addon loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# नेटिव Addon Loader Runtime

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` में addon लोडिंग/सत्यापन परत की गहन समीक्षा करता है: `native.ts` कैसे तय करता है कि कौन सी `.node` फ़ाइल लोड करनी है, एम्बेडेड पेलोड एक्सट्रैक्शन कब चलता है, और स्टार्टअप विफलताओं की रिपोर्ट कैसे की जाती है।

## कार्यान्वयन फ़ाइलें

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## दायरा और उत्तरदायित्व

Loader/runtime उत्तरदायित्व जानबूझकर सीमित हैं:

- Addon फ़ाइलनामों और डायरेक्टरियों के लिए प्लेटफ़ॉर्म/CPU-अवगत उम्मीदवार सूची बनाना।
- वैकल्पिक रूप से एम्बेडेड addon को संस्करणित प्रति-उपयोगकर्ता कैश डायरेक्टरी में भौतिक रूप देना।
- निर्धारित क्रम में उम्मीदवारों को आज़माना।
- बाइंडिंग्स को उजागर करने से पहले `validateNative` के माध्यम से पुराने या असंगत addons को अस्वीकार करना।

यहाँ दायरे से बाहर: मॉड्यूल-विशिष्ट grep/text/highlight व्यवहार।

## रनटाइम इनपुट और व्युत्पन्न स्थिति

मॉड्यूल इनिशियलाइज़ेशन (`export const native = loadNative();`) पर, `native.ts` स्थैतिक संदर्भ की गणना करता है:

- **प्लेटफ़ॉर्म टैग**: ``${process.platform}-${process.arch}`` (उदाहरण के लिए `darwin-arm64`)।
- **पैकेज संस्करण**: `packages/natives/package.json` से (`version` फ़ील्ड)।
- **मुख्य डायरेक्टरियाँ**:
  - `nativeDir`: पैकेज-स्थानीय `packages/natives/native`।
  - `execDir`: `process.execPath` वाली डायरेक्टरी।
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`।
  - `userDataDir` फ़ॉलबैक:
    - Windows: `%LOCALAPPDATA%/xcsh` (या `%USERPROFILE%/AppData/Local/xcsh`)।
    - Non-Windows: `~/.local/bin`।
- **कम्पाइल्ड-बाइनरी मोड** (`isCompiledBinary`): सत्य यदि इनमें से कोई भी:
  - `PI_COMPILED` env var सेट हो, या
  - `import.meta.url` में Bun-एम्बेडेड मार्कर हों (`$bunfs`, `~BUN`, `%7EBUN`)।
- **वैरिएंट ओवरराइड**: `PI_NATIVE_VARIANT` (केवल `modern`/`baseline`; अमान्य मान अनदेखे किए जाते हैं)।
- **चयनित वैरिएंट**: स्पष्ट ओवरराइड, अन्यथा x64 पर रनटाइम AVX2 डिटेक्शन (AVX2 होने पर `modern`, अन्यथा `baseline`)।

## प्लेटफ़ॉर्म समर्थन और टैग रिज़ॉल्यूशन

`SUPPORTED_PLATFORMS` इसमें निश्चित है:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

व्यवहार विवरण:

- असमर्थित प्लेटफ़ॉर्मों को पहले से अस्वीकार नहीं किया जाता।
- Loader पहले सभी गणना किए गए उम्मीदवारों को आज़माता है।
- यदि कुछ भी लोड नहीं होता, तो यह समर्थित टैग सूचीबद्ध करते हुए स्पष्ट असमर्थित-प्लेटफ़ॉर्म त्रुटि फेंकता है।

यह निकट-चूक मामलों के लिए उपयोगी डायग्नोस्टिक्स को संरक्षित करता है जबकि वास्तव में असमर्थित लक्ष्यों के लिए कठोर रूप से विफल होता है।

## वैरिएंट चयन (`modern` / `baseline` / डिफ़ॉल्ट)

### x64 व्यवहार

1. यदि `PI_NATIVE_VARIANT` `modern` या `baseline` है, तो वह मान प्रबल होता है।
2. अन्यथा AVX2 समर्थन का पता लगाएँ:
   - Linux: `/proc/cpuinfo` में `avx2` खोजें।
   - macOS: `sysctl` से पूछताछ करें (`machdep.cpu.leaf7_features`, फ़ॉलबैक `machdep.cpu.features`)।
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` चलाएँ।
3. परिणाम:
   - AVX2 उपलब्ध -> `modern`
   - AVX2 अनुपलब्ध/अज्ञात -> `baseline`

### Non-x64 व्यवहार

- कोई वैरिएंट उपयोग नहीं होता; loader डिफ़ॉल्ट फ़ाइलनाम (`pi_natives.<platform>-<arch>.node`) पर रहता है।

### फ़ाइलनाम निर्माण

दिया गया `tag = <platform>-<arch>`:

- Non-x64 या कोई वैरिएंट नहीं: `pi_natives.<tag>.node`
- x64 + `modern`: इस क्रम में प्रयास करें
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (जानबूझकर फ़ॉलबैक)
- x64 + `baseline`: केवल `pi_natives.<tag>-baseline.node`

अंतिम त्रुटि संदेशों में उपयोग किया जाने वाला `addonLabel` या तो `<tag>` या `<tag> (<variant>)` होता है।

## उम्मीदवार पथ निर्माण और फ़ॉलबैक क्रम

`native.ts` किसी भी `require(...)` कॉल से पहले उम्मीदवार पूल बनाता है।

### रिलीज़ उम्मीदवार

वैरिएंट-रिज़ॉल्व्ड फ़ाइलनाम सूची से बने और इस क्रम में खोजे जाते हैं:

- **Non-compiled runtime**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Compiled runtime** (`PI_COMPILED` या Bun एम्बेडेड मार्कर):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` पहली उपस्थिति क्रम को संरक्षित करते हुए डुप्लिकेट हटाता है।

### अंतिम रनटाइम अनुक्रम

लोड समय पर:

1. वैकल्पिक एम्बेडेड एक्सट्रैक्शन उम्मीदवार (यदि उत्पन्न हुआ) सामने डाला जाता है।
2. शेष डीडुप्लिकेटेड उम्मीदवारों को क्रम में आज़माया जाता है।
3. पहला उम्मीदवार जो `require(...)` और `validateNative(...)` दोनों पास करता है, वह चुना जाता है।

## एम्बेडेड addon एक्सट्रैक्शन जीवनचक्र

`embedded-addon.ts` एक जनरेटेड मैनिफ़ेस्ट आकार परिभाषित करता है:

- `platformTag`
- `version`
- `files[]` जहाँ प्रत्येक प्रविष्टि में `variant`, `filename`, `filePath` होता है

वर्तमान चेक-इन डिफ़ॉल्ट `embeddedAddon: null` है; कम्पाइल्ड आर्टिफ़ैक्ट इसे वास्तविक मेटाडेटा से बदल सकते हैं।

### एक्सट्रैक्शन स्टेट मशीन

एक्सट्रैक्शन (`maybeExtractEmbeddedAddon`) केवल तभी चलता है जब सभी गेट पास हों:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. एक वैरिएंट-उपयुक्त एम्बेडेड फ़ाइल मिली हो

वैरिएंट फ़ाइल चयन रनटाइम वैरिएंट आशय को दर्शाता है:

- Non-x64: `default` को प्राथमिकता, फिर पहली उपलब्ध फ़ाइल।
- x64 + `modern`: `modern` को प्राथमिकता, `baseline` पर फ़ॉलबैक।
- x64 + `baseline`: `baseline` आवश्यक।

भौतिकीकरण व्यवहार:

1. सुनिश्चित करें कि `<versionedDir>` मौजूद है (`mkdirSync(..., { recursive: true })`)।
2. यदि `<versionedDir>/<selected filename>` पहले से मौजूद है, तो इसे पुनः उपयोग करें (कोई पुनर्लेखन नहीं)।
3. अन्यथा एम्बेडेड स्रोत `filePath` पढ़ें और लक्ष्य फ़ाइल लिखें।
4. उच्चतम-प्राथमिकता लोड प्रयास के लिए लक्ष्य पथ लौटाएँ।

विफलता पर, एक्सट्रैक्शन तुरंत क्रैश नहीं होता; यह एक त्रुटि प्रविष्टि जोड़ता है (डायरेक्टरी निर्माण या लेखन विफलता) और loader सामान्य उम्मीदवार जाँच पर आगे बढ़ता है।

## जीवनचक्र और स्थिति संक्रमण

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## `validateNative` अनुबंध जाँच

`validateNative(bindings, source)` स्टार्टअप पर `NativeBindings` पर एक केवल-फ़ंक्शन अनुबंध लागू करता है।

कार्यविधि:

- प्रत्येक आवश्यक एक्सपोर्ट नाम के लिए, यह `typeof bindings[name] === "function"` जाँचता है।
- अनुपस्थित नामों को एकत्रित किया जाता है।
- यदि कोई अनुपस्थित है, तो loader फेंकता है:
  - स्रोत addon पथ,
  - अनुपस्थित एक्सपोर्ट सूची,
  - पुनर्निर्माण कमांड संकेत।

यह पुरानी बाइनरी, आंशिक बिल्ड, और सिंबल/नाम विचलन के विरुद्ध एक कठोर संगतता गेट है।

### JS API ↔ नेटिव एक्सपोर्ट मैपिंग (सत्यापन गेट)

| `validateNative` में जाँचा जाने वाला JS बाइंडिंग नाम | अपेक्षित नेटिव एक्सपोर्ट नाम |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

नोट: `bindings.ts` केवल बेस `cancelWork(id)` सदस्य घोषित करता है; मॉड्यूल `types.ts` फ़ाइलें डिक्लेरेशन-मर्ज के माध्यम से अतिरिक्त सिंबल जोड़ती हैं जो `validateNative` लागू करता है।

## विफलता व्यवहार और डायग्नोस्टिक्स

## असमर्थित प्लेटफ़ॉर्म

यदि सभी उम्मीदवार विफल हो जाते हैं और `platformTag` `SUPPORTED_PLATFORMS` में नहीं है, तो loader फेंकता है:

- `Unsupported platform: <tag>`
- पूर्ण समर्थित-प्लेटफ़ॉर्म सूची
- स्पष्ट समस्या-रिपोर्टिंग मार्गदर्शन

## पुरानी बाइनरी / बेमेल लक्षण

विशिष्ट पुरानी बेमेल संकेत:

- `Native addon missing exports (<candidate>). Missing: ...`

सामान्य कारण:

- पिछले पैकेज संस्करण/API आकार से पुरानी `.node` बाइनरी।
- गलत वैरिएंट आर्टिफ़ैक्ट चयनित (x64 के लिए)।
- लोड किए गए आर्टिफ़ैक्ट में नया Rust एक्सपोर्ट मौजूद नहीं।

Loader व्यवहार:

- प्रति-उम्मीदवार अनुपस्थित-एक्सपोर्ट विफलताओं को रिकॉर्ड करता है।
- शेष उम्मीदवारों की जाँच जारी रखता है।
- यदि कोई उम्मीदवार मान्य नहीं होता, तो अंतिम त्रुटि में प्रत्येक प्रयास किए गए पथ के साथ प्रत्येक विफलता संदेश शामिल होता है।

## Compiled-binary स्टार्टअप विफलताएँ

Compiled मोड में अंतिम डायग्नोस्टिक्स में शामिल होता है:

- अपेक्षित संस्करणित कैश लक्ष्य पथ (`<versionedDir>/<filename>`),
- पुराने `<versionedDir>` को हटाने और पुनः चलाने का उपचार,
- प्रत्येक अपेक्षित फ़ाइलनाम के लिए सीधे रिलीज़ डाउनलोड `curl` कमांड।

## Non-compiled स्टार्टअप विफलताएँ

सामान्य पैकेज/runtime मोड में अंतिम डायग्नोस्टिक्स में शामिल होता है:

- पुनः स्थापना संकेत (`bun install @f5xc-salesdemos/pi-natives`),
- स्थानीय पुनर्निर्माण कमांड (`bun --cwd=packages/natives run build`),
- वैकल्पिक x64 वैरिएंट बिल्ड संकेत (`TARGET_VARIANT=baseline|modern ...`)।

## रनटाइम व्यवहार

- Loader हमेशा रिलीज़ उम्मीदवार श्रृंखला का उपयोग करता है।
- `PI_DEV` सेट करना केवल प्रति-उम्मीदवार कंसोल डायग्नोस्टिक्स सक्षम करता है (`Loaded native addon...` और लोड त्रुटियाँ)।
