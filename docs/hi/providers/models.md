---
title: मॉडल और प्रोवाइडर कॉन्फ़िगरेशन
description: >-
  models.yml के माध्यम से मॉडल रजिस्ट्री और प्रोवाइडर कॉन्फ़िगरेशन, जिसमें
  रूटिंग, फ़ॉलबैक और प्राइसिंग शामिल है।
sidebar:
  order: 1
  label: मॉडल और प्रोवाइडर
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# मॉडल और प्रोवाइडर कॉन्फ़िगरेशन (`models.yml`)

यह दस्तावेज़ बताता है कि coding-agent वर्तमान में मॉडल कैसे लोड करता है, ओवरराइड कैसे लागू करता है, क्रेडेंशियल कैसे रिज़ॉल्व करता है, और रनटाइम पर मॉडल कैसे चुनता है।

## मॉडल व्यवहार को क्या नियंत्रित करता है

प्राथमिक इम्प्लीमेंटेशन फ़ाइलें:

- `src/config/model-registry.ts` — बिल्ट-इन + कस्टम मॉडल लोड करना, प्रोवाइडर ओवरराइड, रनटाइम डिस्कवरी, ऑथ इंटीग्रेशन
- `src/config/model-resolver.ts` — मॉडल पैटर्न पार्स करना और initial/smol/slow मॉडल चयन
- `src/config/settings-schema.ts` — मॉडल-संबंधित सेटिंग्स (`modelRoles`, प्रोवाइडर ट्रांसपोर्ट प्राथमिकताएं)
- `src/session/auth-storage.ts` — API key + OAuth रिज़ॉल्यूशन क्रम
- `packages/ai/src/models.ts` और `packages/ai/src/types.ts` — बिल्ट-इन प्रोवाइडर/मॉडल और `Model`/`compat` टाइप्स

## कॉन्फ़िग फ़ाइल स्थान और लीगेसी व्यवहार

डिफ़ॉल्ट कॉन्फ़िग पथ:

- `~/.xcsh/agent/models.yml`

लीगेसी व्यवहार अभी भी मौजूद है:

- यदि `models.yml` अनुपस्थित है और उसी स्थान पर `models.json` मौजूद है, तो इसे `models.yml` में माइग्रेट किया जाता है।
- स्पष्ट `.json` / `.jsonc` कॉन्फ़िग पथ अभी भी समर्थित हैं जब `ModelRegistry` को प्रोग्रामेटिक रूप से पास किए जाते हैं।

## `models.yml` संरचना

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

`configVersion` एक वैकल्पिक इंटीजर है जो ऑटो-कॉन्फ़िग सिस्टम द्वारा लिखा जाता है। जब मौजूद होता है, तो xcsh इसका उपयोग पुरानी कॉन्फ़िग का पता लगाने और उन्हें ऑटो-अपग्रेड करने के लिए करता है।

`provider-id` कैनोनिकल प्रोवाइडर कुंजी है जो चयन और ऑथ लुकअप में उपयोग होती है।

`equivalence` वैकल्पिक है और कंक्रीट प्रोवाइडर मॉडल के ऊपर कैनोनिकल मॉडल ग्रुपिंग कॉन्फ़िगर करता है:

- `overrides` एक सटीक कंक्रीट सिलेक्टर (`provider/modelId`) को आधिकारिक अपस्ट्रीम कैनोनिकल id पर मैप करता है
- `exclude` एक कंक्रीट सिलेक्टर को कैनोनिकल ग्रुपिंग से बाहर करता है

## प्रोवाइडर-स्तरीय फ़ील्ड

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

### अनुमत प्रोवाइडर/मॉडल `api` मान

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### अनुमत auth/discovery मान

- `auth`: `apiKey` (डिफ़ॉल्ट) या `none`
- `discovery.type`: `ollama`

## वैलिडेशन नियम (वर्तमान)

