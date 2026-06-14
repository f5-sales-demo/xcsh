---
title: नेटिव्स एडॉन लोडर रनटाइम
description: >-
  प्लेटफ़ॉर्म डिटेक्शन, फ़ॉलबैक रणनीतियों और मॉड्यूल रिज़ॉल्यूशन के साथ N-API
  एडॉन लोडर रनटाइम।
sidebar:
  order: 3
  label: एडॉन लोडर
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# नेटिव्स एडॉन लोडर रनटाइम

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` में एडॉन लोडिंग/वैलिडेशन लेयर की गहन जानकारी प्रदान करता है: कैसे `native.ts` यह तय करता है कि कौन-सी `.node` फ़ाइल लोड करनी है, एम्बेडेड पेलोड एक्सट्रैक्शन कब चलता है, और स्टार्टअप विफलताओं की रिपोर्ट कैसे की जाती है।

## इम्प्लीमेंटेशन फ़ाइलें

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## स्कोप और जिम्मेदारी

लोडर/रनटाइम की जिम्मेदारियाँ जानबूझकर सीमित रखी गई हैं:

- एडॉन फ़ाइलनामों और डायरेक्टरियों के लिए प्लेटफ़ॉर्म/CPU-सचेत कैंडिडेट सूची बनाना।
- वैकल्पिक रूप से एक एम्बेडेड एडॉन को एक वर्शन-युक्त प्रति-उपयोगकर्ता कैश डायरेक्टरी में मटेरियलाइज़ करना।
- निर्धारित क्रम में कैंडिडेट्स को आज़माना।
- बाइंडिंग्स एक्सपोज़ करने से पहले `validateNative` के माध्यम से पुराने या असंगत एडॉन्स को अस्वीकार करना।

यहाँ स्कोप से बाहर: मॉड्यूल-विशिष्ट grep/text/highlight व्यवहार।

## रनटाइम इनपुट और व्युत्पन्न स्थिति

मॉड्यूल इनिशियलाइज़ेशन (`export const native = loadNative();`) पर, `native.ts` स्थैतिक संदर्भ की गणना करता है:

- **प्लेटफ़ॉर्म टैग**: ``${process.platform}-${process.arch}`` (उदाहरण के लिए `darwin-arm64`)।
- **पैकेज वर्शन**: `packages/natives/package.json` से (`version` फ़ील्ड)।
- **मुख्य डायरेक्टरियाँ**:
  - `nativeDir`: पैकेज-लोकल `packages/natives/native`।
  - `execDir`: `process.execPath` वाली डायरेक्टरी।
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`।
  - `userDataDir` फ़ॉलबैक:
    - Windows: `%LOCALAPPDATA%/xcsh` (या `%USERPROFILE%/AppData/Local/xcsh`)।
    - Non-Windows: `~/.local/bin`।
- **कंपाइल्ड-बाइनरी मोड** (`isCompiledBinary`): true यदि निम्न में से कोई भी हो:
  - `PI_COMPILED` env var सेट है, या
  - `import.meta.url` में Bun-एम्बेडेड मार्कर हों (`$bunfs`, `~BUN`, `%7EBUN`)।
- **वेरिएंट ओवरराइड**: `PI_NATIVE_VARIANT` (केवल `modern`/`baseline`; अमान्य मान अनदेखे)।
- **चयनित वेरिएंट**: स्पष्ट ओवरराइड, अन्यथा x64 पर रनटाइम AVX2 डिटेक्शन (`modern` यदि AVX2, अन्यथा `baseline`)।

## प्लेटफ़ॉर्म समर्थन और टैग रिज़ॉल्यूशन

`SUPPORTED_PLATFORMS` निम्न तक सीमित है:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

व्यवहार विवरण:

- असमर्थित प्लेटफ़ॉर्म्स को पहले से अस्वीकार नहीं किया जाता।
- लोडर फिर भी पहले सभी गणित किए गए कैंडिडेट्स को आज़माता है।
- यदि कुछ भी लोड नहीं होता, तो यह समर्थित टैग की सूची के साथ एक स्पष्ट असमर्थित-प्लेटफ़ॉर्म एरर फेंकता है।

यह वास्तव में असमर्थित लक्ष्यों के लिए हार्ड फेलिंग बनाए रखते हुए नज़दीकी-मिस मामलों के लिए उपयोगी डायग्नोस्टिक्स सुरक्षित रखता है।

## वेरिएंट चयन (`modern` / `baseline` / डिफ़ॉल्ट)

