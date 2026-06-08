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

يصف هذا المستند كيفية عمل التنقل في شجرة الجلسة حالياً: نموذج الشجرة في الذاكرة، وقواعد حركة الورقة، وسلوك التفرع، والتكامل مع الإضافات/الأحداث.

## ما هو هذا النظام الفرعي

تُخزَّن الجلسة كسجل إدخالات تراكمي (append-only)، لكن السلوك أثناء التشغيل يعتمد على بنية الشجرة:

- كل إدخال غير رأسي يحتوي على `id` و `parentId`.
- الموضع النشط هو `leafId` في `SessionManager`.
- إلحاق إدخال جديد ينشئ دائماً ابناً للورقة الحالية.
- التفرع **لا** يعيد كتابة التاريخ؛ بل يغيّر فقط المكان الذي تشير إليه الورقة قبل الإلحاق التالي.

الملفات الرئيسية:

- `src/session/session-manager.ts` — نموذج بيانات الشجرة، الاجتياز، حركة الورقة، استخراج الفرع/الجلسة
- `src/session/agent-session.ts` — تدفق التنقل `/tree`، التلخيص، إصدار الخطافات/الأحداث
- `src/modes/components/tree-selector.ts` — سلوك واجهة الشجرة التفاعلية والتصفية
- `src/modes/controllers/selector-controller.ts` — تنسيق المحدد لـ `/tree` و `/branch`
- `src/modes/controllers/input-controller.ts` — توجيه الأوامر (`/tree`، `/branch`، سلوك الضغط المزدوج على Escape)
- `src/session/messages.ts` — تحويل إدخالات `branch_summary` و `compaction` و `custom_message` إلى رسائل سياق LLM

## نموذج بيانات الشجرة في `SessionManager`

الفهارس أثناء التشغيل:

- `#byId: Map<string, SessionEntry>` — بحث سريع عن أي إدخال
- `#leafId: string | null` — الموضع الحالي في الشجرة
- `#labelsById: Map<string, string>` — التسميات المحلولة حسب معرف الإدخال المستهدف

واجهات برمجة الشجرة:

- `getBranch(fromId?)` يتتبع روابط الأب حتى الجذر ويعيد المسار من الجذر إلى العقدة
- `getTree()` يعيد `SessionTreeNode[]` (`entry`، `children`، `label`)
  - روابط الأب تتحول إلى مصفوفات أبناء
  - الإدخالات التي لا يوجد لها أب تُعامل كجذور
  - الأبناء مرتبون من الأقدم إلى الأحدث حسب الطابع الزمني
- `getChildren(parentId)` يعيد الأبناء المباشرين
- `getLabel(id)` يحل التسمية الحالية من `labelsById`

`getTree()` هو إسقاط أثناء التشغيل؛ التخزين الدائم يبقى إدخالات JSONL تراكمية.

## دلالات حركة الورقة

هناك ثلاث عمليات أساسية لحركة الورقة:

1. `branch(entryId)`
   - يتحقق من وجود الإدخال
   - يضبط `leafId = entryId`
   - لا يُكتب إدخال جديد

