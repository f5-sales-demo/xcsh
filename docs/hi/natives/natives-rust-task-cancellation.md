---
title: नेटिव Rust टास्क एक्ज़ीक्यूशन और रद्दीकरण
description: >-
  सहकारी रद्दीकरण और क्लीनअप सेमेंटिक्स के साथ Rust async टास्क एक्ज़ीक्यूशन
  मॉडल।
sidebar:
  order: 5
  label: टास्क रद्दीकरण
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# नेटिव Rust टास्क एक्ज़ीक्यूशन और रद्दीकरण (`pi-natives`)

यह दस्तावेज़ बताता है कि `crates/pi-natives` किस प्रकार नेटिव कार्य शेड्यूल करता है और रद्दीकरण किस तरह JS विकल्पों (`timeoutMs`, `AbortSignal`) से Rust एक्ज़ीक्यूशन तक प्रवाहित होता है।

## इम्प्लीमेंटेशन फ़ाइलें

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## कोर प्रिमिटिव्स (`task.rs`)

`task.rs` तीन मुख्य भाग परिभाषित करता है:

1. `task::blocking(tag, cancel_token, work)`
   - `napi::AsyncTask` / `Task` को रैप करता है।
   - `compute()` libuv वर्कर थ्रेड्स पर चलता है (CPU-बाउंड या ब्लॉकिंग/सिंक सिस्टम कॉल के लिए)।
   - JS `Promise<T>` लौटाता है।

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)` को रैप करता है।
   - Tokio रनटाइम पर async कार्य चलाता है।
   - `PromiseRaw<'env, T>` लौटाता है।

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` डेडलाइन + वैकल्पिक `AbortSignal` को संयोजित करता है।
   - `CancelToken::heartbeat()` ब्लॉकिंग लूप के लिए सहकारी रद्दीकरण है।
   - `CancelToken::wait()` async रद्दीकरण प्रतीक्षा है (`Signal` / `Timeout` / `User` Ctrl-C)।
   - `AbortToken` बाहरी कोड को अबॉर्ट अनुरोध करने देता है (`abort(reason)`)।

## `blocking` बनाम `future`: एक्ज़ीक्यूशन मॉडल और चयन

### `task::blocking` का उपयोग करें

तब उपयोग करें जब कार्य CPU-heavy हो या मूलतः सिंक्रोनस/ब्लॉकिंग हो:

- regex/file स्कैनिंग (`grep`, `glob`, `fuzzy_find`)
- सिंक्रोनस PTY लूप इंटर्नल (`run_pty_sync` via `spawn_blocking`)
- clipboard/image/html रूपांतरण

व्यवहार:

- वर्क क्लोज़र को एक क्लोन किया गया `CancelToken` प्राप्त होता है।
- रद्दीकरण केवल वहाँ देखा जाता है जहाँ कोड `ct.heartbeat()?` जाँचता है।
- क्लोज़र `Err(...)` JS प्रॉमिस को रिजेक्ट करता है।

### `task::future` का उपयोग करें

तब उपयोग करें जब कार्य को async ऑपरेशन्स `await` करने हों:

- shell सेशन ऑर्केस्ट्रेशन (`shell.run`, `executeShell`)
- पूर्णता और रद्दीकरण के बीच टास्क रेसिंग (`tokio::select!`)

व्यवहार:

- Future, सामान्य पूर्णता बनाम `ct.wait()` के बीच रेस कर सकता है।
- रद्दीकरण पथ पर, async इम्प्लीमेंटेशन आमतौर पर आंतरिक सबसिस्टम (जैसे `tokio_util::CancellationToken`) में रद्दीकरण प्रसारित करते हैं और वैकल्पिक रूप से ग्रेस टाइमआउट पर जबरन अबॉर्ट करते हैं।

## JS API ↔ Rust एक्सपोर्ट मैपिंग (टास्क/रद्दीकरण संबंधित)

| JS-facing API | Rust export (`#[napi]`) | Scheduler | Cancellation hookup |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in filter loop |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in scoring loop |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` raced against run task; bridges to Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | same as above |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inner `spawn_blocking` | `CancelToken` checked in sync PTY loop via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | none (`()` token) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | none (`()` token) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | none (`()` token) |

