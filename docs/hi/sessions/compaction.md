---
title: Compaction और Branch Summaries
description: >-
  लंबे समय तक चलने वाले सत्रों के लिए कॉन्टेक्स्ट विंडो compaction और branch
  summary जनरेशन।
sidebar:
  order: 5
  label: Compaction
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# Compaction और Branch Summaries

Compaction और branch summaries दो ऐसे तंत्र हैं जो लंबे सत्रों को पूर्व कार्य संदर्भ खोए बिना उपयोगी बनाए रखते हैं।

- **Compaction** वर्तमान branch पर पुराने इतिहास को एक सारांश में पुनर्लिखित करता है।
- **Branch summary** `/tree` नेविगेशन के दौरान छोड़ी गई branch के संदर्भ को कैप्चर करता है।

दोनों सत्र प्रविष्टियों के रूप में संरक्षित किए जाते हैं और LLM इनपुट को पुनर्निर्मित करते समय user-context संदेशों में वापस रूपांतरित किए जाते हैं।

## प्रमुख कार्यान्वयन फ़ाइलें

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

Compaction और branch summaries प्रथम-श्रेणी सत्र प्रविष्टियाँ हैं, सामान्य assistant/user संदेश नहीं।

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, वैकल्पिक `shortSummary`
  - `firstKeptEntryId` (compaction सीमा)
  - `tokensBefore`
  - वैकल्पिक `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - वैकल्पिक `details`, `fromExtension`

जब संदर्भ पुनर्निर्मित किया जाता है (`buildSessionContext`):

1. सक्रिय पथ पर नवीनतम compaction को एक `compactionSummary` संदेश में रूपांतरित किया जाता है।
2. `firstKeptEntryId` से compaction बिंदु तक रखी गई प्रविष्टियाँ पुनः शामिल की जाती हैं।
3. पथ पर बाद की प्रविष्टियाँ जोड़ी जाती हैं।
4. `branch_summary` प्रविष्टियाँ `branchSummary` संदेशों में रूपांतरित की जाती हैं।
5. `custom_message` प्रविष्टियाँ `custom` संदेशों में रूपांतरित की जाती हैं।

फिर उन कस्टम भूमिकाओं को `convertToLlm()` में स्थिर टेम्पलेट्स का उपयोग करके LLM-फेसिंग user संदेशों में रूपांतरित किया जाता है:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Compaction पाइपलाइन

### ट्रिगर

Compaction तीन तरीकों से चल सकता है:

1. **मैन्युअल**: `/compact [instructions]` `AgentSession.compact(...)` को कॉल करता है।
2. **स्वचालित ओवरफ्लो रिकवरी**: एक assistant त्रुटि के बाद जो context overflow से मेल खाती है।
3. **स्वचालित थ्रेशोल्ड compaction**: एक सफल टर्न के बाद जब context थ्रेशोल्ड से अधिक हो जाता है।

### Compaction का आकार (दृश्य)

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

### ओवरफ्लो-रीट्राई बनाम थ्रेशोल्ड compaction

दो स्वचालित पथ जानबूझकर भिन्न हैं:

- **ओवरफ्लो-रीट्राई compaction**
  - ट्रिगर: वर्तमान-मॉडल assistant त्रुटि context overflow के रूप में पहचानी जाती है।
  - रीट्राई से पहले असफल assistant त्रुटि संदेश को सक्रिय agent स्थिति से हटा दिया जाता है।
  - ऑटो compaction `reason: "overflow"` और `willRetry: true` के साथ चलता है।
  - सफलता पर, agent compaction के बाद स्वचालित रूप से जारी रहता है (`agent.continue()`)।

- **थ्रेशोल्ड compaction**
  - ट्रिगर: `contextTokens > contextWindow - compaction.reserveTokens`।
  - `reason: "threshold"` और `willRetry: false` के साथ चलता है।
  - सफलता पर, यदि `compaction.autoContinue !== false`, तो एक सिंथेटिक प्रॉम्प्ट इंजेक्ट करता है:
    - `"Continue if you have next steps."`

### प्री-compaction प्रूनिंग

Compaction जाँचों से पहले, tool-result प्रूनिंग चल सकती है (`pruneToolOutputs`)।

डिफ़ॉल्ट प्रून नीति:

- नवीनतम `40_000` tool-output टोकन सुरक्षित रखें।
- कम से कम `20_000` कुल अनुमानित बचत आवश्यक।
- `skill` या `read` से tool results कभी प्रून न करें।

प्रून किए गए tool results को इससे बदला जाता है:

- `[Output truncated - N tokens]`

यदि प्रूनिंग प्रविष्टियों को बदलती है, तो compaction निर्णयों से पहले सत्र भंडारण पुनर्लिखित किया जाता है और agent संदेश स्थिति ताज़ा की जाती है।

### सीमा और कट-पॉइंट तर्क

`prepareCompaction()` केवल अंतिम compaction प्रविष्टि (यदि कोई हो) के बाद की प्रविष्टियों पर विचार करता है।

1. पिछला compaction इंडेक्स खोजें।
2. `boundaryStart = prevCompactionIndex + 1` की गणना करें।
3. जब उपलब्ध हो तो मापी गई उपयोग अनुपात का उपयोग करके `keepRecentTokens` को अनुकूलित करें।
4. सीमा विंडो पर `findCutPoint()` चलाएं।

मान्य कट पॉइंट में शामिल हैं:

- इन भूमिकाओं वाली संदेश प्रविष्टियाँ: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- `custom_message` प्रविष्टियाँ
- `branch_summary` प्रविष्टियाँ

कठोर नियम: `toolResult` पर कभी कट न करें।

यदि कट पॉइंट से ठीक पहले गैर-संदेश मेटाडेटा प्रविष्टियाँ हैं (`model_change`, `thinking_level_change`, labels, आदि), तो उन्हें कट इंडेक्स को पीछे ले जाकर रखे गए क्षेत्र में खींचा जाता है जब तक कि कोई संदेश या compaction सीमा नहीं मिल जाती।

### स्प्लिट-टर्न हैंडलिंग

यदि कट पॉइंट user-turn की शुरुआत पर नहीं है, तो compaction इसे स्प्लिट टर्न के रूप में मानता है।

टर्न शुरुआत का पता लगाना इन्हें user-turn सीमाओं के रूप में मानता है:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` प्रविष्टि
- `branch_summary` प्रविष्टि

