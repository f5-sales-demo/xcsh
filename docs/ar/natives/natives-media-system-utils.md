---
title: أدوات الوسائط والنظام الأصلية
description: أدوات معالجة الوسائط الأصلية لالتقاط الشاشة ومعالجة الصور ومعلومات النظام.
sidebar:
  order: 7
  label: أدوات الوسائط والنظام
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# أدوات الوسائط والنظام الأصلية

هذا المستند هو تحليل معمّق لنظام فرعي خاص بطبقة **البدائيات الأصلية للنظام/الوسائط/التحويل** الموصوفة في [`docs/natives-architecture.md`](./natives-architecture.md): `image` و`html` و`clipboard` وتحليل أداء `work`.

## ملفات التنفيذ

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> ملاحظة: لا يوجد ملف `crates/pi-natives/src/work.rs`؛ تحليل أداء العمل مُنفَّذ في `prof.rs` ويُغذَّى بالأدوات الموجودة في `task.rs`.

## ربط واجهة TS البرمجية ↔ تصدير/وحدة Rust

| تصدير TS (packages/natives)                 | تصدير N-API في Rust                                                     | وحدة Rust                             |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + منطق احتياطي في TS                                 | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## حدود تنسيقات البيانات والتحويلات

### الصورة (`image`)

- **حد الإدخال في JS**: بايتات صورة مُرمَّزة من نوع `Uint8Array`.
- **حد فك الترميز في Rust**: تُنسَخ البايتات إلى `Vec<u8>`، ويُخمَّن التنسيق باستخدام `ImageReader::with_guessed_format()`، ثم يُفكّ الترميز إلى `DynamicImage`.
- **الحالة في الذاكرة**: يخزّن `PhotonImage` القيمة `Arc<DynamicImage>`.
- **حد الإخراج**: تُعيد `encode(format, quality)` القيمة `Promise<Uint8Array>` (أي `Vec<u8>` في Rust).

معرّفات التنسيقات رقمية:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (مُرمِّز بدون فقدان)
- `3`: GIF

القيود:

- يُستخدَم `quality` فقط مع JPEG.
- تتجاهل PNG/WebP/GIF القيمة `quality`.
- تفشل معرّفات التنسيقات غير المدعومة (`Invalid image format: <id>`).

### تحويل HTML (`html`)

- **حد الإدخال في JS**: سلسلة نصية `string` من HTML + كائن اختياري `{ cleanContent?: boolean; skipImages?: boolean }`.
- **حد التحويل في Rust**: يُحوَّل الإدخال `String` بواسطة `html_to_markdown_rs::convert`.
- **حد الإخراج**: سلسلة نصية `string` بتنسيق Markdown.

سلوك التحويل:

- القيمة الافتراضية لـ `cleanContent` هي `false`.
- عند تعيين `cleanContent=true`، تُفعَّل المعالجة المسبقة مع `PreprocessingPreset::Aggressive` وعلامات الإزالة الصارمة للتنقل والنماذج.
- القيمة الافتراضية لـ `skipImages` هي `false`.

### الحافظة (`clipboard`)

- **مسار النص**:
  - تُصدر TS أولاً OSC 52 (`\x1b]52;c;<base64>\x07`) عندما يكون stdout طرفية TTY.
  - ثم يُحاوَل نسخ نفس النص عبر واجهة الحافظة الأصلية (`native.copyToClipboard`) كمحاولة أفضل جهد.
  - على Termux، تحاول TS استخدام `termux-clipboard-set` أولاً.
- **مسار قراءة الصورة**:
  - يقرأ Rust الصورة الخام من `arboard`.
  - يُعيد Rust ترميزها إلى بايتات PNG (مكتبة `image`)، ويُعيد `{ data: Uint8Array, mimeType: "image/png" }`.
  - تُعيد TS القيمة `null` مبكراً على Termux أو جلسات Linux بدون خادم عرض (عند غياب `DISPLAY`/`WAYLAND_DISPLAY`).

### تحليل أداء العمل (`work`)

- **حد التجميع**: تُنتَج عينات التحليل بواسطة حراسات `profile_region(tag)` في `task::blocking` و`task::future`.
- **تنسيق التخزين**: مخزن مؤقت دائري بحجم ثابت (`MAX_SAMPLES = 10_000`) يخزّن مسار المكدس + المدة (`μs`) + الطابع الزمني (`μs منذ بدء العملية`).
- **حد الإخراج**: تُعيد `getWorkProfile(lastSeconds)` كائناً يحتوي على:
  - `folded`: نص مكدس مطوي (مدخل رسم اللهب البياني)
  - `summary`: جدول ملخص بتنسيق markdown
  - `svg`: رسم SVG اختياري لرسم اللهب البياني
  - `totalMs`، `sampleCount`

