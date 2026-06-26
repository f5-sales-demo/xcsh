---
title: थीमिंग संदर्भ
description: 'रंग टोकन, फ़ॉन्ट सेटिंग और थीम अनुकूलन के साथ TUI थीमिंग संदर्भ।'
sidebar:
  order: 3
  label: थीमिंग
i18n:
  sourceHash: 7132374bd51e
  translator: machine
---

# थीमिंग संदर्भ

यह दस्तावेज़ बताता है कि आज कोडिंग-एजेंट में थीमिंग कैसे काम करती है: स्कीमा, लोडिंग, रनटाइम व्यवहार, और विफलता के तरीके।

## थीम सिस्टम क्या नियंत्रित करता है

थीम सिस्टम निम्नलिखित को संचालित करता है:

- TUI भर में उपयोग किए जाने वाले फ़ोरग्राउंड/बैकग्राउंड रंग टोकन
- मार्कडाउन स्टाइलिंग अडैप्टर (`getMarkdownTheme()`)
- सेलेक्टर/एडिटर/सेटिंग्स लिस्ट अडैप्टर (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- सिंबल प्रीसेट + सिंबल ओवरराइड (`unicode`, `nerd`, `ascii`)
- नेटिव हाइलाइटर द्वारा उपयोग किए जाने वाले सिंटैक्स हाइलाइटिंग रंग (`@f5-sales-demo/pi-natives`)
- स्टेटस लाइन सेगमेंट रंग

प्राथमिक इम्प्लीमेंटेशन: `src/modes/theme/theme.ts`।

## थीम JSON आकार

थीम फ़ाइलें JSON ऑब्जेक्ट हैं जिन्हें `theme.ts` (`ThemeJsonSchema`) में रनटाइम स्कीमा के विरुद्ध सत्यापित किया जाता है और `src/modes/theme/theme-schema.json` द्वारा मिरर किया जाता है।

शीर्ष-स्तरीय फ़ील्ड:

- `name` (आवश्यक)
- `colors` (आवश्यक; सभी रंग टोकन आवश्यक)
- `vars` (वैकल्पिक; पुन: उपयोग योग्य रंग वेरिएबल)
- `export` (वैकल्पिक; HTML एक्सपोर्ट रंग)
- `symbols` (वैकल्पिक)
  - `preset` (वैकल्पिक: `unicode | nerd | ascii`)
  - `overrides` (वैकल्पिक: `SymbolKey` के लिए key/value ओवरराइड)

रंग मान स्वीकार करते हैं:

- hex स्ट्रिंग (`"#RRGGBB"`)
- 256-रंग इंडेक्स (`0..255`)
- वेरिएबल संदर्भ स्ट्रिंग (`vars` के माध्यम से रिज़ॉल्व किया गया)
- रिक्त स्ट्रिंग (`""`) जिसका अर्थ है टर्मिनल डिफ़ॉल्ट (`\x1b[39m` fg, `\x1b[49m` bg)

## आवश्यक रंग टोकन (वर्तमान)

नीचे सभी टोकन `colors` में आवश्यक हैं।

### मुख्य टेक्स्ट और बॉर्डर (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### बैकग्राउंड ब्लॉक (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### मैसेज/टूल टेक्स्ट (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### मार्कडाउन (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### टूल diff + सिंटैक्स हाइलाइटिंग (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### मोड/थिंकिंग बॉर्डर (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### स्टेटस लाइन सेगमेंट रंग (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## वैकल्पिक टोकन

### `export` अनुभाग (वैकल्पिक)

HTML एक्सपोर्ट थीमिंग हेल्पर के लिए उपयोग किया जाता है:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

यदि छोड़ा गया, तो एक्सपोर्ट कोड रिज़ॉल्व किए गए थीम रंगों से डिफ़ॉल्ट प्राप्त करता है।

### `symbols` अनुभाग (वैकल्पिक)

- `symbols.preset` एक थीम-स्तरीय डिफ़ॉल्ट सिंबल सेट सेट करता है।
- `symbols.overrides` व्यक्तिगत `SymbolKey` मानों को ओवरराइड कर सकता है।

रनटाइम प्राथमिकता:

1. सेटिंग्स `symbolPreset` ओवरराइड (यदि सेट है)
2. थीम JSON `symbols.preset`
3. फ़ॉलबैक `"unicode"`

अमान्य ओवरराइड keys को अनदेखा किया जाता है और लॉग किया जाता है (`logger.debug`)।

## बिल्ट-इन बनाम कस्टम थीम स्रोत

थीम लुकअप क्रम (`loadThemeJson`):

1. बिल्ट-इन एम्बेडेड थीम (`defaults/xcsh-dark.json` और `defaults/xcsh-light.json` जो `defaultThemes` में संकलित हैं)
2. कस्टम थीम फ़ाइल: `<customThemesDir>/<name>.json`

कस्टम थीम डायरेक्टरी `getCustomThemesDir()` से आती है:

- डिफ़ॉल्ट: `~/.xcsh/agent/themes`
- `PI_CODING_AGENT_DIR` द्वारा ओवरराइड किया गया (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` मर्ज किए गए बिल्ट-इन + कस्टम नाम लौटाता है, सॉर्ट किए गए, नाम टकराव पर बिल्ट-इन को प्राथमिकता मिलती है।

## लोडिंग, सत्यापन, और रिज़ॉल्यूशन

कस्टम थीम फ़ाइलों के लिए:

1. JSON पढ़ें
2. JSON पार्स करें
3. `ThemeJsonSchema` के विरुद्ध सत्यापित करें
4. `vars` संदर्भों को पुनरावर्ती रूप से रिज़ॉल्व करें
5. रिज़ॉल्व किए गए मानों को टर्मिनल क्षमता मोड द्वारा ANSI में परिवर्तित करें

सत्यापन व्यवहार:

- अनुपस्थित आवश्यक रंग टोकन: स्पष्ट समूहीकृत त्रुटि संदेश
- गलत टोकन प्रकार/मान: JSON पथ के साथ सत्यापन त्रुटियाँ
- अज्ञात थीम फ़ाइल: `Theme not found: <name>`

Var संदर्भ व्यवहार:

- नेस्टेड संदर्भों का समर्थन करता है
- अनुपस्थित वेरिएबल संदर्भ पर त्रुटि फेंकता है
- गोलाकार संदर्भों पर त्रुटि फेंकता है

## टर्मिनल रंग मोड व्यवहार

रंग मोड डिटेक्शन (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` में `dumb`, `linux`, या खाली => 256color
- अन्यथा => truecolor

रूपांतरण व्यवहार:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numeric -> `38;5` / `48;5` ANSI
- `""` -> डिफ़ॉल्ट fg/bg रीसेट

## रनटाइम स्विचिंग व्यवहार

### प्रारंभिक थीम (`initTheme`)

`main.ts` सेटिंग्स के साथ थीम इनिशियलाइज़ करता है:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

ऑटो थीम स्लॉट चयन `COLORFGBG` बैकग्राउंड डिटेक्शन का उपयोग करता है:

- `COLORFGBG` से बैकग्राउंड इंडेक्स पार्स करें
- `< 8` => डार्क स्लॉट (`theme.dark`)
- `>= 8` => लाइट स्लॉट (`theme.light`)
- पार्स विफलता => डार्क स्लॉट

सेटिंग्स स्कीमा से वर्तमान डिफ़ॉल्ट:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### स्पष्ट स्विचिंग (`setTheme`)

- चयनित थीम लोड करता है
- ग्लोबल `theme` सिंगलटन अपडेट करता है
- वैकल्पिक रूप से वॉचर शुरू करता है
- `onThemeChange` कॉलबैक ट्रिगर करता है

विफलता पर:

- बिल्ट-इन `dark` पर फ़ॉलबैक करता है
- `{ success: false, error }` लौटाता है

### प्रीव्यू स्विचिंग (`previewTheme`)

- ग्लोबल `theme` पर अस्थायी प्रीव्यू थीम लागू करता है
- अपने आप सहेजी गई सेटिंग्स **नहीं** बदलता
- फ़ॉलबैक प्रतिस्थापन के बिना success/error लौटाता है

सेटिंग्स UI इसे लाइव प्रीव्यू के लिए उपयोग करता है और रद्द करने पर पूर्व थीम पुनर्स्थापित करता है।

## वॉचर और लाइव रीलोड

जब वॉचर सक्षम हो (`setTheme(..., true)` / इंटरएक्टिव इनिट):

- केवल कस्टम फ़ाइल पथ `<customThemesDir>/<currentTheme>.json` देखता है
- बिल्ट-इन प्रभावी रूप से नहीं देखे जाते
- फ़ाइल `change`: रीलोड का प्रयास करता है (debounced)
- फ़ाइल `rename`/delete: `dark` पर फ़ॉलबैक करता है, वॉचर बंद करता है

ऑटो मोड एक `SIGWINCH` लिस्टनर भी इंस्टॉल करता है और टर्मिनल स्थिति बदलने पर डार्क/लाइट स्लॉट मैपिंग का पुनर्मूल्यांकन कर सकता है।

## कलर-ब्लाइंड मोड व्यवहार

`colorBlindMode` रनटाइम पर केवल एक टोकन बदलता है:

- `toolDiffAdded` को HSV-समायोजित किया जाता है (हरा रंग नीले की ओर स्थानांतरित)
- समायोजन केवल तब लागू होता है जब रिज़ॉल्व किया गया मान hex स्ट्रिंग हो

अन्य टोकन अपरिवर्तित रहते हैं।

## थीम सेटिंग्स कहाँ सहेजी जाती हैं

थीम-संबंधित सेटिंग्स `Settings` द्वारा ग्लोबल config YAML में सहेजी जाती हैं:

- पथ: `<agentDir>/config.yml`
- डिफ़ॉल्ट एजेंट डायरेक्टरी: `~/.xcsh/agent`
- प्रभावी डिफ़ॉल्ट फ़ाइल: `~/.xcsh/agent/config.yml`

सहेजी गई keys:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

लेगेसी माइग्रेशन मौजूद है: पुराने फ्लैट `theme: "name"` को luminance डिटेक्शन के आधार पर नेस्टेड `theme.dark` या `theme.light` में माइग्रेट किया जाता है।

## कस्टम थीम बनाना (व्यावहारिक)

1. कस्टम थीम डायरेक्टरी में फ़ाइल बनाएँ, जैसे `~/.xcsh/agent/themes/my-theme.json`।
2. `name`, वैकल्पिक `vars`, और **सभी आवश्यक** `colors` टोकन शामिल करें।
3. वैकल्पिक रूप से `symbols` और `export` शामिल करें।
4. Settings में थीम चुनें (`Display -> Dark theme` या `Display -> Light theme`) इस पर निर्भर करते हुए कि आप कौन सा ऑटो स्लॉट चाहते हैं।

न्यूनतम स्केलेटन। `colors` में हर key आवश्यक है — रनटाइम वैलिडेटर
(`additionalProperties: false`) अनुपस्थित keys और अज्ञात keys दोनों को अस्वीकार करता है।
शिप किए गए संदर्भ इम्प्लीमेंटेशन के लिए देखें
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
और [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)।

स्टेटस लाइन में दो समानांतर रंग प्रणालियाँ हैं जो issue #242 में दस्तावेज़ीकृत हैं:

- Hex टेक्स्ट रंग (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) नॉन-पावरलाइन
  रेंडरिंग को संचालित करते हैं।
- 256-रंग पैलेट इंडेक्स (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  पावरलाइन सेगमेंट फिल को संचालित करते हैं। वे ऊपर की hex keys से स्वतंत्र हैं —
  दोनों सेट होने चाहिए।

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileXcshBg": "accent",
    "statusLineProfileXcshFg": 231
  }
}
```

## कस्टम थीम का परीक्षण

इस वर्कफ़्लो का उपयोग करें:

1. इंटरएक्टिव मोड शुरू करें (स्टार्टअप से वॉचर सक्षम)।
2. सेटिंग्स खोलें और थीम मान प्रीव्यू करें (लाइव `previewTheme`)।
3. कस्टम थीम फ़ाइलों के लिए, चलते समय JSON संपादित करें और सेव पर ऑटो-रीलोड की पुष्टि करें।
4. महत्वपूर्ण सतहों का परीक्षण करें:
   - मार्कडाउन रेंडरिंग
   - टूल ब्लॉक (pending/success/error)
   - diff रेंडरिंग (added/removed/context)
   - स्टेटस लाइन पठनीयता
   - थिंकिंग स्तर बॉर्डर परिवर्तन
   - bash/python मोड बॉर्डर रंग
5. यदि आपकी थीम glyph चौड़ाई/दिखावट पर निर्भर करती है तो दोनों सिंबल प्रीसेट सत्यापित करें।

## वास्तविक बाधाएँ और सावधानियाँ

- कस्टम थीम के लिए सभी `colors` टोकन आवश्यक हैं।
- `export` और `symbols` वैकल्पिक हैं।
- थीम JSON में `$schema` सूचनात्मक है; रनटाइम सत्यापन कोड में संकलित TypeBox स्कीमा द्वारा लागू किया जाता है।
- `setTheme` विफलता `dark` पर फ़ॉलबैक करती है; `previewTheme` विफलता वर्तमान थीम को प्रतिस्थापित नहीं करती।
- फ़ाइल वॉचर रीलोड त्रुटियाँ वर्तमान लोड की गई थीम को तब तक बनाए रखती हैं जब तक कि सफल रीलोड या फ़ॉलबैक पथ ट्रिगर न हो जाए।
