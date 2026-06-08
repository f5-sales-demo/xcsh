---
title: Session Tree Architecture
description: >-
  Session tree architecture with branching, navigation, and parent-child
  conversation relationships.
sidebar:
  order: 2
  label: Tree architecture
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# सत्र ट्री आर्किटेक्चर (वर्तमान)

संदर्भ: [session.md](./session.md)

यह दस्तावेज़ बताता है कि सत्र ट्री नेविगेशन आज कैसे कार्य करता है: इन-मेमोरी ट्री मॉडल, लीफ मूवमेंट नियम, ब्रांचिंग व्यवहार, और एक्सटेंशन/इवेंट एकीकरण।

## यह सबसिस्टम क्या है

सत्र एक append-only एंट्री लॉग के रूप में संग्रहीत होता है, लेकिन रनटाइम व्यवहार ट्री-आधारित है:

- प्रत्येक गैर-हेडर एंट्री में `id` और `parentId` होता है।
- सक्रिय स्थिति `SessionManager` में `leafId` है।
- एंट्री जोड़ना हमेशा वर्तमान लीफ की चाइल्ड बनाता है।
- ब्रांचिंग इतिहास को **पुनर्लिखित नहीं** करती; यह केवल अगले append से पहले लीफ की स्थिति बदलती है।

मुख्य फ़ाइलें:

- `src/session/session-manager.ts` — ट्री डेटा मॉडल, ट्रैवर्सल, लीफ मूवमेंट, ब्रांच/सत्र निष्कर्षण
- `src/session/agent-session.ts` — `/tree` नेविगेशन फ्लो, सारांशीकरण, हुक/इवेंट उत्सर्जन
- `src/modes/components/tree-selector.ts` — इंटरैक्टिव ट्री UI व्यवहार और फ़िल्टरिंग
- `src/modes/controllers/selector-controller.ts` — `/tree` और `/branch` के लिए सेलेक्टर ऑर्केस्ट्रेशन
- `src/modes/controllers/input-controller.ts` — कमांड राउटिंग (`/tree`, `/branch`, डबल-एस्केप व्यवहार)
- `src/session/messages.ts` — `branch_summary`, `compaction`, और `custom_message` एंट्रीज़ को LLM कॉन्टेक्स्ट संदेशों में रूपांतरण

## `SessionManager` में ट्री डेटा मॉडल

रनटाइम इंडेक्स:

- `#byId: Map<string, SessionEntry>` — किसी भी एंट्री के लिए तीव्र लुकअप
- `#leafId: string | null` — ट्री में वर्तमान स्थिति
- `#labelsById: Map<string, string>` — लक्ष्य एंट्री id द्वारा रिज़ॉल्व्ड लेबल

ट्री APIs:

- `getBranch(fromId?)` पैरेंट लिंक्स को रूट तक ट्रैवर्स करता है और रूट→नोड पथ लौटाता है
- `getTree()` `SessionTreeNode[]` (`entry`, `children`, `label`) लौटाता है
  - पैरेंट लिंक्स चिल्ड्रन ऐरे बन जाते हैं
  - गायब पैरेंट वाली एंट्रीज़ को रूट के रूप में माना जाता है
  - चिल्ड्रन टाइमस्टैम्प के अनुसार पुराने→नए क्रम में सॉर्ट होते हैं
- `getChildren(parentId)` प्रत्यक्ष चिल्ड्रन लौटाता है
- `getLabel(id)` `labelsById` से वर्तमान लेबल रिज़ॉल्व करता है

`getTree()` एक रनटाइम प्रक्षेपण है; स्थायित्व append-only JSONL एंट्रीज़ के रूप में बना रहता है।

## लीफ मूवमेंट सिमेंटिक्स

तीन लीफ मूवमेंट प्रिमिटिव हैं:

1. `branch(entryId)`
   - एंट्री के अस्तित्व को सत्यापित करता है
   - `leafId = entryId` सेट करता है
   - कोई नई एंट्री नहीं लिखी जाती

