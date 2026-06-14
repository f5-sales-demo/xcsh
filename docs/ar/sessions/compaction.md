---
title: الضغط وملخصات الفروع
description: ضغط نافذة السياق وتوليد ملخصات الفروع للجلسات طويلة الأمد.
sidebar:
  order: 5
  label: الضغط
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# الضغط وملخصات الفروع

الضغط وملخصات الفروع هما الآليتان اللتان تُبقيان الجلسات الطويلة قابلةً للاستخدام دون فقدان سياق العمل السابق.

- **الضغط** يُعيد كتابة التاريخ القديم في صورة ملخص على الفرع الحالي.
- **ملخص الفرع** يلتقط سياق الفرع المتروك أثناء التنقل عبر `/tree`.

كلاهما يُحفظ كإدخالات جلسة ويُحوَّل مجدداً إلى رسائل سياق المستخدم عند إعادة بناء مدخلات نموذج اللغة الكبير (LLM).

## ملفات التنفيذ الرئيسية

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## نموذج إدخال الجلسة

الضغط وملخصات الفروع هي إدخالات جلسة من الدرجة الأولى، وليست رسائل مساعد/مستخدم عادية.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`، و`shortSummary` اختياري
  - `firstKeptEntryId` (حد الضغط)
  - `tokensBefore`
  - `details` و`preserveData` و`fromExtension` اختيارية
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`، و`summary`
  - `details` و`fromExtension` اختيارية

عند إعادة بناء السياق (`buildSessionContext`):

1. يُحوَّل آخر ضغط على المسار النشط إلى رسالة `compactionSummary` واحدة.
2. تُعاد إضافة الإدخالات المحفوظة من `firstKeptEntryId` إلى نقطة الضغط.
3. تُضاف الإدخالات اللاحقة على المسار.
4. تُحوَّل إدخالات `branch_summary` إلى رسائل `branchSummary`.
5. تُحوَّل إدخالات `custom_message` إلى رسائل `custom`.

ثم تُحوَّل تلك الأدوار المخصصة إلى رسائل مستخدم موجهة لنموذج اللغة الكبير في `convertToLlm()` باستخدام القوالب الثابتة:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## خط أنابيب الضغط

### المحفزات

يمكن تشغيل الضغط بثلاث طرق:

1. **يدوي**: يستدعي `/compact [instructions]` الدالة `AgentSession.compact(...)`.
2. **استرداد تلقائي من تجاوز السعة**: بعد حدوث خطأ في المساعد يتطابق مع تجاوز السياق.
3. **ضغط تلقائي عند العتبة**: بعد إتمام دورة ناجحة عندما يتجاوز السياق العتبة المحددة.

### شكل الضغط (مرئي)

