---
title: Native Rust Task Execution and Cancellation
description: >-
  Rust async task execution model with cooperative cancellation and cleanup
  semantics.
sidebar:
  order: 5
  label: Task cancellation
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# नेटिव Rust टास्क निष्पादन और रद्दीकरण (`pi-natives`)

यह दस्तावेज़ वर्णन करता है कि `crates/pi-natives` नेटिव कार्य को कैसे शेड्यूल करता है और JS विकल्पों (`timeoutMs`, `AbortSignal`) से Rust निष्पादन तक रद्दीकरण कैसे प्रवाहित होता है।

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

## मूल प्राइमिटिव्स (`task.rs`)

`task.rs` तीन मूल घटक परिभाषित करता है:

1. `task::blocking(tag, cancel_token, work)`
   - `napi::AsyncTask` / `Task` को रैप करता है।
   - `compute()` libuv वर्कर थ्रेड्स पर चलता है (CPU-बाउंड या ब्लॉकिंग/सिंक सिस्टम कॉल्स के लिए)।
   - एक JS `Promise<T>` लौटाता है।

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)` को रैप करता है।
   - Tokio रनटाइम पर async कार्य चलाता है।
   - `PromiseRaw<'env, T>` लौटाता है।

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` डेडलाइन + वैकल्पिक `AbortSignal` को जोड़ता है।
   - `CancelToken::heartbeat()` ब्लॉकिंग लूप्स के लिए सहकारी रद्दीकरण है।
   - `CancelToken::wait()` async रद्दीकरण प्रतीक्षा है (`Signal` / `Timeout` / `User` Ctrl-C)।
   - `AbortToken` बाहरी कोड को abort का अनुरोध करने देता है (`abort(reason)`)।

## `blocking` बनाम `future`: निष्पादन मॉडल और चयन

### `task::blocking` का उपयोग करें

जब कार्य CPU-गहन या मूल रूप से सिंक्रोनस/ब्लॉकिंग हो तब उपयोग करें:

- regex/फ़ाइल स्कैनिंग (`grep`, `glob`, `fuzzy_find`)
- सिंक्रोनस PTY लूप आंतरिक (`run_pty_sync` `spawn_blocking` के माध्यम से)
- clipboard/image/html रूपांतरण

व्यवहार:

- कार्य क्लोज़र एक क्लोन किया गया `CancelToken` प्राप्त करता है।
- रद्दीकरण केवल वहाँ देखा जाता है जहाँ कोड `ct.heartbeat()?` जाँचता है।
- क्लोज़र `Err(...)` JS प्रॉमिस को reject करता है।

### `task::future` का उपयोग करें

जब कार्य को async ऑपरेशन्स `await` करने हों तब उपयोग करें:

- शेल सत्र ऑर्केस्ट्रेशन (`shell.run`, `executeShell`)
- पूर्णता और रद्दीकरण के बीच टास्क रेसिंग (`tokio::select!`)

व्यवहार:

- Future सामान्य पूर्णता को `ct.wait()` के विरुद्ध रेस कर सकता है।
- रद्दीकरण पथ पर, async कार्यान्वयन आमतौर पर रद्दीकरण को आंतरिक उपप्रणालियों तक प्रसारित करते हैं (उदा., `tokio_util::CancellationToken`) और वैकल्पिक रूप से ग्रेस टाइमआउट पर बलपूर्वक abort करते हैं।

## JS API ↔ Rust एक्सपोर्ट मैपिंग (task/cancel प्रासंगिक)

| JS-फेसिंग API | Rust एक्सपोर्ट (`#[napi]`) | शेड्यूलर | रद्दीकरण हुकअप |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + फ़िल्टर लूप में `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + स्कोरिंग लूप में `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` रन टास्क के विरुद्ध रेस किया गया; Tokio `CancellationToken` से ब्रिज करता है |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | ऊपर जैसा ही |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + आंतरिक `spawn_blocking` | सिंक PTY लूप में `heartbeat()` के माध्यम से `CancelToken` जाँचा गया |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | कोई नहीं (`()` टोकन) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | कोई नहीं (`()` टोकन) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | कोई नहीं (`()` टोकन) |

