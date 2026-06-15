---
title: फ़ाइलसिस्टम स्कैन कैश आर्किटेक्चर
description: >-
  तेज़ फ़ाइल खोज के लिए फ़ाइलसिस्टम स्कैन कैश अनुबंध, जिसमें
  stale-while-revalidate सेमेंटिक्स शामिल हैं।
sidebar:
  order: 8
  label: फ़ाइलसिस्टम स्कैन कैश
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# फ़ाइलसिस्टम स्कैन कैश आर्किटेक्चर अनुबंध

यह दस्तावेज़ Rust में लागू किए गए साझा फ़ाइलसिस्टम स्कैन कैश (`crates/pi-natives/src/fs_cache.rs`) के वर्तमान अनुबंध को परिभाषित करता है, जिसे `packages/coding-agent` को एक्सपोज़ की गई नेटिव discovery/search APIs द्वारा उपयोग किया जाता है।

## यह कैश क्या है

कैश में स्कैन स्कोप और ट्रैवर्सल पॉलिसी के आधार पर कुंजीबद्ध पूर्ण डायरेक्टरी-स्कैन एंट्री सूचियाँ (`GlobMatch[]`) संग्रहीत की जाती हैं, फिर उच्च-स्तरीय ऑपरेशन (glob फ़िल्टरिंग, fuzzy स्कोरिंग, grep फ़ाइल चयन) उन कैश्ड एंट्री के विरुद्ध चलाए जाते हैं।

प्राथमिक लक्ष्य:

- बार-बार discovery/search कॉल के लिए बार-बार फ़ाइलसिस्टम वॉक से बचना
- `glob`, `fuzzyFind`, और `grep` के बीच एकरूपता बनाए रखना जब वे एक ही स्कैन पॉलिसी साझा करते हों
- खाली परिणामों के लिए स्पष्ट staleness पुनर्प्राप्ति और फ़ाइल म्यूटेशन के बाद स्पष्ट invalidation की अनुमति देना

## स्वामित्व और सार्वजनिक सतह

- कैश कार्यान्वयन और पॉलिसी: `crates/pi-natives/src/fs_cache.rs`
- नेटिव उपभोक्ता:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JS बाइंडिंग/एक्सपोर्ट:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agent म्यूटेशन invalidation हेल्पर:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## कैश कुंजी विभाजन (हार्ड अनुबंध)

प्रत्येक एंट्री निम्न द्वारा कुंजीबद्ध होती है:

- canonicalized `root` डायरेक्टरी पाथ
- `include_hidden` बूलियन
- `use_gitignore` बूलियन

निहितार्थ:

- हिडन और नॉन-हिडन स्कैन एंट्री साझा **नहीं** करते।
- Gitignore-respecting और ignore-disabled स्कैन एंट्री साझा **नहीं** करते।
- उपभोक्ताओं को hidden/gitignore व्यवहार के लिए स्थिर सेमेंटिक्स पास करना होगा; किसी भी फ्लैग को बदलने से एक अलग कैश पार्टीशन बनता है।

`node_modules` समावेश कैश कुंजी में **नहीं** है। कैश में `node_modules` सहित एंट्री संग्रहीत होती हैं; प्रति-उपभोक्ता फ़िल्टरिंग पुनर्प्राप्ति के बाद लागू होती है।

## स्कैन संग्रह व्यवहार

कैश पॉप्युलेशन एक निर्धारक वॉकर (`ignore::WalkBuilder`) का उपयोग करती है जो `include_hidden` और `use_gitignore` द्वारा कॉन्फ़िगर होता है:

- `follow_links(false)`
- फ़ाइल पाथ के अनुसार क्रमबद्ध
- `.git` हमेशा छोड़ा जाता है
- `node_modules` हमेशा कैश-स्कैन समय पर एकत्र किया जाता है (और वैकल्पिक रूप से बाद में फ़िल्टर किया जाता है)
- एंट्री फ़ाइल प्रकार + `mtime` `symlink_metadata` के माध्यम से कैप्चर किए जाते हैं

