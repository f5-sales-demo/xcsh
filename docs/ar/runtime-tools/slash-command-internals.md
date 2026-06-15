---
title: الداخليات الخاصة بأوامر Slash
description: داخليات نظام أوامر Slash مع التسجيل وتحليل الوسيطات وإرسال التنفيذ.
sidebar:
  order: 5
  label: أوامر Slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# الداخليات الخاصة بأوامر Slash

يصف هذا المستند كيفية اكتشاف أوامر Slash وإزالة تكرارها وعرضها في الوضع التفاعلي وتوسيعها عند وقت المطالبة في `coding-agent`.

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

يقوم سجل القدرات بتحميل جميع الموفرين المسجلين، مرتبةً تنازلياً حسب أولوية الموفر، ويزيل التكرارات بالمفتاح مع دلالات **الفوز للأول**.

### أسبقية الموفر

موفرو أوامر Slash الحاليون وأولوياتهم:

1. `native` (OMP) — الأولوية `100`
2. `claude` — الأولوية `80`
3. `claude-plugins` — الأولوية `70`
4. `codex` — الأولوية `70`

سلوك التعادل: الموفرون ذوو الأولوية المتساوية يحتفظون بترتيب التسجيل. يسجّل ترتيب الاستيراد الحالي `claude-plugins` قبل `codex`، لذلك تفوز أوامر المكوّن الإضافي على أوامر codex في حالات تصادم الأسماء.

### سلوك تصادم الأسماء

بالنسبة لـ `slash-commands`، يتم حل التصادمات بشكل صارم عبر إزالة تكرارات القدرات:

- يُحتفظ بالعنصر الأعلى أولويةً في `result.items`
- تبقى التكرارات الأدنى أولويةً فقط في `result.all` وتُوسَم بـ `_shadowed = true`

يسري هذا عبر الموفرين وأيضاً داخل موفر واحد إذا أعاد أسماءً مكررة.

### سلوك فحص الملفات

يستخدم الموفرون في الغالب `loadFilesFromDir(...)`, والذي يقوم حالياً بما يلي:

- يعتمد على المطابقة غير التعاودية بشكل افتراضي (`*.md`)
- يستخدم glob أصلياً مع `gitignore: true` و `hidden: false`
- يقرأ كل ملف متطابق ويحوّله إلى `SlashCommand`

لذلك لا يتم تحميل الملفات/الأدلة المخفية، ويتم تخطي المسارات المُتجاهَلة.

## 2) مسارات المصدر الخاصة بكل موفر والأسبقية المحلية

## الموفر `native` (`builtin.ts`)

تأتي جذور البحث من أدلة `.xcsh`:

- المشروع: `<cwd>/.xcsh/commands/*.md`
- المستخدم: `~/.xcsh/agent/commands/*.md`

يُعيد `getConfigDirs()` المشروع أولاً ثم المستخدم، لذلك **تتفوق الأوامر الأصلية للمشروع على الأوامر الأصلية للمستخدم** عند تصادم الأسماء.

## الموفر `claude` (`claude.ts`)

يحمّل:

- المستخدم: `~/.claude/commands/*.md`
- المشروع: `<cwd>/.claude/commands/*.md`

يدفع الموفر عناصر المستخدم قبل عناصر المشروع، لذلك **تتفوق أوامر Claude للمستخدم على أوامر Claude للمشروع** في حالات التصادم بالاسم نفسه داخل هذا الموفر.

## الموفر `codex` (`codex.ts`)

يحمّل:

- المستخدم: `~/.codex/commands/*.md`
- المشروع: `<cwd>/.codex/commands/*.md`

يتم تحميل الجانبين ثم تسطيحهما بترتيب المستخدم أولاً، لذلك **تتفوق أوامر Codex للمستخدم على أوامر Codex للمشروع** في حالات التصادم.

يتم تحليل محتوى أوامر Codex مع إزالة frontmatter (`parseFrontmatter`)، ويمكن تجاوز اسم الأمر بواسطة `name` في frontmatter؛ وإلا يُستخدم اسم الملف.

## الموفر `claude-plugins` (`claude-plugins.ts`)

يحمّل جذور أوامر المكوّن الإضافي من `~/.claude/plugins/installed_plugins.json`، ثم يفحص `<pluginRoot>/commands/*.md`.

يتبع الترتيب ترتيب تكرار السجل وترتيب إدخالات كل مكوّن إضافي من بيانات JSON تلك. لا توجد خطوة فرز إضافية.

## 3) التحويل إلى `FileSlashCommand` في وقت التشغيل

تُحوّل `loadSlashCommands()` في `src/extensibility/slash-commands.ts` عناصر القدرات إلى كائنات `FileSlashCommand` المستخدمة عند وقت المطالبة.

