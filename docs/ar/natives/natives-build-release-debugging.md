---
title: 'Natives Build, Release, and Debugging Runbook'
description: >-
  Build, release, and debugging runbook for the Rust native addon across
  platforms.
sidebar:
  order: 8
  label: البناء والإصدار وتصحيح الأخطاء
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# دليل تشغيل بناء وإصدار وتصحيح أخطاء Natives

يصف دليل التشغيل هذا كيف ينتج خط أنابيب بناء `@f5xc-salesdemos/pi-natives` إضافات `.node`، وكيف تقوم التوزيعات المُجمَّعة بتحميلها، وكيفية تصحيح أخطاء المُحمِّل/البناء.

يتبع مصطلحات البنية المعمارية الواردة في `docs/natives-architecture.md`:

- **إنتاج عناصر وقت البناء** (`scripts/build-native.ts`)
- **توليد بيان الإضافة المُضمَّنة** (`scripts/embed-native.ts`)
- **تحميل الإضافة في وقت التشغيل + بوابة التحقق** (`src/native.ts`)

## ملفات التنفيذ

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## نظرة عامة على خط أنابيب البناء

### 1) نقاط دخول البناء

سكربتات `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → بناء إصدار
- `bun scripts/build-native.ts --dev` (`dev:native`) → بناء ملف تعريف تصحيح/تطوير (نفس تسمية المخرجات)
- `bun scripts/embed-native.ts` (`embed:native`) → توليد `src/embedded-addon.ts` من الملفات المبنية

### 2) بناء عناصر Rust

يُشغّل `build-native.ts` أداة Cargo في `crates/pi-natives`:

- الأمر الأساسي: `cargo build`
- وضع الإصدار يُضيف `--release` ما لم يتم تمرير `--dev`
- الهدف المتقاطع يُضيف `--target <CROSS_TARGET>`

يُصرّح `crates/pi-natives/Cargo.toml` عن `crate-type = ["cdylib"]`، لذا يُنتج Cargo مكتبة مشتركة (`.so`/`.dylib`/`.dll`) يتم بعدها نسخها/إعادة تسميتها إلى اسم ملف إضافة `.node`.

### 3) اكتشاف العناصر وتثبيتها

بعد اكتمال Cargo، يفحص `build-native.ts` أدلة المخرجات المرشحة بالترتيب:

1. `${CARGO_TARGET_DIR}` (إذا كان مُعيَّنًا)
2. `<repo>/target`
3. `crates/pi-natives/target`

لكل جذر يتحقق من أدلة الملف التعريفي:

- البناء المتقاطع: `<root>/<crossTarget>/<profile>` ثم `<root>/<profile>`
- البناء المحلي: `<root>/<profile>`

ثم يبحث عن أحد الملفات التالية:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

عند العثور عليه، يتم تثبيته ذريًا في `packages/natives/native/` باستخدام دلالات ملف مؤقت + إعادة تسمية (يتعامل البديل على Windows مع إخفاقات استبدال DLL المقفل بشكل صريح).

## نموذج الهدف/المتغير واصطلاحات التسمية

## وسم المنصة

يستخدم كل من البناء ووقت التشغيل وسم المنصة:

`<platform>-<arch>` (مثال: `darwin-arm64`، `linux-x64`)

## نموذج المتغيرات (x64 فقط)

يدعم x64 متغيرات المعالج:

- `modern` (مسار قادر على AVX2)
- `baseline` (بديل احتياطي)

يستخدم غير x64 عنصرًا افتراضيًا واحدًا (بدون لاحقة متغير).

### أسماء ملفات المخرجات

بناء الإصدار:

- x64: `pi_natives.<platform>-<arch>-modern.node` أو `...-baseline.node`
- غير x64: `pi_natives.<platform>-<arch>.node`

بناء التطوير (`--dev`):

- يستخدم علامات ملف تعريف التصحيح لكن يحافظ على تسمية المخرجات الموسومة بالمنصة القياسية

ترتيب المرشحين في مُحمِّل وقت التشغيل في `native.ts`:

- مرشحو الإصدار
- الوضع المُجمَّع يُقدّم المرشحين المستخرجين/المخزنين مؤقتًا قبل الملفات المحلية للحزمة

## علامات البيئة وخيارات البناء

## علامات وقت التشغيل

- `PI_DEV` (سلوك المُحمِّل): تمكين تشخيصات المُحمِّل
- `PI_NATIVE_VARIANT` (سلوك المُحمِّل، x64 فقط): فرض اختيار `modern` أو `baseline` في وقت التشغيل
- `PI_COMPILED` (سلوك المُحمِّل): تمكين سلوك المرشح/الاستخراج للملف الثنائي المُجمَّع

## علامات/خيارات وقت البناء

- `--dev` (وسيط السكربت): بناء ملف تعريف التصحيح
- `CROSS_TARGET`: يُمرَّر إلى Cargo `--target`
- `TARGET_PLATFORM`: تجاوز تسمية وسم المنصة في المخرجات
- `TARGET_ARCH`: تجاوز تسمية البنية في المخرجات
- `TARGET_VARIANT` (x64 فقط): فرض `modern` أو `baseline` لاسم ملف المخرجات وسياسة RUSTFLAGS
- `CARGO_TARGET_DIR`: جذر إضافي عند البحث في مخرجات Cargo
- `RUSTFLAGS`:
  - إذا لم يكن مُعيَّنًا ولا يتم التجميع المتقاطع، يُعيّن السكربت:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - غير x64 / بدون متغير: `-C target-cpu=native`
  - إذا كان مُعيَّنًا مسبقًا، لا يتجاوزه السكربت

## انتقالات حالة/دورة حياة البناء

### دورة حياة البناء (`build-native.ts`)

1. **التهيئة**: تحليل الوسائط/البيئة (`--dev`، تجاوزات الهدف، علامات التجميع المتقاطع)
2. **تحديد المتغير**:
   - غير x64 → بدون متغير
   - x64 + `TARGET_VARIANT` → متغير صريح
   - بناء متقاطع x64 بدون `TARGET_VARIANT` → خطأ فادح
   - بناء محلي x64 بدون تجاوز → اكتشاف AVX2 للمضيف
3. **التجميع**: تشغيل Cargo مع الملف التعريفي/الهدف المُحدَّد
4. **تحديد العنصر**: فحص جذور الهدف/أدلة الملفات التعريفية/أسماء المكتبات
5. **التثبيت**: نسخ + إعادة تسمية ذرية إلى `packages/natives/native`
6. **الاكتمال**: عنصر الإضافة جاهز لمرشحي المُحمِّل

تحدث حالات خروج الفشل في أي مرحلة مع نص خطأ صريح (متغير غير صالح، فشل بناء cargo، مكتبة مخرجات مفقودة، فشل التثبيت/إعادة التسمية).

### دورة حياة التضمين (`embed-native.ts`)

1. **التهيئة**: حساب وسم المنصة من `TARGET_PLATFORM`/`TARGET_ARCH` أو قيم المضيف
2. **مجموعة المرشحين**:
   - x64 يتوقع كلاً من `modern` و`baseline`
   - غير x64 يتوقع ملفًا افتراضيًا واحدًا
3. **التحقق من التوفر** في `packages/natives/native`
4. **توليد البيان** (`src/embedded-addon.ts`) مع استيرادات `file` من Bun وإصدار الحزمة
5. **الاستخراج في وقت التشغيل جاهز** للوضع المُجمَّع

`--reset` يتجاوز التحقق ويكتب بيانًا فارغًا (`embeddedAddon = null`).

## سير عمل التطوير مقابل السلوك المُجمَّع/المشحون

## سير عمل التطوير المحلي

الحلقة المحلية النموذجية:

1. بناء الإضافة:
   - إصدار: `bun --cwd=packages/natives run build`
   - ملف تعريف تصحيح: `bun --cwd=packages/natives run dev:native`
2. تعيين `PI_DEV=1` عند اختبار تشخيصات المُحمِّل
3. المُحمِّل في `native.ts` يُحدِّد مرشحي `native/` المحليين للحزمة (والبديل في دليل الملف التنفيذي)
4. `validateNative` يفرض توافق التصدير قبل أن تستخدم الأغلفة الربط

## سير عمل الملف الثنائي المشحون/المُجمَّع

في الوضع المُجمَّع (`PI_COMPILED` أو علامات Bun المُضمَّنة):

1. يحسب المُحمِّل دليل ذاكرة التخزين المؤقت المُسيَّر: `<getNativesDir()>/<packageVersion>` (عمليًا `~/.xcsh/natives/<version>`)
2. إذا تطابق البيان المُضمَّن مع المنصة+الإصدار الحاليين، قد يستخرج المُحمِّل الملف المُضمَّن المُحدَّد إلى ذلك الدليل المُسيَّر
3. يتضمن ترتيب مرشحي وقت التشغيل:
   - دليل ذاكرة التخزين المؤقت المُسيَّر
   - دليل الملف الثنائي المُجمَّع القديم (`%LOCALAPPDATA%/xcsh` على Windows، `~/.local/bin` في غير ذلك)
   - أدلة الحزمة/الملف التنفيذي
4. أول إضافة يتم تحميلها بنجاح لا تزال يجب أن تجتاز `validateNative`

لهذا السبب يجب أن تتوافق توقعات التغليف + مُحمِّل وقت التشغيل: أسماء الملفات ووسوم المنصة والرموز المُصدَّرة يجب أن تتطابق مع ما يفحصه ويتحقق منه `native.ts`.

## ربط واجهة JS API ↔ تصدير Rust (مجموعة فرعية من بوابة التحقق)

يتطلب `native.ts` وجود هذه التصديرات المرئية من JS على الإضافة المُحمَّلة. وهي تتناظر مع تصديرات N-API من Rust في `crates/pi-natives/src`:

| اسم JS المطلوب بواسطة `validateNative` | إعلان تصدير Rust | ملف مصدر Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (تصدير بنمط camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

إذا كان أي رمز مطلوب مفقودًا، يفشل المُحمِّل فورًا مع تلميح لإعادة البناء.

## سلوك الفشل والتشخيصات

## إخفاقات وقت البناء

- تكوين متغير غير صالح:
  - `TARGET_VARIANT` مُعيَّن على غير x64 → خطأ فوري
  - بناء متقاطع x64 بدون `TARGET_VARIANT` صريح → خطأ فوري
- فشل بناء Cargo:
  - يُظهر السكربت رمز الخروج غير الصفري و stderr
- العنصر غير موجود:
  - يطبع السكربت كل دليل ملف تعريفي تم فحصه
- فشل التثبيت:
  - رسالة صريحة؛ Windows يتضمن تلميحًا للملف المقفل

## إخفاقات مُحمِّل وقت التشغيل (`native.ts`)

- وسم منصة غير مدعوم:
  - يرمي خطأ مع قائمة المنصات المدعومة
- لم يتمكن أي مرشح من التحميل:
  - يرمي خطأ مع قائمة أخطاء المرشحين الكاملة وتلميحات معالجة خاصة بالوضع
- تصديرات مفقودة:
  - يرمي خطأ مع أسماء الرموز المفقودة بالضبط وأمر إعادة البناء
- مشاكل الاستخراج المُضمَّن:
  - أخطاء إنشاء الدليل/الكتابة يتم تسجيلها وتضمينها في التشخيصات النهائية

## مصفوفة استكشاف الأخطاء وإصلاحها

| العَرَض | السبب المُحتمل | التحقق | الإصلاح |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ملف ثنائي `.node` قديم، أو عدم تطابق اسم تصدير Rust، أو تم تحميل ملف ثنائي خاطئ | شغّل مع `PI_DEV=1` لرؤية المسار المُحمَّل؛ افحص قائمة التصديرات لذلك الملف | أعد بناء `build`؛ تأكد أن اسم تصدير Rust `#[napi]` (أو الاسم المستعار الصريح عند الحاجة) يتطابق مع مفتاح JS؛ احذف الملفات المخزنة مؤقتًا/المُسيَّرة القديمة |
| جهاز x64 يُحمِّل baseline بينما المتوقع modern | `PI_NATIVE_VARIANT=baseline`، أو لم يتم اكتشاف AVX2، أو ملف baseline فقط موجود | تحقق من `PI_NATIVE_VARIANT`؛ افحص `native/` بحثًا عن ملف `-modern` | ابنِ متغير modern (`TARGET_VARIANT=modern ... build`) وتأكد من شحن الملف |
| البناء المتقاطع يُنتج ملفًا ثنائيًا غير قابل للاستخدام/بتسمية خاطئة | عدم تطابق بين `CROSS_TARGET` و `TARGET_PLATFORM`/`TARGET_ARCH`، أو `TARGET_VARIANT` مفقود لـ x64 | تأكد من مجموعة متغيرات البيئة واسم ملف المخرجات | أعد التشغيل بقيم بيئة متسقة و `TARGET_VARIANT` صريح لـ x64 |
| الملف الثنائي المُجمَّع يفشل بعد الترقية | ذاكرة تخزين مؤقت مستخرجة قديمة (`~/.xcsh/natives/<old-or-mismatched-version>`) أو عدم تطابق البيان المُضمَّن | افحص دليل natives المُسيَّر وقائمة أخطاء المُحمِّل | احذف ذاكرة التخزين المؤقت المُسيَّرة لإصدار الحزمة وأعد التشغيل؛ أعد توليد البيان المُضمَّن أثناء التغليف |
| المُحمِّل يفحص مسارات عديدة ولا يعمل أي منها | عدم تطابق المنصة أو عنصر إصدار مفقود في `native/` الحزمة | تحقق من `platformTag` مقابل اسم/أسماء الملفات الفعلية | تأكد أن اسم الملف المبني يتطابق تمامًا مع اصطلاح `pi_natives.<platform>-<arch>(-variant).node` وأن الحزمة تتضمن `native/` |
| `embed:native` يفشل مع "Incomplete native addons" | ملفات المتغيرات المطلوبة لم تُبنَ قبل التضمين | تحقق من القائمة المتوقعة مقابل الموجودة في نص الخطأ | ابنِ الملفات المطلوبة أولاً (x64: كلا modern+baseline؛ غير x64: الافتراضي)، ثم أعد تشغيل `embed:native` |

## الأوامر التشغيلية

```bash
# Release artifact for current host
bun --cwd=packages/natives run build

# Debug profile artifact build
bun --cwd=packages/natives run dev:native

# Build explicit x64 variants
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Generate embedded addon manifest from built native files
bun --cwd=packages/natives run embed:native

# Reset embedded manifest to null stub
bun --cwd=packages/natives run embed:native -- --reset
```
