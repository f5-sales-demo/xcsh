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

يصف هذا المستند كيف يكتشف coding-agent القواعد من تنسيقات التكوين المدعومة، ويُطبّعها في شكل `Rule` موحد، ويحل تعارضات الأسبقية، ويقسم النتيجة إلى:

- **قواعد كتاب القواعد** (متاحة للنموذج عبر موجه النظام + عناوين URL من نوع `rule://`)
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

## 1. شكل القاعدة القانوني

تُطبّع جميع الموفرين ملفات المصدر إلى `Rule`:

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

النتيجة: الأسبقية وإزالة التكرار تعتمد **على الاسم فقط**. ملفان مختلفان بنفس `name` يُعتبران نفس القاعدة المنطقية.

## 2. مصادر الاكتشاف والتطبيع

يقوم `src/discovery/index.ts` بتسجيل الموفرين تلقائياً. بالنسبة لـ `rules`، الموفرون الحاليون هم:

- `native` (الأولوية `100`)
- `cursor` (الأولوية `50`)
- `windsurf` (الأولوية `50`)
- `cline` (الأولوية `40`)

### الموفر الأصلي (`builtin.ts`)

يحمّل قواعد `.xcsh` من:

- المشروع: `<cwd>/.xcsh/rules/*.{md,mdc}`
- المستخدم: `~/.xcsh/agent/rules/*.{md,mdc}`

التطبيع:

- `name` = اسم الملف بدون `.md`/`.mdc`
- يتم تحليل الواجهة الأمامية عبر `parseFrontmatter`
- `content` = المتن (بعد إزالة الواجهة الأمامية)
- `globs`، `alwaysApply`، `description`، `ttsr_trigger` يتم تعيينها مباشرة

تحذير مهم: يتم تحويل `globs` كـ `string[] | undefined` بدون تصفية العناصر في هذا الموفر.

### موفر Cursor (`cursor.ts`)

يحمّل من:

- المستخدم: `~/.cursor/rules/*.{mdc,md}`
- المشروع: `<cwd>/.cursor/rules/*.{mdc,md}`

التطبيع (`transformMDCRule`):

- `description`: يُحتفظ بها فقط إذا كانت سلسلة نصية
- `alwaysApply`: يُحتفظ فقط بالقيمة `true` (تصبح `false` قيمة `undefined`)
- `globs`: يقبل مصفوفة (عناصر نصية فقط) أو سلسلة نصية واحدة
- `ttsr_trigger`: سلسلة نصية فقط
- `name` من اسم الملف بدون الامتداد

### موفر Windsurf (`windsurf.ts`)

يحمّل من:

- المستخدم: `~/.codeium/windsurf/memories/global_rules.md` (اسم قاعدة ثابت `global_rules`)
- المشروع: `<cwd>/.windsurf/rules/*.md`

التطبيع:

- `globs`: مصفوفة سلاسل نصية أو سلسلة نصية واحدة
- `alwaysApply`، `description` يتم تحويلها من الواجهة الأمامية
- `ttsr_trigger`: سلسلة نصية فقط
- `name` من اسم الملف لقواعد المشروع

### موفر Cline (`cline.ts`)

يبحث صعوداً من `cwd` عن أقرب `.clinerules`:

- إذا كان مجلداً: يحمّل ملفات `*.md` بداخله
- إذا كان ملفاً: يحمّل ملفاً واحداً كقاعدة باسم `clinerules`

التطبيع:

- `globs`: مصفوفة سلاسل نصية أو سلسلة نصية واحدة
- `alwaysApply`: فقط إذا كانت قيمة منطقية
- `description`: سلسلة نصية فقط
- `ttsr_trigger`: سلسلة نصية فقط

## 3. سلوك تحليل الواجهة الأمامية والغموض

تستخدم جميع الموفرين `parseFrontmatter` (`utils/frontmatter.ts`) بهذه الدلالات:

1. يتم تحليل الواجهة الأمامية فقط عندما يبدأ المحتوى بـ `---` ويحتوي على `\n---` كإغلاق.
2. يتم قص المتن بعد استخراج الواجهة الأمامية.
3. إذا فشل تحليل YAML:
   - يتم تسجيل تحذير،
   - يعود المحلل إلى تحليل سطري بسيط لنمط `key: value` (`^(\w+):\s*(.*)$`).

عواقب الغموض:

- المحلل الاحتياطي لا يدعم المصفوفات أو الكائنات المتداخلة أو قواعد الاقتباس أو المفاتيح ذات الواصلات.
- تصبح قيم المحلل الاحتياطي سلاسل نصية (مثلاً `alwaysApply: true` تصبح السلسلة النصية `"true"`)، لذلك قد يُسقط الموفرون الذين يتطلبون أنواع منطقية/نصية البيانات الوصفية.
- `ttsr_trigger` يعمل في المحلل الاحتياطي (مفتاح بشرطة سفلية)؛ مفاتيح مثل `thinking-level` لن تعمل.
- الملفات التي لا تحتوي على واجهة أمامية صالحة تُحمّل كقواعد ببيانات وصفية فارغة ومحتوى كامل.

## 4. أسبقية الموفرين وإزالة التكرار

يدمج `loadCapability("rules")` (`capability/index.ts`) مخرجات الموفرين ثم يزيل التكرار حسب `rule.name`.

### نموذج الأسبقية

- يتم ترتيب الموفرين حسب الأولوية تنازلياً.
- الأولوية المتساوية تحافظ على ترتيب التسجيل (`cursor` قبل `windsurf` من `discovery/index.ts`).
- إزالة التكرار بنظام الأول يفوز: أول اسم قاعدة يتم مواجهته يُحتفظ به؛ العناصر اللاحقة بنفس الاسم تُعلّم كـ `_shadowed` في `all` وتُستبعد من `items`.

ترتيب موفري القواعد الفعلي حالياً هو:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### تحذير بشأن الترتيب داخل الموفر

داخل الموفر، يأتي ترتيب العناصر من ترتيب نتيجة glob في `loadFilesFromDir` بالإضافة إلى ترتيب الإضافة الصريح. هذا حتمي بما يكفي للاستخدام العادي لكنه غير مُرتّب صراحةً في الكود.

اختلافات ملحوظة في ترتيب المصدر:

- `native` يُلحق مجلدات تكوين المشروع ثم المستخدم.
- `cursor` يُلحق نتائج المستخدم ثم المشروع.
- `windsurf` يُلحق `global_rules` للمستخدم أولاً، ثم قواعد المشروع.
- `cline` يحمّل فقط أقرب مصدر `.clinerules`.

## 5. التقسيم إلى حاويات كتاب القواعد والتطبيق الدائم و TTSR

بعد اكتشاف القواعد في `createAgentSession` (`sdk.ts`):

1. يتم فحص جميع القواعد المكتشفة.
2. القواعد التي تحتوي على `condition` (مفتاح واجهة أمامية؛ يُقبل `ttsr_trigger` / `ttsrTrigger` كبديل) تُسجّل في `TtsrManager`.
3. يتم بناء قائمة `rulebookRules` منفصلة بهذا الشرط:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. يتم بناء قائمة `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### سلوك الحاويات

- **حاوية TTSR**: أي قاعدة تحتوي على `condition` (الوصف غير مطلوب). لها الأولوية على الحاويات الأخرى.
- **حاوية التطبيق الدائم**: `alwaysApply === true`، ليست TTSR. يتم حقن المحتوى الكامل في موجه النظام. يمكن الوصول إليها عبر `rule://`.
- **حاوية كتاب القواعد**: يجب أن تحتوي على وصف، ويجب ألا تكون TTSR، ويجب ألا تكون `alwaysApply`. تُدرج في موجه النظام بالاسم + الوصف؛ يُقرأ المحتوى عند الطلب عبر `rule://`.
- القاعدة التي تحتوي على كل من `condition` و `alwaysApply` تذهب إلى TTSR فقط (TTSR لها الأولوية).
- القاعدة التي تحتوي على كل من `alwaysApply` و `description` تذهب إلى التطبيق الدائم فقط (وليس كتاب القواعد).

