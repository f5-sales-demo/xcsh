---
title: Model and Provider Configuration
description: >-
  Model registry and provider configuration via models.yml with routing,
  fallback, and pricing.
sidebar:
  order: 1
  label: Models & providers
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# إعدادات النماذج ومزودي الخدمة (`models.yml`)

يصف هذا المستند كيفية تحميل وكيل البرمجة للنماذج حالياً، وتطبيق التجاوزات، وحل بيانات الاعتماد، واختيار النماذج أثناء التشغيل.

## ما الذي يتحكم في سلوك النموذج

ملفات التنفيذ الرئيسية:

- `src/config/model-registry.ts` — يحمّل النماذج المدمجة + المخصصة، تجاوزات المزودين، الاكتشاف أثناء التشغيل، تكامل المصادقة
- `src/config/model-resolver.ts` — يحلل أنماط النماذج ويختار النماذج الأولية/الصغيرة/البطيئة
- `src/config/settings-schema.ts` — الإعدادات المتعلقة بالنماذج (`modelRoles`، تفضيلات نقل المزود)
- `src/session/auth-storage.ts` — ترتيب حل مفتاح API + OAuth
- `packages/ai/src/models.ts` و `packages/ai/src/types.ts` — المزودون/النماذج المدمجة وأنواع `Model`/`compat`

## موقع ملف الإعدادات والسلوك القديم

مسار الإعدادات الافتراضي:

- `~/.xcsh/agent/models.yml`

السلوك القديم لا يزال موجوداً:

- إذا كان `models.yml` مفقوداً و `models.json` موجوداً في نفس الموقع، يتم ترحيله إلى `models.yml`.
- مسارات الإعدادات الصريحة بصيغة `.json` / `.jsonc` لا تزال مدعومة عند تمريرها برمجياً إلى `ModelRegistry`.

## هيكل `models.yml`

```yaml
configVersion: 1  # optional — written by auto-config, used for migration detection
providers:
  <provider-id>:
    # provider-level config
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` هو عدد صحيح اختياري يُكتب بواسطة نظام الإعداد التلقائي. عند وجوده، يستخدمه xcsh للكشف عن الإعدادات القديمة وترقيتها تلقائياً.

`provider-id` هو مفتاح المزود القياسي المستخدم عبر عمليات الاختيار والبحث عن المصادقة.

`equivalence` اختياري ويُعدّ تجميع النماذج القياسية فوق نماذج المزود الفعلية:

- `overrides` يربط محدداً فعلياً دقيقاً (`provider/modelId`) بمعرف قياسي رسمي من المصدر الأصلي
- `exclude` يستثني محدداً فعلياً من التجميع القياسي

## حقول مستوى المزود

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
          extraBody:
            gateway: m1-01
            controller: mlx
```

### قيم `api` المسموح بها للمزود/النموذج

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### قيم المصادقة/الاكتشاف المسموح بها

- `auth`: `apiKey` (افتراضي) أو `none`
- `discovery.type`: `ollama`

## قواعد التحقق (الحالية)

### مزود مخصص كامل (`models` غير فارغ)

مطلوب:

- `baseUrl`
- `apiKey` ما لم يكن `auth: none`
- `api` على مستوى المزود أو لكل نموذج

### مزود للتجاوز فقط (`models` مفقود أو فارغ)

يجب تعريف واحد على الأقل من:

- `baseUrl`
- `modelOverrides`
- `discovery`

### الاكتشاف

- `discovery` يتطلب `api` على مستوى المزود.

### فحوصات قيم النموذج

- `id` مطلوب
- `contextWindow` و `maxTokens` يجب أن تكون موجبة إذا تم تقديمها

## ترتيب الدمج والتجاوز

خط أنابيب ModelRegistry (عند التحديث):

1. تحميل المزودين/النماذج المدمجة من `@f5xc-salesdemos/pi-ai`.
2. تحميل إعدادات `models.yml` المخصصة.
3. تطبيق تجاوزات المزود (`baseUrl`، `headers`) على النماذج المدمجة.
4. تطبيق `modelOverrides` (لكل مزود + معرف نموذج).
5. دمج `models` المخصصة:
   - نفس `المزود + المعرف` يستبدل الموجود
   - وإلا يُضاف في النهاية
6. تطبيق النماذج المكتشفة أثناء التشغيل (حالياً Ollama و LM Studio)، ثم إعادة تطبيق تجاوزات النماذج.

## تكافؤ النماذج القياسية والتجميع

يحتفظ السجل بكل نموذج مزود فعلي ثم يبني طبقة قياسية فوقها.

المعرفات القياسية هي معرفات رسمية من المصدر الأصلي فقط، على سبيل المثال:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### إعدادات التكافؤ في `models.yml`

مثال:

```yaml
providers:
  zenmux:
    baseUrl: https://api.zenmux.example/v1
    apiKey: ZENMUX_API_KEY
    api: openai-codex-responses
    models:
      - id: codex
        name: Zenmux Codex
        reasoning: true
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 200000
        maxTokens: 32768

