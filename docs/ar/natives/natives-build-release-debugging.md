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

# دليل تشغيل البناء والإصدار وتصحيح أخطاء الإضافات الأصلية

يصف دليل التشغيل هذا كيف ينتج خط أنابيب بناء `@f5xc-salesdemos/pi-natives` إضافات `.node`، وكيف تقوم التوزيعات المُجمَّعة بتحميلها، وكيفية تصحيح أخطاء المُحمِّل/البناء.

يتبع مصطلحات البنية المعمارية من `docs/natives-architecture.md`:

- **إنتاج المخرجات في وقت البناء** (`scripts/build-native.ts`)
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

- `bun scripts/build-native.ts` (`build`) → بناء الإصدار النهائي
- `bun scripts/build-native.ts --dev` (`dev:native`) → بناء بملف تعريف التصحيح/التطوير (نفس تسمية المخرجات)
- `bun scripts/embed-native.ts` (`embed:native`) → توليد `src/embedded-addon.ts` من الملفات المبنية

### 2) بناء مخرجات Rust

يُشغِّل `build-native.ts` أداة Cargo في `crates/pi-natives`:

- الأمر الأساسي: `cargo build`
- وضع الإصدار يضيف `--release` ما لم يتم تمرير `--dev`
- الهدف المتقاطع يضيف `--target <CROSS_TARGET>`

يُعلن `crates/pi-natives/Cargo.toml` عن `crate-type = ["cdylib"]`، لذا يُصدر Cargo مكتبة مشتركة (`.so`/`.dylib`/`.dll`) يتم نسخها/إعادة تسميتها بعد ذلك إلى اسم ملف إضافة `.node`.

### 3) اكتشاف المخرجات وتثبيتها

بعد اكتمال Cargo، يفحص `build-native.ts` مجلدات المخرجات المرشحة بالترتيب:

1. `${CARGO_TARGET_DIR}` (إذا كان مُعيَّنًا)
2. `<repo>/target`
3. `crates/pi-natives/target`

لكل جذر يتحقق من مجلدات ملف التعريف:

- البناء المتقاطع: `<root>/<crossTarget>/<profile>` ثم `<root>/<profile>`
- البناء المحلي: `<root>/<profile>`

ثم يبحث عن أحد الملفات التالية:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

عند العثور عليه، يتم تثبيته بشكل ذري في `packages/natives/native/` باستخدام دلالات الملف المؤقت + إعادة التسمية (آلية Windows الاحتياطية تتعامل صراحةً مع فشل استبدال DLL المقفلة).

## نموذج الهدف/المتغير واصطلاحات التسمية

## وسم المنصة

يستخدم كل من البناء ووقت التشغيل وسم المنصة:

`<platform>-<arch>` (مثال: `darwin-arm64`، `linux-x64`)

## نموذج المتغيرات (x64 فقط)

يدعم x64 متغيرات المعالج:

- `modern` (مسار يدعم AVX2)
- `baseline` (احتياطي)

المعماريات غير x64 تستخدم مخرجًا افتراضيًا واحدًا (بدون لاحقة متغير).

### أسماء ملفات المخرجات

بناء الإصدار:

- x64: `pi_natives.<platform>-<arch>-modern.node` أو `...-baseline.node`
- غير x64: `pi_natives.<platform>-<arch>.node`

بناء التطوير (`--dev`):

- يستخدم أعلام ملف تعريف التصحيح لكنه يحتفظ بتسمية المخرجات القياسية الموسومة بالمنصة

ترتيب المرشحين في مُحمِّل وقت التشغيل في `native.ts`:

- مرشحو الإصدار
- في الوضع المُجمَّع يُقدِّم مرشحي الاستخراج/التخزين المؤقت قبل الملفات المحلية للحزمة

## أعلام البيئة وخيارات البناء

## أعلام وقت التشغيل

- `PI_DEV` (سلوك المُحمِّل): تفعيل تشخيصات المُحمِّل
- `PI_NATIVE_VARIANT` (سلوك المُحمِّل، x64 فقط): فرض اختيار `modern` أو `baseline` في وقت التشغيل
- `PI_COMPILED` (سلوك المُحمِّل): تفعيل سلوك المرشحين/الاستخراج للملفات الثنائية المُجمَّعة

## أعلام/خيارات وقت البناء

