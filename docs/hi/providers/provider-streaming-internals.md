---
title: Provider Streaming Internals
description: >-
  SSE पार्सिंग, टोकन काउंटिंग, और बैकप्रेशर हैंडलिंग के साथ प्रोवाइडर स्ट्रीमिंग
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

1. `streamSimple()` (`packages/ai/src/stream.ts`) सामान्य विकल्पों को मैप करता है और एक प्रोवाइडर स्ट्रीम फ़ंक्शन को डिस्पैच करता है।
2. प्रोवाइडर स्ट्रीम फ़ंक्शन (`anthropic.ts`, `openai-responses.ts`, `google.ts`) प्रोवाइडर-नेटिव स्ट्रीम इवेंट्स को एकीकृत `AssistantMessageEvent` अनुक्रम में अनुवादित करते हैं।
3. प्रत्येक प्रोवाइडर `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) में इवेंट्स पुश करता है, जो डेल्टा इवेंट्स को थ्रॉटल करता है और निम्नलिखित उपलब्ध कराता है:
   - क्रमिक अपडेट्स के लिए async इटरेशन
   - अंतिम `AssistantMessage` के लिए `result()`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) उन इवेंट्स का उपभोग करता है, इन-फ्लाइट असिस्टेंट स्थिति को म्यूटेट करता है, और कच्चे `assistantMessageEvent` को ले जाने वाले `message_update` इवेंट्स उत्सर्जित करता है।
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) एजेंट इवेंट्स की सदस्यता लेता है, संदेशों को स्थायी रूप से संग्रहित करता है, एक्सटेंशन हुक्स चलाता है, और सत्र व्यवहारों (पुनः प्रयास, संक्षेपण, TTSR, स्ट्रीमिंग-एडिट एबॉर्ट जाँच) को लागू करता है।

## `@f5xc-salesdemos/pi-ai` में एकीकृत स्ट्रीम अनुबंध

सभी प्रोवाइडर समान आकृति उत्सर्जित करते हैं (`AssistantMessageEvent` `packages/ai/src/types.ts` में):

- `start`
- कंटेंट ब्लॉक जीवनचक्र त्रिक:
  - टेक्स्ट: `text_start` → `text_delta`* → `text_end`
  - थिंकिंग: `thinking_start` → `thinking_delta`* → `thinking_end`
  - टूल कॉल: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- टर्मिनल इवेंट:
  - `done` जिसमें `reason: "stop" | "length" | "toolUse"`
  - या `error` जिसमें `reason: "aborted" | "error"`

`AssistantMessageEventStream` गारंटी देता है:

- अंतिम परिणाम टर्मिनल इवेंट (`done` या `error`) द्वारा रिज़ॉल्व होता है
- डेल्टा बैच/थ्रॉटल किए जाते हैं (~50ms)
- बफ़र किए गए डेल्टा नॉन-डेल्टा इवेंट्स से पहले और पूर्णता से पहले फ्लश किए जाते हैं

## डेल्टा थ्रॉटलिंग और सामंजस्य व्यवहार

`AssistantMessageEventStream` `text_delta`, `thinking_delta`, और `toolcall_delta` को मर्ज करने योग्य इवेंट्स के रूप में मानता है:

- बफ़र किए गए डेल्टा केवल तभी मर्ज होते हैं जब **type + contentIndex** मेल खाते हैं
- मर्ज नवीनतम `partial` स्नैपशॉट रखता है
- नॉन-डेल्टा इवेंट्स तत्काल फ्लश को बाध्य करते हैं

यह TUI/इवेंट उपभोक्ताओं के लिए उच्च-आवृत्ति प्रोवाइडर स्ट्रीम्स को सुचारू बनाता है, लेकिन यह प्रोवाइडर बैकप्रेशर नहीं है: प्रोवाइडर अभी भी पूरी गति से उत्पादन करते हैं, जबकि स्थानीय स्ट्रीम बफ़र करती है।

## प्रोवाइडर सामान्यीकरण विवरण

## Anthropic (`anthropic-messages`)

स्रोत: `packages/ai/src/providers/anthropic.ts`

सामान्यीकरण बिंदु:

- `message_start` उपयोग को आरंभ करता है (इनपुट/आउटपुट/कैश टोकन)
- `content_block_start` टेक्स्ट/थिंकिंग/टूलकॉल स्टार्ट्स में मैप होता है
- `content_block_delta` मैप करता है:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` केवल `thinkingSignature` अपडेट करता है (कोई इवेंट नहीं)
- `content_block_stop` संबंधित `*_end` उत्सर्जित करता है
- `message_delta.stop_reason` `mapStopReason()` के माध्यम से मैप होता है