### x64 व्यवहार

1. यदि `PI_NATIVE_VARIANT` `modern` या `baseline` है, तो वह मान जीतता है।
2. अन्यथा AVX2 समर्थन का पता लगाएँ:
   - Linux: `avx2` के लिए `/proc/cpuinfo` स्कैन करें।
   - macOS: `sysctl` (`machdep.cpu.leaf7_features`, फ़ॉलबैक `machdep.cpu.features`) क्वेरी करें।
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` चलाएँ।
3. परिणाम:
   - AVX2 उपलब्ध -> `modern`
   - AVX2 अनुपलब्ध/अज्ञात -> `baseline`

### Non-x64 व्यवहार

- कोई वेरिएंट उपयोग नहीं किया जाता; लोडर डिफ़ॉल्ट फ़ाइलनाम (`pi_natives.<platform>-<arch>.node`) पर रहता है।

### फ़ाइलनाम निर्माण

`tag = <platform>-<arch>` दिया गया:

- Non-x64 या कोई वेरिएंट नहीं: `pi_natives.<tag>.node`
- x64 + `modern`: क्रम में आज़माएँ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (जानबूझकर फ़ॉलबैक)
- x64 + `baseline`: केवल `pi_natives.<tag>-baseline.node`

अंतिम एरर संदेशों में उपयोग किया गया `addonLabel` या तो `<tag>` या `<tag> (<variant>)` है।

## कैंडिडेट पाथ निर्माण और फ़ॉलबैक क्रम

`native.ts` किसी भी `require(...)` कॉल से पहले कैंडिडेट पूल बनाता है।

### रिलीज़ कैंडिडेट्स

वेरिएंट-रिज़ॉल्व्ड फ़ाइलनाम सूची से बने और इस क्रम में खोजे गए:

- **नॉन-कंपाइल्ड रनटाइम**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **कंपाइल्ड रनटाइम** (`PI_COMPILED` या Bun एम्बेडेड मार्कर):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` पहली-घटना क्रम बनाए रखते हुए डुप्लिकेट हटाता है।

### अंतिम रनटाइम अनुक्रम

लोड समय पर:

1. वैकल्पिक एम्बेडेड एक्सट्रैक्शन कैंडिडेट (यदि उत्पन्न हुआ) सबसे आगे डाला जाता है।
2. शेष डिडुप्लिकेटेड कैंडिडेट्स क्रम में आज़माए जाते हैं।
3. पहला कैंडिडेट जो `require(...)` और `validateNative(...)` दोनों पास करे, जीतता है।

## एम्बेडेड एडॉन एक्सट्रैक्शन लाइफसाइकिल

`embedded-addon.ts` एक जनरेटेड मैनिफेस्ट शेप परिभाषित करता है:

- `platformTag`
- `version`
- `files[]` जहाँ प्रत्येक एंट्री में `variant`, `filename`, `filePath` हो

वर्तमान चेक-इन डिफ़ॉल्ट `embeddedAddon: null` है; कंपाइल किए गए आर्टिफैक्ट इसे वास्तविक मेटाडेटा से बदल सकते हैं।

### एक्सट्रैक्शन स्टेट मशीन

एक्सट्रैक्शन (`maybeExtractEmbeddedAddon`) केवल तब चलता है जब सभी गेट पास हों:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. एक वेरिएंट-उपयुक्त एम्बेडेड फ़ाइल मिली

वेरिएंट फ़ाइल चयन रनटाइम वेरिएंट इंटेंट को प्रतिबिंबित करता है:

- Non-x64: `default` को प्राथमिकता दें, फिर पहली उपलब्ध फ़ाइल।
- x64 + `modern`: `modern` को प्राथमिकता, `baseline` पर फ़ॉलबैक।
- x64 + `baseline`: `baseline` आवश्यक।

मटेरियलाइज़ेशन व्यवहार:

1. `<versionedDir>` सुनिश्चित करें (`mkdirSync(..., { recursive: true })`)।
2. यदि `<versionedDir>/<selected filename>` पहले से मौजूद है, तो उसे पुनः उपयोग करें (पुनः लिखें नहीं)।
3. अन्यथा एम्बेडेड सोर्स `filePath` पढ़ें और टारगेट फ़ाइल लिखें।
4. उच्चतम-प्राथमिकता लोड प्रयास के लिए टारगेट पाथ लौटाएँ।

