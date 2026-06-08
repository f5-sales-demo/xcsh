---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: أوامر Slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# الآليات الداخلية لأوامر Slash

يصف هذا المستند كيفية اكتشاف أوامر slash وإزالة التكرارات وعرضها في الوضع التفاعلي وتوسيعها عند وقت الأوامر النصية في `coding-agent`.

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

يقوم سجل القدرات بتحميل جميع المزوّدين المسجلين، مرتّبين حسب أولوية المزوّد تنازلياً، ويزيل التكرارات بالمفتاح بدلالات **الأول يفوز**.

### أسبقية المزوّدين

المزوّدون الحاليون لأوامر slash وأولوياتهم:

1. `native` (OMP) — الأولوية `100`
2. `claude` — الأولوية `80`
3. `claude-plugins` — الأولوية `70`
4. `codex` — الأولوية `70`

سلوك التعادل: المزوّدون ذوو الأولوية المتساوية يحتفظون بترتيب التسجيل. ترتيب الاستيراد الحالي يسجل `claude-plugins` قبل `codex`، لذا تفوز أوامر الإضافات على أوامر codex عند تعارض الأسماء.

### سلوك تعارض الأسماء

بالنسبة لـ `slash-commands`، يتم حل التعارضات بشكل صارم من خلال إزالة تكرار القدرات:

- يُحتفظ بالعنصر ذي الأولوية الأعلى في `result.items`
- تبقى التكرارات ذات الأولوية الأدنى فقط في `result.all` وتُعلَّم بـ `_shadowed = true`

ينطبق هذا عبر المزوّدين وأيضاً داخل المزوّد الواحد إذا أعاد أسماءً مكررة.

### سلوك فحص الملفات

يستخدم المزوّدون في الغالب `loadFilesFromDir(...)`، والتي حالياً:

- تستخدم افتراضياً المطابقة غير العودية (`*.md`)
- تستخدم glob الأصلي مع `gitignore: true`، `hidden: false`
- تقرأ كل ملف مطابق وتحوّله إلى `SlashCommand`

لذا لا يتم تحميل الملفات/المجلدات المخفية، ويتم تخطي المسارات المتجاهلة.

## 2) مسارات المصادر الخاصة بكل مزوّد والأسبقية المحلية

## مزوّد `native` (`builtin.ts`)

تأتي جذور البحث من مجلدات `.xcsh`:

- المشروع: `<cwd>/.xcsh/commands/*.md`
- المستخدم: `~/.xcsh/agent/commands/*.md`

تعيد `getConfigDirs()` المشروع أولاً، ثم المستخدم، لذا **تتغلب أوامر native الخاصة بالمشروع على أوامر native الخاصة بالمستخدم** عند تعارض الأسماء.

## مزوّد `claude` (`claude.ts`)

يحمّل:

- المستخدم: `~/.claude/commands/*.md`
- المشروع: `<cwd>/.claude/commands/*.md`

يضيف المزوّد عناصر المستخدم قبل عناصر المشروع، لذا **تتغلب أوامر Claude الخاصة بالمستخدم على أوامر Claude الخاصة بالمشروع** عند تعارض الأسماء داخل هذا المزوّد.

## مزوّد `codex` (`codex.ts`)

يحمّل:

- المستخدم: `~/.codex/commands/*.md`
- المشروع: `<cwd>/.codex/commands/*.md`

يتم تحميل كلا الجانبين ثم تسطيحهما بترتيب المستخدم أولاً، لذا **تتغلب أوامر Codex الخاصة بالمستخدم على أوامر Codex الخاصة بالمشروع** عند التعارضات.

يتم تحليل محتوى أوامر Codex مع إزالة frontmatter (`parseFrontmatter`)، ويمكن تجاوز اسم الأمر بواسطة frontmatter `name`؛ وإلا يُستخدم اسم الملف.

## مزوّد `claude-plugins` (`claude-plugins.ts`)

يحمّل جذور أوامر الإضافات من `~/.claude/plugins/installed_plugins.json`، ثم يفحص `<pluginRoot>/commands/*.md`.

يتبع الترتيب ترتيب تكرار السجل وترتيب إدخال كل إضافة من بيانات JSON تلك. لا توجد خطوة ترتيب إضافية.

## 3) التحويل إلى `FileSlashCommand` في وقت التشغيل

تحوّل `loadSlashCommands()` في `src/extensibility/slash-commands.ts` عناصر القدرات إلى كائنات `FileSlashCommand` المستخدمة في وقت الأوامر النصية.

لكل أمر:

