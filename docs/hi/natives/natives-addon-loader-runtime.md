---
title: नेटिव्स एडऑन लोडर रनटाइम
description: >-
  N-API एडऑन लोडर रनटाइम जिसमें प्लेटफ़ॉर्म डिटेक्शन, फ़ॉलबैक रणनीतियाँ और
  मॉड्यूल रिज़ॉल्यूशन शामिल हैं।
sidebar:
  order: 3
  label: एडऑन लोडर
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# नेटिव्स एडऑन लोडर रनटाइम

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` में एडऑन लोडिंग/वैलिडेशन लेयर का गहन विश्लेषण करता है: `native.ts` कैसे तय करता है कि कौन सी `.node` फ़ाइल लोड करनी है, एम्बेडेड पेलोड एक्सट्रैक्शन कब चलता है, और स्टार्टअप विफलताओं की रिपोर्ट कैसे की जाती है।

## इम्प्लीमेंटेशन फ़ाइलें

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## दायरा और जिम्मेदारी

लोडर/रनटाइम की जिम्मेदारियाँ जानबूझकर सीमित रखी गई हैं:

- एडऑन फ़ाइलनेम और डायरेक्ट्रीज़ के लिए प्लेटफ़ॉर्म/CPU-अवेयर कैंडिडेट लिस्ट बनाना।
- वैकल्पिक रूप से एम्बेडेड एडऑन को वर्शन-आधारित प्रति-उपयोगकर्ता कैश डायरेक्ट्री में मटीरियलाइज़ करना।
- कैंडिडेट्स को निर्धारित क्रम में आज़माना।
- बाइंडिंग्स एक्सपोज़ करने से पहले `validateNative` के माध्यम से पुराने या असंगत एडऑन्स को रिजेक्ट करना।

यहाँ दायरे से बाहर: मॉड्यूल-विशिष्ट grep/text/highlight व्यवहार।

## रनटाइम इनपुट और व्युत्पन्न स्थिति

मॉड्यूल इनिशियलाइज़ेशन (`export const native = loadNative();`) पर, `native.ts` स्टैटिक कॉन्टेक्स्ट की गणना करता है:

- **प्लेटफ़ॉर्म टैग**: ``${process.platform}-${process.arch}`` (उदाहरण के लिए `darwin-arm64`)।
- **पैकेज वर्शन**: `packages/natives/package.json` से (`version` फ़ील्ड)।
- **मुख्य डायरेक्ट्रीज़**:
  - `nativeDir`: पैकेज-लोकल `packages/natives/native`।
  - `execDir`: `process.execPath` वाली डायरेक्ट्री।
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`।
  - `userDataDir` फ़ॉलबैक:
    - Windows: `%LOCALAPPDATA%/xcsh` (या `%USERPROFILE%/AppData/Local/xcsh`)।
    - गैर-Windows: `~/.local/bin`।
- **कम्पाइल्ड-बाइनरी मोड** (`isCompiledBinary`): true अगर इनमें से कोई भी:
  - `PI_COMPILED` env var सेट हो, या
  - `import.meta.url` में Bun-एम्बेडेड मार्कर हों (`$bunfs`, `~BUN`, `%7EBUN`)।
- **वैरिएंट ओवरराइड**: `PI_NATIVE_VARIANT` (केवल `modern`/`baseline`; अमान्य मान अनदेखे किए जाते हैं)।
- **चयनित वैरिएंट**: स्पष्ट ओवरराइड, अन्यथा x64 पर रनटाइम AVX2 डिटेक्शन (AVX2 होने पर `modern`, अन्यथा `baseline`)।

## प्लेटफ़ॉर्म सपोर्ट और टैग रिज़ॉल्यूशन

`SUPPORTED_PLATFORMS` निश्चित है:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

व्यवहार विवरण:

- असमर्थित प्लेटफ़ॉर्म पहले से रिजेक्ट नहीं किए जाते।
- लोडर फिर भी पहले सभी कम्प्यूटेड कैंडिडेट्स आज़माता है।
- अगर कुछ भी लोड नहीं होता, तो यह समर्थित टैग्स की सूची के साथ स्पष्ट असमर्थित-प्लेटफ़ॉर्म त्रुटि फेंकता है।

यह लगभग-मिलते-जुलते मामलों के लिए उपयोगी डायग्नोस्टिक्स को संरक्षित करता है जबकि वास्तव में असमर्थित लक्ष्यों के लिए पूरी तरह विफल होता है।

