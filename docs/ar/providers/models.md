---
title: تهيئة النماذج والموفرين
description: سجل النماذج وتهيئة الموفرين عبر models.yml مع التوجيه والاحتياطي والتسعير.
sidebar:
  order: 1
  label: النماذج والموفرون
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# تهيئة النماذج والموفرين (`models.yml`)

يصف هذا المستند كيفية تحميل عامل البرمجة للنماذج حالياً، وتطبيق التجاوزات، وحل بيانات الاعتماد، واختيار النماذج في وقت التشغيل.

## ما يتحكم في سلوك النموذج

ملفات التنفيذ الأساسية:

- `src/config/model-registry.ts` — تحميل النماذج المدمجة والمخصصة، وتجاوزات الموفر، والاكتشاف في وقت التشغيل، وتكامل المصادقة
- `src/config/model-resolver.ts` — تحليل أنماط النماذج واختيار النماذج الأولية/الصغيرة/البطيئة
- `src/config/settings-schema.ts` — الإعدادات المتعلقة بالنماذج (`modelRoles`، تفضيلات نقل الموفر)
- `src/session/auth-storage.ts` — ترتيب حل مفتاح API + OAuth
- `packages/ai/src/models.ts` و`packages/ai/src/types.ts` — الموفرون/النماذج المدمجة وأنواع `Model`/`compat`

## موقع ملف التهيئة والسلوك القديم

مسار التهيئة الافتراضي:

- `~/.xcsh/agent/models.yml`

السلوك القديم لا يزال موجوداً:

- إذا كان `models.yml` غير موجود وكان `models.json` موجوداً في نفس الموقع، يتم ترحيله إلى `models.yml`.
- مسارات تهيئة `.json` / `.jsonc` الصريحة لا تزال مدعومة عند تمريرها برمجياً إلى `ModelRegistry`.

## شكل `models.yml`

```yaml
configVersion: 1  # اختياري — يُكتب بواسطة الإعداد التلقائي، يُستخدم للكشف عن الترحيل
providers:
  <provider-id>:
    # تهيئة على مستوى الموفر
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` هو عدد صحيح اختياري يُكتب بواسطة نظام الإعداد التلقائي. عند وجوده، يستخدمه xcsh للكشف عن التهيئات القديمة وترقيتها تلقائياً.

`provider-id` هو مفتاح الموفر الأساسي المستخدم عبر الاختيار والبحث عن المصادقة.

`equivalence` اختياري ويهيئ تجميع النماذج الأساسية فوق نماذج الموفر الملموسة:

- `overrides` يعيّن محدداً ملموساً دقيقاً (`provider/modelId`) إلى معرف أساسي رسمي من المنبع
- `exclude` يُخرج محدداً ملموساً من التجميع الأساسي

## حقول مستوى الموفر

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

### قيم `api` المسموح بها للموفر/النموذج

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### قيم المصادقة/الاكتشاف المسموح بها

- `auth`: `apiKey` (الافتراضي) أو `none`
- `discovery.type`: `ollama`

## قواعد التحقق (الحالية)

### موفر مخصص كامل (`models` غير فارغ)

المطلوب:

- `baseUrl`
- `apiKey` ما لم يكن `auth: none`
- `api` على مستوى الموفر أو لكل نموذج

### موفر التجاوز فقط (`models` مفقود أو فارغ)

يجب تعريف واحد على الأقل من:

- `baseUrl`
- `modelOverrides`
- `discovery`

### الاكتشاف

- `discovery` يتطلب `api` على مستوى الموفر.

### فحوصات قيمة النموذج

- `id` مطلوب
- يجب أن يكون `contextWindow` و`maxTokens` موجبَين إذا تم توفيرهما

## ترتيب الدمج والتجاوز

مسار ModelRegistry (عند التحديث):

1. تحميل الموفرين/النماذج المدمجة من `@f5xc-salesdemos/pi-ai`.
2. تحميل التهيئة المخصصة من `models.yml`.
3. تطبيق تجاوزات الموفر (`baseUrl`، `headers`) على النماذج المدمجة.
4. تطبيق `modelOverrides` (لكل موفر ومعرف نموذج).
5. دمج `models` المخصصة:
   - نفس `provider + id` يستبدل الموجود
   - وإلا يُلحق
