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

يصف هذا المستند كيفية تنفيذ وكيل البرمجة لأمر `/handoff` حالياً: مسار التشغيل، ومحفز التوليد، والتقاط الاكتمال، وتبديل الجلسة، وإعادة حقن السياق.

## النطاق

يشمل:

- إرسال أمر `/handoff` التفاعلي
- دورة حياة `AgentSession.handoff()` وانتقالات الحالة
- كيفية التقاط مخرجات التسليم من مخرجات المساعد
- كيفية استمرار الجلسات القديمة/الجديدة في تخزين بيانات التسليم بشكل مختلف
- سلوك واجهة المستخدم عند النجاح والإلغاء والفشل

لا يشمل:

- التنقل العام في الشجرة/الداخليات الفرعية
- أوامر الجلسة غير المتعلقة بالتسليم (`/new`، `/fork`، `/resume`)

## ملفات التنفيذ

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## مسار التشغيل

1. يُعلَن عن `/handoff` في بيانات تعريف أوامر الشرطة المائلة المدمجة (`slash-commands.ts`) مع تلميح اختياري مضمَّن: `[focus instructions]`.
2. في معالجة الإدخال التفاعلية (`InputController`)، يُعترض نص الإرسال المطابق لـ `/handoff` أو `/handoff ...` قبل الإرسال الاعتيادي للمحفز.
3. يُمسح المحرر وتُستدعى الدالة `handleHandoffCommand(customInstructions?)`.
4. يُجري `CommandController.handleHandoffCommand` فحصاً مسبقاً باستخدام المدخلات الحالية:
   - يحسب مدخلات `type === "message"`.
   - إذا كانت `< 2`، يُصدر تحذيراً: `Nothing to hand off (no messages yet)` ويعود.

يوجد نفس الحارس للحد الأدنى من المحتوى مجدداً داخل `AgentSession.handoff()` ويُلقي استثناءً إذا انتُهك. يُكرر هذا الأمان على مستوى كل من واجهة المستخدم وطبقة الجلسة.

## دورة الحياة الشاملة

### 1) بدء توليد التسليم

`AgentSession.handoff(customInstructions?)`:

- يقرأ مدخلات الفرع الحالية (`sessionManager.getBranch()`)
- يتحقق من الحد الأدنى لعدد الرسائل (`>= 2`)
- ينشئ `#handoffAbortController`
- يبني محفزاً ثابتاً ومضمَّناً يطلب مستند تسليم منظماً (`Goal`، `Constraints & Preferences`، `Progress`، `Key Decisions`، `Critical Context`، `Next Steps`)
- يُضيف `Additional focus: ...` إذا وُجدت تعليمات مخصصة

يُرسَل المحفز عبر:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

يمنع `expandPromptTemplates: false` توسيع الشرطة المائلة/قوالب المحفز لهذه الحمولة التعليمية الداخلية.

### 2) التقاط الاكتمال

قبل إرسال المحفز، تشترك `handoff()` في أحداث الجلسة وتنتظر `agent_end`.

عند `agent_end`، تستخرج نص التسليم من حالة الوكيل بالمسح للخلف للعثور على أحدث رسالة `assistant`، ثم تسلسل جميع كتل `content` حيث `type === "text"` مع `\n`.

افتراضات الاستخراج المهمة:

- تُستخدم كتل النصوص فقط؛ يُتجاهل المحتوى غير النصي.
- يُفترض أن أحدث رسالة مساعد تقابل توليد التسليم.
- لا يُحلَّل أقسام الـ markdown ولا يُتحقق من مطابقة التنسيق.
- إذا لم يكن في مخرجات المساعد أي كتل نصية، يُعامَل التسليم على أنه مفقود.

### 3) فحوصات الإلغاء

تُعيد `handoff()` القيمة `undefined` عند تحقق أي من الشرطين:

- عدم وجود نص تسليم ملتقط، أو
- كون `#handoffAbortController.signal.aborted` صحيحاً

دائماً تُمسح `#handoffAbortController` في `finally`.

### 4) إنشاء جلسة جديدة

إذا تم التقاط النص ولم يُلغَ:

1. مسح كاتب الجلسة الحالية (`sessionManager.flush()`)
2. بدء جلسة جديدة تماماً (`sessionManager.newSession()`)
3. إعادة ضبط حالة الوكيل في الذاكرة (`agent.reset()`)
4. إعادة ربط `agent.sessionId` بمعرّف الجلسة الجديدة
5. مسح مصفوفات السياق المُصطفة (`#steeringMessages`، `#followUpMessages`، `#pendingNextTurnMessages`)
6. إعادة ضبط عداد تذكير المهام

ينشئ `newSession()` ترويساً جديداً وقائمة مدخلات فارغة (إعادة ضبط الورقة إلى `null`). في مسار التسليم، لا يُمرَّر `parentSession`.

### 5) حقن سياق التسليم

يُغلَّف مستند التسليم المُولَّد ويُضاف إلى الجلسة الجديدة كمدخل `custom_message`:

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

1. تحلّ `sessionManager.buildSessionContext()` قائمة الرسائل للورقة الحالية
2. يجعل `agent.replaceMessages(sessionContext.messages)` رسالة التسليم المحقونة السياقَ النشط
3. تُعيد الدالة `{ document: handoffText }`

في هذه المرحلة، يحتوي سياق LLM النشط في الجلسة الجديدة على رسالة التسليم المحقونة، لا النسخة القديمة من المحادثة.

## نموذج الاستمرارية: الجلسة القديمة مقابل الجديدة

### الجلسة القديمة

أثناء التوليد، تظل آلية استمرار الرسائل الاعتيادية نشطة. يُخزَّن رد التسليم من المساعد كمدخل `message` عادي عند `message_end`.

النتيجة: تحتوي الجلسة الأصلية على التسليم المُولَّد المرئي كجزء من النسخة التاريخية للمحادثة.

### الجلسة الجديدة

بعد إعادة ضبط الجلسة، يُخزَّن التسليم كـ `custom_message` مع `customType: "handoff"`.

يحوّل `buildSessionContext()` هذا المدخل إلى رسالة سياق مخصصة/مستخدم في وقت التشغيل عبر `createCustomMessage(...)`, لذا يُدرَج في المحفزات المستقبلية من الجلسة الجديدة.

## سلوك المتحكم/واجهة المستخدم

سلوك `CommandController.handleHandoffCommand`:

- يستدعي `await session.handoff(customInstructions)`
- إذا كانت النتيجة `undefined`: `showError("Handoff cancelled")`
- عند النجاح:
  - `rebuildChatFromMessages()` (يحمّل سياق الجلسة الجديدة، بما في ذلك التسليم المحقون)
  - يُبطل سطر الحالة والحد العلوي للمحرر
  - يُعيد تحميل المهام
  - يُضيف سطر نجاح في الدردشة: `New session started with handoff context`
- عند وجود استثناء:
  - إذا كانت الرسالة `"Handoff cancelled"` أو اسم الخطأ `AbortError`: `showError("Handoff cancelled")`
  - وإلا: `showError("Handoff failed: <message>")`
- يطلب عرضاً في النهاية

## دلالات الإلغاء (السلوك الحالي)

### أداة الإلغاء على مستوى الجلسة

تعرض `AgentSession`:

- `abortHandoff()` ← تُلغي `#handoffAbortController`
- `isGeneratingHandoff` ← صحيح أثناء وجود المتحكم

عند استخدام مسار الإلغاء هذا، يرفض مشترك التسليم بـ `Error("Handoff cancelled")`، ويُربط متحكم الأمر بواجهة مستخدم الإلغاء.

### محدودية مسار `/handoff` التفاعلي

