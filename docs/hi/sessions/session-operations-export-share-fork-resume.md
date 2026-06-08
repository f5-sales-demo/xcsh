---
title: 'सत्र संचालन: Export, Dump, Share, Fork, Resume'
description: 'वार्तालापों को निर्यात, साझा, फोर्क और पुनः आरंभ करने के लिए सत्र संचालन।'
sidebar:
  order: 3
  label: Operations
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# सत्र संचालन: export, dump, share, fork, resume/continue

यह दस्तावेज़ वर्तमान में लागू किए गए session export/share/fork/resume संचालनों के लिए ऑपरेटर-दृश्य व्यवहार का वर्णन करता है।

## कार्यान्वयन फ़ाइलें

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## संचालन मैट्रिक्स

| संचालन | प्रवेश पथ | सत्र परिवर्तन | सत्र फ़ाइल निर्माण/स्विच | आउटपुट आर्टिफैक्ट |
|---|---|---|---|---|
| `/dump` | इंटरैक्टिव स्लैश कमांड | नहीं | नहीं | क्लिपबोर्ड टेक्स्ट |
| `/export [path]` | इंटरैक्टिव स्लैश कमांड | नहीं | नहीं | HTML फ़ाइल |
| `--export <session.jsonl> [outputPath]` | CLI स्टार्टअप फ़ास्ट-पाथ | कोई रनटाइम सत्र परिवर्तन नहीं | कोई सक्रिय सत्र नहीं; लक्ष्य फ़ाइल पढ़ता है | HTML फ़ाइल |
| `/share` | इंटरैक्टिव स्लैश कमांड | नहीं | नहीं | अस्थायी HTML + share URL/gist |
| `/fork` | इंटरैक्टिव स्लैश कमांड | हाँ (सक्रिय सत्र पहचान बदलती है) | नई सत्र फ़ाइल बनाता है और वर्तमान सत्र को उसमें स्विच करता है (केवल persistent मोड) | उपस्थित होने पर आर्टिफैक्ट डायरेक्टरी को नए सत्र नेमस्पेस में कॉपी करता है |
| `/resume` | इंटरैक्टिव स्लैश कमांड | हाँ (सक्रिय इन-मेमोरी स्थिति प्रतिस्थापित) | चयनित मौजूदा सत्र फ़ाइल पर स्विच करता है | कोई नहीं |
| `--resume` | CLI स्टार्टअप (पिकर) | सत्र निर्माण के बाद हाँ | चयनित मौजूदा सत्र फ़ाइल खोलता है | कोई नहीं |
| `--resume <id\|path>` | CLI स्टार्टअप | सत्र निर्माण के बाद हाँ | मौजूदा सत्र खोलता है; क्रॉस-प्रोजेक्ट मामले में वर्तमान प्रोजेक्ट में फोर्क कर सकता है | कोई नहीं |
| `--continue` | CLI स्टार्टअप | सत्र निर्माण के बाद हाँ | टर्मिनल ब्रेडक्रंब या सबसे हाल का सत्र खोलता है; यदि कोई मौजूद नहीं है तो नया बनाता है | कोई नहीं |

## Export और dump

### `/export [outputPath]` (इंटरैक्टिव)

प्रवाह:

1. `InputController` `/export...` को `CommandController.handleExportCommand` पर रूट करता है।
2. कमांड व्हाइटस्पेस पर विभाजित होता है और `/export` के बाद केवल पहले आर्गुमेंट को `outputPath` के रूप में उपयोग करता है।
3. `AgentSession.exportToHtml()` `exportSessionToHtml(sessionManager, state, { outputPath, themeName })` को कॉल करता है।
4. सफलता पर, UI पथ दिखाता है और फ़ाइल को ब्राउज़र में खोलता है।

व्यवहार विवरण:

- `--copy`, `clipboard`, और `copy` आर्गुमेंट `/dump` उपयोग करने की चेतावनी के साथ स्पष्ट रूप से अस्वीकार किए जाते हैं।
- Export सत्र header/entries/leaf के साथ वर्तमान `systemPrompt` और एजेंट स्थिति से टूल विवरण एम्बेड करता है।
- Export के दौरान कोई सत्र प्रविष्टियाँ जोड़ी नहीं जातीं।

चेतावनी:

- आर्गुमेंट पार्सिंग व्हाइटस्पेस-आधारित (`text.split(/\s+/)`) है, इसलिए स्पेस वाले उद्धृत पथ इस कमांड पथ द्वारा एकल पथ के रूप में संरक्षित नहीं होते।

### `--export <inputSessionFile> [outputPath]` (CLI)

`main.ts` में प्रवाह:

1. जल्दी संभाला जाता है (इंटरैक्टिव/सत्र स्टार्टअप से पहले)।
2. `exportFromFile(inputPath, outputPath?)` को कॉल करता है।
3. `SessionManager.open(inputPath)` प्रविष्टियाँ लोड करता है, फिर HTML उत्पन्न और लिखा जाता है।
4. प्रक्रिया `Exported to: ...` प्रिंट करती है और बाहर निकलती है।

व्यवहार विवरण:

- गायब इनपुट फ़ाइल `File not found: <path>` के रूप में प्रकट होती है।
- यह पथ `AgentSession` नहीं बनाता और किसी चल रहे सत्र को परिवर्तित नहीं करता।

### `/dump` (इंटरैक्टिव क्लिपबोर्ड निर्यात)

प्रवाह:

1. `CommandController.handleDumpCommand()` `session.formatSessionAsText()` को कॉल करता है।
2. यदि खाली स्ट्रिंग है, तो `No messages to dump yet.` रिपोर्ट करता है।
3. अन्यथा नेटिव `copyToClipboard` के माध्यम से क्लिपबोर्ड में कॉपी करता है।

Dump सामग्री में शामिल है:

- सिस्टम प्रॉम्प्ट
- सक्रिय मॉडल/थिंकिंग स्तर
- टूल परिभाषाएँ + पैरामीटर
- उपयोगकर्ता/सहायक संदेश
- थिंकिंग ब्लॉक और टूल कॉल
- टूल परिणाम और निष्पादन ब्लॉक (`excludeFromContext` bash/python प्रविष्टियों को छोड़कर)
- कस्टम/हुक/फ़ाइल मेंशन/ब्रांच सारांश/कॉम्पैक्शन सारांश प्रविष्टियाँ

डंपिंग द्वारा कोई सत्र स्थायित्व परिवर्तन नहीं किया जाता।

## Share

`/share` केवल इंटरैक्टिव है और हमेशा वर्तमान सत्र को एक अस्थायी HTML फ़ाइल में निर्यात करके शुरू होता है।

### चरण 1: अस्थायी निर्यात

- अस्थायी फ़ाइल पथ: `${os.tmpdir()}/${Snowflake.next()}.html`
- `session.exportToHtml(tmpFile)` का उपयोग करता है
- यदि निर्यात विफल होता है (विशेष रूप से इन-मेमोरी सत्रों में), तो share त्रुटि के साथ समाप्त होता है।

### चरण 2: कस्टम share हैंडलर (यदि मौजूद हो)

`loadCustomShare()` `~/.xcsh/agent` में पहले मौजूद उम्मीदवार की जाँच करता है:

- `share.ts`
- `share.js`
- `share.mjs`

आवश्यकताएँ:

- मॉड्यूल को एक फ़ंक्शन `(htmlPath) => Promise<CustomShareResult | string | undefined>` default-export करना चाहिए।

यदि मौजूद और मान्य हो:

- UI `Sharing...` लोडर स्थिति में प्रवेश करता है।
- हैंडलर परिणाम की व्याख्या:
  - string => URL के रूप में माना जाता है, दिखाया और खोला जाता है
  - object => `url` और/या `message` दिखाया जाता है; `url` खोला जाता है
  - `undefined`/falsy => सामान्य `Session shared`
- पूर्णता के बाद अस्थायी फ़ाइल हटा दी जाती है।

महत्वपूर्ण फ़ॉलबैक व्यवहार:

- यदि कस्टम हैंडलर मौजूद है लेकिन लोडिंग विफल होती है, तो कमांड त्रुटि देता है और लौटता है।
- यदि कस्टम हैंडलर निष्पादित होता है और throw करता है, तो कमांड त्रुटि देता है और लौटता है।
- दोनों विफलता मामलों में, यह GitHub gist पर **फ़ॉलबैक नहीं करता**।
- Gist फ़ॉलबैक केवल तब होता है जब कोई कस्टम share स्क्रिप्ट मौजूद नहीं होती।

### चरण 3: डिफ़ॉल्ट gist फ़ॉलबैक

केवल तब जब कोई कस्टम share हैंडलर नहीं मिलता:

1. `gh auth status` को मान्य करता है।
2. `Creating gist...` लोडर दिखाता है।
3. `gh gist create --public=false <tmpFile>` चलाता है।
4. Gist URL पार्स करता है, gist id निकालता है, प्रीव्यू URL `https://gistpreview.github.io/?<id>` बनाता है।
5. प्रीव्यू और gist दोनों URL दिखाता है; प्रीव्यू खोलता है।

Share में रद्दीकरण/abort शब्दार्थ:

- लोडर में `onAbort` हुक है जो एडिटर UI को पुनर्स्थापित करता है और `Share cancelled` रिपोर्ट करता है।
- इस कोड पथ में अंतर्निहित `gh gist create` कमांड को abort सिग्नल नहीं भेजा जाता; रद्दीकरण UI-स्तर का है और कमांड लौटने के बाद जाँचा जाता है।