```text
قبل الضغط:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

بعد الضغط (إدخال جديد مُضاف):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

ما يراه نموذج اللغة الكبير:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### ضغط استرداد التجاوز مقابل ضغط العتبة

المساران التلقائيان مختلفان عن قصد:

- **ضغط استرداد التجاوز**
  - المحفز: يُكتشف خطأ المساعد في النموذج الحالي كتجاوز للسياق.
  - تُزال رسالة خطأ المساعد الفاشلة من حالة العامل النشطة قبل إعادة المحاولة.
  - يعمل الضغط التلقائي بـ `reason: "overflow"` و`willRetry: true`.
  - عند النجاح، يستأنف العامل تلقائياً (`agent.continue()`) بعد الضغط.

- **ضغط العتبة**
  - المحفز: `contextTokens > contextWindow - compaction.reserveTokens`.
  - يعمل بـ `reason: "threshold"` و`willRetry: false`.
  - عند النجاح، إذا كان `compaction.autoContinue !== false`، يُحقن موجه اصطناعي:
    - `"Continue if you have next steps."`

### التقليم قبل الضغط

قبل فحوصات الضغط، قد يعمل تقليم نتائج الأدوات (`pruneToolOutputs`).

سياسة التقليم الافتراضية:

- حماية أحدث `40_000` رمز مميز من مخرجات الأدوات.
- اشتراط توفير `20_000` رمز مميز على الأقل من التوفير الكلي المُقدَّر.
- عدم تقليم نتائج الأدوات من `skill` أو `read` مطلقاً.

تُستبدل نتائج الأدوات المُقلَّمة بـ:

- `[Output truncated - N tokens]`

إذا غيّر التقليم الإدخالات، تُعاد كتابة تخزين الجلسة وتُحدَّث حالة رسائل العامل قبل قرارات الضغط.

### منطق الحد ونقطة القطع

تأخذ `prepareCompaction()` في الاعتبار الإدخالات منذ آخر إدخال ضغط فحسب (إن وُجد).

1. إيجاد فهرس الضغط السابق.
2. حساب `boundaryStart = prevCompactionIndex + 1`.
3. تكييف `keepRecentTokens` باستخدام نسبة الاستخدام المقيسة عند توافرها.
4. تشغيل `findCutPoint()` على نافذة الحد.

تشمل نقاط القطع الصالحة:

- إدخالات الرسائل ذات الأدوار: `user` و`assistant` و`bashExecution` و`hookMessage` و`branchSummary` و`compactionSummary`
- إدخالات `custom_message`
- إدخالات `branch_summary`

قاعدة صارمة: لا تقطع عند `toolResult` أبداً.

إذا كانت هناك إدخالات بيانات وصفية غير رسائل مباشرةً قبل نقطة القطع (`model_change` و`thinking_level_change` والتسميات وغيرها)، تُسحب إلى المنطقة المحفوظة بتحريك فهرس القطع للخلف حتى يُبلغ حد رسالة أو ضغط.

### معالجة الدورات المقسومة

إذا لم تكن نقطة القطع عند بداية دورة مستخدم، يعاملها الضغط كدورة مقسومة.

تكتشف آلية الدورات بداية دورة المستخدم عند هذه الحالات:

- `message.role === "user"`
- `message.role === "bashExecution"`
- إدخال `custom_message`
- إدخال `branch_summary`

يولّد ضغط الدورة المقسومة ملخصين:

1. ملخص التاريخ (`messagesToSummarize`)
2. ملخص بادئة الدورة (`turnPrefixMessages`)

يُدمج الملخص النهائي المُخزَّن على النحو التالي:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### توليد الملخص

تبني `compact(...)` الملخصات من نص المحادثة المتسلسل:

1. تحويل الرسائل عبر `convertToLlm()`.
2. التسلسل باستخدام `serializeConversation()`.
3. التغليف في `<conversation>...</conversation>`.
4. تضمين `<previous-summary>...</previous-summary>` اختيارياً.
5. حقن سياق الخطاف اختيارياً كقائمة `<additional-context>`.
6. تنفيذ موجه التلخيص مع `SUMMARIZATION_SYSTEM_PROMPT`.

اختيار الموجه:

- الضغط الأول: `compaction-summary.md`
- الضغط التكراري مع ملخص سابق: `compaction-update-summary.md`
- التمرير الثاني للدورة المقسومة: `compaction-turn-prefix.md`
- الملخص القصير لواجهة المستخدم: `compaction-short-summary.md`

وضع التلخيص عن بُعد:

- إذا كان `compaction.remoteEndpoint` مضبوطاً، يُرسل الضغط طلب POST يحتوي على:
  - `{ systemPrompt, prompt }`
- يتوقع JSON يحتوي على `{ summary }` على الأقل.

### سياق عمليات الملفات في الملخصات

يتتبع الضغط نشاط الملفات التراكمي باستخدام استدعاءات أدوات المساعد:

- `read(path)` ← مجموعة القراءة
- `write(path)` ← مجموعة التعديل
- `edit(path)` ← مجموعة التعديل

السلوك التراكمي:

- يشمل تفاصيل الضغط السابق فقط عندما يكون الإدخال السابق مُولَّداً بواسطة pi (`fromExtension !== true`).
- في الدورات المقسومة، يشمل عمليات ملفات بادئة الدورة أيضاً.
- يستثني `readFiles` الملفاتِ المُعدَّلة أيضاً.

تُضاف وسوم الملفات إلى نص الملخص عبر قالب الموجه:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### الحفظ وإعادة التحميل

بعد توليد الملخص (أو الملخص المُقدَّم من الخطاف)، تقوم جلسة العامل بـ:

1. إضافة `CompactionEntry` عبر `appendCompaction(...)`.
2. إعادة بناء السياق عبر `buildSessionContext()`.
3. استبدال رسائل العامل الحية بالسياق المُعاد بناؤه.
4. إصدار حدث الخطاف `session_compact`.

## خط أنابيب تلخيص الفروع

تلخيص الفروع مرتبط بالتنقل في الشجرة، لا بتجاوز الرموز المميزة.

### المحفز

أثناء `navigateTree(...)`:

1. حساب الإدخالات المتروكة من الورقة القديمة إلى السلف المشترك باستخدام `collectEntriesForBranchSummary(...)`.
2. إذا طلب المستدعي ملخصاً (`options.summarize`)، يُولَّد الملخص قبل تبديل الورقة.
3. إذا وُجد ملخص، يُرفق عند هدف التنقل باستخدام `branchWithSummary(...)`.

يُشغَّل هذا عادةً عبر تدفق `/tree` عندما يكون `branchSummary.enabled` مفعَّلاً.

### شكل تبديل الفرع (مرئي)

```text
الشجرة قبل التنقل:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

