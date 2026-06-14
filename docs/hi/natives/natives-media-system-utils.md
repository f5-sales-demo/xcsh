---
title: नेटिव मीडिया और सिस्टम यूटिलिटीज़
description: >-
  स्क्रीनशॉट, इमेज हैंडलिंग और सिस्टम जानकारी के लिए नेटिव मीडिया प्रोसेसिंग
  यूटिलिटीज़।
sidebar:
  order: 7
  label: मीडिया और सिस्टम यूटिल्स
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# नेटिव मीडिया + सिस्टम यूटिलिटीज़

यह दस्तावेज़ [`docs/natives-architecture.md`](./natives-architecture.md) में वर्णित **system/media/conversion primitives** परत का एक सब-सिस्टम गहन-विवरण है: `image`, `html`, `clipboard`, और `work` प्रोफ़ाइलिंग।

## इम्प्लीमेंटेशन फ़ाइलें

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

> नोट: कोई `crates/pi-natives/src/work.rs` नहीं है; work प्रोफ़ाइलिंग `prof.rs` में कार्यान्वित है और `task.rs` में इंस्ट्रूमेंटेशन द्वारा फ़ीड की जाती है।

## TS API ↔ Rust export/module मैपिंग

| TS export (packages/natives)                | Rust N-API export                                                       | Rust module                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS fallback logic                                  | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## डेटा फ़ॉर्मेट सीमाएँ और रूपांतरण

### इमेज (`image`)

- **JS इनपुट सीमा**: `Uint8Array` एनकोडेड इमेज बाइट्स।
- **Rust डिकोड सीमा**: बाइट्स को `Vec<u8>` में कॉपी किया जाता है, फ़ॉर्मेट `ImageReader::with_guessed_format()` से अनुमानित किया जाता है, फिर `DynamicImage` में डिकोड किया जाता है।
- **इन-मेमोरी स्थिति**: `PhotonImage` में `Arc<DynamicImage>` संग्रहीत होता है।
- **आउटपुट सीमा**: `encode(format, quality)` `Promise<Uint8Array>` (Rust `Vec<u8>`) लौटाता है।

फ़ॉर्मेट ID संख्यात्मक हैं:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (lossless encoder)
- `3`: GIF

बाधाएँ:

- `quality` का उपयोग केवल JPEG के लिए किया जाता है।
- PNG/WebP/GIF `quality` को अनदेखा करते हैं।
- असमर्थित फ़ॉर्मेट ID विफल होते हैं (`Invalid image format: <id>`)।

### HTML रूपांतरण (`html`)

- **JS इनपुट सीमा**: HTML `string` + वैकल्पिक ऑब्जेक्ट `{ cleanContent?: boolean; skipImages?: boolean }`।
- **Rust रूपांतरण सीमा**: `String` इनपुट `html_to_markdown_rs::convert` द्वारा रूपांतरित किया जाता है।
- **आउटपुट सीमा**: Markdown `string`।

रूपांतरण व्यवहार:

- `cleanContent` डिफ़ॉल्ट रूप से `false` होता है।
- जब `cleanContent=true` हो, तो `PreprocessingPreset::Aggressive` और navigation/forms के लिए hard-removal फ़्लैग के साथ प्रीप्रोसेसिंग सक्षम होती है।
- `skipImages` डिफ़ॉल्ट रूप से `false` होता है।

### क्लिपबोर्ड (`clipboard`)

- **टेक्स्ट पाथ**:
  - TS पहले OSC 52 (`\x1b]52;c;<base64>\x07`) एमिट करता है जब stdout एक TTY हो।
  - वही टेक्स्ट फिर best-effort के रूप में native clipboard API (`native.copyToClipboard`) के ज़रिए प्रयास किया जाता है।
  - Termux पर, TS पहले `termux-clipboard-set` का प्रयास करता है।
- **इमेज रीड पाथ**:
  - Rust `arboard` से raw इमेज पढ़ता है।
  - Rust इसे PNG बाइट्स (`image` crate) में पुनः-एनकोड करता है, `{ data: Uint8Array, mimeType: "image/png" }` लौटाता है।
  - Termux पर या display server (`DISPLAY`/`WAYLAND_DISPLAY` अनुपस्थित) के बिना Linux सत्रों पर TS शुरू में ही `null` लौटाता है।

### Work प्रोफ़ाइलिंग (`work`)

- **संग्रह सीमा**: प्रोफ़ाइलिंग सैंपल `task::blocking` और `task::future` में `profile_region(tag)` गार्ड द्वारा उत्पन्न किए जाते हैं।
- **स्टोरेज फ़ॉर्मेट**: निश्चित-आकार का circular buffer (`MAX_SAMPLES = 10_000`) जो stack path + duration (`μs`) + timestamp (`μs since process start`) संग्रहीत करता है।
- **आउटपुट सीमा**: `getWorkProfile(lastSeconds)` ऑब्जेक्ट लौटाता है:
  - `folded`: folded-stack टेक्स्ट (flamegraph इनपुट)
  - `summary`: markdown टेबल सारांश
  - `svg`: वैकल्पिक flamegraph SVG
  - `totalMs`, `sampleCount`

