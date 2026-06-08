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

يشرح هذا المستند كيفية توحيد تدفق الرموز/الأدوات في `@f5xc-salesdemos/pi-ai`، ثم نشرها عبر `@f5xc-salesdemos/pi-agent-core` وأحداث جلسة `coding-agent`.

## تدفق العملية من البداية إلى النهاية

1. `streamSimple()` (`packages/ai/src/stream.ts`) تربط الخيارات العامة وتوجهها إلى دالة تدفق المزود.
2. دوال تدفق المزودين (`anthropic.ts`، `openai-responses.ts`، `google.ts`) تحول أحداث التدفق الأصلية للمزود إلى تسلسل `AssistantMessageEvent` الموحد.
3. يقوم كل مزود بدفع الأحداث إلى `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)، الذي يخنق أحداث الدلتا ويوفر:
   - تكرار غير متزامن للتحديثات التزايدية
   - `result()` للحصول على `AssistantMessage` النهائية
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) يستهلك تلك الأحداث، ويعدل حالة المساعد أثناء التنفيذ، ويصدر أحداث `message_update` التي تحمل `assistantMessageEvent` الخام.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) يشترك في أحداث الوكيل، ويحفظ الرسائل، ويشغل خطافات الإضافات، ويطبق سلوكيات الجلسة (إعادة المحاولة، الضغط، TTSR، فحوصات إلغاء التحرير أثناء التدفق).

## عقد التدفق الموحد في `@f5xc-salesdemos/pi-ai`

جميع المزودين يصدرون نفس الشكل (`AssistantMessageEvent` في `packages/ai/src/types.ts`):

- `start`
- ثلاثيات دورة حياة كتل المحتوى:
  - النص: `text_start` → `text_delta`* → `text_end`
  - التفكير: `thinking_start` → `thinking_delta`* → `thinking_end`
  - استدعاء الأداة: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- الحدث النهائي:
  - `done` مع `reason: "stop" | "length" | "toolUse"`
  - أو `error` مع `reason: "aborted" | "error"`

ضمانات `AssistantMessageEventStream`:

- يتم حل النتيجة النهائية بواسطة الحدث النهائي (`done` أو `error`)
- يتم تجميع/خنق الدلتا (~50 مللي ثانية)
- يتم تفريغ الدلتا المخزنة مؤقتاً قبل الأحداث غير الدلتا وقبل الاكتمال

## سلوك خنق الدلتا وتوحيدها

يتعامل `AssistantMessageEventStream` مع `text_delta` و`thinking_delta` و`toolcall_delta` كأحداث قابلة للدمج:

- يتم دمج الدلتا المخزنة مؤقتاً فقط عندما يتطابق **النوع + فهرس المحتوى (contentIndex)**
- يحتفظ الدمج بأحدث لقطة `partial`
- الأحداث غير الدلتا تفرض التفريغ الفوري

هذا يُنعّم تدفقات المزودين عالية التردد لمستهلكي TUI/الأحداث، لكنه ليس ضغطاً خلفياً على المزود: المزودون لا يزالون ينتجون بأقصى سرعة، بينما يقوم التدفق المحلي بالتخزين المؤقت.

## تفاصيل توحيد المزودين

## Anthropic (`anthropic-messages`)

المصدر: `packages/ai/src/providers/anthropic.ts`

نقاط التوحيد:

- `message_start` يهيئ الاستخدام (رموز الإدخال/الإخراج/التخزين المؤقت)
- `content_block_start` يتم ربطه ببدايات النص/التفكير/استدعاء الأداة
- `content_block_delta` يربط:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` يحدث `thinkingSignature` فقط (بدون حدث)
- `content_block_stop` يصدر `*_end` المقابل
- `message_delta.stop_reason` يتم ربطه عبر `mapStopReason()`

تدفق وسيطات استدعاء الأداة:

- كل كتلة أداة تحمل `partialJson` داخلي
- كل دلتا JSON تُلحق بـ `partialJson`
- يتم إعادة تحليل `arguments` عند كل دلتا عبر `parseStreamingJson()`
- `toolcall_end` يعيد التحليل مرة أخرى، ثم يزيل `partialJson`

## OpenAI Responses (`openai-responses`)

المصدر: `packages/ai/src/providers/openai-responses.ts`

نقاط التوحيد:

- `response.output_item.added` يبدأ كتل الاستدلال/النص/استدعاء الدالة
- أحداث ملخص الاستدلال (`response.reasoning_summary_text.delta`) تصبح `thinking_delta`
- دلتا الإخراج/الرفض تصبح `text_delta`
- `response.function_call_arguments.delta` تصبح `toolcall_delta`
- `response.output_item.done` تصدر `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` تربط الحالة بسبب التوقف والاستخدام

تدفق وسيطات استدعاء الأداة:

- نفس نمط تراكم `partialJson` مثل Anthropic
- المزودون الذين يرسلون فقط `response.function_call_arguments.done` لا يزالون يملؤون الوسيطات النهائية
- يتم توحيد معرفات استدعاء الأداة كـ `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

المصدر: `packages/ai/src/providers/google.ts`

نقاط التوحيد:

- يتكرر على `candidate.content.parts`
- أجزاء النص تُقسم إلى تفكير مقابل نص بواسطة `isThinkingPart(part)`
- انتقالات الكتل تغلق الكتلة السابقة قبل بدء كتلة جديدة
- `part.functionCall` يُعامل كاستدعاء أداة مكتمل (يتم إصدار start/delta/end فوراً)
- سبب الإنهاء يُربط بواسطة `mapStopReason()` من `google-shared.ts`

تدفق وسيطات استدعاء الأداة:

- تصل وسيطات استدعاء الدالة ككائن منظم، وليس كنص JSON تزايدي
- التنفيذ يصدر `toolcall_delta` اصطناعي واحد يحتوي على `JSON.stringify(arguments)`
- لا حاجة لمحلل JSON جزئي لـ Google في هذا المسار

## تراكم واستعادة JSON الجزئي لاستدعاءات الأدوات

السلوك المشترك لـ Anthropic/OpenAI Responses يستخدم `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. محاولة `JSON.parse`
2. الرجوع إلى محلل `partial-json` للأجزاء غير المكتملة
3. إذا فشل كلاهما، إرجاع `{}`

التبعات:

- دلتا الوسيطات المشوهة أو المقطوعة لا تُعطل معالجة التدفق فوراً
- `arguments` قيد التنفيذ قد تكون مؤقتاً `{}`
- دلتا صالحة لاحقة يمكن أن تستعيد الوسيطات المنظمة لأن التحليل يُعاد عند كل إلحاق
- `toolcall_end` النهائي يقوم بمحاولة تحليل أخيرة قبل الإصدار

## أسباب التوقف مقابل أخطاء النقل/وقت التشغيل

يتم ربط أسباب توقف المزود بـ `stopReason` الموحد:

- Anthropic: `end_turn`→`stop`، `max_tokens`→`length`، `tool_use`→`toolUse`، حالات السلامة/الرفض→`error`
- OpenAI Responses: `completed`→`stop`، `incomplete`→`length`، `failed/cancelled`→`error`
- Google: `STOP`→`stop`، `MAX_TOKENS`→`length`، فئات السلامة/المحظور/استدعاء الدالة المشوه→`error`

دلالات الأخطاء مقسمة إلى مرحلتين:

1. **دلالات اكتمال النموذج** (سبب الإنهاء/الحالة المُبلغ عنها من المزود)
2. **فشل النقل/وقت التشغيل** (استثناءات الشبكة/العميل/المحلل/الإلغاء)

إذا ألقى تدفق المزود استثناءً أو أشار إلى فشل، يلتقط كل غلاف مزود ويصدر حدث `error` نهائي مع:

- `stopReason = "aborted"` عندما تكون إشارة الإلغاء مُعيَّنة
- وإلا `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## سلوك فشل تحليل القطع المشوهة / SSE

بالنسبة لمسارات المزودين هذه، يتم التعامل مع تأطير القطع/SSE بواسطة تدفقات SDK الخاصة بالبائع (Anthropic SDK، OpenAI SDK، Google SDK). هذا الكود لا ينفذ فك تشفير SSE مخصص هنا.

السلوك الملاحظ في التنفيذ الحالي:

- تحليل القطع/SSE المشوهة على مستوى SDK يظهر كاستثناء أو حدث `error` للتدفق
- غلاف المزود يحول ذلك إلى حدث `error` نهائي موحد
- لا يوجد استئناف/إعادة محاولة خاصة بالمزود داخل دالة التدفق نفسها
- إعادة المحاولات عالية المستوى تُعالج في منطق إعادة المحاولة التلقائية لـ `AgentSession` (إعادة محاولة على مستوى الرسالة، وليس إعادة تشغيل قطع التدفق)

## حدود الإلغاء

الإلغاء مُطبق بطبقات:

- طلب مزود الذكاء الاصطناعي: يتم تمرير `options.signal` إلى استدعاء تدفق عميل المزود.
- غلاف المزود: بعد حلقة التدفق، الإشارة الملغاة تفرض مسار الخطأ (`"Request was aborted"`).
- حلقة الوكيل: تتحقق من `signal.aborted` قبل معالجة كل حدث مزود ويمكنها تصنيع رسالة مساعد ملغاة من أحدث جزء جزئي.
- عناصر التحكم في الجلسة/الوكيل: `AgentSession.abort()` -> `agent.abort()` -> إلغاء متحكم الإلغاء المشترك.

إلغاء تنفيذ الأداة منفصل عن إلغاء تدفق النموذج:

- مشغلو الأدوات يستخدمون `AbortSignal.any([agentSignal, steeringAbortSignal])`
- مقاطعات التوجيه يمكن أن تلغي تنفيذ الأداة المتبقي مع الحفاظ على نتائج الأدوات المنتجة بالفعل

## حدود الضغط الخلفي

لا توجد آلية ضغط خلفي صارمة بين تدفق SDK للمزود والمستهلكين اللاحقين:

- `EventStream` يستخدم طوابير في الذاكرة بدون حد أقصى للحجم
- الخنق يقلل معدل تحديث واجهة المستخدم لكنه لا يبطئ استهلاك المزود
- إذا تأخر المستهلكون بشكل كبير، يمكن أن تنمو الأحداث المُصفوفة حتى الاكتمال

التصميم الحالي يفضل الاستجابية والترتيب البسيط على التحكم في التدفق بمخازن محدودة.

## كيف تظهر أحداث التدفق كأحداث وكيل/جلسة

`agentLoop.streamAssistantResponse()` يربط `AssistantMessageEvent` بـ `AgentEvent`:

- عند `start`: يدفع رسالة مساعد بديلة ويصدر `message_start`
- عند أحداث الكتل (`text_*`، `thinking_*`، `toolcall_*`): يحدث آخر رسالة مساعد، ويصدر `message_update` مع `assistantMessageEvent` الخام
- عند الانتهاء (`done`/`error`): يحل الرسالة النهائية من `response.result()`، ويصدر `message_end`

`AgentSession` ثم يستهلك تلك الأحداث لسلوكيات مستوى الجلسة:

- TTSR يراقب `message_update.assistantMessageEvent` لـ `text_delta` و`toolcall_delta`
- حارس التحرير أثناء التدفق يفحص `toolcall_delta`/`toolcall_end` على استدعاءات `edit` ويمكنه الإلغاء مبكراً
- الحفظ يكتب الرسائل النهائية عند `message_end`
- إعادة المحاولة التلقائية تفحص `stopReason === "error"` للمساعد بالإضافة إلى استدلالات `errorMessage`

## المسؤوليات الموحدة مقابل الخاصة بالمزود

موحدة (العقد المشترك):

- شكل الحدث (`AssistantMessageEvent`)
- استخراج النتيجة النهائية (`done`/`error`)
- قواعد خنق + دمج الدلتا
- نموذج نشر أحداث الوكيل/الجلسة

خاصة بالمزود (غير مجردة بالكامل):

- تصنيفات الأحداث الأصلية ومنطق الربط
- جداول ترجمة أسباب التوقف
- اصطلاحات معرفات استدعاء الأدوات
- دلالات كتل الاستدلال/التفكير والتوقيعات
- دلالات رموز الاستخدام وتوقيت التوفر
- قيود تحويل الرسائل لكل واجهة برمجة تطبيقات

## ملفات التنفيذ

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — توجيه المزود، ربط الخيارات، تمرير مفتاح API/الجلسة.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — طابور تدفق عام + خنق دلتا المساعد.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — تحليل JSON الجزئي لوسيطات الأدوات المتدفقة.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — ترجمة أحداث Anthropic وتراكم دلتا JSON للأدوات.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — ترجمة أحداث OpenAI Responses وربط الحالة.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — ترجمة قطع تدفق Gemini إلى كتل.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — ربط أسباب إنهاء Gemini وقواعد التحويل المشتركة.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — استهلاك تدفق المزود وربط `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — معالجة مستوى الجلسة لتحديثات التدفق والإلغاء وإعادة المحاولة والحفظ.
