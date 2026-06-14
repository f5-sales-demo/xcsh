---
title: कॉम्पैक्शन और ब्रांच सारांश
description: लंबे सत्रों के लिए संदर्भ विंडो कॉम्पैक्शन और ब्रांच सारांश निर्माण।
sidebar:
  order: 5
  label: कॉम्पैक्शन
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# कॉम्पैक्शन और ब्रांच सारांश

कॉम्पैक्शन और ब्रांच सारांश दो ऐसे तंत्र हैं जो लंबे सत्रों को पूर्व कार्य संदर्भ खोए बिना उपयोगी बनाए रखते हैं।

- **कॉम्पैक्शन** वर्तमान ब्रांच पर पुराने इतिहास को एक सारांश में पुनर्लेखित करता है।
- **ब्रांच सारांश** `/tree` नेविगेशन के दौरान छोड़े गए ब्रांच संदर्भ को संरक्षित करता है।

दोनों को सत्र प्रविष्टियों के रूप में संग्रहीत किया जाता है और LLM इनपुट पुनर्निर्माण के समय उपयोगकर्ता-संदर्भ संदेशों में वापस परिवर्तित किया जाता है।

## मुख्य कार्यान्वयन फ़ाइलें

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## सत्र प्रविष्टि मॉडल

कॉम्पैक्शन और ब्रांच सारांश प्रथम-श्रेणी सत्र प्रविष्टियाँ हैं, न कि सामान्य assistant/user संदेश।

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, वैकल्पिक `shortSummary`
  - `firstKeptEntryId` (कॉम्पैक्शन सीमा)
  - `tokensBefore`
  - वैकल्पिक `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - वैकल्पिक `details`, `fromExtension`

जब संदर्भ पुनर्निर्मित होता है (`buildSessionContext`):

1. सक्रिय पथ पर नवीनतम कॉम्पैक्शन को एक `compactionSummary` संदेश में परिवर्तित किया जाता है।
2. `firstKeptEntryId` से कॉम्पैक्शन बिंदु तक की रखी गई प्रविष्टियाँ पुनः शामिल की जाती हैं।
3. पथ पर बाद की प्रविष्टियाँ जोड़ी जाती हैं।
4. `branch_summary` प्रविष्टियाँ `branchSummary` संदेशों में परिवर्तित होती हैं।
5. `custom_message` प्रविष्टियाँ `custom` संदेशों में परिवर्तित होती हैं।

उन कस्टम भूमिकाओं को `convertToLlm()` में स्थिर टेम्प्लेट का उपयोग करके LLM-सामना करने वाले उपयोगकर्ता संदेशों में बदला जाता है:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## कॉम्पैक्शन पाइपलाइन

### ट्रिगर

कॉम्पैक्शन तीन तरीकों से चल सकता है:

1. **मैनुअल**: `/compact [instructions]` `AgentSession.compact(...)` को कॉल करता है।
2. **स्वचालित ओवरफ्लो रिकवरी**: संदर्भ ओवरफ्लो से मेल खाने वाली assistant त्रुटि के बाद।
3. **स्वचालित थ्रेशोल्ड कॉम्पैक्शन**: सफल टर्न के बाद जब संदर्भ थ्रेशोल्ड से अधिक हो जाता है।

### कॉम्पैक्शन आकार (दृश्य)

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### ओवरफ्लो-रिट्राय बनाम थ्रेशोल्ड कॉम्पैक्शन

दो स्वचालित पथ जानबूझकर भिन्न हैं:

- **ओवरफ्लो-रिट्राय कॉम्पैक्शन**
  - ट्रिगर: वर्तमान-मॉडल assistant त्रुटि को संदर्भ ओवरफ्लो के रूप में पहचाना जाता है।
  - रिट्राय से पहले विफल assistant त्रुटि संदेश सक्रिय agent स्थिति से हटा दिया जाता है।
  - ऑटो कॉम्पैक्शन `reason: "overflow"` और `willRetry: true` के साथ चलता है।
  - सफलता पर, कॉम्पैक्शन के बाद agent स्वतः-जारी रहता है (`agent.continue()`)।

- **थ्रेशोल्ड कॉम्पैक्शन**
  - ट्रिगर: `contextTokens > contextWindow - compaction.reserveTokens`।
  - `reason: "threshold"` और `willRetry: false` के साथ चलता है।
  - सफलता पर, यदि `compaction.autoContinue !== false`, एक सिंथेटिक प्रॉम्प्ट इंजेक्ट करता है:
    - `"Continue if you have next steps."`

### पूर्व-कॉम्पैक्शन प्रूनिंग

कॉम्पैक्शन जांच से पहले, टूल-रिज़ल्ट प्रूनिंग चल सकती है (`pruneToolOutputs`)।

डिफ़ॉल्ट प्रून नीति:

- नवीनतम `40_000` टूल-आउटपुट टोकन की सुरक्षा करें।
- कम से कम `20_000` कुल अनुमानित बचत की आवश्यकता है।
- `skill` या `read` से टूल परिणाम कभी न प्रून करें।

प्रून किए गए टूल परिणामों को इससे बदला जाता है:

- `[Output truncated - N tokens]`

यदि प्रूनिंग प्रविष्टियों को बदलती है, तो कॉम्पैक्शन निर्णयों से पहले सत्र स्टोरेज पुनर्लेखित किया जाता है और agent संदेश स्थिति ताज़ा की जाती है।

### सीमा और कट-पॉइंट लॉजिक

`prepareCompaction()` केवल अंतिम कॉम्पैक्शन प्रविष्टि (यदि कोई हो) के बाद की प्रविष्टियों पर विचार करता है।

1. पिछला कॉम्पैक्शन इंडेक्स खोजें।
2. `boundaryStart = prevCompactionIndex + 1` की गणना करें।
3. उपलब्ध होने पर मापे गए उपयोग अनुपात का उपयोग करके `keepRecentTokens` को अनुकूलित करें।
4. सीमा विंडो पर `findCutPoint()` चलाएं।

वैध कट पॉइंट में शामिल हैं:

- भूमिकाओं वाली message प्रविष्टियाँ: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- `custom_message` प्रविष्टियाँ
- `branch_summary` प्रविष्टियाँ

कठोर नियम: कभी भी `toolResult` पर न काटें।

यदि कट पॉइंट से ठीक पहले गैर-संदेश मेटाडेटा प्रविष्टियाँ हैं (`model_change`, `thinking_level_change`, लेबल आदि), तो उन्हें कट इंडेक्स को पीछे ले जाकर रखे गए क्षेत्र में खींचा जाता है जब तक संदेश या कॉम्पैक्शन सीमा नहीं आ जाती।

### स्प्लिट-टर्न हैंडलिंग

यदि कट पॉइंट उपयोगकर्ता-टर्न की शुरुआत में नहीं है, तो कॉम्पैक्शन इसे स्प्लिट टर्न के रूप में मानता है।

टर्न शुरू होने की पहचान इन्हें उपयोगकर्ता-टर्न सीमाओं के रूप में मानती है:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` प्रविष्टि
- `branch_summary` प्रविष्टि

