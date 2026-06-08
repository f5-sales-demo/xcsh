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

# عقد ربط الوظائف الأصلية (جانب TypeScript)

يُحدد هذا المستند عقد جانب TypeScript الذي يقع بين مستدعيي `@f5xc-salesdemos/pi-natives` وإضافة N-API المُحمّلة.

يركز على ثلاثة أجزاء:

1. شكل العقد (`NativeBindings` + تعزيز الوحدة)،
2. سلوك المُغلّف (`src/<module>/index.ts`)،
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

يُحدد `packages/natives/src/bindings.ts` العقد الأساسي:

- `NativeBindings` (واجهة أساسية، تتضمن حالياً `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`، `signal?: AbortSignal`)
- `TsFunc<T>` شكل دالة الاستدعاء المُستخدم من قبل استدعاءات N-API الآمنة للخيوط

تُضيف كل وحدة حقولها الخاصة عبر دمج الإعلانات:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

يُبقي هذا على واجهة ربط مُجمّعة واحدة دون ملف أنواع مركزي ضخم.

## دورة حياة دمج الإعلانات وانتقالات الحالة

### 1) تجميع الأنواع في وقت الترجمة

- يوفر `bindings.ts` رمز `NativeBindings` الأساسي.
- يُعزز كل ملف `src/<module>/types.ts` واجهة `NativeBindings`.
- يستورد `src/native.ts` جميع ملفات `./<module>/types` للتأثيرات الجانبية بحيث يكون العقد المدمج في النطاق حيث يُستخدم `NativeBindings`.

انتقال الحالة: **العقد الأساسي** → **العقد المدمج**.

### 2) تحميل الإضافة في وقت التشغيل وبوابة التحقق

- يُحمّل `src/native.ts` ملفات `.node` الثنائية المرشحة.
- يُعامل الكائن المُحمّل كـ `NativeBindings` ويُمرر فوراً عبر `validateNative(...)`.
- يتحقق `validateNative` من مفاتيح التصدير المطلوبة عبر `typeof bindings[name] === "function"`.

انتقال الحالة: **كائن إضافة غير موثوق** → **كائن ربط أصلي مُتحقق منه** (أو فشل قاطع).

### 3) استدعاء المُغلّف

- تستدعي مُغلّفات الوحدات في `src/<module>/index.ts` الدالة `native.<export>`.
- تُكيّف المُغلّفات القيم الافتراضية وشكل الاستدعاء (من `(err, value)` إلى أنماط استدعاء القيمة فقط في واجهات JS).
- يُعيد `src/index.ts` تصدير مُغلّفات/أنواع الوحدات كواجهة الحزمة العامة.

انتقال الحالة: **روابط خام مُتحقق منها** → **واجهة عامة مريحة الاستخدام**.

## مسؤوليات المُغلّف

المُغلّفات رقيقة عمداً؛ فهي لا تُعيد تنفيذ المنطق الأصلي.

المسؤوليات الأساسية:

- **تطبيع/تعيين القيم الافتراضية للوسائط**
  - تُحوّل `glob()` المسار `options.path` إلى مسار مطلق وتُعيّن القيم الافتراضية لـ `hidden` و `gitignore` و `recursive`.
  - تملأ `hasMatch()` الأعلام الافتراضية (`ignoreCase`، `multiline`) قبل الاستدعاء الأصلي.
- **تكييف الاستدعاءات**
  - تُحوّل `grep()` و `glob()` و `executeShell()` دالة `TsFunc<T>` (`error, value`) إلى استدعاء المستخدم الذي يستقبل القيم الناجحة فقط.
- **سلوك البيئة أو السياسة حول الاستدعاءات الأصلية**
  - يُضيف مُغلّف الحافظة معالجة OSC52/Termux/وضع بدون واجهة ويُعامل النسخ كأفضل جهد.
- **التسمية العامة وتنسيق إعادة التصدير**
  - تُعيّن `searchContent()` إلى التصدير الأصلي `search`.

## تنظيم سطح التصدير العام

يُعد `packages/natives/src/index.ts` ملف التجميع العام المرجعي. يُجمّع التصديرات حسب مجال القدرة:

- البحث/النص: `grep`، `glob`، `text`، `highlight`
- التنفيذ/العمليات/الطرفية: `shell`، `pty`، `ps`، `keys`
- النظام/الوسائط/التحويل: `image`، `html`، `clipboard`، `system-info`، `work`

قاعدة للمشرفين: إذا لم يُعاد تصدير مُغلّف من `src/index.ts`، فهو ليس جزءاً من سطح الحزمة العام المقصود.

## تعيين واجهة JS ↔ التصدير الأصلي (تمثيلي)

يستخدم جانب Rust أسماء تصدير N-API (عادةً من تحويل `#[napi]` من snake_case إلى camelCase، مع أسماء بديلة صريحة أحياناً) التي يجب أن تتطابق مع مفاتيح الربط هذه.

| الفئة | واجهة JS العامة (المُغلّف) | مفتاح الربط الأصلي | نوع الإرجاع | غير متزامن؟ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | نعم |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | لا |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | لا |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | نعم |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | نعم |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | لا |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | نعم |
| Shell | `Shell` | `Shell` | مُنشئ صنف | غ/م |
| PTY | `PtySession` | `PtySession` | مُنشئ صنف | غ/م |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | لا |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | لا |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | لا |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | لا |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | نعم |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | لا |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | لا |
| Process | `killTree(pid, signal)` | `killTree` | `number` | لا |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | لا |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (سلوك مُغلّف بأفضل جهد) | نعم |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | نعم |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | لا |

