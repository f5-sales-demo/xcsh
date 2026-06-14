---
title: خط أنابيب توليد التسليم
description: خط أنابيب توليد التسليم لإنشاء ملخصات جلسات قابلة للنقل للتعاون بين الفرق.
sidebar:
  order: 8
  label: خط أنابيب التسليم
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# خط أنابيب توليد `/handoff`

يصف هذا المستند كيفية تنفيذ وكيل البرمجة لأمر `/handoff` حاليًا: مسار التشغيل، وموجّه التوليد، والتقاط الإكمال، والتبديل بين الجلسات، وإعادة حقن السياق.

## النطاق

يغطي:

- إرسال أمر `/handoff` التفاعلي
- دورة حياة `AgentSession.handoff()` وانتقالات الحالة
- كيفية التقاط مخرجات التسليم من مخرجات المساعد
- كيفية اختلاف استمرار بيانات التسليم بين الجلسات القديمة والجديدة
- سلوك واجهة المستخدم في حالات النجاح والإلغاء والفشل

لا يغطي:

- التنقل العام في الشجرة/الآليات الداخلية للفروع
- أوامر الجلسة غير المتعلقة بالتسليم (`/new`، `/fork`، `/resume`)

## ملفات التطبيق

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## مسار التشغيل

1. يُعلَن `/handoff` في بيانات تعريف أوامر الشرطة المائلة المدمجة (`slash-commands.ts`) مع تلميح اختياري مضمّن: `[focus instructions]`.
2. في معالجة الإدخال التفاعلي (`InputController`)، يتم اعتراض نص الإرسال المطابق لـ `/handoff` أو `/handoff ...` قبل إرسال الموجّه الطبيعي.
3. يُمسح المحرر ويُستدعى `handleHandoffCommand(customInstructions?)`.
4. ينفّذ `CommandController.handleHandoffCommand` فحصًا مسبقًا باستخدام الإدخالات الحالية:
   - يحسب الإدخالات من النوع `type === "message"`.
   - إذا كانت `< 2`، يُصدر تحذيرًا: `Nothing to hand off (no messages yet)` ويعود.

يوجد نفس حارس الحد الأدنى للمحتوى مرة أخرى داخل `AgentSession.handoff()` ويرمي خطأً إذا انتُهك. هذا يُضاعف الأمان على مستوى واجهة المستخدم ومستوى الجلسة معًا.

## دورة الحياة الكاملة

### 1) بدء توليد التسليم

`AgentSession.handoff(customInstructions?)`:

- يقرأ إدخالات الفرع الحالي (`sessionManager.getBranch()`)
- يتحقق من الحد الأدنى لعدد الرسائل (`>= 2`)
- ينشئ `#handoffAbortController`
- يبني موجّهًا ثابتًا مضمّنًا يطلب وثيقة تسليم منظمة (`Goal`، `Constraints & Preferences`، `Progress`، `Key Decisions`، `Critical Context`، `Next Steps`)
- يُلحق `Additional focus: ...` إذا تم توفير تعليمات مخصصة

يُرسَل الموجّه عبر:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` يمنع توسيع قوالب الشرطة المائلة/الموجّهات لهذه الحمولة التعليمية الداخلية.

### 2) التقاط الإكمال

قبل إرسال الموجّه، يشترك `handoff()` في أحداث الجلسة وينتظر `agent_end`.

عند `agent_end`، يستخرج نص التسليم من حالة الوكيل عن طريق المسح للخلف بحثًا عن أحدث رسالة `assistant`، ثم تسلسل جميع كتل `content` التي يكون فيها `type === "text"` مع `\n`.

افتراضات الاستخراج المهمة:

- تُستخدم كتل النص فقط؛ يتم تجاهل المحتوى غير النصي.
- يفترض أن آخر رسالة مساعد تقابل توليد التسليم.
- لا يحلل أقسام markdown ولا يتحقق من الامتثال للتنسيق.
- إذا لم يحتوِ مخرج المساعد على كتل نصية، يُعامَل التسليم على أنه مفقود.

### 3) فحوصات الإلغاء

يُعيد `handoff()` قيمة `undefined` عند تحقق أي من الشرطين:

- عدم وجود نص تسليم ملتقط، أو
- كون `#handoffAbortController.signal.aborted` صحيحًا

