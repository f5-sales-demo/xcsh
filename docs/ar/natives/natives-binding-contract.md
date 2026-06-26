---
title: عقد الربط الأصلي (جانب TypeScript)
description: عقد الربط من جانب TypeScript لاستدعاء دوال Rust الأصلية عبر N-API.
sidebar:
  order: 2
  label: عقد الربط
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# عقد الربط الأصلي (جانب TypeScript)

يُحدّد هذا المستند العقد من جانب TypeScript الذي يقع بين مستدعي `@f5-sales-demo/pi-natives` والإضافة N-API المحمّلة.

يركّز على ثلاثة عناصر:

1. شكل العقد (`NativeBindings` + توسيع الوحدة)،
2. سلوك الغلاف (`src/<module>/index.ts`)،
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
- `Cancellable` (`timeoutMs?: number`، `signal?: AbortSignal`)
- شكل ردّ الاتصال `TsFunc<T>` المستخدم من قِبَل ردود الاتصال الآمنة للخيوط في N-API

تُضيف كل وحدة حقولها الخاصة عن طريق دمج التصريحات:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

يُبقي هذا على واجهة ربط مجمّعة واحدة دون الحاجة إلى ملف نوع مركزي ضخم.

## دورة حياة دمج التصريحات وانتقالات الحالة

### 1) تجميع النوع في وقت الترجمة

- يوفّر `bindings.ts` الرمز الأساسي `NativeBindings`.
- يُوسّع كل `src/<module>/types.ts` واجهة `NativeBindings`.
- يستورد `src/native.ts` جميع ملفات `./<module>/types` كتأثيرات جانبية لضمان وجود العقد المدموج في النطاق حيث يُستخدم `NativeBindings`.

انتقال الحالة: **العقد الأساسي** → **العقد المدموج**.

### 2) تحميل الإضافة في وقت التشغيل وبوابة التحقق

- يُحمّل `src/native.ts` الملفات الثنائية المرشّحة ذات الامتداد `.node`.
- يُعامَل الكائن المحمّل على أنه `NativeBindings` ويُمرَّر فورًا عبر `validateNative(...)`.
- يتحقق `validateNative` من مفاتيح التصدير المطلوبة عبر `typeof bindings[name] === "function"`.

انتقال الحالة: **كائن الإضافة غير الموثوق** → **كائن الربط الأصلي المُتحقَّق منه** (أو فشل غير قابل للاسترداد).

### 3) استدعاء الغلاف

- تستدعي أغلفة الوحدات في `src/<module>/index.ts` الـ `native.<export>`.
- تُكيّف الأغلفة القيم الافتراضية وشكل ردّ الاتصال (من نمط `(err, value)` إلى أنماط رد الاتصال التي تعتمد على القيمة فقط في واجهات برمجة JS).
- يُعيد تصدير `src/index.ts` أغلفة الوحدات وأنواعها كواجهة برمجة تطبيقات عامة للحزمة.

انتقال الحالة: **روابط خام مُتحقَّق منها** → **واجهة برمجة تطبيقات عامة سهلة الاستخدام**.

## مسؤوليات الغلاف

الأغلفة رفيعة بصورة مقصودة؛ إذ لا تُعيد تنفيذ المنطق الأصلي.

المسؤوليات الأساسية:

- **تطبيع الحجج وتعيين قيمها الافتراضية**
  - يحلّ `glob()` `options.path` إلى مسار مطلق ويضع قيمًا افتراضية لـ `hidden` و`gitignore` و`recursive`.
  - يملأ `hasMatch()` الأعلام الافتراضية (`ignoreCase`، `multiline`) قبل استدعاء الدالة الأصلية.
- **تكييف ردّ الاتصال**
  - تحوّل `grep()` و`glob()` و`executeShell()` الـ `TsFunc<T>` (`error, value`) إلى رد اتصال المستخدم الذي يستقبل القيم الناجحة فقط.
- **سلوك البيئة أو السياسة حول الاستدعاءات الأصلية**
  - يُضيف غلاف الحافظة معالجة OSC52/Termux/بدون واجهة رسومية، ويتعامل مع النسخ على أنه بذل أفضل جهد.
- **التسمية العامة وتنسيق إعادة التصدير**
  - تُعيّن `searchContent()` تعيينًا إلى التصدير الأصلي `search`.

## تنظيم سطح التصدير العام

`packages/natives/src/index.ts` هو البرميل العام الرئيسي. يُجمّع الصادرات حسب نطاق القدرة:

- البحث/النص: `grep`، `glob`، `text`، `highlight`
- التنفيذ/العملية/الطرفية: `shell`، `pty`، `ps`، `keys`
- النظام/الوسائط/التحويل: `image`، `html`، `clipboard`، `system-info`، `work`

قاعدة للمشرفين: إذا لم يُعَد تصدير غلاف ما من `src/index.ts`، فهو ليس جزءًا من سطح الحزمة العام المقصود.

## تعيين واجهة برمجة JS ↔ تصدير أصلي (تمثيلي)

تستخدم جانب Rust أسماء تصدير N-API (مشتقة عادةً من تحويل `#[napi]` من snake_case إلى camelCase، مع أسماء مستعارة صريحة أحيانًا) يجب أن تتطابق مع مفاتيح الربط هذه.

| الفئة | واجهة برمجة JS العامة (الغلاف) | مفتاح الربط الأصلي | نوع الإرجاع | غير متزامن؟ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | نعم |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | لا |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | لا |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | نعم |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | نعم |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | لا |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | نعم |
| Shell | `Shell` | `Shell` | مُنشئ الفئة | غير مُنطبق |
| PTY | `PtySession` | `PtySession` | مُنشئ الفئة | غير مُنطبق |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | لا |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | لا |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | لا |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | لا |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | نعم |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | لا |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | لا |
| Process | `killTree(pid, signal)` | `killTree` | `number` | لا |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | لا |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (سلوك الغلاف ببذل أفضل جهد) | نعم |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | نعم |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | لا |

