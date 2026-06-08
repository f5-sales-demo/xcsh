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

# नेटिव मीडिया + सिस्टम उपयोगिताएँ

यह दस्तावेज़ [`docs/natives-architecture.md`](./natives-architecture.md) में वर्णित **system/media/conversion primitives** परत का एक उपप्रणाली गहन विश्लेषण है: `image`, `html`, `clipboard`, और `work` प्रोफाइलिंग।

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

> नोट: कोई `crates/pi-natives/src/work.rs` नहीं है; वर्क प्रोफाइलिंग `prof.rs` में कार्यान्वित है और `task.rs` में इंस्ट्रुमेंटेशन द्वारा डेटा प्रदान किया जाता है।

## TS API ↔ Rust export/module मैपिंग

| TS export (packages/natives)                | Rust N-API export                                                       | Rust मॉड्यूल                          |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS फ़ॉलबैक लॉजिक                                  | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## डेटा प्रारूप सीमाएँ और रूपांतरण

### इमेज (`image`)

- **JS इनपुट सीमा**: `Uint8Array` एन्कोडेड इमेज बाइट्स।
- **Rust डिकोड सीमा**: बाइट्स को `Vec<u8>` में कॉपी किया जाता है, `ImageReader::with_guessed_format()` से प्रारूप का अनुमान लगाया जाता है, फिर `DynamicImage` में डिकोड किया जाता है।
- **इन-मेमोरी स्थिति**: `PhotonImage` `Arc<DynamicImage>` स्टोर करता है।
- **आउटपुट सीमा**: `encode(format, quality)` `Promise<Uint8Array>` (Rust `Vec<u8>`) लौटाता है।

प्रारूप ID संख्यात्मक हैं:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (लॉसलेस एन्कोडर)
- `3`: GIF

बाधाएँ:

- `quality` केवल JPEG के लिए उपयोग होता है।
- PNG/WebP/GIF `quality` को अनदेखा करते हैं।
- असमर्थित प्रारूप ID विफल होते हैं (`Invalid image format: <id>`)।

### HTML रूपांतरण (`html`)

- **JS इनपुट सीमा**: HTML `string` + वैकल्पिक ऑब्जेक्ट `{ cleanContent?: boolean; skipImages?: boolean }`।
- **Rust रूपांतरण सीमा**: `String` इनपुट `html_to_markdown_rs::convert` द्वारा रूपांतरित होता है।
- **आउटपुट सीमा**: Markdown `string`।

रूपांतरण व्यवहार:

- `cleanContent` डिफ़ॉल्ट रूप से `false` होता है।
- जब `cleanContent=true` हो, तो `PreprocessingPreset::Aggressive` और नेविगेशन/फ़ॉर्म के लिए हार्ड-रिमूवल फ़्लैग के साथ प्रीप्रोसेसिंग सक्षम होती है।
- `skipImages` डिफ़ॉल्ट रूप से `false` होता है।

### क्लिपबोर्ड (`clipboard`)

- **टेक्स्ट पथ**:
  - TS पहले OSC 52 (`\x1b]52;c;<base64>\x07`) उत्सर्जित करता है जब stdout एक TTY हो।
  - फिर उसी टेक्स्ट को नेटिव क्लिपबोर्ड API (`native.copyToClipboard`) के माध्यम से बेस्ट-एफ़र्ट के रूप में प्रयास किया जाता है।
  - Termux पर, TS पहले `termux-clipboard-set` का प्रयास करता है।
- **इमेज रीड पथ**:
  - Rust `arboard` से रॉ इमेज पढ़ता है।
  - Rust इसे PNG बाइट्स (`image` क्रेट) में री-एन्कोड करता है, `{ data: Uint8Array, mimeType: "image/png" }` लौटाता है।
  - Termux या डिस्प्ले सर्वर रहित Linux सत्रों (`DISPLAY`/`WAYLAND_DISPLAY` अनुपस्थित) पर TS जल्दी `null` लौटाता है।

### वर्क प्रोफाइलिंग (`work`)

- **संग्रह सीमा**: प्रोफाइलिंग सैंपल `task::blocking` और `task::future` में `profile_region(tag)` गार्ड्स द्वारा उत्पन्न होते हैं।
- **स्टोरेज प्रारूप**: निश्चित-आकार का वृत्ताकार बफ़र (`MAX_SAMPLES = 10_000`) जो स्टैक पथ + अवधि (`μs`) + टाइमस्टैम्प (`प्रक्रिया शुरू होने से μs`) संग्रहीत करता है।
- **आउटपुट सीमा**: `getWorkProfile(lastSeconds)` ऑब्जेक्ट लौटाता है:
  - `folded`: फ़ोल्डेड-स्टैक टेक्स्ट (flamegraph इनपुट)
  - `summary`: markdown टेबल सारांश
  - `svg`: वैकल्पिक flamegraph SVG
  - `totalMs`, `sampleCount`

## जीवनचक्र और स्थिति संक्रमण

### इमेज जीवनचक्र

1. `PhotonImage.parse(bytes)` एक ब्लॉकिंग डिकोड टास्क (`image.decode`) शेड्यूल करता है।
2. सफलता पर, JS में एक नेटिव `PhotonImage` हैंडल मौजूद होता है।
3. `resize(...)` एक नया नेटिव हैंडल (`image.resize`) बनाता है, पुराने और नए हैंडल सह-अस्तित्व में रह सकते हैं।
4. `encode(...)` इमेज आयामों को बदले बिना बाइट्स (`image.encode`) को मटीरियलाइज़ करता है।

