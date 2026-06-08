---
title: اكتشاف التكوين وتحليله
description: كيف يكتشف xcsh التكوين ويحلله ويطبق طبقاته من جذور المشروع والمستخدم والمؤسسة.
sidebar:
  order: 1
  label: التكوين
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# اكتشاف التكوين وتحليله

يصف هذا المستند كيف يقوم وكيل البرمجة بتحليل التكوين حالياً: أي الجذور يتم مسحها، وكيف تعمل الأسبقية، وكيف يتم استهلاك التكوين المُحلَّل بواسطة الإعدادات والمهارات والخطافات والأدوات والإضافات.

## النطاق

التنفيذ الأساسي:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

نقاط التكامل الرئيسية:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## تدفق التحليل (مرئي)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) جذور التكوين وترتيب المصادر

## الجذور المرجعية

يحدد `src/config.ts` قائمة أسبقية مصادر ثابتة:

1. `.xcsh` (أصلي)
2. `.claude`
3. `.codex`
4. `.gemini`

القواعد على مستوى المستخدم:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

القواعد على مستوى المشروع:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` هو `.xcsh` (`packages/utils/src/dirs.ts`).

## قيد مهم

المساعدات العامة في `src/config.ts` **لا** تتضمن `.pi` في ترتيب اكتشاف المصادر.

---

## 2) مساعدات الاكتشاف الأساسية (`src/config.ts`)

## `getConfigDirs(subpath, options)`

تُرجع مُدخلات مرتبة:

- مُدخلات مستوى المستخدم أولاً (حسب أسبقية المصدر)
- ثم مُدخلات مستوى المشروع (حسب نفس أسبقية المصدر)

الخيارات:

- `user` (الافتراضي `true`)
- `project` (الافتراضي `true`)
- `cwd` (الافتراضي `getProjectDir()`)
- `existingOnly` (الافتراضي `false`)

تُستخدم هذه الواجهة البرمجية لعمليات البحث عن التكوين المبنية على المجلدات (الأوامر، الخطافات، الأدوات، الوكلاء، إلخ).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

تبحث عن أول ملف موجود عبر القواعد المرتبة، وتُرجع أول تطابق (المسار فقط أو المسار + البيانات الوصفية).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

تتنقل صعوداً عبر المجلدات الأم وتُرجع **أقرب مجلد موجود لكل قاعدة مصدر** (`.xcsh`، `.claude`، `.codex`، `.gemini`)، ثم تُرتب النتائج حسب أسبقية المصدر.

استخدم هذه الدالة عندما يجب وراثة تكوين المشروع من المجلدات الأم (سلوك مستودع أحادي/مساحة عمل متداخلة).

---

## 3) مُغلِّف ملف التكوين (`ConfigFile<T>` في `src/config.ts`)

`ConfigFile<T>` هو المُحمِّل المُتحقق من المخطط لملفات التكوين الفردية.

الصيغ المدعومة:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

السلوك:

- يتحقق من البيانات المُحلَّلة باستخدام AJV مقابل مخطط TypeBox المُقدَّم.
- يُخزِّن نتيجة التحميل مؤقتاً حتى استدعاء `invalidate()`.
- يُرجع نتيجة ثلاثية الحالة عبر `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` مع سياق المخطط/التحليل)

لا يزال الترحيل القديم مدعوماً:

- إذا كان المسار المستهدف `.yml`/`.yaml`، يتم ترحيل ملف `.json` مُجاور تلقائياً مرة واحدة (`migrateJsonToYml`).

---

## 4) نموذج تحليل الإعدادات (`src/config/settings.ts`)

نموذج إعدادات وقت التشغيل مُطبَّق بطبقات:

1. الإعدادات العامة: `~/.xcsh/agent/config.yml`
2. إعدادات المشروع: مُكتشفة عبر قدرة الإعدادات (`settings.json` من المزودين)
3. التجاوزات أثناء التشغيل: في الذاكرة، غير دائمة
4. القيم الافتراضية للمخطط: من `SETTINGS_SCHEMA`

مسار القراءة الفعلي:

`defaults <- global <- project <- overrides`

سلوك الكتابة:

- `settings.set(...)` يكتب في الطبقة **العامة** (`config.yml`) ويُدرج عملية حفظ في الخلفية.
- إعدادات المشروع للقراءة فقط من اكتشاف القدرات.

## سلوك الترحيل لا يزال نشطاً

عند بدء التشغيل، إذا كان `config.yml` مفقوداً:

1. الترحيل من `~/.xcsh/agent/settings.json` (يُعاد تسميته إلى `.bak` عند النجاح)
2. الدمج مع إعدادات قاعدة البيانات القديمة من `agent.db`
3. كتابة النتيجة المُدمجة إلى `config.yml`

عمليات الترحيل على مستوى الحقول في `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` من ميلي ثانية إلى ثوانٍ عندما تبدو القيمة القديمة بالميلي ثانية (`> 1000`)
- البنية المسطحة القديمة `theme: "..."` -> بنية `theme.dark/theme.light`

---

## 5) تكامل القدرات/الاكتشاف

معظم تدفقات تحميل التكوين غير الأساسية تمر عبر سجل القدرات (`src/capability/index.ts` + `src/discovery/index.ts`).

## ترتيب المزودين

يتم فرز المزودين حسب الأولوية الرقمية (الأعلى أولاً). أمثلة على الأولويات:

- Native OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## دلالات إزالة التكرار

تُحدد القدرات `key(item)`:

- نفس المفتاح => العنصر الأول يفوز (العنصر ذو الأولوية الأعلى/المُحمَّل أولاً)
- لا مفتاح (`undefined`) => لا إزالة تكرار، يتم الاحتفاظ بجميع العناصر

المفاتيح ذات الصلة:

- المهارات: `name`
- الأدوات: `name`
- الخطافات: `${type}:${tool}:${name}`
- وحدات الإضافات: `name`
- الإضافات: `name`
- الإعدادات: لا إزالة تكرار (يتم الاحتفاظ بجميع العناصر)

---

## 6) سلوك مزود `.xcsh` الأصلي (`src/discovery/builtin.ts`)

المزود الأصلي (`id: native`) يقرأ من:

- المشروع: `<cwd>/.xcsh/...`
- المستخدم: `~/.xcsh/agent/...`

### قاعدة قبول المجلد

`builtin.ts` يتضمن جذر تكوين فقط إذا كان المجلد موجوداً **وغير فارغ** (`ifNonEmptyDir`).

### التحميل الخاص بالنطاق

- المهارات: `skills/*/SKILL.md`
- أوامر الشرطة المائلة: `commands/*.md`
- القواعد: `rules/*.{md,mdc}`
- القوالب: `prompts/*.md`
- التعليمات: `instructions/*.md`
- الخطافات: `hooks/pre/*`، `hooks/post/*`
- الأدوات: `tools/*.json|*.md` و `tools/<name>/index.ts`
- وحدات الإضافات: مُكتشفة تحت `extensions/` (+ مصفوفة سلاسل نصية قديمة `settings.json.extensions`)
- الإضافات: `extensions/<name>/gemini-extension.json`
- قدرة الإعدادات: `settings.json`

### تفصيل البحث عن أقرب مشروع

لـ `SYSTEM.md` و `AGENTS.md`، يستخدم المزود الأصلي البحث في أقرب مجلد مشروع `.xcsh` في المجلدات الأم (التنقل صعوداً) لكنه لا يزال يتطلب أن يكون مجلد `.xcsh` غير فارغ.

---

## 7) كيف تستهلك الأنظمة الفرعية الرئيسية التكوين

## نظام الإعدادات الفرعي

- `Settings.init()` يُحمِّل `config.yml` العام + عناصر قدرة `settings.json` المُكتشفة للمشروع.
- فقط عناصر القدرات ذات `level === "project"` يتم دمجها في طبقة المشروع.

## نظام المهارات الفرعي

- `extensibility/skills.ts` يُحمِّل عبر `loadCapability(skillCapability.id, { cwd })`.
- يُطبِّق مفاتيح التبديل والمرشحات الخاصة بالمصدر (`ignoredSkills`، `includeSkills`، المجلدات المخصصة).
- لا تزال مفاتيح التبديل ذات الأسماء القديمة موجودة (`skills.enablePiUser`، `skills.enablePiProject`) لكنها تتحكم في المزود الأصلي (`provider === "native"`).

## نظام الخطافات الفرعي

- `discoverAndLoadHooks()` يحل مسارات الخطافات من قدرة الخطاف + المسارات المُكوَّنة صراحةً.
- ثم يُحمِّل الوحدات عبر استيراد Bun.

## نظام الأدوات الفرعي

- `discoverAndLoadCustomTools()` يحل مسارات الأدوات من قدرة الأداة + مسارات أدوات الإضافات + المسارات المُكوَّنة صراحةً.
- ملفات الأدوات التصريحية `.md/.json` هي بيانات وصفية فقط؛ التحميل التنفيذي يتوقع وحدات شفرة.

## نظام الإضافات الفرعي

- `discoverAndLoadExtensions()` يحل وحدات الإضافات من قدرة وحدة الإضافة بالإضافة إلى المسارات الصريحة.
- التنفيذ الحالي يحتفظ عمداً فقط بعناصر القدرات ذات `_source.provider === "native"` قبل التحميل.

---

## 8) قواعد الأسبقية التي يمكن الاعتماد عليها

استخدم هذا النموذج الذهني:

1. ترتيب مجلد المصدر من `config.ts` يحدد ترتيب المسارات المرشحة.
2. أولوية مزود القدرة تحدد الأسبقية عبر المزودين.
3. إزالة تكرار مفتاح القدرة تحدد سلوك التعارض (الأول يفوز للقدرات ذات المفاتيح).
4. منطق الدمج الخاص بالنظام الفرعي يمكن أن يُغيِّر الأسبقية الفعلية أكثر (خاصة الإعدادات).

### تحذير خاص بالإعدادات

عناصر قدرة الإعدادات لا يتم إزالة تكرارها؛ `Settings.#loadProjectSettings()` يقوم بدمج عميق لعناصر المشروع بالترتيب المُرجَع. لأن الدمج يُطبِّق قيم العنصر اللاحق فوق القيم السابقة، فإن سلوك التجاوز الفعلي يعتمد على ترتيب إصدار المزود، وليس فقط على دلالات مفتاح القدرة.

---

## 9) السلوكيات القديمة/التوافقية لا تزال موجودة

- ترحيل `ConfigFile` من JSON إلى YAML للملفات المستهدفة بصيغة YAML.
- ترحيل الإعدادات من `settings.json` و `agent.db` إلى `config.yml`.
- ترحيل مفاتيح الإعدادات (`queueMode`، `ask.timeout`، `theme` المسطح).
- توافق بيان الإضافة: المُحمِّل يقبل كلاً من أقسام `package.json.xcsh` و `package.json.pi` في البيان.
- أسماء الإعدادات القديمة `skills.enablePiUser` / `skills.enablePiProject` لا تزال بوابات نشطة لمصدر المهارات الأصلي.

إذا تمت إزالة مسارات التوافق هذه من الشفرة، قم بتحديث هذا المستند فوراً؛ عدة سلوكيات وقت التشغيل لا تزال تعتمد عليها اليوم.
