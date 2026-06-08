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

يغطي هذا المستند مسار التنفيذ الحالي لقواعد البث عبر الزمن (Time Traveling Stream Rules - TTSR) من اكتشاف القواعد إلى مقاطعة البث، وحقن إعادة المحاولة، وإشعارات الإضافات، ومعالجة حالة الجلسة.

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

تقوم `loadCapability("rules")` بإزالة التكرار بناءً على `rule.name` بدلالة الأول يفوز (الأولوية الأعلى للمزود أولاً). يتم إزالة النسخ المكررة المظللة قبل تسجيل TTSR.

### سلوك `TtsrManager.addRule()`

يتم تخطي التسجيل عندما:

- يكون `rule.ttsrTrigger` غائباً
- تم بالفعل تسجيل قاعدة بنفس `rule.name` في هذا المدير
- يفشل تجميع التعبير النمطي (يرمي `new RegExp(rule.ttsrTrigger)` خطأ)

يتم تسجيل محفزات التعبيرات النمطية غير الصالحة كتحذيرات ويتم تجاهلها؛ ويستمر بدء تشغيل الجلسة.

### تحفظ بشأن الإعدادات

يتم تحميل `TtsrSettings.enabled` في المدير لكنه لا يُفحص حالياً في بوابة وقت التشغيل. إذا وُجدت قواعد، يستمر التطابق بالعمل.

## 2. دورة حياة مراقب البث

يعمل اكتشاف TTSR داخل `AgentSession.#handleAgentEvent`.

### بداية الدور

عند `turn_start`، يتم إعادة تعيين ذاكرة التخزين المؤقت للبث:

- `ttsrManager.resetBuffer()`

### أثناء البث (`message_update`)

عند وصول تحديثات المساعد ووجود قواعد:

- مراقبة `text_delta` و `toolcall_delta`
- إلحاق الدلتا في ذاكرة التخزين المؤقت للمدير
- استدعاء `check(buffer)`

يتكرر `check()` عبر القواعد المسجلة ويعيد جميع القواعد المتطابقة التي تجتاز سياسة التكرار (`#canTrigger`).

## 3. قرار التحفيز ومسار الإلغاء الفوري

عند تطابق قاعدة واحدة أو أكثر:

1. يسجل `markInjected(matches)` أسماء القواعد في حالة حقن المدير.
2. توضع القواعد المتطابقة في قائمة الانتظار `#pendingTtsrInjections`.
3. يتم تعيين `#ttsrAbortPending = true`.
4. يتم استدعاء `agent.abort()` فوراً.
5. يتم إرسال حدث `ttsr_triggered` بشكل غير متزامن (أطلق وانسَ).
6. تتم جدولة عمل إعادة المحاولة عبر `setTimeout(..., 50)`.

لا يتم حظر الإلغاء بانتظار استدعاءات الإضافات.

## 4. جدولة إعادة المحاولة، وضع السياق، وحقن التذكير

بعد المهلة الزمنية البالغة 50 مللي ثانية:

1. `#ttsrAbortPending = false`
2. قراءة `ttsrManager.getSettings().contextMode`
3. إذا كان `contextMode === "discard"`، يتم حذف مخرجات المساعد الجزئية باستخدام `agent.popMessage()`
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

### سلوك `contextMode` مع المخرجات الجزئية

- `discard`: تتم إزالة رسالة المساعد الجزئية/الملغاة قبل إعادة المحاولة.
- `keep`: تبقى مخرجات المساعد الجزئية في حالة المحادثة؛ ويتم إلحاق التذكير بعدها.

## 5. سياسة التكرار ومنطق الفجوة

يتتبع `TtsrManager` عداد `#messageCount` وعداد `lastInjectedAt` لكل قاعدة.

### `repeatMode: "once"`

يمكن للقاعدة أن تتحفز مرة واحدة فقط بعد أن يكون لها سجل حقن.

### `repeatMode: "after-gap"`

يمكن للقاعدة أن تُعاد تحفيزها فقط عندما:

- `messageCount - lastInjectedAt >= repeatGap`

