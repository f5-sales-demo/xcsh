---
title: प्रोवाइडर स्ट्रीमिंग आंतरिक विवरण
description: >-
  SSE पार्सिंग, टोकन काउंटिंग और बैकप्रेशर हैंडलिंग के साथ प्रोवाइडर स्ट्रीमिंग
  कार्यान्वयन।
sidebar:
  order: 2
  label: स्ट्रीमिंग आंतरिक विवरण
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# प्रोवाइडर स्ट्रीमिंग आंतरिक विवरण

यह दस्तावेज़ बताता है कि `@f5xc-salesdemos/pi-ai` में टोकन/टूल स्ट्रीमिंग को कैसे सामान्यीकृत किया जाता है, फिर `@f5xc-salesdemos/pi-agent-core` और `coding-agent` सत्र इवेंट के माध्यम से प्रसारित किया जाता है।

## एंड-टू-एंड प्रवाह

1. `streamSimple()` (`packages/ai/src/stream.ts`) सामान्य विकल्पों को मैप करता है और प्रोवाइडर स्ट्रीम फ़ंक्शन पर डिस्पैच करता है।
2. प्रोवाइडर स्ट्रीम फ़ंक्शन (`anthropic.ts`, `openai-responses.ts`, `google.ts`) प्रोवाइडर-नेटिव स्ट्रीम इवेंट को एकीकृत `AssistantMessageEvent` अनुक्रम में रूपांतरित करते हैं।
3. प्रत्येक प्रोवाइडर इवेंट को `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) में पुश करता है, जो डेल्टा इवेंट को थ्रॉटल करता है और उजागर करता है:
   - वृद्धिशील अपडेट के लिए async इटरेशन
   - अंतिम `AssistantMessage` के लिए `result()`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) उन इवेंट का उपभोग करता है, इन-फ्लाइट असिस्टेंट स्थिति को म्यूटेट करता है, और कच्चे `assistantMessageEvent` ले जाने वाले `message_update` इवेंट उत्सर्जित करता है।
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) एजेंट इवेंट की सदस्यता लेता है, संदेश सहेजता है, एक्सटेंशन हुक चलाता है, और सत्र व्यवहार (retry, compaction, TTSR, streaming-edit abort checks) लागू करता है।

## `@f5xc-salesdemos/pi-ai` में एकीकृत स्ट्रीम अनुबंध

सभी प्रोवाइडर एक ही आकार उत्सर्जित करते हैं (`AssistantMessageEvent` `packages/ai/src/types.ts` में):

- `start`
- कंटेंट ब्लॉक जीवनचक्र ट्रिपलेट:
  - टेक्स्ट: `text_start` → `text_delta`* → `text_end`
  - थिंकिंग: `thinking_start` → `thinking_delta`* → `thinking_end`
  - टूल कॉल: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- टर्मिनल इवेंट:
  - `done` जिसमें `reason: "stop" | "length" | "toolUse"`
  - या `error` जिसमें `reason: "aborted" | "error"`

`AssistantMessageEventStream` की गारंटी:

- अंतिम परिणाम टर्मिनल इवेंट (`done` या `error`) द्वारा रिज़ॉल्व किया जाता है
- डेल्टा को बैच/थ्रॉटल किया जाता है (~50ms)
- बफ़र किए गए डेल्टा को नॉन-डेल्टा इवेंट से पहले और पूर्णता से पहले फ्लश किया जाता है

## डेल्टा थ्रॉटलिंग और हार्मोनाइज़ेशन व्यवहार

`AssistantMessageEventStream` `text_delta`, `thinking_delta`, और `toolcall_delta` को मर्ज करने योग्य इवेंट के रूप में मानता है:

- बफ़र किए गए डेल्टा केवल तभी मर्ज किए जाते हैं जब **type + contentIndex** मेल खाते हों
- मर्ज नवीनतम `partial` स्नैपशॉट रखता है
- नॉन-डेल्टा इवेंट तत्काल फ्लश को बाध्य करते हैं

यह TUI/इवेंट उपभोक्ताओं के लिए उच्च-आवृत्ति प्रोवाइडर स्ट्रीम को सुचारू करता है, लेकिन यह प्रोवाइडर बैकप्रेशर नहीं है: प्रोवाइडर अभी भी पूरी गति से उत्पादन करते हैं, जबकि स्थानीय स्ट्रीम बफ़र करती है।

## प्रोवाइडर सामान्यीकरण विवरण

## Anthropic (`anthropic-messages`)

स्रोत: `packages/ai/src/providers/anthropic.ts`

सामान्यीकरण बिंदु:

- `message_start` उपयोग (input/output/cache टोकन) प्रारंभ करता है
- `content_block_start` text/thinking/toolcall स्टार्ट पर मैप करता है
- `content_block_delta` मैप करता है:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` केवल `thinkingSignature` अपडेट करता है (कोई इवेंट नहीं)
- `content_block_stop` संगत `*_end` उत्सर्जित करता है
- `message_delta.stop_reason` `mapStopReason()` के माध्यम से मैप होता है

