---
title: عقد الربط الأصلي (الجانب TypeScript)
description: عقد الربط من جانب TypeScript لاستدعاء الدوال الأصلية في Rust عبر N-API.
sidebar:
  order: 2
  label: عقد الربط
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# عقد الربط الأصلي (الجانب TypeScript)

يُعرِّف هذا المستند عقد الربط من جانب TypeScript الذي يقع بين مستدعي `@f5xc-salesdemos/pi-natives` والإضافة N-API المحمَّلة.

يركز على ثلاثة محاور:

1. شكل العقد (`NativeBindings` + توسيع الوحدة)،
2. سلوك الغلاف (`src/<module>/index.ts`)،
3. واجهة التصدير العامة (`src/index.ts`).

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

يُعرِّف `packages/natives/src/bindings.ts` العقد الأساسي:

- `NativeBindings` (الواجهة الأساسية، وتتضمن حاليًا `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`، `signal?: AbortSignal`)
- شكل رد النداء `TsFunc<T>` المستخدَم بواسطة ردود النداء الآمنة للخيوط في N-API

تُضيف كل وحدة حقولها الخاصة عبر دمج التصريحات:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

يُبقي ذلك على واجهة ربط مجمَّعة واحدة دون ملف نوع مركزي ضخم.

## دورة حياة دمج التصريحات وانتقالات الحالة

### 1) تجميع الأنواع في وقت الترجمة

- يوفر `bindings.ts` الرمز الأساسي `NativeBindings`.
- يُوسِّع كل ملف `src/<module>/types.ts` واجهة `NativeBindings`.
- يستورد `src/native.ts` جميع ملفات `./<module>/types` للتأثيرات الجانبية كي يكون العقد المدموج في النطاق حيث تُستخدَم `NativeBindings`.

انتقال الحالة: **العقد الأساسي** → **العقد المدموج**.

### 2) تحميل الإضافة في وقت التشغيل وبوابة التحقق

- يُحمِّل `src/native.ts` الثنائيات المرشحة ذات الامتداد `.node`.
- يُعامَل الكائن المحمَّل باعتباره `NativeBindings` ويُمرَّر فورًا عبر `validateNative(...)`.
- يتحقق `validateNative` من مفاتيح التصدير المطلوبة بواسطة `typeof bindings[name] === "function"`.

انتقال الحالة: **كائن الإضافة غير الموثوق** → **كائن الربط الأصلي المتحقق منه** (أو إخفاق قاطع).

### 3) استدعاء الغلاف

- تستدعي أغلفة الوحدة في `src/<module>/index.ts` الدالة `native.<export>`.
- تُكيِّف الأغلفة القيم الافتراضية وشكل رد النداء (من نمط `(err, value)` إلى أنماط ردود النداء التي تُعيد القيمة فقط في واجهات برمجة JS).
- يُعيد تصدير `src/index.ts` أغلفة الوحدات وأنواعها بوصفها واجهة برمجة الحزمة العامة.

انتقال الحالة: **الربطات الخام المتحقق منها** → **واجهة برمجة عامة مريحة**.

## مسؤوليات الغلاف

صُمِّمت الأغلفة لتكون رفيعة عن قصد؛ فهي لا تُعيد تنفيذ المنطق الأصلي.

المسؤوليات الأساسية:

- **تطبيع الوسيطات وتعيين القيم الافتراضية**
  - تُحوِّل `glob()` المسار `options.path` إلى مسار مطلق وتُعيِّن القيم الافتراضية لـ `hidden` و`gitignore` و`recursive`.
  - تُعبِّئ `hasMatch()` الأعلام الافتراضية (`ignoreCase`، `multiline`) قبل الاستدعاء الأصلي.
- **تكييف رد النداء**
  - تُحوِّل `grep()` و`glob()` و`executeShell()` نمط `TsFunc<T>` (المعتمد على `error, value`) إلى رد نداء للمستخدم يستقبل القيم الناجحة فقط.