स्प्लिट-टर्न compaction दो सारांश उत्पन्न करता है:

1. इतिहास सारांश (`messagesToSummarize`)
2. टर्न-प्रीफिक्स सारांश (`turnPrefixMessages`)

अंतिम संग्रहीत सारांश इस प्रकार विलय किया जाता है:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### सारांश जनरेशन

`compact(...)` क्रमबद्ध वार्तालाप पाठ से सारांश बनाता है:

1. `convertToLlm()` के माध्यम से संदेशों को रूपांतरित करें।
2. `serializeConversation()` के साथ क्रमबद्ध करें।
3. `<conversation>...</conversation>` में लपेटें।
4. वैकल्पिक रूप से `<previous-summary>...</previous-summary>` शामिल करें।
5. वैकल्पिक रूप से hook संदर्भ को `<additional-context>` सूची के रूप में इंजेक्ट करें।
6. `SUMMARIZATION_SYSTEM_PROMPT` के साथ सारांशीकरण प्रॉम्प्ट निष्पादित करें।

प्रॉम्प्ट चयन:

- पहला compaction: `compaction-summary.md`
- पूर्व सारांश के साथ पुनरावृत्त compaction: `compaction-update-summary.md`
- स्प्लिट-टर्न दूसरा पास: `compaction-turn-prefix.md`
- संक्षिप्त UI सारांश: `compaction-short-summary.md`

रिमोट सारांशीकरण मोड:

- यदि `compaction.remoteEndpoint` सेट है, तो compaction POST करता है:
  - `{ systemPrompt, prompt }`
- कम से कम `{ summary }` वाला JSON अपेक्षित है।

### सारांशों में फ़ाइल-ऑपरेशन संदर्भ

Compaction assistant tool calls का उपयोग करके संचयी फ़ाइल गतिविधि को ट्रैक करता है:

- `read(path)` → read सेट
- `write(path)` → modified सेट
- `edit(path)` → modified सेट

संचयी व्यवहार:

- पूर्व compaction विवरण केवल तभी शामिल करता है जब पूर्व प्रविष्टि pi-जनित हो (`fromExtension !== true`)।
- स्प्लिट टर्न में, टर्न-प्रीफिक्स फ़ाइल ops भी शामिल करता है।
- `readFiles` उन फ़ाइलों को बाहर करता है जो modified भी हैं।

सारांश पाठ में प्रॉम्प्ट टेम्पलेट के माध्यम से फ़ाइल टैग जोड़े जाते हैं:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### संरक्षण और पुनः लोड

सारांश जनरेशन (या hook-प्रदत्त सारांश) के बाद, agent session:

1. `appendCompaction(...)` के साथ `CompactionEntry` जोड़ता है।
2. `buildSessionContext()` के माध्यम से संदर्भ पुनर्निर्मित करता है।
3. लाइव agent संदेशों को पुनर्निर्मित संदर्भ से बदलता है।
4. `session_compact` hook इवेंट एमिट करता है।

## Branch सारांशीकरण पाइपलाइन

Branch सारांशीकरण ट्री नेविगेशन से जुड़ा है, token overflow से नहीं।

### ट्रिगर

`navigateTree(...)` के दौरान:

1. `collectEntriesForBranchSummary(...)` का उपयोग करके पुरानी leaf से common ancestor तक छोड़ी गई प्रविष्टियों की गणना करें।
2. यदि कॉलर ने सारांश का अनुरोध किया है (`options.summarize`), तो leaf स्विच करने से पहले सारांश उत्पन्न करें।
3. यदि सारांश मौजूद है, तो `branchWithSummary(...)` का उपयोग करके इसे नेविगेशन लक्ष्य पर संलग्न करें।

