---
title: Natives Text and Search Pipeline
description: >-
  Native text search pipeline with grep, glob, and ripgrep-based file content
  indexing.
sidebar:
  order: 6
  label: خط أنابيب النص والبحث
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# خط أنابيب النص/البحث الأصلي

يوثّق هذا المستند سطح البحث/النص الخاص بـ `@f5xc-salesdemos/pi-natives` (`grep`، `glob`، `text`، `highlight`) من أغلفة TypeScript إلى تصديرات Rust N-API والعودة إلى كائنات نتائج JS.

المصطلحات تتبع `docs/natives-architecture.md`:

- **الغلاف (Wrapper)**: واجهة TS البرمجية في `packages/natives/src/*`
- **طبقة وحدة Rust**: تصديرات N-API في `crates/pi-natives/src/*`
- **ذاكرة المسح المشتركة**: ذاكرة تخزين مؤقت لمدخلات الدليل مدعومة بـ `fs_cache` تُستخدم من قبل تدفقات الاكتشاف/البحث

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

## ربط واجهة JS البرمجية ↔ تصديرات Rust

| واجهة غلاف JS | تصدير Rust (`#[napi]`، snake_case -> camelCase) | وحدة Rust |
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
   - `grep/index.ts` يمرر `options` دون تغيير تقريبًا ويغلف رد الاستدعاء من `(match) => void` إلى شكل رد استدعاء napi الآمن للخيوط `(err, match)`.
   - `searchContent` و `hasMatch` يمرران سلسلة نصية/`Uint8Array` مباشرة.
2. هياكل خيارات Rust في `grep.rs` تُلغي تسلسل حقول camelCase (`ignoreCase`، `maxCount`، `contextBefore`، `contextAfter`، `maxColumns`، `timeoutMs`).
3. `grep` ينشئ `CancelToken` من `timeoutMs` + `AbortSignal` ويعمل داخل `task::blocking("grep", ...)`.

### فروع التنفيذ

- **الفرع في الذاكرة (أداة مساعدة بحتة)**
  - `search` → `search_sync` → `run_search` على بايتات المحتوى المُقدمة.
  - لا مسح لنظام الملفات، ولا `fs_cache`.
- **فرع الملف المفرد (يعتمد على نظام الملفات)**
  - `grep_sync` يحل المسار، يتحقق أن البيانات الوصفية هي ملف، يبث حتى `MAX_FILE_BYTES` لكل ملف (`4 MiB`) عبر مُطابق ripgrep.
- **فرع الدليل (يعتمد على نظام الملفات)**
  - بحث اختياري في الذاكرة المؤقتة عبر `fs_cache::get_or_scan` عندما `cache: true`.
  - مسح جديد عبر `fs_cache::force_rescan` عندما `cache: false`.
  - إعادة فحص اختيارية للنتائج الفارغة عندما يتجاوز عمر الذاكرة المؤقتة `empty_recheck_ms()`.
  - تصفية المدخلات: ملفات فقط + مرشح glob اختياري (`glob_util`) + ربط مرشح نوع اختياري (`js`، `ts`، `rust`، إلخ).

### دلالات البحث/التجميع

- محرك التعبيرات النمطية: `grep_regex::RegexMatcherBuilder` مع `ignoreCase` و `multiline`.
- حل السياق:
  - `contextBefore/contextAfter` يتجاوزان `context` القديم.
  - الأوضاع غير المتعلقة بالمحتوى تُصفّر جمع السياق.
- أوضاع الإخراج:
  - `content` => `GrepMatch` واحد لكل تطابق.
  - `count` و `filesWithMatches` كلاهما يُربط إلى مدخلات نمط العدّ (`lineNumber=0`، `line=""`، `matchCount` مُعيَّن).
- الحدود:
  - `offset` و `maxCount` العالميان يُطبقان عبر الملفات.
  - المسار المتوازي يُستخدم فقط عندما يكون `maxCount` غير مُعيَّن و `offset == 0`؛ وإلا فالمسار التسلسلي يحافظ على دلالات الإزاحة/الحد العالمية الحتمية.

### تشكيل النتائج للعودة إلى JS

- حقول Rust `SearchResult`/`GrepResult` تُربط إلى أنواع TS عبر تحويل حقول كائنات N-API.
- العدادات تُقيَّد إلى `u32` قبل عبور N-API.
- القيم المنطقية الاختيارية تُحذف ما لم تكن صحيحة في بعض المسارات (`limitReached`).
- رد الاستدعاء المتدفق يستقبل كل `GrepMatch` مُشكَّل (مدخل محتوى أو عدّ).

### سلوك الفشل

- `searchContent` يُعيد `SearchResult.error` لأخطاء التعبيرات النمطية/البحث بدلاً من رمي استثناء.
- `grep` يرفض عند الأخطاء الصعبة (مسار غير صالح، glob/regex غير صالح، مهلة إلغاء/إجهاض).
- `hasMatch` يُعيد `Result<bool>` ويرمي استثناءً عند أخطاء النمط غير الصالح/فك ترميز UTF-8.
- أخطاء فتح/بحث الملفات في عمليات المسح متعددة الملفات يُتخطى كل ملف منها؛ ويستمر المسح.

