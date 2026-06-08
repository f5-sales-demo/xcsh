---
title: TTSR इंजेक्शन जीवनचक्र
description: >-
  संदर्भ प्रबंधन के लिए TTSR (tool-use, tool-result, system-reminder) इंजेक्शन
  जीवनचक्र।
sidebar:
  order: 9
  label: TTSR इंजेक्शन
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSR इंजेक्शन जीवनचक्र

यह दस्तावेज़ वर्तमान Time Traveling Stream Rules (TTSR) रनटाइम पथ को कवर करता है, जिसमें नियम खोज से लेकर स्ट्रीम रुकावट, पुनः प्रयास इंजेक्शन, एक्सटेंशन सूचनाएं, और सत्र-स्थिति प्रबंधन शामिल हैं।

## कार्यान्वयन फ़ाइलें

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. डिस्कवरी फीड और नियम पंजीकरण

सत्र निर्माण के समय, `createAgentSession()` सभी खोजे गए नियमों को लोड करता है और एक `TtsrManager` का निर्माण करता है:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### पूर्व-पंजीकरण डीडुप्लिकेशन व्यवहार

`loadCapability("rules")` `rule.name` के आधार पर पहले-आओ-पहले-पाओ (first-wins) सिमैंटिक्स के साथ डीडुप्लिकेट करता है (उच्च प्रदाता प्राथमिकता पहले)। छायांकित डुप्लिकेट TTSR पंजीकरण से पहले हटा दिए जाते हैं।

### `TtsrManager.addRule()` व्यवहार

पंजीकरण तब छोड़ दिया जाता है जब:

- `rule.ttsrTrigger` अनुपस्थित हो
- उसी `rule.name` वाला नियम पहले से इस मैनेजर में पंजीकृत हो
- रेगेक्स संकलित होने में विफल हो (`new RegExp(rule.ttsrTrigger)` त्रुटि देता है)

अमान्य रेगेक्स ट्रिगर चेतावनी के रूप में लॉग किए जाते हैं और अनदेखा किए जाते हैं; सत्र स्टार्टअप जारी रहता है।

### सेटिंग संबंधी चेतावनी

`TtsrSettings.enabled` मैनेजर में लोड किया जाता है लेकिन वर्तमान में रनटाइम गेटिंग में जाँचा नहीं जाता। यदि नियम मौजूद हैं, तो मिलान फिर भी चलता है।

## 2. स्ट्रीमिंग मॉनिटर जीवनचक्र

TTSR डिटेक्शन `AgentSession.#handleAgentEvent` के अंदर चलता है।

### टर्न प्रारंभ

`turn_start` पर, स्ट्रीम बफ़र रीसेट होता है:

- `ttsrManager.resetBuffer()`

### स्ट्रीम के दौरान (`message_update`)

जब सहायक अपडेट आते हैं और नियम मौजूद होते हैं:

- `text_delta` और `toolcall_delta` की निगरानी करें
- डेल्टा को मैनेजर बफ़र में जोड़ें
- `check(buffer)` कॉल करें

`check()` पंजीकृत नियमों पर इटरेट करता है और सभी मिलान करने वाले नियम लौटाता है जो दोहराव नीति (`#canTrigger`) पास करते हैं।

## 3. ट्रिगर निर्णय और तत्काल एबॉर्ट पथ

जब एक या अधिक नियम मिलान करते हैं:

1. `markInjected(matches)` मैनेजर इंजेक्शन स्थिति में नियम नाम रिकॉर्ड करता है।
2. मिलान किए गए नियम `#pendingTtsrInjections` में कतारबद्ध किए जाते हैं।
3. `#ttsrAbortPending = true`।
4. `agent.abort()` तुरंत कॉल किया जाता है।
5. `ttsr_triggered` इवेंट असिंक्रोनस रूप से उत्सर्जित होता है (fire-and-forget)।
6. पुनः प्रयास कार्य `setTimeout(..., 50)` के माध्यम से शेड्यूल किया जाता है।

एबॉर्ट एक्सटेंशन कॉलबैक पर अवरुद्ध नहीं होता।

## 4. पुनः प्रयास शेड्यूलिंग, संदर्भ मोड, और रिमाइंडर इंजेक्शन

50ms टाइमआउट के बाद:

1. `#ttsrAbortPending = false`
2. `ttsrManager.getSettings().contextMode` पढ़ें
3. यदि `contextMode === "discard"` है, तो `agent.popMessage()` के साथ आंशिक सहायक आउटपुट हटाएं
4. `ttsr-interrupt.md` टेम्पलेट का उपयोग करके लंबित नियमों से इंजेक्शन सामग्री बनाएं
5. प्रति नियम एक `<system-interrupt ...>` ब्लॉक वाला सिंथेटिक उपयोगकर्ता संदेश जोड़ें
6. जनरेशन पुनः प्रयास करने के लिए `agent.continue()` कॉल करें

टेम्पलेट पेलोड है:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

सामग्री जनरेशन के बाद लंबित इंजेक्शन साफ़ कर दिए जाते हैं।

### आंशिक आउटपुट पर `contextMode` व्यवहार

- `discard`: पुनः प्रयास से पहले आंशिक/एबॉर्ट किया गया सहायक संदेश हटा दिया जाता है।
- `keep`: आंशिक सहायक आउटपुट वार्तालाप स्थिति में बना रहता है; इसके बाद रिमाइंडर जोड़ा जाता है।

