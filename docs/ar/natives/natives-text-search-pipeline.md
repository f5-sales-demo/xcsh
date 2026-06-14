---
title: خط أنابيب النصوص والبحث الأصلي
description: >-
  خط أنابيب البحث النصي الأصلي مع فهرسة محتوى الملفات باستخدام grep وglob
  وripgrep.
sidebar:
  order: 6
  label: خط أنابيب النصوص والبحث
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# خط أنابيب النصوص/البحث الأصلي

يُعيّن هذا المستند السطح النصي/البحثي لـ `@f5xc-salesdemos/pi-natives` (`grep`, `glob`, `text`, `highlight`) من مُغلّفات TypeScript إلى صادرات Rust N-API وصولاً إلى كائنات النتائج في JS.

تتبع المصطلحات ملف `docs/natives-architecture.md`:

- **المُغلّف (Wrapper)**: واجهة برمجية بـ TS في `packages/natives/src/*`
- **طبقة وحدة Rust**: صادرات N-API في `crates/pi-natives/src/*`
- **ذاكرة تخزين المسح المشتركة**: ذاكرة تخزين مُدخلات الدليل المدعومة بـ `fs_cache` المستخدمة في تدفقات الاكتشاف/البحث

## ملفات التنفيذ

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

## تعيين واجهة برمجة JS ↔ صادرات Rust

| واجهة برمجة JS المُغلّفة | صادرات Rust (`#[napi]`، snake_case -> camelCase) | وحدة Rust |
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

## نظرة عامة على خط الأنابيب حسب النظام الفرعي

## 1) البحث بالتعبيرات النمطية (`grep`، `searchContent`، `hasMatch`)

### تدفق المدخلات/الخيارات

1. يُمرّر مُغلّف TS الخيارات إلى الطبقة الأصلية:
   - يُمرّر `grep/index.ts` الخيارات `options` دون تغيير في معظمها ويُغلّف رد الاتصال من `(match) => void` إلى شكل رد اتصال napi threadsafe وهو `(err, match)`.
   - يُمرّر `searchContent` و`hasMatch` السلسلة النصية/`Uint8Array` مباشرةً.
2. تُحلَّل بنى خيارات Rust في `grep.rs` لحقول camelCase (`ignoreCase`، `maxCount`، `contextBefore`، `contextAfter`، `maxColumns`، `timeoutMs`).
3. ينشئ `grep` رمز `CancelToken` من `timeoutMs` + `AbortSignal` ويُشغّله داخل `task::blocking("grep", ...)`.

### فروع التنفيذ

- **فرع في الذاكرة (أداة مساعدة خالصة)**
  - `search` ← `search_sync` ← `run_search` على بايتات المحتوى المُقدَّمة.
  - لا يوجد مسح لنظام الملفات، ولا `fs_cache`.
- **فرع ملف منفرد (يعتمد على نظام الملفات)**
  - يحلّ `grep_sync` المسار، ويتحقق من أن البيانات الوصفية تشير إلى ملف، ويبثّ حتى `MAX_FILE_BYTES` لكل ملف (`4 MiB`) عبر مطابق ripgrep.
- **فرع الدليل (يعتمد على نظام الملفات)**
  - بحث اختياري في ذاكرة التخزين المؤقت عبر `fs_cache::get_or_scan` عند تفعيل `cache: true`.
  - مسح جديد عبر `fs_cache::force_rescan` عند تفعيل `cache: false`.
  - إعادة فحص اختيارية للنتائج الفارغة عند تجاوز عمر ذاكرة التخزين المؤقت لـ `empty_recheck_ms()`.
  - تصفية المُدخلات: ملفات فقط + تصفية glob اختيارية (`glob_util`) + تصفية نوع اختيارية (`js`، `ts`، `rust`، إلخ).

### دلالات البحث/التجميع

- محرك التعبيرات النمطية: `grep_regex::RegexMatcherBuilder` مع `ignoreCase` و`multiline`.
- تحليل السياق:
  - تُلغي `contextBefore/contextAfter` الإعداد القديم `context`.
  - تُصفّر أوضاع غير المحتوى تجميع السياق.
