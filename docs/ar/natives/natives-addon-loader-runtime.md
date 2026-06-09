---
title: بيئة تشغيل محمّل الإضافات الأصلية
description: >-
  بيئة تشغيل محمّل إضافات N-API مع اكتشاف المنصة واستراتيجيات الرجوع البديلة وحل
  الوحدات.
sidebar:
  order: 3
  label: محمّل الإضافات
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# بيئة تشغيل محمّل الإضافات الأصلية

يتناول هذا المستند بالتفصيل طبقة تحميل/التحقق من الإضافات في `@f5xc-salesdemos/pi-natives`: كيف يقرر `native.ts` أي ملف `.node` سيتم تحميله، ومتى يتم تشغيل استخراج الحمولة المضمّنة، وكيف يتم الإبلاغ عن أخطاء بدء التشغيل.

## ملفات التنفيذ

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## النطاق والمسؤولية

مسؤوليات المحمّل/بيئة التشغيل محدودة عمداً:

- بناء قائمة مرشحين مدركة للمنصة/المعالج لأسماء ملفات الإضافات والمجلدات.
- تجسيد اختياري لإضافة مضمّنة في مجلد ذاكرة مؤقتة مُصنّف بالإصدار لكل مستخدم.
- تجربة المرشحين بترتيب حتمي.
- رفض الإضافات القديمة أو غير المتوافقة عبر `validateNative` قبل كشف الروابط.

خارج النطاق هنا: سلوك grep/النص/التمييز الخاص بكل وحدة.

## مدخلات بيئة التشغيل والحالة المشتقة

عند تهيئة الوحدة (`export const native = loadNative();`)، يحسب `native.ts` السياق الثابت:

- **وسم المنصة**: ``${process.platform}-${process.arch}`` (مثال `darwin-arm64`).
- **إصدار الحزمة**: من `packages/natives/package.json` (حقل `version`).
- **المجلدات الأساسية**:
  - `nativeDir`: المجلد المحلي للحزمة `packages/natives/native`.
  - `execDir`: المجلد الذي يحتوي على `process.execPath`.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - مجلد `userDataDir` البديل:
    - Windows: `%LOCALAPPDATA%/xcsh` (أو `%USERPROFILE%/AppData/Local/xcsh`).
    - غير Windows: `~/.local/bin`.
- **وضع الملف الثنائي المُجمّع** (`isCompiledBinary`): صحيح إذا تحقق أي مما يلي:
  - متغير البيئة `PI_COMPILED` مُعيّن، أو
  - `import.meta.url` يحتوي على علامات Bun المضمّنة (`$bunfs`، `~BUN`، `%7EBUN`).
- **تجاوز المتغير**: `PI_NATIVE_VARIANT` (`modern`/`baseline` فقط؛ القيم غير الصالحة تُتجاهل).
- **المتغير المُختار**: التجاوز الصريح، وإلا اكتشاف AVX2 أثناء التشغيل على x64 (`modern` إذا توفر AVX2، وإلا `baseline`).

## دعم المنصات وحل الوسوم

`SUPPORTED_PLATFORMS` محدد بـ:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

تفاصيل السلوك:

- المنصات غير المدعومة لا تُرفض مسبقاً.
- يحاول المحمّل أولاً جميع المرشحين المحسوبين.
- إذا لم يتم تحميل أي شيء، يطرح خطأ صريحاً بعدم دعم المنصة مع سرد الوسوم المدعومة.

هذا يحافظ على تشخيصات مفيدة للحالات القريبة من الصحة مع الفشل الحازم للأهداف غير المدعومة فعلاً.

## اختيار المتغير (`modern` / `baseline` / افتراضي)

### سلوك x64

1. إذا كان `PI_NATIVE_VARIANT` يساوي `modern` أو `baseline`، تفوز تلك القيمة.
2. وإلا يتم اكتشاف دعم AVX2:
   - Linux: فحص `/proc/cpuinfo` بحثاً عن `avx2`.
   - macOS: الاستعلام من `sysctl` (`machdep.cpu.leaf7_features`، بديل `machdep.cpu.features`).
   - Windows: تشغيل PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. النتيجة:
   - AVX2 متاح -> `modern`
   - AVX2 غير متاح/غير قابل للاكتشاف -> `baseline`

### سلوك غير x64

- لا يُستخدم أي متغير؛ يبقى المحمّل على اسم الملف الافتراضي (`pi_natives.<platform>-<arch>.node`).

### بناء اسم الملف

بالنظر إلى `tag = <platform>-<arch>`:

- غير x64 أو بدون متغير: `pi_natives.<tag>.node`
- x64 + `modern`: يُجرّب بالترتيب
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (رجوع بديل مقصود)
- x64 + `baseline`: فقط `pi_natives.<tag>-baseline.node`

`addonLabel` المستخدم في رسائل الخطأ النهائية هو إما `<tag>` أو `<tag> (<variant>)`.

## بناء مسارات المرشحين وترتيب الرجوع البديل

يبني `native.ts` مجموعات المرشحين قبل أي استدعاء لـ `require(...)`.

### مرشحو الإصدار

تُبنى من قائمة أسماء الملفات المحسومة بالمتغير وتُبحث بهذا الترتيب:

