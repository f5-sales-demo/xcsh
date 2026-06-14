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

**لا** تتناول تحميل وحدات امتداد TypeScript/JavaScript (`extensions/*.ts`، `index.ts`، `package.json xcsh.extensions`)، الموثقة في `extension-loading.md`.

## ملفات التنفيذ

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## ما الذي يتم اكتشافه

يُسجّل موفر Gemini (`id: gemini`، الأولوية `60`) محمّل `extensions` يفحص جذرين ثابتين:

- المستخدم: `~/.gemini/extensions`
- المشروع: `<cwd>/.gemini/extensions`

يتم تحليل المسار مباشرةً من `ctx.home` و`ctx.cwd` عبر `getUserPath()` / `getProjectPath()`.

قاعدة النطاق المهمة: البحث في المشروع مقيّد بـ **cwd فقط**. ولا يتصفح الدلائل الأم.

---

## قواعد فحص الدليل

لكل جذر (`~/.gemini/extensions` و`<cwd>/.gemini/extensions`)، يتم الاكتشاف على النحو التالي:

1. `readDirEntries(root)`
2. الاحتفاظ فقط بالدلائل الفرعية المباشرة (`entry.isDirectory()`)
3. لكل دليل فرعي `<name>`، محاولة قراءة ما يلي حصراً:
   - `<root>/<name>/gemini-extension.json`

لا يوجد فحص تكراري يتجاوز مستوى دليل واحد.

### الدلائل المخفية

لا يُصفّي اكتشاف Gemini manifest أسماء الدلائل التي تبدأ بنقطة. إذا كان دليل فرعي مخفي موجوداً ويحتوي على `gemini-extension.json`، فسيُؤخذ في الاعتبار.

### الملفات المفقودة أو غير القابلة للقراءة

إذا كان `gemini-extension.json` مفقوداً أو غير قابل للقراءة، يتم تخطي ذلك الدليل بصمت (بدون أي تحذير).

---

## شكل الـ Manifest (كما هو مُنفَّذ)

يُعرّف نوع القدرة شكل هذا الـ manifest على النحو التالي:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

السلوك وقت الاكتشاف مرن عن قصد:

- يُشترط نجاح تحليل JSON.
- لا يوجد تحقق من صحة المخطط وقت التشغيل لأنواع الحقول/المحتوى خارج نطاق بنية JSON.
- يُخزَّن الكائن المُحلَّل كـ `manifest` على عنصر القدرة.

### تطبيع الاسم

يُضبط `Extension.name` على:

1. `manifest.name` إذا لم يكن `null`/`undefined`
2. وإلا اسم دليل الامتداد

لا يُطبَّق أي إلزام بنوع السلسلة النصية هنا.

---

## التحويل إلى عناصر القدرة

يُنشئ كل manifest مُحلَّل صالح عنصر قدرة `Extension` واحداً:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

ملاحظات:

- يتم تطبيع `_source.path` إلى مسار مطلق عبر `createSourceMeta()`.
- يتحقق التحقق من القدرة على مستوى السجل لـ `extensions` فقط من وجود `name` و`path`.
- لا يتم التحقق من مضمون الـ manifest (`mcpServers`، `tools`، `context`) أثناء الاكتشاف.

---

## معالجة الأخطاء ودلالات التحذير

### التحذيرات

- JSON غير صالح في ملف manifest:
  - تنسيق التحذير: `Invalid JSON in <manifestPath>`

### بدون تحذير (تخطي صامت)

- دليل `extensions` مفقود
- دليل فرعي لا يحتوي على `gemini-extension.json`
- ملف manifest غير قابل للقراءة
- JSON للـ manifest صحيح بنيوياً لكنه غريب/غير مكتمل دلالياً

هذا يعني قبول الصحة الجزئية: الإخفاق البنيوي في JSON فقط هو الذي يُصدر تحذيراً.

---

## الأسبقية وإزالة التكرار من مصادر أخرى

تُجمَّع قدرة `extensions` عبر الموفرين بواسطة سجل القدرات.

الموفرون الحاليون لهذه القدرة:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) أولوية `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) أولوية `60`

مفتاح إزالة التكرار هو `ext.name` (`extensionCapability.key = ext => ext.name`).

### الأسبقية عبر الموفرين

يفوز الموفر ذو الأولوية الأعلى عند تكرار أسماء الامتدادات.

- إذا أصدر كل من `native` و`gemini` امتداداً باسم `foo`، يُحتفظ بالعنصر الأصيل.
- يُحتفظ بالتكرار ذو الأولوية الأدنى فقط في `result.all` مع `_shadowed = true`.

### تأثيرات الترتيب داخل الموفر الواحد

نظراً لأن إزالة التكرار تعمل وفق مبدأ "الأول يُحفظ"، يُهم ترتيب العناصر المحلية للموفر.

- يُلحق محمّل Gemini **المستخدم أولاً**، ثم **المشروع**.
- لذلك، تُحتفظ الأسماء المكررة بين `~/.gemini/extensions` و`<cwd>/.gemini/extensions` بالمدخل الخاص بالمستخدم، وتُظلَّل مدخل المشروع.

في المقابل، يبني الموفر الأصيل ترتيب دليل التكوين بشكل مختلف (`project` ثم `user` في `getConfigDirs()`)، لذا فإن إزالة التكرار داخل الموفر الأصيل تسير في الاتجاه المعاكس.

---

## ملخص سلوك المستخدم مقابل المشروع

فيما يخص Gemini manifests تحديداً:

- يتم فحص كلا الجذرين (المستخدم والمشروع) في كل تحميل.
- جذر المشروع ثابت عند `<cwd>/.gemini/extensions` (بدون تصفح الدلائل الأم).
- تُحلّ الأسماء المكررة داخل مصدر Gemini لصالح المستخدم أولاً.
- تخسر الأسماء المكررة في مواجهة الموفرين ذوي الأولوية الأعلى (الأصيل تحديداً) بسبب الأولوية.

---

## الحد الفاصل: بيانات الاكتشاف مقابل تحميل الامتداد وقت التشغيل

يُغذّي اكتشاف `gemini-extension.json` حالياً بيانات القدرة (`Extension` items). **لا** يُحمّل مباشرةً وحدات امتداد TS/JS قابلة للتشغيل.

يستخدم تحميل الوحدات وقت التشغيل (`discoverAndLoadExtensions()` / `loadExtensions()`) مسارات `extension-modules` صريحة، ويُصفّي حالياً الوحدات المُكتشفة تلقائياً للموفر `native` فقط.

التداعية العملية:

- يمكن اكتشاف امتدادات Gemini manifest كسجلات للقدرات.
- لا تُنفَّذ بحد ذاتها كوحدات امتداد وقت تشغيل بواسطة سلسلة محمّل الامتداد.

هذا الحد الفاصل مقصود في التنفيذ الحالي ويُفسّر سبب إمكانية تباين اكتشاف الـ manifest وتحميل الوحدات القابلة للتنفيذ.
