---
title: Rulebook Matching Pipeline
description: >-
  Rulebook matching pipeline for selecting and applying context-specific
  instruction sets to agent sessions.
sidebar:
  order: 6
  label: مطابقة كتاب القواعد
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# خط أنابيب مطابقة كتاب القواعد

يصف هذا المستند كيف يكتشف coding-agent القواعد من تنسيقات التكوين المدعومة، ويوحّدها في شكل `Rule` واحد، ويحل تعارضات الأولوية، ويقسم النتيجة إلى:

- **قواعد كتاب القواعد** (متاحة للنموذج عبر موجّه النظام + عناوين URL من نوع `rule://`)
- **قواعد TTSR** (قواعد مقاطعة تدفق السفر عبر الزمن)

يعكس هذا المستند التنفيذ الحالي، بما في ذلك الدلالات الجزئية والبيانات الوصفية التي يتم تحليلها ولكن لا يتم فرضها.

## ملفات التنفيذ

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. الشكل القانوني للقاعدة

تقوم جميع الموفّرات بتوحيد ملفات المصدر في `Rule`:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

هوية القدرة هي `rule.name` (`ruleCapability.key = rule => rule.name`).

النتيجة: الأولوية وإزالة التكرار تعتمدان **على الاسم فقط**. ملفان مختلفان بنفس `name` يُعتبران نفس القاعدة المنطقية.

## 2. مصادر الاكتشاف والتوحيد

يقوم `src/discovery/index.ts` بتسجيل الموفّرات تلقائيًا. بالنسبة لـ `rules`، الموفّرات الحالية هي:

- `native` (الأولوية `100`)
- `cursor` (الأولوية `50`)
- `windsurf` (الأولوية `50`)
- `cline` (الأولوية `40`)

### الموفّر الأصلي (`builtin.ts`)

يحمّل قواعد `.xcsh` من:

- المشروع: `<cwd>/.xcsh/rules/*.{md,mdc}`
- المستخدم: `~/.xcsh/agent/rules/*.{md,mdc}`

التوحيد:

- `name` = اسم الملف بدون `.md`/`.mdc`
- يتم تحليل البيانات الأمامية عبر `parseFrontmatter`
- `content` = المحتوى (بعد إزالة البيانات الأمامية)
- `globs`، `alwaysApply`، `description`، `ttsr_trigger` يتم ربطها مباشرة

تحذير مهم: يتم تحويل `globs` كـ `string[] | undefined` بدون تصفية العناصر في هذا الموفّر.

### موفّر Cursor (`cursor.ts`)

يحمّل من:

- المستخدم: `~/.cursor/rules/*.{mdc,md}`
- المشروع: `<cwd>/.cursor/rules/*.{mdc,md}`

التوحيد (`transformMDCRule`):

- `description`: يُحتفظ به فقط إذا كان نصًا
- `alwaysApply`: يُحتفظ فقط بـ `true` (`false` يصبح `undefined`)
- `globs`: يقبل مصفوفة (عناصر نصية فقط) أو نص مفرد
- `ttsr_trigger`: نص فقط
- `name` من اسم الملف بدون الامتداد

### موفّر Windsurf (`windsurf.ts`)

يحمّل من:

- المستخدم: `~/.codeium/windsurf/memories/global_rules.md` (اسم قاعدة ثابت `global_rules`)
- المشروع: `<cwd>/.windsurf/rules/*.md`

التوحيد:

- `globs`: مصفوفة نصية أو نص مفرد
- `alwaysApply`، `description` يتم تحويلها من البيانات الأمامية
- `ttsr_trigger`: نص فقط
- `name` من اسم الملف لقواعد المشروع

### موفّر Cline (`cline.ts`)

يبحث صعودًا من `cwd` عن أقرب `.clinerules`:

- إذا كان مجلدًا: يحمّل ملفات `*.md` بداخله
- إذا كان ملفًا: يحمّل ملفًا واحدًا كقاعدة باسم `clinerules`

التوحيد:

- `globs`: مصفوفة نصية أو نص مفرد
- `alwaysApply`: فقط إذا كانت قيمة منطقية
- `description`: نص فقط
- `ttsr_trigger`: نص فقط

