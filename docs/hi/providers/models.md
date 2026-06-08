---
title: मॉडल और प्रदाता कॉन्फ़िगरेशन
description: >-
  Model registry and provider configuration via models.yml with routing,
  fallback, and pricing.
sidebar:
  order: 1
  label: मॉडल और प्रदाता
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# मॉडल और प्रदाता कॉन्फ़िगरेशन (`models.yml`)

यह दस्तावेज़ वर्णन करता है कि coding-agent वर्तमान में मॉडल कैसे लोड करता है, ओवरराइड कैसे लागू करता है, क्रेडेंशियल कैसे रिज़ॉल्व करता है, और रनटाइम पर मॉडल कैसे चुनता है।

## मॉडल व्यवहार को क्या नियंत्रित करता है

प्राथमिक कार्यान्वयन फ़ाइलें:

- `src/config/model-registry.ts` — बिल्ट-इन + कस्टम मॉडल लोड करना, प्रदाता ओवरराइड, रनटाइम डिस्कवरी, ऑथ इंटीग्रेशन
- `src/config/model-resolver.ts` — मॉडल पैटर्न पार्स करना और initial/smol/slow मॉडल चुनना
- `src/config/settings-schema.ts` — मॉडल-संबंधी सेटिंग्स (`modelRoles`, प्रदाता ट्रांसपोर्ट प्राथमिकताएं)
- `src/session/auth-storage.ts` — API की + OAuth रिज़ॉल्यूशन क्रम
- `packages/ai/src/models.ts` और `packages/ai/src/types.ts` — बिल्ट-इन प्रदाता/मॉडल और `Model`/`compat` प्रकार

## कॉन्फ़िग फ़ाइल स्थान और लेगेसी व्यवहार

डिफ़ॉल्ट कॉन्फ़िग पथ:

- `~/.xcsh/agent/models.yml`

लेगेसी व्यवहार अभी भी मौजूद है:

- यदि `models.yml` अनुपस्थित है और `models.json` उसी स्थान पर मौजूद है, तो इसे `models.yml` में माइग्रेट कर दिया जाता है।
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

`configVersion` एक वैकल्पिक पूर्णांक है जो ऑटो-कॉन्फ़िग सिस्टम द्वारा लिखा जाता है। जब मौजूद हो, xcsh इसका उपयोग पुराने कॉन्फ़िग का पता लगाने और उन्हें स्वचालित रूप से अपग्रेड करने के लिए करता है।

`provider-id` वह कैनोनिकल प्रदाता की है जो चयन और ऑथ लुकअप में उपयोग होती है।

`equivalence` वैकल्पिक है और ठोस प्रदाता मॉडल के ऊपर कैनोनिकल मॉडल ग्रुपिंग कॉन्फ़िगर करता है:

- `overrides` एक सटीक ठोस सिलेक्टर (`provider/modelId`) को एक आधिकारिक अपस्ट्रीम कैनोनिकल id से मैप करता है
- `exclude` एक ठोस सिलेक्टर को कैनोनिकल ग्रुपिंग से बाहर रखता है

## प्रदाता-स्तरीय फ़ील्ड

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

### अनुमत प्रदाता/मॉडल `api` मान

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

## सत्यापन नियम (वर्तमान)

### पूर्ण कस्टम प्रदाता (`models` गैर-रिक्त है)

आवश्यक:

- `baseUrl`
- `apiKey` जब तक `auth: none` न हो
- `api` प्रदाता स्तर पर या प्रत्येक मॉडल पर

### केवल-ओवरराइड प्रदाता (`models` अनुपस्थित या रिक्त)

इनमें से कम से कम एक परिभाषित होना चाहिए:

- `baseUrl`
- `modelOverrides`
- `discovery`

### डिस्कवरी

- `discovery` के लिए प्रदाता-स्तरीय `api` आवश्यक है।

### मॉडल मान जांच

- `id` आवश्यक है
- `contextWindow` और `maxTokens` यदि प्रदान किए गए हों तो धनात्मक होने चाहिए

## मर्ज और ओवरराइड क्रम

ModelRegistry पाइपलाइन (रिफ्रेश पर):

