---
title: Natives Media and System Utilities
description: >-
  Native media processing utilities for screenshots, image handling, and system
  information.
sidebar:
  order: 7
  label: Media & system utils
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# नेटिव मीडिया + सिस्टम यूटिलिटीज

यह दस्तावेज़ [`docs/natives-architecture.md`](./natives-architecture.md) में वर्णित **system/media/conversion primitives** परत का एक सबसिस्टम गहन विश्लेषण है: `image`, `html`, `clipboard`, और `work` प्रोफाइलिंग।

## कार्यान्वयन फ़ाइलें

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> नोट: कोई `crates/pi-natives/src/work.rs` नहीं है; वर्क प्रोफाइलिंग `prof.rs` में कार्यान्वित है और `task.rs` में इंस्ट्रूमेंटेशन द्वारा फीड की जाती है।

## TS API ↔ Rust एक्सपोर्ट/मॉड्यूल मैपिंग

| TS एक्सपोर्ट (packages/natives)             | Rust N-API एक्सपोर्ट                                                    | Rust मॉड्यूल                          |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS फ़ॉलबैक लॉजिक                                  | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## डेटा फ़ॉर्मेट सीमाएँ और रूपांतरण

### इमेज (`image`)

- **JS इनपुट सीमा**: `Uint8Array` एन्कोडेड इमेज बाइट्स।
- **Rust डीकोड सीमा**: बाइट्स को `Vec<u8>` में कॉपी किया जाता है, `ImageReader::with_guessed_format()` से फ़ॉर्मेट का अनुमान लगाया जाता है, फिर `DynamicImage` में डीकोड किया जाता है।
- **इन-मेमोरी स्थिति**: `PhotonImage` `Arc<DynamicImage>` स्टोर करता है।
- **आउटपुट सीमा**: `encode(format, quality)` `Promise<Uint8Array>` (Rust `Vec<u8>`) लौटाता है।

फ़ॉर्मेट ID संख्यात्मक हैं:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (लॉसलेस एन्कोडर)
- `3`: GIF

प्रतिबंध:

- `quality` केवल JPEG के लिए उपयोग किया जाता है।
- PNG/WebP/GIF `quality` को अनदेखा करते हैं।
- असमर्थित फ़ॉर्मेट ID विफल होते हैं (`Invalid image format: <id>`)।

### HTML रूपांतरण (`html`)

- **JS इनपुट सीमा**: HTML `string` + वैकल्पिक ऑब्जेक्ट `{ cleanContent?: boolean; skipImages?: boolean }`।
- **Rust रूपांतरण सीमा**: `String` इनपुट को `html_to_markdown_rs::convert` द्वारा रूपांतरित किया जाता है।
- **आउटपुट सीमा**: Markdown `string`।

रूपांतरण व्यवहार:

- `cleanContent` डिफ़ॉल्ट रूप से `false` है।
- जब `cleanContent=true` हो, तो `PreprocessingPreset::Aggressive` और नेविगेशन/फ़ॉर्म के लिए हार्ड-रिमूवल फ़्लैग के साथ प्रीप्रोसेसिंग सक्षम होती है।
- `skipImages` डिफ़ॉल्ट रूप से `false` है।

### क्लिपबोर्ड (`clipboard`)

- **टेक्स्ट पथ**:
  - TS पहले OSC 52 (`\x1b]52;c;<base64>\x07`) एमिट करता है जब stdout एक TTY हो।
  - वही टेक्स्ट फिर नेटिव क्लिपबोर्ड API (`native.copyToClipboard`) के माध्यम से बेस्ट-एफर्ट के रूप में प्रयास किया जाता है।
  - Termux पर, TS पहले `termux-clipboard-set` का प्रयास करता है।
- **इमेज रीड पथ**:
  - Rust `arboard` से रॉ इमेज पढ़ता है।
  - Rust इसे PNG बाइट्स (`image` क्रेट) में री-एन्कोड करता है, `{ data: Uint8Array, mimeType: "image/png" }` लौटाता है।
  - TS Termux या बिना डिस्प्ले सर्वर वाले Linux सेशन (`DISPLAY`/`WAYLAND_DISPLAY` अनुपस्थित) पर जल्दी `null` लौटाता है।

### वर्क प्रोफाइलिंग (`work`)

- **संग्रह सीमा**: प्रोफाइलिंग सैंपल `task::blocking` और `task::future` में `profile_region(tag)` गार्ड्स द्वारा उत्पन्न किए जाते हैं।
- **स्टोरेज फ़ॉर्मेट**: निश्चित-आकार का सर्कुलर बफ़र (`MAX_SAMPLES = 10_000`) जो स्टैक पथ + अवधि (`μs`) + टाइमस्टैम्प (`प्रक्रिया शुरू होने के बाद से μs`) स्टोर करता है।
- **आउटपुट सीमा**: `getWorkProfile(lastSeconds)` ऑब्जेक्ट लौटाता है:
  - `folded`: फोल्डेड-स्टैक टेक्स्ट (flamegraph इनपुट)
  - `summary`: markdown तालिका सारांश
  - `svg`: वैकल्पिक flamegraph SVG
  - `totalMs`, `sampleCount`

## जीवनचक्र और स्थिति संक्रमण

### इमेज जीवनचक्र