## 3. سلوك تحليل البيانات الأمامية والغموض

تستخدم جميع الموفّرات `parseFrontmatter` (`utils/frontmatter.ts`) بالدلالات التالية:

1. يتم تحليل البيانات الأمامية فقط عندما يبدأ المحتوى بـ `---` ويحتوي على إغلاق `\n---`.
2. يتم قص المحتوى بعد استخراج البيانات الأمامية.
3. إذا فشل تحليل YAML:
   - يتم تسجيل تحذير،
   - يتراجع المحلل إلى تحليل بسيط سطرًا بسطر `key: value` (`^(\w+):\s*(.*)$`).

عواقب الغموض:

- المحلل الاحتياطي لا يدعم المصفوفات، والكائنات المتداخلة، وقواعد التنصيص، أو المفاتيح ذات الشرطات.
- تصبح القيم الاحتياطية نصوصًا (على سبيل المثال `alwaysApply: true` تصبح النص `"true"`)، لذا قد تُسقط الموفّرات التي تتطلب أنواعًا منطقية/نصية البيانات الوصفية.
- `ttsr_trigger` يعمل في الوضع الاحتياطي (مفتاح بشرطة سفلية)؛ المفاتيح مثل `thinking-level` لن تعمل.
- الملفات التي لا تحتوي على بيانات أمامية صالحة لا تزال تُحمّل كقواعد ببيانات وصفية فارغة ومحتوى كامل.

## 4. أولوية الموفّرات وإزالة التكرار

يقوم `loadCapability("rules")` (`capability/index.ts`) بدمج مخرجات الموفّرات ثم إزالة التكرار بناءً على `rule.name`.

### نموذج الأولوية

- يتم ترتيب الموفّرات حسب الأولوية تنازليًا.
- الأولوية المتساوية تحافظ على ترتيب التسجيل (`cursor` قبل `windsurf` من `discovery/index.ts`).
- إزالة التكرار تعتمد على الأول يفوز: أول اسم قاعدة يتم مواجهته يُحتفظ به؛ العناصر اللاحقة بنفس الاسم تُعلّم كـ `_shadowed` في `all` وتُستبعد من `items`.

الترتيب الفعلي الحالي لموفّرات القواعد هو:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### تحذير بشأن الترتيب داخل الموفّر

داخل الموفّر، يأتي ترتيب العناصر من نتيجة glob في `loadFilesFromDir` بالإضافة إلى ترتيب الإضافة الصريح. هذا حتمي بما يكفي للاستخدام العادي لكنه غير مرتب صراحةً في الكود.

فروقات ملحوظة في ترتيب المصدر:

- `native` يضيف مجلدات تكوين المشروع ثم المستخدم.
- `cursor` يضيف نتائج المستخدم ثم المشروع.
- `windsurf` يضيف `global_rules` الخاصة بالمستخدم أولًا، ثم قواعد المشروع.
- `cline` يحمّل فقط من أقرب مصدر `.clinerules`.

## 5. التقسيم إلى حاويات كتاب القواعد، والتطبيق الدائم، وTTSR

بعد اكتشاف القواعد في `createAgentSession` (`sdk.ts`):

1. يتم فحص جميع القواعد المكتشفة.
2. القواعد التي تحتوي على `condition` (مفتاح بيانات أمامية؛ `ttsr_trigger` / `ttsrTrigger` مقبولة كبديل) يتم تسجيلها في `TtsrManager`.
3. يتم بناء قائمة `rulebookRules` منفصلة بالشرط التالي:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. يتم بناء قائمة `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### سلوك الحاويات

- **حاوية TTSR**: أي قاعدة تحتوي على `condition` (الوصف غير مطلوب). تأخذ الأولوية على الحاويات الأخرى.
- **حاوية التطبيق الدائم**: `alwaysApply === true`، ليست TTSR. يتم حقن المحتوى الكامل في موجّه النظام. قابلة للحل عبر `rule://`.
- **حاوية كتاب القواعد**: يجب أن تحتوي على وصف، ويجب ألا تكون TTSR، ويجب ألا تكون `alwaysApply`. تُدرج في موجّه النظام بالاسم+الوصف؛ يُقرأ المحتوى عند الطلب عبر `rule://`.
- القاعدة التي تحتوي على كلٍّ من `condition` و`alwaysApply` تذهب إلى TTSR فقط (TTSR تأخذ الأولوية).
- القاعدة التي تحتوي على كلٍّ من `alwaysApply` و`description` تذهب إلى التطبيق الدائم فقط (ليست كتاب قواعد).