### पूर्ण कस्टम प्रोवाइडर (`models` गैर-रिक्त)

आवश्यक:

- `baseUrl`
- `apiKey` जब तक `auth: none` न हो
- `api` प्रोवाइडर स्तर पर या प्रत्येक मॉडल पर

### केवल-ओवरराइड प्रोवाइडर (`models` अनुपस्थित या रिक्त)

इनमें से कम से कम एक परिभाषित होना चाहिए:

- `baseUrl`
- `modelOverrides`
- `discovery`

### डिस्कवरी

- `discovery` के लिए प्रोवाइडर-स्तरीय `api` आवश्यक है।

### मॉडल मान जांच

- `id` आवश्यक है
- `contextWindow` और `maxTokens` यदि प्रदान किए गए हैं तो धनात्मक होने चाहिए

## मर्ज और ओवरराइड क्रम

ModelRegistry पाइपलाइन (रिफ़्रेश पर):

1. `@f5xc-salesdemos/pi-ai` से बिल्ट-इन प्रोवाइडर/मॉडल लोड करें।
2. `models.yml` कस्टम कॉन्फ़िग लोड करें।
3. बिल्ट-इन मॉडल पर प्रोवाइडर ओवरराइड (`baseUrl`, `headers`) लागू करें।
4. `modelOverrides` (प्रति प्रोवाइडर + मॉडल id) लागू करें।
5. कस्टम `models` मर्ज करें:
   - समान `provider + id` मौजूदा को रिप्लेस करता है
   - अन्यथा जोड़ता है
6. रनटाइम-डिस्कवर किए गए मॉडल (वर्तमान में Ollama और LM Studio) लागू करें, फिर मॉडल ओवरराइड पुनः लागू करें।

## कैनोनिकल मॉडल समतुल्यता और कोलेसिंग

रजिस्ट्री प्रत्येक कंक्रीट प्रोवाइडर मॉडल रखती है और फिर उनके ऊपर एक कैनोनिकल लेयर बनाती है।

