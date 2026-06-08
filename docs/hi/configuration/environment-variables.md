---
title: एनवायरनमेंट वेरिएबल्स
description: >-
  xcsh कॉन्फ़िगरेशन और व्यवहार नियंत्रण के लिए रनटाइम एनवायरनमेंट वेरिएबल
  संदर्भ।
sidebar:
  order: 2
  label: एनवायरनमेंट वेरिएबल्स
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# एनवायरनमेंट वेरिएबल्स (वर्तमान रनटाइम संदर्भ)

यह संदर्भ वर्तमान कोड पथों से प्राप्त किया गया है:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (coding-agent द्वारा उपयोग किया जाने वाला प्रोवाइडर/ऑथ रिज़ॉल्यूशन)
- `packages/utils/src/**` और `packages/tui/src/**` जहाँ वे वेरिएबल्स सीधे coding-agent रनटाइम को प्रभावित करते हैं

यह केवल सक्रिय व्यवहार को दस्तावेज़ित करता है।

## रिज़ॉल्यूशन मॉडल और प्राथमिकता

अधिकांश रनटाइम लुकअप `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`) से `$env` का उपयोग करते हैं।

`$env` लोडिंग क्रम:

1. मौजूदा प्रोसेस एनवायरनमेंट (`Bun.env`)
2. प्रोजेक्ट `.env` (`$PWD/.env`) उन कीज़ के लिए जो पहले से सेट नहीं हैं
3. होम `.env` (`~/.env`) उन कीज़ के लिए जो पहले से सेट नहीं हैं

`.env` फाइलों में अतिरिक्त नियम: `XCSH_*` कीज़ को पार्स के दौरान `PI_*` कीज़ में मिरर किया जाता है।

---

## 1) मॉडल/प्रोवाइडर प्रमाणीकरण

ये `getEnvApiKey()` (`packages/ai/src/stream.ts`) के माध्यम से उपभोग किए जाते हैं जब तक अन्यथा नोट न किया गया हो।

### मुख्य प्रोवाइडर क्रेडेंशियल्स

