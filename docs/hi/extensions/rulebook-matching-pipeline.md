---
title: रूलबुक मैचिंग पाइपलाइन
description: >-
  एजेंट सेशन के लिए संदर्भ-विशिष्ट निर्देश सेट चुनने और लागू करने हेतु रूलबुक
  मैचिंग पाइपलाइन।
sidebar:
  order: 6
  label: रूलबुक मैचिंग
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# रूलबुक मैचिंग पाइपलाइन

यह दस्तावेज़ बताता है कि coding-agent किस प्रकार समर्थित config फॉर्मेट से नियमों की खोज करता है, उन्हें एकल `Rule` आकार में सामान्यीकृत करता है, प्राथमिकता संघर्षों को हल करता है, और परिणाम को निम्नलिखित में विभाजित करता है:

- **रूलबुक नियम** (सिस्टम प्रॉम्प्ट + `rule://` URL के माध्यम से मॉडल को उपलब्ध)
- **TTSR नियम** (time-travel stream interruption नियम)

यह वर्तमान कार्यान्वयन को दर्शाता है, जिसमें आंशिक सिमेंटिक्स और मेटाडेटा शामिल है जो पार्स तो किया जाता है लेकिन लागू नहीं होता।

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

सभी प्रोवाइडर स्रोत फ़ाइलों को `Rule` में सामान्यीकृत करते हैं:

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

Capability पहचान `rule.name` है (`ruleCapability.key = rule => rule.name`)।

परिणाम: प्राथमिकता और डिडुप्लिकेशन **केवल नाम-आधारित** हैं। एक ही `name` वाली दो अलग-अलग फ़ाइलें एक ही तार्किक नियम मानी जाती हैं।

## 2. डिस्कवरी स्रोत और सामान्यीकरण

`src/discovery/index.ts` प्रोवाइडर को स्वतः पंजीकृत करता है। `rules` के लिए वर्तमान प्रोवाइडर हैं:

- `native` (प्राथमिकता `100`)
- `cursor` (प्राथमिकता `50`)
- `windsurf` (प्राथमिकता `50`)
- `cline` (प्राथमिकता `40`)

### Native प्रोवाइडर (`builtin.ts`)

`.xcsh` नियमों को निम्न से लोड करता है:

- प्रोजेक्ट: `<cwd>/.xcsh/rules/*.{md,mdc}`
- उपयोगकर्ता: `~/.xcsh/agent/rules/*.{md,mdc}`

सामान्यीकरण:

- `name` = `.md`/`.mdc` के बिना फ़ाइलनाम
- frontmatter `parseFrontmatter` के माध्यम से पार्स किया गया
- `content` = बॉडी (frontmatter हटाया गया)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` सीधे मैप किए गए

महत्वपूर्ण चेतावनी: इस प्रोवाइडर में `globs` को `string[] | undefined` के रूप में कास्ट किया जाता है, लेकिन कोई element filtering नहीं होती।

### Cursor प्रोवाइडर (`cursor.ts`)

निम्न से लोड करता है:

- उपयोगकर्ता: `~/.cursor/rules/*.{mdc,md}`
- प्रोजेक्ट: `<cwd>/.cursor/rules/*.{mdc,md}`

सामान्यीकरण (`transformMDCRule`):

- `description`: केवल तभी रखा जाता है जब string हो
- `alwaysApply`: केवल `true` संरक्षित होता है (`false` `undefined` बन जाता है)
- `globs`: array (केवल string elements) या single string स्वीकार करता है
- `ttsr_trigger`: केवल string
- `name` फ़ाइलनाम से बिना extension के

### Windsurf प्रोवाइडर (`windsurf.ts`)

निम्न से लोड करता है:

- उपयोगकर्ता: `~/.codeium/windsurf/memories/global_rules.md` (निश्चित नियम नाम `global_rules`)
- प्रोजेक्ट: `<cwd>/.windsurf/rules/*.md`

सामान्यीकरण:

- `globs`: array-of-string या single string
- `alwaysApply`, `description` frontmatter से कास्ट किया गया
- `ttsr_trigger`: केवल string
- `name` प्रोजेक्ट नियमों के लिए फ़ाइलनाम से

### Cline प्रोवाइडर (`cline.ts`)

निकटतम `.clinerules` के लिए `cwd` से ऊपर की ओर खोज करता है:

- यदि directory है: उसके अंदर `*.md` लोड करता है
- यदि file है: एकल फ़ाइल को `clinerules` नाम के नियम के रूप में लोड करता है

सामान्यीकरण:

- `globs`: array-of-string या single string
- `alwaysApply`: केवल यदि boolean हो
- `description`: केवल string
- `ttsr_trigger`: केवल string

## 3. Frontmatter पार्सिंग व्यवहार और अस्पष्टता

सभी प्रोवाइडर `parseFrontmatter` (`utils/frontmatter.ts`) का उपयोग इन सिमेंटिक्स के साथ करते हैं:

1. Frontmatter तभी पार्स होता है जब content `---` से शुरू हो और एक closing `\n---` हो।
2. Frontmatter निष्कर्षण के बाद बॉडी trimmed होती है।
3. यदि YAML पार्स विफल हो:
   - चेतावनी लॉग की जाती है,
   - पार्सर simple `key: value` लाइन पार्सिंग (`^(\w+):\s*(.*)$`) पर fallback करता है।

अस्पष्टता के परिणाम:

- Fallback पार्सर arrays, nested objects, quoting rules, या हाइफ़नेटेड keys को समर्थन नहीं करता।
- Fallback मान strings बन जाते हैं (उदाहरण के लिए `alwaysApply: true` string `"true"` बन जाता है), इसलिए boolean/string types की आवश्यकता वाले प्रोवाइडर मेटाडेटा छोड़ सकते हैं।
- `ttsr_trigger` fallback में काम करता है (underscore key); `thinking-level` जैसी keys नहीं करतीं।
- Valid frontmatter के बिना फ़ाइलें अभी भी खाली मेटाडेटा और पूर्ण content body के साथ नियमों के रूप में लोड होती हैं।

## 4. प्रोवाइडर प्राथमिकता और डिडुप्लिकेशन

`loadCapability("rules")` (`capability/index.ts`) प्रोवाइडर आउटपुट को merge करता है और फिर `rule.name` द्वारा deduplicate करता है।

### प्राथमिकता मॉडल

- प्रोवाइडर को प्राथमिकता अवरोही क्रम में क्रमित किया जाता है।
- समान प्राथमिकता पर पंजीकरण क्रम रखा जाता है (`discovery/index.ts` से `cursor` `windsurf` से पहले)।
- Dedup first-wins है: पहले आने वाला नियम नाम रखा जाता है; बाद के समान-नाम वाले items `all` में `_shadowed` चिह्नित होते हैं और `items` से बाहर रखे जाते हैं।

वर्तमान में प्रभावी नियम प्रोवाइडर क्रम है:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Intra-provider ordering चेतावनी

किसी प्रोवाइडर के भीतर, item क्रम `loadFilesFromDir` glob परिणाम क्रम और स्पष्ट push क्रम से आता है। यह सामान्य उपयोग के लिए पर्याप्त deterministic है लेकिन code में स्पष्ट रूप से sorted नहीं है।

उल्लेखनीय source-order अंतर:

- `native` प्रोजेक्ट फिर user config dirs जोड़ता है।
- `cursor` user फिर प्रोजेक्ट परिणाम जोड़ता है।
- `windsurf` user `global_rules` पहले जोड़ता है, फिर प्रोजेक्ट नियम।
- `cline` केवल निकटतम `.clinerules` स्रोत लोड करता है।

## 5. Rulebook, Always-Apply, और TTSR buckets में विभाजन

`createAgentSession` (`sdk.ts`) में नियम खोज के बाद:

1. सभी खोजे गए नियमों को स्कैन किया जाता है।
2. `condition` (frontmatter key; `ttsr_trigger` / `ttsrTrigger` fallback के रूप में स्वीकृत) वाले नियमों को `TtsrManager` में पंजीकृत किया जाता है।
3. एक अलग `rulebookRules` सूची इस predicate के साथ बनाई जाती है:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. एक `alwaysApplyRules` सूची बनाई जाती है:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Bucket व्यवहार

- **TTSR bucket**: `condition` वाला कोई भी नियम (description आवश्यक नहीं)। अन्य buckets पर प्राथमिकता लेता है।
- **Always-apply bucket**: `alwaysApply === true`, TTSR नहीं। पूर्ण content सिस्टम प्रॉम्प्ट में inject होती है। `rule://` के माध्यम से resolve करने योग्य।
- **Rulebook bucket**: description होनी चाहिए, TTSR नहीं होना चाहिए, `alwaysApply` नहीं होना चाहिए। सिस्टम प्रॉम्प्ट में name+description द्वारा सूचीबद्ध; content `rule://` के माध्यम से मांग पर पढ़ी जाती है।
- `condition` और `alwaysApply` दोनों वाला नियम केवल TTSR में जाता है (TTSR प्राथमिकता लेता है)।
- `alwaysApply` और `description` दोनों वाला नियम केवल always-apply में जाता है (rulebook में नहीं)।

## 6. मेटाडेटा runtime surfaces को कैसे प्रभावित करता है

### `description`

- Rulebook में शामिल करने के लिए आवश्यक।
- सिस्टम प्रॉम्प्ट `<rules>` ब्लॉक में rendered।
- Description न होने का अर्थ है नियम `rule://` के माध्यम से उपलब्ध नहीं है और सिस्टम प्रॉम्प्ट नियमों में सूचीबद्ध नहीं है।

### `globs`

- `Rule` पर carry through होता है।
- सिस्टम प्रॉम्प्ट rules block में `<glob>...</glob>` entries के रूप में rendered।
- Rules UI state (`extensions` mode list) में exposed।
- **इस पाइपलाइन में स्वचालित मैचिंग के लिए लागू नहीं।** कोई runtime glob matcher नहीं है जो वर्तमान file/tool target द्वारा नियमों का चयन करे।

### `alwaysApply`

- प्रोवाइडर द्वारा पार्स और संरक्षित किया जाता है।
- UI display में उपयोग (`"always"` trigger label extensions state manager में)।
- `rulebookRules` से exclusion condition के रूप में उपयोग।
- **पूर्ण नियम content सिस्टम प्रॉम्प्ट में स्वतः inject होती है** (rulebook rules section से पहले)।
- नियम को re-reading के लिए `rule://<name>` के माध्यम से भी address किया जा सकता है।

### `ttsr_trigger`

- `rule.ttsrTrigger` पर मैप किया गया।
- यदि उपस्थित हो, नियम को TTSR manager की ओर route किया जाता है, rulebook में नहीं।

## 7. सिस्टम प्रॉम्प्ट inclusion path

`buildSystemPromptInternal` को `rules` (rulebook) और `alwaysApplyRules` दोनों प्राप्त होते हैं।

Always-apply नियम पहले rendered होते हैं, उनकी raw content सीधे प्रॉम्प्ट में inject होती है।

Rulebook नियम एक `# Rules` section में rendered होते हैं:

- `Read rule://<name> when working in matching domain`
- प्रत्येक नियम का `name`, `description`, और वैकल्पिक `<glob>` सूची

यह advisory/contextual है: प्रॉम्प्ट टेक्स्ट मॉडल से लागू नियमों को पढ़ने के लिए कहता है, लेकिन code glob applicability को enforce नहीं करता।

## 8. `rule://` internal URL व्यवहार

`RuleProtocolHandler` निम्न के साथ पंजीकृत है:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

निहितार्थ:

- `rule://<name>` **rulebookRules** और **alwaysApplyRules** दोनों के विरुद्ध resolve करता है।
- केवल TTSR वाले नियम और बिना description और बिना `alwaysApply` के नियम `rule://` के माध्यम से address करने योग्य नहीं हैं।
- Resolution exact name match है।
- अज्ञात नाम उपलब्ध नियम नामों की सूची देते हुए error लौटाते हैं।
- लौटाई गई content raw `rule.content` है (frontmatter हटाया गया), content type `text/markdown`।

## 9. ज्ञात आंशिक / non-enforced सिमेंटिक्स

1. प्रोवाइडर descriptions legacy फ़ाइलों (`.cursorrules`, `.windsurfrules`) का उल्लेख करती हैं, लेकिन वर्तमान loader code paths वास्तव में उन फ़ाइलों को नहीं पढ़ते।
2. `globs` मेटाडेटा prompt/UI को surfaced है लेकिन rule selection logic द्वारा enforce नहीं किया जाता।
3. `rule://` के लिए नियम चयन में rulebook और always-apply नियम शामिल हैं, लेकिन केवल TTSR नियम नहीं।
4. Discovery warnings (`loadCapability("rules").warnings`) उत्पन्न होती हैं लेकिन `createAgentSession` वर्तमान में इस path में उन्हें surface/log नहीं करता।