स्प्लिट-टर्न कॉम्पैक्शन दो सारांश उत्पन्न करता है:

1. इतिहास सारांश (`messagesToSummarize`)
2. टर्न-प्रीफिक्स सारांश (`turnPrefixMessages`)

अंतिम संग्रहीत सारांश को इस प्रकार मर्ज किया जाता है:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### सारांश निर्माण

`compact(...)` क्रमबद्ध वार्तालाप टेक्स्ट से सारांश बनाता है:

1. `convertToLlm()` के माध्यम से संदेशों को परिवर्तित करें।
2. `serializeConversation()` के साथ क्रमबद्ध करें।
3. `<conversation>...</conversation>` में लपेटें।
4. वैकल्पिक रूप से `<previous-summary>...</previous-summary>` शामिल करें।
5. वैकल्पिक रूप से hook संदर्भ को `<additional-context>` सूची के रूप में इंजेक्ट करें।
6. `SUMMARIZATION_SYSTEM_PROMPT` के साथ संक्षेपण प्रॉम्प्ट निष्पादित करें।

प्रॉम्प्ट चयन:

- पहला कॉम्पैक्शन: `compaction-summary.md`
- पूर्व सारांश के साथ पुनरावृत्त कॉम्पैक्शन: `compaction-update-summary.md`
- स्प्लिट-टर्न दूसरा पास: `compaction-turn-prefix.md`
- संक्षिप्त UI सारांश: `compaction-short-summary.md`