`text.rs` और `ps.rs` वर्तमान में `task::blocking`/`task::future` का उपयोग नहीं करते और इसलिए इस रद्दीकरण पथ में भाग नहीं लेते।

## रद्दीकरण जीवनचक्र और स्थिति संक्रमण

### `CancelToken` जीवनचक्र

`CancelToken` सहकारी और स्टेटफुल है:

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### शुरू होने से पहले बनाम एक्ज़ीक्यूशन के दौरान रद्दीकरण

- **शुरू होने से पहले / पहली रद्दीकरण जाँच से पहले**:
  - `task::future` उपयोगकर्ता जो `ct.wait()` पर रेस करते हैं, `select!` में प्रवेश करते ही रद्दीकरण तुरंत रिज़ॉल्व कर सकते हैं।
  - `task::blocking` उपयोगकर्ता रद्दीकरण तभी देखते हैं जब क्लोज़र कोड `heartbeat()` तक पहुँचता है। यदि क्लोज़र जल्दी हार्टबीट नहीं करता, तो रद्दीकरण में देरी होती है।

- **एक्ज़ीक्यूशन के दौरान**:
  - `blocking`: अगला `heartbeat()` `Err("Aborted: ...")` लौटाता है।
  - `future`: `ct.wait()` ब्रांच `select!` जीतती है, फिर कोड अधीनस्थ async मशीनरी रद्द करता है (shell के लिए: Tokio टोकन रद्द करता है, 2 सेकंड तक प्रतीक्षा करता है, फिर टास्क अबॉर्ट करता है)।

## लंबे समय तक चलने वाले लूप के लिए हार्टबीट अपेक्षाएँ

`heartbeat()` अनबाउंडेड या बड़े वर्क सेट वाले लूप में अनुमानित कैडेंस पर चलना चाहिए।

देखे गए पैटर्न:

- `glob::filter_entries`: फ़िल्टरिंग/मैचिंग से पहले प्रत्येक एंट्री जाँचें।
- `fd::score_entries`: प्रत्येक स्कैन किए गए कैंडिडेट की जाँच करें।
- `grep_sync`: हेवी सर्च फ़ेज़ से पहले स्पष्ट रद्दीकरण जाँच, साथ ही fs-cache कॉल जो टोकन भी प्राप्त करते हैं।
- `run_pty_sync`: प्रत्येक लूप टिक पर जाँच (~16ms स्लीप कैडेंस) और रद्दीकरण पर चाइल्ड को किल करें।

व्यावहारिक नियम: बाहरी आकार के इनपुट पर कोई भी लूप बिना हार्टबीट के एक छोटे बाउंडेड अंतराल से अधिक नहीं होना चाहिए।

## JS में विफलता व्यवहार और एरर प्रसार

### ब्लॉकिंग टास्क

एरर पथ:

1. क्लोज़र `Err(napi::Error)` लौटाता है (`heartbeat()` अबॉर्ट सहित)।
2. `Task::compute()` `Err` लौटाता है।
3. `AsyncTask` JS प्रॉमिस को रिजेक्ट करता है।

सामान्य एरर स्ट्रिंग:

- `Aborted: Timeout`
- `Aborted: Signal`
- डोमेन एरर (`Failed to decode image: ...`, `Conversion error: ...`, आदि)

### Future टास्क

एरर पथ:

1. Async बॉडी `Err(napi::Error)` लौटाती है या join विफलता मैप की जाती है (`... task failed: {err}`)।
2. `task::future`-स्पॉन्ड प्रॉमिस रिजेक्ट होती है।
3. कुछ API जानबूझकर रिजेक्शन के बजाय संरचित रद्दीकरण परिणाम लौटाते हैं (`ShellRunResult`/`ShellExecuteResult` जिनमें `cancelled`/`timed_out` फ्लैग और `exit_code: None` हैं)।

### रद्दीकरण रिपोर्टिंग विभाजन

- **एरर के रूप में अबॉर्ट**: अधिकांश ब्लॉकिंग एक्सपोर्ट `heartbeat()?` का उपयोग करते हुए।
- **टाइप्ड रिजल्ट के रूप में अबॉर्ट**: shell/pty शैली कमांड API जो रिजल्ट स्ट्रक्चर में रद्दीकरण मॉडल करते हैं।

