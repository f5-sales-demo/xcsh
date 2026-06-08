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

# تكوين النماذج ومقدمي الخدمات (`models.yml`)

يصف هذا المستند كيف يقوم وكيل البرمجة حالياً بتحميل النماذج، وتطبيق التجاوزات، وحل بيانات الاعتماد، واختيار النماذج أثناء التشغيل.

## ما الذي يتحكم في سلوك النماذج

ملفات التنفيذ الأساسية:

- `src/config/model-registry.ts` — يحمّل النماذج المدمجة + المخصصة، تجاوزات مقدمي الخدمات، الاكتشاف أثناء التشغيل، تكامل المصادقة
- `src/config/model-resolver.ts` — يحلل أنماط النماذج ويختار النماذج الأولية/الصغيرة/البطيئة
- `src/config/settings-schema.ts` — الإعدادات المتعلقة بالنماذج (`modelRoles`، تفضيلات نقل مقدم الخدمة)
- `src/session/auth-storage.ts` — ترتيب حل مفتاح API + OAuth
- `packages/ai/src/models.ts` و `packages/ai/src/types.ts` — مقدمو الخدمات/النماذج المدمجة وأنواع `Model`/`compat`

## موقع ملف التكوين والسلوك القديم

مسار التكوين الافتراضي:

- `~/.xcsh/agent/models.yml`

السلوك القديم لا يزال موجوداً:

- إذا كان `models.yml` مفقوداً و `models.json` موجوداً في نفس الموقع، يتم ترحيله إلى `models.yml`.
- مسارات التكوين الصريحة بامتداد `.json` / `.jsonc` لا تزال مدعومة عند تمريرها برمجياً إلى `ModelRegistry`.

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

`configVersion` هو عدد صحيح اختياري يُكتب بواسطة نظام التكوين التلقائي. عند وجوده، يستخدمه xcsh للكشف عن التكوينات القديمة وترقيتها تلقائياً.

`provider-id` هو مفتاح مقدم الخدمة القانوني المستخدم عبر الاختيار والبحث عن المصادقة.

`equivalence` اختياري ويُكوّن تجميع النماذج القانونية فوق نماذج مقدمي الخدمات الفعلية:

- `overrides` يربط محدداً فعلياً دقيقاً (`provider/modelId`) بمعرف قانوني أصلي من المنبع
- `exclude` يستثني محدداً فعلياً من التجميع القانوني

## الحقول على مستوى مقدم الخدمة

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

### قيم `api` المسموح بها لمقدم الخدمة/النموذج

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

### مقدم خدمة مخصص كامل (`models` غير فارغ)

مطلوب:

- `baseUrl`
- `apiKey` ما لم يكن `auth: none`
- `api` على مستوى مقدم الخدمة أو لكل نموذج

### مقدم خدمة للتجاوز فقط (`models` مفقود أو فارغ)

يجب تعريف واحد على الأقل من:

- `baseUrl`
- `modelOverrides`
- `discovery`

### الاكتشاف

- `discovery` يتطلب `api` على مستوى مقدم الخدمة.

### فحوصات قيم النموذج

- `id` مطلوب
- `contextWindow` و `maxTokens` يجب أن تكون موجبة إذا تم تقديمها

## ترتيب الدمج والتجاوز

خط أنابيب ModelRegistry (عند التحديث):

1. تحميل مقدمي الخدمات/النماذج المدمجة من `@f5xc-salesdemos/pi-ai`.
2. تحميل تكوين `models.yml` المخصص.
3. تطبيق تجاوزات مقدم الخدمة (`baseUrl`، `headers`) على النماذج المدمجة.
4. تطبيق `modelOverrides` (لكل مقدم خدمة + معرف نموذج).
5. دمج `models` المخصصة:
   - نفس `provider + id` يستبدل الموجود
   - وإلا يُلحق
6. تطبيق النماذج المكتشفة أثناء التشغيل (حالياً Ollama و LM Studio)، ثم إعادة تطبيق تجاوزات النماذج.

## تكافؤ النماذج القانونية والدمج

يحتفظ السجل بكل نموذج فعلي لمقدم الخدمة ثم يبني طبقة قانونية فوقها.