1. `@f5xc-salesdemos/pi-ai` से बिल्ट-इन प्रदाता/मॉडल लोड करें।
2. `models.yml` कस्टम कॉन्फ़िग लोड करें।
3. बिल्ट-इन मॉडल पर प्रदाता ओवरराइड (`baseUrl`, `headers`) लागू करें।
4. `modelOverrides` लागू करें (प्रति प्रदाता + मॉडल id)।
5. कस्टम `models` मर्ज करें:
   - समान `provider + id` मौजूदा को प्रतिस्थापित करता है
   - अन्यथा जोड़ें
6. रनटाइम-डिस्कवर्ड मॉडल लागू करें (वर्तमान में Ollama और LM Studio), फिर मॉडल ओवरराइड पुनः लागू करें।

## कैनोनिकल मॉडल समतुल्यता और कोलेसिंग

रजिस्ट्री प्रत्येक ठोस प्रदाता मॉडल रखती है और फिर उनके ऊपर एक कैनोनिकल परत बनाती है।

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

कैनोनिकल ग्रुपिंग के लिए निर्माण क्रम:

1. `equivalence.overrides` से सटीक उपयोगकर्ता ओवरराइड
2. बिल्ट-इन मॉडल मेटाडेटा से बंडल आधिकारिक-id मिलान
3. गेटवे/प्रदाता वेरिएंट के लिए रूढ़िवादी ह्यूरिस्टिक नॉर्मलाइज़ेशन
4. ठोस मॉडल की स्वयं की id पर फ़ॉलबैक

वर्तमान ह्यूरिस्टिक्स जानबूझकर संकीर्ण हैं:

- एम्बेडेड अपस्ट्रीम उपसर्ग मौजूद होने पर हटाए जा सकते हैं, उदाहरण के लिए `anthropic/...` या `openai/...`
- डॉट और डैश वर्शन वेरिएंट केवल तब नॉर्मलाइज़ हो सकते हैं जब वे किसी मौजूदा आधिकारिक id से मैप होते हैं, उदाहरण के लिए `4.6 -> 4-6`
- अस्पष्ट फ़ैमिली या वर्शन बिना बंडल मिलान या स्पष्ट ओवरराइड के मर्ज नहीं किए जाते

### कैनोनिकल रिज़ॉल्यूशन व्यवहार

जब कई ठोस वेरिएंट एक कैनोनिकल id साझा करते हैं, रिज़ॉल्यूशन इसका उपयोग करता है:

1. उपलब्धता और ऑथ
2. `config.yml` `modelProviderOrder`
3. मौजूदा रजिस्ट्री/प्रदाता क्रम यदि `modelProviderOrder` सेट नहीं है

अक्षम या अनप्रमाणित प्रदाता छोड़ दिए जाते हैं।

सेशन स्थिति और ट्रांसक्रिप्ट उस ठोस प्रदाता/मॉडल को रिकॉर्ड करना जारी रखते हैं जिसने वास्तव में टर्न निष्पादित किया।

प्रदाता डिफ़ॉल्ट बनाम प्रति-मॉडल ओवरराइड:

- प्रदाता `headers` बेसलाइन हैं।
- मॉडल `headers` प्रदाता हेडर की को ओवरराइड करते हैं।
- `modelOverrides` मॉडल मेटाडेटा (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`) को ओवरराइड कर सकता है।
- `compat` नेस्टेड राउटिंग ब्लॉक (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`) के लिए डीप-मर्ज होता है।

## रनटाइम डिस्कवरी इंटीग्रेशन

### अंतर्निहित Ollama डिस्कवरी

यदि `ollama` स्पष्ट रूप से कॉन्फ़िगर नहीं है, रजिस्ट्री एक अंतर्निहित डिस्कवर करने योग्य प्रदाता जोड़ती है:

- प्रदाता: `ollama`
- api: `openai-completions`
- बेस URL: `OLLAMA_BASE_URL` या `http://127.0.0.1:11434`
- ऑथ मोड: कीलेस (`auth: none` व्यवहार)

रनटाइम डिस्कवरी Ollama पर `GET /api/tags` कॉल करती है और स्थानीय डिफ़ॉल्ट के साथ मॉडल प्रविष्टियां संश्लेषित करती है।

### अंतर्निहित llama.cpp डिस्कवरी