- **بيئة تشغيل غير مُجمّعة**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **بيئة تشغيل مُجمّعة** (`PI_COMPILED` أو علامات Bun المضمّنة):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` يزيل التكرارات مع الحفاظ على ترتيب أول ظهور.

### التسلسل النهائي أثناء التشغيل

عند التحميل:

1. مرشح الاستخراج المضمّن الاختياري (إن أُنتج) يُدرج في المقدمة.
2. المرشحون المتبقون بعد إزالة التكرار يُجرّبون بالترتيب.
3. أول مرشح ينجح في `require(...)` ويجتاز `validateNative(...)` يفوز.

## دورة حياة استخراج الإضافة المضمّنة

يعرّف `embedded-addon.ts` شكل بيان مُولّد:

- `platformTag`
- `version`
- `files[]` حيث كل عنصر يحتوي على `variant`، `filename`، `filePath`

القيمة الافتراضية المسجّلة حالياً هي `embeddedAddon: null`؛ قد تستبدلها الحِزم المُجمّعة ببيانات وصفية حقيقية.

### آلة حالة الاستخراج

يعمل الاستخراج (`maybeExtractEmbeddedAddon`) فقط عندما تمر جميع البوابات:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. يتم العثور على ملف مضمّن مناسب للمتغير

اختيار ملف المتغير يعكس نية متغير بيئة التشغيل:

- غير x64: تفضيل `default`، ثم أول ملف متاح.
- x64 + `modern`: تفضيل `modern`، رجوع بديل إلى `baseline`.
- x64 + `baseline`: يتطلب `baseline`.

سلوك التجسيد:

1. التأكد من وجود `<versionedDir>` (`mkdirSync(..., { recursive: true })`).
2. إذا كان `<versionedDir>/<selected filename>` موجوداً بالفعل، يُعاد استخدامه (بدون إعادة كتابة).
3. وإلا يُقرأ مصدر الملف المضمّن `filePath` ويُكتب الملف الهدف.
4. يُعاد مسار الهدف لمحاولة التحميل ذات الأولوية الأعلى.

عند الفشل، لا يتعطل الاستخراج فوراً؛ بل يُلحق إدخال خطأ (فشل إنشاء المجلد أو الكتابة) ويتابع المحمّل مع فحص المرشحين العاديين.

## دورة الحياة وانتقالات الحالة

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## فحوصات عقد `validateNative`

يفرض `validateNative(bindings, source)` عقداً قائماً على الدوال فقط على `NativeBindings` عند بدء التشغيل.

الآلية:

- لكل اسم تصدير مطلوب، يتحقق من `typeof bindings[name] === "function"`.
- الأسماء المفقودة تُجمّع.
- إذا كان أي منها مفقوداً، يطرح المحمّل:
  - مسار الإضافة المصدر،
  - قائمة التصديرات المفقودة،
  - تلميح بأمر إعادة البناء.

هذه بوابة توافقية صارمة ضد الملفات الثنائية القديمة والبناءات الجزئية وانحراف الرموز/الأسماء.

### تعيين JS API ↔ التصديرات الأصلية (بوابة التحقق)

| اسم الربط في JS المُتحقق منه في `validateNative` | اسم التصدير الأصلي المتوقع |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

ملاحظة: `bindings.ts` يُعلن فقط عن العضو الأساسي `cancelWork(id)`؛ ملفات `types.ts` الخاصة بالوحدات تُوسّع التعريف بدمج رموز إضافية يفرضها `validateNative`.

## سلوك الفشل والتشخيصات

## منصة غير مدعومة

إذا فشل جميع المرشحين و `platformTag` ليس ضمن `SUPPORTED_PLATFORMS`، يطرح المحمّل:

- `Unsupported platform: <tag>`
- القائمة الكاملة للمنصات المدعومة
- إرشادات صريحة للإبلاغ عن المشكلة

## أعراض الملف الثنائي القديم / عدم التطابق

إشارة عدم التطابق القديم النموذجية:

- `Native addon missing exports (<candidate>). Missing: ...`

الأسباب الشائعة:

- ملف `.node` ثنائي قديم من إصدار/شكل API سابق للحزمة.
- اختيار حزمة متغير خاطئة (لـ x64).
- تصدير Rust جديد غير موجود في الحزمة المُحمّلة.

سلوك المحمّل:

- يسجل أخطاء التصديرات المفقودة لكل مرشح.
- يستمر في فحص المرشحين المتبقين.
- إذا لم يجتز أي مرشح التحقق، يتضمن الخطأ النهائي كل مسار تمت تجربته مع رسالة الفشل لكل منها.

## أخطاء بدء التشغيل في وضع الملف الثنائي المُجمّع

في الوضع المُجمّع تتضمن التشخيصات النهائية:

- مسارات ذاكرة التخزين المؤقت المُصنّفة بالإصدار المتوقعة (`<versionedDir>/<filename>`),
- معالجة بحذف `<versionedDir>` القديم وإعادة التشغيل,
- أوامر `curl` مباشرة لتنزيل الإصدار لكل اسم ملف متوقع.

## أخطاء بدء التشغيل في الوضع غير المُجمّع

في وضع الحزمة/بيئة التشغيل العادي تتضمن التشخيصات النهائية:

- تلميح بإعادة التثبيت (`bun install @f5xc-salesdemos/pi-natives`),
- أمر إعادة البناء المحلي (`bun --cwd=packages/natives run build`),
- تلميح اختياري لبناء متغير x64 (`TARGET_VARIANT=baseline|modern ...`).

## سلوك بيئة التشغيل

- يستخدم المحمّل دائماً سلسلة مرشحي الإصدار.
- تعيين `PI_DEV` يُفعّل فقط تشخيصات وحدة التحكم لكل مرشح (`Loaded native addon...` وأخطاء التحميل).
