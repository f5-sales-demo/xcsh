---
title: कॉन्फ़िगरेशन खोज और रिज़ॉल्यूशन
description: >-
  xcsh प्रोजेक्ट, उपयोगकर्ता और एंटरप्राइज़ रूट्स से कॉन्फ़िगरेशन कैसे खोजता,
  रिज़ॉल्व करता और लेयर करता है।
sidebar:
  order: 1
  label: कॉन्फ़िगरेशन
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# कॉन्फ़िगरेशन खोज और रिज़ॉल्यूशन

यह दस्तावेज़ बताता है कि coding-agent आज कॉन्फ़िगरेशन को कैसे रिज़ॉल्व करता है: कौन से रूट्स स्कैन किए जाते हैं, प्राथमिकता कैसे काम करती है, और रिज़ॉल्व किए गए कॉन्फ़िग को settings, skills, hooks, tools और extensions द्वारा कैसे उपभोग किया जाता है।

## दायरा

प्राथमिक कार्यान्वयन:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

प्रमुख एकीकरण बिंदु:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## रिज़ॉल्यूशन प्रवाह (दृश्य)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) कॉन्फ़िग रूट्स और स्रोत क्रम

## कैनोनिकल रूट्स

`src/config.ts` एक निश्चित स्रोत प्राथमिकता सूची परिभाषित करता है:

1. `.xcsh` (नेटिव)
2. `.claude`
3. `.codex`
4. `.gemini`

उपयोगकर्ता-स्तरीय आधार:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

प्रोजेक्ट-स्तरीय आधार:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` `.xcsh` है (`packages/utils/src/dirs.ts`)।

## महत्वपूर्ण बाधा

`src/config.ts` में जेनेरिक हेल्पर्स स्रोत खोज क्रम में `.pi` को शामिल **नहीं** करते।

---

## 2) कोर खोज हेल्पर्स (`src/config.ts`)

## `getConfigDirs(subpath, options)`

क्रमबद्ध एंट्रीज़ लौटाता है:

- पहले उपयोगकर्ता-स्तरीय एंट्रीज़ (स्रोत प्राथमिकता अनुसार)
- फिर प्रोजेक्ट-स्तरीय एंट्रीज़ (उसी स्रोत प्राथमिकता अनुसार)

विकल्प:

- `user` (डिफ़ॉल्ट `true`)
- `project` (डिफ़ॉल्ट `true`)
- `cwd` (डिफ़ॉल्ट `getProjectDir()`)
- `existingOnly` (डिफ़ॉल्ट `false`)

यह API डायरेक्टरी-आधारित कॉन्फ़िग लुकअप (commands, hooks, tools, agents, आदि) के लिए उपयोग किया जाता है।

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

क्रमबद्ध आधारों में पहली मौजूदा फ़ाइल खोजता है, पहला मिलान लौटाता है (केवल पथ या पथ+मेटाडेटा)।

## `findAllNearestProjectConfigDirs(subpath, cwd)`

पैरेंट डायरेक्टरीज़ में ऊपर की ओर चलता है और **प्रत्येक स्रोत आधार** (`.xcsh`, `.claude`, `.codex`, `.gemini`) के लिए **निकटतम मौजूदा डायरेक्टरी** लौटाता है, फिर परिणामों को स्रोत प्राथमिकता अनुसार क्रमबद्ध करता है।

इसका उपयोग तब करें जब प्रोजेक्ट कॉन्फ़िग को पूर्वज डायरेक्टरीज़ से इनहेरिट किया जाना चाहिए (मोनोरेपो/नेस्टेड वर्कस्पेस व्यवहार)।

---

## 3) फ़ाइल कॉन्फ़िग रैपर (`ConfigFile<T>` `src/config.ts` में)

`ConfigFile<T>` एकल कॉन्फ़िग फ़ाइलों के लिए स्कीमा-सत्यापित लोडर है।

समर्थित प्रारूप:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

व्यवहार:

- पार्स किए गए डेटा को प्रदान किए गए TypeBox स्कीमा के विरुद्ध AJV से सत्यापित करता है।
- `invalidate()` तक लोड परिणाम कैश करता है।
- `tryLoad()` के माध्यम से त्रि-अवस्था परिणाम लौटाता है:
  - `ok`
  - `not-found`
  - `error` (स्कीमा/पार्स संदर्भ के साथ `ConfigError`)

लेगसी माइग्रेशन अभी भी समर्थित:

- यदि लक्ष्य पथ `.yml`/`.yaml` है, तो एक समकक्ष `.json` एक बार स्वचालित रूप से माइग्रेट किया जाता है (`migrateJsonToYml`)।

---

## 4) सेटिंग्स रिज़ॉल्यूशन मॉडल (`src/config/settings.ts`)

रनटाइम सेटिंग्स मॉडल लेयर्ड है:

1. ग्लोबल सेटिंग्स: `~/.xcsh/agent/config.yml`
2. प्रोजेक्ट सेटिंग्स: settings capability के माध्यम से खोजी गई (प्रदाताओं से `settings.json`)
3. रनटाइम ओवरराइड: इन-मेमोरी, नॉन-पर्सिस्टेंट
4. स्कीमा डिफ़ॉल्ट: `SETTINGS_SCHEMA` से

प्रभावी रीड पथ:

`defaults <- global <- project <- overrides`

राइट व्यवहार:

- `settings.set(...)` **ग्लोबल** लेयर (`config.yml`) में लिखता है और बैकग्राउंड सेव की कतार में डालता है।
- प्रोजेक्ट सेटिंग्स capability खोज से केवल-पठनीय हैं।

## माइग्रेशन व्यवहार अभी भी सक्रिय

स्टार्टअप पर, यदि `config.yml` अनुपस्थित है:

1. `~/.xcsh/agent/settings.json` से माइग्रेट करें (सफलता पर `.bak` में नाम बदला जाता है)
2. `agent.db` से लेगसी DB सेटिंग्स के साथ मर्ज करें
3. मर्ज किया गया परिणाम `config.yml` में लिखें

`#migrateRawSettings` में फ़ील्ड-स्तरीय माइग्रेशन:

- `queueMode` -> `steeringMode`
- `ask.timeout` मिलीसेकंड -> सेकंड जब पुराना मान ms जैसा दिखता है (`> 1000`)
- लेगसी फ्लैट `theme: "..."` -> `theme.dark/theme.light` संरचना

---

## 5) Capability/खोज एकीकरण

अधिकांश नॉन-कोर कॉन्फ़िग लोडिंग capability रजिस्ट्री (`src/capability/index.ts` + `src/discovery/index.ts`) के माध्यम से प्रवाहित होती है।

## प्रदाता क्रम

प्रदाताओं को संख्यात्मक प्राथमिकता (उच्चतम पहले) के अनुसार क्रमबद्ध किया जाता है। उदाहरण प्राथमिकताएँ:

- Native OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## डीडुप सेमेंटिक्स

Capabilities एक `key(item)` परिभाषित करती हैं:

- समान key => पहला आइटम जीतता है (उच्च-प्राथमिकता/पहले-लोड किया गया आइटम)
- कोई key नहीं (`undefined`) => कोई डीडुप नहीं, सभी आइटम बनाए रखे जाते हैं

प्रासंगिक keys:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: कोई डीडुप नहीं (सभी आइटम संरक्षित)

---

## 6) नेटिव `.xcsh` प्रदाता व्यवहार (`src/discovery/builtin.ts`)

नेटिव प्रदाता (`id: native`) इनसे पढ़ता है:

- प्रोजेक्ट: `<cwd>/.xcsh/...`
- उपयोगकर्ता: `~/.xcsh/agent/...`

### डायरेक्टरी प्रवेश नियम

`builtin.ts` केवल तभी कॉन्फ़िग रूट शामिल करता है जब डायरेक्टरी मौजूद **और गैर-रिक्त** हो (`ifNonEmptyDir`)।

