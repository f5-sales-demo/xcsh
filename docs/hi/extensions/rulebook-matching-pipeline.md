---
title: Rulebook Matching Pipeline
description: >-
  एजेंट सत्रों में संदर्भ-विशिष्ट निर्देश सेटों के चयन और लागू करने के लिए
  रूलबुक मैचिंग पाइपलाइन।
sidebar:
  order: 6
  label: Rulebook matching
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Rulebook Matching Pipeline

यह दस्तावेज़ वर्णन करता है कि कैसे coding-agent समर्थित कॉन्फ़िग प्रारूपों से नियमों की खोज करता है, उन्हें एक एकल `Rule` आकार में सामान्यीकृत करता है, प्राथमिकता संघर्षों को हल करता है, और परिणाम को विभाजित करता है:

- **Rulebook नियम** (सिस्टम प्रॉम्प्ट + `rule://` URL के माध्यम से मॉडल को उपलब्ध)
- **TTSR नियम** (time-travel stream interruption नियम)

यह वर्तमान कार्यान्वयन को दर्शाता है, जिसमें आंशिक अर्थविज्ञान और मेटाडेटा शामिल है जो पार्स किया जाता है लेकिन लागू नहीं किया जाता।

## कार्यान्वयन फ़ाइलें

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. कैनोनिकल नियम आकार

सभी प्रदाता स्रोत फ़ाइलों को `Rule` में सामान्यीकृत करते हैं:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

क्षमता पहचान `rule.name` है (`ruleCapability.key = rule => rule.name`)।

परिणाम: प्राथमिकता और डिडुप्लिकेशन **केवल नाम-आधारित** हैं। एक ही `name` वाली दो अलग-अलग फ़ाइलें एक ही तार्किक नियम मानी जाती हैं।

## 2. खोज स्रोत और सामान्यीकरण

`src/discovery/index.ts` प्रदाताओं को स्वचालित रूप से पंजीकृत करता है। `rules` के लिए, वर्तमान प्रदाता हैं:

- `native` (प्राथमिकता `100`)
- `cursor` (प्राथमिकता `50`)
- `windsurf` (प्राथमिकता `50`)
- `cline` (प्राथमिकता `40`)

### Native प्रदाता (`builtin.ts`)

`.xcsh` नियमों को यहाँ से लोड करता है:

- प्रोजेक्ट: `<cwd>/.xcsh/rules/*.{md,mdc}`
- उपयोगकर्ता: `~/.xcsh/agent/rules/*.{md,mdc}`

सामान्यीकरण:

- `name` = `.md`/`.mdc` के बिना फ़ाइलनाम
- फ्रंटमैटर `parseFrontmatter` के माध्यम से पार्स किया जाता है
- `content` = बॉडी (फ्रंटमैटर हटाया गया)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` सीधे मैप किए जाते हैं

महत्वपूर्ण चेतावनी: `globs` को इस प्रदाता में बिना एलिमेंट फ़िल्टरिंग के `string[] | undefined` के रूप में कास्ट किया जाता है।

### Cursor प्रदाता (`cursor.ts`)

यहाँ से लोड करता है:

- उपयोगकर्ता: `~/.cursor/rules/*.{mdc,md}`
- प्रोजेक्ट: `<cwd>/.cursor/rules/*.{mdc,md}`

सामान्यीकरण (`transformMDCRule`):

- `description`: केवल स्ट्रिंग होने पर रखा जाता है
- `alwaysApply`: केवल `true` संरक्षित किया जाता है (`false` `undefined` बन जाता है)
- `globs`: ऐरे (केवल स्ट्रिंग एलिमेंट) या एकल स्ट्रिंग स्वीकार करता है
- `ttsr_trigger`: केवल स्ट्रिंग
- `name` एक्सटेंशन के बिना फ़ाइलनाम से

### Windsurf प्रदाता (`windsurf.ts`)

यहाँ से लोड करता है:

- उपयोगकर्ता: `~/.codeium/windsurf/memories/global_rules.md` (निश्चित नियम नाम `global_rules`)
- प्रोजेक्ट: `<cwd>/.windsurf/rules/*.md`

सामान्यीकरण:

- `globs`: स्ट्रिंग-का-ऐरे या एकल स्ट्रिंग
- `alwaysApply`, `description` फ्रंटमैटर से कास्ट किए जाते हैं
- `ttsr_trigger`: केवल स्ट्रिंग
- प्रोजेक्ट नियमों के लिए `name` फ़ाइलनाम से

### Cline प्रदाता (`cline.ts`)

`cwd` से ऊपर की ओर निकटतम `.clinerules` खोजता है:

- यदि डायरेक्टरी: इसके अंदर `*.md` लोड करता है
- यदि फ़ाइल: `clinerules` नामक एकल नियम के रूप में फ़ाइल लोड करता है

सामान्यीकरण:

- `globs`: स्ट्रिंग-का-ऐरे या एकल स्ट्रिंग
- `alwaysApply`: केवल बूलियन होने पर
- `description`: केवल स्ट्रिंग
- `ttsr_trigger`: केवल स्ट्रिंग

## 3. फ्रंटमैटर पार्सिंग व्यवहार और अस्पष्टता

सभी प्रदाता इन अर्थविज्ञान के साथ `parseFrontmatter` (`utils/frontmatter.ts`) का उपयोग करते हैं:

1. फ्रंटमैटर केवल तभी पार्स किया जाता है जब कंटेंट `---` से शुरू होता है और एक समापन `\n---` होता है।
2. फ्रंटमैटर निष्कर्षण के बाद बॉडी ट्रिम की जाती है।
3. यदि YAML पार्स विफल होता है:
   - चेतावनी लॉग की जाती है,
   - पार्सर सरल `key: value` लाइन पार्सिंग (`^(\w+):\s*(.*)$`) पर फ़ॉलबैक करता है।

अस्पष्टता के परिणाम:

- फ़ॉलबैक पार्सर ऐरे, नेस्टेड ऑब्जेक्ट, कोटिंग नियम, या हाइफ़नेटेड कुंजियों का समर्थन नहीं करता।
- फ़ॉलबैक मान स्ट्रिंग बन जाते हैं (उदाहरण के लिए `alwaysApply: true` स्ट्रिंग `"true"` बन जाता है), इसलिए बूलियन/स्ट्रिंग प्रकारों की आवश्यकता वाले प्रदाता मेटाडेटा छोड़ सकते हैं।
- `ttsr_trigger` फ़ॉलबैक में काम करता है (अंडरस्कोर कुंजी); `thinking-level` जैसी कुंजियाँ नहीं करतीं।
- बिना वैध फ्रंटमैटर वाली फ़ाइलें अभी भी खाली मेटाडेटा और पूर्ण कंटेंट बॉडी के साथ नियमों के रूप में लोड होती हैं।

## 4. प्रदाता प्राथमिकता और डिडुप्लिकेशन

`loadCapability("rules")` (`capability/index.ts`) प्रदाता आउटपुट को मर्ज करता है और फिर `rule.name` द्वारा डिडुप्लिकेट करता है।

### प्राथमिकता मॉडल

- प्रदाताओं को प्राथमिकता अवरोही क्रम में व्यवस्थित किया जाता है।
- समान प्राथमिकता पंजीकरण क्रम बनाए रखती है (`discovery/index.ts` से `cursor` `windsurf` से पहले)।
- डिडुप पहले-जीतता-है: पहले सामने आया नियम नाम रखा जाता है; बाद में समान-नाम वाले आइटम `all` में `_shadowed` चिह्नित किए जाते हैं और `items` से बाहर रखे जाते हैं।

प्रभावी नियम प्रदाता क्रम वर्तमान में है:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### अंतर-प्रदाता क्रम चेतावनी

एक प्रदाता के भीतर, आइटम क्रम `loadFilesFromDir` glob परिणाम क्रम और स्पष्ट push क्रम से आता है। यह सामान्य उपयोग के लिए पर्याप्त रूप से निर्धारणीय है लेकिन कोड में स्पष्ट रूप से सॉर्ट नहीं किया गया है।

उल्लेखनीय स्रोत-क्रम अंतर:

- `native` प्रोजेक्ट फिर उपयोगकर्ता कॉन्फ़िग डायरेक्टरी जोड़ता है।
- `cursor` उपयोगकर्ता फिर प्रोजेक्ट परिणाम जोड़ता है।
- `windsurf` पहले उपयोगकर्ता `global_rules` जोड़ता है, फिर प्रोजेक्ट नियम।
- `cline` केवल निकटतम `.clinerules` स्रोत लोड करता है।

## 5. Rulebook, Always-Apply, और TTSR बकेट में विभाजन

`createAgentSession` (`sdk.ts`) में नियम खोज के बाद:

1. सभी खोजे गए नियमों को स्कैन किया जाता है।
2. `condition` (फ्रंटमैटर कुंजी; `ttsr_trigger` / `ttsrTrigger` फ़ॉलबैक के रूप में स्वीकृत) वाले नियम `TtsrManager` में पंजीकृत किए जाते हैं।
3. इस प्रेडिकेट के साथ एक अलग `rulebookRules` सूची बनाई जाती है:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. एक `alwaysApplyRules` सूची बनाई जाती है:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### बकेट व्यवहार

- **TTSR बकेट**: `condition` वाला कोई भी नियम (विवरण आवश्यक नहीं)। अन्य बकेट पर प्राथमिकता लेता है।
- **Always-apply बकेट**: `alwaysApply === true`, TTSR नहीं। पूर्ण कंटेंट सिस्टम प्रॉम्प्ट में इंजेक्ट किया जाता है। `rule://` के माध्यम से हल करने योग्य।
- **Rulebook बकेट**: विवरण होना चाहिए, TTSR नहीं होना चाहिए, `alwaysApply` नहीं होना चाहिए। सिस्टम प्रॉम्प्ट में नाम+विवरण द्वारा सूचीबद्ध; कंटेंट `rule://` के माध्यम से माँग पर पढ़ा जाता है।
- `condition` और `alwaysApply` दोनों वाला नियम केवल TTSR में जाता है (TTSR प्राथमिकता लेता है)।
- `alwaysApply` और `description` दोनों वाला नियम केवल always-apply में जाता है (rulebook में नहीं)।

## 6. मेटाडेटा रनटाइम सतहों को कैसे प्रभावित करता है

### `description`

- Rulebook में शामिल होने के लिए आवश्यक।
- सिस्टम प्रॉम्प्ट `<rules>` ब्लॉक में रेंडर किया जाता है।
- विवरण अनुपस्थित होने का अर्थ है कि नियम `rule://` के माध्यम से उपलब्ध नहीं है और सिस्टम प्रॉम्प्ट नियमों में सूचीबद्ध नहीं है।

### `globs`

- `Rule` पर ले जाया जाता है।
- सिस्टम प्रॉम्प्ट नियम ब्लॉक में `<glob>...</glob>` प्रविष्टियों के रूप में रेंडर किया जाता है।
- नियम UI स्थिति में उजागर किया जाता है (`extensions` मोड सूची)।
- **इस पाइपलाइन में स्वचालित मैचिंग के लिए लागू नहीं किया जाता।** वर्तमान फ़ाइल/टूल लक्ष्य द्वारा नियमों का चयन करने वाला कोई रनटाइम glob मैचर नहीं है।

### `alwaysApply`

- प्रदाताओं द्वारा पार्स और संरक्षित किया जाता है।
- UI प्रदर्शन में उपयोग किया जाता है (extensions स्थिति प्रबंधक में `"always"` ट्रिगर लेबल)।
- `rulebookRules` से बहिष्करण शर्त के रूप में उपयोग किया जाता है।
- **पूर्ण नियम कंटेंट सिस्टम प्रॉम्प्ट में स्वचालित रूप से इंजेक्ट किया जाता है** (rulebook नियम अनुभाग से पहले)।
- नियम पुनः पढ़ने के लिए `rule://<name>` के माध्यम से भी संबोधित किया जा सकता है।

### `ttsr_trigger`

- `rule.ttsrTrigger` में मैप किया जाता है।
- यदि मौजूद है, तो नियम TTSR प्रबंधक को रूट किया जाता है, rulebook को नहीं।

## 7. सिस्टम प्रॉम्प्ट समावेशन पथ

`buildSystemPromptInternal` `rules` (rulebook) और `alwaysApplyRules` दोनों प्राप्त करता है।

Always-apply नियम पहले रेंडर किए जाते हैं, अपना कच्चा कंटेंट सीधे प्रॉम्प्ट में इंजेक्ट करते हैं।

Rulebook नियम `# Rules` अनुभाग में इसके साथ रेंडर किए जाते हैं:

- `Read rule://<name> when working in matching domain`
- प्रत्येक नियम का `name`, `description`, और वैकल्पिक `<glob>` सूची

यह सलाहकारी/संदर्भात्मक है: प्रॉम्प्ट टेक्स्ट मॉडल से लागू नियम पढ़ने के लिए कहता है, लेकिन कोड glob प्रयोज्यता लागू नहीं करता।

## 8. `rule://` आंतरिक URL व्यवहार

`RuleProtocolHandler` इसके साथ पंजीकृत किया जाता है:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

निहितार्थ:

- `rule://<name>` **rulebookRules** और **alwaysApplyRules** दोनों के विरुद्ध हल होता है।
- केवल-TTSR नियम और बिना विवरण और बिना `alwaysApply` वाले नियम `rule://` के माध्यम से संबोधित नहीं किए जा सकते।
- हल सटीक नाम मिलान है।
- अज्ञात नाम उपलब्ध नियम नामों की सूची के साथ त्रुटि लौटाते हैं।
- लौटाया गया कंटेंट कच्चा `rule.content` है (फ्रंटमैटर हटाया गया), कंटेंट प्रकार `text/markdown`।

## 9. ज्ञात आंशिक / गैर-लागू अर्थविज्ञान

1. प्रदाता विवरण विरासत फ़ाइलों (`.cursorrules`, `.windsurfrules`) का उल्लेख करते हैं, लेकिन वर्तमान लोडर कोड पथ वास्तव में उन फ़ाइलों को नहीं पढ़ते।
2. `globs` मेटाडेटा प्रॉम्प्ट/UI को दिखाया जाता है लेकिन नियम चयन तर्क द्वारा लागू नहीं किया जाता।
3. `rule://` के लिए नियम चयन में rulebook और always-apply नियम शामिल हैं, लेकिन केवल-TTSR नियम नहीं।
4. खोज चेतावनियाँ (`loadCapability("rules").warnings`) उत्पन्न होती हैं लेकिन `createAgentSession` वर्तमान में इस पथ में उन्हें सतह पर नहीं लाता/लॉग नहीं करता।
