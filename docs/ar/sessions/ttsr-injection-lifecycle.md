---
title: دورة حياة حقن TTSR
description: دورة حياة حقن TTSR (استخدام الأداة، نتيجة الأداة، تذكير النظام) لإدارة السياق.
sidebar:
  order: 9
  label: حقن TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# دورة حياة حقن TTSR

يغطي هذا المستند مسار تشغيل قواعد Time Traveling Stream Rules (TTSR) الحالي من اكتشاف القواعد إلى مقاطعة التدفق، وإعادة حقن المحاولات، وإشعارات الامتدادات، ومعالجة حالة الجلسة.

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

تقوم `loadCapability("rules")` بإزالة التكرار استناداً إلى `rule.name` باعتماد الأولوية الأولى (المزود ذو الأولوية الأعلى أولاً). تُزال التكرارات المظللة قبل تسجيل TTSR.

### سلوك `TtsrManager.addRule()`

يُتخطى التسجيل عند:

- غياب `rule.ttsrTrigger`
- وجود قاعدة بنفس `rule.name` مسجلة مسبقاً في هذا المدير
- فشل تحليل التعبير النمطي (رمي `new RegExp(rule.ttsrTrigger)` استثناءً)

تُسجَّل المشغّلات ذات التعبيرات النمطية غير الصالحة كتحذيرات ويتم تجاهلها؛ ويستمر تشغيل الجلسة.

### تحفظ الإعداد

يُحمَّل `TtsrSettings.enabled` في المدير لكنه غير مفحوص حالياً في بوابة وقت التشغيل. إذا كانت القواعد موجودة، فإن المطابقة لا تزال تعمل.

## 2. دورة حياة مراقب التدفق

يعمل كشف TTSR داخل `AgentSession.#handleAgentEvent`.

### بداية الدور

عند `turn_start`، يتم إعادة تعيين مخزن التدفق المؤقت:

- `ttsrManager.resetBuffer()`

### أثناء التدفق (`message_update`)

عند وصول تحديثات المساعد ووجود قواعد:

- مراقبة `text_delta` و`toolcall_delta`
- إضافة الدلتا إلى مخزن المدير المؤقت
- استدعاء `check(buffer)`

تكرّر `check()` القواعد المسجلة وتُعيد جميع القواعد المطابقة التي تجتاز سياسة التكرار (`#canTrigger`).

## 3. قرار التشغيل ومسار الإجهاض الفوري

عند مطابقة قاعدة واحدة أو أكثر:

1. تسجّل `markInjected(matches)` أسماء القواعد في حالة حقن المدير.
2. تُضاف القواعد المطابقة إلى قائمة انتظار `#pendingTtsrInjections`.
3. يصبح `#ttsrAbortPending = true`.
4. يُستدعى `agent.abort()` فوراً.
5. يُصدَر حدث `ttsr_triggered` بشكل غير متزامن (أطلق وانسَ).
6. يُجدوَل عمل إعادة المحاولة عبر `setTimeout(..., 50)`.

لا يُوقَف الإجهاض بانتظار استدعاءات امتداد المكونات.

## 4. جدولة إعادة المحاولة ووضع السياق وحقن التذكير

بعد مهلة 50 مللي ثانية:

1. `#ttsrAbortPending = false`
2. قراءة `ttsrManager.getSettings().contextMode`
3. إذا كانت `contextMode === "discard"`، يُسقط الخرج الجزئي للمساعد بـ `agent.popMessage()`
4. بناء محتوى الحقن من القواعد المعلقة باستخدام قالب `ttsr-interrupt.md`
5. إلحاق رسالة مستخدم اصطناعية تحتوي على كتلة `<system-interrupt ...>` واحدة لكل قاعدة
6. استدعاء `agent.continue()` لإعادة محاولة التوليد

حمولة القالب هي:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

تُمسح الحقنات المعلقة بعد توليد المحتوى.

### سلوك `contextMode` على الخرج الجزئي

- `discard`: تُزال الرسالة الجزئية/المجهضة للمساعد قبل إعادة المحاولة.
- `keep`: يبقى الخرج الجزئي للمساعد في حالة المحادثة؛ يُلحق التذكير بعده.

## 5. سياسة التكرار ومنطق الفجوة

يتتبع `TtsrManager` كلاً من `#messageCount` و`lastInjectedAt` لكل قاعدة.

