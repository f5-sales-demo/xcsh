---
title: Native Rust Task Execution and Cancellation
description: >-
  Rust async task execution model with cooperative cancellation and cleanup
  semantics.
sidebar:
  order: 5
  label: إلغاء المهام
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# تنفيذ وإلغاء المهام الأصلية في Rust (`pi-natives`)

يصف هذا المستند كيف يقوم `crates/pi-natives` بجدولة العمل الأصلي وكيف ينتقل الإلغاء من خيارات JS (`timeoutMs`، `AbortSignal`) إلى تنفيذ Rust.

## ملفات التنفيذ

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

## الأساسيات الجوهرية (`task.rs`)

يُعرِّف `task.rs` ثلاثة عناصر أساسية:

1. `task::blocking(tag, cancel_token, work)`
   - يغلّف `napi::AsyncTask` / `Task`.
   - تعمل `compute()` على خيوط عمل libuv (للعمليات المكثفة لوحدة المعالجة أو استدعاءات النظام المتزامنة/الحاجبة).
   - يُرجع `Promise<T>` في JS.

2. `task::future(env, tag, work)`
   - يغلّف `env.spawn_future(...)`.
   - يُنفّذ العمل غير المتزامن على بيئة تشغيل Tokio.
   - يُرجع `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` يجمع بين الموعد النهائي و`AbortSignal` الاختياري.
   - `CancelToken::heartbeat()` هو إلغاء تعاوني للحلقات الحاجبة.
   - `CancelToken::wait()` هو انتظار إلغاء غير متزامن (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` يتيح للكود الخارجي طلب الإيقاف (`abort(reason)`).

## `blocking` مقابل `future`: نموذج التنفيذ والاختيار

### استخدم `task::blocking`

يُستخدم عندما يكون العمل مكثفاً لوحدة المعالجة أو متزامناً/حاجباً بطبيعته:

- مسح الملفات بالتعابير النمطية (`grep`، `glob`، `fuzzy_find`)
- الأجزاء الداخلية لحلقة PTY المتزامنة (`run_pty_sync` عبر `spawn_blocking`)
- تحويلات الحافظة/الصور/HTML

السلوك:

- يستقبل الإغلاق نسخة مستنسخة من `CancelToken`.
- يُلاحَظ الإلغاء فقط حيث يتحقق الكود من `ct.heartbeat()?`.
- `Err(...)` في الإغلاق يرفض وعد JS.

### استخدم `task::future`

يُستخدم عندما يجب على العمل انتظار (`await`) عمليات غير متزامنة:

- تنظيم جلسات الصدفة (`shell.run`، `executeShell`)
- التسابق بين المهام (`tokio::select!`) بين الإكمال والإلغاء

السلوك:

- يمكن للمستقبل (Future) التسابق بين الإكمال الطبيعي و`ct.wait()`.
- في مسار الإلغاء، تنشر التنفيذات غير المتزامنة عادةً الإلغاء إلى الأنظمة الفرعية الداخلية (مثل `tokio_util::CancellationToken`) وتفرض اختيارياً الإيقاف القسري عند انتهاء مهلة السماح.

## ربط واجهة JS ↔ تصدير Rust (المتعلق بالمهام/الإلغاء)

| واجهة JS | تصدير Rust (`#[napi]`) | المُجدوِل | ربط الإلغاء |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة التصفية |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة التقييم |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` يتسابق مع مهمة التشغيل؛ يربط مع `CancellationToken` في Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | نفس ما سبق |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` داخلي | `CancelToken` يُفحص في حلقة PTY المتزامنة عبر `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | لا يوجد (رمز `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | لا يوجد (رمز `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | لا يوجد (رمز `()`) |

`text.rs` و`ps.rs` حالياً لا يستخدمان `task::blocking`/`task::future` وبالتالي لا يشاركان في مسار الإلغاء هذا.

## دورة حياة الإلغاء وانتقالات الحالة

### دورة حياة `CancelToken`

`CancelToken` تعاوني وذو حالة:

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

### الإلغاء قبل البدء مقابل أثناء التنفيذ

- **قبل البدء / قبل أول فحص إلغاء**:
  - مستخدمو `task::future` الذين يتسابقون على `ct.wait()` يمكنهم حل الإلغاء فوراً بمجرد دخولهم `select!`.
  - مستخدمو `task::blocking` يلاحظون الإلغاء فقط عندما يصل كود الإغلاق إلى `heartbeat()`. إذا لم يقم الإغلاق بفحص النبض مبكراً، يتأخر الإلغاء.

- **أثناء التنفيذ**:
  - `blocking`: فحص `heartbeat()` التالي يُرجع `Err("Aborted: ...")`.
  - `future`: فرع `ct.wait()` يفوز في `select!`، ثم يُلغي الكود الآلية غير المتزامنة التابعة (للصدفة: يُلغي رمز Tokio، وينتظر حتى ثانيتين، ثم يوقف المهمة قسرياً).

## توقعات النبض للحلقات طويلة التشغيل

يجب أن يعمل `heartbeat()` بوتيرة متوقعة في الحلقات ذات مجموعات العمل غير المحدودة أو الكبيرة.

الأنماط الملاحظة:

- `glob::filter_entries`: فحص كل إدخال قبل التصفية/المطابقة.
- `fd::score_entries`: فحص كل مرشح ممسوح.
- `grep_sync`: فحص إلغاء صريح قبل مرحلة البحث المكثفة، بالإضافة إلى استدعاءات ذاكرة التخزين المؤقت لنظام الملفات التي تستقبل الرمز أيضاً.
- `run_pty_sync`: فحص كل دورة حلقة (وتيرة سكون ~16 مللي ثانية) وإنهاء العملية الفرعية عند الإلغاء.

القاعدة العملية: لا ينبغي لأي حلقة على مدخلات ذات حجم خارجي أن تتجاوز فترة قصيرة محدودة دون فحص نبض.

## سلوك الفشل وتوصيل الأخطاء إلى JS

### المهام الحاجبة

مسار الخطأ:

1. يُرجع الإغلاق `Err(napi::Error)` (بما في ذلك إيقاف `heartbeat()`).
2. تُرجع `Task::compute()` `Err`.
3. `AsyncTask` يرفض وعد JS.

نصوص الخطأ النموذجية:

- `Aborted: Timeout`
- `Aborted: Signal`
- أخطاء النطاق (`Failed to decode image: ...`، `Conversion error: ...`، إلخ.)

### مهام المستقبل (Future)

مسار الخطأ:

1. يُرجع الجسم غير المتزامن `Err(napi::Error)` أو يُعيَّن فشل الضم (`... task failed: {err}`).
2. يُرفض الوعد المُنشأ بواسطة `task::future`.
3. بعض الواجهات تُرجع عمداً نتائج إلغاء مُهيكلة بدلاً من الرفض (`ShellRunResult`/`ShellExecuteResult` مع علامات `cancelled`/`timed_out` و`exit_code: None`).

### تقسيم الإبلاغ عن الإلغاء

- **الإيقاف كخطأ**: معظم التصديرات الحاجبة التي تستخدم `heartbeat()?`.
- **الإيقاف كنتيجة مُنمَّطة**: واجهات أوامر نمط الصدفة/PTY التي تُنمذج الإلغاء في هياكل النتائج.

اختر نموذجاً واحداً لكل واجهة ووثّقه بشكل صريح.

## المزالق الشائعة

1. **نبض مفقود في الحلقات الحاجبة**
   - العَرَض: يبدو أن المهلة/الإشارة يتم تجاهلها حتى تنتهي الحلقة.
   - الحل: أضف `ct.heartbeat()?` في أعلى الحلقة وقبل الخطوات المكلفة لكل عنصر.

2. **أقسام طويلة غير قابلة للإلغاء**
   - العَرَض: ارتفاعات مفاجئة في زمن الإلغاء أثناء استدعاء كبير واحد (فك تشفير، فرز، ضغط، إلخ.).
   - الحل: قسّم العمل إلى أجزاء مع حدود نبض؛ إذا كان ذلك مستحيلاً، وثّق الزمن المتوقع.

3. **حجب المُنفِّذ غير المتزامن**
   - العَرَض: توقف الواجهة غير المتزامنة عندما يعمل كود مكثف متزامنياً مباشرة في المستقبل.
   - الحل: انقل الكتل المتزامنة/المكثفة لوحدة المعالجة إلى `task::blocking` أو `tokio::task::spawn_blocking`.

4. **دلالات إلغاء غير متسقة**
   - العَرَض: واجهة ترفض عند الإلغاء وأخرى تحل مع علامات، مما يربك المستدعين.
   - الحل: وحّد المعايير لكل نطاق وحافظ على توافق وثائق المغلّف.

5. **نسيان جسر الإلغاء في المهام غير المتزامنة المتداخلة**
   - العَرَض: يُلغى الرمز الخارجي لكن القارئات الداخلية/مهام العمليات الفرعية تستمر في العمل.
   - الحل: اربط الإلغاء بالرمز/الإشارة الداخلية وافرض مهلة سماح + آلية إيقاف قسري احتياطية.

## قائمة مراجعة للتصديرات الجديدة القابلة للإلغاء

1. صنّف العمل بشكل صحيح:
   - مكثف لوحدة المعالجة أو حاجب متزامن -> `task::blocking`
   - إدخال/إخراج غير متزامن / تنظيم `await` -> `task::future`

2. اكشف مدخلات الإلغاء عند الحاجة:
   - ضمّن `timeoutMs` و`signal` في خيارات `#[napi(object)]`
   - أنشئ `let ct = task::CancelToken::new(timeout_ms, signal);`

3. مرّر الإلغاء عبر جميع الطبقات:
   - الحلقات الحاجبة: `ct.heartbeat()?` بفترات منتظمة
   - التنظيم غير المتزامن: تسابق مع `ct.wait()` وألغِ المهام/الرموز الفرعية

4. حدّد عقد الإلغاء:
   - ارفض الوعد بخطأ إيقاف، أو
   - حُل بنتيجة مُنمَّطة `{ cancelled, timedOut, ... }`
   - حافظ على اتساق هذا العقد لعائلة الواجهة

5. أوصل الأخطاء مع السياق:
   - عيّن الأخطاء عبر `Error::from_reason(format!("...: {err}"))`
   - ضمّن بادئات خاصة بالمرحلة (`spawn`، `decode`، `wait`، إلخ.)

6. تعامل مع الإلغاء قبل البدء وأثناء التنفيذ:
   - يجب أن يحدث فحص/انتظار الإلغاء قبل الجسم المكلف وأثناء التنفيذ الطويل

7. تحقق من عدم إساءة استخدام المُنفِّذ:
   - لا يوجد عمل متزامن طويل مباشرة داخل المستقبلات غير المتزامنة بدون `spawn_blocking`/مغلّف مهمة حاجبة