टूल-कॉल आर्ग्युमेंट स्ट्रीमिंग:

- प्रत्येक टूल ब्लॉक आंतरिक `partialJson` रखता है
- प्रत्येक JSON डेल्टा `partialJson` में जोड़ा जाता है
- `arguments` प्रत्येक डेल्टा पर `parseStreamingJson()` के माध्यम से पुनः पार्स किए जाते हैं
- `toolcall_end` एक बार और पार्स करता है, फिर `partialJson` हटाता है

## OpenAI Responses (`openai-responses`)

स्रोत: `packages/ai/src/providers/openai-responses.ts`

सामान्यीकरण बिंदु:

- `response.output_item.added` reasoning/text/function-call ब्लॉक शुरू करता है
- reasoning summary इवेंट (`response.reasoning_summary_text.delta`) `thinking_delta` बनते हैं
- output/refusal डेल्टा `text_delta` बनते हैं
- `response.function_call_arguments.delta` `toolcall_delta` बनता है
- `response.output_item.done` `thinking_end` / `text_end` / `toolcall_end` उत्सर्जित करता है
- `response.completed` स्थिति को stop reason और usage पर मैप करता है

टूल-कॉल आर्ग्युमेंट स्ट्रीमिंग:

- Anthropic जैसी ही `partialJson` संचय पैटर्न
- जो प्रोवाइडर केवल `response.function_call_arguments.done` भेजते हैं वे भी अंतिम args भरते हैं
- टूल कॉल IDs `"<call_id>|<item_id>"` के रूप में सामान्यीकृत हैं

## Google Generative AI (`google-generative-ai`)

स्रोत: `packages/ai/src/providers/google.ts`

सामान्यीकरण बिंदु:

- `candidate.content.parts` पर इटरेट करता है
- टेक्स्ट पार्ट्स को `isThinkingPart(part)` द्वारा thinking बनाम text में विभाजित किया जाता है
- ब्लॉक ट्रांज़िशन नया ब्लॉक शुरू करने से पहले पिछले ब्लॉक को बंद करते हैं
- `part.functionCall` को एक पूर्ण टूल कॉल के रूप में माना जाता है (start/delta/end तत्काल उत्सर्जित)
- finish reason `google-shared.ts` के `mapStopReason()` द्वारा मैप किया जाता है

टूल-कॉल आर्ग्युमेंट स्ट्रीमिंग:

- फ़ंक्शन कॉल args संरचित ऑब्जेक्ट के रूप में आते हैं, वृद्धिशील JSON टेक्स्ट के रूप में नहीं
- कार्यान्वयन `JSON.stringify(arguments)` युक्त एक सिंथेटिक `toolcall_delta` उत्सर्जित करता है
- इस पथ में Google के लिए कोई partial JSON पार्सर आवश्यक नहीं है

## आंशिक टूल-कॉल JSON संचय और पुनर्प्राप्ति

