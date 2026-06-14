---
title: المكونات الداخلية لأوامر Slash
description: المكونات الداخلية لنظام أوامر Slash مع التسجيل وتحليل الوسائط وإرسال التنفيذ.
sidebar:
  order: 5
  label: أوامر Slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# المكونات الداخلية لأوامر Slash

يصف هذا المستند كيفية اكتشاف أوامر Slash وإزالة تكراراتها وعرضها في الوضع التفاعلي وتوسيعها عند وقت المطالبة في `coding-agent`.

## ملفات التنفيذ

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) نموذج الاكتشاف

أوامر Slash هي قدرة (`id: "slash-commands"`) مفهرسة باسم الأمر (`key: cmd => cmd.name`).

يحمّل سجل القدرات جميع الموفرين المسجلين، مرتبةً تنازلياً حسب أولوية الموفر، ويُزيل التكرارات بالمفتاح مع دلالات **الأول يفوز**.

### أولوية الموفر

موفرو أوامر Slash الحاليون وأولوياتهم:

1. `native` (OMP) — الأولوية `100`
2. `claude` — الأولوية `80`
3. `claude-plugins` — الأولوية `70`
4. `codex` — الأولوية `70`

سلوك التعادل: الموفرون ذوو الأولوية المتساوية يحتفظون بترتيب التسجيل. يسجّل ترتيب الاستيراد الحالي `claude-plugins` قبل `codex`، لذا تفوز أوامر الإضافات على أوامر codex عند تعارض الأسماء.

### سلوك تعارض الأسماء

بالنسبة لـ `slash-commands`، تُحسم التعارضات حصرياً بواسطة إزالة تكرار القدرة:

- يُحتفظ بالعنصر ذي الأولوية الأعلى في `result.items`
- تبقى التكرارات ذات الأولوية الأدنى فقط في `result.all` وتُوسَم بـ `_shadowed = true`

ينطبق هذا عبر الموفرين وأيضاً داخل الموفر الواحد إذا أرجع أسماءً مكررة.

### سلوك فحص الملفات

يستخدم الموفرون في الغالب `loadFilesFromDir(...)` الذي يعمل حالياً على النحو التالي:

- يُطابق بشكل غير تكراري افتراضياً (`*.md`)
- يستخدم glob أصلياً مع `gitignore: true` و`hidden: false`
- يقرأ كل ملف مطابق ويحوّله إلى `SlashCommand`

لذلك لا تُحمَّل الملفات/الدلائل المخفية، وتُتخطى المسارات المستبعدة.

## 2) مسارات المصدر الخاصة بكل موفر والأولوية المحلية

## الموفر `native` (`builtin.ts`)

تأتي جذور البحث من دلائل `.xcsh`:

- المشروع: `<cwd>/.xcsh/commands/*.md`
- المستخدم: `~/.xcsh/agent/commands/*.md`

تُرجع `getConfigDirs()` المشروع أولاً ثم المستخدم، لذا **تتفوق أوامر المشروع الأصلية على أوامر المستخدم الأصلية** عند تعارض الأسماء.

## الموفر `claude` (`claude.ts`)

يحمّل:

- المستخدم: `~/.claude/commands/*.md`
- المشروع: `<cwd>/.claude/commands/*.md`

يدفع الموفر عناصر المستخدم قبل عناصر المشروع، لذا **تتفوق أوامر Claude للمستخدم على أوامر Claude للمشروع** عند تعارض الأسماء داخل هذا الموفر.

## الموفر `codex` (`codex.ts`)

يحمّل:

- المستخدم: `~/.codex/commands/*.md`
- المشروع: `<cwd>/.codex/commands/*.md`

يُحمَّل الجانبان ثم يُدمجان بترتيب يُقدِّم المستخدم أولاً، لذا **تتفوق أوامر Codex للمستخدم على أوامر Codex للمشروع** عند التعارض.

يُحلَّل محتوى أوامر Codex مع استخلاص frontmatter (`parseFrontmatter`)، ويمكن تجاوز اسم الأمر عبر `name` في frontmatter؛ وإلا يُستخدم اسم الملف.

## الموفر `claude-plugins` (`claude-plugins.ts`)

يحمّل جذور أوامر الإضافات من `~/.claude/plugins/installed_plugins.json`، ثم يفحص `<pluginRoot>/commands/*.md`.

يتبع الترتيب ترتيب تكرار السجل وترتيب إدخال كل إضافة من بيانات JSON تلك. لا توجد خطوة فرز إضافية.

## 3) التحويل إلى `FileSlashCommand` وقت التشغيل

