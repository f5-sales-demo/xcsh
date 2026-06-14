---
title: خط أنابيب مطابقة كتيب القواعد
description: >-
  خط أنابيب مطابقة كتيب القواعد لاختيار مجموعات التعليمات الخاصة بالسياق
  وتطبيقها على جلسات الوكيل.
sidebar:
  order: 6
  label: مطابقة كتيب القواعد
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# خط أنابيب مطابقة كتيب القواعد

يصف هذا المستند كيفية اكتشاف وكيل البرمجة للقواعد من صيغ التهيئة المدعومة، وتطبيعها في شكل `Rule` موحّد، وحل تعارضات الأولوية، وتقسيم النتيجة إلى:

- **قواعد كتيب القواعد** (متاحة للنموذج عبر موجه النظام + عناوين URL من نوع `rule://`)
- **قواعد TTSR** (قواعد مقاطعة تدفق السفر عبر الزمن)

يعكس هذا المستند التطبيق الحالي، بما فيه الدلالات الجزئية والبيانات الوصفية التي يتم تحليلها دون تطبيقها.

## ملفات التطبيق

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

تقوم جميع الموفّرات بتطبيع الملفات المصدرية إلى `Rule`:

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

النتيجة: الأولوية وإزالة التكرار تعتمدان **على الاسم فقط**. يُعدّ ملفان مختلفان بالاسم ذاته قاعدةً منطقية واحدة.

## 2. مصادر الاكتشاف والتطبيع

يقوم `src/discovery/index.ts` بتسجيل الموفّرات تلقائياً. بالنسبة لـ `rules`، الموفّرات الحالية هي:

- `native` (الأولوية `100`)
- `cursor` (الأولوية `50`)
- `windsurf` (الأولوية `50`)
- `cline` (الأولوية `40`)

### الموفّر الأصلي (`builtin.ts`)

يحمّل قواعد `.xcsh` من:

- المشروع: `<cwd>/.xcsh/rules/*.{md,mdc}`
- المستخدم: `~/.xcsh/agent/rules/*.{md,mdc}`

التطبيع:

- `name` = اسم الملف بدون `.md`/`.mdc`
- يتم تحليل الـ frontmatter عبر `parseFrontmatter`
- `content` = النص الأساسي (بعد استخراج الـ frontmatter)
- يتم تعيين `globs` و`alwaysApply` و`description` و`ttsr_trigger` مباشرةً

تحفّظ مهم: يتم تحويل `globs` إلى `string[] | undefined` دون تصفية عناصرها في هذا الموفّر.

### موفّر Cursor (`cursor.ts`)

يحمّل من:

- المستخدم: `~/.cursor/rules/*.{mdc,md}`
- المشروع: `<cwd>/.cursor/rules/*.{mdc,md}`

التطبيع (`transformMDCRule`):

- `description`: يُحتفظ به فقط إذا كان نصاً
- `alwaysApply`: يُحتفظ بـ `true` فقط (`false` تصبح `undefined`)
- `globs`: يقبل مصفوفة (عناصر نصية فقط) أو نصاً مفرداً
- `ttsr_trigger`: نص فقط
- `name` من اسم الملف بدون الامتداد

### موفّر Windsurf (`windsurf.ts`)

يحمّل من:

- المستخدم: `~/.codeium/windsurf/memories/global_rules.md` (اسم القاعدة الثابت `global_rules`)
- المشروع: `<cwd>/.windsurf/rules/*.md`

التطبيع:

- `globs`: مصفوفة نصوص أو نص مفرد
- `alwaysApply` و`description` مُحوَّلان من الـ frontmatter
- `ttsr_trigger`: نص فقط
- `name` من اسم الملف لقواعد المشروع

### موفّر Cline (`cline.ts`)

يبحث للأعلى من `cwd` عن أقرب `.clinerules`:

- إذا كان دليلاً: يحمّل ملفات `*.md` بداخله
- إذا كان ملفاً: يحمّل الملف الفردي كقاعدة باسم `clinerules`

التطبيع:

- `globs`: مصفوفة نصوص أو نص مفرد
- `alwaysApply`: فقط إذا كان قيمة منطقية
- `description`: نص فقط
- `ttsr_trigger`: نص فقط

