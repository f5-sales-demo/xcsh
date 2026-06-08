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

يُعيّن هذا المستند سطح النص/البحث (`grep`، `glob`، `text`، `highlight`) الخاص بـ `@f5xc-salesdemos/pi-natives` من أغلفة TypeScript إلى تصدير Rust N-API والعودة إلى كائنات نتائج JS.

تتبع المصطلحات `docs/natives-architecture.md`:

- **الغلاف (Wrapper)**: واجهة برمجة تطبيقات TS في `packages/natives/src/*`
- **طبقة وحدة Rust**: تصديرات N-API في `crates/pi-natives/src/*`
- **ذاكرة المسح المؤقتة المشتركة**: ذاكرة مؤقتة لإدخالات الدليل مدعومة بـ `fs_cache` تُستخدم من قبل تدفقات الاكتشاف/البحث

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

## تعيين واجهة JS API ↔ تصدير Rust

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

1. يُمرر غلاف TS الخيارات إلى الوحدة الأصلية:
   - `grep/index.ts` يُمرر `options` دون تغيير تقريباً ويُغلّف الاستدعاء الراجع من `(match) => void` إلى شكل استدعاء napi الآمن للخيوط `(err, match)`.
   - `searchContent` و `hasMatch` يُمرران سلسلة نصية/`Uint8Array` مباشرة.
2. بنى خيارات Rust في `grep.rs` تُلغي تسلسل الحقول بصيغة camelCase (`ignoreCase`، `maxCount`، `contextBefore`، `contextAfter`، `maxColumns`، `timeoutMs`).
3. `grep` يُنشئ `CancelToken` من `timeoutMs` + `AbortSignal` ويعمل داخل `task::blocking("grep", ...)`.

### فروع التنفيذ

- **الفرع داخل الذاكرة (أداة مساعدة بحتة)**
  - `search` → `search_sync` → `run_search` على بايتات المحتوى المُقدّمة.
  - لا مسح لنظام الملفات، لا `fs_cache`.
- **فرع الملف المفرد (يعتمد على نظام الملفات)**
  - `grep_sync` يحل المسار، يتحقق أن البيانات الوصفية هي ملف، يبث حتى `MAX_FILE_BYTES` لكل ملف (`4 MiB`) عبر مُطابق ripgrep.
- **فرع الدليل (يعتمد على نظام الملفات)**
  - بحث اختياري في الذاكرة المؤقتة عبر `fs_cache::get_or_scan` عندما `cache: true`.
  - مسح جديد عبر `fs_cache::force_rescan` عندما `cache: false`.
  - إعادة فحص اختيارية للنتائج الفارغة عندما يتجاوز عمر الذاكرة المؤقتة `empty_recheck_ms()`.
  - تصفية الإدخالات: ملفات فقط + تصفية glob اختيارية (`glob_util`) + تعيين اختياري لفلتر النوع (`js`، `ts`، `rust`، إلخ.).

### دلالات البحث/التجميع

- محرك التعبيرات النمطية: `grep_regex::RegexMatcherBuilder` مع `ignoreCase` و `multiline`.
- حل السياق:
  - `contextBefore/contextAfter` يتجاوزان `context` القديم.
  - الأوضاع غير المتعلقة بالمحتوى تُصفّر تجميع السياق.
- أوضاع الإخراج:
  - `content` => `GrepMatch` واحد لكل تطابق.
  - `count` و `filesWithMatches` كلاهما يُعيّن إلى إدخالات نمط العد (`lineNumber=0`، `line=""`، `matchCount` مُعيّن).
- الحدود:
  - `offset` و `maxCount` العامة تُطبّق عبر الملفات.
  - المسار المتوازي يُستخدم فقط عندما يكون `maxCount` غير مُعيّن و `offset == 0`؛ وإلا فإن المسار التسلسلي يحافظ على دلالات الإزاحة/الحد العامة الحتمية.

### تشكيل النتائج للعودة إلى JS

- حقول Rust `SearchResult`/`GrepResult` تُعيّن إلى أنواع TS عبر تحويل حقول كائن N-API.
- العدادات تُقيّد إلى `u32` قبل عبور N-API.
- القيم المنطقية الاختيارية تُحذف ما لم تكن صحيحة في بعض المسارات (`limitReached`).
- الاستدعاء الراجع المتدفق يستقبل كل `GrepMatch` مُشكّل (إدخال محتوى أو عد).

### سلوك الفشل

- `searchContent` يُعيد `SearchResult.error` لأخطاء التعبيرات النمطية/البحث بدلاً من رمي استثناء.
- `grep` يرفض عند الأخطاء الجسيمة (مسار غير صالح، glob/regex غير صالح، انتهاء مهلة الإلغاء/الإجهاض).
- `hasMatch` يُعيد `Result<bool>` ويرمي استثناء عند أخطاء النمط غير الصالح/فك ترميز UTF-8.
- أخطاء فتح/بحث الملفات في عمليات المسح متعددة الملفات تُتخطى لكل ملف؛ يستمر المسح.

### معالجة التعبيرات النمطية المشوهة