المعرفات القانونية هي معرفات المنبع الرسمية فقط، على سبيل المثال:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### تكوين التكافؤ في `models.yml`

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

ترتيب البناء للتجميع القانوني:

1. تجاوز المستخدم الدقيق من `equivalence.overrides`
2. مطابقات المعرف الرسمي المجمعة من بيانات النموذج المدمجة الوصفية
3. تطبيع استدلالي متحفظ لمتغيرات البوابة/مقدم الخدمة
4. الرجوع إلى المعرف الخاص بالنموذج الفعلي

الاستدلالات الحالية ضيقة عمداً:

- يمكن إزالة بادئات المنبع المضمنة عند وجودها، على سبيل المثال `anthropic/...` أو `openai/...`
- يمكن تطبيع متغيرات الإصدارات المنقطة والمشرطة فقط عندما تُربط بمعرف رسمي موجود، على سبيل المثال `4.6 -> 4-6`
- العائلات أو الإصدارات الغامضة لا تُدمج بدون مطابقة مجمعة أو تجاوز صريح

### سلوك الحل القانوني

عندما تشترك عدة متغيرات فعلية في معرف قانوني واحد، يستخدم الحل:

1. التوفر والمصادقة
2. `modelProviderOrder` في `config.yml`
3. ترتيب السجل/مقدم الخدمة الموجود إذا لم يكن `modelProviderOrder` مُعيّناً

يتم تخطي مقدمي الخدمات المعطلين أو غير المصادق عليهم.

تستمر حالة الجلسة والنصوص في تسجيل مقدم الخدمة/النموذج الفعلي الذي نفّذ الدورة فعلياً.

الإعدادات الافتراضية لمقدم الخدمة مقابل تجاوزات كل نموذج:

- `headers` لمقدم الخدمة هي الأساس.
- `headers` للنموذج تتجاوز مفاتيح ترويسة مقدم الخدمة.
- `modelOverrides` يمكنها تجاوز بيانات النموذج الوصفية (`name`، `reasoning`، `input`، `cost`، `contextWindow`، `maxTokens`، `headers`، `compat`، `contextPromotionTarget`).
- `compat` يتم دمجه بعمق لكتل التوجيه المتداخلة (`openRouterRouting`، `vercelGatewayRouting`، `extraBody`).

## تكامل الاكتشاف أثناء التشغيل

### اكتشاف Ollama الضمني

إذا لم يتم تكوين `ollama` صراحة، يضيف السجل مقدم خدمة قابلاً للاكتشاف ضمنياً:

- المقدم: `ollama`
- api: `openai-completions`
- عنوان URL الأساسي: `OLLAMA_BASE_URL` أو `http://127.0.0.1:11434`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف أثناء التشغيل `GET /api/tags` على Ollama ويُنشئ إدخالات نماذج بإعدادات افتراضية محلية.

### اكتشاف llama.cpp الضمني

إذا لم يتم تكوين `llama.cpp` صراحة، يضيف السجل مقدم خدمة قابلاً للاكتشاف ضمنياً:
ملاحظة: يستخدم واجهة برمجة رسائل anthropic الأحدث بدلاً من openai-completions.

- المقدم: `llama.cpp`
- api: `openai-responses`
- عنوان URL الأساسي: `LLAMA_CPP_BASE_URL` أو `http://127.0.0.1:8080`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف أثناء التشغيل `GET models` على llama.cpp ويُنشئ إدخالات نماذج بإعدادات افتراضية محلية.

### اكتشاف LM Studio الضمني

إذا لم يتم تكوين `lm-studio` صراحة، يضيف السجل مقدم خدمة قابلاً للاكتشاف ضمنياً:

- المقدم: `lm-studio`
- api: `openai-completions`
- عنوان URL الأساسي: `LM_STUDIO_BASE_URL` أو `http://127.0.0.1:1234/v1`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يجلب الاكتشاف أثناء التشغيل النماذج (`GET /models`) ويُنشئ إدخالات نماذج بإعدادات افتراضية محلية.

### اكتشاف مقدم الخدمة الصريح

يمكنك تكوين الاكتشاف بنفسك:

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

### تسجيل مقدم خدمة الإضافات

