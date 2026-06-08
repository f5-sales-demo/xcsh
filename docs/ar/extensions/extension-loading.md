---
title: Extension Loading (TypeScript/JavaScript Modules)
description: >-
  TypeScript and JavaScript module loading pipeline for extensions with
  resolution, validation, and caching.
sidebar:
  order: 2
  label: تحميل الإضافات
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# تحميل الإضافات (وحدات TypeScript/JavaScript)

يتناول هذا المستند كيفية اكتشاف وكيل البرمجة لـ**وحدات الإضافات** (`.ts`/`.js`) وتحميلها عند بدء التشغيل.

لا يتناول هذا المستند إضافات ملف البيان `gemini-extension.json` (موثقة بشكل منفصل).

## ما يقوم به هذا النظام الفرعي

يقوم تحميل الإضافات ببناء قائمة من ملفات الإدخال للوحدات، ثم يستورد كل وحدة باستخدام Bun، وينفذ المصنع الخاص بها، ويعيد:

- تعريفات الإضافات المحملة
- أخطاء التحميل لكل مسار (دون إيقاف عملية التحميل بالكامل)
- كائن تشغيل إضافات مشترك يُستخدم لاحقاً بواسطة `ExtensionRunner`

## ملفات التنفيذ الرئيسية

- `src/extensibility/extensions/loader.ts` — اكتشاف المسارات + الاستيراد/التنفيذ
- `src/extensibility/extensions/index.ts` — التصديرات العامة
- `src/extensibility/extensions/runner.ts` — التشغيل/تنفيذ الأحداث بعد التحميل
- `src/discovery/builtin.ts` — مزود الاكتشاف التلقائي الأصلي لوحدات الإضافات
- `src/config/settings.ts` — تحميل إعدادات `extensions` / `disabledExtensions` المدمجة

---

## مدخلات تحميل الإضافات

### 1) وحدات الإضافات الأصلية المكتشفة تلقائياً

تقوم `discoverAndLoadExtensions()` أولاً بسؤال مزودي الاكتشاف عن عناصر القدرة `extension-module`، ثم تحتفظ فقط بعناصر المزود `native`.

المواقع الأصلية الفعالة:

- المشروع: `<cwd>/.xcsh/extensions`
- المستخدم: `~/.xcsh/agent/extensions`

تأتي جذور المسارات من المزود الأصلي (`SOURCE_PATHS.native`).

ملاحظات:

- الاكتشاف التلقائي الأصلي يعتمد حالياً على `.xcsh`.
- لا يزال `.pi` القديم مقبولاً في مفاتيح بيان `package.json` (`pi.extensions`)، لكن ليس كجذر أصلي هنا.

### 2) المسارات المُعدَّة صراحةً

بعد الاكتشاف التلقائي، تُلحق المسارات المُعدَّة وتُحل.

مصادر المسارات المُعدَّة في مسار بدء الجلسة الرئيسي (`sdk.ts`):

1. المسارات المقدمة عبر سطر الأوامر (`--extension/-e`، و`--hook` يُعامل أيضاً كمسار إضافة)
2. مصفوفة `extensions` في الإعدادات (إعدادات عامة + إعدادات المشروع مدمجة)

ملف الإعدادات العامة:

- `~/.xcsh/agent/config.yml` (أو مجلد وكيل مخصص عبر `PI_CODING_AGENT_DIR`)

ملف إعدادات المشروع:

- `<cwd>/.xcsh/settings.json`

أمثلة:

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## عناصر التحكم في التفعيل/التعطيل

### تعطيل الاكتشاف

- سطر الأوامر: `--no-extensions`
- خيار SDK: `disableExtensionDiscovery`

تقسيم السلوك:

- SDK: عندما يكون `disableExtensionDiscovery=true`، يظل يحمل `additionalExtensionPaths` عبر `loadExtensions()`.
- بناء مسار سطر الأوامر (`main.ts`) يمسح حالياً مسارات إضافات سطر الأوامر عند تعيين `--no-extensions`، لذا لا يتم تمرير `-e/--hook` الصريحة في هذا الوضع.

### تعطيل وحدات إضافات محددة

إعداد `disabledExtensions` يُرشِّح حسب تنسيق معرف الإضافة:

- `extension-module:<derivedName>`

يعتمد `derivedName` على مسار الإدخال (`getExtensionNameFromPath`)، على سبيل المثال:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

مثال:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## حل المسارات والإدخالات

### تطبيع المسارات