تحوّل `loadSlashCommands()` في `src/extensibility/slash-commands.ts` عناصر القدرة إلى كائنات `FileSlashCommand` تُستخدم عند وقت المطالبة.

لكل أمر:

1. تحليل frontmatter والمحتوى (`parseFrontmatter`)
2. مصدر الوصف:
   - `frontmatter.description` إن وُجد
   - وإلا أول سطر غير فارغ في المحتوى (مُقلَّص، 60 حرفاً كحد أقصى مع `...`)
3. الاحتفاظ بالمحتوى المحلَّل كقالب تنفيذي
4. حساب سلسلة مصدر للعرض مثل `via Claude Code Project`

تعتمد درجة تحليل frontmatter على المصدر:

- مستوى `native` -> أخطاء التحليل تكون `fatal`
- مستويا `user`/`project` -> أخطاء التحليل تكون `warn` مع تحليل احتياطي

### الأوامر الاحتياطية المدمجة

بعد أوامر نظام الملفات/الموفرين، تُلحَق قوالب الأوامر المدمجة (`EMBEDDED_COMMAND_TEMPLATES`) إن لم تكن أسماؤها موجودة بالفعل.

تأتي المجموعة المدمجة الحالية من `src/task/commands.ts` وتُستخدم احتياطياً (`source: "bundled"`).

## 4) الوضع التفاعلي: مصادر قوائم الأوامر

يجمع الوضع التفاعلي مصادر أوامر متعددة للإكمال التلقائي وتوجيه الأوامر.

يبني عند الإنشاء قائمة أوامر معلقة من:

- الأوامر المدمجة (`BUILTIN_SLASH_COMMANDS`، تشمل إكمال الوسائط والتلميحات المضمنة لأوامر مختارة)
- أوامر Slash المسجلة بالامتدادات (`extensionRunner.getRegisteredCommands(...)`)
- الأوامر المخصصة بـ TypeScript (`session.customCommands`)، مُعيَّنة إلى تسميات أوامر Slash
- أوامر المهارات الاختيارية (`/skill:<name>`) عند تفعيل `skills.enableSkillCommands`

ثم تستدعي `init()` الدالة `refreshSlashCommandState(...)` لتحميل الأوامر القائمة على الملفات وتثبيت `CombinedAutocompleteProvider` واحد يحتوي على:

- الأوامر المعلقة أعلاه
- الأوامر المكتشفة القائمة على الملفات

تُحدّث `refreshSlashCommandState(...)` أيضاً `session.setSlashCommands(...)` لكي يستخدم توسيع المطالبة نفس مجموعة أوامر الملفات المكتشفة.

### دورة حياة التحديث

يُحدَّث حالة أوامر Slash:

- أثناء تهيئة الوضع التفاعلي
- بعد تغيير `/move` لدليل العمل (تستدعي `handleMoveCommand` الدالة `resetCapabilities()` ثم `refreshSlashCommandState(newCwd)`)

لا يوجد مراقب ملفات مستمر لدلائل الأوامر.

### العرض الآخر

تحمّل لوحة الامتدادات أيضاً قدرة `slash-commands` وتعرض إدخالات الأوامر النشطة والمحجوبة، بما فيها تكرارات `_shadowed`.

## 5) موضع خط أنابيب المطالبة

ترتيب معالجة Slash في `AgentSession.prompt(...)` (عند `expandPromptTemplates !== false`):

1. **أوامر الامتداد** (`#tryExecuteExtensionCommand`)  
   إذا طابق `/name` أمراً مسجلاً بالامتداد، ينفّذ المعالج فوراً وتعود المطالبة.
2. **الأوامر المخصصة بـ TypeScript** (`#tryExecuteCustomCommand`)  
   حد فاصل فقط: إذا تطابق، ينفّذ وقد يُرجع:
   - `string` -> يستبدل نص المطالبة بذلك النص
   - `void/undefined` -> يُعامَل كمعالَج؛ لا مطالبة LLM
3. **أوامر Slash القائمة على الملفات** (`expandSlashCommand`)  
   إذا بدأ النص بـ `/` بعد ذلك، يُحاوَل توسيع أمر markdown.
4. **قوالب المطالبة** (`expandPromptTemplate`)  
   تُطبَّق بعد معالجة Slash/الأوامر المخصصة.
5. **التوصيل**
   - خامل: تُرسَل المطالبة فوراً إلى الوكيل
   - بث: تُوضع المطالبة في قائمة انتظار كتوجيه/متابعة حسب `streamingBehavior`

هذا هو السبب في أن توسيع أوامر Slash يسبق توسيع قوالب المطالبة، ولماذا يمكن للأوامر المخصصة تحويل الـ `/` البادئة قبل مطابقة أوامر الملفات.

