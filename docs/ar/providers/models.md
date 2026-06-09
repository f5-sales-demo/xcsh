---
title: تكوين النموذج والمزود
description: >-
  سجل النماذج وتكوين المزودات عبر models.yml مع التوجيه والبدائل الاحتياطية
  والتسعير.
sidebar:
  order: 1
  label: النماذج والمزودات
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# تكوين النموذج والمزود (`models.yml`)

يصف هذا المستند كيفية قيام وكيل البرمجة حالياً بتحميل النماذج، وتطبيق التجاوزات، وحل بيانات الاعتماد، واختيار النماذج أثناء التشغيل.

## ما يتحكم في سلوك النموذج

ملفات التنفيذ الرئيسية:

- `src/config/model-registry.ts` — يحمل النماذج المدمجة + المخصصة، تجاوزات المزودات، الاكتشاف أثناء التشغيل، تكامل المصادقة
- `src/config/model-resolver.ts` — يحلل أنماط النماذج ويختار النماذج الأولية/الصغيرة/البطيئة
- `src/config/settings-schema.ts` — الإعدادات المتعلقة بالنماذج (`modelRoles`، تفضيلات نقل المزود)
- `src/session/auth-storage.ts` — ترتيب حل مفتاح API + OAuth
- `packages/ai/src/models.ts` و `packages/ai/src/types.ts` — المزودات/النماذج المدمجة وأنواع `Model`/`compat`

## موقع ملف التكوين والسلوك القديم

مسار التكوين الافتراضي:

- `~/.xcsh/agent/models.yml`

السلوك القديم لا يزال موجوداً:

- إذا كان `models.yml` مفقوداً و `models.json` موجوداً في نفس الموقع، يتم ترحيله إلى `models.yml`.
- مسارات التكوين الصريحة `.json` / `.jsonc` لا تزال مدعومة عند تمريرها برمجياً إلى `ModelRegistry`.

## بنية `models.yml`

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

`configVersion` هو عدد صحيح اختياري يُكتب بواسطة نظام التكوين التلقائي. عند وجوده، يستخدمه xcsh لاكتشاف التكوينات القديمة وترقيتها تلقائياً.

`provider-id` هو مفتاح المزود القانوني المستخدم عبر الاختيار والبحث عن المصادقة.

`equivalence` اختياري ويُكوّن تجميع النماذج القانونية فوق نماذج المزود الفعلية:

- `overrides` يربط محدداً فعلياً دقيقاً (`provider/modelId`) بمعرف قانوني رسمي من المصدر الأصلي
- `exclude` يستبعد محدداً فعلياً من التجميع القانوني

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
- `contextWindow` و `maxTokens` يجب أن تكون موجبة إذا تم توفيرها

## ترتيب الدمج والتجاوز

مسار معالجة ModelRegistry (عند التحديث):

1. تحميل المزودات/النماذج المدمجة من `@f5xc-salesdemos/pi-ai`.
2. تحميل تكوين `models.yml` المخصص.
3. تطبيق تجاوزات المزود (`baseUrl`، `headers`) على النماذج المدمجة.
4. تطبيق `modelOverrides` (لكل مزود + معرف نموذج).
5. دمج `models` المخصصة:
   - نفس `provider + id` يستبدل الموجود
   - وإلا يُلحق
6. تطبيق النماذج المكتشفة أثناء التشغيل (حالياً Ollama و LM Studio)، ثم إعادة تطبيق تجاوزات النموذج.

## تكافؤ النماذج القانونية والتجميع

يحتفظ السجل بكل نموذج مزود فعلي ثم يبني طبقة قانونية فوقها.

المعرفات القانونية هي معرفات رسمية من المصدر الأصلي فقط، على سبيل المثال:

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

ترتيب بناء التجميع القانوني:

1. تجاوز المستخدم الدقيق من `equivalence.overrides`
2. مطابقات المعرف الرسمي المجمعة من البيانات الوصفية المدمجة للنموذج
3. تطبيع إرشادي محافظ لمتغيرات البوابة/المزود
4. الرجوع إلى المعرف الخاص بالنموذج الفعلي

الإرشادات الحالية ضيقة عمداً:

- يمكن إزالة البادئات المضمنة من المصدر الأصلي عند وجودها، على سبيل المثال `anthropic/...` أو `openai/...`
- متغيرات الإصدار المنقطة والمشرطة يمكن تطبيعها فقط عندما ترتبط بمعرف رسمي موجود، على سبيل المثال `4.6 -> 4-6`
- العائلات أو الإصدارات الغامضة لا تُدمج بدون مطابقة مجمعة أو تجاوز صريح

### سلوك الحل القانوني

عندما تتشارك عدة متغيرات فعلية في معرف قانوني، يستخدم الحل:

1. التوفر والمصادقة
2. `modelProviderOrder` من `config.yml`
3. ترتيب السجل/المزود الحالي إذا لم يُعيّن `modelProviderOrder`

يتم تخطي المزودات المعطلة أو غير المصادق عليها.

تستمر حالة الجلسة والنصوص في تسجيل المزود/النموذج الفعلي الذي نفذ الدور فعلياً.

الإعدادات الافتراضية للمزود مقابل تجاوزات كل نموذج:

- `headers` الخاصة بالمزود هي الأساس.
- `headers` الخاصة بالنموذج تتجاوز مفاتيح ترويسات المزود.
- `modelOverrides` يمكنها تجاوز البيانات الوصفية للنموذج (`name`، `reasoning`، `input`، `cost`، `contextWindow`، `maxTokens`، `headers`، `compat`، `contextPromotionTarget`).
- `compat` يتم دمجه بعمق لكتل التوجيه المتداخلة (`openRouterRouting`، `vercelGatewayRouting`، `extraBody`).

## تكامل الاكتشاف أثناء التشغيل

### اكتشاف Ollama الضمني

إذا لم يتم تكوين `ollama` صراحةً، يضيف السجل مزوداً ضمنياً قابلاً للاكتشاف:

- المزود: `ollama`
- API: `openai-completions`
- عنوان URL الأساسي: `OLLAMA_BASE_URL` أو `http://127.0.0.1:11434`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف أثناء التشغيل `GET /api/tags` على Ollama ويُنشئ إدخالات نماذج بإعدادات افتراضية محلية.

### اكتشاف llama.cpp الضمني

إذا لم يتم تكوين `llama.cpp` صراحةً، يضيف السجل مزوداً ضمنياً قابلاً للاكتشاف:
ملاحظة: يستخدم واجهة رسائل anthropic الأحدث بدلاً من openai-completions.

- المزود: `llama.cpp`
- API: `openai-responses`
- عنوان URL الأساسي: `LLAMA_CPP_BASE_URL` أو `http://127.0.0.1:8080`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف أثناء التشغيل `GET models` على llama.cpp ويُنشئ إدخالات نماذج بإعدادات افتراضية محلية.

### اكتشاف LM Studio الضمني

إذا لم يتم تكوين `lm-studio` صراحةً، يضيف السجل مزوداً ضمنياً قابلاً للاكتشاف:

- المزود: `lm-studio`
- API: `openai-completions`
- عنوان URL الأساسي: `LM_STUDIO_BASE_URL` أو `http://127.0.0.1:1234/v1`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يجلب الاكتشاف أثناء التشغيل النماذج (`GET /models`) ويُنشئ إدخالات نماذج بإعدادات افتراضية محلية.

### اكتشاف المزود الصريح

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

### تسجيل مزود الإضافات

يمكن للإضافات تسجيل مزودات أثناء التشغيل (`pi.registerProvider(...)`)، بما في ذلك:

- استبدال/إلحاق النماذج لمزود
- تسجيل معالج تدفق مخصص لمعرفات API جديدة
- تسجيل مزود OAuth مخصص

## ترتيب حل المصادقة ومفتاح API

عند طلب مفتاح لمزود، الترتيب الفعال هو:

1. تجاوز أثناء التشغيل (CLI `--api-key`)
2. بيانات اعتماد مفتاح API المخزنة في `agent.db`
3. بيانات اعتماد OAuth المخزنة في `agent.db` (مع التحديث)
4. ربط متغيرات البيئة (`OPENAI_API_KEY`، `ANTHROPIC_API_KEY`، إلخ.)
5. محلل ModelRegistry الاحتياطي (`apiKey` الخاص بالمزود من `models.yml`، دلالات اسم-متغير-بيئة-أو-نص-حرفي)

سلوك `apiKey` في `models.yml`:

- تُعامل القيمة أولاً كاسم متغير بيئة.
- إذا لم يوجد متغير بيئة، تُستخدم السلسلة النصية الحرفية كرمز مميز.

إذا كان `authHeader: true` و `apiKey` الخاص بالمزود مُعيّناً، تحصل النماذج على:

- ترويسة `Authorization: Bearer <resolved-key>` مُحقونة.

المزودات بدون مفتاح:

- المزودات المعلمة بـ `auth: none` تُعامل كمتاحة بدون بيانات اعتماد.
- `getApiKey*` تُرجع `kNoAuth` لها.

## توفر النموذج مقابل جميع النماذج

- `getAll()` تُرجع سجل النماذج المحمّل (المدمجة + المخصصة المدمجة + المكتشفة).
- `getAvailable()` تُصفي إلى النماذج التي لا تحتاج مفتاحاً أو التي لديها مصادقة قابلة للحل.

لذا يمكن أن يوجد نموذج في السجل لكنه لا يكون قابلاً للاختيار حتى تتوفر المصادقة.

## حل النموذج أثناء التشغيل

### سطر الأوامر وتحليل الأنماط

يدعم `model-resolver.ts`:

- `provider/modelId` دقيق
- معرف نموذج قانوني دقيق
- معرف نموذج دقيق (يُستنتج المزود)
- مطابقة غامضة/سلسلة فرعية
- أنماط نطاق glob في `--models` (مثل `openai/*`، `*sonnet*`)
- لاحقة `:thinkingLevel` اختيارية (`off|minimal|low|medium|high|xhigh`)

`--provider` قديم؛ `--model` هو المفضل.

أولوية الحل للمحددات الدقيقة:

1. `provider/modelId` الدقيق يتجاوز التجميع
2. المعرف القانوني الدقيق يُحل عبر الفهرس القانوني
3. المعرف الفعلي المجرد الدقيق لا يزال يعمل
4. المطابقة الغامضة وglob تعمل بعد المسارات الدقيقة

### أولوية اختيار النموذج الأولي

يستخدم `findInitialModel(...)` هذا الترتيب:

1. مزود+نموذج CLI صريح
2. أول نموذج ضمن النطاق (إذا لم يكن استئنافاً)
3. مزود/نموذج افتراضي محفوظ
4. إعدادات افتراضية للمزودات المعروفة (مثل OpenAI/Anthropic/إلخ.) من بين النماذج المتاحة
5. أول نموذج متاح

### أسماء الأدوار المستعارة والإعدادات

أدوار النماذج المدعومة:

- `default`، `smol`، `slow`، `plan`، `commit`

أسماء الأدوار المستعارة مثل `pi/smol` تتوسع عبر `settings.modelRoles`. يمكن لكل قيمة دور أيضاً إلحاق محدد تفكير مثل `:minimal`، `:low`، `:medium`، أو `:high`.

إذا أشار دور إلى دور آخر، يرث النموذج المستهدف بشكل طبيعي وأي لاحقة صريحة على الدور المُشير تتفوق لاستخدام ذلك الدور المحدد.