| वेरिएबल                        | उपयोग | आवश्यक जब                                                 | नोट्स / प्राथमिकता                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API प्रमाणीकरण | OAuth टोकन प्रमाणीकरण के साथ Anthropic का उपयोग                         | प्रोवाइडर ऑथ रिज़ॉल्यूशन के लिए `ANTHROPIC_API_KEY` पर प्राथमिकता लेता है                              |
| `ANTHROPIC_API_KEY`             | Anthropic API प्रमाणीकरण | OAuth टोकन के बिना Anthropic का उपयोग                           | `ANTHROPIC_OAUTH_TOKEN` के बाद फ़ॉलबैक                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Azure Foundry / एंटरप्राइज़ गेटवे के माध्यम से Anthropic | `CLAUDE_CODE_USE_FOUNDRY` सक्षम                             | Foundry मोड सक्षम होने पर `ANTHROPIC_OAUTH_TOKEN` और `ANTHROPIC_API_KEY` पर प्राथमिकता लेता है  |
| `OPENAI_API_KEY`                | OpenAI प्रमाणीकरण | स्पष्ट apiKey आर्गुमेंट के बिना OpenAI-फैमिली प्रोवाइडर्स का उपयोग | OpenAI Completions/Responses प्रोवाइडर्स द्वारा उपयोग किया जाता है                                                      |
| `GEMINI_API_KEY`                | Google Gemini प्रमाणीकरण | `google` प्रोवाइडर मॉडल्स का उपयोग                                | Gemini प्रोवाइडर मैपिंग के लिए प्राथमिक कुंजी                                                             |
| `GOOGLE_API_KEY`                | Gemini इमेज टूल प्रमाणीकरण फ़ॉलबैक | `GEMINI_API_KEY` के बिना `gemini_image` टूल का उपयोग            | coding-agent इमेज टूल फ़ॉलबैक पथ द्वारा उपयोग किया जाता है                                                       |
| `GROQ_API_KEY`                  | Groq प्रमाणीकरण | Groq मॉडल्स का उपयोग                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras प्रमाणीकरण | Cerebras मॉडल्स का उपयोग                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together प्रमाणीकरण | `together` प्रोवाइडर का उपयोग                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face प्रमाणीकरण | `huggingface` प्रोवाइडर का उपयोग                                  | प्राथमिक Hugging Face टोकन env वेरिएबल                                                                  |
| `HF_TOKEN`                      | Hugging Face प्रमाणीकरण | `huggingface` प्रोवाइडर का उपयोग                                  | `HUGGINGFACE_HUB_TOKEN` अनसेट होने पर फ़ॉलबैक                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic प्रमाणीकरण | Synthetic मॉडल्स का उपयोग                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA प्रमाणीकरण | `nvidia` प्रोवाइडर का उपयोग                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT प्रमाणीकरण | `nanogpt` प्रोवाइडर का उपयोग                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice प्रमाणीकरण | `venice` प्रोवाइडर का उपयोग                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM प्रमाणीकरण | `litellm` प्रोवाइडर का उपयोग                                      | OpenAI-संगत LiteLLM प्रॉक्सी कुंजी। `LITELLM_BASE_URL` के साथ सेट होने पर, `models.yml` का ऑटो-कॉन्फ़िग सक्षम करता है |
| `LM_STUDIO_API_KEY`             | LM Studio प्रमाणीकरण (वैकल्पिक) | प्रमाणित होस्ट्स के साथ `lm-studio` प्रोवाइडर का उपयोग           | स्थानीय LM Studio आमतौर पर प्रमाणीकरण के बिना चलता है; जब कुंजी आवश्यक हो तो कोई भी गैर-रिक्त टोकन काम करता है         |
| `OLLAMA_API_KEY`                | Ollama प्रमाणीकरण (वैकल्पिक) | प्रमाणित होस्ट्स के साथ `ollama` प्रोवाइडर का उपयोग              | स्थानीय Ollama आमतौर पर प्रमाणीकरण के बिना चलता है; जब कुंजी आवश्यक हो तो कोई भी गैर-रिक्त टोकन काम करता है            |
| `LLAMA_CPP_API_KEY`             | Ollama प्रमाणीकरण (वैकल्पिक) | `--api-key` पैरामीटर के साथ `llama-server` का उपयोग              | स्थानीय llama.cpp आमतौर पर प्रमाणीकरण के बिना चलता है; जब कुंजी कॉन्फ़िगर हो तो कोई भी गैर-रिक्त टोकन काम करता है       |
| `XIAOMI_API_KEY`                | Xiaomi MiMo प्रमाणीकरण | `xiaomi` प्रोवाइडर का उपयोग                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot प्रमाणीकरण | `moonshot` प्रोवाइडर का उपयोग                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI प्रमाणीकरण | xAI मॉडल्स का उपयोग                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter प्रमाणीकरण | OpenRouter मॉडल्स का उपयोग                                       | जब पसंदीदा/ऑटो प्रोवाइडर OpenRouter हो तो इमेज टूल द्वारा भी उपयोग किया जाता है                                  |
| `MISTRAL_API_KEY`               | Mistral प्रमाणीकरण | Mistral मॉडल्स का उपयोग                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai प्रमाणीकरण | z.ai मॉडल्स का उपयोग                                             | z.ai वेब सर्च प्रोवाइडर द्वारा भी उपयोग किया जाता है                                                               |
| `MINIMAX_API_KEY`               | MiniMax प्रमाणीकरण | `minimax` प्रोवाइडर का उपयोग                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code प्रमाणीकरण | `minimax-code` प्रोवाइडर का उपयोग                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN प्रमाणीकरण | `minimax-code-cn` प्रोवाइडर का उपयोग                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode प्रमाणीकरण | OpenCode मॉडल्स का उपयोग                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan प्रमाणीकरण | `qianfan` प्रोवाइडर का उपयोग                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen Portal प्रमाणीकरण | OAuth टोकन के साथ `qwen-portal` का उपयोग                          | `QWEN_PORTAL_API_KEY` पर प्राथमिकता लेता है                                                         |
| `QWEN_PORTAL_API_KEY`           | Qwen Portal प्रमाणीकरण | API कुंजी के साथ `qwen-portal` का उपयोग                              | `QWEN_OAUTH_TOKEN` के बाद फ़ॉलबैक                                                                   |
| `ZENMUX_API_KEY`                | ZenMux प्रमाणीकरण | `zenmux` प्रोवाइडर का उपयोग                                       | ZenMux OpenAI और Anthropic-संगत रूट्स के लिए उपयोग किया जाता है                                              |
| `VLLM_API_KEY`                  | vLLM प्रमाणीकरण/डिस्कवरी ऑप्ट-इन | `vllm` प्रोवाइडर (स्थानीय OpenAI-संगत सर्वर) का उपयोग       | बिना-प्रमाणीकरण स्थानीय सर्वर के लिए कोई भी गैर-रिक्त मान काम करता है                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursor प्रोवाइडर प्रमाणीकरण | Cursor प्रोवाइडर का उपयोग                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway प्रमाणीकरण | `vercel-ai-gateway` प्रोवाइडर का उपयोग                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway प्रमाणीकरण | `cloudflare-ai-gateway` प्रोवाइडर का उपयोग                        | बेस URL `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` के रूप में कॉन्फ़िगर होना चाहिए |

