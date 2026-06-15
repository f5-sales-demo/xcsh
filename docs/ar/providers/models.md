---
title: تكوين النماذج والموفرين
description: >-
  سجل النماذج وتكوين الموفرين عبر models.yml مع التوجيه والتحويل الاحتياطي
  والتسعير.
sidebar:
  order: 1
  label: النماذج والموفرون
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# تكوين النماذج والموفرين (`models.yml`)

يصف هذا المستند كيفية تحميل وكيل الترميز للنماذج حالياً، وتطبيق التجاوزات، وحل بيانات الاعتماد، واختيار النماذج في وقت التشغيل.

## ما يتحكم في سلوك النماذج

ملفات التنفيذ الأساسية:

- `src/config/model-registry.ts` — يحمّل النماذج المدمجة والمخصصة، وتجاوزات الموفر، والاكتشاف في وقت التشغيل، وتكامل المصادقة
- `src/config/model-resolver.ts` — يحلّل أنماط النماذج ويختار النماذج الأولية/المصغّرة/البطيئة
- `src/config/settings-schema.ts` — الإعدادات المتعلقة بالنماذج (`modelRoles`، وتفضيلات نقل الموفر)
- `src/session/auth-storage.ts` — ترتيب حل مفتاح API ومصادقة OAuth
- `packages/ai/src/models.ts` و`packages/ai/src/types.ts` — الموفرون/النماذج المدمجون وأنواع `Model`/`compat`

## موقع ملف التكوين والسلوك القديم

مسار التكوين الافتراضي:

- `~/.xcsh/agent/models.yml`

السلوك القديم لا يزال موجوداً:

- إذا كان `models.yml` مفقوداً وكان `models.json` موجوداً في نفس الموقع، يتم ترحيله إلى `models.yml`.
- مسارات التكوين الصريحة بصيغة `.json` / `.jsonc` لا تزال مدعومة عند تمريرها برمجياً إلى `ModelRegistry`.

## شكل `models.yml`

```yaml
configVersion: 1  # اختياري — يُكتب بواسطة الضبط التلقائي، يُستخدم لاكتشاف الترحيل
providers:
  <provider-id>:
    # تكوين على مستوى الموفر
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` هو عدد صحيح اختياري يُكتب بواسطة نظام الضبط التلقائي. عند وجوده، يستخدمه xcsh لاكتشاف التكوينات القديمة وترقيتها تلقائياً.

`provider-id` هو مفتاح الموفر المعياري المستخدم عبر الاختيار وبحث المصادقة.

`equivalence` اختياري ويُكوّن تجميع النماذج المعيارية فوق نماذج الموفر الملموسة:

- `overrides` يعيّن محدداً ملموساً دقيقاً (`provider/modelId`) إلى معرّف معياري رسمي من المصدر الأعلى
- `exclude` يُخرج محدداً ملموساً من التجميع المعياري

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

- `auth`: `apiKey` (افتراضي) أو `none`
- `discovery.type`: `ollama`

## قواعد التحقق (الحالية)

### موفر مخصص كامل (`models` غير فارغة)

المطلوب:

- `baseUrl`
- `apiKey` ما لم يكن `auth: none`
- `api` على مستوى الموفر أو لكل نموذج

### موفر للتجاوز فقط (`models` مفقودة أو فارغة)

يجب تعريف واحد على الأقل من:

- `baseUrl`
- `modelOverrides`
- `discovery`

### الاكتشاف

- يتطلب `discovery` وجود `api` على مستوى الموفر.

### فحوصات قيم النموذج

- `id` مطلوب
- يجب أن يكون `contextWindow` و`maxTokens` موجبَين إذا تم توفيرهما

## ترتيب الدمج والتجاوز

خط أنابيب ModelRegistry (عند التحديث):

1. تحميل الموفرين/النماذج المدمجة من `@f5xc-salesdemos/pi-ai`.
2. تحميل تكوين `models.yml` المخصص.
3. تطبيق تجاوزات الموفر (`baseUrl`، `headers`) على النماذج المدمجة.
4. تطبيق `modelOverrides` (لكل موفر ومعرّف نموذج).
5. دمج `models` المخصصة:
   - نفس `provider + id` يستبدل الموجود
   - وإلا يُضاف