الإعدادات ذات الصلة:

- `modelRoles` (سجل)
- `enabledModels` (قائمة أنماط ذات نطاق)
- `modelProviderOrder` (أولوية المزود القانوني العامة)
- `providers.kimiApiFormat` (تنسيق طلب `openai` أو `anthropic`)
- `providers.openaiWebsockets` (تفضيل websocket `auto|off|on` لنقل OpenAI Codex)

قد يخزن `modelRoles` إما:

- `provider/modelId` لتثبيت متغير مزود فعلي
- معرف قانوني مثل `gpt-5.3-codex` للسماح بتجميع المزودات

بالنسبة لـ `enabledModels` و CLI `--models`:

- المعرفات القانونية الدقيقة تتوسع إلى جميع المتغيرات الفعلية في تلك المجموعة القانونية
- إدخالات `provider/modelId` الصريحة تبقى دقيقة
- أنماط glob والمطابقات الغامضة لا تزال تعمل على النماذج الفعلية

## `/model` و `--list-models`

كلتا الواجهتين تبقيان النماذج ذات بادئة المزود مرئية وقابلة للاختيار.

كما تعرضان الآن النماذج القانونية/المجمعة:

- `/model` يتضمن عرضاً قانونياً بجانب علامات تبويب المزود
- `--list-models` يطبع قسماً قانونياً بالإضافة إلى صفوف المزود الفعلية

اختيار إدخال قانوني يخزن المحدد القانوني. اختيار صف مزود يخزن `provider/modelId` الصريح.

## ترقية السياق (سلاسل النماذج الاحتياطية على مستوى النموذج)

ترقية السياق هي آلية استرداد من التجاوز للمتغيرات ذات السياق الصغير (على سبيل المثال `*-spark`) التي تُرقّي تلقائياً إلى نموذج شقيق ذي سياق أكبر عندما ترفض واجهة API الطلب بخطأ طول السياق.

### المحفز والترتيب

عندما يفشل دور بخطأ تجاوز السياق (مثل `context_length_exceeded`)، يحاول `AgentSession` الترقية **قبل** الرجوع إلى الضغط:

1. إذا كان `contextPromotion.enabled` مفعلاً، حل هدف الترقية (انظر أدناه).
2. إذا وُجد هدف، التبديل إليه وإعادة محاولة الطلب — لا حاجة للضغط.
3. إذا لم يتوفر هدف، المرور إلى الضغط التلقائي على النموذج الحالي.

### اختيار الهدف

الاختيار مدفوع بالنموذج، وليس بالدور:

1. `currentModel.contextPromotionTarget` (إذا تم تكوينه)
2. أصغر نموذج ذي سياق أكبر على نفس المزود + API

يتم تجاهل المرشحين ما لم تُحل بيانات الاعتماد (`ModelRegistry.getApiKey(...)`).

### تسليم websocket الخاص بـ OpenAI Codex

إذا تم التبديل من/إلى `openai-codex-responses`، يتم إغلاق مفتاح حالة مزود الجلسة `openai-codex-responses` قبل تبديل النموذج. هذا يُسقط حالة نقل websocket حتى يبدأ الدور التالي نظيفاً على النموذج المُرقّى.

### سلوك الاستمرارية

تستخدم الترقية تبديلاً مؤقتاً (`setModelTemporary`):

- تُسجل كـ `model_change` مؤقت في سجل الجلسة
- لا تُعيد كتابة ربط الأدوار المحفوظ

### تكوين سلاسل احتياطية صريحة

كوّن البديل الاحتياطي مباشرة في البيانات الوصفية للنموذج عبر `contextPromotionTarget`.

يقبل `contextPromotionTarget` إما:

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

يُعيّن مولد النماذج المدمج هذا تلقائياً أيضاً لنماذج `*-spark` عندما يوجد نموذج أساسي على نفس المزود.

