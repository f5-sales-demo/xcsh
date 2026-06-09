---
title: خط أنابيب توليد التسليم
description: خط أنابيب توليد التسليم لإنشاء ملخصات جلسات قابلة للنقل للتعاون بين الفريق.
sidebar:
  order: 8
  label: خط أنابيب التسليم
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# خط أنابيب توليد `/handoff`

يصف هذا المستند كيف ينفذ وكيل البرمجة `/handoff` حالياً: مسار التفعيل، موجه التوليد، التقاط المخرجات، تبديل الجلسة، وإعادة حقن السياق.

## النطاق

يغطي:

- إرسال أمر `/handoff` التفاعلي
- دورة حياة `AgentSession.handoff()` وانتقالات الحالة
- كيفية التقاط مخرجات التسليم من مخرجات المساعد
- كيفية حفظ بيانات التسليم في الجلسات القديمة/الجديدة بشكل مختلف
- سلوك واجهة المستخدم للنجاح والإلغاء والفشل

لا يغطي:

- التفاصيل الداخلية للتنقل العام في الشجرة/الفروع
- أوامر الجلسات غير المتعلقة بالتسليم (`/new`، `/fork`، `/resume`)

## ملفات التنفيذ

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## مسار التفعيل

1. يتم التصريح عن `/handoff` في البيانات الوصفية المدمجة لأوامر الشرطة المائلة (`slash-commands.ts`) مع تلميح مضمن اختياري: `[focus instructions]`.
2. في معالجة الإدخال التفاعلي (`InputController`)، يتم اعتراض النص المُرسَل المطابق لـ `/handoff` أو `/handoff ...` قبل الإرسال العادي للموجه.
3. يتم مسح المحرر واستدعاء `handleHandoffCommand(customInstructions?)`.
4. يقوم `CommandController.handleHandoffCommand` بإجراء فحص أولي باستخدام الإدخالات الحالية:
   - يحسب إدخالات `type === "message"`.
   - إذا كانت `< 2`، يعرض تحذيراً: `Nothing to hand off (no messages yet)` ويعود.

نفس حارس الحد الأدنى للمحتوى موجود أيضاً داخل `AgentSession.handoff()` ويطرح خطأ إذا تم انتهاكه. هذا يكرر الحماية في كلتا طبقتي واجهة المستخدم والجلسة.

## دورة الحياة من البداية إلى النهاية

### 1) بدء توليد التسليم

`AgentSession.handoff(customInstructions?)`:

- يقرأ إدخالات الفرع الحالي (`sessionManager.getBranch()`)
- يتحقق من الحد الأدنى لعدد الرسائل (`>= 2`)
- ينشئ `#handoffAbortController`
- يبني موجهاً ثابتاً ومضمناً يطلب مستند تسليم منظم (`Goal`، `Constraints & Preferences`، `Progress`، `Key Decisions`، `Critical Context`، `Next Steps`)
- يُلحق `Additional focus: ...` إذا تم توفير تعليمات مخصصة

يتم إرسال الموجه عبر:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` يمنع التوسيع عبر الشرطة المائلة/قوالب الموجهات لهذه الحمولة التعليمية الداخلية.

### 2) التقاط المخرجات

قبل إرسال الموجه، يشترك `handoff()` في أحداث الجلسة وينتظر `agent_end`.

عند `agent_end`، يستخرج نص التسليم من حالة الوكيل عن طريق المسح العكسي لأحدث رسالة `assistant`، ثم يدمج جميع كتل `content` حيث `type === "text"` باستخدام `\n`.

افتراضات الاستخراج المهمة:

- يتم استخدام كتل النص فقط؛ يتم تجاهل المحتوى غير النصي.
- يفترض أن أحدث رسالة من المساعد تتوافق مع توليد التسليم.
- لا يحلل أقسام markdown ولا يتحقق من الامتثال للتنسيق.
- إذا لم تحتوِ مخرجات المساعد على كتل نصية، يُعامَل التسليم على أنه مفقود.

### 3) فحوصات الإلغاء

يُرجع `handoff()` القيمة `undefined` عند تحقق أي من الشرطين:

- عدم وجود نص تسليم ملتقط، أو
- `#handoffAbortController.signal.aborted` يساوي true

