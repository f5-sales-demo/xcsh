---
title: متغيرات البيئة
description: مرجع متغيرات بيئة وقت التشغيل لتكوين xcsh والتحكم في سلوكه.
sidebar:
  order: 2
  label: متغيرات البيئة
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# متغيرات البيئة (مرجع وقت التشغيل الحالي)

هذا المرجع مُستمد من مسارات الكود الحالية في:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (دقة المزود/المصادقة المُستخدمة بواسطة coding-agent)
- `packages/utils/src/**` و `packages/tui/src/**` حيث تؤثر تلك المتغيرات مباشرة على وقت تشغيل coding-agent

يوثق هذا المرجع السلوك النشط فقط.

## نموذج الدقة والأسبقية

معظم عمليات البحث في وقت التشغيل تستخدم `$env` من `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`).

ترتيب تحميل `$env`:

1. بيئة العملية الحالية (`Bun.env`)
2. ملف `.env` الخاص بالمشروع (`$PWD/.env`) للمفاتيح غير المُعيّنة مسبقاً
3. ملف `.env` الخاص بالمجلد الرئيسي (`~/.env`) للمفاتيح غير المُعيّنة مسبقاً

قاعدة إضافية في ملفات `.env`: يتم نسخ مفاتيح `XCSH_*` إلى مفاتيح `PI_*` أثناء التحليل.

---

## 1) مصادقة النموذج/المزود

تُستهلك هذه عبر `getEnvApiKey()` (`packages/ai/src/stream.ts`) ما لم يُذكر خلاف ذلك.

### بيانات اعتماد المزود الأساسية

