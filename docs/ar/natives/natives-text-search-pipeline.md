---
title: خط أنابيب النصوص والبحث الأصلي
description: >-
  خط أنابيب البحث النصي الأصلي باستخدام grep و glob وفهرسة محتوى الملفات المبنية
  على ripgrep.
sidebar:
  order: 6
  label: خط أنابيب النصوص والبحث
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# خط أنابيب النصوص/البحث الأصلي

يُعيّن هذا المستند سطح البحث/النص (`grep`، `glob`، `text`، `highlight`) الخاص بـ `@f5xc-salesdemos/pi-natives` من أغلفة TypeScript إلى صادرات Rust N-API والعودة إلى كائنات نتائج JS.

تتبع المصطلحات ما ورد في `docs/natives-architecture.md`:

- **الغلاف (Wrapper)**: واجهة TS في `packages/natives/src/*`
- **طبقة وحدة Rust**: صادرات N-API في `crates/pi-natives/src/*`
- **ذاكرة المسح المشتركة**: ذاكرة التخزين المؤقت لإدخالات الدليل المدعومة بـ `fs_cache` والمستخدمة في تدفقات الاكتشاف/البحث

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

## ربط واجهة JS ↔ صادرات Rust

| واجهة غلاف JS | صادرات Rust (`#[napi]`، snake_case -> camelCase) | وحدة Rust |
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

1. يمرر غلاف TS الخيارات إلى الوحدة الأصلية:
   - `grep/index.ts` يمرر `options` دون تغيير في الغالب ويغلّف رد النداء من `(match) => void` إلى شكل رد نداء napi الآمن للخيوط `(err, match)`.
   - `searchContent` و `hasMatch` يمرران السلسلة النصية/`Uint8Array` مباشرة.
2. هياكل خيارات Rust في `grep.rs` تفكّ تسلسل الحقول بنمط camelCase (`ignoreCase`، `maxCount`، `contextBefore`، `contextAfter`، `maxColumns`، `timeoutMs`).
3. `grep` ينشئ `CancelToken` من `timeoutMs` + `AbortSignal` ويعمل داخل `task::blocking("grep", ...)`.

### فروع التنفيذ

- **الفرع داخل الذاكرة (أداة مساعدة صرفة)**
  - `search` → `search_sync` → `run_search` على بايتات المحتوى المقدمة.
  - لا مسح لنظام الملفات، لا `fs_cache`.
- **فرع الملف الواحد (يعتمد على نظام الملفات)**
  - `grep_sync` يحلل المسار، يتحقق من أن البيانات الوصفية تشير إلى ملف، ويمرر ما يصل إلى `MAX_FILE_BYTES` لكل ملف (`4 MiB`) عبر مطابق ripgrep.
- **فرع الدليل (يعتمد على نظام الملفات)**
  - بحث اختياري في ذاكرة التخزين المؤقت عبر `fs_cache::get_or_scan` عندما يكون `cache: true`.
  - مسح جديد عبر `fs_cache::force_rescan` عندما يكون `cache: false`.
  - إعادة فحص اختيارية للنتائج الفارغة عندما يتجاوز عمر ذاكرة التخزين المؤقت `empty_recheck_ms()`.
  - تصفية الإدخالات: ملفات فقط + تصفية glob اختيارية (`glob_util`) + تصفية نوع اختيارية بالربط (`js`، `ts`، `rust`، إلخ.).

### دلالات البحث/التجميع

- محرك التعبيرات النمطية: `grep_regex::RegexMatcherBuilder` مع `ignoreCase` و `multiline`.
- حل السياق:
  - `contextBefore/contextAfter` يتجاوزان `context` القديم.
  - أوضاع غير المحتوى تصفّر جمع السياق.
- أوضاع الإخراج:
  - `content` => `GrepMatch` واحد لكل نتيجة.
  - `count` و `filesWithMatches` كلاهما يُربط إلى إدخالات نمط العد (`lineNumber=0`، `line=""`، `matchCount` مُعيّن).