### GitHub/Copilot टोकन चेन

| वेरिएबल | उपयोग | चेन |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot प्रोवाइडर प्रमाणीकरण | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot फ़ॉलबैक; वेब स्क्रैपर में GitHub API प्रमाणीकरण | वेब स्क्रैपर में: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot फ़ॉलबैक; वेब स्क्रैपर में GitHub API प्रमाणीकरण | वेब स्क्रैपर में: `GH_TOKEN` से पहले जाँचा जाता है |

---

## 2) प्रोवाइडर-विशिष्ट रनटाइम कॉन्फ़िगरेशन

### Anthropic Foundry Gateway (Azure / एंटरप्राइज़ प्रॉक्सी)

जब `CLAUDE_CODE_USE_FOUNDRY` सक्षम होता है, Anthropic अनुरोध Foundry मोड में स्विच हो जाते हैं:

- बेस URL `FOUNDRY_BASE_URL` से रिज़ॉल्व होता है (अनसेट होने पर फ़ॉलबैक मॉडल/डिफ़ॉल्ट बेस URL रहता है)।
- प्रोवाइडर `anthropic` के लिए API कुंजी रिज़ॉल्यूशन बन जाता है:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`।
- `ANTHROPIC_CUSTOM_HEADERS` को कॉमा/न्यूलाइन-सेपरेटेड `key: value` जोड़ियों के रूप में पार्स किया जाता है और अनुरोध हेडर्स में मर्ज किया जाता है।
- TLS क्लाइंट/सर्वर मटेरियल env मानों से इंजेक्ट किया जा सकता है:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`।
  प्रत्येक स्वीकार करता है:
  - PEM सामग्री के लिए एक फाइलसिस्टम पथ, या
  - इनलाइन PEM (एस्केप्ड `\n` सीक्वेंस सहित)।

| वेरिएबल | मान प्रकार | व्यवहार |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | बूलियन-जैसी स्ट्रिंग (`1`, `true`, `yes`, `on`) | Anthropic प्रोवाइडर के लिए Foundry मोड सक्षम करता है |
| `FOUNDRY_BASE_URL` | URL स्ट्रिंग | Foundry मोड में Anthropic एंडपॉइंट बेस URL |
| `ANTHROPIC_FOUNDRY_API_KEY` | टोकन स्ट्रिंग | `Authorization: Bearer <token>` के लिए उपयोग किया जाता है |
| `ANTHROPIC_CUSTOM_HEADERS` | हेडर लिस्ट स्ट्रिंग | अतिरिक्त हेडर्स; फ़ॉर्मेट `header-a: value, header-b: value` या न्यूलाइन-सेपरेटेड |
| `NODE_EXTRA_CA_CERTS` | PEM पथ या इनलाइन PEM | सर्वर सर्टिफिकेट सत्यापन के लिए अतिरिक्त CA चेन |
| `CLAUDE_CODE_CLIENT_CERT` | PEM पथ या इनलाइन PEM | mTLS क्लाइंट सर्टिफिकेट |
| `CLAUDE_CODE_CLIENT_KEY` | PEM पथ या इनलाइन PEM | mTLS क्लाइंट प्राइवेट कुंजी (सर्टिफिकेट के साथ जोड़ा जाना चाहिए) |