6. تطبيق النماذج المكتشفة في وقت التشغيل (Ollama وLM Studio حالياً)، ثم إعادة تطبيق تجاوزات النموذج.

## التكافؤ المعياري للنماذج والتجميع

يحتفظ السجل بكل نموذج موفر ملموس ثم يبني طبقة معيارية فوقها.

المعرّفات المعيارية هي معرّفات رسمية من المصدر الأعلى فقط، على سبيل المثال:

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

ترتيب البناء للتجميع المعياري:

1. التجاوز الصريح من المستخدم من `equivalence.overrides`
2. تطابقات المعرّف الرسمي المجمّعة من بيانات وصف النموذج المدمجة
3. تطبيع اكتشافي محافظ لمتغيرات البوابة/الموفر
4. الرجوع إلى معرّف النموذج الملموس الخاص به

الاكتشافات الحالية ضيّقة عمداً:

- يمكن حذف بادئات المصدر الأعلى المضمّنة عند وجودها، مثلاً `anthropic/...` أو `openai/...`
- يمكن تطبيع متغيرات الإصدار بنقطة وشرطة فقط عندما تعيّن إلى معرّف رسمي موجود، مثلاً `4.6 -> 4-6`
- لا يتم دمج العائلات أو الإصدارات الغامضة بدون تطابق مجمّع أو تجاوز صريح

### سلوك الحل المعياري

عندما تشترك متغيرات ملموسة متعددة في معرّف معياري، يستخدم الحل:

1. التوافر والمصادقة
2. `modelProviderOrder` في `config.yml`
3. ترتيب السجل/الموفر الحالي إذا كان `modelProviderOrder` غير محدد

يتم تجاهل الموفرين المعطّلين أو غير الموثّقين.

تواصل حالة الجلسة والسجلات التاريخية تسجيل الموفر/النموذج الملموس الذي نفّذ الدور فعلياً.

افتراضيات الموفر مقابل تجاوزات لكل نموذج:

- `headers` الموفر هي خط الأساس.
- `headers` النموذج تتجاوز مفاتيح رأس الموفر.
- يمكن لـ `modelOverrides` تجاوز بيانات وصف النموذج (`name`، `reasoning`، `input`، `cost`، `contextWindow`، `maxTokens`، `headers`، `compat`، `contextPromotionTarget`).
- يتم الدمج العميق لـ `compat` لكتل التوجيه المتداخلة (`openRouterRouting`، `vercelGatewayRouting`، `extraBody`).

## تكامل الاكتشاف في وقت التشغيل

### اكتشاف Ollama الضمني

إذا لم يكن `ollama` مُكوَّناً صراحةً، يضيف السجل موفراً قابلاً للاكتشاف ضمنياً:

- الموفر: `ollama`
- api: `openai-completions`
- عنوان URL الأساسي: `OLLAMA_BASE_URL` أو `http://127.0.0.1:11434`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف في وقت التشغيل `GET /api/tags` على Ollama ويُنشئ إدخالات نموذج بقيم افتراضية محلية.

### اكتشاف llama.cpp الضمني

إذا لم يكن `llama.cpp` مُكوَّناً صراحةً، يضيف السجل موفراً قابلاً للاكتشاف ضمنياً:
ملاحظة: يستخدم واجهة برمجة تطبيقات رسائل anthropic الأحدث بدلاً من openai-completions.

- الموفر: `llama.cpp`
- api: `openai-responses`
- عنوان URL الأساسي: `LLAMA_CPP_BASE_URL` أو `http://127.0.0.1:8080`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يستدعي الاكتشاف في وقت التشغيل `GET models` على llama.cpp ويُنشئ إدخالات نموذج بقيم افتراضية محلية.

### اكتشاف LM Studio الضمني

إذا لم يكن `lm-studio` مُكوَّناً صراحةً، يضيف السجل موفراً قابلاً للاكتشاف ضمنياً:

- الموفر: `lm-studio`
- api: `openai-completions`
- عنوان URL الأساسي: `LM_STUDIO_BASE_URL` أو `http://127.0.0.1:1234/v1`
- وضع المصادقة: بدون مفتاح (سلوك `auth: none`)

يجلب الاكتشاف في وقت التشغيل النماذج (`GET /models`) ويُنشئ إدخالات نموذج بقيم افتراضية محلية.