في الأسلاك الحالية للمتحكم التفاعلي، لا يُثبِّت `/handoff` معالجاً مخصصاً لمفتاح Escape يستدعي `abortHandoff()` (على خلاف مسارات الضغط/ملخص الفرع التي تُعيد تعريف `editor.onEscape` مؤقتاً).

الأثر العملي:

- يتوفر دعم الإلغاء على مستوى الجلسة، لكن لا يوجد ربط مفتاح مخصص للتسليم في مسار أمر `/handoff`.
- قد يظل مقاطعة المستخدم ممكنةً عبر مسارات إلغاء الوكيل الأشمل، لكن ذلك ليس نفس قناة الإلغاء الصريحة التي يستخدمها `abortHandoff()`.

## التسليم الملغى مقابل الفاشل

تصنيف واجهة المستخدم الحالي:

- **ملغى/مُلغَى**
  - يُشغِّل مسار `abortHandoff()` الخطأ `"Handoff cancelled"`، أو
  - رمي `AbortError`
  - تعرض واجهة المستخدم `Handoff cancelled`

- **فاشل**
  - أي خطأ مرمي آخر من `handoff()` / خط أنابيب المحفز (أخطاء التحقق من النموذج/API، استثناءات وقت التشغيل، إلخ)
  - تعرض واجهة المستخدم `Handoff failed: ...`

فارق دقيق إضافي: إذا اكتمل التوليد لكن لم يُستخرج أي نص، تُعيد `handoff()` القيمة `undefined` ويُبلِّغ المتحكم حالياً عن **إلغاء**، لا **فشل**.

## ضمانات الجلسات القصيرة والحد الأدنى من المحتوى

يمنع حارسان إنشاء تسليمات منخفضة الإشارة:

- طبقة واجهة المستخدم (`handleHandoffCommand`): تُصدر تحذيراً وتعود مبكراً لـ `< 2` مدخلات رسائل
- طبقة الجلسة (`handoff()`): ترمي نفس الشرط كخطأ

يتجنب هذا إنشاء جلسة جديدة بسياق تسليم فارغ أو شبه فارغ.

## ملخص انتقالات الحالة

تدفق الحالة رفيع المستوى:

1. اعتراض أمر الشرطة المائلة التفاعلي
2. الفحص المسبق لعدد الرسائل
3. إنشاء `#handoffAbortController` (`isGeneratingHandoff = true`)
4. إرسال محفز التسليم الداخلي (مرئي في الدردشة كتوليد مساعد عادي)
5. عند `agent_end`، استخراج آخر نص مساعد
6. إذا كان مفقوداً/ملغى ← إعادة `undefined` أو مسار خطأ الإلغاء
7. إذا كان موجوداً:
   - مسح الجلسة القديمة
   - إنشاء جلسة جديدة فارغة
   - إعادة ضبط قوائم الانتظار/العدادات في وقت التشغيل
   - إضافة `custom_message(handoff)`
   - إعادة بناء واستبدال رسائل الوكيل النشطة
8. يُعيد المتحكم بناء واجهة دردشة المستخدم ويُعلن النجاح
9. مسح `#handoffAbortController` (`isGeneratingHandoff = false`)

## الافتراضات والقيود المعروفة

- استخراج التسليم تخميني: "آخر كتل نص مساعد"؛ لا يوجد تحقق هيكلي.
- لا يوجد فحص صارم بأن الـ markdown المُولَّد يتبع تنسيق الأقسام المطلوب.
- يُبلَّغ عن النص المستخرج المفقود على أنه إلغاء في واجهة المستخدم الخاصة بالمتحكم.
- يفتقر تدفق `/handoff` التفاعلي حالياً إلى ربط مخصص بـ Escape→`abortHandoff()`.
- لا تُضبط بيانات وصف سلسلة نسب الجلسة الجديدة (`parentSession`) في هذا المسار.
