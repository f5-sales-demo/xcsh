---
title: الداخليات الداخلية لتدفق الموفر
description: تنفيذ تدفق الموفر مع تحليل SSE، وعد الرموز، ومعالجة الضغط العكسي.
sidebar:
  order: 2
  label: الداخليات الداخلية للتدفق
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# الداخليات الداخلية لتدفق الموفر

يشرح هذا المستند كيفية توحيد تدفق الرموز/الأدوات في `@f5-sales-demo/pi-ai`، ثم نشره عبر أحداث جلسات `@f5-sales-demo/pi-agent-core` و`coding-agent`.

## التدفق الشامل من البداية إلى النهاية

1. تقوم `streamSimple()` (`packages/ai/src/stream.ts`) بتعيين الخيارات العامة وإرسالها إلى دالة تدفق الموفر.
2. تقوم دوال تدفق الموفر (`anthropic.ts`، `openai-responses.ts`، `google.ts`) بترجمة أحداث التدفق الأصلية للموفر إلى تسلسل `AssistantMessageEvent` الموحد.
3. يدفع كل موفر الأحداث إلى `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)، والذي يُخفف أحداث دلتا ويكشف عن:
   - التكرار غير المتزامن للتحديثات التدريجية
   - `result()` للـ `AssistantMessage` النهائي
4. تستهلك `agentLoop` (`packages/agent/src/agent-loop.ts`) تلك الأحداث، وتعدّل حالة المساعد أثناء التنفيذ، وتصدر أحداث `message_update` تحمل `assistantMessageEvent` الخام.
5. تشترك `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) في أحداث الوكيل، وتحفظ الرسائل، وتشغّل خطافات الامتداد، وتطبق سلوكيات الجلسة (إعادة المحاولة، والضغط، وTTSR، وفحوصات إلغاء التدفق أثناء التحرير).

## عقد التدفق الموحد في `@f5-sales-demo/pi-ai`

تصدر جميع الموفرين نفس الشكل (`AssistantMessageEvent` في `packages/ai/src/types.ts`):

- `start`
- ثلاثية دورة حياة كتلة المحتوى:
  - نص: `text_start` → `text_delta`* → `text_end`
  - تفكير: `thinking_start` → `thinking_delta`* → `thinking_end`
  - استدعاء أداة: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- حدث نهائي:
  - `done` مع `reason: "stop" | "length" | "toolUse"`
  - أو `error` مع `reason: "aborted" | "error"`

تضمن `AssistantMessageEventStream`:

- يتم حل النتيجة النهائية بواسطة الحدث النهائي (`done` أو `error`)
- يتم تجميع/تخفيف الدلتا (~50ms)
- يتم مسح الدلتا المؤقتة قبل الأحداث غير الدلتا وقبل الاكتمال

## سلوك تخفيف الدلتا وتنسيقها

تعامل `AssistantMessageEventStream` أحداث `text_delta` و`thinking_delta` و`toolcall_delta` كأحداث قابلة للدمج:

- يتم دمج الدلتا المؤقتة فقط عندما يتطابق **النوع + contentIndex**
- يحتفظ الدمج بأحدث لقطة `partial`
- تؤدي الأحداث غير الدلتا إلى مسح فوري

يُلطّف هذا تدفقات الموفر عالية التردد لمستهلكي TUI/الأحداث، لكنه ليس ضغطًا عكسيًا للموفر: تنتج الموفرون بأقصى سرعة، بينما يخزن التدفق المحلي مؤقتًا.

## تفاصيل توحيد الموفر

## Anthropic (`anthropic-messages`)

المصدر: `packages/ai/src/providers/anthropic.ts`

نقاط التوحيد:

- `message_start` يُهيئ الاستخدام (رموز المدخلات/المخرجات/ذاكرة التخزين المؤقت)
- `content_block_start` يُعيّن إلى بدايات النص/التفكير/استدعاء الأداة
- `content_block_delta` يُعيّن:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` يحدّث `thinkingSignature` فقط (بدون حدث)
- `content_block_stop` يصدر `*_end` المقابل
- `message_delta.stop_reason` يُعيّن عبر `mapStopReason()`

تدفق وسيطات استدعاء الأداة:

- تحمل كل كتلة أداة `partialJson` داخليًا
- تُلحق كل دلتا JSON بـ `partialJson`
- يُعاد تحليل `arguments` في كل دلتا عبر `parseStreamingJson()`
- يُعيد `toolcall_end` التحليل مرة أخرى، ثم يُجرّد `partialJson`

## OpenAI Responses (`openai-responses`)

المصدر: `packages/ai/src/providers/openai-responses.ts`

نقاط التوحيد:

- `response.output_item.added` يبدأ كتل التفكير/النص/استدعاء الدالة
- أحداث ملخص التفكير (`response.reasoning_summary_text.delta`) تصبح `thinking_delta`
- دلتا المخرجات/الرفض تصبح `text_delta`
- `response.function_call_arguments.delta` يصبح `toolcall_delta`
- `response.output_item.done` يصدر `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` يُعيّن الحالة إلى سبب الإيقاف والاستخدام

تدفق وسيطات استدعاء الأداة:

- نفس نمط تراكم `partialJson` كـ Anthropic
- الموفرون الذين يرسلون فقط `response.function_call_arguments.done` يملؤون الوسيطات النهائية أيضًا
- يتم توحيد معرّفات استدعاء الأداة كـ `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

