---
title: دورة حياة حقن TTSR
description: >-
  دورة حياة حقن TTSR (استخدام الأداة، ونتيجة الأداة، وتذكير النظام) لإدارة
  السياق.
sidebar:
  order: 9
  label: حقن TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# دورة حياة حقن TTSR

تغطي هذه الوثيقة مسار تشغيل Time Traveling Stream Rules (TTSR) الحالي بدءًا من اكتشاف القواعد وصولًا إلى مقاطعة التدفق، وحقن إعادة المحاولة، وإشعارات الامتداد، ومعالجة حالة الجلسة.

## ملفات التنفيذ

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. تغذية الاكتشاف وتسجيل القواعد

عند إنشاء الجلسة، تقوم `createAgentSession()` بتحميل جميع القواعد المكتشفة وبناء `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### سلوك إزالة التكرار قبل التسجيل

تُزيل `loadCapability("rules")` التكرارات استنادًا إلى `rule.name` مع منطق "الأول يفوز" (بأولوية مزود أعلى أولًا). تُحذف التكرارات المظللة قبل تسجيل TTSR.

### سلوك `TtsrManager.addRule()`

يُتخطى التسجيل عند:

- غياب `rule.ttsrTrigger`
- وجود قاعدة بالاسم `rule.name` نفسه مسجلة بالفعل في هذا المدير
- فشل تجميع التعبير النمطي (إلقاء `new RegExp(rule.ttsrTrigger)`)

تُسجَّل محفزات التعبير النمطي غير الصالحة كتحذيرات وتُتجاهل؛ ويستمر بدء تشغيل الجلسة.

### تحفظ الإعدادات

يُحمَّل `TtsrSettings.enabled` في المدير لكنه لا يُفحص حاليًا في بوابة وقت التشغيل. إذا كانت هناك قواعد، تستمر عملية المطابقة.

## 2. دورة حياة مراقب التدفق

يعمل اكتشاف TTSR داخل `AgentSession.#handleAgentEvent`.

### بداية الدور

عند `turn_start`، تُعاد تهيئة مؤقت التدفق:

- `ttsrManager.resetBuffer()`

### أثناء التدفق (`message_update`)

عند وصول تحديثات المساعد وعند وجود قواعد:

- مراقبة `text_delta` و`toolcall_delta`
- إلحاق الدلتا بمؤقت المدير
- استدعاء `check(buffer)`

تُكرر `check()` على القواعد المسجلة وتُعيد جميع القواعد المطابقة التي تجتاز سياسة التكرار (`#canTrigger`).

## 3. قرار التفعيل ومسار الإيقاف الفوري

عند تطابق قاعدة واحدة أو أكثر:

1. تُسجّل `markInjected(matches)` أسماء القواعد في حالة الحقن بالمدير.
2. تُضاف القواعد المطابقة إلى قائمة انتظار `#pendingTtsrInjections`.
3. يُعيَّن `#ttsrAbortPending = true`.
4. يُستدعى `agent.abort()` فورًا.
5. يُصدَر حدث `ttsr_triggered` بشكل غير متزامن (fire-and-forget).
6. يُجدوَل عمل إعادة المحاولة عبر `setTimeout(..., 50)`.

لا يُعلَّق الإيقاف على انتظار استدعاءات الامتداد.

## 4. جدولة إعادة المحاولة، ووضع السياق، وحقن التذكير

بعد مهلة 50 مللي ثانية:

1. `#ttsrAbortPending = false`
2. قراءة `ttsrManager.getSettings().contextMode`
3. إذا كان `contextMode === "discard"`، يُحذف الإخراج الجزئي للمساعد باستخدام `agent.popMessage()`
4. بناء محتوى الحقن من القواعد المعلقة باستخدام قالب `ttsr-interrupt.md`
5. إلحاق رسالة مستخدم اصطناعية تحتوي على كتلة `<system-interrupt ...>` واحدة لكل قاعدة
6. استدعاء `agent.continue()` لإعادة محاولة التوليد

تُمسح الحقنات المعلقة بعد توليد المحتوى.

### سلوك `contextMode` على الإخراج الجزئي

- `discard`: تُحذف رسالة المساعد الجزئية/المجهضة قبل إعادة المحاولة.
- `keep`: يبقى الإخراج الجزئي للمساعد في حالة المحادثة؛ ويُلحق التذكير بعده.

## 5. سياسة التكرار ومنطق الفجوة