### اكتشاف الموفر الصريح

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

### تسجيل موفر الامتداد

يمكن للامتدادات تسجيل موفرين في وقت التشغيل (`pi.registerProvider(...)`), بما في ذلك:

- استبدال النماذج/إضافتها لموفر
- تسجيل معالج بث مخصص لمعرّفات API جديدة
- تسجيل موفر OAuth مخصص

## ترتيب حل المصادقة ومفتاح API

عند طلب مفتاح لموفر، يكون الترتيب الفعّال:

1. التجاوز في وقت التشغيل (CLI `--api-key`)
2. بيانات اعتماد مفتاح API المخزّنة في `agent.db`
3. بيانات اعتماد OAuth المخزّنة في `agent.db` (مع التحديث)
4. تعيين متغير البيئة (`OPENAI_API_KEY`، `ANTHROPIC_API_KEY`، إلخ)
5. محلّل الرجوع في ModelRegistry (موفر `apiKey` من `models.yml`، بدلالات اسم البيئة أو القيمة الحرفية)

سلوك `apiKey` في `models.yml`:

- تُعامَل القيمة أولاً كاسم متغير بيئة.
- إذا لم يكن متغير البيئة موجوداً، تُستخدم السلسلة الحرفية كرمز مميز.

إذا كان `authHeader: true` وكان `apiKey` الموفر محدداً، تحصل النماذج على:

- رأس `Authorization: Bearer <resolved-key>` مُحقَن.

الموفرون بدون مفتاح:

- يُعامَل الموفرون المُعلَّمون بـ `auth: none` على أنهم متاحون بدون بيانات اعتماد.
- يُعيد `getApiKey*` القيمة `kNoAuth` لهم.

## توافر النموذج مقابل جميع النماذج

- يُعيد `getAll()` سجل النماذج المُحمَّل (المدمجة + المخصصة المدموجة + المكتشفة).
- يُصفّي `getAvailable()` للنماذج التي لا تحتاج مفتاحاً أو لها مصادقة قابلة للحل.

لذا يمكن أن يوجد نموذج في السجل لكن لا يكون قابلاً للاختيار حتى تتوفر المصادقة.

## حل النموذج في وقت التشغيل

### CLI وتحليل الأنماط

يدعم `model-resolver.ts`:

- `provider/modelId` الدقيق
- معرّف النموذج المعياري الدقيق
- معرّف النموذج الدقيق (يُستنتج الموفر)
- المطابقة الغامضة/بالسلسلة الجزئية
- أنماط النطاق العام في `--models` (مثلاً `openai/*`، `*sonnet*`)
- لاحقة اختيارية `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` موروث؛ `--model` مفضّل.

أولوية الحل للمحددات الدقيقة:

1. `provider/modelId` الدقيق يتجاوز التجميع
2. المعرّف المعياري الدقيق يُحلّ عبر الفهرس المعياري
3. معرّف ملموس مجرّد دقيق لا يزال يعمل
4. المطابقة الغامضة والعام تعمل بعد المسارات الدقيقة

### أولوية اختيار النموذج الأولي

يستخدم `findInitialModel(...)` هذا الترتيب:

1. موفر+نموذج CLI صريح
2. أول نموذج في النطاق (إذا لم يكن استئنافاً)
3. الموفر/النموذج الافتراضي المحفوظ
4. افتراضيات الموفر المعروفة (مثلاً OpenAI/Anthropic/إلخ) بين النماذج المتاحة
5. أول نموذج متاح

### أدوار الأسماء المستعارة والإعدادات

أدوار النماذج المدعومة:

- `default`، `smol`، `slow`، `plan`، `commit`

أسماء الأدوار المستعارة مثل `pi/smol` تُوسَّع عبر `settings.modelRoles`. يمكن لكل قيمة دور أيضاً إلحاق محدد تفكير مثل `:minimal`، `:low`، `:medium`، أو `:high`.

إذا كان الدور يشير إلى دور آخر، فإن النموذج المستهدف لا يزال يرث بصورة طبيعية وأي لاحقة صريحة على الدور المُحيل تفوز لذلك الاستخدام الخاص بالدور.

الإعدادات ذات الصلة:

- `modelRoles` (سجل)
- `enabledModels` (قائمة أنماط النطاق)
- `modelProviderOrder` (أولوية الموفر المعياري العامة)
- `providers.kimiApiFormat` (تنسيق طلب `openai` أو `anthropic`)
- `providers.openaiWebsockets` (تفضيل WebSocket بـ `auto|off|on` لنقل OpenAI Codex)

قد يخزّن `modelRoles` إما:

- `provider/modelId` لتثبيت متغير موفر ملموس
- معرّفاً معيارياً مثل `gpt-5.3-codex` للسماح بتجميع الموفرين

بالنسبة لـ `enabledModels` وـ `--models` في CLI:

- تُوسَّع المعرّفات المعيارية الدقيقة إلى جميع المتغيرات الملموسة في تلك المجموعة المعيارية
- إدخالات `provider/modelId` الصريحة تبقى دقيقة
- العام والمطابقة الغامضة لا تزال تعمل على النماذج الملموسة

## `/model` و`--list-models`

تُبقي كلتا الواجهتين النماذج ذات البادئة المتعلقة بالموفر مرئية وقابلة للاختيار.

تكشفان الآن أيضاً النماذج المعيارية/المجمّعة:

- يتضمن `/model` عرضاً معيارياً جانباً بتبويبات الموفر
- يطبع `--list-models` قسماً معيارياً بالإضافة إلى صفوف الموفر الملموسة

يخزّن اختيار إدخال معياري المحدد المعياري. يخزّن اختيار صف موفر `provider/modelId` الصريح.

## ترقية السياق (سلاسل الرجوع على مستوى النموذج)

ترقية السياق هي آلية استرداد من الفيض لمتغيرات السياق الصغيرة (مثلاً `*-spark`) التي تُرقّي تلقائياً إلى نسخة ذات سياق أكبر عندما يرفض API الطلب بخطأ طول سياق.

### المشغّل والترتيب

عندما يفشل دور بخطأ فيض سياق (مثلاً `context_length_exceeded`)، يحاول `AgentSession` الترقية **قبل** الرجوع إلى الضغط:

1. إذا كان `contextPromotion.enabled` صحيحاً، يُحلّ هدف الترقية (انظر أدناه).
2. إذا وُجد هدف، يتم التبديل إليه وإعادة محاولة الطلب — لا حاجة للضغط.
3. إذا لم يتوفر هدف، يتم الرجوع إلى الضغط التلقائي على النموذج الحالي.

### اختيار الهدف

الاختيار مُوجَّه بالنموذج، لا بالدور:

1. `currentModel.contextPromotionTarget` (إذا كان مُكوَّناً)
2. أصغر نموذج بسياق أكبر لدى نفس الموفر + API

يتم تجاهل المرشّحين ما لم تُحلّ بيانات الاعتماد (`ModelRegistry.getApiKey(...)`).

### تسليم WebSocket لـ OpenAI Codex

عند التبديل من/إلى `openai-codex-responses`، يُغلَق مفتاح حالة موفر الجلسة `openai-codex-responses` قبل تبديل النموذج. هذا يُسقط حالة نقل WebSocket حتى يبدأ الدور التالي نظيفاً على النموذج المُرقَّى.

### سلوك الاستمرارية

تستخدم الترقية التبديل المؤقت (`setModelTemporary`):

- يُسجَّل كـ `model_change` مؤقت في تاريخ الجلسة
- لا يعيد كتابة تعيين الدور المحفوظ

### تكوين سلاسل الرجوع الصريحة

قم بتكوين الرجوع مباشرةً في بيانات وصف النموذج عبر `contextPromotionTarget`.

يقبل `contextPromotionTarget` إما:

- `provider/model-id` (صريح)
- `model-id` (يُحلّ داخل الموفر الحالي)

مثال (`models.yml`) لـ Spark -> غير Spark على نفس الموفر:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

يُعيّن مولّد النماذج المدمج هذا أيضاً تلقائياً لنماذج `*-spark` عندما يوجد نموذج أساسي على نفس الموفر.

## حقول التوافق والتوجيه