يمسح دائماً `#handoffAbortController` في `finally`.

### 4) إنشاء جلسة جديدة

إذا تم التقاط النص ولم يتم الإلغاء:

1. مسح كاتب الجلسة الحالي (`sessionManager.flush()`)
2. بدء جلسة جديدة بالكامل (`sessionManager.newSession()`)
3. إعادة تعيين حالة الوكيل في الذاكرة (`agent.reset()`)
4. إعادة ربط `agent.sessionId` بمعرف الجلسة الجديد
5. مسح مصفوفات السياق المُنتظرة (`#steeringMessages`، `#followUpMessages`، `#pendingNextTurnMessages`)
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
- `display`: `true` (مرئي في إعادة بناء واجهة المستخدم النصية)
- نوع الإدخال: `custom_message` (يشارك في سياق نموذج اللغة الكبير)

### 6) إعادة بناء سياق الوكيل النشط

بعد الحقن:

1. `sessionManager.buildSessionContext()` يحل قائمة الرسائل للورقة الحالية
2. `agent.replaceMessages(sessionContext.messages)` يجعل رسالة التسليم المحقونة السياق النشط
3. يُرجع الأسلوب `{ document: handoffText }`

عند هذه النقطة، يحتوي سياق نموذج اللغة الكبير النشط في الجلسة الجديدة على رسالة التسليم المحقونة، وليس النسخة القديمة من المحادثة.

## نموذج الاستمرارية: الجلسة القديمة مقابل الجلسة الجديدة

### الجلسة القديمة

أثناء التوليد، تظل استمرارية الرسائل العادية نشطة. يتم حفظ استجابة التسليم من المساعد كإدخال `message` عادي عند `message_end`.

النتيجة: تحتوي الجلسة الأصلية على التسليم المُولَّد المرئي كجزء من سجل المحادثة التاريخي.

### الجلسة الجديدة

بعد إعادة تعيين الجلسة، يتم حفظ التسليم كـ `custom_message` مع `customType: "handoff"`.

`buildSessionContext()` يحول هذا الإدخال إلى رسالة سياق مخصصة/مستخدم في وقت التشغيل عبر `createCustomMessage(...)`، لذلك يتم تضمينه في الموجهات المستقبلية من الجلسة الجديدة.

## سلوك وحدة التحكم/واجهة المستخدم

سلوك `CommandController.handleHandoffCommand`:

- يستدعي `await session.handoff(customInstructions)`
- إذا كانت النتيجة `undefined`: `showError("Handoff cancelled")`
- عند النجاح:
  - `rebuildChatFromMessages()` (يحمل سياق الجلسة الجديدة، بما في ذلك التسليم المحقون)
  - يُبطل شريط الحالة والحد العلوي للمحرر
  - يعيد تحميل المهام
  - يُلحق سطر نجاح في المحادثة: `New session started with handoff context`
- عند حدوث استثناء:
  - إذا كانت الرسالة `"Handoff cancelled"` أو اسم الخطأ `AbortError`: `showError("Handoff cancelled")`
  - وإلا: `showError("Handoff failed: <message>")`
- يطلب إعادة العرض في النهاية

## دلالات الإلغاء (السلوك الحالي)

### أساسيات الإلغاء على مستوى الجلسة

يكشف `AgentSession` عن:

- `abortHandoff()` → يُلغي `#handoffAbortController`
- `isGeneratingHandoff` → true أثناء وجود وحدة التحكم

عند استخدام مسار الإلغاء هذا، يرفض مشترك التسليم بـ `Error("Handoff cancelled")`، وتربطه وحدة التحكم بالأوامر بواجهة مستخدم الإلغاء.

