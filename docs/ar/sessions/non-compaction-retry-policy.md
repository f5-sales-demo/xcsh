---
title: Non-Compaction Auto-Retry Policy
description: Auto-retry policy for transient API failures outside the compaction path.
sidebar:
  order: 6
  label: سياسة إعادة المحاولة
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# سياسة إعادة المحاولة التلقائية خارج نطاق الضغط

يصف هذا المستند مسار إعادة المحاولة القياسي لأخطاء واجهة برمجة التطبيقات في `AgentSession`.

يستثني هذا المستند صراحةً استعادة تجاوز السياق عبر الضغط التلقائي. يتم التعامل مع التجاوز بواسطة منطق الضغط وهو موثق بشكل منفصل في [`compaction.md`](./compaction.md).

## ملفات التنفيذ

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## حدود النطاق مقابل الضغط

يتم فحص إعادة المحاولة والضغط من نفس مسار `agent_end`، لكنهما مفصولان عمداً:

1. يفحص `agent_end` آخر رسالة من المساعد.
2. يتم تشغيل `#isRetryableError(...)` أولاً.
3. إذا بدأت إعادة المحاولة، يتم تخطي فحوصات الضغط لتلك الدورة.
4. يتم استبعاد أخطاء تجاوز السياق بشكل صارم من تصنيف إعادة المحاولة (تقوم `isContextOverflow(...)` بالقطع المبكر لإعادة المحاولة).
5. لذلك ينتقل التجاوز إلى `#checkCompaction(...)` بدلاً من إعادة المحاولة القياسية.

إذن: أعطال الحمل الزائد/تحديد المعدل/الخادم/الشبكة تستخدم سياسة إعادة المحاولة هذه؛ تجاوز نافذة السياق يستخدم استعادة الضغط.

## تصنيف إعادة المحاولة

يتطلب `#isRetryableError(...)` توفر جميع الشروط التالية:

- `stopReason === "error"` للمساعد
- وجود `errorMessage`
- الرسالة **ليست** تجاوز سياق
- `errorMessage` يطابق `#isRetryableErrorMessage(...)`

مجموعة الأنماط القابلة لإعادة المحاولة الحالية (قائمة على التعبيرات النمطية):

- overloaded
- rate limit / usage limit / too many requests
- فئات الخادم المشابهة لـ HTTP: 429، 500، 502، 503، 504
- service unavailable / server error / internal error
- connection error / fetch failed
- صياغة `retry delay`

هذا تصنيف قائم على أنماط النصوص، وليس رموز أخطاء مزود مُهيكلة.

## دورة حياة إعادة المحاولة وانتقالات الحالة

حالة الجلسة المستخدمة بواسطة إعادة المحاولة:

- `#retryAttempt: number` (`0` تعني خامل)
- `#retryPromise: Promise<void> | undefined` (تتبع دورة حياة إعادة المحاولة الجارية)
- `#retryResolve: (() => void) | undefined` (تحل `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (تلغي انتظار التراجع)

التدفق (`#handleRetryableError`):

1. قراءة مجموعة إعدادات `retry`.
2. إذا كان `retry.enabled === false`، التوقف فوراً (`false`، لم تبدأ إعادة المحاولة).
3. زيادة `#retryAttempt`.
4. إنشاء `#retryPromise` مرة واحدة (المحاولة الأولى في سلسلة).
5. إذا تجاوزت المحاولة `retry.maxRetries`، إصدار حدث فشل نهائي والتوقف.
6. حساب التأخير: `retry.baseDelayMs * 2^(attempt-1)`.
7. لأخطاء حد الاستخدام، تحليل تلميحات إعادة المحاولة واستدعاء تخزين المصادقة (`markUsageLimitReached(...)`)؛ إذا نجح تبديل المزود/النموذج، فرض التأخير إلى `0`.
8. إصدار `auto_retry_start`.
9. إزالة رسالة خطأ المساعد الأخيرة من حالة وقت تشغيل الوكيل (يتم الاحتفاظ بها في سجل الجلسة المحفوظ).
10. الانتظار مع دعم الإلغاء.
11. عند الاستيقاظ، جدولة `agent.continue()` عبر `setTimeout(..., 0)`.

### ما الذي يعيد تعيين عدادات إعادة المحاولة

يتم إعادة تعيين `#retryAttempt` إلى `0` في هذه الحالات:

- أول رسالة مساعد ناجحة بدون خطأ وبدون إلغاء بعد بدء إعادة المحاولات (تصدر `auto_retry_end { success: true }`)
- إلغاء إعادة المحاولة أثناء انتظار التراجع
- مسار تجاوز الحد الأقصى لإعادة المحاولات

يتم حل/مسح `#retryPromise` عند انتهاء سلسلة إعادة المحاولة (نجاح، إلغاء، أو تجاوز الحد الأقصى)، عبر `#resolveRetry()`.

## دلالات التراجع والحد الأقصى للمحاولات

الإعدادات:

- `retry.enabled` (الافتراضي `true`)
- `retry.maxRetries` (الافتراضي `3`)
- `retry.baseDelayMs` (الافتراضي `2000`)

ترقيم المحاولات:

- يتم زيادة عداد المحاولات قبل فحص الحد الأقصى
- تستخدم أحداث البدء المحاولة الحالية (تبدأ من 1)
- حدث انتهاء تجاوز الحد الأقصى يبلغ عن `attempt: this.#retryAttempt - 1` (عدد آخر محاولة إعادة)

تسلسل التراجع مع الإعدادات الافتراضية:

- المحاولة 1: 2000 مللي ثانية
- المحاولة 2: 4000 مللي ثانية
- المحاولة 3: 8000 مللي ثانية

يتم استخدام مدخلات تجاوز التأخير فقط في مسار معالجة حد الاستخدام، وفقط للتأثير على قرار تبديل النموذج/الحساب في تخزين المصادقة. في مسار إعادة المحاولة الرئيسي خارج نطاق الضغط، يظل التراجع تأخيراً أسياً محلياً ما لم ينجح التبديل (`delayMs = 0`).

## آليات الإلغاء

### إلغاء إعادة المحاولة الصريح

`abortRetry()`:

- تلغي `#retryAbortController` (إن وُجد)
- تحل وعد إعادة المحاولة (`#resolveRetry()`) بحيث يتم إلغاء حظر المنتظرين

إذا حدث الإلغاء أثناء الانتظار، يصدر مسار الالتقاط:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- إعادة تعيين المحاولة/المتحكم

### تفاعل إلغاء العملية الشاملة

تستدعي `abort()` الدالة `abortRetry()` قبل إلغاء تدفق الوكيل النشط. هذا يضمن إلغاء انتظار تراجع إعادة المحاولة عندما يصدر المستخدم إلغاءً عاماً.

### تفاعل واجهة المستخدم النصية (TUI)

عند `auto_retry_start`، يقوم EventController بـ:

- تبديل معالج `Esc` إلى `session.abortRetry()`
- عرض نص التحميل: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

عند `auto_retry_end`، يستعيد معالج `Esc` السابق ويمسح حالة التحميل.

## سلوك البث وإتمام الطلب

تنتظر `prompt()` في النهاية على `#waitForRetry()` بعد أن تعيد `agent.prompt(...)` نتيجتها.

التأثير:

- لا يكتمل حل استدعاء الطلب بالكامل حتى تنتهي أي سلسلة إعادة محاولة بدأت (نجاح/فشل/إلغاء)
- دورة حياة إعادة المحاولة هي جزء من حد تنفيذ طلب منطقي واحد

هذا يمنع المستدعين من اعتبار دورة إعادة المحاولة مكتملة مبكراً.

## عناصر التحكم: الإعدادات و RPC

### مفاتيح التكوين

مُعرَّفة في مخطط الإعدادات تحت مجموعة retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

مفاتيح التبديل البرمجية في الجلسة:

- `setAutoRetryEnabled(enabled)` تكتب `retry.enabled`
- `autoRetryEnabled` تقرأ `retry.enabled`
- `isRetrying` تُبلغ ما إذا كان وعد دورة حياة إعادة المحاولة نشطاً

### عناصر تحكم RPC

سطح أوامر RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

مساعدات العميل:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

يعيد كلا الأمرين استجابات نجاح؛ تفاصيل تقدم/فشل إعادة المحاولة تأتي من أحداث الجلسة المتدفقة، وليس من حمولات استجابة الأوامر.

## إصدار الأحداث وإظهار الأعطال

أحداث إعادة المحاولة على مستوى الجلسة:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

الانتشار:

- تُصدر عبر `AgentSession.subscribe(...)`
- تُعاد توجيهها إلى مشغل الإضافات كأحداث إضافات
- في وضع RPC، تُعاد توجيهها مباشرة ككائنات أحداث JSON (`session.subscribe(event => output(event))`)
- في واجهة المستخدم النصية (TUI)، يستهلكها `EventController` لواجهة التحميل/الأخطاء

إظهار الفشل النهائي:

- عند تجاوز الحد الأقصى أو الإلغاء، `auto_retry_end.success === false`
- تعرض واجهة المستخدم النصية: `Retry failed after N attempts: <finalError>`
- تتلقى الإضافات/الخطافات `auto_retry_end` بنفس الحقول
- يتلقى مستهلكو RPC نفس كائن الحدث على تدفق stdout

## شروط التوقف الدائم

تتوقف إعادة المحاولة ولن تستمر تلقائياً عند حدوث أي مما يلي:

- `retry.enabled` يساوي false
- الخطأ غير مصنف كقابل لإعادة المحاولة
- الخطأ هو تجاوز سياق (يُفوَّض إلى مسار الضغط)
- تجاوز الحد الأقصى لإعادة المحاولات
- إلغاء المستخدم لإعادة المحاولة (`abort_retry` أو `Esc` أثناء محمل إعادة المحاولة)
- الإلغاء الشامل (`abort`) يلغي إعادة المحاولة أولاً

يمكن أن تبدأ سلسلة إعادة محاولة جديدة لاحقاً عند حدوث خطأ قابل لإعادة المحاولة في المستقبل بعد إعادة تعيين العدادات.

## ملاحظات تشغيلية

- التصنيف يعتمد على مطابقة نصوص التعبيرات النمطية؛ لا تُستخدم أخطاء المزود المُهيكلة هنا.
- تزيل إعادة المحاولة خطأ المساعد الفاشل من **سياق وقت التشغيل** قبل إعادة المتابعة، لكن سجل الجلسة لا يزال يحتفظ بإدخال ذلك الخطأ.
- يكشف `RpcSessionState` حالياً عن `autoCompactionEnabled` لكنه لا يكشف عن حقل `autoRetryEnabled`؛ يجب على مستدعي RPC تتبع حالة التبديل الخاصة بهم أو الاستعلام عن الإعدادات عبر واجهات برمجة تطبيقات أخرى.