1. `PhotonImage.parse(bytes)` एक ब्लॉकिंग डीकोड टास्क (`image.decode`) शेड्यूल करता है।
2. सफलता पर, JS में एक नेटिव `PhotonImage` हैंडल मौजूद होता है।
3. `resize(...)` एक नया नेटिव हैंडल (`image.resize`) बनाता है, पुराने और नए हैंडल सह-अस्तित्व में रह सकते हैं।
4. `encode(...)` इमेज आयामों को बदले बिना बाइट्स (`image.encode`) को मटीरियलाइज़ करता है।

विफलता संक्रमण:

- फ़ॉर्मेट डिटेक्शन/डीकोड विफलता parse प्रॉमिस को रिजेक्ट करती है।
- एन्कोड विफलता encode प्रॉमिस को रिजेक्ट करती है।
- अमान्य फ़ॉर्मेट ID encode प्रॉमिस को रिजेक्ट करता है।

### HTML जीवनचक्र

1. `htmlToMarkdown(html, options)` एक ब्लॉकिंग रूपांतरण टास्क शेड्यूल करता है।
2. रूपांतरण डिफ़ॉल्ट विकल्पों (`cleanContent=false`, `skipImages=false`) के साथ चलता है जब तक निर्दिष्ट न हो।
3. Markdown स्ट्रिंग लौटाता है या रिजेक्ट करता है।

विफलता संक्रमण:

- कनवर्टर विफलता रिजेक्टेड प्रॉमिस लौटाती है (`Conversion error: ...`)।

### क्लिपबोर्ड जीवनचक्र

`copyToClipboard(text)` जानबूझकर बेस्ट-एफर्ट और मल्टी-पथ है:

1. यदि TTY है: OSC 52 राइट (base64 पेलोड) का प्रयास करें।
2. जब `TERMUX_VERSION` सेट हो तो Termux कमांड का प्रयास करें।
3. नेटिव `arboard` टेक्स्ट कॉपी का प्रयास करें।
4. TS लेयर पर त्रुटियों को दबाएँ।

`readImageFromClipboard()` की सख्ती चरण के अनुसार भिन्न होती है:

1. TS असमर्थित रनटाइम संदर्भों (Termux/हेडलेस Linux) को `null` पर हार्ड-गेट करता है।
2. Rust `arboard` रीड केवल तब चलता है जब TS इसे अनुमति देता है।
3. `ContentNotAvailable` `null` में मैप होता है।
4. अन्य Rust त्रुटियाँ रिजेक्ट करती हैं।

### वर्क प्रोफाइलिंग जीवनचक्र

1. कोई स्पष्ट शुरुआत नहीं: जब टास्क हेल्पर निष्पादित होते हैं तो प्रोफाइलिंग हमेशा चालू रहती है।
2. प्रत्येक इंस्ट्रूमेंटेड टास्क स्कोप गार्ड ड्रॉप पर एक सैंपल रिकॉर्ड करता है।
3. बफ़र क्षमता पूरी होने के बाद सैंपल सबसे पुरानी प्रविष्टियों को ओवरराइट करते हैं।
4. `getWorkProfile(lastSeconds)` एक समय विंडो पढ़ता है और फोल्डेड/सारांश/svg आर्टिफ़ैक्ट्स प्राप्त करता है।

विफलता संक्रमण:

- SVG जनरेशन विफलता सॉफ्ट-फ़ेल है (`svg: null`), जबकि फोल्डेड और सारांश फिर भी लौटते हैं।
- खाली सैंपल विंडो खाली फोल्डेड डेटा और `svg: null` लौटाती है, त्रुटि नहीं।

## असमर्थित ऑपरेशन और त्रुटि प्रसार

### इमेज

- असमर्थित डीकोड इनपुट या दूषित बाइट्स: सख्त विफलता (प्रॉमिस रिजेक्शन)।
- असमर्थित एन्कोड फ़ॉर्मेट ID: सख्त विफलता।
- TS रैपर में कोई बेस्ट-एफर्ट फ़ॉलबैक पथ नहीं।

### HTML

- रूपांतरण त्रुटियाँ सख्त विफलताएँ (रिजेक्शन) हैं।
- विकल्प छोड़ना बेस्ट-एफर्ट डिफ़ॉल्टिंग है, विफलता नहीं।

### क्लिपबोर्ड

- टेक्स्ट कॉपी TS लेयर पर बेस्ट-एफर्ट है: परिचालन विफलताएँ दबा दी जाती हैं।
- इमेज रीड "कोई इमेज नहीं" (`null`) और परिचालन विफलता (रिजेक्शन) के बीच अंतर करता है।
- Termux/हेडलेस Linux को इमेज रीड के लिए असमर्थित संदर्भ माना जाता है (`null`)।

### वर्क प्रोफाइलिंग

- रिट्रीवल फ़ंक्शन कॉल के लिए सख्त है, लेकिन आर्टिफ़ैक्ट जनरेशन आंशिक रूप से बेस्ट-एफर्ट है (`svg` nullable)।
- बफ़र ट्रंकेशन अपेक्षित व्यवहार (रिंग बफ़र) है, डेटा हानि बग नहीं।

## प्लेटफ़ॉर्म संबंधी चेतावनियाँ

- **क्लिपबोर्ड टेक्स्ट**: OSC 52 टर्मिनल सपोर्ट पर निर्भर करता है; नेटिव क्लिपबोर्ड एक्सेस डेस्कटॉप एनवायरनमेंट/सेशन पर निर्भर करता है।
- **क्लिपबोर्ड इमेज रीड**: Termux और बिना डिस्प्ले सर्वर वाले Linux के लिए TS में ब्लॉक किया गया है।
