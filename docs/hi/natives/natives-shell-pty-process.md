---
title: 'Natives Shell, PTY, Process, और Key आंतरिक संरचना'
description: >-
  नेटिव लेयर में Shell निष्पादन, PTY प्रबंधन, प्रोसेस जीवनचक्र, और की इवेंट
  हैंडलिंग।
sidebar:
  order: 4
  label: 'Shell, PTY और process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell, PTY, Process, और Key आंतरिक संरचना

यह दस्तावेज़ `@f5xc-salesdemos/pi-natives` में **निष्पादन/प्रोसेस/टर्मिनल प्रिमिटिव** को कवर करता है: `shell`, `pty`, `ps`, और `keys`, जो `docs/natives-architecture.md` से आर्किटेक्चर शब्दावली का उपयोग करता है।

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

- **TS रैपर/API लेयर** (`packages/natives/src/*`): टाइप्ड एंट्रीपॉइंट्स, रद्दीकरण सरफेस (`timeoutMs`, `AbortSignal`), और JS एर्गोनॉमिक्स।
- **Rust N-API मॉड्यूल लेयर** (`crates/pi-natives/src/*`): shell/PTY प्रोसेस निष्पादन, प्रोसेस-ट्री ट्रैवर्सल/टर्मिनेशन, और की-सीक्वेंस पार्सिंग।
- **वैलिडेशन गेट** (`native.ts`, आर्किटेक्चर-स्तर): रैपर उपयोग से पहले सुनिश्चित करता है कि आवश्यक एक्सपोर्ट्स (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, key हेल्पर्स) मौजूद हैं।

## Shell उपप्रणाली (`shell`)

### API मॉडल

दो निष्पादन मोड उपलब्ध हैं:

1. **एक-बार** `executeShell(options, onChunk?)` के माध्यम से।
2. **स्थायी सत्र** `new Shell(options?)` के माध्यम से फिर `shell.run(...)` को बार-बार चलाना।

दोनों थ्रेडसेफ कॉलबैक के माध्यम से आउटपुट स्ट्रीम करते हैं और `{ exitCode?, cancelled, timedOut }` लौटाते हैं।

### सत्र निर्माण और एनवायरनमेंट मॉडल

Rust `brush_core::Shell` बनाता है इनके साथ:

- नॉन-इंटरैक्टिव मोड,
- `do_not_inherit_env: true`,
- होस्ट env से स्पष्ट एनवायरनमेंट पुनर्निर्माण,
- shell-संवेदनशील वेरिएबल्स के लिए स्किप-लिस्ट (`PS1`, `PWD`, `SHLVL`, bash फंक्शन एक्सपोर्ट्स, आदि)।

सत्र env व्यवहार:

- `ShellOptions.sessionEnv` सत्र निर्माण के समय एक बार लागू होता है।
- `ShellRunOptions.env` कमांड-स्कोप्ड (`EnvironmentScope::Command`) है और प्रत्येक रन के बाद पॉप होता है।
- `PATH` को Windows पर केस-इनसेंसिटिव डीडुप के साथ विशेष रूप से मर्ज किया जाता है।

Windows-विशिष्ट पाथ एनरिचमेंट (`shell/windows.rs`): खोजे गए Git-for-Windows पाथ (`cmd`, `bin`, `usr/bin`) यदि मौजूद हैं और पहले से शामिल नहीं हैं तो जोड़े जाते हैं।

### रनटाइम जीवनचक्र और स्टेट ट्रांज़िशन

स्थायी shell (`Shell.run`) इस स्टेट मशीन का उपयोग करता है:

- **Idle/Uninitialized**: `session: None`।
- **Running**: पहला `run()` आलसी रूप से सत्र बनाता है, `current_abort` टोकन स्टोर करता है, कमांड निष्पादित करता है।
- **Completed + keepalive**: यदि निष्पादन कंट्रोल फ्लो `Normal` है, तो `current_abort` क्लियर होता है और सत्र पुनः उपयोग किया जाता है।
- **Completed + teardown**: यदि कंट्रोल फ्लो लूप/स्क्रिप्ट/shell-exit संबंधित है (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), तो सत्र ड्रॉप होता है (`session: None`)।
- **Cancelled/Timed out**: रन टास्क रद्द होता है, ग्रेस वेट (2s), फिर फोर्स-एबॉर्ट; सत्र ड्रॉप होता है।
- **Error**: सत्र ड्रॉप होता है।