### स्कोप-विशिष्ट लोडिंग

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` और `tools/<name>/index.ts`
- Extension modules: `extensions/` के अंतर्गत खोजे जाते हैं (+ लेगसी `settings.json.extensions` स्ट्रिंग ऐरे)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### निकटतम-प्रोजेक्ट लुकअप की बारीकी

`SYSTEM.md` और `AGENTS.md` के लिए, नेटिव प्रदाता निकटतम-पूर्वज प्रोजेक्ट `.xcsh` डायरेक्टरी खोज (वॉक-अप) का उपयोग करता है लेकिन फिर भी `.xcsh` डायरेक्टरी का गैर-रिक्त होना आवश्यक है।

---

## 7) प्रमुख उपप्रणालियाँ कॉन्फ़िग का उपभोग कैसे करती हैं

## सेटिंग्स उपप्रणाली

- `Settings.init()` ग्लोबल `config.yml` + खोजे गए प्रोजेक्ट `settings.json` capability आइटम्स लोड करता है।
- केवल `level === "project"` वाले capability आइटम्स प्रोजेक्ट लेयर में मर्ज किए जाते हैं।

## Skills उपप्रणाली

- `extensibility/skills.ts` `loadCapability(skillCapability.id, { cwd })` के माध्यम से लोड करता है।
- स्रोत टॉगल और फ़िल्टर लागू करता है (`ignoredSkills`, `includeSkills`, कस्टम dirs)।
- लेगसी-नामित टॉगल अभी भी मौजूद हैं (`skills.enablePiUser`, `skills.enablePiProject`) लेकिन वे नेटिव प्रदाता (`provider === "native"`) को गेट करते हैं।

## Hooks उपप्रणाली

- `discoverAndLoadHooks()` hook capability + स्पष्ट रूप से कॉन्फ़िगर किए गए पथों से hook पथों को रिज़ॉल्व करता है।
- फिर Bun import के माध्यम से मॉड्यूल लोड करता है।

## Tools उपप्रणाली

- `discoverAndLoadCustomTools()` tool capability + प्लगइन tool पथों + स्पष्ट रूप से कॉन्फ़िगर किए गए पथों से tool पथों को रिज़ॉल्व करता है।
- डिक्लेरेटिव `.md/.json` tool फ़ाइलें केवल मेटाडेटा हैं; एक्ज़ीक्यूटेबल लोडिंग कोड मॉड्यूल की अपेक्षा करती है।

## Extensions उपप्रणाली

- `discoverAndLoadExtensions()` extension-module capability और स्पष्ट पथों से extension मॉड्यूल रिज़ॉल्व करता है।
- वर्तमान कार्यान्वयन जानबूझकर लोडिंग से पहले केवल `_source.provider === "native"` वाले capability आइटम्स रखता है।

---

## 8) भरोसा करने योग्य प्राथमिकता नियम

इस मानसिक मॉडल का उपयोग करें:

1. `config.ts` से स्रोत डायरेक्टरी क्रम उम्मीदवार पथ क्रम निर्धारित करता है।
2. Capability प्रदाता प्राथमिकता क्रॉस-प्रदाता प्राथमिकता निर्धारित करती है।
3. Capability key डीडुप टकराव व्यवहार निर्धारित करता है (keyed capabilities के लिए पहला जीतता है)।
4. उपप्रणाली-विशिष्ट मर्ज लॉजिक प्रभावी प्राथमिकता को और बदल सकता है (विशेष रूप से settings)।

### Settings-विशिष्ट चेतावनी

Settings capability आइटम्स डीडुप्लिकेट नहीं किए जाते; `Settings.#loadProjectSettings()` प्रोजेक्ट आइटम्स को लौटाए गए क्रम में डीप-मर्ज करता है। क्योंकि मर्ज बाद के आइटम मूल्यों को पहले वाले मूल्यों पर लागू करता है, प्रभावी ओवरराइड व्यवहार प्रदाता उत्सर्जन क्रम पर निर्भर करता है, न कि केवल capability key सेमेंटिक्स पर।

---

## 9) अभी भी मौजूद लेगसी/संगतता व्यवहार

- YAML-लक्षित फ़ाइलों के लिए `ConfigFile` JSON -> YAML माइग्रेशन।
- `settings.json` और `agent.db` से `config.yml` में सेटिंग्स माइग्रेशन।
- सेटिंग्स key माइग्रेशन (`queueMode`, `ask.timeout`, फ्लैट `theme`)।
- Extension मैनिफ़ेस्ट संगतता: लोडर `package.json.xcsh` और `package.json.pi` दोनों मैनिफ़ेस्ट सेक्शन स्वीकार करता है।
- लेगसी सेटिंग नाम `skills.enablePiUser` / `skills.enablePiProject` अभी भी नेटिव skill स्रोत के लिए सक्रिय गेट हैं।

यदि कोड में इन संगतता पथों को हटाया जाता है, तो इस दस्तावेज़ को तुरंत अपडेट करें; कई रनटाइम व्यवहार आज भी इन पर निर्भर हैं।