### `repeatMode: "once"`

يمكن لقاعدة أن تُشغَّل مرة واحدة فقط بعد وجود سجل حقن لها.

### `repeatMode: "after-gap"`

يمكن لقاعدة إعادة التشغيل فقط عندما:

- `messageCount - lastInjectedAt >= repeatGap`

يتزايد `messageCount` عند `turn_end`، لذا تُقاس الفجوة بالدورات المكتملة وليس بمقاطع التدفق.

## 6. إصدار الأحداث وأسطح الامتدادات/الخطافات

### حدث الجلسة

يتضمن `AgentSessionEvent`:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### مشغّل الامتداد

يوجّه `#emitSessionEvent()` الحدث إلى:

- مستمعي الامتداد (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- مشتركي الجلسة المحليين

### أنواع الخطافات والأدوات المخصصة

- تكشف واجهة API للامتداد عن `on("ttsr_triggered", ...)`
- تكشف واجهة API للخطافات عن `on("ttsr_triggered", ...)`
- تستقبل الأدوات المخصصة `onSession({ reason: "ttsr_triggered", rules })`

### اختلاف العرض في الوضع التفاعلي

يستخدم الوضع التفاعلي `session.isTtsrAbortPending` لتجنب إظهار سبب إيقاف المساعد المجهض كفشل مرئي أثناء مقاطعة TTSR، ويعرض `TtsrNotificationComponent` عند وصول الحدث.

## 7. الاستمرارية وحالة الاستئناف (التنفيذ الحالي)

يمتلك `SessionManager` دعماً كاملاً للمخطط لاستمرارية القواعد المحقونة:

- نوع الإدخال: `ttsr_injection`
- واجهة API للإلحاق: `appendTtsrInjection(ruleNames)`
- واجهة API للاستعلام: `getInjectedTtsrRules()`
- يتضمن إعادة بناء السياق `SessionContext.injectedTtsrRules`

يدعم `TtsrManager` أيضاً الاستعادة عبر `restoreInjected(ruleNames)`.

### حالة التوصيل الحالية

في مسار التشغيل الحالي:

- لا تضيف `AgentSession` إدخالات `ttsr_injection` عند تشغيل TTSR.
- لا تستعيد `createAgentSession()` قيمة `existingSession.injectedTtsrRules` إلى `ttsrManager`.

الأثر الصافي: يُطبَّق قمع القواعد المحقونة في الذاكرة للعملية الحية، لكنه غير محفوظ/مستعاد حالياً عبر إعادة تحميل الجلسة/استئنافها من خلال هذا المسار.

## 8. حدود السباق وضمانات الترتيب

### الإجهاض مقابل استدعاء إعادة المحاولة

- الإجهاض متزامن من منظور معالج TTSR (`agent.abort()` يُستدعى فوراً)
- إعادة المحاولة مؤجلة بمؤقت (50 مللي ثانية)
- إشعار الامتداد غير متزامن ومتعمَّد عدم انتظاره قبل جدولة الإجهاض/إعادة المحاولة

### مطابقات متعددة في نافذة تدفق واحدة

تُعيد `check()` جميع القواعد المؤهلة المطابقة حالياً. تُحقن كدفعة واحدة في رسالة إعادة المحاولة التالية.

### بين الإجهاض والاستمرار

خلال نافذة المؤقت، يمكن أن تتغير الحالة (مقاطعة المستخدم، إجراءات الوضع، أحداث إضافية). استدعاء إعادة المحاولة هو جهد أفضل ما يمكن: `agent.continue().catch(() => {})` تستوعب الأخطاء اللاحقة.

## 9. ملخص الحالات الحدية

- تعبير نمطي `ttsr_trigger` غير صالح: يُتخطى مع تحذير؛ تستمر القواعد الأخرى.
- أسماء قواعد مكررة في طبقة القدرة: تُظلَّل التكرارات ذات الأولوية الأدنى قبل التسجيل.
- أسماء مكررة في طبقة المدير: يُتجاهل التسجيل الثاني.
- `contextMode: "keep"`: يمكن أن يبقى الخرج المنتهك الجزئي في السياق قبل إعادة محاولة التذكير.
- يعتمد التكرار بعد الفجوة على تزايد عدد الدورات عند `turn_end`؛ لا تُقدّم مقاطع منتصف الدور عدادات الفجوة.