## 6. كيف تؤثر البيانات الوصفية على أسطح وقت التشغيل

### `description`

- مطلوب للتضمين في كتاب القواعد.
- يُعرض في كتلة `<rules>` في موجّه النظام.
- غياب الوصف يعني أن القاعدة غير متاحة عبر `rule://` وغير مدرجة في قواعد موجّه النظام.

### `globs`

- يتم نقله مع `Rule`.
- يُعرض كمدخلات `<glob>...</glob>` في كتلة قواعد موجّه النظام.
- يُكشف في حالة واجهة القواعد (قائمة وضع `extensions`).
- **لا يتم فرضه للمطابقة التلقائية في هذا الخط الأنبوبي.** لا يوجد مطابق glob في وقت التشغيل يختار القواعد بناءً على الملف الحالي/هدف الأداة.

### `alwaysApply`

- يتم تحليله والحفاظ عليه بواسطة الموفّرات.
- يُستخدم في عرض واجهة المستخدم (تسمية المحفّز `"always"` في مدير حالة الإضافات).
- يُستخدم كشرط استبعاد من `rulebookRules`.
- **يتم حقن محتوى القاعدة الكامل تلقائيًا في موجّه النظام** (قبل قسم قواعد كتاب القواعد).
- القاعدة قابلة أيضًا للوصول عبر `rule://<name>` لإعادة القراءة.

### `ttsr_trigger`

- يُربط بـ `rule.ttsrTrigger`.
- إذا كان موجودًا، يتم توجيه القاعدة إلى مدير TTSR، وليس كتاب القواعد.

## 7. مسار التضمين في موجّه النظام

يستقبل `buildSystemPromptInternal` كلًا من `rules` (كتاب القواعد) و`alwaysApplyRules`.

يتم عرض قواعد التطبيق الدائم أولًا، مع حقن محتواها الخام مباشرةً في الموجّه.

يتم عرض قواعد كتاب القواعد في قسم `# Rules` مع:

- `Read rule://<name> when working in matching domain`
- اسم كل قاعدة، ووصفها، وقائمة `<glob>` الاختيارية

هذا استشاري/سياقي: نص الموجّه يطلب من النموذج قراءة القواعد المطبّقة، لكن الكود لا يفرض تطبيق glob.

## 8. سلوك عنوان URL الداخلي `rule://`

يتم تسجيل `RuleProtocolHandler` مع:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

الآثار المترتبة:

- `rule://<name>` يُحل مقابل كلٍّ من **rulebookRules** و**alwaysApplyRules**.
- قواعد TTSR فقط والقواعد التي لا تحتوي على وصف ولا `alwaysApply` غير قابلة للوصول عبر `rule://`.
- الحل يعتمد على مطابقة الاسم الدقيقة.
- الأسماء غير المعروفة تُرجع خطأ مع قائمة بأسماء القواعد المتاحة.
- المحتوى المُرجع هو `rule.content` الخام (بعد إزالة البيانات الأمامية)، نوع المحتوى `text/markdown`.

## 9. الدلالات الجزئية / غير المفروضة المعروفة

1. أوصاف الموفّرات تذكر ملفات قديمة (`.cursorrules`، `.windsurfrules`)، لكن مسارات كود التحميل الحالية لا تقرأ تلك الملفات فعليًا.
2. بيانات `globs` الوصفية تُعرض في الموجّه/واجهة المستخدم لكن لا يتم فرضها بواسطة منطق اختيار القواعد.
3. اختيار القواعد لـ `rule://` يشمل قواعد كتاب القواعد وقواعد التطبيق الدائم، لكن ليس قواعد TTSR فقط.
4. تحذيرات الاكتشاف (`loadCapability("rules").warnings`) يتم إنتاجها لكن `createAgentSession` لا يعرضها/يسجّلها حاليًا في هذا المسار.