यदि `llama.cpp` स्पष्ट रूप से कॉन्फ़िगर नहीं है, रजिस्ट्री एक अंतर्निहित डिस्कवर करने योग्य प्रदाता जोड़ती है:
नोट: यह openai-completions के बजाय नए anthropic messages api का उपयोग कर रहा है।

- प्रदाता: `llama.cpp`
- api: `openai-responses`
- बेस URL: `LLAMA_CPP_BASE_URL` या `http://127.0.0.1:8080`
- ऑथ मोड: कीलेस (`auth: none` व्यवहार)

रनटाइम डिस्कवरी llama.cpp पर `GET models` कॉल करती है और स्थानीय डिफ़ॉल्ट के साथ मॉडल प्रविष्टियां संश्लेषित करती है।

### अंतर्निहित LM Studio डिस्कवरी

यदि `lm-studio` स्पष्ट रूप से कॉन्फ़िगर नहीं है, रजिस्ट्री एक अंतर्निहित डिस्कवर करने योग्य प्रदाता जोड़ती है:

- प्रदाता: `lm-studio`
- api: `openai-completions`
- बेस URL: `LM_STUDIO_BASE_URL` या `http://127.0.0.1:1234/v1`
- ऑथ मोड: कीलेस (`auth: none` व्यवहार)

रनटाइम डिस्कवरी मॉडल फ़ेच करती है (`GET /models`) और स्थानीय डिफ़ॉल्ट के साथ मॉडल प्रविष्टियां संश्लेषित करती है।

### स्पष्ट प्रदाता डिस्कवरी

आप स्वयं डिस्कवरी कॉन्फ़िगर कर सकते हैं:

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

### एक्सटेंशन प्रदाता पंजीकरण

एक्सटेंशन रनटाइम पर प्रदाता पंजीकृत कर सकते हैं (`pi.registerProvider(...)`), जिसमें शामिल हैं:

- किसी प्रदाता के लिए मॉडल प्रतिस्थापन/जोड़ना
- नए API ID के लिए कस्टम स्ट्रीम हैंडलर पंजीकरण
- कस्टम OAuth प्रदाता पंजीकरण

## ऑथ और API की रिज़ॉल्यूशन क्रम

किसी प्रदाता के लिए की का अनुरोध करते समय, प्रभावी क्रम है:

1. रनटाइम ओवरराइड (CLI `--api-key`)
2. `agent.db` में संग्रहीत API की क्रेडेंशियल
3. `agent.db` में संग्रहीत OAuth क्रेडेंशियल (रिफ्रेश सहित)
4. एनवायरनमेंट वेरिएबल मैपिंग (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, आदि)
5. ModelRegistry फ़ॉलबैक रिज़ॉल्वर (`models.yml` से प्रदाता `apiKey`, env-name-or-literal सिमेंटिक्स)

`models.yml` `apiKey` व्यवहार:

- मान को पहले एनवायरनमेंट वेरिएबल नाम के रूप में माना जाता है।
- यदि कोई env var मौजूद नहीं है, तो शाब्दिक स्ट्रिंग को टोकन के रूप में उपयोग किया जाता है।

यदि `authHeader: true` और प्रदाता `apiKey` सेट है, तो मॉडल को मिलता है:

- `Authorization: Bearer <resolved-key>` हेडर इंजेक्ट किया जाता है।

कीलेस प्रदाता:

- `auth: none` चिह्नित प्रदाताओं को बिना क्रेडेंशियल के उपलब्ध माना जाता है।
- `getApiKey*` उनके लिए `kNoAuth` लौटाता है।

## मॉडल उपलब्धता बनाम सभी मॉडल

- `getAll()` लोड की गई मॉडल रजिस्ट्री (बिल्ट-इन + मर्ज किए गए कस्टम + डिस्कवर्ड) लौटाता है।
- `getAvailable()` उन मॉडल को फ़िल्टर करता है जो कीलेस हैं या जिनके पास रिज़ॉल्व करने योग्य ऑथ है।

तो एक मॉडल रजिस्ट्री में मौजूद हो सकता है लेकिन ऑथ उपलब्ध होने तक चयन योग्य नहीं होगा।

## रनटाइम मॉडल रिज़ॉल्यूशन

### CLI और पैटर्न पार्सिंग

`model-resolver.ts` समर्थन करता है:

- सटीक `provider/modelId`
- सटीक कैनोनिकल मॉडल id
- सटीक मॉडल id (प्रदाता अनुमानित)
- फ़ज़ी/सबस्ट्रिंग मिलान
- `--models` में ग्लोब स्कोप पैटर्न (जैसे `openai/*`, `*sonnet*`)
- वैकल्पिक `:thinkingLevel` प्रत्यय (`off|minimal|low|medium|high|xhigh`)

`--provider` लेगेसी है; `--model` पसंदीदा है।

सटीक सिलेक्टर के लिए रिज़ॉल्यूशन प्राथमिकता:

1. सटीक `provider/modelId` कोलेसिंग को बायपास करता है
2. सटीक कैनोनिकल id कैनोनिकल इंडेक्स के माध्यम से रिज़ॉल्व होता है
3. सटीक बेयर ठोस id अभी भी काम करता है
4. फ़ज़ी और ग्लोब मिलान सटीक पथों के बाद चलते हैं

### प्रारंभिक मॉडल चयन प्राथमिकता

`findInitialModel(...)` इस क्रम का उपयोग करता है:

1. स्पष्ट CLI प्रदाता+मॉडल
2. पहला स्कोप्ड मॉडल (यदि पुनः प्रारंभ नहीं हो रहा)
3. सहेजा गया डिफ़ॉल्ट प्रदाता/मॉडल
4. उपलब्ध मॉडल में ज्ञात प्रदाता डिफ़ॉल्ट (जैसे OpenAI/Anthropic/आदि)
5. पहला उपलब्ध मॉडल

### रोल उपनाम और सेटिंग्स

समर्थित मॉडल रोल:

- `default`, `smol`, `slow`, `plan`, `commit`

`pi/smol` जैसे रोल उपनाम `settings.modelRoles` के माध्यम से विस्तारित होते हैं। प्रत्येक रोल मान `:minimal`, `:low`, `:medium`, या `:high` जैसा थिंकिंग सिलेक्टर भी जोड़ सकता है।

यदि कोई रोल दूसरे रोल की ओर इंगित करता है, तो लक्ष्य मॉडल सामान्य रूप से इनहेरिट होता है और संदर्भित रोल पर कोई भी स्पष्ट प्रत्यय उस रोल-विशिष्ट उपयोग के लिए प्रबल होता है।

संबंधित सेटिंग्स:

- `modelRoles` (रिकॉर्ड)
- `enabledModels` (स्कोप्ड पैटर्न सूची)
- `modelProviderOrder` (ग्लोबल कैनोनिकल-प्रदाता प्राथमिकता)
- `providers.kimiApiFormat` (`openai` या `anthropic` अनुरोध प्रारूप)
- `providers.openaiWebsockets` (`auto|off|on` OpenAI Codex ट्रांसपोर्ट के लिए वेबसॉकेट प्राथमिकता)

`modelRoles` इनमें से कोई भी संग्रहीत कर सकता है:

- ठोस प्रदाता वेरिएंट को पिन करने के लिए `provider/modelId`
- प्रदाता कोलेसिंग की अनुमति देने के लिए `gpt-5.3-codex` जैसा कैनोनिकल id

`enabledModels` और CLI `--models` के लिए:

- सटीक कैनोनिकल id उस कैनोनिकल ग्रुप के सभी ठोस वेरिएंट में विस्तारित होते हैं
- स्पष्ट `provider/modelId` प्रविष्टियां सटीक रहती हैं
- ग्लोब और फ़ज़ी मिलान अभी भी ठोस मॉडल पर संचालित होते हैं

## `/model` और `--list-models`

दोनों सतहें प्रदाता-उपसर्ग वाले मॉडल को दृश्यमान और चयन योग्य रखती हैं।

वे अब कैनोनिकल/कोलेस्ड मॉडल भी प्रदर्शित करती हैं:

- `/model` प्रदाता टैब के साथ एक कैनोनिकल दृश्य शामिल करता है
- `--list-models` ठोस प्रदाता पंक्तियों के साथ एक कैनोनिकल अनुभाग प्रिंट करता है

कैनोनिकल प्रविष्टि चुनने पर कैनोनिकल सिलेक्टर संग्रहीत होता है। प्रदाता पंक्ति चुनने पर स्पष्ट `provider/modelId` संग्रहीत होता है।

