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

## العناصر الأولية الأساسية (`task.rs`)

يعرّف `task.rs` ثلاثة عناصر أساسية:

1. `task::blocking(tag, cancel_token, work)`
   - يُغلّف `napi::AsyncTask` / `Task`.
   - تعمل `compute()` على خيوط عمل libuv (للعمليات المكثفة بحوسبيًا أو استدعاءات النظام المتزامنة/الحاجبة).
   - تُرجع `Promise<T>` في JS.

2. `task::future(env, tag, work)`
   - يُغلّف `env.spawn_future(...)`.
   - يُشغّل العمل غير المتزامن على وقت تشغيل Tokio.
   - تُرجع `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - تجمع `CancelToken::new(timeout_ms, signal)` بين الموعد النهائي والـ `AbortSignal` الاختياري.
   - `CancelToken::heartbeat()` هو إلغاء تعاوني لحلقات الحجب.
   - `CancelToken::wait()` هو انتظار إلغاء غير متزامن (`Signal` / `Timeout` / `User` Ctrl-C).
   - يتيح `AbortToken` للكود الخارجي طلب الإلغاء (`abort(reason)`).

## `blocking` مقابل `future`: نموذج التنفيذ والاختيار

### استخدام `task::blocking`

استخدمه عندما يكون العمل مكثفًا حوسبيًا أو متزامنًا/حاجبًا بطبيعته:

- المسح بالتعبيرات النمطية/الملفات (`grep`، `glob`، `fuzzy_find`)
- عمليات حلقة PTY المتزامنة الداخلية (`run_pty_sync` عبر `spawn_blocking`)
- تحويلات الحافظة/الصور/HTML

السلوك:

- تستقبل إغلاق العمل نسخة مستنسخة من `CancelToken`.
- يُلاحَظ الإلغاء فقط عند تحقق الكود من `ct.heartbeat()?`.
- يرفض `Err(...)` من الإغلاق وعد JS.

### استخدام `task::future`

استخدمه عندما يجب أن يعمل العمل بـ `await` على عمليات غير متزامنة:

- تنسيق جلسات shell (`shell.run`، `executeShell`)
- المسابقة بين المهام (`tokio::select!`) بين الإتمام والإلغاء

السلوك:

- يمكن للمستقبل أن يتسابق بين الإتمام الطبيعي و`ct.wait()`.
- في مسار الإلغاء، عادةً ما تنشر التنفيذات غير المتزامنة الإلغاء إلى الأنظمة الفرعية الداخلية (مثل `tokio_util::CancellationToken`) وتفرض الإلغاء القسري عند انتهاء مهلة السماحة اختياريًا.

## تعيين واجهة برمجة JS ↔ صادرات Rust (المتعلقة بالمهام/الإلغاء)

| واجهة JS | صادرات Rust (`#[napi]`) | المجدول | ربط الإلغاء |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة التصفية |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` في حلقة التسجيل |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` في مسابقة مع مهمة التشغيل؛ يتصل بـ `CancellationToken` في Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | مثل السابق |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` داخلي | يُتحقق من `CancelToken` في حلقة PTY المتزامنة عبر `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | لا يوجد (رمز `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | لا يوجد (رمز `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | لا يوجد (رمز `()`) |

لا يستخدم كل من `text.rs` و`ps.rs` حاليًا `task::blocking`/`task::future`، وبالتالي لا يشاركان في مسار الإلغاء هذا.

## دورة حياة الإلغاء وانتقالات الحالة

### دورة حياة `CancelToken`

`CancelToken` تعاونية وذات حالة:

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
  - يمكن لمستخدمي `task::future` الذين يتسابقون على `ct.wait()` حل الإلغاء فورًا بمجرد دخولهم `select!`.
  - يلاحظ مستخدمو `task::blocking` الإلغاء فقط عند وصول كود الإغلاق إلى `heartbeat()`. إذا لم ينفّذ الإغلاق heartbeat مبكرًا، يتأخر الإلغاء.

- **أثناء التنفيذ**:
  - `blocking`: تُرجع `heartbeat()` التالية `Err("Aborted: ...")`.
  - `future`: يفوز فرع `ct.wait()` في `select!`، ثم يُلغي الكود الآلية غير المتزامنة التابعة (بالنسبة لـ shell: يُلغي رمز Tokio، وينتظر حتى 2 ثانية، ثم يُجبر على إلغاء المهمة).

## توقعات النبضات لحلقات التشغيل الطويل

يجب تشغيل `heartbeat()` بإيقاع منتظم في الحلقات ذات مجموعات العمل غير المحدودة أو الكبيرة.

الأنماط الملاحظة:

- `glob::filter_entries`: التحقق من كل إدخال قبل التصفية/المطابقة.
- `fd::score_entries`: التحقق من كل مرشح تم مسحه.
- `grep_sync`: فحص إلغاء صريح قبل مرحلة البحث المكثفة، بالإضافة إلى استدعاءات fs-cache التي تستقبل الرمز أيضًا.
- `run_pty_sync`: التحقق في كل دورة حلقة (بإيقاع نوم ~16ms) وإيقاف العملية الابن عند الإلغاء.

