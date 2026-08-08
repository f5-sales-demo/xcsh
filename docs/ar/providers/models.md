---
title: تكوين النماذج ومزودي الخدمة
description: سجل النماذج وتكوين مزودي الخدمة عبر models.yml مع التوجيه، والبدائل، والتسعير.
sidebar:
  order: 1
  label: النماذج ومزودي الخدمة
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# تكوين النماذج ومزودي الخدمة (`models.yml`)

يصف هذا المستند كيف يقوم وكيل التشفير حاليًا بتحميل النماذج، وتطبيق التجاوزات، وحل بيانات الاعتماد، واختيار النماذج في وقت التشغيل.

## ما الذي يتحكم في سلوك النموذج

ملفات التنفيذ الأساسية:

- `src/config/model-registry.ts` — يُحمل النماذج المدمجة + المخصصة، وتجاوزات مزودي الخدمة، واكتشاف وقت التشغيل، وتكامل المصادقة
- `src/config/model-resolver.ts` — يحلل أنماط النموذج ويختار النماذج الأولية/الصغيرة/البطيئة
- `src/config/settings-schema.ts` — الإعدادات المتعلقة بالنماذج (`modelRoles`، تفضيلات نقل مزود الخدمة)
- `src/session/auth-storage.ts` — مفتاح API + ترتيب حل OAuth
- `packages/ai/src/models.ts` و `packages/ai/src/types.ts` — مزودو/نماذج الخدمة المدمجة وأنواع `Model`/`compat`

## موقع ملف التكوين والسلوك القديم

مسار التكوين الافتراضي:

- `~/.xcsh/agent/models.yml`

لا يزال السلوك القديم موجودًا:

- إذا كان `models.yml` مفقودًا وكان `models.json` موجودًا في نفس الموقع، فسيتم ترحيله إلى `models.yml`.
- لا تزال مسارات التكوين الصريحة `.json` / `.jsonc` مدعومة عند تمريرها برمجيًا إلى `ModelRegistry`.

## شكل `models.yml`

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

`configVersion` هو عدد صحيح اختياري يكتبه نظام التكوين التلقائي. عند وجوده، يستخدمه xcsh لاكتشاف التكوينات القديمة وترقيتها تلقائيًا.

`provider-id` هو مفتاح مزود الخدمة الأساسي المستخدم عبر الاختيار والبحث عن المصادقة.

`equivalence` اختياري ويقوم بتكوين تجميع النماذج الأساسية أعلى نماذج مزود الخدمة الملموسة:

- `overrides` يعين محددًا ملموسًا دقيقًا (`provider/modelId`) إلى معرف أساسي رسمي من المصدر
- `exclude` يستبعد محددًا ملموسًا من التجميع الأساسي

## الحقول على مستوى مزود الخدمة

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

### قيم `api` المسموح بها لمزود الخدمة/النموذج

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

## قواعد التحقق من الصحة (الحالية)

### مزود خدمة مخصص بالكامل (`models` غير فارغ)

مطلوب:

- `baseUrl`
- `apiKey` ما لم يكن `auth: none`
- `api` على مستوى مزود الخدمة أو لكل نموذج

### مزود خدمة التجاوز فقط (`models` مفقود أو فارغ)

يجب تحديد واحد على الأقل من:

- `baseUrl`
- `modelOverrides`
- `discovery`

### الاكتشاف

- يتطلب `discovery` `api` على مستوى مزود الخدمة.

### فحوصات قيم النموذج

- `id` مطلوب
- يجب أن يكون `contextWindow` و `maxTokens` موجبين إذا تم توفيرهما

## ترتيب الدمج والتجاوز

خط أنابيب ModelRegistry (عند التحديث):

1. تحميل مزودي الخدمة/النماذج المدمجة من `@f5-sales-demo/pi-ai`.
2. تحميل التكوين المخصص `models.yml`.
3. تطبيق تجاوزات مزود الخدمة (`baseUrl`، `headers`) على النماذج المدمجة.
4. تطبيق `modelOverrides` (لكل مزود خدمة + معرف النموذج).
5. دمج `models` المخصصة:
   - `provider + id` نفسه يحل محل الموجود
   - غير ذلك يتم إلحاقه
6. تطبيق النماذج المكتشفة في وقت التشغيل (حاليًا Ollama و LM Studio)، ثم إعادة تطبيق تجاوزات النموذج.