## लाइफ़साइकल और स्थिति संक्रमण

### इमेज लाइफ़साइकल

1. `PhotonImage.parse(bytes)` एक blocking decode टास्क (`image.decode`) शेड्यूल करता है।
2. सफलता पर, JS में एक native `PhotonImage` हैंडल मौजूद होता है।
3. `resize(...)` एक नया native हैंडल (`image.resize`) बनाता है, पुराने और नए हैंडल सह-अस्तित्व में रह सकते हैं।
4. `encode(...)` इमेज डायमेंशन को म्यूटेट किए बिना बाइट्स (`image.encode`) मटेरियलाइज़ करता है।

विफलता संक्रमण:

- फ़ॉर्मेट डिटेक्शन/डिकोड विफलता parse promise को रिजेक्ट करती है।
- Encode विफलता encode promise को रिजेक्ट करती है।
- अमान्य फ़ॉर्मेट ID encode promise को रिजेक्ट करती है।

### HTML लाइफ़साइकल

1. `htmlToMarkdown(html, options)` एक blocking conversion टास्क शेड्यूल करता है।
2. रूपांतरण डिफ़ॉल्ट विकल्पों (`cleanContent=false`, `skipImages=false`) के साथ चलता है जब तक निर्दिष्ट न किया जाए।
3. markdown string लौटाता है या रिजेक्ट करता है।

विफलता संक्रमण:

- Converter विफलता rejected promise लौटाती है (`Conversion error: ...`)।

### क्लिपबोर्ड लाइफ़साइकल

`copyToClipboard(text)` जानबूझकर best-effort और multi-path है:

1. यदि TTY हो: OSC 52 write (base64 payload) का प्रयास करें।
2. जब `TERMUX_VERSION` सेट हो तो Termux command आज़माएँ।
3. Native `arboard` text copy आज़माएँ।
4. TS लेयर पर त्रुटियाँ निगल लें।

`readImageFromClipboard()` की कठोरता चरण के अनुसार भिन्न होती है:

1. TS असमर्थित runtime संदर्भों (Termux/headless Linux) को `null` पर hard-gate करता है।
2. Rust `arboard` read केवल तभी चलता है जब TS इसकी अनुमति दे।
3. `ContentNotAvailable` `null` में मैप होता है।
4. अन्य Rust त्रुटियाँ रिजेक्ट करती हैं।

### Work प्रोफ़ाइलिंग लाइफ़साइकल

1. कोई स्पष्ट प्रारंभ नहीं: प्रोफ़ाइलिंग हमेशा चालू रहती है जब task helpers निष्पादित होते हैं।
2. प्रत्येक इंस्ट्रूमेंटेड टास्क स्कोप गार्ड ड्रॉप पर एक सैंपल रिकॉर्ड करता है।
3. बफ़र क्षमता पहुँचने के बाद सैंपल सबसे पुरानी प्रविष्टियाँ ओवरराइट करते हैं।
4. `getWorkProfile(lastSeconds)` एक समय विंडो पढ़ता है और folded/summary/svg आर्टिफैक्ट डेरिव करता है।

विफलता संक्रमण:

- SVG जनरेशन विफलता soft-fail है (`svg: null`), जबकि folded और summary फिर भी लौटते हैं।
- खाली सैंपल विंडो खाली folded डेटा और `svg: null` लौटाती है, त्रुटि नहीं।

## असमर्थित ऑपरेशन और त्रुटि प्रसार

### इमेज

- असमर्थित डिकोड इनपुट या दूषित बाइट्स: सख्त विफलता (promise rejection)।
- असमर्थित encode फ़ॉर्मेट ID: सख्त विफलता।
- TS wrapper में कोई best-effort fallback पाथ नहीं।

### HTML

- रूपांतरण त्रुटियाँ सख्त विफलताएँ हैं (rejection)।
- विकल्प चूक best-effort डिफ़ॉल्टिंग है, विफलता नहीं।

### क्लिपबोर्ड

- टेक्स्ट copy TS लेयर पर best-effort है: ऑपरेशनल विफलताएँ दबाई जाती हैं।
- इमेज read "no image" (`null`) को ऑपरेशनल विफलता (rejection) से अलग करता है।
- Termux/headless Linux को इमेज read के लिए असमर्थित संदर्भ माना जाता है (`null`)।

### Work प्रोफ़ाइलिंग

- पुनःप्राप्ति फ़ंक्शन कॉल के लिए स्वयं सख्त है, लेकिन आर्टिफैक्ट जनरेशन आंशिक रूप से best-effort है (`svg` nullable)।
- बफ़र ट्रंकेशन अपेक्षित व्यवहार है (ring buffer), डेटा लॉस बग नहीं।

## प्लेटफ़ॉर्म चेतावनियाँ

- **क्लिपबोर्ड टेक्स्ट**: OSC 52 टर्मिनल सपोर्ट पर निर्भर करता है; native clipboard एक्सेस desktop environment/session पर निर्भर करती है।
- **क्लिपबोर्ड इमेज रीड**: Termux और display server के बिना Linux पर TS में अवरुद्ध है।