يدعم `models.yml` هذه المجموعة الفرعية من `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` أو `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

تُستهلك هذه الحقول بواسطة منطق نقل OpenAI-completions وتُجمَع مع الكشف التلقائي القائم على URL.

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

### وكيل مستضاف بمفتاح مستند إلى متغير البيئة

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

### تجاوز مسار الموفر المدمج + بيانات وصف النموذج

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

## الضبط التلقائي لـ LiteLLM proxy

عند تعيين متغيري البيئة `LITELLM_BASE_URL` و`LITELLM_API_KEY` معاً، يدير xcsh تلقائياً تكوين `models.yml` لـ LiteLLM proxy.

### التوليد التلقائي عند أول تشغيل

إذا لم يكن `models.yml` موجوداً واكتُشف متغيرا بيئة LiteLLM، يُنشئه xcsh تلقائياً:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

يُنشأ أيضاً `config.yml` افتراضي بإعدادات موفر الصور المعقولة.

### الإصلاح الذاتي عند بدء التشغيل

عند كل بدء تشغيل، يُشغّل `startupHealthCheck()` في سجل النماذج الفحوصات التالية:

| الحالة | الإجراء |
|-----------|--------|
| `models.yml` مفقود | التوليد التلقائي من متغيرات البيئة |
| `models.yml` تالف أو غير قابل للتحليل | نسخ احتياطي بـ `.bak`، إعادة التوليد |
| `baseUrl` لا يتطابق مع `LITELLM_BASE_URL` | نسخ احتياطي بـ `.bak`، إعادة التوليد بعنوان URL الجديد |
| `configVersion` مفقود أو قديم | نسخ احتياطي بـ `.bak`، إعادة التوليد بالإصدار الحالي |
| التكوين سليم | لا إجراء |

تُنشئ جميع الإصلاحات نسخاً احتياطية بـ `.bak` قبل الكتابة فوقها. جميع العمليات غير قابلة للتأثير المتكرر.

### أمر CLI

```bash
xcsh setup litellm              # إنشاء أو إصلاح تكوين LiteLLM
xcsh setup litellm --check      # التحقق بدون كتابة
xcsh setup litellm --check --json  # إخراج التحقق قابل للقراءة آلياً
```

### متغيرات البيئة المطلوبة

| المتغير | الغرض |
|----------|---------|
| `LITELLM_BASE_URL` | عنوان URL لـ LiteLLM proxy (مثلاً `https://your-proxy.example.com`). يجب أن يبدأ بـ `http://` أو `https://`. |
| `LITELLM_API_KEY` | مفتاح API للوكيل. يُشار إليه بالاسم في التكوين المُولَّد ويُحلّ في وقت التشغيل. |

إذا لم يكن أي من المتغيرين محدداً، يتم تخطي الضبط التلقائي بصمت.

### إصدار التكوين

تتضمن التكوينات المُولَّدة حقل `configVersion`. عندما يتغير تنسيق التوليد في الإصدارات المستقبلية، يكتشف xcsh التكوينات القديمة ويُرقّيها تلقائياً (مع نسخ احتياطي).

## تحفّظ المستهلك القديم

يتدفق معظم تكوين النماذج الآن عبر `models.yml` عبر `ModelRegistry`.

يبقى مسار موروث واحد ملحوظ: لا يزال حل مصادقة Anthropic للبحث على الويب يقرأ `~/.xcsh/agent/models.json` مباشرةً في `src/web/search/auth.ts`.

إذا كنت تعتمد على ذلك المسار المحدد، ضع في اعتبارك التوافق مع JSON حتى يُرحَّل ذلك الوحدة.

## وضع الفشل

إذا فشل `models.yml` في فحوصات المخطط أو التحقق:

- إذا كان `LITELLM_BASE_URL` و`LITELLM_API_KEY` محدّدَين، يحاول فحص صحة بدء التشغيل الإصلاح التلقائي (نسخ الملف التالف احتياطياً، وإعادة التوليد من متغيرات البيئة). إذا نجح الإصلاح، يُعيد السجل تحميل التكوين المُصلَح.
- إذا لم يكن الإصلاح التلقائي ممكناً (متغيرات البيئة غير محدّدة، فشل الكتابة)، يستمر السجل في العمل بالنماذج المدمجة.
- يُكشف الخطأ عبر `ModelRegistry.getError()` ويُعرض في واجهة المستخدم/الإشعارات.