व्यावहारिक रूप से यह आमतौर पर `/tree` प्रवाह द्वारा संचालित होता है जब `branchSummary.enabled` सक्षम होता है।

### Branch स्विच का आकार (दृश्य)

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

### तैयारी और token बजट

`generateBranchSummary(...)` बजट की गणना इस प्रकार करता है:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` फिर:

1. पहला पास: सभी सारांशित प्रविष्टियों से संचयी फ़ाइल ops एकत्र करें, जिसमें पूर्व pi-जनित `branch_summary` विवरण शामिल हैं।
2. दूसरा पास: नवीनतम → पुराने की ओर चलें, token बजट पूरा होने तक संदेश जोड़ें।
3. हाल के संदर्भ को संरक्षित करने को प्राथमिकता दें।
4. निरंतरता के लिए बजट सीमा के पास बड़ी सारांश प्रविष्टियाँ अभी भी शामिल कर सकते हैं।

Branch सारांशीकरण इनपुट के दौरान Compaction प्रविष्टियाँ संदेशों (`compactionSummary`) के रूप में शामिल की जाती हैं।

### सारांश जनरेशन और संरक्षण

Branch सारांशीकरण:

1. चयनित संदेशों को रूपांतरित और क्रमबद्ध करता है।
2. `<conversation>` में लपेटता है।
3. यदि प्रदान किए गए हों तो कस्टम निर्देशों का उपयोग करता है, अन्यथा `branch-summary.md`।
4. `SUMMARIZATION_SYSTEM_PROMPT` के साथ सारांशीकरण मॉडल को कॉल करता है।
5. `branch-summary-preamble.md` पहले जोड़ता है।
6. फ़ाइल-ऑपरेशन टैग जोड़ता है।

परिणाम वैकल्पिक विवरण (`readFiles`, `modifiedFiles`) के साथ `BranchSummaryEntry` के रूप में संग्रहीत किया जाता है।

## Extension और hook टचपॉइंट

### `session_before_compact`

प्री-compaction hook।

यह कर सकता है:

- compaction रद्द करें (`{ cancel: true }`)
- पूर्ण कस्टम compaction payload प्रदान करें (`{ compaction: CompactionResult }`)

### `session.compacting`

डिफ़ॉल्ट compaction के लिए प्रॉम्प्ट/संदर्भ अनुकूलन hook।

यह लौटा सकता है:

- `prompt` (आधार सारांश प्रॉम्प्ट को ओवरराइड करें)
- `context` (अतिरिक्त संदर्भ पंक्तियाँ `<additional-context>` में इंजेक्ट की जाती हैं)
- `preserveData` (compaction प्रविष्टि पर संग्रहीत)

### `session_compact`

सहेजी गई `compactionEntry` और `fromExtension` फ्लैग के साथ पोस्ट-compaction सूचना।

### `session_before_tree`

डिफ़ॉल्ट branch summary जनरेशन से पहले ट्री नेविगेशन पर चलता है।

यह कर सकता है:

- नेविगेशन रद्द करें
- कस्टम `{ summary: { summary, details } }` प्रदान करें जो उपयोगकर्ता द्वारा सारांशीकरण अनुरोध करने पर उपयोग किया जाता है

### `session_tree`

नई/पुरानी leaf और वैकल्पिक summary प्रविष्टि को उजागर करने वाला पोस्ट-नेविगेशन इवेंट।

## रनटाइम व्यवहार और विफलता शब्दार्थ

- मैन्युअल compaction पहले वर्तमान agent ऑपरेशन को रद्द करता है।
- `abortCompaction()` मैन्युअल और ऑटो-compaction दोनों नियंत्रकों को रद्द करता है।
- ऑटो compaction UI/स्थिति अपडेट के लिए start/end सत्र इवेंट एमिट करता है।
- ऑटो compaction कई मॉडल उम्मीदवारों को आज़मा सकता है और क्षणिक विफलताओं पर रीट्राई कर सकता है।
- ओवरफ्लो त्रुटियों को सामान्य रीट्राई पथ से बाहर रखा जाता है क्योंकि वे compaction द्वारा संभाली जाती हैं।
- यदि ऑटो-compaction विफल होता है:
  - ओवरफ्लो पथ `Context overflow recovery failed: ...` एमिट करता है
  - थ्रेशोल्ड पथ `Auto-compaction failed: ...` एमिट करता है
- Branch सारांशीकरण abort सिग्नल (जैसे, Escape) के माध्यम से रद्द किया जा सकता है, जो canceled/aborted नेविगेशन परिणाम लौटाता है।

## सेटिंग्स और डिफ़ॉल्ट

`settings-schema.ts` से:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

ये मान रनटाइम पर `AgentSession` और compaction/branch सारांशीकरण मॉड्यूल द्वारा उपयोग किए जाते हैं।