القاعدة العملية: لا ينبغي أن تتجاوز أي حلقة على مدخلات خارجية الحجم فترة محدودة قصيرة دون نبضة.

## سلوك الفشل ونشر الأخطاء إلى JS

### المهام الحاجبة

مسار الخطأ:

1. يُرجع الإغلاق `Err(napi::Error)` (بما في ذلك إلغاء `heartbeat()`).
2. تُرجع `Task::compute()` قيمة `Err`.
3. يرفض `AsyncTask` وعد JS.

سلاسل الأخطاء النموذجية:

- `Aborted: Timeout`
- `Aborted: Signal`
- أخطاء النطاق (`Failed to decode image: ...`، `Conversion error: ...`، إلخ)

### المهام المستقبلية

مسار الخطأ:

1. يُرجع جسم غير المتزامن `Err(napi::Error)` أو يُعيَّن فشل الانضمام (`... task failed: {err}`).
2. يرفض الوعد المُولَّد بـ `task::future`.
3. تُرجع بعض واجهات برمجة التطبيقات عن قصد نتائج إلغاء منظمة بدلًا من الرفض (`ShellRunResult`/`ShellExecuteResult` مع أعلام `cancelled`/`timed_out` و`exit_code: None`).

### تقسيم تقارير الإلغاء

- **الإلغاء كخطأ**: معظم الصادرات الحاجبة التي تستخدم `heartbeat()?`.
- **الإلغاء كنتيجة مكتوبة**: واجهات برمجة تطبيقات الأوامر من نمط shell/pty التي تُنمذج الإلغاء في هياكل النتائج.

اختر نموذجًا واحدًا لكل واجهة برمجة ووثّقه صراحةً.

## المشكلات الشائعة

1. **نبضة مفقودة في حلقات الحجب**
   - الأعراض: يبدو أن المهلة/الإشارة مُتجاهلة حتى نهاية الحلقة.
   - الحل: أضف `ct.heartbeat()?` في بداية الحلقة وقبل الخطوات المكثفة لكل عنصر.

2. **أقسام غير قابلة للإلغاء لفترات طويلة**
   - الأعراض: ارتفاع زمن الاستجابة للإلغاء خلال استدعاء واحد كبير (فك الترميز، الفرز، الضغط، إلخ).
   - الحل: قسّم العمل إلى قطع مع حدود نبضات؛ إذا كان ذلك مستحيلًا، وثّق زمن الاستجابة.

3. **حجب منفّذ غير المتزامن**
   - الأعراض: تتوقف واجهة برمجة التطبيقات غير المتزامنة عند تشغيل كود مكثف حوسبيًا مباشرةً في المستقبل.
   - الحل: انقل كتل CPU/المتزامن إلى `task::blocking` أو `tokio::task::spawn_blocking`.

4. **دلالات إلغاء غير متسقة**
   - الأعراض: ترفض إحدى واجهات برمجة التطبيقات عند الإلغاء، بينما تحل واجهة أخرى مع أعلام، مما يُربك المستدعين.
   - الحل: وحّد المعالجة لكل نطاق واحتفظ بتوثيق المُغلّف متوافقًا.

5. **نسيان جسر الإلغاء في المهام غير المتزامنة المتداخلة**
   - الأعراض: يُلغى الرمز الخارجي لكن قراء الداخل/مهام العمليات الفرعية تستمر في العمل.
   - الحل: اجسر الإلغاء إلى الرمز/الإشارة الداخلية وفرض مهلة السماحة والإلغاء القسري احتياطيًا.

## قائمة مراجعة الصادرات القابلة للإلغاء الجديدة

1. صنّف العمل بشكل صحيح:
   - مكثف حوسبيًا أو حجب متزامن -> `task::blocking`
   - إدخال/إخراج غير متزامن / تنسيق `await` -> `task::future`

2. اكشف مدخلات الإلغاء عند الحاجة:
   - أدرج `timeoutMs` و`signal` في خيارات `#[napi(object)]`
   - أنشئ `let ct = task::CancelToken::new(timeout_ms, signal);`

3. اربط الإلغاء عبر جميع الطبقات:
   - حلقات الحجب: `ct.heartbeat()?` على فترات منتظمة
   - تنسيق غير متزامن: تسابق مع `ct.wait()` وإلغاء المهام الفرعية/الرموز

4. حدد عقد الإلغاء:
   - رفض الوعد مع خطأ إلغاء، أو
   - حل نوع مكتوب `{ cancelled, timedOut, ... }`
   - احتفظ بهذا العقد متسقًا لعائلة واجهة برمجة التطبيقات

5. انشر الأخطاء مع السياق:
   - عيّن الأخطاء عبر `Error::from_reason(format!("...: {err}"))`
   - أدرج بادئات خاصة بالمرحلة (`spawn`، `decode`، `wait`، إلخ)

6. تعامل مع الإلغاء قبل البدء وأثناء التنفيذ:
   - يجب أن يحدث فحص/انتظار الإلغاء قبل الجسم المكلف وأثناء التنفيذ الطويل

7. تحقق من عدم إساءة استخدام المنفّذ:
   - لا عمل متزامن طويل مباشرةً داخل المستقبلات غير المتزامنة دون `spawn_blocking`/مُغلّف مهمة حاجبة
