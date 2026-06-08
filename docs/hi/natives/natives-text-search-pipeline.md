---
title: Natives Text and Search Pipeline
description: >-
  Native text search pipeline with grep, glob, and ripgrep-based file content
  indexing.
sidebar:
  order: 6
  label: Text & search pipeline
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# नेटिव्स टेक्स्ट/सर्च पाइपलाइन

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` टेक्स्ट/सर्च सरफेस (`grep`, `glob`, `text`, `highlight`) को TypeScript रैपर्स से Rust N-API एक्सपोर्ट्स और वापस JS रिज़ल्ट ऑब्जेक्ट्स तक मैप करता है।

शब्दावली `docs/natives-architecture.md` का अनुसरण करती है:

- **रैपर**: `packages/natives/src/*` में TS API
- **Rust मॉड्यूल लेयर**: `crates/pi-natives/src/*` में N-API एक्सपोर्ट्स
- **शेयर्ड स्कैन कैश**: `fs_cache`-आधारित डायरेक्टरी-एंट्री कैश जो डिस्कवरी/सर्च फ्लो द्वारा उपयोग किया जाता है

## इम्प्लीमेंटेशन फाइलें

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

## सबसिस्टम के अनुसार पाइपलाइन अवलोकन

## 1) रेगेक्स सर्च (`grep`, `searchContent`, `hasMatch`)

### इनपुट/ऑप्शंस फ्लो

1. TS रैपर ऑप्शंस को नेटिव में फॉरवर्ड करता है:
   - `grep/index.ts` `options` को अधिकतर अपरिवर्तित पास करता है और कॉलबैक को `(match) => void` से napi threadsafe कॉलबैक शेप `(err, match)` में रैप करता है।
   - `searchContent` और `hasMatch` स्ट्रिंग/`Uint8Array` को सीधे पास करते हैं।
2. `grep.rs` में Rust ऑप्शन स्ट्रक्ट्स camelCase फील्ड्स (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`) को डीसीरियलाइज़ करते हैं।
3. `grep` `timeoutMs` + `AbortSignal` से `CancelToken` बनाता है और `task::blocking("grep", ...)` के अंदर चलता है।

### एक्जीक्यूशन ब्रांचेज

- **इन-मेमोरी ब्रांच (प्योर यूटिलिटी)**
  - `search` → `search_sync` → प्रदान किए गए कंटेंट बाइट्स पर `run_search`।
  - कोई फाइलसिस्टम स्कैन नहीं, कोई `fs_cache` नहीं।
- **सिंगल-फाइल ब्रांच (फाइलसिस्टम-निर्भर)**
  - `grep_sync` पाथ रिज़ॉल्व करता है, मेटाडेटा जाँचता है कि फाइल है, ripgrep matcher के माध्यम से प्रति फाइल `MAX_FILE_BYTES` (`4 MiB`) तक स्ट्रीम करता है।
- **डायरेक्टरी ब्रांच (फाइलसिस्टम-निर्भर)**
  - `cache: true` होने पर `fs_cache::get_or_scan` के माध्यम से वैकल्पिक कैश लुकअप।
  - `cache: false` होने पर `fs_cache::force_rescan` के माध्यम से ताज़ा स्कैन।
  - कैश आयु `empty_recheck_ms()` से अधिक होने पर वैकल्पिक खाली-परिणाम पुनर्जाँच।
  - एंट्री फिल्टरिंग: केवल-फाइल + वैकल्पिक glob फिल्टर (`glob_util`) + वैकल्पिक टाइप फिल्टर मैपिंग (`js`, `ts`, `rust`, आदि)।

### सर्च/कलेक्शन सिमेंटिक्स

- रेगेक्स इंजन: `ignoreCase` और `multiline` के साथ `grep_regex::RegexMatcherBuilder`।
- कॉन्टेक्स्ट रिज़ॉल्यूशन:
  - `contextBefore/contextAfter` लेगेसी `context` को ओवरराइड करते हैं।
  - नॉन-कंटेंट मोड कॉन्टेक्स्ट कलेक्शन को शून्य कर देते हैं।
- आउटपुट मोड:
  - `content` => प्रति हिट एक `GrepMatch`।
  - `count` और `filesWithMatches` दोनों काउंट-स्टाइल एंट्रीज़ पर मैप होते हैं (`lineNumber=0`, `line=""`, `matchCount` सेट)।
- सीमाएँ:
  - ग्लोबल `offset` और `maxCount` सभी फाइलों में लागू होते हैं।
  - पैरेलल पाथ केवल तब उपयोग होता है जब `maxCount` अनसेट हो और `offset == 0` हो; अन्यथा सीक्वेंशियल पाथ निर्धारित ग्लोबल offset/limit सिमेंटिक्स को संरक्षित करता है।

### JS में वापस परिणाम आकार देना

- Rust `SearchResult`/`GrepResult` फील्ड्स N-API ऑब्जेक्ट फील्ड कन्वर्शन के माध्यम से TS टाइप्स पर मैप होते हैं।
- काउंटर्स N-API पार करने से पहले `u32` में क्लैम्प किए जाते हैं।
- वैकल्पिक बूलियन कुछ पाथ में true होने तक छोड़ दिए जाते हैं (`limitReached`)।
- स्ट्रीमिंग कॉलबैक प्रत्येक शेप्ड `GrepMatch` (कंटेंट या काउंट एंट्री) प्राप्त करता है।

### विफलता व्यवहार

- `searchContent` थ्रो करने के बजाय regex/सर्च विफलताओं के लिए `SearchResult.error` रिटर्न करता है।
- `grep` कठिन त्रुटियों (अमान्य पाथ, अमान्य glob/regex, कैंसिलेशन टाइमआउट/एबॉर्ट) पर रिजेक्ट करता है।
- `hasMatch` `Result<bool>` रिटर्न करता है और अमान्य पैटर्न/UTF-8 डिकोडिंग त्रुटियों पर थ्रो करता है।
- मल्टी-फाइल स्कैन में फाइल ओपन/सर्च त्रुटियाँ प्रति-फाइल छोड़ दी जाती हैं; स्कैन जारी रहता है।

### विकृत regex हैंडलिंग

`grep.rs` regex कंपाइल से पहले ब्रेसेज़ को सैनिटाइज़ करता है:

- अमान्य रिपीटिशन-जैसे ब्रेसेज़ को एस्केप किया जाता है (`{`/`}` -> `\{`/`\}`) जब वे `{N}`, `{N,}`, `{N,M}` नहीं बना सकते।
- यह सामान्य लिटरल-टेम्पलेट फ्रैगमेंट्स (उदाहरण के लिए `${platform}`) को विकृत रिपीटिशन के रूप में विफल होने से रोकता है।
- शेष अमान्य regex सिंटैक्स अभी भी regex त्रुटि रिटर्न करता है।

## 2) फाइल डिस्कवरी (`glob`) और फ़ज़ी पाथ सर्च (`fuzzyFind`)

`glob` और `fuzzyFind` `fs_cache` स्कैन साझा करते हैं; मैचिंग लॉजिक भिन्न है।

### `glob` फ्लो

1. TS रैपर (`glob/index.ts`):
   - `path.resolve(options.path)`।
   - डिफॉल्ट्स: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`।
2. Rust `glob` `GlobConfig` बनाता है और `glob_util::compile_glob` के माध्यम से पैटर्न कंपाइल करता है।
3. एंट्री स्रोत:
   - `cache=true` => `get_or_scan` + वैकल्पिक स्टेल-एम्प्टी `force_rescan`।
   - `cache=false` => `force_rescan(..., store=false)` (केवल ताज़ा)।
4. फिल्टरिंग:
   - `.git` को हमेशा छोड़ें।
   - अनुरोध किए जाने तक `node_modules` छोड़ें (`includeNodeModules` या node_modules का उल्लेख करने वाला पैटर्न)।
   - glob मैच लागू करें।
   - फाइल-टाइप फिल्टर लागू करें; symlink `file/dir` फिल्टर टारगेट मेटाडेटा रिज़ॉल्व करते हैं।
5. `maxResults` तक ट्रंकेट करने से पहले mtime desc द्वारा वैकल्पिक सॉर्ट (`sortByMtime`)।

### `fuzzyFind` फ्लो (`fd.rs` में इम्प्लीमेंटेड)

1. TS रैपर `grep` मॉड्यूल से एक्सपोर्ट किया गया है, लेकिन Rust इम्प्लीमेंटेशन `fd.rs` में है।
2. `fs_cache` से शेयर्ड स्कैन स्रोत, समान cache/no-cache स्प्लिट और स्टेल-एम्प्टी रीचेक पॉलिसी के साथ।
3. स्कोरिंग:
   - exact / starts-with / contains / subsequence-आधारित फ़ज़ी स्कोर
   - separator/punctuation-नॉर्मलाइज़्ड स्कोरिंग पाथ
   - डायरेक्टरी बोनस और निर्धारित टाई-ब्रेक (`score desc`, फिर `path asc`)
4. Symlink एंट्रीज़ फ़ज़ी परिणामों से बाहर रखी जाती हैं।

### विफलता व्यवहार

- अमान्य glob पैटर्न => `glob_util::compile_glob` से त्रुटि।
- सर्च रूट एक मौजूदा डायरेक्टरी होनी चाहिए (`resolve_search_path`), अन्यथा त्रुटि।
- कैंसिलेशन/टाइमआउट लूप में `CancelToken::heartbeat()` जाँच के माध्यम से एबॉर्ट त्रुटियों के रूप में प्रचारित होते हैं।

### विकृत glob हैंडलिंग

`glob_util::build_glob_pattern` सहनशील है:

- `\` को `/` में नॉर्मलाइज़ करता है।
- `recursive=true` होने पर सरल रिकर्सिव पैटर्न को `**/` से ऑटो-प्रीफिक्स करता है।
- कंपाइल से पहले असंतुलित `{...` अल्टरनेशन ग्रुप को ऑटो-क्लोज़ करता है।

## 3) शेयर्ड स्कैन/कैश लाइफसाइकिल (`fs_cache`)

`fs_cache` स्कैन परिणामों को नॉर्मलाइज़्ड रिलेटिव एंट्रीज़ (`path`, `fileType`, वैकल्पिक `mtime`) के रूप में स्टोर करता है, जो इनसे की (key) किए जाते हैं:

- कैनोनिकल सर्च रूट
- `include_hidden`
- `use_gitignore`

### कैश स्टेट ट्रांज़िशन

1. **मिस / डिसेबल्ड**
   - TTL `0` है या key अनुपस्थित/एक्सपायर्ड -> ताज़ा `collect_entries`।
2. **हिट**
   - एंट्री आयु `< cache_ttl_ms()` -> कैश्ड एंट्रीज़ + `cache_age_ms` रिटर्न करें।
3. **स्टेल-एम्प्टी रीचेक** (`glob`/`grep`/`fd` में कॉलर पॉलिसी)
   - यदि क्वेरी शून्य मैच देती है और `cache_age_ms >= empty_recheck_ms()`, एक रीस्कैन फोर्स करें।
4. **इनवैलिडेशन**
   - `invalidateFsScanCache(path?)`:
     - कोई आर्ग नहीं: सभी keys क्लियर करें
     - path आर्ग: उन keys को हटाएँ जिनका root उस टारगेट पाथ को प्रीफिक्स करता है

### स्टेल-रिज़ल्ट ट्रेडऑफ

- कैश तत्काल कंसिस्टेंसी पर कम-लेटेंसी बार-बार के स्कैन को प्राथमिकता देता है।
- TTL विंडो स्टेल पॉज़िटिव/नेगेटिव रिटर्न कर सकती है।
- एम्प्टी-रिज़ल्ट रीचेक एक अतिरिक्त स्कैन की कीमत पर पुराने कैश्ड स्कैन के लिए स्टेल नेगेटिव को कम करता है।
- फाइल म्यूटेशन के बाद एक्सप्लिसिट इनवैलिडेशन इच्छित शुद्धता हुक है।

## 4) ANSI टेक्स्ट यूटिलिटीज़ (`text`)

ये प्योर, इन-मेमोरी यूटिलिटीज़ हैं (कोई फाइलसिस्टम स्कैनिंग नहीं)।

### सीमाएँ और जिम्मेदारियाँ

- **`text.rs` टर्मिनल-सेल सिमेंटिक्स का स्वामी है**:
  - ANSI सीक्वेंस पार्सिंग
  - ग्राफीम-अवेयर चौड़ाई और स्लाइसिंग
  - wrap/truncate/sanitize व्यवहार
- **`grep.rs` लाइन ट्रंकेशन (`maxColumns`) अलग है**:
  - मैच्ड लाइनों का `...` के साथ सरल कैरेक्टर-बाउंड्री ट्रंकेशन
  - ANSI-स्टेट-प्रिज़र्विंग नहीं और टर्मिनल-सेल चौड़ाई अवेयर नहीं

### मुख्य व्यवहार

- `wrapTextWithAnsi`: विज़िबल चौड़ाई से रैप करता है, रैप्ड लाइनों में एक्टिव SGR कोड कैरी करता है।
- `truncateToWidth`: ellipsis पॉलिसी (`Unicode`, `Ascii`, `Omit`), वैकल्पिक राइट पैडिंग, और अपरिवर्तित होने पर मूल JS स्ट्रिंग रिटर्न करने वाले फास्ट-पाथ के साथ विज़िबल-सेल ट्रंकेशन।
- `sliceWithWidth`: वैकल्पिक स्ट्रिक्ट चौड़ाई एनफोर्समेंट के साथ कॉलम स्लाइसिंग।
- `extractSegments`: ओवरले के आस-पास before/after सेगमेंट्स निकालता है जबकि `after` सेगमेंट के लिए ANSI स्टेट रीस्टोर करता है।
- `sanitizeText`: ANSI एस्केप + कंट्रोल कैरेक्टर्स स्ट्रिप करता है, लोन सरोगेट्स ड्रॉप करता है, `\r` हटाकर CR/LF नॉर्मलाइज़ करता है।
- `visibleWidth`: विज़िबल टर्मिनल सेल्स गिनता है (tabs Rust इम्प्लीमेंटेशन से फिक्स्ड `TAB_WIDTH` उपयोग करते हैं)।

### विफलता व्यवहार

टेक्स्ट फंक्शंस सामान्यतः निर्धारित ट्रांसफॉर्म्ड आउटपुट रिटर्न करते हैं; त्रुटियाँ JS स्ट्रिंग कन्वर्शन बाउंड्रीज़ (N-API आर्गुमेंट कन्वर्शन विफलताएँ) तक सीमित हैं।

## 5) सिंटैक्स हाइलाइटिंग (`highlight`)

`highlight.rs` प्योर ट्रांसफॉर्मेशन है (कोई FS नहीं, कोई कैश नहीं)।

### फ्लो

1. रैपर `code`, वैकल्पिक `lang`, और ANSI कलर पैलेट फॉरवर्ड करता है।
2. Rust सिंटैक्स रिज़ॉल्व करता है:
   - token/name लुकअप
   - extension लुकअप
   - alias टेबल फॉलबैक (`ts/tsx/js -> JavaScript`, आदि)
   - अनरिज़ॉल्व्ड होने पर प्लेन टेक्स्ट सिंटैक्स पर फॉलबैक
3. syntect `ParseState` और scope stack के साथ प्रत्येक लाइन पार्स करें।
4. स्कोप्स को 11 सिमेंटिक कलर कैटेगरीज़ पर मैप करें और ANSI कलर कोड इंजेक्ट/रीसेट करें।

### विफलता व्यवहार

- प्रति-लाइन पार्स विफलता कॉल को विफल नहीं करती: वह लाइन बिना हाइलाइट अपेंड की जाती है और प्रोसेसिंग जारी रहती है।
- अज्ञात/असमर्थित भाषा प्लेन टेक्स्ट सिंटैक्स पर फॉलबैक करती है।

## प्योर यूटिलिटी बनाम फाइलसिस्टम-निर्भर फ्लो

| फ्लो | फाइलसिस्टम एक्सेस | शेयर्ड कैश | नोट्स |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | नहीं | नहीं | केवल प्रदान किए गए bytes/string पर regex |
| `text` मॉड्यूल फंक्शंस | नहीं | नहीं | केवल ANSI/width/sanitization |
| `highlight` मॉड्यूल फंक्शंस | नहीं | नहीं | केवल syntax + ANSI कलरिंग |
| `glob` | हाँ | वैकल्पिक | डायरेक्टरी स्कैन + glob फिल्टरिंग |
| `fuzzyFind` | हाँ | वैकल्पिक | डायरेक्टरी स्कैन + फ़ज़ी स्कोरिंग |
| `grep` (file/dir path) | हाँ | वैकल्पिक (dir मोड) | फाइलों पर ripgrep, वैकल्पिक फिल्टर/कॉलबैक |

## एंड-टू-एंड लाइफसाइकिल सारांश

1. कॉलर टाइप्ड ऑप्शंस के साथ TS रैपर को इनवोक करता है।
2. रैपर डिफॉल्ट्स नॉर्मलाइज़ करता है (विशेषतः `glob`) और `native.*` एक्सपोर्ट को फॉरवर्ड करता है।
3. Rust ऑप्शंस को वैलिडेट/नॉर्मलाइज़ करता है और matcher/सर्च कॉन्फिग बनाता है।
4. फाइलसिस्टम फ्लो के लिए, एंट्रीज़ स्कैन की जाती हैं (कैश हिट/मिस/रीस्कैन) फिर फिल्टर/स्कोर की जाती हैं।
5. वर्कर लूप समय-समय पर cancel heartbeat कॉल करते हैं; timeout/abort एक्जीक्यूशन समाप्त कर सकता है।
6. Rust आउटपुट को N-API ऑब्जेक्ट्स (`lineNumber`, `matchCount`, `limitReached`, आदि) में शेप करता है।
7. TS रैपर टाइप्ड JS ऑब्जेक्ट्स (और `grep`/`glob` के लिए वैकल्पिक प्रति-मैच कॉलबैक) रिटर्न करता है।
