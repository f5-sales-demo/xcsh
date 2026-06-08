---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: أوامر السلاش
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# الآليات الداخلية لأوامر السلاش

يصف هذا المستند كيفية اكتشاف أوامر السلاش، وإزالة التكرارات، وعرضها في الوضع التفاعلي، وتوسيعها في وقت الطلب في `coding-agent`.

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

أوامر السلاش هي قدرة (`id: "slash-commands"`) مفهرسة باسم الأمر (`key: cmd => cmd.name`).

يقوم سجل القدرات بتحميل جميع الموفرين المسجلين، مرتبين حسب أولوية الموفر تنازلياً، ويزيل التكرارات بالمفتاح وفق دلالات **الأول يفوز**.

### أسبقية الموفرين

الموفرون الحاليون لأوامر السلاش وأولوياتهم:

1. `native` (OMP) — الأولوية `100`
2. `claude` — الأولوية `80`
3. `claude-plugins` — الأولوية `70`
4. `codex` — الأولوية `70`

سلوك التعادل: الموفرون ذوو الأولوية المتساوية يحافظون على ترتيب التسجيل. ترتيب الاستيراد الحالي يسجل `claude-plugins` قبل `codex`، لذا تفوز أوامر الإضافات على أوامر codex عند تعارض الأسماء.

### سلوك تعارض الأسماء

بالنسبة لـ `slash-commands`، يتم حل التعارضات بشكل صارم عبر إزالة تكرار القدرات:

- يُحتفظ بالعنصر ذي الأولوية الأعلى في `result.items`
- تبقى التكرارات ذات الأولوية الأدنى فقط في `result.all` وتُعلَّم بـ `_shadowed = true`

ينطبق هذا عبر الموفرين وأيضاً داخل الموفر الواحد إذا أعاد أسماء مكررة.

### سلوك فحص الملفات

يستخدم الموفرون في الغالب `loadFilesFromDir(...)`، والتي حالياً:

- تستخدم افتراضياً المطابقة غير التكرارية (`*.md`)
- تستخدم glob الأصلي مع `gitignore: true`، `hidden: false`
- تقرأ كل ملف مطابق وتحوله إلى `SlashCommand`

لذا لا يتم تحميل الملفات/المجلدات المخفية، ويتم تخطي المسارات المتجاهلة.

## 2) مسارات المصدر الخاصة بكل موفر والأسبقية المحلية

## موفر `native` (`builtin.ts`)

تأتي جذور البحث من مجلدات `.xcsh`:

- المشروع: `<cwd>/.xcsh/commands/*.md`
- المستخدم: `~/.xcsh/agent/commands/*.md`

تُعيد `getConfigDirs()` المشروع أولاً، ثم المستخدم، لذا **تتفوق أوامر native الخاصة بالمشروع على أوامر native الخاصة بالمستخدم** عند تعارض الأسماء.

## موفر `claude` (`claude.ts`)

يحمّل:

- المستخدم: `~/.claude/commands/*.md`
- المشروع: `<cwd>/.claude/commands/*.md`

يضيف الموفر عناصر المستخدم قبل عناصر المشروع، لذا **تتفوق أوامر Claude الخاصة بالمستخدم على أوامر Claude الخاصة بالمشروع** عند تعارض الأسماء داخل هذا الموفر.

## موفر `codex` (`codex.ts`)

يحمّل:

- المستخدم: `~/.codex/commands/*.md`
- المشروع: `<cwd>/.codex/commands/*.md`

يتم تحميل كلا الجانبين ثم تسطيحهما بترتيب المستخدم أولاً، لذا **تتفوق أوامر Codex الخاصة بالمستخدم على أوامر Codex الخاصة بالمشروع** عند التعارض.

يتم تحليل محتوى أوامر Codex مع إزالة المقدمة (`parseFrontmatter`)، ويمكن تجاوز اسم الأمر بواسطة حقل `name` في المقدمة؛ وإلا يُستخدم اسم الملف.

## موفر `claude-plugins` (`claude-plugins.ts`)

يحمّل جذور أوامر الإضافات من `~/.claude/plugins/installed_plugins.json`، ثم يفحص `<pluginRoot>/commands/*.md`.

يتبع الترتيب ترتيب التكرار في السجل وترتيب الإدخالات لكل إضافة من بيانات JSON تلك. لا توجد خطوة فرز إضافية.

## 3) التحويل إلى `FileSlashCommand` في وقت التشغيل

تحول `loadSlashCommands()` في `src/extensibility/slash-commands.ts` عناصر القدرات إلى كائنات `FileSlashCommand` المستخدمة في وقت الطلب.