يزداد `messageCount` عند `turn_end`، لذا تُقاس الفجوة بالأدوار المكتملة وليس بأجزاء البث.

## 6. إرسال الأحداث وواجهات الإضافات/الخطافات

### حدث الجلسة

يتضمن `AgentSessionEvent`:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### مشغل الإضافات

يوجه `#emitSessionEvent()` الحدث إلى:

- مستمعي الإضافات (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- مشتركي الجلسة المحليين

### أنواع الخطافات والأدوات المخصصة

- تكشف واجهة برمجة الإضافات `on("ttsr_triggered", ...)`
- تكشف واجهة برمجة الخطافات `on("ttsr_triggered", ...)`
- تتلقى الأدوات المخصصة `onSession({ reason: "ttsr_triggered", rules })`

### الاختلاف في العرض بالوضع التفاعلي

يستخدم الوضع التفاعلي `session.isTtsrAbortPending` لمنع عرض سبب توقف المساعد الملغى كفشل مرئي أثناء مقاطعة TTSR، ويعرض `TtsrNotificationComponent` عند وصول الحدث.

## 7. الاستمرارية وحالة الاستئناف (التنفيذ الحالي)

يمتلك `SessionManager` دعماً كاملاً للمخطط لاستمرارية القواعد المحقونة:

- نوع الإدخال: `ttsr_injection`
- واجهة الإلحاق: `appendTtsrInjection(ruleNames)`
- واجهة الاستعلام: `getInjectedTtsrRules()`
- تتضمن إعادة بناء السياق `SessionContext.injectedTtsrRules`

يدعم `TtsrManager` أيضاً الاستعادة عبر `restoreInjected(ruleNames)`.

### حالة التوصيل الحالية

في مسار التنفيذ الحالي:

- لا يقوم `AgentSession` بإلحاق إدخالات `ttsr_injection` عند تحفيز TTSR.
- لا يقوم `createAgentSession()` باستعادة `existingSession.injectedTtsrRules` مرة أخرى إلى `ttsrManager`.

التأثير الصافي: يتم فرض كبت القواعد المحقونة في الذاكرة للعملية الحية، لكنها لا تُحفظ/تُستعاد حالياً عبر إعادة تحميل/استئناف الجلسة من خلال هذا المسار.

## 8. حدود السباق وضمانات الترتيب

### الإلغاء مقابل استدعاء إعادة المحاولة

- الإلغاء متزامن من منظور معالج TTSR (يتم استدعاء `agent.abort()` فوراً)
- إعادة المحاولة مؤجلة بمؤقت (`50ms`)
- إشعار الإضافة غير متزامن ولا يُنتظر عمداً قبل جدولة الإلغاء/إعادة المحاولة

### تطابقات متعددة في نفس نافذة البث

يعيد `check()` جميع القواعد المؤهلة المتطابقة حالياً. يتم حقنها كدفعة واحدة في رسالة إعادة المحاولة التالية.

### بين الإلغاء والاستمرار

أثناء نافذة المؤقت، يمكن أن تتغير الحالة (مقاطعة المستخدم، إجراءات الأوضاع، أحداث إضافية). استدعاء إعادة المحاولة يعمل بأفضل جهد: `agent.continue().catch(() => {})` يبتلع الأخطاء اللاحقة.

## 9. ملخص الحالات الحدية

- تعبير نمطي غير صالح في `ttsr_trigger`: يتم تخطيه مع تحذير؛ وتستمر القواعد الأخرى.
- أسماء قواعد مكررة في طبقة القدرات: يتم تظليل النسخ المكررة ذات الأولوية الأقل قبل التسجيل.
- أسماء مكررة في طبقة المدير: يتم تجاهل التسجيل الثاني.
- `contextMode: "keep"`: يمكن أن تبقى المخرجات الجزئية المنتهكة في السياق قبل إعادة محاولة التذكير.
- يعتمد التكرار بعد الفجوة على زيادات عداد الأدوار عند `turn_end`؛ ولا تُقدّم أجزاء البث في منتصف الدور عدادات الفجوة.