يمسح دائمًا `#handoffAbortController` في `finally`.

### 4) إنشاء جلسة جديدة

إذا تم التقاط النص ولم يُلغَ:

1. مسح كاتب الجلسة الحالية (`sessionManager.flush()`)
2. بدء جلسة جديدة تمامًا (`sessionManager.newSession()`)
3. إعادة تعيين حالة الوكيل في الذاكرة (`agent.reset()`)
4. إعادة ربط `agent.sessionId` بمعرّف الجلسة الجديدة
5. مسح مصفوفات السياق المنتظرة (`#steeringMessages`، `#followUpMessages`، `#pendingNextTurnMessages`)
6. إعادة تعيين عداد تذكير المهام

ينشئ `newSession()` ترويسة جديدة وقائمة إدخالات فارغة (إعادة تعيين الورقة إلى `null`). في مسار التسليم، لا يُمرَّر `parentSession`.

### 5) حقن سياق التسليم

يُغلَّف مستند التسليم المُولَّد ويُلحق بالجلسة الجديدة كإدخال `custom_message`:

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
- نوع الإدخال: `custom_message` (يشارك في سياق نموذج اللغة الكبير)

### 6) إعادة بناء سياق الوكيل النشط

بعد الحقن:

1. يحلّ `sessionManager.buildSessionContext()` قائمة الرسائل للورقة الحالية
2. يجعل `agent.replaceMessages(sessionContext.messages)` رسالة التسليم المُحقَنة سياقًا نشطًا
3. تُعيد الدالة `{ document: handoffText }`

في هذه المرحلة، يحتوي سياق نموذج اللغة الكبير النشط في الجلسة الجديدة على رسالة التسليم المُحقَنة، وليس النسخة القديمة.

## نموذج الاستمرار: الجلسة القديمة مقابل الجلسة الجديدة

### الجلسة القديمة

أثناء التوليد، يظل استمرار الرسائل الطبيعي نشطًا. يُستمَر بالاستجابة التسليمية للمساعد كإدخال `message` عادي عند `message_end`.

النتيجة: تحتوي الجلسة الأصلية على التسليم المُولَّد المرئي كجزء من السجل التاريخي.

### الجلسة الجديدة

بعد إعادة تعيين الجلسة، يُستمَر بالتسليم كـ `custom_message` مع `customType: "handoff"`.

يحوّل `buildSessionContext()` هذا الإدخال إلى رسالة سياق مخصصة/للمستخدم في وقت التشغيل عبر `createCustomMessage(...)` لتُدرَج في الموجّهات المستقبلية من الجلسة الجديدة.

## سلوك المتحكم/واجهة المستخدم

سلوك `CommandController.handleHandoffCommand`:

- يستدعي `await session.handoff(customInstructions)`
- إذا كانت النتيجة `undefined`: `showError("Handoff cancelled")`
- عند النجاح:
  - `rebuildChatFromMessages()` (تحميل سياق الجلسة الجديدة، بما في ذلك التسليم المُحقَن)
  - إبطال سطر الحالة والحد العلوي للمحرر
  - إعادة تحميل المهام
  - إلحاق سطر نجاح في الدردشة: `New session started with handoff context`
- عند الاستثناء:
  - إذا كانت الرسالة `"Handoff cancelled"` أو كان اسم الخطأ `AbortError`: `showError("Handoff cancelled")`
  - وإلا: `showError("Handoff failed: <message>")`
- يطلب التصيير في النهاية

## دلالات الإلغاء (السلوك الحالي)

### آلية الإلغاء على مستوى الجلسة

يُوفّر `AgentSession`:

- `abortHandoff()` ← يُلغي `#handoffAbortController`
- `isGeneratingHandoff` ← صحيح أثناء وجود المتحكم

