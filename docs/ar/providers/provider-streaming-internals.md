---
title: البنية الداخلية لتدفق المزودين
description: تنفيذ تدفق المزودين مع تحليل SSE وعد الرموز ومعالجة الضغط العكسي.
sidebar:
  order: 2
  label: البنية الداخلية للتدفق
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# البنية الداخلية لتدفق المزودين

يشرح هذا المستند كيفية توحيد تدفق الرموز/الأدوات في `@f5xc-salesdemos/pi-ai`، ثم نشره عبر `@f5xc-salesdemos/pi-agent-core` وأحداث جلسة `coding-agent`.

## التدفق من البداية إلى النهاية

1. `streamSimple()` (`packages/ai/src/stream.ts`) يربط الخيارات العامة ويوجه إلى دالة تدفق المزود.
2. دوال تدفق المزودين (`anthropic.ts`، `openai-responses.ts`، `google.ts`) تترجم أحداث التدفق الأصلية للمزود إلى تسلسل `AssistantMessageEvent` الموحد.
3. يدفع كل مزود الأحداث إلى `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)، الذي يخنق أحداث الدلتا ويكشف عن:
   - تكرار غير متزامن للتحديثات التدريجية
   - `result()` للحصول على `AssistantMessage` النهائي
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) يستهلك تلك الأحداث، ويعدّل حالة المساعد أثناء التشغيل، ويصدر أحداث `message_update` التي تحمل `assistantMessageEvent` الخام.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) يشترك في أحداث الوكيل، ويحفظ الرسائل، ويدير خطافات الإضافات، ويطبق سلوكيات الجلسة (إعادة المحاولة، الضغط، TTSR، فحوصات إلغاء التحرير أثناء التدفق).

## عقد التدفق الموحد في `@f5xc-salesdemos/pi-ai`

جميع المزودين يصدرون نفس الشكل (`AssistantMessageEvent` في `packages/ai/src/types.ts`):

- `start`
- ثلاثيات دورة حياة كتل المحتوى:
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

## سلوك خنق الدلتا ومواءمتها

يعامل `AssistantMessageEventStream` كلاً من `text_delta` و`thinking_delta` و`toolcall_delta` كأحداث قابلة للدمج:

- يتم دمج الدلتا المخزنة مؤقتاً فقط عندما يتطابق **النوع + فهرس المحتوى**
- يحتفظ الدمج بأحدث لقطة `partial`
- الأحداث غير الدلتا تفرض تفريغاً فورياً

هذا يُنعّم تدفقات المزودين عالية التردد لمستهلكي TUI/الأحداث، لكنه ليس ضغطاً عكسياً للمزود: المزودون لا يزالون ينتجون بأقصى سرعة، بينما يخزن التدفق المحلي مؤقتاً.

## تفاصيل توحيد المزودين

## Anthropic (`anthropic-messages`)

المصدر: `packages/ai/src/providers/anthropic.ts`

نقاط التوحيد:

- `message_start` يُهيئ الاستخدام (رموز الإدخال/الإخراج/التخزين المؤقت)
- `content_block_start` يُربط ببدايات النص/التفكير/استدعاء الأداة
- `content_block_delta` يُربط:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` يُحدّث `thinkingSignature` فقط (بدون حدث)
- `content_block_stop` يُصدر `*_end` المقابل
- `message_delta.stop_reason` يُربط عبر `mapStopReason()`

تدفق وسائط استدعاء الأداة:

- كل كتلة أداة تحمل `partialJson` داخلي
- كل دلتا JSON تُلحق بـ `partialJson`
- يتم إعادة تحليل `arguments` عند كل دلتا عبر `parseStreamingJson()`
- `toolcall_end` يعيد التحليل مرة أخرى، ثم يزيل `partialJson`

## OpenAI Responses (`openai-responses`)

المصدر: `packages/ai/src/providers/openai-responses.ts`

نقاط التوحيد:

- `response.output_item.added` يبدأ كتل التفكير/النص/استدعاء الدالة
- أحداث ملخص التفكير (`response.reasoning_summary_text.delta`) تصبح `thinking_delta`
- دلتا الإخراج/الرفض تصبح `text_delta`
- `response.function_call_arguments.delta` تصبح `toolcall_delta`
- `response.output_item.done` تُصدر `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` تربط الحالة بسبب التوقف والاستخدام

