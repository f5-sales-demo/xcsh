---
title: دورة حياة حقن TTSR
description: >-
  دورة حياة حقن TTSR (استخدام الأداة، نتيجة الأداة، التذكير النظامي) لإدارة
  السياق.
sidebar:
  order: 9
  label: حقن TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# دورة حياة حقن TTSR

يغطي هذا المستند المسار الحالي لوقت التشغيل الخاص بقواعد البث عبر الزمن (TTSR) بدءًا من اكتشاف القواعد وحتى مقاطعة البث، وحقن إعادة المحاولة، وإشعارات الإضافات، ومعالجة حالة الجلسة.

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

تقوم `loadCapability("rules")` بإزالة التكرار حسب `rule.name` بدلالات الأولوية للأول (المزود ذو الأولوية الأعلى أولاً). تتم إزالة النسخ المكررة المحجوبة قبل تسجيل TTSR.

### سلوك `TtsrManager.addRule()`

يتم تخطي التسجيل عندما:

- يكون `rule.ttsrTrigger` غير موجود
- تكون قاعدة بنفس `rule.name` مسجلة بالفعل في هذا المدير
- يفشل تجميع التعبير النمطي (يرمي `new RegExp(rule.ttsrTrigger)` خطأ)

يتم تسجيل محفزات التعبيرات النمطية غير الصالحة كتحذيرات ويتم تجاهلها؛ يستمر بدء الجلسة.

### تنبيه بخصوص الإعداد

يتم تحميل `TtsrSettings.enabled` في المدير ولكن لا يتم التحقق منه حالياً في بوابة وقت التشغيل. إذا كانت القواعد موجودة، فإن المطابقة تعمل على أي حال.

## 2. دورة حياة مراقبة البث

يعمل كشف TTSR داخل `AgentSession.#handleAgentEvent`.

### بداية الدور

عند `turn_start`، يتم إعادة تعيين مخزن البث المؤقت:

- `ttsrManager.resetBuffer()`

### أثناء البث (`message_update`)

عند وصول تحديثات المساعد ووجود قواعد:

- مراقبة `text_delta` و `toolcall_delta`
- إلحاق الدلتا في مخزن المدير المؤقت
- استدعاء `check(buffer)`

تكرر `check()` على القواعد المسجلة وتعيد جميع القواعد المطابقة التي تجتاز سياسة التكرار (`#canTrigger`).

## 3. قرار التحفيز ومسار الإلغاء الفوري

عندما تتطابق قاعدة واحدة أو أكثر:

1. تسجل `markInjected(matches)` أسماء القواعد في حالة حقن المدير.
2. يتم وضع القواعد المتطابقة في قائمة الانتظار `#pendingTtsrInjections`.
3. يتم تعيين `#ttsrAbortPending = true`.
4. يتم استدعاء `agent.abort()` فوراً.
5. يتم إصدار حدث `ttsr_triggered` بشكل غير متزامن (أطلق وانسَ).
6. يتم جدولة عمل إعادة المحاولة عبر `setTimeout(..., 50)`.

لا يتم حظر الإلغاء بانتظار استدعاءات الإضافات.

## 4. جدولة إعادة المحاولة، وضع السياق، وحقن التذكير

بعد مهلة الـ 50 مللي ثانية:

1. `#ttsrAbortPending = false`
2. قراءة `ttsrManager.getSettings().contextMode`
3. إذا كان `contextMode === "discard"`، يتم إسقاط مخرجات المساعد الجزئية باستخدام `agent.popMessage()`
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

يتم مسح الحقن المعلقة بعد توليد المحتوى.

### سلوك `contextMode` على المخرجات الجزئية

- `discard`: يتم إزالة رسالة المساعد الجزئية/الملغاة قبل إعادة المحاولة.
- `keep`: تبقى مخرجات المساعد الجزئية في حالة المحادثة؛ يتم إلحاق التذكير بعدها.

## 5. سياسة التكرار ومنطق الفجوة

يتتبع `TtsrManager` القيمة `#messageCount` والقيمة `lastInjectedAt` لكل قاعدة.

### `repeatMode: "once"`

يمكن للقاعدة أن تتحفز مرة واحدة فقط بعد أن يكون لها سجل حقن.

