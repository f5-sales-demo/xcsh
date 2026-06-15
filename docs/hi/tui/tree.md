---
title: Tree कमांड संदर्भ
description: सत्र इतिहास और वार्तालाप शाखाओं को विज़ुअलाइज़ करने के लिए /tree कमांड संदर्भ।
sidebar:
  order: 4
  label: /tree कमांड
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree` कमांड संदर्भ

`/tree` इंटरएक्टिव **Session Tree** नेविगेटर खोलता है। यह आपको वर्तमान सत्र फ़ाइल में किसी भी प्रविष्टि पर जाने और उस बिंदु से जारी रखने की सुविधा देता है।

यह एक इन-फ़ाइल लीफ़ मूव है, न कि कोई नया सत्र एक्सपोर्ट।

## `/tree` क्या करता है

- वर्तमान सत्र प्रविष्टियों से एक ट्री बनाता है (`SessionManager.getTree()`)
- `TreeSelectorComponent` को कीबोर्ड नेविगेशन, फ़िल्टर और सर्च के साथ खोलता है
- चयन पर, `AgentSession.navigateTree(targetId, { summarize, customInstructions })` को कॉल करता है
- नए लीफ़ पाथ से दृश्यमान चैट को पुनर्निर्मित करता है
- user/custom संदेश चुनते समय वैकल्पिक रूप से एडिटर टेक्स्ट प्रीफ़िल करता है

मुख्य इम्प्लीमेंटेशन:

- `src/modes/controllers/input-controller.ts` (`/tree`, keybinding वायरिंग, double-escape व्यवहार)
- `src/modes/controllers/selector-controller.ts` (tree UI लॉन्च + summary prompt फ्लो)
- `src/modes/components/tree-selector.ts` (नेविगेशन, फ़िल्टर, सर्च, लेबल, रेंडरिंग)
- `src/session/agent-session.ts` (`navigateTree` लीफ़ स्विचिंग + वैकल्पिक सारांश)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, लेबल पर्सिस्टेंस)

## इसे कैसे खोलें

निम्नलिखित में से कोई भी एक ही सेलेक्टर खोलता है:

- `/tree`
- कॉन्फ़िगर किया गया keybinding एक्शन `tree`
- खाली एडिटर पर double-escape जब `doubleEscapeAction = "tree"` (डिफ़ॉल्ट)
- `/branch` जब `doubleEscapeAction = "tree"` (tree सेलेक्टर की ओर रूट करता है, न कि user-only branch picker की ओर)

## Tree UI मॉडल

ट्री को सत्र प्रविष्टि पेरेंट पॉइंटर्स (`id` / `parentId`) से रेंडर किया जाता है।

- बच्चों को टाइमस्टैम्प के अनुसार आरोही क्रम में क्रमबद्ध किया जाता है (पुराने पहले, नए नीचे)
- सक्रिय शाखा (रूट से वर्तमान लीफ़ तक का पाथ) एक बुलेट के साथ चिह्नित होती है
- लेबल (यदि मौजूद हों) नोड टेक्स्ट से पहले `[label]` के रूप में रेंडर होते हैं
- यदि एकाधिक रूट मौजूद हों (अनाथ/टूटी हुई पेरेंट चेन), तो उन्हें एक वर्चुअल ब्रांचिंग रूट के अंतर्गत दिखाया जाता है

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

सेलेक्टर वर्तमान चयन के आसपास पुनः केंद्रित होता है और अधिकतम निम्नलिखित दिखाता है:

- `max(5, floor(terminalHeight / 2))` पंक्तियाँ

## Tree सेलेक्टर के अंदर कीबाइंडिंग

- `Up` / `Down`: चयन को आगे/पीछे ले जाएं (रैप करता है)
- `Left` / `Right`: पेज अप / पेज डाउन
- `Enter`: नोड चुनें
- `Esc`: सर्च सक्रिय होने पर उसे साफ़ करें; अन्यथा सेलेक्टर बंद करें
- `Ctrl+C`: सेलेक्टर बंद करें
- `Type`: सर्च क्वेरी में जोड़ें
- `Backspace`: सर्च कैरेक्टर हटाएं
- `Shift+L`: चयनित प्रविष्टि पर लेबल संपादित करें/साफ़ करें
- `Ctrl+O`: फ़िल्टर को आगे चक्र करें
- `Shift+Ctrl+O`: फ़िल्टर को पीछे चक्र करें
- `Alt+D/T/U/L/A`: सीधे किसी विशिष्ट फ़िल्टर मोड पर जाएं

## फ़िल्टर और सर्च सेमेंटिक्स

फ़िल्टर मोड (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

अधिकांश वार्तालापात्मक नोड दिखाता है, लेकिन बुककीपिंग प्रविष्टि प्रकार छुपाता है:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

`default` के समान, साथ ही `toolResult` संदेश भी छुपाता है।

### `user-only`

केवल `message` प्रविष्टियाँ जहाँ role `user` है।

### `labeled-only`

केवल वे प्रविष्टियाँ जो वर्तमान में किसी लेबल को रिज़ॉल्व करती हैं।

### `all`

सत्र ट्री में सब कुछ, जिसमें बुककीपिंग/custom प्रविष्टियाँ शामिल हैं।

### Tool-only assistant नोड व्यवहार

Assistant संदेश जिनमें **केवल tool calls** हों (कोई टेक्स्ट नहीं) डिफ़ॉल्ट रूप से सभी फ़िल्टर किए गए व्यूज़ में छुपे रहते हैं, जब तक कि:

- संदेश error/aborted न हो (`stopReason` `stop`/`toolUse` न हो), या
- यह वर्तमान लीफ़ न हो (हमेशा दृश्यमान रखा जाता है)

### सर्च व्यवहार

- क्वेरी को स्पेस द्वारा टोकनाइज़ किया जाता है
- मिलान case-insensitive होता है
- सभी टोकन मिलने चाहिए (AND सेमेंटिक्स)
- खोजने योग्य टेक्स्ट में लेबल, role और प्रकार-विशिष्ट कंटेंट शामिल है (संदेश टेक्स्ट, branch summary टेक्स्ट, custom type, tool command स्निपेट, आदि)

## चयन परिणाम (महत्वपूर्ण)

`navigateTree` चयनित प्रविष्टि प्रकार से नए लीफ़ व्यवहार की गणना करता है:

### `user` संदेश चुनना

- नया लीफ़ चयनित प्रविष्टि का `parentId` बन जाता है
- यदि parent `null` है (रूट user संदेश), तो लीफ़ रूट पर रीसेट होता है (`resetLeaf()`)
- चयनित संदेश टेक्स्ट संपादन/पुनः सबमिट के लिए एडिटर में कॉपी हो जाता है

### `custom_message` चुनना

- user संदेशों जैसा ही लीफ़ नियम (`parentId`)
- टेक्स्ट कंटेंट निकाला जाता है और एडिटर में कॉपी होता है

### non-user नोड चुनना (assistant/tool/summary/compaction/custom bookkeeping/आदि)

- नया लीफ़ चयनित नोड id बन जाता है
- एडिटर प्रीफ़िल नहीं होता

### वर्तमान लीफ़ चुनना

- कोई क्रिया नहीं; सेलेक्टर "Already at this point" के साथ बंद होता है

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## स्विच पर सारांश फ्लो

Summary prompt `branchSummary.enabled` (डिफ़ॉल्ट: `false`) द्वारा नियंत्रित होता है।

सक्षम होने पर, नोड चुनने के बाद UI पूछता है:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

फ्लो विवरण:

- Summary prompt में Escape tree सेलेक्टर को पुनः खोलता है
- Custom prompt रद्द करने पर summary choice loop पर वापस लौटता है
- सारांश के दौरान, UI लोडर दिखाता है और `Esc` को `abortBranchSummary()` से बाइंड करता है
- यदि सारांश बीच में रद्द हो, तो tree सेलेक्टर पुनः खुलता है और कोई मूव लागू नहीं होता

`navigateTree` आंतरिक विवरण:

- पुराने लीफ़ से सामान्य पूर्वज तक abandoned-branch प्रविष्टियाँ एकत्र करता है
- `session_before_tree` emit करता है (एक्सटेंशन रद्द कर सकते हैं या सारांश inject कर सकते हैं)
- डिफ़ॉल्ट summarizer का उपयोग केवल तब करता है जब अनुरोध हो और आवश्यक हो
- निम्नलिखित के साथ मूव लागू करता है:
  - `branchWithSummary(...)` जब सारांश मौजूद हो
  - `branch(newLeafId)` सारांश के बिना non-root मूव के लिए
  - `resetLeaf()` सारांश के बिना root मूव के लिए
- पुनर्निर्मित सत्र संदर्भ के साथ agent conversation को बदलता है
- `session_tree` emit करता है

नोट: यदि user सारांश का अनुरोध करता है लेकिन सारांश बनाने के लिए कुछ नहीं है, तो नेविगेशन summary प्रविष्टि बनाए बिना आगे बढ़ता है।

## लेबल

Tree UI में लेबल संपादन `appendLabelChange(targetId, label)` को कॉल करता है।

- non-empty लेबल resolved लेबल सेट/अपडेट करता है
- empty लेबल उसे साफ़ करता है
- लेबल append-only `label` प्रविष्टियों के रूप में संग्रहीत होते हैं
- tree नोड्स resolved लेबल स्थिति प्रदर्शित करते हैं, न कि raw label-entry इतिहास

## `/tree` और संबंधित ऑपरेशन

| ऑपरेशन | स्कोप | परिणाम |
|---|---|---|
| `/tree` | वर्तमान सत्र फ़ाइल | चयनित बिंदु पर लीफ़ मूव करता है (वही फ़ाइल) |
| `/branch` | आमतौर पर वर्तमान सत्र फ़ाइल -> नई सत्र फ़ाइल | डिफ़ॉल्ट रूप से चयनित **user** संदेश से नई सत्र फ़ाइल में ब्रांच करता है; यदि `doubleEscapeAction = "tree"` हो, तो `/branch` tree navigation UI खोलता है |
| `/fork` | पूरा वर्तमान सत्र | सत्र को एक नई persisted सत्र फ़ाइल में डुप्लीकेट करता है |
| `/resume` | सत्र सूची | किसी अन्य सत्र फ़ाइल पर स्विच करता है |

मुख्य अंतर: `/tree` एक सत्र फ़ाइल के अंदर नेविगेशन/पुनःस्थिति उपकरण है। `/branch`, `/fork`, और `/resume` सभी सत्र-फ़ाइल संदर्भ बदलते हैं।

## ऑपरेटर वर्कफ़्लो

### वर्तमान शाखा खोए बिना पहले के user prompt से पुनः चलाएं

1. `/tree`
2. पहले के user संदेश को खोजें/चुनें
3. `No summary` चुनें (या यदि आवश्यक हो तो सारांश करें)
4. एडिटर में प्रीफ़िल्ड टेक्स्ट संपादित करें
5. सबमिट करें

प्रभाव: उसी सत्र फ़ाइल के अंदर चयनित बिंदु से नई शाखा बढ़ती है।

### संदर्भ ब्रेडक्रम्ब के साथ वर्तमान शाखा छोड़ें

1. `branchSummary.enabled` सक्षम करें
2. `/tree` और लक्ष्य नोड चुनें
3. `Summarize` (या custom prompt) चुनें

प्रभाव: जारी रखने से पहले लक्ष्य स्थिति पर एक `branch_summary` प्रविष्टि जोड़ी जाती है।

### छुपी हुई बुककीपिंग प्रविष्टियाँ जाँचें

1. `/tree`
2. `Alt+A` दबाएं (all)
3. `model`, `thinking`, `custom`, या लेबल खोजें

प्रभाव: केवल वार्तालापात्मक नोड्स नहीं, बल्कि पूरी आंतरिक टाइमलाइन देखें।

### बाद की जंप के लिए पिवट पॉइंट बुकमार्क करें

1. `/tree`
2. प्रविष्टि पर जाएं
3. `Shift+L` और लेबल सेट करें
4. बाद में त्वरित जंप के लिए `Alt+L` (`labeled-only`) का उपयोग करें

प्रभाव: टिकाऊ शाखा मील के पत्थरों के बीच तेज़ नेविगेशन।
