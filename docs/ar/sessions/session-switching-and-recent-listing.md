---
title: Session Switching and Recent Session Listing
description: >-
  Session switching mechanics and recent session listing with search and
  filtering.
sidebar:
  order: 4
  label: التبديل والجلسات الأخيرة
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# تبديل الجلسات وقائمة الجلسات الأخيرة

يصف هذا المستند كيف يكتشف coding-agent الجلسات الأخيرة، ويحل أهداف `--resume`، ويعرض منتقيات الجلسات، ويبدّل جلسة وقت التشغيل النشطة.

يركز على سلوك التنفيذ الحالي، بما في ذلك المسارات البديلة والتنبيهات.

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

يخزّن `SessionManager` الجلسات تحت دليل محدد بنطاق دليل العمل الحالي (cwd) بشكل افتراضي:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

يقرأ `SessionManager.list(cwd, sessionDir?)` ذلك الدليل فقط ما لم يتم توفير `sessionDir` صريح.

### مساران للقوائم مع حمولات بيانات مختلفة

هناك مساران مختلفان لتجهيز القوائم:

1. `getRecentSessions(sessionDir, limit)` (عرض الترحيب/الملخص)
   - يقرأ فقط بادئة بحجم 4 كيلوبايت (`readTextPrefix(..., 4096)`) من كل ملف.
   - يحلل الترويسة + معاينة أول نص للمستخدم.
   - يُرجع `RecentSessionInfo` خفيفة الوزن مع محصّلات (getters) كسولة لـ `name` و `timeAgo`.
   - يرتب حسب `mtime` للملف تنازلياً.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (منتقيات الاستئناف ومطابقة المعرّفات)
   - يقرأ ملفات الجلسات كاملة.
   - يبني كائنات `SessionInfo` (`id`، `cwd`، `title`، `messageCount`، `firstMessage`، `allMessagesText`، الطوابع الزمنية).
   - يحذف الجلسات التي لا تحتوي على أي إدخالات `message`.
   - يرتب حسب `modified` تنازلياً.

### سلوك البيانات الوصفية الاحتياطي

لملخصات الجلسات الأخيرة (`RecentSessionInfo`):

- أولوية اسم العرض: `header.title` -> أول طلب للمستخدم -> `header.id` -> اسم الملف
- يُقتطع الاسم إلى 40 حرفاً للعروض المدمجة
- تُزال/تُنظّف أحرف التحكم والأسطر الجديدة من الأسماء المشتقة من العنوان

لإدخالات قائمة `SessionInfo`:

- `title` هو `header.title` أو أحدث `shortSummary` للضغط
- `firstMessage` هو نص أول رسالة للمستخدم أو `"(no messages)"`

## حل `--continue` وأولوية علامة الطرفية المرجعية

يحل `SessionManager.continueRecent(cwd, sessionDir?)` الهدف بهذا الترتيب:

1. قراءة العلامة المرجعية المحددة بنطاق الطرفية (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. التحقق من صحة العلامة المرجعية:
   - يمكن تحديد الطرفية الحالية
   - دليل العمل الحالي للعلامة المرجعية يطابق دليل العمل الحالي (مقارنة المسار المحلول)
   - الملف المُشار إليه لا يزال موجوداً
3. إذا كانت العلامة المرجعية غير صالحة/مفقودة، يُرجع إلى أحدث ملف حسب mtime في دليل الجلسات (`findMostRecentSession`)
4. إذا لم يُعثر على أي ملف، يُنشئ جلسة جديدة

يفضّل اشتقاق معرّف الطرفية مسار TTY ويعود إلى المعرّفات المبنية على متغيرات البيئة (`KITTY_WINDOW_ID`، `TMUX_PANE`، `TERM_SESSION_ID`، `WT_SESSION`).

كتابة العلامات المرجعية تتم بأفضل جهد وغير مسببة للفشل.

## حل هدف الاستئناف وقت بدء التشغيل (`main.ts`)

### `--resume <value>`

يعالج `createSessionManager(...)` قيمة `--resume` النصية في وضعين:

1. قيمة تشبه المسار (تحتوي على `/` أو `\\` أو تنتهي بـ `.jsonl`)
   - مباشرة `SessionManager.open(sessionArg, parsed.sessionDir)`

2. قيمة بادئة المعرّف
   - البحث عن تطابق في `SessionManager.list(cwd, sessionDir)` عبر `id.startsWith(sessionArg)`
   - إذا لم يوجد تطابق محلي و`sessionDir` غير مفروض، يُجرّب `SessionManager.listAll()`
   - يُستخدم أول تطابق (بدون طلب توضيح للغموض)

سلوك المطابقة عبر المشاريع:

- إذا كان دليل العمل الحالي للجلسة المطابقة يختلف عن دليل العمل الحالي، تسأل واجهة سطر الأوامر عما إذا كان ينبغي التفريع إلى المشروع الحالي
- نعم -> `SessionManager.forkFrom(...)`
- لا -> يُطلق خطأ (`Session "..." is in another project (...)`)

لا تطابق -> يُطلق خطأ (`Session "..." not found.`).

### `--resume` (بدون قيمة)

يُعالج بعد إنشاء مدير الجلسات الأولي:

1. سرد الجلسات المحلية عبر `SessionManager.list(cwd, parsed.sessionDir)`
2. إذا كانت فارغة: يطبع `No sessions found` ويخرج مبكراً
3. يفتح منتقي واجهة المستخدم النصية (`selectSession`)
4. إذا أُلغي: يطبع `No session selected` ويخرج مبكراً
5. إذا تم الاختيار: `SessionManager.open(selectedPath)`

### `--continue`

يستخدم `SessionManager.continueRecent(...)` مباشرة (سلوك أولوية العلامة المرجعية المذكور أعلاه).

## آليات الاختيار المبنية على المنتقي الداخلية

## منتقي واجهة سطر الأوامر (`src/cli/session-picker.ts`)

ينشئ `selectSession(sessions)` واجهة مستخدم نصية مستقلة مع `SessionSelectorComponent` ويُحل مرة واحدة بالضبط:

- الاختيار -> يُحل المسار المختار
- الإلغاء (Esc) -> يُحل `null`
- الخروج القسري (مسار Ctrl+C) -> يوقف واجهة المستخدم النصية و `process.exit(0)`

## منتقي الجلسة التفاعلي داخل الجلسة (`SelectorController.showSessionSelector`)

المسار:

1. جلب الجلسات من دليل الجلسة الحالي عبر `SessionManager.list(currentCwd, currentSessionDir)`
2. تركيب `SessionSelectorComponent` في منطقة المحرر باستخدام `showSelector(...)`
3. الاستدعاءات الراجعة:
   - الاختيار -> إغلاق المنتقي واستدعاء `handleResumeSession(sessionPath)`
   - الإلغاء -> استعادة المحرر وإعادة العرض
   - الخروج -> `ctx.shutdown()`

## سلوك مكوّن منتقي الجلسة

يدعم `SessionList`:

- التنقل بالأسهم/الصفحات
- Enter للاختيار
- Esc للإلغاء
- Ctrl+C للخروج
- بحث ضبابي عبر معرّف الجلسة/العنوان/دليل العمل الحالي/الرسالة الأولى/جميع الرسائل/المسار

سلوك عرض القائمة الفارغة:

- يعرض رسالة بدلاً من التعطل
- Enter على قائمة فارغة لا يفعل شيئاً (بدون استدعاء راجع)
- Esc/Ctrl+C لا يزالان يعملان

تنبيه: نص واجهة المستخدم يقول `Press Tab to view all`، لكن هذا المكوّن حالياً لا يحتوي على معالج Tab والتوصيل الحالي يسرد فقط جلسات النطاق الحالي.

## تنفيذ التبديل أثناء التشغيل (`AgentSession.switchSession`)

`switchSession(sessionPath)` هو مسار التبديل الأساسي داخل العملية.

دورة الحياة/انتقال الحالة:

1. التقاط `previousSessionFile`
2. إطلاق حدث الخطاف `session_before_switch` (`reason: "resume"`، قابل للإلغاء)
3. إذا أُلغي -> يُرجع `false` بدون تبديل
4. قطع الاتصال من تدفق أحداث الوكيل الحالي
5. إلغاء التوليد/تدفق الأدوات النشط
6. مسح مخازن الرسائل المؤقتة للتوجيه/المتابعة/الدور التالي
7. تفريغ كاتب الجلسة (`sessionManager.flush()`) لحفظ الكتابات المعلقة
8. `sessionManager.setSessionFile(sessionPath)`
   - يُحدّث مؤشر ملف الجلسة
   - يكتب العلامة المرجعية للطرفية
   - يُحمّل الإدخالات / يُهاجر / يحل البيانات الثنائية الكبيرة / يُعيد الفهرسة
   - إذا كانت بيانات الملف مفقودة/غير صالحة: يُهيّئ جلسة جديدة في ذلك المسار ويُعيد كتابة الترويسة
9. تحديث `agent.sessionId`
10. إعادة بناء السياق عبر `buildSessionContext()`
11. إطلاق حدث الخطاف `session_switch` (`reason: "resume"`، `previousSessionFile`)
12. استبدال رسائل الوكيل بالسياق المُعاد بناؤه
13. استعادة النموذج الافتراضي من `sessionContext.models.default` إذا كان متاحاً وموجوداً في سجل النماذج
14. استعادة مستوى التفكير:
    - إذا كان الفرع يحتوي بالفعل على `thinking_level_change`، يُطبّق مستوى الجلسة المحفوظ
    - وإلا يُشتق مستوى التفكير الافتراضي من الإعدادات، يُقيّد بقدرة النموذج، يُعيّن، ويُلحق إدخال `thinking_level_change` جديد
15. إعادة توصيل مستمعي الوكيل وإرجاع `true`

## إعادة بناء حالة واجهة المستخدم بعد التبديل التفاعلي

يقوم `SelectorController.handleResumeSession` بإعادة تعيين واجهة المستخدم حول `switchSession`:

- إيقاف حركة التحميل
- مسح حاوية الحالة
- مسح واجهة الرسالة المعلقة وخريطة الأدوات المعلقة
- إعادة تعيين مراجع مكوّن البث/الرسالة
- استدعاء `session.switchSession(...)`
- مسح حاوية المحادثة وإعادة العرض من سياق الجلسة (`renderInitialMessages`)
- إعادة تحميل المهام من مخرجات الجلسة الجديدة
- عرض `Resumed session`

لذا تُعاد بناء حالة المحادثة/المهام المرئية من ملف الجلسة الجديد.

## استئناف بدء التشغيل مقابل التبديل داخل الجلسة

### استئناف بدء التشغيل (`--continue`، `--resume`، الفتح المباشر)

- يُختار ملف الجلسة قبل `createAgentSession(...)`.
- يبني `sdk.ts` كائن `existingSession = sessionManager.buildSessionContext()`.
- تُستعاد رسائل الوكيل مرة واحدة أثناء إنشاء الجلسة.
- يُختار النموذج/التفكير أثناء الإنشاء (بما في ذلك منطق الاستعادة/الاحتياط).
- ثم يُشغّل الوضع التفاعلي `#restoreModeFromSession()` لإعادة الدخول في حالة الوضع المحفوظ (حالياً plan/plan_paused).

### التبديل داخل الجلسة (مسار منتقي نمط `/resume`)

- يستخدم `AgentSession.switchSession(...)` على `AgentSession` قيد التشغيل بالفعل.
- تُعاد بناء الرسائل/النموذج/التفكير فوراً في مكانها.
- تُطلق أحداث الخطاف `session_before_switch`/`session_switch`.
- تُحدّث محادثة/مهام واجهة المستخدم.
- لا يوجد استدعاء مخصص لاستعادة الوضع بعد التبديل في تدفق المنتقي؛ سلوك إعادة دخول الوضع ليس متماثلاً مع `#restoreModeFromSession()` عند بدء التشغيل.

## سلوك الفشل والحالات الحدية

### مسارات الإلغاء

- إلغاء منتقي واجهة سطر الأوامر -> يُرجع `null`، المستدعي يطبع `No session selected`، العملية تخرج مبكراً.
- إلغاء المنتقي التفاعلي -> يُستعاد المحرر، بدون تغيير في الجلسة.
- إلغاء الخطاف (`session_before_switch`) -> `switchSession()` يُرجع `false`.

### مسارات القائمة الفارغة

- `--resume` في واجهة سطر الأوامر (بدون قيمة): القائمة الفارغة تطبع `No sessions found` وتخرج.
- المنتقي التفاعلي: القائمة الفارغة تعرض رسالة وتبقى قابلة للإلغاء.

### ملف جلسة الهدف مفقود/غير صالح

عند فتح/التبديل إلى مسار محدد (`setSessionFile`):

- ENOENT -> يُعامل كفارغ -> تُهيّأ جلسة جديدة في ذلك المسار بالتحديد وتُحفظ.
- ترويسة مشوّهة/غير صالحة (أو إدخالات محللة غير قابلة للقراءة فعلياً) -> تُعامل كفارغة -> تُهيّأ جلسة جديدة وتُحفظ.

هذا سلوك استرداد، وليس فشلاً حاداً.

### حالات الفشل الحاد

التبديل/الفتح يمكن أن يُطلق استثناءات عند حدوث أعطال إدخال/إخراج حقيقية (أخطاء الأذونات، فشل إعادة الكتابة، إلخ)، والتي تنتشر إلى المستدعين.

### تنبيهات مطابقة بادئة المعرّف

- مطابقة المعرّف تستخدم `startsWith` وتأخذ أول تطابق في القائمة المرتبة.
- لا توجد واجهة لتوضيح الغموض إذا تشاركت جلسات متعددة في نفس البادئة.
- `SessionManager.list(...)` يستبعد الجلسات التي لا تحتوي على رسائل، لذا تلك الجلسات لا يمكن استئنافها عبر مطابقة المعرّف/منتقي القائمة.
