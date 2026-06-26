---
title: 'नेटिव्स Shell, PTY, प्रक्रिया और Key आंतरिक तंत्र'
description: >-
  नेटिव परत में Shell निष्पादन, PTY प्रबंधन, प्रक्रिया जीवनचक्र, और key इवेंट
  हैंडलिंग।
sidebar:
  order: 4
  label: 'Shell, PTY और प्रक्रिया'
i18n:
  sourceHash: 00ea95614c6a
  translator: machine
---

# नेटिव्स Shell, PTY, प्रक्रिया और Key आंतरिक तंत्र

यह दस्तावेज़ `@f5-sales-demo/pi-natives` में **निष्पादन/प्रक्रिया/टर्मिनल प्रिमिटिव्स** को कवर करता है: `shell`, `pty`, `ps`, और `keys`, जो `docs/natives-architecture.md` से आर्किटेक्चर शब्दावली का उपयोग करते हैं।

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

## परत स्वामित्व

- **TS रैपर/API परत** (`packages/natives/src/*`): टाइप्ड एंट्रीपॉइंट, रद्दीकरण सतह (`timeoutMs`, `AbortSignal`), और JS एर्गोनॉमिक्स।
- **Rust N-API मॉड्यूल परत** (`crates/pi-natives/src/*`): shell/PTY प्रक्रिया निष्पादन, प्रक्रिया-ट्री ट्रैवर्सल/समाप्ति, और key-सीक्वेंस पार्सिंग।
- **सत्यापन गेट** (`native.ts`, आर्किटेक्चर-स्तर): सुनिश्चित करता है कि रैपर उपयोग से पहले आवश्यक exports (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, key हेल्पर) मौजूद हैं।

## Shell उपतंत्र (`shell`)

### API मॉडल

दो निष्पादन मोड उजागर किए गए हैं:

1. **एक-बार** `executeShell(options, onChunk?)` के माध्यम से।
2. **स्थायी सत्र** `new Shell(options?)` फिर `shell.run(...)` बार-बार के माध्यम से।

दोनों एक थ्रेडसेफ कॉलबैक के माध्यम से आउटपुट स्ट्रीम करते हैं और `{ exitCode?, cancelled, timedOut }` लौटाते हैं।

### सत्र निर्माण और पर्यावरण मॉडल

Rust इन के साथ `brush_core::Shell` बनाता है:

- गैर-इंटरेक्टिव मोड,
- `do_not_inherit_env: true`,
- होस्ट env से स्पष्ट पर्यावरण पुनर्निर्माण,
- shell-संवेदनशील vars के लिए skip-list (`PS1`, `PWD`, `SHLVL`, bash फ़ंक्शन exports, आदि)।

सत्र env व्यवहार:

- `ShellOptions.sessionEnv` सत्र निर्माण पर एक बार लागू होता है।
- `ShellRunOptions.env` कमांड-स्कोप्ड (`EnvironmentScope::Command`) है और प्रत्येक रन के बाद pop होता है।
- `PATH` को Windows पर case-insensitive dedupe के साथ विशेष रूप से मर्ज किया जाता है।

केवल Windows पर path संवर्धन (`shell/windows.rs`): खोजे गए Git-for-Windows paths (`cmd`, `bin`, `usr/bin`) को जोड़ा जाता है यदि मौजूद हों और पहले से शामिल न हों।

### रनटाइम जीवनचक्र और स्थिति संक्रमण

स्थायी shell (`Shell.run`) इस स्थिति मशीन का उपयोग करता है:

- **Idle/अनारंभीकृत**: `session: None`।
- **चल रहा**: पहला `run()` lazily सत्र बनाता है, `current_abort` टोकन संग्रहीत करता है, कमांड निष्पादित करता है।
- **पूर्ण + keepalive**: यदि निष्पादन नियंत्रण प्रवाह `Normal` है, `current_abort` साफ़ होता है और सत्र पुनः उपयोग होता है।
- **पूर्ण + teardown**: यदि नियंत्रण प्रवाह loop/script/shell-exit संबंधित है (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), सत्र drop होता है (`session: None`)।
- **रद्द/टाइम आउट**: रन टास्क रद्द होता है, grace wait (2s), फिर force-abort; सत्र drop होता है।
- **त्रुटि**: सत्र drop होता है।

एक-बार shell (`executeShell`) प्रत्येक कॉल पर हमेशा एक नया सत्र बनाता और drop करता है।

### स्ट्रीमिंग/आउटपुट व्यवहार

