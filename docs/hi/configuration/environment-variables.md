---
title: पर्यावरण चर
description: xcsh कॉन्फ़िगरेशन और व्यवहार नियंत्रण के लिए रनटाइम पर्यावरण चर संदर्भ।
sidebar:
  order: 2
  label: पर्यावरण चर
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# पर्यावरण चर (वर्तमान रनटाइम संदर्भ)

यह संदर्भ वर्तमान कोड पथों से प्राप्त है:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (coding-agent द्वारा उपयोग किया जाने वाला provider/auth resolution)
- `packages/utils/src/**` और `packages/tui/src/**` जहाँ ये चर सीधे coding-agent रनटाइम को प्रभावित करते हैं

यह केवल सक्रिय व्यवहार का दस्तावेज़ीकरण करता है।

## रिज़ॉल्यूशन मॉडल और प्राथमिकता

अधिकांश रनटाइम लुकअप `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`) से `$env` का उपयोग करते हैं।

`$env` लोडिंग क्रम:

1. मौजूदा प्रोसेस एनवायरनमेंट (`Bun.env`)
2. प्रोजेक्ट `.env` (`$PWD/.env`) उन कुंजियों के लिए जो पहले से सेट नहीं हैं
3. होम `.env` (`~/.env`) उन कुंजियों के लिए जो पहले से सेट नहीं हैं

`.env` फ़ाइलों में अतिरिक्त नियम: `XCSH_*` कुंजियों को पार्स के दौरान `PI_*` कुंजियों में मिरर किया जाता है।

---

## 1) मॉडल/प्रदाता प्रमाणीकरण

जब तक अन्यथा नोट न किया जाए, ये `getEnvApiKey()` (`packages/ai/src/stream.ts`) के माध्यम से उपयोग किए जाते हैं।

### मुख्य प्रदाता क्रेडेंशियल