- الحدود:
  - `offset` العام و `maxCount` يُطبّقان عبر الملفات.
  - يُستخدم المسار المتوازي فقط عندما يكون `maxCount` غير مُعيّن و `offset == 0`؛ وإلا فإن المسار التسلسلي يحافظ على دلالات الإزاحة/الحد العامة الحتمية.

### تشكيل النتائج للعودة إلى JS

- حقول Rust `SearchResult`/`GrepResult` تُربط إلى أنواع TS عبر تحويل حقول كائنات N-API.
- العدادات تُقيّد إلى `u32` قبل عبور N-API.
- القيم المنطقية الاختيارية تُحذف ما لم تكن صحيحة في بعض المسارات (`limitReached`).
- رد النداء المتدفق يستقبل كل `GrepMatch` مُشكّل (إدخال محتوى أو عد).

### سلوك الفشل

- `searchContent` يُرجع `SearchResult.error` لفشل التعبيرات النمطية/البحث بدلاً من الرمي.
- `grep` يرفض عند الأخطاء الجسيمة (مسار غير صالح، glob/regex غير صالح، انتهاء مهلة الإلغاء/الإيقاف).
- `hasMatch` يُرجع `Result<bool>` ويرمي عند نمط غير صالح/أخطاء فك ترميز UTF-8.
- أخطاء فتح/بحث الملفات في عمليات المسح متعددة الملفات تُتخطّى لكل ملف؛ ويستمر المسح.

### معالجة التعبيرات النمطية المشوّهة

`grep.rs` يُطهّر الأقواس المعقوفة قبل تجميع التعبير النمطي:

- الأقواس المعقوفة الشبيهة بالتكرار غير الصالحة تُهرّب (`{`/`}` -> `\{`/`\}`) عندما لا تستطيع تشكيل `{N}`، `{N,}`، `{N,M}`.
- هذا يمنع أجزاء القوالب الحرفية الشائعة (مثل `${platform}`) من الفشل كتكرار مشوّه.
- صيغة التعبير النمطي غير الصالحة المتبقية لا تزال تُرجع خطأ تعبير نمطي.

## 2) اكتشاف الملفات (`glob`) والبحث الضبابي في المسارات (`fuzzyFind`)

يتشارك `glob` و `fuzzyFind` عمليات مسح `fs_cache`؛ بينما تختلف منطقية المطابقة.

### تدفق `glob`

1. غلاف TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - الافتراضيات: `pattern="*"`، `hidden=false`، `gitignore=true`، `recursive=true`.
2. Rust `glob` يبني `GlobConfig` ويُجمّع النمط عبر `glob_util::compile_glob`.
3. مصدر الإدخالات:
   - `cache=true` => `get_or_scan` + إعادة مسح `force_rescan` اختيارية للبيانات القديمة الفارغة.
   - `cache=false` => `force_rescan(..., store=false)` (جديد فقط).
4. التصفية:
   - تخطي `.git` دائماً.
   - تخطي `node_modules` ما لم يُطلب (`includeNodeModules` أو نمط يذكر node_modules).
   - تطبيق مطابقة glob.
   - تطبيق تصفية نوع الملف؛ تصفية الروابط الرمزية `file/dir` تحلّ البيانات الوصفية للهدف.
5. ترتيب اختياري حسب mtime تنازلياً (`sortByMtime`) قبل الاقتطاع إلى `maxResults`.

### تدفق `fuzzyFind` (مُنفّذ في `fd.rs`)

1. غلاف TS مُصدّر من وحدة `grep`، لكن تنفيذ Rust يقع في `fd.rs`.
2. مصدر مسح مشترك من `fs_cache` مع نفس تقسيم ذاكرة التخزين المؤقت/بدونها وسياسة إعادة فحص البيانات القديمة الفارغة.
3. التسجيل:
   - مطابقة تامة / يبدأ بـ / يحتوي على / تسجيل ضبابي قائم على التتابع الفرعي
   - مسار تسجيل مُطبّع بالفواصل/علامات الترقيم
   - مكافأة الدليل وكسر التعادل الحتمي (`score desc`، ثم `path asc`)