لكل أمر:

1. تحليل frontmatter/الجسم (`parseFrontmatter`)
2. مصدر الوصف:
   - `frontmatter.description` إذا كان موجوداً
   - وإلا أول سطر غير فارغ من الجسم (منظّف، بحد أقصى 60 حرفاً مع `...`)
3. الاحتفاظ بجسم التحليل كمحتوى قالب قابل للتنفيذ
4. حساب سلسلة مصدر عرض مثل `via Claude Code Project`

تعتمد شدة تحليل frontmatter على المصدر:

- المستوى `native` -> أخطاء التحليل تكون `fatal`
- المستويان `user`/`project` -> أخطاء التحليل تكون `warn` مع تحليل احتياطي

### أوامر الاحتياط المدمجة

بعد الأوامر المستندة إلى نظام الملفات/الموفر، يتم إلحاق قوالب أوامر مضمّنة (`EMBEDDED_COMMAND_TEMPLATES`) إذا لم تكن أسماؤها موجودة مسبقاً.

تأتي المجموعة المضمّنة الحالية من `src/task/commands.ts` وتُستخدم كاحتياط (`source: "bundled"`).

## 4) الوضع التفاعلي: مصادر قوائم الأوامر

يجمع الوضع التفاعلي مصادر أوامر متعددة للإكمال التلقائي وتوجيه الأوامر.

عند الإنشاء، يبني قائمة انتظار أوامر من:

- الأوامر المدمجة (`BUILTIN_SLASH_COMMANDS`، تتضمن إكمال الوسيطات والتلميحات المضمّنة لأوامر محددة)
- أوامر Slash المسجلة بالامتداد (`extensionRunner.getRegisteredCommands(...)`)
- الأوامر المخصصة بـ TypeScript (`session.customCommands`)، مُعيَّنة إلى تسميات أوامر Slash
- أوامر المهارة الاختيارية (`/skill:<name>`) عند تمكين `skills.enableSkillCommands`

ثم يستدعي `init()` الدالة `refreshSlashCommandState(...)` لتحميل الأوامر المستندة إلى الملفات وتثبيت موفر `CombinedAutocompleteProvider` واحد يحتوي على:

- الأوامر المعلقة أعلاه
- الأوامر المستندة إلى الملفات المكتشفة

تقوم `refreshSlashCommandState(...)` أيضاً بتحديث `session.setSlashCommands(...)` حتى يستخدم توسيع المطالبة مجموعة أوامر الملف المكتشفة نفسها.

### دورة حياة التحديث

يتم تحديث حالة أوامر Slash:

- أثناء تهيئة الوضع التفاعلي
- بعد أن يغير `/move` دليل العمل (`handleMoveCommand` يستدعي `resetCapabilities()` ثم `refreshSlashCommandState(newCwd)`)

لا يوجد مراقب ملفات مستمر لأدلة الأوامر.

### العرض في أماكن أخرى

تحمّل لوحة تحكم الامتدادات أيضاً قدرة `slash-commands` وتعرض إدخالات الأوامر النشطة والمظلّلة، بما في ذلك التكرارات `_shadowed`.

## 5) موضع خط أنابيب المطالبة

ترتيب معالجة Slash في `AgentSession.prompt(...)` (عند `expandPromptTemplates !== false`):

1. **أوامر الامتداد** (`#tryExecuteExtensionCommand`)  
   إذا تطابق `/name` مع أمر مسجل بالامتداد، يتم تنفيذ المعالج فوراً وتعود المطالبة.
2. **الأوامر المخصصة بـ TypeScript** (`#tryExecuteCustomCommand`)  
   حدٌّ فاصل فقط: إذا تطابق، يتم التنفيذ وقد يُعيد:
   - `string` -> استبدال نص المطالبة بذلك النص
   - `void/undefined` -> يُعامَل كمعالَج؛ لا توجد مطالبة LLM
3. **أوامر Slash المستندة إلى الملفات** (`expandSlashCommand`)  
   إذا كان النص لا يزال يبدأ بـ `/`، محاولة توسيع أمر markdown.
4. **قوالب المطالبة** (`expandPromptTemplate`)  
   تُطبَّق بعد معالجة Slash/المخصص.
5. **التسليم**
   - الخامل: يُرسَل الطلب فوراً إلى الوكيل
   - البث: يُوضع الطلب في قائمة انتظار كتوجيه أو متابعة حسب `streamingBehavior`

هذا هو سبب وجود توسيع أوامر Slash قبل توسيع قالب المطالبة، وسبب قدرة الأوامر المخصصة على تحويل الشرطة المائلة الأمامية قبل مطابقة أوامر الملفات.