| चर                        | उपयोग | आवश्यक जब                                                 | नोट्स / प्राथमिकता                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API प्रमाणीकरण | Anthropic को OAuth टोकन प्रमाणीकरण के साथ उपयोग करते समय                         | प्रदाता प्रमाणीकरण रिज़ॉल्यूशन के लिए `ANTHROPIC_API_KEY` पर प्राथमिकता लेता है                              |
| `ANTHROPIC_API_KEY`             | Anthropic API प्रमाणीकरण | Anthropic को OAuth टोकन के बिना उपयोग करते समय                           | `ANTHROPIC_OAUTH_TOKEN` के बाद फ़ॉलबैक                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Azure Foundry / एंटरप्राइज़ गेटवे के माध्यम से Anthropic | `CLAUDE_CODE_USE_FOUNDRY` सक्षम होने पर                             | Foundry मोड सक्षम होने पर `ANTHROPIC_OAUTH_TOKEN` और `ANTHROPIC_API_KEY` पर प्राथमिकता लेता है  |
| `OPENAI_API_KEY`                | OpenAI प्रमाणीकरण | स्पष्ट apiKey तर्क के बिना OpenAI-फ़ैमिली प्रदाताओं का उपयोग करते समय | OpenAI Completions/Responses प्रदाताओं द्वारा उपयोग किया जाता है                                                      |
| `GEMINI_API_KEY`                | Google Gemini प्रमाणीकरण | `google` प्रदाता मॉडल का उपयोग करते समय                                | Gemini प्रदाता मैपिंग के लिए प्राथमिक कुंजी                                                             |
| `GOOGLE_API_KEY`                | Gemini इमेज टूल प्रमाणीकरण फ़ॉलबैक | `GEMINI_API_KEY` के बिना `gemini_image` टूल का उपयोग करते समय            | coding-agent इमेज टूल फ़ॉलबैक पथ द्वारा उपयोग किया जाता है                                                       |
| `GROQ_API_KEY`                  | Groq प्रमाणीकरण | Groq मॉडल का उपयोग करते समय                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras प्रमाणीकरण | Cerebras मॉडल का उपयोग करते समय                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together प्रमाणीकरण | `together` प्रदाता का उपयोग करते समय                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face प्रमाणीकरण | `huggingface` प्रदाता का उपयोग करते समय                                  | प्राथमिक Hugging Face टोकन env चर                                                                  |
| `HF_TOKEN`                      | Hugging Face प्रमाणीकरण | `huggingface` प्रदाता का उपयोग करते समय                                  | `HUGGINGFACE_HUB_TOKEN` अनसेट होने पर फ़ॉलबैक                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic प्रमाणीकरण | Synthetic मॉडल का उपयोग करते समय                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA प्रमाणीकरण | `nvidia` प्रदाता का उपयोग करते समय                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT प्रमाणीकरण | `nanogpt` प्रदाता का उपयोग करते समय                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice प्रमाणीकरण | `venice` प्रदाता का उपयोग करते समय                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM प्रमाणीकरण | `litellm` प्रदाता का उपयोग करते समय                                      | OpenAI-संगत LiteLLM प्रॉक्सी कुंजी। `LITELLM_BASE_URL` के साथ सेट होने पर, `models.yml` का ऑटो-कॉन्फ़िग सक्षम करता है |
| `LM_STUDIO_API_KEY`             | LM Studio प्रमाणीकरण (वैकल्पिक) | प्रमाणित होस्ट के साथ `lm-studio` प्रदाता का उपयोग करते समय           | स्थानीय LM Studio आमतौर पर प्रमाणीकरण के बिना चलता है; कुंजी आवश्यक होने पर कोई भी गैर-रिक्त टोकन काम करता है         |
| `OLLAMA_API_KEY`                | Ollama प्रमाणीकरण (वैकल्पिक) | प्रमाणित होस्ट के साथ `ollama` प्रदाता का उपयोग करते समय              | स्थानीय Ollama आमतौर पर प्रमाणीकरण के बिना चलता है; कुंजी आवश्यक होने पर कोई भी गैर-रिक्त टोकन काम करता है            |
| `LLAMA_CPP_API_KEY`             | Ollama प्रमाणीकरण (वैकल्पिक) | `--api-key` पैरामीटर के साथ `llama-server` का उपयोग करते समय              | स्थानीय llama.cpp आमतौर पर प्रमाणीकरण के बिना चलता है; कुंजी कॉन्फ़िगर होने पर कोई भी गैर-रिक्त टोकन काम करता है       |
| `XIAOMI_API_KEY`                | Xiaomi MiMo प्रमाणीकरण | `xiaomi` प्रदाता का उपयोग करते समय                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot प्रमाणीकरण | `moonshot` प्रदाता का उपयोग करते समय                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI प्रमाणीकरण | xAI मॉडल का उपयोग करते समय                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter प्रमाणीकरण | OpenRouter मॉडल का उपयोग करते समय                                       | इमेज टूल द्वारा भी उपयोग किया जाता है जब पसंदीदा/ऑटो प्रदाता OpenRouter हो                                  |
| `MISTRAL_API_KEY`               | Mistral प्रमाणीकरण | Mistral मॉडल का उपयोग करते समय                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai प्रमाणीकरण | z.ai मॉडल का उपयोग करते समय                                             | z.ai वेब सर्च प्रदाता द्वारा भी उपयोग किया जाता है                                                               |
| `MINIMAX_API_KEY`               | MiniMax प्रमाणीकरण | `minimax` प्रदाता का उपयोग करते समय                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code प्रमाणीकरण | `minimax-code` प्रदाता का उपयोग करते समय                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN प्रमाणीकरण | `minimax-code-cn` प्रदाता का उपयोग करते समय                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode प्रमाणीकरण | OpenCode मॉडल का उपयोग करते समय                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan प्रमाणीकरण | `qianfan` प्रदाता का उपयोग करते समय                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen Portal प्रमाणीकरण | OAuth टोकन के साथ `qwen-portal` का उपयोग करते समय                          | `QWEN_PORTAL_API_KEY` पर प्राथमिकता लेता है                                                         |
| `QWEN_PORTAL_API_KEY`           | Qwen Portal प्रमाणीकरण | API कुंजी के साथ `qwen-portal` का उपयोग करते समय                              | `QWEN_OAUTH_TOKEN` के बाद फ़ॉलबैक                                                                   |
| `ZENMUX_API_KEY`                | ZenMux प्रमाणीकरण | `zenmux` प्रदाता का उपयोग करते समय                                       | ZenMux OpenAI और Anthropic-संगत रूट्स के लिए उपयोग किया जाता है                                              |
| `VLLM_API_KEY`                  | vLLM प्रमाणीकरण/डिस्कवरी ऑप्ट-इन | `vllm` प्रदाता (स्थानीय OpenAI-संगत सर्वर) का उपयोग करते समय       | बिना-प्रमाणीकरण वाले स्थानीय सर्वरों के लिए कोई भी गैर-रिक्त मान काम करता है                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursor प्रदाता प्रमाणीकरण | Cursor प्रदाता का उपयोग करते समय                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway प्रमाणीकरण | `vercel-ai-gateway` प्रदाता का उपयोग करते समय                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway प्रमाणीकरण | `cloudflare-ai-gateway` प्रदाता का उपयोग करते समय                        | बेस URL `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` के रूप में कॉन्फ़िगर होना चाहिए |

