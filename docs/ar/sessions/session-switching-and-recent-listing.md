---
title: تبديل الجلسات وعرض قائمة الجلسات الأخيرة
description: آليات تبديل الجلسات وعرض قائمة الجلسات الأخيرة مع إمكانية البحث والتصفية.
sidebar:
  order: 4
  label: التبديل والجلسات الأخيرة
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# تبديل الجلسات وعرض قائمة الجلسات الأخيرة

يصف هذا المستند كيفية اكتشاف عميل البرمجة للجلسات الأخيرة، وحل أهداف `--resume`، وعرض أدوات اختيار الجلسات، وتبديل جلسة وقت التشغيل النشطة.

يركز على سلوك التنفيذ الحالي، بما في ذلك مسارات الاحتياط والتحفظات.

## ملفات التنفيذ

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## اكتشاف الجلسات الأخيرة

### نطاق الدليل

يخزّن `SessionManager` الجلسات تحت دليل مرتبط بـ cwd بشكل افتراضي:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

يقرأ `SessionManager.list(cwd, sessionDir?)` ذلك الدليل فقط ما لم يُقدَّم `sessionDir` صريح.

### مساران للإدراج بحمولات مختلفة

يوجد خطان مختلفان للإدراج:

1. `getRecentSessions(sessionDir, limit)` (عرض الترحيب/الملخص)
   - يقرأ بادئة 4KB فقط (`readTextPrefix(..., 4096)`) من كل ملف.
   - يحلل الترويسة وأقدم معاينة نصية للمستخدم.
   - يُعيد `RecentSessionInfo` خفيف الوزن مع أدوات جلب `name` و`timeAgo` متأخرة التحميل.
   - يرتب حسب `mtime` للملف تنازلياً.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (أدوات اختيار الاستئناف ومطابقة المعرّف)
   - يقرأ ملفات الجلسة الكاملة.
   - يبني كائنات `SessionInfo` (`id`، `cwd`، `title`، `messageCount`، `firstMessage`، `allMessagesText`، الطوابع الزمنية).
   - يحذف الجلسات التي تحتوي على صفر مدخلات `message`.
   - يرتب حسب `modified` تنازلياً.

### سلوك الاحتياط للبيانات الوصفية

لملخصات الجلسات الأخيرة (`RecentSessionInfo`):

- أولوية اسم العرض: `header.title` -> أول موجه للمستخدم -> `header.id` -> اسم الملف
- يُقطع الاسم إلى 40 حرفاً للعروض المدمجة
- تُجرَّد أحرف التحكم وأسطر النهاية أو يُعقَّمها من الأسماء المستخرجة من العنوان

لمدخلات قائمة `SessionInfo`:

- `title` هو `header.title` أو أحدث `shortSummary` من الضغط
- `firstMessage` هو نص رسالة المستخدم الأولى أو `"(no messages)"`

## حل `--continue` وتفضيل مسار التنقل الطرفي

يحل `SessionManager.continueRecent(cwd, sessionDir?)` الهدف بهذا الترتيب:

1. قراءة مسار التنقل المرتبط بالطرفية (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. التحقق من صحة مسار التنقل:
   - يمكن تحديد الطرفية الحالية
   - يتطابق cwd في مسار التنقل مع cwd الحالي (مقارنة المسار المحلول)
   - الملف المُشار إليه لا يزال موجوداً
3. إذا كان مسار التنقل غير صالح أو مفقوداً، يعود إلى أحدث ملف حسب mtime في دليل الجلسة (`findMostRecentSession`)
4. إذا لم يُعثَر على أي شيء، يُنشئ جلسة جديدة

اشتقاق معرّف الطرفية يُفضّل مسار TTY ويعود إلى المعرّفات البيئية (`KITTY_WINDOW_ID`، `TMUX_PANE`، `TERM_SESSION_ID`، `WT_SESSION`).

كتابة مسارات التنقل تُبذل جهدها وغير مميتة عند الفشل.

## حل هدف الاستئناف عند بدء التشغيل (`main.ts`)

### `--resume <value>`

يتعامل `createSessionManager(...)` مع `--resume` ذي القيمة النصية في وضعين:

1. قيمة تشبه المسار (تحتوي على `/` أو `\\` أو تنتهي بـ `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` مباشرةً

2. قيمة بادئة معرّف
   - البحث عن تطابق في `SessionManager.list(cwd, sessionDir)` بواسطة `id.startsWith(sessionArg)`
   - إذا لم يُعثَر على تطابق محلي ولم يُفرض `sessionDir`، تجرَّب `SessionManager.listAll()`
   - يُستخدم التطابق الأول (لا يوجد موجه لحالة الغموض)

سلوك التطابق عبر المشاريع:

- إذا اختلف cwd للجلسة المتطابقة عن cwd الحالي، يسأل CLI عما إذا كان سيتفرع إلى المشروع الحالي
- نعم -> `SessionManager.forkFrom(...)`
- لا -> يطرح خطأ (`Session "..." is in another project (...)`)

عدم التطابق -> يطرح خطأ (`Session "..." not found.`).

### `--resume` (بدون قيمة)

يُعالَج بعد إنشاء مدير الجلسة الأولي:

1. إدراج الجلسات المحلية بواسطة `SessionManager.list(cwd, parsed.sessionDir)`
2. إذا كانت فارغة: طباعة `No sessions found` والخروج المبكر
3. فتح أداة الاختيار TUI (`selectSession`)
4. إذا أُلغي: طباعة `No session selected` والخروج المبكر
5. إذا جرى الاختيار: `SessionManager.open(selectedPath)`

### `--continue`

يستخدم `SessionManager.continueRecent(...)` مباشرةً (السلوك القائم على مسار التنقل أعلاه).

## آليات الاختيار عبر أداة الاختيار

## أداة الاختيار عبر CLI (`src/cli/session-picker.ts`)

تُنشئ `selectSession(sessions)` واجهة TUI مستقلة مع `SessionSelectorComponent` وتحل مرة واحدة تماماً:

- الاختيار -> يحل مسار الاختيار
- الإلغاء (Esc) -> يحل `null`
- الخروج القسري (مسار Ctrl+C) -> يوقف TUI وينفذ `process.exit(0)`

## أداة الاختيار التفاعلية داخل الجلسة (`SelectorController.showSessionSelector`)

التدفق:

1. جلب الجلسات من دليل الجلسة الحالي عبر `SessionManager.list(currentCwd, currentSessionDir)`
2. تحميل `SessionSelectorComponent` في منطقة المحرر باستخدام `showSelector(...)`
3. ردود الاستدعاء:
   - اختيار -> إغلاق أداة الاختيار واستدعاء `handleResumeSession(sessionPath)`
   - إلغاء -> استعادة المحرر وإعادة العرض
   - خروج -> `ctx.shutdown()`

## سلوك مكوّن أداة اختيار الجلسة

تدعم `SessionList`:

- التنقل بالأسهم والصفحات
- Enter للاختيار
- Esc للإلغاء
- Ctrl+C للخروج
- البحث الضبابي عبر معرّف الجلسة/العنوان/cwd/الرسالة الأولى/جميع الرسائل/المسار

سلوك العرض عند القائمة الفارغة:

- يعرض رسالة بدلاً من التعطل
- Enter على قائمة فارغة لا يفعل شيئاً (لا يوجد استدعاء)
- Esc/Ctrl+C لا يزالان يعملان

تحفظ: النص في واجهة المستخدم يقول `Press Tab to view all`، لكن هذا المكوّن لا يحتوي حالياً على معالج Tab والتوصيل الحالي يُدرج جلسات النطاق الحالي فقط.

## تنفيذ التبديل في وقت التشغيل (`AgentSession.switchSession`)

`switchSession(sessionPath)` هو مسار التبديل الأساسي داخل العملية.

دورة الحياة/انتقال الحالة:

1. التقاط `previousSessionFile`
2. إرسال حدث خطاف `session_before_switch` (`reason: "resume"`، قابل للإلغاء)
3. إذا أُلغي -> إرجاع `false` بدون تبديل
4. قطع الاتصال بتدفق أحداث الوكيل الحالي
5. إيقاف تدفق التوليد/الأدوات النشط
6. مسح قوائم انتظار الرسائل التوجيهية/المتابعة/الدور التالي
7. تفريغ كاتب الجلسة (`sessionManager.flush()`) للإبقاء على الكتابات المعلقة
8. `sessionManager.setSessionFile(sessionPath)`
   - تحديث مؤشر ملف الجلسة
   - كتابة مسار التنقل الطرفي
   - تحميل المدخلات / الترحيل / حل النقاط العمياء / إعادة الفهرسة
   - إذا كانت بيانات الملف مفقودة/غير صالحة: تهيئة جلسة جديدة في ذلك المسار وإعادة كتابة الترويسة
9. تحديث `agent.sessionId`
10. إعادة بناء السياق عبر `buildSessionContext()`
11. إرسال حدث خطاف `session_switch` (`reason: "resume"`، `previousSessionFile`)
12. استبدال رسائل الوكيل بالسياق المُعاد بناؤه
13. استعادة النموذج الافتراضي من `sessionContext.models.default` إذا كان متاحاً وموجوداً في سجل النماذج
14. استعادة مستوى التفكير:
    - إذا كانت الفرعية تحتوي بالفعل على `thinking_level_change`، طبّق مستوى الجلسة المحفوظ
    - وإلا استخرج مستوى التفكير الافتراضي من الإعدادات، اقطعه وفق قدرة النموذج، اضبطه وأضف مدخلة `thinking_level_change` جديدة
15. إعادة توصيل مستمعي الوكيل وإرجاع `true`

## إعادة بناء حالة واجهة المستخدم بعد التبديل التفاعلي

تُنفّذ `SelectorController.handleResumeSession` إعادة ضبط واجهة المستخدم حول `switchSession`:

- إيقاف رسوم التحميل المتحركة
- مسح حاوية الحالة
- مسح واجهة الرسائل المعلقة وخريطة الأدوات المعلقة
- إعادة ضبط مكوّن البث/مراجع الرسائل
- استدعاء `session.switchSession(...)`
- مسح حاوية الدردشة وإعادة العرض من سياق الجلسة (`renderInitialMessages`)
- إعادة تحميل مهام المستخدم من قطع الجلسة الجديدة
- عرض `Resumed session`

لذا تُعاد بناء حالة المحادثة/المهام المرئية من ملف الجلسة الجديد.

## الاستئناف عند بدء التشغيل مقابل التبديل داخل الجلسة

### الاستئناف عند بدء التشغيل (`--continue`، `--resume`، الفتح المباشر)

- يُختار ملف الجلسة قبل `createAgentSession(...)`.
- يبني `sdk.ts` `existingSession = sessionManager.buildSessionContext()`.
- تُستعاد رسائل الوكيل مرة واحدة أثناء إنشاء الجلسة.
- يُختار النموذج/التفكير أثناء الإنشاء (بما في ذلك منطق الاستعادة/الاحتياط).
- ثم يُشغّل الوضع التفاعلي `#restoreModeFromSession()` لإعادة الدخول إلى حالة الوضع المثبتة (حالياً plan/plan_paused).

### التبديل داخل الجلسة (مسار أداة الاختيار بنمط `/resume`)

- يستخدم `AgentSession.switchSession(...)` على `AgentSession` قيد التشغيل.
- تُعاد بناء الرسائل/النموذج/التفكير فوراً في مكانها.
- تُرسَل أحداث خطاف `session_before_switch`/`session_switch`.
- تُحدَّث واجهة المحادثة/المهام.
- لا يُجرى استدعاء مخصص لاستعادة الوضع بعد التبديل في تدفق أداة الاختيار؛ سلوك إعادة دخول الوضع غير متماثل مع `#restoreModeFromSession()` عند بدء التشغيل.

## سلوك حالات الفشل والحالات الحافة

### مسارات الإلغاء

- إلغاء أداة اختيار CLI -> يُعيد `null`، يطبع المستدعي `No session selected`، تخرج العملية مبكراً.
- إلغاء أداة الاختيار التفاعلية -> يُستعاد المحرر، لا يتغير الجلسة.
- إلغاء الخطاف (`session_before_switch`) -> يُعيد `switchSession()` القيمة `false`.

### مسارات القائمة الفارغة

- CLI `--resume` (بدون قيمة): تطبع القائمة الفارغة `No sessions found` وتخرج.
- أداة الاختيار التفاعلية: القائمة الفارغة تعرض رسالة وتبقى قابلة للإلغاء.

### ملف الجلسة المستهدف المفقود/غير الصالح

عند الفتح/التبديل إلى مسار محدد (`setSessionFile`):

- ENOENT -> يُعامَل كفارغ -> تُهيأ جلسة جديدة في ذلك المسار بالضبط وتُثبَّت.
- ترويسة مشوهة/غير صالحة (أو مدخلات محللة غير قابلة للقراءة فعلياً) -> تُعامَل كفارغة -> تُهيأ جلسة جديدة وتُثبَّت.

هذا سلوك استرداد، وليس فشلاً كاملاً.

### الفشل الكامل

لا يزال التبديل/الفتح قادراً على إطلاق أخطاء عند حدوث إخفاقات I/O حقيقية (أخطاء الأذونات، أخطاء إعادة الكتابة، إلخ)، والتي تنتشر إلى المستدعين.

### تحفظات مطابقة بادئة المعرّف

- تستخدم مطابقة المعرّف `startsWith` وتأخذ أول تطابق في القائمة المرتبة.
- لا توجد واجهة مستخدم للغموض إذا كانت جلسات متعددة تشترك في البادئة.
- يستثني `SessionManager.list(...)` الجلسات ذات الصفر رسائل، لذا فتلك الجلسات غير قابلة للاستئناف عبر مطابقة المعرّف/أداة اختيار القائمة.
