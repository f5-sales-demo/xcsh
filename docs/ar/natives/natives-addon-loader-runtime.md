---
title: بيئة تشغيل محمّل الإضافات الأصلية
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: محمّل الإضافات
i18n:
  sourceHash: 743ea3e32c7c
  translator: machine
---

# بيئة تشغيل محمّل الإضافات الأصلية

يتعمق هذا المستند في طبقة تحميل/التحقق من الإضافات في `@f5-sales-demo/pi-natives`: كيف يقرر `native.ts` أي ملف `.node` سيتم تحميله، ومتى يتم تشغيل استخراج الحمولة المضمّنة، وكيف يتم الإبلاغ عن إخفاقات بدء التشغيل.

## ملفات التنفيذ

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## النطاق والمسؤولية

مسؤوليات المحمّل/بيئة التشغيل محدودة عن قصد:

- بناء قائمة مرشحة لأسماء ملفات الإضافات والمجلدات بناءً على المنصة ووحدة المعالجة المركزية.
- تجسيد إضافة مضمّنة اختيارياً في مجلد ذاكرة مؤقتة مُصدَّر لكل مستخدم.
- تجربة المرشحين بترتيب حتمي.
- رفض الإضافات القديمة أو غير المتوافقة عبر `validateNative` قبل كشف الربطات.

خارج النطاق هنا: سلوك grep/text/highlight الخاص بالوحدات.

## مدخلات بيئة التشغيل والحالة المشتقة

عند تهيئة الوحدة (`export const native = loadNative();`)، يحسب `native.ts` السياق الثابت:

- **وسم المنصة**: ``${process.platform}-${process.arch}`` (على سبيل المثال `darwin-arm64`).
- **إصدار الحزمة**: من `packages/natives/package.json` (حقل `version`).
- **المجلدات الأساسية**:
  - `nativeDir`: المجلد المحلي للحزمة `packages/natives/native`.
  - `execDir`: المجلد الذي يحتوي على `process.execPath`.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - بديل `userDataDir`:
    - ويندوز: `%LOCALAPPDATA%/xcsh` (أو `%USERPROFILE%/AppData/Local/xcsh`).
    - غير ويندوز: `~/.local/bin`.
- **وضع الملف التنفيذي المُجمَّع** (`isCompiledBinary`): يكون `true` إذا تحقق أي مما يلي:
  - متغير البيئة `PI_COMPILED` مُعيَّن، أو
  - `import.meta.url` يحتوي على علامات Bun المضمّنة (`$bunfs`، `~BUN`، `%7EBUN`).
- **تجاوز المتغير**: `PI_NATIVE_VARIANT` (`modern`/`baseline` فقط؛ القيم غير الصالحة يتم تجاهلها).
- **المتغير المُختار**: التجاوز الصريح، وإلا كشف AVX2 أثناء التشغيل على x64 (`modern` إذا كان AVX2 متاحاً، وإلا `baseline`).

## دعم المنصات وتحليل الوسوم

`SUPPORTED_PLATFORMS` محددة بـ:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

تفاصيل السلوك:

- لا يتم رفض المنصات غير المدعومة مسبقاً.
- يحاول المحمّل جميع المرشحين المحسوبين أولاً.
- إذا لم يتم تحميل أي شيء، يُطلق خطأً صريحاً بعدم دعم المنصة مع سرد الوسوم المدعومة.

يحافظ هذا على تشخيصات مفيدة لحالات الاقتراب مع الاستمرار في الفشل الحاسم للأهداف غير المدعومة فعلاً.

## اختيار المتغير (`modern` / `baseline` / افتراضي)

### سلوك x64

1. إذا كان `PI_NATIVE_VARIANT` يساوي `modern` أو `baseline`، تفوز تلك القيمة.
2. وإلا يتم كشف دعم AVX2:
   - لينكس: فحص `/proc/cpuinfo` بحثاً عن `avx2`.
   - ماك: استعلام `sysctl` (`machdep.cpu.leaf7_features`، بديل `machdep.cpu.features`).
   - ويندوز: تشغيل PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. النتيجة:
   - AVX2 متاح -> `modern`
   - AVX2 غير متاح/غير قابل للكشف -> `baseline`

### سلوك غير x64

- لا يُستخدم أي متغير؛ يبقى المحمّل على اسم الملف الافتراضي (`pi_natives.<platform>-<arch>.node`).

### بناء اسم الملف

بافتراض `tag = <platform>-<arch>`:

- غير x64 أو بدون متغير: `pi_natives.<tag>.node`
- x64 + `modern`: محاولة بالترتيب
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (بديل مقصود)
- x64 + `baseline`: فقط `pi_natives.<tag>-baseline.node`

`addonLabel` المستخدم في رسائل الخطأ النهائية هو إما `<tag>` أو `<tag> (<variant>)`.

## بناء مسارات المرشحين وترتيب البدائل

يبني `native.ts` مجموعات المرشحين قبل أي استدعاء `require(...)`.

### مرشحو الإصدار

مبنية من قائمة أسماء الملفات المحلولة حسب المتغير ويتم البحث فيها بهذا الترتيب:

- **بيئة تشغيل غير مُجمَّعة**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **بيئة تشغيل مُجمَّعة** (`PI_COMPILED` أو علامات Bun المضمّنة):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` يزيل التكرارات مع الحفاظ على ترتيب الظهور الأول.

### التسلسل النهائي أثناء التشغيل

عند وقت التحميل:

1. يتم إدراج مرشح الاستخراج المضمّن الاختياري (إذا تم إنتاجه) في المقدمة.
2. يتم تجربة المرشحين المتبقين بعد إزالة التكرار بالترتيب.
3. أول مرشح ينجح في كل من `require(...)` ويجتاز `validateNative(...)` يفوز.

## دورة حياة استخراج الإضافة المضمّنة

يحدد `embedded-addon.ts` شكل بيان مُولَّد:

- `platformTag`
- `version`
- `files[]` حيث يحتوي كل إدخال على `variant`، `filename`، `filePath`

القيمة الافتراضية المسجلة حالياً هي `embeddedAddon: null`؛ قد تستبدل القطع الأثرية المُجمَّعة هذه ببيانات وصفية حقيقية.

### آلة حالة الاستخراج

يعمل الاستخراج (`maybeExtractEmbeddedAddon`) فقط عندما تمر جميع البوابات:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. يتم العثور على ملف مضمّن مناسب للمتغير

اختيار ملف المتغير يعكس غرض المتغير أثناء التشغيل:

- غير x64: تفضيل `default`، ثم أول ملف متاح.
- x64 + `modern`: تفضيل `modern`، بديل `baseline`.
- x64 + `baseline`: يتطلب `baseline`.

سلوك التجسيد:

1. التأكد من وجود `<versionedDir>` (`mkdirSync(..., { recursive: true })`).
2. إذا كان `<versionedDir>/<selected filename>` موجوداً بالفعل، يتم إعادة استخدامه (بدون إعادة كتابة).
3. وإلا يتم قراءة مصدر `filePath` المضمّن وكتابة الملف المستهدف.
4. إرجاع المسار المستهدف لمحاولة التحميل ذات الأولوية الأعلى.

عند الفشل، لا يتعطل الاستخراج فوراً؛ بل يُلحق إدخال خطأ (فشل إنشاء المجلد أو الكتابة) ويتابع المحمّل فحص المرشحين العاديين.

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
- يتم تجميع الأسماء المفقودة.
- إذا كان أي منها مفقوداً، يُطلق المحمّل خطأً يتضمن:
  - مسار الإضافة المصدر،
  - قائمة التصديرات المفقودة،
  - تلميح أمر إعادة البناء.

هذه بوابة توافق صارمة ضد الملفات الثنائية القديمة والبنى الجزئية وانحراف الرموز/الأسماء.

### تعيين واجهة JS ↔ التصدير الأصلي (بوابة التحقق)

| اسم ربط JS المُفحوص في `validateNative` | اسم التصدير الأصلي المتوقع |
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

ملاحظة: يُصرّح `bindings.ts` فقط عن العضو الأساسي `cancelWork(id)`؛ ملفات `types.ts` الخاصة بالوحدات تدمج إعلانات رموز إضافية يفرضها `validateNative`.

## سلوك الفشل والتشخيصات

## منصة غير مدعومة

إذا فشل جميع المرشحين ولم يكن `platformTag` ضمن `SUPPORTED_PLATFORMS`، يُطلق المحمّل:

- `Unsupported platform: <tag>`
- قائمة كاملة بالمنصات المدعومة
- إرشادات صريحة للإبلاغ عن المشكلة

## أعراض الملف الثنائي القديم / عدم التطابق

إشارة عدم التطابق القديمة النموذجية:

- `Native addon missing exports (<candidate>). Missing: ...`

الأسباب الشائعة:

- ملف `.node` ثنائي قديم من إصدار/شكل API سابق للحزمة.
- اختيار قطعة أثرية بمتغير خاطئ (لـ x64).
- تصدير Rust جديد غير موجود في القطعة الأثرية المحمّلة.

سلوك المحمّل:

- يسجل إخفاقات التصديرات المفقودة لكل مرشح.
- يستمر في فحص المرشحين المتبقين.
- إذا لم ينجح أي مرشح في التحقق، يتضمن الخطأ النهائي كل مسار تمت تجربته مع رسالة فشل كل منها.

## إخفاقات بدء تشغيل الملف الثنائي المُجمَّع

في وضع التجميع تتضمن التشخيصات النهائية:

- مسارات ذاكرة التخزين المؤقت المُصدَّرة المتوقعة (`<versionedDir>/<filename>`)،
- معالجة لحذف `<versionedDir>` القديم وإعادة التشغيل،
- أوامر `curl` لتنزيل الإصدار المباشر لكل اسم ملف متوقع.

## إخفاقات بدء التشغيل غير المُجمَّعة

في وضع الحزمة/بيئة التشغيل العادية تتضمن التشخيصات النهائية:

- تلميح إعادة التثبيت (`bun install @f5-sales-demo/pi-natives`)،
- أمر إعادة البناء المحلي (`bun --cwd=packages/natives run build`)،
- تلميح اختياري لبناء متغير x64 (`TARGET_VARIANT=baseline|modern ...`).

## سلوك بيئة التشغيل

- يستخدم المحمّل دائماً سلسلة مرشحي الإصدار.
- تعيين `PI_DEV` يُفعّل فقط التشخيصات لكل مرشح على وحدة التحكم (`Loaded native addon...` وأخطاء التحميل).
