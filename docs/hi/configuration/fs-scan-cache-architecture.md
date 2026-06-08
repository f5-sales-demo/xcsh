---
title: Filesystem Scan Cache Architecture
description: >-
  Filesystem scan cache contract for fast file discovery with
  stale-while-revalidate semantics.
sidebar:
  order: 8
  label: Filesystem scan cache
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# Filesystem Scan Cache आर्किटेक्चर कॉन्ट्रैक्ट

यह दस्तावेज़ Rust (`crates/pi-natives/src/fs_cache.rs`) में लागू साझा filesystem scan cache के वर्तमान कॉन्ट्रैक्ट को परिभाषित करता है, जिसे `packages/coding-agent` को उपलब्ध कराए गए native discovery/search API द्वारा उपयोग किया जाता है।

## यह cache क्या है

यह cache पूर्ण directory-scan entry सूचियों (`GlobMatch[]`) को scan scope और traversal policy के आधार पर key करके संग्रहीत करता है, फिर उच्च-स्तरीय संचालनों (glob filtering, fuzzy scoring, grep file selection) को उन cached entries पर चलने देता है।

प्राथमिक लक्ष्य:

- बार-बार की जाने वाली discovery/search कॉल्स के लिए दोहराए जाने वाले filesystem walks से बचना
- जब `glob`, `fuzzyFind`, और `grep` एक ही scan policy साझा करें तो उनके बीच consistency बनाए रखना
- खाली परिणामों के लिए स्पष्ट staleness recovery और file mutations के बाद स्पष्ट invalidation की अनुमति देना

## स्वामित्व और सार्वजनिक सतह

- Cache कार्यान्वयन और policy: `crates/pi-natives/src/fs_cache.rs`
- Native consumers:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JS binding/export:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agent mutation invalidation helpers:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## Cache key विभाजन (कठोर कॉन्ट्रैक्ट)

प्रत्येक entry इन आधारों पर key की जाती है:

- canonicalized `root` directory path
- `include_hidden` boolean
- `use_gitignore` boolean

निहितार्थ:

- Hidden और non-hidden scans entries **साझा नहीं** करते।
- Gitignore-respecting और ignore-disabled scans entries **साझा नहीं** करते।
- Consumers को hidden/gitignore व्यवहार के लिए स्थिर semantics पास करने चाहिए; किसी भी flag को बदलने से एक अलग cache partition बनता है।

`node_modules` inclusion cache key में **नहीं** है। Cache entries को `node_modules` सहित संग्रहीत करता है; प्रति-consumer filtering retrieval के बाद लागू की जाती है।

## Scan संग्रहण व्यवहार

Cache population एक deterministic walker (`ignore::WalkBuilder`) का उपयोग करता है जो `include_hidden` और `use_gitignore` द्वारा कॉन्फ़िगर किया जाता है:

- `follow_links(false)`
- file path के अनुसार sorted
- `.git` हमेशा छोड़ दिया जाता है
- `node_modules` हमेशा cache-scan समय पर collect किया जाता है (और बाद में वैकल्पिक रूप से filter किया जाता है)
- entry file type + `mtime` को `symlink_metadata` के माध्यम से capture किया जाता है

Search roots को `resolve_search_path` द्वारा resolve किया जाता है:

- relative paths को वर्तमान cwd के विरुद्ध resolve किया जाता है
- target एक मौजूदा directory होनी चाहिए
- root को जब संभव हो canonicalize किया जाता है

## Freshness और eviction policy

Global policy (environment-overridable):

