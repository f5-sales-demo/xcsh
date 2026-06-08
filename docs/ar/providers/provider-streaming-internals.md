---
title: Provider Streaming Internals
description: >-
  Provider streaming implementation with SSE parsing, token counting, and
  backpressure handling.
sidebar:
  order: 2
  label: البنية الداخلية للتدفق
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# البنية الداخلية لتدفق المزودين

يشرح هذا المستند كيفية تطبيع تدفق الرموز/الأدوات في `@f5xc-salesdemos/pi-ai`، ثم نشرها عبر `@f5xc-salesdemos/pi-agent-core` وأحداث جلسة `coding-agent`.

## التدفق من البداية إلى النهاية

1. `streamSimple()` (`packages/ai/src/stream.ts`) تربط الخيارات العامة وترسلها إلى دالة تدفق المزود.
2. دوال تدفق المزودين (`anthropic.ts`، `openai-responses.ts`، `google.ts`) تترجم أحداث التدفق الأصلية للمزود إلى تسلسل `AssistantMessageEvent` الموحد.
3. يدفع كل مزود الأحداث إلى `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)، الذي يخنق أحداث الدلتا ويكشف عن:
   - التكرار غير المتزامن للتحديثات التدريجية
   - `result()` للحصول على `AssistantMessage` النهائية
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) يستهلك تلك الأحداث، ويعدل حالة المساعد أثناء التنفيذ، ويصدر أحداث `message_update` التي تحمل `assistantMessageEvent` الخام.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) يشترك في أحداث الوكيل، ويحفظ الرسائل، ويشغل خطافات الإضافات، ويطبق سلوكيات الجلسة (إعادة المحاولة، الضغط، TTSR، فحوصات إلغاء التحرير أثناء التدفق).

## عقد التدفق الموحد في `@f5xc-salesdemos/pi-ai`

تصدر جميع المزودين نفس الشكل (`AssistantMessageEvent` في `packages/ai/src/types.ts`):

- `start`
- ثلاثيات دورة حياة كتلة المحتوى:
  - نص: `text_start` → `text_delta`* → `text_end`
  - تفكير: `thinking_start` → `thinking_delta`* → `thinking_end`
  - استدعاء أداة: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- حدث نهائي:
  - `done` مع `reason: "stop" | "length" | "toolUse"`
  - أو `error` مع `reason: "aborted" | "error"`

يضمن `AssistantMessageEventStream`:

- يتم حل النتيجة النهائية بواسطة الحدث النهائي (`done` أو `error`)
- يتم تجميع/خنق الدلتا (~50 مللي ثانية)
- يتم تفريغ الدلتا المخزنة مؤقتاً قبل الأحداث غير الدلتا وقبل الاكتمال

## سلوك خنق الدلتا والمواءمة

يعامل `AssistantMessageEventStream` كلاً من `text_delta` و`thinking_delta` و`toolcall_delta` كأحداث قابلة للدمج:

- يتم دمج الدلتا المخزنة مؤقتاً فقط عندما يتطابق **النوع + مؤشر المحتوى**
- يحتفظ الدمج بأحدث لقطة `partial`
- تفرض الأحداث غير الدلتا تفريغاً فورياً

هذا يعمل على تنعيم تدفقات المزودين عالية التردد لمستهلكي واجهة المستخدم النصية/الأحداث، لكنه ليس ضغطاً عكسياً للمزود: لا يزال المزودون ينتجون بأقصى سرعة، بينما يخزن التدفق المحلي مؤقتاً.

## تفاصيل تطبيع المزودين

## Anthropic (`anthropic-messages`)

المصدر: `packages/ai/src/providers/anthropic.ts`

نقاط التطبيع:

- `message_start` يهيئ الاستخدام (رموز الإدخال/الإخراج/ذاكرة التخزين المؤقت)
- `content_block_start` يُربط ببدايات النص/التفكير/استدعاء الأداة
- `content_block_delta` يُربط:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` يحدث `thinkingSignature` فقط (بدون حدث)
- `content_block_stop` يصدر `*_end` المقابل
- `message_delta.stop_reason` يُربط عبر `mapStopReason()`

تدفق وسيطات استدعاء الأداة:

- تحمل كل كتلة أداة `partialJson` داخلي
- كل دلتا JSON تُلحق بـ `partialJson`
- يتم إعادة تحليل `arguments` عند كل دلتا عبر `parseStreamingJson()`
- `toolcall_end` يعيد التحليل مرة أخرى، ثم يزيل `partialJson`

## OpenAI Responses (`openai-responses`)