रिमोट संक्षेपण मोड:

- यदि `compaction.remoteEndpoint` सेट है, तो कॉम्पैक्शन POST करता है:
  - `{ systemPrompt, prompt }`
- कम से कम `{ summary }` युक्त JSON की अपेक्षा करता है।

### सारांशों में फ़ाइल-ऑपरेशन संदर्भ

कॉम्पैक्शन assistant टूल कॉल का उपयोग करके संचयी फ़ाइल गतिविधि को ट्रैक करता है:

- `read(path)` → read सेट
- `write(path)` → modified सेट
- `edit(path)` → modified सेट

संचयी व्यवहार:

- पूर्व कॉम्पैक्शन विवरण तभी शामिल करता है जब पूर्व प्रविष्टि pi-generated हो (`fromExtension !== true`)।
- स्प्लिट टर्न में, टर्न-प्रीफिक्स फ़ाइल ऑप्स भी शामिल करता है।
- `readFiles` में वे फ़ाइलें शामिल नहीं होती जो modified भी हैं।

सारांश टेक्स्ट में प्रॉम्प्ट टेम्प्लेट के माध्यम से फ़ाइल टैग जोड़े जाते हैं:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### संग्रह और पुनः लोड

सारांश निर्माण (या hook-प्रदत्त सारांश) के बाद, agent सत्र:

1. `appendCompaction(...)` के साथ `CompactionEntry` जोड़ता है।
2. `buildSessionContext()` के माध्यम से संदर्भ पुनर्निर्मित करता है।
3. लाइव agent संदेशों को पुनर्निर्मित संदर्भ से बदलता है।
4. `session_compact` hook इवेंट उत्सर्जित करता है।

## ब्रांच संक्षेपण पाइपलाइन

ब्रांच संक्षेपण टोकन ओवरफ्लो से नहीं, बल्कि ट्री नेविगेशन से जुड़ा है।

### ट्रिगर

`navigateTree(...)` के दौरान:

1. `collectEntriesForBranchSummary(...)` का उपयोग करके पुराने लीफ से सामान्य पूर्वज तक छोड़ी गई प्रविष्टियों की गणना करें।
2. यदि कॉलर ने सारांश अनुरोध किया है (`options.summarize`), तो लीफ बदलने से पहले सारांश उत्पन्न करें।
3. यदि सारांश मौजूद है, तो `branchWithSummary(...)` का उपयोग करके नेविगेशन लक्ष्य पर इसे संलग्न करें।

संचालनात्मक रूप से यह सामान्यतः `/tree` प्रवाह द्वारा संचालित होता है जब `branchSummary.enabled` सक्षम होता है।

### ब्रांच स्विच आकार (दृश्य)

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### तैयारी और टोकन बजट