टूल-कॉल आर्गुमेंट स्ट्रीमिंग:

- प्रत्येक टूल ब्लॉक आंतरिक `partialJson` रखता है
- प्रत्येक JSON डेल्टा `partialJson` में जुड़ता है
- `arguments` प्रत्येक डेल्टा पर `parseStreamingJson()` के माध्यम से पुनः पार्स किए जाते हैं
- `toolcall_end` एक बार और पार्स करता है, फिर `partialJson` हटा देता है

## OpenAI Responses (`openai-responses`)

स्रोत: `packages/ai/src/providers/openai-responses.ts`

सामान्यीकरण बिंदु:

- `response.output_item.added` रीज़निंग/टेक्स्ट/फ़ंक्शन-कॉल ब्लॉक शुरू करता है
- रीज़निंग सारांश इवेंट्स (`response.reasoning_summary_text.delta`) `thinking_delta` बनते हैं
- आउटपुट/रिफ्यूज़ल डेल्टा `text_delta` बनते हैं
- `response.function_call_arguments.delta` `toolcall_delta` बनता है
- `response.output_item.done` `thinking_end` / `text_end` / `toolcall_end` उत्सर्जित करता है
- `response.completed` स्टेटस को स्टॉप रीज़न और उपयोग में मैप करता है

टूल-कॉल आर्गुमेंट स्ट्रीमिंग:

- Anthropic के समान `partialJson` संचय पैटर्न
- जो प्रोवाइडर केवल `response.function_call_arguments.done` भेजते हैं, वे भी अंतिम args भरते हैं
- टूल कॉल IDs को `"<call_id>|<item_id>"` के रूप में सामान्यीकृत किया जाता है

## Google Generative AI (`google-generative-ai`)

स्रोत: `packages/ai/src/providers/google.ts`

सामान्यीकरण बिंदु:

- `candidate.content.parts` पर इटरेट करता है
- टेक्स्ट पार्ट्स को `isThinkingPart(part)` द्वारा थिंकिंग बनाम टेक्स्ट में विभाजित किया जाता है
- ब्लॉक ट्रांज़िशन नया ब्लॉक शुरू करने से पहले पिछले ब्लॉक को बंद करते हैं
- `part.functionCall` को एक पूर्ण टूल कॉल के रूप में माना जाता है (start/delta/end तुरंत उत्सर्जित)
- फिनिश रीज़न `google-shared.ts` से `mapStopReason()` द्वारा मैप किया जाता है

टूल-कॉल आर्गुमेंट स्ट्रीमिंग:

- फ़ंक्शन कॉल args संरचित ऑब्जेक्ट के रूप में आते हैं, क्रमिक JSON टेक्स्ट के रूप में नहीं
- कार्यान्वयन `JSON.stringify(arguments)` युक्त एक सिंथेटिक `toolcall_delta` उत्सर्जित करता है
- इस पथ में Google के लिए आंशिक JSON पार्सर की आवश्यकता नहीं है

## आंशिक टूल-कॉल JSON संचय और पुनर्प्राप्ति

Anthropic/OpenAI Responses के लिए साझा व्यवहार `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`) का उपयोग करता है:

1. `JSON.parse` प्रयास करें
2. अपूर्ण खंडों के लिए `partial-json` पार्सर पर फ़ॉलबैक
3. यदि दोनों विफल हों, `{}` लौटाएं

निहितार्थ:

- विकृत या कटे हुए आर्गुमेंट डेल्टा स्ट्रीम प्रोसेसिंग को तुरंत क्रैश नहीं करते
- प्रगतिरत `arguments` अस्थायी रूप से `{}` हो सकते हैं
- बाद के वैध डेल्टा संरचित आर्गुमेंट्स को पुनर्प्राप्त कर सकते हैं क्योंकि प्रत्येक append पर पार्सिंग पुनः प्रयास की जाती है
- अंतिम `toolcall_end` उत्सर्जन से पहले एक और पार्स प्रयास करता है