## 3. سلوك تحليل الـ frontmatter وحالات الغموض

تستخدم جميع الموفّرات `parseFrontmatter` (`utils/frontmatter.ts`) وفق الدلالات التالية:

1. يتم تحليل الـ frontmatter فقط عندما يبدأ المحتوى بـ `---` ويحتوي على إغلاق `\n---`.
2. يتم تقليص النص الأساسي بعد استخراج الـ frontmatter.
3. إذا فشل تحليل YAML:
   - تُسجَّل رسالة تحذير،
   - يعود المحلّل إلى تحليل بسيط من نوع `key: value` للأسطر (`^(\w+):\s*(.*)$`).

تبعات حالات الغموض:

- لا يدعم المحلّل الاحتياطي المصفوفات أو الكائنات المتداخلة أو قواعد الاقتباس أو المفاتيح ذات الشرطة.
- تصبح القيم الاحتياطية نصوصاً (على سبيل المثال: `alwaysApply: true` تصبح النص `"true"`)، لذا قد تُسقط الموفّرات التي تتطلب أنواع منطقية/نصية البيانات الوصفية.
- يعمل `ttsr_trigger` في الوضع الاحتياطي (مفتاح بالشرطة السفلية)؛ أما المفاتيح مثل `thinking-level` فلا تعمل.
- تُحمَّل الملفات التي لا تحتوي على frontmatter صالح كقواعد ببيانات وصفية فارغة ونص محتوى كامل.

## 4. أولوية الموفّر وإزالة التكرار

يدمج `loadCapability("rules")` (`capability/index.ts`) مخرجات الموفّرات ثم يزيل التكرار بناءً على `rule.name`.

### نموذج الأولوية

- تُرتَّب الموفّرات تنازلياً حسب الأولوية.
- الأولوية المتساوية تحتفظ بترتيب التسجيل (`cursor` قبل `windsurf` من `discovery/index.ts`).
- إزالة التكرار تعتمد مبدأ الأول يُحتفظ به: يتم الاحتفاظ بأول اسم قاعدة مُكتشَف؛ وتُعلَّم العناصر اللاحقة بالاسم ذاته بـ `_shadowed` في `all` وتُستبعد من `items`.

ترتيب موفّرات القواعد الفعلي حالياً هو:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### تحفّظ الترتيب داخل الموفّر

داخل الموفّر الواحد، يأتي ترتيب العناصر من ترتيب نتائج glob في `loadFilesFromDir` بالإضافة إلى ترتيب الإضافة الصريح. وهو محدد بشكل كافٍ للاستخدام العادي لكنه غير مفروز صراحةً في الكود.

اختلافات ترتيب المصدر البارزة:

- `native` يُلحق دلائل إعداد المشروع ثم المستخدم.
- `cursor` يُلحق نتائج المستخدم ثم المشروع.
- `windsurf` يُلحق `global_rules` الخاصة بالمستخدم أولاً، ثم قواعد المشروع.
- `cline` يحمّل فقط أقرب مصدر `.clinerules`.

## 5. التقسيم إلى حاويات كتيب القواعد والتطبيق الدائم وTTSR

بعد اكتشاف القواعد في `createAgentSession` (`sdk.ts`):

1. يتم فحص جميع القواعد المكتشفة.
2. تُسجَّل القواعد التي تحتوي على `condition` (مفتاح frontmatter؛ يُقبل `ttsr_trigger` / `ttsrTrigger` كبديل) في `TtsrManager`.
3. يُبنى قائمة `rulebookRules` منفصلة وفق هذا الشرط:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. تُبنى قائمة `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### سلوك الحاويات

- **حاوية TTSR**: أي قاعدة تحتوي على `condition` (الوصف غير مطلوب). تأخذ أولوية على الحاويات الأخرى.
- **حاوية التطبيق الدائم**: `alwaysApply === true`، وليست TTSR. يُحقن محتواها الكامل في موجه النظام. قابلة للوصول عبر `rule://`.
- **حاوية كتيب القواعد**: يجب أن تحتوي على وصف، وألا تكون TTSR، وألا تكون `alwaysApply`. تُدرج في موجه النظام بالاسم والوصف؛ يُقرأ محتواها عند الطلب عبر `rule://`.
- القاعدة التي تحتوي على كلٍّ من `condition` و`alwaysApply` تذهب إلى TTSR فقط (TTSR لها الأولوية).
- القاعدة التي تحتوي على كلٍّ من `alwaysApply` و`description` تذهب إلى التطبيق الدائم فقط (لا إلى كتيب القواعد).