## Fork

`/fork` वर्तमान सत्र से एक नया सत्र बनाता है और सक्रिय सत्र पहचान स्विच करता है।

### पूर्व शर्तें और तत्काल गार्ड

- यदि एजेंट स्ट्रीमिंग कर रहा है, तो `/fork` चेतावनी के साथ अस्वीकार किया जाता है।
- संचालन से पहले UI स्थिति/लोडिंग संकेतक साफ़ किए जाते हैं।

### सत्र-स्तरीय प्रवाह

`AgentSession.fork()`:

1. `reason: "fork"` के साथ `session_before_switch` उत्सर्जित करता है (रद्द करने योग्य)।
2. लंबित लेखन को फ्लश करता है।
3. `SessionManager.fork()` को कॉल करता है।
4. पुराने सत्र नेमस्पेस से नए नेमस्पेस में आर्टिफैक्ट्स डायरेक्टरी कॉपी करता है (सर्वोत्तम प्रयास; गैर-ENOENT कॉपी विफलताएँ लॉग की जाती हैं, घातक नहीं)।
5. `agent.sessionId` अपडेट करता है।
6. `reason: "fork"` के साथ `session_switch` उत्सर्जित करता है।

`SessionManager.fork()` व्यवहार:

- Persistent मोड और मौजूदा सत्र फ़ाइल की आवश्यकता है।
- नई सत्र id और नई JSONL फ़ाइल पथ बनाता है।
- हेडर को निम्न के साथ पुनर्लिखित करता है:
  - नया `id`
  - नया टाइमस्टैम्प
  - `cwd` अपरिवर्तित
  - `parentSession` पिछले सत्र id पर सेट
- नई फ़ाइल में सभी गैर-हेडर प्रविष्टियाँ अपरिवर्तित रहती हैं।

### गैर-persistent व्यवहार

- इन-मेमोरी सत्र प्रबंधक `fork()` से `undefined` लौटाता है।
- `AgentSession.fork()` `false` लौटाता है।
- UI `Fork failed (session not persisted or cancelled)` रिपोर्ट करता है।

## Resume और continue

## इंटरैक्टिव `/resume`

प्रवाह:

1. `SessionManager.list(currentCwd, currentSessionDir)` के माध्यम से भरा गया सत्र चयनकर्ता खोलता है।
2. चयन पर, `SelectorController.handleResumeSession(sessionPath)` `session.switchSession(sessionPath)` को कॉल करता है।
3. UI चैट और todos को साफ़/पुनर्निर्मित करता है, फिर `Resumed session` रिपोर्ट करता है।

नोट्स:

- यह पिकर केवल वर्तमान सत्र डायरेक्टरी दायरे में सत्रों को सूचीबद्ध करता है।
- यह वैश्विक क्रॉस-प्रोजेक्ट खोज का उपयोग नहीं करता।

## CLI `--resume`

### `--resume` (बिना मान)

- `main.ts` वर्तमान cwd/sessionDir के लिए सत्रों को सूचीबद्ध करता है और पिकर खोलता है।
- सत्र निर्माण से पहले चयनित पथ `SessionManager.open(selectedPath)` के साथ खोला जाता है।

### `--resume <value>`

`createSessionManager()` समाधान क्रम:

1. यदि मान पथ जैसा दिखता है (`/`, `\`, या `.jsonl`), तो सीधे खोलें।
2. अन्यथा id उपसर्ग के रूप में माना जाता है:
   - वर्तमान दायरे में खोज (`SessionManager.list(cwd, sessionDir)`)
   - यदि नहीं मिला और कोई स्पष्ट `sessionDir` नहीं है, तो वैश्विक खोज (`SessionManager.listAll()`)

क्रॉस-प्रोजेक्ट id मिलान व्यवहार:

- यदि मिलान किए गए सत्र का cwd वर्तमान cwd से भिन्न है, तो CLI पूछता है:
  - `Session found in different project ... Fork into current directory? [y/N]`
- हाँ पर: `SessionManager.forkFrom(match.path, cwd, sessionDir)` एक नई स्थानीय फोर्क फ़ाइल बनाता है।
- नहीं/गैर-TTY डिफ़ॉल्ट पर: कमांड त्रुटि देता है।

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. वर्तमान cwd के लिए सत्र dir हल करता है।
2. पहले टर्मिनल-स्कोप्ड ब्रेडक्रंब पढ़ता है।
3. सबसे हाल में संशोधित सत्र फ़ाइल पर फ़ॉलबैक करता है।
4. मिले हुए सत्र को खोलता है; यदि कोई मौजूद नहीं है, तो नया सत्र बनाता है।

यह केवल स्टार्टअप व्यवहार है; कोई इंटरैक्टिव `/continue` स्लैश कमांड नहीं है।

## सत्र स्विचिंग वास्तव में रनटाइम स्थिति को कैसे परिवर्तित करती है

`AgentSession.switchSession(sessionPath)` resume-जैसे संचालनों द्वारा उपयोग किया जाने वाला रनटाइम संक्रमण करता है:

1. `reason: "resume"` और `targetSessionFile` के साथ `session_before_switch` उत्सर्जित करता है (रद्द करने योग्य)।
2. एजेंट इवेंट सब्सक्रिप्शन डिस्कनेक्ट करता है और चल रहे कार्य को abort करता है।
3. कतारबद्ध steering/follow-up/next-turn संदेशों को साफ़ करता है।
4. वर्तमान सत्र प्रबंधक लेखन को फ्लश करता है।
5. `sessionManager.setSessionFile(sessionPath)` और `agent.sessionId` अपडेट करता है।
6. लोड की गई प्रविष्टियों से सत्र संदर्भ बनाता है।
7. `reason: "resume"` के साथ `session_switch` उत्सर्जित करता है।
8. संदर्भ से एजेंट संदेशों को प्रतिस्थापित करता है।
9. मॉडल को पुनर्स्थापित करता है (यदि वर्तमान रजिस्ट्री में उपलब्ध हो)।
10. थिंकिंग स्तर को पुनर्स्थापित या आरंभ करता है।
11. एजेंट इवेंट सब्सक्रिप्शन पुनः कनेक्ट करता है।

`switchSession()` स्वयं कोई नई सत्र फ़ाइल नहीं बनाता।

## इवेंट उत्सर्जन और रद्दीकरण बिंदु

### Switch/fork जीवनचक्र हुक

`newSession`, `fork`, और `switchSession` के लिए:

- पूर्व इवेंट: `session_before_switch`
  - कारण: `new`, `fork`, `resume`
  - `{ cancel: true }` लौटाकर रद्द करने योग्य
- पश्चात इवेंट: `session_switch`
  - समान कारण सेट
  - `previousSessionFile` शामिल करता है

`ExtensionRunner.emit()` पहले रद्द करने वाले before-event परिणाम पर जल्दी लौटता है।

### कस्टम टूल `onSession` व्यवहार

SDK ब्रिज एक्सटेंशन सत्र इवेंट्स को कस्टम टूल `onSession` कॉलबैक से जोड़ता है:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

ये कॉलबैक अवलोकनात्मक हैं; ये switch/fork को रद्द नहीं करते।

### इस दस्तावेज़ से संबंधित अन्य रद्दीकरण सतहें

- स्ट्रीमिंग के दौरान `/fork` अवरुद्ध है (उपयोगकर्ता को पहले वर्तमान प्रतिक्रिया की प्रतीक्षा/abort करना होगा)।
- उपयोगकर्ता द्वारा चयनकर्ता बंद करके `/resume` चयनकर्ता रद्द किया जा सकता है।
- फोर्क प्रॉम्प्ट को अस्वीकार करके क्रॉस-प्रोजेक्ट `--resume <id>` रद्द किया जा सकता है।
- `/share` में gist प्रवाह के लिए UI abort पथ (`Share cancelled`) है; यह इस कोड पथ में `gh gist create` के लिए process-kill शब्दार्थ को वायर नहीं करता।

## गैर-persistent (इन-मेमोरी) सत्र व्यवहार

जब सत्र प्रबंधक `SessionManager.inMemory()` (`--no-session`) के साथ बनाया जाता है:

- सत्र फ़ाइल पथ अनुपस्थित होता है।
- `/export` और `/share` `Cannot export in-memory session to HTML` के साथ विफल होते हैं (कमांड त्रुटि UI में प्रचारित)।
- `/fork` विफल होता है क्योंकि `SessionManager.fork()` को persistence की आवश्यकता होती है।
- `/dump` अभी भी काम करता है क्योंकि यह इन-मेमोरी एजेंट स्थिति को क्रमबद्ध करता है।
- CLI resume/continue शब्दार्थ बायपास किए जाते हैं यदि `--no-session` सेट है, क्योंकि प्रबंधक निर्माण तुरंत इन-मेमोरी लौटता है।

## ज्ञात कार्यान्वयन चेतावनियाँ (वर्तमान कोड के अनुसार)

- `SelectorController.handleResumeSession()` `session.switchSession(...)` से बूलियन परिणाम की जाँच नहीं करता; एक हुक-रद्द स्विच अभी भी UI "Resumed session" repaint/status पथ से आगे बढ़ सकता है।
- `/share` कस्टम-share विफलताएँ डिफ़ॉल्ट gist फ़ॉलबैक में नहीं गिरतीं; वे त्रुटि के साथ कमांड को समाप्त करती हैं।
- `/export` आर्गुमेंट टोकनाइज़ेशन सरल है और स्पेस वाले उद्धृत पथों को संरक्षित नहीं करता।