## 6. كيف تؤثر البيانات الوصفية على أسطح وقت التشغيل

### `description`

- مطلوب للإدراج في كتاب القواعد.
- يُعرض في كتلة `<rules>` في موجه النظام.
- عدم وجود الوصف يعني أن القاعدة غير متاحة عبر `rule://` وغير مدرجة في قواعد موجه النظام.

### `globs`

- يُنقل عبر `Rule`.
- يُعرض كإدخالات `<glob>...</glob>` في كتلة قواعد موجه النظام.
- يُعرض في حالة واجهة القواعد (قائمة وضع `extensions`).
- **لا يُفرض للمطابقة التلقائية في هذا الخط الأنابيب.** لا يوجد مُطابق glob في وقت التشغيل يختار القواعد حسب الملف الحالي/هدف الأداة.

### `alwaysApply`

- يتم تحليله والحفاظ عليه بواسطة الموفرين.
- يُستخدم في عرض واجهة المستخدم (تسمية مُشغّل `"always"` في مدير حالة الإضافات).
- يُستخدم كشرط استبعاد من `rulebookRules`.
- **يتم حقن محتوى القاعدة الكامل تلقائياً في موجه النظام** (قبل قسم قواعد كتاب القواعد).
- يمكن أيضاً الوصول إلى القاعدة عبر `rule://<name>` لإعادة القراءة.

### `ttsr_trigger`

- يُعيّن إلى `rule.ttsrTrigger`.
- إذا كان موجوداً، يتم توجيه القاعدة إلى مدير TTSR، وليس كتاب القواعد.

## 7. مسار الإدراج في موجه النظام

يستقبل `buildSystemPromptInternal` كلاً من `rules` (كتاب القواعد) و `alwaysApplyRules`.

يتم عرض قواعد التطبيق الدائم أولاً، مع حقن محتواها الخام مباشرة في الموجه.

يتم عرض قواعد كتاب القواعد في قسم `# Rules` مع:

- `Read rule://<name> when working in matching domain`
- اسم كل قاعدة و `description` وقائمة `<glob>` الاختيارية

هذا استرشادي/سياقي: يطلب نص الموجه من النموذج قراءة القواعد المطبّقة، لكن الكود لا يفرض قابلية تطبيق glob.

## 8. سلوك عنوان URL الداخلي `rule://`

يتم تسجيل `RuleProtocolHandler` مع:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

الآثار المترتبة:

- `rule://<name>` يُحلّ مقابل كل من **rulebookRules** و **alwaysApplyRules**.
- القواعد المخصصة لـ TTSR فقط والقواعد التي لا تحتوي على وصف ولا `alwaysApply` لا يمكن الوصول إليها عبر `rule://`.
- الحل يعتمد على مطابقة الاسم بالضبط.
- الأسماء غير المعروفة تُرجع خطأ يسرد أسماء القواعد المتاحة.
- المحتوى المُرجع هو `rule.content` الخام (بعد إزالة الواجهة الأمامية)، نوع المحتوى `text/markdown`.

## 9. دلالات جزئية / غير مُفرضة معروفة

1. تذكر أوصاف الموفرين ملفات قديمة (`.cursorrules`، `.windsurfrules`)، لكن مسارات كود التحميل الحالية لا تقرأ تلك الملفات فعلياً.
2. البيانات الوصفية لـ `globs` تُعرض في الموجه/واجهة المستخدم لكن لا تُفرض بواسطة منطق اختيار القواعد.
3. اختيار القواعد لـ `rule://` يشمل قواعد كتاب القواعد وقواعد التطبيق الدائم، لكن ليس قواعد TTSR فقط.
4. تحذيرات الاكتشاف (`loadCapability("rules").warnings`) تُنتج لكن `createAgentSession` لا يعرضها/يسجّلها حالياً في هذا المسار.