6. تطبيق النماذج المكتشفة في وقت التشغيل (Ollama وLM Studio حالياً)، ثم إعادة تطبيق تجاوزات النموذج.

## تكافؤ النموذج الأساسي والتجميع

يحتفظ السجل بكل نموذج موفر ملموس ثم يبني طبقة أساسية فوقها.

معرفات الأساس هي معرفات رسمية من المنبع فقط، على سبيل المثال:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### تهيئة التكافؤ في `models.yml`

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

1. التجاوز الصريح من المستخدم من `equivalence.overrides`
2. تطابقات المعرف الرسمي المجمّعة من البيانات الوصفية للنموذج المدمج
3. التطبيع الاستدلالي المحافظ لمتغيرات البوابة/الموفر
4. الرجوع إلى معرف النموذج الملموس الخاص به

الاستدلالات الحالية ضيقة عمداً:

- يمكن حذف البادئات الأصلية من المنبع المضمّنة عند وجودها، مثلاً `anthropic/...` أو `openai/...`
- يمكن تطبيع متغيرات الإصدار بالنقاط والشرطات فقط عندما تُعيَّن إلى معرف رسمي موجود، مثلاً `4.6 -> 4-6`
- لا يتم دمج المجموعات أو الإصدارات الغامضة دون تطابق مجمّع أو تجاوز صريح

### سلوك الحل الأساسي

عندما تشترك عدة متغيرات ملموسة في معرف أساسي، يستخدم الحل:

1. التوفر والمصادقة
2. `modelProviderOrder` في `config.yml`
3. ترتيب السجل/الموفر الحالي إذا كان `modelProviderOrder` غير مُعيَّن

يتم تخطي الموفرين المعطّلين أو غير المصادق عليهم.

تستمر حالة الجلسة والنصوص في تسجيل الموفر/النموذج الملموس الذي نفّذ الدور فعلياً.

الافتراضيات على مستوى الموفر مقابل تجاوزات كل نموذج:

- `headers` الموفر هي الأساس.
- `headers` النموذج تتجاوز مفاتيح رأس الموفر.
- يمكن لـ`modelOverrides` تجاوز البيانات الوصفية للنموذج (`name`، `reasoning`، `input`، `cost`، `contextWindow`، `maxTokens`، `headers`، `compat`، `contextPromotionTarget`).
- يتم دمج `compat` بعمق لكتل التوجيه المتداخلة (`openRouterRouting`، `vercelGatewayRouting`، `extraBody`).

## تكامل الاكتشاف في وقت التشغيل

### اكتشاف Ollama الضمني

إذا لم يكن `ollama` مهيأً صراحةً، يضيف السجل موفراً قابلاً للاكتشاف ضمنياً:

- الموفر: `ollama`
- api: `openai-completions`
- عنوان URL الأساسي: `OLLAMA_BASE_URL` أو `http://127.0.0.1:11434`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي اكتشاف وقت التشغيل `GET /api/tags` على Ollama ويُركّب إدخالات نموذج بإعدادات افتراضية محلية.

### اكتشاف llama.cpp الضمني

إذا لم يكن `llama.cpp` مهيأً صراحةً، يضيف السجل موفراً قابلاً للاكتشاف ضمنياً:
ملاحظة: يستخدم واجهة برمجة رسائل anthropic الأحدث بدلاً من openai-completions.

- الموفر: `llama.cpp`
- api: `openai-responses`
- عنوان URL الأساسي: `LLAMA_CPP_BASE_URL` أو `http://127.0.0.1:8080`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي اكتشاف وقت التشغيل `GET models` على llama.cpp ويُركّب إدخالات نموذج بإعدادات افتراضية محلية.

### اكتشاف LM Studio الضمني

إذا لم يكن `lm-studio` مهيأً صراحةً، يضيف السجل موفراً قابلاً للاكتشاف ضمنياً:

- الموفر: `lm-studio`
- api: `openai-completions`
- عنوان URL الأساسي: `LM_STUDIO_BASE_URL` أو `http://127.0.0.1:1234/v1`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يجلب اكتشاف وقت التشغيل النماذج (`GET /models`) ويُركّب إدخالات نموذج بإعدادات افتراضية محلية.

