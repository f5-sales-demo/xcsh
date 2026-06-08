---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Handoff pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# مسار توليد `/handoff`

يصف هذا المستند كيف يقوم وكيل البرمجة بتنفيذ `/handoff` حالياً: مسار التشغيل، موجه التوليد، التقاط المخرجات، تبديل الجلسة، وإعادة حقن السياق.

## النطاق

يغطي:

- إرسال أمر `/handoff` التفاعلي
- دورة حياة `AgentSession.handoff()` وانتقالات الحالة
- كيفية التقاط مخرجات التسليم من مخرجات المساعد
- كيف تحتفظ الجلسات القديمة/الجديدة ببيانات التسليم بشكل مختلف
- سلوك واجهة المستخدم عند النجاح والإلغاء والفشل

لا يغطي:

- الأجزاء الداخلية العامة للتنقل في الشجرة/الفروع
- أوامر الجلسات غير المتعلقة بالتسليم (`/new`، `/fork`، `/resume`)

## ملفات التنفيذ

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## مسار التشغيل

1. يتم الإعلان عن `/handoff` في البيانات الوصفية لأوامر الشرطة المائلة المدمجة (`slash-commands.ts`) مع تلميح مضمن اختياري: `[focus instructions]`.
2. في معالجة الإدخال التفاعلي (`InputController`)، يتم اعتراض النص المُرسَل المطابق لـ `/handoff` أو `/handoff ...` قبل إرسال الموجه العادي.
3. يتم مسح المحرر واستدعاء `handleHandoffCommand(customInstructions?)`.
4. يقوم `CommandController.handleHandoffCommand` بإجراء فحص أولي باستخدام المدخلات الحالية:
   - يحسب المدخلات من نوع `type === "message"`.
   - إذا كانت `< 2`، يعرض تحذيراً: `Nothing to hand off (no messages yet)` ويعود.

نفس حارس الحد الأدنى من المحتوى موجود أيضاً داخل `AgentSession.handoff()` ويرمي خطأ إذا تم انتهاكه. هذا يكرر الحماية في كل من طبقة واجهة المستخدم وطبقة الجلسة.

## دورة الحياة من البداية إلى النهاية

### 1) بدء توليد التسليم

`AgentSession.handoff(customInstructions?)`:

- يقرأ مدخلات الفرع الحالي (`sessionManager.getBranch()`)
- يتحقق من الحد الأدنى لعدد الرسائل (`>= 2`)
- ينشئ `#handoffAbortController`
- يبني موجهاً ثابتاً مضمناً يطلب مستند تسليم منظم (`Goal`، `Constraints & Preferences`، `Progress`، `Key Decisions`، `Critical Context`، `Next Steps`)
- يُلحق `Additional focus: ...` إذا تم تقديم تعليمات مخصصة

يتم إرسال الموجه عبر:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` يمنع توسيع الشرطة المائلة/قوالب الموجهات لحمولة التعليمات الداخلية هذه.

### 2) التقاط الإكمال

قبل إرسال الموجه، تشترك `handoff()` في أحداث الجلسة وتنتظر `agent_end`.

عند `agent_end`، تستخرج نص التسليم من حالة الوكيل عن طريق المسح العكسي للعثور على أحدث رسالة `assistant`، ثم تجميع جميع كتل `content` حيث `type === "text"` باستخدام `\n`.

افتراضات الاستخراج المهمة:

- تُستخدم كتل النص فقط؛ يتم تجاهل المحتوى غير النصي.
- يُفترض أن أحدث رسالة للمساعد تتوافق مع توليد التسليم.
- لا يتم تحليل أقسام markdown أو التحقق من التوافق مع التنسيق.
- إذا لم تحتوِ مخرجات المساعد على كتل نصية، يُعامَل التسليم على أنه مفقود.

### 3) فحوصات الإلغاء

تعيد `handoff()` القيمة `undefined` عندما يتحقق أي من الشرطين:

- عدم وجود نص تسليم ملتقط، أو
- `#handoffAbortController.signal.aborted` تساوي true

