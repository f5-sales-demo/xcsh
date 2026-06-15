---
title: नेटिव Rust टास्क निष्पादन और रद्दीकरण
description: सहकारी रद्दीकरण और क्लीनअप सिमेंटिक्स के साथ Rust async टास्क निष्पादन मॉडल।
sidebar:
  order: 5
  label: टास्क रद्दीकरण
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# नेटिव Rust टास्क निष्पादन और रद्दीकरण (`pi-natives`)

यह दस्तावेज़ बताता है कि `crates/pi-natives` नेटिव कार्य को कैसे शेड्यूल करता है और रद्दीकरण JS विकल्पों (`timeoutMs`, `AbortSignal`) से Rust निष्पादन तक कैसे प्रवाहित होता है।

## कार्यान्वयन फ़ाइलें

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

`task.rs` तीन कोर घटक परिभाषित करता है:

1. `task::blocking(tag, cancel_token, work)`
   - `napi::AsyncTask` / `Task` को रैप करता है।
   - `compute()` libuv वर्कर थ्रेड्स पर चलता है (CPU-बाउंड या ब्लॉकिंग/सिंक सिस्टम कॉल के लिए)।
   - JS `Promise<T>` लौटाता है।

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)` को रैप करता है।
   - Tokio रनटाइम पर async कार्य चलाता है।
   - `PromiseRaw<'env, T>` लौटाता है।

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` डेडलाइन + वैकल्पिक `AbortSignal` को संयुक्त करता है।
   - `CancelToken::heartbeat()` ब्लॉकिंग लूप के लिए सहकारी रद्दीकरण है।
   - `CancelToken::wait()` async रद्दीकरण प्रतीक्षा है (`Signal` / `Timeout` / `User` Ctrl-C)।
   - `AbortToken` बाहरी कोड को abort अनुरोध करने देता है (`abort(reason)`)।

## `blocking` बनाम `future`: निष्पादन मॉडल और चयन

### `task::blocking` का उपयोग करें

जब कार्य CPU-भारी या मूल रूप से सिंक्रोनस/ब्लॉकिंग हो:

- regex/फ़ाइल स्कैनिंग (`grep`, `glob`, `fuzzy_find`)
- सिंक्रोनस PTY लूप इंटर्नल्स (`spawn_blocking` के माध्यम से `run_pty_sync`)
- clipboard/image/html रूपांतरण

व्यवहार:

- वर्क क्लोज़र एक क्लोन किया हुआ `CancelToken` प्राप्त करता है।
- रद्दीकरण केवल वहीं देखा जाता है जहाँ कोड `ct.heartbeat()?` जाँचता है।
- क्लोज़र `Err(...)` JS promise को अस्वीकार करता है।

### `task::future` का उपयोग करें

जब कार्य को async ऑपरेशन `await` करना हो:

- shell सत्र ऑर्केस्ट्रेशन (`shell.run`, `executeShell`)
- टास्क रेसिंग (`tokio::select!`) पूर्णता और रद्दीकरण के बीच

व्यवहार:

- Future, `ct.wait()` के विरुद्ध सामान्य पूर्णता को रेस कर सकता है।
- कैंसल पाथ पर, async कार्यान्वयन आमतौर पर आंतरिक सबसिस्टम को रद्दीकरण प्रसारित करते हैं (जैसे, `tokio_util::CancellationToken`) और वैकल्पिक रूप से ग्रेस टाइमआउट पर जबरदस्ती abort करते हैं।

## JS API ↔ Rust एक्सपोर्ट मैपिंग (टास्क/कैंसल प्रासंगिक)

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

`text.rs` और `ps.rs` वर्तमान में `task::blocking`/`task::future` का उपयोग नहीं करते और इसलिए इस रद्दीकरण पाथ में भाग नहीं लेते।

## रद्दीकरण जीवनचक्र और अवस्था संक्रमण

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

### शुरू से पहले बनाम मध्य-निष्पादन रद्दीकरण

- **शुरू से पहले / पहली रद्दीकरण जाँच से पहले**:
  - `task::future` उपयोगकर्ता जो `ct.wait()` पर रेस करते हैं, एक बार `select!` में प्रवेश करने पर कैंसल को तुरंत हल कर सकते हैं।
  - `task::blocking` उपयोगकर्ता रद्दीकरण तभी देखते हैं जब क्लोज़र कोड `heartbeat()` तक पहुँचता है। यदि क्लोज़र जल्दी हार्टबीट नहीं करता, तो रद्दीकरण देरी से होगा।

- **मध्य-निष्पादन**:
  - `blocking`: अगला `heartbeat()` `Err("Aborted: ...")` लौटाता है।
  - `future`: `ct.wait()` ब्रांच `select!` जीतती है, फिर कोड अधीनस्थ async मशीनरी को रद्द करता है (shell के लिए: Tokio टोकन रद्द करता है, 2s तक प्रतीक्षा करता है, फिर टास्क abort करता है)।

## लंबे समय तक चलने वाले लूप के लिए हार्टबीट अपेक्षाएँ

`heartbeat()` को असीमित या बड़े वर्क सेट वाले लूप में अनुमानित गति से चलना चाहिए।

देखे गए पैटर्न:

- `glob::filter_entries`: फ़िल्टरिंग/मिलान से पहले प्रत्येक एंट्री की जाँच करें।
- `fd::score_entries`: प्रत्येक स्कैन किए गए उम्मीदवार की जाँच करें।
- `grep_sync`: भारी सर्च चरण से पहले स्पष्ट रद्दीकरण जाँच, साथ ही fs-cache कॉल जो टोकन भी प्राप्त करते हैं।
- `run_pty_sync`: प्रत्येक लूप टिक (~16ms स्लीप गति) पर जाँच और रद्दीकरण पर child को kill करना।

व्यावहारिक नियम: बाहरी-आकार इनपुट पर कोई भी लूप हार्टबीट के बिना एक छोटी बाउंडेड अंतराल से अधिक नहीं होना चाहिए।

## JS को विफलता व्यवहार और त्रुटि प्रसार

### ब्लॉकिंग टास्क

त्रुटि पाथ:

1. क्लोज़र `Err(napi::Error)` लौटाता है (`heartbeat()` abort सहित)।
2. `Task::compute()` `Err` लौटाता है।
3. `AsyncTask` JS promise को अस्वीकार करता है।

सामान्य त्रुटि स्ट्रिंग्स:

- `Aborted: Timeout`
- `Aborted: Signal`
- डोमेन त्रुटियाँ (`Failed to decode image: ...`, `Conversion error: ...`, आदि)

### Future टास्क

त्रुटि पाथ:

1. Async बॉडी `Err(napi::Error)` लौटाती है या join विफलता को मैप किया जाता है (`... task failed: {err}`)।
2. `task::future`-स्पॉन्ड promise अस्वीकार होता है।
3. कुछ APIs जानबूझकर अस्वीकृति के बजाय संरचित रद्दीकरण परिणाम लौटाते हैं (`ShellRunResult`/`ShellExecuteResult` के साथ `cancelled`/`timed_out` फ्लैग और `exit_code: None`)।

### रद्दीकरण रिपोर्टिंग विभाजन

- **त्रुटि के रूप में Abort**: `heartbeat()?` का उपयोग करने वाले अधिकांश ब्लॉकिंग एक्सपोर्ट।
- **टाइप्ड परिणाम के रूप में Abort**: shell/pty स्टाइल कमांड APIs जो रिजल्ट स्ट्रक्चर में रद्दीकरण को मॉडल करते हैं।

प्रति API एक मॉडल चुनें और उसे स्पष्ट रूप से दस्तावेज़ीकृत करें।

## सामान्य समस्याएँ

1. **ब्लॉकिंग लूप में हार्टबीट का अभाव**
   - लक्षण: टाइमआउट/सिग्नल लूप समाप्त होने तक अनदेखा प्रतीत होता है।
   - समाधान: लूप के शीर्ष और महंगे प्रति-आइटम चरणों से पहले `ct.heartbeat()?` जोड़ें।

2. **लंबे अरद्द करने योग्य खंड**
   - लक्षण: एकल बड़े कॉल (decode, sort, compression, आदि) के दौरान रद्दीकरण विलंब में वृद्धि।
   - समाधान: कार्य को हार्टबीट सीमाओं के साथ खंडों में विभाजित करें; यदि असंभव हो, तो विलंब को दस्तावेज़ीकृत करें।

3. **Blocking async executor**
   - लक्षण: async API रुक जाती है जब sync-भारी कोड सीधे future में चलता है।
   - समाधान: CPU/sync ब्लॉक को `task::blocking` या `tokio::task::spawn_blocking` में ले जाएँ।

4. **असंगत कैंसल सिमेंटिक्स**
   - लक्षण: एक API कैंसल पर reject करती है, दूसरी फ्लैग के साथ resolve करती है, जो callers को भ्रमित करता है।
   - समाधान: प्रति डोमेन मानकीकृत करें और रैपर दस्तावेज़ को संरेखित रखें।

5. **नेस्टेड async टास्क में रद्दीकरण ब्रिज भूलना**
   - लक्षण: बाहरी टोकन रद्द होता है लेकिन आंतरिक readers/subprocess टास्क चलते रहते हैं।
   - समाधान: रद्दीकरण को आंतरिक टोकन/सिग्नल से जोड़ें और ग्रेस टाइमआउट + जबरदस्ती abort फॉलबैक लागू करें।

## नए रद्द करने योग्य एक्सपोर्ट के लिए चेकलिस्ट

1. कार्य को सही ढंग से वर्गीकृत करें:
   - CPU-बाउंड या sync ब्लॉकिंग -> `task::blocking`
   - async I/O / `await` ऑर्केस्ट्रेशन -> `task::future`

2. आवश्यकता पड़ने पर कैंसल इनपुट उजागर करें:
   - `#[napi(object)]` विकल्पों में `timeoutMs` और `signal` शामिल करें
   - `let ct = task::CancelToken::new(timeout_ms, signal);` बनाएँ