equivalence:
  overrides:
    zenmux/codex: gpt-5.3-codex
    p-codex/codex: gpt-5.3-codex
  exclude:
    - demo/codex-preview
```

ترتيب البناء للتجميع القياسي:

1. تجاوز المستخدم الدقيق من `equivalence.overrides`
2. مطابقات المعرف الرسمي المُجمّعة من البيانات الوصفية المدمجة للنموذج
3. تطبيع استدلالي محافظ لمتغيرات البوابة/المزود
4. الرجوع إلى المعرف الخاص بالنموذج الفعلي

الاستدلالات الحالية ضيقة عمداً:

- يمكن إزالة البادئات المضمنة من المصدر الأصلي عند وجودها، على سبيل المثال `anthropic/...` أو `openai/...`
- يمكن تطبيع متغيرات الإصدار بالنقاط والشرطات فقط عندما تتطابق مع معرف رسمي موجود، على سبيل المثال `4.6 -> 4-6`
- لا يتم دمج العائلات أو الإصدارات الغامضة بدون مطابقة مُجمّعة أو تجاوز صريح

### سلوك الحل القياسي

عندما تتشارك متغيرات فعلية متعددة في معرف قياسي واحد، يستخدم الحل:

1. التوفر والمصادقة
2. `modelProviderOrder` في `config.yml`
3. ترتيب السجل/المزود الحالي إذا لم يتم تعيين `modelProviderOrder`

يتم تخطي المزودين المعطلين أو غير المصادق عليهم.

تستمر حالة الجلسة والنصوص في تسجيل المزود/النموذج الفعلي الذي نفّذ الدور فعلاً.

الإعدادات الافتراضية للمزود مقابل تجاوزات كل نموذج:

- `headers` الخاصة بالمزود هي الأساس.
- `headers` الخاصة بالنموذج تتجاوز مفاتيح رأس المزود.
- `modelOverrides` يمكنها تجاوز البيانات الوصفية للنموذج (`name`، `reasoning`، `input`، `cost`، `contextWindow`، `maxTokens`، `headers`، `compat`، `contextPromotionTarget`).
- `compat` يتم دمجها بعمق لكتل التوجيه المتداخلة (`openRouterRouting`، `vercelGatewayRouting`، `extraBody`).

## تكامل الاكتشاف أثناء التشغيل

### اكتشاف Ollama الضمني

إذا لم يتم إعداد `ollama` صراحةً، يضيف السجل مزوداً ضمنياً قابلاً للاكتشاف:

- المزود: `ollama`
- الواجهة: `openai-completions`
- عنوان URL الأساسي: `OLLAMA_BASE_URL` أو `http://127.0.0.1:11434`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف أثناء التشغيل `GET /api/tags` على Ollama ويُركّب إدخالات نماذج بإعدادات محلية افتراضية.

### اكتشاف llama.cpp الضمني

إذا لم يتم إعداد `llama.cpp` صراحةً، يضيف السجل مزوداً ضمنياً قابلاً للاكتشاف:
ملاحظة: يستخدم واجهة رسائل Anthropic الأحدث بدلاً من openai-completions.

- المزود: `llama.cpp`
- الواجهة: `openai-responses`
- عنوان URL الأساسي: `LLAMA_CPP_BASE_URL` أو `http://127.0.0.1:8080`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف أثناء التشغيل `GET models` على llama.cpp ويُركّب إدخالات نماذج بإعدادات محلية افتراضية.

### اكتشاف LM Studio الضمني

إذا لم يتم إعداد `lm-studio` صراحةً، يضيف السجل مزوداً ضمنياً قابلاً للاكتشاف:

