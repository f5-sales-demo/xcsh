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

# Natives Text/Search Pipeline

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` text/search सतह (`grep`, `glob`, `text`, `highlight`) को TypeScript wrappers से Rust N-API exports और फिर वापस JS result objects तक मैप करता है।

शब्दावली `docs/natives-architecture.md` का अनुसरण करती है:

- **Wrapper**: `packages/natives/src/*` में TS API
- **Rust module layer**: `crates/pi-natives/src/*` में N-API exports
- **Shared scan cache**: `fs_cache`-आधारित directory-entry cache जो discovery/search प्रवाहों द्वारा उपयोग किया जाता है

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

## JS API ↔ Rust export मैपिंग

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

## उपप्रणाली के अनुसार पाइपलाइन अवलोकन

## 1) Regex खोज (`grep`, `searchContent`, `hasMatch`)

### इनपुट/विकल्प प्रवाह

1. TS wrapper विकल्पों को native को अग्रेषित करता है:
   - `grep/index.ts` `options` को अधिकतर अपरिवर्तित पास करता है और callback को `(match) => void` से napi threadsafe callback आकार `(err, match)` में रूपांतरित करता है।
   - `searchContent` और `hasMatch` string/`Uint8Array` सीधे पास करते हैं।
2. `grep.rs` में Rust option structs camelCase फ़ील्ड्स (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`) को deserialize करते हैं।
3. `grep` `timeoutMs` + `AbortSignal` से `CancelToken` बनाता है और `task::blocking("grep", ...)` के अंदर चलता है।

### निष्पादन शाखाएँ

- **इन-मेमोरी शाखा (शुद्ध उपयोगिता)**
  - `search` → `search_sync` → प्रदान किए गए content bytes पर `run_search`।
  - कोई फ़ाइल सिस्टम स्कैन नहीं, कोई `fs_cache` नहीं।
- **एकल-फ़ाइल शाखा (फ़ाइल सिस्टम-निर्भर)**
  - `grep_sync` पथ को resolve करता है, metadata की जाँच करता है कि फ़ाइल है, ripgrep matcher के माध्यम से प्रति फ़ाइल `MAX_FILE_BYTES` (`4 MiB`) तक स्ट्रीम करता है।
- **डायरेक्टरी शाखा (फ़ाइल सिस्टम-निर्भर)**
  - `cache: true` होने पर `fs_cache::get_or_scan` के माध्यम से वैकल्पिक cache lookup।
  - `cache: false` होने पर `fs_cache::force_rescan` के माध्यम से ताज़ा स्कैन।
  - cache आयु `empty_recheck_ms()` से अधिक होने पर वैकल्पिक खाली-परिणाम पुनर्जाँच।
  - एंट्री फ़िल्टरिंग: केवल-फ़ाइल + वैकल्पिक glob फ़िल्टर (`glob_util`) + वैकल्पिक प्रकार फ़िल्टर मैपिंग (`js`, `ts`, `rust`, आदि)।

### खोज/संग्रह शब्दार्थ

- Regex इंजन: `ignoreCase` और `multiline` के साथ `grep_regex::RegexMatcherBuilder`।
- Context resolution:
  - `contextBefore/contextAfter` लिगेसी `context` को ओवरराइड करते हैं।
  - गैर-content मोड context संग्रह को शून्य कर देते हैं।
- आउटपुट मोड:
  - `content` => प्रति हिट एक `GrepMatch`।
  - `count` और `filesWithMatches` दोनों count-शैली प्रविष्टियों पर मैप होते हैं (`lineNumber=0`, `line=""`, `matchCount` सेट)।
- सीमाएँ:
  - वैश्विक `offset` और `maxCount` फ़ाइलों में लागू होते हैं।
  - समानांतर पथ केवल तब उपयोग किया जाता है जब `maxCount` अनसेट हो और `offset == 0` हो; अन्यथा अनुक्रमिक पथ निर्धारक वैश्विक offset/limit शब्दार्थ को संरक्षित करता है।

### JS में वापस परिणाम आकार देना

- Rust `SearchResult`/`GrepResult` फ़ील्ड्स N-API object field रूपांतरण के माध्यम से TS प्रकारों पर मैप होते हैं।
- N-API पार करने से पहले काउंटर `u32` में क्लैम्प किए जाते हैं।
- वैकल्पिक booleans कुछ पथों में true न होने पर छोड़ दिए जाते हैं (`limitReached`)।
- स्ट्रीमिंग callback प्रत्येक आकार दिए गए `GrepMatch` (content या count प्रविष्टि) प्राप्त करता है।

### विफलता व्यवहार

- `searchContent` regex/search विफलताओं के लिए throw करने के बजाय `SearchResult.error` लौटाता है।
- `grep` कठोर त्रुटियों पर reject करता है (अमान्य पथ, अमान्य glob/regex, रद्दीकरण timeout/abort)।
- `hasMatch` `Result<bool>` लौटाता है और अमान्य pattern/UTF-8 डिकोडिंग त्रुटियों पर throw करता है।
- बहु-फ़ाइल स्कैन में फ़ाइल open/search त्रुटियाँ प्रति-फ़ाइल छोड़ दी जाती हैं; स्कैन जारी रहता है।

### विकृत regex हैंडलिंग

`grep.rs` regex compile से पहले braces को sanitize करता है:

- अमान्य repetition-जैसे braces को escape किया जाता है (`{`/`}` -> `\{`/`\}`) जब वे `{N}`, `{N,}`, `{N,M}` नहीं बना सकते।
- यह सामान्य literal-template fragments (उदाहरण के लिए `${platform}`) को विकृत repetition के रूप में विफल होने से रोकता है।
- शेष अमान्य regex syntax अभी भी regex त्रुटि लौटाता है।

## 2) फ़ाइल खोज (`glob`) और fuzzy पथ खोज (`fuzzyFind`)

`glob` और `fuzzyFind` `fs_cache` स्कैन साझा करते हैं; मिलान तर्क भिन्न है।

### `glob` प्रवाह

1. TS wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`।
   - डिफ़ॉल्ट: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`।
2. Rust `glob` `GlobConfig` बनाता है और `glob_util::compile_glob` के माध्यम से pattern संकलित करता है।
3. एंट्री स्रोत:
   - `cache=true` => `get_or_scan` + वैकल्पिक stale-empty `force_rescan`।
   - `cache=false` => `force_rescan(..., store=false)` (केवल ताज़ा)।
4. फ़िल्टरिंग:
   - `.git` हमेशा छोड़ें।
   - अनुरोध न किए जाने पर `node_modules` छोड़ें (`includeNodeModules` या node_modules का उल्लेख करने वाला pattern)।
   - glob match लागू करें।
   - फ़ाइल-प्रकार फ़िल्टर लागू करें; symlink `file/dir` फ़िल्टर लक्ष्य metadata resolve करते हैं।
5. `maxResults` में truncate करने से पहले mtime desc द्वारा वैकल्पिक सॉर्ट (`sortByMtime`)।

### `fuzzyFind` प्रवाह (`fd.rs` में कार्यान्वित)

1. TS wrapper `grep` मॉड्यूल से export किया जाता है, लेकिन Rust कार्यान्वयन `fd.rs` में रहता है।
2. समान cache/no-cache विभाजन और stale-empty recheck नीति के साथ `fs_cache` से साझा स्कैन स्रोत।
3. स्कोरिंग:
   - exact / starts-with / contains / subsequence-आधारित fuzzy score
   - separator/punctuation-सामान्यीकृत स्कोरिंग पथ
   - directory बोनस और निर्धारक tie-break (`score desc`, फिर `path asc`)
4. Symlink प्रविष्टियाँ fuzzy परिणामों से बाहर रखी जाती हैं।

### विफलता व्यवहार

- अमान्य glob pattern => `glob_util::compile_glob` से त्रुटि।
- खोज root एक मौजूदा डायरेक्टरी होनी चाहिए (`resolve_search_path`), अन्यथा त्रुटि।
- रद्दीकरण/timeouts लूप में `CancelToken::heartbeat()` जाँच के माध्यम से abort त्रुटियों के रूप में प्रसारित होते हैं।

### विकृत glob हैंडलिंग

`glob_util::build_glob_pattern` सहनशील है:

- `\` को `/` में सामान्यीकृत करता है।
- `recursive=true` होने पर सरल recursive patterns को स्वचालित रूप से `**/` से prefix करता है।
- compile से पहले असंतुलित `{...` alternation groups को स्वचालित रूप से बंद करता है।

## 3) साझा स्कैन/cache जीवनचक्र (`fs_cache`)

`fs_cache` स्कैन परिणामों को सामान्यीकृत सापेक्ष प्रविष्टियों (`path`, `fileType`, वैकल्पिक `mtime`) के रूप में संग्रहीत करता है, जो इनके द्वारा कुंजीकृत हैं:

- canonical search root
- `include_hidden`
- `use_gitignore`

### Cache स्थिति संक्रमण

1. **Miss / अक्षम**
   - TTL `0` है या key अनुपस्थित/समाप्त -> ताज़ा `collect_entries`।
2. **Hit**
   - एंट्री आयु `< cache_ttl_ms()` -> cached entries + `cache_age_ms` लौटाएँ।
3. **Stale-empty पुनर्जाँच** (`glob`/`grep`/`fd` में कॉलर नीति)
   - यदि query शून्य मिलान देती है और `cache_age_ms >= empty_recheck_ms()`, एक rescan बाध्य करें।
4. **Invalidation**
   - `invalidateFsScanCache(path?)`:
     - कोई arg नहीं: सभी keys साफ़ करें
     - path arg: उन keys को हटाएँ जिनका root उस लक्ष्य पथ को prefix करता है

### Stale-result ट्रेडऑफ़

- Cache तत्काल संगति की तुलना में कम-विलंबता दोहराए गए स्कैन को प्राथमिकता देता है।
- TTL विंडो stale positives/negatives लौटा सकती है।
- खाली-परिणाम पुनर्जाँच एक अतिरिक्त स्कैन की कीमत पर पुराने cached स्कैन के लिए stale negatives को कम करती है।
- फ़ाइल म्यूटेशन के बाद स्पष्ट invalidation इच्छित शुद्धता हुक है।

## 4) ANSI text उपयोगिताएँ (`text`)

ये शुद्ध, इन-मेमोरी उपयोगिताएँ हैं (कोई फ़ाइल सिस्टम स्कैनिंग नहीं)।

### सीमाएँ और उत्तरदायित्व

- **`text.rs` टर्मिनल-सेल शब्दार्थ का स्वामी है**:
  - ANSI sequence parsing
  - grapheme-aware चौड़ाई और slicing
  - wrap/truncate/sanitize व्यवहार
- **`grep.rs` line truncation (`maxColumns`) अलग है**:
  - `...` के साथ मिलान की गई पंक्तियों का सरल character-boundary truncation
  - ANSI-state-संरक्षित नहीं और टर्मिनल-सेल चौड़ाई जागरूक नहीं

### मुख्य व्यवहार

- `wrapTextWithAnsi`: दृश्य चौड़ाई के अनुसार wrap करता है, wrapped पंक्तियों में सक्रिय SGR codes को ले जाता है।
- `truncateToWidth`: ellipsis नीति (`Unicode`, `Ascii`, `Omit`), वैकल्पिक दाएँ padding, और अपरिवर्तित होने पर मूल JS string लौटाने वाले fast-path के साथ visible-cell truncation।
- `sliceWithWidth`: वैकल्पिक strict चौड़ाई प्रवर्तन के साथ column slicing।
- `extractSegments`: `after` segment के लिए ANSI state को पुनर्स्थापित करते हुए एक overlay के आसपास before/after segments निकालता है।
- `sanitizeText`: ANSI escapes + control chars को हटाता है, lone surrogates को छोड़ता है, `\r` को हटाकर CR/LF को सामान्यीकृत करता है।
- `visibleWidth`: दृश्य टर्मिनल cells की गणना करता है (tabs Rust कार्यान्वयन से निश्चित `TAB_WIDTH` का उपयोग करते हैं)।

### विफलता व्यवहार

Text फ़ंक्शन सामान्यतः निर्धारक रूपांतरित आउटपुट लौटाते हैं; त्रुटियाँ JS string रूपांतरण सीमाओं (N-API argument रूपांतरण विफलताओं) तक सीमित हैं।

## 5) Syntax highlighting (`highlight`)

`highlight.rs` शुद्ध रूपांतरण है (कोई FS नहीं, कोई cache नहीं)।

### प्रवाह

1. Wrapper `code`, वैकल्पिक `lang`, और ANSI color palette अग्रेषित करता है।
2. Rust syntax को इनके द्वारा resolve करता है:
   - token/name lookup
   - extension lookup
   - alias table fallback (`ts/tsx/js -> JavaScript`, आदि)
   - अनresolved होने पर plain text syntax पर fallback
3. syntect `ParseState` और scope stack के साथ प्रत्येक पंक्ति को parse करें।
4. Scopes को 11 semantic color श्रेणियों पर मैप करें और ANSI color codes inject/reset करें।

### विफलता व्यवहार

- प्रति-पंक्ति parse विफलता कॉल को विफल नहीं करती: वह पंक्ति बिना highlighting के जोड़ी जाती है और प्रसंस्करण जारी रहता है।
- अज्ञात/असमर्थित भाषा plain text syntax पर fallback करती है।

## शुद्ध उपयोगिता बनाम फ़ाइल सिस्टम-निर्भर प्रवाह

| प्रवाह | फ़ाइल सिस्टम पहुँच | साझा cache | नोट्स |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | नहीं | नहीं | केवल प्रदान किए गए bytes/string पर regex |
| `text` मॉड्यूल फ़ंक्शन | नहीं | नहीं | केवल ANSI/width/sanitization |
| `highlight` मॉड्यूल फ़ंक्शन | नहीं | नहीं | केवल syntax + ANSI coloring |
| `glob` | हाँ | वैकल्पिक | directory scans + glob filtering |
| `fuzzyFind` | हाँ | वैकल्पिक | directory scans + fuzzy scoring |
| `grep` (file/dir path) | हाँ | वैकल्पिक (dir mode) | फ़ाइलों पर ripgrep, वैकल्पिक filters/callback |

## एंड-टू-एंड जीवनचक्र सारांश

1. कॉलर typed options के साथ TS wrapper को आमंत्रित करता है।
2. Wrapper डिफ़ॉल्ट (विशेष रूप से `glob`) को सामान्यीकृत करता है और `native.*` export को अग्रेषित करता है।
3. Rust options को validate/normalize करता है और matcher/search config बनाता है।
4. फ़ाइल सिस्टम प्रवाहों के लिए, entries स्कैन की जाती हैं (cache hit/miss/rescan) फिर filter/score की जाती हैं।
5. Worker loops समय-समय पर cancel heartbeat कॉल करते हैं; timeout/abort निष्पादन समाप्त कर सकता है।
6. Rust आउटपुट को N-API objects (`lineNumber`, `matchCount`, `limitReached`, आदि) में आकार देता है।
7. TS wrapper typed JS objects लौटाता है (और `grep`/`glob` के लिए वैकल्पिक प्रति-match callbacks)।