कैनोनिकल id केवल आधिकारिक अपस्ट्रीम id हैं, उदाहरण के लिए:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` समतुल्यता कॉन्फ़िग

उदाहरण:

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

कैनोनिकल ग्रुपिंग के लिए बिल्ड क्रम:

1. `equivalence.overrides` से सटीक उपयोगकर्ता ओवरराइड
2. बिल्ट-इन मॉडल मेटाडेटा से बंडल किए गए आधिकारिक-id मिलान
3. गेटवे/प्रोवाइडर वेरिएंट के लिए रूढ़िवादी ह्यूरिस्टिक नॉर्मलाइज़ेशन
4. कंक्रीट मॉडल के स्वयं के id पर फ़ॉलबैक

वर्तमान ह्यूरिस्टिक्स जानबूझकर संकीर्ण हैं:

- एम्बेडेड अपस्ट्रीम प्रीफ़िक्स मौजूद होने पर हटाए जा सकते हैं, उदाहरण `anthropic/...` या `openai/...`
- डॉटेड और डैश्ड वर्शन वेरिएंट केवल तभी नॉर्मलाइज़ हो सकते हैं जब वे किसी मौजूदा आधिकारिक id पर मैप होते हैं, उदाहरण `4.6 -> 4-6`
- अस्पष्ट फ़ैमिली या वर्शन बंडल मैच या स्पष्ट ओवरराइड के बिना मर्ज नहीं किए जाते

### कैनोनिकल रिज़ॉल्यूशन व्यवहार

जब कई कंक्रीट वेरिएंट एक कैनोनिकल id साझा करते हैं, तो रिज़ॉल्यूशन इसका उपयोग करता है:

1. उपलब्धता और ऑथ
2. `config.yml` `modelProviderOrder`
3. मौजूदा रजिस्ट्री/प्रोवाइडर क्रम यदि `modelProviderOrder` सेट नहीं है

अक्षम या अप्रमाणित प्रोवाइडर छोड़ दिए जाते हैं।

सेशन स्टेट और ट्रांसक्रिप्ट उस कंक्रीट provider/model को रिकॉर्ड करना जारी रखते हैं जिसने वास्तव में टर्न निष्पादित किया।

प्रोवाइडर डिफ़ॉल्ट बनाम प्रति-मॉडल ओवरराइड:

- प्रोवाइडर `headers` बेसलाइन हैं।
- मॉडल `headers` प्रोवाइडर हेडर कुंजियों को ओवरराइड करते हैं।
- `modelOverrides` मॉडल मेटाडेटा (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`) को ओवरराइड कर सकता है।
- `compat` नेस्टेड रूटिंग ब्लॉक (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`) के लिए डीप-मर्ज किया जाता है।

## रनटाइम डिस्कवरी इंटीग्रेशन

### अंतर्निहित Ollama डिस्कवरी

यदि `ollama` स्पष्ट रूप से कॉन्फ़िगर नहीं किया गया है, तो रजिस्ट्री एक अंतर्निहित डिस्कवरेबल प्रोवाइडर जोड़ती है:

- प्रोवाइडर: `ollama`
- api: `openai-completions`
- बेस URL: `OLLAMA_BASE_URL` या `http://127.0.0.1:11434`
- ऑथ मोड: कीलेस (`auth: none` व्यवहार)

रनटाइम डिस्कवरी Ollama पर `GET /api/tags` कॉल करती है और लोकल डिफ़ॉल्ट के साथ मॉडल एंट्री सिंथेसाइज़ करती है।

### अंतर्निहित llama.cpp डिस्कवरी

यदि `llama.cpp` स्पष्ट रूप से कॉन्फ़िगर नहीं किया गया है, तो रजिस्ट्री एक अंतर्निहित डिस्कवरेबल प्रोवाइडर जोड़ती है:
नोट: यह openai-completions के बजाय नए anthropic messages api का उपयोग करता है।

- प्रोवाइडर: `llama.cpp`
- api: `openai-responses`
- बेस URL: `LLAMA_CPP_BASE_URL` या `http://127.0.0.1:8080`
- ऑथ मोड: कीलेस (`auth: none` व्यवहार)

रनटाइम डिस्कवरी llama.cpp पर `GET models` कॉल करती है और लोकल डिफ़ॉल्ट के साथ मॉडल एंट्री सिंथेसाइज़ करती है।

### अंतर्निहित LM Studio डिस्कवरी

यदि `lm-studio` स्पष्ट रूप से कॉन्फ़िगर नहीं किया गया है, तो रजिस्ट्री एक अंतर्निहित डिस्कवरेबल प्रोवाइडर जोड़ती है:

- प्रोवाइडर: `lm-studio`
- api: `openai-completions`
- बेस URL: `LM_STUDIO_BASE_URL` या `http://127.0.0.1:1234/v1`
- ऑथ मोड: कीलेस (`auth: none` व्यवहार)

रनटाइम डिस्कवरी मॉडल फ़ेच करती है (`GET /models`) और लोकल डिफ़ॉल्ट के साथ मॉडल एंट्री सिंथेसाइज़ करती है।

### स्पष्ट प्रोवाइडर डिस्कवरी

आप डिस्कवरी स्वयं कॉन्फ़िगर कर सकते हैं:

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

### एक्सटेंशन प्रोवाइडर रजिस्ट्रेशन

एक्सटेंशन रनटाइम पर प्रोवाइडर रजिस्टर कर सकते हैं (`pi.registerProvider(...)`), जिसमें शामिल है:

- किसी प्रोवाइडर के लिए मॉडल रिप्लेसमेंट/एपेंड
- नए API ID के लिए कस्टम स्ट्रीम हैंडलर रजिस्ट्रेशन
- कस्टम OAuth प्रोवाइडर रजिस्ट्रेशन

## ऑथ और API key रिज़ॉल्यूशन क्रम

किसी प्रोवाइडर के लिए key अनुरोध करते समय, प्रभावी क्रम है:

1. रनटाइम ओवरराइड (CLI `--api-key`)
2. `agent.db` में संग्रहित API key क्रेडेंशियल
3. `agent.db` में संग्रहित OAuth क्रेडेंशियल (रिफ़्रेश के साथ)
4. एनवायरनमेंट वेरिएबल मैपिंग (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, आदि)
5. ModelRegistry फ़ॉलबैक रिज़ॉल्वर (`models.yml` से प्रोवाइडर `apiKey`, env-name-or-literal सेमांटिक्स)

`models.yml` `apiKey` व्यवहार:

- मान को पहले एनवायरनमेंट वेरिएबल नाम के रूप में माना जाता है।
- यदि कोई env var मौजूद नहीं है, तो लिटरल स्ट्रिंग टोकन के रूप में उपयोग होती है।

यदि `authHeader: true` और प्रोवाइडर `apiKey` सेट है, तो मॉडल को मिलता है:

- `Authorization: Bearer <resolved-key>` हेडर इंजेक्ट किया जाता है।

कीलेस प्रोवाइडर:

- `auth: none` चिह्नित प्रोवाइडर क्रेडेंशियल के बिना उपलब्ध माने जाते हैं।
- `getApiKey*` उनके लिए `kNoAuth` लौटाता है।

## मॉडल उपलब्धता बनाम सभी मॉडल

- `getAll()` लोडेड मॉडल रजिस्ट्री लौटाता है (बिल्ट-इन + मर्ज किए गए कस्टम + डिस्कवर किए गए)।
- `getAvailable()` कीलेस या रिज़ॉल्व योग्य ऑथ वाले मॉडल तक फ़िल्टर करता है।

इसलिए एक मॉडल रजिस्ट्री में मौजूद हो सकता है लेकिन ऑथ उपलब्ध होने तक चयन योग्य नहीं होगा।

## रनटाइम मॉडल रिज़ॉल्यूशन

### CLI और पैटर्न पार्सिंग

`model-resolver.ts` समर्थन करता है:

- सटीक `provider/modelId`
- सटीक कैनोनिकल मॉडल id
- सटीक मॉडल id (प्रोवाइडर अनुमानित)
- फ़ज़ी/सबस्ट्रिंग मैचिंग
- `--models` में ग्लोब स्कोप पैटर्न (जैसे `openai/*`, `*sonnet*`)
- वैकल्पिक `:thinkingLevel` सफ़िक्स (`off|minimal|low|medium|high|xhigh`)

`--provider` लीगेसी है; `--model` प्राथमिक है।

सटीक सिलेक्टर के लिए रिज़ॉल्यूशन प्राथमिकता:

1. सटीक `provider/modelId` कोलेसिंग को बायपास करता है
2. सटीक कैनोनिकल id कैनोनिकल इंडेक्स के माध्यम से रिज़ॉल्व होता है
3. सटीक बेयर कंक्रीट id अभी भी काम करता है
4. फ़ज़ी और ग्लोब मैचिंग सटीक पथों के बाद चलती है

### प्रारंभिक मॉडल चयन प्राथमिकता

`findInitialModel(...)` इस क्रम का उपयोग करता है:

1. स्पष्ट CLI provider+model
2. पहला स्कोप्ड मॉडल (यदि रिज़्यूम नहीं कर रहे)
3. सहेजा गया डिफ़ॉल्ट provider/model
4. उपलब्ध मॉडल में ज्ञात प्रोवाइडर डिफ़ॉल्ट (जैसे OpenAI/Anthropic/आदि)
5. पहला उपलब्ध मॉडल

### रोल एलियास और सेटिंग्स

समर्थित मॉडल रोल:

- `default`, `smol`, `slow`, `plan`, `commit`

`pi/smol` जैसे रोल एलियास `settings.modelRoles` के माध्यम से विस्तारित होते हैं। प्रत्येक रोल मान थिंकिंग सिलेक्टर भी जोड़ सकता है जैसे `:minimal`, `:low`, `:medium`, या `:high`।

यदि कोई रोल किसी अन्य रोल को इंगित करता है, तो लक्ष्य मॉडल सामान्य रूप से इनहेरिट करता है और संदर्भित रोल पर कोई भी स्पष्ट सफ़िक्स उस रोल-विशिष्ट उपयोग के लिए जीतता है।

संबंधित सेटिंग्स:

- `modelRoles` (रिकॉर्ड)
- `enabledModels` (स्कोप्ड पैटर्न सूची)
- `modelProviderOrder` (ग्लोबल कैनोनिकल-प्रोवाइडर प्राथमिकता)
- `providers.kimiApiFormat` (`openai` या `anthropic` रिक्वेस्ट फ़ॉर्मेट)
- `providers.openaiWebsockets` (`auto|off|on` OpenAI Codex ट्रांसपोर्ट के लिए वेबसॉकेट प्राथमिकता)

`modelRoles` इनमें से कुछ भी स्टोर कर सकता है:

- `provider/modelId` किसी कंक्रीट प्रोवाइडर वेरिएंट को पिन करने के लिए
- कैनोनिकल id जैसे `gpt-5.3-codex` प्रोवाइडर कोलेसिंग की अनुमति देने के लिए

`enabledModels` और CLI `--models` के लिए:

- सटीक कैनोनिकल id उस कैनोनिकल ग्रुप में सभी कंक्रीट वेरिएंट में विस्तारित होते हैं
- स्पष्ट `provider/modelId` एंट्री सटीक रहती हैं
- ग्लोब और फ़ज़ी मैच अभी भी कंक्रीट मॉडल पर काम करते हैं

## `/model` और `--list-models`

दोनों सतहें प्रोवाइडर-प्रीफ़िक्स्ड मॉडल को दृश्यमान और चयन योग्य रखती हैं।

वे अब कैनोनिकल/कोलेस्ड मॉडल भी दिखाती हैं:

- `/model` प्रोवाइडर टैब के साथ एक कैनोनिकल व्यू शामिल करता है
- `--list-models` कंक्रीट प्रोवाइडर पंक्तियों के साथ एक कैनोनिकल सेक्शन प्रिंट करता है

कैनोनिकल एंट्री चुनने पर कैनोनिकल सिलेक्टर स्टोर होता है। प्रोवाइडर पंक्ति चुनने पर स्पष्ट `provider/modelId` स्टोर होता है।

## कॉन्टेक्स्ट प्रमोशन (मॉडल-स्तरीय फ़ॉलबैक चेन)

कॉन्टेक्स्ट प्रमोशन छोटे-कॉन्टेक्स्ट वेरिएंट (उदाहरण `*-spark`) के लिए एक ओवरफ़्लो रिकवरी मैकेनिज़्म है जो API द्वारा कॉन्टेक्स्ट लंबाई त्रुटि के साथ रिक्वेस्ट अस्वीकार करने पर स्वचालित रूप से एक बड़े-कॉन्टेक्स्ट सिबलिंग में प्रमोट करता है।

### ट्रिगर और क्रम

जब कोई टर्न कॉन्टेक्स्ट ओवरफ़्लो त्रुटि (जैसे `context_length_exceeded`) के साथ विफल होता है, तो `AgentSession` कॉम्पैक्शन पर फ़ॉलबैक करने **से पहले** प्रमोशन का प्रयास करता है:

1. यदि `contextPromotion.enabled` true है, तो प्रमोशन लक्ष्य रिज़ॉल्व करें (नीचे देखें)।
2. यदि कोई लक्ष्य मिलता है, तो उसमें स्विच करें और रिक्वेस्ट पुनः प्रयास करें — कॉम्पैक्शन की आवश्यकता नहीं।
3. यदि कोई लक्ष्य उपलब्ध नहीं है, तो वर्तमान मॉडल पर ऑटो-कॉम्पैक्शन पर आगे बढ़ें।

### लक्ष्य चयन

चयन मॉडल-संचालित है, रोल-संचालित नहीं:

1. `currentModel.contextPromotionTarget` (यदि कॉन्फ़िगर किया गया है)
2. समान प्रोवाइडर + API पर सबसे छोटा बड़ा-कॉन्टेक्स्ट मॉडल

उम्मीदवारों को तब तक अनदेखा किया जाता है जब तक क्रेडेंशियल रिज़ॉल्व न हो जाएं (`ModelRegistry.getApiKey(...)`)।

### OpenAI Codex वेबसॉकेट हैंडऑफ़

यदि `openai-codex-responses` से/में स्विच कर रहे हैं, तो मॉडल स्विच से पहले सेशन प्रोवाइडर स्टेट key `openai-codex-responses` बंद कर दी जाती है। यह वेबसॉकेट ट्रांसपोर्ट स्टेट को ड्रॉप करता है ताकि अगला टर्न प्रमोटेड मॉडल पर साफ़ शुरू हो।

### पर्सिस्टेंस व्यवहार

प्रमोशन अस्थायी स्विचिंग (`setModelTemporary`) का उपयोग करता है:

- सेशन हिस्ट्री में अस्थायी `model_change` के रूप में रिकॉर्ड किया जाता है
- सहेजी गई रोल मैपिंग को फिर से नहीं लिखता

### स्पष्ट फ़ॉलबैक चेन कॉन्फ़िगर करना

`contextPromotionTarget` के माध्यम से मॉडल मेटाडेटा में सीधे फ़ॉलबैक कॉन्फ़िगर करें।

`contextPromotionTarget` इनमें से कोई भी स्वीकार करता है:

- `provider/model-id` (स्पष्ट)
- `model-id` (वर्तमान प्रोवाइडर के भीतर रिज़ॉल्व)

उदाहरण (`models.yml`) समान प्रोवाइडर पर Spark -> नॉन-Spark के लिए:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

बिल्ट-इन मॉडल जनरेटर भी `*-spark` मॉडल के लिए यह स्वचालित रूप से असाइन करता है जब समान-प्रोवाइडर बेस मॉडल मौजूद होता है।

## संगतता और रूटिंग फ़ील्ड

`models.yml` इस `compat` सबसेट का समर्थन करता है:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` या `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

ये OpenAI-completions ट्रांसपोर्ट लॉजिक द्वारा उपभोग किए जाते हैं और URL-आधारित ऑटो-डिटेक्शन के साथ संयुक्त होते हैं।

## व्यावहारिक उदाहरण

### लोकल OpenAI-संगत एंडपॉइंट (बिना ऑथ)

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

### env-आधारित key के साथ होस्टेड प्रॉक्सी

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

### बिल्ट-इन प्रोवाइडर रूट + मॉडल मेटाडेटा ओवरराइड करें

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

## LiteLLM प्रॉक्सी ऑटो-कॉन्फ़िगरेशन

जब `LITELLM_BASE_URL` और `LITELLM_API_KEY` दोनों एनवायरनमेंट वेरिएबल सेट होते हैं, तो xcsh LiteLLM प्रॉक्सी के लिए `models.yml` कॉन्फ़िगरेशन को स्वचालित रूप से प्रबंधित करता है।

### पहले-रन ऑटो-जनरेशन

यदि `models.yml` मौजूद नहीं है और LiteLLM env vars का पता चलता है, तो xcsh इसे स्वचालित रूप से जनरेट करता है:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

उचित इमेज प्रोवाइडर सेटिंग्स के साथ एक डिफ़ॉल्ट `config.yml` भी जनरेट किया जाता है।

### स्टार्टअप सेल्फ-हीलिंग

प्रत्येक स्टार्टअप पर, मॉडल रजिस्ट्री में `startupHealthCheck()` निम्नलिखित जांच चलाता है:

| स्थिति | कार्रवाई |
|---------|---------|
| `models.yml` अनुपस्थित | env vars से ऑटो-जनरेट |
| `models.yml` करप्ट या अनपार्सेबल | `.bak` में बैकअप, पुनर्जनन |
| `baseUrl` `LITELLM_BASE_URL` से मेल नहीं खाता | `.bak` में बैकअप, नए URL के साथ पुनर्जनन |
| `configVersion` अनुपस्थित या पुराना | `.bak` में बैकअप, वर्तमान वर्शन के साथ पुनर्जनन |
| कॉन्फ़िग स्वस्थ है | कोई कार्रवाई नहीं |

सभी मरम्मत ओवरराइट करने से पहले `.bak` बैकअप बनाती हैं। सभी ऑपरेशन आइडेम्पोटेंट हैं।

### CLI कमांड

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### आवश्यक एनवायरनमेंट वेरिएबल

| वेरिएबल | उद्देश्य |
|---------|---------|
| `LITELLM_BASE_URL` | LiteLLM प्रॉक्सी URL (जैसे `https://your-proxy.example.com`)। `http://` या `https://` से शुरू होना चाहिए। |
| `LITELLM_API_KEY` | प्रॉक्सी के लिए API key। जनरेट की गई कॉन्फ़िग में नाम से संदर्भित, रनटाइम पर रिज़ॉल्व किया जाता है। |

यदि कोई भी वेरिएबल अनसेट है, तो ऑटो-कॉन्फ़िगरेशन चुपचाप छोड़ दिया जाता है।

### कॉन्फ़िग वर्शनिंग

जनरेट की गई कॉन्फ़िग में `configVersion` फ़ील्ड शामिल होती है। जब भविष्य के रिलीज़ में जनरेट किया गया फ़ॉर्मेट बदलता है, तो xcsh पुरानी कॉन्फ़िग का पता लगाता है और उन्हें स्वचालित रूप से अपग्रेड करता है (बैकअप के साथ)।

## लीगेसी कंज्यूमर चेतावनी

अधिकांश मॉडल कॉन्फ़िगरेशन अब `ModelRegistry` के माध्यम से `models.yml` से प्रवाहित होता है।

एक उल्लेखनीय लीगेसी पथ शेष है: वेब-सर्च Anthropic ऑथ रिज़ॉल्यूशन अभी भी `src/web/search/auth.ts` में सीधे `~/.xcsh/agent/models.json` पढ़ता है।

यदि आप उस विशिष्ट पथ पर निर्भर हैं, तो उस मॉड्यूल के माइग्रेट होने तक JSON संगतता ध्यान में रखें।

## विफलता मोड

यदि `models.yml` स्कीमा या वैलिडेशन जांच में विफल होता है:

- यदि `LITELLM_BASE_URL` और `LITELLM_API_KEY` सेट हैं, तो स्टार्टअप हेल्थ चेक ऑटो-मरम्मत का प्रयास करता है (करप्ट फ़ाइल का बैकअप, env vars से पुनर्जनन)। यदि मरम्मत सफल होती है, तो रजिस्ट्री ठीक की गई कॉन्फ़िग को पुनः लोड करती है।
- यदि ऑटो-मरम्मत संभव नहीं है (env vars अनसेट, लिखने में विफलता), तो रजिस्ट्री बिल्ट-इन मॉडल के साथ काम करना जारी रखती है।
- त्रुटि `ModelRegistry.getError()` के माध्यम से उजागर होती है और UI/सूचनाओं में दिखाई देती है।