## वैरिएंट चयन (`modern` / `baseline` / डिफ़ॉल्ट)

### x64 व्यवहार

1. अगर `PI_NATIVE_VARIANT` `modern` या `baseline` है, तो वह मान प्रभावी होता है।
2. अन्यथा AVX2 सपोर्ट का पता लगाएँ:
   - Linux: `/proc/cpuinfo` में `avx2` स्कैन करें।
   - macOS: `sysctl` क्वेरी करें (`machdep.cpu.leaf7_features`, फ़ॉलबैक `machdep.cpu.features`)।
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` चलाएँ।
3. परिणाम:
   - AVX2 उपलब्ध -> `modern`
   - AVX2 अनुपलब्ध/पता न लग सके -> `baseline`

### गैर-x64 व्यवहार

- कोई वैरिएंट उपयोग नहीं होता; लोडर डिफ़ॉल्ट फ़ाइलनेम (`pi_natives.<platform>-<arch>.node`) पर रहता है।

### फ़ाइलनेम निर्माण

दिया गया `tag = <platform>-<arch>`:

- गैर-x64 या कोई वैरिएंट नहीं: `pi_natives.<tag>.node`
- x64 + `modern`: इस क्रम में आज़माएँ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (जानबूझकर फ़ॉलबैक)
- x64 + `baseline`: केवल `pi_natives.<tag>-baseline.node`

अंतिम त्रुटि संदेशों में उपयोग किया जाने वाला `addonLabel` या तो `<tag>` या `<tag> (<variant>)` होता है।

## कैंडिडेट पथ निर्माण और फ़ॉलबैक क्रम

`native.ts` किसी भी `require(...)` कॉल से पहले कैंडिडेट पूल बनाता है।

### रिलीज़ कैंडिडेट

वैरिएंट-रिज़ॉल्व्ड फ़ाइलनेम लिस्ट से निर्मित और इस क्रम में खोजे जाते हैं:

- **गैर-कम्पाइल्ड रनटाइम**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **कम्पाइल्ड रनटाइम** (`PI_COMPILED` या Bun एम्बेडेड मार्कर):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` पहली उपस्थिति क्रम को संरक्षित करते हुए डुप्लिकेट हटाता है।

### अंतिम रनटाइम अनुक्रम

लोड समय पर:

1. वैकल्पिक एम्बेडेड एक्सट्रैक्शन कैंडिडेट (यदि उत्पन्न हो) सामने डाला जाता है।
2. शेष डिडुप्लिकेटेड कैंडिडेट क्रम में आज़माए जाते हैं।
3. पहला कैंडिडेट जो `require(...)` और `validateNative(...)` दोनों पास करता है, चयनित होता है।

## एम्बेडेड एडऑन एक्सट्रैक्शन जीवनचक्र

`embedded-addon.ts` एक जनरेटेड मैनिफ़ेस्ट शेप परिभाषित करता है:

- `platformTag`
- `version`
- `files[]` जहाँ प्रत्येक प्रविष्टि में `variant`, `filename`, `filePath` होता है

वर्तमान चेक-इन डिफ़ॉल्ट `embeddedAddon: null` है; कम्पाइल्ड आर्टिफ़ैक्ट्स इसे वास्तविक मेटाडेटा से बदल सकते हैं।

### एक्सट्रैक्शन स्टेट मशीन

एक्सट्रैक्शन (`maybeExtractEmbeddedAddon`) केवल तभी चलता है जब सभी गेट्स पास हों:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. एक वैरिएंट-उपयुक्त एम्बेडेड फ़ाइल मिले

वैरिएंट फ़ाइल चयन रनटाइम वैरिएंट इंटेंट को मिरर करता है:

- गैर-x64: `default` को प्राथमिकता, फिर पहली उपलब्ध फ़ाइल।
- x64 + `modern`: `modern` को प्राथमिकता, `baseline` पर फ़ॉलबैक।
- x64 + `baseline`: `baseline` आवश्यक।

मटीरियलाइज़ेशन व्यवहार:

1. सुनिश्चित करें कि `<versionedDir>` मौजूद है (`mkdirSync(..., { recursive: true })`)।
2. अगर `<versionedDir>/<selected filename>` पहले से मौजूद है, तो उसे पुनः उपयोग करें (कोई रीराइट नहीं)।
3. अन्यथा एम्बेडेड स्रोत `filePath` पढ़ें और लक्ष्य फ़ाइल लिखें।
4. उच्चतम-प्राथमिकता लोड प्रयास के लिए लक्ष्य पथ लौटाएँ।

