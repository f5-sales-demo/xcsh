---
title: خط أنابيب مطابقة كتاب القواعد
description: >-
  خط أنابيب مطابقة كتاب القواعد لاختيار مجموعات التعليمات الخاصة بالسياق
  وتطبيقها على جلسات الوكيل.
sidebar:
  order: 6
  label: مطابقة كتاب القواعد
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# خط أنابيب مطابقة كتاب القواعد

يصف هذا المستند كيفية اكتشاف وكيل البرمجة للقواعد من تنسيقات الإعداد المدعومة، وتطبيعها في شكل `Rule` موحّد، وحل تعارضات الأسبقية، وتقسيم الناتج إلى:

- **قواعد كتاب القواعد** (متاحة للنموذج عبر موجّه النظام + عناوين URL من النوع `rule://`)
- **قواعد TTSR** (قواعد مقاطعة تدفق السفر عبر الزمن)

يعكس هذا المستند التنفيذ الحالي، بما في ذلك الدلالات الجزئية والبيانات الوصفية التي تُحلَّل ولكن لا تُطبَّق.

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

تُطبِّع جميع الموفِّرين ملفات المصدر إلى `Rule`:

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

النتيجة: الأسبقية وإزالة التكرار تعتمدان على **الاسم فقط**. يُعتبر ملفان مختلفان يحملان الاسم `name` ذاته قاعدةً منطقية واحدة.

## 2. مصادر الاكتشاف والتطبيع

يُسجِّل `src/discovery/index.ts` الموفِّرين تلقائيًا. بالنسبة لـ `rules`، الموفِّرون الحاليون هم:

- `native` (الأولوية `100`)
- `cursor` (الأولوية `50`)
- `windsurf` (الأولوية `50`)
- `cline` (الأولوية `40`)

### الموفِّر الأصلي (`builtin.ts`)

يُحمِّل قواعد `.xcsh` من:

- المشروع: `<cwd>/.xcsh/rules/*.{md,mdc}`
- المستخدم: `~/.xcsh/agent/rules/*.{md,mdc}`

التطبيع:

- `name` = اسم الملف بدون `.md`/`.mdc`
- يُحلَّل الـ frontmatter عبر `parseFrontmatter`
- `content` = الجسم (بعد إزالة frontmatter)
- يُعيَّن كلٌّ من `globs` و`alwaysApply` و`description` و`ttsr_trigger` مباشرةً

تحفظ مهم: يُصنَّف `globs` كـ `string[] | undefined` دون تصفية للعناصر في هذا الموفِّر.

### موفِّر Cursor (`cursor.ts`)

يُحمِّل من:

- المستخدم: `~/.cursor/rules/*.{mdc,md}`
- المشروع: `<cwd>/.cursor/rules/*.{mdc,md}`

التطبيع (`transformMDCRule`):

- `description`: يُحتفظ به فقط إذا كان من نوع string
- `alwaysApply`: يُحتفظ بـ `true` فقط (`false` يصبح `undefined`)
- `globs`: يقبل مصفوفة (عناصر string فقط) أو string مفردة
- `ttsr_trigger`: string فقط
- `name` من اسم الملف بدون الامتداد

### موفِّر Windsurf (`windsurf.ts`)

يُحمِّل من:

- المستخدم: `~/.codeium/windsurf/memories/global_rules.md` (اسم القاعدة الثابت `global_rules`)
- المشروع: `<cwd>/.windsurf/rules/*.md`

التطبيع:

- `globs`: مصفوفة-من-string أو string مفردة
- `alwaysApply` و`description` مُصنَّفان من frontmatter
- `ttsr_trigger`: string فقط
- `name` من اسم الملف لقواعد المشروع

### موفِّر Cline (`cline.ts`)

يبحث من `cwd` صعودًا عن أقرب `.clinerules`:

- إذا كان مجلدًا: يُحمِّل `*.md` بداخله
- إذا كان ملفًا: يُحمِّل ملفًا واحدًا كقاعدة باسم `clinerules`

التطبيع:

- `globs`: مصفوفة-من-string أو string مفردة
- `alwaysApply`: فقط إذا كان من نوع boolean
- `description`: string فقط
- `ttsr_trigger`: string فقط

