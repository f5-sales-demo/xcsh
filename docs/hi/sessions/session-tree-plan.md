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

# सेशन ट्री आर्किटेक्चर (वर्तमान)

संदर्भ: [session.md](./session.md)

यह दस्तावेज़ वर्णन करता है कि सेशन ट्री नेविगेशन आज कैसे काम करता है: इन-मेमोरी ट्री मॉडल, लीफ मूवमेंट नियम, ब्रांचिंग व्यवहार, और एक्सटेंशन/इवेंट इंटीग्रेशन।

## यह सबसिस्टम क्या है

सेशन एक append-only एंट्री लॉग के रूप में संग्रहीत होता है, लेकिन रनटाइम व्यवहार ट्री-आधारित है:

- हर नॉन-हेडर एंट्री में `id` और `parentId` होता है।
- सक्रिय स्थिति `SessionManager` में `leafId` है।
- एंट्री जोड़ना हमेशा वर्तमान लीफ का चाइल्ड बनाता है।
- ब्रांचिंग इतिहास को **पुनर्लेखित नहीं** करती; यह केवल अगले append से पहले लीफ की पॉइंटिंग स्थिति बदलती है।

मुख्य फाइलें:

- `src/session/session-manager.ts` — ट्री डेटा मॉडल, ट्रैवर्सल, लीफ मूवमेंट, ब्रांच/सेशन एक्सट्रैक्शन
- `src/session/agent-session.ts` — `/tree` नेविगेशन फ्लो, सारांशीकरण, हुक/इवेंट एमिशन
- `src/modes/components/tree-selector.ts` — इंटरैक्टिव ट्री UI व्यवहार और फिल्टरिंग
- `src/modes/controllers/selector-controller.ts` — `/tree` और `/branch` के लिए सिलेक्टर ऑर्केस्ट्रेशन
- `src/modes/controllers/input-controller.ts` — कमांड राउटिंग (`/tree`, `/branch`, डबल-एस्केप व्यवहार)
- `src/session/messages.ts` — `branch_summary`, `compaction`, और `custom_message` एंट्रीज़ का LLM कॉन्टेक्स्ट मैसेज में रूपांतरण

## `SessionManager` में ट्री डेटा मॉडल

रनटाइम इंडेक्स:

- `#byId: Map<string, SessionEntry>` — किसी भी एंट्री के लिए तेज़ लुकअप
- `#leafId: string | null` — ट्री में वर्तमान स्थिति
- `#labelsById: Map<string, string>` — लक्ष्य एंट्री id के अनुसार रिज़ॉल्व्ड लेबल

ट्री APIs:

- `getBranch(fromId?)` पैरेंट लिंक्स के माध्यम से रूट तक चलता है और रूट→नोड पथ लौटाता है
- `getTree()` `SessionTreeNode[]` (`entry`, `children`, `label`) लौटाता है
  - पैरेंट लिंक्स चिल्ड्रन एरेज़ बन जाते हैं
  - गायब पैरेंट वाली एंट्रीज़ को रूट माना जाता है
  - चिल्ड्रन टाइमस्टैम्प के अनुसार पुराने→नए क्रम में सॉर्ट होते हैं
- `getChildren(parentId)` प्रत्यक्ष चिल्ड्रन लौटाता है
- `getLabel(id)` `labelsById` से वर्तमान लेबल रिज़ॉल्व करता है

`getTree()` एक रनटाइम प्रोजेक्शन है; पर्सिस्टेंस append-only JSONL एंट्रीज़ बनी रहती है।

## लीफ मूवमेंट सिमेंटिक्स

तीन लीफ मूवमेंट प्रिमिटिव्स हैं:

1. `branch(entryId)`
   - एंट्री के अस्तित्व की पुष्टि करता है
   - `leafId = entryId` सेट करता है
   - कोई नई एंट्री नहीं लिखी जाती