### اكتشاف الموفر الصريح

يمكنك تهيئة الاكتشاف بنفسك:

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

### تسجيل موفر الامتداد

يمكن للامتدادات تسجيل الموفرين في وقت التشغيل (`pi.registerProvider(...)`), بما في ذلك:

- استبدال/إلحاق نموذج لموفر
- تسجيل معالج دفق مخصص لمعرفات API جديدة
- تسجيل موفر OAuth مخصص

## ترتيب حل المصادقة ومفتاح API

عند طلب مفتاح لموفر، يكون الترتيب الفعلي:

1. تجاوز وقت التشغيل (CLI `--api-key`)
2. بيانات اعتماد مفتاح API المخزنة في `agent.db`
3. بيانات اعتماد OAuth المخزنة في `agent.db` (مع التحديث)
4. تعيين متغير البيئة (`OPENAI_API_KEY`، `ANTHROPIC_API_KEY`، إلخ)
5. محلل الاحتياط في ModelRegistry (موفر `apiKey` من `models.yml`، دلالات اسم-البيئة-أو-الحرفي)

سلوك `apiKey` في `models.yml`:

- يُعامَل القيمة أولاً كاسم متغير بيئة.
- إذا لم يكن متغير البيئة موجوداً، تُستخدم السلسلة الحرفية كرمز مميز.

إذا كان `authHeader: true` وكان `apiKey` الموفر مُعيَّناً، تحصل النماذج على:

- رأس `Authorization: Bearer <resolved-key>` مُدرج.

الموفرون بدون مفتاح:

- يُعامَل الموفرون المُعلَّمون بـ`auth: none` كمتاحين بدون بيانات اعتماد.
- يُرجع `getApiKey*` القيمة `kNoAuth` لهم.

## توفر النموذج مقابل جميع النماذج

- يُرجع `getAll()` سجل النموذج المحمّل (مدمج + مخصص مدموج + مكتشف).
- يُصفّي `getAvailable()` إلى النماذج التي تعمل بدون مفتاح أو لديها مصادقة قابلة للحل.

لذلك يمكن أن يوجد نموذج في السجل دون أن يكون قابلاً للاختيار حتى تتوفر المصادقة.

## حل النموذج في وقت التشغيل

### تحليل نمط CLI

يدعم `model-resolver.ts`:

- `provider/modelId` الدقيق
- معرف النموذج الأساسي الدقيق
- معرف النموذج الدقيق (الموفر مستنتج)
- المطابقة الغامضة/الجزئية
- أنماط النطاق الشامل في `--models` (مثلاً `openai/*`، `*sonnet*`)
- لاحقة `:thinkingLevel` الاختيارية (`off|minimal|low|medium|high|xhigh`)

`--provider` قديم؛ `--model` هو المفضّل.

أولوية الحل للمحددات الدقيقة:

1. `provider/modelId` الدقيق يتجاوز التجميع
2. المعرف الأساسي الدقيق يُحل عبر الفهرس الأساسي
3. المعرف الملموس المجرد الدقيق لا يزال يعمل
4. المطابقة الغامضة والشاملة تعمل بعد المسارات الدقيقة

### أولوية اختيار النموذج الأولي

يستخدم `findInitialModel(...)` هذا الترتيب:

1. موفر+نموذج CLI الصريح
2. أول نموذج محدد النطاق (إذا لم يكن يستأنف)
3. موفر/نموذج افتراضي محفوظ
4. افتراضيات الموفر المعروفة (مثلاً OpenAI/Anthropic/إلخ) بين النماذج المتاحة
5. أول نموذج متاح

### أسماء الأدوار المستعارة والإعدادات

أدوار النموذج المدعومة:

- `default`، `smol`، `slow`، `plan`، `commit`

تتوسع أسماء الأدوار المستعارة مثل `pi/smol` عبر `settings.modelRoles`. يمكن لكل قيمة دور أيضاً إلحاق محدد التفكير مثل `:minimal`، `:low`، `:medium`، أو `:high`.

إذا أشار دور إلى دور آخر، يرث النموذج الهدف بشكل طبيعي وأي لاحقة صريحة على الدور المُحيل تفوز لذلك الاستخدام الخاص بالدور.

الإعدادات ذات الصلة:

- `modelRoles` (سجل)
- `enabledModels` (قائمة أنماط محددة النطاق)
- `modelProviderOrder` (أولوية أساسية-موفر عالمية)
- `providers.kimiApiFormat` (تنسيق طلب `openai` أو `anthropic`)
- `providers.openaiWebsockets` (تفضيل websocket بقيمة `auto|off|on` لنقل OpenAI Codex)

قد يخزن `modelRoles` إما:

- `provider/modelId` لتثبيت متغير موفر ملموس
- معرفاً أساسياً مثل `gpt-5.3-codex` للسماح بتجميع الموفر

لـ`enabledModels` و`--models` في CLI:

- تتوسع المعرفات الأساسية الدقيقة إلى جميع المتغيرات الملموسة في ذلك المجموعة الأساسية
- تبقى إدخالات `provider/modelId` الصريحة دقيقة
- لا تزال المطابقة الشاملة والغامضة تعمل على النماذج الملموسة

## `/model` و`--list-models`

تبقي كلا الواجهتين النماذج ذات البادئة الموفر مرئية وقابلة للاختيار.

تعرضان أيضاً الآن النماذج الأساسية/المجمّعة:

- `/model` يتضمن عرضاً أساسياً جنباً إلى جنب مع تبويبات الموفر
- `--list-models` يطبع قسماً أساسياً بالإضافة إلى صفوف الموفر الملموسة

اختيار إدخال أساسي يخزن المحدد الأساسي. اختيار صف موفر يخزن `provider/modelId` الصريح.

## ترقية السياق (سلاسل الاحتياط على مستوى النموذج)

ترقية السياق هي آلية استرداد من الفيضان للمتغيرات ذات السياق الصغير (مثلاً `*-spark`) التي تُرقّي تلقائياً إلى نموذج شقيق ذي سياق أكبر عندما يرفض API الطلب بسبب خطأ طول السياق.

### المشغّل والترتيب

عندما تفشل دورة بخطأ فيضان سياق (مثلاً `context_length_exceeded`)، تحاول `AgentSession` الترقية **قبل** الرجوع إلى الضغط:

1. إذا كان `contextPromotion.enabled` صحيحاً، يُحل هدف ترقية (انظر أدناه).
2. إذا وُجد هدف، يتم التبديل إليه وإعادة محاولة الطلب — لا حاجة للضغط.
3. إذا لم يكن هناك هدف متاح، يتم الرجوع إلى الضغط التلقائي على النموذج الحالي.

### اختيار الهدف

الاختيار مدفوع بالنموذج لا بالدور:

1. `currentModel.contextPromotionTarget` (إذا كان مُهيَّأً)
2. أصغر نموذج ذي سياق أكبر على نفس الموفر + API

يتم تجاهل المرشحين ما لم تُحل بيانات الاعتماد (`ModelRegistry.getApiKey(...)`).

### تسليم WebSocket لـOpenAI Codex

عند التبديل من/إلى `openai-codex-responses`، يتم إغلاق مفتاح حالة موفر الجلسة `openai-codex-responses` قبل تبديل النموذج. يُسقط هذا حالة نقل websocket بحيث تبدأ الدورة التالية نظيفة على النموذج المُرقَّى.

### سلوك الاستمرارية

تستخدم الترقية التبديل المؤقت (`setModelTemporary`):

- مسجّل كـ`model_change` مؤقت في تاريخ الجلسة
- لا يُعيد كتابة تعيين الدور المحفوظ

### تهيئة سلاسل الاحتياط الصريحة

قم بتهيئة الاحتياط مباشرةً في البيانات الوصفية للنموذج عبر `contextPromotionTarget`.

يقبل `contextPromotionTarget` إما:

- `provider/model-id` (صريح)
- `model-id` (مُحلَّل ضمن الموفر الحالي)

مثال (`models.yml`) لـSpark -> غير Spark على نفس الموفر:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

يُعيِّن مولّد النموذج المدمج هذا أيضاً تلقائياً لنماذج `*-spark` عندما يوجد نموذج أساسي على نفس الموفر.

## حقول التوافق والتوجيه