## संदर्भ प्रोमोशन (मॉडल-स्तरीय फ़ॉलबैक श्रृंखलाएं)

संदर्भ प्रोमोशन छोटे-संदर्भ वेरिएंट (उदाहरण के लिए `*-spark`) के लिए एक ओवरफ़्लो रिकवरी तंत्र है जो API द्वारा संदर्भ लंबाई त्रुटि के साथ अनुरोध अस्वीकार करने पर स्वचालित रूप से बड़े-संदर्भ वाले सिबलिंग में प्रोमोट करता है।

### ट्रिगर और क्रम

जब कोई टर्न संदर्भ ओवरफ़्लो त्रुटि (जैसे `context_length_exceeded`) के साथ विफल होता है, `AgentSession` कंपैक्शन पर फ़ॉलबैक करने **से पहले** प्रोमोशन का प्रयास करता है:

1. यदि `contextPromotion.enabled` true है, तो प्रोमोशन लक्ष्य रिज़ॉल्व करें (नीचे देखें)।
2. यदि लक्ष्य मिलता है, उस पर स्विच करें और अनुरोध पुनः प्रयास करें — कोई कंपैक्शन आवश्यक नहीं।
3. यदि कोई लक्ष्य उपलब्ध नहीं है, वर्तमान मॉडल पर ऑटो-कंपैक्शन पर आगे बढ़ें।

### लक्ष्य चयन

चयन मॉडल-संचालित है, रोल-संचालित नहीं:

1. `currentModel.contextPromotionTarget` (यदि कॉन्फ़िगर किया गया हो)
2. समान प्रदाता + API पर सबसे छोटा बड़े-संदर्भ वाला मॉडल

उम्मीदवारों को अनदेखा किया जाता है जब तक क्रेडेंशियल रिज़ॉल्व नहीं होते (`ModelRegistry.getApiKey(...)`)।

### OpenAI Codex वेबसॉकेट हैंडऑफ़

यदि `openai-codex-responses` से/में स्विच हो रहा है, सेशन प्रदाता स्थिति की `openai-codex-responses` मॉडल स्विच से पहले बंद कर दी जाती है। यह वेबसॉकेट ट्रांसपोर्ट स्थिति को ड्रॉप करता है ताकि अगला टर्न प्रोमोटेड मॉडल पर नए सिरे से शुरू हो।

### पर्सिस्टेंस व्यवहार

प्रोमोशन अस्थायी स्विचिंग (`setModelTemporary`) का उपयोग करता है:

- सेशन इतिहास में अस्थायी `model_change` के रूप में रिकॉर्ड किया जाता है
- सहेजी गई रोल मैपिंग को पुनर्लिखित नहीं करता

### स्पष्ट फ़ॉलबैक श्रृंखलाएं कॉन्फ़िगर करना

`contextPromotionTarget` के माध्यम से सीधे मॉडल मेटाडेटा में फ़ॉलबैक कॉन्फ़िगर करें।

`contextPromotionTarget` इनमें से कोई भी स्वीकार करता है:

- `provider/model-id` (स्पष्ट)
- `model-id` (वर्तमान प्रदाता के भीतर रिज़ॉल्व)

समान प्रदाता पर Spark -> non-Spark के लिए उदाहरण (`models.yml`):

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

बिल्ट-इन मॉडल जेनरेटर भी `*-spark` मॉडल के लिए यह स्वचालित रूप से असाइन करता है जब समान-प्रदाता बेस मॉडल मौजूद होता है।

## संगतता और राउटिंग फ़ील्ड

`models.yml` इस `compat` उपसमूह का समर्थन करता है:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` या `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

इनका उपयोग OpenAI-completions ट्रांसपोर्ट लॉजिक द्वारा किया जाता है और URL-आधारित ऑटो-डिटेक्शन के साथ संयुक्त किया जाता है।

## व्यावहारिक उदाहरण

### स्थानीय OpenAI-संगत एंडपॉइंट (बिना ऑथ)

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

### env-आधारित की के साथ होस्टेड प्रॉक्सी

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

### बिल्ट-इन प्रदाता रूट + मॉडल मेटाडेटा ओवरराइड करें

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

जब `LITELLM_BASE_URL` और `LITELLM_API_KEY` दोनों एनवायरनमेंट वेरिएबल सेट होते हैं, xcsh स्वचालित रूप से LiteLLM प्रॉक्सी के लिए `models.yml` कॉन्फ़िगरेशन प्रबंधित करता है।