- **السلوك البيئي أو سلوك السياسة حول الاستدعاءات الأصلية**
  - يُضيف غلاف الحافظة معالجة OSC52/Termux/headless ويُعامل عملية النسخ باعتبارها ذات جهد أفضل.
- **التسمية العامة وإدارة إعادة التصدير**
  - يرتبط `searchContent()` بالتصدير الأصلي `search`.

## تنظيم واجهة التصدير العامة

يُعدُّ `packages/natives/src/index.ts` البرميل العام المعياري. يُجمِّع التصديرات حسب نطاق القدرة:

- البحث/النص: `grep`، `glob`، `text`، `highlight`
- التنفيذ/العملية/الطرفية: `shell`، `pty`، `ps`، `keys`
- النظام/الوسائط/التحويل: `image`، `html`، `clipboard`، `system-info`، `work`

قاعدة المشرف: إذا لم يُعَد تصدير غلاف من `src/index.ts`، فهو ليس جزءًا من واجهة الحزمة العامة المقصودة.

## تعيين واجهة برمجة JS ↔ التصدير الأصلي (تمثيلي)

تستخدم جهة Rust أسماء تصدير N-API (المُستمَدة عادةً من تحويل `#[napi]` بنمط snake_case إلى camelCase، مع أسماء مستعارة صريحة أحيانًا) يجب أن تطابق مفاتيح الربط هذه.

| الفئة | واجهة برمجة JS العامة (الغلاف) | مفتاح الربط الأصلي | نوع الإرجاع | غير متزامن؟ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | نعم |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | لا |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | لا |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | نعم |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | نعم |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | لا |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | نعم |
| Shell | `Shell` | `Shell` | مُنشئ الفئة | لا ينطبق |
| PTY | `PtySession` | `PtySession` | مُنشئ الفئة | لا ينطبق |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | لا |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | لا |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | لا |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | لا |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | نعم |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | لا |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | لا |
| Process | `killTree(pid, signal)` | `killTree` | `number` | لا |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | لا |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (سلوك الغلاف ذو الجهد الأفضل) | نعم |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | نعم |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | لا |

## الفوارق بين عقد الاستدعاء المتزامن وغير المتزامن

يجمع العقد بين واجهات برمجة متزامنة وغير متزامنة؛ إذ تحافظ الأغلفة على أسلوب الاستدعاء الأصلي بدلًا من فرض نموذج واحد:

- **التصديرات غير المتزامنة المستندة إلى Promise** للإدخال/الإخراج أو الأعمال طويلة الأمد (`grep`، `glob`، `htmlToMarkdown`، `executeShell`، الحافظة، عمليات الصور).
- **التصديرات المتزامنة** للتحويلات والمحللات في الذاكرة ذات الطابع الحتمي (`search`، `hasMatch`، التمييز البرمجي، عرض النص/التقطيع، تحليل المفاتيح، استعلامات العمليات).
- **تصديرات المُنشئ** للكائنات ذات الحالة في وقت التشغيل (`Shell`، `PtySession`، `PhotonImage`).

الأثر على المشرفين: يُعدُّ تغيير نمط تصدير موجود من متزامن إلى غير متزامن أو العكس تغييرًا كاسرًا لواجهة برمجة التطبيقات والعقد عبر الأغلفة والمستدعين.

## أنماط كتابة الكائنات والتعدادات

### أنماط الكائنات (كائنات JS بأسلوب `#[napi(object)]`)

تُمثِّل TypeScript القيم الأصلية ذات شكل الكائن كواجهات، على سبيل المثال:

- `GrepResult`، `SearchResult`، `GlobResult`
- `SystemInfo`، `WorkProfile`
- `ClipboardImage`، `ParsedKittyResult`

هذه عقود هيكلية في وقت الترجمة؛ وصحة الشكل في وقت التشغيل تقع على عاتق التنفيذ الأصلي.