Anthropic/OpenAI Responses के लिए साझा व्यवहार `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`) का उपयोग करता है:

1. `JSON.parse` आज़माएं
2. अपूर्ण खंडों के लिए `partial-json` पार्सर का फ़ॉलबैक
3. यदि दोनों विफल हों, `{}` लौटाएं

निहितार्थ:

- विकृत या छोटे कटे आर्ग्युमेंट डेल्टा स्ट्रीम प्रोसेसिंग को तत्काल क्रैश नहीं करते
- इन-प्रोग्रेस `arguments` अस्थायी रूप से `{}` हो सकते हैं
- बाद के वैध डेल्टा संरचित आर्ग्युमेंट पुनर्प्राप्त कर सकते हैं क्योंकि पार्सिंग प्रत्येक append पर पुनः प्रयास की जाती है
- अंतिम `toolcall_end` उत्सर्जन से पहले एक और पार्स प्रयास करता है

## Stop Reasons बनाम ट्रांसपोर्ट/रनटाइम त्रुटियाँ

प्रोवाइडर stop reasons को सामान्यीकृत `stopReason` पर मैप किया जाता है:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, safety/refusal cases→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, safety/prohibited/malformed-function-call classes→`error`

त्रुटि सिमेंटिक्स दो चरणों में विभाजित हैं:

1. **मॉडल कम्पलीशन सिमेंटिक्स** (प्रोवाइडर द्वारा रिपोर्ट किया गया finish reason/status)
2. **ट्रांसपोर्ट/रनटाइम विफलता** (नेटवर्क/क्लाइंट/पार्सर/abort अपवाद)

यदि प्रोवाइडर स्ट्रीम थ्रो करती है या विफलता संकेत देती है, तो प्रत्येक प्रोवाइडर रैपर पकड़ता है और टर्मिनल `error` इवेंट उत्सर्जित करता है:

- `stopReason = "aborted"` जब abort signal सेट हो
- अन्यथा `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## विकृत चंक / SSE पार्स विफलता व्यवहार

इन प्रोवाइडर पथों के लिए, चंक/SSE फ्रेमिंग वेंडर SDK स्ट्रीम (Anthropic SDK, OpenAI SDK, Google SDK) द्वारा हैंडल की जाती है। यह कोड यहाँ कस्टम SSE डीकोडर कार्यान्वित नहीं करता।

वर्तमान कार्यान्वयन में देखा गया व्यवहार:

- SDK स्तर पर विकृत चंक/SSE पार्सिंग एक अपवाद या स्ट्रीम `error` इवेंट के रूप में सामने आती है
- प्रोवाइडर रैपर उसे एकीकृत टर्मिनल `error` इवेंट में परिवर्तित करता है
- स्ट्रीम फ़ंक्शन के अंदर कोई प्रोवाइडर-विशिष्ट resume/retry नहीं
- उच्च-स्तरीय retries `AgentSession` auto-retry लॉजिक में हैंडल की जाती हैं (message-level retry, stream-chunk replay नहीं)

## रद्दीकरण सीमाएं

रद्दीकरण स्तरबद्ध है:

- AI प्रोवाइडर अनुरोध: `options.signal` प्रोवाइडर क्लाइंट स्ट्रीम कॉल में पास किया जाता है।
- प्रोवाइडर रैपर: स्ट्रीम लूप के बाद, aborted signal error path (`"Request was aborted"`) को बाध्य करता है।
- एजेंट लूप: प्रत्येक प्रोवाइडर इवेंट को हैंडल करने से पहले `signal.aborted` जाँचता है और नवीनतम partial से aborted असिस्टेंट संदेश सिंथेसाइज़ कर सकता है।
- सत्र/एजेंट नियंत्रण: `AgentSession.abort()` -> `agent.abort()` -> साझा abort controller रद्दीकरण।

टूल एग्ज़ीक्यूशन रद्दीकरण मॉडल स्ट्रीम रद्दीकरण से अलग है:

- टूल रनर `AbortSignal.any([agentSignal, steeringAbortSignal])` का उपयोग करते हैं
- steering interrupts शेष टूल एग्ज़ीक्यूशन को abort कर सकते हैं जबकि पहले से उत्पादित टूल परिणाम सुरक्षित रहते हैं

## बैकप्रेशर सीमाएं

प्रोवाइडर SDK स्ट्रीम और डाउनस्ट्रीम उपभोक्ताओं के बीच कोई हार्ड बैकप्रेशर तंत्र नहीं है:

- `EventStream` बिना अधिकतम आकार के इन-मेमोरी कतारों का उपयोग करता है
- थ्रॉटलिंग UI अपडेट दर कम करती है लेकिन प्रोवाइडर intake धीमा नहीं करती
- यदि उपभोक्ता काफ़ी पीछे रहते हैं, तो कतारबद्ध इवेंट पूर्णता तक बढ़ सकते हैं

वर्तमान डिज़ाइन bounded-buffer flow control की जगह responsiveness और सरल ordering को प्राथमिकता देता है।

## स्ट्रीम इवेंट एजेंट/सत्र इवेंट के रूप में कैसे सामने आते हैं

`agentLoop.streamAssistantResponse()` `AssistantMessageEvent` को `AgentEvent` से जोड़ता है:

- `start` पर: placeholder असिस्टेंट संदेश पुश करता है और `message_start` उत्सर्जित करता है
- ब्लॉक इवेंट (`text_*`, `thinking_*`, `toolcall_*`) पर: अंतिम असिस्टेंट संदेश अपडेट करता है, कच्चे `assistantMessageEvent` के साथ `message_update` उत्सर्जित करता है
- टर्मिनल (`done`/`error`) पर: `response.result()` से अंतिम संदेश रिज़ॉल्व करता है, `message_end` उत्सर्जित करता है

`AgentSession` फिर सत्र-स्तरीय व्यवहारों के लिए उन इवेंट का उपभोग करता है:

- TTSR `text_delta` और `toolcall_delta` के लिए `message_update.assistantMessageEvent` देखता है
- streaming edit guard `edit` कॉल पर `toolcall_delta`/`toolcall_end` निरीक्षण करता है और जल्दी abort कर सकता है
- persistence `message_end` पर अंतिम संदेश लिखता है
- auto-retry असिस्टेंट `stopReason === "error"` और `errorMessage` heuristics की जाँच करता है

## एकीकृत बनाम प्रोवाइडर-विशिष्ट ज़िम्मेदारियाँ

एकीकृत (सामान्य अनुबंध):

- इवेंट आकार (`AssistantMessageEvent`)
- अंतिम परिणाम निष्कर्षण (`done`/`error`)
- डेल्टा थ्रॉटलिंग + मर्ज नियम
- एजेंट/सत्र इवेंट प्रसार मॉडल

प्रोवाइडर-विशिष्ट (पूरी तरह abstracted नहीं):

- upstream इवेंट वर्गीकरण और मैपिंग लॉजिक
- stop-reason अनुवाद तालिकाएं
- टूल-कॉल ID परंपराएं
- reasoning/thinking ब्लॉक सिमेंटिक्स और signatures
- usage टोकन सिमेंटिक्स और उपलब्धता समय
- API के अनुसार संदेश रूपांतरण प्रतिबंध

## कार्यान्वयन फ़ाइलें

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — प्रोवाइडर dispatch, option mapping, API key/session plumbing।
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — सामान्य stream queue + असिस्टेंट डेल्टा थ्रॉटलिंग।
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — streamed टूल आर्ग्युमेंट के लिए partial JSON पार्सिंग।
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic इवेंट अनुवाद और टूल JSON डेल्टा संचय।
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses इवेंट अनुवाद और status mapping।
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini stream chunk-to-block अनुवाद।
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini finish-reason mapping और साझा रूपांतरण नियम।
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — प्रोवाइडर stream उपभोग और `message_update` bridging।
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — streaming updates, abort, retry और persistence का सत्र-स्तरीय हैंडलिंग।
