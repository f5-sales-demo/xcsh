---
title: कौशल
description: >-
  कोडिंग एजेंट में विशेष क्षमताओं को पंजीकृत करने, खोजने और आह्वान करने के लिए
  कौशल प्रणाली।
sidebar:
  order: 3
  label: कौशल
i18n:
  sourceHash: 3e062cc13851
  translator: machine
---

# कौशल

कौशल (Skills) फ़ाइल-आधारित क्षमता पैक हैं जो स्टार्टअप पर खोजे जाते हैं और मॉडल को निम्नलिखित रूप में उपलब्ध कराए जाते हैं:

- सिस्टम प्रॉम्प्ट में हल्का मेटाडेटा (नाम + विवरण)
- `read skill://...` के माध्यम से मांग पर सामग्री
- वैकल्पिक इंटरैक्टिव `/skill:<name>` कमांड

यह दस्तावेज़ `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts`, और `src/discovery/agents-md.ts` में वर्तमान रनटाइम व्यवहार को कवर करता है।

## इस कोडबेस में एक कौशल क्या है

एक खोजा गया कौशल इस प्रकार प्रस्तुत किया जाता है:

- `name`
- `description`
- `filePath` (`SKILL.md` पथ)
- `baseDir` (कौशल डायरेक्टरी)
- स्रोत मेटाडेटा (`provider`, `level`, पथ)

रनटाइम को वैधता के लिए केवल `name` और `path` की आवश्यकता होती है। व्यवहार में, मिलान गुणवत्ता इस बात पर निर्भर करती है कि `description` सार्थक हो।

## आवश्यक लेआउट और SKILL.md अपेक्षाएं

### डायरेक्टरी लेआउट

प्रोवाइडर-आधारित खोज (native/Claude/Codex/Agents/plugin प्रोवाइडर) के लिए, कौशल **`skills/` के एक स्तर नीचे** खोजे जाते हैं:

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md` जैसे नेस्टेड पैटर्न प्रोवाइडर लोडर द्वारा खोजे नहीं जाते।

`skills.customDirectories` के लिए, स्कैनिंग उसी गैर-पुनरावर्ती लेआउट (`*/SKILL.md`) का उपयोग करती है।

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### `SKILL.md` फ्रंटमैटर

कौशल प्रकार पर समर्थित फ्रंटमैटर फ़ील्ड:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- अतिरिक्त कुंजियाँ अज्ञात मेटाडेटा के रूप में संरक्षित की जाती हैं

वर्तमान रनटाइम व्यवहार:

- `name` डिफ़ॉल्ट रूप से कौशल डायरेक्टरी का नाम होता है
- `description` निम्नलिखित के लिए आवश्यक है:
  - native `.xcsh` प्रोवाइडर कौशल खोज (`requireDescription: true`)
  - `src/discovery/helpers.ts` में `scanSkillsFromDir` के माध्यम से `skills.customDirectories` स्कैन (गैर-पुनरावर्ती)
- गैर-native प्रोवाइडर विवरण के बिना कौशल लोड कर सकते हैं

## खोज पाइपलाइन

`src/extensibility/skills.ts` में `discoverSkills()` दो पास करता है:

1. **क्षमता प्रोवाइडर** `loadCapability("skills")` के माध्यम से
2. **कस्टम डायरेक्टरी** `scanSkillsFromDir(..., { requireDescription: true })` के माध्यम से (एक-स्तरीय डायरेक्टरी गणना)

यदि `skills.enabled` `false` है, तो खोज कोई कौशल नहीं लौटाती।

### अंतर्निहित कौशल प्रोवाइडर और प्राथमिकता

प्रोवाइडर क्रम पहले प्राथमिकता-आधारित है (उच्चतर जीतता है), फिर बराबरी के लिए पंजीकरण क्रम।

वर्तमान में पंजीकृत कौशल प्रोवाइडर:

1. `native` (प्राथमिकता 100) — `src/discovery/builtin.ts` के माध्यम से `.xcsh` user/project कौशल
2. `claude` (प्राथमिकता 80)
3. प्राथमिकता 70 समूह (पंजीकरण क्रम में):
   - `claude-plugins`
   - `agents`
   - `codex`

डिडुप कुंजी कौशल नाम है। किसी दिए गए नाम वाला पहला आइटम जीतता है।

### स्रोत टॉगल और फ़िल्टरिंग

`discoverSkills()` ये नियंत्रण लागू करता है:

- स्रोत टॉगल: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- कौशल नाम पर glob फ़िल्टर:
  - `ignoredSkills` (बाहर करें)
  - `includeSkills` (allowlist शामिल करें; खाली का अर्थ है सब शामिल करें)

फ़िल्टर क्रम है:

1. स्रोत सक्षम
2. अनदेखा नहीं किया गया
3. शामिल (यदि include सूची मौजूद है)

codex/claude/native के अलावा अन्य प्रोवाइडर के लिए (उदाहरण के लिए `agents`, `claude-plugins`), सक्षमता वर्तमान में इस पर वापस जाती है: सक्षम यदि **कोई भी** अंतर्निहित स्रोत टॉगल सक्षम है।

### टकराव और डुप्लिकेट प्रबंधन

- क्षमता डिडुप पहले से ही प्रति नाम पहला कौशल रखती है (उच्चतम-प्राथमिकता प्रोवाइडर)
- `extensibility/skills.ts` अतिरिक्त रूप से:
  - `realpath` द्वारा समान फ़ाइलों को डी-डुप्लिकेट करता है (symlink-safe)
  - बाद में कौशल नाम टकराने पर टकराव चेतावनियाँ उत्सर्जित करता है
  - `scanSkillsFromDir` पर एक पतले अडैप्टर के रूप में सुविधा `discoverSkillsFromDir({ dir, source })` API रखता है
- कस्टम-डायरेक्टरी कौशल प्रोवाइडर कौशल के बाद मर्ज किए जाते हैं और उसी टकराव व्यवहार का पालन करते हैं

## रनटाइम उपयोग व्यवहार

### सिस्टम प्रॉम्प्ट एक्सपोज़र

सिस्टम प्रॉम्प्ट निर्माण (`src/system-prompt.ts`) खोजे गए कौशल का उपयोग इस प्रकार करता है:

- यदि `read` टूल उपलब्ध है:
  - प्रॉम्प्ट में खोजे गए कौशल सूची शामिल करें
- अन्यथा:
  - खोजी गई सूची छोड़ें

Task tool subagents को सामान्य session निर्माण के माध्यम से session की खोजी गई/प्रदत्त कौशल सूची प्राप्त होती है; कोई per-task कौशल pinning ओवरराइड नहीं है।

### इंटरैक्टिव `/skill:<name>` कमांड

यदि `skills.enableSkillCommands` true है, तो इंटरैक्टिव मोड प्रत्येक खोजे गए कौशल के लिए एक slash कमांड पंजीकृत करता है।

`/skill:<name> [args]` व्यवहार:

- `filePath` से सीधे कौशल फ़ाइल पढ़ता है
- फ्रंटमैटर हटाता है
- कौशल बॉडी को follow-up कस्टम संदेश के रूप में इंजेक्ट करता है
- मेटाडेटा जोड़ता है (`Skill: <path>`, वैकल्पिक `User: <args>`)

## `skill://` URL व्यवहार