### GitHub/Copilot टोकन श्रृंखलाएँ

| चर | उपयोग | श्रृंखला |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot प्रदाता प्रमाणीकरण | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot फ़ॉलबैक; वेब स्क्रैपर में GitHub API प्रमाणीकरण | वेब स्क्रैपर में: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot फ़ॉलबैक; वेब स्क्रैपर में GitHub API प्रमाणीकरण | वेब स्क्रैपर में: `GH_TOKEN` से पहले जाँचा जाता है |

---

## 2) प्रदाता-विशिष्ट रनटाइम कॉन्फ़िगरेशन

### Anthropic Foundry Gateway (Azure / एंटरप्राइज़ प्रॉक्सी)

जब `CLAUDE_CODE_USE_FOUNDRY` सक्षम होता है, Anthropic अनुरोध Foundry मोड पर स्विच हो जाते हैं:

- बेस URL `FOUNDRY_BASE_URL` से रिज़ॉल्व होता है (अनसेट होने पर फ़ॉलबैक मॉडल/डिफ़ॉल्ट बेस URL रहता है)।
- प्रदाता `anthropic` के लिए API कुंजी रिज़ॉल्यूशन बन जाता है:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`।
- `ANTHROPIC_CUSTOM_HEADERS` को कॉमा/न्यूलाइन-विभाजित `key: value` जोड़ियों के रूप में पार्स किया जाता है और अनुरोध हेडर में मर्ज किया जाता है।
- TLS क्लाइंट/सर्वर मटेरियल env मानों से इंजेक्ट किया जा सकता है:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`।
  प्रत्येक स्वीकार करता है:
  - PEM सामग्री का फ़ाइलसिस्टम पथ, या
  - इनलाइन PEM (एस्केप्ड `\n` अनुक्रमों सहित)।

| चर | मान प्रकार | व्यवहार |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | बूलियन-जैसी स्ट्रिंग (`1`, `true`, `yes`, `on`) | Anthropic प्रदाता के लिए Foundry मोड सक्षम करता है |
| `FOUNDRY_BASE_URL` | URL स्ट्रिंग | Foundry मोड में Anthropic एंडपॉइंट बेस URL |
| `ANTHROPIC_FOUNDRY_API_KEY` | टोकन स्ट्रिंग | `Authorization: Bearer <token>` के लिए उपयोग किया जाता है |
| `ANTHROPIC_CUSTOM_HEADERS` | हेडर सूची स्ट्रिंग | अतिरिक्त हेडर; प्रारूप `header-a: value, header-b: value` या न्यूलाइन-विभाजित |
| `NODE_EXTRA_CA_CERTS` | PEM पथ या इनलाइन PEM | सर्वर प्रमाणपत्र सत्यापन के लिए अतिरिक्त CA श्रृंखला |
| `CLAUDE_CODE_CLIENT_CERT` | PEM पथ या इनलाइन PEM | mTLS क्लाइंट प्रमाणपत्र |
| `CLAUDE_CODE_CLIENT_KEY` | PEM पथ या इनलाइन PEM | mTLS क्लाइंट प्राइवेट कुंजी (cert के साथ जोड़ा जाना चाहिए) |