### أنماط التعداد

تُمثَّل التعدادات الأصلية الرقمية كقيم `const enum` في TypeScript:

- `FileType` (`1=ملف`، `2=مجلد`، `3=رابط رمزي`)
- `ImageFormat` (`0=PNG`، `1=JPEG`، `2=WEBP`، `3=GIF`)
- `SamplingFilter`، `Ellipsis`، `KeyEventType`

يرى المستدعون أعضاء التعداد بأسمائها؛ بينما تمر الأرقام عبر حد الربط.

## كيف تُكشَف التناقضات

يتم اكتشاف التناقضات عند طبقتين:

1. **فحوصات عقد TypeScript في وقت الترجمة**
   - تستدعي الأغلفة `native.<name>` مقابل واجهة `NativeBindings` المدموجة.
   - تكسر مفاتيح الربط المفقودة أو المُعاد تسميتها فحص الأنواع في TypeScript داخل الأغلفة.

2. **التحقق في وقت التشغيل في `validateNative`**
   - بعد التحميل، يتحقق `native.ts` من التصديرات المطلوبة ويُطلق استثناءً إذا كان أيٌّ منها مفقودًا.
   - تتضمن رسالة الخطأ المفاتيح المفقودة وتعليمات إعادة البناء.

يرصد ذلك انجراف الثنائيات القديمة الشائع: وجود الغلاف/النوع لكن غياب التصدير في ملف `.node` المحمَّل.

## سلوك الإخفاق والتحفظات

### إخفاقات التحميل/التحقق (الإخفاقات القاطعة)

- يؤدي إخفاق تحميل الإضافة أو المنصة غير المدعومة إلى إطلاق استثناء أثناء تهيئة الوحدة في `native.ts`.
- يؤدي غياب التصديرات المطلوبة إلى إطلاق استثناء قبل أن تصبح الأغلفة قابلة للاستخدام.

الأثر: تُخفق الحزمة بسرعة بدلًا من تأجيل الإخفاق إلى أول استدعاء.

### الفوارق في السلوك على مستوى الغلاف

- تُخفِّف بعض الأغلفة الإخفاقات عن قصد (`copyToClipboard` ذات جهد أفضل وتبتلع إخفاقات الطبقة الأصلية).
- تتجاهل ردود نداء البث حمولات الأخطاء وتُعيد توجيه أحداث القيم الناجحة فقط.

### تحفظات على مستوى الأنواع (التشغيل أكثر صرامة من TypeScript)

- لا تضمن الحقول الاختيارية في TypeScript الصلاحية الدلالية؛ إذ يمكن للطبقة الأصلية رفض القيم المشوهة.
- لا يمنع كتابة `const enum` تمرير قيم رقمية خارج النطاق من المستدعين غير المكتوبين في وقت التشغيل.
- يتحقق `validateNative` من وجود التصديرات المطلوبة وكونها دوالًا فحسب، دون التحقق العميق من توافق شكل الوسيطات والإرجاع.
- يتضمن `bindings.ts` الدالة `cancelWork(id)` في الواجهة الأساسية، لكن قائمة التحقق في وقت التشغيل الحالية لا تفرض ذلك المفتاح.

## قائمة التحقق للمشرف عند تغيير الربط

عند إضافة تصدير أو تغييره، حدِّث جميع ما يلي:

1. `src/<module>/types.ts` (التوسيع وأنواع العقد)
2. `src/<module>/index.ts` (سلوك الغلاف)
3. استيرادات `src/native.ts` لأنواع الوحدة (في حالة وجود وحدة جديدة)
4. فحوصات التصدير المطلوبة في `validateNative`
5. إعادة التصديرات العامة في `src/index.ts`

يؤدي تجاهل أي خطوة إلى انجراف في وقت الترجمة أو إخفاق في وقت التحميل أثناء التشغيل.
