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

- **الضغط** يُعيد كتابة السجل القديم في صورة ملخص على الفرع الحالي.
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
2. تُعاد إضافة الإدخالات المحتفظ بها من `firstKeptEntryId` حتى نقطة الضغط.
3. تُلحَق الإدخالات اللاحقة على المسار.
4. تُحوَّل إدخالات `branch_summary` إلى رسائل `branchSummary`.
5. تُحوَّل إدخالات `custom_message` إلى رسائل `custom`.

ثم تُحوَّل تلك الأدوار المخصصة إلى رسائل مستخدم موجهة لنموذج LLM في `convertToLlm()` باستخدام القوالب الثابتة:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## مسار الضغط

### مُشغِّلات التفعيل

يمكن تشغيل الضغط بثلاث طرق:

1. **يدوي**: يستدعي `/compact [instructions]` الدالة `AgentSession.compact(...)`.
2. **استعادة تلقائية من تجاوز الحد**: بعد خطأ مساعد مطابق لتجاوز سياق النافذة.
3. **ضغط تلقائي عند تجاوز العتبة**: بعد دورة ناجحة عندما يتجاوز السياق العتبة المحددة.

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

بعد الضغط (إلحاق إدخال جديد):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

ما يراه نموذج LLM:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### الضغط عند تجاوز الحد مقابل الضغط عند بلوغ العتبة

يتعمد المساران التلقائيان الاختلاف:

- **ضغط إعادة المحاولة عند تجاوز الحد**
  - المُشغِّل: يُكتشف أن خطأ المساعد في النموذج الحالي ناجم عن تجاوز سياق النافذة.
  - تُحذف رسالة خطأ المساعد الفاشلة من حالة العميل النشطة قبل إعادة المحاولة.
  - يُشغَّل الضغط التلقائي مع `reason: "overflow"` و`willRetry: true`.
  - عند النجاح، يواصل العميل تلقائياً (`agent.continue()`) بعد الضغط.

- **ضغط العتبة**
  - المُشغِّل: `contextTokens > contextWindow - compaction.reserveTokens`.
  - يُشغَّل مع `reason: "threshold"` و`willRetry: false`.
  - عند النجاح، إذا كان `compaction.autoContinue !== false`، يُحقن موجه اصطناعي:
    - `"Continue if you have next steps."`

### التقليم قبل الضغط

قبل إجراء فحوصات الضغط، قد يُشغَّل تقليم نتائج الأدوات (`pruneToolOutputs`).

سياسة التقليم الافتراضية:

- حماية أحدث `40_000` رمز من مخرجات الأدوات.
- اشتراط توفير ما لا يقل عن `20_000` رمز إجمالياً.
- عدم تقليم نتائج الأدوات من `skill` أو `read`.

تُستبدل نتائج الأدوات المُقلَّمة بـ:

- `[Output truncated - N tokens]`

إذا أفضى التقليم إلى تغيير الإدخالات، يُعاد كتابة تخزين الجلسة وتُحدَّث حالة رسائل العميل قبل اتخاذ قرارات الضغط.

### منطق الحدود ونقطة القطع

لا يأخذ `prepareCompaction()` في الاعتبار إلا الإدخالات منذ آخر إدخال ضغط (إن وُجد).

1. إيجاد فهرس الضغط السابق.
2. حساب `boundaryStart = prevCompactionIndex + 1`.
3. تعديل `keepRecentTokens` باستخدام نسبة الاستخدام المقاسة عند توفرها.
4. تشغيل `findCutPoint()` على نافذة الحدود.

تشمل نقاط القطع الصالحة:

- إدخالات الرسائل ذات الأدوار: `user`، `assistant`، `bashExecution`، `hookMessage`، `branchSummary`، `compactionSummary`
- إدخالات `custom_message`
- إدخالات `branch_summary`

قاعدة صارمة: لا يجوز القطع عند `toolResult` أبداً.

