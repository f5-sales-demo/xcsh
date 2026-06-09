---
title: أدوات الوسائط والنظام الأصلية
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

هذا المستند هو تعمق في النظام الفرعي لطبقة **البدائيات الخاصة بالنظام/الوسائط/التحويل** الموصوفة في [`docs/natives-architecture.md`](./natives-architecture.md): `image`، `html`، `clipboard`، وتنميط `work`.

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

> ملاحظة: لا يوجد ملف `crates/pi-natives/src/work.rs`؛ تنميط العمل مُنفَّذ في `prof.rs` ويتغذى من الأدوات المُضمَّنة في `task.rs`.

## ربط واجهة TS ↔ تصدير/وحدة Rust

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

### الصورة (`image`)

- **حد الإدخال في JS**: بايتات صورة مُشفَّرة كـ `Uint8Array`.
- **حد فك التشفير في Rust**: يتم نسخ البايتات إلى `Vec<u8>`، ويتم تخمين التنسيق باستخدام `ImageReader::with_guessed_format()`، ثم فك تشفيرها إلى `DynamicImage`.
- **الحالة في الذاكرة**: يخزن `PhotonImage` قيمة `Arc<DynamicImage>`.
- **حد الإخراج**: يُعيد `encode(format, quality)` قيمة `Promise<Uint8Array>` (أي `Vec<u8>` في Rust).

معرّفات التنسيق رقمية:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (مُشفِّر بدون فقدان)
- `3`: GIF

القيود:

- يُستخدم `quality` فقط مع JPEG.
- تتجاهل PNG/WebP/GIF قيمة `quality`.
- معرّفات التنسيق غير المدعومة تفشل (`Invalid image format: <id>`).

### تحويل HTML (`html`)

- **حد الإدخال في JS**: سلسلة نصية HTML من نوع `string` + كائن اختياري `{ cleanContent?: boolean; skipImages?: boolean }`.
- **حد التحويل في Rust**: يتم تحويل إدخال `String` بواسطة `html_to_markdown_rs::convert`.
- **حد الإخراج**: سلسلة نصية Markdown من نوع `string`.

سلوك التحويل:

- القيمة الافتراضية لـ `cleanContent` هي `false`.
- عند `cleanContent=true`، يتم تفعيل المعالجة المسبقة مع `PreprocessingPreset::Aggressive` وعلامات الإزالة الصارمة للتنقل/النماذج.
- القيمة الافتراضية لـ `skipImages` هي `false`.

### الحافظة (`clipboard`)

- **مسار النص**:
  - ترسل TS أولاً OSC 52 (`\x1b]52;c;<base64>\x07`) عندما يكون stdout طرفية TTY.
  - ثم يتم محاولة نسخ نفس النص عبر واجهة الحافظة الأصلية (`native.copyToClipboard`) كأفضل جهد.
  - على Termux، تحاول TS تنفيذ `termux-clipboard-set` أولاً.
- **مسار قراءة الصورة**:
  - يقرأ Rust الصورة الخام من `arboard`.
  - يعيد Rust ترميزها إلى بايتات PNG (مكتبة `image`)، ويُعيد `{ data: Uint8Array, mimeType: "image/png" }`.
  - تُعيد TS قيمة `null` مبكراً على Termux أو جلسات Linux بدون خادم عرض (غياب `DISPLAY`/`WAYLAND_DISPLAY`).

### تنميط العمل (`work`)

- **حد التجميع**: تُنتَج عينات التنميط بواسطة حراسات `profile_region(tag)` في `task::blocking` و `task::future`.
- **تنسيق التخزين**: مخزن مؤقت دائري بحجم ثابت (`MAX_SAMPLES = 10_000`) يخزن مسار المكدس + المدة (`μs`) + الطابع الزمني (`μs منذ بدء العملية`).
- **حد الإخراج**: يُعيد `getWorkProfile(lastSeconds)` كائناً:
  - `folded`: نص مكدسات مطوية (مدخل رسم اللهب)
  - `summary`: جدول ملخص بصيغة markdown
  - `svg`: رسم لهب SVG اختياري
  - `totalMs`، `sampleCount`

## دورة الحياة وانتقالات الحالة

### دورة حياة الصورة

