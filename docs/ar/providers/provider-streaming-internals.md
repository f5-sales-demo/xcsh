---
title: الآليات الداخلية لبث الموفر
description: تنفيذ بث الموفر مع تحليل SSE، وعد الرموز، ومعالجة الضغط الخلفي.
sidebar:
  order: 2
  label: الآليات الداخلية للبث
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# الآليات الداخلية لبث الموفر

يشرح هذا المستند كيفية توحيد بث الرموز/الأدوات في `@f5xc-salesdemos/pi-ai`، ثم نشره عبر أحداث جلسة `@f5xc-salesdemos/pi-agent-core` و`coding-agent`.

## التدفق الشامل من البداية إلى النهاية

1. تقوم `streamSimple()` (`packages/ai/src/stream.ts`) بتعيين الخيارات العامة والإرسال إلى دالة بث الموفر.
2. تترجم دوال بث الموفر (`anthropic.ts`، `openai-responses.ts`، `google.ts`) أحداث البث الأصلية للموفر إلى تسلسل `AssistantMessageEvent` الموحد.
3. يدفع كل موفر الأحداث إلى `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)، الذي يُخفف أحداث الدلتا ويعرض:
   - التكرار غير المتزامن للتحديثات التدريجية
   - `result()` للحصول على `AssistantMessage` النهائية
4. تستهلك `agentLoop` (`packages/agent/src/agent-loop.ts`) تلك الأحداث، وتعدّل حالة المساعد الجارية، وتصدر أحداث `message_update` حاملةً `assistantMessageEvent` الخام.
5. تشترك `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) في أحداث الوكيل، وتُثبّت الرسائل، وتُشغّل خطافات الامتداد، وتطبّق سلوكيات الجلسة (إعادة المحاولة، والضغط، وTTSR، وفحوصات إجهاض تحرير البث).

## عقد البث الموحد في `@f5xc-salesdemos/pi-ai`

تصدر جميع الموفرين نفس الشكل (`AssistantMessageEvent` في `packages/ai/src/types.ts`):

- `start`
- ثلاثيات دورة حياة كتلة المحتوى:
  - النص: `text_start` → `text_delta`* → `text_end`
  - التفكير: `thinking_start` → `thinking_delta`* → `thinking_end`
  - استدعاء الأداة: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- الحدث الطرفي:
  - `done` مع `reason: "stop" | "length" | "toolUse"`
  - أو `error` مع `reason: "aborted" | "error"`

تضمن `AssistantMessageEventStream`:

- يُحلّ النتيجة النهائية بالحدث الطرفي (`done` أو `error`)
- تُجمَّع الدلتات/تُخفَّف (~50ms)
- تُفرغ الدلتات المؤقتة قبل الأحداث غير الدلتا وقبل الاكتمال

## سلوك تخفيف الدلتا وتنسيقها

تعامل `AssistantMessageEventStream` أحداث `text_delta` و`thinking_delta` و`toolcall_delta` كأحداث قابلة للدمج:

- تُدمَج الدلتات المؤقتة فقط عندما يتطابق **النوع + contentIndex**
- يحتفظ الدمج بأحدث لقطة `partial`
- تفرض الأحداث غير الدلتا التفريغ الفوري

يُنعّم هذا تدفقات الموفر عالية التردد لمستهلكي TUI/الأحداث، لكنه لا يمثل ضغطاً خلفياً للموفر: تظل الموفرون ينتجون بالسرعة الكاملة، بينما يخزّن التدفق المحلي مؤقتاً.

## تفاصيل توحيد الموفر

## Anthropic (`anthropic-messages`)

المصدر: `packages/ai/src/providers/anthropic.ts`

نقاط التوحيد:

- يُهيّئ `message_start` الاستخدام (رموز الإدخال/الإخراج/ذاكرة التخزين المؤقت)
- يُعيّن `content_block_start` إلى بدايات النص/التفكير/استدعاء الأداة
- يُعيّن `content_block_delta`:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` يُحدّث `thinkingSignature` فقط (بدون حدث)
- يُصدر `content_block_stop` الـ `*_end` المقابلة
- يُعيّن `message_delta.stop_reason` عبر `mapStopReason()`

بث وسائط استدعاء الأداة:

- تحمل كل كتلة أداة `partialJson` داخلية
- تُلحق كل دلتا JSON بـ `partialJson`
- تُعاد قراءة `arguments` عند كل دلتا عبر `parseStreamingJson()`
- يُعيد `toolcall_end` القراءة مرة أخيرة، ثم يُجرّد `partialJson`

## OpenAI Responses (`openai-responses`)

المصدر: `packages/ai/src/providers/openai-responses.ts`

نقاط التوحيد:

- تبدأ `response.output_item.added` كتل الاستدلال/النص/استدعاء الدالة
- تُصبح أحداث ملخص الاستدلال (`response.reasoning_summary_text.delta`) `thinking_delta`
- تُصبح دلتات الإخراج/الرفض `text_delta`
- تُصبح `response.function_call_arguments.delta` `toolcall_delta`
- يُصدر `response.output_item.done` أحداث `thinking_end` / `text_end` / `toolcall_end`
- يُعيّن `response.completed` الحالة إلى سبب التوقف والاستخدام

بث وسائط استدعاء الأداة:

- نفس نمط تراكم `partialJson` المستخدم في Anthropic
- تُعبّئ الموفرون الذين يُرسلون فقط `response.function_call_arguments.done` الوسائط النهائية
- تُوحَّد معرّفات استدعاء الأداة بصيغة `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