2. `resetLeaf()`
   - يضبط `leafId = null`
   - الإلحاق التالي ينشئ إدخالاً جذرياً جديداً (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - يقبل `branchFromId: string | null`
   - يضبط `leafId = branchFromId`
   - يلحق إدخال `branch_summary` كابن لتلك الورقة
   - عندما يكون `branchFromId` هو `null`، يُخزَّن `fromId` بقيمة `"root"`

## سلوك التنقل `/tree` (نفس ملف الجلسة)

`AgentSession.navigateTree()` هو تنقل وليس تفريع ملف.

التدفق:

1. التحقق من الهدف وحساب المسار المتروك (`collectEntriesForBranchSummary`)
2. إصدار `session_before_tree` مع `TreePreparation`
3. اختيارياً تلخيص الإدخالات المتروكة (ملخص مقدم من الخطاف أو الملخص المدمج)
4. حساب هدف الورقة الجديد:
   - اختيار رسالة **مستخدم**: تنتقل الورقة إلى الأب، ويُعاد نص الرسالة لملء المحرر مسبقاً
   - اختيار **custom_message**: نفس قاعدة رسالة المستخدم (الورقة = الأب، النص يملأ المحرر مسبقاً)
   - اختيار أي إدخال آخر: الورقة = معرف الإدخال المحدد
5. تطبيق حركة الورقة:
   - مع ملخص: `branchWithSummary(newLeafId, ...)`
   - بدون ملخص و `newLeafId === null`: `resetLeaf()`
   - خلاف ذلك: `branch(newLeafId)`
6. إعادة بناء سياق الوكيل من الورقة الجديدة وإصدار `session_tree`

ملاحظة مهمة: إدخالات الملخص تُرفق عند **موضع التنقل الجديد**، وليس على ذيل الفرع المتروك.

## سلوك `/branch` (ملف جلسة جديد)

`/branch` و `/tree` مختلفان عمداً:

- `/tree` يتنقل داخل ملف الجلسة الحالي.
- `/branch` ينشئ ملف فرع جلسة جديد (أو استبدال في الذاكرة للوضع غير الدائم).

تدفق `/branch` من جهة المستخدم (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- مصدر الفرع يجب أن يكون **رسالة مستخدم**.
- يُستخرج نص المستخدم المحدد لملء المحرر مسبقاً.
- إذا كانت رسالة المستخدم المحددة جذرية (`parentId === null`): تبدأ جلسة جديدة عبر `newSession({ parentSession: previousSessionFile })`.
- خلاف ذلك: `createBranchedSession(selectedEntry.parentId)` لتفريع التاريخ حتى حدود الطلب المحدد.

تفاصيل `SessionManager.createBranchedSession(leafId)`:

- يبني مسار الجذر→الورقة عبر `getBranch(leafId)`؛ يطرح خطأ إذا كان مفقوداً.
- يستبعد إدخالات `label` الموجودة من المسار المنسوخ.
- يعيد بناء إدخالات تسمية جديدة من `labelsById` المحلولة للإدخالات التي تبقى في المسار.
- الوضع الدائم: يكتب ملف JSONL جديداً وينتقل المدير إليه؛ يعيد مسار الملف الجديد.
- الوضع في الذاكرة: يستبدل الإدخالات في الذاكرة؛ يعيد `undefined`.

## إعادة بناء السياق وتكامل الملخصات/الرسائل المخصصة

`buildSessionContext()` (في `session-manager.ts`) يحل مسار الجذر→الورقة النشط ويبني حالة سياق LLM الفعالة:

- يتتبع آخر حالة تفكير/نموذج/وضع/ttsr على المسار.
- يعالج آخر ضغط على المسار:
  - يصدر ملخص الضغط أولاً
  - يعيد تشغيل الرسائل المحتفظ بها من `firstKeptEntryId` إلى نقطة الضغط
  - ثم يعيد تشغيل الرسائل بعد الضغط
- يتضمن إدخالات `branch_summary` و `custom_message` ككائنات `AgentMessage`.

`session/messages.ts` يحوّل بعد ذلك أنواع الرسائل هذه لإدخال النموذج:

- `branchSummary` و `compactionSummary` تصبح رسائل سياق بدور المستخدم مع قوالب
- `custom`/`hookMessage` تصبح رسائل محتوى بدور المستخدم

إذن حركة الشجرة تغيّر السياق عن طريق تغيير مسار الورقة النشطة، وليس عن طريق تعديل الإدخالات القديمة.

## التسميات وسلوك واجهة الشجرة

استمرارية التسميات:

- `appendLabelChange(targetId, label?)` يكتب إدخالات `label` على سلسلة الورقة الحالية.
- `labelsById` يُحدَّث فوراً (ضبط أو حذف).
- `getTree()` يحل التسمية الحالية على كل عقدة مُعادة.

سلوك محدد الشجرة (`tree-selector.ts`):

- يُسطّح الشجرة للتنقل، يحتفظ بتمييز المسار النشط، ويعطي الأولوية لعرض الفرع النشط أولاً.
- يدعم أوضاع التصفية: `default`، `no-tools`، `user-only`، `labeled-only`، `all`.
- يدعم البحث النصي الحر على المحتوى الدلالي المُصيَّر.
- `Shift+L` يفتح تحرير التسمية المضمن ويكتب عبر `appendLabelChange`.

توجيه الأوامر:

- `/tree` يفتح دائماً محدد الشجرة.
- `/branch` يفتح محدد رسائل المستخدم ما لم يكن `doubleEscapeAction=tree`، وفي هذه الحالة يستخدم أيضاً واجهة محدد الشجرة.

## نقاط اتصال الإضافات والخطافات لعمليات الشجرة

واجهة برمجة الإضافات وقت الأوامر (`ExtensionCommandContext`):

- `branch(entryId)` — إنشاء ملف جلسة متفرع
- `navigateTree(targetId, { summarize? })` — التنقل داخل الشجرة/الملف الحالي

الأحداث حول التنقل في الشجرة:

- `session_before_tree`
  - يستقبل `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - يمكنه إلغاء التنقل
  - يمكنه تقديم حمولة ملخص تُستخدم بدلاً من الملخص المدمج
  - يستقبل إشارة إلغاء `signal` (مسار الإلغاء بـ Escape)
- `session_tree`
  - يصدر `newLeafId`، `oldLeafId`
  - يتضمن `summaryEntry` عند إنشاء ملخص
  - `fromExtension` يشير إلى مصدر الملخص

خطافات دورة الحياة المجاورة ذات الصلة:

- `session_before_branch` / `session_branch` لتدفق `/branch`
- `session_before_compact`، `session.compacting`، `session_compact` لإدخالات الضغط التي تؤثر لاحقاً على إعادة بناء سياق الشجرة

## القيود الفعلية والحالات الحدية

- `branch()` لا يمكنه استهداف `null`؛ استخدم `resetLeaf()` لحالة الجذر قبل الإدخال الأول.
- `branchWithSummary()` يدعم الهدف `null` ويسجل `fromId: "root"`.
- اختيار الورقة الحالية في محدد الشجرة لا يفعل شيئاً.
- التلخيص يتطلب نموذجاً نشطاً؛ إذا كان غائباً، يفشل تنقل التلخيص بسرعة.
- إذا أُلغي التلخيص، يُلغى التنقل وتبقى الورقة دون تغيير.
- الجلسات في الذاكرة لا تعيد أبداً مسار ملف فرع من `createBranchedSession`.

## التوافق مع الإصدارات القديمة لا يزال موجوداً

ترحيلات الجلسة لا تزال تعمل عند التحميل:

- v1→v2 يضيف `id`/`parentId` ويحوّل مرساة فهرس الضغط إلى مرساة معرف
- v2→v3 يرحّل دور `hookMessage` القديم إلى `custom`

السلوك الحالي أثناء التشغيل هو دلالات الشجرة الإصدار 3 بعد الترحيل.