يمكن للإضافات تسجيل مقدمي خدمات أثناء التشغيل (`pi.registerProvider(...)`)، بما في ذلك:

- استبدال/إلحاق النماذج لمقدم خدمة
- تسجيل معالج تدفق مخصص لمعرفات API جديدة
- تسجيل مقدم خدمة OAuth مخصص

## ترتيب حل المصادقة ومفتاح API

عند طلب مفتاح لمقدم خدمة، الترتيب الفعلي هو:

1. تجاوز وقت التشغيل (CLI `--api-key`)
2. بيانات اعتماد مفتاح API المخزنة في `agent.db`
3. بيانات اعتماد OAuth المخزنة في `agent.db` (مع التحديث)
4. ربط متغير البيئة (`OPENAI_API_KEY`، `ANTHROPIC_API_KEY`، إلخ.)
5. محلل ModelRegistry الاحتياطي (`apiKey` لمقدم الخدمة من `models.yml`، دلالات اسم-المتغير-أو-النص-الحرفي)

سلوك `apiKey` في `models.yml`:

- تُعامل القيمة أولاً كاسم متغير بيئة.
- إذا لم يوجد متغير بيئة، يُستخدم النص الحرفي كرمز مميز.

إذا كان `authHeader: true` و `apiKey` لمقدم الخدمة مُعيّناً، تحصل النماذج على:

- حقن ترويسة `Authorization: Bearer <resolved-key>`.

مقدمو الخدمات بدون مفاتيح:

- مقدمو الخدمات المُعلّمون بـ `auth: none` يُعاملون كمتوفرين بدون بيانات اعتماد.
- `getApiKey*` تُرجع `kNoAuth` لهم.

## توفر النماذج مقابل جميع النماذج

- `getAll()` تُرجع سجل النماذج المحمّل (المدمجة + المخصصة المدمجة + المكتشفة).
- `getAvailable()` تُصفّي إلى النماذج التي لا تحتاج مفاتيح أو التي لديها مصادقة قابلة للحل.

لذلك يمكن أن يوجد نموذج في السجل لكن لا يكون قابلاً للاختيار حتى تتوفر المصادقة.

## حل النماذج أثناء التشغيل

### واجهة سطر الأوامر وتحليل الأنماط

`model-resolver.ts` يدعم:

- مطابقة دقيقة `provider/modelId`
- معرف نموذج قانوني دقيق
- معرف نموذج دقيق (يُستنتج مقدم الخدمة)
- مطابقة ضبابية/سلسلة فرعية
- أنماط نطاق glob في `--models` (مثل `openai/*`، `*sonnet*`)
- لاحقة `:thinkingLevel` اختيارية (`off|minimal|low|medium|high|xhigh`)

`--provider` قديم؛ `--model` مُفضّل.

أسبقية الحل للمحددات الدقيقة:

1. `provider/modelId` الدقيق يتجاوز الدمج
2. المعرف القانوني الدقيق يُحل عبر الفهرس القانوني
3. المعرف الفعلي المجرد الدقيق لا يزال يعمل
4. المطابقة الضبابية وglob تعمل بعد المسارات الدقيقة

### أولوية اختيار النموذج الأولي

`findInitialModel(...)` تستخدم هذا الترتيب:

1. مقدم الخدمة+النموذج الصريح من CLI
2. أول نموذج ضمن النطاق (إذا لم يكن استئنافاً)
3. مقدم الخدمة/النموذج الافتراضي المحفوظ
4. الإعدادات الافتراضية المعروفة لمقدمي الخدمات (مثل OpenAI/Anthropic/إلخ.) من بين النماذج المتوفرة
5. أول نموذج متوفر

### أسماء الأدوار المستعارة والإعدادات

أدوار النماذج المدعومة:

- `default`، `smol`، `slow`، `plan`، `commit`

الأسماء المستعارة للأدوار مثل `pi/smol` تتوسع عبر `settings.modelRoles`. يمكن لكل قيمة دور أيضاً إلحاق محدد تفكير مثل `:minimal`، `:low`، `:medium`، أو `:high`.

إذا أشار دور إلى دور آخر، يرث النموذج المستهدف بشكل طبيعي وأي لاحقة صريحة على الدور المُشير تفوز لذلك الاستخدام الخاص بالدور.