विफलता पर, एक्सट्रैक्शन तुरंत क्रैश नहीं करता; यह एक त्रुटि प्रविष्टि जोड़ता है (डायरेक्ट्री निर्माण या राइट विफलता) और लोडर सामान्य कैंडिडेट प्रोबिंग पर आगे बढ़ता है।

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

`validateNative(bindings, source)` स्टार्टअप पर `NativeBindings` पर केवल-फ़ंक्शन अनुबंध लागू करता है।

कार्यप्रणाली:

- प्रत्येक आवश्यक एक्सपोर्ट नाम के लिए, यह `typeof bindings[name] === "function"` जाँचता है।
- गायब नाम एकत्रित किए जाते हैं।
- अगर कोई गायब है, तो लोडर फेंकता है:
  - स्रोत एडऑन पथ,
  - गायब एक्सपोर्ट सूची,
  - रीबिल्ड कमांड हिंट।

यह पुरानी बाइनरीज़, आंशिक बिल्ड्स, और सिंबल/नाम ड्रिफ़्ट के विरुद्ध एक कठोर संगतता गेट है।

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

नोट: `bindings.ts` केवल बेस `cancelWork(id)` सदस्य घोषित करता है; मॉड्यूल `types.ts` फ़ाइलें डिक्लेरेशन-मर्ज के माध्यम से अतिरिक्त सिंबल जोड़ती हैं जिन्हें `validateNative` लागू करता है।

## विफलता व्यवहार और डायग्नोस्टिक्स

## असमर्थित प्लेटफ़ॉर्म

अगर सभी कैंडिडेट विफल हो जाते हैं और `platformTag` `SUPPORTED_PLATFORMS` में नहीं है, तो लोडर फेंकता है:

- `Unsupported platform: <tag>`
- पूर्ण समर्थित-प्लेटफ़ॉर्म सूची
- स्पष्ट इश्यू-रिपोर्टिंग मार्गदर्शन

## पुरानी बाइनरी / बेमेल लक्षण

सामान्य पुरानी बेमेल संकेत:

- `Native addon missing exports (<candidate>). Missing: ...`

सामान्य कारण:

- पिछले पैकेज वर्शन/API शेप से पुरानी `.node` बाइनरी।
- x64 के लिए गलत वैरिएंट आर्टिफ़ैक्ट चयनित।
- नया Rust एक्सपोर्ट लोडेड आर्टिफ़ैक्ट में मौजूद नहीं।

लोडर व्यवहार:

- प्रति-कैंडिडेट गायब-एक्सपोर्ट विफलताएँ रिकॉर्ड करता है।
- शेष कैंडिडेट्स की प्रोबिंग जारी रखता है।
- अगर कोई कैंडिडेट वैलिडेट नहीं होता, तो अंतिम त्रुटि में प्रत्येक विफलता संदेश के साथ हर प्रयास किया गया पथ शामिल होता है।

## कम्पाइल्ड-बाइनरी स्टार्टअप विफलताएँ

कम्पाइल्ड मोड में अंतिम डायग्नोस्टिक्स में शामिल हैं:

- अपेक्षित वर्शन्ड कैश लक्ष्य पथ (`<versionedDir>/<filename>`),
- पुराने `<versionedDir>` को हटाने और पुनः चलाने का उपचार,
- प्रत्येक अपेक्षित फ़ाइलनेम के लिए सीधे रिलीज़ डाउनलोड `curl` कमांड।

## गैर-कम्पाइल्ड स्टार्टअप विफलताएँ

सामान्य पैकेज/रनटाइम मोड में अंतिम डायग्नोस्टिक्स में शामिल हैं:

- रीइंस्टॉल हिंट (`bun install @f5xc-salesdemos/pi-natives`),
- लोकल रीबिल्ड कमांड (`bun --cwd=packages/natives run build`),
- वैकल्पिक x64 वैरिएंट बिल्ड हिंट (`TARGET_VARIANT=baseline|modern ...`)।

## रनटाइम व्यवहार

- लोडर हमेशा रिलीज़ कैंडिडेट चेन का उपयोग करता है।
- `PI_DEV` सेट करना केवल प्रति-कैंडिडेट कंसोल डायग्नोस्टिक्स सक्षम करता है (`Loaded native addon...` और लोड त्रुटियाँ)।