| المتغير                        | الاستخدام | مطلوب عندما                                                 | ملاحظات / الأسبقية                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | مصادقة Anthropic API | استخدام Anthropic مع مصادقة رمز OAuth                         | يأخذ الأسبقية على `ANTHROPIC_API_KEY` لدقة مصادقة المزود                              |
| `ANTHROPIC_API_KEY`             | مصادقة Anthropic API | استخدام Anthropic بدون رمز OAuth                           | احتياطي بعد `ANTHROPIC_OAUTH_TOKEN`                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic عبر Azure Foundry / بوابة المؤسسات | تفعيل `CLAUDE_CODE_USE_FOUNDRY`                             | يأخذ الأسبقية على `ANTHROPIC_OAUTH_TOKEN` و `ANTHROPIC_API_KEY` عند تفعيل وضع Foundry  |
| `OPENAI_API_KEY`                | مصادقة OpenAI | استخدام مزودي عائلة OpenAI بدون وسيط apiKey صريح | يُستخدم بواسطة مزودي OpenAI Completions/Responses                                                      |
| `GEMINI_API_KEY`                | مصادقة Google Gemini | استخدام نماذج مزود `google`                                | المفتاح الأساسي لتعيين مزود Gemini                                                             |
| `GOOGLE_API_KEY`                | احتياطي مصادقة أداة صور Gemini | استخدام أداة `gemini_image` بدون `GEMINI_API_KEY`            | يُستخدم بواسطة مسار أداة الصور الاحتياطي في coding-agent                                                       |
| `GROQ_API_KEY`                  | مصادقة Groq | استخدام نماذج Groq                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | مصادقة Cerebras | استخدام نماذج Cerebras                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | مصادقة Together | استخدام مزود `together`                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | مصادقة Hugging Face | استخدام مزود `huggingface`                                  | متغير رمز Hugging Face الأساسي                                                                  |
| `HF_TOKEN`                      | مصادقة Hugging Face | استخدام مزود `huggingface`                                  | احتياطي عندما يكون `HUGGINGFACE_HUB_TOKEN` غير مُعيّن                                                      |
| `SYNTHETIC_API_KEY`             | مصادقة Synthetic | استخدام نماذج Synthetic                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | مصادقة NVIDIA | استخدام مزود `nvidia`                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | مصادقة NanoGPT | استخدام مزود `nanogpt`                                      |                                                                                                     |
| `VENICE_API_KEY`                | مصادقة Venice | استخدام مزود `venice`                                       |                                                                                                     |
| `LITELLM_API_KEY`               | مصادقة LiteLLM | استخدام مزود `litellm`                                      | مفتاح وكيل LiteLLM المتوافق مع OpenAI. عند تعيينه مع `LITELLM_BASE_URL`، يُفعّل التكوين التلقائي لـ `models.yml` |
| `LM_STUDIO_API_KEY`             | مصادقة LM Studio (اختياري) | استخدام مزود `lm-studio` مع مضيفين مصادق عليهم           | عادة يعمل LM Studio المحلي بدون مصادقة؛ أي رمز غير فارغ يعمل عند الحاجة لمفتاح         |
| `OLLAMA_API_KEY`                | مصادقة Ollama (اختياري) | استخدام مزود `ollama` مع مضيفين مصادق عليهم              | عادة يعمل Ollama المحلي بدون مصادقة؛ أي رمز غير فارغ يعمل عند الحاجة لمفتاح            |
| `LLAMA_CPP_API_KEY`             | مصادقة Ollama (اختياري) | استخدام `llama-server` مع معامل `--api-key`              | عادة يعمل llama.cpp المحلي بدون مصادقة؛ أي رمز غير فارغ يعمل عند تكوين مفتاح       |
| `XIAOMI_API_KEY`                | مصادقة Xiaomi MiMo | استخدام مزود `xiaomi`                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | مصادقة Moonshot | استخدام مزود `moonshot`                                     |                                                                                                     |
| `XAI_API_KEY`                   | مصادقة xAI | استخدام نماذج xAI                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | مصادقة OpenRouter | استخدام نماذج OpenRouter                                       | يُستخدم أيضاً بواسطة أداة الصور عندما يكون المزود المفضل/التلقائي هو OpenRouter                                  |
| `MISTRAL_API_KEY`               | مصادقة Mistral | استخدام نماذج Mistral                                          |                                                                                                     |
| `ZAI_API_KEY`                   | مصادقة z.ai | استخدام نماذج z.ai                                             | يُستخدم أيضاً بواسطة مزود بحث الويب z.ai                                                               |
| `MINIMAX_API_KEY`               | مصادقة MiniMax | استخدام مزود `minimax`                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | مصادقة MiniMax Code | استخدام مزود `minimax-code`                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | مصادقة MiniMax Code CN | استخدام مزود `minimax-code-cn`                              |                                                                                                     |
| `OPENCODE_API_KEY`              | مصادقة OpenCode | استخدام نماذج OpenCode                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | مصادقة Qianfan | استخدام مزود `qianfan`                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | مصادقة Qwen Portal | استخدام `qwen-portal` مع رمز OAuth                          | يأخذ الأسبقية على `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | مصادقة Qwen Portal | استخدام `qwen-portal` مع مفتاح API                              | احتياطي بعد `QWEN_OAUTH_TOKEN`                                                                   |
| `ZENMUX_API_KEY`                | مصادقة ZenMux | استخدام مزود `zenmux`                                       | يُستخدم لمسارات ZenMux المتوافقة مع OpenAI وAnthropic                                              |
| `VLLM_API_KEY`                  | مصادقة/اكتشاف vLLM | استخدام مزود `vllm` (خوادم محلية متوافقة مع OpenAI)       | أي قيمة غير فارغة تعمل للخوادم المحلية بدون مصادقة                                                 |
| `CURSOR_ACCESS_TOKEN`           | مصادقة مزود Cursor | استخدام مزود Cursor                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | مصادقة Vercel AI Gateway | استخدام مزود `vercel-ai-gateway`                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | مصادقة Cloudflare AI Gateway | استخدام مزود `cloudflare-ai-gateway`                        | يجب تكوين عنوان URL الأساسي كـ `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### سلاسل رموز GitHub/Copilot

| المتغير | الاستخدام | السلسلة |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | مصادقة مزود GitHub Copilot | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | احتياطي Copilot؛ مصادقة GitHub API في أداة استخراج الويب | في أداة استخراج الويب: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | احتياطي Copilot؛ مصادقة GitHub API في أداة استخراج الويب | في أداة استخراج الويب: يُفحص قبل `GH_TOKEN` |