المصدر: `packages/ai/src/providers/openai-responses.ts`

نقاط التطبيع:

- `response.output_item.added` يبدأ كتل الاستدلال/النص/استدعاء الدالة
- أحداث ملخص الاستدلال (`response.reasoning_summary_text.delta`) تصبح `thinking_delta`
- دلتا الإخراج/الرفض تصبح `text_delta`
- `response.function_call_arguments.delta` يصبح `toolcall_delta`
- `response.output_item.done` يصدر `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` يربط الحالة بسبب التوقف والاستخدام

تدفق وسيطات استدعاء الأداة:

- نفس نمط تراكم `partialJson` كما في Anthropic
- المزودون الذين يرسلون فقط `response.function_call_arguments.done` لا يزالون يملؤون الوسيطات النهائية
- يتم تطبيع معرفات استدعاء الأداة كـ `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

المصدر: `packages/ai/src/providers/google.ts`

نقاط التطبيع:

- يتكرر عبر `candidate.content.parts`
- يتم تقسيم أجزاء النص إلى تفكير مقابل نص بواسطة `isThinkingPart(part)`
- انتقالات الكتل تغلق الكتلة السابقة قبل بدء كتلة جديدة
- `part.functionCall` يُعامل كاستدعاء أداة كامل (يتم إصدار start/delta/end فوراً)
- يُربط سبب الانتهاء بواسطة `mapStopReason()` من `google-shared.ts`

تدفق وسيطات استدعاء الأداة:

- تصل وسيطات استدعاء الدالة ككائن منظم، وليس كنص JSON تدريجي
- ينفذ التطبيق إصدار `toolcall_delta` اصطناعي واحد يحتوي على `JSON.stringify(arguments)`
- لا حاجة لمحلل JSON جزئي لـ Google في هذا المسار

## تراكم واستعادة JSON الجزئي لاستدعاء الأداة

يستخدم السلوك المشترك لـ Anthropic/OpenAI Responses دالة `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. محاولة `JSON.parse`
2. الرجوع إلى محلل `partial-json` للأجزاء غير المكتملة
3. إذا فشل كلاهما، إرجاع `{}`

الآثار المترتبة:

- لا تتسبب دلتا الوسيطات المشوهة أو المبتورة في تعطل معالجة التدفق فوراً
- قد تكون `arguments` قيد التنفيذ مؤقتاً `{}`
- يمكن لدلتا صالحة لاحقة استعادة الوسيطات المنظمة لأن التحليل يُعاد محاولته عند كل إلحاق
- يقوم `toolcall_end` بمحاولة تحليل أخيرة قبل الإصدار

## أسباب التوقف مقابل أخطاء النقل/وقت التشغيل

يتم ربط أسباب توقف المزود بـ `stopReason` الموحد:

- Anthropic: `end_turn`→`stop`، `max_tokens`→`length`، `tool_use`→`toolUse`، حالات الأمان/الرفض→`error`
- OpenAI Responses: `completed`→`stop`، `incomplete`→`length`، `failed/cancelled`→`error`
- Google: `STOP`→`stop`، `MAX_TOKENS`→`length`، فئات الأمان/المحظور/استدعاء الدالة المشوه→`error`

تنقسم دلالات الأخطاء إلى مرحلتين:

1. **دلالات اكتمال النموذج** (سبب الانتهاء/الحالة التي أبلغ عنها المزود)
2. **فشل النقل/وقت التشغيل** (استثناءات الشبكة/العميل/المحلل/الإلغاء)

إذا أطلق تدفق المزود استثناءً أو أشار إلى فشل، يلتقط كل غلاف مزود ويصدر حدث `error` نهائي مع:

- `stopReason = "aborted"` عند تعيين إشارة الإلغاء
- وإلا `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## سلوك فشل تحليل القطع / SSE المشوهة

بالنسبة لمسارات المزودين هذه، يتم التعامل مع تأطير القطع/SSE بواسطة تدفقات SDK الخاصة بالمورد (Anthropic SDK، OpenAI SDK، Google SDK). لا ينفذ هذا الكود مفكك تشفير SSE مخصص هنا.

السلوك الملاحظ في التنفيذ الحالي:

- يظهر تحليل القطع/SSE المشوهة على مستوى SDK كاستثناء أو حدث `error` للتدفق
- يحول غلاف المزود ذلك إلى حدث `error` نهائي موحد
- لا يوجد استئناف/إعادة محاولة خاصة بالمزود داخل دالة التدفق نفسها
- يتم التعامل مع إعادة المحاولات عالية المستوى في منطق إعادة المحاولة التلقائي لـ `AgentSession` (إعادة محاولة على مستوى الرسالة، وليس إعادة تشغيل قطعة التدفق)

## حدود الإلغاء

الإلغاء متعدد الطبقات:

- طلب مزود الذكاء الاصطناعي: يتم تمرير `options.signal` إلى استدعاء تدفق عميل المزود.
- غلاف المزود: بعد حلقة التدفق، تفرض إشارة الإلغاء المفعلة مسار الخطأ (`"Request was aborted"`).
- حلقة الوكيل: تتحقق من `signal.aborted` قبل معالجة كل حدث مزود ويمكنها تجميع رسالة مساعد ملغاة من أحدث جزء.
- ضوابط الجلسة/الوكيل: `AgentSession.abort()` -> `agent.abort()` -> إلغاء وحدة التحكم في الإلغاء المشتركة.

إلغاء تنفيذ الأداة منفصل عن إلغاء تدفق النموذج:

- تستخدم مشغلات الأدوات `AbortSignal.any([agentSignal, steeringAbortSignal])`
- يمكن لمقاطعات التوجيه إلغاء تنفيذ الأداة المتبقي مع الحفاظ على نتائج الأداة المنتجة بالفعل

## حدود الضغط العكسي

لا توجد آلية ضغط عكسي صارمة بين تدفق SDK الخاص بالمزود والمستهلكين المصب:

- يستخدم `EventStream` طوابير في الذاكرة بدون حجم أقصى
- يقلل الخنق من معدل تحديث واجهة المستخدم لكنه لا يبطئ استقبال المزود
- إذا تأخر المستهلكون بشكل كبير، يمكن أن تنمو الأحداث المتراكمة حتى الاكتمال

يفضل التصميم الحالي الاستجابة والترتيب البسيط على التحكم في التدفق بمخزن مؤقت محدود.

## كيف تظهر أحداث التدفق كأحداث وكيل/جلسة

`agentLoop.streamAssistantResponse()` يربط `AssistantMessageEvent` بـ `AgentEvent`:

- عند `start`: يدفع رسالة مساعد مؤقتة ويصدر `message_start`
- عند أحداث الكتل (`text_*`، `thinking_*`، `toolcall_*`): يحدث آخر رسالة مساعد، يصدر `message_update` مع `assistantMessageEvent` الخام
- عند الحدث النهائي (`done`/`error`): يحل الرسالة النهائية من `response.result()`، يصدر `message_end`

ثم يستهلك `AgentSession` تلك الأحداث لسلوكيات مستوى الجلسة:

- يراقب TTSR `message_update.assistantMessageEvent` لـ `text_delta` و`toolcall_delta`
- يفحص حارس التحرير أثناء التدفق `toolcall_delta`/`toolcall_end` عند استدعاءات `edit` ويمكنه الإلغاء مبكراً
- تكتب الاستمرارية الرسائل النهائية عند `message_end`
- تفحص إعادة المحاولة التلقائية `stopReason === "error"` للمساعد بالإضافة إلى استدلالات `errorMessage`

## المسؤوليات الموحدة مقابل الخاصة بالمزود

موحدة (العقد المشترك):

- شكل الحدث (`AssistantMessageEvent`)
- استخراج النتيجة النهائية (`done`/`error`)
- قواعد خنق ودمج الدلتا
- نموذج نشر أحداث الوكيل/الجلسة

خاصة بالمزود (غير مجردة بالكامل):

- تصنيفات الأحداث الأولية ومنطق الربط
- جداول ترجمة أسباب التوقف
- اصطلاحات معرف استدعاء الأداة
- دلالات وتوقيعات كتل الاستدلال/التفكير
- دلالات رموز الاستخدام وتوقيت توفرها
- قيود تحويل الرسائل لكل واجهة برمجة تطبيقات

## ملفات التنفيذ

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — إرسال المزود، ربط الخيارات، توصيل مفتاح API/الجلسة.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — طابور تدفق عام + خنق دلتا المساعد.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — تحليل JSON الجزئي لوسيطات الأدوات المتدفقة.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — ترجمة أحداث Anthropic وتراكم دلتا JSON للأدوات.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — ترجمة أحداث OpenAI Responses وربط الحالة.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — ترجمة قطع تدفق Gemini إلى كتل.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — ربط سبب انتهاء Gemini وقواعد التحويل المشتركة.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — استهلاك تدفق المزود وربط `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — معالجة تحديثات التدفق على مستوى الجلسة، الإلغاء، إعادة المحاولة، والاستمرارية.