إذا وُجدت إدخالات بيانات وصفية غير رسائلية مباشرةً قبل نقطة القطع (`model_change`، `thinking_level_change`، التسميات، إلخ)، يُضمَّها إلى المنطقة المحتفظ بها بتحريك فهرس القطع للخلف حتى الوصول إلى رسالة أو حد ضغط.

### معالجة الدورة المنقسمة

إذا لم تكن نقطة القطع عند بداية دورة مستخدم، يعامل الضغط الأمر باعتباره دورة منقسمة.

يعتمد اكتشاف بداية الدورة على هذه الحدود كبدايات دورة مستخدم:

- `message.role === "user"`
- `message.role === "bashExecution"`
- إدخال `custom_message`
- إدخال `branch_summary`

يُولِّد ضغط الدورة المنقسمة ملخصين:

1. ملخص السجل (`messagesToSummarize`)
2. ملخص بادئة الدورة (`turnPrefixMessages`)

يُدمج الملخص المخزن النهائي على النحو التالي:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### توليد الملخص

يبني `compact(...)` الملخصات من نص المحادثة المُسلسَل:

1. تحويل الرسائل عبر `convertToLlm()`.
2. التسلسل باستخدام `serializeConversation()`.
3. التغليف في `<conversation>...</conversation>`.
4. إضافة `<previous-summary>...</previous-summary>` اختيارياً.
5. حقن سياق الخطاف اختيارياً كقائمة `<additional-context>`.
6. تنفيذ موجه التلخيص مع `SUMMARIZATION_SYSTEM_PROMPT`.

اختيار الموجه:

- أول ضغط: `compaction-summary.md`
- ضغط تكراري مع ملخص سابق: `compaction-update-summary.md`
- المرور الثاني للدورة المنقسمة: `compaction-turn-prefix.md`
- ملخص واجهة مستخدم مختصر: `compaction-short-summary.md`

وضع التلخيص البعيد:

- إذا كان `compaction.remoteEndpoint` مضبوطاً، يُرسل الضغط طلب POST يحتوي على:
  - `{ systemPrompt, prompt }`
- يتوقع استجابة JSON تحتوي على `{ summary }` على الأقل.

### سياق عمليات الملفات في الملخصات

يتتبع الضغط نشاط الملفات التراكمي باستخدام استدعاءات أدوات المساعد:

- `read(path)` ← مجموعة القراءة
- `write(path)` ← مجموعة التعديل
- `edit(path)` ← مجموعة التعديل

السلوك التراكمي:

- يتضمن تفاصيل الضغط السابق فقط عندما يكون الإدخال السابق ناتجاً عن المنصة (`fromExtension !== true`).
- في الدورات المنقسمة، يتضمن أيضاً عمليات ملفات بادئة الدورة.
- يستثني `readFiles` الملفاتِ التي جرى تعديلها أيضاً.

تُلحَق وسوم الملفات بنص الملخص عبر قالب الموجه:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### الحفظ والإعادة

بعد توليد الملخص (أو الملخص المُقدَّم من الخطاف)، تقوم جلسة العميل بـ:

1. إلحاق `CompactionEntry` باستخدام `appendCompaction(...)`.
2. إعادة بناء السياق عبر `buildSessionContext()`.
3. استبدال رسائل العميل الحية بالسياق المُعاد بناؤه.
4. إطلاق حدث خطاف `session_compact`.

## مسار تلخيص الفروع

يرتبط تلخيص الفروع بالتنقل في الشجرة، لا بتجاوز حد الرموز.

### المُشغِّل

أثناء `navigateTree(...)`:

1. حساب الإدخالات المتروكة من الورقة القديمة إلى الجد المشترك باستخدام `collectEntriesForBranchSummary(...)`.
2. إذا طلب المُستدعي ملخصاً (`options.summarize`)، يُولَّد الملخص قبل تبديل الورقة.
3. إذا وُجد ملخص، يُرفق في هدف التنقل باستخدام `branchWithSummary(...)`.

يُشغَّل هذا عادةً من مسار `/tree` عندما يكون `branchSummary.enabled` مفعَّلاً.