`text.rs` और `ps.rs` वर्तमान में `task::blocking`/`task::future` का उपयोग नहीं करते हैं और इसलिए इस रद्दीकरण पथ में भाग नहीं लेते हैं।

## रद्दीकरण जीवनचक्र और स्थिति परिवर्तन

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

### प्रारंभ-पूर्व बनाम निष्पादन-मध्य रद्दीकरण

- **प्रारंभ से पहले / पहली रद्दीकरण जाँच से पहले**:
  - `task::future` उपयोगकर्ता जो `ct.wait()` पर रेस करते हैं, `select!` में प्रवेश करते ही तुरंत रद्दीकरण resolve कर सकते हैं।
  - `task::blocking` उपयोगकर्ता केवल तब रद्दीकरण देखते हैं जब क्लोज़र कोड `heartbeat()` तक पहुँचता है। यदि क्लोज़र जल्दी heartbeat नहीं करता, तो रद्दीकरण में विलंब होता है।

- **निष्पादन-मध्य**:
  - `blocking`: अगला `heartbeat()` `Err("Aborted: ...")` लौटाता है।
  - `future`: `ct.wait()` शाखा `select!` जीतती है, फिर कोड अधीनस्थ async मशीनरी को रद्द करता है (शेल के लिए: Tokio टोकन रद्द करता है, 2 सेकंड तक प्रतीक्षा करता है, फिर टास्क abort करता है)।

## लंबे समय तक चलने वाले लूप्स के लिए Heartbeat अपेक्षाएँ

`heartbeat()` को असीमित या बड़े कार्य सेट वाले लूप्स में अनुमानित गति से चलना चाहिए।

देखे गए पैटर्न:

- `glob::filter_entries`: फ़िल्टरिंग/मैचिंग से पहले प्रत्येक प्रविष्टि की जाँच।
- `fd::score_entries`: प्रत्येक स्कैन किए गए उम्मीदवार की जाँच।
- `grep_sync`: भारी खोज चरण से पहले स्पष्ट रद्दीकरण जाँच, साथ ही fs-cache कॉल्स जो टोकन भी प्राप्त करते हैं।
- `run_pty_sync`: प्रत्येक लूप टिक (~16ms स्लीप केडेंस) पर जाँच और रद्दीकरण पर चाइल्ड प्रक्रिया को kill करना।

व्यावहारिक नियम: बाहरी-आकार के इनपुट पर कोई भी लूप heartbeat के बिना एक छोटे सीमित अंतराल से अधिक नहीं होना चाहिए।

## विफलता व्यवहार और JS में त्रुटि प्रसार

### ब्लॉकिंग टास्क

त्रुटि पथ:

1. क्लोज़र `Err(napi::Error)` लौटाता है (`heartbeat()` abort सहित)।
2. `Task::compute()` `Err` लौटाता है।
3. `AsyncTask` JS प्रॉमिस को reject करता है।

सामान्य त्रुटि स्ट्रिंग्स:

- `Aborted: Timeout`
- `Aborted: Signal`
- डोमेन त्रुटियाँ (`Failed to decode image: ...`, `Conversion error: ...`, आदि)

### Future टास्क

त्रुटि पथ:

1. Async बॉडी `Err(napi::Error)` लौटाती है या join विफलता को मैप किया जाता है (`... task failed: {err}`)।
2. `task::future`-स्पॉन किया गया प्रॉमिस reject होता है।
3. कुछ APIs जानबूझकर rejection के बजाय संरचित रद्दीकरण परिणाम लौटाते हैं (`ShellRunResult`/`ShellExecuteResult` जिसमें `cancelled`/`timed_out` फ्लैग्स और `exit_code: None` होते हैं)।

### रद्दीकरण रिपोर्टिंग विभाजन

- **त्रुटि के रूप में Abort**: अधिकांश ब्लॉकिंग एक्सपोर्ट्स जो `heartbeat()?` का उपयोग करते हैं।
- **टाइप्ड परिणाम के रूप में Abort**: शेल/pty शैली कमांड APIs जो रद्दीकरण को रिजल्ट स्ट्रक्ट्स में मॉडल करते हैं।