## 6) دلالات التوسيع لأوامر Slash القائمة على الملفات

سلوك `expandSlashCommand(text, fileCommands)`:

- يعمل فقط عندما يبدأ النص بـ `/`
- يحلّل اسم الأمر من الرمز الأول بعد `/`
- يحلّل الوسائط من النص المتبقي عبر `parseCommandArgs`
- يجد تطابقاً تاماً للاسم في `fileCommands` المحملة
- عند التطابق، يطبّق:
  - الاستبدال الموضعي: `$1`، `$2`، ...
  - الاستبدال الإجمالي: `$ARGUMENTS` و`$@`
  - ثم تصيير القالب عبر `prompt.render` مع `{ args, ARGUMENTS, arguments }`
- عند عدم التطابق، يُرجع النص الأصلي دون تغيير

### تحفظات `parseCommandArgs`

المحلّل عبارة عن تقسيم بسيط مدرك للاقتباس:

- يدعم الاقتباس `'المفرد'` و`"المزدوج"` للحفاظ على المسافات
- يحذف محددات الاقتباس
- لا ينفّذ قواعد الإفلات بالشرطة المائلة العكسية
- الاقتباس غير المكتمل ليس خطأ؛ يستهلك المحلّل حتى النهاية

## 7) سلوك `/...` غير المعروف

المدخل `/...` غير المعروف **لا يُرفض** بواسطة منطق Slash الأساسي.

إذا لم يعالج أيٌّ من طبقات الامتداد/المخصص/الملف الأمرَ، تُرجع `expandSlashCommand` النص الأصلي، ويمر حرفياً `/...` عبر توسيع قوالب المطالبة العادي وتوصيل LLM.

يعالج الوضع التفاعلي بشكل صارم كثيراً من الأوامر المدمجة في `InputController` (مثل `/settings`، `/model`، `/mcp`، `/move`، `/exit`). تُستهلك هذه قبل `session.prompt(...)` وبالتالي لا تصل أبداً إلى توسيع أوامر الملفات في ذلك المسار.

## 8) الفروق في وقت البث مقارنةً بالخمول

## مسار الخمول

- يشغّل `session.prompt("/x ...")` خط أنابيب الأوامر إما لتنفيذ الأمر فوراً أو لإرسال النص الموسَّع مباشرةً.

## مسار البث (`session.isStreaming === true`)

- تُشغّل `prompt(...)` تحويلات الامتداد/المخصص/الملف/القالب أولاً
- ثم تتطلب `streamingBehavior`:
  - `"steer"` -> وضع رسالة مقاطعة في قائمة الانتظار (`agent.steer`)
  - `"followUp"` -> وضع رسالة ما بعد الدور في قائمة الانتظار (`agent.followUp`)
- إذا حُذف `streamingBehavior`، تُصدر المطالبة خطأً

### سلوك البث المهم الخاص بالأوامر

- تُنفَّذ أوامر الامتداد فوراً حتى أثناء البث (لا تُوضع في قائمة انتظار كنص).
- تُرفض الطريقتان `steer(...)`/`followUp(...)` أوامر الامتداد (`#throwIfExtensionCommand`) لتجنب وضع نص الأمر في قائمة انتظار معالجات يجب تشغيلها بشكل متزامن.
- يستخدم إعادة تشغيل قائمة انتظار الضغط `isKnownSlashCommand(...)` لتقرير ما إذا كان ينبغي إعادة تشغيل الإدخالات الموضوعة في قائمة الانتظار عبر `session.prompt(...)` (لأوامر Slash المعروفة) مقابل طرق steer/follow-up الخام.

## 9) معالجة الأخطاء وأسطح الفشل

- إخفاقات تحميل الموفر معزولة؛ يجمع السجل التحذيرات ويواصل مع الموفرين الآخرين.
- عناصر أوامر Slash غير الصالحة (اسم أو مسار أو محتوى مفقود، أو مستوى غير صالح) تُسقطها التحقق من صحة القدرة.
- إخفاقات تحليل Frontmatter:
  - الأوامر الأصلية: يتصاعد خطأ التحليل الفادح
  - الأوامر غير الأصلية: تحذير + تحليل احتياطي بالمفتاح/القيمة
- استثناءات معالج أوامر الامتداد/المخصص تُلتقط وتُبلَّغ عبر قناة أخطاء الامتداد (أو logger احتياطي للأوامر المخصصة بدون مشغّل امتداد)، وتُعامَل كمعالَجة (لا تنفيذ احتياطي غير مقصود).
