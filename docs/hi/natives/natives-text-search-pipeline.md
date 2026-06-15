---
title: नेटिव टेक्स्ट और खोज पाइपलाइन
description: >-
  grep, glob, और ripgrep-आधारित फ़ाइल सामग्री इंडेक्सिंग के साथ नेटिव टेक्स्ट
  खोज पाइपलाइन।
sidebar:
  order: 6
  label: टेक्स्ट और खोज पाइपलाइन
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# नेटिव टेक्स्ट/खोज पाइपलाइन

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` टेक्स्ट/खोज सतह (`grep`, `glob`, `text`, `highlight`) को TypeScript रैपर से Rust N-API एक्सपोर्ट तक और वापस JS परिणाम ऑब्जेक्ट में मैप करता है।

शब्दावली `docs/natives-architecture.md` का अनुसरण करती है:

- **रैपर**: `packages/natives/src/*` में TS API
- **Rust मॉड्यूल लेयर**: `crates/pi-natives/src/*` में N-API एक्सपोर्ट
- **साझा स्कैन कैश**: `fs_cache`-समर्थित डायरेक्टरी-एंट्री कैश जो डिस्कवरी/खोज प्रवाह द्वारा उपयोग किया जाता है

## कार्यान्वयन फ़ाइलें

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## JS API ↔ Rust एक्सपोर्ट मैपिंग

| JS रैपर API | Rust एक्सपोर्ट (`#[napi]`, snake_case -> camelCase) | Rust मॉड्यूल |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## उपतंत्र द्वारा पाइपलाइन अवलोकन

## 1) रेजेक्स खोज (`grep`, `searchContent`, `hasMatch`)

### इनपुट/विकल्प प्रवाह

1. TS रैपर विकल्पों को नेटिव को फॉरवर्ड करता है:
   - `grep/index.ts` `options` को अधिकांशतः अपरिवर्तित पास करता है और कॉलबैक को `(match) => void` से napi threadsafe कॉलबैक शेप `(err, match)` में रैप करता है।
   - `searchContent` और `hasMatch` स्ट्रिंग/`Uint8Array` सीधे पास करते हैं।
2. `grep.rs` में Rust विकल्प स्ट्रक्चर camelCase फ़ील्ड डिसीरियलाइज़ करते हैं (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`)।
3. `grep` `timeoutMs` + `AbortSignal` से `CancelToken` बनाता है और `task::blocking("grep", ...)` के अंदर चलता है।

### निष्पादन शाखाएँ

- **इन-मेमोरी शाखा (शुद्ध उपयोगिता)**
  - `search` → `search_sync` → प्रदान की गई सामग्री बाइट्स पर `run_search`।
  - कोई फ़ाइलसिस्टम स्कैन नहीं, कोई `fs_cache` नहीं।
- **एकल-फ़ाइल शाखा (फ़ाइलसिस्टम-निर्भर)**
  - `grep_sync` पथ रिज़ॉल्व करता है, मेटाडेटा की जाँच करता है कि फ़ाइल है, प्रति फ़ाइल `MAX_FILE_BYTES` (`4 MiB`) तक ripgrep मैचर के माध्यम से स्ट्रीम करता है।
- **डायरेक्टरी शाखा (फ़ाइलसिस्टम-निर्भर)**
  - `cache: true` होने पर `fs_cache::get_or_scan` के माध्यम से वैकल्पिक कैश लुकअप।
  - `cache: false` होने पर `fs_cache::force_rescan` के माध्यम से नया स्कैन।
  - कैश आयु `empty_recheck_ms()` से अधिक होने पर वैकल्पिक खाली-परिणाम पुनःजाँच।
  - एंट्री फ़िल्टरिंग: केवल-फ़ाइल + वैकल्पिक glob फ़िल्टर (`glob_util`) + वैकल्पिक प्रकार फ़िल्टर मैपिंग (`js`, `ts`, `rust`, आदि)।

### खोज/संग्रह सिमेंटिक्स

- रेजेक्स इंजन: `ignoreCase` और `multiline` के साथ `grep_regex::RegexMatcherBuilder`।
- संदर्भ रिज़ॉल्यूशन:
  - `contextBefore/contextAfter` पुरानी `context` को ओवरराइड करते हैं।
  - गैर-सामग्री मोड संदर्भ संग्रह को शून्य करते हैं।
- आउटपुट मोड:
  - `content` => प्रति हिट एक `GrepMatch`।
  - `count` और `filesWithMatches` दोनों काउंट-स्टाइल एंट्री में मैप होते हैं (`lineNumber=0`, `line=""`, `matchCount` सेट)।
- सीमाएँ:
  - वैश्विक `offset` और `maxCount` फ़ाइलों में लागू।
  - समानांतर पथ तभी उपयोग होता है जब `maxCount` अनसेट हो और `offset == 0`; अन्यथा क्रमिक पथ नियतात्मक वैश्विक offset/limit सिमेंटिक्स संरक्षित करता है।

### JS को वापस परिणाम आकार देना

- Rust `SearchResult`/`GrepResult` फ़ील्ड N-API ऑब्जेक्ट फ़ील्ड रूपांतरण के माध्यम से TS प्रकारों में मैप होते हैं।
- N-API पार करने से पहले काउंटर `u32` तक क्लैंप किए जाते हैं।
- वैकल्पिक बूलियन कुछ पथों में केवल तब शामिल होते हैं जब true हों (`limitReached`)।
- स्ट्रीमिंग कॉलबैक प्रत्येक आकार दिए गए `GrepMatch` (सामग्री या काउंट एंट्री) प्राप्त करता है।

### विफलता व्यवहार

- `searchContent` थ्रो करने के बजाय regex/खोज विफलताओं के लिए `SearchResult.error` लौटाता है।
- `grep` कठिन त्रुटियों पर रिजेक्ट करता है (अमान्य पथ, अमान्य glob/regex, रद्दीकरण timeout/abort)।
- `hasMatch` `Result<bool>` लौटाता है और अमान्य पैटर्न/UTF-8 डिकोडिंग त्रुटियों पर थ्रो करता है।
- मल्टी-फ़ाइल स्कैन में फ़ाइल खोलने/खोज त्रुटियाँ प्रति-फ़ाइल छोड़ी जाती हैं; स्कैन जारी रहता है।

### विकृत रेजेक्स हैंडलिंग

`grep.rs` रेजेक्स कंपाइल से पहले ब्रेसेज़ को साफ़ करता है:

- अमान्य रिपीटिशन-जैसे ब्रेसेज़ एस्केप किए जाते हैं (`{`/`}` -> `\{`/`\}`) जब वे `{N}`, `{N,}`, `{N,M}` नहीं बना सकते।
- यह सामान्य लिटरल-टेम्पलेट फ्रैगमेंट (उदाहरण के लिए `${platform}`) को विकृत रिपीटिशन के रूप में विफल होने से रोकता है।
- शेष अमान्य रेजेक्स सिंटैक्स अभी भी रेजेक्स त्रुटि लौटाता है।

## 2) फ़ाइल डिस्कवरी (`glob`) और फ़ज़ी पथ खोज (`fuzzyFind`)

`glob` और `fuzzyFind` `fs_cache` स्कैन साझा करते हैं; मिलान तर्क अलग होता है।

### `glob` प्रवाह

1. TS रैपर (`glob/index.ts`):
   - `path.resolve(options.path)`।
   - डिफ़ॉल्ट: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`।
2. Rust `glob` `GlobConfig` बनाता है और `glob_util::compile_glob` के माध्यम से पैटर्न कंपाइल करता है।
3. एंट्री स्रोत:
   - `cache=true` => `get_or_scan` + वैकल्पिक stale-empty `force_rescan`।
   - `cache=false` => `force_rescan(..., store=false)` (केवल नया)।
4. फ़िल्टरिंग:
   - `.git` हमेशा छोड़ें।
   - `node_modules` छोड़ें जब तक अनुरोध न किया जाए (`includeNodeModules` या node_modules का उल्लेख करने वाला पैटर्न)।
   - glob मिलान लागू करें।
   - फ़ाइल-प्रकार फ़िल्टर लागू करें; symlink `file/dir` फ़िल्टर लक्ष्य मेटाडेटा रिज़ॉल्व करते हैं।
5. `maxResults` तक छोटा करने से पहले mtime desc द्वारा वैकल्पिक सॉर्ट (`sortByMtime`)।

### `fuzzyFind` प्रवाह (`fd.rs` में कार्यान्वित)

1. TS रैपर `grep` मॉड्यूल से एक्सपोर्ट है, लेकिन Rust कार्यान्वयन `fd.rs` में रहता है।
2. `fs_cache` से साझा स्कैन स्रोत, समान cache/no-cache विभाजन और stale-empty recheck नीति के साथ।
3. स्कोरिंग:
   - exact / starts-with / contains / subsequence-आधारित fuzzy स्कोर
   - separator/punctuation-नॉर्मलाइज़्ड स्कोरिंग पथ
   - डायरेक्टरी बोनस और नियतात्मक टाई-ब्रेक (`score desc`, फिर `path asc`)
4. Symlink एंट्री fuzzy परिणामों से बाहर रखी जाती हैं।

### विफलता व्यवहार

- अमान्य glob पैटर्न => `glob_util::compile_glob` से त्रुटि।
- खोज रूट एक मौजूदा डायरेक्टरी होनी चाहिए (`resolve_search_path`), अन्यथा त्रुटि।
- रद्दीकरण/timeout लूप में `CancelToken::heartbeat()` जाँच के माध्यम से abort त्रुटियों के रूप में प्रसारित होते हैं।

### विकृत glob हैंडलिंग

`glob_util::build_glob_pattern` सहनशील है:

- `\` को `/` में नॉर्मलाइज़ करता है।
- `recursive=true` होने पर सरल पुनरावर्ती पैटर्न को स्वतः `**/` से उपसर्गित करता है।
- कंपाइल से पहले असंतुलित `{...` ऑल्टर्नेशन ग्रुप को स्वतः बंद करता है।

## 3) साझा स्कैन/कैश जीवनचक्र (`fs_cache`)

`fs_cache` स्कैन परिणामों को नॉर्मलाइज़्ड सापेक्ष एंट्री (`path`, `fileType`, वैकल्पिक `mtime`) के रूप में संग्रहीत करता है, जो इनके द्वारा कुंजीकृत हैं:

- कैनोनिकल खोज रूट
- `include_hidden`
- `use_gitignore`

### कैश स्थिति संक्रमण

1. **मिस / अक्षम**
   - TTL `0` है या कुंजी अनुपस्थित/समाप्त है -> नया `collect_entries`।
2. **हिट**
   - एंट्री आयु `< cache_ttl_ms()` -> कैश्ड एंट्री + `cache_age_ms` लौटाएँ।
3. **Stale-empty recheck** (`glob`/`grep`/`fd` में कॉलर नीति)
   - यदि क्वेरी शून्य मिलान देती है और `cache_age_ms >= empty_recheck_ms()`, तो एक बार पुनः स्कैन बाध्य करें।
4. **अमान्यकरण**
   - `invalidateFsScanCache(path?)`:
     - कोई आर्ग नहीं: सभी कुंजियाँ साफ़ करें
     - path आर्ग: उन कुंजियाँ हटाएँ जिनका रूट उस लक्ष्य पथ को उपसर्गित करता है

### Stale-परिणाम ट्रेडऑफ

- कैश तत्काल संगतता पर कम-विलंबता बार-बार स्कैन को प्राथमिकता देता है।
- TTL विंडो stale सकारात्मक/नकारात्मक परिणाम लौटा सकती है।
- खाली-परिणाम recheck एक अतिरिक्त स्कैन की कीमत पर पुराने कैश्ड स्कैन के लिए stale नकारात्मक परिणाम कम करता है।
- फ़ाइल म्यूटेशन के बाद स्पष्ट अमान्यकरण इच्छित सटीकता हुक है।

## 4) ANSI टेक्स्ट उपयोगिताएँ (`text`)

ये शुद्ध, इन-मेमोरी उपयोगिताएँ हैं (कोई फ़ाइलसिस्टम स्कैनिंग नहीं)।

### सीमाएँ और जिम्मेदारियाँ

- **`text.rs` टर्मिनल-सेल सिमेंटिक्स का स्वामी है**:
  - ANSI सीक्वेंस पार्सिंग
  - ग्राफीम-अवेयर चौड़ाई और स्लाइसिंग
  - wrap/truncate/sanitize व्यवहार
- **`grep.rs` लाइन ट्रंकेशन (`maxColumns`) अलग है**:
  - `...` के साथ मिलान की गई लाइनों का सरल कैरेक्टर-बाउंड्री ट्रंकेशन
  - ANSI-state-preserving नहीं और टर्मिनल-सेल चौड़ाई जागरूक नहीं

### मुख्य व्यवहार

- `wrapTextWithAnsi`: दृश्यमान चौड़ाई से रैप करता है, रैप्ड लाइनों में सक्रिय SGR कोड वहन करता है।
- `truncateToWidth`: ellipsis नीति (`Unicode`, `Ascii`, `Omit`) के साथ दृश्यमान-सेल ट्रंकेशन, वैकल्पिक दाईं पैडिंग, और अपरिवर्तित होने पर मूल JS स्ट्रिंग लौटाने का fast-path।
- `sliceWithWidth`: वैकल्पिक strict चौड़ाई प्रवर्तन के साथ कॉलम स्लाइसिंग।
- `extractSegments`: `after` सेगमेंट के लिए ANSI स्थिति पुनर्स्थापित करते हुए ओवरले के आसपास before/after सेगमेंट निकालता है।
- `sanitizeText`: ANSI एस्केप + कंट्रोल कैरेक्टर हटाता है, अकेले surrogates छोड़ता है, `\r` हटाकर CR/LF नॉर्मलाइज़ करता है।
- `visibleWidth`: दृश्यमान टर्मिनल सेल गिनता है (टैब Rust कार्यान्वयन से निश्चित `TAB_WIDTH` उपयोग करते हैं)।

### विफलता व्यवहार

टेक्स्ट फ़ंक्शन आमतौर पर नियतात्मक रूपांतरित आउटपुट लौटाते हैं; त्रुटियाँ JS स्ट्रिंग रूपांतरण सीमाओं (N-API आर्ग्युमेंट रूपांतरण विफलताओं) तक सीमित हैं।

## 5) सिंटैक्स हाइलाइटिंग (`highlight`)

`highlight.rs` शुद्ध परिवर्तन है (कोई FS नहीं, कोई कैश नहीं)।

### प्रवाह

1. रैपर `code`, वैकल्पिक `lang`, और ANSI रंग पैलेट फॉरवर्ड करता है।
2. Rust सिंटैक्स रिज़ॉल्व करता है:
   - टोकन/नाम लुकअप
   - एक्सटेंशन लुकअप
   - उपनाम तालिका फॉलबैक (`ts/tsx/js -> JavaScript`, आदि)
   - अनरिज़ॉल्व्ड होने पर सादे टेक्स्ट सिंटैक्स में फॉलबैक
3. syntect `ParseState` और स्कोप स्टैक के साथ प्रत्येक लाइन पार्स करें।
4. स्कोप को 11 सिमेंटिक रंग श्रेणियों में मैप करें और ANSI रंग कोड इंजेक्ट/रीसेट करें।

### विफलता व्यवहार

- प्रति-लाइन पार्स विफलता कॉल को विफल नहीं करती: वह लाइन बिना हाइलाइट के जोड़ी जाती है और प्रोसेसिंग जारी रहती है।
- अज्ञात/असमर्थित भाषा सादे टेक्स्ट सिंटैक्स पर फॉलबैक करती है।

## शुद्ध उपयोगिता बनाम फ़ाइलसिस्टम-निर्भर प्रवाह

| प्रवाह | फ़ाइलसिस्टम एक्सेस | साझा कैश | टिप्पणियाँ |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | नहीं | नहीं | केवल प्रदान की गई बाइट्स/स्ट्रिंग पर रेजेक्स |
| `text` मॉड्यूल फ़ंक्शन | नहीं | नहीं | केवल ANSI/चौड़ाई/sanitization |
| `highlight` मॉड्यूल फ़ंक्शन | नहीं | नहीं | केवल सिंटैक्स + ANSI रंगीकरण |
| `glob` | हाँ | वैकल्पिक | डायरेक्टरी स्कैन + glob फ़िल्टरिंग |
| `fuzzyFind` | हाँ | वैकल्पिक | डायरेक्टरी स्कैन + fuzzy स्कोरिंग |
| `grep` (फ़ाइल/dir पथ) | हाँ | वैकल्पिक (dir मोड) | फ़ाइलों पर ripgrep, वैकल्पिक फ़िल्टर/कॉलबैक |

## एंड-टू-एंड जीवनचक्र सारांश

1. कॉलर टाइप्ड विकल्पों के साथ TS रैपर को आमंत्रित करता है।
2. रैपर डिफ़ॉल्ट नॉर्मलाइज़ करता है (विशेष रूप से `glob`) और `native.*` एक्सपोर्ट को फॉरवर्ड करता है।
3. Rust विकल्प सत्यापित/नॉर्मलाइज़ करता है और मैचर/खोज कॉन्फ़िगरेशन बनाता है।
4. फ़ाइलसिस्टम प्रवाह के लिए, एंट्री स्कैन (कैश हिट/मिस/रीस्कैन) की जाती हैं और फिर फ़िल्टर/स्कोर की जाती हैं।
5. वर्कर लूप समय-समय पर cancel heartbeat कॉल करते हैं; timeout/abort निष्पादन समाप्त कर सकते हैं।
6. Rust आउटपुट को N-API ऑब्जेक्ट (`lineNumber`, `matchCount`, `limitReached`, आदि) में आकार देता है।
7. TS रैपर टाइप्ड JS ऑब्जेक्ट लौटाता है (और `grep`/`glob` के लिए वैकल्पिक प्रति-मिलान कॉलबैक)।