### Amazon Bedrock

| चर | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `AWS_REGION` | प्राथमिक क्षेत्र स्रोत |
| `AWS_DEFAULT_REGION` | `AWS_REGION` अनसेट होने पर फ़ॉलबैक |
| `AWS_PROFILE` | नामित प्रोफ़ाइल प्रमाणीकरण पथ सक्षम करता है |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | IAM कुंजी प्रमाणीकरण पथ सक्षम करता है |
| `AWS_BEARER_TOKEN_BEDROCK` | बियरर टोकन प्रमाणीकरण पथ सक्षम करता है |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECS टास्क क्रेडेंशियल पथ सक्षम करता है |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | वेब आइडेंटिटी प्रमाणीकरण पथ सक्षम करता है |
| `AWS_BEDROCK_SKIP_AUTH` | यदि `1`, डमी क्रेडेंशियल इंजेक्ट करता है (प्रॉक्सी/गैर-प्रमाणीकरण परिदृश्य) |
| `AWS_BEDROCK_FORCE_HTTP1` | यदि `1`, Node HTTP/1 रिक्वेस्ट हैंडलर को बाध्य करता है |

प्रदाता कोड में क्षेत्र फ़ॉलबैक: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`।

### Azure OpenAI Responses

| चर | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `AZURE_OPENAI_API_KEY` | आवश्यक जब तक विकल्प के रूप में API कुंजी पास न की जाए |
| `AZURE_OPENAI_API_VERSION` | डिफ़ॉल्ट `v1` |
| `AZURE_OPENAI_BASE_URL` | सीधा बेस URL ओवरराइड |
| `AZURE_OPENAI_RESOURCE_NAME` | बेस URL बनाने के लिए उपयोग किया जाता है: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | वैकल्पिक मैपिंग स्ट्रिंग: `modelId=deploymentName,model2=deployment2` |

बेस URL रिज़ॉल्यूशन: विकल्प `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → विकल्प/env संसाधन नाम → `model.baseUrl`।

### Google Vertex AI