---

## 2) تكوين وقت التشغيل الخاص بالمزود

### بوابة Anthropic Foundry (Azure / وكيل المؤسسات)

عند تفعيل `CLAUDE_CODE_USE_FOUNDRY`، تتحول طلبات Anthropic إلى وضع Foundry:

- يُحل عنوان URL الأساسي من `FOUNDRY_BASE_URL` (يبقى الاحتياطي هو عنوان URL الأساسي للنموذج/الافتراضي إذا لم يُعيّن).
- تصبح دقة مفتاح API للمزود `anthropic`:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- يُحلل `ANTHROPIC_CUSTOM_HEADERS` كأزواج `key: value` مفصولة بفواصل/أسطر جديدة ويُدمج في رؤوس الطلب.
- يمكن حقن مواد TLS للعميل/الخادم من قيم البيئة:
  `NODE_EXTRA_CA_CERTS`، `CLAUDE_CODE_CLIENT_CERT`، `CLAUDE_CODE_CLIENT_KEY`.
  كل منها يقبل إما:
  - مسار نظام ملفات لمحتوى PEM، أو
  - PEM مضمّن (بما في ذلك تسلسلات `\n` المُهرّبة).

| المتغير | نوع القيمة | السلوك |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | سلسلة شبيهة بالمنطقية (`1`، `true`، `yes`، `on`) | يُفعّل وضع Foundry لمزود Anthropic |
| `FOUNDRY_BASE_URL` | سلسلة URL | عنوان URL الأساسي لنقطة نهاية Anthropic في وضع Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | سلسلة رمز | يُستخدم لـ `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | سلسلة قائمة رؤوس | رؤوس إضافية؛ التنسيق `header-a: value, header-b: value` أو مفصولة بأسطر جديدة |
| `NODE_EXTRA_CA_CERTS` | مسار PEM أو PEM مضمّن | سلسلة CA إضافية للتحقق من شهادة الخادم |
| `CLAUDE_CODE_CLIENT_CERT` | مسار PEM أو PEM مضمّن | شهادة عميل mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | مسار PEM أو PEM مضمّن | مفتاح خاص لعميل mTLS (يجب إقرانه بالشهادة) |

### Amazon Bedrock

| المتغير | الافتراضي / السلوك |
|---|---|
| `AWS_REGION` | مصدر المنطقة الأساسي |
| `AWS_DEFAULT_REGION` | احتياطي إذا لم يُعيّن `AWS_REGION` |
| `AWS_PROFILE` | يُفعّل مسار مصادقة الملف الشخصي المُسمّى |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | يُفعّل مسار مصادقة مفتاح IAM |
| `AWS_BEARER_TOKEN_BEDROCK` | يُفعّل مسار مصادقة رمز الحامل |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | يُفعّل مسار بيانات اعتماد مهام ECS |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | يُفعّل مسار مصادقة هوية الويب |
| `AWS_BEDROCK_SKIP_AUTH` | إذا كان `1`، يحقن بيانات اعتماد وهمية (سيناريوهات الوكيل/بدون مصادقة) |
| `AWS_BEDROCK_FORCE_HTTP1` | إذا كان `1`، يفرض معالج طلبات Node HTTP/1 |

احتياطي المنطقة في كود المزود: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### استجابات Azure OpenAI

| المتغير | الافتراضي / السلوك |
|---|---|
| `AZURE_OPENAI_API_KEY` | مطلوب ما لم يُمرر مفتاح API كخيار |
| `AZURE_OPENAI_API_VERSION` | الافتراضي `v1` |
| `AZURE_OPENAI_BASE_URL` | تجاوز مباشر لعنوان URL الأساسي |
| `AZURE_OPENAI_RESOURCE_NAME` | يُستخدم لبناء عنوان URL الأساسي: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | سلسلة تعيين اختيارية: `modelId=deploymentName,model2=deployment2` |

دقة عنوان URL الأساسي: خيار `azureBaseUrl` → بيئة `AZURE_OPENAI_BASE_URL` → خيار/بيئة اسم المورد → `model.baseUrl`.

### Google Vertex AI

| المتغير | مطلوب؟ | ملاحظات |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | نعم (ما لم يُمرر في الخيارات) | احتياطي: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | احتياطي | يُستخدم كمصدر بديل لمعرف المشروع |
| `GOOGLE_CLOUD_LOCATION` | نعم (ما لم يُمرر في الخيارات) | لا يوجد افتراضي في المزود |
| `GOOGLE_APPLICATION_CREDENTIALS` | مشروط | إذا عُيّن، يجب أن يكون الملف موجوداً؛ وإلا يُفحص مسار ADC الاحتياطي (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| المتغير | الافتراضي / السلوك |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | تجاوز مضيف OAuth الأساسي |
| `KIMI_OAUTH_HOST` | تجاوز مضيف OAuth الاحتياطي |
| `KIMI_CODE_BASE_URL` | يتجاوز عنوان URL الأساسي لنقطة نهاية استخدام Kimi (`usage/kimi.ts`) |

سلسلة مضيف OAuth: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### توافق Antigravity/صور Gemini

| المتغير | الافتراضي / السلوك |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | يتجاوز علامة إصدار وكيل المستخدم Antigravity في مزود Gemini CLI |

### استجابات OpenAI Codex (عناصر تحكم الميزات/التصحيح)

| المتغير | السلوك |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` يُفعّل تسجيل تصحيح مزود Codex |
| `PI_CODEX_WEBSOCKET` | `1`/`true` يُفعّل تفضيل نقل websocket |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` يُفعّل مسار websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | تجاوز عدد صحيح موجب (الافتراضي 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | تجاوز عدد صحيح غير سالب (الافتراضي 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | تجاوز تأخير أساسي للتراجع كعدد صحيح موجب (الافتراضي 500) |

### تصحيح مزود Cursor

| المتغير | السلوك |
|---|---|
| `DEBUG_CURSOR` | يُفعّل سجلات تصحيح المزود؛ `2`/`verbose` لمقتطفات حمولة مفصلة |
| `DEBUG_CURSOR_LOG` | مسار ملف اختياري لإخراج سجل تصحيح JSONL |

### مفتاح توافق ذاكرة التخزين المؤقت للمطالبات

| المتغير | السلوك |
|---|---|
| `PI_CACHE_RETENTION` | إذا كان `long`، يُفعّل الاحتفاظ الطويل حيث يُدعم (`anthropic`، `openai-responses`، دقة احتفاظ Bedrock) |

---

## 3) نظام البحث على الويب الفرعي

### بيانات اعتماد مزود البحث

| المتغير | يُستخدم بواسطة |
|---|---|
| `EXA_API_KEY` | مزود بحث Exa وأدوات Exa MCP |
| `BRAVE_API_KEY` | مزود بحث Brave |
| `PERPLEXITY_API_KEY` | وضع مفتاح API لمزود بحث Perplexity |
| `TAVILY_API_KEY` | مزود بحث Tavily |
| `ZAI_API_KEY` | مزود بحث z.ai (يتحقق أيضاً من OAuth المُخزّن في `agent.db`) |
| `OPENAI_API_KEY` / Codex OAuth في DB | توفر/مصادقة مزود بحث Codex |

### سلسلة مصادقة بحث الويب لـ Anthropic

يُحل `packages/coding-agent/src/web/search/auth.ts` بيانات اعتماد بحث الويب لـ Anthropic بهذا الترتيب:

1. `ANTHROPIC_SEARCH_API_KEY` (+ اختياري `ANTHROPIC_SEARCH_BASE_URL`)
2. إدخال مزود `models.json` مع `api: "anthropic-messages"`
3. بيانات اعتماد Anthropic OAuth من `agent.db` (يجب ألا تنتهي صلاحيتها خلال فترة عازلة مدتها 5 دقائق)
4. احتياطي بيئة Anthropic العام: مفتاح المزود (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + اختياري `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` عند تفعيل وضع Foundry)

المتغيرات ذات الصلة:

| المتغير | الافتراضي / السلوك |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | مفتاح بحث صريح بأعلى أسبقية |
| `ANTHROPIC_SEARCH_BASE_URL` | يُعيّن افتراضياً إلى `https://api.anthropic.com` عند حذفه |
| `ANTHROPIC_SEARCH_MODEL` | يُعيّن افتراضياً إلى `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | عنوان URL أساسي احتياطي عام لمسار مصادقة المستوى 4 |

### علامة سلوك تدفق Perplexity OAuth

| المتغير | السلوك |
|---|---|
| `PI_AUTH_NO_BORROW` | إذا عُيّن، يُعطّل مسار استعارة رمز التطبيق الأصلي لـ macOS في تدفق تسجيل دخول Perplexity |

---

## 4) أدوات Python ووقت تشغيل النواة

| المتغير | الافتراضي / السلوك |
|---|---|
| `PI_PY` | تجاوز وضع أداة Python: `0`/`bash`=`bash-only`، `1`/`py`=`ipy-only`، `mix`/`both`=`both`؛ القيم غير الصالحة تُتجاهل |
| `PI_PYTHON_SKIP_CHECK` | إذا كان `1`، يتخطى فحوصات توفر نواة Python/فحوصات التسخين |
| `PI_PYTHON_GATEWAY_URL` | إذا عُيّن، يستخدم بوابة نواة خارجية بدلاً من البوابة المشتركة المحلية |
| `PI_PYTHON_GATEWAY_TOKEN` | رمز مصادقة اختياري للبوابة الخارجية (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | إذا كان `1`، يُفعّل مسار تتبع IPC المنخفض المستوى في وحدة النواة |
| `VIRTUAL_ENV` | مسار venv بأعلى أسبقية لدقة وقت تشغيل Python |

سلوك شرطي إضافي:

- إذا كان `BUN_ENV=test` أو `NODE_ENV=test`، تُعامل فحوصات توفر Python كناجحة ويُتخطى التسخين.
- تصفية بيئة Python ترفض مفاتيح API الشائعة وتسمح بمتغيرات الأساس الآمنة + بادئات `LC_`، `XDG_`، `PI_`.

---

## 5) مفاتيح تبديل سلوك الوكيل/وقت التشغيل

| المتغير                   | الافتراضي / السلوك                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | تجاوز مؤقت لدور النموذج `smol` (CLI `--smol` يأخذ الأسبقية)                     |
| `PI_SLOW_MODEL`            | تجاوز مؤقت لدور النموذج `slow` (CLI `--slow` يأخذ الأسبقية)                     |
| `PI_PLAN_MODEL`            | تجاوز مؤقت لدور النموذج `plan` (CLI `--plan` يأخذ الأسبقية)                     |
| `PI_NO_TITLE`              | إذا عُيّن (أي قيمة غير فارغة)، يُعطّل توليد عنوان الجلسة التلقائي عند أول رسالة مستخدم   |
| `NULL_PROMPT`              | إذا كان `true`، يُعيد منشئ مطالبة النظام سلسلة فارغة                                        |
| `PI_BLOCKED_AGENT`         | يحظر نوع وكيل فرعي محدد في أداة المهام                                                 |
| `PI_SUBPROCESS_CMD`        | يتجاوز أمر إنشاء الوكيل الفرعي (تجاوز دقة `xcsh` / `xcsh.cmd`)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | الحد الأقصى لبايتات الإخراج الملتقطة لكل وكيل فرعي (الافتراضي `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | الحد الأقصى لأسطر الإخراج الملتقطة لكل وكيل فرعي (الافتراضي `5000`)                                      |
| `PI_TIMING`                | إذا كان `1`، يُفعّل سجلات أدوات توقيت بدء التشغيل/الأدوات                                     |
| `PI_DEBUG_STARTUP`         | يُفعّل طباعة تصحيح مرحلة بدء التشغيل إلى stderr في مسارات بدء تشغيل متعددة                       |
| `PI_PACKAGE_DIR`           | يتجاوز دقة مجلد أصول الحزمة الأساسي (بحث مسار المستندات/الأمثلة/سجل التغييرات)            |
| `PI_DISABLE_LSPMUX`        | إذا كان `1`، يُعطّل اكتشاف/تكامل lspmux ويفرض إنشاء خادم LSP مباشر          |
| `LITELLM_BASE_URL`         | عنوان URL الأساسي لوكيل LiteLLM. عند تعيينه مع `LITELLM_API_KEY`، يُطلق التوليد التلقائي لـ `models.yml` عند التشغيل الأول والإصلاح الذاتي عند كل بدء تشغيل |
| `LM_STUDIO_BASE_URL`       | تجاوز عنوان URL الأساسي الافتراضي الضمني لاكتشاف LM Studio (`http://127.0.0.1:1234/v1` إذا لم يُعيّن) |
| `OLLAMA_BASE_URL`          | تجاوز عنوان URL الأساسي الافتراضي الضمني لاكتشاف Ollama (`http://127.0.0.1:11434` إذا لم يُعيّن)      |
| `LLAMA_CPP_BASE_URL`       | تجاوز عنوان URL الأساسي الافتراضي الضمني لاكتشاف Llama.cpp (`http://127.0.0.1:8080` إذا لم يُعيّن)    |
| `PI_EDIT_VARIANT`          | إذا كان `hashline`، يفرض وضع عرض قراءة/بحث hashline عند توفر أداة التحرير               |
| `PI_NO_PTY`                | إذا كان `1`، يُعطّل مسار PTY التفاعلي لأداة bash                                          |

