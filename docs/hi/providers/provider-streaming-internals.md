---
title: प्रोवाइडर स्ट्रीमिंग आंतरिक संरचना
description: >-
  SSE पार्सिंग, टोकन काउंटिंग और बैकप्रेशर हैंडलिंग के साथ प्रोवाइडर स्ट्रीमिंग
  कार्यान्वयन।
sidebar:
  order: 2
  label: स्ट्रीमिंग आंतरिक संरचना
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# प्रोवाइडर स्ट्रीमिंग आंतरिक संरचना

यह दस्तावेज़ बताता है कि `@f5xc-salesdemos/pi-ai` में टोकन/टूल स्ट्रीमिंग को कैसे सामान्यीकृत किया जाता है, फिर `@f5xc-salesdemos/pi-agent-core` और `coding-agent` सत्र इवेंट्स के माध्यम से कैसे प्रसारित किया जाता है।

## एंड-टू-एंड प्रवाह

1. `streamSimple()` (`packages/ai/src/stream.ts`) सामान्य विकल्पों को मैप करता है और किसी प्रोवाइडर स्ट्रीम फ़ंक्शन को डिस्पैच करता है।
2. प्रोवाइडर स्ट्रीम फ़ंक्शन (`anthropic.ts`, `openai-responses.ts`, `google.ts`) प्रोवाइडर-नेटिव स्ट्रीम इवेंट्स को एकीकृत `AssistantMessageEvent` अनुक्रम में रूपांतरित करते हैं।
3. प्रत्येक प्रोवाइडर `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) में इवेंट्स पुश करता है, जो डेल्टा इवेंट्स को थ्रॉटल करता है और निम्नलिखित उजागर करता है:
   - वृद्धिशील अपडेट के लिए async पुनरावृत्ति
   - अंतिम `AssistantMessage` के लिए `result()`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) उन इवेंट्स का उपभोग करता है, इन-फ़्लाइट असिस्टेंट स्थिति को संशोधित करता है, और कच्चे `assistantMessageEvent` वहन करने वाले `message_update` इवेंट्स उत्सर्जित करता है।
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) एजेंट इवेंट्स की सदस्यता लेता है, संदेशों को संग्रहीत करता है, एक्सटेंशन हुक्स चलाता है, और सत्र व्यवहार लागू करता है (retry, compaction, TTSR, streaming-edit abort जाँच)।

## `@f5xc-salesdemos/pi-ai` में एकीकृत स्ट्रीम अनुबंध

सभी प्रोवाइडर एक ही आकार उत्सर्जित करते हैं (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- कंटेंट ब्लॉक लाइफसाइकिल ट्रिपलेट्स:
  - टेक्स्ट: `text_start` → `text_delta`* → `text_end`
  - थिंकिंग: `thinking_start` → `thinking_delta`* → `thinking_end`
  - टूल कॉल: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- टर्मिनल इवेंट:
  - `done` with `reason: "stop" | "length" | "toolUse"`
  - या `error` with `reason: "aborted" | "error"`

`AssistantMessageEventStream` की गारंटी:

- अंतिम परिणाम टर्मिनल इवेंट (`done` या `error`) द्वारा हल किया जाता है
- डेल्टा को बैच/थ्रॉटल किया जाता है (~50ms)
- बफर्ड डेल्टा को नॉन-डेल्टा इवेंट्स से पहले और पूर्णता से पहले फ्लश किया जाता है

## डेल्टा थ्रॉटलिंग और हार्मोनाइज़ेशन व्यवहार

`AssistantMessageEventStream` `text_delta`, `thinking_delta`, और `toolcall_delta` को विलयनीय इवेंट्स मानता है:

- बफर्ड डेल्टा केवल तभी विलीन होते हैं जब **type + contentIndex** मेल खाएं
- विलय नवीनतम `partial` स्नैपशॉट रखता है
- नॉन-डेल्टा इवेंट्स तत्काल फ्लश को बाध्य करते हैं

यह TUI/इवेंट उपभोक्ताओं के लिए उच्च-आवृत्ति प्रोवाइडर स्ट्रीम को सुचारू बनाता है, लेकिन यह प्रोवाइडर बैकप्रेशर नहीं है: प्रोवाइडर अभी भी पूरी गति से उत्पादन करते हैं, जबकि स्थानीय स्ट्रीम बफर करती है।

## प्रोवाइडर सामान्यीकरण विवरण

## Anthropic (`anthropic-messages`)

स्रोत: `packages/ai/src/providers/anthropic.ts`

सामान्यीकरण बिंदु:

- `message_start` उपयोग (input/output/cache टोकन) को प्रारंभ करता है
- `content_block_start` text/thinking/toolcall स्टार्ट्स पर मैप होता है
- `content_block_delta` मैप करता है:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` केवल `thinkingSignature` अपडेट करता है (कोई इवेंट नहीं)
- `content_block_stop` संबंधित `*_end` उत्सर्जित करता है
- `message_delta.stop_reason` को `mapStopReason()` के माध्यम से मैप किया जाता है

