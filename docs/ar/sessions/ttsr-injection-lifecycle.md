---
title: TTSR Injection Lifecycle
description: >-
  TTSR (tool-use, tool-result, system-reminder) injection lifecycle for context
  management.
sidebar:
  order: 9
  label: TTSR injection
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# دورة حياة حقن TTSR

يتناول هذا المستند المسار الحالي لتشغيل قواعد البث عبر الزمن (TTSR) من اكتشاف القواعد إلى مقاطعة البث، وحقن إعادة المحاولة، وإشعارات الإضافات، ومعالجة حالة الجلسة.

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

عند إنشاء الجلسة، تقوم `createAgentSession()` بتحميل جميع القواعد المكتشفة وإنشاء `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### سلوك إزالة التكرارات قبل التسجيل

تقوم `loadCapability("rules")` بإزالة التكرارات بناءً على `rule.name` بدلالات الأولوية للأول (الأولوية الأعلى للمزود أولاً). يتم إزالة التكرارات المحجوبة قبل تسجيل TTSR.

### سلوك `TtsrManager.addRule()`

يتم تخطي التسجيل عندما:

- يكون `rule.ttsrTrigger` غير موجود
- تكون قاعدة بنفس `rule.name` مسجلة بالفعل في هذا المدير
- يفشل تعبير regex في التجميع (يرمي `new RegExp(rule.ttsrTrigger)` خطأً)

يتم تسجيل محفزات regex غير الصالحة كتحذيرات ويتم تجاهلها؛ ويستمر بدء تشغيل الجلسة.

### تنبيه بخصوص الإعدادات

يتم تحميل `TtsrSettings.enabled` في المدير لكنه لا يُفحص حالياً في بوابة التشغيل. إذا كانت القواعد موجودة، فإن المطابقة تعمل على أي حال.

## 2. دورة حياة مراقب البث

يعمل كشف TTSR داخل `AgentSession.#handleAgentEvent`.

### بداية الدور

عند `turn_start`، يتم إعادة تعيين مخزن البث المؤقت:

- `ttsrManager.resetBuffer()`

### أثناء البث (`message_update`)

عندما تصل تحديثات المساعد وتوجد قواعد:

- مراقبة `text_delta` و `toolcall_delta`
- إلحاق الدلتا في مخزن المدير المؤقت
- استدعاء `check(buffer)`

تتكرر `check()` عبر القواعد المسجلة وتُعيد جميع القواعد المطابقة التي تجتاز سياسة التكرار (`#canTrigger`).

## 3. قرار التفعيل ومسار الإلغاء الفوري

عندما تتطابق قاعدة واحدة أو أكثر:

1. تُسجل `markInjected(matches)` أسماء القواعد في حالة حقن المدير.
2. يتم وضع القواعد المطابقة في قائمة الانتظار في `#pendingTtsrInjections`.
3. يتم تعيين `#ttsrAbortPending = true`.
4. يتم استدعاء `agent.abort()` فوراً.
5. يتم إصدار حدث `ttsr_triggered` بشكل غير متزامن (أطلق وانسَ).
6. يتم جدولة عمل إعادة المحاولة عبر `setTimeout(..., 50)`.

لا يتم حظر الإلغاء بانتظار استدعاءات الإضافات.

## 4. جدولة إعادة المحاولة، وضع السياق، وحقن التذكير

بعد انتهاء مهلة 50 مللي ثانية:

1. يتم تعيين `#ttsrAbortPending = false`
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

يتم مسح الحقنات المعلقة بعد توليد المحتوى.

### سلوك `contextMode` على المخرجات الجزئية

- `discard`: يتم إزالة رسالة المساعد الجزئية/الملغاة قبل إعادة المحاولة.
- `keep`: تبقى مخرجات المساعد الجزئية في حالة المحادثة؛ ويتم إلحاق التذكير بعدها.

## 5. سياسة التكرار ومنطق الفجوة

يتتبع `TtsrManager` قيمة `#messageCount` و `lastInjectedAt` لكل قاعدة.

### `repeatMode: "once"`

يمكن للقاعدة أن تتفعل مرة واحدة فقط بعد أن يكون لديها سجل حقن.