### पहले-रन ऑटो-जनरेशन

यदि `models.yml` मौजूद नहीं है और LiteLLM env vars का पता चलता है, xcsh इसे स्वचालित रूप से जेनरेट करता है:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

एक डिफ़ॉल्ट `config.yml` भी उचित इमेज प्रदाता सेटिंग्स के साथ जेनरेट किया जाता है।

### स्टार्टअप सेल्फ-हीलिंग

प्रत्येक स्टार्टअप पर, मॉडल रजिस्ट्री में `startupHealthCheck()` निम्नलिखित जांच चलाता है:

| स्थिति | कार्रवाई |
|---------|----------|
| `models.yml` अनुपस्थित | env vars से ऑटो-जेनरेट |
| `models.yml` दूषित या अपार्स करने योग्य नहीं | `.bak` में बैकअप, पुनः जेनरेट |
| `baseUrl` `LITELLM_BASE_URL` से मेल नहीं खाता | `.bak` में बैकअप, नए URL के साथ पुनः जेनरेट |
| `configVersion` अनुपस्थित या पुराना | `.bak` में बैकअप, वर्तमान संस्करण के साथ पुनः जेनरेट |
| कॉन्फ़िग स्वस्थ है | कोई कार्रवाई नहीं |

सभी मरम्मत ओवरराइट करने से पहले `.bak` बैकअप बनाती हैं। सभी ऑपरेशन इडेम्पोटेंट हैं।

### CLI कमांड

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### आवश्यक एनवायरनमेंट वेरिएबल

| वेरिएबल | उद्देश्य |
|----------|----------|
| `LITELLM_BASE_URL` | LiteLLM प्रॉक्सी URL (जैसे `https://your-proxy.example.com`)। `http://` या `https://` से शुरू होना चाहिए। |
| `LITELLM_API_KEY` | प्रॉक्सी के लिए API की। जेनरेट किए गए कॉन्फ़िग में नाम से संदर्भित, रनटाइम पर रिज़ॉल्व। |

यदि कोई भी वेरिएबल सेट नहीं है, ऑटो-कॉन्फ़िगरेशन चुपचाप छोड़ दिया जाता है।

### कॉन्फ़िग वर्शनिंग

जेनरेट किए गए कॉन्फ़िग में `configVersion` फ़ील्ड शामिल होता है। जब भविष्य के रिलीज़ में जेनरेट किया गया प्रारूप बदलता है, xcsh पुराने कॉन्फ़िग का पता लगाता है और उन्हें स्वचालित रूप से अपग्रेड करता है (बैकअप के साथ)।

## लेगेसी कंज्यूमर चेतावनी

अधिकांश मॉडल कॉन्फ़िगरेशन अब `ModelRegistry` के माध्यम से `models.yml` से प्रवाहित होता है।

एक उल्लेखनीय लेगेसी पथ बचा हुआ है: वेब-सर्च Anthropic ऑथ रिज़ॉल्यूशन अभी भी `src/web/search/auth.ts` में सीधे `~/.xcsh/agent/models.json` पढ़ता है।

यदि आप उस विशिष्ट पथ पर निर्भर हैं, तो उस मॉड्यूल के माइग्रेट होने तक JSON संगतता को ध्यान में रखें।

## विफलता मोड

यदि `models.yml` स्कीमा या सत्यापन जांच में विफल होता है:

- यदि `LITELLM_BASE_URL` और `LITELLM_API_KEY` सेट हैं, स्टार्टअप स्वास्थ्य जांच ऑटो-मरम्मत का प्रयास करती है (दूषित फ़ाइल बैकअप करें, env vars से पुनः जेनरेट करें)। यदि मरम्मत सफल होती है, रजिस्ट्री ठीक किए गए कॉन्फ़िग को पुनः लोड करती है।
- यदि ऑटो-मरम्मत संभव नहीं है (env vars सेट नहीं, लिखने में विफलता), रजिस्ट्री बिल्ट-इन मॉडल के साथ संचालन जारी रखती है।
- त्रुटि `ModelRegistry.getError()` के माध्यम से प्रकट होती है और UI/नोटिफिकेशन में प्रदर्शित की जाती है।