3. सभी परतों में रद्दीकरण जोड़ें:
   - ब्लॉकिंग लूप: स्थिर अंतराल पर `ct.heartbeat()?`
   - async ऑर्केस्ट्रेशन: `ct.wait()` के साथ रेस करें और sub-tasks/tokens रद्द करें

4. रद्दीकरण अनुबंध तय करें:
   - abort त्रुटि के साथ promise अस्वीकार करें, या
   - टाइप्ड `{ cancelled, timedOut, ... }` resolve करें
   - API परिवार के लिए यह अनुबंध सुसंगत रखें

5. संदर्भ के साथ विफलताएँ प्रसारित करें:
   - `Error::from_reason(format!("...: {err}"))` के माध्यम से त्रुटियाँ मैप करें
   - चरण-विशिष्ट उपसर्ग शामिल करें (`spawn`, `decode`, `wait`, आदि)

6. शुरू से पहले और मध्य-उड़ान रद्दीकरण संभालें:
   - महंगे बॉडी से पहले और लंबे निष्पादन के दौरान रद्दीकरण जाँच/प्रतीक्षा होनी चाहिए

7. executor के दुरुपयोग की जाँच करें:
   - `spawn_blocking`/blocking टास्क रैपर के बिना async futures के अंदर सीधे कोई लंबा sync कार्य नहीं
