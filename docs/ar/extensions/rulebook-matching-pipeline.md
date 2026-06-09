---
title: خط أنابيب مطابقة كتاب القواعد
description: >-
  خط أنابيب مطابقة كتاب القواعد لاختيار وتطبيق مجموعات التعليمات الخاصة بالسياق
  على جلسات الوكيل.
sidebar:
  order: 6
  label: مطابقة كتاب القواعد
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# خط أنابيب مطابقة كتاب القواعد

يصف هذا المستند كيف يكتشف coding-agent القواعد من تنسيقات التكوين المدعومة، ويُوحّدها في شكل `Rule` واحد، ويحل تعارضات الأسبقية، ويقسم النتيجة إلى:

- **قواعد كتاب القواعد** (متاحة للنموذج عبر موجه النظام + عناوين `rule://`)
- **قواعد TTSR** (قواعد مقاطعة تدفق السفر عبر الزمن)

يعكس هذا التنفيذ الحالي، بما في ذلك الدلالات الجزئية والبيانات الوصفية التي يتم تحليلها ولكن لا يتم فرضها.

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

جميع الموفرين يُوحّدون الملفات المصدرية إلى `Rule`:

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

النتيجة: الأسبقية وإزالة التكرار تعتمدان على **الاسم فقط**. ملفان مختلفان يحملان نفس `name` يُعتبران نفس القاعدة المنطقية.

## 2. مصادر الاكتشاف والتوحيد

`src/discovery/index.ts` يُسجّل الموفرين تلقائياً. بالنسبة لـ `rules`، الموفرون الحاليون هم:

- `native` (الأولوية `100`)
- `cursor` (الأولوية `50`)
- `windsurf` (الأولوية `50`)
- `cline` (الأولوية `40`)

### الموفر الأصلي (`builtin.ts`)

يحمّل قواعد `.xcsh` من:

- المشروع: `<cwd>/.xcsh/rules/*.{md,mdc}`
- المستخدم: `~/.xcsh/agent/rules/*.{md,mdc}`

التوحيد:

- `name` = اسم الملف بدون `.md`/`.mdc`
- يتم تحليل المقدمة الوصفية عبر `parseFrontmatter`
- `content` = المحتوى (بعد إزالة المقدمة الوصفية)
- `globs`، `alwaysApply`، `description`، `ttsr_trigger` يتم تعيينها مباشرة

تحذير مهم: يتم تحويل `globs` كـ `string[] | undefined` بدون تصفية للعناصر في هذا الموفر.

### موفر Cursor (`cursor.ts`)

يحمّل من:

- المستخدم: `~/.cursor/rules/*.{mdc,md}`
- المشروع: `<cwd>/.cursor/rules/*.{mdc,md}`

التوحيد (`transformMDCRule`):

- `description`: يُحتفظ بها فقط إذا كانت نصية
- `alwaysApply`: يُحتفظ فقط بـ `true` (`false` تصبح `undefined`)
- `globs`: يقبل مصفوفة (عناصر نصية فقط) أو نص مفرد
- `ttsr_trigger`: نص فقط
- `name` من اسم الملف بدون الامتداد

### موفر Windsurf (`windsurf.ts`)

يحمّل من:

- المستخدم: `~/.codeium/windsurf/memories/global_rules.md` (اسم قاعدة ثابت `global_rules`)
- المشروع: `<cwd>/.windsurf/rules/*.md`

التوحيد:

- `globs`: مصفوفة نصية أو نص مفرد
- `alwaysApply`، `description` يتم تحويلهما من المقدمة الوصفية
- `ttsr_trigger`: نص فقط
- `name` من اسم الملف لقواعد المشروع

### موفر Cline (`cline.ts`)

يبحث صعوداً من `cwd` عن أقرب `.clinerules`:

- إذا كان مجلداً: يحمّل ملفات `*.md` بداخله
- إذا كان ملفاً: يحمّل ملفاً واحداً كقاعدة باسم `clinerules`

التوحيد:

- `globs`: مصفوفة نصية أو نص مفرد
- `alwaysApply`: فقط إذا كانت قيمة منطقية
- `description`: نص فقط
- `ttsr_trigger`: نص فقط

