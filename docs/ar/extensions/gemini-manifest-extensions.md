---
title: ملحقات ملف تعريف Gemini
description: تنسيق ملحقات ملف تعريف Gemini للتوافق بين المنصات للمهارات والوكلاء.
sidebar:
  order: 7
  label: ملف تعريف Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# ملحقات ملف تعريف Gemini (`gemini-extension.json`)

يغطي هذا المستند كيفية اكتشاف وكيل البرمجة لملحقات ملف التعريف بنمط Gemini (`gemini-extension.json`) وتحليلها إلى قدرة `extensions`.

هذا المستند **لا** يغطي تحميل وحدات الملحقات بلغة TypeScript/JavaScript (`extensions/*.ts`، `index.ts`، `package.json xcsh.extensions`)، والتي موثقة في `extension-loading.md`.

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

يتم تحليل المسار مباشرة من `ctx.home` و `ctx.cwd` عبر `getUserPath()` / `getProjectPath()`.

قاعدة نطاق مهمة: البحث في المشروع يقتصر على **دليل العمل الحالي فقط**. ولا يتم التنقل في الأدلة الأب.

---

## قواعد فحص الأدلة

لكل جذر (`~/.gemini/extensions` و `<cwd>/.gemini/extensions`)، يقوم الاكتشاف بـ:

1. `readDirEntries(root)`
2. الاحتفاظ فقط بالأدلة الفرعية المباشرة (`entry.isDirectory()`)
3. لكل دليل فرعي `<name>`، محاولة قراءة بالضبط:
   - `<root>/<name>/gemini-extension.json`

لا يوجد فحص تكراري أعمق من مستوى دليل واحد.

### الأدلة المخفية

اكتشاف ملف تعريف Gemini **لا** يستبعد أسماء الأدلة المسبوقة بنقطة. إذا كان دليل فرعي مخفي موجوداً ويحتوي على `gemini-extension.json`، فسيتم اعتباره.

### الملفات المفقودة/غير القابلة للقراءة

إذا كان `gemini-extension.json` مفقوداً أو غير قابل للقراءة، يتم تخطي ذلك الدليل بصمت (بدون تحذير).

---

## شكل ملف التعريف (كما هو مُنفّذ)

يحدد نوع القدرة شكل ملف التعريف هذا:

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

- يُشترط نجاح تحليل JSON.
- لا يوجد تحقق من المخطط أثناء التشغيل لأنواع/محتوى الحقول بخلاف صياغة JSON.
- يتم تخزين الكائن المُحلّل كـ `manifest` على عنصر القدرة.

### تطبيع الاسم

يتم تعيين `Extension.name` إلى:

1. `manifest.name` إذا لم يكن `null`/`undefined`
2. وإلا اسم دليل الملحق

لا يتم تطبيق أي فرض لنوع السلسلة النصية هنا.

---

## التجسيد إلى عناصر القدرة

ملف تعريف مُحلّل صالح يُنشئ عنصر قدرة `Extension` واحد:

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

- `_source.path` يتم تطبيعه إلى مسار مطلق بواسطة `createSourceMeta()`.
- التحقق من القدرة على مستوى السجل لـ `extensions` يتحقق فقط من وجود `name` و `path`.
- المحتويات الداخلية لملف التعريف (`mcpServers`، `tools`، `context`) لا يتم التحقق منها أثناء الاكتشاف.

---

## معالجة الأخطاء ودلالات التحذيرات

### مع تحذير

- JSON غير صالح في ملف التعريف:
  - صيغة التحذير: `Invalid JSON in <manifestPath>`

### بدون تحذير (تخطي صامت)

- دليل `extensions` مفقود
- الدليل الفرعي لا يحتوي على `gemini-extension.json`
- ملف تعريف غير قابل للقراءة
- JSON في ملف التعريف صحيح نحوياً لكنه غريب/غير مكتمل دلالياً

هذا يعني أن الصلاحية الجزئية مقبولة: فقط فشل JSON النحوي يُصدر تحذيراً.

---

## الأسبقية وإزالة التكرار مع المصادر الأخرى

يتم تجميع قدرة `extensions` عبر المزودين بواسطة سجل القدرات.

المزودون الحاليون لهذه القدرة:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) الأولوية `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) الأولوية `60`

مفتاح إزالة التكرار هو `ext.name` (`extensionCapability.key = ext => ext.name`).

### الأسبقية بين المزودين

المزود ذو الأولوية الأعلى يفوز عند تكرار أسماء الملحقات.

- إذا أصدر كل من `native` و `gemini` ملحقاً بالاسم `foo`، يتم الاحتفاظ بعنصر native.
- يتم الاحتفاظ بالتكرار ذي الأولوية الأقل فقط في `result.all` مع `_shadowed = true`.

### تأثيرات الترتيب داخل المزود

لأن إزالة التكرار تعمل بمبدأ "الأول المُشاهد يفوز"، فإن ترتيب العناصر المحلي للمزود مهم.

- مُحمّل Gemini يُلحق **المستخدم أولاً**، ثم **المشروع**.
- لذلك، الأسماء المكررة بين `~/.gemini/extensions` و `<cwd>/.gemini/extensions` تحتفظ بإدخال المستخدم وتُظلل إدخال المشروع.

على النقيض، يبني المزود native ترتيب أدلة التكوين بشكل مختلف (`project` ثم `user` في `getConfigDirs()`)، لذا التظليل داخل المزود native يكون بالاتجاه المعاكس.

---

## ملخص سلوك المستخدم مقابل المشروع

بالنسبة لملفات تعريف Gemini تحديداً:

- يتم فحص جذري المستخدم والمشروع في كل عملية تحميل.
- جذر المشروع ثابت على `<cwd>/.gemini/extensions` (بدون تنقل في الأدلة الأب).
- الأسماء المكررة داخل مصدر Gemini تُحل لصالح المستخدم أولاً.
- الأسماء المكررة مقابل مزودين ذوي أولوية أعلى (خاصة native) تخسر بالأولوية.

---

## الحدود: بيانات الاكتشاف الوصفية مقابل تحميل الملحقات أثناء التشغيل

اكتشاف `gemini-extension.json` حالياً يُغذي بيانات القدرة الوصفية (عناصر `Extension`). وهو **لا** يُحمّل مباشرة وحدات ملحقات TS/JS القابلة للتشغيل.

تحميل الوحدات أثناء التشغيل (`discoverAndLoadExtensions()` / `loadExtensions()`) يستخدم `extension-modules` ومسارات صريحة، ويُصفّي حالياً الوحدات المكتشفة تلقائياً للمزود `native` فقط.

الأثر العملي:

- ملحقات ملف تعريف Gemini قابلة للاكتشاف كسجلات قدرات.
- لكنها لا تُنفَّذ بذاتها كوحدات ملحقات قابلة للتشغيل بواسطة خط أنابيب تحميل الملحقات.

هذا الحد مقصود في التنفيذ الحالي ويُفسر لماذا يمكن أن يتباين اكتشاف ملف التعريف وتحميل الوحدات القابلة للتنفيذ.
