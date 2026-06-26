---
title: नेटिव्स एडऑन लोडर रनटाइम
description: >-
  N-API एडऑन लोडर रनटाइम जिसमें प्लेटफ़ॉर्म डिटेक्शन, फॉलबैक स्ट्रैटेजी और
  मॉड्यूल रिज़ॉल्यूशन शामिल है।
sidebar:
  order: 3
  label: एडऑन लोडर
i18n:
  sourceHash: 743ea3e32c7c
  translator: machine
---

# नेटिव्स एडऑन लोडर रनटाइम

यह दस्तावेज़ `@f5-sales-demo/pi-natives` में एडऑन लोडिंग/वैलिडेशन लेयर का गहराई से विश्लेषण करता है: `native.ts` यह कैसे तय करता है कि कौन सी `.node` फ़ाइल लोड करनी है, एम्बेडेड पेलोड एक्सट्रैक्शन कब चलता है, और स्टार्टअप विफलताओं की रिपोर्ट कैसे की जाती है।

## इम्प्लीमेंटेशन फ़ाइलें

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## दायरा और जिम्मेदारी

लोडर/रनटाइम की जिम्मेदारियाँ जानबूझकर सीमित रखी गई हैं:

- एडऑन फ़ाइलनाम और डायरेक्टरी के लिए प्लेटफ़ॉर्म/CPU-अवेयर कैंडिडेट सूची बनाना।
- वैकल्पिक रूप से एक एम्बेडेड एडऑन को वर्शन्ड पर-यूज़र कैश डायरेक्टरी में मटीरियलाइज़ करना।
- निर्धारित क्रम में कैंडिडेट्स का प्रयास करना।
- बाइंडिंग्स एक्सपोज़ करने से पहले `validateNative` के माध्यम से पुराने या असंगत एडऑन को रिजेक्ट करना।

यहाँ दायरे से बाहर: मॉड्यूल-स्पेसिफिक grep/text/highlight व्यवहार।

## रनटाइम इनपुट और व्युत्पन्न स्थिति

मॉड्यूल इनिशियलाइज़ेशन (`export const native = loadNative();`) पर, `native.ts` स्टैटिक कॉन्टेक्स्ट कंप्यूट करता है:

- **प्लेटफ़ॉर्म टैग**: ``${process.platform}-${process.arch}`` (उदाहरण के लिए `darwin-arm64`)।
- **पैकेज वर्शन**: `packages/natives/package.json` से (`version` फ़ील्ड)।
- **कोर डायरेक्टरीज़**:
  - `nativeDir`: पैकेज-लोकल `packages/natives/native`।
  - `execDir`: `process.execPath` वाली डायरेक्टरी।
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`।
  - `userDataDir` फॉलबैक:
    - Windows: `%LOCALAPPDATA%/xcsh` (या `%USERPROFILE%/AppData/Local/xcsh`)।
    - नॉन-Windows: `~/.local/bin`।
- **कम्पाइल्ड-बाइनरी मोड** (`isCompiledBinary`): true अगर इनमें से कोई भी हो:
  - `PI_COMPILED` env var सेट हो, या
  - `import.meta.url` में Bun-एम्बेडेड मार्कर्स हों (`$bunfs`, `~BUN`, `%7EBUN`)।
- **वेरिएंट ओवरराइड**: `PI_NATIVE_VARIANT` (केवल `modern`/`baseline`; अमान्य मान अनदेखे)।
- **चयनित वेरिएंट**: स्पष्ट ओवरराइड, अन्यथा x64 पर रनटाइम AVX2 डिटेक्शन (AVX2 हो तो `modern`, नहीं तो `baseline`)।

## प्लेटफ़ॉर्म सपोर्ट और टैग रिज़ॉल्यूशन

`SUPPORTED_PLATFORMS` निम्न तक सीमित है:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

व्यवहार विवरण:

- असमर्थित प्लेटफ़ॉर्म्स को शुरुआत में रिजेक्ट नहीं किया जाता।
- लोडर फिर भी सभी कम्प्यूटेड कैंडिडेट्स पहले आज़माता है।
- यदि कुछ भी लोड नहीं होता, तो यह समर्थित टैग्स की सूची के साथ स्पष्ट असमर्थित-प्लेटफ़ॉर्म एरर थ्रो करता है।

यह नज़दीकी-मिस केस के लिए उपयोगी डायग्नोस्टिक्स बनाए रखता है, जबकि वास्तव में असमर्थित टारगेट्स के लिए पूरी तरह विफल होता है।

## वेरिएंट चयन (`modern` / `baseline` / डिफ़ॉल्ट)

### x64 व्यवहार

1. यदि `PI_NATIVE_VARIANT` `modern` या `baseline` है, तो वह मान जीतता है।
2. अन्यथा AVX2 सपोर्ट डिटेक्ट करें:
   - Linux: `avx2` के लिए `/proc/cpuinfo` स्कैन करें।
   - macOS: `sysctl` क्वेरी करें (`machdep.cpu.leaf7_features`, फॉलबैक `machdep.cpu.features`)।
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` चलाएं।
3. परिणाम:
   - AVX2 उपलब्ध -> `modern`
   - AVX2 अनुपलब्ध/अनडिटेक्टेबल -> `baseline`