- Stdout/stderr को एक साझा pipe में रूट किया जाता है और एक साथ पढ़ा जाता है।
- रीडर UTF-8 को incrementally decode करता है; अमान्य byte सीक्वेंस `U+FFFD` रिप्लेसमेंट chunks emit करते हैं।
- प्रक्रिया पूर्ण होने के बाद, आउटपुट drain में idle/max guards (`250ms` idle, `2s` max) होते हैं ताकि descriptors खुला रखने वाली बैकग्राउंड jobs पर hanging से बचा जा सके।

### रद्दीकरण, टाइमआउट, और बैकग्राउंड jobs

- `CancelToken` `timeoutMs` और वैकल्पिक `AbortSignal` से बनाया जाता है।
- रद्दीकरण/टाइमआउट पर, shell रद्दीकरण टोकन ट्रिगर होता है, फिर forced abort से पहले टास्क को 2s graceful window मिलती है।
- यदि रद्दीकरण होता है, बैकग्राउंड jobs brush job metadata का उपयोग करके समाप्त की जाती हैं (`TERM`, फिर delayed `KILL`)।

`Shell.abort()` व्यवहार:

- केवल उस `Shell` इंस्टेंस के लिए वर्तमान चल रहे कमांड को abort करता है,
- जब कुछ नहीं चल रहा हो तो no-op success।

### विफलता व्यवहार

सामान्य उजागर त्रुटियों में शामिल हैं:

- सत्र init विफलताएं (`Failed to initialize shell`),
- cwd त्रुटियां (`Failed to set cwd`),
- env set/pop विफलताएं,
- snapshot source विफलताएं,
- pipe creation/clone विफलताएं,
- निष्पादन विफलता (`Shell execution failed: ...`),
- टास्क रैपर विफलताएं (`Shell execution task failed: ...`)।

परिणाम-स्तर रद्दीकरण flags:

- timeout -> `exitCode: undefined`, `timedOut: true`।
- abort signal -> `exitCode: undefined`, `cancelled: true`।

## PTY उपतंत्र (`pty`)

### API मॉडल

`new PtySession()` उजागर करता है:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### रनटाइम जीवनचक्र और स्थिति संक्रमण

`PtySession` स्थिति मशीन:

- **Idle**: `core: None`।
- **Reserved**: `start()` async काम शुरू होने से पहले synchronously कंट्रोल चैनल install करता है (`core: Some`), ताकि `write/resize/kill` तुरंत valid हो जाएं।
- **चल रहा**: blocking PTY loop child स्थिति, reader events, रद्दीकरण heartbeat, और control messages हैंडल करता है।
- **टर्मिनल बंद**: child exit + reader completion।
- **Finalized**: start टास्क पूर्ण होने के बाद (success या error) `core` हमेशा `None` पर reset होता है।

संगामिता गार्ड:

- पहले से चल रहे होने पर start करने पर `PTY session already running` लौटाता है।

### Spawn/attach/write/read/terminate पैटर्न

- PTY `portable_pty::native_pty_system().openpty(...)` के माध्यम से खुलता है।
- कमांड वर्तमान में वैकल्पिक `cwd` और env overrides के साथ `sh -lc <command>` के रूप में चलता है।
- `write()` PTY stdin को raw bytes भेजता है।
- `resize()` dimensions को clamp करता है (`cols 20..400`, `rows 5..200`) और master resize कॉल करता है।
- `kill()` run को cancelled के रूप में चिह्नित करता है और child प्रक्रिया को kill करता है।

आउटपुट पथ:

- समर्पित reader thread master stream पढ़ता है,
- `U+FFFD` रिप्लेसमेंट के साथ अमान्य bytes पर incremental UTF-8 decode,
- N-API threadsafe callback के माध्यम से chunks forward किए जाते हैं।

### रद्दीकरण और टाइमआउट सिमेंटिक्स

- `timeoutMs` और `AbortSignal` एक `CancelToken` को फ़ीड करते हैं।
- loop आवधिक रूप से `ct.heartbeat()` कॉल करता है; abort child kill ट्रिगर करता है।
- टाइमआउट वर्गीकरण string-based है (heartbeat error में `"Timeout"` substring)।

### विफलता व्यवहार

त्रुटि surfaces में शामिल हैं:

- PTY allocation/open विफलता,
- PTY spawn विफलता,
- writer/reader acquisition विफलता,
- child status/wait विफलताएं,
- lock poisoning,
- control-channel disconnection (`PTY session is no longer available`)।

चल न रहे होने पर control call विफलताएं:

- `write/resize/kill` `PTY session is not running` लौटाते हैं।

## प्रक्रिया-ट्री उपतंत्र (`ps`)

### API मॉडल

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS रैपर `setNativeKillTree(native.killTree)` के माध्यम से native kill-tree integration को साझा utils में भी रजिस्टर करता है।

