---
title: Gemini Manifest Extensions
description: >-
  Gemini manifest extension format for cross-platform skill and agent
  compatibility.
sidebar:
  order: 7
  label: بيان Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# امتدادات بيان Gemini (`gemini-extension.json`)

يتناول هذا المستند كيفية اكتشاف وكيل البرمجة (coding-agent) لامتدادات بيان بنمط Gemini (`gemini-extension.json`) وتحليلها إلى قدرة `extensions`.

**لا** يتناول هذا المستند تحميل وحدات الامتدادات بلغة TypeScript/JavaScript (`extensions/*.ts`، `index.ts`، `package.json xcsh.extensions`)، والموثقة في `extension-loading.md`.

## ملفات التنفيذ

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## ما يتم اكتشافه

يسجل مزود Gemini (`id: gemini`، الأولوية `60`) محمّل `extensions` يفحص جذرين ثابتين:

- المستخدم: `~/.gemini/extensions`
- المشروع: `<cwd>/.gemini/extensions`

يتم حل المسارات مباشرة من `ctx.home` و `ctx.cwd` عبر `getUserPath()` / `getProjectPath()`.

قاعدة نطاق مهمة: بحث المشروع يقتصر على **دليل العمل الحالي فقط**. ولا يتتبع الأدلة الأم.

---

## قواعد فحص الأدلة

لكل جذر (`~/.gemini/extensions` و `<cwd>/.gemini/extensions`)، يقوم الاكتشاف بما يلي:

1. `readDirEntries(root)`
2. الاحتفاظ فقط بالأدلة الفرعية المباشرة (`entry.isDirectory()`)
3. لكل دليل فرعي `<name>`، محاولة قراءة الملف التالي تحديداً:
   - `<root>/<name>/gemini-extension.json`

لا يوجد فحص تكراري أبعد من مستوى دليل واحد.

### الأدلة المخفية

اكتشاف بيان Gemini **لا** يقوم بتصفية أسماء الأدلة المسبوقة بنقطة. إذا وُجد دليل فرعي مخفي يحتوي على `gemini-extension.json`، فسيتم أخذه بعين الاعتبار.

### الملفات المفقودة/غير القابلة للقراءة

إذا كان `gemini-extension.json` مفقوداً أو غير قابل للقراءة، يتم تخطي ذلك الدليل بصمت (بدون تحذير).

---

## شكل البيان (كما هو مُنفّذ)

يحدد نوع القدرة شكل البيان التالي:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

سلوك وقت الاكتشاف متساهل عمداً:

- نجاح تحليل JSON مطلوب.
- لا توجد تحقق مخطط في وقت التشغيل لأنواع/محتوى الحقول بخلاف صياغة JSON.
- يتم تخزين الكائن المحلل كـ `manifest` على عنصر القدرة.

### تطبيع الاسم

يتم تعيين `Extension.name` إلى:

1. `manifest.name` إذا لم يكن `null`/`undefined`
2. وإلا اسم دليل الامتداد

لا يتم تطبيق أي تحقق من نوع السلسلة النصية هنا.

---

## التحويل إلى عناصر القدرة

ينشئ بيان صالح تم تحليله عنصر قدرة `Extension` واحداً:

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

- يتم تطبيع `_source.path` إلى مسار مطلق بواسطة `createSourceMeta()`.
- التحقق من القدرة على مستوى السجل لـ `extensions` يتحقق فقط من وجود `name` و `path`.
- لا يتم التحقق من المحتويات الداخلية للبيان (`mcpServers`، `tools`، `context`) أثناء الاكتشاف.

---

## معالجة الأخطاء ودلالات التحذيرات

### يتم التحذير

- JSON غير صالح في ملف بيان:
  - صيغة التحذير: `Invalid JSON in <manifestPath>`

### لا يتم التحذير (تخطٍّ صامت)

- دليل `extensions` مفقود
- الدليل الفرعي لا يحتوي على `gemini-extension.json`
- ملف بيان غير قابل للقراءة
- JSON في البيان صحيح نحوياً لكنه غريب/غير مكتمل دلالياً

هذا يعني أن الصلاحية الجزئية مقبولة: فقط فشل JSON النحوي يُصدر تحذيراً.

---

## الأسبقية وإزالة التكرار مع المصادر الأخرى

يتم تجميع قدرة `extensions` عبر المزودين بواسطة سجل القدرات.

المزودون الحاليون لهذه القدرة:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) الأولوية `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) الأولوية `60`

مفتاح إزالة التكرار هو `ext.name` (`extensionCapability.key = ext => ext.name`).

### الأسبقية عبر المزودين

المزود ذو الأولوية الأعلى يفوز عند تكرار أسماء الامتدادات.

- إذا أصدر كل من `native` و `gemini` امتداداً باسم `foo`، يتم الاحتفاظ بعنصر native.
- يتم الاحتفاظ بالتكرار ذو الأولوية الأدنى فقط في `result.all` مع `_shadowed = true`.

### تأثيرات الترتيب داخل المزود الواحد

لأن إزالة التكرار تعتمد على "الأول المُكتشف يفوز"، فإن ترتيب العناصر المحلي للمزود مهم.

- محمّل Gemini يُلحق **المستخدم أولاً**، ثم **المشروع**.
- لذلك، الأسماء المكررة بين `~/.gemini/extensions` و `<cwd>/.gemini/extensions` تحتفظ بإدخال المستخدم وتُظلل إدخال المشروع.

بالمقابل، يبني المزود الأصلي (native) ترتيب دليل الإعدادات بشكل مختلف (`project` ثم `user` في `getConfigDirs()`)، لذا التظليل داخل المزود الأصلي يكون في الاتجاه المعاكس.

---

## ملخص سلوك المستخدم مقابل المشروع

بالنسبة لبيانات Gemini تحديداً:

- يتم فحص كلا جذري المستخدم والمشروع في كل تحميل.
- جذر المشروع ثابت عند `<cwd>/.gemini/extensions` (بدون تتبع الأسلاف).
- الأسماء المكررة داخل مصدر Gemini تُحل لصالح المستخدم أولاً.
- الأسماء المكررة مقابل مزودين ذوي أولوية أعلى (خاصة native) تخسر بالأولوية.

---

## الحدود: بيانات الاكتشاف التعريفية مقابل تحميل الامتدادات في وقت التشغيل

اكتشاف `gemini-extension.json` يغذي حالياً بيانات القدرة التعريفية (عناصر `Extension`). وهو **لا** يحمّل مباشرة وحدات امتدادات TS/JS القابلة للتشغيل.

تحميل الوحدات في وقت التشغيل (`discoverAndLoadExtensions()` / `loadExtensions()`) يستخدم `extension-modules` ومسارات صريحة، ويقوم حالياً بتصفية الوحدات المكتشفة تلقائياً للمزود `native` فقط.

النتيجة العملية:

- امتدادات بيان Gemini قابلة للاكتشاف كسجلات قدرات.
- لا يتم تنفيذها بحد ذاتها كوحدات امتدادات قابلة للتشغيل في وقت التشغيل بواسطة خط أنابيب محمّل الامتدادات.

هذا الحد مقصود في التنفيذ الحالي ويوضح لماذا يمكن أن يتباعد اكتشاف البيان وتحميل الوحدات القابلة للتنفيذ.
