---
title: 'नेटिव्स शेल, PTY, प्रोसेस, और Key आंतरिक संरचना'
description: >-
  नेटिव लेयर में शेल एक्सीक्यूशन, PTY प्रबंधन, प्रोसेस जीवनचक्र, और key इवेंट
  हैंडलिंग।
sidebar:
  order: 4
  label: 'शेल, PTY और प्रोसेस'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# नेटिव्स शेल, PTY, प्रोसेस, और Key आंतरिक संरचना

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` में **एक्सीक्यूशन/प्रोसेस/टर्मिनल प्रिमिटिव्स** को कवर करता है: `shell`, `pty`, `ps`, और `keys`, जो `docs/natives-architecture.md` से आर्किटेक्चर शब्दावली का उपयोग करता है।

## इम्प्लीमेंटेशन फ़ाइलें

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (केवल Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (shell/pty द्वारा उपयोग किया जाने वाला साझा कैंसिलेशन व्यवहार)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## लेयर स्वामित्व

- **TS रैपर/API लेयर** (`packages/natives/src/*`): टाइप्ड एंट्रीपॉइंट्स, कैंसिलेशन सरफेस (`timeoutMs`, `AbortSignal`), और JS एर्गोनॉमिक्स।
- **Rust N-API मॉड्यूल लेयर** (`crates/pi-natives/src/*`): शेल/PTY प्रोसेस एक्सीक्यूशन, प्रोसेस-ट्री ट्रैवर्सल/टर्मिनेशन, और key-सीक्वेंस पार्सिंग।
- **वैलिडेशन गेट** (`native.ts`, आर्किटेक्चर-स्तर): रैपर्स के उपयोग से पहले सुनिश्चित करता है कि आवश्यक एक्सपोर्ट्स (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, key हेल्पर्स) मौजूद हैं।

## शेल सबसिस्टम (`shell`)

### API मॉडल

दो एक्सीक्यूशन मोड एक्सपोज़ किए गए हैं:

1. **वन-शॉट** `executeShell(options, onChunk?)` के माध्यम से।
2. **पर्सिस्टेंट सेशन** `new Shell(options?)` के माध्यम से फिर बार-बार `shell.run(...)`।

दोनों एक threadsafe कॉलबैक के माध्यम से आउटपुट स्ट्रीम करते हैं और `{ exitCode?, cancelled, timedOut }` रिटर्न करते हैं।

### सेशन निर्माण और एनवायरनमेंट मॉडल

Rust `brush_core::Shell` बनाता है:

- नॉन-इंटरैक्टिव मोड,
- `do_not_inherit_env: true`,
- होस्ट env से स्पष्ट एनवायरनमेंट पुनर्निर्माण,
- शेल-सेंसिटिव वेरिएबल्स के लिए स्किप-लिस्ट (`PS1`, `PWD`, `SHLVL`, bash फ़ंक्शन एक्सपोर्ट्स, आदि)।

सेशन env व्यवहार:

- `ShellOptions.sessionEnv` सेशन निर्माण के समय एक बार लागू होता है।
- `ShellRunOptions.env` कमांड-स्कोप्ड (`EnvironmentScope::Command`) है और प्रत्येक रन के बाद पॉप हो जाता है।
- Windows पर `PATH` को केस-इनसेंसिटिव डीडुप्लीकेशन के साथ विशेष रूप से मर्ज किया जाता है।

Windows-विशिष्ट पाथ एनरिचमेंट (`shell/windows.rs`): खोजे गए Git-for-Windows पाथ (`cmd`, `bin`, `usr/bin`) अगर मौजूद हैं और पहले से शामिल नहीं हैं तो जोड़ दिए जाते हैं।

### रनटाइम जीवनचक्र और स्टेट ट्रांज़िशन

पर्सिस्टेंट शेल (`Shell.run`) इस स्टेट मशीन का उपयोग करता है:

- **Idle/Uninitialized**: `session: None`।
- **Running**: पहला `run()` लेज़िली सेशन बनाता है, `current_abort` टोकन स्टोर करता है, कमांड एक्सीक्यूट करता है।
- **Completed + keepalive**: यदि एक्सीक्यूशन कंट्रोल फ्लो `Normal` है, तो `current_abort` क्लियर हो जाता है और सेशन पुन: उपयोग होता है।
- **Completed + teardown**: यदि कंट्रोल फ्लो लूप/स्क्रिप्ट/शेल-एक्ज़िट संबंधित है (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), तो सेशन ड्रॉप हो जाता है (`session: None`)।
- **Cancelled/Timed out**: रन टास्क कैंसिल होता है, ग्रेस वेट (2s), फिर फोर्स-एबॉर्ट; सेशन ड्रॉप हो जाता है।
- **Error**: सेशन ड्रॉप हो जाता है।

वन-शॉट शेल (`executeShell`) हमेशा प्रत्येक कॉल के लिए एक ताज़ा सेशन बनाता और ड्रॉप करता है।

### स्ट्रीमिंग/आउटपुट व्यवहार

- Stdout/stderr एक साझा पाइप में रूट होते हैं और समवर्ती रूप से पढ़े जाते हैं।
- रीडर UTF-8 को इंक्रीमेंटली डिकोड करता है; अमान्य बाइट सीक्वेंस `U+FFFD` रिप्लेसमेंट चंक्स उत्सर्जित करते हैं।
- प्रोसेस पूरा होने के बाद, आउटपुट ड्रेन में idle/max गार्ड्स (`250ms` idle, `2s` max) होते हैं ताकि बैकग्राउंड जॉब्स द्वारा डिस्क्रिप्टर्स खुले रखने पर हैंग होने से बचा जा सके।

### कैंसिलेशन, टाइमआउट, और बैकग्राउंड जॉब्स

- `CancelToken` `timeoutMs` और वैकल्पिक `AbortSignal` से बनाया जाता है।
- कैंसिलेशन/टाइमआउट पर, शेल कैंसिलेशन टोकन ट्रिगर होता है, फिर टास्क को फोर्स्ड एबॉर्ट से पहले 2s का ग्रेसफुल विंडो मिलता है।
- यदि कैंसिलेशन होता है, तो बैकग्राउंड जॉब्स brush जॉब मेटाडेटा का उपयोग करके टर्मिनेट किए जाते हैं (`TERM`, फिर विलंबित `KILL`)।

`Shell.abort()` व्यवहार:

- उस `Shell` इंस्टेंस के लिए केवल वर्तमान चल रहे कमांड को एबॉर्ट करता है,
- जब कुछ नहीं चल रहा तो नो-ऑप सक्सेस।

### विफलता व्यवहार

सामान्य सरफेस्ड त्रुटियों में शामिल हैं:

- सेशन इनिट विफलताएँ (`Failed to initialize shell`),
- cwd त्रुटियाँ (`Failed to set cwd`),
- env सेट/पॉप विफलताएँ,
- स्नैपशॉट सोर्स विफलताएँ,
- पाइप क्रिएशन/क्लोन विफलताएँ,
- एक्सीक्यूशन विफलता (`Shell execution failed: ...`),
- टास्क रैपर विफलताएँ (`Shell execution task failed: ...`)।

रिजल्ट-स्तर कैंसिलेशन फ्लैग्स:

- टाइमआउट -> `exitCode: undefined`, `timedOut: true`।
- एबॉर्ट सिग्नल -> `exitCode: undefined`, `cancelled: true`।

## PTY सबसिस्टम (`pty`)

### API मॉडल

`new PtySession()` एक्सपोज़ करता है:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### रनटाइम जीवनचक्र और स्टेट ट्रांज़िशन

`PtySession` स्टेट मशीन:

- **Idle**: `core: None`।
- **Reserved**: `start()` async कार्य शुरू होने से पहले कंट्रोल चैनल को सिंक्रोनसली इंस्टॉल करता है (`core: Some`), इसलिए `write/resize/kill` तुरंत वैलिड हो जाते हैं।
- **Running**: ब्लॉकिंग PTY लूप चाइल्ड स्टेट, रीडर इवेंट्स, कैंसिलेशन हार्टबीट, और कंट्रोल मैसेजेस को हैंडल करता है।
- **Terminal closed**: चाइल्ड एक्ज़िट + रीडर कम्प्लीशन।
- **Finalized**: `start()` टास्क पूरा होने के बाद (सफलता या त्रुटि) `core` हमेशा `None` पर रीसेट हो जाता है।

कंकरेंसी गार्ड:

- पहले से चलते समय स्टार्ट करने पर `PTY session already running` रिटर्न होता है।

### स्पॉन/अटैच/राइट/रीड/टर्मिनेट पैटर्न

- PTY `portable_pty::native_pty_system().openpty(...)` के माध्यम से खोला जाता है।
- कमांड वर्तमान में `sh -lc <command>` के रूप में वैकल्पिक `cwd` और env ओवरराइड्स के साथ चलता है।
- `write()` PTY stdin में रॉ बाइट्स भेजता है।
- `resize()` डायमेंशन्स को क्लैम्प करता है (`cols 20..400`, `rows 5..200`) और मास्टर रिसाइज़ कॉल करता है।
- `kill()` रन को कैंसिल्ड मार्क करता है और चाइल्ड प्रोसेस को किल करता है।

आउटपुट पाथ:

- डेडिकेटेड रीडर थ्रेड मास्टर स्ट्रीम पढ़ता है,
- अमान्य बाइट्स पर `U+FFFD` रिप्लेसमेंट के साथ इंक्रीमेंटल UTF-8 डिकोड,
- चंक्स N-API threadsafe कॉलबैक के माध्यम से फॉरवर्ड होते हैं।

### कैंसिलेशन और टाइमआउट सिमेंटिक्स

- `timeoutMs` और `AbortSignal` एक `CancelToken` को फीड करते हैं।
- लूप समय-समय पर `ct.heartbeat()` कॉल करता है; एबॉर्ट चाइल्ड किल ट्रिगर करता है।
- टाइमआउट वर्गीकरण स्ट्रिंग-आधारित है (हार्टबीट एरर में `"Timeout"` सबस्ट्रिंग)।

### विफलता व्यवहार

त्रुटि सरफेस में शामिल हैं:

- PTY एलोकेशन/ओपन विफलता,
- PTY स्पॉन विफलता,
- राइटर/रीडर अधिग्रहण विफलता,
- चाइल्ड स्टेटस/वेट विफलताएँ,
- लॉक पॉइज़निंग,
- कंट्रोल-चैनल डिस्कनेक्शन (`PTY session is no longer available`)।

जब नहीं चल रहा तब कंट्रोल कॉल विफलताएँ:

- `write/resize/kill` `PTY session is not running` रिटर्न करते हैं।

## प्रोसेस-ट्री सबसिस्टम (`ps`)

### API मॉडल

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS रैपर `setNativeKillTree(native.killTree)` के माध्यम से साझा utils में नेटिव किल-ट्री इंटीग्रेशन भी रजिस्टर करता है।

### प्लेटफॉर्म-विशिष्ट इम्प्लीमेंटेशन

- **Linux**: रिकर्सिवली `/proc/<pid>/task/<pid>/children` पढ़ता है।
- **macOS**: `libproc` `proc_listchildpids` का उपयोग करता है।
- **Windows**: `CreateToolhelp32Snapshot` के साथ प्रोसेस टेबल का स्नैपशॉट लेता है, parent->children मैप बनाता है, `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` से टर्मिनेट करता है।

### किल-ट्री व्यवहार

- डिसेंडेंट्स रिकर्सिवली एकत्र किए जाते हैं।
- किल ऑर्डर बॉटम-अप है (सबसे गहरे डिसेंडेंट्स पहले) ताकि ऑर्फ़न री-पेरेंटिंग कम हो।
- रूट pid सबसे अंत में किल होता है।
- रिटर्न वैल्यू सफल टर्मिनेशन्स की गिनती है।

सिग्नल व्यवहार:

- POSIX: प्रदान किया गया `signal` `kill` को पास होता है।
- Windows: `signal` को अनदेखा किया जाता है; टर्मिनेशन बिना शर्त प्रोसेस टर्मिनेट है।

### विफलता व्यवहार

यह मॉड्यूल जानबूझकर API सरफेस पर नॉन-थ्रोइंग है:

- अनुपलब्ध/अप्राप्य प्रोसेस ट्री शाखाएँ स्किप की जाती हैं,
- प्रति-pid किल विफलताएँ असफल के रूप में गिनी जाती हैं (त्रुटियाँ नहीं),
- लुकअप मिस आमतौर पर `listDescendants` से `[]` और `killTree` से `0` देता है।

## Key पार्सिंग सबसिस्टम (`keys`)

### API मॉडल

एक्सपोज़ किए गए हेल्पर्स:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### पार्सिंग मॉडल

पार्सर निम्नलिखित को संयोजित करता है:

- प्रत्यक्ष सिंगल-बाइट मैपिंग्स (`enter`, `tab`, `ctrl+<letter>`, प्रिंटेबल ASCII),
- O(1) लिगेसी एस्केप-सीक्वेंस लुकअप (PHF मैप),
- xterm `modifyOtherKeys` पार्सिंग,
- Kitty प्रोटोकॉल पार्सिंग (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- key IDs में नॉर्मलाइज़ेशन (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, आदि)।

मॉडिफायर हैंडलिंग:

- key मैचिंग के लिए केवल shift/alt/ctrl बिट्स की तुलना की जाती है,
- तुलना से पहले लॉक बिट्स मास्क आउट किए जाते हैं।

लेआउट व्यवहार:

- बेस-लेआउट फॉलबैक जानबूझकर सीमित है ताकि रीमैप्ड लेआउट ASCII अक्षरों/सिंबल्स के लिए फॉल्स मैच न बनाएँ।

### विफलता व्यवहार

- अपरिचित या अमान्य सीक्वेंस पार्स फ़ंक्शन्स से `null` उत्पन्न करते हैं।
- पार्स विफलता या मिसमैच पर मैच फ़ंक्शन्स `false` रिटर्न करते हैं।
- विकृत key इनपुट के लिए कोई थ्रोन एरर सरफेस नहीं है।

## JS रैपर API ↔ Rust एक्सपोर्ट मैपिंग

### शेल + PTY + प्रोसेस

| TS रैपर API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | वन-शॉट शेल एक्सीक्यूशन |
| `new Shell(options?)` | `Shell` क्लास | पर्सिस्टेंट शेल सेशन |
| `shell.run(options, onChunk?)` | `Shell::run` | keepalive कंट्रोल फ्लो पर सेशन पुन: उपयोग |
| `shell.abort()` | `Shell::abort` | उस शेल इंस्टेंस के सक्रिय रन को एबॉर्ट करता है |
| `new PtySession()` | `PtySession` क्लास | स्टेटफुल PTY सेशन |
| `pty.start(options, onChunk?)` | `PtySession::start` | इंटरैक्टिव PTY रन |
| `pty.write(data)` | `PtySession::write` | रॉ stdin पासथ्रू |
| `pty.resize(cols, rows)` | `PtySession::resize` | क्लैम्प्ड टर्मिनल डायमेंशन्स |
| `pty.kill()` | `PtySession::kill` | सक्रिय PTY चाइल्ड को फोर्स-किल करता है |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | चिल्ड्रन-फर्स्ट प्रोसेस ट्री टर्मिनेशन |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | रिकर्सिव डिसेंडेंट्स लिस्टिंग |

### Keys

| TS रैपर API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty कोडपॉइंट+मॉडिफायर मैच |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | नॉर्मलाइज़्ड key-id पार्सर |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | सटीक लिगेसी सीक्वेंस मैप चेक |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | स्ट्रक्चर्ड Kitty पार्स रिजल्ट |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | हाई-लेवल key मैचर |

## परित्यक्त सेशन क्लीनअप और फाइनलाइज़ेशन नोट्स

- **शेल पर्सिस्टेंट सेशन**: यदि कोई रन कैंसिल/टाइम आउट/एरर/नॉन-keepalive कंट्रोल फ्लो होता है, तो Rust स्पष्ट रूप से आंतरिक सेशन स्टेट को ड्रॉप करता है। सफल सामान्य रन सेशन को पुन: उपयोग के लिए रखते हैं।
- **PTY सेशन**: `start()` पूरा होने के बाद, विफलता पाथ सहित, `core` हमेशा क्लियर होता है।
- रैपर्स द्वारा **कोई स्पष्ट JS फाइनलाइज़र-ड्रिवन किल कॉन्ट्रैक्ट एक्सपोज़ नहीं** किया गया है; क्लीनअप मुख्य रूप से रन कम्प्लीशन/कैंसिलेशन पाथ से जुड़ा है। कॉलर्स को निर्धारक टियरडाउन के लिए `timeoutMs`, `AbortSignal`, `shell.abort()`, या `pty.kill()` का उपयोग करना चाहिए।