الإعدادات ذات الصلة:

- `modelRoles` (سجل)
- `enabledModels` (قائمة أنماط محددة النطاق)
- `modelProviderOrder` (أسبقية مقدم الخدمة القانوني العامة)
- `providers.kimiApiFormat` (تنسيق طلب `openai` أو `anthropic`)
- `providers.openaiWebsockets` (تفضيل websocket `auto|off|on` لنقل OpenAI Codex)

`modelRoles` قد يخزن إما:

- `provider/modelId` لتثبيت متغير مقدم خدمة فعلي
- معرفاً قانونياً مثل `gpt-5.3-codex` للسماح بدمج مقدمي الخدمات

بالنسبة لـ `enabledModels` و CLI `--models`:

- المعرفات القانونية الدقيقة تتوسع إلى جميع المتغيرات الفعلية في تلك المجموعة القانونية
- إدخالات `provider/modelId` الصريحة تبقى دقيقة
- مطابقات glob والضبابية لا تزال تعمل على النماذج الفعلية

## `/model` و `--list-models`

كلا الواجهتين تبقيان النماذج المسبوقة بمقدم الخدمة مرئية وقابلة للاختيار.

كما أنهما تعرضان الآن النماذج القانونية/المدمجة:

- `/model` يتضمن عرضاً قانونياً بجانب علامات تبويب مقدمي الخدمات
- `--list-models` يطبع قسماً قانونياً بالإضافة إلى صفوف مقدمي الخدمات الفعلية

اختيار إدخال قانوني يخزن المحدد القانوني. اختيار صف مقدم خدمة يخزن `provider/modelId` الصريح.

## ترقية السياق (سلاسل النماذج الاحتياطية على مستوى النموذج)

ترقية السياق هي آلية استرداد من التجاوز للمتغيرات ذات السياق الصغير (على سبيل المثال `*-spark`) التي تُرقّي تلقائياً إلى نظير بسياق أكبر عندما ترفض واجهة API الطلب بخطأ طول السياق.

### المشغّل والترتيب

عندما تفشل دورة بخطأ تجاوز السياق (مثل `context_length_exceeded`)، يحاول `AgentSession` الترقية **قبل** الرجوع إلى الضغط:

1. إذا كان `contextPromotion.enabled` صحيحاً، يحل هدف الترقية (انظر أدناه).
2. إذا وُجد هدف، يتحول إليه ويعيد محاولة الطلب — لا حاجة للضغط.
3. إذا لم يتوفر هدف، يمر إلى الضغط التلقائي على النموذج الحالي.

### اختيار الهدف

الاختيار مدفوع بالنموذج، وليس بالدور:

1. `currentModel.contextPromotionTarget` (إذا تم تكوينه)
2. أصغر نموذج بسياق أكبر على نفس مقدم الخدمة + API

يتم تجاهل المرشحين ما لم تُحل بيانات الاعتماد (`ModelRegistry.getApiKey(...)`).

### تسليم websocket لـ OpenAI Codex

إذا تم التبديل من/إلى `openai-codex-responses`، يتم إغلاق مفتاح حالة مقدم الجلسة `openai-codex-responses` قبل تبديل النموذج. هذا يُسقط حالة نقل websocket حتى تبدأ الدورة التالية نظيفة على النموذج المُرقّى.

### سلوك الاستمرار

تستخدم الترقية تبديلاً مؤقتاً (`setModelTemporary`):

- يُسجّل كـ `model_change` مؤقت في سجل الجلسة
- لا يُعيد كتابة ربط الأدوار المحفوظ

### تكوين سلاسل احتياطية صريحة

كوّن الاحتياطي مباشرة في بيانات النموذج الوصفية عبر `contextPromotionTarget`.

`contextPromotionTarget` يقبل إما:

- `provider/model-id` (صريح)
- `model-id` (يُحل ضمن مقدم الخدمة الحالي)

مثال (`models.yml`) لـ Spark -> غير Spark على نفس مقدم الخدمة:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

مولّد النماذج المدمج يُعيّن هذا أيضاً تلقائياً لنماذج `*-spark` عندما يوجد نموذج أساسي على نفس مقدم الخدمة.

