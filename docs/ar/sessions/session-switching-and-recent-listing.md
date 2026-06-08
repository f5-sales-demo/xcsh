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

# تبديل الجلسات وعرض قائمة الجلسات الأخيرة

يصف هذا المستند كيف يكتشف coding-agent الجلسات الأخيرة، ويحل أهداف `--resume`، ويعرض أدوات اختيار الجلسات، ويبدّل جلسة وقت التشغيل النشطة.

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

### نطاق المجلد

يخزّن `SessionManager` الجلسات ضمن مجلد محدد بنطاق دليل العمل الحالي (cwd) افتراضياً:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

تقرأ `SessionManager.list(cwd, sessionDir?)` ذلك المجلد فقط ما لم يتم توفير `sessionDir` صريح.

### مساران للعرض بحمولات بيانات مختلفة

هناك مساران مختلفان لخط معالجة العرض:

1. `getRecentSessions(sessionDir, limit)` (عرض الترحيب/الملخص)
   - يقرأ فقط بادئة بحجم 4 كيلوبايت (`readTextPrefix(..., 4096)`) من كل ملف.
   - يحلل الترويسة + معاينة أقدم نص للمستخدم.
   - يُرجع `RecentSessionInfo` خفيفة الوزن مع getters كسولة لـ `name` و `timeAgo`.
   - يرتب حسب `mtime` للملف تنازلياً.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (أدوات اختيار الاستئناف ومطابقة المعرّفات)
   - يقرأ ملفات الجلسات كاملة.
   - يبني كائنات `SessionInfo` (`id`، `cwd`، `title`، `messageCount`، `firstMessage`، `allMessagesText`، الطوابع الزمنية).
   - يستبعد الجلسات التي لا تحتوي على أي إدخالات `message`.
   - يرتب حسب `modified` تنازلياً.

### سلوك البيانات الوصفية البديلة

بالنسبة للملخصات الأخيرة (`RecentSessionInfo`):

- أولوية اسم العرض: `header.title` -> أول مطالبة للمستخدم -> `header.id` -> اسم الملف
- يُقتطع الاسم إلى 40 حرفاً للعروض المدمجة
- تُزال/تُنظّف أحرف التحكم والأسطر الجديدة من الأسماء المشتقة من العنوان

بالنسبة لإدخالات قائمة `SessionInfo`:

- `title` هو `header.title` أو أحدث `shortSummary` للضغط
- `firstMessage` هو نص أول رسالة للمستخدم أو `"(no messages)"`

## حل `--continue` وتفضيل علامة الطرفية

تحل `SessionManager.continueRecent(cwd, sessionDir?)` الهدف بهذا الترتيب:

1. قراءة علامة محددة بنطاق الطرفية (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. التحقق من صحة العلامة:
   - يمكن تحديد الطرفية الحالية
   - دليل العمل الحالي للعلامة يطابق دليل العمل الحالي (مقارنة المسار المحلول)
   - الملف المرجعي لا يزال موجوداً
3. إذا كانت العلامة غير صالحة/مفقودة، يعود إلى أحدث ملف حسب mtime في مجلد الجلسات (`findMostRecentSession`)
4. إذا لم يُعثر على أي جلسة، يُنشئ جلسة جديدة

يفضّل اشتقاق معرّف الطرفية مسار TTY ويعود إلى المعرّفات المبنية على متغيرات البيئة (`KITTY_WINDOW_ID`، `TMUX_PANE`، `TERM_SESSION_ID`، `WT_SESSION`).

كتابة العلامات تتم بأفضل جهد وليست قاتلة للعملية.

## حل هدف الاستئناف عند بدء التشغيل (`main.ts`)

### `--resume <value>`

تعالج `createSessionManager(...)` قيمة `--resume` النصية في وضعين:

1. قيمة تشبه المسار (تحتوي على `/`، `\\`، أو تنتهي بـ `.jsonl`)
   - فتح مباشر `SessionManager.open(sessionArg, parsed.sessionDir)`

2. قيمة بادئة معرّف
   - البحث عن تطابق في `SessionManager.list(cwd, sessionDir)` عبر `id.startsWith(sessionArg)`
   - إذا لم يوجد تطابق محلي ولم يُفرض `sessionDir`، يحاول `SessionManager.listAll()`
   - يُستخدم أول تطابق (بدون مطالبة بحل الغموض)

سلوك المطابقة عبر المشاريع:

- إذا كان دليل العمل الحالي للجلسة المطابقة يختلف عن دليل العمل الحالي، يسأل CLI ما إذا كان يجب التفريع إلى المشروع الحالي
- نعم -> `SessionManager.forkFrom(...)`
- لا -> يرمي خطأ (`Session "..." is in another project (...)`)

عدم وجود تطابق -> يرمي خطأ (`Session "..." not found.`).

### `--resume` (بدون قيمة)

يُعالج بعد إنشاء مدير الجلسات الأولي:

1. عرض الجلسات المحلية باستخدام `SessionManager.list(cwd, parsed.sessionDir)`
2. إذا كانت فارغة: يطبع `No sessions found` وينتهي مبكراً
3. يفتح أداة اختيار TUI (`selectSession`)
4. إذا أُلغي: يطبع `No session selected` وينتهي مبكراً
5. إذا تم الاختيار: `SessionManager.open(selectedPath)`

### `--continue`

يستخدم `SessionManager.continueRecent(...)` مباشرة (سلوك أولوية العلامة المذكور أعلاه).

## تفاصيل الاختيار المبني على أداة الانتقاء

## أداة اختيار CLI (`src/cli/session-picker.ts`)

تنشئ `selectSession(sessions)` واجهة TUI مستقلة مع `SessionSelectorComponent` وتُحل مرة واحدة بالضبط:

- الاختيار -> تُحل بالمسار المحدد
- الإلغاء (Esc) -> تُحل بـ `null`
- الخروج الصعب (مسار Ctrl+C) -> يوقف TUI ويستدعي `process.exit(0)`

## أداة الانتقاء التفاعلية داخل الجلسة (`SelectorController.showSessionSelector`)

المسار:

1. جلب الجلسات من مجلد الجلسة الحالي عبر `SessionManager.list(currentCwd, currentSessionDir)`
2. تحميل `SessionSelectorComponent` في منطقة المحرر باستخدام `showSelector(...)`
3. ردود الاتصال:
   - الاختيار -> إغلاق أداة الانتقاء واستدعاء `handleResumeSession(sessionPath)`
   - الإلغاء -> استعادة المحرر وإعادة العرض
   - الخروج -> `ctx.shutdown()`

## سلوك مكون اختيار الجلسة

يدعم `SessionList`:

- التنقل بالأسهم/الصفحات
- Enter للاختيار
- Esc للإلغاء
- Ctrl+C للخروج
- البحث الغامض عبر معرّف الجلسة/العنوان/دليل العمل الحالي/الرسالة الأولى/جميع الرسائل/المسار

سلوك العرض عند القائمة الفارغة:

- يعرض رسالة بدلاً من التعطل
- الضغط على Enter عند الفراغ لا يفعل شيئاً (بدون رد اتصال)
- Esc/Ctrl+C لا يزالان يعملان

تنبيه: يقول نص الواجهة `Press Tab to view all`، لكن هذا المكون لا يملك حالياً معالج Tab والتوصيل الحالي يعرض فقط جلسات النطاق الحالي.

## تنفيذ التبديل أثناء التشغيل (`AgentSession.switchSession`)

`switchSession(sessionPath)` هو مسار التبديل الأساسي داخل العملية.

دورة الحياة/انتقال الحالة:

1. التقاط `previousSessionFile`
2. إصدار حدث خطاف `session_before_switch` (`reason: "resume"`، قابل للإلغاء)
3. إذا أُلغي -> يُرجع `false` بدون تبديل
4. قطع الاتصال من تدفق أحداث الوكيل الحالي
5. إلغاء التوليد/تدفق الأدوات النشط
6. مسح مخازن رسائل التوجيه/المتابعة/الدور التالي المنتظرة
7. تفريغ كاتب الجلسة (`sessionManager.flush()`) لحفظ الكتابات المعلقة
8. `sessionManager.setSessionFile(sessionPath)`
   - يحدّث مؤشر ملف الجلسة
   - يكتب علامة الطرفية
   - يحمّل الإدخالات / يهاجر / يحل البيانات الثنائية / يعيد الفهرسة
   - إذا كانت بيانات الملف مفقودة/غير صالحة: يُهيئ جلسة جديدة في ذلك المسار ويعيد كتابة الترويسة
9. تحديث `agent.sessionId`
10. إعادة بناء السياق عبر `buildSessionContext()`
11. إصدار حدث خطاف `session_switch` (`reason: "resume"`، `previousSessionFile`)
12. استبدال رسائل الوكيل بالسياق المعاد بناؤه
13. استعادة النموذج الافتراضي من `sessionContext.models.default` إذا كان متاحاً وموجوداً في سجل النماذج
14. استعادة مستوى التفكير:
    - إذا كان الفرع يحتوي بالفعل على `thinking_level_change`، يُطبّق مستوى الجلسة المحفوظ
    - وإلا يشتق مستوى التفكير الافتراضي من الإعدادات، يقيّده بقدرة النموذج، يضبطه، ويُلحق إدخال `thinking_level_change` جديد
15. إعادة توصيل مستمعي الوكيل وإرجاع `true`

## إعادة بناء حالة الواجهة بعد التبديل التفاعلي

تقوم `SelectorController.handleResumeSession` بإعادة تعيين الواجهة حول `switchSession`:

- إيقاف رسوم التحميل المتحركة
- مسح حاوية الحالة
- مسح واجهة الرسائل المعلقة وخريطة الأدوات المعلقة
- إعادة تعيين مراجع مكون البث/الرسالة
- استدعاء `session.switchSession(...)`
- مسح حاوية المحادثة وإعادة العرض من سياق الجلسة (`renderInitialMessages`)
- إعادة تحميل المهام من عناصر الجلسة الجديدة
- عرض `Resumed session`

لذا تُعاد بناء حالة المحادثة/المهام المرئية من ملف الجلسة الجديد.

## الاستئناف عند بدء التشغيل مقابل التبديل داخل الجلسة

### الاستئناف عند بدء التشغيل (`--continue`، `--resume`، الفتح المباشر)

- يُختار ملف الجلسة قبل `createAgentSession(...)`.
- يبني `sdk.ts` `existingSession = sessionManager.buildSessionContext()`.
- تُستعاد رسائل الوكيل مرة واحدة أثناء إنشاء الجلسة.
- يُختار النموذج/التفكير أثناء الإنشاء (بما في ذلك منطق الاستعادة/البديل).
- ثم يشغّل الوضع التفاعلي `#restoreModeFromSession()` لإعادة الدخول في حالة الوضع المحفوظ (حالياً plan/plan_paused).

### التبديل داخل الجلسة (مسار أداة انتقاء نمط `/resume`)

- يستخدم `AgentSession.switchSession(...)` على `AgentSession` قيد التشغيل بالفعل.
- تُعاد بناء الرسائل/النموذج/التفكير فوراً في مكانها.
- تُصدر أحداث خطاف `session_before_switch`/`session_switch`.
- تُحدّث المحادثة/المهام في الواجهة.
- لا يوجد استدعاء مخصص لاستعادة الوضع بعد التبديل في مسار أداة الانتقاء؛ سلوك إعادة دخول الوضع ليس متماثلاً مع `#restoreModeFromSession()` عند بدء التشغيل.

## سلوك الفشل والحالات الطرفية

### مسارات الإلغاء

- إلغاء أداة اختيار CLI -> يُرجع `null`، المستدعي يطبع `No session selected`، العملية تنتهي مبكراً.
- إلغاء أداة الانتقاء التفاعلية -> يُستعاد المحرر، بدون تغيير في الجلسة.
- إلغاء الخطاف (`session_before_switch`) -> `switchSession()` تُرجع `false`.

### مسارات القائمة الفارغة

- CLI `--resume` (بدون قيمة): القائمة الفارغة تطبع `No sessions found` وتنتهي.
- أداة الانتقاء التفاعلية: القائمة الفارغة تعرض رسالة وتبقى قابلة للإلغاء.

### ملف الجلسة الهدف مفقود/غير صالح

عند فتح/التبديل إلى مسار محدد (`setSessionFile`):

- ENOENT -> يُعامل كفارغ -> تُهيّأ جلسة جديدة في ذلك المسار بالضبط وتُحفظ.
- ترويسة مشوّهة/غير صالحة (أو إدخالات محللة غير قابلة للقراءة فعلياً) -> تُعامل كفارغة -> تُهيّأ جلسة جديدة وتُحفظ.

هذا سلوك استرداد، وليس فشلاً حاداً.

### حالات الفشل الحادة

يمكن أن يرمي التبديل/الفتح خطأ عند فشل الإدخال/الإخراج الحقيقي (أخطاء الأذونات، فشل إعادة الكتابة، إلخ)، وهذه الأخطاء تنتشر إلى المستدعين.

### تنبيهات مطابقة بادئة المعرّف

- مطابقة المعرّف تستخدم `startsWith` وتأخذ أول تطابق في القائمة المرتبة.
- لا توجد واجهة لحل الغموض إذا تشاركت جلسات متعددة نفس البادئة.
- `SessionManager.list(...)` تستبعد الجلسات التي لا تحتوي على رسائل، لذا هذه الجلسات غير قابلة للاستئناف عبر مطابقة المعرّف/أداة اختيار القائمة.