تدفق وسائط استدعاء الأداة:

- نفس نمط تراكم `partialJson` كما في Anthropic
- المزودون الذين يرسلون `response.function_call_arguments.done` فقط لا يزالون يملأون الوسائط النهائية
- يتم توحيد معرفات استدعاء الأداة كـ `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

المصدر: `packages/ai/src/providers/google.ts`

نقاط التوحيد:

- يتكرر على `candidate.content.parts`
- أجزاء النص تُقسم إلى تفكير مقابل نص بواسطة `isThinkingPart(part)`
- انتقالات الكتل تُغلق الكتلة السابقة قبل بدء كتلة جديدة
- `part.functionCall` يُعامل كاستدعاء أداة مكتمل (يتم إصدار start/delta/end فوراً)
- سبب الانتهاء يُربط بواسطة `mapStopReason()` من `google-shared.ts`

تدفق وسائط استدعاء الأداة:

- وسائط استدعاء الدالة تصل ككائن منظم، وليس كنص JSON تدريجي
- التنفيذ يُصدر `toolcall_delta` اصطناعي واحد يحتوي على `JSON.stringify(arguments)`
- لا حاجة لمحلل JSON جزئي لـ Google في هذا المسار

## تراكم JSON الجزئي لاستدعاء الأداة والاسترداد

السلوك المشترك لـ Anthropic/OpenAI Responses يستخدم `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. محاولة `JSON.parse`
2. الرجوع إلى محلل `partial-json` للأجزاء غير المكتملة
3. إذا فشل كلاهما، يُرجع `{}`

الآثار المترتبة:

- دلتا الوسائط المشوهة أو المبتورة لا تُعطل معالجة التدفق فوراً
- `arguments` قيد التقدم قد تكون مؤقتاً `{}`
- الدلتا الصحيحة اللاحقة يمكنها استرداد الوسائط المنظمة لأن التحليل يُعاد عند كل إلحاق
- `toolcall_end` النهائي يُجري محاولة تحليل أخيرة قبل الإصدار

## أسباب التوقف مقابل أخطاء النقل/وقت التشغيل

يتم ربط أسباب توقف المزود بـ `stopReason` الموحد:

- Anthropic: `end_turn`→`stop`، `max_tokens`→`length`، `tool_use`→`toolUse`، حالات الأمان/الرفض→`error`
- OpenAI Responses: `completed`→`stop`، `incomplete`→`length`، `failed/cancelled`→`error`
- Google: `STOP`→`stop`، `MAX_TOKENS`→`length`، فئات الأمان/المحظور/استدعاء الدالة المشوه→`error`

دلالات الأخطاء مقسمة إلى مرحلتين:

1. **دلالات اكتمال النموذج** (سبب الانتهاء/الحالة التي يبلغ عنها المزود)
2. **فشل النقل/وقت التشغيل** (استثناءات الشبكة/العميل/المحلل/الإلغاء)

إذا رمى تدفق المزود أو أشار إلى فشل، يلتقط كل غلاف مزود ويُصدر حدث `error` نهائي مع:

- `stopReason = "aborted"` عندما يكون إشارة الإلغاء مُعيّنة
- وإلا `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## سلوك القطعة المشوهة / فشل تحليل SSE

لمسارات المزودين هذه، يتم التعامل مع تأطير القطع/SSE بواسطة تدفقات SDK الخاصة بالمورد (Anthropic SDK، OpenAI SDK، Google SDK). هذا الكود لا يُنفذ مفكك SSE مخصصاً هنا.

السلوك الملاحظ في التنفيذ الحالي:

- تحليل القطع/SSE المشوه على مستوى SDK يظهر كاستثناء أو حدث `error` في التدفق
- غلاف المزود يحوله إلى حدث `error` نهائي موحد
- لا توجد استئناف/إعادة محاولة خاصة بالمزود داخل دالة التدفق نفسها
- إعادة المحاولة على المستوى الأعلى يتم التعامل معها في منطق إعادة المحاولة التلقائية لـ `AgentSession` (إعادة محاولة على مستوى الرسالة، وليس إعادة تشغيل قطع التدفق)

## حدود الإلغاء

الإلغاء متعدد الطبقات:

- طلب مزود AI: يتم تمرير `options.signal` إلى استدعاء تدفق عميل المزود.
- غلاف المزود: بعد حلقة التدفق، الإشارة الملغاة تفرض مسار الخطأ (`"Request was aborted"`).
- حلقة الوكيل: تتحقق من `signal.aborted` قبل معالجة كل حدث مزود ويمكنها تركيب رسالة مساعد ملغاة من أحدث جزء جزئي.
- عناصر التحكم في الجلسة/الوكيل: `AgentSession.abort()` -> `agent.abort()` -> إلغاء متحكم الإلغاء المشترك.

إلغاء تنفيذ الأداة منفصل عن إلغاء تدفق النموذج:

- مُشغّلات الأدوات تستخدم `AbortSignal.any([agentSignal, steeringAbortSignal])`
- المقاطعات التوجيهية يمكنها إلغاء تنفيذ الأداة المتبقي مع الحفاظ على نتائج الأداة المُنتجة بالفعل

## حدود الضغط العكسي

لا توجد آلية ضغط عكسي صارمة بين تدفق SDK للمزود والمستهلكين في اتجاه التدفق:

- `EventStream` يستخدم طوابير في الذاكرة بدون حد أقصى للحجم
- الخنق يقلل معدل تحديث واجهة المستخدم لكنه لا يُبطئ استقبال المزود
- إذا تأخر المستهلكون بشكل ملحوظ، يمكن أن تنمو الأحداث المُصفوفة حتى الاكتمال

التصميم الحالي يُفضل الاستجابة والترتيب البسيط على التحكم في التدفق ذي المخزن المؤقت المحدود.

## كيف تظهر أحداث التدفق كأحداث وكيل/جلسة

`agentLoop.streamAssistantResponse()` يربط `AssistantMessageEvent` بـ `AgentEvent`:

- عند `start`: يدفع رسالة مساعد مؤقتة ويُصدر `message_start`
- عند أحداث الكتل (`text_*`، `thinking_*`، `toolcall_*`): يُحدّث آخر رسالة مساعد، ويُصدر `message_update` مع `assistantMessageEvent` الخام
- عند النهاية (`done`/`error`): يحل الرسالة النهائية من `response.result()`، ويُصدر `message_end`

ثم يستهلك `AgentSession` تلك الأحداث لسلوكيات مستوى الجلسة:

- TTSR يراقب `message_update.assistantMessageEvent` لـ `text_delta` و`toolcall_delta`
- حارس التحرير أثناء التدفق يفحص `toolcall_delta`/`toolcall_end` على استدعاءات `edit` ويمكنه الإلغاء مبكراً
- الحفظ يكتب الرسائل المُنهاة عند `message_end`
- إعادة المحاولة التلقائية تفحص `stopReason === "error"` للمساعد بالإضافة إلى استدلالات `errorMessage`

## المسؤوليات الموحدة مقابل الخاصة بالمزود

موحدة (العقد المشترك):

- شكل الحدث (`AssistantMessageEvent`)
- استخراج النتيجة النهائية (`done`/`error`)
- قواعد خنق ودمج الدلتا
- نموذج نشر أحداث الوكيل/الجلسة

خاصة بالمزود (غير مُجرّدة بالكامل):

- تصنيفات الأحداث الأصلية ومنطق الربط
- جداول ترجمة أسباب التوقف
- اصطلاحات معرفات استدعاء الأداة
- دلالات كتل التفكير/الاستدلال والتوقيعات
- دلالات رموز الاستخدام وتوقيت التوفر
- قيود تحويل الرسائل لكل واجهة برمجة تطبيقات

## ملفات التنفيذ

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — توجيه المزود، ربط الخيارات، توصيل مفتاح API/الجلسة.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — طابور تدفق عام + خنق دلتا المساعد.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — تحليل JSON الجزئي لوسائط الأداة المتدفقة.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — ترجمة أحداث Anthropic وتراكم دلتا JSON للأداة.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — ترجمة أحداث OpenAI Responses وربط الحالة.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — ترجمة قطع تدفق Gemini إلى كتل.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — ربط سبب انتهاء Gemini وقواعد التحويل المشتركة.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — استهلاك تدفق المزود وربط `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — معالجة تحديثات التدفق على مستوى الجلسة، والإلغاء، وإعادة المحاولة، والحفظ.