| चर | आवश्यक? | नोट्स |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | हाँ (जब तक विकल्पों में पास न किया जाए) | फ़ॉलबैक: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | फ़ॉलबैक | वैकल्पिक प्रोजेक्ट ID स्रोत के रूप में उपयोग किया जाता है |
| `GOOGLE_CLOUD_LOCATION` | हाँ (जब तक विकल्पों में पास न किया जाए) | प्रदाता में कोई डिफ़ॉल्ट नहीं |
| `GOOGLE_APPLICATION_CREDENTIALS` | सशर्त | यदि सेट है, तो फ़ाइल मौजूद होनी चाहिए; अन्यथा ADC फ़ॉलबैक पथ जाँचा जाता है (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| चर | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | प्राथमिक OAuth होस्ट ओवरराइड |
| `KIMI_OAUTH_HOST` | फ़ॉलबैक OAuth होस्ट ओवरराइड |
| `KIMI_CODE_BASE_URL` | Kimi उपयोग एंडपॉइंट बेस URL को ओवरराइड करता है (`usage/kimi.ts`) |

OAuth होस्ट श्रृंखला: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`।

### Antigravity/Gemini इमेज संगतता

| चर | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Gemini CLI प्रदाता में Antigravity user-agent संस्करण टैग को ओवरराइड करता है |

### OpenAI Codex responses (सुविधा/डीबग नियंत्रण)

| चर | व्यवहार |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` Codex प्रदाता डीबग लॉगिंग सक्षम करता है |
| `PI_CODEX_WEBSOCKET` | `1`/`true` वेबसॉकेट ट्रांसपोर्ट प्राथमिकता सक्षम करता है |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` वेबसॉकेट v2 पथ सक्षम करता है |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | धनात्मक पूर्णांक ओवरराइड (डिफ़ॉल्ट 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | गैर-ऋणात्मक पूर्णांक ओवरराइड (डिफ़ॉल्ट 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | धनात्मक पूर्णांक बेस बैकऑफ़ ओवरराइड (डिफ़ॉल्ट 500) |

### Cursor प्रदाता डीबग

| चर | व्यवहार |
|---|---|
| `DEBUG_CURSOR` | प्रदाता डीबग लॉग सक्षम करता है; विस्तृत पेलोड स्निपेट के लिए `2`/`verbose` |
| `DEBUG_CURSOR_LOG` | JSONL डीबग लॉग आउटपुट के लिए वैकल्पिक फ़ाइल पथ |

### प्रॉम्प्ट कैश संगतता स्विच

| चर | व्यवहार |
|---|---|
| `PI_CACHE_RETENTION` | यदि `long`, समर्थित होने पर लंबे रिटेंशन को सक्षम करता है (`anthropic`, `openai-responses`, Bedrock रिटेंशन रिज़ॉल्यूशन) |

---

## 3) वेब सर्च उपप्रणाली

### सर्च प्रदाता क्रेडेंशियल

| चर | द्वारा उपयोग |
|---|---|
| `EXA_API_KEY` | Exa सर्च प्रदाता और Exa MCP टूल्स |
| `BRAVE_API_KEY` | Brave सर्च प्रदाता |
| `PERPLEXITY_API_KEY` | Perplexity सर्च प्रदाता API-कुंजी मोड |
| `TAVILY_API_KEY` | Tavily सर्च प्रदाता |
| `ZAI_API_KEY` | z.ai सर्च प्रदाता (`agent.db` में संग्रहीत OAuth भी जाँचता है) |
| `OPENAI_API_KEY` / DB में Codex OAuth | Codex सर्च प्रदाता उपलब्धता/प्रमाणीकरण |

### Anthropic वेब सर्च प्रमाणीकरण श्रृंखला

`packages/coding-agent/src/web/search/auth.ts` Anthropic वेब-सर्च क्रेडेंशियल को इस क्रम में रिज़ॉल्व करता है:

1. `ANTHROPIC_SEARCH_API_KEY` (+ वैकल्पिक `ANTHROPIC_SEARCH_BASE_URL`)
2. `api: "anthropic-messages"` वाली `models.json` प्रदाता प्रविष्टि
3. `agent.db` से Anthropic OAuth क्रेडेंशियल (5-मिनट बफ़र के भीतर समाप्त नहीं होने चाहिए)
4. सामान्य Anthropic env फ़ॉलबैक: प्रदाता कुंजी (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + वैकल्पिक `ANTHROPIC_BASE_URL` (Foundry मोड सक्षम होने पर `FOUNDRY_BASE_URL`)

संबंधित चर:

| चर | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | सर्वोच्च-प्राथमिकता स्पष्ट सर्च कुंजी |
| `ANTHROPIC_SEARCH_BASE_URL` | छोड़े जाने पर `https://api.anthropic.com` पर डिफ़ॉल्ट |
| `ANTHROPIC_SEARCH_MODEL` | `claude-haiku-4-5` पर डिफ़ॉल्ट |
| `ANTHROPIC_BASE_URL` | टियर-4 प्रमाणीकरण पथ के लिए सामान्य फ़ॉलबैक बेस URL |

### Perplexity OAuth प्रवाह व्यवहार फ़्लैग

| चर | व्यवहार |
|---|---|
| `PI_AUTH_NO_BORROW` | यदि सेट है, Perplexity लॉगिन प्रवाह में macOS नेटिव-ऐप टोकन उधार पथ को अक्षम करता है |

---

## 4) Python टूलिंग और कर्नेल रनटाइम

| चर | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `PI_PY` | Python टूल मोड ओवरराइड: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; अमान्य मान अनदेखे किए जाते हैं |
| `PI_PYTHON_SKIP_CHECK` | यदि `1`, Python कर्नेल उपलब्धता जाँच/वार्म जाँच छोड़ता है |
| `PI_PYTHON_GATEWAY_URL` | यदि सेट है, स्थानीय साझा गेटवे के बजाय बाहरी कर्नेल गेटवे का उपयोग करता है |
| `PI_PYTHON_GATEWAY_TOKEN` | बाहरी गेटवे के लिए वैकल्पिक प्रमाणीकरण टोकन (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | यदि `1`, कर्नेल मॉड्यूल में निम्न-स्तरीय IPC ट्रेस पथ सक्षम करता है |
| `VIRTUAL_ENV` | Python रनटाइम रिज़ॉल्यूशन के लिए सर्वोच्च-प्राथमिकता venv पथ |

अतिरिक्त सशर्त व्यवहार:

- यदि `BUN_ENV=test` या `NODE_ENV=test`, Python उपलब्धता जाँच को OK माना जाता है और वार्मिंग छोड़ दी जाती है।
- Python env फ़िल्टरिंग सामान्य API कुंजियों को अस्वीकार करता है और सुरक्षित बेस चर + `LC_`, `XDG_`, `PI_` उपसर्गों को अनुमति देता है।

---

## 5) एजेंट/रनटाइम व्यवहार टॉगल

| चर                   | डिफ़ॉल्ट / व्यवहार                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | `smol` के लिए अल्पकालिक मॉडल-भूमिका ओवरराइड (CLI `--smol` प्राथमिकता लेता है)                     |
| `PI_SLOW_MODEL`            | `slow` के लिए अल्पकालिक मॉडल-भूमिका ओवरराइड (CLI `--slow` प्राथमिकता लेता है)                     |
| `PI_PLAN_MODEL`            | `plan` के लिए अल्पकालिक मॉडल-भूमिका ओवरराइड (CLI `--plan` प्राथमिकता लेता है)                     |
| `PI_NO_TITLE`              | यदि सेट (कोई भी गैर-रिक्त मान), पहले उपयोगकर्ता संदेश पर ऑटो सत्र शीर्षक जनन अक्षम करता है   |
| `NULL_PROMPT`              | यदि `true`, सिस्टम प्रॉम्प्ट बिल्डर खाली स्ट्रिंग लौटाता है                                        |
| `PI_BLOCKED_AGENT`         | टास्क टूल में एक विशिष्ट सबएजेंट प्रकार को अवरुद्ध करता है                                                 |
| `PI_SUBPROCESS_CMD`        | सबएजेंट स्पॉन कमांड को ओवरराइड करता है (`xcsh` / `xcsh.cmd` रिज़ॉल्यूशन बायपास)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | प्रति सबएजेंट अधिकतम कैप्चर किए गए आउटपुट बाइट (डिफ़ॉल्ट `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | प्रति सबएजेंट अधिकतम कैप्चर की गई आउटपुट पंक्तियाँ (डिफ़ॉल्ट `5000`)                                      |
| `PI_TIMING`                | यदि `1`, स्टार्टअप/टूल टाइमिंग इंस्ट्रूमेंटेशन लॉग सक्षम करता है                                     |
| `PI_DEBUG_STARTUP`         | कई स्टार्टअप पथों में stderr पर स्टार्टअप स्टेज डीबग प्रिंट सक्षम करता है                       |
| `PI_PACKAGE_DIR`           | पैकेज एसेट बेस डायरेक्टरी रिज़ॉल्यूशन को ओवरराइड करता है (docs/examples/changelog पथ लुकअप)            |
| `PI_DISABLE_LSPMUX`        | यदि `1`, lspmux डिटेक्शन/इंटीग्रेशन अक्षम करता है और सीधे LSP सर्वर स्पॉनिंग को बाध्य करता है          |
| `LITELLM_BASE_URL`         | LiteLLM प्रॉक्सी बेस URL। `LITELLM_API_KEY` के साथ सेट होने पर, पहले रन पर `models.yml` का ऑटो-जनन और हर स्टार्टअप पर स्व-उपचार ट्रिगर करता है |
| `LM_STUDIO_BASE_URL`       | डिफ़ॉल्ट निहित LM Studio डिस्कवरी बेस URL ओवरराइड (अनसेट होने पर `http://127.0.0.1:1234/v1`) |
| `OLLAMA_BASE_URL`          | डिफ़ॉल्ट निहित Ollama डिस्कवरी बेस URL ओवरराइड (अनसेट होने पर `http://127.0.0.1:11434`)      |
| `LLAMA_CPP_BASE_URL`       | डिफ़ॉल्ट निहित Llama.cpp डिस्कवरी बेस URL ओवरराइड (अनसेट होने पर `http://127.0.0.1:8080`)    |
| `PI_EDIT_VARIANT`          | यदि `hashline`, एडिट टूल उपलब्ध होने पर hashline read/grep डिस्प्ले मोड बाध्य करता है               |
| `PI_NO_PTY`                | यदि `1`, bash टूल के लिए इंटरैक्टिव PTY पथ अक्षम करता है                                          |

`PI_NO_PTY` CLI `--no-pty` उपयोग होने पर आंतरिक रूप से भी सेट किया जाता है।

---

## 6) स्टोरेज और कॉन्फ़िग रूट पथ

ये `@f5xc-salesdemos/pi-utils/dirs` के माध्यम से उपयोग किए जाते हैं और प्रभावित करते हैं कि coding-agent डेटा कहाँ संग्रहीत करता है।

| चर | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `PI_CONFIG_DIR` | होम के अंतर्गत कॉन्फ़िग रूट dirname (डिफ़ॉल्ट `.xcsh`) |
| `PI_CODING_AGENT_DIR` | एजेंट डायरेक्टरी के लिए पूर्ण ओवरराइड (डिफ़ॉल्ट `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | पथ हेल्पर्स में कैनोनिकल वर्तमान कार्य डायरेक्टरी मिलान करते समय उपयोग किया जाता है |

---

## 7) शेल/टूल निष्पादन वातावरण

(`packages/utils/src/procmgr.ts` और coding-agent bash टूल इंटीग्रेशन से।)

| चर | व्यवहार |
|---|---|
| `PI_BASH_NO_CI` | स्पॉन किए गए शेल env में स्वचालित `CI=true` इंजेक्शन को दबाता है |
| `CLAUDE_BASH_NO_CI` | `PI_BASH_NO_CI` के लिए लीगेसी उपनाम फ़ॉलबैक |
| `PI_BASH_NO_LOGIN` | लॉगिन शेल मोड अक्षम करने के लिए अभिप्रेत |
| `CLAUDE_BASH_NO_LOGIN` | `PI_BASH_NO_LOGIN` के लिए लीगेसी उपनाम फ़ॉलबैक |
| `PI_SHELL_PREFIX` | वैकल्पिक कमांड प्रीफ़िक्स रैपर |
| `CLAUDE_CODE_SHELL_PREFIX` | `PI_SHELL_PREFIX` के लिए लीगेसी उपनाम फ़ॉलबैक |
| `VISUAL` | पसंदीदा बाहरी एडिटर कमांड |
| `EDITOR` | फ़ॉलबैक बाहरी एडिटर कमांड |

वर्तमान कार्यान्वयन नोट: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` पढ़े जाते हैं, लेकिन वर्तमान `getShellArgs()` दोनों शाखाओं में `['-l','-c']` लौटाता है (आज प्रभावी रूप से नो-ऑप)।

---

## 8) UI/थीम/सत्र पहचान (ऑटो-डिटेक्टेड env)

ये रनटाइम सिग्नल के रूप में पढ़े जाते हैं; ये आमतौर पर मैन्युअल कॉन्फ़िगरेशन के बजाय टर्मिनल/OS द्वारा सेट किए जाते हैं।

| चर | उपयोग |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | रंग क्षमता पहचान (थीम रंग मोड) |
| `COLORFGBG` | टर्मिनल पृष्ठभूमि लाइट/डार्क ऑटो-डिटेक्शन |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | सिस्टम प्रॉम्प्ट/संदर्भ में टर्मिनल पहचान |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | सिस्टम प्रॉम्प्ट/संदर्भ में डेस्कटॉप/विंडो-मैनेजर पहचान |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | स्थिर प्रति-टर्मिनल सत्र ब्रेडक्रंब ID |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | सिस्टम जानकारी डायग्नोस्टिक्स |
| `APPDATA`, `XDG_CONFIG_HOME` | lspmux कॉन्फ़िग पथ रिज़ॉल्यूशन |
| `HOME` | MCP कमांड UI में पथ संक्षिप्तकरण |

---

## 9) नेटिव लोडर/डीबग फ़्लैग

| चर | व्यवहार |
|---|---|
| `PI_DEV` | `packages/natives` में वर्बोस नेटिव एडऑन लोड डायग्नोस्टिक्स सक्षम करता है |

## 10) TUI रनटाइम फ़्लैग (साझा पैकेज, coding-agent UX को प्रभावित करता है)

| चर | व्यवहार |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` डेस्कटॉप सूचनाओं को दबाता है |
| `PI_TUI_WRITE_LOG` | यदि सेट, TUI लेखन को फ़ाइल में लॉग करता है |
| `PI_HARDWARE_CURSOR` | यदि `1`, हार्डवेयर कर्सर मोड सक्षम करता है |
| `PI_CLEAR_ON_SHRINK` | यदि `1`, सामग्री सिकुड़ने पर खाली पंक्तियों को साफ़ करता है |
| `PI_DEBUG_REDRAW` | यदि `1`, रीड्रॉ डीबग लॉगिंग सक्षम करता है |
| `PI_TUI_DEBUG` | यदि `1`, गहन TUI डीबग डंप पथ सक्षम करता है |

---

## 11) कमिट जनन नियंत्रण

| चर | व्यवहार |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | यदि `true` (केस-असंवेदनशील), कमिट फ़ॉलबैक जनन पथ बाध्य करता है |
| `PI_COMMIT_NO_FALLBACK` | यदि `true`, एजेंट द्वारा कोई प्रस्ताव न लौटाने पर फ़ॉलबैक अक्षम करता है |
| `PI_COMMIT_MAP_REDUCE` | यदि `false`, map-reduce कमिट विश्लेषण पथ अक्षम करता है |
| `DEBUG` | यदि सेट, कमिट एजेंट त्रुटि स्टैक ट्रेस प्रिंट किए जाते हैं |

---

## सुरक्षा-संवेदनशील चर

इन्हें गोपनीय मानें; इन्हें लॉग या कमिट न करें:

- प्रदाता/API कुंजियाँ और OAuth/बियरर क्रेडेंशियल (सभी `*_API_KEY`, `*_TOKEN`, OAuth एक्सेस/रिफ़्रेश टोकन)
- क्लाउड क्रेडेंशियल (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS` पथ सर्विस-अकाउंट मटेरियल उजागर कर सकता है)
- सर्च/प्रदाता प्रमाणीकरण चर (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, Anthropic सर्च कुंजियाँ)
- Foundry mTLS मटेरियल (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` जब यह प्राइवेट CA बंडल्स की ओर इंगित करता है)

Python रनटाइम कर्नेल सबप्रोसेस स्पॉन करने से पहले कई सामान्य कुंजी चरों को स्पष्ट रूप से हटा देता है (`packages/coding-agent/src/ipy/runtime.ts`)।
