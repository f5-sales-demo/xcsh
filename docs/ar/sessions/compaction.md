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

الضغط وملخصات الفروع هما الآليتان اللتان تحافظان على قابلية استخدام الجلسات الطويلة دون فقدان سياق العمل السابق.

- **الضغط** يعيد كتابة السجل القديم في شكل ملخص على الفرع الحالي.
- **ملخص الفرع** يلتقط سياق الفرع المهجور أثناء التنقل عبر `/tree`.

كلاهما يُحفظ كإدخالات جلسة ويُحوّل مرة أخرى إلى رسائل سياق المستخدم عند إعادة بناء مدخلات نموذج اللغة الكبير (LLM).

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

## نموذج إدخالات الجلسة

الضغط وملخصات الفروع هي إدخالات جلسة من الدرجة الأولى، وليست رسائل مساعد/مستخدم عادية.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`، `shortSummary` اختياري
  - `firstKeptEntryId` (حد الضغط)
  - `tokensBefore`
  - `details`، `preserveData`، `fromExtension` اختيارية
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`، `summary`
  - `details`، `fromExtension` اختيارية

عند إعادة بناء السياق (`buildSessionContext`):

1. يُحوّل أحدث ضغط على المسار النشط إلى رسالة `compactionSummary` واحدة.
2. يُعاد تضمين الإدخالات المحتفظ بها من `firstKeptEntryId` إلى نقطة الضغط.
3. تُلحق الإدخالات اللاحقة على المسار.
4. تُحوّل إدخالات `branch_summary` إلى رسائل `branchSummary`.
5. تُحوّل إدخالات `custom_message` إلى رسائل `custom`.

ثم تُحوّل هذه الأدوار المخصصة إلى رسائل مستخدم موجهة لنموذج اللغة الكبير في `convertToLlm()` باستخدام القوالب الثابتة:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## خط أنابيب الضغط

### المحفزات

يمكن تشغيل الضغط بثلاث طرق:

1. **يدوي**: `/compact [instructions]` يستدعي `AgentSession.compact(...)`.
2. **استرداد تلقائي عند تجاوز السعة**: بعد خطأ مساعد يطابق تجاوز سعة السياق.
3. **ضغط تلقائي عند العتبة**: بعد دورة ناجحة عندما يتجاوز السياق العتبة المحددة.

### شكل الضغط (بصري)

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### ضغط إعادة المحاولة عند التجاوز مقابل ضغط العتبة

المساران التلقائيان مختلفان عمداً:

- **ضغط إعادة المحاولة عند التجاوز**
  - المحفز: يُكتشف خطأ مساعد النموذج الحالي على أنه تجاوز سعة السياق.
  - تُزال رسالة خطأ المساعد الفاشلة من حالة الوكيل النشطة قبل إعادة المحاولة.
  - يعمل الضغط التلقائي مع `reason: "overflow"` و `willRetry: true`.
  - عند النجاح، يستمر الوكيل تلقائياً (`agent.continue()`) بعد الضغط.

- **ضغط العتبة**
  - المحفز: `contextTokens > contextWindow - compaction.reserveTokens`.
  - يعمل مع `reason: "threshold"` و `willRetry: false`.
  - عند النجاح، إذا كان `compaction.autoContinue !== false`، يُحقن موجه اصطناعي:
    - `"Continue if you have next steps."`

### التقليم قبل الضغط

قبل فحوصات الضغط، قد يعمل تقليم نتائج الأدوات (`pruneToolOutputs`).

سياسة التقليم الافتراضية:

- حماية أحدث `40_000` رمز من مخرجات الأدوات.
- تتطلب على الأقل `20_000` من إجمالي التوفير المقدر.
- عدم تقليم نتائج الأدوات من `skill` أو `read` أبداً.

تُستبدل نتائج الأدوات المقلمة بـ:

- `[Output truncated - N tokens]`

إذا غيّر التقليم الإدخالات، يُعاد كتابة تخزين الجلسة وتُحدّث حالة رسائل الوكيل قبل قرارات الضغط.

### منطق الحدود ونقطة القطع

`prepareCompaction()` تأخذ بعين الاعتبار فقط الإدخالات منذ آخر إدخال ضغط (إن وُجد).