لكل أمر:

1. تحليل المقدمة/المتن (`parseFrontmatter`)
2. مصدر الوصف:
   - `frontmatter.description` إن وُجد
   - وإلا أول سطر غير فارغ من المتن (مقتطع، بحد أقصى 60 حرفاً مع `...`)
3. الاحتفاظ بالمتن المحلل كمحتوى قالب قابل للتنفيذ
4. حساب نص مصدر العرض مثل `via Claude Code Project`

شدة تحليل المقدمة تعتمد على المصدر:

- مستوى `native` -> أخطاء التحليل تكون `fatal`
- مستويات `user`/`project` -> أخطاء التحليل تكون `warn` مع تحليل احتياطي

### الأوامر المدمجة الاحتياطية

بعد أوامر نظام الملفات/الموفرين، تُلحق قوالب الأوامر المضمنة (`EMBEDDED_COMMAND_TEMPLATES`) إذا لم تكن أسماؤها موجودة بالفعل.

المجموعة المضمنة الحالية تأتي من `src/task/commands.ts` وتُستخدم كاحتياطي (`source: "bundled"`).

## 4) الوضع التفاعلي: من أين تأتي قوائم الأوامر

يجمع الوضع التفاعلي مصادر أوامر متعددة للإكمال التلقائي وتوجيه الأوامر.

في وقت الإنشاء يبني قائمة أوامر معلقة من:

- الأوامر المدمجة (`BUILTIN_SLASH_COMMANDS`، تتضمن إكمال الوسائط وتلميحات مضمنة لأوامر محددة)
- أوامر السلاش المسجلة من الإضافات (`extensionRunner.getRegisteredCommands(...)`)
- أوامر TypeScript المخصصة (`session.customCommands`)، مُعيَّنة إلى تسميات أوامر السلاش
- أوامر المهارات الاختيارية (`/skill:<name>`) عند تفعيل `skills.enableSkillCommands`

ثم تستدعي `init()` دالة `refreshSlashCommandState(...)` لتحميل الأوامر المبنية على الملفات وتثبيت `CombinedAutocompleteProvider` واحد يحتوي على:

- الأوامر المعلقة أعلاه
- الأوامر المكتشفة المبنية على الملفات

تقوم `refreshSlashCommandState(...)` أيضاً بتحديث `session.setSlashCommands(...)` حتى يستخدم توسيع الطلبات نفس مجموعة أوامر الملفات المكتشفة.

### دورة حياة التحديث

يتم تحديث حالة أوامر السلاش:

- أثناء تهيئة الوضع التفاعلي
- بعد تغيير `/move` لمجلد العمل (`handleMoveCommand` تستدعي `resetCapabilities()` ثم `refreshSlashCommandState(newCwd)`)

لا يوجد مراقب مستمر لملفات مجلدات الأوامر.

### عرض آخر

تقوم لوحة معلومات الإضافات أيضاً بتحميل قدرة `slash-commands` وعرض إدخالات الأوامر النشطة/المظللة، بما في ذلك التكرارات المعلمة بـ `_shadowed`.

## 5) موضع خط أنابيب الطلبات

ترتيب معالجة السلاش في `AgentSession.prompt(...)` (عندما `expandPromptTemplates !== false`):

1. **أوامر الإضافات** (`#tryExecuteExtensionCommand`)
   إذا تطابق `/name` مع أمر مسجل من إضافة، يُنفذ المعالج فوراً ويعود الطلب.
2. **أوامر TypeScript المخصصة** (`#tryExecuteCustomCommand`)
   حدود فقط: إذا تطابق، يُنفذ وقد يعيد:
   - `string` -> استبدال نص الطلب بتلك السلسلة
   - `void/undefined` -> يُعامل كمُعالَج؛ لا طلب LLM
3. **أوامر السلاش المبنية على الملفات** (`expandSlashCommand`)
   إذا كان النص لا يزال يبدأ بـ `/`، محاولة توسيع أمر markdown.
4. **قوالب الطلبات** (`expandPromptTemplate`)
   تُطبق بعد معالجة السلاش/الأوامر المخصصة.
5. **التسليم**
   - خامل: يُرسل الطلب فوراً إلى الوكيل
   - بث: يُوضع الطلب في قائمة الانتظار كتوجيه/متابعة حسب `streamingBehavior`

لهذا السبب يأتي توسيع أوامر السلاش قبل توسيع قوالب الطلبات، ولهذا يمكن للأوامر المخصصة إزالة السلاش الأول قبل مطابقة أوامر الملفات.

