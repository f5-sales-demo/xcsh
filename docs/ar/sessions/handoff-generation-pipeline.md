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

# خط أنابيب توليد `/handoff`

يصف هذا المستند كيفية تنفيذ وكيل البرمجة لأمر `/handoff` حالياً: مسار التشغيل، موجه التوليد، التقاط المخرجات، تبديل الجلسة، وإعادة حقن السياق.

## النطاق

يغطي:

- إرسال أمر `/handoff` التفاعلي
- دورة حياة `AgentSession.handoff()` وانتقالات الحالة
- كيفية التقاط مخرجات التسليم من مخرجات المساعد
- كيفية حفظ بيانات التسليم بشكل مختلف في الجلسات القديمة والجديدة
- سلوك واجهة المستخدم للنجاح والإلغاء والفشل

لا يغطي:

- آليات التنقل في الشجرة/التفرعات العامة
- أوامر الجلسة غير المتعلقة بالتسليم (`/new`، `/fork`، `/resume`)

## ملفات التنفيذ

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## مسار التشغيل

1. يتم الإعلان عن `/handoff` في البيانات الوصفية للأوامر المائلة المدمجة (`slash-commands.ts`) مع تلميح مضمّن اختياري: `[focus instructions]`.
2. في معالجة الإدخال التفاعلي (`InputController`)، يتم اعتراض النص المُرسَل المطابق لـ `/handoff` أو `/handoff ...` قبل الإرسال العادي للموجه.
3. يتم مسح المحرر واستدعاء `handleHandoffCommand(customInstructions?)`.
4. يقوم `CommandController.handleHandoffCommand` بإجراء فحص أولي باستخدام الإدخالات الحالية:
   - يحسب الإدخالات من نوع `type === "message"`.
   - إذا كانت `< 2`، يعرض تحذيراً: `Nothing to hand off (no messages yet)` ويعود.

نفس حارس الحد الأدنى للمحتوى موجود أيضاً داخل `AgentSession.handoff()` ويطرح خطأ إذا تم انتهاكه. هذا يكرر الحماية في كل من طبقة واجهة المستخدم وطبقة الجلسة.

## دورة الحياة من البداية إلى النهاية

### 1) بدء توليد التسليم

`AgentSession.handoff(customInstructions?)`:

- يقرأ إدخالات الفرع الحالي (`sessionManager.getBranch()`)
- يتحقق من الحد الأدنى لعدد الرسائل (`>= 2`)
- ينشئ `#handoffAbortController`
- يبني موجهاً ثابتاً مضمّناً يطلب مستند تسليم منظماً (`Goal`، `Constraints & Preferences`، `Progress`، `Key Decisions`، `Critical Context`، `Next Steps`)
- يُلحق `Additional focus: ...` إذا تم توفير تعليمات مخصصة

يتم إرسال الموجه عبر:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` يمنع توسيع قوالب الأوامر المائلة/الموجهات لحمولة التعليمات الداخلية هذه.

### 2) التقاط المخرجات المكتملة

قبل إرسال الموجه، يشترك `handoff()` في أحداث الجلسة وينتظر `agent_end`.

عند `agent_end`، يستخرج نص التسليم من حالة الوكيل عن طريق المسح العكسي للعثور على أحدث رسالة `assistant`، ثم يدمج جميع كتل `content` حيث `type === "text"` باستخدام `\n`.

افتراضات الاستخراج المهمة:

- يتم استخدام كتل النص فقط؛ المحتوى غير النصي يتم تجاهله.
- يفترض أن أحدث رسالة للمساعد تتوافق مع توليد التسليم.
- لا يقوم بتحليل أقسام markdown أو التحقق من التوافق مع التنسيق.
- إذا لم تحتوِ مخرجات المساعد على كتل نصية، يتم التعامل مع التسليم على أنه مفقود.

### 3) فحوصات الإلغاء

يُعيد `handoff()` قيمة `undefined` عندما يتحقق أي من الشرطين:

- عدم وجود نص تسليم ملتقط، أو
- `#handoffAbortController.signal.aborted` يساوي true