1. تحليل frontmatter/body (`parseFrontmatter`)
2. مصدر الوصف:
   - `frontmatter.description` إن وُجد
   - وإلا أول سطر غير فارغ من المحتوى (مقتطع، بحد أقصى 60 حرفاً مع `...`)
3. الاحتفاظ بالمحتوى المحلّل كقالب محتوى قابل للتنفيذ
4. حساب سلسلة مصدر العرض مثل `via Claude Code Project`

شدة تحليل Frontmatter تعتمد على المصدر:

- مستوى `native` -> أخطاء التحليل `fatal`
- مستويات `user`/`project` -> أخطاء التحليل `warn` مع تحليل احتياطي

### الأوامر المضمّنة الاحتياطية

بعد أوامر نظام الملفات/المزوّدين، تُلحق قوالب الأوامر المضمّنة (`EMBEDDED_COMMAND_TEMPLATES`) إذا لم تكن أسماؤها موجودة بالفعل.

تأتي المجموعة المضمّنة الحالية من `src/task/commands.ts` وتُستخدم كاحتياطي (`source: "bundled"`).

## 4) الوضع التفاعلي: من أين تأتي قوائم الأوامر

يجمع الوضع التفاعلي مصادر أوامر متعددة للإكمال التلقائي وتوجيه الأوامر.

عند وقت البناء يُنشئ قائمة أوامر معلّقة من:

- الأوامر المدمجة (`BUILTIN_SLASH_COMMANDS`، تتضمن إكمال المعاملات وتلميحات مضمّنة لأوامر محددة)
- أوامر slash المسجّلة عبر الإضافات (`extensionRunner.getRegisteredCommands(...)`)
- الأوامر المخصصة بـ TypeScript (`session.customCommands`)، مُعيَّنة إلى تسميات أوامر slash
- أوامر المهارات الاختيارية (`/skill:<name>`) عند تمكين `skills.enableSkillCommands`

ثم تستدعي `init()` الدالة `refreshSlashCommandState(...)` لتحميل الأوامر المبنية على الملفات وتثبيت `CombinedAutocompleteProvider` واحد يحتوي على:

- الأوامر المعلّقة أعلاه
- الأوامر المبنية على الملفات المكتشفة

تقوم `refreshSlashCommandState(...)` أيضاً بتحديث `session.setSlashCommands(...)` بحيث يستخدم توسيع الأوامر النصية نفس مجموعة أوامر الملفات المكتشفة.

### دورة حياة التحديث

يتم تحديث حالة أوامر slash:

- أثناء تهيئة الوضع التفاعلي
- بعد تغيير `/move` لمجلد العمل (`handleMoveCommand` تستدعي `resetCapabilities()` ثم `refreshSlashCommandState(newCwd)`)

لا يوجد مراقب ملفات مستمر لمجلدات الأوامر.

### عرض آخر

تقوم لوحة معلومات الإضافات أيضاً بتحميل قدرة `slash-commands` وعرض إدخالات الأوامر النشطة/المحجوبة، بما في ذلك التكرارات المعلّمة بـ `_shadowed`.

## 5) موقع خط أنابيب الأوامر النصية

ترتيب معالجة أوامر slash في `AgentSession.prompt(...)` (عندما يكون `expandPromptTemplates !== false`):

1. **أوامر الإضافات** (`#tryExecuteExtensionCommand`)  
   إذا تطابق `/name` مع أمر مسجّل عبر إضافة، يُنفَّذ المعالج فوراً ويعود prompt.
2. **أوامر TypeScript المخصصة** (`#tryExecuteCustomCommand`)  
   حد فقط: إذا تطابق، يُنفَّذ وقد يعيد:
   - `string` -> يستبدل نص prompt بتلك السلسلة
   - `void/undefined` -> يُعامَل كمعالَج؛ لا يُرسل أمر نصي للنموذج اللغوي
3. **أوامر slash المبنية على الملفات** (`expandSlashCommand`)  
   إذا كان النص لا يزال يبدأ بـ `/`، يُحاول توسيع أمر markdown.
4. **قوالب الأوامر النصية** (`expandPromptTemplate`)  
   تُطبَّق بعد معالجة أوامر slash/المخصصة.
5. **التسليم**
   - خامل: يُرسل الأمر النصي فوراً إلى الوكيل
   - بثّ مباشر: يُوضع الأمر النصي في قائمة الانتظار كتوجيه/متابعة حسب `streamingBehavior`

لهذا يأتي توسيع أوامر slash قبل توسيع قوالب الأوامر النصية، ولهذا يمكن للأوامر المخصصة إزالة الشرطة المائلة البادئة قبل مطابقة أوامر الملفات.