## الاختلافات بين العقد المتزامن وغير المتزامن

يمزج العقد بين واجهات متزامنة وغير متزامنة؛ تحافظ المُغلّفات على أسلوب الاستدعاء الأصلي بدلاً من فرض نموذج واحد:

- **تصديرات غير متزامنة قائمة على Promise** لعمليات الإدخال/الإخراج أو العمل طويل الأمد (`grep`، `glob`، `htmlToMarkdown`، `executeShell`، الحافظة، عمليات الصور).
- **تصديرات متزامنة** للتحويلات/المحللات الحتمية في الذاكرة (`search`، `hasMatch`، التمييز، عرض/تقطيع النص، تحليل المفاتيح، استعلامات العمليات).
- **تصديرات مُنشئات** لكائنات وقت التشغيل ذات الحالة (`Shell`، `PtySession`، `PhotonImage`).

دلالة للمشرفين: تغيير متزامن ↔ غير متزامن لتصدير موجود يُعد تغييراً كاسراً للواجهة والعقد عبر المُغلّفات والمستدعين.

## أنماط تنميط الكائنات والتعدادات

### أنماط الكائنات (كائنات JS بأسلوب `#[napi(object)]`)

تُنمذج TypeScript القيم الأصلية بشكل كائنات كواجهات، على سبيل المثال:

- `GrepResult`، `SearchResult`، `GlobResult`
- `SystemInfo`، `WorkProfile`
- `ClipboardImage`، `ParsedKittyResult`

هذه عقود هيكلية في وقت الترجمة؛ صحة الشكل في وقت التشغيل مسؤولية التنفيذ الأصلي.

### أنماط التعدادات

تُمثّل التعدادات الأصلية الرقمية كقيم `const enum` في TypeScript:

- `FileType` (`1=file`، `2=dir`، `3=symlink`)
- `ImageFormat` (`0=PNG`، `1=JPEG`، `2=WEBP`، `3=GIF`)
- `SamplingFilter`، `Ellipsis`، `KeyEventType`

يرى المستدعون أعضاء التعداد المسماة؛ تمرر حدود الربط أرقاماً.

## كيف يتم اكتشاف حالات عدم التطابق

يحدث اكتشاف عدم التطابق على طبقتين:

1. **فحوصات عقد TypeScript في وقت الترجمة**
   - تستدعي المُغلّفات `native.<name>` مقابل `NativeBindings` المدمج.
   - مفاتيح الربط المفقودة/المُعاد تسميتها تكسر فحص أنواع TypeScript في المُغلّفات.

2. **التحقق في وقت التشغيل في `validateNative`**
   - بعد التحميل، يفحص `native.ts` التصديرات المطلوبة ويطرح استثناءً إذا كان أي منها مفقوداً.
   - تتضمن رسالة الخطأ المفاتيح المفقودة وتعليمات إعادة البناء.

يكتشف هذا الانحراف الشائع للملف الثنائي القديم: المُغلّف/النوع موجود لكن ملف `.node` المُحمّل يفتقر إلى التصدير.

## سلوك الفشل والتحفظات

### فشل التحميل/التحقق (فشل قاطع)

- فشل تحميل الإضافة أو المنصة غير المدعومة يطرح استثناءً أثناء تهيئة الوحدة في `native.ts`.
- التصديرات المطلوبة المفقودة تطرح استثناءً قبل أن تكون المُغلّفات قابلة للاستخدام.

التأثير: تفشل الحزمة مبكراً بدلاً من تأجيل الفشل إلى الاستدعاء الأول.

### اختلافات السلوك على مستوى المُغلّف

- بعض المُغلّفات تُخفف الأخطاء عمداً (`copyToClipboard` يعمل بأفضل جهد ويبتلع الفشل الأصلي).
- استدعاءات البث تتجاهل حمولات أخطاء الاستدعاء وتُمرر فقط أحداث القيم الناجحة.

### تحفظات على مستوى الأنواع (وقت التشغيل أكثر صرامة من TypeScript)

- الحقول الاختيارية في TypeScript لا تضمن الصلاحية الدلالية؛ يمكن للطبقة الأصلية رفض القيم غير الصحيحة.
- تنميط `const enum` لا يمنع القيم الرقمية خارج النطاق من المستدعين غير المُنمّطين في وقت التشغيل.
- يفحص `validateNative` فقط وجود التصديرات المطلوبة وكونها دوال، وليس التوافق العميق لشكل الوسائط/الإرجاع.
- يتضمن `bindings.ts` دالة `cancelWork(id)` في الواجهة الأساسية، لكن قائمة التحقق الحالية في وقت التشغيل لا تفرض هذا المفتاح.

## قائمة مراجعة المشرف لتغييرات الربط

عند إضافة/تغيير تصدير، حدّث جميع ما يلي:

1. `src/<module>/types.ts` (التعزيز + أنواع العقد)
2. `src/<module>/index.ts` (سلوك المُغلّف)
3. استيرادات `src/native.ts` لأنواع الوحدة (إذا كانت وحدة جديدة)
4. فحوصات التصدير المطلوبة في `validateNative`
5. إعادة التصدير العامة في `src/index.ts`

تخطي أي خطوة يُنشئ إما انحرافاً في وقت الترجمة أو فشلاً في وقت التحميل أثناء التشغيل.