## التكافؤ الأساسي للنموذج والتجميع

يحتفظ السجل بكل نموذج ملموس لمزود الخدمة ثم يبني طبقة أساسية فوقها.

المعرفات الأساسية هي معرفات رسمية من المصدر فقط، على سبيل المثال:

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

ترتيب البناء للتجميع الأساسي:

1. التجاوز الدقيق للمستخدم من `equivalence.overrides`
2. مطابقات المعرف الرسمي المجمعة من بيانات التعريف المدمجة للنموذج
3. التطبيع التجريبي المحافظ لمتغيرات البوابة/مزود الخدمة
4. التراجع إلى المعرف الخاص بالنموذج الملموس

الاستدلالات الحالية ضيقة عن قصد:

- يمكن إزالة البادئات المضمنة من المصدر عند وجودها، على سبيل المثال `anthropic/...` أو `openai/...`
- يمكن أن تتطابق المتغيرات ذات الإصدارات المنقطة والموصولة بشرطة فقط عندما تعين لمعرف رسمي موجود، على سبيل المثال `4.6 -> 4-6`
- لا يتم دمج العائلات أو الإصدارات الغامضة بدون مطابقة مجمعة أو تجاوز صريح

### سلوك الدقة الأساسية

عندما تشترك عدة متغيرات ملموسة في معرف أساسي، تستخدم الدقة:

1. التوفر والمصادقة
2. `config.yml` `modelProviderOrder`
3. ترتيب السجل/مزود الخدمة الموجود إذا كان `modelProviderOrder` غير معين

يتم تخطي مزودي الخدمة المعطلين أو غير المصادق عليهم.

تستمر حالة الجلسة والنصوص في تسجيل مزود الخدمة/النموذج الملموس الذي نفذ الدور الفعلي.

الافتراضيات لمزود الخدمة مقابل التجاوزات لكل نموذج:

- تعتبر `headers` لمزود الخدمة خط الأساس.
- تتجاوز `headers` للنموذج مفاتيح رأس مزود الخدمة.
- يمكن أن تتجاوز `modelOverrides` بيانات تعريف النموذج (`name`، `reasoning`، `input`، `cost`، `contextWindow`، `maxTokens`، `headers`، `compat`، `contextPromotionTarget`).
- يتم دمج `compat` بعمق لكتل التوجيه المتداخلة (`openRouterRouting`، `vercelGatewayRouting`، `extraBody`).

## تكامل اكتشاف وقت التشغيل

### اكتشاف Ollama الضمني

إذا لم يتم تكوين `ollama` بشكل صريح، يضيف السجل مزود خدمة اكتشاف ضمني:

- مزود الخدمة: `ollama`
- واجهة برمجة التطبيقات: `openai-completions`
- عنوان URL الأساسي: `OLLAMA_BASE_URL` أو `http://127.0.0.1:11434`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي اكتشاف وقت التشغيل `GET /api/tags` على Ollama ويقوم بتركيب إدخالات النموذج مع الافتراضيات المحلية.

### اكتشاف llama.cpp الضمني

إذا لم يتم تكوين `llama.cpp` بشكل صريح، يضيف السجل مزود خدمة اكتشاف ضمني:
ملاحظة: يستخدم واجهة برمجة تطبيقات رسائل antropic الأحدث بدلاً من openai-competions.

- مزود الخدمة: `llama.cpp`
- واجهة برمجة التطبيقات: `openai-responses`
- عنوان URL الأساسي: `LLAMA_CPP_BASE_URL` أو `http://127.0.0.1:8080`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي اكتشاف وقت التشغيل `GET models` على llama.cpp ويقوم بتركيب إدخالات النموذج مع الافتراضيات المحلية.

### اكتشاف LM Studio الضمني

إذا لم يتم تكوين `lm-studio` بشكل صريح، يضيف السجل مزود خدمة اكتشاف ضمني:

- مزود الخدمة: `lm-studio`
- واجهة برمجة التطبيقات: `openai-completions`
- عنوان URL الأساسي: `LM_STUDIO_BASE_URL` أو `http://127.0.0.1:1234/v1`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يجلب اكتشاف وقت التشغيل النماذج (`GET /models`) ويقوم بتركيب إدخالات النموذج مع الافتراضيات المحلية.