टूल-कॉल आर्गुमेंट स्ट्रीमिंग:

- प्रत्येक टूल ब्लॉक में आंतरिक `partialJson` होता है
- प्रत्येक JSON डेल्टा `partialJson` में जोड़ा जाता है
- `arguments` को प्रत्येक डेल्टा पर `parseStreamingJson()` के माध्यम से पुनः पार्स किया जाता है
- `toolcall_end` एक बार और पार्स करता है, फिर `partialJson` हटाता है

## OpenAI Responses (`openai-responses`)

स्रोत: `packages/ai/src/providers/openai-responses.ts`

सामान्यीकरण बिंदु:

- `response.output_item.added` reasoning/text/function-call ब्लॉक शुरू करता है
- reasoning summary इवेंट्स (`response.reasoning_summary_text.delta`) `thinking_delta` बनते हैं
- output/refusal डेल्टा `text_delta` बनते हैं
- `response.function_call_arguments.delta` `toolcall_delta` बनता है
- `response.output_item.done` `thinking_end` / `text_end` / `toolcall_end` उत्सर्जित करता है
- `response.completed` स्टेटस को stop reason और usage पर मैप करता है

टूल-कॉल आर्गुमेंट स्ट्रीमिंग:

- Anthropic जैसा ही `partialJson` संचय पैटर्न
- ऐसे प्रोवाइडर जो केवल `response.function_call_arguments.done` भेजते हैं, अंतिम args को फिर भी पॉप्युलेट करते हैं
- टूल कॉल IDs को `"<call_id>|<item_id>"` के रूप में सामान्यीकृत किया जाता है

## Google Generative AI (`google-generative-ai`)

स्रोत: `packages/ai/src/providers/google.ts`

सामान्यीकरण बिंदु:

- `candidate.content.parts` को इटरेट करता है
- टेक्स्ट पार्ट्स को `isThinkingPart(part)` द्वारा thinking बनाम text में विभाजित किया जाता है
- ब्लॉक ट्रांजिशन नया ब्लॉक शुरू करने से पहले पिछले को बंद करते हैं
- `part.functionCall` को एक पूर्ण टूल कॉल माना जाता है (start/delta/end तुरंत उत्सर्जित)
- finish reason को `google-shared.ts` से `mapStopReason()` द्वारा मैप किया जाता है

टूल-कॉल आर्गुमेंट स्ट्रीमिंग:

- function call args संरचित ऑब्जेक्ट के रूप में आते हैं, न कि वृद्धिशील JSON टेक्स्ट के रूप में
- कार्यान्वयन `JSON.stringify(arguments)` युक्त एक सिंथेटिक `toolcall_delta` उत्सर्जित करता है
- इस पथ में Google के लिए partial JSON पार्सर की आवश्यकता नहीं है

## आंशिक टूल-कॉल JSON संचय और पुनर्प्राप्ति

Anthropic/OpenAI Responses के लिए साझा व्यवहार `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`) का उपयोग करता है:

1. `JSON.parse` का प्रयास
2. अधूरे खंडों के लिए `partial-json` पार्सर पर फ़ॉलबैक
3. यदि दोनों विफल हों, तो `{}` लौटाएं

निहितार्थ:

- खराब या काटे गए आर्गुमेंट डेल्टा स्ट्रीम प्रोसेसिंग को तुरंत क्रैश नहीं करते
- प्रगतिशील `arguments` अस्थायी रूप से `{}` हो सकते हैं
- बाद के वैध डेल्टा संरचित आर्गुमेंट पुनर्प्राप्त कर सकते हैं क्योंकि प्रत्येक append पर पार्सिंग पुनः प्रयास होता है
- अंतिम `toolcall_end` उत्सर्जन से पहले एक और पार्स प्रयास करता है

## Stop Reasons बनाम ट्रांसपोर्ट/रनटाइम त्रुटियां

प्रोवाइडर stop reasons को सामान्यीकृत `stopReason` पर मैप किया जाता है:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, safety/refusal cases→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, safety/prohibited/malformed-function-call classes→`error`

त्रुटि सेमेंटिक्स दो चरणों में विभाजित हैं:

1. **मॉडल कम्पलीशन सेमेंटिक्स** (प्रोवाइडर द्वारा रिपोर्ट किया गया finish reason/status)
2. **ट्रांसपोर्ट/रनटाइम विफलता** (नेटवर्क/क्लाइंट/पार्सर/abort अपवाद)

यदि प्रोवाइडर स्ट्रीम थ्रो करता है या विफलता का संकेत देता है, तो प्रत्येक प्रोवाइडर रैपर पकड़ता है और टर्मिनल `error` इवेंट उत्सर्जित करता है:

- `stopReason = "aborted"` जब abort सिग्नल सेट हो
- अन्यथा `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## खराब चंक / SSE पार्स विफलता व्यवहार

इन प्रोवाइडर पथों के लिए, चंक/SSE फ्रेमिंग वेंडर SDK स्ट्रीम (Anthropic SDK, OpenAI SDK, Google SDK) द्वारा संभाली जाती है। यह कोड यहाँ कस्टम SSE डिकोडर कार्यान्वित नहीं करता।

वर्तमान कार्यान्वयन में अवलोकित व्यवहार:

- SDK स्तर पर खराब चंक/SSE पार्सिंग एक अपवाद या स्ट्रीम `error` इवेंट के रूप में सामने आती है
- प्रोवाइडर रैपर इसे एकीकृत टर्मिनल `error` इवेंट में बदलता है
- स्ट्रीम फ़ंक्शन के अंदर कोई प्रोवाइडर-विशिष्ट resume/retry नहीं
- उच्च-स्तरीय retries `AgentSession` auto-retry लॉजिक में संभाले जाते हैं (संदेश-स्तर retry, स्ट्रीम-चंक रिप्ले नहीं)

## रद्दीकरण सीमाएं

रद्दीकरण स्तरबद्ध है:

- AI प्रोवाइडर अनुरोध: `options.signal` को प्रोवाइडर क्लाइंट स्ट्रीम कॉल में पास किया जाता है।
- प्रोवाइडर रैपर: स्ट्रीम लूप के बाद, aborted सिग्नल error पथ (`"Request was aborted"`) को बाध्य करता है।
- एजेंट लूप: प्रत्येक प्रोवाइडर इवेंट को संभालने से पहले `signal.aborted` जाँचता है और नवीनतम partial से aborted असिस्टेंट संदेश संश्लेषित कर सकता है।
- Session/agent नियंत्रण: `AgentSession.abort()` -> `agent.abort()` -> साझा abort controller रद्दीकरण।

टूल execution रद्दीकरण मॉडल स्ट्रीम रद्दीकरण से अलग है:

- टूल रनर `AbortSignal.any([agentSignal, steeringAbortSignal])` का उपयोग करते हैं
- steering interrupts पहले से उत्पादित टूल परिणामों को संरक्षित करते हुए शेष टूल execution को abort कर सकते हैं

## बैकप्रेशर सीमाएं

प्रोवाइडर SDK स्ट्रीम और डाउनस्ट्रीम उपभोक्ताओं के बीच कोई कठोर बैकप्रेशर तंत्र नहीं है:

- `EventStream` बिना अधिकतम आकार के इन-मेमोरी कतारों का उपयोग करता है
- थ्रॉटलिंग UI अपडेट दर कम करता है लेकिन प्रोवाइडर इनटेक को धीमा नहीं करता
- यदि उपभोक्ता काफी पीछे हों, तो कतारबद्ध इवेंट्स पूर्णता तक बढ़ सकते हैं

वर्तमान डिज़ाइन bounded-buffer flow control पर जवाबदेही और सरल क्रमण को प्राथमिकता देता है।

## स्ट्रीम इवेंट्स एजेंट/सत्र इवेंट्स के रूप में कैसे सामने आते हैं

`agentLoop.streamAssistantResponse()` `AssistantMessageEvent` को `AgentEvent` से जोड़ता है:

- `start` पर: placeholder असिस्टेंट संदेश पुश करता है और `message_start` उत्सर्जित करता है
- ब्लॉक इवेंट्स पर (`text_*`, `thinking_*`, `toolcall_*`): अंतिम असिस्टेंट संदेश अपडेट करता है, कच्चे `assistantMessageEvent` के साथ `message_update` उत्सर्जित करता है
- टर्मिनल पर (`done`/`error`): `response.result()` से अंतिम संदेश हल करता है, `message_end` उत्सर्जित करता है

`AgentSession` फिर सत्र-स्तरीय व्यवहारों के लिए उन इवेंट्स का उपभोग करता है:

- TTSR `text_delta` और `toolcall_delta` के लिए `message_update.assistantMessageEvent` देखता है
- streaming edit guard `edit` कॉल पर `toolcall_delta`/`toolcall_end` की जाँच करता है और जल्दी abort कर सकता है
- persistence `message_end` पर अंतिम संदेश लिखता है
- auto-retry असिस्टेंट `stopReason === "error"` और `errorMessage` heuristics की जाँच करता है

## एकीकृत बनाम प्रोवाइडर-विशिष्ट जिम्मेदारियां

एकीकृत (सामान्य अनुबंध):

- इवेंट आकार (`AssistantMessageEvent`)
- अंतिम परिणाम निष्कर्षण (`done`/`error`)
- डेल्टा थ्रॉटलिंग + विलय नियम
- एजेंट/सत्र इवेंट प्रसार मॉडल

प्रोवाइडर-विशिष्ट (पूरी तरह अमूर्त नहीं):

- upstream इवेंट वर्गीकरण और मैपिंग लॉजिक
- stop-reason अनुवाद तालिकाएं
- टूल-कॉल ID परंपराएं
- reasoning/thinking ब्लॉक सेमेंटिक्स और signatures
- usage टोकन सेमेंटिक्स और उपलब्धता समय
- प्रति API संदेश रूपांतरण बाधाएं

## कार्यान्वयन फ़ाइलें

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — प्रोवाइडर dispatch, option mapping, API key/session plumbing।
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — सामान्य स्ट्रीम कतार + असिस्टेंट डेल्टा थ्रॉटलिंग।
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — स्ट्रीम किए गए टूल आर्गुमेंट के लिए partial JSON पार्सिंग।
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic इवेंट अनुवाद और टूल JSON डेल्टा संचय।
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses इवेंट अनुवाद और status mapping।
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini स्ट्रीम chunk-to-block अनुवाद।
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini finish-reason mapping और साझा रूपांतरण नियम।
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — प्रोवाइडर स्ट्रीम उपभोग और `message_update` ब्रिजिंग।
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — स्ट्रीमिंग अपडेट, abort, retry और persistence का सत्र-स्तरीय प्रबंधन।