प्रति API एक मॉडल चुनें और इसे स्पष्ट रूप से प्रलेखित करें।

## सामान्य गलतियाँ

1. **ब्लॉकिंग लूप्स में heartbeat का अभाव**
   - लक्षण: timeout/signal लूप समाप्त होने तक अनदेखा प्रतीत होता है।
   - समाधान: लूप के शीर्ष पर और प्रत्येक आइटम के महंगे चरणों से पहले `ct.heartbeat()?` जोड़ें।

2. **लंबे अ-रद्दीकरणयोग्य अनुभाग**
   - लक्षण: एकल बड़े कॉल (decode, sort, compression, आदि) के दौरान रद्दीकरण विलंबता बढ़ जाती है।
   - समाधान: कार्य को heartbeat सीमाओं के साथ खंडों में विभाजित करें; यदि असंभव हो, तो विलंबता प्रलेखित करें।

3. **Async executor को ब्लॉक करना**
   - लक्षण: जब sync-भारी कोड सीधे future में चलता है तो async API रुक जाता है।
   - समाधान: CPU/sync ब्लॉक्स को `task::blocking` या `tokio::task::spawn_blocking` में स्थानांतरित करें।

4. **असंगत रद्दीकरण सिमेंटिक्स**
   - लक्षण: एक API रद्दीकरण पर reject करता है, दूसरा फ्लैग्स के साथ resolve करता है, जो कॉलर्स को भ्रमित करता है।
   - समाधान: प्रति डोमेन मानकीकृत करें और रैपर डॉक्स को संरेखित रखें।

5. **नेस्टेड async टास्क में रद्दीकरण ब्रिज भूलना**
   - लक्षण: बाहरी टोकन रद्द हो गया है लेकिन आंतरिक रीडर्स/subprocess टास्क चलते रहते हैं।
   - समाधान: रद्दीकरण को आंतरिक टोकन/signal तक ब्रिज करें और ग्रेस टाइमआउट + बलपूर्वक abort फ़ॉलबैक लागू करें।

## नए रद्दीकरणयोग्य एक्सपोर्ट्स के लिए चेकलिस्ट

1. कार्य को सही ढंग से वर्गीकृत करें:
   - CPU-बाउंड या sync ब्लॉकिंग -> `task::blocking`
   - async I/O / `await` ऑर्केस्ट्रेशन -> `task::future`

2. आवश्यकता होने पर रद्दीकरण इनपुट्स एक्सपोज़ करें:
   - `#[napi(object)]` विकल्पों में `timeoutMs` और `signal` शामिल करें
   - `let ct = task::CancelToken::new(timeout_ms, signal);` बनाएँ

3. सभी परतों में रद्दीकरण को वायर करें:
   - ब्लॉकिंग लूप्स: स्थिर अंतराल पर `ct.heartbeat()?`
   - async ऑर्केस्ट्रेशन: `ct.wait()` के साथ रेस करें और उप-टास्क/टोकन रद्द करें

4. रद्दीकरण अनुबंध तय करें:
   - abort त्रुटि के साथ प्रॉमिस reject करें, या
   - टाइप्ड `{ cancelled, timedOut, ... }` resolve करें
   - इस अनुबंध को API परिवार के लिए संगत रखें

5. संदर्भ के साथ विफलताएँ प्रसारित करें:
   - `Error::from_reason(format!("...: {err}"))` के माध्यम से त्रुटियाँ मैप करें
   - चरण-विशिष्ट उपसर्ग शामिल करें (`spawn`, `decode`, `wait`, आदि)

6. प्रारंभ-पूर्व और मध्य-उड़ान रद्दीकरण संभालें:
   - महंगे बॉडी से पहले और लंबे निष्पादन के दौरान रद्दीकरण जाँच/await होनी चाहिए

7. सत्यापित करें कि executor का दुरुपयोग नहीं हो रहा:
   - `spawn_blocking`/blocking task wrapper के बिना async futures के अंदर सीधे लंबा sync कार्य नहीं होना चाहिए