## الفروقات بين عقود المزامنة وغير المزامنة

يمزج العقد بين واجهات برمجة التطبيقات المتزامنة وغير المتزامنة؛ وتُبقي الأغلفة على أسلوب الاستدعاء الأصلي بدلًا من فرض نموذج واحد:

- **صادرات غير متزامنة قائمة على الوعود** للعمليات التي تتضمن إدخالًا/إخراجًا أو مهامًا طويلة الأمد (`grep`، `glob`، `htmlToMarkdown`، `executeShell`، الحافظة، عمليات الصور).
- **صادرات متزامنة** للتحويلات/المحلّلات الحتمية في الذاكرة (`search`، `hasMatch`، التمييز البرمجي، عرض النص/التقطيع، تحليل المفاتيح، استعلامات العمليات).
- **صادرات المُنشئ** للكائنات التشغيلية ذات الحالة (`Shell`، `PtySession`، `PhotonImage`).

انعكاس على المشرفين: تغيير نمط تصدير قائم من متزامن إلى غير متزامن أو العكس يُعدّ تغييرًا كسرًا في العقد والواجهة البرمجية عبر الأغلفة والمستدعين.

## أنماط كتابة الكائنات والتعدادات

### أنماط الكائنات (كائنات JS بنمط `#[napi(object)]`)

يُمثّل TypeScript القيم الأصلية ذات شكل الكائن كواجهات، على سبيل المثال:

- `GrepResult`، `SearchResult`، `GlobResult`
- `SystemInfo`، `WorkProfile`
- `ClipboardImage`، `ParsedKittyResult`

هذه عقود هيكلية في وقت الترجمة؛ وصحة الشكل في وقت التشغيل تقع على عاتق التنفيذ الأصلي.

### أنماط التعدادات

تُمثَّل التعدادات الرقمية الأصلية كقيم `const enum` في TypeScript:

- `FileType` (`1=file`، `2=dir`، `3=symlink`)
- `ImageFormat` (`0=PNG`، `1=JPEG`، `2=WEBP`، `3=GIF`)
- `SamplingFilter`، `Ellipsis`، `KeyEventType`

يرى المستدعون أعضاء التعداد بأسمائها؛ بينما يمرّر حدّ الربط أرقامًا.

## كيفية اكتشاف عدم التطابق

يحدث اكتشاف عدم التطابق على طبقتين:

1. **فحوصات عقد TypeScript في وقت الترجمة**
   - تستدعي الأغلفة `native.<name>` مقابل `NativeBindings` المدموجة.
   - تؤدي مفاتيح الربط المفقودة أو المُعاد تسميتها إلى كسر فحص النوع في TypeScript داخل الأغلفة.

2. **التحقق في وقت التشغيل في `validateNative`**
   - بعد التحميل، يتحقق `native.ts` من الصادرات المطلوبة ويرمي استثناءً إن كان أيٌّ منها مفقودًا.
   - تتضمن رسالة الخطأ المفاتيح المفقودة وتعليمات إعادة البناء.

يُمكّن هذا من اكتشاف انحراف الثنائي القديم الشائع: يوجد الغلاف/النوع لكن ملف `.node` المحمّل لا يحتوي على التصدير.

## سلوك الفشل والتحفظات

### فشل التحميل/التحقق (فشل غير قابل للاسترداد)

- يُرمى استثناء عند فشل تحميل الإضافة أو عدم دعم المنصة أثناء تهيئة الوحدة في `native.ts`.
- يُرمى استثناء عند وجود صادرات مطلوبة مفقودة قبل أن تصبح الأغلفة قابلة للاستخدام.

الأثر: تفشل الحزمة بسرعة بدلًا من تأجيل الفشل إلى الاستدعاء الأول.

### فروقات السلوك على مستوى الغلاف

- تُليّن بعض الأغلفة الفشل عن قصد (`copyToClipboard` تبذل أفضل جهد وتتجاهل فشل الاستدعاء الأصلي).
- تتجاهل ردود الاتصال للبث حمولات خطأ ردّ الاتصال وتُعيد توجيه أحداث القيمة الناجحة فقط.

### تحفظات على مستوى النوع (وقت التشغيل أشدّ دقةً من TypeScript)

- الحقول الاختيارية في TypeScript لا تضمن الصحة الدلالية؛ إذ يمكن للطبقة الأصلية رفض القيم المشوّهة.
- كتابة `const enum` لا تمنع القيم الرقمية خارج النطاق من المستدعين غير المكتوبين في وقت التشغيل.
- يتحقق `validateNative` من وجود الصادرات المطلوبة وكونها دالة فحسب، وليس من توافق شكل الحجج/القيمة المُرجعة بعمق.
- يتضمن `bindings.ts` `cancelWork(id)` في الواجهة الأساسية، لكن قائمة التحقق في وقت التشغيل الحالية لا تُطبّق هذا المفتاح.

## قائمة فحص المشرف لتغييرات الربط

عند إضافة تصدير أو تغييره، قم بتحديث جميع ما يلي:

1. `src/<module>/types.ts` (التوسيع + أنواع العقد)
2. `src/<module>/index.ts` (سلوك الغلاف)
3. استيرادات `src/native.ts` لأنواع الوحدة (في حال إنشاء وحدة جديدة)
4. فحوصات التصدير المطلوبة في `validateNative`
5. إعادة التصديرات العامة في `src/index.ts`

إغفال أيّ خطوة يُفضي إلى انحراف في وقت الترجمة أو فشل في وقت تحميل وقت التشغيل.