بعد التنقل مع ملخص:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### الإعداد وميزانية الرموز المميزة

تحسب `generateBranchSummary(...)` الميزانية كالتالي:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

ثم تقوم `prepareBranchEntries(...)` بـ:

1. التمرير الأول: جمع عمليات الملفات التراكمية من جميع الإدخالات المُلخَّصة، بما فيها تفاصيل `branch_summary` المُولَّدة بواسطة pi السابقة.
2. التمرير الثاني: السير من الأحدث إلى الأقدم، إضافة الرسائل حتى الوصول إلى ميزانية الرموز المميزة.
3. تفضيل الحفاظ على السياق الحديث.
4. قد لا يزال يشمل إدخالات ملخص كبيرة قرب حافة الميزانية للاستمرارية.

تُدرج إدخالات الضغط كرسائل (`compactionSummary`) أثناء مدخلات تلخيص الفروع.

### توليد الملخص والحفظ

تلخيص الفروع:

1. يحوّل الرسائل المختارة ويُسلسلها.
2. يغلّفها في `<conversation>`.
3. يستخدم تعليمات مخصصة إذا وُفِّرت، وإلا `branch-summary.md`.
4. يستدعي نموذج التلخيص مع `SUMMARIZATION_SYSTEM_PROMPT`.
5. يُضيف `branch-summary-preamble.md` في البداية.
6. يُلحق وسوم عمليات الملفات.

يُخزَّن الناتج كـ `BranchSummaryEntry` مع تفاصيل اختيارية (`readFiles` و`modifiedFiles`).

## نقاط تمديد الخطافات

### `session_before_compact`

خطاف ما قبل الضغط.

يمكنه:

- إلغاء الضغط (`{ cancel: true }`)
- توفير حمولة ضغط مخصصة كاملة (`{ compaction: CompactionResult }`)

### `session.compacting`

خطاف تخصيص الموجه/السياق للضغط الافتراضي.

يمكنه إرجاع:

- `prompt` (تجاوز موجه الملخص الأساسي)
- `context` (أسطر سياق إضافية تُحقن في `<additional-context>`)
- `preserveData` (مُخزَّن على إدخال الضغط)

### `session_compact`

إشعار ما بعد الضغط يحتوي على `compactionEntry` المحفوظ وعلامة `fromExtension`.

### `session_before_tree`

يعمل عند التنقل في الشجرة قبل توليد ملخص الفرع الافتراضي.

يمكنه:

- إلغاء التنقل
- توفير `{ summary: { summary, details } }` مخصص يُستخدم عندما يطلب المستخدم التلخيص

### `session_tree`

حدث ما بعد التنقل يكشف عن الورقة الجديدة/القديمة وإدخال الملخص الاختياري.

## سلوك وقت التشغيل ودلالات الفشل

- يُوقف الضغط اليدوي العملية الحالية للعامل أولاً.
- يُلغي `abortCompaction()` كلاً من وحدات التحكم في الضغط اليدوي والتلقائي.
- يُصدر الضغط التلقائي أحداث بداية/نهاية الجلسة لتحديثات واجهة المستخدم/الحالة.
- يمكن للضغط التلقائي تجربة مرشحين من النماذج المتعددة وإعادة المحاولة عند الأعطال العابرة.
- تُستثنى أخطاء التجاوز من مسار إعادة المحاولة العام لأنها تُعالَج بواسطة الضغط.
- إذا فشل الضغط التلقائي:
  - يُصدر مسار التجاوز `Context overflow recovery failed: ...`
  - يُصدر مسار العتبة `Auto-compaction failed: ...`
- يمكن إلغاء تلخيص الفروع عبر إشارة الإيقاف (مثلاً، مفتاح Escape)، مما يُعيد نتيجة تنقل ملغاة/متوقفة.

## الإعدادات والقيم الافتراضية

من `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

تُستهلك هذه القيم في وقت التشغيل بواسطة `AgentSession` ووحدات الضغط/تلخيص الفروع.
