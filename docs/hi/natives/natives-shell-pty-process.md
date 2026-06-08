---
title: 'Natives Shell, PTY, Process, और Key आंतरिक संरचना'
description: >-
  नेटिव लेयर में Shell निष्पादन, PTY प्रबंधन, प्रोसेस जीवनचक्र, और key इवेंट
  हैंडलिंग।
sidebar:
  order: 4
  label: 'Shell, PTY & process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell, PTY, Process, और Key आंतरिक संरचना

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` में **निष्पादन/प्रोसेस/टर्मिनल प्रिमिटिव्स** को कवर करता है: `shell`, `pty`, `ps`, और `keys`, `docs/natives-architecture.md` से आर्किटेक्चर शब्दावली का उपयोग करते हुए।

## कार्यान्वयन फ़ाइलें

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (केवल Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (shell/pty द्वारा उपयोग किया जाने वाला साझा रद्दीकरण व्यवहार)
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

- **TS wrapper/API लेयर** (`packages/natives/src/*`): टाइप्ड एंट्रीपॉइंट्स, रद्दीकरण सतह (`timeoutMs`, `AbortSignal`), और JS एर्गोनॉमिक्स।
- **Rust N-API मॉड्यूल लेयर** (`crates/pi-natives/src/*`): shell/PTY प्रोसेस निष्पादन, प्रोसेस-ट्री ट्रैवर्सल/समाप्ति, और key-सीक्वेंस पार्सिंग।
- **सत्यापन गेट** (`native.ts`, आर्किटेक्चर-स्तर): सुनिश्चित करता है कि आवश्यक एक्सपोर्ट्स (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, key हेल्पर्स) रैपर्स के उपयोग से पहले मौजूद हैं।

## Shell उपप्रणाली (`shell`)

### API मॉडल

दो निष्पादन मोड उपलब्ध हैं:

1. **वन-शॉट** `executeShell(options, onChunk?)` के माध्यम से।
2. **स्थायी सत्र** `new Shell(options?)` के माध्यम से, फिर बार-बार `shell.run(...)`।

दोनों एक threadsafe कॉलबैक के माध्यम से आउटपुट स्ट्रीम करते हैं और `{ exitCode?, cancelled, timedOut }` लौटाते हैं।

### सत्र निर्माण और पर्यावरण मॉडल

Rust `brush_core::Shell` बनाता है:

- नॉन-इंटरैक्टिव मोड,
- `do_not_inherit_env: true`,
- होस्ट env से स्पष्ट पर्यावरण पुनर्निर्माण,
- shell-संवेदनशील वेरिएबल्स के लिए स्किप-लिस्ट (`PS1`, `PWD`, `SHLVL`, bash फंक्शन एक्सपोर्ट्स, आदि)।

सत्र env व्यवहार:

- `ShellOptions.sessionEnv` सत्र निर्माण के समय एक बार लागू होता है।
- `ShellRunOptions.env` कमांड-स्कोप्ड (`EnvironmentScope::Command`) है और प्रत्येक रन के बाद पॉप हो जाता है।
- `PATH` को Windows पर केस-इनसेंसिटिव डीडुप के साथ विशेष रूप से मर्ज किया जाता है।

Windows-विशिष्ट पथ संवर्धन (`shell/windows.rs`): खोजे गए Git-for-Windows पथ (`cmd`, `bin`, `usr/bin`) यदि मौजूद हों और पहले से शामिल न हों तो जोड़ दिए जाते हैं।

### रनटाइम जीवनचक्र और स्थिति परिवर्तन

स्थायी shell (`Shell.run`) इस स्टेट मशीन का उपयोग करता है:

- **Idle/Uninitialized**: `session: None`।
- **Running**: पहला `run()` आलसी रूप से सत्र बनाता है, `current_abort` टोकन संग्रहित करता है, कमांड निष्पादित करता है।
- **Completed + keepalive**: यदि निष्पादन नियंत्रण प्रवाह `Normal` है, तो `current_abort` साफ़ हो जाता है और सत्र पुनः उपयोग किया जाता है।
- **Completed + teardown**: यदि नियंत्रण प्रवाह लूप/स्क्रिप्ट/shell-exit संबंधित है (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), तो सत्र ड्रॉप हो जाता है (`session: None`)।
- **Cancelled/Timed out**: रन टास्क रद्द किया जाता है, ग्रेस वेट (2s), फिर फोर्स-एबॉर्ट; सत्र ड्रॉप हो जाता है।
- **Error**: सत्र ड्रॉप हो जाता है।

वन-शॉट shell (`executeShell`) हमेशा प्रति कॉल एक ताज़ा सत्र बनाता और ड्रॉप करता है।

### स्ट्रीमिंग/आउटपुट व्यवहार

- Stdout/stderr एक साझा पाइप में रूट किए जाते हैं और समवर्ती रूप से पढ़े जाते हैं।
- रीडर UTF-8 को इंक्रीमेंटली डीकोड करता है; अमान्य बाइट सीक्वेंस `U+FFFD` रिप्लेसमेंट चंक्स उत्सर्जित करते हैं।
- प्रोसेस पूर्णता के बाद, आउटपुट ड्रेन में idle/max गार्ड (`250ms` idle, `2s` max) होते हैं ताकि बैकग्राउंड जॉब्स द्वारा डिस्क्रिप्टर खुला रखने पर हैंगिंग से बचा जा सके।

### रद्दीकरण, टाइमआउट, और बैकग्राउंड जॉब्स

- `CancelToken` `timeoutMs` और वैकल्पिक `AbortSignal` से निर्मित होता है।
- रद्दीकरण/टाइमआउट पर, shell रद्दीकरण टोकन ट्रिगर होता है, फिर टास्क को फोर्स्ड एबॉर्ट से पहले 2s की ग्रेसफुल विंडो मिलती है।
- यदि रद्दीकरण होता है, तो बैकग्राउंड जॉब्स brush जॉब मेटाडेटा का उपयोग करके समाप्त किए जाते हैं (`TERM`, फिर विलंबित `KILL`)।

`Shell.abort()` व्यवहार:

- उस `Shell` इंस्टेंस के लिए केवल वर्तमान चल रही कमांड को एबॉर्ट करता है,
- जब कुछ नहीं चल रहा हो तो नो-ऑप सफलता।

### विफलता व्यवहार

सामान्य सामने आने वाली त्रुटियों में शामिल हैं:

- सत्र आरंभीकरण विफलताएं (`Failed to initialize shell`),
- cwd त्रुटियां (`Failed to set cwd`),
- env set/pop विफलताएं,
- स्नैपशॉट स्रोत विफलताएं,
- पाइप निर्माण/क्लोन विफलताएं,
- निष्पादन विफलता (`Shell execution failed: ...`),
- टास्क रैपर विफलताएं (`Shell execution task failed: ...`)।

परिणाम-स्तरीय रद्दीकरण फ्लैग:

- टाइमआउट -> `exitCode: undefined`, `timedOut: true`।
- एबॉर्ट सिग्नल -> `exitCode: undefined`, `cancelled: true`।

## PTY उपप्रणाली (`pty`)

### API मॉडल

`new PtySession()` उपलब्ध कराता है:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### रनटाइम जीवनचक्र और स्थिति परिवर्तन

`PtySession` स्टेट मशीन:

- **Idle**: `core: None`।
- **Reserved**: `start()` async कार्य शुरू होने से पहले सिंक्रोनस रूप से कंट्रोल चैनल इंस्टॉल करता है (`core: Some`), ताकि `write/resize/kill` तुरंत मान्य हो जाएं।
- **Running**: ब्लॉकिंग PTY लूप चाइल्ड स्थिति, रीडर इवेंट्स, रद्दीकरण हार्टबीट, और कंट्रोल संदेशों को संभालता है।
- **Terminal closed**: चाइल्ड एक्जिट + रीडर पूर्णता।
- **Finalized**: `start()` टास्क पूर्णता के बाद `core` हमेशा `None` पर रीसेट होता है (सफलता या त्रुटि दोनों में)।

समवर्ती गार्ड:

- पहले से चल रहे होने पर प्रारंभ करने से `PTY session already running` लौटता है।

### Spawn/attach/write/read/terminate पैटर्न

- PTY `portable_pty::native_pty_system().openpty(...)` के माध्यम से खोला जाता है।
- कमांड वर्तमान में `sh -lc <command>` के रूप में वैकल्पिक `cwd` और env ओवरराइड्स के साथ चलता है।
- `write()` PTY stdin को रॉ बाइट्स भेजता है।
- `resize()` डायमेंशन्स को क्लैंप करता है (`cols 20..400`, `rows 5..200`) और मास्टर रीसाइज़ कॉल करता है।
- `kill()` रन को रद्द के रूप में चिह्नित करता है और चाइल्ड प्रोसेस को समाप्त करता है।

आउटपुट पथ:

- समर्पित रीडर थ्रेड मास्टर स्ट्रीम पढ़ता है,
- अमान्य बाइट्स पर `U+FFFD` रिप्लेसमेंट के साथ इंक्रीमेंटल UTF-8 डीकोड,
- चंक्स N-API threadsafe कॉलबैक के माध्यम से फॉरवर्ड किए जाते हैं।

### रद्दीकरण और टाइमआउट सिमेंटिक्स

- `timeoutMs` और `AbortSignal` एक `CancelToken` को फीड करते हैं।
- लूप समय-समय पर `ct.heartbeat()` कॉल करता है; एबॉर्ट चाइल्ड किल ट्रिगर करता है।
- टाइमआउट वर्गीकरण स्ट्रिंग-आधारित है (हार्टबीट त्रुटि में `"Timeout"` सबस्ट्रिंग)।

### विफलता व्यवहार

त्रुटि सतहों में शामिल हैं:

- PTY आवंटन/ओपन विफलता,
- PTY spawn विफलता,
- writer/reader अधिग्रहण विफलता,
- चाइल्ड स्थिति/प्रतीक्षा विफलताएं,
- लॉक पॉइज़निंग,
- कंट्रोल-चैनल विच्छेद (`PTY session is no longer available`)।

जब नहीं चल रहा हो तब कंट्रोल कॉल विफलताएं:

- `write/resize/kill` `PTY session is not running` लौटाते हैं।

## प्रोसेस-ट्री उपप्रणाली (`ps`)

### API मॉडल

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS wrapper `setNativeKillTree(native.killTree)` के माध्यम से साझा utils में नेटिव kill-tree एकीकरण भी पंजीकृत करता है।

### प्लेटफ़ॉर्म-विशिष्ट कार्यान्वयन

- **Linux**: पुनरावर्ती रूप से `/proc/<pid>/task/<pid>/children` पढ़ता है।
- **macOS**: `libproc` `proc_listchildpids` का उपयोग करता है।
- **Windows**: `CreateToolhelp32Snapshot` के साथ प्रोसेस टेबल स्नैपशॉट लेता है, parent->children मैप बनाता है, `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` के साथ समाप्त करता है।

### Kill-tree व्यवहार

- वंशज पुनरावर्ती रूप से एकत्रित किए जाते हैं।
- किल क्रम बॉटम-अप है (सबसे गहरे वंशज पहले) ताकि अनाथ पुनः-पैरेंटिंग कम हो।
- रूट pid अंत में समाप्त किया जाता है।
- रिटर्न वैल्यू सफल समाप्तियों की गिनती है।

सिग्नल व्यवहार:

- POSIX: प्रदान किया गया `signal` `kill` को पास किया जाता है।
- Windows: `signal` अनदेखा किया जाता है; समाप्ति बिना शर्त प्रोसेस टर्मिनेट है।

### विफलता व्यवहार

यह मॉड्यूल API सतह पर जानबूझकर नॉन-थ्रोइंग है:

- अनुपलब्ध/अनुपहुंच प्रोसेस ट्री शाखाएं छोड़ दी जाती हैं,
- प्रति-pid किल विफलताएं असफल के रूप में गिनी जाती हैं (त्रुटि नहीं),
- लुकअप मिस आमतौर पर `listDescendants` से `[]` और `killTree` से `0` उत्पन्न करता है।

## Key पार्सिंग उपप्रणाली (`keys`)

### API मॉडल

उपलब्ध हेल्पर्स:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### पार्सिंग मॉडल

पार्सर इन्हें संयोजित करता है:

- प्रत्यक्ष एकल-बाइट मैपिंग (`enter`, `tab`, `ctrl+<letter>`, प्रिंटेबल ASCII),
- O(1) लेगेसी एस्केप-सीक्वेंस लुकअप (PHF मैप),
- xterm `modifyOtherKeys` पार्सिंग,
- Kitty प्रोटोकॉल पार्सिंग (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- key IDs में सामान्यीकरण (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, आदि)।

मॉडिफायर हैंडलिंग:

- key मैचिंग के लिए केवल shift/alt/ctrl बिट्स की तुलना की जाती है,
- तुलना से पहले लॉक बिट्स मास्क आउट किए जाते हैं।

लेआउट व्यवहार:

- बेस-लेआउट फॉलबैक जानबूझकर प्रतिबंधित है ताकि रीमैप्ड लेआउट ASCII अक्षरों/प्रतीकों के लिए गलत मैच न बनाएं।

### विफलता व्यवहार

- अपरिचित या अमान्य सीक्वेंस पार्स फंक्शन्स से `null` उत्पन्न करते हैं।
- मैच फंक्शन्स पार्स विफलता या बेमेल पर `false` लौटाते हैं।
- विकृत key इनपुट के लिए कोई थ्रोन एरर सतह नहीं।

## JS wrapper API ↔ Rust एक्सपोर्ट मैपिंग

### Shell + PTY + Process

| TS wrapper API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | वन-शॉट shell निष्पादन |
| `new Shell(options?)` | `Shell` class | स्थायी shell सत्र |
| `shell.run(options, onChunk?)` | `Shell::run` | keepalive नियंत्रण प्रवाह पर सत्र पुनः उपयोग करता है |
| `shell.abort()` | `Shell::abort` | उस shell इंस्टेंस के सक्रिय रन को एबॉर्ट करता है |
| `new PtySession()` | `PtySession` class | स्टेटफुल PTY सत्र |
| `pty.start(options, onChunk?)` | `PtySession::start` | इंटरैक्टिव PTY रन |
| `pty.write(data)` | `PtySession::write` | रॉ stdin पासथ्रू |
| `pty.resize(cols, rows)` | `PtySession::resize` | क्लैंप्ड टर्मिनल डायमेंशन्स |
| `pty.kill()` | `PtySession::kill` | सक्रिय PTY चाइल्ड को फोर्स-किल करता है |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | चिल्ड्रन-फर्स्ट प्रोसेस ट्री समाप्ति |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | पुनरावर्ती वंशज सूचीकरण |

### Keys

| TS wrapper API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty कोडपॉइंट+मॉडिफायर मैच |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | सामान्यीकृत key-id पार्सर |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | सटीक लेगेसी सीक्वेंस मैप जाँच |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | संरचित Kitty पार्स परिणाम |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | उच्च-स्तरीय key मैचर |

## परित्यक्त सत्र सफ़ाई और अंतिमीकरण नोट्स

- **Shell स्थायी सत्र**: यदि कोई रन रद्द/टाइमआउट/त्रुटि/नॉन-keepalive नियंत्रण प्रवाह होता है, तो Rust स्पष्ट रूप से आंतरिक सत्र स्थिति ड्रॉप करता है। सफल सामान्य रन सत्र को पुनः उपयोग के लिए रखते हैं।
- **PTY सत्र**: `start()` पूर्ण होने के बाद `core` हमेशा साफ़ किया जाता है, विफलता पथों सहित।
- **कोई स्पष्ट JS फ़ाइनलाइज़र-चालित किल अनुबंध** रैपर्स द्वारा उपलब्ध नहीं कराया जाता; सफ़ाई मुख्य रूप से रन पूर्णता/रद्दीकरण पथों से जुड़ी है। कॉलर्स को निश्चयात्मक टियरडाउन के लिए `timeoutMs`, `AbortSignal`, `shell.abort()`, या `pty.kill()` का उपयोग करना चाहिए।