تقوم دائماً بمسح `#handoffAbortController` في كتلة `finally`.

### 4) إنشاء جلسة جديدة

إذا تم التقاط النص ولم يتم الإلغاء:

1. تفريغ كاتب الجلسة الحالية (`sessionManager.flush()`)
2. بدء جلسة جديدة تماماً (`sessionManager.newSession()`)
3. إعادة تعيين حالة الوكيل في الذاكرة (`agent.reset()`)
4. إعادة ربط `agent.sessionId` بمعرف الجلسة الجديد
5. مسح مصفوفات السياق المُصفَّفة (`#steeringMessages`، `#followUpMessages`، `#pendingNextTurnMessages`)
6. إعادة تعيين عداد تذكير المهام

تُنشئ `newSession()` ترويسة جديدة وقائمة مدخلات فارغة (إعادة تعيين الورقة إلى `null`). في مسار التسليم، لا يتم تمرير `parentSession`.

### 5) حقن سياق التسليم

يتم تغليف مستند التسليم المُولَّد وإلحاقه بالجلسة الجديدة كمدخل `custom_message`:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

استدعاء الإدراج:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

الدلالات:

- `customType`: `"handoff"`
- `display`: `true` (مرئي في إعادة بناء TUI)
- نوع المدخل: `custom_message` (يشارك في سياق LLM)

### 6) إعادة بناء سياق الوكيل النشط

بعد الحقن:

1. تحل `sessionManager.buildSessionContext()` قائمة الرسائل للورقة الحالية
2. `agent.replaceMessages(sessionContext.messages)` تجعل رسالة التسليم المحقونة السياق النشط
3. تعيد الدالة `{ document: handoffText }`

عند هذه النقطة، يحتوي سياق LLM النشط في الجلسة الجديدة على رسالة التسليم المحقونة، وليس النسخة القديمة من المحادثة.

## نموذج الاستمرارية: الجلسة القديمة مقابل الجلسة الجديدة

### الجلسة القديمة

أثناء التوليد، تظل استمرارية الرسائل العادية نشطة. يتم حفظ استجابة التسليم من المساعد كمدخل `message` عادي عند `message_end`.

النتيجة: تحتوي الجلسة الأصلية على التسليم المُولَّد المرئي كجزء من سجل المحادثة التاريخي.

### الجلسة الجديدة

بعد إعادة تعيين الجلسة، يتم حفظ التسليم كـ `custom_message` مع `customType: "handoff"`.

تحوّل `buildSessionContext()` هذا المدخل إلى رسالة سياق مخصصة/مستخدم وقت التشغيل عبر `createCustomMessage(...)`، بحيث يتم تضمينه في الموجهات المستقبلية من الجلسة الجديدة.

## سلوك المتحكم/واجهة المستخدم

سلوك `CommandController.handleHandoffCommand`:

- يستدعي `await session.handoff(customInstructions)`
- إذا كانت النتيجة `undefined`: `showError("Handoff cancelled")`
- عند النجاح:
  - `rebuildChatFromMessages()` (يحمّل سياق الجلسة الجديدة، بما في ذلك التسليم المحقون)
  - يُبطل شريط الحالة والحد العلوي للمحرر
  - يعيد تحميل المهام
  - يُلحق سطر نجاح في المحادثة: `New session started with handoff context`
- عند حدوث استثناء:
  - إذا كانت الرسالة `"Handoff cancelled"` أو اسم الخطأ `AbortError`: `showError("Handoff cancelled")`
  - وإلا: `showError("Handoff failed: <message>")`
- يطلب إعادة العرض في النهاية

## دلالات الإلغاء (السلوك الحالي)

### بدائية الإلغاء على مستوى الجلسة

يكشف `AgentSession` عن:

- `abortHandoff()` → يُلغي `#handoffAbortController`
- `isGeneratingHandoff` → true أثناء وجود المتحكم

