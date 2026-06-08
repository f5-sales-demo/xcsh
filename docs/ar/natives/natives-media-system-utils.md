---
title: أدوات الوسائط الأصلية والنظام
description: >-
  أدوات معالجة الوسائط الأصلية لالتقاط لقطات الشاشة ومعالجة الصور ومعلومات
  النظام.
sidebar:
  order: 7
  label: أدوات الوسائط والنظام
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# أدوات الوسائط والنظام الأصلية

هذه الوثيقة هي تعمّق في النظام الفرعي لطبقة **بدائيات النظام/الوسائط/التحويل** الموصوفة في [`docs/natives-architecture.md`](./natives-architecture.md): `image`، و`html`، و`clipboard`، وتوصيف `work`.

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

> ملاحظة: لا يوجد ملف `crates/pi-natives/src/work.rs`؛ توصيف العمل مُنفَّذ في `prof.rs` ويتغذى من الأدوات الموجودة في `task.rs`.

## تعيين واجهة TS البرمجية ↔ تصدير/وحدة Rust

| تصدير TS (packages/natives)                 | تصدير N-API في Rust                                                     | وحدة Rust                             |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + منطق احتياطي في TS                                 | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## حدود تنسيق البيانات والتحويلات

### الصور (`image`)

- **حد الإدخال في JS**: بايتات صورة مُرمَّزة بصيغة `Uint8Array`.
- **حد فك الترميز في Rust**: يتم نسخ البايتات إلى `Vec<u8>`، ويتم تخمين التنسيق باستخدام `ImageReader::with_guessed_format()`، ثم يتم فك الترميز إلى `DynamicImage`.
- **الحالة في الذاكرة**: يخزن `PhotonImage` مؤشر `Arc<DynamicImage>`.
- **حد الإخراج**: يُرجع `encode(format, quality)` وعدًا `Promise<Uint8Array>` (في Rust: `Vec<u8>`).

معرّفات التنسيق رقمية:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (ترميز بدون فقدان)
- `3`: GIF

القيود:

- `quality` يُستخدم فقط مع JPEG.
- PNG/WebP/GIF تتجاهل `quality`.
- معرّفات التنسيق غير المدعومة تفشل (`Invalid image format: <id>`).

### تحويل HTML (`html`)

- **حد الإدخال في JS**: سلسلة نصية HTML `string` + كائن اختياري `{ cleanContent?: boolean; skipImages?: boolean }`.
- **حد التحويل في Rust**: يتم تحويل المدخل `String` بواسطة `html_to_markdown_rs::convert`.
- **حد الإخراج**: سلسلة نصية Markdown `string`.

سلوك التحويل:

- القيمة الافتراضية لـ `cleanContent` هي `false`.
- عند `cleanContent=true`، يتم تفعيل المعالجة المسبقة مع `PreprocessingPreset::Aggressive` وعلامات الإزالة الصارمة للتنقل/النماذج.
- القيمة الافتراضية لـ `skipImages` هي `false`.

### الحافظة (`clipboard`)

- **مسار النص**:
  - يُرسل TS أولاً OSC 52 (`\x1b]52;c;<base64>\x07`) عندما يكون stdout طرفية TTY.
  - ثم يتم محاولة نفس النص عبر واجهة الحافظة الأصلية (`native.copyToClipboard`) كمحاولة بأفضل جهد.
  - على Termux، يحاول TS تنفيذ `termux-clipboard-set` أولاً.
- **مسار قراءة الصور**:
  - يقرأ Rust الصورة الخام من `arboard`.
  - يُعيد Rust ترميزها إلى بايتات PNG (مكتبة `image`)، ويُرجع `{ data: Uint8Array, mimeType: "image/png" }`.
  - يُرجع TS قيمة `null` مبكرًا على Termux أو جلسات Linux بدون خادم عرض (غياب `DISPLAY`/`WAYLAND_DISPLAY`).

### توصيف العمل (`work`)

- **حد التجميع**: يتم إنتاج عينات التوصيف بواسطة حراس `profile_region(tag)` في `task::blocking` و`task::future`.
- **تنسيق التخزين**: مخزن مؤقت دائري بحجم ثابت (`MAX_SAMPLES = 10_000`) يخزن مسار المكدس + المدة (`μs`) + الطابع الزمني (`μs منذ بدء العملية`).
- **حد الإخراج**: يُرجع `getWorkProfile(lastSeconds)` كائنًا:
  - `folded`: نص مكدس مطوي (مدخل رسم اللهب البياني)
  - `summary`: جدول ملخص بتنسيق Markdown
  - `svg`: رسم SVG اختياري لرسم اللهب البياني
  - `totalMs`، `sampleCount`

