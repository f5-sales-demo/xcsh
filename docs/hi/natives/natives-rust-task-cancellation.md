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

यह दस्तावेज़ वर्णन करता है कि `crates/pi-natives` नेटिव कार्य को कैसे शेड्यूल करता है और रद्दीकरण JS विकल्पों (`timeoutMs`, `AbortSignal`) से Rust निष्पादन तक कैसे प्रवाहित होता है।

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

`task.rs` तीन मुख्य घटकों को परिभाषित करता है:

1. `task::blocking(tag, cancel_token, work)`
   - `napi::AsyncTask` / `Task` को रैप करता है।
   - `compute()` libuv वर्कर थ्रेड्स पर चलता है (CPU-बाउंड या ब्लॉकिंग/सिंक सिस्टम कॉल्स के लिए)।
   - एक JS `Promise<T>` लौटाता है।

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)` को रैप करता है।
   - Tokio रनटाइम पर async कार्य चलाता है।
   - `PromiseRaw<'env, T>` लौटाता है।

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` डेडलाइन + वैकल्पिक `AbortSignal` को संयोजित करता है।
   - `CancelToken::heartbeat()` ब्लॉकिंग लूप्स के लिए सहकारी रद्दीकरण है।
   - `CancelToken::wait()` async रद्दीकरण प्रतीक्षा है (`Signal` / `Timeout` / `User` Ctrl-C)।
   - `AbortToken` बाहरी कोड को abort अनुरोध करने देता है (`abort(reason)`)।

## `blocking` बनाम `future`: निष्पादन मॉडल और चयन

### `task::blocking` का उपयोग करें

जब कार्य CPU-भारी या मूल रूप से सिंक्रोनस/ब्लॉकिंग हो तब उपयोग करें:

- regex/फ़ाइल स्कैनिंग (`grep`, `glob`, `fuzzy_find`)
- सिंक्रोनस PTY लूप आंतरिक (`run_pty_sync` `spawn_blocking` के माध्यम से)
- क्लिपबोर्ड/इमेज/html रूपांतरण

व्यवहार:

- वर्क क्लोज़र एक क्लोन किया हुआ `CancelToken` प्राप्त करता है।
- रद्दीकरण केवल वहाँ देखा जाता है जहाँ कोड `ct.heartbeat()?` की जाँच करता है।
- क्लोज़र `Err(...)` JS प्रॉमिस को रिजेक्ट करता है।

### `task::future` का उपयोग करें

जब कार्य को async ऑपरेशन `await` करने हों तब उपयोग करें:

- शेल सेशन ऑर्केस्ट्रेशन (`shell.run`, `executeShell`)
- पूर्णता और रद्दीकरण के बीच टास्क रेसिंग (`tokio::select!`)

व्यवहार:

- Future सामान्य पूर्णता को `ct.wait()` के विरुद्ध रेस कर सकता है।
- रद्दीकरण पथ पर, async कार्यान्वयन आमतौर पर रद्दीकरण को आंतरिक उपप्रणालियों में प्रसारित करते हैं (जैसे, `tokio_util::CancellationToken`) और वैकल्पिक रूप से ग्रेस टाइमआउट पर बलपूर्वक abort करते हैं।

## JS API ↔ Rust एक्सपोर्ट मैपिंग (टास्क/रद्दीकरण संबंधित)

| JS-फेसिंग API | Rust एक्सपोर्ट (`#[napi]`) | शेड्यूलर | रद्दीकरण हुकअप |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + फ़िल्टर लूप में `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + स्कोरिंग लूप में `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` रन टास्क के विरुद्ध रेस; Tokio `CancellationToken` से ब्रिज |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | ऊपर के समान |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + आंतरिक `spawn_blocking` | सिंक PTY लूप में `heartbeat()` के माध्यम से `CancelToken` जाँच |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | कोई नहीं (`()` टोकन) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | कोई नहीं (`()` टोकन) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | कोई नहीं (`()` टोकन) |

`text.rs` और `ps.rs` वर्तमान में `task::blocking`/`task::future` का उपयोग नहीं करते हैं और इसलिए इस रद्दीकरण पथ में भाग नहीं लेते हैं।