عند استخدام مسار الإلغاء هذا، يرفض مشترك التسليم بـ `Error("Handoff cancelled")`، ويُعيّنه متحكم الأوامر إلى واجهة مستخدم الإلغاء.

### قيود مسار `/handoff` التفاعلي

في التوصيل الحالي للمتحكم التفاعلي، لا يُثبّت `/handoff` معالج Escape مخصصاً يستدعي `abortHandoff()` (على عكس مسارات الضغط/ملخص الفرع التي تُعيد تعريف `editor.onEscape` مؤقتاً).

التأثير العملي:

- يوجد دعم للإلغاء على مستوى الجلسة، لكن لا يوجد ربط مفتاح مخصص للتسليم في مسار أمر `/handoff`.
- قد يحدث مقاطعة المستخدم من خلال مسارات إلغاء الوكيل الأوسع، لكن ذلك ليس نفس قناة الإلغاء الصريحة التي يستخدمها `abortHandoff()`.

## التسليم المُلغى مقابل الفاشل

التصنيف الحالي لواجهة المستخدم:

- **مُلغى/ملغي**
  - مسار `abortHandoff()` يُشغّل `"Handoff cancelled"`، أو
  - خطأ `AbortError` مرمي
  - تعرض واجهة المستخدم `Handoff cancelled`

- **فاشل**
  - أي خطأ آخر مرمي من `handoff()` / مسار الموجه (أخطاء التحقق من النموذج/API، استثناءات وقت التشغيل، إلخ.)
  - تعرض واجهة المستخدم `Handoff failed: ...`

فارق دقيق إضافي: إذا اكتمل التوليد لكن لم يتم استخراج نص، تعيد `handoff()` القيمة `undefined` ويُبلغ المتحكم حالياً عن **إلغاء**، وليس **فشل**.

## حراس الجلسات القصيرة والحد الأدنى من المحتوى

يمنع حارسان التسليمات ذات الإشارة المنخفضة:

- طبقة واجهة المستخدم (`handleHandoffCommand`): تُحذّر وتعود مبكراً عند وجود `< 2` مدخلات رسائل
- طبقة الجلسة (`handoff()`): ترمي نفس الشرط كخطأ

هذا يتجنب إنشاء جلسة جديدة بسياق تسليم فارغ/شبه فارغ.

## ملخص انتقال الحالة

تدفق الحالة عالي المستوى:

1. اعتراض أمر الشرطة المائلة التفاعلي
2. فحص أولي لعدد الرسائل
3. إنشاء `#handoffAbortController` (`isGeneratingHandoff = true`)
4. إرسال موجه التسليم الداخلي (مرئي في المحادثة كتوليد مساعد عادي)
5. عند `agent_end`، استخراج آخر نص للمساعد
6. إذا كان مفقوداً/مُلغى → إعادة `undefined` أو مسار خطأ الإلغاء
7. إذا كان موجوداً:
   - تفريغ الجلسة القديمة
   - إنشاء جلسة فارغة جديدة
   - إعادة تعيين قوائم الانتظار/العدادات وقت التشغيل
   - إلحاق `custom_message(handoff)`
   - إعادة بناء واستبدال رسائل الوكيل النشطة
8. يعيد المتحكم بناء واجهة المحادثة ويعلن النجاح
9. مسح `#handoffAbortController` (`isGeneratingHandoff = false`)

## الافتراضات والقيود المعروفة

- استخراج التسليم تجريبي: "آخر كتل نصية للمساعد"؛ لا يوجد تحقق هيكلي.
- لا يوجد فحص صارم بأن markdown المُولَّد يتبع تنسيق الأقسام المطلوب.
- يتم الإبلاغ عن النص المستخرج المفقود على أنه إلغاء في تجربة مستخدم المتحكم.
- يفتقر تدفق `/handoff` التفاعلي حالياً إلى ربط مخصص Escape→`abortHandoff()`.
- لا يتم تعيين بيانات نسب الجلسة الجديدة (`parentSession`) بواسطة هذا المسار.