للمسارات المُعدَّة:

1. تطبيع مسافات اليونيكود
2. توسيع `~`
3. إذا كان نسبياً، يُحل بالنسبة إلى `cwd` الحالي

### إذا كان المسار المُعدَّ ملفاً

يُستخدم مباشرة كمرشح إدخال وحدة.

### إذا كان المسار المُعدَّ مجلداً

ترتيب الحل:

1. `package.json` في ذلك المجلد مع `xcsh.extensions` (أو `pi.extensions` القديم) -> استخدام الإدخالات المُعلنة
2. `index.ts`
3. `index.js`
4. وإلا يتم فحص مستوى واحد بحثاً عن إدخالات الإضافات:
   - `*.ts` / `*.js` مباشرة
   - `index.ts` / `index.js` في المجلد الفرعي
   - `package.json` في المجلد الفرعي مع `xcsh.extensions` / `pi.extensions`

القواعد والقيود:

- لا يوجد اكتشاف تكراري أبعد من مستوى مجلد فرعي واحد
- إدخالات البيان `extensions` المُعلنة تُحل بالنسبة إلى مجلد الحزمة ذاك
- تُدرج الإدخالات المُعلنة فقط إذا كان الملف موجوداً/الوصول مسموح به
- في أزواج `*/index.{ts,js}`، يُفضَّل TypeScript على JavaScript
- تُعامل الروابط الرمزية كملفات/مجلدات مؤهلة

### يختلف سلوك التجاهل حسب المصدر

- الاكتشاف التلقائي الأصلي (`discoverExtensionModulePaths` في مساعدي الاكتشاف) يستخدم glob الأصلي مع `gitignore: true` و`hidden: false`.
- فحص المجلدات المُعدَّة صراحةً في `loader.ts` يستخدم قواعد `readdir` و**لا** يطبق ترشيح gitignore.

---

## ترتيب التحميل والأسبقية

تبني `discoverAndLoadExtensions()` قائمة مرتبة واحدة ثم تستدعي `loadExtensions()`.

الترتيب:

1. الوحدات المكتشفة تلقائياً الأصلية
2. المسارات المُعدَّة صراحةً (بالترتيب المقدم)

في `sdk.ts`، الترتيب المُعدَّ هو:

1. المسارات الإضافية من سطر الأوامر
2. مصفوفة `extensions` من الإعدادات

إزالة التكرار:

- تعتمد على المسار المطلق
- المسار الأول الذي يُرى يفوز
- التكرارات اللاحقة تُتجاهل

النتيجة: إذا كان نفس مسار الوحدة مكتشفاً تلقائياً ومُعدَّاً صراحةً، يُحمَّل مرة واحدة في الموضع الأول (مرحلة الاكتشاف التلقائي).

---

## استيراد الوحدة وعقد المصنع

يُحمَّل كل مسار مرشح باستخدام الاستيراد الديناميكي:

- `await import(resolvedPath)`
- المصنع هو `module.default ?? module`
- يجب أن يكون المصنع دالة (`ExtensionFactory`)

إذا لم يكن التصدير دالة، يفشل ذلك المسار بخطأ مُهيكل ويستمر التحميل.

---

## معالجة الأخطاء والعزل

### أثناء التحميل

لكل مسار إضافة، تُلتقط الأخطاء كـ `{ path, error }` ولا توقف تحميل المسارات الأخرى.

الحالات الشائعة:

- فشل الاستيراد / ملف مفقود
- تصدير مصنع غير صالح (ليس دالة)
- استثناء مُلقى أثناء تنفيذ المصنع

### نموذج عزل التشغيل

- الإضافات **ليست معزولة في بيئة آمنة** (نفس العملية/بيئة التشغيل).
- تتشارك `EventBus` واحد ومثيل `ExtensionRuntime` واحد.
- أثناء التحميل، تُلقي أساليب إجراءات التشغيل عمداً `ExtensionRuntimeNotInitializedError`؛ يحدث ربط الإجراءات لاحقاً في `ExtensionRunner.initialize()`.

### بعد التحميل

عندما تُنفذ الأحداث عبر `ExtensionRunner`، تُلتقط استثناءات المعالجات وتُصدر كأخطاء إضافات بدلاً من إيقاف حلقة المشغل.

---

## أمثلة بسيطة لتخطيط المستخدم/المشروع

### على مستوى المستخدم

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### على مستوى المشروع

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`:

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

مفتاح البيان القديم لا يزال مقبولاً:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
