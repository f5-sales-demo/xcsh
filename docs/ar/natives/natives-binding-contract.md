---
title: Natives Binding Contract (TypeScript Side)
description: >-
  TypeScript-side binding contract for calling into Rust native functions via
  N-API.
sidebar:
  order: 2
  label: عقد الربط
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# عقد ربط الوحدات الأصلية (جانب TypeScript)

يُعرّف هذا المستند عقد جانب TypeScript الذي يقع بين مُستدعي `@f5xc-salesdemos/pi-natives` وإضافة N-API المحمّلة.

يركز على ثلاثة أجزاء:

1. شكل العقد (`NativeBindings` + توسيع الوحدة),
2. سلوك المُغلّف (`src/<module>/index.ts`),
3. سطح التصدير العام (`src/index.ts`).

## ملفات التنفيذ

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## نموذج العقد

يُعرّف `packages/natives/src/bindings.ts` العقد الأساسي:

- `NativeBindings` (الواجهة الأساسية، تتضمن حاليًا `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` شكل دالة الاستدعاء الراجع المُستخدم بواسطة استدعاءات N-API الآمنة للخيوط

تُضيف كل وحدة حقولها الخاصة عبر دمج التصريحات:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

يحافظ هذا على واجهة ربط مُجمّعة واحدة دون ملف أنواع مركزي ضخم.

## دورة حياة دمج التصريحات وانتقالات الحالة

### 1) تجميع الأنواع في وقت الترجمة

- يوفر `bindings.ts` رمز `NativeBindings` الأساسي.
- يُوسّع كل ملف `src/<module>/types.ts` واجهة `NativeBindings`.
- يستورد `src/native.ts` جميع ملفات `./<module>/types` للتأثيرات الجانبية بحيث يكون العقد المُدمج في النطاق حيث يُستخدم `NativeBindings`.

انتقال الحالة: **العقد الأساسي** → **العقد المُدمج**.

### 2) تحميل الإضافة في وقت التشغيل وبوابة التحقق

- يُحمّل `src/native.ts` ملفات `.node` الثنائية المُرشّحة.
- يُعامَل الكائن المُحمّل كـ `NativeBindings` ويُمرّر فورًا عبر `validateNative(...)`.
- يتحقق `validateNative` من مفاتيح التصدير المطلوبة عبر `typeof bindings[name] === "function"`.

انتقال الحالة: **كائن إضافة غير موثوق** → **كائن ربط أصلي مُتحقق منه** (أو فشل حاد).

### 3) استدعاء المُغلّف

- تستدعي مُغلّفات الوحدات في `src/<module>/index.ts` الدالة `native.<export>`.
- تُكيّف المُغلّفات القيم الافتراضية وشكل الاستدعاء الراجع (`(err, value)` إلى أنماط استدعاء القيمة فقط في واجهات JS البرمجية).
- يُعيد `src/index.ts` تصدير مُغلّفات/أنواع الوحدات كواجهة الحزمة العامة.

انتقال الحالة: **ربط خام مُتحقق منه** → **واجهة برمجية عامة مريحة**.

## مسؤوليات المُغلّف

المُغلّفات رقيقة عمدًا؛ فهي لا تُعيد تنفيذ المنطق الأصلي.

المسؤوليات الرئيسية:

- **تطبيع/تعيين القيم الافتراضية للمعاملات**
  - `glob()` يحلّ `options.path` إلى مسار مطلق ويُعيّن القيم الافتراضية لـ `hidden` و`gitignore` و`recursive`.
  - `hasMatch()` يملأ الأعلام الافتراضية (`ignoreCase`, `multiline`) قبل الاستدعاء الأصلي.
- **تكييف الاستدعاء الراجع**
  - `grep()` و`glob()` و`executeShell()` تُحوّل `TsFunc<T>` (`error, value`) إلى استدعاء راجع للمستخدم يستقبل القيم الناجحة فقط.
- **سلوك البيئة أو السياسة حول الاستدعاءات الأصلية**
  - يُضيف مُغلّف الحافظة معالجة OSC52/Termux/بدون واجهة رسومية ويُعامل النسخ كأفضل جهد.
- **التسمية العامة وتنظيم إعادة التصدير**
  - `searchContent()` يُرتبط بالتصدير الأصلي `search`.

## تنظيم سطح التصدير العام

`packages/natives/src/index.ts` هو ملف التجميع العام المرجعي. يُجمّع التصديرات حسب مجال القدرة:

- البحث/النص: `grep`, `glob`, `text`, `highlight`
- التنفيذ/العمليات/الطرفية: `shell`, `pty`, `ps`, `keys`
- النظام/الوسائط/التحويل: `image`, `html`, `clipboard`, `system-info`, `work`

قاعدة المُشرف: إذا لم يُعاد تصدير مُغلّف من `src/index.ts`، فهو ليس جزءًا من سطح الحزمة العامة المقصود.

## تعيين واجهة JS البرمجية ↔ التصدير الأصلي (تمثيلي)

يستخدم جانب Rust أسماء تصدير N-API (عادةً من تحويل `#[napi]` snake_case -> camelCase، مع أسماء بديلة صريحة أحيانًا) التي يجب أن تتطابق مع مفاتيح الربط هذه.

| الفئة | واجهة JS العامة (المُغلّف) | مفتاح الربط الأصلي | نوع الإرجاع | غير متزامن؟ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | نعم |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | لا |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | لا |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | نعم |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | نعم |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | لا |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | نعم |
| Shell | `Shell` | `Shell` | مُنشئ الفئة | غ/م |
| PTY | `PtySession` | `PtySession` | مُنشئ الفئة | غ/م |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | لا |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | لا |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | لا |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | لا |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | نعم |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | لا |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | لا |
| Process | `killTree(pid, signal)` | `killTree` | `number` | لا |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | لا |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (سلوك مُغلّف أفضل جهد) | نعم |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | نعم |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | لا |

## الفروق بين العقد المتزامن وغير المتزامن

يمزج العقد بين واجهات برمجية متزامنة وغير متزامنة؛ تحافظ المُغلّفات على أسلوب الاستدعاء الأصلي بدلاً من فرض نموذج واحد:

- **تصديرات غير متزامنة قائمة على Promise** لعمليات الإدخال/الإخراج أو العمل طويل الأمد (`grep`, `glob`, `htmlToMarkdown`, `executeShell`، الحافظة، عمليات الصور).
- **تصديرات متزامنة** للتحويلات/المُحللات الحتمية في الذاكرة (`search`, `hasMatch`، التمييز، عرض/تقطيع النص، تحليل المفاتيح، استعلامات العمليات).
- **تصديرات المُنشئات** للكائنات ذات الحالة في وقت التشغيل (`Shell`, `PtySession`, `PhotonImage`).

تأثير على المُشرفين: تغيير متزامن ↔ غير متزامن لتصدير موجود هو تغيير كاسر للواجهة البرمجية والعقد عبر المُغلّفات والمُستدعين.

## أنماط تنميط الكائنات والتعدادات

### أنماط الكائنات (كائنات JS بأسلوب `#[napi(object)]`)

تُنمذج TypeScript القيم الأصلية على شكل كائنات كواجهات، على سبيل المثال:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

هذه عقود هيكلية في وقت الترجمة؛ صحة الشكل في وقت التشغيل مسؤولية التنفيذ الأصلي.

### أنماط التعدادات

تُمثَّل التعدادات الرقمية الأصلية كقيم `const enum` في TypeScript:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

يرى المُستدعون أعضاء التعداد المُسمّاة؛ تمرّ حدود الربط أرقامًا.

## كيف يتم اكتشاف عدم التطابق

يحدث اكتشاف عدم التطابق على طبقتين:

1. **فحوصات عقد TypeScript في وقت الترجمة**
   - تستدعي المُغلّفات `native.<name>` مقابل `NativeBindings` المُدمجة.
   - مفاتيح الربط المفقودة/المُعاد تسميتها تكسر فحص أنواع TypeScript في المُغلّفات.

2. **التحقق في وقت التشغيل في `validateNative`**
   - بعد التحميل، يتحقق `native.ts` من التصديرات المطلوبة ويرمي خطأً إذا كانت أي منها مفقودة.
   - تتضمن رسالة الخطأ المفاتيح المفقودة وتعليمات إعادة البناء.

يكتشف هذا الانحراف الشائع للملف الثنائي القديم: المُغلّف/النوع موجود لكن ملف `.node` المُحمّل يفتقر إلى التصدير.

## سلوك الفشل والتحذيرات

### فشل التحميل/التحقق (فشل حاد)

- فشل تحميل الإضافة أو النظام الأساسي غير المدعوم يرمي خطأً أثناء تهيئة الوحدة في `native.ts`.
- التصديرات المطلوبة المفقودة ترمي خطأً قبل أن تكون المُغلّفات قابلة للاستخدام.

التأثير: تفشل الحزمة بسرعة بدلاً من تأجيل الفشل إلى أول استدعاء.

### اختلافات سلوك مستوى المُغلّف

- بعض المُغلّفات تُخفف الفشل عمدًا (`copyToClipboard` أفضل جهد ويبتلع فشل الاستدعاء الأصلي).
- استدعاءات البث الراجعة تتجاهل حمولات خطأ الاستدعاء الراجع وتُمرّر فقط أحداث القيم الناجحة.

### تحذيرات مستوى الأنواع (وقت التشغيل أكثر صرامة من TypeScript)

- الحقول الاختيارية في TypeScript لا تضمن الصحة الدلالية؛ الطبقة الأصلية يمكنها رفض القيم المشوّهة.
- تنميط `const enum` لا يمنع القيم الرقمية خارج النطاق من المُستدعين غير المُنمّطين في وقت التشغيل.
- `validateNative` يتحقق فقط من وجود التصديرات المطلوبة وكونها دوال، وليس من توافق شكل المعاملات/الإرجاع بعمق.
- `bindings.ts` يتضمن `cancelWork(id)` في الواجهة الأساسية، لكن قائمة التحقق الحالية في وقت التشغيل لا تفرض هذا المفتاح.

## قائمة مراجعة المُشرف لتغييرات الربط

عند إضافة/تغيير تصدير، حدّث جميع ما يلي:

1. `src/<module>/types.ts` (التوسيع + أنواع العقد)
2. `src/<module>/index.ts` (سلوك المُغلّف)
3. استيرادات `src/native.ts` لأنواع الوحدة (إذا كانت وحدة جديدة)
4. فحوصات التصدير المطلوبة في `validateNative`
5. إعادة التصدير العامة في `src/index.ts`

تخطي أي خطوة يُنشئ إما انحرافًا في وقت الترجمة أو فشلًا في وقت التحميل.