### الاكتشاف الصريح لمزود الخدمة

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

### تسجيل مزود الامتداد

يمكن للامتدادات تسجيل مزودي الخدمة في وقت التشغيل (`pi.registerProvider(...)`)، بما في ذلك:

- استبدال/إلحاق النموذج لمزود الخدمة
- تسجيل معالج الدفق المخصص لمعرفات API الجديدة
- تسجيل مزود خدمة OAuth المخصص

## ترتيب حل مفتاح API والمصادقة

عند طلب مفتاح لمزود الخدمة، الترتيب الفعلي هو:

1. تجاوز وقت التشغيل (CLI `--api-key`)
2. بيانات اعتماد مفتاح API المخزنة في `agent.db`
3. بيانات اعتماد OAuth المخزنة في `agent.db` (مع التحديث)
4. تعيين متغير البيئة (`OPENAI_API_KEY`، `ANTHROPIC_API_KEY`، إلخ)
5. محلل احتياطي ModelRegistry (`apiKey` لمزود الخدمة من `models.yml`، دلالات اسم البيئة أو الحرفية)

سلوك `apiKey` لـ `models.yml`:

- يتم التعامل مع القيمة أولاً كاسم متغير بيئة.
- إذا لم يكن هناك متغير بيئة موجود، يتم استخدام السلسلة الحرفية كرمز مميز.

إذا كان `authHeader: true` وتم تعيين `apiKey` لمزود الخدمة، تحصل النماذج على:

- حقن رأس `Authorization: Bearer <resolved-key>`.

مزودو الخدمة بدون مفتاح:

- يتم التعامل مع مزودي الخدمة المحددين `auth: none` على أنهم متاحون بدون بيانات اعتماد.
- ترجع `getApiKey*` `kNoAuth` لهم.

## توفر النموذج مقابل جميع النماذج

- تُرجع `getAll()` سجل النموذج المحمل (المدمج + المخصص المدمج + المكتشف).
- تقوم `getAvailable()` بالتصفية للنماذج التي ليس لها مفتاح أو لديها مصادقة قابلة للحل.

لذلك يمكن أن يوجد نموذج في السجل ولكن لا يمكن تحديده حتى تتوفر المصادقة.

## دقة النموذج في وقت التشغيل

### CLI وتحليل الأنماط

يدعم `model-resolver.ts`:

- دقيق `provider/modelId`
- معرف النموذج الأساسي الدقيق
- معرف النموذج الدقيق (استدلال مزود الخدمة)
- مطابقة ضبابية/سلسلة فرعية
- أنماط نطاق الكرة الأرضية في `--models` (على سبيل المثال `openai/*`، `*sonnet*`)
- لاحقة `:thinkingLevel` الاختيارية (`off|minimal|low|medium|high|xhigh`)

`--provider` قديم؛ يفضل `--model`.

أولوية الحل للمحددات الدقيقة:

1. يتجاوز `provider/modelId` الدقيق التجميع
2. يحل المعرف الأساسي الدقيق من خلال الفهرس الأساسي
3. المعرف الملموس المجرد الدقيق لا يزال يعمل
4. تعمل المطابقة الضبابية والأنماط بعد المسارات الدقيقة

### أولوية اختيار النموذج الأولي

تستخدم `findInitialModel(...)` هذا الترتيب:

1. مزود خدمة+نموذج CLI صريح
2. أول نموذج محدد النطاق (إذا لم يتم الاستئناف)
3. مزود الخدمة/النموذج الافتراضي المحفوظ
4. افتراضيات مزود الخدمة المعروفة (على سبيل المثال OpenAI/Anthropic/إلخ) من بين النماذج المتاحة
5. أول نموذج متاح

### الأسماء المستعارة للأدوار والإعدادات

أدوار النموذج المدعومة:

- `default`، `smol`، `slow`، `plan`، `commit`

تتوسع الأسماء المستعارة للأدوار مثل `pi/smol` عبر `settings.modelRoles`. يمكن أن تلحق كل قيمة دور أيضًا محدد التفكير مثل `:minimal`، `:low`، `:medium`، أو `:high`.

إذا أشار أحد الأدوار إلى دور آخر، فإن النموذج الهدف لا يزال يرث بشكل طبيعي وتفوز أي لاحقة صريحة على الدور المشير لهذا الاستخدام الخاص بالدور.