المصدر: `packages/ai/src/providers/google.ts`

نقاط التوحيد:

- يتكرر على `candidate.content.parts`
- تُقسّم أجزاء النص إلى تفكير مقابل نص عبر `isThinkingPart(part)`
- تؤدي انتقالات الكتلة إلى إغلاق الكتلة السابقة قبل بدء كتلة جديدة
- يُعامَل `part.functionCall` كاستدعاء أداة كامل (يُصدر البدء/الدلتا/النهاية فورًا)
- يُعيّن سبب الإنهاء عبر `mapStopReason()` من `google-shared.ts`

تدفق وسيطات استدعاء الأداة:

- تصل وسيطات استدعاء الدالة ككائن منظم، وليس نصًا JSON تدريجيًا
- يصدر التنفيذ `toolcall_delta` اصطناعيًا واحدًا يحتوي على `JSON.stringify(arguments)`
- لا يلزم محلل JSON جزئي لـ Google في هذا المسار

## تراكم JSON لاستدعاء الأداة الجزئي واستعادته

يستخدم السلوك المشترك لـ Anthropic/OpenAI Responses دالة `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. محاولة `JSON.parse`
2. الرجوع إلى محلل `partial-json` للأجزاء غير المكتملة
3. إرجاع `{}` إذا فشل كلاهما

التداعيات:

- لا تؤدي دلتا الوسيطات المشوهة أو المبتورة إلى تعطل معالجة التدفق فورًا
- قد تكون `arguments` قيد التقدم مؤقتًا `{}`
- يمكن لدلتا صالحة لاحقة استعادة الوسيطات المنظمة لأن التحليل يُعاد في كل إلحاق
- يُجري `toolcall_end` محاولة تحليل أخيرة قبل الإصدار

## أسباب الإيقاف مقابل أخطاء النقل/وقت التشغيل

يتم تعيين أسباب إيقاف الموفر إلى `stopReason` الموحد:

- Anthropic: `end_turn`→`stop`، `max_tokens`→`length`، `tool_use`→`toolUse`، حالات الأمان/الرفض→`error`
- OpenAI Responses: `completed`→`stop`، `incomplete`→`length`، `failed/cancelled`→`error`
- Google: `STOP`→`stop`، `MAX_TOKENS`→`length`، فئات الأمان/المحظور/استدعاء الدالة المشوه→`error`

تنقسم دلالات الأخطاء إلى مرحلتين:

1. **دلالات اكتمال النموذج** (سبب الإنهاء/الحالة التي أبلغ عنها الموفر)
2. **فشل النقل/وقت التشغيل** (استثناءات الشبكة/العميل/المحلل/الإلغاء)

إذا طرح تدفق الموفر استثناءً أو أشار إلى فشل، يلتقط كل غلاف موفر ويصدر حدث `error` نهائيًا بـ:

- `stopReason = "aborted"` عندما يكون إشارة الإلغاء مُعيَّنة
- وإلا `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## سلوك فشل تحليل القطعة/SSE المشوهة

في مسارات الموفر هذه، يتولى معالجة إطار القطعة/SSE حزم SDK الخاصة بالبائع (Anthropic SDK، OpenAI SDK، Google SDK). لا يُنفّذ هذا الكود محللًا مخصصًا لـ SSE هنا.

السلوك الملاحظ في التنفيذ الحالي:

- يظهر فشل تحليل القطعة/SSE على مستوى SDK كاستثناء أو حدث `error` للتدفق
- يحوّل غلاف الموفر ذلك إلى حدث `error` نهائي موحد
- لا توجد استئناف/إعادة محاولة خاصة بالموفر داخل دالة التدفق نفسها
- تُعالج إعادة المحاولة على مستوى أعلى في منطق الإعادة التلقائية لـ `AgentSession` (إعادة محاولة على مستوى الرسالة، وليس إعادة تشغيل قطعة التدفق)