المصدر: `packages/ai/src/providers/google.ts`

نقاط التوحيد:

- يُكرر `candidate.content.parts`
- تُقسّم أجزاء النص إلى تفكير مقابل نص بواسطة `isThinkingPart(part)`
- تُغلق انتقالات الكتلة الكتلة السابقة قبل بدء كتلة جديدة
- يُعامَل `part.functionCall` كاستدعاء أداة كامل (يُصدر start/delta/end فوراً)
- يُعيّن سبب الإنهاء بواسطة `mapStopReason()` من `google-shared.ts`

بث وسائط استدعاء الأداة:

- تصل وسائط استدعاء الدالة ككائن منظّم، وليس نصاً تدريجياً بصيغة JSON
- يُصدر التنفيذ `toolcall_delta` اصطناعية واحدة تحتوي على `JSON.stringify(arguments)`
- لا يلزم محلل JSON جزئي لـ Google في هذا المسار

## تراكم JSON الجزئي لاستدعاء الأداة واستعادته

يستخدم السلوك المشترك لـ Anthropic/OpenAI Responses دالة `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. تجربة `JSON.parse`
2. الرجوع إلى محلل `partial-json` للأجزاء غير المكتملة
3. إذا فشل كلاهما، إرجاع `{}`

التداعيات:

- لا تُعطّل دلتات الوسائط المشوهة أو المقطوعة معالجة التدفق فوراً
- قد تكون `arguments` الجارية مؤقتاً `{}`
- يمكن لدلتات صالحة لاحقة استعادة الوسائط المنظمة لأن التحليل يُعاد عند كل إلحاق
- يُجري `toolcall_end` النهائي محاولة تحليل أخيرة قبل الإصدار

## أسباب التوقف مقابل أخطاء النقل/وقت التشغيل

تُعيّن أسباب توقف الموفر إلى `stopReason` موحد:

- Anthropic: `end_turn`→`stop`، `max_tokens`→`length`، `tool_use`→`toolUse`، حالات السلامة/الرفض→`error`
- OpenAI Responses: `completed`→`stop`، `incomplete`→`length`، `failed/cancelled`→`error`
- Google: `STOP`→`stop`، `MAX_TOKENS`→`length`، فئات السلامة/المحظورة/استدعاء الدالة المشوه→`error`

تُقسَّم دلالات الأخطاء في مرحلتين:

1. **دلالات اكتمال النموذج** (سبب الإنهاء/الحالة الذي أبلغ عنه الموفر)
2. **فشل النقل/وقت التشغيل** (استثناءات الشبكة/العميل/المحلل/الإجهاض)

إذا أصدر تدفق الموفر استثناءً أو أشار إلى فشل، يلتقط كل غلاف موفر ذلك ويصدر حدث `error` طرفياً مع:

- `stopReason = "aborted"` عند تعيين إشارة الإجهاض
- وإلا `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## سلوك الأجزاء المشوهة / فشل تحليل SSE

في مسارات الموفر هذه، يتولى تأطير الأجزاء/SSE تدفقات SDK الخاصة بالبائع (Anthropic SDK، وOpenAI SDK، وGoogle SDK). لا تُنفّذ هذه الشفرة مُحلّل SSE مخصصاً هنا.

السلوك الملاحظ في التنفيذ الحالي:

- يظهر تحليل الأجزاء/SSE المشوهة على مستوى SDK كاستثناء أو حدث `error` في التدفق
- يحوّل غلاف الموفر ذلك إلى حدث `error` طرفي موحد
- لا يوجد استئناف/إعادة محاولة خاص بالموفر داخل دالة التدفق نفسها
- تُعالَج إعادة المحاولة على المستوى الأعلى في منطق إعادة المحاولة التلقائية لـ `AgentSession` (إعادة المحاولة على مستوى الرسالة، وليس إعادة تشغيل أجزاء التدفق)