## 3. سلوك تحليل المقدمة الوصفية والغموض

جميع الموفرين يستخدمون `parseFrontmatter` (`utils/frontmatter.ts`) بالدلالات التالية:

1. يتم تحليل المقدمة الوصفية فقط عندما يبدأ المحتوى بـ `---` ويحتوي على إغلاق `\n---`.
2. يتم قص المحتوى بعد استخراج المقدمة الوصفية.
3. إذا فشل تحليل YAML:
   - يتم تسجيل تحذير،
   - يعود المحلل إلى تحليل بسيط لأسطر `key: value` (`^(\w+):\s*(.*)$`).

نتائج الغموض:

- المحلل الاحتياطي لا يدعم المصفوفات أو الكائنات المتداخلة أو قواعد الاقتباس أو المفاتيح التي تحتوي على شرطات.
- القيم الاحتياطية تصبح نصوصاً (مثلاً `alwaysApply: true` تصبح النص `"true"`)، لذا الموفرون الذين يتطلبون أنواع منطقية/نصية قد يُسقطون البيانات الوصفية.
- `ttsr_trigger` يعمل في الوضع الاحتياطي (مفتاح بشرطة سفلية)؛ مفاتيح مثل `thinking-level` لن تعمل.
- الملفات بدون مقدمة وصفية صالحة تُحمّل كقواعد ببيانات وصفية فارغة ومحتوى كامل.

## 4. أسبقية الموفرين وإزالة التكرار

`loadCapability("rules")` (`capability/index.ts`) يدمج مخرجات الموفرين ثم يزيل التكرار بواسطة `rule.name`.

### نموذج الأسبقية

- يتم ترتيب الموفرين حسب الأولوية تنازلياً.
- الأولوية المتساوية تحافظ على ترتيب التسجيل (`cursor` قبل `windsurf` من `discovery/index.ts`).
- إزالة التكرار تعتمد على الأول يفوز: أول قاعدة تتم مواجهتها بالاسم يتم الاحتفاظ بها؛ العناصر اللاحقة بنفس الاسم تُعلّم بـ `_shadowed` في `all` وتُستبعد من `items`.

ترتيب موفري القواعد الفعلي حالياً هو:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### تحذير بشأن الترتيب داخل الموفر

داخل الموفر، يأتي ترتيب العناصر من نتيجة glob لـ `loadFilesFromDir` بالإضافة إلى ترتيب الإضافة الصريح. هذا حتمي بما يكفي للاستخدام العادي لكنه غير مُرتّب صراحة في الكود.

فروقات ملحوظة في ترتيب المصدر:

- `native` يُلحق مجلدات تكوين المشروع ثم المستخدم.
- `cursor` يُلحق نتائج المستخدم ثم المشروع.
- `windsurf` يُلحق `global_rules` الخاص بالمستخدم أولاً، ثم قواعد المشروع.
- `cline` يحمّل فقط أقرب مصدر `.clinerules`.

## 5. التقسيم إلى مجموعات كتاب القواعد والتطبيق الدائم وTTSR

بعد اكتشاف القواعد في `createAgentSession` (`sdk.ts`):

1. يتم مسح جميع القواعد المُكتشفة.
2. القواعد التي تحتوي على `condition` (مفتاح المقدمة الوصفية؛ `ttsr_trigger` / `ttsrTrigger` مقبولة كبديل) يتم تسجيلها في `TtsrManager`.
3. يتم بناء قائمة `rulebookRules` منفصلة بهذا الشرط:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. يتم بناء قائمة `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### سلوك المجموعات

- **مجموعة TTSR**: أي قاعدة تحتوي على `condition` (الوصف غير مطلوب). تأخذ الأولوية على المجموعات الأخرى.
- **مجموعة التطبيق الدائم**: `alwaysApply === true`، ليست TTSR. يتم حقن المحتوى الكامل في موجه النظام. قابلة للحل عبر `rule://`.
- **مجموعة كتاب القواعد**: يجب أن تحتوي على وصف، يجب ألا تكون TTSR، يجب ألا تكون `alwaysApply`. تُدرج في موجه النظام بالاسم + الوصف؛ يُقرأ المحتوى عند الطلب عبر `rule://`.
- قاعدة تحتوي على كل من `condition` و`alwaysApply` تذهب إلى TTSR فقط (TTSR تأخذ الأولوية).
- قاعدة تحتوي على كل من `alwaysApply` و`description` تذهب إلى التطبيق الدائم فقط (ليس كتاب القواعد).

