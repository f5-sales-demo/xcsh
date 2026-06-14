---
title: मॉडल और प्रोवाइडर कॉन्फ़िगरेशन
description: >-
  रूटिंग, फ़ॉलबैक और मूल्य निर्धारण के साथ models.yml के माध्यम से मॉडल
  रजिस्ट्री और प्रोवाइडर कॉन्फ़िगरेशन।
sidebar:
  order: 1
  label: मॉडल और प्रोवाइडर
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# मॉडल और प्रोवाइडर कॉन्फ़िगरेशन (`models.yml`)

यह दस्तावेज़ बताता है कि coding-agent वर्तमान में मॉडल कैसे लोड करता है, ओवरराइड लागू करता है, क्रेडेंशियल रिज़ॉल्व करता है, और रनटाइम पर मॉडल चुनता है।

## मॉडल व्यवहार को क्या नियंत्रित करता है

प्राथमिक कार्यान्वयन फ़ाइलें:

- `src/config/model-registry.ts` — बिल्ट-इन + कस्टम मॉडल, प्रोवाइडर ओवरराइड, रनटाइम डिस्कवरी, auth इंटीग्रेशन लोड करता है
- `src/config/model-resolver.ts` — मॉडल पैटर्न पार्स करता है और initial/smol/slow मॉडल चुनता है
- `src/config/settings-schema.ts` — मॉडल-संबंधित सेटिंग्स (`modelRoles`, प्रोवाइडर ट्रांसपोर्ट प्राथमिकताएं)
- `src/session/auth-storage.ts` — API key + OAuth रिज़ॉल्यूशन क्रम
- `packages/ai/src/models.ts` और `packages/ai/src/types.ts` — बिल्ट-इन प्रोवाइडर/मॉडल और `Model`/`compat` टाइप

## कॉन्फ़िग फ़ाइल स्थान और लेगेसी व्यवहार

डिफ़ॉल्ट कॉन्फ़िग पाथ:

- `~/.xcsh/agent/models.yml`

लेगेसी व्यवहार अभी भी मौजूद है:

- यदि `models.yml` अनुपस्थित है और उसी स्थान पर `models.json` मौजूद है, तो इसे `models.yml` में माइग्रेट किया जाता है।
- स्पष्ट `.json` / `.jsonc` कॉन्फ़िग पाथ अभी भी समर्थित हैं जब `ModelRegistry` को प्रोग्रामेटिक रूप से पास किए जाएं।

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

`configVersion` एक वैकल्पिक integer है जो auto-config सिस्टम द्वारा लिखा जाता है। जब मौजूद हो, xcsh इसका उपयोग पुराने कॉन्फ़िग का पता लगाने और उन्हें ऑटो-अपग्रेड करने के लिए करता है।

`provider-id` वह canonical प्रोवाइडर की है जो चयन और auth लुकअप में उपयोग होती है।

`equivalence` वैकल्पिक है और concrete प्रोवाइडर मॉडल के ऊपर canonical मॉडल ग्रुपिंग कॉन्फ़िगर करता है:

- `overrides` एक exact concrete selector (`provider/modelId`) को आधिकारिक upstream canonical id से मैप करता है
- `exclude` एक concrete selector को canonical ग्रुपिंग से बाहर करता है

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

## सत्यापन नियम (वर्तमान)

### पूर्ण कस्टम प्रोवाइडर (`models` non-empty है)

आवश्यक:

- `baseUrl`
- `apiKey` जब तक `auth: none` न हो
- `api` प्रोवाइडर स्तर पर या प्रत्येक मॉडल में

### केवल-ओवरराइड प्रोवाइडर (`models` अनुपस्थित या empty)

निम्न में से कम से कम एक परिभाषित होना चाहिए:

- `baseUrl`
- `modelOverrides`
- `discovery`

### डिस्कवरी

- `discovery` के लिए प्रोवाइडर-स्तरीय `api` आवश्यक है।

### मॉडल मान जांच

- `id` आवश्यक है
- `contextWindow` और `maxTokens` यदि प्रदान किए गए हों तो सकारात्मक होने चाहिए

## मर्ज और ओवरराइड क्रम

ModelRegistry पाइपलाइन (रिफ्रेश पर):

1. `@f5xc-salesdemos/pi-ai` से बिल्ट-इन प्रोवाइडर/मॉडल लोड करें।
2. `models.yml` कस्टम कॉन्फ़िग लोड करें।
3. बिल्ट-इन मॉडलों पर प्रोवाइडर ओवरराइड (`baseUrl`, `headers`) लागू करें।
4. `modelOverrides` (प्रति प्रोवाइडर + मॉडल id) लागू करें।
5. कस्टम `models` मर्ज करें:
   - समान `provider + id` मौजूदा को बदलता है
   - अन्यथा जोड़ें