الإعدادات ذات الصلة:

- `modelRoles` (سجل)
- `enabledModels` (قائمة أنماط محددة النطاق)
- `modelProviderOrder` (أولوية مزود الخدمة الأساسي العالمي)
- `providers.kimiApiFormat` (تنسيق طلب `openai` أو `anthropic`)
- `providers.openaiWebsockets` (`auto|off|on` تفضيل مأخذ التوصيل لـ OpenAI Codex)

قد تخزن `modelRoles` إما:

- `provider/modelId` لتثبيت متغير مزود الخدمة الملموس
- معرف أساسي مثل `gpt-5.3-codex` للسماح بتجميع مزود الخدمة

بالنسبة لـ `enabledModels` و CLI `--models`:

- تتوسع المعرفات الأساسية الدقيقة لتشمل جميع المتغيرات الملموسة في تلك المجموعة الأساسية
- تظل إدخالات `provider/modelId` الصريحة دقيقة
- لا تزال الأنماط الكروية والمطابقات الضبابية تعمل على النماذج الملموسة

## `/model` و `--list-models`

كلا السطحين يحافظان على النماذج المسبوقة بمزود الخدمة مرئية وقابلة للتحديد.

كما أنها تعرض الآن نماذج أساسية/مجمعة:

- يتضمن `/model` عرضًا أساسيًا جنبًا إلى جنب مع علامات تبويب مزود الخدمة
- تطبع `--list-models` قسمًا أساسيًا بالإضافة إلى صفوف مزود الخدمة الملموسة

يؤدي تحديد إدخال أساسي إلى تخزين المحدد الأساسي. يؤدي تحديد صف مزود الخدمة إلى تخزين `provider/modelId` الصريح.

## ترقية السياق (سلاسل التراجع على مستوى النموذج)

ترقية السياق هي آلية استرداد التدفق للمتغيرات ذات السياق الصغير (على سبيل المثال `*-spark`) والتي يتم ترقيتها تلقائيًا إلى شقيق ذي سياق أكبر عندما ترفض واجهة برمجة التطبيقات طلبًا يعاني من خطأ في طول السياق.

### المشغل والترتيب

عندما يفشل الدور بخطأ تجاوز السياق (على سبيل المثال `context_length_exceeded`)، تحاول `AgentSession` الترقية **قبل** التراجع إلى الضغط:

1. إذا كان `contextPromotion.enabled` صحيحًا، قم بحل هدف الترقية (انظر أدناه).
2. إذا تم العثور على هدف، فقم بالتبديل إليه وأعد المحاولة — لا حاجة للضغط.
3. إذا لم يتوفر هدف، تراجع للضغط التلقائي على النموذج الحالي.

### اختيار الهدف

يكون الاختيار مدفوعًا بالنموذج، وليس بالدور:

1. `currentModel.contextPromotionTarget` (إذا تم تكوينه)
2. أصغر نموذج سياق أكبر على نفس مزود الخدمة + واجهة برمجة التطبيقات

يتم تجاهل المر المرشحين ما لم يتم حل بيانات الاعتماد (`ModelRegistry.getApiKey(...)`).

### تسليم مأخذ توصيل OpenAI Codex

إذا تم التبديل من/إلى `openai-codex-responses`، يتم إغلاق مفتاح حالة مزود جلسة العمل `openai-codex-responses` قبل تبديل النموذج. يؤدي هذا إلى إسقاط حالة النقل عبر مأخذ التوصيل بحيث يبدأ الدور التالي نظيفًا على النموذج المُرقى.

### سلوك الاستمرار

تستخدم الترقية التبديل المؤقت (`setModelTemporary`):

- مُسجل كـ `model_change` مؤقت في محفوظات الجلسة
- لا يعيد كتابة تعيين الدور المحفوظ

### تكوين سلاسل التراجع الصريحة

تكوين التراجع مباشرة في بيانات تعريف النموذج عبر `contextPromotionTarget`.

يقبل `contextPromotionTarget` إما:

- `provider/model-id` (صريح)
- `model-id` (محلول داخل مزود الخدمة الحالي)

مثال (`models.yml`) لـ Spark -> غير Spark على نفس مزود الخدمة:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

