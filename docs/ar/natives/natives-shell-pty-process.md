---
title: 'Natives Shell, PTY, Process, and Key Internals'
description: >-
  تنفيذ الصدفة، إدارة PTY، دورة حياة العمليات، ومعالجة أحداث المفاتيح في الطبقة
  الأصلية.
sidebar:
  order: 4
  label: 'Shell, PTY & process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# البنية الداخلية للصدفة وPTY والعمليات والمفاتيح في الطبقة الأصلية

يغطي هذا المستند **بدائيات التنفيذ/العمليات/الطرفية** في `@f5xc-salesdemos/pi-natives`: `shell` و`pty` و`ps` و`keys`، باستخدام مصطلحات البنية المعمارية من `docs/natives-architecture.md`.

## ملفات التنفيذ

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (Windows فقط)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (سلوك الإلغاء المشترك المستخدم بواسطة shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## ملكية الطبقات

- **طبقة غلاف TS/واجهة برمجة التطبيقات** (`packages/natives/src/*`): نقاط الدخول المنمَّطة، وسطح الإلغاء (`timeoutMs`، `AbortSignal`)، وسهولة استخدام JS.
- **طبقة وحدة Rust N-API** (`crates/pi-natives/src/*`): تنفيذ عمليات الصدفة/PTY، واجتياز/إنهاء شجرة العمليات، وتحليل تسلسلات المفاتيح.
- **بوابة التحقق** (`native.ts`، على مستوى البنية المعمارية): تضمن وجود الصادرات المطلوبة (`Shell`، `executeShell`، `PtySession`، `killTree`، `listDescendants`، مساعدات المفاتيح) قبل استخدام الأغلفة.

## نظام الصدفة الفرعي (`shell`)

### نموذج واجهة برمجة التطبيقات

يتم عرض وضعين للتنفيذ:

1. **تنفيذ لمرة واحدة** عبر `executeShell(options, onChunk?)`.
2. **جلسة مستمرة** عبر `new Shell(options?)` ثم `shell.run(...)` بشكل متكرر.

كلاهما يبث المخرجات من خلال استدعاء راجع آمن للخيوط ويعيد `{ exitCode?, cancelled, timedOut }`.

### إنشاء الجلسة ونموذج البيئة

تنشئ Rust `brush_core::Shell` مع:

- الوضع غير التفاعلي،
- `do_not_inherit_env: true`،
- إعادة بناء صريحة للبيئة من بيئة المضيف،
- قائمة تخطي للمتغيرات الحساسة للصدفة (`PS1`، `PWD`، `SHLVL`، صادرات دوال bash، إلخ).

سلوك بيئة الجلسة:

- يتم تطبيق `ShellOptions.sessionEnv` مرة واحدة عند إنشاء الجلسة.
- `ShellRunOptions.env` محدود النطاق بالأمر (`EnvironmentScope::Command`) ويتم إزالته بعد كل تشغيل.
- يتم دمج `PATH` بشكل خاص على Windows مع إزالة التكرارات بدون تمييز حالة الأحرف.

إثراء المسار الخاص بـ Windows (`shell/windows.rs`): يتم إلحاق مسارات Git-for-Windows المكتشفة (`cmd`، `bin`، `usr/bin`) إذا كانت موجودة وغير مضمنة بالفعل.

### دورة حياة التشغيل وانتقالات الحالة

تستخدم الصدفة المستمرة (`Shell.run`) آلة الحالة هذه:

- **خاملة/غير مهيأة**: `session: None`.
- **قيد التشغيل**: أول `run()` ينشئ الجلسة بتكاسل، يخزن رمز `current_abort`، وينفذ الأمر.
- **مكتملة + استمرار النشاط**: إذا كان تدفق التحكم في التنفيذ `Normal`، يتم مسح `current_abort` وإعادة استخدام الجلسة.
- **مكتملة + إنهاء**: إذا كان تدفق التحكم مرتبطاً بالحلقة/السكريبت/خروج الصدفة (`BreakLoop`، `ContinueLoop`، `ReturnFromFunctionOrScript`، `ExitShell`)، يتم إسقاط الجلسة (`session: None`).
- **ملغاة/انتهت المهلة**: يتم إلغاء مهمة التشغيل، انتظار سماح (2 ثانية)، ثم إنهاء قسري؛ يتم إسقاط الجلسة.
- **خطأ**: يتم إسقاط الجلسة.

الصدفة لمرة واحدة (`executeShell`) تنشئ دائماً جلسة جديدة وتسقطها مع كل استدعاء.

### سلوك البث/المخرجات

- يتم توجيه stdout/stderr إلى أنبوب مشترك وقراءتهما بشكل متزامن.
- يفك القارئ ترميز UTF-8 تدريجياً؛ تسلسلات البايت غير الصالحة تنتج أجزاء بديلة `U+FFFD`.
- بعد اكتمال العملية، يحتوي تصريف المخرجات على حراسات خمول/حد أقصى (`250ms` خمول، `2s` حد أقصى) لتجنب التعليق بسبب المهام الخلفية التي تبقي الواصفات مفتوحة.

### الإلغاء والمهلة الزمنية والمهام الخلفية

- يتم إنشاء `CancelToken` من `timeoutMs` و`AbortSignal` الاختياري.
- عند الإلغاء/انتهاء المهلة، يتم تفعيل رمز إلغاء الصدفة، ثم تحصل المهمة على نافذة سماح مدتها 2 ثانية قبل الإنهاء القسري.
- إذا حدث الإلغاء، يتم إنهاء المهام الخلفية (`TERM`، ثم `KILL` مؤجل) باستخدام بيانات وصفية لمهام brush.

سلوك `Shell.abort()`:

- يلغي فقط الأمر الجاري حالياً لمثيل `Shell` ذاك،
- نجاح بدون عملية عندما لا يكون هناك شيء قيد التشغيل.

### سلوك الفشل

الأخطاء الشائعة المعروضة تشمل:

- فشل تهيئة الجلسة (`Failed to initialize shell`)،
- أخطاء دليل العمل (`Failed to set cwd`)،
- فشل تعيين/إزالة البيئة،
- فشل مصدر اللقطة،
- فشل إنشاء/استنساخ الأنبوب،
- فشل التنفيذ (`Shell execution failed: ...`)،
- فشل غلاف المهمة (`Shell execution task failed: ...`).

علامات الإلغاء على مستوى النتيجة:

- المهلة الزمنية -> `exitCode: undefined`، `timedOut: true`.
- إشارة الإنهاء -> `exitCode: undefined`، `cancelled: true`.

## نظام PTY الفرعي (`pty`)

### نموذج واجهة برمجة التطبيقات

يعرض `new PtySession()`:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### دورة حياة التشغيل وانتقالات الحالة

آلة حالة `PtySession`:

- **خاملة**: `core: None`.
- **محجوزة**: `start()` تثبت قناة التحكم بشكل متزامن (`core: Some`) قبل بدء العمل غير المتزامن، لذا يصبح `write/resize/kill` صالحاً فوراً.
- **قيد التشغيل**: حلقة PTY المحجوبة تتعامل مع حالة العملية الفرعية، أحداث القارئ، نبضات الإلغاء، ورسائل التحكم.
- **الطرفية مغلقة**: خروج العملية الفرعية + اكتمال القارئ.
- **منتهية**: يتم دائماً إعادة تعيين `core` إلى `None` بعد اكتمال مهمة البدء (نجاح أو خطأ).

حارس التزامن:

- البدء أثناء التشغيل بالفعل يعيد `PTY session already running`.

### أنماط الإنشاء/الربط/الكتابة/القراءة/الإنهاء

- يتم فتح PTY عبر `portable_pty::native_pty_system().openpty(...)`.
- يتم تشغيل الأمر حالياً كـ `sh -lc <command>` مع `cwd` اختياري وتجاوزات البيئة.
- `write()` يرسل بايتات خام إلى stdin الخاص بـ PTY.
- `resize()` يحد الأبعاد (`cols 20..400`، `rows 5..200`) ويستدعي تغيير حجم المستر.
- `kill()` يميّز التشغيل كملغى ويقتل العملية الفرعية.

مسار المخرجات:

- خيط قارئ مخصص يقرأ من تيار المستر،
- فك ترميز UTF-8 تدريجي مع استبدال `U+FFFD` عند البايتات غير الصالحة،
- يتم تمرير الأجزاء من خلال استدعاء راجع N-API آمن للخيوط.

### دلالات الإلغاء والمهلة الزمنية

- `timeoutMs` و`AbortSignal` يغذيان `CancelToken`.
- الحلقة تستدعي `ct.heartbeat()` دورياً؛ الإنهاء يفعّل قتل العملية الفرعية.
- تصنيف المهلة الزمنية يعتمد على السلاسل النصية (السلسلة الفرعية `"Timeout"` في خطأ النبضة).

### سلوك الفشل

أسطح الأخطاء تشمل:

- فشل تخصيص/فتح PTY،
- فشل إنشاء عملية PTY،
- فشل الحصول على الكاتب/القارئ،
- فشل حالة/انتظار العملية الفرعية،
- تسمم القفل،
- انقطاع قناة التحكم (`PTY session is no longer available`).

فشل استدعاءات التحكم عندما لا يكون قيد التشغيل:

- `write/resize/kill` تعيد `PTY session is not running`.

## نظام شجرة العمليات الفرعي (`ps`)

### نموذج واجهة برمجة التطبيقات

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

يسجل غلاف TS أيضاً تكامل قتل الشجرة الأصلي في الأدوات المشتركة عبر `setNativeKillTree(native.killTree)`.

### التنفيذ الخاص بالمنصة

- **Linux**: يقرأ بشكل متكرر `/proc/<pid>/task/<pid>/children`.
- **macOS**: يستخدم `libproc` `proc_listchildpids`.
- **Windows**: يأخذ لقطة لجدول العمليات باستخدام `CreateToolhelp32Snapshot`، يبني خريطة أب->أبناء، وينهي باستخدام `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### سلوك قتل الشجرة

- يتم جمع الأحفاد بشكل متكرر.
- ترتيب القتل من الأسفل للأعلى (الأحفاد الأعمق أولاً) لتقليل إعادة تعيين الأبوة للعمليات اليتيمة.
- يتم قتل العملية الجذر أخيراً.
- القيمة المعادة هي عدد عمليات الإنهاء الناجحة.

سلوك الإشارة:

- POSIX: يتم تمرير `signal` المقدم إلى `kill`.
- Windows: يتم تجاهل `signal`؛ الإنهاء هو إنهاء عملية غير مشروط.

### سلوك الفشل

هذه الوحدة مصممة عمداً لعدم إطلاق استثناءات على سطح واجهة برمجة التطبيقات:

- يتم تخطي فروع شجرة العمليات المفقودة/غير القابلة للوصول،
- فشل القتل لكل عملية يتم احتسابه كغير ناجح (وليس أخطاء)،
- عدم العثور في البحث عادةً ينتج `[]` من `listDescendants` و`0` من `killTree`.

## نظام تحليل المفاتيح الفرعي (`keys`)

### نموذج واجهة برمجة التطبيقات

المساعدات المعروضة:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### نموذج التحليل

يجمع المحلل بين:

- تعيينات البايت الفردي المباشرة (`enter`، `tab`، `ctrl+<letter>`، ASCII القابل للطباعة)،
- بحث تسلسل الهروب القديم بتعقيد O(1) (خريطة PHF)،
- تحليل xterm `modifyOtherKeys`،
- تحليل بروتوكول Kitty (`CSI u`، `CSI ~`، `CSI 1;...<letter>`)،
- التطبيع إلى معرفات المفاتيح (`ctrl+c`، `shift+tab`، `pageUp`، `f5`، إلخ).

معالجة المعدِّلات:

- يتم مقارنة بتات shift/alt/ctrl فقط لمطابقة المفاتيح،
- يتم إخفاء بتات القفل قبل المقارنات.

سلوك التخطيط:

- الرجوع للتخطيط الأساسي مقيد عمداً حتى لا تنشئ التخطيطات المعاد تعيينها مطابقات خاطئة لأحرف/رموز ASCII.

### سلوك الفشل

- التسلسلات غير المعروفة أو غير الصالحة تنتج `null` من دوال التحليل.
- دوال المطابقة تعيد `false` عند فشل التحليل أو عدم التطابق.
- لا يوجد سطح أخطاء مطلقة لإدخال مفاتيح مشوه.

## تعيين واجهة غلاف JS ↔ صادرات Rust

### الصدفة + PTY + العمليات

| واجهة غلاف TS | صادرات Rust N-API | ملاحظات |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | تنفيذ صدفة لمرة واحدة |
| `new Shell(options?)` | `Shell` class | جلسة صدفة مستمرة |
| `shell.run(options, onChunk?)` | `Shell::run` | يعيد استخدام الجلسة عند تدفق تحكم الاستمرار |
| `shell.abort()` | `Shell::abort` | يلغي التشغيل النشط لمثيل الصدفة ذاك |
| `new PtySession()` | `PtySession` class | جلسة PTY ذات حالة |
| `pty.start(options, onChunk?)` | `PtySession::start` | تشغيل PTY تفاعلي |
| `pty.write(data)` | `PtySession::write` | تمرير مباشر لـ stdin الخام |
| `pty.resize(cols, rows)` | `PtySession::resize` | أبعاد طرفية محدودة |
| `pty.kill()` | `PtySession::kill` | يقتل قسرياً العملية الفرعية النشطة لـ PTY |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | إنهاء شجرة العمليات بدءاً من الأبناء |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | قائمة الأحفاد المتكررة |

### المفاتيح

| واجهة غلاف TS | صادرات Rust N-API | ملاحظات |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | مطابقة نقطة ترميز+معدِّل Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | محلل معرف المفتاح المطبَّع |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | فحص خريطة التسلسل القديم بالتحديد |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | نتيجة تحليل Kitty المهيكلة |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | مطابق المفاتيح عالي المستوى |

## تنظيف الجلسات المهجورة وملاحظات الإنهاء

- **جلسة الصدفة المستمرة**: إذا تم إلغاء/انتهاء مهلة/خطأ/تدفق تحكم غير مستمر في التشغيل، تسقط Rust صراحةً حالة الجلسة الداخلية. عمليات التشغيل الطبيعية الناجحة تحتفظ بالجلسة لإعادة الاستخدام.
- **جلسة PTY**: يتم دائماً مسح `core` بعد انتهاء `start()`، بما في ذلك مسارات الفشل.
- **لا يوجد عقد قتل مدفوع بمنهي JS صريح** معروض من الأغلفة؛ التنظيف مرتبط بشكل أساسي بمسارات اكتمال/إلغاء التشغيل. يجب على المستدعين استخدام `timeoutMs` أو `AbortSignal` أو `shell.abort()` أو `pty.kill()` للإنهاء المحدد.