### معالجة التعبيرات النمطية المشوهة

`grep.rs` ينظف الأقواس المعقوفة قبل تجميع التعبير النمطي:

- الأقواس المعقوفة الشبيهة بالتكرار غير الصالحة يتم تهريبها (`{`/`}` -> `\{`/`\}`) عندما لا تستطيع تشكيل `{N}`، `{N,}`، `{N,M}`.
- هذا يمنع أجزاء القوالب الحرفية الشائعة (مثل `${platform}`) من الفشل كتكرار مشوه.
- صيغ التعبيرات النمطية غير الصالحة المتبقية لا تزال تُعيد خطأ تعبير نمطي.

## 2) اكتشاف الملفات (`glob`) والبحث الضبابي في المسارات (`fuzzyFind`)

`glob` و `fuzzyFind` يتشاركان عمليات مسح `fs_cache`؛ منطق المطابقة يختلف.

### تدفق `glob`

1. غلاف TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - القيم الافتراضية: `pattern="*"`، `hidden=false`، `gitignore=true`، `recursive=true`.
2. Rust `glob` يبني `GlobConfig` ويُجمّع النمط عبر `glob_util::compile_glob`.
3. مصدر المدخلات:
   - `cache=true` => `get_or_scan` + إعادة مسح اختيارية للنتائج الفارغة القديمة (`force_rescan`).
   - `cache=false` => `force_rescan(..., store=false)` (جديد فقط).
4. التصفية:
   - تخطي `.git` دائمًا.
   - تخطي `node_modules` ما لم يُطلب (`includeNodeModules` أو نمط يذكر node_modules).
   - تطبيق مطابقة glob.
   - تطبيق مرشح نوع الملف؛ مرشحات `file/dir` للروابط الرمزية تحل البيانات الوصفية للهدف.
5. فرز اختياري حسب mtime تنازليًا (`sortByMtime`) قبل الاقتطاع إلى `maxResults`.

### تدفق `fuzzyFind` (مُنفذ في `fd.rs`)

1. غلاف TS يُصدَّر من وحدة `grep`، لكن تنفيذ Rust يوجد في `fd.rs`.
2. مصدر مسح مشترك من `fs_cache` مع نفس تقسيم ذاكرة/بدون ذاكرة مؤقتة وسياسة إعادة فحص النتائج الفارغة القديمة.
3. التسجيل:
   - تطابق تام / يبدأ بـ / يحتوي على / نتيجة ضبابية مبنية على التتابع الفرعي
   - مسار تسجيل منظف بالفواصل/علامات الترقيم
   - مكافأة الدليل وفصل حتمي للتعادل (`score desc`، ثم `path asc`)
4. مدخلات الروابط الرمزية تُستثنى من النتائج الضبابية.

### سلوك الفشل

- نمط glob غير صالح => خطأ من `glob_util::compile_glob`.
- جذر البحث يجب أن يكون دليلًا موجودًا (`resolve_search_path`)، وإلا خطأ.
- الإلغاء/المهلات تنتشر كأخطاء إجهاض عبر فحوصات `CancelToken::heartbeat()` في الحلقات.

### معالجة أنماط glob المشوهة

`glob_util::build_glob_pattern` متسامح:

- يُطبّع `\` إلى `/`.
- يُضيف تلقائيًا بادئة `**/` للأنماط التكرارية البسيطة عندما `recursive=true`.
- يُغلق تلقائيًا مجموعات التناوب `{...` غير المتوازنة قبل التجميع.

## 3) دورة حياة المسح/الذاكرة المؤقتة المشتركة (`fs_cache`)

`fs_cache` يخزن نتائج المسح كمدخلات نسبية منظفة (`path`، `fileType`، `mtime` اختياري) مفهرسة بـ:

- جذر البحث القانوني
- `include_hidden`
- `use_gitignore`

### انتقالات حالة الذاكرة المؤقتة

1. **فقدان / معطلة**
   - TTL هو `0` أو المفتاح غائب/منتهي الصلاحية -> `collect_entries` جديد.
2. **إصابة**
   - عمر المدخلة `< cache_ttl_ms()` -> إرجاع المدخلات المخبأة + `cache_age_ms`.
3. **إعادة فحص النتائج الفارغة القديمة** (سياسة المُستدعي في `glob`/`grep`/`fd`)
   - إذا أعطى الاستعلام صفر تطابقات و `cache_age_ms >= empty_recheck_ms()`، فرض إعادة مسح واحدة.
4. **الإبطال**
   - `invalidateFsScanCache(path?)`:
     - بدون وسيط: مسح جميع المفاتيح
     - وسيط مسار: إزالة المفاتيح التي يكون جذرها بادئة لمسار الهدف

### مقايضة النتائج القديمة

- الذاكرة المؤقتة تفضل عمليات المسح المتكررة منخفضة الكمون على الاتساق الفوري.
- نافذة TTL يمكن أن تُعيد إيجابيات/سلبيات قديمة.
- إعادة فحص النتائج الفارغة تقلل السلبيات القديمة لعمليات المسح المخبأة الأقدم على حساب مسح إضافي واحد.
- الإبطال الصريح هو خطاف الصحة المقصود بعد تعديلات الملفات.

## 4) أدوات نص ANSI المساعدة (`text`)

هذه أدوات مساعدة بحتة في الذاكرة (بدون مسح لنظام الملفات).

### الحدود والمسؤوليات

- **`text.rs` يملك دلالات خلايا الطرفية**:
  - تحليل تسلسلات ANSI
  - العرض والتقطيع الواعي بالحروف المركبة
  - سلوك اللف/الاقتطاع/التنظيف
- **اقتطاع أسطر `grep.rs` (`maxColumns`) منفصل**:
  - اقتطاع بسيط على حدود الأحرف للأسطر المُطابقة مع `...`
  - غير حافظ لحالة ANSI وغير واعٍ بعرض خلايا الطرفية

### السلوكيات الرئيسية

- `wrapTextWithAnsi`: يلف حسب العرض المرئي، ينقل أكواد SGR النشطة عبر الأسطر الملفوفة.
- `truncateToWidth`: اقتطاع بالخلايا المرئية مع سياسة الحذف (`Unicode`، `Ascii`، `Omit`)، حشو يميني اختياري، ومسار سريع يُعيد سلسلة JS الأصلية عندما لا تتغير.
- `sliceWithWidth`: تقطيع أعمدة مع فرض عرض صارم اختياري.
- `extractSegments`: يستخرج شرائح قبل/بعد حول تراكب مع استعادة حالة ANSI لشريحة `after`.
- `sanitizeText`: يزيل تسلسلات ANSI الهاربة + أحرف التحكم، يُسقط البدائل المنفردة، يُطبّع CR/LF بإزالة `\r`.
- `visibleWidth`: يعد خلايا الطرفية المرئية (علامات الجدولة تستخدم `TAB_WIDTH` ثابت من تنفيذ Rust).

### سلوك الفشل

دوال النص تُعيد عمومًا مخرجات محولة حتمية؛ الأخطاء تقتصر على حدود تحويل سلاسل JS (أخطاء تحويل وسيطات N-API).

## 5) تمييز الصيغة (`highlight`)

`highlight.rs` هو تحويل بحت (بدون نظام ملفات، بدون ذاكرة مؤقتة).

### التدفق

1. الغلاف يمرر `code`، `lang` اختياري، ولوحة ألوان ANSI.
2. Rust يحل الصيغة عبر:
   - بحث رمز/اسم
   - بحث امتداد
   - جدول أسماء بديلة احتياطي (`ts/tsx/js -> JavaScript`، إلخ)
   - احتياطي لصيغة نص عادي عند عدم الحل
3. تحليل كل سطر مع `ParseState` من syntect ومكدس النطاقات.
4. ربط النطاقات بـ 11 فئة ألوان دلالية وحقن/إعادة تعيين أكواد ألوان ANSI.

### سلوك الفشل

- فشل تحليل سطر ما لا يُفشل الاستدعاء: ذلك السطر يُلحق بدون تمييز ويستمر المعالجة.
- لغة غير معروفة/غير مدعومة تتراجع إلى صيغة نص عادي.

## التدفقات المساعدة البحتة مقابل المعتمدة على نظام الملفات

| التدفق | الوصول لنظام الملفات | ذاكرة مؤقتة مشتركة | ملاحظات |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | لا | لا | تعبير نمطي على بايتات/سلسلة مُقدمة فقط |
| دوال وحدة `text` | لا | لا | ANSI/عرض/تنظيف فقط |
| دوال وحدة `highlight` | لا | لا | صيغة + تلوين ANSI فقط |
| `glob` | نعم | اختياري | مسح أدلة + تصفية glob |
| `fuzzyFind` | نعم | اختياري | مسح أدلة + تسجيل ضبابي |
| `grep` (مسار ملف/دليل) | نعم | اختياري (وضع الدليل) | ripgrep على الملفات، مرشحات/رد استدعاء اختياري |

## ملخص دورة الحياة من البداية إلى النهاية

1. المُستدعي يستدعي غلاف TS بخيارات مُنمطة.
2. الغلاف يُطبّع القيم الافتراضية (خاصة `glob`) ويمرر إلى تصدير `native.*`.
3. Rust يتحقق/يُطبّع الخيارات ويبني المُطابق/تكوين البحث.
4. لتدفقات نظام الملفات، تُمسح المدخلات (إصابة/فقدان/إعادة مسح في الذاكرة المؤقتة) ثم تُصفى/تُسجل.
5. حلقات العامل تستدعي دوريًا نبضة قلب الإلغاء؛ المهلة/الإجهاض يمكن أن تُنهي التنفيذ.
6. Rust يُشكّل المخرجات إلى كائنات N-API (`lineNumber`، `matchCount`، `limitReached`، إلخ).
7. غلاف TS يُعيد كائنات JS مُنمطة (وردود استدعاء اختيارية لكل تطابق لـ `grep`/`glob`).