1. يقوم `PhotonImage.parse(bytes)` بجدولة مهمة فك تشفير حاجبة (`image.decode`).
2. عند النجاح، يوجد مقبض `PhotonImage` أصلي في JS.
3. ينشئ `resize(...)` مقبضاً أصلياً جديداً (`image.resize`)، ويمكن أن يتواجد المقبض القديم والجديد معاً.
4. يُنتج `encode(...)` البايتات (`image.encode`) دون تغيير أبعاد الصورة.

انتقالات الفشل:

- فشل اكتشاف التنسيق/فك التشفير يرفض وعد التحليل.
- فشل الترميز يرفض وعد الترميز.
- معرّف تنسيق غير صالح يرفض وعد الترميز.

### دورة حياة HTML

1. يقوم `htmlToMarkdown(html, options)` بجدولة مهمة تحويل حاجبة.
2. يعمل التحويل بالخيارات الافتراضية (`cleanContent=false`، `skipImages=false`) ما لم يتم تحديد غير ذلك.
3. يُعيد سلسلة markdown نصية أو يرفض.

انتقالات الفشل:

- فشل المحوِّل يُعيد وعداً مرفوضاً (`Conversion error: ...`).

### دورة حياة الحافظة

`copyToClipboard(text)` مصمم ليكون أفضل جهد ومتعدد المسارات:

1. إذا كان TTY: محاولة كتابة OSC 52 (حمولة base64).
2. تجربة أمر Termux عند تعيين `TERMUX_VERSION`.
3. تجربة نسخ النص الأصلي عبر `arboard`.
4. ابتلاع الأخطاء في طبقة TS.

يختلف مستوى الصرامة في `readImageFromClipboard()` حسب المرحلة:

1. تمنع TS بشكل صارم سياقات التشغيل غير المدعومة (Termux/Linux بدون واجهة رسومية) وتُعيد `null`.
2. تعمل قراءة `arboard` في Rust فقط عندما تسمح TS بذلك.
3. يُربط `ContentNotAvailable` بالقيمة `null`.
4. أخطاء Rust الأخرى ترفض الوعد.

### دورة حياة تنميط العمل

1. لا يوجد بدء صريح: التنميط يعمل دائماً عند تنفيذ مساعدات المهام.
2. كل نطاق مهمة مُزوَّد بأدوات القياس يسجل عينة واحدة عند إسقاط الحارس.
3. تُستبدل العينات الأقدم بعد الوصول إلى سعة المخزن المؤقت.
4. يقرأ `getWorkProfile(lastSeconds)` نافذة زمنية ويشتق منها مخرجات المكدسات المطوية/الملخص/SVG.

انتقالات الفشل:

- فشل إنشاء SVG هو فشل مرن (`svg: null`)، بينما تُعاد المكدسات المطوية والملخص بشكل طبيعي.
- نافذة العينات الفارغة تُعيد بيانات مكدسات مطوية فارغة و `svg: null`، وليست خطأً.

## العمليات غير المدعومة ونشر الأخطاء

### الصورة

- إدخال فك تشفير غير مدعوم أو بايتات تالفة: فشل صارم (رفض الوعد).
- معرّف تنسيق ترميز غير مدعوم: فشل صارم.
- لا يوجد مسار احتياطي بأفضل جهد في غلاف TS.

### HTML

- أخطاء التحويل هي فشل صارم (رفض).
- حذف الخيارات يعتمد التعيين الافتراضي بأفضل جهد، وليس فشلاً.

### الحافظة

- نسخ النص يعتمد أفضل جهد في طبقة TS: يتم قمع فشل العمليات.
- قراءة الصورة تميز بين "لا توجد صورة" (`null`) وفشل العملية (رفض).
- تُعامل Termux/Linux بدون واجهة رسومية كسياقات غير مدعومة لقراءة الصورة (`null`).

### تنميط العمل

- الاسترجاع صارم لاستدعاء الدالة نفسه، لكن إنشاء المخرجات يعتمد جزئياً أفضل جهد (`svg` قابل للقيمة الفارغة).
- اقتطاع المخزن المؤقت هو سلوك متوقع (مخزن دائري)، وليس خطأ فقدان بيانات.

## تنبيهات خاصة بالمنصة

- **نص الحافظة**: يعتمد OSC 52 على دعم الطرفية؛ ويعتمد الوصول إلى الحافظة الأصلية على بيئة سطح المكتب/الجلسة.
- **قراءة صورة الحافظة**: محظورة في TS لـ Termux وLinux بدون خادم عرض.