## 6) دلالات التوسيع لأوامر slash المبنية على الملفات

سلوك `expandSlashCommand(text, fileCommands)`:

- يعمل فقط عندما يبدأ النص بـ `/`
- يحلّل اسم الأمر من أول رمز بعد `/`
- يحلّل المعاملات من النص المتبقي عبر `parseCommandArgs`
- يبحث عن تطابق دقيق للاسم في `fileCommands` المحمّلة
- إذا تطابق، يُطبِّق:
   - الاستبدال الموضعي: `$1`، `$2`، ...
   - الاستبدال التجميعي: `$ARGUMENTS` و `$@`
   - ثم عرض القالب عبر `prompt.render` مع `{ args, ARGUMENTS, arguments }`
- إذا لم يتطابق، يعيد النص الأصلي دون تغيير

### تحفظات `parseCommandArgs`

المحلّل عبارة عن تقسيم بسيط يدرك علامات الاقتباس:

- يدعم الاقتباس `'المفرد'` و `"المزدوج"` للاحتفاظ بالمسافات
- يزيل محددات الاقتباس
- لا ينفّذ قواعد الهروب بالشرطة المائلة العكسية
- علامة الاقتباس غير المُغلقة ليست خطأ؛ يستهلك المحلّل حتى النهاية

## 7) سلوك `/...` غير المعروف

المدخلات غير المعروفة لأوامر slash **لا تُرفض** بواسطة منطق slash الأساسي.

إذا لم يُعالَج الأمر بواسطة طبقات الإضافات/المخصصة/الملفات، تعيد `expandSlashCommand` النص الأصلي، ويمرّ الأمر النصي الحرفي `/...` عبر توسيع قوالب الأوامر النصية العادي والتسليم للنموذج اللغوي.

يتعامل الوضع التفاعلي بشكل منفصل مع العديد من الأوامر المدمجة في `InputController` (مثل `/settings`، `/model`، `/mcp`، `/move`، `/exit`). تُستهلك هذه قبل `session.prompt(...)` ولذلك لا تصل أبداً إلى توسيع أوامر الملفات في هذا المسار.

## 8) الاختلافات في وقت البثّ المباشر مقابل الخمول

## مسار الخمول

- `session.prompt("/x ...")` يشغّل خط أنابيب الأوامر وإما ينفّذ الأمر فوراً أو يرسل النص الموسّع مباشرة.

## مسار البثّ المباشر (`session.isStreaming === true`)

- `prompt(...)` لا يزال يشغّل تحويلات الإضافات/المخصصة/الملفات/القوالب أولاً
- ثم يتطلب `streamingBehavior`:
   - `"steer"` -> يضع رسالة مقاطعة في قائمة الانتظار (`agent.steer`)
   - `"followUp"` -> يضع رسالة ما بعد الدور في قائمة الانتظار (`agent.followUp`)
- إذا حُذف `streamingBehavior`، يرمي prompt خطأ

### سلوك بثّ مباشر مهم خاص بالأوامر

- تُنفَّذ أوامر الإضافات فوراً حتى أثناء البثّ المباشر (لا تُوضع في قائمة الانتظار كنص).
- ترفض دوال المساعدة `steer(...)`/`followUp(...)` أوامر الإضافات (`#throwIfExtensionCommand`) لتجنب وضع نص الأوامر في قائمة الانتظار للمعالجات التي يجب أن تعمل بشكل متزامن.
- تستخدم إعادة تشغيل قائمة انتظار الضغط `isKnownSlashCommand(...)` لتحديد ما إذا كان يجب إعادة تشغيل الإدخالات المُنتظرة عبر `session.prompt(...)` (لأوامر slash المعروفة) مقابل طرق steer/follow-up الخام.

## 9) معالجة الأخطاء وأسطح الفشل

- فشل تحميل المزوّدين معزول؛ يجمع السجل التحذيرات ويستمر مع المزوّدين الآخرين.
- عناصر أوامر slash غير الصالحة (الاسم/المسار/المحتوى المفقود أو المستوى غير الصالح) تُسقط بواسطة التحقق من القدرات.
- فشل تحليل Frontmatter:
   - الأوامر الأصلية: خطأ تحليل فادح يتصاعد
   - الأوامر غير الأصلية: تحذير + تحليل احتياطي بمفتاح/قيمة
- استثناءات معالجات أوامر الإضافات/المخصصة يتم التقاطها والإبلاغ عنها عبر قناة أخطاء الإضافات (أو المسجّل كاحتياطي للأوامر المخصصة بدون مشغّل إضافات)، وتُعامَل كمعالَجة (لا يحدث تنفيذ احتياطي غير مقصود).
