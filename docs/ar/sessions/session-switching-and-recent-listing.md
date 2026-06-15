---
title: تبديل الجلسة وعرض الجلسات الأخيرة
description: آليات تبديل الجلسة وعرض الجلسات الأخيرة مع البحث والتصفية.
sidebar:
  order: 4
  label: التبديل والجلسات الأخيرة
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# تبديل الجلسة وعرض الجلسات الأخيرة

يصف هذا المستند كيفية اكتشاف وكيل البرمجة للجلسات الأخيرة، وتحليل أهداف `--resume`، وعرض أدوات اختيار الجلسة، وتبديل جلسة التشغيل النشطة.

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

يخزّن `SessionManager` الجلسات ضمن دليل مُحدَّد بنطاق cwd افتراضيًا:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

تقرأ `SessionManager.list(cwd, sessionDir?)` ذلك الدليل فقط ما لم يُقدَّم `sessionDir` صريح.

### مساران للعرض بحمولات مختلفة

ثمة مساران مختلفان لمعالجة القوائم:

1. `getRecentSessions(sessionDir, limit)` (عرض الترحيب/الملخص)
   - يقرأ بادئة 4KB فقط (`readTextPrefix(..., 4096)`) من كل ملف.
   - يحلل الترويسة ومعاينة أول نص مستخدم.
   - يُعيد `RecentSessionInfo` خفيف الوزن مع أدوات جلب `name` و`timeAgo` كسولة.
   - يرتب بترتيب تنازلي حسب `mtime` للملف.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (أدوات الاستئناف واستيفاء المعرّف)
   - يقرأ ملفات الجلسة الكاملة.
   - يبني كائنات `SessionInfo` (`id`، `cwd`، `title`، `messageCount`، `firstMessage`، `allMessagesText`، الطوابع الزمنية).
   - يُسقط الجلسات ذات صفر من إدخالات `message`.
   - يرتب بترتيب تنازلي حسب `modified`.

### سلوك الاحتياط للبيانات الوصفية

للملخصات الأخيرة (`RecentSessionInfo`):

- تفضيل اسم العرض: `header.title` -> أول موجه مستخدم -> `header.id` -> اسم الملف
- يُقطع الاسم إلى 40 حرفًا للعروض المدمجة
- تُزال أحرف التحكم/أسطر السطر الجديد وتُصحح من الأسماء المستمدة من العنوان

لإدخالات قائمة `SessionInfo`:

- `title` هو `header.title` أو آخر `shortSummary` للضغط
- `firstMessage` هو نص أول رسالة مستخدم أو `"(no messages)"`

## تحليل `--continue` وتفضيل بصمة الطرفية

تحلّ `SessionManager.continueRecent(cwd, sessionDir?)` الهدف بهذا الترتيب:

1. قراءة بصمة نطاق الطرفية (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. التحقق من صحة البصمة:
   - يمكن تحديد الطرفية الحالية
   - يتطابق cwd البصمة مع cwd الحالية (مقارنة المسار المحلول)
   - الملف المُشار إليه لا يزال موجودًا
3. إذا كانت البصمة غير صالحة/مفقودة، الاحتياط إلى أحدث ملف بـ mtime في دليل الجلسة (`findMostRecentSession`)
4. إذا لم يُوجد أي ملف، إنشاء جلسة جديدة

يُفضّل اشتقاق معرّف الطرفية مسار TTY ويحتاط إلى معرّفات قائمة على البيئة (`KITTY_WINDOW_ID`، `TMUX_PANE`، `TERM_SESSION_ID`، `WT_SESSION`).

كتابات البصمة تبذل أفضل جهد ولا تُسبب فشلًا مميتًا.

## تحليل هدف الاستئناف عند بدء التشغيل (`main.ts`)

### `--resume <value>`

تتعامل `createSessionManager(...)` مع `--resume` ذي قيمة نصية في وضعين:

1. قيمة شبيهة بالمسار (تحتوي على `/`، أو `\\`، أو تنتهي بـ `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` مباشرةً

2. قيمة بادئة المعرّف
   - البحث عن تطابق في `SessionManager.list(cwd, sessionDir)` عبر `id.startsWith(sessionArg)`
   - إذا لم يكن هناك تطابق محلي ولم يُفرض `sessionDir`، جرّب `SessionManager.listAll()`
   - يُستخدم أول تطابق (لا يوجد موجه للغموض)

سلوك التطابق عبر المشاريع:

- إذا اختلف cwd الجلسة المُطابقة عن cwd الحالية، يسأل CLI إذا كان المستخدم يريد التفريع إلى المشروع الحالي
- نعم -> `SessionManager.forkFrom(...)`
- لا -> يُطلق خطأ (`Session "..." is in another project (...)`)

لا تطابق -> يُطلق خطأ (`Session "..." not found.`).

### `--resume` (بدون قيمة)

يُعالج بعد إنشاء مدير الجلسة الأولي:

1. عرض الجلسات المحلية باستخدام `SessionManager.list(cwd, parsed.sessionDir)`
2. إذا كانت فارغة: طباعة `No sessions found` والخروج مبكرًا
3. فتح أداة الاختيار TUI (`selectSession`)
4. إذا أُلغي: طباعة `No session selected` والخروج مبكرًا
5. إذا اختير: `SessionManager.open(selectedPath)`

### `--continue`

يستخدم `SessionManager.continueRecent(...)` مباشرةً (السلوك المعتمد على البصمة أعلاه).

## آليات الاختيار القائمة على أداة الاختيار

## أداة اختيار CLI (`src/cli/session-picker.ts`)

تُنشئ `selectSession(sessions)` واجهة TUI مستقلة مع `SessionSelectorComponent` وتحل مرة واحدة بالضبط:

- الاختيار -> يحل المسار المختار
- الإلغاء (Esc) -> يحل `null`
- الخروج القسري (مسار Ctrl+C) -> يوقف TUI ويستدعي `process.exit(0)`

## أداة الاختيار التفاعلية داخل الجلسة (`SelectorController.showSessionSelector`)

التدفق:

1. جلب الجلسات من دليل الجلسة الحالي عبر `SessionManager.list(currentCwd, currentSessionDir)`
2. تركيب `SessionSelectorComponent` في منطقة المحرر باستخدام `showSelector(...)`
3. ردود النداء:
   - الاختيار -> إغلاق أداة الاختيار واستدعاء `handleResumeSession(sessionPath)`
   - الإلغاء -> استعادة المحرر وإعادة العرض
   - الخروج -> `ctx.shutdown()`

## سلوك مكوّن اختيار الجلسة

تدعم `SessionList`:

- التنقل بالأسهم/الصفحات
- Enter للاختيار
- Esc للإلغاء
- Ctrl+C للخروج
- البحث الضبابي عبر معرّف الجلسة/العنوان/cwd/أول رسالة/جميع الرسائل/المسار

سلوك عرض القائمة الفارغة:

- يعرض رسالة بدلًا من الانهيار
- Enter على القائمة الفارغة لا يفعل شيئًا (لا رد نداء)
- Esc/Ctrl+C لا يزالان يعملان

تحفظ: نص واجهة المستخدم يقول `Press Tab to view all`، لكن هذا المكوّن لا يحتوي حاليًا على معالج Tab والتوصيل الحالي يسرد جلسات النطاق الحالي فحسب.

## تنفيذ التبديل في وقت التشغيل (`AgentSession.switchSession`)

`switchSession(sessionPath)` هو مسار التبديل الأساسي داخل العملية.

دورة الحياة/انتقال الحالة:

1. التقاط `previousSessionFile`
2. إطلاق حدث هوك `session_before_switch` (`reason: "resume"`، قابل للإلغاء)
3. إذا أُلغي -> إعادة `false` بدون تبديل
4. قطع الاتصال عن تدفق أحداث الوكيل الحالي
5. إلغاء تدفق التوليد/الأداة النشط
6. مسح المخازن المؤقتة لرسائل التوجيه/المتابعة/الدور التالي المُنتظرة
7. مسح كاتب الجلسة (`sessionManager.flush()`) لإبقاء الكتابات المعلقة
8. `sessionManager.setSessionFile(sessionPath)`
   - يحدث مؤشر ملف الجلسة
   - يكتب بصمة الطرفية
   - يُحمّل الإدخالات / يُهاجر / يحل الكتلة / يُعيد الفهرسة
   - إذا كانت بيانات الملف مفقودة/غير صالحة: يُهيئ جلسة جديدة في ذلك المسار ويُعيد كتابة الترويسة
9. تحديث `agent.sessionId`
10. إعادة بناء السياق عبر `buildSessionContext()`
11. إطلاق حدث هوك `session_switch` (`reason: "resume"`، `previousSessionFile`)
12. استبدال رسائل الوكيل بالسياق المُعاد بناؤه
13. استعادة النموذج الافتراضي من `sessionContext.models.default` إذا كان متاحًا وموجودًا في سجل النماذج
14. استعادة مستوى التفكير:
    - إذا كان الفرع يحتوي بالفعل على `thinking_level_change`، تطبيق مستوى الجلسة المحفوظ
    - وإلا اشتقاق مستوى التفكير الافتراضي من الإعدادات، تقليصه لقدرة النموذج، تعيينه، وإضافة إدخال `thinking_level_change` جديد
15. إعادة توصيل مستمعي الوكيل وإعادة `true`

## إعادة بناء حالة واجهة المستخدم بعد التبديل التفاعلي

تُجري `SelectorController.handleResumeSession` إعادة تعيين واجهة المستخدم حول `switchSession`:

- إيقاف رسوم التحميل المتحركة
- مسح حاوية الحالة
- مسح واجهة الرسائل المعلقة وخريطة الأدوات المعلقة
- إعادة تعيين مراجع مكوّن/رسالة البث
- استدعاء `session.switchSession(...)`
- مسح حاوية الدردشة وإعادة العرض من سياق الجلسة (`renderInitialMessages`)
- إعادة تحميل المهام من مخرجات الجلسة الجديدة
- عرض `Resumed session`

وهكذا يُعاد بناء حالة المحادثة/المهام المرئية من ملف الجلسة الجديد.

## الاستئناف عند بدء التشغيل مقابل التبديل داخل الجلسة

### الاستئناف عند بدء التشغيل (`--continue`، `--resume`، الفتح المباشر)

- يُختار ملف الجلسة قبل `createAgentSession(...)`.
- تبني `sdk.ts` الكائن `existingSession = sessionManager.buildSessionContext()`.
- تُستعاد رسائل الوكيل مرة واحدة أثناء إنشاء الجلسة.
- يُختار النموذج/التفكير أثناء الإنشاء (بما في ذلك منطق الاستعادة/الاحتياط).
- ثم يُشغّل الوضع التفاعلي `#restoreModeFromSession()` لإعادة الدخول إلى حالة الوضع المستمرة (plan/plan_paused حاليًا).

### التبديل داخل الجلسة (مسار أداة اختيار `/resume`)

- يستخدم `AgentSession.switchSession(...)` على `AgentSession` قيد التشغيل بالفعل.
- تُعاد بناء الرسائل/النموذج/التفكير فورًا في مكانها.
- تُطلق أحداث هوك `session_before_switch`/`session_switch`.
- تُحدَّث دردشة واجهة المستخدم/المهام.
- لا يُجرى استدعاء مخصص لاستعادة الوضع بعد التبديل في تدفق أداة الاختيار؛ سلوك إعادة الدخول إلى الوضع ليس متماثلًا مع `#restoreModeFromSession()` عند بدء التشغيل.

## سلوك الفشل وحالات الحافة

### مسارات الإلغاء

- إلغاء أداة اختيار CLI -> يُعيد `null`، يطبع المُستدعي `No session selected`، تخرج العملية مبكرًا.
- إلغاء أداة الاختيار التفاعلية -> يُستعاد المحرر، لا تغيير في الجلسة.
- إلغاء الهوك (`session_before_switch`) -> تُعيد `switchSession()` القيمة `false`.

### مسارات القائمة الفارغة

- CLI `--resume` (بدون قيمة): تطبع القائمة الفارغة `No sessions found` وتخرج.
- أداة الاختيار التفاعلية: تعرض القائمة الفارغة رسالة وتبقى قابلة للإلغاء.

### ملف الجلسة الهدف مفقود/غير صالح

عند الفتح/التبديل إلى مسار محدد (`setSessionFile`):

- ENOENT -> يُعامل كفارغ -> تُهيأ جلسة جديدة في ذلك المسار بالضبط وتُستمر.
- ترويسة مشوهة/غير صالحة (أو إدخالات محللة غير قابلة للقراءة فعليًا) -> تُعامل كفارغة -> تُهيأ جلسة جديدة وتُستمر.

هذا سلوك استرداد، لا فشل صارم.

### الفشل الصارم

يمكن أن يُطلق التبديل/الفتح استثناءات عند أخطاء I/O الحقيقية (أخطاء الأذونات، أخطاء إعادة الكتابة، إلخ)، والتي تنتشر إلى المُستدعين.

### تحفظات استيفاء بادئة المعرّف

- يستخدم استيفاء المعرّف `startsWith` ويأخذ أول تطابق في القائمة المرتبة.
- لا توجد واجهة للغموض إذا شاركت جلسات متعددة نفس البادئة.
- تستبعد `SessionManager.list(...)` الجلسات ذات الصفر من الرسائل، لذا لا يمكن استئناف تلك الجلسات عبر استيفاء المعرّف/أداة اختيار القائمة.