## स्टॉप रीज़न बनाम ट्रांसपोर्ट/रनटाइम त्रुटियाँ

प्रोवाइडर स्टॉप रीज़न को सामान्यीकृत `stopReason` में मैप किया जाता है:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, सेफ्टी/रिफ्यूज़ल केस→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, सेफ्टी/प्रतिबंधित/विकृत-फ़ंक्शन-कॉल श्रेणियाँ→`error`

त्रुटि शब्दार्थ दो चरणों में विभाजित हैं:

1. **मॉडल पूर्णता शब्दार्थ** (प्रोवाइडर द्वारा रिपोर्ट किया गया फिनिश रीज़न/स्टेटस)
2. **ट्रांसपोर्ट/रनटाइम विफलता** (नेटवर्क/क्लाइंट/पार्सर/एबॉर्ट अपवाद)

यदि प्रोवाइडर स्ट्रीम थ्रो करती है या विफलता का संकेत देती है, तो प्रत्येक प्रोवाइडर रैपर कैच करता है और निम्नलिखित के साथ टर्मिनल `error` इवेंट उत्सर्जित करता है:

- `stopReason = "aborted"` जब एबॉर्ट सिग्नल सेट हो
- अन्यथा `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## विकृत चंक / SSE पार्स विफलता व्यवहार

इन प्रोवाइडर पथों के लिए, चंक/SSE फ्रेमिंग वेंडर SDK स्ट्रीम्स (Anthropic SDK, OpenAI SDK, Google SDK) द्वारा संभाली जाती है। यह कोड यहाँ कस्टम SSE डिकोडर लागू नहीं करता।

वर्तमान कार्यान्वयन में देखा गया व्यवहार:

- SDK स्तर पर विकृत चंक/SSE पार्सिंग एक अपवाद या स्ट्रीम `error` इवेंट के रूप में प्रकट होती है
- प्रोवाइडर रैपर उसे एकीकृत टर्मिनल `error` इवेंट में परिवर्तित करता है
- स्ट्रीम फ़ंक्शन के अंदर कोई प्रोवाइडर-विशिष्ट रिज़्यूम/रिट्राई नहीं है
- उच्च-स्तरीय पुनः प्रयास `AgentSession` ऑटो-रिट्राई लॉजिक में संभाले जाते हैं (संदेश-स्तरीय पुनः प्रयास, स्ट्रीम-चंक रीप्ले नहीं)

## रद्दीकरण सीमाएं

रद्दीकरण स्तरित है:

- AI प्रोवाइडर अनुरोध: `options.signal` प्रोवाइडर क्लाइंट स्ट्रीम कॉल में पास किया जाता है।
- प्रोवाइडर रैपर: स्ट्रीम लूप के बाद, एबॉर्ट किया गया सिग्नल एरर पथ को बाध्य करता है (`"Request was aborted"`)।
- एजेंट लूप: प्रत्येक प्रोवाइडर इवेंट को संभालने से पहले `signal.aborted` की जाँच करता है और नवीनतम आंशिक से एबॉर्ट किया गया असिस्टेंट संदेश संश्लेषित कर सकता है।
- सत्र/एजेंट नियंत्रण: `AgentSession.abort()` -> `agent.abort()` -> साझा एबॉर्ट कंट्रोलर रद्दीकरण।

टूल निष्पादन रद्दीकरण मॉडल स्ट्रीम रद्दीकरण से अलग है:

- टूल रनर `AbortSignal.any([agentSignal, steeringAbortSignal])` का उपयोग करते हैं
- स्टीयरिंग इंटरप्ट्स पहले से उत्पादित टूल परिणामों को संरक्षित करते हुए शेष टूल निष्पादन को एबॉर्ट कर सकते हैं

## बैकप्रेशर सीमाएं

प्रोवाइडर SDK स्ट्रीम और डाउनस्ट्रीम उपभोक्ताओं के बीच कोई कठोर बैकप्रेशर तंत्र नहीं है:

- `EventStream` बिना अधिकतम आकार वाली इन-मेमोरी कतारों का उपयोग करता है
- थ्रॉटलिंग UI अपडेट दर को कम करती है लेकिन प्रोवाइडर इनटेक को धीमा नहीं करती
- यदि उपभोक्ता काफी पीछे रह जाएं, तो कतारबद्ध इवेंट्स पूर्णता तक बढ़ सकते हैं

वर्तमान डिज़ाइन बाउंडेड-बफ़र प्रवाह नियंत्रण पर प्रतिक्रियाशीलता और सरल क्रम को प्राथमिकता देता है।

## स्ट्रीम इवेंट्स एजेंट/सत्र इवेंट्स के रूप में कैसे प्रकट होते हैं

`agentLoop.streamAssistantResponse()` `AssistantMessageEvent` को `AgentEvent` से जोड़ता है:

- `start` पर: प्लेसहोल्डर असिस्टेंट संदेश पुश करता है और `message_start` उत्सर्जित करता है
- ब्लॉक इवेंट्स पर (`text_*`, `thinking_*`, `toolcall_*`): अंतिम असिस्टेंट संदेश अपडेट करता है, कच्चे `assistantMessageEvent` के साथ `message_update` उत्सर्जित करता है
- टर्मिनल पर (`done`/`error`): `response.result()` से अंतिम संदेश रिज़ॉल्व करता है, `message_end` उत्सर्जित करता है

`AgentSession` फिर सत्र-स्तरीय व्यवहारों के लिए उन इवेंट्स का उपभोग करता है:

- TTSR `text_delta` और `toolcall_delta` के लिए `message_update.assistantMessageEvent` की निगरानी करता है
- स्ट्रीमिंग एडिट गार्ड `edit` कॉल्स पर `toolcall_delta`/`toolcall_end` का निरीक्षण करता है और जल्दी एबॉर्ट कर सकता है
- स्थायी संग्रहण `message_end` पर अंतिम रूप दिए गए संदेश लिखता है
- ऑटो-रिट्राई असिस्टेंट `stopReason === "error"` प्लस `errorMessage` ह्यूरिस्टिक्स की जाँच करता है

## एकीकृत बनाम प्रोवाइडर-विशिष्ट जिम्मेदारियाँ

एकीकृत (सामान्य अनुबंध):

- इवेंट आकृति (`AssistantMessageEvent`)
- अंतिम परिणाम निष्कर्षण (`done`/`error`)
- डेल्टा थ्रॉटलिंग + मर्ज नियम
- एजेंट/सत्र इवेंट प्रसार मॉडल

प्रोवाइडर-विशिष्ट (पूरी तरह से अमूर्त नहीं):

- अपस्ट्रीम इवेंट वर्गीकरण और मैपिंग लॉजिक
- स्टॉप-रीज़न अनुवाद तालिकाएँ
- टूल-कॉल ID परंपराएँ
- रीज़निंग/थिंकिंग ब्लॉक शब्दार्थ और हस्ताक्षर
- उपयोग टोकन शब्दार्थ और उपलब्धता समय
- प्रति API संदेश रूपांतरण बाधाएँ

## कार्यान्वयन फ़ाइलें

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — प्रोवाइडर डिस्पैच, विकल्प मैपिंग, API कुंजी/सत्र प्लंबिंग।
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — जेनेरिक स्ट्रीम कतार + असिस्टेंट डेल्टा थ्रॉटलिंग।
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — स्ट्रीम किए गए टूल आर्गुमेंट्स के लिए आंशिक JSON पार्सिंग।
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic इवेंट अनुवाद और टूल JSON डेल्टा संचय।
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses इवेंट अनुवाद और स्टेटस मैपिंग।
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini स्ट्रीम चंक-से-ब्लॉक अनुवाद।
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini फिनिश-रीज़न मैपिंग और साझा रूपांतरण नियम।
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — प्रोवाइडर स्ट्रीम उपभोग और `message_update` ब्रिजिंग।
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — स्ट्रीमिंग अपडेट्स, एबॉर्ट, रिट्राई, और स्थायी संग्रहण का सत्र-स्तरीय प्रबंधन।
