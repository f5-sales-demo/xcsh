---
title: Session Tree Architecture
description: >-
  Session tree architecture with branching, navigation, and parent-child
  conversation relationships.
sidebar:
  order: 2
  label: بنية الشجرة
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# بنية شجرة الجلسة (الحالية)

المرجع: [session.md](./session.md)

يصف هذا المستند كيفية عمل التنقل في شجرة الجلسة حالياً: نموذج الشجرة في الذاكرة، قواعد حركة الورقة، سلوك التفرع، وتكامل الإضافات/الأحداث.

## ما هو هذا النظام الفرعي

تُخزّن الجلسة كسجل إدخالات تراكمي (append-only)، لكن السلوك أثناء التشغيل يعتمد على بنية شجرية:

- كل إدخال غير رأسي يحتوي على `id` و `parentId`.
- الموضع النشط هو `leafId` في `SessionManager`.
- إضافة إدخال جديد تُنشئ دائماً ابناً للورقة الحالية.
- التفرع **لا** يُعيد كتابة التاريخ؛ بل يغيّر فقط الموضع الذي تشير إليه الورقة قبل الإضافة التالية.

الملفات الرئيسية:

- `src/session/session-manager.ts` — نموذج بيانات الشجرة، الاجتياز، حركة الورقة، استخراج الفروع/الجلسات
- `src/session/agent-session.ts` — تدفق التنقل `/tree`، التلخيص، إطلاق الخطافات/الأحداث
- `src/modes/components/tree-selector.ts` — سلوك واجهة الشجرة التفاعلية والتصفية
- `src/modes/controllers/selector-controller.ts` — تنسيق المحدد لـ `/tree` و `/branch`
- `src/modes/controllers/input-controller.ts` — توجيه الأوامر (`/tree`، `/branch`، سلوك الضغط المزدوج على Escape)
- `src/session/messages.ts` — تحويل إدخالات `branch_summary` و `compaction` و `custom_message` إلى رسائل سياق LLM

## نموذج بيانات الشجرة في `SessionManager`

الفهارس أثناء التشغيل:

- `#byId: Map<string, SessionEntry>` — بحث سريع لأي إدخال
- `#leafId: string | null` — الموضع الحالي في الشجرة
- `#labelsById: Map<string, string>` — التسميات المحلولة حسب معرّف الإدخال المستهدف

واجهات برمجة الشجرة:

- `getBranch(fromId?)` يتتبع روابط الأب حتى الجذر ويعيد المسار من الجذر إلى العقدة
- `getTree()` يعيد `SessionTreeNode[]` (`entry`، `children`، `label`)
  - روابط الأب تتحول إلى مصفوفات أبناء
  - الإدخالات ذات الآباء المفقودين تُعامَل كجذور
  - الأبناء مرتبون من الأقدم إلى الأحدث حسب الطابع الزمني
- `getChildren(parentId)` يعيد الأبناء المباشرين
- `getLabel(id)` يحل التسمية الحالية من `labelsById`

`getTree()` هو إسقاط أثناء التشغيل؛ يبقى التخزين الدائم إدخالات JSONL تراكمية.

## دلالات حركة الورقة

توجد ثلاث عمليات أولية لحركة الورقة:

1. `branch(entryId)`
   - يتحقق من وجود الإدخال
   - يضبط `leafId = entryId`
   - لا يُكتب إدخال جديد