### قيود مسار `/handoff` التفاعلي

في التوصيل الحالي لوحدة التحكم التفاعلية، لا يقوم `/handoff` بتثبيت معالج Escape مخصص يستدعي `abortHandoff()` (على عكس مسارات الضغط/ملخص الفروع التي تتجاوز مؤقتاً `editor.onEscape`).

التأثير العملي:

- يوجد دعم للإلغاء على مستوى الجلسة، لكن لا يوجد ربط مفتاح مخصص للتسليم في مسار أمر `/handoff`.
- قد يحدث انقطاع المستخدم من خلال مسارات إلغاء الوكيل الأوسع، لكن ذلك ليس نفس قناة الإلغاء الصريحة المستخدمة بواسطة `abortHandoff()`.

## مُلغى مقابل فاشل في التسليم

تصنيف واجهة المستخدم الحالي:

- **مُلغى/ملغي**
  - مسار `abortHandoff()` يطلق `"Handoff cancelled"`، أو
  - `AbortError` مطروح
  - تعرض واجهة المستخدم `Handoff cancelled`

- **فاشل**
  - أي خطأ آخر مطروح من `handoff()` / خط أنابيب الموجهات (أخطاء التحقق من النموذج/واجهة برمجة التطبيقات، استثناءات وقت التشغيل، إلخ.)
  - تعرض واجهة المستخدم `Handoff failed: ...`

فارق إضافي دقيق: إذا اكتمل التوليد لكن لم يتم استخراج نص، يُرجع `handoff()` القيمة `undefined` وتُبلغ وحدة التحكم حالياً عن **إلغاء**، وليس **فشل**.

## حراس الجلسة القصيرة والحد الأدنى من المحتوى

يمنع حارسان التسليمات منخفضة الإشارة:

- طبقة واجهة المستخدم (`handleHandoffCommand`): تحذر وتعود مبكراً لإدخالات الرسائل `< 2`
- طبقة الجلسة (`handoff()`): تطرح نفس الشرط كخطأ

هذا يتجنب إنشاء جلسة جديدة بسياق تسليم فارغ/شبه فارغ.

## ملخص انتقال الحالة

تدفق الحالة عالي المستوى:

1. اعتراض أمر الشرطة المائلة التفاعلي
2. حارس فحص عدد الرسائل الأولي
3. إنشاء `#handoffAbortController` (`isGeneratingHandoff = true`)
4. إرسال موجه التسليم الداخلي (مرئي في المحادثة كتوليد مساعد عادي)
5. عند `agent_end`، يتم استخراج آخر نص للمساعد
6. إذا كان مفقوداً/مُلغى → إرجاع `undefined` أو مسار خطأ الإلغاء
7. إذا كان موجوداً:
   - مسح الجلسة القديمة
   - إنشاء جلسة فارغة جديدة
   - إعادة تعيين طوابير/عدادات وقت التشغيل
   - إلحاق `custom_message(handoff)`
   - إعادة بناء واستبدال رسائل الوكيل النشطة
8. تعيد وحدة التحكم بناء واجهة المحادثة وتُعلن النجاح
9. مسح `#handoffAbortController` (`isGeneratingHandoff = false`)

## الافتراضات والقيود المعروفة

- استخراج التسليم استدلالي: "آخر كتل نصية للمساعد"؛ بدون تحقق هيكلي.
- لا يوجد فحص صارم بأن markdown المُولَّد يتبع تنسيق الأقسام المطلوب.
- النص المستخرج المفقود يُبلَّغ عنه كإلغاء في تجربة مستخدم وحدة التحكم.
- مسار `/handoff` التفاعلي يفتقر حالياً إلى ربط مخصص Escape→`abortHandoff()`.
- البيانات الوصفية لسلالة الجلسة الجديدة (`parentSession`) لا يتم تعيينها بواسطة هذا المسار.