प्रति API एक मॉडल चुनें और इसे स्पष्ट रूप से दस्तावेज़ीकृत करें।

## सामान्य गलतियाँ

1. **ब्लॉकिंग लूप में हार्टबीट का अभाव**
   - लक्षण: लूप समाप्त होने तक टाइमआउट/सिग्नल अनदेखा लगता है।
   - समाधान: लूप की शुरुआत में और महँगे प्रति-आइटम चरणों से पहले `ct.heartbeat()?` जोड़ें।

2. **लंबे अरद्दीकरण-योग्य अनुभाग**
   - लक्षण: एकल बड़े कॉल (decode, sort, compression, आदि) के दौरान रद्दीकरण लेटेंसी बढ़ जाती है।
   - समाधान: कार्य को हार्टबीट सीमाओं के साथ चंक्स में विभाजित करें; यदि संभव न हो, तो लेटेंसी दस्तावेज़ीकृत करें।

3. **Async एक्ज़ीक्यूटर को ब्लॉक करना**
   - लक्षण: async API रुक जाता है जब सिंक-heavy कोड सीधे future में चलता है।
   - समाधान: CPU/सिंक ब्लॉक्स को `task::blocking` या `tokio::task::spawn_blocking` में स्थानांतरित करें।

4. **असंगत रद्दीकरण सेमेंटिक्स**
   - लक्षण: एक API रद्दीकरण पर रिजेक्ट करता है, दूसरा फ्लैग के साथ रिज़ॉल्व करता है, जिससे कॉलर भ्रमित होते हैं।
   - समाधान: प्रति डोमेन मानकीकृत करें और रैपर दस्तावेज़ों को संरेखित रखें।

5. **नेस्टेड async टास्क में रद्दीकरण ब्रिज भूलना**
   - लक्षण: बाहरी टोकन रद्द हो जाता है लेकिन आंतरिक रीडर/सबप्रोसेस टास्क चलते रहते हैं।
   - समाधान: आंतरिक टोकन/सिग्नल में रद्दीकरण ब्रिज करें और ग्रेस टाइमआउट + जबरन अबॉर्ट फॉलबैक लागू करें।

## नए रद्दीकरण-योग्य एक्सपोर्ट के लिए चेकलिस्ट

1. कार्य का सही वर्गीकरण करें:
   - CPU-बाउंड या सिंक ब्लॉकिंग -> `task::blocking`
   - async I/O / `await` ऑर्केस्ट्रेशन -> `task::future`

2. आवश्यक होने पर रद्दीकरण इनपुट एक्सपोज़ करें:
   - `#[napi(object)]` विकल्पों में `timeoutMs` और `signal` शामिल करें
   - `let ct = task::CancelToken::new(timeout_ms, signal);` बनाएँ

3. सभी परतों में रद्दीकरण जोड़ें:
   - ब्लॉकिंग लूप: स्थिर अंतराल पर `ct.heartbeat()?`
   - async ऑर्केस्ट्रेशन: `ct.wait()` के साथ रेस करें और सब-टास्क/टोकन रद्द करें

4. रद्दीकरण कॉन्ट्रैक्ट तय करें:
   - अबॉर्ट एरर के साथ प्रॉमिस रिजेक्ट करें, या
   - टाइप्ड `{ cancelled, timedOut, ... }` रिज़ॉल्व करें
   - API परिवार के लिए इस कॉन्ट्रैक्ट को सुसंगत रखें

5. संदर्भ के साथ विफलताएँ प्रसारित करें:
   - `Error::from_reason(format!("...: {err}"))` के माध्यम से एरर मैप करें
   - चरण-विशिष्ट प्रीफ़िक्स शामिल करें (`spawn`, `decode`, `wait`, आदि)

6. शुरू होने से पहले और एक्ज़ीक्यूशन के दौरान रद्दीकरण संभालें:
   - रद्दीकरण जाँच/प्रतीक्षा महँगे बॉडी से पहले और लंबे एक्ज़ीक्यूशन के दौरान होनी चाहिए

7. एक्ज़ीक्यूटर के दुरुपयोग की जाँच करें:
   - `spawn_blocking`/ब्लॉकिंग टास्क रैपर के बिना async futures के अंदर सीधे लंबा सिंक कार्य नहीं
