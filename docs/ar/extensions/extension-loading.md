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

يغطي هذا المستند كيفية اكتشاف وكيل البرمجة وتحميله **لوحدات الإضافات** (`.ts`/`.js`) عند بدء التشغيل.

لا يغطي هذا المستند إضافات ملف البيان `gemini-extension.json` (موثقة بشكل منفصل).

## ما يقوم به هذا النظام الفرعي

يبني تحميل الإضافات قائمة بملفات الإدخال للوحدات، ويستورد كل وحدة باستخدام Bun، وينفذ المصنع الخاص بها، ويُرجع:

- تعريفات الإضافات المُحمّلة
- أخطاء التحميل لكل مسار (دون إيقاف عملية التحميل بالكامل)
- كائن وقت تشغيل الإضافات المشترك الذي يُستخدم لاحقاً بواسطة `ExtensionRunner`

## ملفات التنفيذ الأساسية

- `src/extensibility/extensions/loader.ts` — اكتشاف المسارات + الاستيراد/التنفيذ
- `src/extensibility/extensions/index.ts` — التصديرات العامة
- `src/extensibility/extensions/runner.ts` — وقت التشغيل/تنفيذ الأحداث بعد التحميل
- `src/discovery/builtin.ts` — مزود الاكتشاف التلقائي الأصلي لوحدات الإضافات
- `src/config/settings.ts` — يحمّل إعدادات `extensions` / `disabledExtensions` المدمجة

---

## مدخلات تحميل الإضافات

### 1) وحدات الإضافات الأصلية المكتشفة تلقائياً

تقوم `discoverAndLoadExtensions()` أولاً بسؤال مزودي الاكتشاف عن عناصر القدرة `extension-module`، ثم تحتفظ فقط بعناصر المزود `native`.

المواقع الأصلية الفعّالة:

- المشروع: `<cwd>/.xcsh/extensions`
- المستخدم: `~/.xcsh/agent/extensions`

تأتي جذور المسارات من المزود الأصلي (`SOURCE_PATHS.native`).

ملاحظات:

- الاكتشاف التلقائي الأصلي يعتمد حالياً على `.xcsh`.
- لا يزال `.pi` القديم مقبولاً في مفاتيح بيان `package.json` (`pi.extensions`)، لكن ليس كجذر أصلي هنا.

### 2) المسارات المُعدّة بشكل صريح

بعد الاكتشاف التلقائي، تُضاف المسارات المُعدّة وتُحلّ.

مصادر المسارات المُعدّة في مسار بدء الجلسة الرئيسية (`sdk.ts`):

1. المسارات المقدمة عبر سطر الأوامر (`--extension/-e`، و `--hook` يُعامل أيضاً كمسار إضافة)
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

## عناصر التحكم في التمكين/التعطيل

### تعطيل الاكتشاف

- سطر الأوامر: `--no-extensions`
- خيار SDK: `disableExtensionDiscovery`

تقسيم السلوك:

- SDK: عندما يكون `disableExtensionDiscovery=true`، لا يزال يحمّل `additionalExtensionPaths` عبر `loadExtensions()`.
- بناء مسار سطر الأوامر (`main.ts`) يمسح حالياً مسارات إضافات سطر الأوامر عند تعيين `--no-extensions`، لذلك لا يتم تمرير `-e/--hook` الصريحة في هذا الوضع.

### تعطيل وحدات إضافات محددة

إعداد `disabledExtensions` يُرشّح بتنسيق معرّف الإضافة:

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

## حل المسارات والإدخال

### تطبيع المسارات

للمسارات المُعدّة:

1. تطبيع مسافات يونيكود
2. توسيع `~`
3. إذا كان نسبياً، يُحلّ بالنسبة لـ `cwd` الحالي

### إذا كان المسار المُعدّ ملفاً

يُستخدم مباشرة كمرشح لإدخال الوحدة.

### إذا كان المسار المُعدّ مجلداً

ترتيب الحل:

1. `package.json` في ذلك المجلد مع `xcsh.extensions` (أو `pi.extensions` القديم) -> استخدام الإدخالات المُعلنة
2. `index.ts`
3. `index.js`
4. وإلا يتم مسح مستوى واحد بحثاً عن إدخالات الإضافات:
   - `*.ts` / `*.js` مباشرة
   - `index.ts` / `index.js` في المجلدات الفرعية
   - `package.json` في المجلدات الفرعية مع `xcsh.extensions` / `pi.extensions`

القواعد والقيود:

- لا يوجد اكتشاف متكرر أبعد من مستوى مجلد فرعي واحد
- إدخالات بيان `extensions` المُعلنة تُحلّ بالنسبة لمجلد الحزمة ذاك
- تُضمّن الإدخالات المُعلنة فقط إذا كان الملف موجوداً/الوصول مسموح به
- في أزواج `*/index.{ts,js}`، يُفضّل TypeScript على JavaScript
- تُعامل الروابط الرمزية كملفات/مجلدات مؤهلة

### يختلف سلوك التجاهل حسب المصدر

- الاكتشاف التلقائي الأصلي (`discoverExtensionModulePaths` في مساعدات الاكتشاف) يستخدم glob أصلي مع `gitignore: true` و `hidden: false`.
- مسح المجلدات المُعدّة بشكل صريح في `loader.ts` يستخدم قواعد `readdir` و**لا** يُطبّق تصفية gitignore.

---

## ترتيب التحميل والأولوية

تبني `discoverAndLoadExtensions()` قائمة مرتبة واحدة ثم تستدعي `loadExtensions()`.

الترتيب:

1. الوحدات المكتشفة تلقائياً الأصلية
2. المسارات المُعدّة بشكل صريح (بالترتيب المقدم)

في `sdk.ts`، الترتيب المُعدّ هو:

1. المسارات الإضافية من سطر الأوامر
2. `extensions` من الإعدادات

إزالة التكرار:

- تعتمد على المسار المطلق
- المسار الأول المُشاهد يفوز
- يتم تجاهل التكرارات اللاحقة

الدلالة: إذا كان نفس مسار الوحدة مكتشفاً تلقائياً ومُعدّاً بشكل صريح في نفس الوقت، يُحمّل مرة واحدة في الموضع الأول (مرحلة الاكتشاف التلقائي).

---

## استيراد الوحدة وعقد المصنع

يُحمّل كل مسار مرشح باستخدام الاستيراد الديناميكي:

- `await import(resolvedPath)`
- المصنع هو `module.default ?? module`
- يجب أن يكون المصنع دالة (`ExtensionFactory`)

إذا لم يكن التصدير دالة، يفشل ذلك المسار بخطأ منظم ويستمر التحميل.

---

## معالجة الأخطاء والعزل

### أثناء التحميل

لكل مسار إضافة، تُلتقط الأخطاء كـ `{ path, error }` ولا توقف تحميل المسارات الأخرى.

الحالات الشائعة:

- فشل الاستيراد / ملف مفقود
- تصدير مصنع غير صالح (ليس دالة)
- استثناء مُطلق أثناء تنفيذ المصنع

### نموذج عزل وقت التشغيل

- الإضافات **غير معزولة** (نفس العملية/وقت التشغيل).
- تتشارك `EventBus` واحد وكائن `ExtensionRuntime` واحد.
- أثناء التحميل، تُطلق أساليب إجراءات وقت التشغيل عمداً `ExtensionRuntimeNotInitializedError`؛ يحدث ربط الإجراءات لاحقاً في `ExtensionRunner.initialize()`.

### بعد التحميل

عندما تعمل الأحداث عبر `ExtensionRunner`، تُلتقط استثناءات المعالجات وتُصدر كأخطاء إضافات بدلاً من إيقاف حلقة المشغّل.

---

## أمثلة تخطيط بسيطة على مستوى المستخدم/المشروع

### مستوى المستخدم

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### مستوى المشروع

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