खोज रूट `resolve_search_path` द्वारा रिज़ॉल्व किए जाते हैं:

- सापेक्ष पाथ वर्तमान cwd के विरुद्ध रिज़ॉल्व होते हैं
- लक्ष्य एक मौजूदा डायरेक्टरी होनी चाहिए
- संभव होने पर रूट canonicalize किया जाता है

## ताज़गी और निष्कासन नीति

वैश्विक नीति (environment-overridable):

- `FS_SCAN_CACHE_TTL_MS` (डिफ़ॉल्ट `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (डिफ़ॉल्ट `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (डिफ़ॉल्ट `16`)

व्यवहार:

- `get_or_scan(...)`
  - यदि TTL `0` है: कैश को पूरी तरह बायपास करें, हमेशा ताज़ा स्कैन (`cache_age_ms = 0`)
  - TTL के भीतर कैश हिट पर: कैश्ड एंट्री + नॉन-ज़ीरो `cache_age_ms` लौटाएं
  - एक्सपायर्ड हिट पर: कुंजी evict करें, रिस्कैन करें, ताज़ा एंट्री स्टोर करें
- अधिकतम एंट्री प्रवर्तन `created_at` के अनुसार oldest-first eviction है

## खाली-परिणाम फास्ट रीचेक (सामान्य हिट से अलग)

सामान्य कैश हिट:

- TTL के भीतर कैश हिट कैश्ड एंट्री लौटाती है और कुछ नहीं करती।

खाली-परिणाम फास्ट रीचेक:

- यह `ScanResult.cache_age_ms` का उपयोग करने वाली एक **caller-side** नीति है
- यदि फ़िल्टर्ड/क्वेरी परिणाम खाली है और कैश्ड स्कैन आयु कम से कम `empty_recheck_ms()` है, तो कॉलर एक `force_rescan(...)` करता है और पुनः प्रयास करता है
- यह तब stale-negative परिणामों को कम करने के लिए है जब फ़ाइलें हाल ही में जोड़ी गई हों लेकिन कैश अभी भी TTL के भीतर हो

वर्तमान उपभोक्ता:

- `glob`: जब फ़िल्टर्ड मैच खाली हों और स्कैन आयु सीमा से अधिक हो तो रीचेक करता है
- `fuzzyFind` (`fd.rs`): केवल तब रीचेक करता है जब क्वेरी नॉन-एम्प्टी हो और स्कोर्ड मैच खाली हों
- `grep`: जब चयनित candidate फ़ाइल सूची खाली हो तब रीचेक करता है

## उपभोक्ता डिफ़ॉल्ट और कैश उपयोग

कैश सभी एक्सपोज़्ड APIs पर opt-in है (`cache?: boolean`, डिफ़ॉल्ट `false`)।

नेटिव APIs में वर्तमान डिफ़ॉल्ट:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, और कैश स्कैन हमेशा `use_gitignore=true` का उपयोग करता है

Coding-agent कॉलर आज:

- हाई-वॉल्यूम mention candidate discovery कैश सक्षम करती है:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - प्रोफ़ाइल: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- टूल-स्तरीय `grep` इंटीग्रेशन वर्तमान में स्कैन कैश अक्षम करता है (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Invalidation अनुबंध

नेटिव invalidation एंट्रीपॉइंट:

- `invalidateFsScanCache(path?: string)`
  - `path` के साथ: उन कैश एंट्री हटाएं जिनका रूट लक्ष्य पाथ का उपसर्ग है
  - पाथ के बिना: सभी स्कैन कैश एंट्री साफ़ करें

पाथ हैंडलिंग विवरण:

- सापेक्ष invalidation पाथ cwd के विरुद्ध रिज़ॉल्व होते हैं
- invalidation canonicalization का प्रयास करती है
- यदि लक्ष्य मौजूद नहीं है (जैसे, डिलीट), तो fallback parent को canonicalize करता है और संभव होने पर फ़ाइलनाम पुनः संलग्न करता है
- यह create/delete/rename के लिए invalidation व्यवहार सुरक्षित रखता है जहाँ एक पक्ष मौजूद नहीं हो सकता

## Coding-agent म्यूटेशन फ्लो ज़िम्मेदारियाँ

Coding-agent कोड को सफल फ़ाइलसिस्टम म्यूटेशन के बाद invalidate करना होगा।

केंद्रीय हेल्पर:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (जब पाथ अलग हों तो दोनों पक्षों को invalidate करता है)

वर्तमान म्यूटेशन टूल callsite:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (hashline/patch/replace फ्लो)

नियम: यदि कोई फ्लो फ़ाइलसिस्टम सामग्री या स्थान को म्यूटेट करता है और इन हेल्पर को बायपास करता है, तो कैश staleness बग अपेक्षित हैं।

## नया कैश उपभोक्ता सुरक्षित रूप से जोड़ना

नए scanner/search पाथ में कैश उपयोग पेश करते समय:

1. **स्थिर स्कैन पॉलिसी इनपुट का उपयोग करें**
   - पहले hidden/gitignore सेमेंटिक्स तय करें
   - उन्हें `get_or_scan`/`force_rescan` में लगातार पास करें ताकि कैश पार्टीशन जानबूझकर हों

2. **कैश डेटा को केवल ट्रैवर्सल पॉलिसी द्वारा प्री-फ़िल्टर्ड मानें**
   - पुनर्प्राप्ति के बाद टूल-विशिष्ट फ़िल्टरिंग (glob पैटर्न, टाइप फ़िल्टर, node_modules नियम) लागू करें
   - यह कभी न मानें कि कैश्ड एंट्री पहले से आपके उच्च-स्तरीय फ़िल्टर दर्शाती हैं

3. **खाली-परिणाम फास्ट रीचेक केवल stale-negative जोखिम के लिए लागू करें**
   - `scan.cache_age_ms >= empty_recheck_ms()` का उपयोग करें
   - `force_rescan(..., store=true, ...)` के साथ एक बार पुनः प्रयास करें
   - इस पाथ को सामान्य कैश-हिट लॉजिक से अलग रखें

4. **नो-कैश मोड का स्पष्ट रूप से सम्मान करें**
   - जब कॉलर कैश अक्षम करे, `force_rescan(..., store=false, ...)` कॉल करें
   - नो-कैश रिक्वेस्ट पाथ में साझा कैश पॉप्युलेट न करें

5. **किसी भी नए राइट पाथ के लिए म्यूटेशन invalidation वायर करें**
   - सफल write/edit/delete/rename के बाद, coding-agent invalidation हेल्पर कॉल करें
   - rename/move के लिए, पुराने और नए दोनों पाथ invalidate करें

6. **प्रति-कॉल TTL नॉब न जोड़ें**
   - वर्तमान अनुबंध केवल वैश्विक नीति (env-configured) है, कोई per-request TTL ओवरराइड नहीं

## ज्ञात सीमाएँ

- कैश स्कोप प्रक्रिया-स्थानीय इन-मेमोरी (`DashMap`) है, प्रक्रिया पुनरारंभ के दौरान संरक्षित नहीं।
- कैश स्कैन एंट्री संग्रहीत करता है, अंतिम टूल परिणाम नहीं।
- `glob`/`fuzzyFind`/`grep` स्कैन एंट्री केवल तब साझा करते हैं जब कुंजी आयाम (`root`, `hidden`, `gitignore`) मेल खाते हों।
- `.git` हमेशा कॉलर विकल्पों की परवाह किए बिना स्कैन संग्रह समय पर बाहर रखा जाता है।