### `repeatMode: "after-gap"`

يمكن للقاعدة أن تتحفز مجدداً فقط عندما:

- `messageCount - lastInjectedAt >= repeatGap`

يزداد `messageCount` عند `turn_end`، لذا تُقاس الفجوة بالأدوار المكتملة وليس بأجزاء البث.

## 6. إصدار الأحداث وواجهات الإضافات/الخطافات

### حدث الجلسة

يتضمن `AgentSessionEvent`:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### مشغّل الإضافات

تقوم `#emitSessionEvent()` بتوجيه الحدث إلى:

- مستمعي الإضافات (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- مشتركي الجلسة المحليين

### أنواع الخطافات والأدوات المخصصة

- تعرض واجهة الإضافات البرمجية `on("ttsr_triggered", ...)`
- تعرض واجهة الخطافات البرمجية `on("ttsr_triggered", ...)`
- تستقبل الأدوات المخصصة `onSession({ reason: "ttsr_triggered", rules })`

### اختلاف العرض في الوضع التفاعلي

يستخدم الوضع التفاعلي `session.isTtsrAbortPending` لمنع عرض سبب توقف المساعد الملغي كفشل مرئي أثناء مقاطعة TTSR، ويعرض `TtsrNotificationComponent` عند وصول الحدث.

## 7. الاستمرارية وحالة الاستئناف (التنفيذ الحالي)

يمتلك `SessionManager` دعماً كاملاً للمخطط لاستمرارية القواعد المحقونة:

- نوع الإدخال: `ttsr_injection`
- واجهة الإلحاق البرمجية: `appendTtsrInjection(ruleNames)`
- واجهة الاستعلام البرمجية: `getInjectedTtsrRules()`
- إعادة بناء السياق تتضمن `SessionContext.injectedTtsrRules`

يدعم `TtsrManager` أيضاً الاستعادة عبر `restoreInjected(ruleNames)`.

### حالة التوصيل الحالية

في مسار وقت التشغيل الحالي:

- لا تقوم `AgentSession` بإلحاق إدخالات `ttsr_injection` عند تحفيز TTSR.
- لا تقوم `createAgentSession()` باستعادة `existingSession.injectedTtsrRules` مرة أخرى إلى `ttsrManager`.

التأثير الصافي: يتم فرض منع القواعد المحقونة في الذاكرة للعملية الحية، لكن لا يتم حالياً حفظها/استعادتها عبر إعادة تحميل/استئناف الجلسة من خلال هذا المسار.

## 8. حدود السباق وضمانات الترتيب

### الإلغاء مقابل استدعاء إعادة المحاولة

- الإلغاء متزامن من منظور معالج TTSR (يتم استدعاء `agent.abort()` فوراً)
- إعادة المحاولة مؤجلة بمؤقت (`50ms`)
- إشعار الإضافات غير متزامن ولا يتم انتظاره عمداً قبل جدولة الإلغاء/إعادة المحاولة

### تطابقات متعددة في نفس نافذة البث

تعيد `check()` جميع القواعد المؤهلة المتطابقة حالياً. يتم حقنها كدفعة واحدة في رسالة إعادة المحاولة التالية.

### بين الإلغاء والمتابعة

خلال نافذة المؤقت، يمكن أن تتغير الحالة (مقاطعة المستخدم، إجراءات الوضع، أحداث إضافية). استدعاء إعادة المحاولة يعمل بأفضل جهد: `agent.continue().catch(() => {})` يبتلع أخطاء المتابعة.

## 9. ملخص الحالات الحدية

- تعبير نمطي `ttsr_trigger` غير صالح: يتم تخطيه مع تحذير؛ تستمر القواعد الأخرى.
- أسماء قواعد مكررة في طبقة القدرات: يتم حجب النسخ المكررة ذات الأولوية الأقل قبل التسجيل.
- أسماء مكررة في طبقة المدير: يتم تجاهل التسجيل الثاني.
- `contextMode: "keep"`: يمكن أن تبقى المخرجات الجزئية المخالفة في السياق قبل إعادة محاولة التذكير.
- يعتمد التكرار بعد الفجوة على زيادات عدد الأدوار عند `turn_end`؛ لا تقدم أجزاء منتصف الدور عدادات الفجوة.