- `--dev` (معامل السكربت): بناء بملف تعريف التصحيح
- `CROSS_TARGET`: يُمرَّر إلى Cargo `--target`
- `TARGET_PLATFORM`: تجاوز تسمية وسم منصة المخرجات
- `TARGET_ARCH`: تجاوز تسمية معمارية المخرجات
- `TARGET_VARIANT` (x64 فقط): فرض `modern` أو `baseline` لاسم ملف المخرجات وسياسة RUSTFLAGS
- `CARGO_TARGET_DIR`: جذر إضافي عند البحث في مخرجات Cargo
- `RUSTFLAGS`:
  - إذا لم يكن مُعيَّنًا ولم يكن بناءً متقاطعًا، يُعيِّن السكربت:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - غير x64 / بدون متغير: `-C target-cpu=native`
  - إذا كان مُعيَّنًا مسبقًا، لا يتجاوزه السكربت

## حالات البناء/تحولات دورة الحياة

### دورة حياة البناء (`build-native.ts`)

1. **التهيئة**: تحليل المعاملات/البيئة (`--dev`، تجاوزات الهدف، أعلام البناء المتقاطع)
2. **حل المتغير**:
   - غير x64 → بدون متغير
   - x64 + `TARGET_VARIANT` → متغير صريح
   - بناء x64 متقاطع بدون `TARGET_VARIANT` → خطأ حازم
   - بناء x64 محلي بدون تجاوز → اكتشاف دعم AVX2 في المضيف
3. **التجميع**: تشغيل Cargo بملف التعريف/الهدف المُحدَّد
4. **تحديد موقع المخرج**: فحص جذور الهدف/مجلدات ملف التعريف/أسماء المكتبات
5. **التثبيت**: نسخ + إعادة تسمية ذرية إلى `packages/natives/native`
6. **الاكتمال**: الإضافة جاهزة لمرشحي المُحمِّل

يحدث إنهاء بسبب الفشل في أي مرحلة مع نص خطأ صريح (متغير غير صالح، فشل بناء cargo، مكتبة مخرجات مفقودة، فشل التثبيت/إعادة التسمية).

### دورة حياة التضمين (`embed-native.ts`)

1. **التهيئة**: حساب وسم المنصة من `TARGET_PLATFORM`/`TARGET_ARCH` أو قيم المضيف
2. **مجموعة المرشحين**:
   - x64 يتوقع كلاً من `modern` و`baseline`
   - غير x64 يتوقع ملفًا افتراضيًا واحدًا
3. **التحقق من التوفر** في `packages/natives/native`
4. **توليد البيان** (`src/embedded-addon.ts`) مع استيرادات `file` من Bun وإصدار الحزمة
5. **جاهز للاستخراج في وقت التشغيل** للوضع المُجمَّع

`--reset` يتجاوز التحقق ويكتب بيانًا فارغًا (`embeddedAddon = null`).

## سير عمل التطوير مقابل السلوك المُشحون/المُجمَّع

## سير عمل التطوير المحلي

حلقة التطوير المحلية النموذجية:

1. بناء الإضافة:
   - إصدار: `bun --cwd=packages/natives run build`
   - ملف تعريف التصحيح: `bun --cwd=packages/natives run dev:native`
2. تعيين `PI_DEV=1` عند اختبار تشخيصات المُحمِّل
3. المُحمِّل في `native.ts` يحل مرشحي `native/` المحلية للحزمة (والاحتياطي لمجلد الملف التنفيذي)
4. `validateNative` يفرض توافق التصدير قبل أن تستخدم الأغلفة الربط

## سير عمل الملف الثنائي المُشحون/المُجمَّع

في الوضع المُجمَّع (`PI_COMPILED` أو علامات Bun المُضمَّنة):

1. يحسب المُحمِّل مجلد التخزين المؤقت المُعنون بالإصدار: `<getNativesDir()>/<packageVersion>` (عمليًا `~/.xcsh/natives/<version>`)
2. إذا تطابق بيان التضمين مع المنصة+الإصدار الحاليين، قد يستخرج المُحمِّل الملف المُضمَّن المُحدَّد إلى ذلك المجلد المُعنون بالإصدار
3. ترتيب مرشحي وقت التشغيل يشمل:
   - مجلد التخزين المؤقت المُعنون بالإصدار
   - مجلد الملفات الثنائية المُجمَّعة القديم (`%LOCALAPPDATA%/xcsh` على Windows، `~/.local/bin` في الأنظمة الأخرى)
   - مجلدات الحزمة/الملف التنفيذي
4. أول إضافة يتم تحميلها بنجاح لا تزال يجب أن تجتاز `validateNative`

هذا هو السبب في أن توقعات التعبئة + مُحمِّل وقت التشغيل يجب أن تتوافق: أسماء الملفات، وأوسمة المنصة، والرموز المُصدَّرة يجب أن تتطابق مع ما يفحصه ويتحقق منه `native.ts`.

## تعيين واجهة JS البرمجية ↔ تصدير Rust (مجموعة فرعية من بوابة التحقق)