## حدود الإلغاء

يتدرج الإلغاء على طبقات:

- طلب موفر الذكاء الاصطناعي: يُمرَّر `options.signal` إلى استدعاء تدفق عميل الموفر.
- غلاف الموفر: بعد حلقة التدفق، تفرض الإشارة المجهضة مسار الخطأ (`"Request was aborted"`).
- حلقة الوكيل: تفحص `signal.aborted` قبل معالجة كل حدث موفر ويمكنها تركيب رسالة مساعد مجهضة من آخر جزء جزئي.
- ضوابط الجلسة/الوكيل: `AgentSession.abort()` -> `agent.abort()` -> إلغاء وحدة تحكم الإجهاض المشتركة.

إلغاء تنفيذ الأداة منفصل عن إلغاء تدفق النموذج:

- تستخدم مشغّلات الأدوات `AbortSignal.any([agentSignal, steeringAbortSignal])`
- يمكن لمقاطعات التوجيه إجهاض تنفيذ الأدوات المتبقية مع الحفاظ على نتائج الأدوات المُنتجة مسبقاً

## حدود الضغط الخلفي

لا توجد آلية ضغط خلفي صارمة بين تدفق SDK الموفر والمستهلكين في المصب:

- يستخدم `EventStream` طوابير في الذاكرة بدون حجم أقصى
- يُقلّل التخفيف من معدل تحديث واجهة المستخدم لكنه لا يُبطئ استهلاك الموفر
- إذا تأخر المستهلكون بشكل ملحوظ، يمكن أن تنمو الأحداث المخزنة مؤقتاً حتى الاكتمال

يُفضّل التصميم الحالي الاستجابة وبساطة الترتيب على التحكم في تدفق المخزن المحدود.

## كيفية ظهور أحداث البث كأحداث وكيل/جلسة

تربط `agentLoop.streamAssistantResponse()` بين `AssistantMessageEvent` و`AgentEvent`:

- عند `start`: تدفع رسالة مساعد عنصراً نائباً وتصدر `message_start`
- عند أحداث الكتلة (`text_*`، `thinking_*`، `toolcall_*`): تُحدّث آخر رسالة مساعد، وتصدر `message_update` مع `assistantMessageEvent` الخام
- عند الطرفي (`done`/`error`): تحلّ الرسالة النهائية من `response.result()`، وتصدر `message_end`

ثم تستهلك `AgentSession` تلك الأحداث للسلوكيات على مستوى الجلسة:

- يراقب TTSR `message_update.assistantMessageEvent` بحثاً عن `text_delta` و`toolcall_delta`
- يفحص حارس تعديل البث `toolcall_delta`/`toolcall_end` على استدعاءات `edit` ويمكنه الإجهاض مبكراً
- تكتب الاستمرارية الرسائل النهائية عند `message_end`
- تفحص إعادة المحاولة التلقائية `stopReason === "error"` للمساعد بالإضافة إلى إرشادات `errorMessage`

## المسؤوليات الموحدة مقابل المسؤوليات الخاصة بالموفر

الموحّد (العقد المشترك):

- شكل الحدث (`AssistantMessageEvent`)
- استخراج النتيجة النهائية (`done`/`error`)
- تخفيف الدلتا + قواعد الدمج
- نموذج نشر الأحداث للوكيل/الجلسة

خاص بالموفر (غير مجرّد بالكامل):

- تصنيفات الأحداث في المصدر العلوي ومنطق التعيين
- جداول ترجمة سبب التوقف
- اصطلاحات معرّف استدعاء الأداة
- دلالات كتلة الاستدلال/التفكير والتوقيعات
- دلالات رموز الاستخدام وتوافر التوقيت
- قيود تحويل الرسائل لكل API

## ملفات التنفيذ

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — إرسال الموفر، وتعيين الخيارات، وتوصيل مفتاح API/الجلسة.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — طابور التدفق العام + تخفيف دلتا المساعد.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — تحليل JSON الجزئي لوسائط الأداة المبثوثة.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — ترجمة حدث Anthropic وتراكم دلتا JSON للأداة.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — ترجمة حدث OpenAI Responses وتعيين الحالة.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — ترجمة أجزاء تدفق Gemini إلى كتل.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — تعيين سبب إنهاء Gemini وقواعد التحويل المشتركة.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — استهلاك تدفق الموفر وجسر `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — المعالجة على مستوى الجلسة لتحديثات البث، والإجهاض، وإعادة المحاولة، والاستمرارية.
