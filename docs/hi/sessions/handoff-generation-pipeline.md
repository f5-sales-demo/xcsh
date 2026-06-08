---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Handoff pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` जनरेशन पाइपलाइन

यह दस्तावेज़ बताता है कि coding-agent आज `/handoff` को कैसे लागू करता है: ट्रिगर पथ, जनरेशन प्रॉम्प्ट, कम्पलीशन कैप्चर, सेशन स्विच, और कॉन्टेक्स्ट री-इंजेक्शन।

## दायरा

इसमें शामिल है:

- इंटरैक्टिव `/handoff` कमांड डिस्पैच
- `AgentSession.handoff()` लाइफसाइकल और स्टेट ट्रांज़िशन
- असिस्टेंट आउटपुट से हैंडऑफ़ आउटपुट कैसे कैप्चर किया जाता है
- पुराने/नए सेशन हैंडऑफ़ डेटा को अलग-अलग तरीके से कैसे पर्सिस्ट करते हैं
- सफलता, रद्द, और विफलता के लिए UI व्यवहार

इसमें शामिल नहीं है:

- जेनेरिक ट्री नेविगेशन/ब्रांच इंटर्नल्स
- नॉन-हैंडऑफ़ सेशन कमांड (`/new`, `/fork`, `/resume`)

## इम्प्लीमेंटेशन फाइलें

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## ट्रिगर पथ

1. `/handoff` को बिल्टइन स्लैश कमांड मेटाडेटा (`slash-commands.ts`) में वैकल्पिक इनलाइन हिंट के साथ घोषित किया गया है: `[focus instructions]`।
2. इंटरैक्टिव इनपुट हैंडलिंग (`InputController`) में, `/handoff` या `/handoff ...` से मेल खाने वाला सबमिट टेक्स्ट सामान्य प्रॉम्प्ट सबमिशन से पहले इंटरसेप्ट किया जाता है।
3. एडिटर क्लियर किया जाता है और `handleHandoffCommand(customInstructions?)` कॉल किया जाता है।
4. `CommandController.handleHandoffCommand` वर्तमान एंट्रीज़ का उपयोग करके एक प्रीफ्लाइट गार्ड करता है:
   - `type === "message"` एंट्रीज़ की गणना करता है।
   - यदि `< 2` है, तो चेतावनी देता है: `Nothing to hand off (no messages yet)` और लौट जाता है।

वही न्यूनतम-सामग्री गार्ड `AgentSession.handoff()` के अंदर भी मौजूद है और उल्लंघन होने पर throw करता है। यह UI और सेशन दोनों परतों पर सुरक्षा को डुप्लिकेट करता है।

## एंड-टू-एंड लाइफसाइकल

### 1) हैंडऑफ़ जनरेशन शुरू करना

`AgentSession.handoff(customInstructions?)`:

- वर्तमान ब्रांच एंट्रीज़ पढ़ता है (`sessionManager.getBranch()`)
- न्यूनतम मैसेज काउंट (`>= 2`) को मान्य करता है
- `#handoffAbortController` बनाता है
- एक निश्चित, इनलाइन प्रॉम्प्ट बनाता है जो एक संरचित हैंडऑफ़ दस्तावेज़ का अनुरोध करता है (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- यदि कस्टम निर्देश दिए गए हैं तो `Additional focus: ...` जोड़ता है

प्रॉम्प्ट इसके माध्यम से भेजा जाता है:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` इस आंतरिक निर्देश पेलोड के स्लैश/प्रॉम्प्ट-टेम्पलेट विस्तार को रोकता है।

### 2) कम्पलीशन कैप्चर

प्रॉम्प्ट भेजने से पहले, `handoff()` सेशन इवेंट्स को सब्सक्राइब करता है और `agent_end` की प्रतीक्षा करता है।

`agent_end` पर, यह सबसे हालिया `assistant` मैसेज के लिए पीछे की ओर स्कैन करके एजेंट स्टेट से हैंडऑफ़ टेक्स्ट निकालता है, फिर `type === "text"` वाले सभी `content` ब्लॉक्स को `\n` के साथ जोड़ता है।

महत्वपूर्ण एक्सट्रैक्शन अनुमान:

- केवल टेक्स्ट ब्लॉक्स का उपयोग किया जाता है; नॉन-टेक्स्ट कंटेंट को अनदेखा किया जाता है।
- यह मानता है कि नवीनतम असिस्टेंट मैसेज हैंडऑफ़ जनरेशन से संबंधित है।
- यह मार्कडाउन सेक्शन को पार्स नहीं करता या फॉर्मेट अनुपालन को मान्य नहीं करता।
- यदि असिस्टेंट आउटपुट में कोई टेक्स्ट ब्लॉक नहीं है, तो हैंडऑफ़ को अनुपस्थित माना जाता है।

### 3) रद्दीकरण जाँच

`handoff()` `undefined` लौटाता है जब इनमें से कोई भी शर्त पूरी होती है:

- कोई कैप्चर किया गया हैंडऑफ़ टेक्स्ट नहीं है, या
- `#handoffAbortController.signal.aborted` true है

यह हमेशा `finally` में `#handoffAbortController` को क्लियर करता है।

### 4) नया सेशन बनाना

यदि टेक्स्ट कैप्चर किया गया था और abort नहीं किया गया:

1. वर्तमान सेशन राइटर को फ्लश करें (`sessionManager.flush()`)
2. एक बिल्कुल नया सेशन शुरू करें (`sessionManager.newSession()`)
3. इन-मेमोरी एजेंट स्टेट रीसेट करें (`agent.reset()`)
4. `agent.sessionId` को नए सेशन id से रीबाइंड करें
5. कतारबद्ध कॉन्टेक्स्ट ऐरे क्लियर करें (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Todo रिमाइंडर काउंटर रीसेट करें

`newSession()` एक फ्रेश हेडर और खाली एंट्री लिस्ट बनाता है (लीफ `null` पर रीसेट)। हैंडऑफ़ पथ में, कोई `parentSession` पास नहीं किया जाता।

### 5) हैंडऑफ़-कॉन्टेक्स्ट इंजेक्शन

जनरेट किया गया हैंडऑफ़ दस्तावेज़ रैप किया जाता है और नए सेशन में `custom_message` एंट्री के रूप में जोड़ा जाता है:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

इंसर्शन कॉल:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

सिमेंटिक्स:

- `customType`: `"handoff"`
- `display`: `true` (TUI रीबिल्ड में दिखाई देता है)
- एंट्री टाइप: `custom_message` (LLM कॉन्टेक्स्ट में भाग लेता है)

### 6) सक्रिय एजेंट कॉन्टेक्स्ट का पुनर्निर्माण

इंजेक्शन के बाद:

1. `sessionManager.buildSessionContext()` वर्तमान लीफ के लिए मैसेज लिस्ट रिज़ॉल्व करता है
2. `agent.replaceMessages(sessionContext.messages)` इंजेक्ट किए गए हैंडऑफ़ मैसेज को सक्रिय कॉन्टेक्स्ट बनाता है
3. मेथड `{ document: handoffText }` लौटाता है

इस बिंदु पर, नए सेशन में सक्रिय LLM कॉन्टेक्स्ट में इंजेक्ट किया गया हैंडऑफ़ मैसेज होता है, पुरानी ट्रांसक्रिप्ट नहीं।

## पर्सिस्टेंस मॉडल: पुराना सेशन बनाम नया सेशन

### पुराना सेशन

जनरेशन के दौरान, सामान्य मैसेज पर्सिस्टेंस सक्रिय रहता है। असिस्टेंट हैंडऑफ़ रिस्पॉन्स `message_end` पर एक नियमित `message` एंट्री के रूप में पर्सिस्ट किया जाता है।

परिणाम: मूल सेशन में जनरेट किया गया दिखने वाला हैंडऑफ़ ऐतिहासिक ट्रांसक्रिप्ट के हिस्से के रूप में होता है।

### नया सेशन

सेशन रीसेट के बाद, हैंडऑफ़ `customType: "handoff"` के साथ `custom_message` के रूप में पर्सिस्ट किया जाता है।

`buildSessionContext()` इस एंट्री को `createCustomMessage(...)` के माध्यम से एक रनटाइम कस्टम/यूज़र-कॉन्टेक्स्ट मैसेज में बदलता है, ताकि यह नए सेशन के भविष्य के प्रॉम्प्ट्स में शामिल हो।

## कंट्रोलर/UI व्यवहार

`CommandController.handleHandoffCommand` व्यवहार:

- `await session.handoff(customInstructions)` कॉल करता है
- यदि परिणाम `undefined` है: `showError("Handoff cancelled")`
- सफलता पर:
  - `rebuildChatFromMessages()` (नया सेशन कॉन्टेक्स्ट लोड करता है, इंजेक्ट किए गए हैंडऑफ़ सहित)
  - स्टेटस लाइन और एडिटर टॉप बॉर्डर को इनवैलिडेट करता है
  - todos को रीलोड करता है
  - सफलता चैट लाइन जोड़ता है: `New session started with handoff context`
- अपवाद पर:
  - यदि मैसेज `"Handoff cancelled"` है या error name `AbortError` है: `showError("Handoff cancelled")`
  - अन्यथा: `showError("Handoff failed: <message>")`
- अंत में रेंडर का अनुरोध करता है

## रद्दीकरण सिमेंटिक्स (वर्तमान व्यवहार)

### सेशन-स्तरीय रद्दीकरण प्रिमिटिव

`AgentSession` एक्सपोज़ करता है:

- `abortHandoff()` → `#handoffAbortController` को abort करता है
- `isGeneratingHandoff` → कंट्रोलर मौजूद होने पर true

जब यह abort पथ उपयोग किया जाता है, तो हैंडऑफ़ सब्सक्राइबर `Error("Handoff cancelled")` के साथ reject करता है, और कमांड कंट्रोलर इसे कैंसलेशन UI में मैप करता है।

### इंटरैक्टिव `/handoff` पथ की सीमा

वर्तमान इंटरैक्टिव कंट्रोलर वायरिंग में, `/handoff` एक समर्पित Escape हैंडलर इंस्टॉल नहीं करता जो `abortHandoff()` कॉल करे (कॉम्पैक्शन/ब्रांच-सारांश पथों के विपरीत जो अस्थायी रूप से `editor.onEscape` को ओवरराइड करते हैं)।

व्यावहारिक प्रभाव:

- सेशन-स्तरीय रद्दीकरण समर्थन है, लेकिन `/handoff` कमांड पथ में कोई हैंडऑफ़-विशिष्ट कीबाइंडिंग हुक नहीं है।
- उपयोगकर्ता रुकावट अभी भी व्यापक एजेंट abort पथों के माध्यम से हो सकती है, लेकिन यह `abortHandoff()` द्वारा उपयोग किया जाने वाला वही स्पष्ट रद्दीकरण चैनल नहीं है।

## Aborted बनाम विफल हैंडऑफ़

वर्तमान UI वर्गीकरण:

- **Aborted/रद्द**
  - `abortHandoff()` पथ `"Handoff cancelled"` ट्रिगर करता है, या
  - thrown `AbortError`
  - UI दिखाता है `Handoff cancelled`

- **विफल**
  - `handoff()` / प्रॉम्प्ट पाइपलाइन से कोई अन्य thrown error (मॉडल/API वैलिडेशन एरर, रनटाइम अपवाद, आदि)
  - UI दिखाता है `Handoff failed: ...`

अतिरिक्त सूक्ष्मता: यदि जनरेशन पूर्ण हो जाता है लेकिन कोई टेक्स्ट एक्सट्रैक्ट नहीं होता, तो `handoff()` `undefined` लौटाता है और कंट्रोलर वर्तमान में **रद्द** रिपोर्ट करता है, **विफल** नहीं।

## शॉर्ट-सेशन और न्यूनतम-सामग्री गार्डरेल्स

दो गार्ड कम-सिग्नल हैंडऑफ़ को रोकते हैं:

- UI परत (`handleHandoffCommand`): `< 2` मैसेज एंट्रीज़ के लिए चेतावनी देता है और जल्दी लौट जाता है
- सेशन परत (`handoff()`): उसी शर्त को एरर के रूप में throw करता है

यह खाली/लगभग-खाली हैंडऑफ़ कॉन्टेक्स्ट के साथ नया सेशन बनाने से बचाता है।

## स्टेट ट्रांज़िशन सारांश

उच्च-स्तरीय स्टेट फ्लो:

1. इंटरैक्टिव स्लैश कमांड इंटरसेप्ट किया गया
2. प्रीफ्लाइट मैसेज-काउंट गार्ड
3. `#handoffAbortController` बनाया गया (`isGeneratingHandoff = true`)
4. आंतरिक हैंडऑफ़ प्रॉम्प्ट सबमिट किया गया (चैट में सामान्य असिस्टेंट जनरेशन के रूप में दिखता है)
5. `agent_end` पर, अंतिम असिस्टेंट टेक्स्ट एक्सट्रैक्ट किया गया
6. यदि अनुपस्थित/abort किया गया → `undefined` लौटाता है या रद्दीकरण एरर पथ
7. यदि मौजूद है:
   - पुराना सेशन फ्लश करें
   - नया खाली सेशन बनाएं
   - रनटाइम कतारें/काउंटर रीसेट करें
   - `custom_message(handoff)` जोड़ें
   - सक्रिय एजेंट मैसेजेज़ को पुनर्निर्मित और बदलें
8. कंट्रोलर चैट UI को पुनर्निर्मित करता है और सफलता की घोषणा करता है
9. `#handoffAbortController` क्लियर किया गया (`isGeneratingHandoff = false`)

## ज्ञात अनुमान और सीमाएं

- हैंडऑफ़ एक्सट्रैक्शन ह्यूरिस्टिक है: "अंतिम असिस्टेंट टेक्स्ट ब्लॉक्स"; कोई संरचनात्मक मान्यकरण नहीं।
- जनरेट किया गया मार्कडाउन अनुरोधित सेक्शन फॉर्मेट का पालन करता है या नहीं, इसकी कोई कठोर जाँच नहीं।
- गायब एक्सट्रैक्टेड टेक्स्ट को कंट्रोलर UX में रद्दीकरण के रूप में रिपोर्ट किया जाता है।
- `/handoff` इंटरैक्टिव फ्लो में वर्तमान में एक समर्पित Escape→`abortHandoff()` बाइंडिंग का अभाव है।
- इस पथ द्वारा नया सेशन लिनिएज मेटाडेटा (`parentSession`) सेट नहीं किया जाता।