يتطلب `native.ts` وجود هذه التصديرات المرئية من JS على الإضافة المُحمَّلة. وهي تتوافق مع تصديرات N-API في Rust في `crates/pi-natives/src`:

| اسم JS المطلوب بواسطة `validateNative` | إعلان التصدير في Rust | ملف مصدر Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (تصدير بنمط camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

إذا كان أي رمز مطلوب مفقودًا، يفشل المُحمِّل فورًا مع تلميح بإعادة البناء.

## سلوك الفشل والتشخيصات

## أخطاء وقت البناء

- تكوين متغير غير صالح:
  - `TARGET_VARIANT` مُعيَّن على معمارية غير x64 → خطأ فوري
  - بناء x64 متقاطع بدون `TARGET_VARIANT` صريح → خطأ فوري
- فشل بناء Cargo:
  - يعرض السكربت رمز الخروج غير الصفري ومخرجات stderr
- لم يتم العثور على المخرج:
  - يطبع السكربت كل مجلد ملف تعريف تم فحصه
- فشل التثبيت:
  - رسالة صريحة؛ على Windows يتضمن تلميحًا عن الملف المقفل

## أخطاء مُحمِّل وقت التشغيل (`native.ts`)

- وسم منصة غير مدعوم:
  - يطرح استثناءً مع قائمة المنصات المدعومة
- لم يتمكن أي مرشح من التحميل:
  - يطرح استثناءً مع قائمة أخطاء المرشحين الكاملة وتلميحات معالجة خاصة بالوضع
- تصديرات مفقودة:
  - يطرح استثناءً مع أسماء الرموز المفقودة بالضبط وأمر إعادة البناء
- مشاكل استخراج التضمين:
  - أخطاء mkdir/write أثناء الاستخراج يتم تسجيلها وإدراجها في التشخيصات النهائية

## مصفوفة استكشاف الأخطاء وإصلاحها

| العَرَض | السبب المحتمل | التحقق | الإصلاح |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ملف `.node` ثنائي قديم، عدم تطابق اسم تصدير Rust، أو تحميل ملف ثنائي خاطئ | شغِّل مع `PI_DEV=1` لرؤية المسار المُحمَّل؛ افحص قائمة التصديرات لذلك الملف | أعد بناء `build`؛ تأكد من أن اسم تصدير `#[napi]` في Rust (أو الاسم البديل الصريح عند الحاجة) يتطابق مع مفتاح JS؛ احذف الملفات المُخزَّنة مؤقتًا/المُعنونة بالإصدار القديمة |
| جهاز x64 يُحمِّل baseline بينما المتوقع modern | `PI_NATIVE_VARIANT=baseline`، أو لم يتم اكتشاف AVX2، أو وجود ملف baseline فقط | تحقق من `PI_NATIVE_VARIANT`؛ افحص `native/` للبحث عن ملف `-modern` | ابنِ المتغير modern (`TARGET_VARIANT=modern ... build`) وتأكد من شحن الملف |
| البناء المتقاطع ينتج ملفًا ثنائيًا غير قابل للاستخدام/بتسمية خاطئة | عدم تطابق بين `CROSS_TARGET` و`TARGET_PLATFORM`/`TARGET_ARCH`، أو `TARGET_VARIANT` مفقود لـ x64 | تأكد من توافق متغيرات البيئة واسم ملف المخرجات | أعد التشغيل بقيم بيئة متسقة و`TARGET_VARIANT` صريح لـ x64 |
| الملف الثنائي المُجمَّع يفشل بعد الترقية | تخزين مؤقت مُستخرَج قديم (`~/.xcsh/natives/<old-or-mismatched-version>`) أو عدم تطابق بيان التضمين | افحص مجلد الإضافات الأصلية المُعنون بالإصدار وقائمة أخطاء المُحمِّل | احذف تخزين الإضافات الأصلية المؤقت لإصدار الحزمة وأعد التشغيل؛ أعد توليد بيان التضمين أثناء التعبئة |
| المُحمِّل يفحص عدة مسارات ولا يعمل أي منها | عدم تطابق المنصة أو مخرج إصدار مفقود في `native/` بالحزمة | تحقق من `platformTag` مقابل اسم/أسماء الملفات الفعلية | تأكد من أن اسم الملف المبني يتطابق تمامًا مع اصطلاح `pi_natives.<platform>-<arch>(-variant).node` وأن الحزمة تتضمن `native/` |
| `embed:native` يفشل مع "Incomplete native addons" | ملفات المتغيرات المطلوبة لم تُبنَ قبل التضمين | تحقق من القائمة المتوقعة مقابل الموجودة في نص الخطأ | ابنِ الملفات المطلوبة أولاً (x64: كلاً من modern+baseline؛ غير x64: الافتراضي)، ثم أعد تشغيل `embed:native` |

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