- `FS_SCAN_CACHE_TTL_MS` (डिफ़ॉल्ट `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (डिफ़ॉल्ट `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (डिफ़ॉल्ट `16`)

व्यवहार:

- `get_or_scan(...)`
  - यदि TTL `0` है: cache को पूरी तरह bypass करें, हमेशा fresh scan (`cache_age_ms = 0`)
  - TTL के भीतर cache hit पर: cached entries + non-zero `cache_age_ms` लौटाएं
  - expired hit पर: key को evict करें, rescan करें, fresh entry संग्रहीत करें
- max entry enforcement `created_at` के आधार पर oldest-first eviction है

## खाली-परिणाम fast recheck (सामान्य hits से अलग)

सामान्य cache hit:

- TTL के भीतर एक cache hit cached entries लौटाता है और कुछ और नहीं करता।

खाली-परिणाम fast recheck:

- यह `ScanResult.cache_age_ms` का उपयोग करने वाली एक **caller-side** policy है
- यदि filtered/query result खाली है और cached scan age कम से कम `empty_recheck_ms()` है, तो caller एक `force_rescan(...)` करता है और पुनः प्रयास करता है
- इसका उद्देश्य stale-negative परिणामों को कम करना है जब files हाल ही में जोड़ी गई हों लेकिन cache अभी भी TTL के भीतर हो

वर्तमान consumers:

- `glob`: जब filtered matches खाली हों और scan age threshold से अधिक हो तो recheck करता है
- `fuzzyFind` (`fd.rs`): केवल तब recheck करता है जब query non-empty हो और scored matches खाली हों
- `grep`: जब चयनित candidate file सूची खाली हो तो recheck करता है

## Consumer defaults और cache उपयोग

Cache सभी exposed APIs पर opt-in है (`cache?: boolean`, डिफ़ॉल्ट `false`)।

Native APIs में वर्तमान defaults:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, और cache scan हमेशा `use_gitignore=true` का उपयोग करता है

आज के Coding-agent callers:

- उच्च-वॉल्यूम mention candidate discovery cache सक्षम करती है:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - प्रोफ़ाइल: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- Tool-level `grep` integration वर्तमान में scan cache अक्षम करता है (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Invalidation कॉन्ट्रैक्ट

Native invalidation entrypoint:

- `invalidateFsScanCache(path?: string)`
  - `path` के साथ: उन cache entries को हटाएं जिनका root target path का prefix है
  - path के बिना: सभी scan cache entries साफ़ करें

Path handling विवरण:

- relative invalidation paths को cwd के विरुद्ध resolve किया जाता है
- invalidation canonicalization का प्रयास करता है
- यदि target मौजूद नहीं है (जैसे, delete), तो fallback parent को canonicalize करता है और जब संभव हो filename को पुनः जोड़ता है
- यह create/delete/rename के लिए invalidation व्यवहार को संरक्षित करता है जहां एक पक्ष मौजूद नहीं हो सकता

## Coding-agent mutation flow जिम्मेदारियाँ

Coding-agent कोड को सफल filesystem mutations के बाद invalidate करना चाहिए।

केंद्रीय helpers:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (जब paths भिन्न हों तो दोनों पक्षों को invalidate करता है)

वर्तमान mutation tool callsites:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (hashline/patch/replace flows)

नियम: यदि कोई flow filesystem content या location को mutate करता है और इन helpers को bypass करता है, तो cache staleness bugs अपेक्षित हैं।

## एक नया cache consumer सुरक्षित रूप से जोड़ना

जब किसी नए scanner/search path में cache उपयोग शुरू करें:

1. **स्थिर scan policy inputs का उपयोग करें**
   - पहले hidden/gitignore semantics तय करें
   - उन्हें `get_or_scan`/`force_rescan` को consistently पास करें ताकि cache partitions जानबूझकर हों

2. **Cache data को केवल traversal policy द्वारा pre-filtered मानें**
   - tool-specific filtering (glob patterns, type filters, node_modules rules) retrieval के बाद लागू करें
   - कभी यह न मानें कि cached entries पहले से ही आपके उच्च-स्तरीय filters को दर्शाती हैं

3. **खाली-परिणाम fast recheck केवल stale-negative जोखिम के लिए लागू करें**
   - `scan.cache_age_ms >= empty_recheck_ms()` का उपयोग करें
   - `force_rescan(..., store=true, ...)` के साथ एक बार पुनः प्रयास करें
   - इस path को सामान्य cache-hit logic से अलग रखें

4. **no-cache mode का स्पष्ट रूप से सम्मान करें**
   - जब caller cache अक्षम करे, `force_rescan(..., store=false, ...)` कॉल करें
   - no-cache request path में साझा cache को populate न करें

5. **किसी भी नए write path के लिए mutation invalidation जोड़ें**
   - सफल write/edit/delete/rename के बाद, coding-agent invalidation helper कॉल करें
   - rename/move के लिए, पुराने और नए दोनों paths को invalidate करें

6. **प्रति-कॉल TTL knobs न जोड़ें**
   - वर्तमान कॉन्ट्रैक्ट केवल global policy (env-configured) है, कोई प्रति-request TTL override नहीं

## ज्ञात सीमाएँ

- Cache scope process-local in-memory (`DashMap`) है, process restarts के बीच persist नहीं होता।
- Cache scan entries संग्रहीत करता है, अंतिम tool results नहीं।
- `glob`/`fuzzyFind`/`grep` scan entries केवल तब साझा करते हैं जब key dimensions (`root`, `hidden`, `gitignore`) मेल खाएं।
- `.git` को caller options की परवाह किए बिना scan collection समय पर हमेशा बाहर रखा जाता है।
