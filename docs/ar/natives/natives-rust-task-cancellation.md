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

# تنفيذ المهام الأصلية في Rust وإلغاؤها (`pi-natives`)

يصف هذا المستند كيف يقوم `crates/pi-natives` بجدولة العمل الأصلي وكيف يتدفق الإلغاء من خيارات JS (`timeoutMs`، `AbortSignal`) إلى تنفيذ Rust.

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

## الأوليات الأساسية (`task.rs`)

يعرّف `task.rs` ثلاث قطع أساسية:

1. `task::blocking(tag, cancel_token, work)`
   - يغلّف `napi::AsyncTask` / `Task`.
   - يعمل `compute()` على خيوط عمال libuv (للعمليات كثيفة المعالج أو استدعاءات النظام المتزامنة/الحاجبة).
   - يُرجع JS `Promise<T>`.

2. `task::future(env, tag, work)`
   - يغلّف `env.spawn_future(...)`.
   - يشغّل العمل غير المتزامن على بيئة تشغيل Tokio.
   - يُرجع `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` يجمع بين الموعد النهائي + `AbortSignal` اختياري.
   - `CancelToken::heartbeat()` هو إلغاء تعاوني للحلقات الحاجبة.
   - `CancelToken::wait()` هو انتظار إلغاء غير متزامن (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` يسمح للكود الخارجي بطلب الإلغاء (`abort(reason)`).

## `blocking` مقابل `future`: نموذج التنفيذ والاختيار

### استخدم `task::blocking`

استخدمه عندما يكون العمل كثيف المعالج أو متزامن/حاجب بطبيعته:

- مسح regex/الملفات (`grep`، `glob`، `fuzzy_find`)
- الأجزاء الداخلية لحلقة PTY المتزامنة (`run_pty_sync` عبر `spawn_blocking`)
- تحويلات الحافظة/الصور/HTML

السلوك:

- يستقبل إغلاق العمل `CancelToken` منسوخاً.
- يُلاحظ الإلغاء فقط حيث يتحقق الكود من `ct.heartbeat()?`.
- `Err(...)` من الإغلاق يرفض وعد JS.

### استخدم `task::future`

استخدمه عندما يجب على العمل انتظار (`await`) عمليات غير متزامنة:

- تنسيق جلسة الصدفة (`shell.run`، `executeShell`)
- سباق المهام (`tokio::select!`) بين الإكمال والإلغاء

السلوك:

- يمكن للمستقبل أن يتسابق بين الإكمال الطبيعي و `ct.wait()`.
- في مسار الإلغاء، تنشر التطبيقات غير المتزامنة عادةً الإلغاء إلى الأنظمة الفرعية الداخلية (مثل `tokio_util::CancellationToken`) وتفرض اختيارياً الإلغاء القسري عند انتهاء مهلة السماح.

## ربط واجهة JS API ↔ تصدير Rust (ما يتعلق بالمهمة/الإلغاء)

| واجهة JS API | تصدير Rust (`#[napi]`) | المجدول | ربط الإلغاء |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة التصفية |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة التسجيل |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` يتسابق ضد مهمة التشغيل؛ يربط مع Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | نفس ما سبق |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` داخلي | `CancelToken` يُتحقق منه في حلقة PTY المتزامنة عبر `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | لا يوجد (رمز `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | لا يوجد (رمز `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | لا يوجد (رمز `()`) |

`text.rs` و `ps.rs` لا يستخدمان حالياً `task::blocking`/`task::future` وبالتالي لا يشاركان في مسار الإلغاء هذا.

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
  - مستخدمو `task::blocking` يلاحظون الإلغاء فقط عندما يصل كود الإغلاق إلى `heartbeat()`. إذا لم يقم الإغلاق بنبض مبكر، يتأخر الإلغاء.

- **أثناء التنفيذ**:
  - `blocking`: `heartbeat()` التالي يُرجع `Err("Aborted: ...")`.
  - `future`: فرع `ct.wait()` يفوز بـ `select!`، ثم يلغي الكود الآلية غير المتزامنة التابعة (بالنسبة للصدفة: يلغي رمز Tokio، ينتظر حتى ثانيتين، ثم يلغي المهمة قسرياً).

## توقعات النبض للحلقات طويلة التشغيل

يجب أن يعمل `heartbeat()` بإيقاع يمكن التنبؤ به في الحلقات ذات مجموعات العمل غير المحدودة أو الكبيرة.

الأنماط الملاحظة:

- `glob::filter_entries`: فحص كل إدخال قبل التصفية/المطابقة.
- `fd::score_entries`: فحص كل مرشح ممسوح.
- `grep_sync`: فحص إلغاء صريح قبل مرحلة البحث الثقيلة، بالإضافة إلى استدعاءات fs-cache التي تستقبل الرمز أيضاً.
- `run_pty_sync`: فحص في كل دورة حلقة (إيقاع سكون ~16 مللي ثانية) وقتل العملية الفرعية عند الإلغاء.

القاعدة العملية: لا يجب أن تتجاوز أي حلقة على مدخلات ذات حجم خارجي فترة محدودة قصيرة دون نبض.

## سلوك الفشل وانتشار الأخطاء إلى JS

### المهام الحاجبة

مسار الخطأ:

1. الإغلاق يُرجع `Err(napi::Error)` (بما في ذلك إلغاء `heartbeat()`).
2. `Task::compute()` يُرجع `Err`.
3. `AsyncTask` يرفض وعد JS.

نصوص الأخطاء النموذجية:

- `Aborted: Timeout`
- `Aborted: Signal`
- أخطاء المجال (`Failed to decode image: ...`، `Conversion error: ...`، إلخ.)

### مهام Future

مسار الخطأ:

1. الجسم غير المتزامن يُرجع `Err(napi::Error)` أو فشل الانضمام يُعيَّن (`... task failed: {err}`).
2. الوعد المنشأ بواسطة `task::future` يُرفض.
3. بعض الواجهات تُرجع عمداً نتائج إلغاء منظّمة بدلاً من الرفض (`ShellRunResult`/`ShellExecuteResult` مع أعلام `cancelled`/`timed_out` و `exit_code: None`).

### تقسيم تقرير الإلغاء

- **الإلغاء كخطأ**: معظم التصديرات الحاجبة التي تستخدم `heartbeat()?`.
- **الإلغاء كنتيجة مُنمَّطة**: واجهات أوامر نمط shell/pty التي تنمذج الإلغاء في هياكل النتائج.

اختر نموذجاً واحداً لكل واجهة API ووثّقه بوضوح.

## المزالق الشائعة

1. **نبض مفقود في الحلقات الحاجبة**
   - العرض: يبدو أن المهلة/الإشارة تُتجاهل حتى تنتهي الحلقة.
   - الحل: أضف `ct.heartbeat()?` في أعلى الحلقة وقبل الخطوات المكلفة لكل عنصر.

2. **أقسام طويلة غير قابلة للإلغاء**
   - العرض: ارتفاعات في زمن الإلغاء أثناء استدعاء واحد كبير (فك تشفير، ترتيب، ضغط، إلخ.).
   - الحل: قسّم العمل إلى أجزاء مع حدود نبض؛ إذا كان ذلك مستحيلاً، وثّق زمن الانتظار.

3. **حجب المنفذ غير المتزامن**
   - العرض: واجهة API غير متزامنة تتعطل عندما يعمل كود ثقيل متزامن مباشرة في future.
   - الحل: انقل كتل المعالج/المتزامنة إلى `task::blocking` أو `tokio::task::spawn_blocking`.

4. **دلالات إلغاء غير متسقة**
   - العرض: واجهة API ترفض عند الإلغاء، وأخرى تحل بأعلام، مما يربك المستدعين.
   - الحل: وحّد المعايير لكل مجال وحافظ على توافق وثائق المغلّف.

5. **نسيان جسر الإلغاء في المهام غير المتزامنة المتداخلة**
   - العرض: يُلغى الرمز الخارجي لكن القارئات الداخلية/مهام العمليات الفرعية تستمر في العمل.
   - الحل: اربط الإلغاء بالرمز/الإشارة الداخلية وفرض مهلة سماح + إلغاء قسري احتياطي.

## قائمة تحقق للتصديرات القابلة للإلغاء الجديدة

1. صنّف العمل بشكل صحيح:
   - كثيف المعالج أو حجب متزامن -> `task::blocking`
   - إدخال/إخراج غير متزامن / تنسيق `await` -> `task::future`

2. كشف مدخلات الإلغاء عند الحاجة:
   - ضمّن `timeoutMs` و `signal` في خيارات `#[napi(object)]`
   - أنشئ `let ct = task::CancelToken::new(timeout_ms, signal);`

3. مرر الإلغاء عبر جميع الطبقات:
   - الحلقات الحاجبة: `ct.heartbeat()?` على فترات مستقرة
   - التنسيق غير المتزامن: تسابق مع `ct.wait()` وإلغاء المهام/الرموز الفرعية

4. قرر عقد الإلغاء:
   - رفض الوعد بخطأ إلغاء، أو
   - حل بنوع مُنمَّط `{ cancelled, timedOut, ... }`
   - حافظ على اتساق هذا العقد لعائلة الواجهة

5. انشر الأخطاء مع السياق:
   - عيّن الأخطاء عبر `Error::from_reason(format!("...: {err}"))`
   - ضمّن بادئات خاصة بالمرحلة (`spawn`، `decode`، `wait`، إلخ.)

6. تعامل مع الإلغاء قبل البدء وأثناء التنفيذ:
   - يجب أن يحدث فحص/انتظار الإلغاء قبل الجسم المكلف وأثناء التنفيذ الطويل

7. تحقق من عدم إساءة استخدام المنفذ:
   - لا عمل متزامن طويل مباشرة داخل futures غير متزامنة بدون مغلّف `spawn_blocking`/مهمة حاجبة