### प्लेटफ़ॉर्म-विशिष्ट कार्यान्वयन

- **Linux**: `/proc/<pid>/task/<pid>/children` को recursively पढ़ता है।
- **macOS**: `libproc` `proc_listchildpids` का उपयोग करता है।
- **Windows**: `CreateToolhelp32Snapshot` से प्रक्रिया तालिका snapshot करता है, parent->children map बनाता है, `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` से समाप्त करता है।

### Kill-tree व्यवहार

- Descendants recursively एकत्र किए जाते हैं।
- Kill क्रम bottom-up (पहले सबसे गहरे descendants) है ताकि orphan re-parenting कम हो।
- Root pid अंत में kill होता है।
- Return value सफल terminations की गिनती है।

Signal व्यवहार:

- POSIX: प्रदान किया गया `signal` `kill` को पास होता है।
- Windows: `signal` को ignore किया जाता है; termination बिना शर्त process terminate है।

### विफलता व्यवहार

यह मॉड्यूल API surface पर जानबूझकर non-throwing है:

- गुम/अनुपलब्ध प्रक्रिया ट्री शाखाएं skip की जाती हैं,
- per-pid kill विफलताएं असफल के रूप में गिनी जाती हैं (त्रुटियां नहीं),
- lookup miss आमतौर पर `listDescendants` से `[]` और `killTree` से `0` देता है।

## Key पार्सिंग उपतंत्र (`keys`)

### API मॉडल

उजागर हेल्पर:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### पार्सिंग मॉडल

पार्सर को जोड़ता है:

- सीधे single-byte mappings (`enter`, `tab`, `ctrl+<letter>`, printable ASCII),
- O(1) legacy escape-sequence lookup (PHF map),
- xterm `modifyOtherKeys` पार्सिंग,
- Kitty protocol पार्सिंग (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- key IDs में normalization (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, आदि)।

Modifier हैंडलिंग:

- key matching के लिए केवल shift/alt/ctrl bits की तुलना की जाती है,
- lock bits को comparisons से पहले masked out किया जाता है।

Layout व्यवहार:

- base-layout fallback जानबूझकर constrained है ताकि remapped layouts ASCII letters/symbols के लिए false matches न बनाएं।

### विफलता व्यवहार

- अज्ञात या अमान्य sequences parse functions से `null` देते हैं।
- Match functions parse विफलता या mismatch पर `false` लौटाते हैं।
- विकृत key input के लिए कोई thrown error surface नहीं है।

## JS रैपर API ↔ Rust export मैपिंग

### Shell + PTY + प्रक्रिया

| TS रैपर API | Rust N-API export | नोट्स |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | एक-बार shell निष्पादन |
| `new Shell(options?)` | `Shell` class | स्थायी shell सत्र |
| `shell.run(options, onChunk?)` | `Shell::run` | keepalive control flow पर सत्र पुनः उपयोग करता है |
| `shell.abort()` | `Shell::abort` | उस shell इंस्टेंस के लिए सक्रिय run को abort करता है |
| `new PtySession()` | `PtySession` class | Stateful PTY सत्र |
| `pty.start(options, onChunk?)` | `PtySession::start` | इंटरेक्टिव PTY run |
| `pty.write(data)` | `PtySession::write` | Raw stdin passthrough |
| `pty.resize(cols, rows)` | `PtySession::resize` | Clamped टर्मिनल dimensions |
| `pty.kill()` | `PtySession::kill` | सक्रिय PTY child को force-kill करता है |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Children-first प्रक्रिया ट्री समाप्ति |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Recursive descendants listing |

### Keys

| TS रैपर API | Rust N-API export | नोट्स |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty codepoint+modifier match |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Normalized key-id पार्सर |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Exact legacy sequence map check |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Structured Kitty parse परिणाम |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | High-level key matcher |

## परित्यक्त सत्र cleanup और finalization नोट्स

- **Shell स्थायी सत्र**: यदि कोई run रद्द/टाइम आउट/त्रुटि/non-keepalive control flow है, Rust स्पष्ट रूप से आंतरिक सत्र स्थिति drop करता है। सफल सामान्य runs पुनः उपयोग के लिए सत्र रखते हैं।
- **PTY सत्र**: विफलता paths सहित `start()` समाप्त होने के बाद `core` हमेशा साफ़ होता है।
- **कोई स्पष्ट JS finalizer-driven kill अनुबंध** रैपर द्वारा उजागर नहीं किया जाता; cleanup मुख्य रूप से run completion/cancellation paths से जुड़ी है। कॉलर्स को निर्धारक teardown के लिए `timeoutMs`, `AbortSignal`, `shell.abort()`, या `pty.kill()` का उपयोग करना चाहिए।