विफलता संक्रमण:

- प्रारूप पहचान/डिकोड विफलता parse promise को रिजेक्ट करती है।
- एन्कोड विफलता encode promise को रिजेक्ट करती है।
- अमान्य प्रारूप ID encode promise को रिजेक्ट करता है।

### HTML जीवनचक्र

1. `htmlToMarkdown(html, options)` एक ब्लॉकिंग रूपांतरण टास्क शेड्यूल करता है।
2. रूपांतरण डिफ़ॉल्ट विकल्पों (`cleanContent=false`, `skipImages=false`) के साथ चलता है जब तक निर्दिष्ट न हो।
3. Markdown स्ट्रिंग लौटाता है या रिजेक्ट करता है।

विफलता संक्रमण:

- कनवर्टर विफलता रिजेक्टेड promise लौटाती है (`Conversion error: ...`)।

### क्लिपबोर्ड जीवनचक्र

`copyToClipboard(text)` जानबूझकर बेस्ट-एफ़र्ट और मल्टी-पथ है:

1. यदि TTY: OSC 52 लिखने का प्रयास (base64 पेलोड)।
2. जब `TERMUX_VERSION` सेट हो तो Termux कमांड का प्रयास।
3. नेटिव `arboard` टेक्स्ट कॉपी का प्रयास।
4. TS परत पर त्रुटियों को दबाया जाता है।

`readImageFromClipboard()` की कठोरता चरण के अनुसार भिन्न होती है:

1. TS असमर्थित रनटाइम संदर्भों (Termux/हेडलेस Linux) को `null` तक हार्ड-गेट करता है।
2. Rust `arboard` रीड केवल तब चलता है जब TS अनुमति देता है।
3. `ContentNotAvailable` `null` में मैप होता है।
4. अन्य Rust त्रुटियाँ रिजेक्ट होती हैं।

### वर्क प्रोफाइलिंग जीवनचक्र

1. कोई स्पष्ट शुरुआत नहीं: जब टास्क हेल्पर्स निष्पादित होते हैं तब प्रोफाइलिंग हमेशा चालू रहती है।
2. प्रत्येक इंस्ट्रुमेंटेड टास्क स्कोप गार्ड ड्रॉप पर एक सैंपल रिकॉर्ड करता है।
3. बफ़र क्षमता पूरी होने के बाद सैंपल सबसे पुरानी प्रविष्टियों को ओवरराइट करते हैं।
4. `getWorkProfile(lastSeconds)` एक समय विंडो पढ़ता है और फ़ोल्डेड/सारांश/svg आर्टिफ़ैक्ट्स प्राप्त करता है।

विफलता संक्रमण:

- SVG जनरेशन विफलता सॉफ़्ट-फ़ेल है (`svg: null`), जबकि फ़ोल्डेड और सारांश फिर भी लौटते हैं।
- खाली सैंपल विंडो खाली फ़ोल्डेड डेटा और `svg: null` लौटाती है, त्रुटि नहीं।

## असमर्थित संचालन और त्रुटि प्रसार

### इमेज

- असमर्थित डिकोड इनपुट या दूषित बाइट्स: सख्त विफलता (promise रिजेक्शन)।
- असमर्थित एन्कोड प्रारूप ID: सख्त विफलता।
- TS रैपर में कोई बेस्ट-एफ़र्ट फ़ॉलबैक पथ नहीं।

### HTML

- रूपांतरण त्रुटियाँ सख्त विफलताएँ हैं (रिजेक्शन)।
- विकल्प छोड़ना बेस्ट-एफ़र्ट डिफ़ॉल्टिंग है, विफलता नहीं।

### क्लिपबोर्ड

- टेक्स्ट कॉपी TS परत पर बेस्ट-एफ़र्ट है: संचालन विफलताएँ दबा दी जाती हैं।
- इमेज रीड "कोई इमेज नहीं" (`null`) को संचालन विफलता (रिजेक्शन) से अलग करता है।
- Termux/हेडलेस Linux को इमेज रीड के लिए असमर्थित संदर्भ माना जाता है (`null`)।

### वर्क प्रोफाइलिंग

- पुनर्प्राप्ति फ़ंक्शन कॉल के लिए सख्त है, लेकिन आर्टिफ़ैक्ट जनरेशन आंशिक रूप से बेस्ट-एफ़र्ट है (`svg` nullable)।
- बफ़र ट्रंकेशन अपेक्षित व्यवहार है (रिंग बफ़र), डेटा हानि बग नहीं।

## प्लेटफ़ॉर्म संबंधी सावधानियाँ

- **क्लिपबोर्ड टेक्स्ट**: OSC 52 टर्मिनल सपोर्ट पर निर्भर करता है; नेटिव क्लिपबोर्ड एक्सेस डेस्कटॉप एनवायरनमेंट/सत्र पर निर्भर करता है।
- **क्लिपबोर्ड इमेज रीड**: Termux और डिस्प्ले सर्वर रहित Linux के लिए TS में अवरुद्ध है।
