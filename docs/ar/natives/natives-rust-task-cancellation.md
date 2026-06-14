---
title: تنفيذ مهام Rust الأصلية وإلغاؤها
description: نموذج تنفيذ المهام غير المتزامنة في Rust مع دلالات الإلغاء التعاوني والتنظيف.
sidebar:
  order: 5
  label: إلغاء المهام
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# تنفيذ مهام Rust الأصلية وإلغاؤها (`pi-natives`)

يصف هذا المستند كيفية جدولة `crates/pi-natives` للعمل الأصلي، وكيفية تدفق الإلغاء من خيارات JS (`timeoutMs`، `AbortSignal`) إلى تنفيذ Rust.

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

## العناصر الأساسية (`task.rs`)

يُعرّف `task.rs` ثلاثة عناصر أساسية:

1. `task::blocking(tag, cancel_token, work)`
   - يُغلّف `napi::AsyncTask` / `Task`.
   - يعمل `compute()` على خيوط عمل libuv (للعمليات المكثفة بالمعالج أو استدعاءات النظام المتزامنة/المحجوبة).
   - يُعيد `Promise<T>` في JS.

2. `task::future(env, tag, work)`
   - يُغلّف `env.spawn_future(...)`.
   - يُشغّل العمل غير المتزامن على وقت تشغيل Tokio.
   - يُعيد `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - يُجمع `CancelToken::new(timeout_ms, signal)` الموعد النهائي مع `AbortSignal` الاختياري.
   - `CancelToken::heartbeat()` هو إلغاء تعاوني للحلقات المحجوبة.
   - `CancelToken::wait()` هو انتظار إلغاء غير متزامن (`Signal` / `Timeout` / `User` Ctrl-C).
   - يُتيح `AbortToken` للشفرة الخارجية طلب الإجهاض (`abort(reason)`).

## `blocking` مقابل `future`: نموذج التنفيذ والاختيار

### استخدام `task::blocking`

استخدمه عندما يكون العمل مكثفاً بالمعالج أو متزامناً/محجوباً بطبيعته:

- فحص regex/الملفات (`grep`، `glob`، `fuzzy_find`)
- الحلقات الداخلية المتزامنة لـ PTY (`run_pty_sync` عبر `spawn_blocking`)
- تحويلات الحافظة/الصورة/HTML

السلوك:

- يستقبل مغلق العمل نسخة مستنسخة من `CancelToken`.
- لا يُلاحَظ الإلغاء إلا عند فحص الشفرة لـ `ct.heartbeat()?`.
- يرفض `Err(...)` من المغلق وعد JS.

### استخدام `task::future`

استخدمه عندما يتعين على العمل `await` عمليات غير متزامنة:

- تنسيق جلسة shell (`shell.run`، `executeShell`)
- تسابق المهام (`tokio::select!`) بين الاكتمال والإلغاء

السلوك:

- يمكن للمستقبل التسابق بين الاكتمال الطبيعي و`ct.wait()`.
- في مسار الإلغاء، تُوصّل التطبيقات غير المتزامنة الإلغاء عادةً إلى الأنظمة الفرعية الداخلية (مثل `tokio_util::CancellationToken`) وتُجبر على الإجهاض اختيارياً عند انقضاء مهلة السماح.

## تعيين JS API ↔ صادرات Rust (ذو صلة بالمهام/الإلغاء)

| JS API الظاهر | صادرات Rust (`#[napi]`) | المُجدوِل | ربط الإلغاء |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة الفلترة |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة التسجيل |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` يتسابق مع مهمة التشغيل؛ يجسّر إلى Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | مثل ما سبق |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` داخلي | يُفحص `CancelToken` في حلقة PTY المتزامنة عبر `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | لا يوجد (رمز `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | لا يوجد (رمز `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | لا يوجد (رمز `()`) |

لا تستخدم `text.rs` و`ps.rs` حالياً `task::blocking`/`task::future`، وبالتالي لا تشارك في مسار الإلغاء هذا.

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

### الإلغاء قبل البدء مقابل الإلغاء أثناء التنفيذ

- **قبل البدء / قبل أول فحص للإلغاء**:
  - يمكن لمستخدمي `task::future` الذين يتسابقون على `ct.wait()` حل الإلغاء فوراً بمجرد دخولهم `select!`.
  - لا يُلاحظ مستخدمو `task::blocking` الإلغاء إلا عندما تصل شفرة المغلق إلى `heartbeat()`. إذا لم يضرب المغلق نبضات قلب مبكرة، يتأخر الإلغاء.

- **أثناء التنفيذ**:
  - `blocking`: يُعيد `heartbeat()` التالي `Err("Aborted: ...")`.
  - `future`: يفوز فرع `ct.wait()` في `select!`، ثم تُلغي الشفرة الآلية غير المتزامنة التابعة (لـ shell: تُلغي رمز Tokio، تنتظر حتى ثانيتين، ثم تُجهض المهمة).

## توقعات نبضات القلب للحلقات طويلة الأمد

يجب أن تعمل `heartbeat()` بإيقاع منتظم في الحلقات ذات مجموعات العمل غير المحدودة أو الكبيرة.

الأنماط الملاحظة:

- `glob::filter_entries`: فحص كل إدخال قبل الفلترة/المطابقة.
- `fd::score_entries`: فحص كل مرشح ممسوح.
- `grep_sync`: فحص إلغاء صريح قبل مرحلة البحث المكثفة، بالإضافة إلى استدعاءات fs-cache التي تستقبل الرمز أيضاً.
- `run_pty_sync`: فحص كل دورة في الحلقة (إيقاع سكون ~16 مللي ثانية) وإنهاء العملية الفرعية عند الإلغاء.

القاعدة العملية: لا يجب أن تتجاوز أي حلقة على مدخلات ذات حجم خارجي فترة زمنية قصيرة محدودة دون نبضة قلب.

## سلوك الفشل وانتشار الخطأ إلى JS

### المهام المحجوبة

مسار الخطأ:

1. يُعيد المغلق `Err(napi::Error)` (بما في ذلك إجهاض `heartbeat()`).
2. يُعيد `Task::compute()` القيمة `Err`.
3. يرفض `AsyncTask` وعد JS.

سلاسل الخطأ النموذجية:

- `Aborted: Timeout`
- `Aborted: Signal`
- أخطاء نطاقية (`Failed to decode image: ...`، `Conversion error: ...`، إلخ)

### المهام المستقبلية

مسار الخطأ:

1. يُعيد جسم async القيمة `Err(napi::Error)` أو يُعيَّن فشل الانضمام (`... task failed: {err}`).
2. يرفض الوعد المُطلق عبر `task::future`.
3. تُعيد بعض واجهات API عمداً نتائج إلغاء منظّمة بدلاً من الرفض (`ShellRunResult`/`ShellExecuteResult` مع إشارات `cancelled`/`timed_out` و`exit_code: None`).

### تقسيم إبلاغ الإلغاء

- **الإجهاض كخطأ**: معظم الصادرات المحجوبة التي تستخدم `heartbeat()?`.
- **الإجهاض كنتيجة مكتوبة**: واجهات API أوامر نمط shell/pty التي تُنمذج الإلغاء في هياكل النتائج.

اختر نموذجاً واحداً لكل واجهة API ووثّقه صراحةً.

## الأخطاء الشائعة

1. **نبضات قلب مفقودة في حلقات محجوبة**
   - الأعراض: يبدو أن المهلة/الإشارة يُتجاهلان حتى تنتهي الحلقة.
   - الحل: أضف `ct.heartbeat()?` في أعلى الحلقة وقبل الخطوات المكثفة لكل عنصر.

2. **أقسام طويلة غير قابلة للإلغاء**
   - الأعراض: ارتفاع زمن استجابة الإلغاء أثناء استدعاء كبير واحد (فك تشفير، فرز، ضغط، إلخ).
   - الحل: قسّم العمل إلى أجزاء بحدود نبضات قلب؛ إذا كان مستحيلاً، وثّق زمن الاستجابة.

3. **إعاقة منفّذ async**
   - الأعراض: تتوقف واجهة API غير المتزامنة عند تشغيل شفرة مكثفة بالمعالج مباشرةً في المستقبل.
   - الحل: انقل كتل المعالج/المتزامنة إلى `task::blocking` أو `tokio::task::spawn_blocking`.

4. **دلالات إلغاء غير متسقة**
   - الأعراض: ترفض إحدى واجهات API عند الإلغاء، وتحل أخرى مع إشارات، مما يُربك المستخدمين.
   - الحل: قوّم لكل نطاق واحتفظ بتوثيق المغلف متوافقاً.

5. **نسيان جسر الإلغاء في المهام غير المتزامنة المتداخلة**
   - الأعراض: يُلغى الرمز الخارجي لكن القرّاء الداخليون/مهام العمليات الفرعية تواصل العمل.
   - الحل: جسّر الإلغاء إلى الرمز/الإشارة الداخلية وفرض مهلة سماح + احتياطي إجهاض قسري.

## قائمة التحقق للصادرات القابلة للإلغاء الجديدة

1. صنّف العمل بشكل صحيح:
   - مكثف بالمعالج أو محجوب بالمزامنة -> `task::blocking`
   - إدخال/إخراج async / تنسيق `await` -> `task::future`

2. اعرض مدخلات الإلغاء عند الحاجة:
   - أدرج `timeoutMs` و`signal` في خيارات `#[napi(object)]`
   - أنشئ `let ct = task::CancelToken::new(timeout_ms, signal);`

3. مرّر الإلغاء عبر جميع الطبقات:
   - حلقات محجوبة: `ct.heartbeat()?` على فترات ثابتة
   - تنسيق async: تسابق مع `ct.wait()` وإلغاء المهام/الرموز الفرعية

4. حدد عقد الإلغاء:
   - رفض الوعد بخطأ إجهاض، أو
   - حل `{ cancelled, timedOut, ... }` مكتوب
   - احتفظ بهذا العقد متسقاً لعائلة API

5. انشر الأخطاء مع السياق:
   - عيّن الأخطاء عبر `Error::from_reason(format!("...: {err}"))`
   - أدرج بادئات خاصة بالمرحلة (`spawn`، `decode`، `wait`، إلخ)

6. تعامل مع الإلغاء قبل البدء وأثناء التنفيذ:
   - يجب أن يحدث فحص/انتظار الإلغاء قبل الجسم المكثف وأثناء التنفيذ الطويل

7. تحقق من عدم إساءة استخدام المنفّذ:
   - لا عمل مكثف بالمزامنة مباشرةً داخل مستقبلات async دون `spawn_blocking`/مغلف مهمة محجوبة