### नॉन-x64 व्यवहार

- कोई वेरिएंट उपयोग नहीं होता; लोडर डिफ़ॉल्ट फ़ाइलनाम (`pi_natives.<platform>-<arch>.node`) पर रहता है।

### फ़ाइलनाम कंस्ट्रक्शन

`tag = <platform>-<arch>` मानते हुए:

- नॉन-x64 या कोई वेरिएंट नहीं: `pi_natives.<tag>.node`
- x64 + `modern`: क्रम में प्रयास करें
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (जानबूझकर फॉलबैक)
- x64 + `baseline`: केवल `pi_natives.<tag>-baseline.node`

`addonLabel` जो अंतिम एरर मैसेज में उपयोग होता है वह `<tag>` या `<tag> (<variant>)` है।

## कैंडिडेट पाथ कंस्ट्रक्शन और फॉलबैक ऑर्डरिंग

`native.ts` किसी भी `require(...)` कॉल से पहले कैंडिडेट पूल बनाता है।

### रिलीज़ कैंडिडेट्स

वेरिएंट-रिज़ॉल्व्ड फ़ाइलनाम सूची से बने और इस क्रम में खोजे गए:

- **नॉन-कम्पाइल्ड रनटाइम**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **कम्पाइल्ड रनटाइम** (`PI_COMPILED` या Bun एम्बेडेड मार्कर्स):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` पहली घटना के क्रम को बनाए रखते हुए डुप्लिकेट हटाता है।

### अंतिम रनटाइम सीक्वेंस

लोड टाइम पर:

1. वैकल्पिक एम्बेडेड एक्सट्रैक्शन कैंडिडेट (यदि उत्पन्न हो) सबसे आगे डाला जाता है।
2. शेष डिडुप्लिकेटेड कैंडिडेट्स क्रम में आज़माए जाते हैं।
3. पहला कैंडिडेट जो `require(...)` और `validateNative(...)` दोनों पास करे, जीतता है।

## एम्बेडेड एडऑन एक्सट्रैक्शन लाइफसाइकिल

`embedded-addon.ts` एक जेनरेटेड मैनिफेस्ट शेप परिभाषित करता है:

- `platformTag`
- `version`
- `files[]` जहाँ प्रत्येक एंट्री में `variant`, `filename`, `filePath` हो

वर्तमान चेक-इन डिफ़ॉल्ट `embeddedAddon: null` है; कम्पाइल्ड आर्टिफैक्ट्स इसे वास्तविक मेटाडेटा से बदल सकते हैं।

### एक्सट्रैक्शन स्टेट मशीन

एक्सट्रैक्शन (`maybeExtractEmbeddedAddon`) केवल तब चलता है जब सभी गेट्स पास हों:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. एक वेरिएंट-उपयुक्त एम्बेडेड फ़ाइल मिले

वेरिएंट फ़ाइल चयन रनटाइम वेरिएंट इंटेंट को दर्शाता है:

- नॉन-x64: `default` को प्राथमिकता दें, फिर पहली उपलब्ध फ़ाइल।
- x64 + `modern`: `modern` को प्राथमिकता दें, `baseline` पर फॉलबैक।
- x64 + `baseline`: `baseline` आवश्यक।

मटीरियलाइज़ेशन व्यवहार:

1. `<versionedDir>` सुनिश्चित करें कि मौजूद हो (`mkdirSync(..., { recursive: true })`)।
2. यदि `<versionedDir>/<selected filename>` पहले से मौजूद है, तो उसे पुनः उपयोग करें (कोई री-राइट नहीं)।
3. अन्यथा एम्बेडेड सोर्स `filePath` पढ़ें और टारगेट फ़ाइल लिखें।
4. उच्चतम-प्राथमिकता लोड प्रयास के लिए टारगेट पाथ रिटर्न करें।

विफलता पर, एक्सट्रैक्शन तुरंत क्रैश नहीं होता; यह एक एरर एंट्री (डायरेक्टरी क्रिएशन या राइट विफलता) जोड़ता है और लोडर सामान्य कैंडिडेट प्रोबिंग पर आगे बढ़ता है।

## लाइफसाइकिल और स्टेट ट्रांज़िशन

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

## `validateNative` कॉन्ट्रैक्ट चेक्स

`validateNative(bindings, source)` स्टार्टअप पर `NativeBindings` पर फंक्शन-ओनली कॉन्ट्रैक्ट लागू करता है।

मैकेनिक्स:

- प्रत्येक आवश्यक एक्सपोर्ट नाम के लिए, यह जाँचता है कि `typeof bindings[name] === "function"`।
- गायब नाम एकत्रित किए जाते हैं।
- यदि कोई गायब हों, तो लोडर थ्रो करता है:
  - सोर्स एडऑन पाथ,
  - गायब एक्सपोर्ट सूची,
  - रीबिल्ड कमांड हिंट।

यह पुराने बाइनरी, आंशिक बिल्ड और सिम्बल/नाम ड्रिफ्ट के विरुद्ध एक हार्ड कम्पैटिबिलिटी गेट है।

### JS API ↔ नेटिव एक्सपोर्ट मैपिंग (वैलिडेशन गेट)

| `validateNative` में चेक किया गया JS बाइंडिंग नाम | अपेक्षित नेटिव एक्सपोर्ट नाम |
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

नोट: `bindings.ts` केवल बेस `cancelWork(id)` मेम्बर डिक्लेयर करता है; मॉड्यूल `types.ts` फ़ाइलें अतिरिक्त सिम्बल्स को डिक्लेरेशन-मर्ज करती हैं जो `validateNative` लागू करता है।

## विफलता व्यवहार और डायग्नोस्टिक्स

## असमर्थित प्लेटफ़ॉर्म

यदि सभी कैंडिडेट्स विफल हों और `platformTag` `SUPPORTED_PLATFORMS` में न हो, तो लोडर थ्रो करता है:

- `Unsupported platform: <tag>`
- पूर्ण समर्थित-प्लेटफ़ॉर्म सूची
- स्पष्ट इश्यू-रिपोर्टिंग मार्गदर्शन

## पुराना बाइनरी / मिसमैच लक्षण

विशिष्ट पुराना मिसमैच सिग्नल:

- `Native addon missing exports (<candidate>). Missing: ...`

सामान्य कारण:

- पिछले पैकेज वर्शन/API शेप से पुरानी `.node` बाइनरी।
- गलत वेरिएंट आर्टिफैक्ट चयनित (x64 के लिए)।
- लोड किए गए आर्टिफैक्ट में नया Rust एक्सपोर्ट मौजूद नहीं।

लोडर व्यवहार:

- प्रति-कैंडिडेट मिसिंग-एक्सपोर्ट विफलताएँ रिकॉर्ड करता है।
- शेष कैंडिडेट्स की प्रोबिंग जारी रखता है।
- यदि कोई कैंडिडेट वैलिडेट न हो, तो अंतिम एरर में प्रत्येक विफलता मैसेज के साथ हर आज़माया गया पाथ शामिल होता है।

## कम्पाइल्ड-बाइनरी स्टार्टअप विफलताएँ

कम्पाइल्ड मोड में अंतिम डायग्नोस्टिक्स में शामिल हैं:

- अपेक्षित वर्शन्ड कैश टारगेट पाथ (`<versionedDir>/<filename>`),
- पुराने `<versionedDir>` को हटाने और पुनः चलाने का समाधान,
- प्रत्येक अपेक्षित फ़ाइलनाम के लिए डायरेक्ट रिलीज़ डाउनलोड `curl` कमांड।

## नॉन-कम्पाइल्ड स्टार्टअप विफलताएँ

सामान्य पैकेज/रनटाइम मोड में अंतिम डायग्नोस्टिक्स में शामिल हैं:

- रीइंस्टॉल हिंट (`bun install @f5-sales-demo/pi-natives`),
- लोकल रीबिल्ड कमांड (`bun --cwd=packages/natives run build`),
- वैकल्पिक x64 वेरिएंट बिल्ड हिंट (`TARGET_VARIANT=baseline|modern ...`)।

## रनटाइम व्यवहार

- लोडर हमेशा रिलीज़ कैंडिडेट चेन उपयोग करता है।
- `PI_DEV` सेट करने से केवल प्रति-कैंडिडेट कंसोल डायग्नोस्टिक्स सक्षम होते हैं (`Loaded native addon...` और लोड एरर)।