يقوم دائماً بمسح `#handoffAbortController` في `finally`.

### 4) إنشاء جلسة جديدة

إذا تم التقاط النص ولم يتم الإلغاء:

1. تفريغ كاتب الجلسة الحالية (`sessionManager.flush()`)
2. بدء جلسة جديدة تماماً (`sessionManager.newSession()`)
3. إعادة تعيين حالة الوكيل في الذاكرة (`agent.reset()`)
4. إعادة ربط `agent.sessionId` بمعرف الجلسة الجديدة
5. مسح مصفوفات السياق المُصفّاة (`#steeringMessages`، `#followUpMessages`، `#pendingNextTurnMessages`)
6. إعادة تعيين عداد تذكير المهام

`newSession()` ينشئ ترويسة جديدة وقائمة إدخالات فارغة (إعادة تعيين الورقة إلى `null`). في مسار التسليم، لا يتم تمرير `parentSession`.

### 5) حقن سياق التسليم

يتم تغليف مستند التسليم المُولَّد وإلحاقه بالجلسة الجديدة كإدخال `custom_message`:

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
- `display`: `true` (مرئي في إعادة بناء واجهة TUI)
- نوع الإدخال: `custom_message` (يشارك في سياق LLM)

### 6) إعادة بناء سياق الوكيل النشط

بعد الحقن:

1. `sessionManager.buildSessionContext()` يحل قائمة الرسائل للورقة الحالية
2. `agent.replaceMessages(sessionContext.messages)` يجعل رسالة التسليم المحقونة سياقاً نشطاً
3. تُعيد الطريقة `{ document: handoffText }`

عند هذه النقطة، يحتوي سياق LLM النشط في الجلسة الجديدة على رسالة التسليم المحقونة، وليس النص الأصلي القديم.

## نموذج الاستمرارية: الجلسة القديمة مقابل الجلسة الجديدة

### الجلسة القديمة

أثناء التوليد، تبقى آلية حفظ الرسائل العادية نشطة. يتم حفظ استجابة التسليم من المساعد كإدخال `message` عادي عند `message_end`.

النتيجة: تحتوي الجلسة الأصلية على مستند التسليم المُولَّد المرئي كجزء من النص التاريخي.

### الجلسة الجديدة

بعد إعادة تعيين الجلسة، يتم حفظ التسليم كـ `custom_message` مع `customType: "handoff"`.

يقوم `buildSessionContext()` بتحويل هذا الإدخال إلى رسالة سياق مخصصة/مستخدم في وقت التشغيل عبر `createCustomMessage(...)`، بحيث يتم تضمينه في الموجهات المستقبلية من الجلسة الجديدة.

## سلوك المتحكم/واجهة المستخدم

سلوك `CommandController.handleHandoffCommand`:

- يستدعي `await session.handoff(customInstructions)`
- إذا كانت النتيجة `undefined`: `showError("Handoff cancelled")`
- عند النجاح:
  - `rebuildChatFromMessages()` (يحمل سياق الجلسة الجديدة، بما في ذلك التسليم المحقون)
  - يُبطل شريط الحالة والحد العلوي للمحرر
  - يعيد تحميل المهام
  - يلحق سطر نجاح في المحادثة: `New session started with handoff context`
- عند حدوث استثناء:
  - إذا كانت الرسالة `"Handoff cancelled"` أو اسم الخطأ `AbortError`: `showError("Handoff cancelled")`
  - خلاف ذلك: `showError("Handoff failed: <message>")`
- يطلب إعادة العرض في النهاية

## دلالات الإلغاء (السلوك الحالي)

### آلية الإلغاء على مستوى الجلسة

يعرض `AgentSession`:

- `abortHandoff()` → يلغي `#handoffAbortController`
- `isGeneratingHandoff` → يكون true أثناء وجود المتحكم