एक-बार shell (`executeShell`) हमेशा प्रति कॉल एक नया सत्र बनाता और ड्रॉप करता है।

### स्ट्रीमिंग/आउटपुट व्यवहार

- Stdout/stderr को एक साझा पाइप में रूट किया जाता है और समवर्ती रूप से पढ़ा जाता है।
- रीडर UTF-8 को क्रमिक रूप से डिकोड करता है; अमान्य बाइट सीक्वेंस `U+FFFD` रिप्लेसमेंट चंक उत्सर्जित करते हैं।
- प्रोसेस पूर्ण होने के बाद, आउटपुट ड्रेन में idle/max गार्ड (`250ms` idle, `2s` max) होते हैं ताकि बैकग्राउंड जॉब्स द्वारा डिस्क्रिप्टर खुले रखने पर हैंगिंग से बचा जा सके।

### रद्दीकरण, टाइमआउट, और बैकग्राउंड जॉब्स

- `CancelToken` `timeoutMs` और वैकल्पिक `AbortSignal` से निर्मित होता है।
- रद्दीकरण/टाइमआउट पर, shell रद्दीकरण टोकन ट्रिगर होता है, फिर टास्क को फोर्स्ड एबॉर्ट से पहले 2s का ग्रेसफुल विंडो मिलता है।
- यदि रद्दीकरण होता है, तो बैकग्राउंड जॉब्स brush जॉब मेटाडेटा का उपयोग करके टर्मिनेट किए जाते हैं (`TERM`, फिर विलंबित `KILL`)।

`Shell.abort()` व्यवहार:

- उस `Shell` इंस्टेंस के लिए केवल वर्तमान चल रहे कमांड को एबॉर्ट करता है,
- जब कुछ भी नहीं चल रहा हो तो नो-ऑप सक्सेस।

### विफलता व्यवहार

सामान्य सामने आने वाली त्रुटियों में शामिल हैं:

- सत्र इनिट विफलताएं (`Failed to initialize shell`),
- cwd त्रुटियां (`Failed to set cwd`),
- env सेट/पॉप विफलताएं,
- स्नैपशॉट सोर्स विफलताएं,
- पाइप निर्माण/क्लोन विफलताएं,
- निष्पादन विफलता (`Shell execution failed: ...`),
- टास्क रैपर विफलताएं (`Shell execution task failed: ...`)।

परिणाम-स्तरीय रद्दीकरण फ्लैग:

- टाइमआउट -> `exitCode: undefined`, `timedOut: true`।
- एबॉर्ट सिग्नल -> `exitCode: undefined`, `cancelled: true`।

## PTY उपप्रणाली (`pty`)

### API मॉडल

`new PtySession()` उजागर करता है:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### रनटाइम जीवनचक्र और स्टेट ट्रांज़िशन

`PtySession` स्टेट मशीन:

- **Idle**: `core: None`।
- **Reserved**: `start()` एसिंक कार्य शुरू होने से पहले सिंक्रोनस रूप से कंट्रोल चैनल इंस्टॉल करता है (`core: Some`), ताकि `write/resize/kill` तुरंत मान्य हो जाएं।
- **Running**: ब्लॉकिंग PTY लूप चाइल्ड स्टेट, रीडर इवेंट्स, रद्दीकरण हार्टबीट, और कंट्रोल मैसेज को हैंडल करता है।
- **Terminal closed**: चाइल्ड एग्जिट + रीडर कम्पलीशन।
- **Finalized**: `start()` टास्क पूर्ण होने के बाद (सफलता या त्रुटि) `core` हमेशा `None` पर रीसेट होता है।

समवर्ती गार्ड:

- पहले से चल रहे सत्र के दौरान शुरू करने पर `PTY session already running` लौटता है।