4. إدخالات الروابط الرمزية تُستبعد من النتائج الضبابية.

### سلوك الفشل

- نمط glob غير صالح => خطأ من `glob_util::compile_glob`.
- جذر البحث يجب أن يكون دليلاً موجوداً (`resolve_search_path`)، وإلا خطأ.
- الإلغاء/انتهاء المهلة ينتشران كأخطاء إيقاف عبر فحوصات `CancelToken::heartbeat()` في الحلقات.

### معالجة أنماط glob المشوّهة

`glob_util::build_glob_pattern` متسامح:

- يُطبّع `\` إلى `/`.
- يضيف تلقائياً `**/` كبادئة للأنماط العودية البسيطة عندما يكون `recursive=true`.
- يُغلق تلقائياً مجموعات التبديل غير المتوازنة `{...` قبل التجميع.

## 3) دورة حياة المسح/ذاكرة التخزين المؤقت المشتركة (`fs_cache`)

يُخزّن `fs_cache` نتائج المسح كإدخالات نسبية مُطبّعة (`path`، `fileType`، `mtime` اختياري) مفهرسة بـ:

- جذر البحث القانوني
- `include_hidden`
- `use_gitignore`

### انتقالات حالة ذاكرة التخزين المؤقت

1. **فقدان / معطّلة**
   - TTL يساوي `0` أو المفتاح غائب/منتهي الصلاحية -> `collect_entries` جديد.
2. **إصابة**
   - عمر الإدخال `< cache_ttl_ms()` -> إرجاع الإدخالات المخزنة مؤقتاً + `cache_age_ms`.
3. **إعادة فحص البيانات القديمة الفارغة** (سياسة المستدعي في `glob`/`grep`/`fd`)
   - إذا أسفر الاستعلام عن صفر مطابقات و `cache_age_ms >= empty_recheck_ms()`، يُفرض إعادة مسح واحدة.
4. **الإبطال**
   - `invalidateFsScanCache(path?)`:
     - بدون وسيط: مسح جميع المفاتيح
     - وسيط مسار: إزالة المفاتيح التي يبدأ جذرها بمسار الهدف

### مقايضة النتائج القديمة

- ذاكرة التخزين المؤقت تفضّل زمن الاستجابة المنخفض للمسوحات المتكررة على الاتساق الفوري.
- نافذة TTL يمكن أن تُرجع إيجابيات/سلبيات قديمة.
- إعادة فحص النتائج الفارغة تقلل السلبيات القديمة للمسوحات المخزنة مؤقتاً الأقدم على حساب مسح إضافي واحد.
- الإبطال الصريح هو خطّاف الصحة المقصود بعد تغييرات الملفات.

## 4) أدوات نص ANSI المساعدة (`text`)

هذه أدوات مساعدة صرفة داخل الذاكرة (لا مسح لنظام الملفات).

### الحدود والمسؤوليات

- **`text.rs` يمتلك دلالات خلايا الطرفية**:
  - تحليل تسلسلات ANSI
  - العرض والتقطيع المدرك للحروف المركبة (grapheme)
  - سلوك التفاف/اقتطاع/تطهير
- **اقتطاع أسطر `grep.rs` (`maxColumns`) منفصل**:
  - اقتطاع بسيط على حدود الأحرف للأسطر المطابقة مع `...`
  - ليس محافظاً على حالة ANSI وليس مدركاً لعرض خلايا الطرفية

### السلوكيات الرئيسية

- `wrapTextWithAnsi`: يلف حسب العرض المرئي، وينقل رموز SGR النشطة عبر الأسطر الملفوفة.
- `truncateToWidth`: اقتطاع خلايا مرئية مع سياسة علامة الحذف (`Unicode`، `Ascii`، `Omit`)، حشو يميني اختياري، ومسار سريع يُرجع سلسلة JS الأصلية عندما تكون بدون تغيير.
- `sliceWithWidth`: تقطيع أعمدة مع إنفاذ عرض صارم اختياري.
- `extractSegments`: يستخرج الأجزاء قبل/بعد حول طبقة تراكب مع استعادة حالة ANSI للجزء `after`.
- `sanitizeText`: يزيل تسلسلات ANSI الهاربة + أحرف التحكم، يُسقط البدائل المنفردة (lone surrogates)، ويُطبّع CR/LF بإزالة `\r`.
- `visibleWidth`: يعدّ خلايا الطرفية المرئية (التبويبات تستخدم `TAB_WIDTH` ثابت من تنفيذ Rust).

### سلوك الفشل

دوال النص عموماً تُرجع مخرجات محوّلة حتمية؛ الأخطاء محدودة بحدود تحويل سلاسل JS (فشل تحويل وسائط N-API).

## 5) تمييز بناء الجملة (`highlight`)

`highlight.rs` هو تحويل صرف (لا نظام ملفات، لا ذاكرة تخزين مؤقت).

### التدفق

1. الغلاف يمرر `code`، `lang` اختياري، ولوحة ألوان ANSI.
2. Rust يحلّ بناء الجملة عبر:
   - بحث بالرمز/الاسم
   - بحث بالامتداد
   - جدول أسماء بديلة احتياطي (`ts/tsx/js -> JavaScript`، إلخ.)
   - الرجوع إلى بناء جملة النص العادي عند عدم الحل
3. تحليل كل سطر باستخدام syntect `ParseState` ومكدس النطاق.
4. ربط النطاقات بـ 11 فئة ألوان دلالية وحقن/إعادة تعيين رموز ألوان ANSI.

### سلوك الفشل

- فشل تحليل سطر ما لا يُفشل الاستدعاء: يُلحق ذلك السطر بدون تمييز ويستمر المعالجة.
- اللغة غير المعروفة/غير المدعومة ترجع إلى بناء جملة النص العادي.

## التدفقات الأداتية الصرفة مقابل التدفقات المعتمدة على نظام الملفات

| التدفق | الوصول لنظام الملفات | ذاكرة التخزين المؤقت المشتركة | ملاحظات |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | لا | لا | تعبير نمطي على البايتات/السلسلة المقدمة فقط |
| دوال وحدة `text` | لا | لا | ANSI/عرض/تطهير فقط |
| دوال وحدة `highlight` | لا | لا | بناء جملة + تلوين ANSI فقط |
| `glob` | نعم | اختياري | مسح أدلة + تصفية glob |
| `fuzzyFind` | نعم | اختياري | مسح أدلة + تسجيل ضبابي |
| `grep` (مسار ملف/دليل) | نعم | اختياري (وضع الدليل) | ripgrep عبر الملفات، تصفيات/رد نداء اختيارية |

## ملخص دورة الحياة من البداية إلى النهاية

1. المستدعي يستدعي غلاف TS بخيارات مُنمّطة.
2. الغلاف يُطبّع الافتراضيات (لا سيما `glob`) ويمررها إلى صادرات `native.*`.
3. Rust يتحقق من/يُطبّع الخيارات ويبني المطابق/تكوين البحث.
4. لتدفقات نظام الملفات، تُمسح الإدخالات (إصابة/فقدان/إعادة مسح ذاكرة التخزين المؤقت) ثم تُصفّى/تُسجّل.
5. حلقات العامل تستدعي دورياً نبض قلب الإلغاء؛ انتهاء المهلة/الإيقاف يمكن أن ينهي التنفيذ.
6. Rust يُشكّل المخرجات إلى كائنات N-API (`lineNumber`، `matchCount`، `limitReached`، إلخ.).
7. غلاف TS يُرجع كائنات JS مُنمّطة (وردود نداء اختيارية لكل مطابقة لـ `grep`/`glob`).