## रद्दीकरण जीवनचक्र और स्थिति संक्रमण

### `CancelToken` जीवनचक्र

`CancelToken` सहकारी और स्थिति-युक्त है:

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

### प्रारंभ-पूर्व बनाम मध्य-निष्पादन रद्दीकरण

- **प्रारंभ से पहले / पहली रद्दीकरण जाँच से पहले**:
  - `task::future` उपयोगकर्ता जो `ct.wait()` पर रेस करते हैं, `select!` में प्रवेश करते ही तुरंत रद्दीकरण हल कर सकते हैं।
  - `task::blocking` उपयोगकर्ता रद्दीकरण केवल तब देखते हैं जब क्लोज़र कोड `heartbeat()` तक पहुँचता है। यदि क्लोज़र जल्दी heartbeat नहीं करता, तो रद्दीकरण में देरी होती है।

- **मध्य-निष्पादन**:
  - `blocking`: अगला `heartbeat()` `Err("Aborted: ...")` लौटाता है।
  - `future`: `ct.wait()` शाखा `select!` जीतती है, फिर कोड अधीनस्थ async मशीनरी को रद्द करता है (शेल के लिए: Tokio टोकन रद्द करता है, 2 सेकंड तक प्रतीक्षा करता है, फिर टास्क को abort करता है)।

## लंबे समय तक चलने वाले लूप्स के लिए हार्टबीट अपेक्षाएँ

`heartbeat()` को अनबाउंडेड या बड़े वर्क सेट वाले लूप्स में अनुमानित ताल पर चलना चाहिए।

देखे गए पैटर्न:

- `glob::filter_entries`: फ़िल्टरिंग/मैचिंग से पहले प्रत्येक प्रविष्टि की जाँच।
- `fd::score_entries`: प्रत्येक स्कैन किए गए उम्मीदवार की जाँच।
- `grep_sync`: भारी खोज चरण से पहले स्पष्ट रद्दीकरण जाँच, साथ ही fs-cache कॉल्स जो टोकन भी प्राप्त करती हैं।
- `run_pty_sync`: प्रत्येक लूप टिक (~16ms स्लीप ताल) पर जाँच और रद्दीकरण पर चाइल्ड को kill करना।

व्यावहारिक नियम: बाहरी-आकार के इनपुट पर कोई भी लूप बिना heartbeat के एक छोटे बाउंडेड अंतराल से अधिक नहीं होना चाहिए।

## विफलता व्यवहार और JS को त्रुटि प्रसारण

### ब्लॉकिंग टास्क

त्रुटि पथ:

1. क्लोज़र `Err(napi::Error)` लौटाता है (`heartbeat()` abort सहित)।
2. `Task::compute()` `Err` लौटाता है।
3. `AsyncTask` JS प्रॉमिस को रिजेक्ट करता है।

सामान्य त्रुटि स्ट्रिंग्स:

- `Aborted: Timeout`
- `Aborted: Signal`
- डोमेन त्रुटियाँ (`Failed to decode image: ...`, `Conversion error: ...`, आदि)

### Future टास्क

त्रुटि पथ:

1. Async बॉडी `Err(napi::Error)` लौटाती है या join विफलता मैप की जाती है (`... task failed: {err}`)।
2. `task::future`-स्पॉन्ड प्रॉमिस रिजेक्ट होता है।
3. कुछ API जानबूझकर रिजेक्शन के बजाय संरचित रद्दीकरण परिणाम लौटाते हैं (`ShellRunResult`/`ShellExecuteResult` जिसमें `cancelled`/`timed_out` फ्लैग और `exit_code: None`)।

### रद्दीकरण रिपोर्टिंग विभाजन

- **त्रुटि के रूप में Abort**: अधिकांश ब्लॉकिंग एक्सपोर्ट जो `heartbeat()?` का उपयोग करते हैं।
- **टाइप्ड परिणाम के रूप में Abort**: शेल/pty शैली कमांड API जो परिणाम संरचनाओं में रद्दीकरण मॉडल करते हैं।

