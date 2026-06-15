---
title: امتدادات Gemini Manifest
description: تنسيق امتداد Gemini manifest لتوافق المهارات والوكلاء عبر المنصات.
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# امتدادات Gemini Manifest (`gemini-extension.json`)

تتناول هذه الوثيقة كيفية اكتشاف وكيل البرمجة وتحليل امتدادات Gemini manifest (`gemini-extension.json`) في قدرة `extensions`.

**لا** تتناول هذه الوثيقة تحميل وحدات امتداد TypeScript/JavaScript (`extensions/*.ts`، `index.ts`، `package.json xcsh.extensions`)، وهو موثق في `extension-loading.md`.

## ملفات التنفيذ

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## ما الذي يتم اكتشافه

يسجّل موفر Gemini (المعرّف `id: gemini`، الأولوية `60`) محمّل `extensions` يقوم بفحص جذرين ثابتين:

- المستخدم: `~/.gemini/extensions`
- المشروع: `<cwd>/.gemini/extensions`

يتم حل المسارات مباشرةً من `ctx.home` و`ctx.cwd` عبر `getUserPath()` / `getProjectPath()`.

قاعدة النطاق المهمة: البحث في المشروع يقتصر على **الدليل الحالي فقط**، ولا يتجوّل في الدلائل الأصل.

---

## قواعد فحص الدليل

لكل جذر (`~/.gemini/extensions` و`<cwd>/.gemini/extensions`)، يقوم الاكتشاف بما يلي:

1. `readDirEntries(root)`
2. الاحتفاظ بالدلائل الفرعية المباشرة فقط (`entry.isDirectory()`)
3. لكل دليل فرعي `<name>`، محاولة قراءة ما يلي تحديدًا:
   - `<root>/<name>/gemini-extension.json`

لا يوجد فحص متعمّق يتجاوز مستوى دليل واحد.

### الدلائل المخفية

لا يستثني اكتشاف Gemini manifest الدلائل التي تبدأ بنقطة. إذا كان ثمة دليل فرعي مخفي يحتوي على `gemini-extension.json`، فإنه يُؤخذ في الاعتبار.

### الملفات المفقودة أو غير القابلة للقراءة

إذا كان `gemini-extension.json` مفقودًا أو غير قابل للقراءة، يتم تخطي ذلك الدليل بصمت دون أي تحذير.

---

## شكل الـ manifest (كما هو منفَّذ)

يُعرّف نوع القدرة شكل الـ manifest على النحو التالي:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

السلوك في وقت الاكتشاف متساهل عن قصد:

- يُشترط نجاح تحليل JSON.
- لا يوجد تحقق من مخطط البيانات في وقت التشغيل لأنواع الحقول/محتوياتها باستثناء بنية JSON.
- يتم تخزين الكائن المُحلَّل بوصفه `manifest` على عنصر القدرة.

### تطبيع الاسم

يُعيَّن `Extension.name` إلى:

1. `manifest.name` إذا لم يكن `null`/`undefined`
2. وإلا اسم دليل الامتداد

لا يُطبَّق أي إلزام بنوع السلسلة النصية هنا.

---

## التجسيد في عناصر القدرة

يُنشئ كل manifest محلَّل صحيح عنصر قدرة `Extension` واحدًا:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // مُرفق من قِبل سجل القدرات
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

ملاحظات:

- يُطبَّع `_source.path` إلى مسار مطلق بواسطة `createSourceMeta()`.
- التحقق من القدرة على مستوى السجل لـ `extensions` يفحص فقط وجود `name` و`path`.
- لا يتم التحقق من المحتويات الداخلية لـ manifest (`mcpServers`، `tools`، `context`) أثناء الاكتشاف.

---

## معالجة الأخطاء ودلالات التحذيرات

### ما يُصدر تحذيرًا

- JSON غير صحيح في ملف manifest:
  - تنسيق التحذير: `Invalid JSON in <manifestPath>`

### ما لا يُصدر تحذيرًا (تخطي صامت)

- دليل `extensions` مفقود
- الدليل الفرعي لا يحتوي على `gemini-extension.json`
- ملف manifest غير قابل للقراءة
- JSON في الـ manifest صحيح نحويًا لكنه غريب أو غير مكتمل دلاليًا

هذا يعني أن الصحة الجزئية مقبولة: فشل JSON النحوي فقط هو ما يُصدر تحذيرًا.

---

## الأسبقية وإزالة التكرار مع المصادر الأخرى

يتم تجميع قدرة `extensions` عبر الموفرين من قِبل سجل القدرات.

الموفرون الحاليون لهذه القدرة:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) الأولوية `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) الأولوية `60`

مفتاح إزالة التكرار هو `ext.name` (`extensionCapability.key = ext => ext.name`).

### الأسبقية عبر الموفرين

يفوز الموفر ذو الأولوية الأعلى عند تكرار أسماء الامتدادات.

- إذا أصدر كل من `native` و`gemini` امتدادًا باسم `foo`، يُحتفظ بعنصر native.
- يظل التكرار ذو الأولوية الأدنى محتفظًا به في `result.all` فقط مع `_shadowed = true`.

### تأثيرات الترتيب داخل الموفر

نظرًا لأن إزالة التكرار تعمل على مبدأ "الأول يفوز"، فإن ترتيب العناصر داخل الموفر يُهم.

- يُلحق محمّل Gemini **المستخدم أولًا**، ثم **المشروع**.
- لذلك، في حالة تكرار الأسماء بين `~/.gemini/extensions` و`<cwd>/.gemini/extensions`، يُحتفظ بعنصر المستخدم ويُطغى على عنصر المشروع.

في المقابل، يبني الموفر native ترتيب دليل الإعدادات بشكل مختلف (`project` ثم `user` في `getConfigDirs()`)، لذا يكون الطغيان داخل الموفر native في الاتجاه المعاكس.

---

## ملخص سلوك المستخدم مقابل المشروع

بالنسبة لـ Gemini manifests تحديدًا:

- يتم فحص كلا الجذرين (المستخدم والمشروع) في كل عملية تحميل.
- جذر المشروع مثبَّت على `<cwd>/.gemini/extensions` (بدون اجتياز الدلائل الأصل).
- تكرار الأسماء داخل مصدر Gemini يُحل لصالح المستخدم أولًا.
- تكرار الأسماء مع الموفرين ذوي الأولوية الأعلى (ولا سيما native) يخسر بحكم الأولوية.

---

## الحدود الفاصلة: بيانات وصف الاكتشاف مقابل تحميل الامتداد في وقت التشغيل

يُغذّي اكتشاف `gemini-extension.json` حاليًا بيانات وصف القدرة (عناصر `Extension`). **لا** يقوم مباشرةً بتحميل وحدات امتداد TS/JS قابلة للتشغيل.

يستخدم تحميل الوحدات في وقت التشغيل (`discoverAndLoadExtensions()` / `loadExtensions()`) مسارات `extension-modules` الصريحة، ويقوم حاليًا بتصفية الوحدات المكتشفة تلقائيًا للموفر `native` فقط.

الانعكاس العملي:

- امتدادات Gemini manifest قابلة للاكتشاف بوصفها سجلات قدرات.
- لا يتم تنفيذها بذاتها بوصفها وحدات امتداد في وقت التشغيل من قِبل خط أنابيب محمّل الامتدادات.

هذا الفصل مقصود في التنفيذ الحالي ويُفسّر سبب إمكانية تباين اكتشاف الـ manifest وتحميل الوحدات القابلة للتنفيذ.
