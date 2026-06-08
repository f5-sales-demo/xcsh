---
title: Skills
description: >-
  कोडिंग एजेंट में विशेष क्षमताओं को पंजीकृत, खोजने और आमंत्रित करने के लिए
  Skills प्रणाली।
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Skills फ़ाइल-आधारित क्षमता पैक हैं जो स्टार्टअप पर खोजे जाते हैं और मॉडल को इस प्रकार उपलब्ध कराए जाते हैं:

- सिस्टम प्रॉम्प्ट में हल्के मेटाडेटा के रूप में (नाम + विवरण)
- `read skill://...` के माध्यम से ऑन-डिमांड कंटेंट
- वैकल्पिक इंटरैक्टिव `/skill:<name>` कमांड

यह दस्तावेज़ `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts`, और `src/discovery/agents-md.ts` में वर्तमान रनटाइम व्यवहार को कवर करता है।

## इस कोडबेस में skill क्या है

एक खोजी गई skill इस प्रकार प्रस्तुत की जाती है:

- `name`
- `description`
- `filePath` (`SKILL.md` पथ)
- `baseDir` (skill डायरेक्टरी)
- स्रोत मेटाडेटा (`provider`, `level`, path)

रनटाइम को वैधता के लिए केवल `name` और `path` की आवश्यकता होती है। व्यवहार में, मिलान की गुणवत्ता `description` के सार्थक होने पर निर्भर करती है।

## आवश्यक लेआउट और SKILL.md अपेक्षाएँ

### डायरेक्टरी लेआउट

प्रदाता-आधारित खोज (native/Claude/Codex/Agents/plugin प्रदाता) के लिए, skills **`skills/` के एक स्तर नीचे** खोजी जाती हैं:

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md` जैसे नेस्टेड पैटर्न प्रदाता लोडर द्वारा नहीं खोजे जाते।

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

Skill प्रकार पर समर्थित फ्रंटमैटर फ़ील्ड:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- अतिरिक्त कुंजियाँ अज्ञात मेटाडेटा के रूप में संरक्षित रहती हैं

वर्तमान रनटाइम व्यवहार:

- `name` डिफ़ॉल्ट रूप से skill डायरेक्टरी नाम होता है
- `description` इनके लिए आवश्यक है:
  - native `.xcsh` प्रदाता skill खोज (`requireDescription: true`)
  - `src/discovery/helpers.ts` में `scanSkillsFromDir` के माध्यम से `skills.customDirectories` स्कैन (गैर-पुनरावर्ती)
- गैर-native प्रदाता बिना विवरण के skills लोड कर सकते हैं

## खोज पाइपलाइन

`src/extensibility/skills.ts` में `discoverSkills()` दो पास करता है:

1. `loadCapability("skills")` के माध्यम से **क्षमता प्रदाता**
2. `scanSkillsFromDir(..., { requireDescription: true })` के माध्यम से **कस्टम डायरेक्टरी** (एक-स्तरीय डायरेक्टरी गणना)

यदि `skills.enabled` `false` है, तो खोज कोई skills नहीं लौटाती।

### अंतर्निहित skill प्रदाता और प्राथमिकता

प्रदाता क्रम प्राथमिकता-पहले (उच्च जीतता है) है, फिर बराबरी के लिए पंजीकरण क्रम।

वर्तमान पंजीकृत skill प्रदाता:

1. `native` (प्राथमिकता 100) — `src/discovery/builtin.ts` के माध्यम से `.xcsh` उपयोगकर्ता/प्रोजेक्ट skills
2. `claude` (प्राथमिकता 80)
3. प्राथमिकता 70 समूह (पंजीकरण क्रम में):
   - `claude-plugins`
   - `agents`
   - `codex`

डीडुप कुंजी skill नाम है। किसी दिए गए नाम वाला पहला आइटम जीतता है।

### स्रोत टॉगल और फ़िल्टरिंग

`discoverSkills()` ये नियंत्रण लागू करता है:

- स्रोत टॉगल: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- skill नाम पर ग्लोब फ़िल्टर:
  - `ignoredSkills` (बहिष्कृत)
  - `includeSkills` (शामिल अनुमति सूची; खाली का अर्थ है सभी शामिल करें)

फ़िल्टर क्रम है:

1. स्रोत सक्षम
2. अनदेखा नहीं किया गया
3. शामिल (यदि शामिल सूची मौजूद है)

codex/claude/native के अलावा अन्य प्रदाताओं के लिए (उदाहरण के लिए `agents`, `claude-plugins`), सक्षमता वर्तमान में इस पर वापस आती है: सक्षम यदि **कोई भी** अंतर्निहित स्रोत टॉगल सक्षम है।

### टकराव और डुप्लिकेट हैंडलिंग

- क्षमता डीडुप पहले से ही प्रति नाम पहली skill रखता है (उच्चतम-प्राथमिकता प्रदाता)
- `extensibility/skills.ts` अतिरिक्त रूप से:
  - `realpath` द्वारा समान फ़ाइलों को डी-डुप्लिकेट करता है (सिमलिंक-सुरक्षित)
  - जब बाद की skill नाम टकराती है तो टकराव चेतावनियाँ जारी करता है
  - `scanSkillsFromDir` पर एक पतले एडॉप्टर के रूप में सुविधा `discoverSkillsFromDir({ dir, source })` API रखता है
- कस्टम-डायरेक्टरी skills प्रदाता skills के बाद मर्ज होती हैं और समान टकराव व्यवहार का पालन करती हैं

## रनटाइम उपयोग व्यवहार

### सिस्टम प्रॉम्प्ट एक्सपोज़र

सिस्टम प्रॉम्प्ट निर्माण (`src/system-prompt.ts`) खोजी गई skills का उपयोग इस प्रकार करता है:

- यदि `read` टूल उपलब्ध है:
  - प्रॉम्प्ट में खोजी गई skills सूची शामिल करें
- अन्यथा:
  - खोजी गई सूची छोड़ दें

Task टूल सबएजेंट सामान्य सत्र निर्माण के माध्यम से सत्र की खोजी/प्रदान की गई skills सूची प्राप्त करते हैं; कोई प्रति-कार्य skill पिनिंग ओवरराइड नहीं है।

### इंटरैक्टिव `/skill:<name>` कमांड

यदि `skills.enableSkillCommands` सत्य है, तो इंटरैक्टिव मोड प्रति खोजी गई skill एक स्लैश कमांड पंजीकृत करता है।

`/skill:<name> [args]` व्यवहार:

- `filePath` से सीधे skill फ़ाइल पढ़ता है
- फ्रंटमैटर हटाता है
- skill बॉडी को फॉलो-अप कस्टम संदेश के रूप में इंजेक्ट करता है
- मेटाडेटा जोड़ता है (`Skill: <path>`, वैकल्पिक `User: <args>`)

## `skill://` URL व्यवहार