### Spawn/attach/write/read/terminate पैटर्न

- PTY `portable_pty::native_pty_system().openpty(...)` के माध्यम से खोला जाता है।
- कमांड वर्तमान में `sh -lc <command>` के रूप में वैकल्पिक `cwd` और env ओवरराइड के साथ चलता है।
- `write()` PTY stdin को रॉ बाइट्स भेजता है।
- `resize()` आयामों को क्लैंप करता है (`cols 20..400`, `rows 5..200`) और मास्टर रिसाइज़ कॉल करता है।
- `kill()` रन को रद्द के रूप में चिह्नित करता है और चाइल्ड प्रोसेस को किल करता है।

आउटपुट पाथ:

- समर्पित रीडर थ्रेड मास्टर स्ट्रीम पढ़ता है,
- अमान्य बाइट्स पर `U+FFFD` रिप्लेसमेंट के साथ क्रमिक UTF-8 डिकोड,
- चंक N-API थ्रेडसेफ कॉलबैक के माध्यम से फॉरवर्ड किए जाते हैं।

### रद्दीकरण और टाइमआउट सेमैंटिक्स

- `timeoutMs` और `AbortSignal` एक `CancelToken` को फीड करते हैं।
- लूप समय-समय पर `ct.heartbeat()` कॉल करता है; एबॉर्ट चाइल्ड किल को ट्रिगर करता है।
- टाइमआउट वर्गीकरण स्ट्रिंग-आधारित है (हार्टबीट एरर में `"Timeout"` सबस्ट्रिंग)।

### विफलता व्यवहार

त्रुटि सरफेस में शामिल हैं:

- PTY आवंटन/खोलने की विफलता,
- PTY स्पॉन विफलता,
- राइटर/रीडर अधिग्रहण विफलता,
- चाइल्ड स्टेटस/वेट विफलताएं,
- लॉक पॉइज़निंग,
- कंट्रोल-चैनल डिस्कनेक्शन (`PTY session is no longer available`)।

नहीं चलने पर कंट्रोल कॉल विफलताएं:

- `write/resize/kill` `PTY session is not running` लौटाते हैं।

## प्रोसेस-ट्री उपप्रणाली (`ps`)

### API मॉडल

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS रैपर `setNativeKillTree(native.killTree)` के माध्यम से नेटिव kill-tree इंटीग्रेशन को साझा यूटिल्स में भी पंजीकृत करता है।

### प्लेटफॉर्म-विशिष्ट कार्यान्वयन

- **Linux**: पुनरावर्ती रूप से `/proc/<pid>/task/<pid>/children` पढ़ता है।
- **macOS**: `libproc` `proc_listchildpids` का उपयोग करता है।
- **Windows**: `CreateToolhelp32Snapshot` के साथ प्रोसेस टेबल का स्नैपशॉट लेता है, parent->children मैप बनाता है, `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` के साथ टर्मिनेट करता है।

### Kill-tree व्यवहार

- वंशज पुनरावर्ती रूप से एकत्र किए जाते हैं।
- किल क्रम बॉटम-अप (सबसे गहरे वंशज पहले) है ताकि अनाथ री-पैरेंटिंग कम हो।
- रूट pid सबसे अंत में किल होता है।
- वापसी मान सफल टर्मिनेशन की संख्या है।

सिग्नल व्यवहार:

- POSIX: प्रदान किया गया `signal` `kill` को पास किया जाता है।
- Windows: `signal` अनदेखा किया जाता है; टर्मिनेशन बिना शर्त प्रोसेस टर्मिनेट है।

### विफलता व्यवहार

यह मॉड्यूल API सरफेस पर जानबूझकर नॉन-थ्रोइंग है:

- गुम/अप्राप्य प्रोसेस ट्री शाखाएं छोड़ दी जाती हैं,
- प्रति-pid किल विफलताओं को असफल (त्रुटि नहीं) के रूप में गिना जाता है,
- लुकअप मिस आमतौर पर `listDescendants` से `[]` और `killTree` से `0` देता है।

## Key पार्सिंग उपप्रणाली (`keys`)

### API मॉडल

