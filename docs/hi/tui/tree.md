---
title: Tree कमांड संदर्भ
description: सत्र इतिहास और संवाद शाखाओं को विज़ुअलाइज़ करने के लिए /tree कमांड संदर्भ।
sidebar:
  order: 4
  label: /tree कमांड
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree` कमांड संदर्भ

`/tree` इंटरएक्टिव **Session Tree** नेविगेटर खोलता है। यह आपको वर्तमान सत्र फ़ाइल में किसी भी प्रविष्टि पर जाने और वहाँ से जारी रखने की सुविधा देता है।

यह एक इन-फ़ाइल लीफ़ मूव है, न कि कोई नया सत्र निर्यात।

## `/tree` क्या करता है

- वर्तमान सत्र प्रविष्टियों से एक ट्री बनाता है (`SessionManager.getTree()`)
- `TreeSelectorComponent` को कीबोर्ड नेविगेशन, फ़िल्टर और खोज के साथ खोलता है
- चयन पर `AgentSession.navigateTree(targetId, { summarize, customInstructions })` को कॉल करता है
- नए लीफ़ पाथ से दृश्यमान चैट को पुनर्निर्मित करता है
- user/custom मैसेज चुनते समय वैकल्पिक रूप से एडिटर टेक्स्ट प्रीफ़िल करता है

प्राथमिक कार्यान्वयन:

- `src/modes/controllers/input-controller.ts` (`/tree`, कीबाइंडिंग वायरिंग, double-escape व्यवहार)
- `src/modes/controllers/selector-controller.ts` (tree UI लॉन्च + summary prompt फ़्लो)
- `src/modes/components/tree-selector.ts` (नेविगेशन, फ़िल्टर, खोज, लेबल, रेंडरिंग)
- `src/session/agent-session.ts` (`navigateTree` लीफ़ स्विचिंग + वैकल्पिक सारांश)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, लेबल पर्सिस्टेंस)

## इसे कैसे खोलें

निम्नलिखित में से कोई भी एक ही सेलेक्टर खोलता है:

- `/tree`
- कॉन्फ़िगर की गई कीबाइंडिंग एक्शन `tree`
- खाली एडिटर पर double-escape जब `doubleEscapeAction = "tree"` हो (डिफ़ॉल्ट)
- `/branch` जब `doubleEscapeAction = "tree"` हो (user-only branch picker की बजाय tree selector पर रूट करता है)

## Tree UI मॉडल

ट्री सत्र प्रविष्टि पैरेंट पॉइंटर्स (`id` / `parentId`) से रेंडर की जाती है।

- बच्चों को टाइमस्टैम्प के अनुसार आरोही क्रम में क्रमबद्ध किया जाता है (पुराने पहले, नए नीचे)
- सक्रिय शाखा (रूट से वर्तमान लीफ़ तक का पाथ) एक बुलेट के साथ चिह्नित होती है
- लेबल (यदि मौजूद हों) नोड टेक्स्ट से पहले `[label]` के रूप में रेंडर होते हैं
- यदि कई रूट मौजूद हों (अनाथ/टूटी हुई पैरेंट चेन), तो वे एक वर्चुअल ब्रांचिंग रूट के अंतर्गत दिखाए जाते हैं

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

सेलेक्टर वर्तमान चयन के आसपास पुनः केंद्रित होता है और अधिकतम दिखाता है:

- `max(5, floor(terminalHeight / 2))` पंक्तियाँ

## Tree सेलेक्टर में कीबाइंडिंग

- `Up` / `Down`: चयन को स्थानांतरित करें (रैप होता है)
- `Left` / `Right`: पेज अप / पेज डाउन
- `Enter`: नोड चुनें
- `Esc`: सक्रिय होने पर खोज साफ़ करें; अन्यथा सेलेक्टर बंद करें
- `Ctrl+C`: सेलेक्टर बंद करें
- `Type`: खोज क्वेरी में जोड़ें
- `Backspace`: खोज वर्ण हटाएँ
- `Shift+L`: चयनित प्रविष्टि पर लेबल संपादित करें/साफ़ करें
- `Ctrl+O`: फ़िल्टर को आगे साइकल करें
- `Shift+Ctrl+O`: फ़िल्टर को पीछे साइकल करें
- `Alt+D/T/U/L/A`: सीधे विशिष्ट फ़िल्टर मोड पर जाएँ

## फ़िल्टर और खोज सेमेंटिक्स

फ़िल्टर मोड (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

अधिकांश संवादात्मक नोड दिखाता है, लेकिन बुककीपिंग प्रविष्टि प्रकारों को छुपाता है:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

`default` के समान, साथ ही `toolResult` मैसेज भी छुपाता है।

### `user-only`

केवल `message` प्रविष्टियाँ जहाँ role `user` है।

### `labeled-only`

केवल वे प्रविष्टियाँ जो वर्तमान में किसी लेबल पर resolve होती हैं।

### `all`

सत्र ट्री में सब कुछ, बुककीपिंग/custom प्रविष्टियों सहित।

### Tool-only असिस्टेंट नोड व्यवहार

असिस्टेंट मैसेज जिनमें **केवल tool calls** हों (कोई टेक्स्ट नहीं) सभी फ़िल्टर किए गए व्यू में डिफ़ॉल्ट रूप से छुपे होते हैं, जब तक:

- मैसेज error/aborted न हो (`stopReason` `stop`/`toolUse` नहीं है), या
- यह वर्तमान लीफ़ हो (हमेशा दृश्यमान रखा जाता है)

### खोज व्यवहार

- क्वेरी को स्पेस द्वारा टोकनाइज़ किया जाता है
- मिलान केस-इन्सेंसिटिव है
- सभी टोकन मेल खाने चाहिए (AND सेमेंटिक्स)
- खोजने योग्य टेक्स्ट में लेबल, role और प्रकार-विशिष्ट सामग्री शामिल है (मैसेज टेक्स्ट, branch summary टेक्स्ट, custom type, tool command स्निपेट, आदि)

## चयन परिणाम (महत्वपूर्ण)

`navigateTree` चयनित प्रविष्टि प्रकार से नया लीफ़ व्यवहार कंप्यूट करता है:

### `user` मैसेज चुनना

- नया लीफ़ चयनित प्रविष्टि का `parentId` बनता है
- यदि parent `null` हो (रूट user मैसेज), तो लीफ़ रूट पर रीसेट होता है (`resetLeaf()`)
- चयनित मैसेज टेक्स्ट संपादन/पुनः सबमिट के लिए एडिटर में कॉपी होता है

### `custom_message` चुनना

- user मैसेज के समान लीफ़ नियम (`parentId`)
- टेक्स्ट सामग्री निकाली जाती है और एडिटर में कॉपी होती है

### non-user नोड चुनना (assistant/tool/summary/compaction/custom bookkeeping/आदि)

- नया लीफ़ चयनित नोड id बनता है
- एडिटर प्रीफ़िल नहीं होता

### वर्तमान लीफ़ चुनना

- No-op; सेलेक्टर "Already at this point" के साथ बंद होता है

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

## स्विच पर सारांश फ़्लो

Summary prompt `branchSummary.enabled` (डिफ़ॉल्ट: `false`) द्वारा नियंत्रित होता है।

सक्षम होने पर, नोड चुनने के बाद UI पूछता है:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

फ़्लो विवरण:

- Summary prompt में Escape tree सेलेक्टर पुनः खोलता है
- Custom prompt रद्दीकरण summary choice लूप पर वापस आता है
- सारांशीकरण के दौरान, UI लोडर दिखाता है और `Esc` को `abortBranchSummary()` से बाइंड करता है
- यदि सारांशीकरण रद्द हो, tree सेलेक्टर पुनः खुलता है और कोई मूव लागू नहीं होता

`navigateTree` इंटर्नल:

- पुराने लीफ़ से common ancestor तक की abandoned-branch प्रविष्टियाँ एकत्र करता है
- `session_before_tree` emit करता है (एक्सटेंशन रद्द कर सकते हैं या सारांश inject कर सकते हैं)
- केवल अनुरोध और आवश्यकता पर डिफ़ॉल्ट सारांशकर्ता का उपयोग करता है
- इनके साथ मूव लागू करता है:
  - `branchWithSummary(...)` जब सारांश मौजूद हो
  - `branch(newLeafId)` सारांश के बिना non-root मूव के लिए
  - `resetLeaf()` सारांश के बिना root मूव के लिए
- एजेंट संवाद को पुनर्निर्मित सत्र संदर्भ से बदलता है
- `session_tree` emit करता है

नोट: यदि user सारांश का अनुरोध करता है लेकिन सारांश करने के लिए कुछ नहीं है, तो नेविगेशन summary प्रविष्टि बनाए बिना आगे बढ़ता है।

## लेबल

Tree UI में लेबल संपादन `appendLabelChange(targetId, label)` को कॉल करते हैं।

- non-empty लेबल resolved लेबल सेट/अपडेट करता है
- empty लेबल इसे साफ़ करता है
- लेबल append-only `label` प्रविष्टियों के रूप में संग्रहीत होते हैं
- ट्री नोड resolved लेबल स्थिति दिखाते हैं, raw label-entry इतिहास नहीं

## `/tree` बनाम संबंधित ऑपरेशन

| ऑपरेशन | दायरा | परिणाम |
|---|---|---|
| `/tree` | वर्तमान सत्र फ़ाइल | चयनित बिंदु पर लीफ़ मूव करता है (वही फ़ाइल) |
| `/branch` | आमतौर पर वर्तमान सत्र फ़ाइल -> नई सत्र फ़ाइल | डिफ़ॉल्ट रूप से चयनित **user** मैसेज से नई सत्र फ़ाइल में ब्रांच करता है; यदि `doubleEscapeAction = "tree"` हो, तो `/branch` tree navigation UI खोलता है |
| `/fork` | पूरा वर्तमान सत्र | सत्र को एक नई persisted सत्र फ़ाइल में डुप्लिकेट करता है |
| `/resume` | सत्र सूची | किसी अन्य सत्र फ़ाइल पर स्विच करता है |

मुख्य अंतर: `/tree` एक सत्र फ़ाइल के अंदर नेविगेशन/पुनर्स्थापन उपकरण है। `/branch`, `/fork`, और `/resume` सभी सत्र-फ़ाइल संदर्भ बदलते हैं।

## ऑपरेटर वर्कफ़्लो

### वर्तमान शाखा खोए बिना पहले के user prompt से पुनः चलाएँ

1. `/tree`
2. पहले का user मैसेज खोजें/चुनें
3. `No summary` चुनें (या आवश्यकता हो तो सारांश करें)
4. एडिटर में प्रीफ़िल्ड टेक्स्ट संपादित करें
5. सबमिट करें

प्रभाव: उसी सत्र फ़ाइल में चयनित बिंदु से नई शाखा बढ़ती है।

### संदर्भ breadcrumb के साथ वर्तमान शाखा छोड़ें

1. `branchSummary.enabled` सक्षम करें
2. `/tree` और लक्ष्य नोड चुनें
3. `Summarize` (या custom prompt) चुनें

प्रभाव: जारी रखने से पहले लक्ष्य स्थान पर `branch_summary` प्रविष्टि जोड़ी जाती है।

### छुपी हुई बुककीपिंग प्रविष्टियाँ जाँचें

1. `/tree`
2. `Alt+A` दबाएँ (all)
3. `model`, `thinking`, `custom`, या लेबल खोजें

प्रभाव: केवल संवादात्मक नोड नहीं, बल्कि पूरी आंतरिक टाइमलाइन जाँचें।

### बाद की जंप के लिए पिवट बिंदु बुकमार्क करें

1. `/tree`
2. प्रविष्टि पर जाएँ
3. `Shift+L` और लेबल सेट करें
4. बाद में `Alt+L` (`labeled-only`) का उपयोग करके जल्दी जाएँ

प्रभाव: टिकाऊ शाखा landmarks के बीच तेज़ नेविगेशन।
