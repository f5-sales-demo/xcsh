---
title: सेशन ट्री आर्किटेक्चर
description: >-
  ब्रांचिंग, नेविगेशन, और पैरेंट-चाइल्ड कन्वर्सेशन संबंधों के साथ सेशन ट्री
  आर्किटेक्चर।
sidebar:
  order: 2
  label: ट्री आर्किटेक्चर
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# सेशन ट्री आर्किटेक्चर (वर्तमान)

संदर्भ: [session.md](./session.md)

यह दस्तावेज़ बताता है कि सेशन ट्री नेविगेशन आज कैसे काम करता है: इन-मेमोरी ट्री मॉडल, लीफ मूवमेंट नियम, ब्रांचिंग व्यवहार, और एक्सटेंशन/इवेंट इंटीग्रेशन।

## यह सबसिस्टम क्या है

सेशन को एक append-only एंट्री लॉग के रूप में संग्रहीत किया जाता है, लेकिन रनटाइम व्यवहार ट्री-आधारित है:

- प्रत्येक non-header एंट्री में `id` और `parentId` होता है।
- सक्रिय स्थिति `SessionManager` में `leafId` है।
- किसी एंट्री को append करना हमेशा वर्तमान लीफ का एक चाइल्ड बनाता है।
- ब्रांचिंग इतिहास को **पुनर्लेखित नहीं** करती; यह केवल बदलती है कि अगले append से पहले लीफ कहाँ इंगित करती है।

मुख्य फ़ाइलें:

- `src/session/session-manager.ts` — ट्री डेटा मॉडल, ट्रैवर्सल, लीफ मूवमेंट, ब्रांच/सेशन एक्सट्रैक्शन
- `src/session/agent-session.ts` — `/tree` नेविगेशन फ्लो, सारांशीकरण, हुक/इवेंट एमिशन
- `src/modes/components/tree-selector.ts` — इंटरेक्टिव ट्री UI व्यवहार और फ़िल्टरिंग
- `src/modes/controllers/selector-controller.ts` — `/tree` और `/branch` के लिए सेलेक्टर ऑर्केस्ट्रेशन
- `src/modes/controllers/input-controller.ts` — कमांड रूटिंग (`/tree`, `/branch`, double-escape व्यवहार)
- `src/session/messages.ts` — `branch_summary`, `compaction`, और `custom_message` एंट्रियों का LLM कॉन्टेक्स्ट मैसेजेस में रूपांतरण

## `SessionManager` में ट्री डेटा मॉडल

रनटाइम इंडेक्स:

- `#byId: Map<string, SessionEntry>` — किसी भी एंट्री के लिए त्वरित लुकअप
- `#leafId: string | null` — ट्री में वर्तमान स्थिति
- `#labelsById: Map<string, string>` — टार्गेट एंट्री id द्वारा रिज़ॉल्व्ड लेबल

ट्री APIs:

- `getBranch(fromId?)` पैरेंट लिंक से रूट तक चलता है और रूट→नोड पाथ लौटाता है
- `getTree()` `SessionTreeNode[]` (`entry`, `children`, `label`) लौटाता है
  - पैरेंट लिंक चिल्ड्रेन ऐरे बन जाते हैं
  - गुम पैरेंट वाली एंट्रियों को रूट माना जाता है
  - चिल्ड्रेन टाइमस्टैम्प के अनुसार oldest→newest क्रमबद्ध होते हैं
- `getChildren(parentId)` प्रत्यक्ष चिल्ड्रेन लौटाता है
- `getLabel(id)` `labelsById` से वर्तमान लेबल रिज़ॉल्व करता है

`getTree()` एक रनटाइम प्रोजेक्शन है; परसिस्टेंस append-only JSONL एंट्रियाँ बनी रहती हैं।

## लीफ मूवमेंट सिमेंटिक्स

तीन लीफ मूवमेंट प्रिमिटिव हैं:

1. `branch(entryId)`
   - एंट्री के अस्तित्व को वैलिडेट करता है
   - `leafId = entryId` सेट करता है
   - कोई नई एंट्री नहीं लिखी जाती