## دورة الحياة وانتقالات الحالة

### دورة حياة الصور

1. يجدول `PhotonImage.parse(bytes)` مهمة فك ترميز حاجبة (`image.decode`).
2. عند النجاح، يوجد مقبض `PhotonImage` أصلي في JS.
3. ينشئ `resize(...)` مقبضًا أصليًا جديدًا (`image.resize`)، ويمكن أن يتواجد المقبض القديم والجديد معًا.
4. يحوّل `encode(...)` الصورة إلى بايتات (`image.encode`) دون تغيير أبعاد الصورة.

انتقالات الفشل:

- فشل اكتشاف التنسيق/فك الترميز يرفض وعد التحليل.
- فشل الترميز يرفض وعد الترميز.
- معرّف تنسيق غير صالح يرفض وعد الترميز.

### دورة حياة HTML

1. يجدول `htmlToMarkdown(html, options)` مهمة تحويل حاجبة.
2. يعمل التحويل بالخيارات الافتراضية (`cleanContent=false`، `skipImages=false`) ما لم يتم تحديدها.
3. يُرجع سلسلة Markdown نصية أو يرفض.

انتقالات الفشل:

- فشل المحوّل يُرجع وعدًا مرفوضًا (`Conversion error: ...`).

### دورة حياة الحافظة

`copyToClipboard(text)` مصمم عمدًا كأفضل جهد ومتعدد المسارات:

1. إذا كان TTY: محاولة كتابة OSC 52 (حمولة base64).
2. محاولة أمر Termux عند تعيين `TERMUX_VERSION`.
3. محاولة نسخ نص عبر `arboard` الأصلي.
4. ابتلاع الأخطاء في طبقة TS.

تختلف صرامة `readImageFromClipboard()` حسب المرحلة:

1. يحظر TS بشكل صارم سياقات التشغيل غير المدعومة (Termux/Linux بدون واجهة رسومية) بإرجاع `null`.
2. تعمل قراءة `arboard` في Rust فقط عندما يسمح TS بذلك.
3. يُعيَّن `ContentNotAvailable` إلى `null`.
4. أخطاء Rust الأخرى ترفض الوعد.

### دورة حياة توصيف العمل

1. لا يوجد بدء صريح: التوصيف يعمل دائمًا عند تنفيذ مساعدي المهام.
2. يسجل كل نطاق مهمة مُجهَّز بالأدوات عينة واحدة عند إسقاط الحارس.
3. تكتب العينات فوق الإدخالات الأقدم بعد الوصول إلى سعة المخزن المؤقت.
4. يقرأ `getWorkProfile(lastSeconds)` نافذة زمنية ويستخرج منتجات المكدس المطوي/الملخص/SVG.

انتقالات الفشل:

- فشل إنشاء SVG هو فشل ناعم (`svg: null`)، بينما لا يزال المكدس المطوي والملخص يُرجعان.
- نافذة العينات الفارغة تُرجع بيانات مكدس مطوي فارغة و`svg: null`، وليست خطأً.

## العمليات غير المدعومة وانتشار الأخطاء

### الصور

- مدخلات فك الترميز غير المدعومة أو البايتات التالفة: فشل صارم (رفض الوعد).
- معرّف تنسيق ترميز غير مدعوم: فشل صارم.
- لا يوجد مسار احتياطي بأفضل جهد في غلاف TS.

### HTML

- أخطاء التحويل هي فشل صارم (رفض).
- حذف الخيارات هو تعيين افتراضي بأفضل جهد، وليس فشلاً.

### الحافظة

- نسخ النص يعمل بأفضل جهد في طبقة TS: يتم إخماد الأخطاء التشغيلية.
- قراءة الصور تميز بين "لا توجد صورة" (`null`) والفشل التشغيلي (رفض).
- يُعامَل Termux/Linux بدون واجهة رسومية كسياقات غير مدعومة لقراءة الصور (`null`).

### توصيف العمل

- الاسترجاع صارم لاستدعاء الدالة نفسه، لكن إنشاء المنتجات يعمل جزئيًا بأفضل جهد (`svg` قابل للقيمة الفارغة).
- اقتطاع المخزن المؤقت هو سلوك متوقع (مخزن مؤقت حلقي)، وليس خطأ فقدان بيانات.

## تحذيرات خاصة بالمنصة

- **نص الحافظة**: يعتمد OSC 52 على دعم الطرفية؛ يعتمد الوصول إلى الحافظة الأصلية على بيئة سطح المكتب/الجلسة.
- **قراءة صور الحافظة**: محظورة في TS على Termux وLinux بدون خادم عرض.