## حقول التوافق والتوجيه

`models.yml` يدعم مجموعة `compat` الفرعية هذه:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` أو `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

تُستهلك هذه بواسطة منطق نقل OpenAI-completions وتُدمج مع الكشف التلقائي المبني على عنوان URL.

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

### وكيل مستضاف بمفتاح مبني على متغير البيئة

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

### تجاوز مسار مقدم خدمة مدمج + بيانات نموذج وصفية

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

## التكوين التلقائي لوكيل LiteLLM

عندما يتم تعيين متغيري البيئة `LITELLM_BASE_URL` و `LITELLM_API_KEY` معاً، يدير xcsh تلقائياً تكوين `models.yml` لوكيل LiteLLM.

### التوليد التلقائي عند التشغيل الأول

إذا لم يكن `models.yml` موجوداً وتم اكتشاف متغيرات بيئة LiteLLM، يولّده xcsh تلقائياً:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

يتم أيضاً توليد `config.yml` افتراضي بإعدادات مقدم صور مناسبة.

### الإصلاح الذاتي عند بدء التشغيل

في كل بدء تشغيل، ينفذ `startupHealthCheck()` في سجل النماذج الفحوصات التالية:

| الحالة | الإجراء |
|--------|---------|
| `models.yml` مفقود | توليد تلقائي من متغيرات البيئة |
| `models.yml` تالف أو غير قابل للتحليل | نسخ احتياطي إلى `.bak`، إعادة التوليد |
| `baseUrl` لا يتطابق مع `LITELLM_BASE_URL` | نسخ احتياطي إلى `.bak`، إعادة التوليد بعنوان URL الجديد |
| `configVersion` مفقود أو قديم | نسخ احتياطي إلى `.bak`، إعادة التوليد بالإصدار الحالي |
| التكوين سليم | لا إجراء |

جميع الإصلاحات تنشئ نسخاً احتياطية `.bak` قبل الكتابة فوقها. جميع العمليات متساوية القوة.

### أمر واجهة سطر الأوامر

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### متغيرات البيئة المطلوبة

| المتغير | الغرض |
|---------|-------|
| `LITELLM_BASE_URL` | عنوان URL لوكيل LiteLLM (مثل `https://your-proxy.example.com`). يجب أن يبدأ بـ `http://` أو `https://`. |
| `LITELLM_API_KEY` | مفتاح API للوكيل. يُشار إليه بالاسم في التكوين المُولّد، ويُحل أثناء التشغيل. |

إذا لم يتم تعيين أي من المتغيرين، يتم تخطي التكوين التلقائي بصمت.

### إصدار التكوين

تتضمن التكوينات المُولّدة حقل `configVersion`. عندما يتغير التنسيق المُولّد في إصدارات مستقبلية، يكتشف xcsh التكوينات القديمة ويُرقّيها تلقائياً (مع نسخ احتياطي).

## تنبيه بشأن المستهلك القديم

معظم تكوين النماذج يمر الآن عبر `models.yml` من خلال `ModelRegistry`.

يبقى مسار قديم واحد ملحوظ: حل مصادقة Anthropic لبحث الويب لا يزال يقرأ `~/.xcsh/agent/models.json` مباشرة في `src/web/search/auth.ts`.

إذا كنت تعتمد على هذا المسار المحدد، ضع في اعتبارك التوافق مع JSON حتى يتم ترحيل هذه الوحدة.

## وضع الفشل

إذا فشل `models.yml` في فحوصات المخطط أو التحقق:

- إذا تم تعيين `LITELLM_BASE_URL` و `LITELLM_API_KEY`، يحاول فحص صحة بدء التشغيل الإصلاح التلقائي (نسخ احتياطي للملف التالف، إعادة التوليد من متغيرات البيئة). إذا نجح الإصلاح، يُعيد السجل تحميل التكوين المُصلح.
- إذا لم يكن الإصلاح التلقائي ممكناً (متغيرات البيئة غير مُعيّنة، فشل الكتابة)، يستمر السجل في العمل بالنماذج المدمجة.
- يُكشف الخطأ عبر `ModelRegistry.getError()` ويُعرض في واجهة المستخدم/الإشعارات.