عند استخدام مسار الإلغاء هذا، يرفض مشترك التسليم بـ `Error("Handoff cancelled")`، ويقوم متحكم الأوامر بتعيينه إلى واجهة مستخدم الإلغاء.

### قيود مسار `/handoff` التفاعلي

في التوصيل الحالي للمتحكم التفاعلي، لا يقوم `/handoff` بتثبيت معالج مخصص لمفتاح Escape يستدعي `abortHandoff()` (على عكس مسارات الضغط/ملخص الفرع التي تتجاوز مؤقتاً `editor.onEscape`).

التأثير العملي:

- يوجد دعم للإلغاء على مستوى الجلسة، لكن لا يوجد ربط مفاتيح مخصص للتسليم في مسار أمر `/handoff`.
- قد يحدث مقاطعة المستخدم من خلال مسارات إلغاء الوكيل الأوسع، لكن ذلك ليس نفس قناة الإلغاء الصريحة المستخدمة بواسطة `abortHandoff()`.

## التسليم الملغى مقابل الفاشل

تصنيف واجهة المستخدم الحالي:

- **ملغى/مُلغى**
  - مسار `abortHandoff()` يطلق `"Handoff cancelled"`، أو
  - خطأ `AbortError` مطروح
  - تعرض الواجهة `Handoff cancelled`

- **فاشل**
  - أي خطأ آخر مطروح من `handoff()` / خط أنابيب الموجه (أخطاء التحقق من النموذج/API، استثناءات وقت التشغيل، إلخ.)
  - تعرض الواجهة `Handoff failed: ...`

ملاحظة إضافية: إذا اكتمل التوليد لكن لم يتم استخراج أي نص، يُعيد `handoff()` قيمة `undefined` ويُبلغ المتحكم حالياً عن **إلغاء**، وليس **فشل**.

## حراس الجلسة القصيرة والحد الأدنى للمحتوى

يمنع حارسان التسليمات ذات الإشارة المنخفضة:

- طبقة واجهة المستخدم (`handleHandoffCommand`): تحذر وتعود مبكراً عند وجود `< 2` إدخال رسالة
- طبقة الجلسة (`handoff()`): تطرح نفس الشرط كخطأ

هذا يتجنب إنشاء جلسة جديدة بسياق تسليم فارغ/شبه فارغ.

## ملخص انتقالات الحالة

تدفق الحالة عالي المستوى:

1. اعتراض الأمر المائل التفاعلي
2. فحص أولي لعدد الرسائل
3. إنشاء `#handoffAbortController` (`isGeneratingHandoff = true`)
4. إرسال موجه التسليم الداخلي (مرئي في المحادثة كتوليد عادي من المساعد)
5. عند `agent_end`، استخراج آخر نص للمساعد
6. إذا كان مفقوداً/ملغى → إعادة `undefined` أو مسار خطأ الإلغاء
7. إذا كان موجوداً:
   - تفريغ الجلسة القديمة
   - إنشاء جلسة جديدة فارغة
   - إعادة تعيين قوائم الانتظار/العدادات في وقت التشغيل
   - إلحاق `custom_message(handoff)`
   - إعادة بناء واستبدال رسائل الوكيل النشطة
8. يعيد المتحكم بناء واجهة المحادثة ويعلن النجاح
9. مسح `#handoffAbortController` (`isGeneratingHandoff = false`)

## الافتراضات والقيود المعروفة

- استخراج التسليم استدلالي: "آخر كتل نصية للمساعد"؛ بدون تحقق هيكلي.
- لا يوجد فحص صارم بأن markdown المُولَّد يتبع تنسيق الأقسام المطلوب.
- يتم الإبلاغ عن النص المستخرج المفقود كإلغاء في تجربة مستخدم المتحكم.
- يفتقر تدفق `/handoff` التفاعلي حالياً إلى ربط مخصص لـ Escape→`abortHandoff()`.
- لا يتم تعيين بيانات نسب الجلسة الجديدة (`parentSession`) بواسطة هذا المسار.