## 3. سلوك تحليل frontmatter والغموض

تستخدم جميع الموفِّرين `parseFrontmatter` (`utils/frontmatter.ts`) بهذه الدلالات:

1. يُحلَّل frontmatter فقط عندما يبدأ المحتوى بـ `---` ويحتوي على إغلاق `\n---`.
2. يُقطَّع الجسم بعد استخراج frontmatter.
3. إذا فشل تحليل YAML:
   - يُسجَّل تحذير،
   - يعود المحلِّل إلى تحليل سطري بسيط للنوع `key: value` (`^(\w+):\s*(.*)$`).

عواقب الغموض:

- لا يدعم المحلِّل الاحتياطي المصفوفاتِ أو الكائناتِ المتداخلة أو قواعد الاقتباس أو المفاتيح ذات الواصلات.
- تصبح قيم المحلِّل الاحتياطي strings (مثلاً `alwaysApply: true` تصبح string `"true"`)، لذا قد تتجاهل الموفِّرون الذين يشترطون أنواع boolean/string البياناتِ الوصفية.
- يعمل `ttsr_trigger` في المحلِّل الاحتياطي (مفتاح بالشرطة السفلية)؛ أما المفاتيح مثل `thinking-level` فلا تعمل.
- تُحمَّل الملفات التي لا تحتوي على frontmatter صالح كقواعد ببيانات وصفية فارغة وجسم المحتوى كاملاً.

## 4. أسبقية الموفِّر وإزالة التكرار

يدمج `loadCapability("rules")` (`capability/index.ts`) مخرجات الموفِّرين ثم يُزيل التكرار حسب `rule.name`.

### نموذج الأسبقية

- يُرتَّب الموفِّرون تنازليًا حسب الأولوية.
- الأولوية المتساوية تُحافظ على ترتيب التسجيل (`cursor` قبل `windsurf` من `discovery/index.ts`).
- إزالة التكرار بمبدأ الفوز الأول: يُحتفظ بأول اسم قاعدة يُصادَف؛ العناصر اللاحقة بالاسم ذاته تُوسَم بـ `_shadowed` في `all` وتُستبعَد من `items`.

ترتيب موفِّري القواعد الفعلي حاليًا هو:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### تحفظ ترتيب الموفِّر الداخلي

داخل الموفِّر، يأتي ترتيب العناصر من نتائج glob في `loadFilesFromDir` إضافةً إلى ترتيب الإلحاق الصريح. هذا الترتيب حتمي بما يكفي للاستخدام العادي لكنه ليس مُرتَّبًا صراحةً في الكود.

الفوارق الجديرة بالملاحظة في ترتيب المصدر:

- يُلحق `native` مجلدات الإعداد الخاصة بالمشروع ثم المستخدم.
- يُلحق `cursor` نتائج المستخدم ثم المشروع.
- يُلحق `windsurf` المستخدم `global_rules` أولاً ثم قواعد المشروع.
- يُحمِّل `cline` مصدر `.clinerules` الأقرب فقط.

## 5. التقسيم إلى حاويات Rulebook وAlways-Apply وTTSR

بعد اكتشاف القواعد في `createAgentSession` (`sdk.ts`):

1. تُفحَص جميع القواعد المكتشفة.
2. تُسجَّل القواعد التي تحتوي على `condition` (مفتاح frontmatter؛ يُقبَل `ttsr_trigger` / `ttsrTrigger` كبديل احتياطي) في `TtsrManager`.
3. تُبنى قائمة `rulebookRules` منفصلة بهذا المحدِّد:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. تُبنى قائمة `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### سلوك الحاويات

- **حاوية TTSR**: أي قاعدة تحتوي على `condition` (لا يُشترط وجود description). تأخذ الأولوية على الحاويات الأخرى.
- **حاوية Always-apply**: `alwaysApply === true`، ليست TTSR. يُحقَن محتواها الكامل في موجّه النظام. قابلة للوصول عبر `rule://`.
- **حاوية Rulebook**: يجب أن تحتوي على description، وألا تكون TTSR، وألا تكون `alwaysApply`. تُدرج في موجّه النظام بالاسم والوصف؛ يُقرأ محتواها عند الطلب عبر `rule://`.
- القاعدة التي تحتوي على `condition` و`alwaysApply` معًا تنتقل إلى TTSR فقط (TTSR لها الأولوية).
- القاعدة التي تحتوي على `alwaysApply` و`description` معًا تنتقل إلى always-apply فقط (لا إلى rulebook).