## حدود الإلغاء

يتم تنظيم الإلغاء على طبقات:

- طلب موفر الذكاء الاصطناعي: يتم تمرير `options.signal` إلى استدعاء تدفق عميل الموفر.
- غلاف الموفر: بعد حلقة التدفق، تفرض الإشارة الملغاة مسار الخطأ (`"Request was aborted"`).
- حلقة الوكيل: تتحقق من `signal.aborted` قبل معالجة كل حدث موفر ويمكنها تكوين رسالة مساعد ملغاة من آخر جزء.
- عناصر تحكم الجلسة/الوكيل: `AgentSession.abort()` -> `agent.abort()` -> إلغاء وحدة التحكم المشتركة في الإلغاء.

إلغاء تنفيذ الأداة منفصل عن إلغاء تدفق النموذج:

- تستخدم مشغّلات الأداة `AbortSignal.any([agentSignal, steeringAbortSignal])`
- يمكن لانقطاعات التوجيه إلغاء تنفيذ الأداة المتبقي مع الحفاظ على نتائج الأدوات التي تم إنتاجها بالفعل

## حدود الضغط العكسي

لا يوجد آلية ضغط عكسي صارمة بين تدفق SDK للموفر والمستهلكين في المصب:

- تستخدم `EventStream` طوابير في الذاكرة بدون حجم أقصى
- يقلل التخفيف من معدل تحديث واجهة المستخدم لكنه لا يُبطئ استيعاب الموفر
- إذا تأخر المستهلكون بشكل كبير، يمكن أن تنمو الأحداث المُخزَّنة في الطابور حتى الاكتمال

يُفضّل التصميم الحالي الاستجابة وبساطة الترتيب على التحكم في التدفق ذي المخزن المؤقت المحدود.

## كيف تظهر أحداث التدفق كأحداث وكيل/جلسة

تربط `agentLoop.streamAssistantResponse()` بين `AssistantMessageEvent` و`AgentEvent`:

- عند `start`: تدفع رسالة مساعد مؤقتة وتصدر `message_start`
- عند أحداث الكتلة (`text_*`، `thinking_*`، `toolcall_*`): تحدّث آخر رسالة مساعد، وتصدر `message_update` مع `assistantMessageEvent` الخام
- عند النهاية (`done`/`error`): تحل الرسالة النهائية من `response.result()`، وتصدر `message_end`

تستهلك `AgentSession` بعدها تلك الأحداث للسلوكيات على مستوى الجلسة:

- يراقب TTSR أحداث `message_update.assistantMessageEvent` لـ `text_delta` و`toolcall_delta`
- يفحص حارس التحرير المتدفق أحداث `toolcall_delta`/`toolcall_end` على استدعاءات `edit` ويمكنه الإلغاء مبكرًا
- تكتب آلية الحفظ الرسائل النهائية عند `message_end`
- تفحص إعادة المحاولة التلقائية `stopReason === "error"` للمساعد إضافة إلى تدقيق `errorMessage`

## المسؤوليات الموحدة مقابل الخاصة بالموفر

الموحدة (العقد المشترك):

- شكل الحدث (`AssistantMessageEvent`)
- استخراج النتيجة النهائية (`done`/`error`)
- قواعد تخفيف الدلتا ودمجها
- نموذج نشر أحداث الوكيل/الجلسة

الخاصة بالموفر (غير مجرَّدة بالكامل):

- تصنيفات الأحداث الأولية ومنطق التعيين
- جداول ترجمة سبب الإيقاف
- اصطلاحات معرّف استدعاء الأداة
- دلالات كتلة التفكير/الاستدلال وتوقيعاتها
- دلالات رموز الاستخدام وتوقيت توافرها
- قيود تحويل الرسائل لكل API

## ملفات التنفيذ

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — إرسال الموفر، وتعيين الخيارات، وتوصيل مفتاح API/الجلسة.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — طابور التدفق العام + تخفيف دلتا المساعد.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — تحليل JSON الجزئي لوسيطات الأداة المتدفقة.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — ترجمة أحداث Anthropic وتراكم دلتا JSON للأداة.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — ترجمة أحداث OpenAI Responses وتعيين الحالة.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — ترجمة قطعة تدفق Gemini إلى كتلة.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — تعيين سبب إنهاء Gemini وقواعد التحويل المشتركة.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — استهلاك تدفق الموفر وتجسير `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — معالجة تحديثات التدفق على مستوى الجلسة، والإلغاء، وإعادة المحاولة، والحفظ.