يقوم مُنشئ النموذج المدمج أيضًا بتعيين هذا تلقائيًا لنماذج `*-spark` عندما يوجد نموذج أساسي من نفس المزود.

## حقول التوافق والتوجيه

يدعم `models.yml` هذه المجموعة الفرعية `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` أو `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

يتم استهلاكها بواسطة منطق النقل الخاص بإكمال OpenAI ودمجها مع الاكتشاف التلقائي المستند إلى عنوان URL.

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

### وكيل مستضاف بمفتاح مستند إلى البيئة

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

### تجاوز توجيه المزود المدمج + بيانات تعريف النموذج

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

عند تعيين كل من متغيري البيئة `LITELLM_BASE_URL` و `LITELLM_API_KEY`، يدير xcsh تلقائيًا تكوين `models.yml` لوكيل LiteLLM.

### الإنشاء التلقائي في التشغيل الأول

إذا لم يكن `models.yml` موجودًا وتم اكتشاف متغيرات بيئة LiteLLM، فإن xcsh ينشئه تلقائيًا:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

كما يتم إنشاء ملف `config.yml` افتراضي بإعدادات معقولة لمزود الصورة.

### الإصلاح الذاتي عند بدء التشغيل

عند كل بدء تشغيل، يقوم `startupHealthCheck()` في سجل النموذج بتشغيل الفحوصات التالية:

| الحالة | الإجراء |
|-----------|--------|
| `models.yml` مفقود | إنشاء تلقائي من متغيرات البيئة |
| `models.yml` تالف أو غير قابل للتحليل | نسخ احتياطي إلى `.bak`، وإعادة إنشاء |
| `baseUrl` لا يتطابق مع `LITELLM_BASE_URL` | نسخ احتياطي إلى `.bak`، وإعادة إنشاء باستخدام عنوان URL الجديد |
| `configVersion` مفقود أو قديم | نسخ احتياطي إلى `.bak`، وإعادة إنشاء باستخدام الإصدار الحالي |
| التكوين سليم | لا يوجد إجراء |

تقوم جميع الإصلاحات بإنشاء نسخ احتياطية `.bak` قبل الاستبدال. جميع العمليات متكافئة.

### أمر CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### متغيرات البيئة المطلوبة

| المتغير | الغرض |
|----------|---------|
| `LITELLM_BASE_URL` | عنوان URL لوكيل LiteLLM (على سبيل المثال `https://your-proxy.example.com`). يجب أن يبدأ بـ `http://` أو `https://`. |
| `LITELLM_API_KEY` | مفتاح API للوكيل. مشار إليه بالاسم في التكوين المُنشأ، ويتم حله في وقت التشغيل. |

إذا كان أي من المتغيرين غير معين، يتم تخطي التكوين التلقائي بصمت.

### تعيين إصدار التكوين

تتضمن التكوينات المُنشأة حقلاً `configVersion`. عندما يتغير التنسيق المُنشأ في الإصدارات المستقبلية، يكتشف xcsh التكوينات القديمة ويرقيها تلقائيًا (مع نسخة احتياطية).

### تحذير المستهلك القديم

يتدفق معظم تكوين النموذج الآن عبر `models.yml` عبر `ModelRegistry`.

يتبقى مسار قديم واحد بارز: لا يزال حل مصادقة بحث الويب الخاص بـ Anthropic يقرأ `~/.xcsh/agent/models.json` مباشرة في `src/web/search/auth.ts`.

إذا كنت تعتمد على هذا المسار المحدد، فضع التوافق مع JSON في الاعتبار حتى يتم ترحيل هذه الوحدة.

### وضع الفشل

إذا فشل `models.yml` في المخطط أو فحوصات التحقق:

- إذا تم تعيين `LITELLM_BASE_URL` و `LITELLM_API_KEY`، يحاول الفحص الصحي لبدء التشغيل الإصلاح التلقائي (نسخ الملف التالف احتياطيًا، وإعادة الإنشاء من متغيرات البيئة). إذا نجح الإصلاح، يعيد السجل تحميل التكوين الثابت.
- إذا لم يكن الإصلاح التلقائي ممكنًا (لم يتم تعيين متغيرات البيئة، فشل الكتابة)، يستمر السجل في العمل باستخدام النماذج المدمجة.
- يتم كشف الخطأ عبر `ModelRegistry.getError()` ويظهر في واجهة المستخدم/الإشعارات.