### Amazon Bedrock

| वेरिएबल | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `AWS_REGION` | प्राथमिक रीजन स्रोत |
| `AWS_DEFAULT_REGION` | `AWS_REGION` अनसेट होने पर फ़ॉलबैक |
| `AWS_PROFILE` | नामित प्रोफाइल प्रमाणीकरण पथ सक्षम करता है |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | IAM कुंजी प्रमाणीकरण पथ सक्षम करता है |
| `AWS_BEARER_TOKEN_BEDROCK` | बेयरर टोकन प्रमाणीकरण पथ सक्षम करता है |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECS टास्क क्रेडेंशियल पथ सक्षम करता है |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | वेब आइडेंटिटी प्रमाणीकरण पथ सक्षम करता है |
| `AWS_BEDROCK_SKIP_AUTH` | यदि `1`, डमी क्रेडेंशियल्स इंजेक्ट करता है (प्रॉक्सी/बिना-प्रमाणीकरण परिदृश्य) |
| `AWS_BEDROCK_FORCE_HTTP1` | यदि `1`, Node HTTP/1 रिक्वेस्ट हैंडलर को बाध्य करता है |

प्रोवाइडर कोड में रीजन फ़ॉलबैक: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`।

### Azure OpenAI Responses

| वेरिएबल | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `AZURE_OPENAI_API_KEY` | आवश्यक जब तक API कुंजी विकल्प के रूप में पास न की गई हो |
| `AZURE_OPENAI_API_VERSION` | डिफ़ॉल्ट `v1` |
| `AZURE_OPENAI_BASE_URL` | डायरेक्ट बेस URL ओवरराइड |
| `AZURE_OPENAI_RESOURCE_NAME` | बेस URL बनाने के लिए उपयोग: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | वैकल्पिक मैपिंग स्ट्रिंग: `modelId=deploymentName,model2=deployment2` |

बेस URL रिज़ॉल्यूशन: विकल्प `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → विकल्प/env रिसोर्स नाम → `model.baseUrl`।

### Google Vertex AI