يدعم `models.yml` هذه المجموعة الفرعية من `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` أو `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

تُستهلك هذه من قِبَل منطق نقل OpenAI-completions وتُجمع مع الكشف التلقائي المستند إلى URL.

## أمثلة عملية

### نقطة نهاية متوافقة مع OpenAI محلية (بدون مصادقة)

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

### تجاوز مسار الموفر المدمج + البيانات الوصفية للنموذج

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

عند تعيين كلٍّ من متغيري البيئة `LITELLM_BASE_URL` و`LITELLM_API_KEY`، تدير xcsh تلقائياً تهيئة `models.yml` لوكيل LiteLLM.

### التوليد التلقائي عند أول تشغيل

إذا لم يكن `models.yml` موجوداً وتم اكتشاف متغيرات بيئة LiteLLM، تولّده xcsh تلقائياً:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

يُولَّد أيضاً `config.yml` افتراضي بإعدادات موفر الصور المناسبة.

### الإصلاح الذاتي عند بدء التشغيل

في كل بدء تشغيل، يُشغِّل `startupHealthCheck()` في سجل النموذج الفحوصات التالية:

| الحالة | الإجراء |
|--------|---------|
| `models.yml` مفقود | توليد تلقائي من متغيرات البيئة |
| `models.yml` تالف أو غير قابل للتحليل | نسخ احتياطي إلى `.bak`، إعادة التوليد |
| `baseUrl` لا يتطابق مع `LITELLM_BASE_URL` | نسخ احتياطي إلى `.bak`، إعادة التوليد بعنوان URL جديد |
| `configVersion` مفقود أو قديم | نسخ احتياطي إلى `.bak`، إعادة التوليد بالإصدار الحالي |
| التهيئة سليمة | لا إجراء |

تُنشئ جميع عمليات الإصلاح نسخاً احتياطية `.bak` قبل الكتابة فوقها. جميع العمليات متكافئة.

### أمر CLI

```bash
xcsh setup litellm              # توليد أو إصلاح تهيئة LiteLLM
xcsh setup litellm --check      # التحقق دون كتابة
xcsh setup litellm --check --json  # مخرجات تحقق قابلة للقراءة آلياً
```

### متغيرات البيئة المطلوبة

| المتغير | الغرض |
|---------|-------|
| `LITELLM_BASE_URL` | عنوان URL لوكيل LiteLLM (مثلاً `https://your-proxy.example.com`). يجب أن يبدأ بـ`http://` أو `https://`. |
| `LITELLM_API_KEY` | مفتاح API للوكيل. مُشار إليه بالاسم في التهيئة المولَّدة، يُحل في وقت التشغيل. |

إذا كان أي من المتغيرين غير مُعيَّن، يتم تخطي الإعداد التلقائي بصمت.

### إصدار التهيئة

تتضمن التهيئات المولَّدة حقل `configVersion`. عندما يتغير تنسيق التوليد في الإصدارات المستقبلية، تكتشف xcsh التهيئات القديمة وتُرقّيها تلقائياً (مع نسخ احتياطي).

## تحذير المستهلك القديم

تتدفق معظم تهيئة النموذج الآن عبر `models.yml` عبر `ModelRegistry`.

لا يزال هناك مسار قديم واحد ملحوظ: لا يزال حل مصادقة Anthropic للبحث على الويب يقرأ `~/.xcsh/agent/models.json` مباشرةً في `src/web/search/auth.ts`.

إذا كنت تعتمد على ذلك المسار المحدد، ضع توافق JSON في الاعتبار حتى يتم ترحيل تلك الوحدة.

## وضع الفشل

إذا فشل `models.yml` في فحوصات المخطط أو التحقق:

- إذا كانت `LITELLM_BASE_URL` و`LITELLM_API_KEY` مُعيَّنتين، يحاول فحص صحة بدء التشغيل الإصلاح التلقائي (نسخ احتياطي للملف التالف، إعادة التوليد من متغيرات البيئة). إذا نجح الإصلاح، يُعيد السجل تحميل التهيئة المُصلَّحة.
- إذا كان الإصلاح التلقائي غير ممكن (متغيرات البيئة غير مُعيَّنة، فشل الكتابة)، يستمر السجل في العمل بالنماذج المدمجة.
- يُعرض الخطأ عبر `ModelRegistry.getError()` ويظهر في واجهة المستخدم/الإشعارات.