يُعيّن `PI_NO_PTY` أيضاً داخلياً عند استخدام CLI `--no-pty`.

---

## 6) مسارات جذر التخزين والتكوين

تُستهلك هذه عبر `@f5xc-salesdemos/pi-utils/dirs` وتؤثر على مكان تخزين بيانات coding-agent.

| المتغير | الافتراضي / السلوك |
|---|---|
| `PI_CONFIG_DIR` | اسم مجلد جذر التكوين تحت المجلد الرئيسي (الافتراضي `.xcsh`) |
| `PI_CODING_AGENT_DIR` | تجاوز كامل لمجلد الوكيل (الافتراضي `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | يُستخدم عند مطابقة مجلد العمل الحالي القانوني في مساعدات المسار |

---

## 7) بيئة تنفيذ الصدفة/الأدوات

(من `packages/utils/src/procmgr.ts` وتكامل أداة bash في coding-agent.)

| المتغير | السلوك |
|---|---|
| `PI_BASH_NO_CI` | يمنع الحقن التلقائي لـ `CI=true` في بيئة الصدفة المُنشأة |
| `CLAUDE_BASH_NO_CI` | اسم مستعار قديم احتياطي لـ `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | مُعدّ لتعطيل وضع صدفة تسجيل الدخول |
| `CLAUDE_BASH_NO_LOGIN` | اسم مستعار قديم احتياطي لـ `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | غلاف بادئة أمر اختياري |
| `CLAUDE_CODE_SHELL_PREFIX` | اسم مستعار قديم احتياطي لـ `PI_SHELL_PREFIX` |
| `VISUAL` | أمر المحرر الخارجي المفضل |
| `EDITOR` | أمر المحرر الخارجي الاحتياطي |

ملاحظة التنفيذ الحالي: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` يُقرأان، لكن `getShellArgs()` الحالية تُعيد `['-l','-c']` في كلا الفرعين (بدون تأثير فعلي اليوم).

---

## 8) كشف واجهة المستخدم/السمة/الجلسة (بيئة مُكتشفة تلقائياً)

تُقرأ هذه كإشارات وقت تشغيل؛ عادة ما تُعيّنها المحطة الطرفية/نظام التشغيل بدلاً من التكوين اليدوي.

| المتغير | الاستخدام |
|---|---|
| `COLORTERM`، `TERM`، `WT_SESSION` | كشف قدرة الألوان (وضع لون السمة) |
| `COLORFGBG` | كشف تلقائي لخلفية المحطة الطرفية فاتحة/داكنة |
| `TERM_PROGRAM`، `TERM_PROGRAM_VERSION`، `TERMINAL_EMULATOR` | هوية المحطة الطرفية في مطالبة/سياق النظام |
| `KDE_FULL_SESSION`، `XDG_CURRENT_DESKTOP`، `DESKTOP_SESSION`، `XDG_SESSION_DESKTOP`، `GDMSESSION`، `WINDOWMANAGER` | كشف سطح المكتب/مدير النوافذ في مطالبة/سياق النظام |
| `KITTY_WINDOW_ID`، `TMUX_PANE`، `TERM_SESSION_ID`، `WT_SESSION` | معرفات جلسة مستقرة لكل محطة طرفية |
| `SHELL`، `ComSpec`، `TERM_PROGRAM`، `TERM` | تشخيصات معلومات النظام |
| `APPDATA`، `XDG_CONFIG_HOME` | دقة مسار تكوين lspmux |
| `HOME` | اختصار المسار في واجهة أمر MCP |

---

## 9) علامات المحمّل الأصلي/التصحيح

| المتغير | السلوك |
|---|---|
| `PI_DEV` | يُفعّل تشخيصات تحميل الإضافة الأصلية المفصلة في `packages/natives` |

## 10) علامات وقت تشغيل TUI (حزمة مشتركة، تؤثر على تجربة المستخدم في coding-agent)

| المتغير | السلوك |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` يمنع إشعارات سطح المكتب |
| `PI_TUI_WRITE_LOG` | إذا عُيّن، يُسجّل كتابات TUI في ملف |
| `PI_HARDWARE_CURSOR` | إذا كان `1`، يُفعّل وضع مؤشر الأجهزة |
| `PI_CLEAR_ON_SHRINK` | إذا كان `1`، يمسح الصفوف الفارغة عند تقلص المحتوى |
| `PI_DEBUG_REDRAW` | إذا كان `1`، يُفعّل تسجيل تصحيح إعادة الرسم |
| `PI_TUI_DEBUG` | إذا كان `1`، يُفعّل مسار تفريغ تصحيح TUI العميق |

---

## 11) عناصر التحكم في توليد الالتزام

| المتغير | السلوك |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | إذا كان `true` (غير حساس لحالة الأحرف)، يفرض مسار توليد الالتزام الاحتياطي |
| `PI_COMMIT_NO_FALLBACK` | إذا كان `true`، يُعطّل الاحتياطي عندما لا يُعيد الوكيل أي اقتراح |
| `PI_COMMIT_MAP_REDUCE` | إذا كان `false`، يُعطّل مسار تحليل التزام map-reduce |
| `DEBUG` | إذا عُيّن، تُطبع تتبعات مكدس أخطاء وكيل الالتزام |

---

## المتغيرات الحساسة أمنياً

عامل هذه كأسرار؛ لا تُسجّلها أو تلتزم بها:

- مفاتيح المزود/API وبيانات اعتماد OAuth/الحامل (جميع `*_API_KEY`، `*_TOKEN`، رموز وصول/تحديث OAuth)
- بيانات اعتماد السحابة (`AWS_*`، مسار `GOOGLE_APPLICATION_CREDENTIALS` قد يكشف مواد حساب الخدمة)
- متغيرات مصادقة البحث/المزود (`EXA_API_KEY`، `BRAVE_API_KEY`، `PERPLEXITY_API_KEY`، مفاتيح بحث Anthropic)
- مواد mTLS لـ Foundry (`CLAUDE_CODE_CLIENT_CERT`، `CLAUDE_CODE_CLIENT_KEY`، `NODE_EXTRA_CA_CERTS` عندما يشير إلى حزم CA خاصة)

يقوم وقت تشغيل Python أيضاً بتجريد العديد من متغيرات المفاتيح الشائعة بشكل صريح قبل إنشاء عمليات نواة فرعية (`packages/coding-agent/src/ipy/runtime.ts`).