### `repeatMode: "after-gap"`

يمكن للقاعدة إعادة التفعيل فقط عندما:

- `messageCount - lastInjectedAt >= repeatGap`

يزداد `messageCount` عند `turn_end`، لذا تُقاس الفجوة بالأدوار المكتملة، وليس بأجزاء البث.

## 6. إصدار الأحداث وأسطح الإضافات/الخطافات

### حدث الجلسة

يتضمن `AgentSessionEvent`:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### مُشغل الإضافات

تقوم `#emitSessionEvent()` بتوجيه الحدث إلى:

- مستمعي الإضافات (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- مشتركي الجلسة المحليين

### أنواع الخطافات والأدوات المخصصة

- تعرض واجهة API للإضافات `on("ttsr_triggered", ...)`
- تعرض واجهة API للخطافات `on("ttsr_triggered", ...)`
- تتلقى الأدوات المخصصة `onSession({ reason: "ttsr_triggered", rules })`

### اختلاف العرض في الوضع التفاعلي

يستخدم الوضع التفاعلي `session.isTtsrAbortPending` لقمع إظهار سبب توقف المساعد الملغى كفشل مرئي أثناء مقاطعة TTSR، ويعرض `TtsrNotificationComponent` عند وصول الحدث.

## 7. الاستمرارية وحالة الاستئناف (التنفيذ الحالي)

يمتلك `SessionManager` دعماً كاملاً للمخطط لاستمرارية القواعد المحقونة:

- نوع الإدخال: `ttsr_injection`
- واجهة الإلحاق: `appendTtsrInjection(ruleNames)`
- واجهة الاستعلام: `getInjectedTtsrRules()`
- يتضمن إعادة بناء السياق `SessionContext.injectedTtsrRules`

يدعم `TtsrManager` أيضاً الاستعادة عبر `restoreInjected(ruleNames)`.

### حالة الربط الحالية

في مسار التشغيل الحالي:

- لا تقوم `AgentSession` بإلحاق إدخالات `ttsr_injection` عند تفعيل TTSR.
- لا تقوم `createAgentSession()` باستعادة `existingSession.injectedTtsrRules` مرة أخرى إلى `ttsrManager`.

النتيجة الصافية: يتم فرض قمع القواعد المحقونة في الذاكرة للعملية الحية، لكنها لا تُستمر/تُستعاد حالياً عبر إعادة تحميل/استئناف الجلسة من خلال هذا المسار.

## 8. حدود التسابق وضمانات الترتيب

### الإلغاء مقابل استدعاء إعادة المحاولة

- الإلغاء متزامن من منظور معالج TTSR (يتم استدعاء `agent.abort()` فوراً)
- إعادة المحاولة مؤجلة بمؤقت (`50ms`)
- إشعار الإضافات غير متزامن ولا يُنتظر عمداً قبل جدولة الإلغاء/إعادة المحاولة

### تطابقات متعددة في نفس نافذة البث

تُعيد `check()` جميع القواعد المؤهلة المطابقة حالياً. يتم حقنها كدفعة واحدة في رسالة إعادة المحاولة التالية.

### بين الإلغاء والمتابعة

خلال نافذة المؤقت، يمكن أن تتغير الحالة (مقاطعة المستخدم، إجراءات الوضع، أحداث إضافية). استدعاء إعادة المحاولة يعمل بأفضل جهد: `agent.continue().catch(() => {})` يبتلع أخطاء المتابعة.

## 9. ملخص الحالات الحدية

- تعبير `ttsr_trigger` regex غير صالح: يُتخطى مع تحذير؛ وتستمر القواعد الأخرى.
- أسماء قواعد مكررة في طبقة القدرات: يتم حجب التكرارات ذات الأولوية المنخفضة قبل التسجيل.
- أسماء مكررة في طبقة المدير: يتم تجاهل التسجيل الثاني.
- `contextMode: "keep"`: يمكن أن تبقى المخرجات الجزئية المنتهكة في السياق قبل إعادة محاولة التذكير.
- يعتمد التكرار-بعد-فجوة على زيادات عدد الأدوار عند `turn_end`؛ أجزاء البث في منتصف الدور لا تقدم عدادات الفجوة.