`generateBranchSummary(...)` बजट की गणना इस प्रकार करता है:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` फिर:

1. पहला पास: सभी संक्षेपित प्रविष्टियों से संचयी फ़ाइल ऑप्स एकत्र करें, जिसमें पूर्व pi-generated `branch_summary` विवरण शामिल हैं।
2. दूसरा पास: नवीनतम → पुराने क्रम में चलें, टोकन बजट पहुंचने तक संदेश जोड़ते रहें।
3. हालिया संदर्भ संरक्षित करना प्राथमिकता है।
4. निरंतरता के लिए बजट सीमा के पास बड़ी सारांश प्रविष्टियाँ अभी भी शामिल हो सकती हैं।

ब्रांच संक्षेपण इनपुट के दौरान कॉम्पैक्शन प्रविष्टियाँ संदेशों (`compactionSummary`) के रूप में शामिल की जाती हैं।

### सारांश निर्माण और संग्रह

ब्रांच संक्षेपण:

1. चुने गए संदेशों को परिवर्तित और क्रमबद्ध करता है।
2. `<conversation>` में लपेटता है।
3. यदि आपूर्ति किए गए हों तो कस्टम निर्देश उपयोग करता है, अन्यथा `branch-summary.md`।
4. `SUMMARIZATION_SYSTEM_PROMPT` के साथ संक्षेपण मॉडल को कॉल करता है।
5. `branch-summary-preamble.md` पूर्वसंलग्न करता है।
6. फ़ाइल-ऑपरेशन टैग जोड़ता है।

परिणाम वैकल्पिक विवरण (`readFiles`, `modifiedFiles`) के साथ `BranchSummaryEntry` के रूप में संग्रहीत होता है।

## एक्सटेंशन और hook टचपॉइंट

### `session_before_compact`

पूर्व-कॉम्पैक्शन hook।

कर सकता है:

- कॉम्पैक्शन रद्द करना (`{ cancel: true }`)
- पूर्ण कस्टम कॉम्पैक्शन पेलोड प्रदान करना (`{ compaction: CompactionResult }`)

### `session.compacting`

डिफ़ॉल्ट कॉम्पैक्शन के लिए प्रॉम्प्ट/संदर्भ अनुकूलन hook।

वापस कर सकता है:

- `prompt` (बेस सारांश प्रॉम्प्ट ओवरराइड)
- `context` (`<additional-context>` में इंजेक्ट की गई अतिरिक्त संदर्भ पंक्तियाँ)
- `preserveData` (कॉम्पैक्शन प्रविष्टि पर संग्रहीत)

### `session_compact`

सहेजी गई `compactionEntry` और `fromExtension` फ्लैग के साथ पोस्ट-कॉम्पैक्शन अधिसूचना।

### `session_before_tree`

डिफ़ॉल्ट ब्रांच सारांश निर्माण से पहले ट्री नेविगेशन पर चलता है।

कर सकता है:

- नेविगेशन रद्द करना
- कस्टम `{ summary: { summary, details } }` प्रदान करना जो उपयोगकर्ता द्वारा संक्षेपण अनुरोध करने पर उपयोग किया जाता है

### `session_tree`

नए/पुराने लीफ और वैकल्पिक सारांश प्रविष्टि को उजागर करने वाला पोस्ट-नेविगेशन इवेंट।

## रनटाइम व्यवहार और विफलता सेमांटिक्स

- मैनुअल कॉम्पैक्शन पहले वर्तमान agent ऑपरेशन को रद्द करता है।
- `abortCompaction()` मैनुअल और ऑटो-कॉम्पैक्शन दोनों नियंत्रकों को रद्द करता है।
- ऑटो कॉम्पैक्शन UI/स्थिति अपडेट के लिए प्रारंभ/अंत सत्र इवेंट उत्सर्जित करता है।
- ऑटो कॉम्पैक्शन कई मॉडल उम्मीदवारों को आज़मा सकता है और क्षणिक विफलताओं को पुनः प्रयास कर सकता है।
- ओवरफ्लो त्रुटियाँ सामान्य रिट्राय पथ से बाहर रखी जाती हैं क्योंकि उन्हें कॉम्पैक्शन द्वारा संभाला जाता है।
- यदि ऑटो-कॉम्पैक्शन विफल होता है:
  - ओवरफ्लो पथ `Context overflow recovery failed: ...` उत्सर्जित करता है
  - थ्रेशोल्ड पथ `Auto-compaction failed: ...` उत्सर्जित करता है
- ब्रांच संक्षेपण को abort संकेत (जैसे Escape) के माध्यम से रद्द किया जा सकता है, जो रद्द/निरस्त नेविगेशन परिणाम लौटाता है।

## सेटिंग्स और डिफ़ॉल्ट

`settings-schema.ts` से:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

ये मान रनटाइम पर `AgentSession` और कॉम्पैक्शन/ब्रांच संक्षेपण मॉड्यूल द्वारा उपयोग किए जाते हैं।