`src/internal-urls/skill-protocol.ts` समर्थन करता है:

- `skill://<name>` → उस कौशल के `SKILL.md` पर resolve होता है
- `skill://<name>/<relative-path>` → उस कौशल डायरेक्टरी के अंदर resolve होता है

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

Resolution विवरण:

- कौशल नाम बिल्कुल मेल खाना चाहिए
- सापेक्ष पथ URL-decoded हैं
- absolute पथ अस्वीकृत हैं
- पथ traversal (`..`) अस्वीकृत है
- resolved पथ `baseDir` के भीतर ही रहना चाहिए
- गायब फ़ाइलें एक स्पष्ट `File not found` त्रुटि लौटाती हैं

कंटेंट प्रकार:

- `.md` => `text/markdown`
- बाकी सब => `text/plain`

गायब assets के लिए कोई fallback खोज नहीं की जाती।

## कौशल बनाम XCSH.md, कमांड, उपकरण, hooks

### कौशल बनाम XCSH.md

- **कौशल**: नामित, वैकल्पिक क्षमता पैक जो कार्य संदर्भ द्वारा चुने जाते हैं या स्पष्ट रूप से अनुरोध किए जाते हैं
- **XCSH.md/context फ़ाइलें**: स्थायी निर्देश फ़ाइलें जो context-file क्षमता के रूप में लोड होती हैं और level/depth नियमों द्वारा मर्ज की जाती हैं

`src/discovery/agents-md.ts` विशेष रूप से standalone `XCSH.md` फ़ाइलें खोजने के लिए `cwd` से पूर्वज डायरेक्टरी में चलता है (depth 20 तक), hidden-directory segments को छोड़कर।

### कौशल बनाम slash कमांड

- **कौशल**: मॉडल-पठनीय ज्ञान/वर्कफ़्लो सामग्री
- **Slash कमांड**: उपयोगकर्ता-आह्वानित कमांड एंट्री पॉइंट
- `/skill:<name>` एक सुविधा wrapper है जो कौशल टेक्स्ट इंजेक्ट करता है; यह कौशल खोज semantics नहीं बदलता

### कौशल बनाम कस्टम उपकरण

- **कौशल**: प्रॉम्प्ट संदर्भ और `read` के माध्यम से लोड की गई दस्तावेज़ीकरण/वर्कफ़्लो सामग्री
- **कस्टम उपकरण**: मॉडल द्वारा schemas और रनटाइम side effects के साथ callable executable tool API

### कौशल बनाम hooks

- **कौशल**: निष्क्रिय सामग्री
- **Hooks**: event-driven रनटाइम interceptors जो निष्पादन के दौरान व्यवहार को block/modify कर सकते हैं

## खोज तर्क से जुड़ा व्यावहारिक authoring मार्गदर्शन

- प्रत्येक कौशल को अपनी डायरेक्टरी में रखें: `<skills-root>/<skill-name>/SKILL.md`
- हमेशा स्पष्ट `name` और `description` फ्रंटमैटर शामिल करें
- संदर्भित assets को उसी कौशल डायरेक्टरी के अंतर्गत रखें और `skill://<name>/...` से एक्सेस करें
- नेस्टेड taxonomy (`team/domain/skill`) के लिए, `skills.customDirectories` को नेस्टेड parent डायरेक्टरी पर point करें; स्कैनिंग स्वयं गैर-पुनरावर्ती रहती है
- स्रोतों में डुप्लिकेट कौशल नाम से बचें; प्रोवाइडर प्राथमिकता द्वारा पहला मेल जीतता है