उजागर हेल्पर्स:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### पार्सिंग मॉडल

पार्सर इनका संयोजन करता है:

- प्रत्यक्ष सिंगल-बाइट मैपिंग (`enter`, `tab`, `ctrl+<letter>`, प्रिंटेबल ASCII),
- O(1) लेगेसी एस्केप-सीक्वेंस लुकअप (PHF मैप),
- xterm `modifyOtherKeys` पार्सिंग,
- Kitty प्रोटोकॉल पार्सिंग (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- की IDs में सामान्यीकरण (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, आदि)।

मॉडिफायर हैंडलिंग:

- की मैचिंग के लिए केवल shift/alt/ctrl बिट्स की तुलना की जाती है,
- तुलना से पहले लॉक बिट्स को मास्क किया जाता है।

लेआउट व्यवहार:

- बेस-लेआउट फॉलबैक जानबूझकर प्रतिबंधित है ताकि रीमैप्ड लेआउट ASCII अक्षरों/चिह्नों के लिए गलत मैच न बनाएं।

### विफलता व्यवहार

- अपरिचित या अमान्य सीक्वेंस पार्स फंक्शन से `null` उत्पन्न करते हैं।
- मैच फंक्शन पार्स विफलता या मिसमैच पर `false` लौटाते हैं।
- विकृत की इनपुट के लिए कोई थ्रोन एरर सरफेस नहीं है।

## JS रैपर API ↔ Rust एक्सपोर्ट मैपिंग

### Shell + PTY + Process

| TS रैपर API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | एक-बार shell निष्पादन |
| `new Shell(options?)` | `Shell` class | स्थायी shell सत्र |
| `shell.run(options, onChunk?)` | `Shell::run` | keepalive कंट्रोल फ्लो पर सत्र पुनः उपयोग |
| `shell.abort()` | `Shell::abort` | उस shell इंस्टेंस के सक्रिय रन को एबॉर्ट करता है |
| `new PtySession()` | `PtySession` class | स्टेटफुल PTY सत्र |
| `pty.start(options, onChunk?)` | `PtySession::start` | इंटरैक्टिव PTY रन |
| `pty.write(data)` | `PtySession::write` | रॉ stdin पासथ्रू |
| `pty.resize(cols, rows)` | `PtySession::resize` | क्लैंप्ड टर्मिनल आयाम |
| `pty.kill()` | `PtySession::kill` | सक्रिय PTY चाइल्ड को फोर्स-किल करता है |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | चिल्ड्रन-फर्स्ट प्रोसेस ट्री टर्मिनेशन |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | पुनरावर्ती वंशज लिस्टिंग |

### Keys

| TS रैपर API | Rust N-API एक्सपोर्ट | नोट्स |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty कोडपॉइंट+मॉडिफायर मैच |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | सामान्यीकृत key-id पार्सर |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | सटीक लेगेसी सीक्वेंस मैप जांच |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | संरचित Kitty पार्स परिणाम |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | उच्च-स्तरीय की मैचर |

## परित्यक्त सत्र क्लीनअप और फाइनलाइज़ेशन नोट्स

- **Shell स्थायी सत्र**: यदि कोई रन रद्द/टाइमआउट/त्रुटि/नॉन-keepalive कंट्रोल फ्लो होता है, तो Rust स्पष्ट रूप से आंतरिक सत्र स्टेट को ड्रॉप करता है। सफल सामान्य रन पुनः उपयोग के लिए सत्र को बनाए रखते हैं।
- **PTY सत्र**: `start()` समाप्त होने के बाद, विफलता पाथ सहित, `core` हमेशा क्लियर होता है।
- रैपर्स द्वारा **कोई स्पष्ट JS फाइनलाइज़र-ड्रिवन किल कॉन्ट्रैक्ट** उजागर नहीं किया जाता; क्लीनअप मुख्य रूप से रन कम्पलीशन/रद्दीकरण पाथ से जुड़ा है। कॉलर्स को निर्धारक टियरडाउन के लिए `timeoutMs`, `AbortSignal`, `shell.abort()`, या `pty.kill()` का उपयोग करना चाहिए।
