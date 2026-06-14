---
title: 'नेटिव Shell, PTY, प्रोसेस और की इंटर्नल्स'
description: >-
  नेटिव लेयर में शेल एक्जीक्यूशन, PTY प्रबंधन, प्रोसेस लाइफसाइकिल, और की इवेंट
  हैंडलिंग।
sidebar:
  order: 4
  label: 'Shell, PTY और प्रोसेस'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# नेटिव Shell, PTY, प्रोसेस और की इंटर्नल्स

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` में **एक्जीक्यूशन/प्रोसेस/टर्मिनल प्रिमिटिव्स** को कवर करता है: `shell`, `pty`, `ps`, और `keys`, जो `docs/natives-architecture.md` से आर्किटेक्चर शब्दावली का उपयोग करते हैं।

## इम्प्लीमेंटेशन फ़ाइलें

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (केवल Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (shell/pty द्वारा उपयोग किया जाने वाला साझा कैंसलेशन व्यवहार)
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

- **TS रैपर/API लेयर** (`packages/natives/src/*`): टाइप्ड एंट्रीपॉइंट्स, कैंसलेशन सरफेस (`timeoutMs`, `AbortSignal`), और JS एर्गोनॉमिक्स।
- **Rust N-API मॉड्यूल लेयर** (`crates/pi-natives/src/*`): shell/PTY प्रोसेस एक्जीक्यूशन, प्रोसेस-ट्री ट्रैवर्सल/टर्मिनेशन, और की-सीक्वेंस पार्सिंग।
- **वैलिडेशन गेट** (`native.ts`, आर्किटेक्चर-स्तर): सुनिश्चित करता है कि रैपर्स के उपयोग से पहले आवश्यक एक्सपोर्ट्स (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, की हेल्पर्स) मौजूद हों।

## Shell सबसिस्टम (`shell`)

### API मॉडल

दो एक्जीक्यूशन मोड उजागर किए गए हैं:

1. **वन-शॉट** `executeShell(options, onChunk?)` के माध्यम से।
2. **पर्सिस्टेंट सेशन** `new Shell(options?)` फिर बार-बार `shell.run(...)` के माध्यम से।

दोनों एक थ्रेडसेफ कॉलबैक के माध्यम से आउटपुट स्ट्रीम करते हैं और `{ exitCode?, cancelled, timedOut }` लौटाते हैं।

### सेशन निर्माण और एनवायरनमेंट मॉडल

Rust इन के साथ `brush_core::Shell` बनाता है:

- नॉन-इंटरैक्टिव मोड,
- `do_not_inherit_env: true`,
- होस्ट env से स्पष्ट एनवायरनमेंट पुनर्निर्माण,
- shell-सेंसिटिव वेरिएबल्स के लिए स्किप-लिस्ट (`PS1`, `PWD`, `SHLVL`, bash फ़ंक्शन एक्सपोर्ट्स, आदि)।

सेशन env व्यवहार:

- `ShellOptions.sessionEnv` को सेशन निर्माण के समय एक बार लागू किया जाता है।
- `ShellRunOptions.env` कमांड-स्कोप्ड है (`EnvironmentScope::Command`) और प्रत्येक रन के बाद पॉप किया जाता है।
- `PATH` को Windows पर केस-इनसेंसिटिव डिडुप के साथ विशेष रूप से मर्ज किया जाता है।

केवल Windows पर पाथ एनरिचमेंट (`shell/windows.rs`): Git-for-Windows के खोजे गए पाथ (`cmd`, `bin`, `usr/bin`) को जोड़ा जाता है यदि वे मौजूद हों और पहले से शामिल न हों।

### रनटाइम लाइफसाइकिल और स्टेट ट्रांज़िशन

पर्सिस्टेंट shell (`Shell.run`) इस स्टेट मशीन का उपयोग करता है:

- **Idle/Uninitialized**: `session: None`।
- **Running**: पहला `run()` लेज़िली सेशन बनाता है, `current_abort` टोकन स्टोर करता है, कमांड एक्जीक्यूट करता है।
- **Completed + keepalive**: यदि एक्जीक्यूशन कंट्रोल फ्लो `Normal` है, तो `current_abort` क्लियर हो जाता है और सेशन पुनः उपयोग किया जाता है।
- **Completed + teardown**: यदि कंट्रोल फ्लो लूप/स्क्रिप्ट/shell-एग्जिट से संबंधित है (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), तो सेशन ड्रॉप हो जाता है (`session: None`)।
- **Cancelled/Timed out**: रन टास्क कैंसल होता है, ग्रेस वेट (2s), फिर फोर्स-अबॉर्ट; सेशन ड्रॉप होता है।
- **Error**: सेशन ड्रॉप होता है।

वन-शॉट shell (`executeShell`) प्रत्येक कॉल के लिए हमेशा एक ताज़ा सेशन बनाता और ड्रॉप करता है।

### स्ट्रीमिंग/आउटपुट व्यवहार

- Stdout/stderr को एक साझा पाइप में रूट किया जाता है और समवर्ती रूप से पढ़ा जाता है।
- रीडर UTF-8 को क्रमिक रूप से डीकोड करता है; अमान्य बाइट सीक्वेंस `U+FFFD` रिप्लेसमेंट चंक्स एमिट करते हैं।
- प्रोसेस पूर्ण होने के बाद, आउटपुट ड्रेन में idle/max गार्ड्स हैं (`250ms` idle, `2s` max) ताकि बैकग्राउंड जॉब्स डिस्क्रिप्टर्स खुले रखने पर हैंग न हो।

### कैंसलेशन, टाइमआउट, और बैकग्राउंड जॉब्स

- `CancelToken` `timeoutMs` और वैकल्पिक `AbortSignal` से बनाया जाता है।
- कैंसलेशन/टाइमआउट पर, shell कैंसलेशन टोकन ट्रिगर होता है, फिर टास्क को फोर्स्ड अबॉर्ट से पहले 2s का ग्रेसफुल विंडो मिलता है।
- यदि कैंसलेशन होती है, तो बैकग्राउंड जॉब्स brush जॉब मेटाडेटा का उपयोग करके टर्मिनेट किए जाते हैं (`TERM`, फिर देरी से `KILL`)।

`Shell.abort()` व्यवहार:

- उस `Shell` इंस्टेंस के लिए केवल वर्तमान चलने वाले कमांड को अबॉर्ट करता है,
- जब कुछ नहीं चल रहा हो तो no-op सफलता।

### विफलता व्यवहार

सामान्य रूप से सामने आने वाली त्रुटियों में शामिल हैं:

- सेशन इनिट विफलताएं (`Failed to initialize shell`),
- cwd त्रुटियां (`Failed to set cwd`),
- env set/pop विफलताएं,
- स्नैपशॉट सोर्स विफलताएं,
- पाइप क्रिएशन/क्लोन विफलताएं,
- एक्जीक्यूशन विफलता (`Shell execution failed: ...`),
- टास्क रैपर विफलताएं (`Shell execution task failed: ...`)।

रिज़ल्ट-स्तर कैंसलेशन फ्लैग्स:

- टाइमआउट -> `exitCode: undefined`, `timedOut: true`।
- अबॉर्ट सिग्नल -> `exitCode: undefined`, `cancelled: true`।

## PTY सबसिस्टम (`pty`)

### API मॉडल

`new PtySession()` उजागर करता है:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### रनटाइम लाइफसाइकिल और स्टेट ट्रांज़िशन

`PtySession` स्टेट मशीन:

- **Idle**: `core: None`।
- **Reserved**: `start()` async काम शुरू होने से पहले सिंक्रोनस रूप से कंट्रोल चैनल इंस्टॉल करता है (`core: Some`), इसलिए `write/resize/kill` तुरंत वैध हो जाते हैं।
- **Running**: ब्लॉकिंग PTY लूप चाइल्ड स्टेट, रीडर इवेंट्स, कैंसलेशन हार्टबीट, और कंट्रोल मैसेज हैंडल करता है।
- **Terminal closed**: चाइल्ड एग्जिट + रीडर कम्पलीशन।
- **Finalized**: start टास्क पूर्ण होने के बाद (सफलता या त्रुटि) `core` हमेशा `None` पर रीसेट होता है।

कंकरेंसी गार्ड:

- पहले से चलने के दौरान स्टार्ट करने पर `PTY session already running` लौटाता है।

### स्पॉन/अटैच/राइट/रीड/टर्मिनेट पैटर्न

- PTY `portable_pty::native_pty_system().openpty(...)` के माध्यम से खोला जाता है।
- कमांड वर्तमान में `sh -lc <command>` के रूप में वैकल्पिक `cwd` और env ओवरराइड के साथ चलता है।
- `write()` PTY stdin को रॉ बाइट्स भेजता है।
- `resize()` डाइमेंशन क्लैंप करता है (`cols 20..400`, `rows 5..200`) और मास्टर रिसाइज़ कॉल करता है।
- `kill()` रन को कैंसल्ड के रूप में मार्क करता है और चाइल्ड प्रोसेस को किल करता है।

आउटपुट पाथ:

- डेडिकेटेड रीडर थ्रेड मास्टर स्ट्रीम पढ़ता है,
- अमान्य बाइट्स पर `U+FFFD` रिप्लेसमेंट के साथ क्रमिक UTF-8 डीकोड,
- N-API थ्रेडसेफ कॉलबैक के माध्यम से फॉरवर्ड किए गए चंक्स।

### कैंसलेशन और टाइमआउट सिमेंटिक्स

- `timeoutMs` और `AbortSignal` एक `CancelToken` फीड करते हैं।
- लूप समय-समय पर `ct.heartbeat()` कॉल करता है; अबॉर्ट चाइल्ड किल ट्रिगर करता है।
- टाइमआउट क्लासिफिकेशन स्ट्रिंग-आधारित है (हार्टबीट त्रुटि में `"Timeout"` सबस्ट्रिंग)।

### विफलता व्यवहार

त्रुटि सरफेस में शामिल हैं:

- PTY एलोकेशन/ओपन विफलता,
- PTY स्पॉन विफलता,
- राइटर/रीडर एक्विज़िशन विफलता,
- चाइल्ड स्टेटस/वेट विफलताएं,
- लॉक पॉइज़निंग,
- कंट्रोल-चैनल डिसकनेक्शन (`PTY session is no longer available`)।

न चलने पर कंट्रोल कॉल विफलताएं:

- `write/resize/kill` `PTY session is not running` लौटाते हैं।

## प्रोसेस-ट्री सबसिस्टम (`ps`)

### API मॉडल

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS रैपर `setNativeKillTree(native.killTree)` के माध्यम से साझा utils में नेटिव किल-ट्री इंटीग्रेशन भी रजिस्टर करता है।

### प्लेटफ़ॉर्म-विशिष्ट इम्प्लीमेंटेशन

- **Linux**: पुनरावर्ती रूप से `/proc/<pid>/task/<pid>/children` पढ़ता है।
- **macOS**: `libproc` `proc_listchildpids` का उपयोग करता है।
- **Windows**: `CreateToolhelp32Snapshot` के साथ प्रोसेस टेबल स्नैपशॉट करता है, parent->children मैप बनाता है, `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` के साथ टर्मिनेट करता है।

### किल-ट्री व्यवहार

- डिसेंडेंट्स पुनरावर्ती रूप से एकत्र किए जाते हैं।
- किल ऑर्डर बॉटम-अप है (अनाथ री-पेरेंटिंग को कम करने के लिए सबसे गहरे डिसेंडेंट्स पहले)।
- रूट pid सबसे अंत में किल होता है।
- रिटर्न वैल्यू सफल टर्मिनेशन की गिनती है।

सिग्नल व्यवहार:

- POSIX: प्रदान किया गया `signal` `kill` को पास किया जाता है।
- Windows: `signal` को नज़रअंदाज़ किया जाता है; टर्मिनेशन बिना शर्त प्रोसेस टर्मिनेट है।

### विफलता व्यवहार

यह मॉड्यूल जानबूझकर API सरफेस पर नॉन-थ्रोइंग है:

- गायब/अनुपलब्ध प्रोसेस ट्री ब्रांचेस छोड़ दी जाती हैं,
- प्रति-pid किल विफलताएं असफल के रूप में गिनी जाती हैं (त्रुटियां नहीं),
- लुकअप मिस आमतौर पर `listDescendants` से `[]` और `killTree` से `0` देता है।

## की पार्सिंग सबसिस्टम (`keys`)

### API मॉडल

उजागर किए गए हेल्पर्स:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### पार्सिंग मॉडल

पार्सर इन्हें जोड़ता है:

- डायरेक्ट सिंगल-बाइट मैपिंग (`enter`, `tab`, `ctrl+<letter>`, प्रिंटेबल ASCII),
- O(1) लेगेसी एस्केप-सीक्वेंस लुकअप (PHF मैप),
- xterm `modifyOtherKeys` पार्सिंग,
- Kitty प्रोटोकॉल पार्सिंग (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- की IDs में नॉर्मलाइज़ेशन (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, आदि)।

मॉडिफायर हैंडलिंग:

- की मैचिंग के लिए केवल shift/alt/ctrl बिट्स की तुलना की जाती है,
- तुलना से पहले लॉक बिट्स मास्क आउट होते हैं।

लेआउट व्यवहार:

- बेस-लेआउट फॉलबैक जानबूझकर प्रतिबंधित है ताकि रिमैप्ड लेआउट ASCII अक्षरों/प्रतीकों के लिए गलत मिलान न बनाएं।

### विफलता व्यवहार

- अपरिचित या अमान्य सीक्वेंस पार्स फ़ंक्शन से `null` उत्पन्न करते हैं।
- पार्स विफलता या मिसमैच पर मैच फ़ंक्शन `false` लौटाते हैं।
- गलत की इनपुट के लिए कोई थ्रो त्रुटि सरफेस नहीं है।

## JS रैपर API ↔ Rust एक्सपोर्ट मैपिंग

### Shell + PTY + प्रोसेस

| TS रैपर API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | वन-शॉट shell एक्जीक्यूशन |
| `new Shell(options?)` | `Shell` क्लास | पर्सिस्टेंट shell सेशन |
| `shell.run(options, onChunk?)` | `Shell::run` | keepalive कंट्रोल फ्लो पर सेशन पुनः उपयोग |
| `shell.abort()` | `Shell::abort` | उस shell इंस्टेंस के लिए सक्रिय रन अबॉर्ट |
| `new PtySession()` | `PtySession` क्लास | स्टेटफुल PTY सेशन |
| `pty.start(options, onChunk?)` | `PtySession::start` | इंटरैक्टिव PTY रन |
| `pty.write(data)` | `PtySession::write` | रॉ stdin पासथ्रू |
| `pty.resize(cols, rows)` | `PtySession::resize` | क्लैंप्ड टर्मिनल डाइमेंशन |
| `pty.kill()` | `PtySession::kill` | सक्रिय PTY चाइल्ड को फोर्स-किल |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | चिल्ड्रेन-फर्स्ट प्रोसेस ट्री टर्मिनेशन |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | पुनरावर्ती डिसेंडेंट्स लिस्टिंग |

### Keys

| TS रैपर API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty कोडपॉइंट+मॉडिफायर मैच |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | नॉर्मलाइज़्ड की-id पार्सर |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | एग्जैक्ट लेगेसी सीक्वेंस मैप चेक |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | स्ट्रक्चर्ड Kitty पार्स रिज़ल्ट |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | हाई-लेवल की मैचर |

## परित्यक्त सेशन क्लीनअप और फाइनलाइज़ेशन नोट्स

- **Shell पर्सिस्टेंट सेशन**: यदि कोई रन कैंसल/टाइम्ड आउट/त्रुटि/नॉन-keepalive कंट्रोल फ्लो है, तो Rust स्पष्ट रूप से आंतरिक सेशन स्टेट ड्रॉप करता है। सफल नॉर्मल रन सेशन को पुनः उपयोग के लिए रखते हैं।
- **PTY सेशन**: विफलता पाथ सहित `start()` समाप्त होने के बाद `core` हमेशा क्लियर होता है।
- **कोई स्पष्ट JS फाइनलाइज़र-ड्रिवन किल कॉन्ट्रैक्ट** रैपर्स द्वारा उजागर नहीं किया जाता; क्लीनअप मुख्य रूप से रन कम्पलीशन/कैंसलेशन पाथ से जुड़ा है। निर्धारक टियरडाउन के लिए कॉलर्स को `timeoutMs`, `AbortSignal`, `shell.abort()`, या `pty.kill()` का उपयोग करना चाहिए।