عند استخدام مسار الإلغاء هذا، يرفض مشترك التسليم مع `Error("Handoff cancelled")`، ويُعيّنه متحكم الأوامر إلى واجهة مستخدم الإلغاء.

### قيد مسار `/handoff` التفاعلي

في التوصيل الحالي للمتحكم التفاعلي، لا يُثبّت `/handoff` معالجًا مخصصًا لـ Escape يستدعي `abortHandoff()` (على عكس مسارات الضغط/ملخص الفرع التي تتجاوز مؤقتًا `editor.onEscape`).

الأثر العملي:

- توجد دعم للإلغاء على مستوى الجلسة، لكن لا يوجد ربط مفتاح خاص بالتسليم في مسار أمر `/handoff`.
- قد يظل مقاطعة المستخدم ممكنة من خلال مسارات إلغاء الوكيل الأشمل، لكن ذلك ليس نفس قناة الإلغاء الصريحة التي يستخدمها `abortHandoff()`.

## التسليم الملغى مقابل الفاشل

التصنيف الحالي لواجهة المستخدم:

- **ملغى/مُلغى**
  - يُشغّل مسار `abortHandoff()` الخطأ `"Handoff cancelled"`، أو
  - خطأ `AbortError` مُرمى
  - تُظهر واجهة المستخدم `Handoff cancelled`

- **فاشل**
  - أي خطأ مُرمى آخر من `handoff()` / خط أنابيب الموجّه (أخطاء التحقق من النموذج/API، استثناءات وقت التشغيل، إلخ)
  - تُظهر واجهة المستخدم `Handoff failed: ...`

تفاصيل إضافية: إذا اكتمل التوليد لكن لم يُستخرج أي نص، يُعيد `handoff()` قيمة `undefined` ويُبلّغ المتحكم حاليًا عن **إلغاء**، وليس **فشل**.

## حواجز الحماية للجلسات القصيرة والحد الأدنى للمحتوى

يمنع حارسان التسليمات ذات الإشارة المنخفضة:

- طبقة واجهة المستخدم (`handleHandoffCommand`): تحذّر وتعود مبكرًا لـ `< 2` إدخالات رسائل
- طبقة الجلسة (`handoff()`): تُرمي نفس الشرط كخطأ

يتجنب هذا إنشاء جلسة جديدة بسياق تسليم فارغ أو شبه فارغ.

## ملخص انتقالات الحالة

تدفق الحالة رفيع المستوى:

1. اعتراض أمر الشرطة المائلة التفاعلية
2. حارس عدد الرسائل المسبق
3. إنشاء `#handoffAbortController` (`isGeneratingHandoff = true`)
4. إرسال موجّه التسليم الداخلي (مرئي في الدردشة كتوليد مساعد طبيعي)
5. عند `agent_end`، استخراج آخر نص للمساعد
6. إذا كان مفقودًا/ملغى ← إعادة `undefined` أو مسار خطأ الإلغاء
7. إذا كان موجودًا:
   - مسح الجلسة القديمة
   - إنشاء جلسة جديدة فارغة
   - إعادة تعيين طوابير/عدادات وقت التشغيل
   - إلحاق `custom_message(handoff)`
   - إعادة بناء رسائل الوكيل النشط واستبدالها
8. يعيد المتحكم بناء واجهة دردشة المستخدم ويُعلن النجاح
9. مسح `#handoffAbortController` (`isGeneratingHandoff = false`)

## الافتراضات والقيود المعروفة

- استخراج التسليم استدلالي: "آخر كتل نص المساعد"؛ لا يوجد تحقق هيكلي.
- لا يوجد فحص صارم بأن markdown المُولَّد يتبع تنسيق القسم المطلوب.
- يُبلَّغ عن النص المُستخرَج المفقود كإلغاء في تجربة مستخدم المتحكم.
- يفتقر تدفق التفاعل `/handoff` حاليًا إلى ربط Escape→`abortHandoff()` مخصص.
- لا يُعيَّن بيانات تعريف النسب للجلسة الجديدة (`parentSession`) من خلال هذا المسار.