## 6) دلالات التوسيع للأوامر المستندة إلى الملفات

سلوك `expandSlashCommand(text, fileCommands)`:

- يعمل فقط عند بدء النص بـ `/`
- يحلل اسم الأمر من الرمز الأول بعد `/`
- يحلل الوسيطات من النص المتبقي عبر `parseCommandArgs`
- يجد تطابقاً دقيقاً للاسم في `fileCommands` المحمّلة
- عند التطابق، يطبّق:
  - الاستبدال الموضعي: `$1`، `$2`، ...
  - الاستبدال الإجمالي: `$ARGUMENTS` و `$@`
  - ثم تصيير القالب عبر `prompt.render` مع `{ args, ARGUMENTS, arguments }`
- عند عدم التطابق، يُعيد النص الأصلي دون تغيير

### محاذير `parseCommandArgs`

المحلل عبارة عن تقسيم بسيط يدرك الاقتباسات:

- يدعم اقتباس `'فردي'` و`"مزدوج"` للحفاظ على المسافات
- يزيل محددات الاقتباس
- لا يُطبّق قواعد الهروب بالشرطة المائلة العكسية
- الاقتباس غير المكتمل ليس خطأً؛ يستهلك المحلل حتى النهاية

## 7) سلوك `/...` غير المعروف

المدخل غير المعروف لـ Slash **لا يُرفض** بواسطة منطق slash الأساسي.

إذا لم يتم معالجة الأمر بواسطة طبقات الامتداد/المخصص/الملف، تُعيد `expandSlashCommand` النص الأصلي، وتمر مطالبة `/...` الحرفية عبر توسيع قالب المطالبة الطبيعي وتسليم LLM.

يتعامل الوضع التفاعلي بشكل منفصل مع العديد من الأوامر المدمجة في `InputController` بشكل صارم (على سبيل المثال `/settings`، `/model`، `/mcp`، `/move`، `/exit`). تُستهلك هذه قبل `session.prompt(...)` وبالتالي لا تصل أبداً إلى توسيع أوامر الملف في ذلك المسار.

## 8) الاختلافات في وقت البث مقارنةً بالخامل

## مسار الخامل

- `session.prompt("/x ...")` يشغّل خط أنابيب الأوامر ويُنفّذ الأمر فوراً أو يُرسل النص الموسَّع مباشرةً.

## مسار البث (`session.isStreaming === true`)

- لا يزال `prompt(...)` يشغّل تحويلات الامتداد/المخصص/الملف/القالب أولاً
- ثم يتطلب `streamingBehavior`:
  - `"steer"` -> وضع رسالة المقاطعة في قائمة الانتظار (`agent.steer`)
  - `"followUp"` -> وضع رسالة ما بعد الدور في قائمة الانتظار (`agent.followUp`)
- إذا تم حذف `streamingBehavior`، يُلقي الطلب خطأً

### سلوك بث مهم خاص بالأوامر

- تُنفَّذ أوامر الامتداد فوراً حتى أثناء البث (لا تُوضع في قائمة انتظار كنص).
- تُرفض بواسطة طرق `steer(...)`/`followUp(...)` المساعدة أوامر الامتداد (`#throwIfExtensionCommand`) لتجنب وضع نص الأمر في قائمة الانتظار للمعالجات التي يجب تشغيلها بشكل متزامن.
- تستخدم إعادة تشغيل قائمة انتظار الضغط `isKnownSlashCommand(...)` لتحديد ما إذا كان يجب إعادة تشغيل الإدخالات في قائمة الانتظار عبر `session.prompt(...)` (لأوامر Slash المعروفة) مقابل طرق steer/follow-up الأولية.

## 9) معالجة الأخطاء وأسطح الفشل

- فشل تحميل الموفر معزول؛ يجمع السجل التحذيرات ويستمر مع الموفرين الآخرين.
- عناصر أوامر Slash غير الصالحة (اسم/مسار/محتوى مفقود أو مستوى غير صالح) تُسقَط بواسطة التحقق من صحة القدرات.
- فشل تحليل frontmatter:
  - الأوامر الأصلية: يتصاعد خطأ التحليل الفادح
  - الأوامر غير الأصلية: تحذير + تحليل احتياطي للمفتاح/القيمة
- استثناءات معالج الأوامر الامتداد/المخصص تُلتقط وتُبلَّغ عبر قناة أخطاء الامتداد (أو مسجّل احتياطي للأوامر المخصصة التي لا تملك مشغّل امتداد)، وتُعامَل كمعالَجة (لا يوجد تنفيذ احتياطي غير مقصود).