يتتبع `TtsrManager` كلًّا من `#messageCount` و`lastInjectedAt` لكل قاعدة.

### `repeatMode: "once"`

يمكن لقاعدة ما أن تُفعَّل مرة واحدة فقط بعد أن تمتلك سجل حقن.

### `repeatMode: "after-gap"`

يمكن لقاعدة ما إعادة التفعيل فقط عندما:

- `messageCount - lastInjectedAt >= repeatGap`

يتزايد `messageCount` عند `turn_end`، لذا تُقاس الفجوة بعدد الأدوار المكتملة، لا بأجزاء التدفق.

## 6. إصدار الأحداث وسطوح الامتداد/الخطاف

### حدث الجلسة

يتضمن `AgentSessionEvent`:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### مشغّل الامتداد

تُوجّه `#emitSessionEvent()` الحدث إلى:

- مستمعي الامتداد (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- المشتركين المحليين في الجلسة

### كتابة الخطاف والأداة المخصصة

- تعرض واجهة API للامتداد `on("ttsr_triggered", ...)`
- تعرض واجهة API للخطاف `on("ttsr_triggered", ...)`
- تتلقى الأدوات المخصصة `onSession({ reason: "ttsr_triggered", rules })`

### الفارق في العرض للوضع التفاعلي

يستخدم الوضع التفاعلي `session.isTtsrAbortPending` لتجنب عرض سبب إيقاف المساعد المجهض بوصفه فشلًا مرئيًا أثناء مقاطعة TTSR، ويعرض `TtsrNotificationComponent` عند وصول الحدث.

## 7. الاستمرارية وحالة الاستئناف (التنفيذ الحالي)

يمتلك `SessionManager` دعمًا كاملًا للمخطط من أجل استمرارية القواعد المحقونة:

- نوع الإدخال: `ttsr_injection`
- واجهة API للإلحاق: `appendTtsrInjection(ruleNames)`
- واجهة API للاستعلام: `getInjectedTtsrRules()`
- يتضمن إعادة بناء السياق `SessionContext.injectedTtsrRules`

يدعم `TtsrManager` أيضًا الاستعادة عبر `restoreInjected(ruleNames)`.

### حالة التوصيل الحالية

في مسار وقت التشغيل الحالي:

- لا تُلحق `AgentSession` إدخالات `ttsr_injection` عند تفعيل TTSR.
- لا تستعيد `createAgentSession()` `existingSession.injectedTtsrRules` في `ttsrManager`.

الأثر الصافي: يُطبَّق قمع القواعد المحقونة في الذاكرة للعملية الحية، لكنه لا يُستمر/يُستعاد حاليًا عبر إعادة تحميل/استئناف الجلسة بهذا المسار.

## 8. حدود السباق وضمانات الترتيب

### الإيقاف مقابل استدعاء إعادة المحاولة

- الإيقاف متزامن من منظور معالج TTSR (استدعاء `agent.abort()` فوريًا)
- إعادة المحاولة مؤجلة بمؤقت (`50ms`)
- إشعار الامتداد غير متزامن وغير منتظَر عمدًا قبل جدولة الإيقاف/إعادة المحاولة

### تطابقات متعددة في نافذة التدفق نفسها

تُعيد `check()` جميع القواعد المؤهلة المطابقة حاليًا. تُحقن في دفعة واحدة في رسالة إعادة المحاولة التالية.

### بين الإيقاف والاستمرار

خلال نافذة المؤقت، قد تتغير الحالة (مقاطعة المستخدم، إجراءات الوضع، أحداث إضافية). استدعاء إعادة المحاولة هو بذل أفضل جهد: `agent.continue().catch(() => {})` يبتلع الأخطاء التالية.

## 9. ملخص الحالات الحافة

- تعبير نمطي غير صالح لـ `ttsr_trigger`: يُتخطى مع تحذير؛ وتستمر القواعد الأخرى.
- أسماء قواعد مكررة في طبقة القدرات: تُظلل التكرارات ذات الأولوية الأدنى قبل التسجيل.
- أسماء مكررة في طبقة المدير: يُتجاهل التسجيل الثاني.
- `contextMode: "keep"`: قد يبقى الإخراج الجزئي المنتهك للقاعدة في السياق قبل إعادة محاولة التذكير.
- يعتمد `repeat-after-gap` على تزايدات عدد الأدوار عند `turn_end`؛ أجزاء منتصف الدور لا تُقدّم عدادات الفجوة.