| वेरिएबल | आवश्यक? | नोट्स |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | हाँ (जब तक विकल्पों में पास न किया गया हो) | फ़ॉलबैक: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | फ़ॉलबैक | वैकल्पिक प्रोजेक्ट ID स्रोत के रूप में उपयोग |
| `GOOGLE_CLOUD_LOCATION` | हाँ (जब तक विकल्पों में पास न किया गया हो) | प्रोवाइडर में कोई डिफ़ॉल्ट नहीं |
| `GOOGLE_APPLICATION_CREDENTIALS` | सशर्त | यदि सेट है, तो फाइल मौजूद होनी चाहिए; अन्यथा ADC फ़ॉलबैक पथ जाँचा जाता है (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| वेरिएबल | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | प्राथमिक OAuth होस्ट ओवरराइड |
| `KIMI_OAUTH_HOST` | फ़ॉलबैक OAuth होस्ट ओवरराइड |
| `KIMI_CODE_BASE_URL` | Kimi उपयोग एंडपॉइंट बेस URL को ओवरराइड करता है (`usage/kimi.ts`) |

OAuth होस्ट चेन: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`।

### Antigravity/Gemini इमेज संगतता

| वेरिएबल | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Gemini CLI प्रोवाइडर में Antigravity user-agent वर्शन टैग को ओवरराइड करता है |

### OpenAI Codex responses (फ़ीचर/डीबग नियंत्रण)

| वेरिएबल | व्यवहार |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` Codex प्रोवाइडर डीबग लॉगिंग सक्षम करता है |
| `PI_CODEX_WEBSOCKET` | `1`/`true` वेबसॉकेट ट्रांसपोर्ट प्राथमिकता सक्षम करता है |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` वेबसॉकेट v2 पथ सक्षम करता है |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | धनात्मक पूर्णांक ओवरराइड (डिफ़ॉल्ट 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | गैर-ऋणात्मक पूर्णांक ओवरराइड (डिफ़ॉल्ट 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | धनात्मक पूर्णांक बेस बैकऑफ़ ओवरराइड (डिफ़ॉल्ट 500) |

### Cursor प्रोवाइडर डीबग

| वेरिएबल | व्यवहार |
|---|---|
| `DEBUG_CURSOR` | प्रोवाइडर डीबग लॉग्स सक्षम करता है; विस्तृत पेलोड स्निपेट्स के लिए `2`/`verbose` |
| `DEBUG_CURSOR_LOG` | JSONL डीबग लॉग आउटपुट के लिए वैकल्पिक फाइल पथ |

### प्रॉम्प्ट कैश संगतता स्विच

| वेरिएबल | व्यवहार |
|---|---|
| `PI_CACHE_RETENTION` | यदि `long`, तो समर्थित स्थानों पर लंबी अवधारण सक्षम करता है (`anthropic`, `openai-responses`, Bedrock अवधारण रिज़ॉल्यूशन) |

---

## 3) वेब सर्च सबसिस्टम

### सर्च प्रोवाइडर क्रेडेंशियल्स

| वेरिएबल | द्वारा उपयोग |
|---|---|
| `EXA_API_KEY` | Exa सर्च प्रोवाइडर और Exa MCP टूल्स |
| `BRAVE_API_KEY` | Brave सर्च प्रोवाइडर |
| `PERPLEXITY_API_KEY` | Perplexity सर्च प्रोवाइडर API-कुंजी मोड |
| `TAVILY_API_KEY` | Tavily सर्च प्रोवाइडर |
| `ZAI_API_KEY` | z.ai सर्च प्रोवाइडर (`agent.db` में संग्रहीत OAuth भी जाँचता है) |
| `OPENAI_API_KEY` / DB में Codex OAuth | Codex सर्च प्रोवाइडर उपलब्धता/प्रमाणीकरण |

### Anthropic वेब सर्च प्रमाणीकरण चेन

`packages/coding-agent/src/web/search/auth.ts` Anthropic वेब-सर्च क्रेडेंशियल्स को इस क्रम में रिज़ॉल्व करता है:

1. `ANTHROPIC_SEARCH_API_KEY` (+ वैकल्पिक `ANTHROPIC_SEARCH_BASE_URL`)
2. `models.json` प्रोवाइडर एंट्री जिसमें `api: "anthropic-messages"` हो
3. `agent.db` से Anthropic OAuth क्रेडेंशियल्स (5-मिनट बफर के भीतर समाप्त नहीं होने चाहिए)
4. जेनेरिक Anthropic env फ़ॉलबैक: प्रोवाइडर कुंजी (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + वैकल्पिक `ANTHROPIC_BASE_URL` (Foundry मोड सक्षम होने पर `FOUNDRY_BASE_URL`)

संबंधित वेरिएबल्स:

| वेरिएबल | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | सर्वोच्च-प्राथमिकता स्पष्ट सर्च कुंजी |
| `ANTHROPIC_SEARCH_BASE_URL` | अनुपस्थित होने पर `https://api.anthropic.com` पर डिफ़ॉल्ट |
| `ANTHROPIC_SEARCH_MODEL` | `claude-haiku-4-5` पर डिफ़ॉल्ट |
| `ANTHROPIC_BASE_URL` | टियर-4 प्रमाणीकरण पथ के लिए जेनेरिक फ़ॉलबैक बेस URL |

### Perplexity OAuth फ़्लो व्यवहार फ़्लैग

| वेरिएबल | व्यवहार |
|---|---|
| `PI_AUTH_NO_BORROW` | यदि सेट है, Perplexity लॉगिन फ़्लो में macOS नेटिव-ऐप टोकन बॉरोइंग पथ अक्षम करता है |

---

## 4) Python टूलिंग और कर्नेल रनटाइम

| वेरिएबल | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `PI_PY` | Python टूल मोड ओवरराइड: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; अमान्य मान अनदेखे |
| `PI_PYTHON_SKIP_CHECK` | यदि `1`, Python कर्नेल उपलब्धता जाँच/वार्म जाँच को छोड़ देता है |
| `PI_PYTHON_GATEWAY_URL` | यदि सेट है, स्थानीय साझा गेटवे के बजाय बाहरी कर्नेल गेटवे का उपयोग करता है |
| `PI_PYTHON_GATEWAY_TOKEN` | बाहरी गेटवे के लिए वैकल्पिक प्रमाणीकरण टोकन (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | यदि `1`, कर्नेल मॉड्यूल में निम्न-स्तरीय IPC ट्रेस पथ सक्षम करता है |
| `VIRTUAL_ENV` | Python रनटाइम रिज़ॉल्यूशन के लिए सर्वोच्च-प्राथमिकता venv पथ |

अतिरिक्त सशर्त व्यवहार:

- यदि `BUN_ENV=test` या `NODE_ENV=test`, Python उपलब्धता जाँच को OK माना जाता है और वार्मिंग छोड़ दी जाती है।
- Python env फ़िल्टरिंग सामान्य API कुंजियों को अस्वीकार करती है और सुरक्षित बेस वेरिएबल्स + `LC_`, `XDG_`, `PI_` प्रीफिक्स की अनुमति देती है।

---

## 5) एजेंट/रनटाइम व्यवहार टॉगल

| वेरिएबल                   | डिफ़ॉल्ट / व्यवहार                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | `smol` के लिए अस्थायी मॉडल-रोल ओवरराइड (CLI `--smol` प्राथमिकता लेता है)                     |
| `PI_SLOW_MODEL`            | `slow` के लिए अस्थायी मॉडल-रोल ओवरराइड (CLI `--slow` प्राथमिकता लेता है)                     |
| `PI_PLAN_MODEL`            | `plan` के लिए अस्थायी मॉडल-रोल ओवरराइड (CLI `--plan` प्राथमिकता लेता है)                     |
| `PI_NO_TITLE`              | यदि सेट (कोई भी गैर-रिक्त मान), पहले उपयोगकर्ता संदेश पर ऑटो सेशन शीर्षक जनरेशन अक्षम करता है   |
| `NULL_PROMPT`              | यदि `true`, सिस्टम प्रॉम्प्ट बिल्डर रिक्त स्ट्रिंग लौटाता है                                        |
| `PI_BLOCKED_AGENT`         | टास्क टूल में एक विशिष्ट सबएजेंट प्रकार को ब्लॉक करता है                                                 |
| `PI_SUBPROCESS_CMD`        | सबएजेंट स्पॉन कमांड को ओवरराइड करता है (`xcsh` / `xcsh.cmd` रिज़ॉल्यूशन बायपास)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | प्रति सबएजेंट अधिकतम कैप्चर्ड आउटपुट बाइट्स (डिफ़ॉल्ट `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | प्रति सबएजेंट अधिकतम कैप्चर्ड आउटपुट लाइन्स (डिफ़ॉल्ट `5000`)                                      |
| `PI_TIMING`                | यदि `1`, स्टार्टअप/टूल टाइमिंग इंस्ट्रूमेंटेशन लॉग्स सक्षम करता है                                     |
| `PI_DEBUG_STARTUP`         | कई स्टार्टअप पथों में stderr पर स्टार्टअप स्टेज डीबग प्रिंट्स सक्षम करता है                       |
| `PI_PACKAGE_DIR`           | पैकेज एसेट बेस डिर रिज़ॉल्यूशन को ओवरराइड करता है (docs/examples/changelog पथ लुकअप)            |
| `PI_DISABLE_LSPMUX`        | यदि `1`, lspmux डिटेक्शन/इंटीग्रेशन अक्षम करता है और डायरेक्ट LSP सर्वर स्पॉनिंग को बाध्य करता है          |
| `LITELLM_BASE_URL`         | LiteLLM प्रॉक्सी बेस URL। `LITELLM_API_KEY` के साथ सेट होने पर, पहले रन पर `models.yml` का ऑटो-जनरेशन और हर स्टार्टअप पर सेल्फ-हीलिंग ट्रिगर करता है |
| `LM_STUDIO_BASE_URL`       | डिफ़ॉल्ट अंतर्निहित LM Studio डिस्कवरी बेस URL ओवरराइड (अनसेट होने पर `http://127.0.0.1:1234/v1`) |
| `OLLAMA_BASE_URL`          | डिफ़ॉल्ट अंतर्निहित Ollama डिस्कवरी बेस URL ओवरराइड (अनसेट होने पर `http://127.0.0.1:11434`)      |
| `LLAMA_CPP_BASE_URL`       | डिफ़ॉल्ट अंतर्निहित Llama.cpp डिस्कवरी बेस URL ओवरराइड (अनसेट होने पर `http://127.0.0.1:8080`)    |
| `PI_EDIT_VARIANT`          | यदि `hashline`, एडिट टूल उपलब्ध होने पर hashline read/grep डिस्प्ले मोड को बाध्य करता है               |
| `PI_NO_PTY`                | यदि `1`, बैश टूल के लिए इंटरैक्टिव PTY पथ अक्षम करता है                                          |

`PI_NO_PTY` आंतरिक रूप से भी सेट किया जाता है जब CLI `--no-pty` का उपयोग किया जाता है।

---

## 6) स्टोरेज और कॉन्फ़िग रूट पथ

ये `@f5xc-salesdemos/pi-utils/dirs` के माध्यम से उपभोग किए जाते हैं और प्रभावित करते हैं कि coding-agent डेटा कहाँ संग्रहीत करता है।

| वेरिएबल | डिफ़ॉल्ट / व्यवहार |
|---|---|
| `PI_CONFIG_DIR` | होम के अंतर्गत कॉन्फ़िग रूट dirname (डिफ़ॉल्ट `.xcsh`) |
| `PI_CODING_AGENT_DIR` | एजेंट डायरेक्टरी के लिए पूर्ण ओवरराइड (डिफ़ॉल्ट `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | पथ हेल्पर्स में कैनोनिकल वर्तमान कार्य डायरेक्टरी मिलान के लिए उपयोग |

---

## 7) शेल/टूल निष्पादन वातावरण

(`packages/utils/src/procmgr.ts` और coding-agent बैश टूल इंटीग्रेशन से।)

| वेरिएबल | व्यवहार |
|---|---|
| `PI_BASH_NO_CI` | स्पॉन किए गए शेल env में स्वचालित `CI=true` इंजेक्शन को दबाता है |
| `CLAUDE_BASH_NO_CI` | `PI_BASH_NO_CI` के लिए लेगेसी एलियास फ़ॉलबैक |
| `PI_BASH_NO_LOGIN` | लॉगिन शेल मोड अक्षम करने के लिए अभिप्रेत |
| `CLAUDE_BASH_NO_LOGIN` | `PI_BASH_NO_LOGIN` के लिए लेगेसी एलियास फ़ॉलबैक |
| `PI_SHELL_PREFIX` | वैकल्पिक कमांड प्रीफिक्स रैपर |
| `CLAUDE_CODE_SHELL_PREFIX` | `PI_SHELL_PREFIX` के लिए लेगेसी एलियास फ़ॉलबैक |
| `VISUAL` | पसंदीदा बाहरी एडिटर कमांड |
| `EDITOR` | फ़ॉलबैक बाहरी एडिटर कमांड |

वर्तमान कार्यान्वयन नोट: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` पढ़े जाते हैं, लेकिन वर्तमान `getShellArgs()` दोनों शाखाओं में `['-l','-c']` लौटाता है (आज प्रभावी रूप से नो-ऑप)।

---

## 8) UI/थीम/सेशन डिटेक्शन (ऑटो-डिटेक्टेड env)

ये रनटाइम सिग्नल के रूप में पढ़े जाते हैं; ये आमतौर पर मैन्युअल रूप से कॉन्फ़िगर करने के बजाय टर्मिनल/OS द्वारा सेट किए जाते हैं।

| वेरिएबल | उपयोग |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | रंग क्षमता डिटेक्शन (थीम कलर मोड) |
| `COLORFGBG` | टर्मिनल बैकग्राउंड लाइट/डार्क ऑटो-डिटेक्शन |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | सिस्टम प्रॉम्प्ट/कॉन्टेक्स्ट में टर्मिनल पहचान |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | सिस्टम प्रॉम्प्ट/कॉन्टेक्स्ट में डेस्कटॉप/विंडो-मैनेजर डिटेक्शन |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | स्थिर प्रति-टर्मिनल सेशन ब्रेडक्रंब IDs |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | सिस्टम जानकारी डायग्नोस्टिक्स |
| `APPDATA`, `XDG_CONFIG_HOME` | lspmux कॉन्फ़िग पथ रिज़ॉल्यूशन |
| `HOME` | MCP कमांड UI में पथ संक्षिप्तीकरण |

---

## 9) नेटिव लोडर/डीबग फ़्लैग्स

| वेरिएबल | व्यवहार |
|---|---|
| `PI_DEV` | `packages/natives` में वर्बोज़ नेटिव एडऑन लोड डायग्नोस्टिक्स सक्षम करता है |

## 10) TUI रनटाइम फ़्लैग्स (साझा पैकेज, coding-agent UX को प्रभावित करता है)

| वेरिएबल | व्यवहार |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` डेस्कटॉप नोटिफिकेशन दबाता है |
| `PI_TUI_WRITE_LOG` | यदि सेट है, TUI लेखन को फाइल में लॉग करता है |
| `PI_HARDWARE_CURSOR` | यदि `1`, हार्डवेयर कर्सर मोड सक्षम करता है |
| `PI_CLEAR_ON_SHRINK` | यदि `1`, सामग्री सिकुड़ने पर खाली पंक्तियाँ साफ़ करता है |
| `PI_DEBUG_REDRAW` | यदि `1`, रीड्रॉ डीबग लॉगिंग सक्षम करता है |
| `PI_TUI_DEBUG` | यदि `1`, गहन TUI डीबग डंप पथ सक्षम करता है |

---

## 11) कमिट जनरेशन नियंत्रण

| वेरिएबल | व्यवहार |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | यदि `true` (केस-असंवेदनशील), कमिट फ़ॉलबैक जनरेशन पथ को बाध्य करता है |
| `PI_COMMIT_NO_FALLBACK` | यदि `true`, एजेंट द्वारा कोई प्रस्ताव न लौटाने पर फ़ॉलबैक अक्षम करता है |
| `PI_COMMIT_MAP_REDUCE` | यदि `false`, मैप-रिड्यूस कमिट विश्लेषण पथ अक्षम करता है |
| `DEBUG` | यदि सेट है, कमिट एजेंट त्रुटि स्टैक ट्रेस प्रिंट किए जाते हैं |

---

## सुरक्षा-संवेदनशील वेरिएबल्स

इन्हें गोपनीय मानें; इन्हें लॉग या कमिट न करें:

- प्रोवाइडर/API कुंजियाँ और OAuth/बेयरर क्रेडेंशियल्स (सभी `*_API_KEY`, `*_TOKEN`, OAuth एक्सेस/रिफ्रेश टोकन)
- क्लाउड क्रेडेंशियल्स (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS` पथ सर्विस-अकाउंट मटेरियल उजागर कर सकता है)
- सर्च/प्रोवाइडर प्रमाणीकरण वेरिएबल्स (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, Anthropic सर्च कुंजियाँ)
- Foundry mTLS मटेरियल (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` जब यह निजी CA बंडलों की ओर इंगित करता है)

Python रनटाइम कर्नेल सबप्रोसेस स्पॉन करने से पहले कई सामान्य कुंजी वेरिएबल्स को स्पष्ट रूप से स्ट्रिप भी करता है (`packages/coding-agent/src/ipy/runtime.ts`)।
