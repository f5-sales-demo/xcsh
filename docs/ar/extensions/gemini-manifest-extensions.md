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

تتناول هذه الوثيقة كيفية اكتشاف عامل البرمجة وتحليل امتدادات Gemini manifest (`gemini-extension.json`) وتحويلها إلى قدرة `extensions`.

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

يسجّل موفر Gemini (`id: gemini`، الأولوية `60`) محمّل `extensions` يفحص جذرين ثابتين:

- المستخدم: `~/.gemini/extensions`
- المشروع: `<cwd>/.gemini/extensions`

يتم تحليل المسارات مباشرةً من `ctx.home` و`ctx.cwd` عبر `getUserPath()` / `getProjectPath()`.

قاعدة النطاق المهمة: بحث المشروع مقيّد بـ **cwd فحسب**. ولا يتجول في الدلائل الأصلية.

---

## قواعد فحص الدليل

لكل جذر (`~/.gemini/extensions` و`<cwd>/.gemini/extensions`)، يقوم الاكتشاف بما يلي:

1. `readDirEntries(root)`
2. الاحتفاظ بالدلائل الفرعية المباشرة فقط (`entry.isDirectory()`)
3. لكل دليل فرعي `<name>`، محاولة قراءة ما يلي حصراً:
   - `<root>/<name>/gemini-extension.json`

لا يوجد فحص تكراري يتخطى مستوى دليل واحد.

### الدلائل المخفية

لا يستبعد اكتشاف Gemini manifest أسماء الدلائل المبدوءة بنقطة. إذا كان دليل فرعي مخفي موجوداً ويحتوي على `gemini-extension.json`، فإنه يُؤخذ بالاعتبار.

### الملفات المفقودة أو غير القابلة للقراءة

إذا كان `gemini-extension.json` مفقوداً أو غير قابل للقراءة، يتم تجاوز ذلك الدليل بصمت (دون تحذير).

---

## شكل Manifest (كما هو منفّذ)

يعرّف نوع القدرة شكل manifest التالي:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

السلوك أثناء الاكتشاف مرن عن قصد:

- يُشترط نجاح تحليل JSON.
- لا يوجد تحقق من مخطط وقت التشغيل لأنواع الحقول/محتواها ما وراء صياغة JSON.
- يُخزَّن الكائن المحلَّل بوصفه `manifest` على عنصر القدرة.

### توحيد الاسم

يُعيَّن `Extension.name` على النحو التالي:

1. `manifest.name` إذا لم يكن `null`/`undefined`
2. وإلا اسم دليل الامتداد

لا يُطبَّق هنا أي إلزام بنوع السلسلة النصية.

---

## التحويل إلى عناصر القدرة

يُنشئ manifest محلَّل صالح عنصر قدرة `Extension` واحداً:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // مرفق بواسطة سجل القدرات
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

ملاحظات:

- يُوحَّد `_source.path` إلى مسار مطلق بواسطة `createSourceMeta()`.
- التحقق من القدرة على مستوى السجل لـ `extensions` يتحقق فقط من وجود `name` و`path`.
- لا يتم التحقق من داخليات Manifest (`mcpServers`، `tools`، `context`) أثناء الاكتشاف.

---

## معالجة الأخطاء ودلالات التحذيرات

### يصدر تحذير

- JSON غير صالح في ملف manifest:
  - تنسيق التحذير: `Invalid JSON in <manifestPath>`

### لا يصدر تحذير (تجاوز صامت)

- دليل `extensions` مفقود
- الدليل الفرعي لا يحتوي على `gemini-extension.json`
- ملف manifest غير قابل للقراءة
- JSON الخاص بـ manifest صحيح صياغياً لكنه غريب/غير مكتمل دلالياً

يعني ذلك قبول الصلاحية الجزئية: يصدر تحذير فقط عند فشل صياغة JSON.

---

## الأولوية وإزالة التكرار مع المصادر الأخرى

تُجمَّع قدرة `extensions` عبر الموفرين بواسطة سجل القدرات.

الموفرون الحاليون لهذه القدرة:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) الأولوية `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) الأولوية `60`

مفتاح إزالة التكرار هو `ext.name` (`extensionCapability.key = ext => ext.name`).

### الأولوية عبر الموفرين

الموفر ذو الأولوية الأعلى يفوز عند تكرار أسماء الامتدادات.

- إذا أصدر كل من `native` و`gemini` اسم امتداد `foo`، يُحتفظ بالعنصر الأصلي (native).
- يُحتفظ بالتكرار ذي الأولوية الأدنى في `result.all` فقط مع تعيين `_shadowed = true`.

### تأثيرات الترتيب داخل الموفر الواحد

نظراً لأن إزالة التكرار تعتمد مبدأ "الأول المكتشف يفوز"، فإن ترتيب العناصر المحلية للموفر مهم.

- يُلحق محمّل Gemini **المستخدم أولاً**، ثم **المشروع**.
- لذلك، في حالة تكرار الأسماء بين `~/.gemini/extensions` و`<cwd>/.gemini/extensions`، يُحتفظ بعنصر المستخدم ويُظلَّل عنصر المشروع.

في المقابل، يبني الموفر الأصلي ترتيب دليل التهيئة بشكل مختلف (`project` ثم `user` في `getConfigDirs()`)، لذا يسير تظليل الموفر الأصلي داخلياً في الاتجاه المعاكس.

---

## ملخص سلوك المستخدم مقابل المشروع

بالنسبة لـ Gemini manifests تحديداً:

- يتم فحص جذري المستخدم والمشروع في كل تحميل.
- جذر المشروع مثبّت على `<cwd>/.gemini/extensions` (دون جولة بين الأجداد).
- تكرار الأسماء داخل مصدر Gemini يُحسم لصالح المستخدم أولاً.
- تكرار الأسماء مع موفرين ذوي أولوية أعلى (لا سيما native) يخسر بالأولوية.

---

## الحدود الفاصلة: بيانات وصف الاكتشاف مقابل تحميل الامتداد في وقت التشغيل

يُغذّي اكتشاف `gemini-extension.json` حالياً بيانات وصف القدرات (عناصر `Extension`). **لا** يقوم بتحميل وحدات امتداد TS/JS قابلة للتشغيل مباشرةً.

يستخدم تحميل الوحدات في وقت التشغيل (`discoverAndLoadExtensions()` / `loadExtensions()`) مسارات `extension-modules` الصريحة، ويصفّي الوحدات المكتشفة تلقائياً حالياً ليقتصر على الموفر `native` فحسب.

الأثر العملي:

- امتدادات Gemini manifest قابلة للاكتشاف بوصفها سجلات قدرات.
- لا تُنفَّذ بذاتها بوصفها وحدات امتداد في وقت التشغيل ضمن خط أنابيب محمّل الامتدادات.

هذه الحدود مقصودة في التنفيذ الحالي وتفسر سبب إمكانية التباين بين اكتشاف manifest وتحميل الوحدات القابلة للتنفيذ.