## 6) دلالات التوسيع لأوامر السلاش المبنية على الملفات

سلوك `expandSlashCommand(text, fileCommands)`:

- يعمل فقط عندما يبدأ النص بـ `/`
- يحلل اسم الأمر من أول رمز بعد `/`
- يحلل الوسائط من النص المتبقي عبر `parseCommandArgs`
- يبحث عن مطابقة دقيقة للاسم في `fileCommands` المحملة
- إذا تطابق، يطبق:
   - الاستبدال الموضعي: `$1`، `$2`، ...
   - الاستبدال التجميعي: `$ARGUMENTS` و `$@`
   - ثم عرض القالب عبر `prompt.render` مع `{ args, ARGUMENTS, arguments }`
- إذا لم يتطابق، يعيد النص الأصلي دون تغيير

### تحفظات `parseCommandArgs`

المحلل هو تقسيم بسيط يراعي علامات الاقتباس:

- يدعم الاقتباس `'المفرد'` و `"المزدوج"` للحفاظ على المسافات
- يزيل محددات الاقتباس
- لا ينفذ قواعد تخطي الشرطة المائلة العكسية
- الاقتباس غير المغلق ليس خطأ؛ يستهلك المحلل حتى النهاية

## 7) سلوك `/...` غير المعروف

المدخلات غير المعروفة التي تبدأ بسلاش **لا تُرفض** بواسطة منطق السلاش الأساسي.

إذا لم يتم التعامل مع الأمر بواسطة طبقات الإضافات/المخصصة/الملفات، تعيد `expandSlashCommand` النص الأصلي، ويمر طلب `/...` الحرفي عبر توسيع قوالب الطلبات العادي والتسليم إلى LLM.

يتعامل الوضع التفاعلي بشكل منفصل مع العديد من الأوامر المدمجة في `InputController` (على سبيل المثال `/settings`، `/model`، `/mcp`، `/move`، `/exit`). تُستهلك هذه قبل `session.prompt(...)` وبالتالي لا تصل أبداً إلى توسيع أوامر الملفات في ذلك المسار.

## 8) الاختلافات في وقت البث مقابل الخمول

## مسار الخمول

- `session.prompt("/x ...")` يشغل خط أنابيب الأوامر وإما ينفذ الأمر فوراً أو يرسل النص الموسع مباشرة.

## مسار البث (`session.isStreaming === true`)

- `prompt(...)` لا يزال يشغل تحويلات الإضافات/المخصصة/الملفات/القوالب أولاً
- ثم يتطلب `streamingBehavior`:
   - `"steer"` -> وضع رسالة مقاطعة في قائمة الانتظار (`agent.steer`)
   - `"followUp"` -> وضع رسالة ما بعد الدور في قائمة الانتظار (`agent.followUp`)
- إذا تم حذف `streamingBehavior`، يرمي الطلب خطأ

### سلوك البث المهم الخاص بالأوامر

- تُنفذ أوامر الإضافات فوراً حتى أثناء البث (لا تُوضع في قائمة الانتظار كنص).
- ترفض طرق `steer(...)`/`followUp(...)` المساعدة أوامر الإضافات (`#throwIfExtensionCommand`) لتجنب وضع نص الأمر في قائمة الانتظار لمعالجات يجب أن تعمل بشكل متزامن.
- تستخدم إعادة تشغيل قائمة انتظار الضغط `isKnownSlashCommand(...)` لتحديد ما إذا كان يجب إعادة تشغيل الإدخالات في قائمة الانتظار عبر `session.prompt(...)` (لأوامر السلاش المعروفة) مقابل طرق التوجيه/المتابعة الخام.

## 9) معالجة الأخطاء وأسطح الفشل

- إخفاقات تحميل الموفر معزولة؛ يجمع السجل التحذيرات ويستمر مع الموفرين الآخرين.
- تُسقط عناصر أوامر السلاش غير الصالحة (اسم/مسار/محتوى مفقود أو مستوى غير صالح) بواسطة التحقق من صحة القدرات.
- إخفاقات تحليل المقدمة:
   - أوامر native: خطأ تحليل فادح يتصاعد
   - أوامر غير native: تحذير + تحليل احتياطي للمفتاح/القيمة
- تُلتقط استثناءات معالج أوامر الإضافات/المخصصة وتُبلَّغ عبر قناة خطأ الإضافة (أو مسجل احتياطي للأوامر المخصصة بدون مشغل إضافات)، وتُعامل كمُعالَجة (لا تنفيذ احتياطي غير مقصود).