2. `resetLeaf()`
   - `leafId = null` सेट करता है
   - अगला append एक नई रूट एंट्री बनाता है (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - `branchFromId: string | null` स्वीकार करता है
   - `leafId = branchFromId` सेट करता है
   - उस लीफ के चाइल्ड के रूप में एक `branch_summary` एंट्री जोड़ता है
   - जब `branchFromId` `null` हो, तो `fromId` `"root"` के रूप में पर्सिस्ट होता है

## `/tree` नेविगेशन व्यवहार (समान सेशन फाइल)

`AgentSession.navigateTree()` नेविगेशन है, फाइल फोर्किंग नहीं।

फ्लो:

1. लक्ष्य की पुष्टि करें और परित्यक्त पथ की गणना करें (`collectEntriesForBranchSummary`)
2. `TreePreparation` के साथ `session_before_tree` एमिट करें
3. वैकल्पिक रूप से परित्यक्त एंट्रीज़ का सारांश बनाएं (हुक-प्रदत्त सारांश या बिल्ट-इन सारांशकर्ता)
4. नया लीफ लक्ष्य गणना करें:
   - **user** मैसेज चुनना: लीफ उसके पैरेंट पर जाती है, और मैसेज टेक्स्ट एडिटर प्रीफिल के लिए लौटाया जाता है
   - **custom_message** चुनना: user मैसेज के समान नियम (लीफ = पैरेंट, टेक्स्ट एडिटर प्रीफिल करता है)
   - कोई अन्य एंट्री चुनना: लीफ = चयनित एंट्री id
5. लीफ मूव लागू करें:
   - सारांश के साथ: `branchWithSummary(newLeafId, ...)`
   - बिना सारांश और `newLeafId === null`: `resetLeaf()`
   - अन्यथा: `branch(newLeafId)`
6. नई लीफ से एजेंट कॉन्टेक्स्ट पुनर्निर्मित करें और `session_tree` एमिट करें

महत्वपूर्ण: सारांश एंट्रीज़ **नई नेविगेशन स्थिति** पर जोड़ी जाती हैं, परित्यक्त ब्रांच के अंत पर नहीं।

## `/branch` व्यवहार (नई सेशन फाइल)

`/branch` और `/tree` जानबूझकर अलग हैं:

- `/tree` वर्तमान सेशन फाइल के भीतर नेविगेट करता है।
- `/branch` एक नई सेशन ब्रांच फाइल बनाता है (या नॉन-पर्सिस्टेंट मोड के लिए इन-मेमोरी रिप्लेसमेंट)।

उपयोगकर्ता-सामने `/branch` फ्लो (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- ब्रांच स्रोत एक **user मैसेज** होना चाहिए।
- चयनित user टेक्स्ट एडिटर प्रीफिल के लिए एक्सट्रैक्ट किया जाता है।
- यदि चयनित user मैसेज रूट है (`parentId === null`): `newSession({ parentSession: previousSessionFile })` के माध्यम से नया सेशन शुरू करें।
- अन्यथा: चयनित प्रॉम्प्ट सीमा तक इतिहास फोर्क करने के लिए `createBranchedSession(selectedEntry.parentId)`।

`SessionManager.createBranchedSession(leafId)` विवरण:

- `getBranch(leafId)` के माध्यम से रूट→लीफ पथ बनाता है; यदि गायब हो तो त्रुटि फेंकता है।
- कॉपी किए गए पथ से मौजूदा `label` एंट्रीज़ को बाहर रखता है।
- पथ में शेष एंट्रीज़ के लिए रिज़ॉल्व्ड `labelsById` से ताज़ा लेबल एंट्रीज़ पुनर्निर्मित करता है।
- पर्सिस्टेंट मोड: नई JSONL फाइल लिखता है और मैनेजर को उसमें स्विच करता है; नया फाइल पथ लौटाता है।
- इन-मेमोरी मोड: इन-मेमोरी एंट्रीज़ को बदलता है; `undefined` लौटाता है।

## कॉन्टेक्स्ट पुनर्निर्माण और सारांश/कस्टम इंटीग्रेशन

`buildSessionContext()` (`session-manager.ts` में) सक्रिय रूट→लीफ पथ रिज़ॉल्व करता है और प्रभावी LLM कॉन्टेक्स्ट स्टेट बनाता है:

- पथ पर नवीनतम thinking/model/mode/ttsr स्टेट ट्रैक करता है।
- पथ पर नवीनतम compaction हैंडल करता है:
  - पहले compaction सारांश एमिट करता है
  - `firstKeptEntryId` से compaction बिंदु तक रखे गए मैसेज रीप्ले करता है
  - फिर post-compaction मैसेज रीप्ले करता है
- `branch_summary` और `custom_message` एंट्रीज़ को `AgentMessage` ऑब्जेक्ट्स के रूप में शामिल करता है।

`session/messages.ts` फिर इन मैसेज प्रकारों को मॉडल इनपुट के लिए मैप करता है:

- `branchSummary` और `compactionSummary` user-role टेम्पलेटेड कॉन्टेक्स्ट मैसेज बनते हैं
- `custom`/`hookMessage` user-role कंटेंट मैसेज बनते हैं

तो ट्री मूवमेंट सक्रिय लीफ पथ बदलकर कॉन्टेक्स्ट बदलता है, पुरानी एंट्रीज़ को म्यूटेट करके नहीं।

## लेबल और ट्री UI व्यवहार

लेबल पर्सिस्टेंस:

- `appendLabelChange(targetId, label?)` वर्तमान लीफ चेन पर `label` एंट्रीज़ लिखता है।
- `labelsById` तुरंत अपडेट होता है (सेट या डिलीट)।
- `getTree()` प्रत्येक लौटाए गए नोड पर वर्तमान लेबल रिज़ॉल्व करता है।

ट्री सिलेक्टर व्यवहार (`tree-selector.ts`):

- नेविगेशन के लिए ट्री को फ्लैट करता है, सक्रिय-पथ हाइलाइटिंग रखता है, और सक्रिय ब्रांच को पहले प्रदर्शित करने को प्राथमिकता देता है।
- फिल्टर मोड सपोर्ट करता है: `default`, `no-tools`, `user-only`, `labeled-only`, `all`।
- रेंडर किए गए सिमेंटिक कंटेंट पर फ्री-टेक्स्ट सर्च सपोर्ट करता है।
- `Shift+L` इनलाइन लेबल एडिटिंग खोलता है और `appendLabelChange` के माध्यम से लिखता है।

कमांड राउटिंग:

- `/tree` हमेशा ट्री सिलेक्टर खोलता है।
- `/branch` user-मैसेज सिलेक्टर खोलता है जब तक कि `doubleEscapeAction=tree` न हो, उस स्थिति में यह ट्री सिलेक्टर UX का भी उपयोग करता है।

## ट्री ऑपरेशंस के लिए एक्सटेंशन और हुक टचपॉइंट्स

कमांड-टाइम एक्सटेंशन API (`ExtensionCommandContext`):

- `branch(entryId)` — ब्रांच्ड सेशन फाइल बनाएं
- `navigateTree(targetId, { summarize? })` — वर्तमान ट्री/फाइल के भीतर नेविगेट करें

ट्री नेविगेशन से संबंधित इवेंट्स:

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
  - `newLeafId`, `oldLeafId` एमिट करता है
  - जब सारांश बनाया गया हो तो `summaryEntry` शामिल करता है
  - `fromExtension` सारांश मूल इंगित करता है

संबद्ध लेकिन संबंधित लाइफसाइकल हुक्स:

- `/branch` फ्लो के लिए `session_before_branch` / `session_branch`
- compaction एंट्रीज़ के लिए `session_before_compact`, `session.compacting`, `session_compact` जो बाद में ट्री-कॉन्टेक्स्ट पुनर्निर्माण को प्रभावित करती हैं

## वास्तविक बाधाएं और एज कंडीशन

- `branch()` `null` को लक्षित नहीं कर सकता; पहली-एंट्री-से-पहले-रूट स्थिति के लिए `resetLeaf()` का उपयोग करें।
- `branchWithSummary()` `null` लक्ष्य सपोर्ट करता है और `fromId: "root"` रिकॉर्ड करता है।
- ट्री सिलेक्टर में वर्तमान लीफ चुनना नो-ऑप है।
- सारांशीकरण के लिए एक सक्रिय मॉडल आवश्यक है; यदि अनुपस्थित हो, तो सारांश नेविगेशन तुरंत विफल हो जाता है।
- यदि सारांशीकरण निरस्त हो जाता है, तो नेविगेशन रद्द हो जाता है और लीफ अपरिवर्तित रहती है।
- इन-मेमोरी सेशन `createBranchedSession` से कभी ब्रांच फाइल पथ नहीं लौटाते।

## अभी भी मौजूद लेगेसी संगतता

सेशन माइग्रेशन लोड पर अभी भी चलते हैं:

- v1→v2 `id`/`parentId` जोड़ता है और compaction इंडेक्स एंकर को id एंकर में बदलता है
- v2→v3 लेगेसी `hookMessage` रोल को `custom` में माइग्रेट करता है

वर्तमान रनटाइम व्यवहार माइग्रेशन के बाद वर्शन-3 ट्री सिमेंटिक्स है।
