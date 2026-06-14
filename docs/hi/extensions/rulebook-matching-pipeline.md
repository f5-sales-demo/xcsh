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

यह दस्तावेज़ बताता है कि coding-agent किस प्रकार समर्थित कॉन्फ़िग फ़ॉर्मेट से नियमों की खोज करता है, उन्हें एकल `Rule` आकार में सामान्यीकृत करता है, प्राथमिकता विरोधों को हल करता है, और परिणाम को निम्नलिखित में विभाजित करता है:

- **Rulebook rules** (मॉडल को सिस्टम प्रॉम्प्ट + `rule://` URLs के माध्यम से उपलब्ध)
- **TTSR rules** (टाइम-ट्रैवल स्ट्रीम इंटरप्शन नियम)

यह वर्तमान कार्यान्वयन को दर्शाता है, जिसमें आंशिक सिमेंटिक्स और मेटाडेटा शामिल हैं जो पार्स तो किए जाते हैं लेकिन लागू नहीं किए जाते।

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

## 1. कैनोनिकल रूल आकार

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

Capability की पहचान `rule.name` है (`ruleCapability.key = rule => rule.name`)।

परिणाम: प्राथमिकता और डिडुप्लिकेशन **केवल नाम-आधारित** हैं। एक ही `name` वाली दो अलग-अलग फ़ाइलें एक ही तार्किक नियम मानी जाती हैं।

## 2. खोज स्रोत और सामान्यीकरण

`src/discovery/index.ts` प्रोवाइडर को स्वतः पंजीकृत करता है। `rules` के लिए वर्तमान प्रोवाइडर हैं:

- `native` (priority `100`)
- `cursor` (priority `50`)
- `windsurf` (priority `50`)
- `cline` (priority `40`)

### Native प्रोवाइडर (`builtin.ts`)

`.xcsh` नियम निम्नलिखित से लोड करता है:

- project: `<cwd>/.xcsh/rules/*.{md,mdc}`
- user: `~/.xcsh/agent/rules/*.{md,mdc}`

सामान्यीकरण:

- `name` = `.md`/`.mdc` के बिना फ़ाइलनाम
- frontmatter `parseFrontmatter` के माध्यम से पार्स किया जाता है
- `content` = body (frontmatter हटाया हुआ)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` सीधे मैप किए जाते हैं

महत्वपूर्ण चेतावनी: `globs` को इस प्रोवाइडर में किसी element फ़िल्टरिंग के बिना `string[] | undefined` के रूप में cast किया जाता है।

### Cursor प्रोवाइडर (`cursor.ts`)

निम्नलिखित से लोड करता है:

- user: `~/.cursor/rules/*.{mdc,md}`
- project: `<cwd>/.cursor/rules/*.{mdc,md}`

सामान्यीकरण (`transformMDCRule`):

- `description`: केवल तभी रखा जाता है जब string हो
- `alwaysApply`: केवल `true` संरक्षित किया जाता है (`false` `undefined` हो जाता है)
- `globs`: array (केवल string elements) या single string स्वीकार करता है
- `ttsr_trigger`: केवल string
- `name` extension के बिना फ़ाइलनाम से

### Windsurf प्रोवाइडर (`windsurf.ts`)

निम्नलिखित से लोड करता है:

- user: `~/.codeium/windsurf/memories/global_rules.md` (निश्चित नियम नाम `global_rules`)
- project: `<cwd>/.windsurf/rules/*.md`

सामान्यीकरण:

- `globs`: array-of-string या single string
- `alwaysApply`, `description` frontmatter से cast किए जाते हैं
- `ttsr_trigger`: केवल string
- project नियमों के लिए `name` फ़ाइलनाम से

### Cline प्रोवाइडर (`cline.ts`)

निकटतम `.clinerules` के लिए `cwd` से ऊपर की ओर खोज करता है:

- यदि directory हो: उसके अंदर `*.md` लोड करता है
- यदि file हो: `clinerules` नाम से single file के रूप में लोड करता है

सामान्यीकरण:

- `globs`: array-of-string या single string
- `alwaysApply`: केवल तभी यदि boolean हो
- `description`: केवल string
- `ttsr_trigger`: केवल string

## 3. Frontmatter पार्सिंग व्यवहार और अस्पष्टता

सभी प्रोवाइडर `parseFrontmatter` (`utils/frontmatter.ts`) का उपयोग इन सिमेंटिक्स के साथ करते हैं:

1. Frontmatter तभी पार्स होता है जब content `---` से शुरू हो और closing `\n---` हो।
2. Frontmatter निष्कर्षण के बाद Body trim की जाती है।
3. यदि YAML parse विफल हो:
   - warning लॉग की जाती है,
   - parser simple `key: value` लाइन पार्सिंग पर वापस जाता है (`^(\w+):\s*(.*)$`)।

अस्पष्टता के परिणाम:

- Fallback parser arrays, nested objects, quoting rules, या hyphenated keys को सपोर्ट नहीं करता।
- Fallback values strings बन जाते हैं (उदाहरण के लिए `alwaysApply: true` string `"true"` बन जाता है), इसलिए boolean/string types की आवश्यकता वाले प्रोवाइडर मेटाडेटा छोड़ सकते हैं।
- `ttsr_trigger` fallback में काम करता है (underscore key); `thinking-level` जैसी keys नहीं करतीं।
- वैध frontmatter के बिना फ़ाइलें अभी भी खाली मेटाडेटा और पूर्ण content body के साथ नियमों के रूप में लोड होती हैं।

## 4. प्रोवाइडर प्राथमिकता और डिडुप्लिकेशन

`loadCapability("rules")` (`capability/index.ts`) प्रोवाइडर आउटपुट को मर्ज करता है और फिर `rule.name` द्वारा डिडुप्लिकेट करता है।

### प्राथमिकता मॉडल

- प्रोवाइडर को priority के अनुसार घटते क्रम में क्रमबद्ध किया जाता है।
- समान priority पंजीकरण क्रम रखती है (`discovery/index.ts` से `cursor` पहले `windsurf` से)।
- Dedup first-wins है: पहला मिला नियम नाम रखा जाता है; बाद के same-name items `all` में `_shadowed` चिह्नित होते हैं और `items` से बाहर रखे जाते हैं।

वर्तमान में प्रभावी नियम प्रोवाइडर क्रम है:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Intra-provider क्रम चेतावनी

एक प्रोवाइडर के भीतर, item क्रम `loadFilesFromDir` glob परिणाम क्रम से आता है साथ ही स्पष्ट push क्रम से। यह सामान्य उपयोग के लिए पर्याप्त रूप से deterministic है, लेकिन code में स्पष्ट रूप से sorted नहीं है।

उल्लेखनीय source-order अंतर:

- `native` project फिर user config dirs जोड़ता है।
- `cursor` user फिर project परिणाम जोड़ता है।
- `windsurf` पहले user `global_rules` जोड़ता है, फिर project rules।
- `cline` केवल निकटतम `.clinerules` स्रोत लोड करता है।

## 5. Rulebook, Always-Apply, और TTSR बकेट में विभाजन

`createAgentSession` (`sdk.ts`) में नियम खोज के बाद:

1. सभी खोजे गए नियमों की जांच की जाती है।
2. `condition` (frontmatter key; fallback के रूप में `ttsr_trigger` / `ttsrTrigger` स्वीकृत) वाले नियम `TtsrManager` में पंजीकृत किए जाते हैं।
3. एक अलग `rulebookRules` सूची इस predicate के साथ बनाई जाती है:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. एक `alwaysApplyRules` सूची बनाई जाती है:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### बकेट व्यवहार

- **TTSR बकेट**: कोई भी नियम जिसमें `condition` हो (description आवश्यक नहीं)। अन्य बकेट पर प्राथमिकता लेता है।
- **Always-apply बकेट**: `alwaysApply === true`, TTSR नहीं। पूर्ण content सिस्टम प्रॉम्प्ट में inject किया जाता है। `rule://` के माध्यम से resolvable।
- **Rulebook बकेट**: description होनी चाहिए, TTSR नहीं होना चाहिए, `alwaysApply` नहीं होना चाहिए। सिस्टम प्रॉम्प्ट में name+description द्वारा सूचीबद्ध; content `rule://` के माध्यम से मांग पर पढ़ी जाती है।
- `condition` और `alwaysApply` दोनों वाला नियम केवल TTSR में जाता है (TTSR प्राथमिकता लेता है)।
- `alwaysApply` और `description` दोनों वाला नियम केवल always-apply में जाता है (rulebook में नहीं)।

## 6. मेटाडेटा रनटाइम सर्फेस को कैसे प्रभावित करता है

### `description`

- Rulebook में शामिल होने के लिए आवश्यक।
- सिस्टम प्रॉम्प्ट `<rules>` ब्लॉक में रेंडर किया जाता है।
- Missing description का अर्थ है नियम `rule://` के माध्यम से उपलब्ध नहीं है और सिस्टम प्रॉम्प्ट rules में सूचीबद्ध नहीं है।

### `globs`

- `Rule` पर carry through किया जाता है।
- सिस्टम प्रॉम्प्ट rules ब्लॉक में `<glob>...</glob>` entries के रूप में रेंडर किया जाता है।
- Rules UI state में exposed (`extensions` mode list)।
- **इस पाइपलाइन में automatic matching के लिए enforce नहीं किया जाता।** कोई runtime glob matcher नहीं है जो current file/tool target द्वारा नियम चुने।

### `alwaysApply`

- प्रोवाइडर द्वारा पार्स और संरक्षित।
- UI display में उपयोग (`"always"` trigger label extensions state manager में)।
- `rulebookRules` से exclusion condition के रूप में उपयोग।
- **पूर्ण नियम content सिस्टम प्रॉम्प्ट में auto-inject किया जाता है** (rulebook rules section से पहले)।
- नियम `rule://<name>` के माध्यम से re-reading के लिए भी addressable है।

### `ttsr_trigger`

- `rule.ttsrTrigger` से mapped।
- उपस्थित होने पर, नियम TTSR manager को routed किया जाता है, rulebook को नहीं।

## 7. सिस्टम प्रॉम्प्ट समावेश पथ

`buildSystemPromptInternal` दोनों `rules` (rulebook) और `alwaysApplyRules` प्राप्त करता है।

Always-apply नियम पहले रेंडर किए जाते हैं, उनकी raw content सीधे prompt में inject की जाती है।

Rulebook नियम एक `# Rules` section में रेंडर किए जाते हैं:

- `Read rule://<name> when working in matching domain`
- प्रत्येक नियम का `name`, `description`, और वैकल्पिक `<glob>` सूची

यह advisory/contextual है: prompt text मॉडल को applicable rules पढ़ने के लिए कहता है, लेकिन code glob applicability enforce नहीं करता।

## 8. `rule://` आंतरिक URL व्यवहार

`RuleProtocolHandler` इसके साथ पंजीकृत है:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

निहितार्थ:

- `rule://<name>` दोनों **rulebookRules** और **alwaysApplyRules** के विरुद्ध resolve होता है।
- केवल TTSR नियम और बिना description और `alwaysApply` के नियम `rule://` के माध्यम से addressable नहीं हैं।
- Resolution exact name match है।
- अज्ञात names उपलब्ध नियम names सूचीबद्ध करते हुए error लौटाते हैं।
- लौटाई गई content raw `rule.content` है (frontmatter हटाया हुआ), content type `text/markdown`।

## 9. ज्ञात आंशिक / non-enforced सिमेंटिक्स

1. प्रोवाइडर descriptions legacy files (`.cursorrules`, `.windsurfrules`) का उल्लेख करती हैं, लेकिन वर्तमान loader code paths वास्तव में उन files को नहीं पढ़ते।
2. `globs` मेटाडेटा prompt/UI पर surfaced होता है लेकिन नियम चयन logic द्वारा enforce नहीं किया जाता।
3. `rule://` के लिए नियम चयन में rulebook और always-apply नियम शामिल हैं, लेकिन TTSR-only नियम नहीं।
4. Discovery warnings (`loadCapability("rules").warnings`) उत्पन्न होती हैं लेकिन `createAgentSession` वर्तमान में इस path में उन्हें surface/log नहीं करता।