## 6. كيف تؤثر البيانات الوصفية على أسطح وقت التشغيل

### `description`

- مطلوبة للإدراج في كتاب القواعد.
- تُعرض في كتلة `<rules>` بموجّه النظام.
- غياب description يعني أن القاعدة غير متاحة عبر `rule://` وغير مدرجة في قواعد موجّه النظام.

### `globs`

- تُنقَل عبر `Rule`.
- تُعرض كإدخالات `<glob>...</glob>` في كتلة قواعد موجّه النظام.
- مكشوفة في حالة واجهة مستخدم القواعد (قائمة وضع `extensions`).
- **غير مطبَّقة للمطابقة التلقائية في هذا الخط.** لا يوجد مطابق glob في وقت التشغيل يختار القواعد حسب الملف الحالي أو هدف الأداة.

### `alwaysApply`

- مُحلَّل ومحتفَظ به من قِبَل الموفِّرين.
- مستخدَم في عرض واجهة المستخدم (تسمية المشغِّل `"always"` في مدير حالة الإضافات).
- مستخدَم كشرط استبعاد من `rulebookRules`.
- **يُحقَن محتوى القاعدة الكامل تلقائيًا في موجّه النظام** (قبل قسم قواعد كتاب القواعد).
- القاعدة قابلة للعنونة أيضًا عبر `rule://<name>` لإعادة القراءة.

### `ttsr_trigger`

- يُعيَّن إلى `rule.ttsrTrigger`.
- إذا كان موجودًا، تُوجَّه القاعدة إلى مدير TTSR، لا إلى كتاب القواعد.

## 7. مسار الإدراج في موجّه النظام

يستقبل `buildSystemPromptInternal` كلاً من `rules` (كتاب القواعد) و`alwaysApplyRules`.

تُعرض قواعد always-apply أولاً، مع حقن محتواها الخام مباشرةً في الموجّه.

تُعرض قواعد كتاب القواعد في قسم `# Rules` مع:

- `Read rule://<name> when working in matching domain`
- `name` و`description` لكل قاعدة، وقائمة `<glob>` الاختيارية

هذا إرشادي/سياقي: ينص نص الموجّه على طلب النموذج قراءة القواعد القابلة للتطبيق، لكن الكود لا يُطبِّق قابلية تطبيق glob.

## 8. سلوك عنوان URL الداخلي `rule://`

يُسجَّل `RuleProtocolHandler` بـ:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

الاستنتاجات:

- يُحلَّل `rule://<name>` مقابل كلٍّ من **rulebookRules** و**alwaysApplyRules**.
- قواعد TTSR الحصرية والقواعد التي لا تحتوي على description ولا `alwaysApply` غير قابلة للعنونة عبر `rule://`.
- التحليل يعتمد على المطابقة الدقيقة للاسم.
- الأسماء غير المعروفة تُرجع خطأً يسرد أسماء القواعد المتاحة.
- المحتوى المُرجَع هو `rule.content` الخام (مع إزالة frontmatter)، من نوع المحتوى `text/markdown`.

## 9. الدلالات الجزئية / غير المطبَّقة المعروفة

1. تذكر أوصاف الموفِّرين ملفات قديمة (`.cursorrules`، `.windsurfrules`)، لكن مسارات كود التحميل الحالية لا تقرأ تلك الملفات فعليًا.
2. بيانات `globs` الوصفية مكشوفة للموجّه/واجهة المستخدم لكنها غير مطبَّقة بواسطة منطق اختيار القواعد.
3. اختيار القواعد لـ `rule://` يشمل قواعد rulebook وalways-apply، لكن لا يشمل قواعد TTSR الحصرية.
4. تُنتَج تحذيرات الاكتشاف (`loadCapability("rules").warnings`) لكن `createAgentSession` لا تعرضها/تسجِّلها حاليًا في هذا المسار.