## 6. كيف تؤثر البيانات الوصفية على أسطح وقت التشغيل

### `description`

- مطلوب للإدراج في كتاب القواعد.
- يُعرض في كتلة `<rules>` بموجه النظام.
- الوصف المفقود يعني أن القاعدة غير متاحة عبر `rule://` وغير مُدرجة في قواعد موجه النظام.

### `globs`

- يُنقل عبر `Rule`.
- يُعرض كإدخالات `<glob>...</glob>` في كتلة قواعد موجه النظام.
- يُعرض في حالة واجهة القواعد (قائمة وضع `extensions`).
- **لا يُفرض للمطابقة التلقائية في هذا الخط.** لا يوجد مُطابق glob في وقت التشغيل يختار القواعد حسب الملف الحالي/هدف الأداة.

### `alwaysApply`

- يتم تحليلها والاحتفاظ بها من قبل الموفرين.
- تُستخدم في عرض الواجهة (تسمية المُشغّل `"always"` في مدير حالة الإضافات).
- تُستخدم كشرط استبعاد من `rulebookRules`.
- **يتم حقن محتوى القاعدة الكامل تلقائياً في موجه النظام** (قبل قسم قواعد كتاب القواعد).
- القاعدة قابلة للعنونة أيضاً عبر `rule://<name>` لإعادة القراءة.

### `ttsr_trigger`

- يُعيّن إلى `rule.ttsrTrigger`.
- إذا كان موجوداً، تُوجّه القاعدة إلى مدير TTSR، وليس كتاب القواعد.

## 7. مسار الإدراج في موجه النظام

`buildSystemPromptInternal` يستقبل كلاً من `rules` (كتاب القواعد) و`alwaysApplyRules`.

قواعد التطبيق الدائم تُعرض أولاً، حيث يتم حقن محتواها الخام مباشرة في الموجه.

قواعد كتاب القواعد تُعرض في قسم `# Rules` مع:

- `Read rule://<name> when working in matching domain`
- اسم كل قاعدة و`description` وقائمة `<glob>` الاختيارية

هذا استشاري/سياقي: نص الموجه يطلب من النموذج قراءة القواعد المنطبقة، لكن الكود لا يفرض تطبيق glob.

## 8. سلوك عنوان URL الداخلي `rule://`

`RuleProtocolHandler` مُسجّل بـ:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

الآثار المترتبة:

- `rule://<name>` يُحل مقابل كل من **rulebookRules** و**alwaysApplyRules**.
- قواعد TTSR فقط والقواعد بدون وصف وبدون `alwaysApply` غير قابلة للعنونة عبر `rule://`.
- الحل يتم بمطابقة الاسم الدقيق.
- الأسماء غير المعروفة تُرجع خطأ يسرد أسماء القواعد المتاحة.
- المحتوى المُرجع هو `rule.content` الخام (بعد إزالة المقدمة الوصفية)، نوع المحتوى `text/markdown`.

## 9. الدلالات الجزئية / غير المُفرضة المعروفة

1. أوصاف الموفرين تذكر ملفات قديمة (`.cursorrules`، `.windsurfrules`)، لكن مسارات كود التحميل الحالية لا تقرأ تلك الملفات فعلياً.
2. البيانات الوصفية لـ `globs` تُعرض في الموجه/الواجهة لكن لا تُفرض بواسطة منطق اختيار القواعد.
3. اختيار القواعد لـ `rule://` يشمل قواعد كتاب القواعد وقواعد التطبيق الدائم، لكن ليس قواعد TTSR فقط.
4. تحذيرات الاكتشاف (`loadCapability("rules").warnings`) تُنتج لكن `createAgentSession` لا يعرضها/يُسجّلها حالياً في هذا المسار.