विफलता पर, एक्सट्रैक्शन तुरंत क्रैश नहीं होता; यह एक एरर एंट्री (डायरेक्टरी निर्माण या राइट विफलता) जोड़ता है और लोडर सामान्य कैंडिडेट प्रोबिंग पर आगे बढ़ता है।

## लाइफसाइकिल और स्थिति ट्रांज़िशन

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

`validateNative(bindings, source)` स्टार्टअप पर `NativeBindings` पर एक function-only अनुबंध लागू करता है।

क्रियाविधि:

- प्रत्येक आवश्यक एक्सपोर्ट नाम के लिए, यह `typeof bindings[name] === "function"` जाँचता है।
- गुम नाम एकत्रित किए जाते हैं।
- यदि कोई गुम हो, तो लोडर फेंकता है:
  - सोर्स एडॉन पाथ,
  - गुम एक्सपोर्ट सूची,
  - रिबिल्ड कमांड संकेत।

यह पुरानी बाइनरियों, आंशिक बिल्ड्स और symbol/name ड्रिफ्ट के खिलाफ एक हार्ड कम्पैटिबिलिटी गेट है।

### JS API ↔ नेटिव एक्सपोर्ट मैपिंग (वैलिडेशन गेट)

| `validateNative` में जाँचा गया JS बाइंडिंग नाम | अपेक्षित नेटिव एक्सपोर्ट नाम |
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

नोट: `bindings.ts` केवल बेस `cancelWork(id)` सदस्य घोषित करता है; मॉड्यूल `types.ts` फ़ाइलें अतिरिक्त सिंबल्स declaration-merge करती हैं जिन्हें `validateNative` लागू करता है।

## विफलता व्यवहार और डायग्नोस्टिक्स

## असमर्थित प्लेटफ़ॉर्म

यदि सभी कैंडिडेट विफल हो जाते हैं और `platformTag` `SUPPORTED_PLATFORMS` में नहीं है, तो लोडर फेंकता है:

- `Unsupported platform: <tag>`
- पूर्ण समर्थित-प्लेटफ़ॉर्म सूची
- स्पष्ट इश्यू-रिपोर्टिंग मार्गदर्शन

## पुरानी बाइनरी / मिसमैच के लक्षण

सामान्य पुराने मिसमैच संकेत:

- `Native addon missing exports (<candidate>). Missing: ...`

सामान्य कारण:

- पिछले पैकेज वर्शन/API शेप से पुरानी `.node` बाइनरी।
- गलत वेरिएंट आर्टिफैक्ट चयनित (x64 के लिए)।
- लोड किए गए आर्टिफैक्ट में नया Rust एक्सपोर्ट अनुपस्थित।

लोडर व्यवहार:

- प्रति-कैंडिडेट गुम-एक्सपोर्ट विफलताएँ रिकॉर्ड करता है।
- शेष कैंडिडेट्स की प्रोबिंग जारी रखता है।
- यदि कोई कैंडिडेट वैलिडेट नहीं होता, तो अंतिम एरर में प्रत्येक विफलता संदेश के साथ आज़माए गए प्रत्येक पाथ शामिल होते हैं।

## कंपाइल्ड-बाइनरी स्टार्टअप विफलताएँ

कंपाइल्ड मोड में अंतिम डायग्नोस्टिक्स में शामिल हैं:

- अपेक्षित वर्शन्ड कैश टारगेट पाथ (`<versionedDir>/<filename>`),
- पुराने `<versionedDir>` को हटाने और पुनः चलाने का उपाय,
- प्रत्येक अपेक्षित फ़ाइलनाम के लिए डायरेक्ट रिलीज़ डाउनलोड `curl` कमांड।

## नॉन-कंपाइल्ड स्टार्टअप विफलताएँ

सामान्य पैकेज/रनटाइम मोड में अंतिम डायग्नोस्टिक्स में शामिल हैं:

- रीइंस्टॉल संकेत (`bun install @f5xc-salesdemos/pi-natives`),
- लोकल रिबिल्ड कमांड (`bun --cwd=packages/natives run build`),
- वैकल्पिक x64 वेरिएंट बिल्ड संकेत (`TARGET_VARIANT=baseline|modern ...`)।

## रनटाइम व्यवहार

- लोडर हमेशा रिलीज़ कैंडिडेट चेन का उपयोग करता है।
- `PI_DEV` सेट करने से केवल प्रति-कैंडिडेट कंसोल डायग्नोस्टिक्स सक्षम होते हैं (`Loaded native addon...` और लोड एरर)।