2. `resetLeaf()`
   - `leafId = null` सेट करता है
   - अगला append एक नई रूट एंट्री बनाता है (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - `branchFromId: string | null` स्वीकार करता है
   - `leafId = branchFromId` सेट करता है
   - उस लीफ की चाइल्ड के रूप में `branch_summary` एंट्री जोड़ता है
   - जब `branchFromId` `null` होता है, तो `fromId` को `"root"` के रूप में संग्रहीत किया जाता है

## `/tree` नेविगेशन व्यवहार (समान सत्र फ़ाइल)

`AgentSession.navigateTree()` नेविगेशन है, फ़ाइल फोर्किंग नहीं।

फ्लो:

1. लक्ष्य को सत्यापित करें और परित्यक्त पथ की गणना करें (`collectEntriesForBranchSummary`)
2. `TreePreparation` के साथ `session_before_tree` उत्सर्जित करें
3. वैकल्पिक रूप से परित्यक्त एंट्रीज़ का सारांश बनाएं (हुक-प्रदत्त सारांश या बिल्ट-इन सारांशकर्ता)
4. नया लीफ लक्ष्य गणना करें:
   - **user** संदेश का चयन: लीफ उसके पैरेंट पर जाती है, और संदेश टेक्स्ट एडिटर प्रीफिल के लिए लौटाया जाता है
   - **custom_message** का चयन: user संदेश के समान नियम (लीफ = पैरेंट, टेक्स्ट एडिटर में प्रीफिल)
   - किसी अन्य एंट्री का चयन: लीफ = चयनित एंट्री id
5. लीफ मूव लागू करें:
   - सारांश के साथ: `branchWithSummary(newLeafId, ...)`
   - सारांश के बिना और `newLeafId === null`: `resetLeaf()`
   - अन्यथा: `branch(newLeafId)`
6. नई लीफ से एजेंट कॉन्टेक्स्ट पुनर्निर्माण करें और `session_tree` उत्सर्जित करें

महत्वपूर्ण: सारांश एंट्रीज़ **नई नेविगेशन स्थिति** पर जोड़ी जाती हैं, परित्यक्त ब्रांच के अंतिम छोर पर नहीं।

## `/branch` व्यवहार (नई सत्र फ़ाइल)

`/branch` और `/tree` जानबूझकर अलग हैं:

- `/tree` वर्तमान सत्र फ़ाइल के भीतर नेविगेट करता है।
- `/branch` एक नई सत्र ब्रांच फ़ाइल बनाता है (या गैर-स्थायी मोड के लिए इन-मेमोरी प्रतिस्थापन)।

उपयोगकर्ता-सामने `/branch` फ्लो (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- ब्रांच स्रोत एक **user संदेश** होना चाहिए।
- चयनित user टेक्स्ट एडिटर प्रीफिल के लिए निकाला जाता है।
- यदि चयनित user संदेश रूट है (`parentId === null`): `newSession({ parentSession: previousSessionFile })` द्वारा नया सत्र शुरू करें।
- अन्यथा: चयनित प्रॉम्प्ट सीमा तक इतिहास फोर्क करने के लिए `createBranchedSession(selectedEntry.parentId)`।

`SessionManager.createBranchedSession(leafId)` विशेषताएं:

- `getBranch(leafId)` द्वारा रूट→लीफ पथ बनाता है; गायब होने पर त्रुटि फेंकता है।
- कॉपी किए गए पथ से मौजूदा `label` एंट्रीज़ को बाहर रखता है।
- पथ में शेष एंट्रीज़ के लिए रिज़ॉल्व्ड `labelsById` से ताज़ा लेबल एंट्रीज़ पुनर्निर्माण करता है।
- स्थायी मोड: नई JSONL फ़ाइल लिखता है और मैनेजर को उसमें स्विच करता है; नया फ़ाइल पथ लौटाता है।
- इन-मेमोरी मोड: इन-मेमोरी एंट्रीज़ प्रतिस्थापित करता है; `undefined` लौटाता है।

## कॉन्टेक्स्ट पुनर्निर्माण और सारांश/कस्टम एकीकरण

`buildSessionContext()` (`session-manager.ts` में) सक्रिय रूट→लीफ पथ को रिज़ॉल्व करता है और प्रभावी LLM कॉन्टेक्स्ट स्थिति बनाता है:

- पथ पर नवीनतम thinking/model/mode/ttsr स्थिति ट्रैक करता है।
- पथ पर नवीनतम compaction संभालता है:
  - पहले compaction सारांश उत्सर्जित करता है
  - `firstKeptEntryId` से compaction बिंदु तक रखे गए संदेश रीप्ले करता है
  - फिर compaction के बाद के संदेश रीप्ले करता है
- `branch_summary` और `custom_message` एंट्रीज़ को `AgentMessage` ऑब्जेक्ट्स के रूप में शामिल करता है।

`session/messages.ts` फिर मॉडल इनपुट के लिए इन संदेश प्रकारों को मैप करता है:

- `branchSummary` और `compactionSummary` user-role टेम्पलेटेड कॉन्टेक्स्ट संदेश बनते हैं
- `custom`/`hookMessage` user-role कंटेंट संदेश बनते हैं

इसलिए ट्री मूवमेंट सक्रिय लीफ पथ बदलकर कॉन्टेक्स्ट बदलता है, पुरानी एंट्रीज़ को म्यूटेट करके नहीं।

## लेबल और ट्री UI व्यवहार

लेबल स्थायित्व:

- `appendLabelChange(targetId, label?)` वर्तमान लीफ चेन पर `label` एंट्रीज़ लिखता है।
- `labelsById` तुरंत अपडेट होता है (सेट या डिलीट)।
- `getTree()` प्रत्येक लौटाए गए नोड पर वर्तमान लेबल रिज़ॉल्व करता है।

ट्री सेलेक्टर व्यवहार (`tree-selector.ts`):

- नेविगेशन के लिए ट्री को सपाट करता है, सक्रिय-पथ हाइलाइटिंग रखता है, और सक्रिय ब्रांच को पहले प्रदर्शित करने को प्राथमिकता देता है।
- फ़िल्टर मोड समर्थित: `default`, `no-tools`, `user-only`, `labeled-only`, `all`।
- रेंडर किए गए सिमेंटिक कंटेंट पर फ्री-टेक्स्ट खोज समर्थित।
- `Shift+L` इनलाइन लेबल संपादन खोलता है और `appendLabelChange` द्वारा लिखता है।

कमांड राउटिंग:

- `/tree` हमेशा ट्री सेलेक्टर खोलता है।
- `/branch` user-message सेलेक्टर खोलता है जब तक कि `doubleEscapeAction=tree` न हो, उस स्थिति में यह ट्री सेलेक्टर UX का भी उपयोग करता है।

## ट्री संचालन के लिए एक्सटेंशन और हुक टचपॉइंट

कमांड-टाइम एक्सटेंशन API (`ExtensionCommandContext`):

- `branch(entryId)` — ब्रांच्ड सत्र फ़ाइल बनाएं
- `navigateTree(targetId, { summarize? })` — वर्तमान ट्री/फ़ाइल के भीतर जाएं

ट्री नेविगेशन के आसपास इवेंट:

- `session_before_tree`
  - `TreePreparation` प्राप्त करता है:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - नेविगेशन रद्द कर सकता है
  - बिल्ट-इन सारांशकर्ता के बजाय उपयोग किया जाने वाला सारांश पेलोड प्रदान कर सकता है
  - abort `signal` प्राप्त करता है (Escape रद्दीकरण पथ)
- `session_tree`
  - `newLeafId`, `oldLeafId` उत्सर्जित करता है
  - जब सारांश बनाया गया हो तो `summaryEntry` शामिल करता है
  - `fromExtension` सारांश मूल को इंगित करता है

संबंधित लेकिन निकटवर्ती जीवनचक्र हुक:

- `/branch` फ्लो के लिए `session_before_branch` / `session_branch`
- compaction एंट्रीज़ के लिए `session_before_compact`, `session.compacting`, `session_compact` जो बाद में ट्री-कॉन्टेक्स्ट पुनर्निर्माण को प्रभावित करती हैं

## वास्तविक बाधाएं और सीमा स्थितियां

- `branch()` `null` को लक्षित नहीं कर सकता; पहली-एंट्री-से-पहले-रूट स्थिति के लिए `resetLeaf()` का उपयोग करें।
- `branchWithSummary()` `null` लक्ष्य समर्थित करता है और `fromId: "root"` रिकॉर्ड करता है।
- ट्री सेलेक्टर में वर्तमान लीफ का चयन no-op है।
- सारांशीकरण के लिए सक्रिय मॉडल आवश्यक है; यदि अनुपस्थित है, तो सारांश नेविगेशन तुरंत विफल होता है।
- यदि सारांशीकरण निरस्त हो जाता है, तो नेविगेशन रद्द हो जाता है और लीफ अपरिवर्तित रहती है।
- इन-मेमोरी सत्र `createBranchedSession` से कभी ब्रांच फ़ाइल पथ नहीं लौटाते।

## अभी भी मौजूद विरासत संगतता

लोड पर सत्र माइग्रेशन अभी भी चलते हैं:

- v1→v2 `id`/`parentId` जोड़ता है और compaction इंडेक्स एंकर को id एंकर में रूपांतरित करता है
- v2→v3 विरासत `hookMessage` रोल को `custom` में माइग्रेट करता है

माइग्रेशन के बाद वर्तमान रनटाइम व्यवहार संस्करण-3 ट्री सिमेंटिक्स है।