प्रति API एक मॉडल चुनें और इसे स्पष्ट रूप से दस्तावेज़ित करें।

## सामान्य समस्याएँ

1. **ब्लॉकिंग लूप्स में हार्टबीट का अभाव**
   - लक्षण: टाइमआउट/सिग्नल लूप समाप्त होने तक अनदेखा प्रतीत होता है।
   - समाधान: लूप के शीर्ष पर और महँगे प्रति-आइटम चरणों से पहले `ct.heartbeat()?` जोड़ें।

2. **लंबे अरद्दनीय खंड**
   - लक्षण: एकल बड़ी कॉल (डिकोड, सॉर्ट, संपीड़न, आदि) के दौरान रद्दीकरण विलंबता में उछाल।
   - समाधान: कार्य को heartbeat सीमाओं के साथ खंडों में विभाजित करें; यदि असंभव हो, तो विलंबता दस्तावेज़ित करें।

3. **Async एक्ज़ीक्यूटर को ब्लॉक करना**
   - लक्षण: जब सिंक-भारी कोड सीधे future में चलता है तो async API रुक जाता है।
   - समाधान: CPU/सिंक ब्लॉक्स को `task::blocking` या `tokio::task::spawn_blocking` में स्थानांतरित करें।

4. **असंगत रद्दीकरण सिमेंटिक्स**
   - लक्षण: एक API रद्दीकरण पर रिजेक्ट करता है, दूसरा फ्लैग्स के साथ resolve करता है, कॉलर्स को भ्रमित करता है।
   - समाधान: प्रति डोमेन मानकीकृत करें और रैपर दस्तावेज़ों को संरेखित रखें।

5. **नेस्टेड async टास्क में रद्दीकरण ब्रिज भूलना**
   - लक्षण: बाहरी टोकन रद्द है लेकिन आंतरिक रीडर्स/सबप्रोसेस टास्क चलते रहते हैं।
   - समाधान: रद्दीकरण को आंतरिक टोकन/सिग्नल से ब्रिज करें और ग्रेस टाइमआउट + बलपूर्वक abort फ़ॉलबैक लागू करें।

## नए रद्दनीय एक्सपोर्ट के लिए चेकलिस्ट

1. कार्य को सही ढंग से वर्गीकृत करें:
   - CPU-बाउंड या सिंक ब्लॉकिंग -> `task::blocking`
   - async I/O / `await` ऑर्केस्ट्रेशन -> `task::future`

2. आवश्यकता होने पर रद्दीकरण इनपुट उजागर करें:
   - `#[napi(object)]` विकल्पों में `timeoutMs` और `signal` शामिल करें
   - `let ct = task::CancelToken::new(timeout_ms, signal);` बनाएँ

3. सभी परतों के माध्यम से रद्दीकरण वायर करें:
   - ब्लॉकिंग लूप्स: स्थिर अंतराल पर `ct.heartbeat()?`
   - async ऑर्केस्ट्रेशन: `ct.wait()` के साथ रेस करें और उप-टास्क/टोकन रद्द करें

4. रद्दीकरण अनुबंध तय करें:
   - abort त्रुटि के साथ प्रॉमिस रिजेक्ट करें, या
   - टाइप्ड `{ cancelled, timedOut, ... }` resolve करें
   - इस अनुबंध को API परिवार के लिए सुसंगत रखें

5. संदर्भ के साथ विफलताएँ प्रसारित करें:
   - `Error::from_reason(format!("...: {err}"))` के माध्यम से त्रुटियाँ मैप करें
   - चरण-विशिष्ट उपसर्ग शामिल करें (`spawn`, `decode`, `wait`, आदि)

6. प्रारंभ-पूर्व और मध्य-उड़ान रद्दीकरण संभालें:
   - रद्दीकरण जाँच/await महँगी बॉडी से पहले और लंबे निष्पादन के दौरान होनी चाहिए

7. सत्यापित करें कि कोई एक्ज़ीक्यूटर दुरुपयोग नहीं है:
   - `spawn_blocking`/ब्लॉकिंग टास्क रैपर के बिना async futures के अंदर सीधे कोई लंबा सिंक कार्य नहीं