## 6. تأثير البيانات الوصفية على الواجهات في وقت التشغيل

### `description`

- مطلوب للإدراج في كتيب القواعد.
- يُعرض في كتلة `<rules>` في موجه النظام.
- غياب الوصف يعني عدم توفر القاعدة عبر `rule://` وعدم إدراجها في قواعد موجه النظام.

### `globs`

- يُحمَل عبر `Rule`.
- يُعرض كإدخالات `<glob>...</glob>` في كتلة قواعد موجه النظام.
- يُكشف في حالة واجهة مستخدم القواعد (قائمة وضع `extensions`).
- **لا يُطبَّق للمطابقة التلقائية في هذا الخط.** لا يوجد مطابق glob في وقت التشغيل يختار القواعد بناءً على الملف الحالي أو هدف الأداة.

### `alwaysApply`

- يتم تحليله والحفاظ عليه من قِبل الموفّرات.
- يُستخدم في عرض واجهة المستخدم (تسمية المشغّل `"always"` في مدير حالة الإضافات).
- يُستخدم كشرط استبعاد من `rulebookRules`.
- **يُحقن محتوى القاعدة الكامل تلقائياً في موجه النظام** (قبل قسم قواعد كتيب القواعد).
- القاعدة قابلة للوصول أيضاً عبر `rule://<name>` لإعادة القراءة.

### `ttsr_trigger`

- يُعيَّن إلى `rule.ttsrTrigger`.
- إذا كان موجوداً، يتم توجيه القاعدة إلى مدير TTSR، لا إلى كتيب القواعد.

## 7. مسار الإدراج في موجه النظام

تستقبل `buildSystemPromptInternal` كلاً من `rules` (كتيب القواعد) و`alwaysApplyRules`.

تُعرض قواعد التطبيق الدائم أولاً، مع حقن محتواها الخام مباشرةً في الموجه.

تُعرض قواعد كتيب القواعد في قسم `# Rules` مع:

- `Read rule://<name> when working in matching domain`
- `name` كل قاعدة و`description` وقائمة `<glob>` الاختيارية

هذا إرشادي/سياقي: يطلب نص الموجه من النموذج قراءة القواعد المنطبقة، لكن الكود لا يُطبّق انطباق glob.

## 8. سلوك عنوان URL الداخلي `rule://`

يُسجَّل `RuleProtocolHandler` بـ:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

الآثار المترتبة:

- `rule://<name>` يُحلَّل مقابل **rulebookRules** و**alwaysApplyRules** معاً.
- قواعد TTSR فقط والقواعد التي لا تحتوي على وصف ولا `alwaysApply` لا يمكن الوصول إليها عبر `rule://`.
- الحل يعتمد على المطابقة الدقيقة للاسم.
- الأسماء غير المعروفة تُعيد خطأً يُدرج أسماء القواعد المتاحة.
- المحتوى المُعاد هو `rule.content` الخام (مع استخراج الـ frontmatter)، من نوع المحتوى `text/markdown`.

## 9. الدلالات الجزئية / غير المطبّقة المعروفة

1. تُشير أوصاف الموفّرات إلى ملفات قديمة (`.cursorrules`، `.windsurfrules`)، لكن مسارات كود المحمّل الحالية لا تقرأ تلك الملفات فعلياً.
2. تُكشف بيانات وصفية `globs` لموجه النظام/واجهة المستخدم لكنها لا تُطبَّق من قِبل منطق اختيار القواعد.
3. اختيار القاعدة لـ `rule://` يشمل قواعد كتيب القواعد وقواعد التطبيق الدائم، لكن ليس قواعد TTSR فقط.
4. تحذيرات الاكتشاف (`loadCapability("rules").warnings`) تُنتَج لكن `createAgentSession` لا تكشفها/تسجّلها حالياً في هذا المسار.