## دورة الحياة وانتقالات الحالة

### دورة حياة الصورة

1. تُجدوِل `PhotonImage.parse(bytes)` مهمة فك ترميز حاجبة (`image.decode`).
2. عند النجاح، يوجد مقبض `PhotonImage` أصلي في JS.
3. تُنشئ `resize(...)` مقبضاً أصلياً جديداً (`image.resize`)، ويمكن أن يتواجد المقبض القديم والجديد معاً.
4. تُجسِّد `encode(...)` البايتات (`image.encode`) دون تغيير أبعاد الصورة.

انتقالات الفشل:

- فشل اكتشاف التنسيق/فك الترميز يرفض وعد التحليل.
- فشل الترميز يرفض وعد الترميز.
- معرّف التنسيق غير الصالح يرفض وعد الترميز.

### دورة حياة HTML

1. تُجدوِل `htmlToMarkdown(html, options)` مهمة تحويل حاجبة.
2. يعمل التحويل مع الخيارات الافتراضية (`cleanContent=false`، `skipImages=false`) ما لم تُحدَّد.
3. تُعيد سلسلة markdown نصية أو ترفض.

انتقالات الفشل:

- فشل المحوِّل يُعيد وعداً مرفوضاً (`Conversion error: ...`).

### دورة حياة الحافظة

`copyToClipboard(text)` مُصمَّم عمداً كأفضل جهد ومتعدد المسارات:

1. إذا كان TTY: محاولة كتابة OSC 52 (حمولة base64).
2. محاولة أمر Termux عند تعيين `TERMUX_VERSION`.
3. محاولة نسخ النص الأصلي عبر `arboard`.
4. ابتلاع الأخطاء في طبقة TS.

تختلف صرامة `readImageFromClipboard()` حسب المرحلة:

1. تحظر TS بشكل صارم سياقات وقت التشغيل غير المدعومة (Termux/Linux بدون واجهة رسومية) وتُعيد `null`.
2. تعمل قراءة `arboard` في Rust فقط عندما تسمح TS بذلك.
3. يُربَط `ContentNotAvailable` بالقيمة `null`.
4. أخطاء Rust الأخرى ترفض.

### دورة حياة تحليل أداء العمل

1. لا يوجد بدء صريح: التحليل يعمل دائماً عند تنفيذ مساعدات المهام.
2. يسجّل كل نطاق مهمة مُجهَّز عينة واحدة عند إسقاط الحارس.
3. تُستبدَل أقدم الإدخالات بعد الوصول لسعة المخزن المؤقت.
4. تقرأ `getWorkProfile(lastSeconds)` نافذة زمنية وتستخرج منتجات المكدس المطوي/الملخص/SVG.

انتقالات الفشل:

- فشل توليد SVG هو فشل مرن (`svg: null`)، بينما يستمر إرجاع المكدس المطوي والملخص.
- نافذة العينات الفارغة تُعيد بيانات مكدس مطوية فارغة و`svg: null`، وليس خطأً.

## العمليات غير المدعومة وانتشار الأخطاء

### الصورة

- إدخال فك ترميز غير مدعوم أو بايتات تالفة: فشل صارم (رفض الوعد).
- معرّف تنسيق ترميز غير مدعوم: فشل صارم.
- لا يوجد مسار احتياطي لأفضل جهد في غلاف TS.

### HTML

- أخطاء التحويل هي فشل صارم (رفض).
- حذف الخيارات يُعامَل كتعيين افتراضي بأفضل جهد، وليس فشلاً.

### الحافظة

- نسخ النص يعمل بأفضل جهد في طبقة TS: تُكبَت الأخطاء التشغيلية.
- قراءة الصورة تُميِّز بين "لا توجد صورة" (`null`) والفشل التشغيلي (الرفض).
- تُعامَل Termux/Linux بدون واجهة رسومية كسياقات غير مدعومة لقراءة الصورة (`null`).

### تحليل أداء العمل

- الاسترجاع صارم بالنسبة لاستدعاء الدالة نفسه، لكن توليد المنتجات يعمل جزئياً بأفضل جهد (`svg` قابل للقيمة null).
- اقتطاع المخزن المؤقت هو سلوك متوقع (مخزن دائري)، وليس خطأ فقدان بيانات.

## ملاحظات خاصة بالمنصة

- **نص الحافظة**: يعتمد OSC 52 على دعم الطرفية؛ ويعتمد الوصول الأصلي للحافظة على بيئة سطح المكتب/الجلسة.
- **قراءة صورة الحافظة**: محظورة في TS على Termux وLinux بدون خادم عرض.