## 5. दोहराव नीति और गैप लॉजिक

`TtsrManager` `#messageCount` और प्रति-नियम `lastInjectedAt` को ट्रैक करता है।

### `repeatMode: "once"`

एक नियम इंजेक्शन रिकॉर्ड होने के बाद केवल एक बार ट्रिगर हो सकता है।

### `repeatMode: "after-gap"`

एक नियम तभी पुनः ट्रिगर हो सकता है जब:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` `turn_end` पर बढ़ता है, इसलिए गैप पूर्ण टर्न में मापा जाता है, स्ट्रीम चंक्स में नहीं।

## 6. इवेंट उत्सर्जन और एक्सटेंशन/हुक सतहें

### सत्र इवेंट

`AgentSessionEvent` में शामिल है:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### एक्सटेंशन रनर

`#emitSessionEvent()` इवेंट को इन तक रूट करता है:

- एक्सटेंशन लिसनर (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- स्थानीय सत्र सब्सक्राइबर

### हुक और कस्टम-टूल टाइपिंग

- एक्सटेंशन API `on("ttsr_triggered", ...)` एक्सपोज़ करता है
- हुक API `on("ttsr_triggered", ...)` एक्सपोज़ करता है
- कस्टम टूल `onSession({ reason: "ttsr_triggered", rules })` प्राप्त करते हैं

### इंटरैक्टिव-मोड रेंडरिंग अंतर

इंटरैक्टिव मोड `session.isTtsrAbortPending` का उपयोग करके TTSR रुकावट के दौरान एबॉर्ट किए गए सहायक स्टॉप कारण को दृश्यमान विफलता के रूप में दिखाने को दबाता है, और जब इवेंट आता है तब `TtsrNotificationComponent` रेंडर करता है।

## 7. स्थायित्व और पुनरारंभ स्थिति (वर्तमान कार्यान्वयन)

`SessionManager` में इंजेक्ट किए गए नियम स्थायित्व के लिए पूर्ण स्कीमा समर्थन है:

- प्रविष्टि प्रकार: `ttsr_injection`
- जोड़ने का API: `appendTtsrInjection(ruleNames)`
- क्वेरी API: `getInjectedTtsrRules()`
- संदर्भ पुनर्निर्माण में `SessionContext.injectedTtsrRules` शामिल है

`TtsrManager` `restoreInjected(ruleNames)` के माध्यम से पुनर्स्थापना का भी समर्थन करता है।

### वर्तमान वायरिंग स्थिति

वर्तमान रनटाइम पथ में:

- `AgentSession` TTSR ट्रिगर होने पर `ttsr_injection` प्रविष्टियाँ नहीं जोड़ता।
- `createAgentSession()` `existingSession.injectedTtsrRules` को वापस `ttsrManager` में पुनर्स्थापित नहीं करता।

शुद्ध प्रभाव: इंजेक्ट किए गए नियम का दमन लाइव प्रक्रिया के लिए इन-मेमोरी लागू होता है, लेकिन वर्तमान में इस पथ द्वारा सत्र रीलोड/पुनरारंभ के बीच स्थायी/पुनर्स्थापित नहीं किया जाता।

## 8. रेस सीमाएं और क्रम गारंटी

### एबॉर्ट बनाम पुनः प्रयास कॉलबैक

- TTSR हैंडलर के दृष्टिकोण से एबॉर्ट सिंक्रोनस है (`agent.abort()` तुरंत कॉल किया जाता है)
- पुनः प्रयास टाइमर द्वारा विलंबित होता है (`50ms`)
- एक्सटेंशन सूचना असिंक्रोनस है और एबॉर्ट/पुनः प्रयास शेड्यूलिंग से पहले जानबूझकर प्रतीक्षित नहीं की जाती

### एक ही स्ट्रीम विंडो में एकाधिक मिलान

`check()` सभी वर्तमान में मिलान करने वाले योग्य नियम लौटाता है। वे अगले पुनः प्रयास संदेश पर बैच के रूप में इंजेक्ट किए जाते हैं।

### एबॉर्ट और कंटिन्यू के बीच

टाइमर विंडो के दौरान, स्थिति बदल सकती है (उपयोगकर्ता रुकावट, मोड क्रियाएं, अतिरिक्त इवेंट)। पुनः प्रयास कॉल सर्वोत्तम-प्रयास है: `agent.continue().catch(() => {})` अनुवर्ती त्रुटियों को निगल लेता है।

## 9. एज केस सारांश

- अमान्य `ttsr_trigger` रेगेक्स: चेतावनी के साथ छोड़ दिया जाता है; अन्य नियम जारी रहते हैं।
- क्षमता परत पर डुप्लिकेट नियम नाम: निम्न-प्राथमिकता वाले डुप्लिकेट पंजीकरण से पहले छायांकित किए जाते हैं।
- मैनेजर परत पर डुप्लिकेट नाम: दूसरा पंजीकरण अनदेखा किया जाता है।
- `contextMode: "keep"`: रिमाइंडर पुनः प्रयास से पहले आंशिक उल्लंघनकारी आउटपुट संदर्भ में बना रह सकता है।
- दोहराव-गैप-के-बाद `turn_end` पर टर्न काउंट वृद्धि पर निर्भर करता है; मध्य-टर्न चंक्स गैप काउंटर को आगे नहीं बढ़ाते।