- أوضاع الإخراج:
  - `content` ← إنتاج `GrepMatch` واحد لكل تطابق.
  - يتعيّن `count` و`filesWithMatches` على مُدخلات بنمط العدد (`lineNumber=0`، `line=""`، `matchCount` محدد).
- الحدود:
  - تُطبَّق `offset` و`maxCount` العامة عبر الملفات.
  - يُستخدم المسار المتوازي فقط عند عدم تعيين `maxCount` وكان `offset == 0`؛ وإلا يُستخدم المسار التسلسلي للحفاظ على دلالات الإزاحة/الحد العالمية الحتمية.

### تشكيل النتائج وإعادتها إلى JS

- تُعيَّن حقول `SearchResult`/`GrepResult` في Rust إلى أنواع TS عبر تحويل حقول كائن N-API.
- تُقيَّد العدادات إلى `u32` قبل عبور N-API.
- تُحذف القيم المنطقية الاختيارية ما لم تكن صحيحة في بعض المسارات (`limitReached`).
- يستقبل رد الاتصال الجاري كل `GrepMatch` مُشكَّل (محتوى أو مُدخل عدّ).

### سلوك الأعطال

- يُعيد `searchContent` القيمة `SearchResult.error` في حالة أعطال التعبيرات النمطية/البحث بدلاً من إلقاء استثناء.
- يرفض `grep` في الأخطاء الجسيمة (مسار غير صالح، glob/regex غير صالح، انتهاء مهلة الإلغاء/الإجهاض).
- يُعيد `hasMatch` القيمة `Result<bool>` ويُلقي استثناءً في حالة أخطاء النمط غير الصالح/فك ترميز UTF-8.
- تُتجاهل أخطاء فتح/بحث الملفات في عمليات المسح متعددة الملفات لكل ملف على حدة؛ ويستمر المسح.

### معالجة التعبيرات النمطية المشوّهة

يُعقّم `grep.rs` الأقواس المعقوصة قبل تصريف التعبير النمطي:

- تُخرج الأقواس المعقوصة التي تشبه التكرار غير الصالح (`{`/`}` ← `\{`/`\}`) عند عدم تمكنها من تشكيل `{N}` أو `{N,}` أو `{N,M}`.
- يمنع ذلك مقاطع قوالب الحرفية الشائعة (مثل `${platform}`) من الفشل كتكرار مشوّه.
- تُعيد بناء صياغة التعبير النمطي غير الصالح المتبقية خطأ في التعبير النمطي.

## 2) اكتشاف الملفات (`glob`) والبحث الضبابي عن المسارات (`fuzzyFind`)

يتشارك `glob` و`fuzzyFind` عمليات مسح `fs_cache`؛ بينما تختلف منطق المطابقة.

### تدفق `glob`

1. مُغلّف TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - القيم الافتراضية: `pattern="*"`، `hidden=false`، `gitignore=true`، `recursive=true`.
2. يبني `glob` في Rust `GlobConfig` ويصرّف النمط عبر `glob_util::compile_glob`.
3. مصدر المُدخلات:
   - `cache=true` ← `get_or_scan` + إعادة مسح اختيارية عند فراغ البيانات القديمة.
   - `cache=false` ← `force_rescan(..., store=false)` (جديد فقط).
4. التصفية:
   - تخطي `.git` دائماً.
   - تخطي `node_modules` ما لم يُطلب (`includeNodeModules` أو نمط يذكر node_modules).
   - تطبيق مطابقة glob.
   - تطبيق تصفية نوع الملف؛ تحلّ فلاتر `file/dir` للرابط الرمزي بيانات الهدف الوصفية.
5. ترتيب اختياري حسب mtime تنازلياً (`sortByMtime`) قبل الاقتطاع إلى `maxResults`.

### تدفق `fuzzyFind` (مُنفَّذ في `fd.rs`)