2. `resetLeaf()`
   - يضبط `leafId = null`
   - الإضافة التالية تُنشئ إدخالاً جذرياً جديداً (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - يقبل `branchFromId: string | null`
   - يضبط `leafId = branchFromId`
   - يُلحق إدخال `branch_summary` كابن لتلك الورقة
   - عندما يكون `branchFromId` هو `null`، يُخزّن `fromId` كـ `"root"`

## سلوك التنقل `/tree` (نفس ملف الجلسة)

`AgentSession.navigateTree()` هو تنقل، وليس تفريع ملف.

التدفق:

1. التحقق من الهدف وحساب المسار المهجور (`collectEntriesForBranchSummary`)
2. إطلاق `session_before_tree` مع `TreePreparation`
3. تلخيص اختياري للإدخالات المهجورة (ملخص مقدم من الخطاف أو الملخّص المدمج)
4. حساب هدف الورقة الجديد:
   - اختيار رسالة **مستخدم**: تنتقل الورقة إلى أبيها، ويُعاد نص الرسالة لملء المحرر مسبقاً
   - اختيار **custom_message**: نفس قاعدة رسالة المستخدم (الورقة = الأب، النص يملأ المحرر مسبقاً)
   - اختيار أي إدخال آخر: الورقة = معرّف الإدخال المحدد
5. تطبيق حركة الورقة:
   - مع ملخص: `branchWithSummary(newLeafId, ...)`
   - بدون ملخص و `newLeafId === null`: `resetLeaf()`
   - خلاف ذلك: `branch(newLeafId)`
6. إعادة بناء سياق الوكيل من الورقة الجديدة وإطلاق `session_tree`

ملاحظة مهمة: إدخالات الملخص تُرفق عند **موضع التنقل الجديد**، وليس على ذيل الفرع المهجور.

## سلوك `/branch` (ملف جلسة جديد)

`/branch` و `/tree` مختلفان عمداً:

- `/tree` يتنقل ضمن ملف الجلسة الحالي.
- `/branch` يُنشئ ملف فرع جلسة جديد (أو بديل في الذاكرة للوضع غير الدائم).

تدفق `/branch` من جهة المستخدم (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- مصدر الفرع يجب أن يكون **رسالة مستخدم**.
- يُستخرج نص المستخدم المحدد لملء المحرر مسبقاً.
- إذا كانت رسالة المستخدم المحددة جذرية (`parentId === null`): بدء جلسة جديدة عبر `newSession({ parentSession: previousSessionFile })`.
- خلاف ذلك: `createBranchedSession(selectedEntry.parentId)` لتفريع التاريخ حتى حدود الطلب المحدد.

تفاصيل `SessionManager.createBranchedSession(leafId)`:

- يبني مسار الجذر→الورقة عبر `getBranch(leafId)`؛ يرمي خطأ إذا كان مفقوداً.
- يستثني إدخالات `label` الموجودة من المسار المنسوخ.
- يعيد بناء إدخالات تسمية جديدة من `labelsById` المحلولة للإدخالات المتبقية في المسار.
- الوضع الدائم: يكتب ملف JSONL جديد وينتقل المدير إليه؛ يعيد مسار الملف الجديد.
- الوضع في الذاكرة: يستبدل الإدخالات في الذاكرة؛ يعيد `undefined`.

## إعادة بناء السياق وتكامل الملخص/المخصص

`buildSessionContext()` (في `session-manager.ts`) يحل مسار الجذر→الورقة النشط ويبني حالة سياق LLM الفعالة:

- يتتبع أحدث حالة thinking/model/mode/ttsr على المسار.
- يعالج أحدث ضغط على المسار:
  - يُصدر ملخص الضغط أولاً
  - يعيد تشغيل الرسائل المحتفظ بها من `firstKeptEntryId` إلى نقطة الضغط
  - ثم يعيد تشغيل الرسائل بعد الضغط
- يتضمن إدخالات `branch_summary` و `custom_message` ككائنات `AgentMessage`.

`session/messages.ts` ثم يحوّل أنواع الرسائل هذه لإدخال النموذج:

- `branchSummary` و `compactionSummary` تصبح رسائل سياق مُقولَبة بدور المستخدم
- `custom`/`hookMessage` تصبح رسائل محتوى بدور المستخدم

إذن حركة الشجرة تغيّر السياق عبر تغيير مسار الورقة النشطة، وليس عبر تعديل الإدخالات القديمة.

## التسميات وسلوك واجهة الشجرة

استمرار التسميات:

- `appendLabelChange(targetId, label?)` يكتب إدخالات `label` على سلسلة الورقة الحالية.
- `labelsById` يُحدَّث فوراً (ضبط أو حذف).
- `getTree()` يحل التسمية الحالية على كل عقدة معادة.

سلوك محدد الشجرة (`tree-selector.ts`):

- يُسطّح الشجرة للتنقل، ويحتفظ بتمييز المسار النشط، ويُعطي الأولوية لعرض الفرع النشط أولاً.
- يدعم أوضاع التصفية: `default`، `no-tools`، `user-only`، `labeled-only`، `all`.
- يدعم البحث النصي الحر عبر المحتوى الدلالي المعروض.
- `Shift+L` يفتح تحرير التسمية المضمّن ويكتب عبر `appendLabelChange`.

توجيه الأوامر:

- `/tree` يفتح دائماً محدد الشجرة.
- `/branch` يفتح محدد رسائل المستخدم إلا إذا كان `doubleEscapeAction=tree`، وفي هذه الحالة يستخدم أيضاً واجهة محدد الشجرة.

## نقاط اتصال الإضافات والخطافات لعمليات الشجرة

واجهة برمجة الإضافات وقت الأمر (`ExtensionCommandContext`):

- `branch(entryId)` — إنشاء ملف جلسة متفرع
- `navigateTree(targetId, { summarize? })` — التنقل ضمن الشجرة/الملف الحالي

الأحداث حول التنقل في الشجرة:

- `session_before_tree`
  - يستقبل `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - قد يُلغي التنقل
  - قد يوفر حمولة ملخص تُستخدم بدلاً من الملخّص المدمج
  - يستقبل إشارة إلغاء `signal` (مسار الإلغاء بـ Escape)
- `session_tree`
  - يُصدر `newLeafId`، `oldLeafId`
  - يتضمن `summaryEntry` عند إنشاء ملخص
  - `fromExtension` يشير إلى مصدر الملخص

خطافات دورة الحياة المجاورة ذات الصلة:

- `session_before_branch` / `session_branch` لتدفق `/branch`
- `session_before_compact`، `session.compacting`، `session_compact` لإدخالات الضغط التي تؤثر لاحقاً على إعادة بناء سياق الشجرة

## القيود الحقيقية والحالات الحدية

- `branch()` لا يمكنه استهداف `null`؛ استخدم `resetLeaf()` لحالة ما قبل الإدخال الأول عند الجذر.
- `branchWithSummary()` يدعم هدف `null` ويسجل `fromId: "root"`.
- اختيار الورقة الحالية في محدد الشجرة لا يُحدث أي تأثير.
- التلخيص يتطلب نموذجاً نشطاً؛ إذا كان غائباً، يفشل تنقل التلخيص بسرعة.
- إذا أُلغي التلخيص، يُلغى التنقل وتبقى الورقة دون تغيير.
- الجلسات في الذاكرة لا تُعيد أبداً مسار ملف فرع من `createBranchedSession`.

## التوافق مع الإصدارات القديمة لا يزال موجوداً

ترحيلات الجلسة لا تزال تعمل عند التحميل:

- v1→v2 يضيف `id`/`parentId` ويحوّل مرساة فهرس الضغط إلى مرساة معرّف
- v2→v3 يرحّل دور `hookMessage` القديم إلى `custom`

السلوك الحالي أثناء التشغيل هو دلالات شجرة الإصدار الثالث بعد الترحيل.