6. रनटाइम-डिस्कवर्ड मॉडल (वर्तमान में Ollama और LM Studio) लागू करें, फिर मॉडल ओवरराइड पुनः लागू करें।

## Canonical मॉडल समतुल्यता और कोलेसिंग

रजिस्ट्री हर concrete प्रोवाइडर मॉडल को रखती है और फिर उनके ऊपर एक canonical लेयर बनाती है।

Canonical ids केवल आधिकारिक upstream ids हैं, उदाहरण के लिए:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` equivalence कॉन्फ़िग

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

Canonical ग्रुपिंग के लिए बिल्ड क्रम:

1. `equivalence.overrides` से exact यूज़र ओवरराइड
2. बिल्ट-इन मॉडल मेटाडेटा से बंडल्ड official-id मिलान
3. gateway/provider वेरिएंट के लिए conservative heuristic normalization
4. concrete मॉडल की अपनी id पर फ़ॉलबैक

वर्तमान heuristics जानबूझकर संकीर्ण हैं:

- एम्बेडेड upstream प्रीफ़िक्स जब मौजूद हों तो हटाए जा सकते हैं, उदाहरण के लिए `anthropic/...` या `openai/...`
- डॉटेड और डैश्ड वर्शन वेरिएंट केवल तब normalize हो सकते हैं जब वे किसी मौजूदा official id से मैप होते हों, उदाहरण के लिए `4.6 -> 4-6`
- अस्पष्ट families या versions को बंडल्ड मिलान या explicit ओवरराइड के बिना मर्ज नहीं किया जाता

### Canonical रिज़ॉल्यूशन व्यवहार

जब कई concrete वेरिएंट एक canonical id साझा करते हैं, तो रिज़ॉल्यूशन उपयोग करता है:

1. उपलब्धता और auth
2. `config.yml` `modelProviderOrder`
3. यदि `modelProviderOrder` अनसेट है तो मौजूदा रजिस्ट्री/प्रोवाइडर क्रम

अक्षम या अनअथेंटिकेटेड प्रोवाइडर को छोड़ दिया जाता है।

सेशन स्थिति और ट्रांसक्रिप्ट concrete प्रोवाइडर/मॉडल को रिकॉर्ड करते रहते हैं जिसने वास्तव में टर्न निष्पादित किया।

प्रोवाइडर डिफ़ॉल्ट बनाम प्रति-मॉडल ओवरराइड:

- प्रोवाइडर `headers` बेसलाइन हैं।
- मॉडल `headers` प्रोवाइडर हेडर की को ओवरराइड करते हैं।
- `modelOverrides` मॉडल मेटाडेटा (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`) ओवरराइड कर सकते हैं।
- `compat` nested रूटिंग ब्लॉक (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`) के लिए deep-merged होता है।

## रनटाइम डिस्कवरी इंटीग्रेशन

### Implicit Ollama डिस्कवरी

यदि `ollama` स्पष्ट रूप से कॉन्फ़िगर नहीं है, तो रजिस्ट्री एक implicit discoverable प्रोवाइडर जोड़ती है:

- प्रोवाइडर: `ollama`
- api: `openai-completions`
- बेस URL: `OLLAMA_BASE_URL` या `http://127.0.0.1:11434`
- auth मोड: keyless (`auth: none` व्यवहार)

रनटाइम डिस्कवरी Ollama पर `GET /api/tags` कॉल करती है और local डिफ़ॉल्ट के साथ मॉडल एंट्री synthesize करती है।

### Implicit llama.cpp डिस्कवरी

यदि `llama.cpp` स्पष्ट रूप से कॉन्फ़िगर नहीं है, तो रजिस्ट्री एक implicit discoverable प्रोवाइडर जोड़ती है:
नोट: यह openai-completions के बजाय नई anthropic messages api का उपयोग कर रहा है।

- प्रोवाइडर: `llama.cpp`
- api: `openai-responses`
- बेस URL: `LLAMA_CPP_BASE_URL` या `http://127.0.0.1:8080`
- auth मोड: keyless (`auth: none` व्यवहार)

रनटाइम डिस्कवरी llama.cpp पर `GET models` कॉल करती है और local डिफ़ॉल्ट के साथ मॉडल एंट्री synthesize करती है।

### Implicit LM Studio डिस्कवरी

यदि `lm-studio` स्पष्ट रूप से कॉन्फ़िगर नहीं है, तो रजिस्ट्री एक implicit discoverable प्रोवाइडर जोड़ती है:

- प्रोवाइडर: `lm-studio`
- api: `openai-completions`
- बेस URL: `LM_STUDIO_BASE_URL` या `http://127.0.0.1:1234/v1`
- auth मोड: keyless (`auth: none` व्यवहार)

रनटाइम डिस्कवरी मॉडल फ़ेच करती है (`GET /models`) और local डिफ़ॉल्ट के साथ मॉडल एंट्री synthesize करती है।

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

### एक्सटेंशन प्रोवाइडर पंजीकरण

एक्सटेंशन रनटाइम पर प्रोवाइडर रजिस्टर कर सकते हैं (`pi.registerProvider(...)`), जिनमें शामिल हैं:

- किसी प्रोवाइडर के लिए मॉडल प्रतिस्थापन/जोड़
- नए API IDs के लिए कस्टम स्ट्रीम हैंडलर पंजीकरण
- कस्टम OAuth प्रोवाइडर पंजीकरण

## Auth और API key रिज़ॉल्यूशन क्रम

किसी प्रोवाइडर के लिए key अनुरोध करते समय, प्रभावी क्रम है:

1. रनटाइम ओवरराइड (CLI `--api-key`)
2. `agent.db` में स्टोर्ड API key क्रेडेंशियल
3. `agent.db` में स्टोर्ड OAuth क्रेडेंशियल (रिफ्रेश के साथ)
4. एनवायरनमेंट वेरिएबल मैपिंग (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, आदि)
5. ModelRegistry फ़ॉलबैक रिज़ॉल्वर (प्रोवाइडर `apiKey` `models.yml` से, env-name-or-literal semantics)

`models.yml` `apiKey` व्यवहार:

- मान को पहले एनवायरनमेंट वेरिएबल नाम के रूप में ट्रीट किया जाता है।
- यदि कोई env var मौजूद नहीं है, तो literal string को टोकन के रूप में उपयोग किया जाता है।

यदि `authHeader: true` और प्रोवाइडर `apiKey` सेट है, तो मॉडलों को मिलता है:

- `Authorization: Bearer <resolved-key>` हेडर इंजेक्ट।

Keyless प्रोवाइडर:

- `auth: none` चिह्नित प्रोवाइडर को बिना क्रेडेंशियल के उपलब्ध माना जाता है।
- `getApiKey*` उनके लिए `kNoAuth` लौटाता है।

## मॉडल उपलब्धता बनाम सभी मॉडल

- `getAll()` लोडेड मॉडल रजिस्ट्री (बिल्ट-इन + मर्ज्ड कस्टम + डिस्कवर्ड) लौटाता है।
- `getAvailable()` उन मॉडलों तक फ़िल्टर करता है जो keyless हैं या जिनका auth रिज़ॉल्व हो सकता है।

इसलिए एक मॉडल रजिस्ट्री में मौजूद हो सकता है लेकिन auth उपलब्ध होने तक चयन योग्य नहीं होगा।

## रनटाइम मॉडल रिज़ॉल्यूशन

### CLI और पैटर्न पार्सिंग

`model-resolver.ts` समर्थन करता है:

- exact `provider/modelId`
- exact canonical मॉडल id
- exact मॉडल id (प्रोवाइडर अनुमानित)
- fuzzy/substring मिलान
- `--models` में glob स्कोप पैटर्न (जैसे `openai/*`, `*sonnet*`)
- वैकल्पिक `:thinkingLevel` suffix (`off|minimal|low|medium|high|xhigh`)

`--provider` लेगेसी है; `--model` प्राथमिक है।

Exact selectors के लिए रिज़ॉल्यूशन प्राथमिकता:

1. exact `provider/modelId` coalescing को bypass करता है
2. exact canonical id canonical इंडेक्स के माध्यम से रिज़ॉल्व होता है
3. exact bare concrete id अभी भी काम करता है
4. fuzzy और glob मिलान exact पाथ के बाद चलते हैं

### Initial मॉडल चयन प्राथमिकता

`findInitialModel(...)` इस क्रम का उपयोग करता है:

1. explicit CLI provider+model
2. पहला scoped मॉडल (यदि resume नहीं हो रहा)
3. सेव्ड डिफ़ॉल्ट provider/model
4. उपलब्ध मॉडलों में ज्ञात प्रोवाइडर डिफ़ॉल्ट (जैसे OpenAI/Anthropic/आदि)
5. पहला उपलब्ध मॉडल

### Role aliases और सेटिंग्स

समर्थित मॉडल roles:

- `default`, `smol`, `slow`, `plan`, `commit`

`pi/smol` जैसे Role aliases `settings.modelRoles` के माध्यम से expand होते हैं। प्रत्येक role मान `:minimal`, `:low`, `:medium`, या `:high` जैसा thinking selector भी जोड़ सकता है।

यदि कोई role किसी अन्य role की ओर इंगित करता है, तो लक्ष्य मॉडल सामान्य रूप से inherit करता है और referring role पर कोई explicit suffix उस role-specific उपयोग के लिए जीतता है।

संबंधित सेटिंग्स:

- `modelRoles` (record)
- `enabledModels` (scoped pattern list)
- `modelProviderOrder` (global canonical-provider precedence)
- `providers.kimiApiFormat` (`openai` या `anthropic` request format)
- `providers.openaiWebsockets` (OpenAI Codex transport के लिए `auto|off|on` websocket प्राथमिकता)

`modelRoles` निम्न में से कोई एक स्टोर कर सकता है:

- `provider/modelId` किसी concrete प्रोवाइडर वेरिएंट को पिन करने के लिए
- `gpt-5.3-codex` जैसी canonical id जो provider coalescing की अनुमति देती है

`enabledModels` और CLI `--models` के लिए:

- exact canonical ids उस canonical समूह में सभी concrete वेरिएंट तक expand होती हैं
- explicit `provider/modelId` एंट्री exact रहती हैं
- globs और fuzzy मिलान अभी भी concrete मॉडलों पर काम करते हैं

## `/model` और `--list-models`

दोनों सतहें provider-prefixed मॉडलों को दृश्यमान और चयन योग्य रखती हैं।

अब वे canonical/coalesced मॉडलों को भी expose करती हैं:

- `/model` प्रोवाइडर tabs के साथ canonical दृश्य शामिल करता है
- `--list-models` concrete प्रोवाइडर rows के साथ एक canonical section प्रिंट करता है

Canonical एंट्री चुनने पर canonical selector स्टोर होता है। प्रोवाइडर row चुनने पर explicit `provider/modelId` स्टोर होता है।

## Context promotion (मॉडल-स्तरीय फ़ॉलबैक चेन)

Context promotion छोटे-context वेरिएंट (उदाहरण के लिए `*-spark`) के लिए एक overflow recovery mechanism है जो स्वचालित रूप से एक बड़े-context sibling पर promote करता है जब API context length error के साथ request reject करता है।

### ट्रिगर और क्रम

जब कोई टर्न context overflow error (जैसे `context_length_exceeded`) के साथ विफल होता है, `AgentSession` compaction से पहले promotion का प्रयास करता है **पहले**:

1. यदि `contextPromotion.enabled` true है, तो promotion target रिज़ॉल्व करें (नीचे देखें)।
2. यदि target मिलता है, उस पर switch करें और request retry करें — कोई compaction की आवश्यकता नहीं।
3. यदि कोई target उपलब्ध नहीं है, तो current मॉडल पर auto-compaction पर fall through करें।

### Target चयन

चयन मॉडल-driven है, role-driven नहीं:

1. `currentModel.contextPromotionTarget` (यदि कॉन्फ़िगर किया गया हो)
2. समान प्रोवाइडर + API पर सबसे छोटा बड़े-context वाला मॉडल

उम्मीदवारों को नज़रअंदाज़ किया जाता है जब तक क्रेडेंशियल रिज़ॉल्व न हों (`ModelRegistry.getApiKey(...)`)।

### OpenAI Codex websocket handoff

यदि `openai-codex-responses` से/से switch हो रहा है, तो मॉडल switch से पहले session provider state key `openai-codex-responses` बंद हो जाती है। यह websocket transport state को drop करता है ताकि अगला टर्न promoted मॉडल पर clean शुरू हो।

### Persistence व्यवहार

Promotion temporary switching (`setModelTemporary`) का उपयोग करता है:

- session history में temporary `model_change` के रूप में रिकॉर्ड
- सेव्ड role mapping को पुनर्लेखित नहीं करता

### Explicit फ़ॉलबैक चेन कॉन्फ़िगर करना

`contextPromotionTarget` के माध्यम से मॉडल मेटाडेटा में सीधे फ़ॉलबैक कॉन्फ़िगर करें।

`contextPromotionTarget` निम्न में से कोई एक स्वीकार करता है:

- `provider/model-id` (explicit)
- `model-id` (current प्रोवाइडर के भीतर रिज़ॉल्व)

उदाहरण (`models.yml`) समान प्रोवाइडर पर Spark -> non-Spark के लिए:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

बिल्ट-इन मॉडल generator `*-spark` मॉडलों के लिए इसे स्वचालित रूप से तब assign करता है जब same-provider base मॉडल मौजूद हो।

## Compatibility और routing फ़ील्ड

`models.yml` यह `compat` subset समर्थन करता है:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` या `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

इन्हें OpenAI-completions transport logic द्वारा उपभोग किया जाता है और URL-based auto-detection के साथ संयुक्त किया जाता है।

## व्यावहारिक उदाहरण

### Local OpenAI-compatible endpoint (बिना auth)

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

### Env-based key के साथ hosted proxy

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

### बिल्ट-इन प्रोवाइडर route + मॉडल मेटाडेटा ओवरराइड

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

## LiteLLM proxy ऑटो-कॉन्फ़िगरेशन

जब `LITELLM_BASE_URL` और `LITELLM_API_KEY` दोनों एनवायरनमेंट वेरिएबल सेट हों, xcsh LiteLLM proxy के लिए `models.yml` कॉन्फ़िगरेशन स्वचालित रूप से प्रबंधित करता है।

### पहली-बार ऑटो-जनरेशन

यदि `models.yml` मौजूद नहीं है और LiteLLM env vars का पता चलता है, xcsh इसे स्वचालित रूप से generate करता है:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

एक डिफ़ॉल्ट `config.yml` भी sensible image provider settings के साथ generate होता है।

### Startup self-healing

हर startup पर, model registry में `startupHealthCheck()` निम्न जांचें चलाता है:

| शर्त | कार्रवाई |
|-----------|--------|
| `models.yml` अनुपस्थित | env vars से ऑटो-generate करें |
| `models.yml` corrupt या parse न हो सके | `.bak` पर backup, regenerate |
| `baseUrl` `LITELLM_BASE_URL` से मेल नहीं खाता | `.bak` पर backup, नए URL के साथ regenerate |
| `configVersion` अनुपस्थित या पुराना | `.bak` पर backup, current version के साथ regenerate |
| कॉन्फ़िग healthy है | कोई कार्रवाई नहीं |

सभी मरम्मत ओवरराइट से पहले `.bak` backup बनाते हैं। सभी ऑपरेशन idempotent हैं।

### CLI कमांड

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### आवश्यक एनवायरनमेंट वेरिएबल

| वेरिएबल | उद्देश्य |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM proxy URL (जैसे `https://your-proxy.example.com`)। `http://` या `https://` से शुरू होना चाहिए। |
| `LITELLM_API_KEY` | proxy के लिए API key। generated config में नाम से referenced, रनटाइम पर रिज़ॉल्व। |

यदि कोई भी वेरिएबल unset है, तो ऑटो-कॉन्फ़िगरेशन silently skip हो जाता है।

### कॉन्फ़िग versioning

Generated configs में `configVersion` फ़ील्ड शामिल होता है। जब भविष्य के releases में generated format बदलता है, xcsh पुराने configs का पता लगाता है और उन्हें स्वचालित रूप से upgrade करता है (backup के साथ)।

## लेगेसी consumer सावधानी

अधिकांश मॉडल कॉन्फ़िगरेशन अब `ModelRegistry` के माध्यम से `models.yml` से होकर जाता है।

एक उल्लेखनीय लेगेसी पाथ बना हुआ है: web-search Anthropic auth resolution अभी भी `src/web/search/auth.ts` में सीधे `~/.xcsh/agent/models.json` पढ़ता है।

यदि आप उस specific पाथ पर निर्भर हैं, तो JSON compatibility को ध्यान में रखें जब तक वह module माइग्रेट नहीं हो जाता।

## विफलता मोड

यदि `models.yml` schema या validation जांच में विफल होता है:

- यदि `LITELLM_BASE_URL` और `LITELLM_API_KEY` सेट हैं, तो startup health check ऑटो-मरम्मत का प्रयास करता है (corrupt फ़ाइल backup करें, env vars से regenerate करें)। यदि मरम्मत सफल हो, तो रजिस्ट्री fixed config को reload करती है।
- यदि ऑटो-मरम्मत संभव नहीं है (env vars unset, write विफलता), तो रजिस्ट्री बिल्ट-इन मॉडलों के साथ काम करती रहती है।
- Error `ModelRegistry.getError()` के माध्यम से expose होती है और UI/notifications में दिखाई जाती है।
