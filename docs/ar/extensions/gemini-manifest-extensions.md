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

يتناول هذا المستند كيفية اكتشاف وكيل البرمجة لامتدادات بيان نمط Gemini (`gemini-extension.json`) وتحليلها إلى قدرة `extensions`.

هذا المستند **لا** يتناول تحميل وحدات الامتدادات بلغة TypeScript/JavaScript (`extensions/*.ts`، `index.ts`، `package.json xcsh.extensions`)، وهو موثق في `extension-loading.md`.

## ملفات التنفيذ

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## ما يتم اكتشافه

يُسجّل مزود Gemini (`id: gemini`، الأولوية `60`) مُحمّل `extensions` يفحص جذرين ثابتين:

- المستخدم: `~/.gemini/extensions`
- المشروع: `<cwd>/.gemini/extensions`

يتم حل المسارات مباشرة من `ctx.home` و `ctx.cwd` عبر `getUserPath()` / `getProjectPath()`.

قاعدة نطاق مهمة: البحث في المشروع يقتصر على **دليل العمل الحالي فقط**. لا يتنقل في الأدلة الأب.

---

## قواعد فحص الأدلة

لكل جذر (`~/.gemini/extensions` و `<cwd>/.gemini/extensions`)، يقوم الاكتشاف بما يلي:

1. `readDirEntries(root)`
2. الاحتفاظ فقط بالأدلة الفرعية المباشرة (`entry.isDirectory()`)
3. لكل دليل فرعي `<name>`، محاولة قراءة:
   - `<root>/<name>/gemini-extension.json`

لا يوجد فحص تكراري بعمق أكثر من مستوى دليل واحد.

### الأدلة المخفية

اكتشاف بيان Gemini **لا** يستبعد أسماء الأدلة المبدوءة بنقطة. إذا وُجد دليل فرعي مخفي يحتوي على `gemini-extension.json`، فإنه يؤخذ بعين الاعتبار.

### الملفات المفقودة/غير القابلة للقراءة

إذا كان `gemini-extension.json` مفقودًا أو غير قابل للقراءة، يتم تخطي ذلك الدليل بصمت (بدون تحذير).

---

## شكل البيان (كما هو مُنفّذ)

يُعرّف نوع القدرة شكل البيان التالي:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

السلوك في وقت الاكتشاف متساهل عمدًا:

- يُشترط نجاح تحليل JSON.
- لا يوجد تحقق من المخطط في وقت التشغيل لأنواع/محتوى الحقول بخلاف بناء JSON.
- يُخزّن الكائن المُحلّل كـ `manifest` على عنصر القدرة.

### تطبيع الاسم

يتم تعيين `Extension.name` إلى:

1. `manifest.name` إذا لم يكن `null`/`undefined`
2. وإلا اسم دليل الامتداد

لا يتم تطبيق فرض نوع السلسلة النصية هنا.

---

## التجسيد إلى عناصر القدرة

ينشئ البيان المُحلّل الصالح عنصر قدرة `Extension` واحدًا:

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
- لا يتم التحقق من محتويات البيان الداخلية (`mcpServers`، `tools`، `context`) أثناء الاكتشاف.

---

## معالجة الأخطاء ودلالات التحذيرات

### يتم التحذير

- JSON غير صالح في ملف بيان:
  - صيغة التحذير: `Invalid JSON in <manifestPath>`

### لا يتم التحذير (تخطي صامت)

- دليل `extensions` مفقود
- الدليل الفرعي لا يحتوي على `gemini-extension.json`
- ملف بيان غير قابل للقراءة
- JSON في البيان صالح نحويًا لكن غريب/ناقص دلاليًا

هذا يعني أن الصلاحية الجزئية مقبولة: فقط فشل JSON النحوي يُصدر تحذيرًا.

---

## الأسبقية وإزالة التكرار مع المصادر الأخرى

يتم تجميع قدرة `extensions` عبر المزودين بواسطة سجل القدرات.

المزودون الحاليون لهذه القدرة:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) الأولوية `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) الأولوية `60`

مفتاح إزالة التكرار هو `ext.name` (`extensionCapability.key = ext => ext.name`).

### الأسبقية عبر المزودين

المزود ذو الأولوية الأعلى يفوز عند تكرار أسماء الامتدادات.

- إذا أصدر كل من `native` و `gemini` امتدادًا باسم `foo`، يتم الاحتفاظ بعنصر native.
- يتم الاحتفاظ بالتكرار ذي الأولوية الأقل فقط في `result.all` مع `_shadowed = true`.

### تأثيرات الترتيب داخل المزود الواحد

نظرًا لأن إزالة التكرار تعمل بمبدأ "الأول يفوز"، فإن ترتيب العناصر المحلي للمزود مهم.

- مُحمّل Gemini يُضيف عناصر **المستخدم أولاً**، ثم **المشروع**.
- لذلك، الأسماء المتكررة بين `~/.gemini/extensions` و `<cwd>/.gemini/extensions` تحتفظ بإدخال المستخدم وتُظلّل إدخال المشروع.

على النقيض، المزود native يبني ترتيب أدلة التكوين بشكل مختلف (`project` ثم `user` في `getConfigDirs()`)، لذا التظليل داخل مزود native يكون في الاتجاه المعاكس.

---

## ملخص سلوك المستخدم مقابل المشروع

بالنسبة لبيانات Gemini تحديدًا:

- يتم فحص كلا جذري المستخدم والمشروع في كل تحميل.
- جذر المشروع ثابت على `<cwd>/.gemini/extensions` (بدون تنقل في الأدلة الأب).
- الأسماء المتكررة داخل مصدر Gemini تُحل بأولوية المستخدم أولاً.
- الأسماء المتكررة مقابل مزودين ذوي أولوية أعلى (لا سيما native) تخسر بالأولوية.

---

## الحدود: بيانات الاكتشاف مقابل تحميل الامتدادات في وقت التشغيل

اكتشاف `gemini-extension.json` حاليًا يُغذي بيانات القدرات الوصفية (عناصر `Extension`). وهو **لا** يُحمّل مباشرة وحدات امتدادات TS/JS القابلة للتشغيل.

تحميل الوحدات في وقت التشغيل (`discoverAndLoadExtensions()` / `loadExtensions()`) يستخدم `extension-modules` ومسارات صريحة، ويُصفّي حاليًا الوحدات المكتشفة تلقائيًا للمزود `native` فقط.

الأثر العملي:

- امتدادات بيان Gemini قابلة للاكتشاف كسجلات قدرات.
- لكنها بذاتها لا تُنفّذ كوحدات امتدادات قابلة للتشغيل بواسطة خط أنابيب مُحمّل الامتدادات.

هذا الحد مقصود في التنفيذ الحالي ويوضح لماذا يمكن أن يتباعد اكتشاف البيانات وتحميل الوحدات القابلة للتنفيذ.