`src/internal-urls/skill-protocol.ts` समर्थन करता है:

- `skill://<name>` → उस skill के `SKILL.md` पर रिज़ॉल्व होता है
- `skill://<name>/<relative-path>` → उस skill डायरेक्टरी के अंदर रिज़ॉल्व होता है

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

रिज़ॉल्यूशन विवरण:

- skill नाम बिल्कुल मेल खाना चाहिए
- सापेक्ष पथ URL-डिकोड किए जाते हैं
- निरपेक्ष पथ अस्वीकृत किए जाते हैं
- पथ ट्रैवर्सल (`..`) अस्वीकृत किया जाता है
- रिज़ॉल्व किया गया पथ `baseDir` के भीतर रहना चाहिए
- गायब फ़ाइलें एक स्पष्ट `File not found` त्रुटि लौटाती हैं

कंटेंट प्रकार:

- `.md` => `text/markdown`
- बाकी सब कुछ => `text/plain`

गायब संपत्तियों के लिए कोई फ़ॉलबैक खोज नहीं की जाती।

## Skills बनाम AGENTS.md, कमांड, टूल, हुक

### Skills बनाम AGENTS.md

- **Skills**: नामित, वैकल्पिक क्षमता पैक जो कार्य संदर्भ द्वारा या स्पष्ट रूप से अनुरोध करके चुने जाते हैं
- **AGENTS.md/कॉन्टेक्स्ट फ़ाइलें**: स्थायी निर्देश फ़ाइलें जो कॉन्टेक्स्ट-फ़ाइल क्षमता के रूप में लोड होती हैं और स्तर/गहराई नियमों द्वारा मर्ज की जाती हैं

`src/discovery/agents-md.ts` विशेष रूप से `cwd` से पूर्वज डायरेक्टरी को वॉक करता है ताकि स्वतंत्र `AGENTS.md` फ़ाइलें खोजी जा सकें (गहराई 20 तक), छिपी-डायरेक्टरी खंडों को बाहर करते हुए।

### Skills बनाम स्लैश कमांड

- **Skills**: मॉडल-पठनीय ज्ञान/वर्कफ़्लो कंटेंट
- **स्लैश कमांड**: उपयोगकर्ता-आमंत्रित कमांड प्रवेश बिंदु
- `/skill:<name>` एक सुविधा रैपर है जो skill टेक्स्ट इंजेक्ट करता है; यह skill खोज शब्दार्थ नहीं बदलता

### Skills बनाम कस्टम टूल

- **Skills**: प्रॉम्प्ट कॉन्टेक्स्ट और `read` के माध्यम से लोड किया गया दस्तावेज़ीकरण/वर्कफ़्लो कंटेंट
- **कस्टम टूल**: निष्पादन योग्य टूल API जो मॉडल द्वारा स्कीमा और रनटाइम साइड इफ़ेक्ट के साथ कॉल किए जा सकते हैं

### Skills बनाम हुक

- **Skills**: निष्क्रिय कंटेंट
- **हुक**: इवेंट-संचालित रनटाइम इंटरसेप्टर जो निष्पादन के दौरान व्यवहार को ब्लॉक/संशोधित कर सकते हैं

## खोज तर्क से जुड़ा व्यावहारिक लेखन मार्गदर्शन

- प्रत्येक skill को अपनी डायरेक्टरी में रखें: `<skills-root>/<skill-name>/SKILL.md`
- हमेशा स्पष्ट `name` और `description` फ्रंटमैटर शामिल करें
- संदर्भित संपत्तियों को उसी skill डायरेक्टरी में रखें और `skill://<name>/...` से एक्सेस करें
- नेस्टेड वर्गीकरण (`team/domain/skill`) के लिए, `skills.customDirectories` को नेस्टेड पैरेंट डायरेक्टरी पर इंगित करें; स्कैनिंग स्वयं गैर-पुनरावर्ती रहती है
- स्रोतों में डुप्लिकेट skill नामों से बचें; प्रदाता प्राथमिकता द्वारा पहला मिलान जीतता है