1. العثور على فهرس الضغط السابق.
2. حساب `boundaryStart = prevCompactionIndex + 1`.
3. تكييف `keepRecentTokens` باستخدام نسبة الاستخدام المقاسة عند توفرها.
4. تشغيل `findCutPoint()` على نافذة الحدود.

نقاط القطع الصالحة تشمل:

- إدخالات الرسائل ذات الأدوار: `user`، `assistant`، `bashExecution`، `hookMessage`، `branchSummary`، `compactionSummary`
- إدخالات `custom_message`
- إدخالات `branch_summary`

قاعدة صارمة: عدم القطع أبداً عند `toolResult`.

إذا كانت هناك إدخالات بيانات وصفية غير رسائل مباشرة قبل نقطة القطع (`model_change`، `thinking_level_change`، التسميات، إلخ.)، فإنها تُسحب إلى المنطقة المحتفظ بها عن طريق تحريك فهرس القطع للخلف حتى الوصول إلى رسالة أو حد ضغط.

### معالجة الدورة المنقسمة

إذا لم تكن نقطة القطع عند بداية دورة مستخدم، يعاملها الضغط كدورة منقسمة.

اكتشاف بداية الدورة يعامل ما يلي كحدود لدورة المستخدم:

- `message.role === "user"`
- `message.role === "bashExecution"`
- إدخال `custom_message`
- إدخال `branch_summary`

ضغط الدورة المنقسمة يولّد ملخصين:

1. ملخص السجل (`messagesToSummarize`)
2. ملخص بادئة الدورة (`turnPrefixMessages`)

الملخص النهائي المخزن يُدمج كالتالي:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### توليد الملخص

`compact(...)` تبني الملخصات من نص المحادثة المتسلسل:

1. تحويل الرسائل عبر `convertToLlm()`.
2. التسلسل باستخدام `serializeConversation()`.
3. التغليف في `<conversation>...</conversation>`.
4. تضمين `<previous-summary>...</previous-summary>` اختيارياً.
5. حقن سياق الخطاف اختيارياً كقائمة `<additional-context>`.
6. تنفيذ موجه التلخيص مع `SUMMARIZATION_SYSTEM_PROMPT`.

اختيار الموجه:

- الضغط الأول: `compaction-summary.md`
- الضغط التكراري مع ملخص سابق: `compaction-update-summary.md`
- المرور الثاني للدورة المنقسمة: `compaction-turn-prefix.md`
- ملخص واجهة المستخدم القصير: `compaction-short-summary.md`

وضع التلخيص عن بُعد:

- إذا كان `compaction.remoteEndpoint` مُعيّناً، يرسل الضغط طلب POST:
  - `{ systemPrompt, prompt }`
- يتوقع JSON يحتوي على الأقل `{ summary }`.

### سياق عمليات الملفات في الملخصات

يتتبع الضغط نشاط الملفات التراكمي باستخدام استدعاءات أدوات المساعد:

- `read(path)` → مجموعة القراءة
- `write(path)` → مجموعة التعديل
- `edit(path)` → مجموعة التعديل

السلوك التراكمي:

- يتضمن تفاصيل الضغط السابق فقط عندما يكون الإدخال السابق مولداً بواسطة pi (`fromExtension !== true`).
- في الدورات المنقسمة، يتضمن عمليات ملفات بادئة الدورة أيضاً.
- `readFiles` تستبعد الملفات التي عُدّلت أيضاً.

يُلحق نص الملخص بوسوم الملفات عبر قالب الموجه:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### الحفظ وإعادة التحميل

بعد توليد الملخص (أو الملخص المقدم من الخطاف)، تقوم جلسة الوكيل بـ:

1. إلحاق `CompactionEntry` باستخدام `appendCompaction(...)`.
2. إعادة بناء السياق عبر `buildSessionContext()`.
3. استبدال رسائل الوكيل الحية بالسياق المُعاد بناؤه.
4. إصدار حدث خطاف `session_compact`.

## خط أنابيب تلخيص الفروع

تلخيص الفروع مرتبط بالتنقل في الشجرة، وليس بتجاوز سعة الرموز.

### المحفز

أثناء `navigateTree(...)`:

1. حساب الإدخالات المهجورة من الورقة القديمة إلى السلف المشترك باستخدام `collectEntriesForBranchSummary(...)`.
2. إذا طلب المستدعي ملخصاً (`options.summarize`)، يُولّد الملخص قبل تبديل الورقة.
3. إذا وُجد الملخص، يُرفق عند هدف التنقل باستخدام `branchWithSummary(...)`.

عملياً، يُحرّك هذا عادةً بواسطة تدفق `/tree` عندما يكون `branchSummary.enabled` مفعّلاً.

### شكل تبديل الفرع (بصري)

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### التحضير وميزانية الرموز

`generateBranchSummary(...)` تحسب الميزانية كالتالي:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` بعد ذلك:

1. المرور الأول: جمع عمليات الملفات التراكمية من جميع الإدخالات الملخصة، بما في ذلك تفاصيل `branch_summary` السابقة المولدة بواسطة pi.
2. المرور الثاني: المشي من الأحدث إلى الأقدم، مع إضافة الرسائل حتى الوصول إلى ميزانية الرموز.
3. تفضيل الحفاظ على السياق الحديث.
4. قد يتضمن إدخالات ملخص كبيرة بالقرب من حافة الميزانية لضمان الاستمرارية.

تُضمّن إدخالات الضغط كرسائل (`compactionSummary`) أثناء مدخلات تلخيص الفروع.

### توليد الملخص والحفظ

تلخيص الفروع:

1. يحوّل ويسلسل الرسائل المختارة.
2. يغلّفها في `<conversation>`.
3. يستخدم تعليمات مخصصة إذا قُدمت، وإلا `branch-summary.md`.
4. يستدعي نموذج التلخيص مع `SUMMARIZATION_SYSTEM_PROMPT`.
5. يُقدّم `branch-summary-preamble.md`.
6. يُلحق وسوم عمليات الملفات.

تُخزّن النتيجة كـ `BranchSummaryEntry` مع تفاصيل اختيارية (`readFiles`، `modifiedFiles`).

## نقاط اتصال الإضافات والخطافات

### `session_before_compact`

خطاف ما قبل الضغط.

يمكنه:

- إلغاء الضغط (`{ cancel: true }`)
- تقديم حمولة ضغط مخصصة كاملة (`{ compaction: CompactionResult }`)

### `session.compacting`

خطاف تخصيص الموجه/السياق للضغط الافتراضي.

يمكنه إرجاع:

- `prompt` (تجاوز موجه الملخص الأساسي)
- `context` (أسطر سياق إضافية تُحقن في `<additional-context>`)
- `preserveData` (تُخزّن على إدخال الضغط)

### `session_compact`

إشعار ما بعد الضغط مع `compactionEntry` المحفوظ وعلامة `fromExtension`.

### `session_before_tree`

يعمل عند التنقل في الشجرة قبل توليد ملخص الفرع الافتراضي.

يمكنه:

- إلغاء التنقل
- تقديم `{ summary: { summary, details } }` مخصص يُستخدم عندما يطلب المستخدم التلخيص

### `session_tree`

حدث ما بعد التنقل يكشف عن الورقة الجديدة/القديمة وإدخال الملخص الاختياري.

## سلوك وقت التشغيل ودلالات الفشل

- الضغط اليدوي يُلغي عملية الوكيل الحالية أولاً.
- `abortCompaction()` تُلغي متحكمات الضغط اليدوي والتلقائي معاً.
- الضغط التلقائي يُصدر أحداث بداية/نهاية الجلسة لتحديثات واجهة المستخدم/الحالة.
- يمكن للضغط التلقائي تجربة عدة نماذج مرشحة وإعادة محاولة الأخطاء العابرة.
- تُستبعد أخطاء التجاوز من مسار إعادة المحاولة العام لأنها تُعالج بواسطة الضغط.
- إذا فشل الضغط التلقائي:
  - مسار التجاوز يُصدر `Context overflow recovery failed: ...`
  - مسار العتبة يُصدر `Auto-compaction failed: ...`
- يمكن إلغاء تلخيص الفروع عبر إشارة الإلغاء (مثل Escape)، مما يُرجع نتيجة تنقل ملغاة/متوقفة.

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