## حقول التوافق والتوجيه

يدعم `models.yml` هذه المجموعة الفرعية من `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` أو `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

تُستهلك هذه بواسطة منطق نقل OpenAI-completions وتُدمج مع الاكتشاف التلقائي المبني على عنوان URL.

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

### وكيل مستضاف بمفتاح من متغير البيئة

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

## التكوين التلقائي لوكيل LiteLLM

عندما يكون كل من متغيري البيئة `LITELLM_BASE_URL` و `LITELLM_API_KEY` مُعيّنين، يدير xcsh تلقائياً تكوين `models.yml` لوكيل LiteLLM.

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

يتم أيضاً توليد `config.yml` افتراضي مع إعدادات معقولة لمزود الصور.

### الإصلاح الذاتي عند بدء التشغيل

في كل بدء تشغيل، تُجري `startupHealthCheck()` في سجل النماذج الفحوصات التالية:

| الشرط | الإجراء |
|-------|---------|
| `models.yml` مفقود | توليد تلقائي من متغيرات البيئة |
| `models.yml` تالف أو غير قابل للتحليل | نسخ احتياطي إلى `.bak`، إعادة توليد |
| `baseUrl` لا يتطابق مع `LITELLM_BASE_URL` | نسخ احتياطي إلى `.bak`، إعادة توليد بعنوان URL الجديد |
| `configVersion` مفقود أو قديم | نسخ احتياطي إلى `.bak`، إعادة توليد بالإصدار الحالي |
| التكوين سليم | لا إجراء |

جميع الإصلاحات تُنشئ نسخاً احتياطية `.bak` قبل الكتابة فوق الملف. جميع العمليات متساوية الأثر (idempotent).

### أمر سطر الأوامر

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### متغيرات البيئة المطلوبة

| المتغير | الغرض |
|---------|-------|
| `LITELLM_BASE_URL` | عنوان URL لوكيل LiteLLM (مثل `https://your-proxy.example.com`). يجب أن يبدأ بـ `http://` أو `https://`. |
| `LITELLM_API_KEY` | مفتاح API للوكيل. يُشار إليه بالاسم في التكوين المولّد، ويُحل أثناء التشغيل. |

إذا لم يكن أي من المتغيرين مُعيّناً، يتم تخطي التكوين التلقائي بصمت.

### إصدار التكوين

تتضمن التكوينات المولّدة حقل `configVersion`. عندما يتغير التنسيق المولّد في الإصدارات المستقبلية، يكتشف xcsh التكوينات القديمة ويُرقّيها تلقائياً (مع نسخ احتياطي).

## تحذير بشأن المستهلك القديم

معظم تكوينات النماذج تتدفق الآن عبر `models.yml` من خلال `ModelRegistry`.

يبقى مسار قديم بارز واحد: حل مصادقة Anthropic للبحث في الويب لا يزال يقرأ `~/.xcsh/agent/models.json` مباشرة في `src/web/search/auth.ts`.

إذا كنت تعتمد على هذا المسار المحدد، ضع في اعتبارك التوافق مع JSON حتى يتم ترحيل هذه الوحدة.

## وضع الفشل

إذا فشل `models.yml` في فحوصات المخطط أو التحقق:

- إذا كان `LITELLM_BASE_URL` و `LITELLM_API_KEY` مُعيّنين، يحاول فحص صحة بدء التشغيل الإصلاح التلقائي (نسخ احتياطي للملف التالف، إعادة توليد من متغيرات البيئة). إذا نجح الإصلاح، يُعيد السجل تحميل التكوين المُصلح.
- إذا لم يكن الإصلاح التلقائي ممكناً (متغيرات البيئة غير مُعيّنة، فشل الكتابة)، يستمر السجل في العمل بالنماذج المدمجة.
- يتم عرض الخطأ عبر `ModelRegistry.getError()` ويُظهر في واجهة المستخدم/الإشعارات.