2. `resetLeaf()`
   - `leafId = null` सेट करता है
   - अगला append एक नई रूट एंट्री बनाता है (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - `branchFromId: string | null` स्वीकार करता है
   - `leafId = branchFromId` सेट करता है
   - उस लीफ के चाइल्ड के रूप में एक `branch_summary` एंट्री append करता है
   - जब `branchFromId` `null` हो, `fromId` को `"root"` के रूप में persisted किया जाता है

## `/tree` नेविगेशन व्यवहार (समान सेशन फ़ाइल)

`AgentSession.navigateTree()` नेविगेशन है, फ़ाइल फोर्किंग नहीं।

फ्लो:

1. टार्गेट को वैलिडेट करें और abandoned पाथ की गणना करें (`collectEntriesForBranchSummary`)
2. `TreePreparation` के साथ `session_before_tree` एमिट करें
3. वैकल्पिक रूप से abandoned एंट्रियों का सारांश बनाएं (हुक-प्रदत्त सारांश या बिल्ट-इन समराइज़र)
4. नया लीफ टार्गेट कंप्यूट करें:
   - एक **user** मैसेज चुनना: लीफ उसके पैरेंट पर जाती है, और मैसेज टेक्स्ट एडिटर प्रीफिल के लिए लौटाया जाता है
   - एक **custom_message** चुनना: user मैसेज के समान नियम (लीफ = पैरेंट, टेक्स्ट एडिटर को प्रीफिल करता है)
   - कोई अन्य एंट्री चुनना: लीफ = चयनित एंट्री id
5. लीफ मूव लागू करें:
   - सारांश के साथ: `branchWithSummary(newLeafId, ...)`
   - सारांश के बिना और `newLeafId === null`: `resetLeaf()`
   - अन्यथा: `branch(newLeafId)`
6. नई लीफ से एजेंट कॉन्टेक्स्ट पुनर्निर्मित करें और `session_tree` एमिट करें

महत्वपूर्ण: सारांश एंट्रियाँ **नई नेविगेशन स्थिति** पर संलग्न होती हैं, abandoned ब्रांच टेल पर नहीं।

## `/branch` व्यवहार (नई सेशन फ़ाइल)

`/branch` और `/tree` जानबूझकर अलग हैं:

- `/tree` वर्तमान सेशन फ़ाइल के भीतर नेविगेट करता है।
- `/branch` एक नई सेशन ब्रांच फ़ाइल बनाता है (या non-persistent मोड के लिए इन-मेमोरी प्रतिस्थापन)।

यूज़र-फेसिंग `/branch` फ्लो (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- ब्रांच सोर्स एक **user message** होना चाहिए।
- चयनित user टेक्स्ट एडिटर प्रीफिल के लिए एक्सट्रैक्ट किया जाता है।
- यदि चयनित user मैसेज रूट है (`parentId === null`): `newSession({ parentSession: previousSessionFile })` के माध्यम से एक नया सेशन शुरू करें।
- अन्यथा: चयनित प्रॉम्प्ट बाउंड्री तक इतिहास फोर्क करने के लिए `createBranchedSession(selectedEntry.parentId)`।

`SessionManager.createBranchedSession(leafId)` विशेषताएँ:

- `getBranch(leafId)` के माध्यम से रूट→लीफ पाथ बनाता है; गुम होने पर throws करता है।
- कॉपी किए गए पाथ से मौजूदा `label` एंट्रियाँ बाहर करता है।
- उन एंट्रियों के लिए resolved `labelsById` से ताज़ा लेबल एंट्रियाँ पुनर्निर्मित करता है जो पाथ में बनी रहती हैं।
- Persistent मोड: नई JSONL फ़ाइल लिखता है और मैनेजर को उस पर स्विच करता है; नया फ़ाइल पाथ लौटाता है।
- इन-मेमोरी मोड: इन-मेमोरी एंट्रियाँ बदलता है; `undefined` लौटाता है।

## कॉन्टेक्स्ट पुनर्निर्माण और सारांश/कस्टम इंटीग्रेशन

`buildSessionContext()` (`session-manager.ts` में) सक्रिय रूट→लीफ पाथ रिज़ॉल्व करता है और प्रभावी LLM कॉन्टेक्स्ट स्टेट बनाता है:

- पाथ पर नवीनतम thinking/model/mode/ttsr स्टेट ट्रैक करता है।
- पाथ पर नवीनतम compaction को हैंडल करता है:
  - पहले compaction सारांश एमिट करता है
  - `firstKeptEntryId` से compaction पॉइंट तक kept मैसेजेस रीप्ले करता है
  - फिर post-compaction मैसेजेस रीप्ले करता है
- `branch_summary` और `custom_message` एंट्रियों को `AgentMessage` ऑब्जेक्ट के रूप में शामिल करता है।

`session/messages.ts` फिर मॉडल इनपुट के लिए इन मैसेज टाइप को मैप करता है:

- `branchSummary` और `compactionSummary` user-role templated कॉन्टेक्स्ट मैसेजेस बन जाते हैं
- `custom`/`hookMessage` user-role कंटेंट मैसेजेस बन जाते हैं

इस प्रकार ट्री मूवमेंट सक्रिय लीफ पाथ बदलकर कॉन्टेक्स्ट बदलता है, पुरानी एंट्रियों को म्यूटेट करके नहीं।

## लेबल और ट्री UI व्यवहार

लेबल परसिस्टेंस:

- `appendLabelChange(targetId, label?)` वर्तमान लीफ चेन पर `label` एंट्रियाँ लिखता है।
- `labelsById` तुरंत अपडेट होता है (set या delete)।
- `getTree()` प्रत्येक लौटाए गए नोड पर वर्तमान लेबल रिज़ॉल्व करता है।

ट्री सेलेक्टर व्यवहार (`tree-selector.ts`):

- नेविगेशन के लिए ट्री को फ्लैट करता है, active-path हाइलाइटिंग रखता है, और पहले सक्रिय ब्रांच प्रदर्शित करने को प्राथमिकता देता है।
- फ़िल्टर मोड सपोर्ट करता है: `default`, `no-tools`, `user-only`, `labeled-only`, `all`।
- रेंडर किए गए सिमेंटिक कंटेंट पर फ्री-टेक्स्ट सर्च सपोर्ट करता है।
- `Shift+L` इनलाइन लेबल एडिटिंग खोलता है और `appendLabelChange` के माध्यम से लिखता है।

कमांड रूटिंग:

- `/tree` हमेशा ट्री सेलेक्टर खोलता है।
- `/branch` user-message सेलेक्टर खोलता है जब तक `doubleEscapeAction=tree` न हो, उस स्थिति में यह ट्री सेलेक्टर UX भी उपयोग करता है।

## ट्री ऑपरेशन के लिए एक्सटेंशन और हुक टचपॉइंट

कमांड-टाइम एक्सटेंशन API (`ExtensionCommandContext`):

- `branch(entryId)` — branched सेशन फ़ाइल बनाएं
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
  - बिल्ट-इन समराइज़र के बजाय उपयोग किया जाने वाला सारांश पेलोड प्रदान कर सकता है
  - abort `signal` प्राप्त करता है (Escape cancellation पाथ)
- `session_tree`
  - `newLeafId`, `oldLeafId` एमिट करता है
  - सारांश बनाए जाने पर `summaryEntry` शामिल करता है
  - `fromExtension` सारांश उत्पत्ति दर्शाता है

आसन्न लेकिन संबंधित लाइफसाइकिल हुक:

- `/branch` फ्लो के लिए `session_before_branch` / `session_branch`
- compaction एंट्रियों के लिए `session_before_compact`, `session.compacting`, `session_compact` जो बाद में ट्री-कॉन्टेक्स्ट पुनर्निर्माण को प्रभावित करती हैं

## वास्तविक बाधाएँ और एज कंडीशन

- `branch()` `null` को टार्गेट नहीं कर सकता; root-before-first-entry स्टेट के लिए `resetLeaf()` उपयोग करें।
- `branchWithSummary()` `null` टार्गेट सपोर्ट करता है और `fromId: "root"` रिकॉर्ड करता है।
- ट्री सेलेक्टर में वर्तमान लीफ का चयन करना एक no-op है।
- सारांशीकरण के लिए एक सक्रिय मॉडल आवश्यक है; अनुपस्थित होने पर, सारांश नेविगेशन तेज़ी से विफल होता है।
- यदि सारांशीकरण abort किया जाता है, तो नेविगेशन रद्द हो जाता है और लीफ अपरिवर्तित रहती है।
- इन-मेमोरी सेशन `createBranchedSession` से कभी भी ब्रांच फ़ाइल पाथ नहीं लौटाते।

## अभी भी मौजूद लेगेसी संगतता

सेशन माइग्रेशन लोड पर चलती हैं:

- v1→v2 `id`/`parentId` जोड़ता है और compaction इंडेक्स एंकर को id एंकर में बदलता है
- v2→v3 legacy `hookMessage` रोल को `custom` में माइग्रेट करता है

माइग्रेशन के बाद वर्तमान रनटाइम व्यवहार version-3 ट्री सिमेंटिक्स है।