`grep.rs` يُعقّم الأقواس المعقوفة قبل تجميع التعبير النمطي:

- الأقواس المعقوفة الشبيهة بالتكرار غير الصالحة يتم تهريبها (`{`/`}` -> `\{`/`\}`) عندما لا تستطيع تكوين `{N}`، `{N,}`، `{N,M}`.
- هذا يمنع أجزاء القوالب الحرفية الشائعة (مثل `${platform}`) من الفشل كتكرار مشوه.
- صيغة التعبير النمطي غير الصالحة المتبقية لا تزال تُعيد خطأ تعبير نمطي.

## 2) اكتشاف الملفات (`glob`) والبحث الضبابي عن المسارات (`fuzzyFind`)

يتشارك `glob` و `fuzzyFind` عمليات مسح `fs_cache`؛ تختلف منطق المطابقة.

### تدفق `glob`

1. غلاف TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - القيم الافتراضية: `pattern="*"`، `hidden=false`، `gitignore=true`، `recursive=true`.
2. Rust `glob` يبني `GlobConfig` ويُجمّع النمط عبر `glob_util::compile_glob`.
3. مصدر الإدخالات:
   - `cache=true` => `get_or_scan` + `force_rescan` اختياري عند انتهاء الصلاحية والفراغ.
   - `cache=false` => `force_rescan(..., store=false)` (جديد فقط).
4. التصفية:
   - تخطي `.git` دائماً.
   - تخطي `node_modules` ما لم يُطلب (`includeNodeModules` أو نمط يذكر node_modules).
   - تطبيق مطابقة glob.
   - تطبيق فلتر نوع الملف؛ فلاتر `file/dir` للروابط الرمزية تحل البيانات الوصفية للهدف.
5. فرز اختياري حسب mtime تنازلياً (`sortByMtime`) قبل الاقتطاع إلى `maxResults`.

### تدفق `fuzzyFind` (مُنفّذ في `fd.rs`)

1. غلاف TS يُصدّر من وحدة `grep`، لكن تنفيذ Rust موجود في `fd.rs`.
2. مصدر مسح مشترك من `fs_cache` بنفس تقسيم الذاكرة المؤقتة/بدونها وسياسة إعادة فحص الفراغ القديم.
3. التسجيل:
   - تطابق تام / يبدأ بـ / يحتوي / نقاط ضبابية قائمة على التتابع الفرعي
   - مسار تسجيل مُطبّع بالفواصل/علامات الترقيم
   - مكافأة الدليل وفك التعادل الحتمي (`score desc`، ثم `path asc`)
4. إدخالات الروابط الرمزية تُستبعد من النتائج الضبابية.

### سلوك الفشل

- نمط glob غير صالح => خطأ من `glob_util::compile_glob`.
- جذر البحث يجب أن يكون دليلاً موجوداً (`resolve_search_path`)، وإلا خطأ.
- الإلغاء/انتهاء المهلة ينتشر كأخطاء إجهاض عبر فحوصات `CancelToken::heartbeat()` في الحلقات.

### معالجة أنماط glob المشوهة

`glob_util::build_glob_pattern` متسامح:

- يُطبّع `\` إلى `/`.
- يُضيف تلقائياً `**/` كبادئة للأنماط التعاودية البسيطة عندما `recursive=true`.
- يُغلق تلقائياً مجموعات التناوب غير المتوازنة `{...` قبل التجميع.

## 3) دورة حياة المسح/الذاكرة المؤقتة المشتركة (`fs_cache`)

يُخزّن `fs_cache` نتائج المسح كإدخالات نسبية مُطبّعة (`path`، `fileType`، `mtime` اختياري) مفهرسة بـ:

- جذر البحث القانوني
- `include_hidden`
- `use_gitignore`

### انتقالات حالة الذاكرة المؤقتة

1. **عدم تطابق / معطّل**
   - TTL هو `0` أو المفتاح غائب/منتهي الصلاحية -> `collect_entries` جديد.
2. **تطابق**
   - عمر الإدخال `< cache_ttl_ms()` -> إعادة الإدخالات المخزنة + `cache_age_ms`.
3. **إعادة فحص الفراغ القديم** (سياسة المُستدعي في `glob`/`grep`/`fd`)
   - إذا أسفر الاستعلام عن صفر تطابقات وكان `cache_age_ms >= empty_recheck_ms()`، يُجبر إعادة مسح واحدة.
4. **الإبطال**
   - `invalidateFsScanCache(path?)`:
     - بدون وسيط: مسح جميع المفاتيح
     - وسيط مسار: إزالة المفاتيح التي يكون جذرها بادئة لذلك المسار الهدف

### مفاضلة النتائج القديمة

- الذاكرة المؤقتة تُفضّل عمليات المسح المتكررة منخفضة الكمون على الاتساق الفوري.
- نافذة TTL يمكن أن تُعيد إيجابيات/سلبيات قديمة.
- إعادة فحص النتائج الفارغة تُقلّل السلبيات القديمة لعمليات المسح المخزنة الأقدم على حساب مسح إضافي واحد.
- الإبطال الصريح هو خطاف الصحة المقصود بعد تعديلات الملفات.

## 4) أدوات نص ANSI المساعدة (`text`)

هذه أدوات مساعدة بحتة داخل الذاكرة (لا مسح لنظام الملفات).

### الحدود والمسؤوليات

- **`text.rs` يمتلك دلالات خلايا الطرفية**:
  - تحليل تسلسلات ANSI
  - العرض والتقطيع الواعي بالحروف المركبة
  - سلوك الالتفاف/الاقتطاع/التعقيم
- **اقتطاع أسطر `grep.rs` (`maxColumns`) منفصل**:
  - اقتطاع بسيط عند حدود الأحرف للأسطر المتطابقة مع `...`
  - ليس محافظاً على حالة ANSI وليس واعياً بعرض خلايا الطرفية

### السلوكيات الرئيسية

- `wrapTextWithAnsi`: يلتف حسب العرض المرئي، يحمل أكواد SGR النشطة عبر الأسطر الملتفة.
- `truncateToWidth`: اقتطاع بالخلايا المرئية مع سياسة القطع (`Unicode`، `Ascii`، `Omit`)، حشو يميني اختياري، ومسار سريع يُعيد سلسلة JS الأصلية عندما لا تتغير.
- `sliceWithWidth`: تقطيع أعمدة مع فرض عرض صارم اختياري.
- `extractSegments`: يستخرج أجزاء قبل/بعد حول طبقة تراكب مع استعادة حالة ANSI لجزء `after`.
- `sanitizeText`: يزيل تسلسلات ANSI + أحرف التحكم، يُسقط البدائل المنفردة، يُطبّع CR/LF بإزالة `\r`.
- `visibleWidth`: يعد خلايا الطرفية المرئية (التبويبات تستخدم `TAB_WIDTH` ثابت من تنفيذ Rust).

### سلوك الفشل

دوال النص عموماً تُعيد مخرجات محوّلة حتمية؛ الأخطاء محدودة بحدود تحويل سلاسل JS (إخفاقات تحويل وسائط N-API).

## 5) تمييز الصيغة (`highlight`)

`highlight.rs` هو تحويل بحت (لا نظام ملفات، لا ذاكرة مؤقتة).

### التدفق

1. الغلاف يُمرر `code`، `lang` اختياري، ولوحة ألوان ANSI.
2. Rust يحل الصيغة عبر:
   - بحث بالرمز/الاسم
   - بحث بالامتداد
   - جدول أسماء بديلة احتياطي (`ts/tsx/js -> JavaScript`، إلخ.)
   - العودة إلى صيغة النص العادي عند عدم الحل
3. تحليل كل سطر مع `ParseState` من syntect ومكدس النطاقات.
4. تعيين النطاقات إلى 11 فئة لون دلالية وحقن/إعادة تعيين أكواد ألوان ANSI.

### سلوك الفشل

- فشل تحليل كل سطر لا يُفشل الاستدعاء: يُلحق ذلك السطر بدون تمييز ويستمر المعالجة.
- اللغة غير المعروفة/غير المدعومة تعود إلى صيغة النص العادي.

## التدفقات المساعدة البحتة مقابل التدفقات المعتمدة على نظام الملفات

| التدفق | الوصول لنظام الملفات | الذاكرة المؤقتة المشتركة | ملاحظات |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | لا | لا | تعبيرات نمطية على بايتات/سلسلة نصية مُقدّمة فقط |
| دوال وحدة `text` | لا | لا | ANSI/عرض/تعقيم فقط |
| دوال وحدة `highlight` | لا | لا | صيغة + تلوين ANSI فقط |
| `glob` | نعم | اختياري | مسح الأدلة + تصفية glob |
| `fuzzyFind` | نعم | اختياري | مسح الأدلة + تسجيل ضبابي |
| `grep` (مسار ملف/دليل) | نعم | اختياري (وضع الدليل) | ripgrep عبر الملفات، فلاتر/استدعاء راجع اختياري |

## ملخص دورة الحياة من البداية إلى النهاية

1. يستدعي المُستدعي غلاف TS بخيارات مُنمّطة.
2. يُطبّع الغلاف القيم الافتراضية (خاصة `glob`) ويُمرر إلى تصدير `native.*`.
3. يتحقق Rust من الخيارات/يُطبّعها ويبني المُطابق/تكوين البحث.
4. لتدفقات نظام الملفات، تُمسح الإدخالات (تطابق/عدم تطابق/إعادة مسح في الذاكرة المؤقتة) ثم تُصفّى/تُسجّل.
5. حلقات العامل تستدعي دورياً نبض القلب للإلغاء؛ يمكن لانتهاء المهلة/الإجهاض إنهاء التنفيذ.
6. يُشكّل Rust المخرجات إلى كائنات N-API (`lineNumber`، `matchCount`، `limitReached`، إلخ.).
7. يُعيد غلاف TS كائنات JS مُنمّطة (واستدعاءات راجعة اختيارية لكل تطابق لـ `grep`/`glob`).