1. مُغلّف TS مُصدَّر من وحدة `grep`، لكن التنفيذ في Rust يقع في `fd.rs`.
2. مصدر المسح المشترك من `fs_cache` مع نفس تقسيم التخزين المؤقت/عدمه وسياسة إعادة الفحص عند الفراغ القديم.
3. التسجيل النقطي:
   - تسجيل نقطي ضبابي قائم على المطابقة التامة / البداية بـ / الاحتواء / التسلسل الفرعي
   - مسار تسجيل نقطي مُعيَّر بالفاصل/علامات الترقيم
   - مكافأة الدليل وكسر التعادل الحتمي (`score desc`، ثم `path asc`)
4. تُستبعد مُدخلات الروابط الرمزية من نتائج الضبابية.

### سلوك الأعطال

- نمط glob غير صالح ← خطأ من `glob_util::compile_glob`.
- يجب أن يكون جذر البحث دليلاً موجوداً (`resolve_search_path`)، وإلا فخطأ.
- تنتشر الإلغاءات/انتهاءات المهلة كأخطاء إجهاض عبر فحوصات `CancelToken::heartbeat()` في الحلقات.

### معالجة أنماط glob المشوّهة

`glob_util::build_glob_pattern` متسامح:

- يُعيَّر `\` إلى `/`.
- يُضاف تلقائياً `**/` كبادئة للأنماط التكرارية البسيطة عند تفعيل `recursive=true`.
- تُغلق تلقائياً مجموعات تناوب `{...` غير المتوازنة قبل التصريف.

## 3) دورة حياة المسح/ذاكرة التخزين المؤقت المشتركة (`fs_cache`)

يخزّن `fs_cache` نتائج المسح كمُدخلات نسبية مُعيَّرة (`path`، `fileType`، `mtime` اختيارية) مفهرَسة بـ:

- جذر البحث المعياري
- `include_hidden`
- `use_gitignore`

### انتقالات حالة ذاكرة التخزين المؤقت

1. **فقدان / معطّل**
   - TTL هو `0` أو المفتاح غائب/منتهي الصلاحية ← `collect_entries` جديدة.
2. **إصابة**
   - عمر المُدخل `< cache_ttl_ms()` ← إعادة المُدخلات المخزّنة مؤقتاً + `cache_age_ms`.
3. **إعادة الفحص عند الفراغ القديم** (سياسة المستدعي في `glob`/`grep`/`fd`)
   - إذا أسفر الاستعلام عن صفر تطابقات وكان `cache_age_ms >= empty_recheck_ms()`، فأجرِ إعادة مسح واحدة.
4. **الإبطال**
   - `invalidateFsScanCache(path?)`:
     - بدون وسيطة: امسح جميع المفاتيح
     - مع وسيطة مسار: أزل المفاتيح التي يسبق جذرها مسار الهدف ذاك

### مقايضة النتائج القديمة

- تُفضّل ذاكرة التخزين المؤقت عمليات المسح المتكررة ذات الكمون المنخفض على الاتساق الفوري.
- يمكن أن تُعيد نافذة TTL نتائج إيجابية/سلبية قديمة.
- يُقلّل إعادة فحص النتائج الفارغة من السلبيات الكاذبة القديمة للمسحات المخزّنة الأقدم بتكلفة مسح إضافي واحد.
- الإبطال الصريح هو الخطاف المقصود للصحة بعد طفرات الملفات.

## 4) أدوات النص المساعدة عبر ANSI (`text`)

هذه أدوات مساعدة خالصة في الذاكرة (لا مسح لنظام الملفات).

### الحدود والمسؤوليات

- **تملك `text.rs` دلالات خلايا الطرفية**:
  - تحليل تسلسلات ANSI
  - العرض والتقطيع الواعي بالحروف المرسومة (grapheme)
  - سلوك التفاف/الاقتطاع/التطهير
- **اقتطاع السطر في `grep.rs` (`maxColumns`) منفصل**:
  - اقتطاع بسيط عند حدود الحرف للأسطر المتطابقة مع `...`
  - غير محافظ على حالة ANSI وغير واعٍ بعرض خلايا الطرفية

### السلوكيات الرئيسية

- `wrapTextWithAnsi`: يلتف بالعرض المرئي، ويحمل رموز SGR النشطة عبر الأسطر الملتفة.
- `truncateToWidth`: اقتطاع خلية مرئية مع سياسة علامة حذف (`Unicode`، `Ascii`، `Omit`)، حشو يمين اختياري، ومسار سريع يُعيد سلسلة JS الأصلية عند عدم التغيير.
- `sliceWithWidth`: تقطيع عمودي مع فرض صارم اختياري للعرض.
- `extractSegments`: استخراج مقاطع قبل/بعد حول طبقة تغطية مع استعادة حالة ANSI لمقطع `after`.
- `sanitizeText`: يجرّد تخطيات ANSI + أحرف التحكم، ويُسقط الأحرف البديلة المنفردة، ويُعيَّر CR/LF بحذف `\r`.
- `visibleWidth`: يعدّ خلايا الطرفية المرئية (تستخدم علامات التبويب `TAB_WIDTH` الثابتة من تنفيذ Rust).

### سلوك الأعطال

تُعيد وظائف النص في الغالب مخرجات مُحوَّلة حتمية؛ تقتصر الأخطاء على حدود تحويل سلسلة JS (أعطال تحويل وسيطات N-API).

## 5) إبراز بناء الجملة (`highlight`)

`highlight.rs` هو تحويل خالص (لا نظام ملفات، لا ذاكرة تخزين مؤقت).

### التدفق

1. يُمرّر المُغلّف `code` ولغة `lang` اختيارية ولوحة ألوان ANSI.
2. يحلّ Rust بناء الجملة عبر:
   - بحث رمزي/بالاسم
   - بحث بالامتداد
   - احتياط جدول الأسماء البديلة (`ts/tsx/js -> JavaScript`، إلخ)
   - احتياط إلى بناء جملة النص العادي عند عدم الحل
3. تحليل كل سطر بـ syntect `ParseState` وحزمة النطاق.
4. تعيين النطاقات إلى 11 فئة لون دلالية وحقن/إعادة ضبط رموز ألوان ANSI.

### سلوك الأعطال

- لا يُخفق فشل التحليل لكل سطر في الاستدعاء: يُلحق ذلك السطر دون إبراز ويستمر المعالجة.
- تعود اللغة غير المعروفة/غير المدعومة إلى بناء جملة النص العادي.

## مقارنة الأدوات الخالصة مقابل التدفقات التي تعتمد على نظام الملفات

| التدفق | وصول نظام الملفات | ذاكرة التخزين المشتركة | ملاحظات |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | لا | لا | تعبير نمطي على البايتات/السلسلة المُقدَّمة فقط |
| وظائف وحدة `text` | لا | لا | ANSI/عرض/تطهير فقط |
| وظائف وحدة `highlight` | لا | لا | بناء جملة + تلوين ANSI فقط |
| `glob` | نعم | اختياري | مسح الدليل + تصفية glob |
| `fuzzyFind` | نعم | اختياري | مسح الدليل + التسجيل الضبابي |
| `grep` (مسار ملف/دليل) | نعم | اختياري (وضع الدليل) | ripgrep على الملفات، فلاتر/رد اتصال اختياري |

## ملخص دورة الحياة الشاملة

1. يستدعي المستدعي مُغلّف TS بخيارات مكتوبة.
2. يُعيَّر المُغلّف القيم الافتراضية (لا سيما `glob`) ويُمرّرها إلى صادرة `native.*`.
3. يتحقق Rust من صحة/يعيَّر الخيارات ويبني تكوين المطابق/البحث.
4. بالنسبة لتدفقات نظام الملفات، تُمسح المُدخلات (إصابة/فقدان/إعادة مسح في ذاكرة التخزين) ثم تُصفَّى/تُسجَّل نقطياً.
5. تستدعي حلقات العامل دورياً نبضات قلب الإلغاء؛ يمكن أن تُنهي انتهاءات المهلة/الإجهاض التنفيذ.
6. يُشكّل Rust المخرجات في كائنات N-API (`lineNumber`، `matchCount`، `limitReached`، إلخ).
7. يُعيد مُغلّف TS كائنات JS مكتوبة (وردود اتصال اختيارية لكل تطابق لـ `grep`/`glob`).