- المزود: `lm-studio`
- الواجهة: `openai-completions`
- عنوان URL الأساسي: `LM_STUDIO_BASE_URL` أو `http://127.0.0.1:1234/v1`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يجلب الاكتشاف أثناء التشغيل النماذج (`GET /models`) ويُركّب إدخالات نماذج بإعدادات محلية افتراضية.

### اكتشاف المزود الصريح

يمكنك إعداد الاكتشاف بنفسك:

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
      
  llama.cpp:
    baseUrl: http://127.0.0.1:8080
    api: openai-responses
    auth: none
    discovery:
      type: llama.cpp
```

### تسجيل مزود الإضافة

يمكن للإضافات تسجيل المزودين أثناء التشغيل (`pi.registerProvider(...)`)، بما في ذلك:

- استبدال/إضافة نموذج لمزود
- تسجيل معالج دفق مخصص لمعرفات API جديدة
- تسجيل مزود OAuth مخصص

## ترتيب حل المصادقة ومفتاح API

عند طلب مفتاح لمزود ما، الترتيب الفعلي هو:

1. تجاوز أثناء التشغيل (CLI `--api-key`)
2. بيانات اعتماد مفتاح API المخزنة في `agent.db`
3. بيانات اعتماد OAuth المخزنة في `agent.db` (مع التحديث)
4. ربط متغير البيئة (`OPENAI_API_KEY`، `ANTHROPIC_API_KEY`، إلخ.)
5. محلل احتياطي ModelRegistry (`apiKey` الخاص بالمزود من `models.yml`، دلالات اسم-المتغير-أو-القيمة-الحرفية)

سلوك `apiKey` في `models.yml`:

- تُعامل القيمة أولاً كاسم متغير بيئة.
- إذا لم يوجد متغير بيئة، تُستخدم السلسلة النصية الحرفية كرمز.

إذا كان `authHeader: true` و `apiKey` الخاص بالمزود مُعيّناً، تحصل النماذج على:

- رأس `Authorization: Bearer <resolved-key>` يُحقن تلقائياً.

المزودون بدون مفتاح:

- المزودون المعلّمون بـ `auth: none` يُعاملون كمتاحين بدون بيانات اعتماد.
- `getApiKey*` تُعيد `kNoAuth` لهم.

## توفر النموذج مقابل جميع النماذج

- `getAll()` تُعيد سجل النماذج المُحمّل (المدمجة + المخصصة المدمجة + المكتشفة).
- `getAvailable()` تُصفّي إلى النماذج التي لا تحتاج مفتاحاً أو لديها مصادقة قابلة للحل.

لذا يمكن أن يوجد نموذج في السجل لكنه غير قابل للاختيار حتى تتوفر المصادقة.

## حل النموذج أثناء التشغيل

### CLI وتحليل الأنماط

`model-resolver.ts` يدعم:

- `provider/modelId` الدقيق
- معرف النموذج القياسي الدقيق
- معرف النموذج الدقيق (يُستنتج المزود)
- المطابقة الضبابية/بالسلسلة الفرعية
- أنماط النطاق بعلامات الاستبدال في `--models` (مثل `openai/*`، `*sonnet*`)
- لاحقة `:thinkingLevel` اختيارية (`off|minimal|low|medium|high|xhigh`)

`--provider` قديم؛ يُفضل `--model`.

أولوية الحل للمحددات الدقيقة:

1. `provider/modelId` الدقيق يتجاوز التجميع
2. المعرف القياسي الدقيق يُحل عبر الفهرس القياسي
3. المعرف الفعلي المجرد الدقيق لا يزال يعمل
4. المطابقة الضبابية وبعلامات الاستبدال تعمل بعد المسارات الدقيقة

### أولوية اختيار النموذج الأولي

`findInitialModel(...)` يستخدم هذا الترتيب:

1. المزود+النموذج الصريح من CLI
2. أول نموذج في النطاق (إذا لم يكن استئنافاً)
3. المزود/النموذج الافتراضي المحفوظ
4. الإعدادات الافتراضية للمزودين المعروفين (مثل OpenAI/Anthropic/إلخ.) من بين النماذج المتاحة
5. أول نموذج متاح

### أسماء الأدوار المستعارة والإعدادات

أدوار النموذج المدعومة:

- `default`، `smol`، `slow`، `plan`، `commit`

الأسماء المستعارة للأدوار مثل `pi/smol` تتوسع عبر `settings.modelRoles`. يمكن لكل قيمة دور أيضاً إلحاق محدد تفكير مثل `:minimal`، `:low`، `:medium`، أو `:high`.

إذا أشار دور إلى دور آخر، فإن النموذج المستهدف لا يزال يرث بشكل طبيعي وأي لاحقة صريحة على الدور المُشير تفوز لاستخدام ذلك الدور المحدد.

الإعدادات ذات الصلة:

- `modelRoles` (سجل)
- `enabledModels` (قائمة أنماط محددة النطاق)
- `modelProviderOrder` (أولوية المزود القياسي العالمية)
- `providers.kimiApiFormat` (تنسيق طلب `openai` أو `anthropic`)
- `providers.openaiWebsockets` (تفضيل websocket `auto|off|on` لنقل OpenAI Codex)

`modelRoles` قد تخزّن إما:

- `provider/modelId` لتثبيت متغير مزود فعلي
- معرف قياسي مثل `gpt-5.3-codex` للسماح بتجميع المزودين

بالنسبة لـ `enabledModels` و CLI `--models`:

- المعرفات القياسية الدقيقة تتوسع إلى جميع المتغيرات الفعلية في تلك المجموعة القياسية
- إدخالات `provider/modelId` الصريحة تبقى دقيقة
- علامات الاستبدال والمطابقة الضبابية لا تزال تعمل على النماذج الفعلية

## `/model` و `--list-models`

كلا الواجهتين تُبقيان النماذج ذات بادئة المزود مرئية وقابلة للاختيار.

وتعرضان الآن أيضاً النماذج القياسية/المُجمّعة:

- `/model` تتضمن عرضاً قياسياً بجانب علامات تبويب المزود
- `--list-models` تطبع قسماً قياسياً بالإضافة إلى صفوف المزود الفعلية

اختيار إدخال قياسي يحفظ المحدد القياسي. اختيار صف مزود يحفظ `provider/modelId` الصريح.

## ترقية السياق (سلاسل النموذج الاحتياطية)

ترقية السياق هي آلية استرداد عند تجاوز السعة للمتغيرات ذات السياق الصغير (على سبيل المثال `*-spark`) التي تُرقّي تلقائياً إلى نموذج شقيق بسياق أكبر عندما ترفض الواجهة البرمجية طلباً بخطأ طول السياق.

### المحفز والترتيب

عندما يفشل دور بخطأ تجاوز السياق (مثل `context_length_exceeded`)، يحاول `AgentSession` الترقية **قبل** الرجوع إلى الضغط:

1. إذا كان `contextPromotion.enabled` صحيحاً، يحل هدف الترقية (انظر أدناه).
2. إذا تم العثور على هدف، ينتقل إليه ويعيد محاولة الطلب — لا حاجة للضغط.
3. إذا لم يتوفر هدف، ينتقل إلى الضغط التلقائي على النموذج الحالي.

### اختيار الهدف

الاختيار مبني على النموذج، وليس على الدور:

1. `currentModel.contextPromotionTarget` (إذا تم إعداده)
2. أصغر نموذج بسياق أكبر على نفس المزود + الواجهة البرمجية

يتم تجاهل المرشحين ما لم يتم حل بيانات الاعتماد (`ModelRegistry.getApiKey(...)`).

### تسليم websocket الخاص بـ OpenAI Codex

إذا تم التبديل من/إلى `openai-codex-responses`، يتم إغلاق مفتاح حالة مزود الجلسة `openai-codex-responses` قبل تبديل النموذج. هذا يُسقط حالة نقل websocket حتى يبدأ الدور التالي نظيفاً على النموذج المُرقّى.

### سلوك الاستمرارية

تستخدم الترقية التبديل المؤقت (`setModelTemporary`):

- يُسجّل كـ `model_change` مؤقت في سجل الجلسة
- لا يُعيد كتابة ربط الدور المحفوظ

### إعداد سلاسل احتياطية صريحة

أعدّ الاحتياط مباشرة في البيانات الوصفية للنموذج عبر `contextPromotionTarget`.

`contextPromotionTarget` يقبل إما:

- `provider/model-id` (صريح)
- `model-id` (يُحل ضمن المزود الحالي)

مثال (`models.yml`) لـ Spark -> غير Spark على نفس المزود:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

مُولّد النماذج المدمج يُعيّن هذا أيضاً تلقائياً لنماذج `*-spark` عندما يوجد نموذج أساسي على نفس المزود.

## حقول التوافق والتوجيه

`models.yml` يدعم مجموعة `compat` الفرعية هذه:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` أو `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

تُستهلك هذه من قِبل منطق نقل OpenAI-completions وتُدمج مع الكشف التلقائي المبني على عنوان URL.

## أمثلة عملية

### نقطة نهاية محلية متوافقة مع OpenAI (بدون مصادقة)

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### وكيل مستضاف بمفتاح مبني على متغير بيئة

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### تجاوز مسار المزود المدمج + البيانات الوصفية للنموذج

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## الإعداد التلقائي لوكيل LiteLLM

عندما يتم تعيين متغيري البيئة `LITELLM_BASE_URL` و `LITELLM_API_KEY` معاً، يدير xcsh تلقائياً إعدادات `models.yml` لوكيل LiteLLM.

### التوليد التلقائي عند التشغيل الأول

إذا لم يكن `models.yml` موجوداً وتم اكتشاف متغيرات بيئة LiteLLM، يُولّده xcsh تلقائياً:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

يتم أيضاً توليد `config.yml` افتراضي بإعدادات معقولة لمزود الصور.

### الإصلاح الذاتي عند بدء التشغيل

عند كل بدء تشغيل، تُجري `startupHealthCheck()` في سجل النماذج الفحوصات التالية:

| الشرط | الإجراء |
|-------|---------|
| `models.yml` مفقود | توليد تلقائي من متغيرات البيئة |
| `models.yml` تالف أو غير قابل للتحليل | نسخ احتياطي إلى `.bak`، إعادة التوليد |
| `baseUrl` لا يتطابق مع `LITELLM_BASE_URL` | نسخ احتياطي إلى `.bak`، إعادة التوليد بالعنوان الجديد |
| `configVersion` مفقود أو قديم | نسخ احتياطي إلى `.bak`، إعادة التوليد بالإصدار الحالي |
| الإعدادات سليمة | لا إجراء |

جميع الإصلاحات تُنشئ نسخاً احتياطية `.bak` قبل الكتابة فوق الملف. جميع العمليات متساوية الأثر (idempotent).

### أمر CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### متغيرات البيئة المطلوبة

| المتغير | الغرض |
|---------|-------|
| `LITELLM_BASE_URL` | عنوان URL لوكيل LiteLLM (مثل `https://your-proxy.example.com`). يجب أن يبدأ بـ `http://` أو `https://`. |
| `LITELLM_API_KEY` | مفتاح API للوكيل. يُشار إليه بالاسم في الإعدادات المولّدة، ويُحل أثناء التشغيل. |

إذا لم يتم تعيين أي من المتغيرين، يتم تخطي الإعداد التلقائي بصمت.

### إصدار الإعدادات

تتضمن الإعدادات المولّدة حقل `configVersion`. عندما يتغير التنسيق المولّد في الإصدارات المستقبلية، يكتشف xcsh الإعدادات القديمة ويُرقّيها تلقائياً (مع نسخة احتياطية).

## تحذير بشأن المستهلكين القدامى

معظم إعدادات النماذج تمر الآن عبر `models.yml` من خلال `ModelRegistry`.

يبقى مسار قديم ملحوظ واحد: حل مصادقة Anthropic للبحث على الويب لا يزال يقرأ `~/.xcsh/agent/models.json` مباشرة في `src/web/search/auth.ts`.

إذا كنت تعتمد على هذا المسار المحدد، ضع في اعتبارك التوافق مع JSON حتى يتم ترحيل تلك الوحدة.

## وضع الفشل

إذا فشل `models.yml` في فحوصات المخطط أو التحقق:

- إذا تم تعيين `LITELLM_BASE_URL` و `LITELLM_API_KEY`، يحاول فحص صحة بدء التشغيل الإصلاح التلقائي (نسخ احتياطي للملف التالف، إعادة التوليد من متغيرات البيئة). إذا نجح الإصلاح، يُعيد السجل تحميل الإعدادات المُصلحة.
- إذا لم يكن الإصلاح التلقائي ممكناً (متغيرات البيئة غير مُعيّنة، فشل الكتابة)، يستمر السجل في العمل بالنماذج المدمجة.
- يتم عرض الخطأ عبر `ModelRegistry.getError()` ويظهر في واجهة المستخدم/الإشعارات.