### شكل تبديل الفرع (مرئي)

```text
الشجرة قبل التنقل:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

بعد التنقل مع الملخص:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### التحضير وميزانية الرموز

تحسب `generateBranchSummary(...)` الميزانية على النحو التالي:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

ثم تقوم `prepareBranchEntries(...)` بـ:

1. المرور الأول: جمع عمليات الملفات التراكمية من جميع الإدخالات المُلخَّصة، بما فيها تفاصيل `branch_summary` السابقة الناتجة عن المنصة.
2. المرور الثاني: المشي من الأحدث إلى الأقدم، إضافة الرسائل حتى بلوغ الميزانية.
3. تفضيل الحفاظ على السياق الأحدث.
4. قد تُضمَّن إدخالات الملخص الكبيرة قرب حافة الميزانية لضمان الاستمرارية.

تُضمَّن إدخالات الضغط كرسائل (`compactionSummary`) خلال مدخلات تلخيص الفروع.

### توليد الملخص والحفظ

يقوم تلخيص الفروع بـ:

1. تحويل الرسائل المختارة وتسلسلها.
2. تغليفها في `<conversation>`.
3. استخدام تعليمات مخصصة إذا وُفِّرت، وإلا يستخدم `branch-summary.md`.
4. استدعاء نموذج التلخيص مع `SUMMARIZATION_SYSTEM_PROMPT`.
5. إضافة `branch-summary-preamble.md` في البداية.
6. إلحاق وسوم عمليات الملفات.

يُخزَّن الناتج كـ `BranchSummaryEntry` مع تفاصيل اختيارية (`readFiles`، `modifiedFiles`).

## نقاط تواصل الامتدادات والخطافات

### `session_before_compact`

خطاف ما قبل الضغط.

يمكنه:

- إلغاء الضغط (`{ cancel: true }`)
- توفير حمولة ضغط مخصصة كاملة (`{ compaction: CompactionResult }`)

### `session.compacting`

خطاف تخصيص الموجه/السياق للضغط الافتراضي.

يمكنه إرجاع:

- `prompt` (تجاوز موجه الملخص الأساسي)
- `context` (سطور سياق إضافية تُحقن في `<additional-context>`)
- `preserveData` (يُخزَّن على إدخال الضغط)

### `session_compact`

إشعار ما بعد الضغط يحتوي على `compactionEntry` المحفوظ وعلامة `fromExtension`.

### `session_before_tree`

يُشغَّل عند التنقل في الشجرة قبل توليد ملخص الفرع الافتراضي.

يمكنه:

- إلغاء التنقل
- توفير `{ summary: { summary, details } }` مخصص يُستخدم عندما يطلب المستخدم التلخيص

### `session_tree`

حدث ما بعد التنقل يكشف عن الورقة الجديدة/القديمة وإدخال الملخص الاختياري.

## سلوك وقت التشغيل ودلالات الفشل

- يُلغي الضغط اليدوي عملية العميل الحالية أولاً.
- يلغي `abortCompaction()` وحدات تحكم الضغط اليدوي والتلقائي معاً.
- يُصدر الضغط التلقائي أحداث بدء/انتهاء جلسة لتحديثات واجهة المستخدم/الحالة.
- يمكن للضغط التلقائي تجربة مرشحين نموذجيين متعددين وإعادة محاولة الأخطاء العابرة.
- تُستثنى أخطاء التجاوز من مسار إعادة المحاولة العام لأنها تُعالَج بالضغط.
- إذا فشل الضغط التلقائي:
  - يُصدر مسار التجاوز `Context overflow recovery failed: ...`
  - يُصدر مسار العتبة `Auto-compaction failed: ...`
- يمكن إلغاء تلخيص الفروع عبر إشارة الإلغاء (مثل Escape)، مما يُعيد نتيجة تنقل ملغاة/متوقفة.

## الإعدادات والقيم الافتراضية

من `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

تُستهلك هذه القيم في وقت التشغيل بواسطة `AgentSession` ووحدات الضغط وتلخيص الفروع.
