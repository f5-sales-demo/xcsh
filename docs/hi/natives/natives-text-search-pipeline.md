---
title: नेटिव्स टेक्स्ट और सर्च पाइपलाइन
description: >-
  grep, glob, और ripgrep-आधारित फ़ाइल कंटेंट इंडेक्सिंग के साथ नेटिव टेक्स्ट
  सर्च पाइपलाइन।
sidebar:
  order: 6
  label: टेक्स्ट और सर्च पाइपलाइन
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# नेटिव्स टेक्स्ट/सर्च पाइपलाइन

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` टेक्स्ट/सर्च सर्फेस (`grep`, `glob`, `text`, `highlight`) को TypeScript रैपर से Rust N-API एक्सपोर्ट तक और वापस JS परिणाम ऑब्जेक्ट तक मैप करता है।

शब्दावली `docs/natives-architecture.md` का अनुसरण करती है:

- **Wrapper**: `packages/natives/src/*` में TS API
- **Rust module layer**: `crates/pi-natives/src/*` में N-API एक्सपोर्ट
- **Shared scan cache**: `fs_cache`-समर्थित डायरेक्टरी-एंट्री कैश जो discovery/search फ्लो द्वारा उपयोग किया जाता है

## इम्प्लीमेंटेशन फ़ाइलें

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

| JS wrapper API | Rust export (`#[napi]`, snake_case -> camelCase) | Rust module |
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

## 1) Regex सर्च (`grep`, `searchContent`, `hasMatch`)

### इनपुट/विकल्प फ्लो

1. TS रैपर विकल्प नेटिव को फॉरवर्ड करता है:
   - `grep/index.ts` अधिकांश `options` को अपरिवर्तित पास करता है और कॉलबैक को `(match) => void` से napi threadsafe कॉलबैक शेप `(err, match)` में रैप करता है।
   - `searchContent` और `hasMatch` string/`Uint8Array` को सीधे पास करते हैं।
2. `grep.rs` में Rust विकल्प structs camelCase फ़ील्ड (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`) को deserialize करते हैं।
3. `grep` `timeoutMs` + `AbortSignal` से `CancelToken` बनाता है और `task::blocking("grep", ...)` के अंदर चलाता है।

### एक्ज़ीक्यूशन शाखाएँ

- **इन-मेमोरी शाखा (순수 उपयोगिता)**
  - `search` → `search_sync` → प्रदान किए गए कंटेंट बाइट्स पर `run_search`।
  - कोई फ़ाइलसिस्टम स्कैन नहीं, कोई `fs_cache` नहीं।
- **सिंगल-फ़ाइल शाखा (फ़ाइलसिस्टम-निर्भर)**
  - `grep_sync` पाथ रिज़ॉल्व करता है, मेटाडेटा जाँचता है कि यह फ़ाइल है, और प्रति फ़ाइल `MAX_FILE_BYTES` (`4 MiB`) तक ripgrep मैचर के माध्यम से स्ट्रीम करता है।
- **डायरेक्टरी शाखा (फ़ाइलसिस्टम-निर्भर)**
  - `cache: true` होने पर `fs_cache::get_or_scan` के माध्यम से वैकल्पिक कैश लुकअप।
  - `cache: false` होने पर `fs_cache::force_rescan` के माध्यम से फ्रेश स्कैन।
  - कैश आयु `empty_recheck_ms()` से अधिक होने पर खाली-परिणाम पुनर्जाँच।
  - एंट्री फ़िल्टरिंग: केवल-फ़ाइल + वैकल्पिक glob फ़िल्टर (`glob_util`) + वैकल्पिक टाइप फ़िल्टर मैपिंग (`js`, `ts`, `rust`, आदि)।

### सर्च/संग्रह सेमेंटिक्स

- Regex इंजन: `ignoreCase` और `multiline` के साथ `grep_regex::RegexMatcherBuilder`।
- कॉन्टेक्स्ट रिज़ॉल्यूशन:
  - `contextBefore/contextAfter` लेगेसी `context` को ओवरराइड करते हैं।
  - नॉन-कंटेंट मोड्स कॉन्टेक्स्ट कलेक्शन को शून्य कर देते हैं।
- आउटपुट मोड:
  - `content` => प्रति हिट एक `GrepMatch`।
  - `count` और `filesWithMatches` दोनों काउंट-स्टाइल एंट्री में मैप होते हैं (`lineNumber=0`, `line=""`, `matchCount` सेट)।
- सीमाएँ:
  - फ़ाइलों में वैश्विक `offset` और `maxCount` लागू।
  - समानांतर पाथ केवल तभी उपयोग होती है जब `maxCount` अनसेट हो और `offset == 0`; अन्यथा सीक्वेंशियल पाथ निर्धारक वैश्विक offset/limit सेमेंटिक्स को सुरक्षित रखती है।

### JS को वापस परिणाम आकार देना

- Rust `SearchResult`/`GrepResult` फ़ील्ड N-API ऑब्जेक्ट फ़ील्ड कन्वर्ज़न के माध्यम से TS टाइप में मैप होते हैं।
- काउंटर N-API पार करने से पहले `u32` तक क्लैंप किए जाते हैं।
- वैकल्पिक बूलियन कुछ पाथ में सत्य न होने पर छोड़ दिए जाते हैं (`limitReached`)।
- स्ट्रीमिंग कॉलबैक प्रत्येक आकारित `GrepMatch` (कंटेंट या काउंट एंट्री) प्राप्त करता है।

### विफलता व्यवहार

- `searchContent` थ्रो करने के बजाय regex/सर्च विफलताओं के लिए `SearchResult.error` लौटाता है।
- `grep` हार्ड एरर पर रिजेक्ट करता है (अमान्य पाथ, अमान्य glob/regex, रद्दीकरण टाइमआउट/abort)।
- `hasMatch` `Result<bool>` लौटाता है और अमान्य पैटर्न/UTF-8 डिकोडिंग एरर पर थ्रो करता है।
- मल्टी-फ़ाइल स्कैन में फ़ाइल ओपन/सर्च एरर प्रति-फ़ाइल स्किप किए जाते हैं; स्कैन जारी रहता है।

### विकृत regex हैंडलिंग

`grep.rs` regex कम्पाइल से पहले ब्रेसेज़ सैनिटाइज़ करता है:

- अमान्य repetition-जैसे ब्रेसेज़ एस्केप किए जाते हैं (`{`/`}` -> `\{`/`\}`) जब वे `{N}`, `{N,}`, `{N,M}` नहीं बना सकते।
- यह सामान्य लिटरल-टेम्पलेट फ्रैगमेंट (उदाहरण के लिए `${platform}`) को विकृत repetition के रूप में विफल होने से रोकता है।
- शेष अमान्य regex सिंटैक्स अभी भी regex एरर लौटाता है।

## 2) फ़ाइल डिस्कवरी (`glob`) और फ़ज़ी पाथ सर्च (`fuzzyFind`)

`glob` और `fuzzyFind` `fs_cache` स्कैन साझा करते हैं; मिलान तर्क भिन्न होता है।

### `glob` फ्लो

1. TS रैपर (`glob/index.ts`):
   - `path.resolve(options.path)`।
   - डिफ़ॉल्ट: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`।
2. Rust `glob` `GlobConfig` बनाता है और `glob_util::compile_glob` के माध्यम से पैटर्न कम्पाइल करता है।
3. एंट्री स्रोत:
   - `cache=true` => `get_or_scan` + वैकल्पिक stale-empty `force_rescan`।
   - `cache=false` => `force_rescan(..., store=false)` (केवल फ्रेश)।
4. फ़िल्टरिंग:
   - `.git` को हमेशा स्किप करें।
   - `node_modules` को स्किप करें जब तक अनुरोध न हो (`includeNodeModules` या node_modules उल्लेख करने वाला पैटर्न)।
   - glob मिलान लागू करें।
   - फ़ाइल-टाइप फ़िल्टर लागू करें; symlink `file/dir` फ़िल्टर टारगेट मेटाडेटा रिज़ॉल्व करते हैं।
5. `maxResults` तक छँटाई से पहले mtime desc द्वारा वैकल्पिक सॉर्ट (`sortByMtime`)।

### `fuzzyFind` फ्लो (`fd.rs` में इम्प्लीमेंट)

1. TS रैपर `grep` मॉड्यूल से एक्सपोर्ट होता है, लेकिन Rust इम्प्लीमेंटेशन `fd.rs` में रहता है।
2. `fs_cache` से साझा स्कैन स्रोत, समान cache/no-cache स्प्लिट और stale-empty recheck नीति के साथ।
3. स्कोरिंग:
   - exact / starts-with / contains / subsequence-आधारित fuzzy स्कोर
   - separator/punctuation-normalized स्कोरिंग पाथ
   - डायरेक्टरी बोनस और निर्धारक tie-break (`score desc`, फिर `path asc`)
4. Symlink एंट्री fuzzy परिणामों से बाहर रखी जाती हैं।

### विफलता व्यवहार

- अमान्य glob पैटर्न => `glob_util::compile_glob` से एरर।
- सर्च रूट एक मौजूदा डायरेक्टरी होनी चाहिए (`resolve_search_path`), अन्यथा एरर।
- रद्दीकरण/टाइमआउट लूप में `CancelToken::heartbeat()` जाँच के माध्यम से abort एरर के रूप में प्रचारित होते हैं।

### विकृत glob हैंडलिंग

`glob_util::build_glob_pattern` सहनशील है:

- `\` को `/` में नॉर्मलाइज़ करता है।
- जब `recursive=true` हो तो सरल recursive पैटर्न को `**/` से ऑटो-प्रीफ़िक्स करता है।
- कम्पाइल से पहले असंतुलित `{...` alternation ग्रुप को ऑटो-क्लोज़ करता है।

## 3) साझा स्कैन/कैश जीवनचक्र (`fs_cache`)

`fs_cache` स्कैन परिणामों को नॉर्मलाइज़ड सापेक्ष एंट्री (`path`, `fileType`, वैकल्पिक `mtime`) के रूप में संग्रहीत करता है, जिनकी कुंजी है:

- canonical सर्च रूट
- `include_hidden`
- `use_gitignore`

### कैश स्थिति परिवर्तन

1. **मिस / अक्षम**
   - TTL `0` है या कुंजी अनुपस्थित/समाप्त है -> फ्रेश `collect_entries`।
2. **हिट**
   - एंट्री आयु `< cache_ttl_ms()` -> कैश की गई एंट्री + `cache_age_ms` लौटाएँ।
3. **Stale-empty recheck** (कॉलर नीति `glob`/`grep`/`fd` में)
   - यदि क्वेरी शून्य मिलान देती है और `cache_age_ms >= empty_recheck_ms()`, तो एक बार force rescan करें।
4. **अमान्यीकरण**
   - `invalidateFsScanCache(path?)`:
     - कोई आर्ग नहीं: सभी कुंजियाँ साफ़ करें
     - path आर्ग: उन कुंजियों को हटाएँ जिनका रूट उस टारगेट पाथ को प्रीफ़िक्स करता है

### Stale-परिणाम ट्रेडऑफ

- कैश तत्काल संगतता के ऊपर कम-विलंबता दोहराए गए स्कैन को प्राथमिकता देता है।
- TTL विंडो stale पॉज़िटिव/नेगेटिव लौटा सकती है।
- Empty-result recheck एक अतिरिक्त स्कैन की कीमत पर पुराने कैश किए गए स्कैन के लिए stale नेगेटिव को कम करता है।
- स्पष्ट अमान्यीकरण फ़ाइल परिवर्तनों के बाद इच्छित correctness हुक है।

## 4) ANSI टेक्स्ट उपयोगिताएँ (`text`)

ये순수 इन-मेमोरी उपयोगिताएँ हैं (कोई फ़ाइलसिस्टम स्कैनिंग नहीं)।

### सीमाएँ और जिम्मेदारियाँ

- **`text.rs` टर्मिनल-सेल सेमेंटिक्स का स्वामी है**:
  - ANSI सीक्वेंस पार्सिंग
  - grapheme-aware चौड़ाई और स्लाइसिंग
  - wrap/truncate/sanitize व्यवहार
- **`grep.rs` लाइन ट्रंकेशन (`maxColumns`) अलग है**:
  - `...` के साथ मिलान की गई लाइनों का सरल character-boundary ट्रंकेशन
  - ANSI-state-preserving नहीं और टर्मिनल-सेल width aware नहीं

### प्रमुख व्यवहार

- `wrapTextWithAnsi`: दृश्यमान चौड़ाई से रैप करता है, रैप की गई लाइनों में सक्रिय SGR कोड ले जाता है।
- `truncateToWidth`: ellipsis नीति (`Unicode`, `Ascii`, `Omit`) के साथ दृश्यमान-सेल ट्रंकेशन, वैकल्पिक राइट पैडिंग, और अपरिवर्तित होने पर मूल JS string लौटाने का fast-path।
- `sliceWithWidth`: वैकल्पिक strict width enforcement के साथ कॉलम स्लाइसिंग।
- `extractSegments`: `after` सेगमेंट के लिए ANSI स्थिति को पुनर्स्थापित करते हुए एक ओवरले के आसपास पहले/बाद के सेगमेंट निकालता है।
- `sanitizeText`: ANSI एस्केप + कंट्रोल चार्स स्ट्रिप करता है, lone surrogates छोड़ता है, `\r` हटाकर CR/LF नॉर्मलाइज़ करता है।
- `visibleWidth`: दृश्यमान टर्मिनल सेल गिनता है (टैब Rust इम्प्लीमेंटेशन से निश्चित `TAB_WIDTH` उपयोग करते हैं)।

### विफलता व्यवहार

टेक्स्ट फ़ंक्शन सामान्यतः निर्धारक रूपांतरित आउटपुट लौटाते हैं; एरर JS string कन्वर्ज़न सीमाओं तक सीमित हैं (N-API आर्ग्युमेंट कन्वर्ज़न विफलताएँ)।

## 5) सिंटैक्स हाइलाइटिंग (`highlight`)

`highlight.rs`순수 ट्रांसफ़ॉर्मेशन है (कोई FS नहीं, कोई कैश नहीं)।

### फ्लो

1. रैपर `code`, वैकल्पिक `lang`, और ANSI कलर पैलेट फॉरवर्ड करता है।
2. Rust सिंटैक्स रिज़ॉल्व करता है:
   - token/name लुकअप
   - extension लुकअप
   - alias टेबल फ़ॉलबैक (`ts/tsx/js -> JavaScript`, आदि)
   - अनरिज़ॉल्व होने पर plain text सिंटैक्स में फ़ॉलबैक
3. syntect `ParseState` और scope stack के साथ प्रत्येक लाइन पार्स करें।
4. स्कोप को 11 सेमेंटिक कलर श्रेणियों में मैप करें और ANSI कलर कोड इंजेक्ट/रीसेट करें।

### विफलता व्यवहार

- प्रति-लाइन पार्स विफलता कॉल को विफल नहीं करती: वह लाइन बिना हाइलाइट के जोड़ी जाती है और प्रोसेसिंग जारी रहती है।
- अज्ञात/असमर्थित भाषा plain text सिंटैक्स में फ़ॉलबैक करती है।

##순수 उपयोगिता बनाम फ़ाइलसिस्टम-निर्भर फ्लो

| फ्लो | फ़ाइलसिस्टम एक्सेस | साझा कैश | नोट्स |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | नहीं | नहीं | केवल प्रदान किए गए बाइट्स/string पर regex |
| `text` मॉड्यूल फ़ंक्शन | नहीं | नहीं | केवल ANSI/width/sanitization |
| `highlight` मॉड्यूल फ़ंक्शन | नहीं | नहीं | केवल syntax + ANSI कलरिंग |
| `glob` | हाँ | वैकल्पिक | डायरेक्टरी स्कैन + glob फ़िल्टरिंग |
| `fuzzyFind` | हाँ | वैकल्पिक | डायरेक्टरी स्कैन + fuzzy स्कोरिंग |
| `grep` (file/dir path) | हाँ | वैकल्पिक (dir मोड) | फ़ाइलों पर ripgrep, वैकल्पिक फ़िल्टर/कॉलबैक |

## एंड-टू-एंड जीवनचक्र सारांश

1. कॉलर टाइप किए गए विकल्पों के साथ TS रैपर को आमंत्रित करता है।
2. रैपर डिफ़ॉल्ट नॉर्मलाइज़ करता है (विशेषकर `glob`) और `native.*` एक्सपोर्ट को फॉरवर्ड करता है।
3. Rust विकल्पों को validate/normalize करता है और matcher/search config बनाता है।
4. फ़ाइलसिस्टम फ्लो के लिए, एंट्री स्कैन की जाती हैं (cache hit/miss/rescan) फिर filter/score की जाती हैं।
5. Worker लूप समय-समय पर cancel heartbeat को कॉल करते हैं; timeout/abort एक्ज़ीक्यूशन समाप्त कर सकते हैं।
6. Rust आउटपुट को N-API ऑब्जेक्ट (`lineNumber`, `matchCount`, `limitReached`, आदि) में आकार देता है।
7. TS रैपर टाइप किए गए JS ऑब्जेक्ट लौटाता है (और `grep`/`glob` के लिए वैकल्पिक प्रति-मिलान कॉलबैक)।
