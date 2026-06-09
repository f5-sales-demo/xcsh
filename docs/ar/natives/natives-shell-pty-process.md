---
title: البنية الداخلية للصدفة وPTY والعمليات والمفاتيح في الطبقة الأصلية
description: >-
  تنفيذ الصدفة، وإدارة PTY، ودورة حياة العمليات، ومعالجة أحداث المفاتيح في
  الطبقة الأصلية.
sidebar:
  order: 4
  label: الصدفة وPTY والعمليات
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# البنية الداخلية للصدفة وPTY والعمليات والمفاتيح في الطبقة الأصلية

يغطي هذا المستند **أساسيات التنفيذ/العمليات/الطرفية** في `@f5xc-salesdemos/pi-natives`: `shell` و`pty` و`ps` و`keys`، باستخدام مصطلحات البنية المعمارية من `docs/natives-architecture.md`.

## ملفات التنفيذ

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (Windows فقط)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (سلوك الإلغاء المشترك المستخدم من قبل shell/pty)
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

- **طبقة غلاف/واجهة TS** (`packages/natives/src/*`): نقاط دخول مُنمَّطة، وسطح الإلغاء (`timeoutMs`، `AbortSignal`)، وسهولة الاستخدام مع JS.
- **طبقة وحدة Rust N-API** (`crates/pi-natives/src/*`): تنفيذ عمليات الصدفة/PTY، واجتياز/إنهاء شجرة العمليات، وتحليل تسلسلات المفاتيح.
- **بوابة التحقق** (`native.ts`، على مستوى البنية المعمارية): تضمن وجود الصادرات المطلوبة (`Shell`، `executeShell`، `PtySession`، `killTree`، `listDescendants`، مساعدات المفاتيح) قبل استخدام الأغلفة.

## نظام الصدفة الفرعي (`shell`)

### نموذج الواجهة البرمجية

يتم توفير وضعين للتنفيذ:

1. **تنفيذ لمرة واحدة** عبر `executeShell(options, onChunk?)`.
2. **جلسة مستمرة** عبر `new Shell(options?)` ثم `shell.run(...)` بشكل متكرر.

كلاهما يبث المخرجات من خلال دالة استدعاء آمنة للخيوط ويُرجع `{ exitCode?, cancelled, timedOut }`.

### إنشاء الجلسة ونموذج البيئة

يقوم Rust بإنشاء `brush_core::Shell` مع:

- الوضع غير التفاعلي،
- `do_not_inherit_env: true`،
- إعادة بناء صريحة للبيئة من بيئة المضيف،
- قائمة استبعاد للمتغيرات الحساسة للصدفة (`PS1`، `PWD`، `SHLVL`، صادرات دوال bash، إلخ.).

سلوك بيئة الجلسة:

- يُطبَّق `ShellOptions.sessionEnv` مرة واحدة عند إنشاء الجلسة.
- `ShellRunOptions.env` محدود بنطاق الأمر (`EnvironmentScope::Command`) ويُزال بعد كل تنفيذ.
- يُدمج `PATH` بشكل خاص على Windows مع إزالة التكرارات بدون حساسية لحالة الأحرف.

إثراء المسار الخاص بـ Windows (`shell/windows.rs`): يتم إلحاق مسارات Git-for-Windows المكتشفة (`cmd`، `bin`، `usr/bin`) إذا كانت موجودة وغير مدرجة مسبقاً.

### دورة حياة التشغيل وتحولات الحالة

الصدفة المستمرة (`Shell.run`) تستخدم آلة الحالة التالية:

- **خاملة/غير مُهيَّأة**: `session: None`.
- **قيد التشغيل**: أول `run()` يُنشئ الجلسة بشكل كسول، ويخزن رمز `current_abort`، وينفذ الأمر.
- **مكتملة + إبقاء حية**: إذا كان تدفق التحكم في التنفيذ `Normal`، يتم مسح `current_abort` ويُعاد استخدام الجلسة.
- **مكتملة + تفكيك**: إذا كان تدفق التحكم متعلقاً بالحلقات/السكربت/خروج الصدفة (`BreakLoop`، `ContinueLoop`، `ReturnFromFunctionOrScript`، `ExitShell`)، يتم إسقاط الجلسة (`session: None`).
- **ملغاة/انتهت مهلتها**: يتم إلغاء مهمة التشغيل، انتظار رشيق (2 ثانية)، ثم إجهاض قسري؛ يتم إسقاط الجلسة.
- **خطأ**: يتم إسقاط الجلسة.

الصدفة لمرة واحدة (`executeShell`) تُنشئ وتُسقط جلسة جديدة دائماً مع كل استدعاء.

### سلوك البث/المخرجات

- يتم توجيه stdout/stderr إلى أنبوب مشترك وقراءتهما بشكل متزامن.
- يقوم القارئ بفك تشفير UTF-8 بشكل تدريجي؛ تسلسلات البايتات غير الصالحة تُصدر أجزاء استبدال `U+FFFD`.
- بعد اكتمال العملية، يحتوي تصريف المخرجات على حراسات الخمول/الحد الأقصى (`250ms` خمول، `2s` حد أقصى) لتجنب التعليق على المهام الخلفية التي تُبقي واصفات الملفات مفتوحة.

### الإلغاء والمهلة الزمنية والمهام الخلفية

- يتم إنشاء `CancelToken` من `timeoutMs` و`AbortSignal` الاختياري.
- عند الإلغاء/انتهاء المهلة، يتم تفعيل رمز إلغاء الصدفة، ثم تحصل المهمة على نافذة رشيقة مدتها 2 ثانية قبل الإجهاض القسري.
- إذا حدث الإلغاء، يتم إنهاء المهام الخلفية (`TERM`، ثم `KILL` مؤجل) باستخدام بيانات وصفية لمهام brush.

سلوك `Shell.abort()`:

- يُلغي فقط الأمر الجاري حالياً لتلك النسخة من `Shell`،
- عملية ناجحة بدون تأثير عندما لا يكون هناك شيء قيد التشغيل.

### سلوك الأخطاء

الأخطاء الشائعة المُعرَّضة تشمل:

- فشل تهيئة الجلسة (`Failed to initialize shell`)،
- أخطاء دليل العمل الحالي (`Failed to set cwd`)،
- فشل تعيين/إزالة البيئة،
- فشل مصدر اللقطة،
- فشل إنشاء/استنساخ الأنبوب،
- فشل التنفيذ (`Shell execution failed: ...`)،
- فشل غلاف المهمة (`Shell execution task failed: ...`).

أعلام الإلغاء على مستوى النتيجة:

- المهلة الزمنية -> `exitCode: undefined`، `timedOut: true`.
- إشارة الإجهاض -> `exitCode: undefined`، `cancelled: true`.

## نظام PTY الفرعي (`pty`)

### نموذج الواجهة البرمجية

`new PtySession()` يوفر:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### دورة حياة التشغيل وتحولات الحالة

آلة حالة `PtySession`:

- **خاملة**: `core: None`.
- **محجوزة**: `start()` يُثبِّت قناة التحكم بشكل متزامن (`core: Some`) قبل بدء العمل غير المتزامن، بحيث تصبح `write/resize/kill` صالحة فوراً.
- **قيد التشغيل**: حلقة PTY المعطِّلة تتعامل مع حالة العملية الفرعية، وأحداث القارئ، ونبضات الإلغاء، ورسائل التحكم.
- **الطرفية مغلقة**: خروج العملية الفرعية + اكتمال القارئ.
- **مُنجَزة**: يتم دائماً إعادة تعيين `core` إلى `None` بعد اكتمال مهمة البدء (نجاح أو خطأ).

حارس التزامن:

- البدء أثناء التشغيل بالفعل يُرجع `PTY session already running`.

### أنماط الإنشاء/الربط/الكتابة/القراءة/الإنهاء

- يتم فتح PTY عبر `portable_pty::native_pty_system().openpty(...)`.
- الأمر حالياً يعمل كـ `sh -lc <command>` مع `cwd` اختياري وتجاوزات البيئة.
- `write()` يُرسل بايتات خام إلى stdin الخاص بـ PTY.
- `resize()` يُقيِّد الأبعاد (`cols 20..400`، `rows 5..200`) ويستدعي تغيير حجم المضيف.
- `kill()` يُعلِّم التشغيل كملغى ويقتل العملية الفرعية.

مسار المخرجات:

- خيط قارئ مخصص يقرأ تدفق المضيف،
- فك تشفير UTF-8 تدريجي مع استبدال `U+FFFD` للبايتات غير الصالحة،
- الأجزاء تُمرَّر عبر دالة استدعاء N-API آمنة للخيوط.

### دلالات الإلغاء والمهلة الزمنية

- `timeoutMs` و`AbortSignal` يُغذيان `CancelToken`.
- الحلقة تستدعي `ct.heartbeat()` بشكل دوري؛ الإجهاض يُفعِّل قتل العملية الفرعية.
- تصنيف المهلة يعتمد على النص (سلسلة فرعية `"Timeout"` في خطأ النبضة).

### سلوك الأخطاء

أسطح الأخطاء تشمل:

- فشل تخصيص/فتح PTY،
- فشل إنشاء عملية PTY،
- فشل الحصول على الكاتب/القارئ،
- فشل حالة/انتظار العملية الفرعية،
- تسمم القفل،
- انقطاع قناة التحكم (`PTY session is no longer available`).

فشل استدعاءات التحكم عندما لا يكون قيد التشغيل:

- `write/resize/kill` تُرجع `PTY session is not running`.

## نظام شجرة العمليات الفرعي (`ps`)

### نموذج الواجهة البرمجية

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

غلاف TS يُسجل أيضاً تكامل kill-tree الأصلي في الأدوات المشتركة عبر `setNativeKillTree(native.killTree)`.

### التنفيذ الخاص بالمنصة

- **Linux**: يقرأ بشكل متكرر `/proc/<pid>/task/<pid>/children`.
- **macOS**: يستخدم `libproc` `proc_listchildpids`.
- **Windows**: يأخذ لقطة لجدول العمليات باستخدام `CreateToolhelp32Snapshot`، يبني خريطة الأب->الأبناء، ينهي باستخدام `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### سلوك قتل الشجرة

- يتم جمع الأحفاد بشكل متكرر.
- ترتيب القتل من الأسفل إلى الأعلى (أعمق الأحفاد أولاً) لتقليل إعادة تبني اليتامى.
- يتم قتل المعرف الجذري أخيراً.
- القيمة المُرجَعة هي عدد عمليات الإنهاء الناجحة.

سلوك الإشارة:

- POSIX: يتم تمرير `signal` المُقدَّمة إلى `kill`.
- Windows: يتم تجاهل `signal`؛ الإنهاء هو إنهاء غير مشروط للعملية.

### سلوك الأخطاء

هذه الوحدة لا تطرح استثناءات عمداً على سطح الواجهة البرمجية:

- يتم تخطي فروع شجرة العمليات المفقودة/التي لا يمكن الوصول إليها،
- فشل القتل لكل معرف عملية يُحسَب كغير ناجح (وليس أخطاء)،
- عدم العثور عادةً يُنتج `[]` من `listDescendants` و`0` من `killTree`.

## نظام تحليل المفاتيح الفرعي (`keys`)

### نموذج الواجهة البرمجية

المساعدات المُعرَّضة:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### نموذج التحليل

يجمع المحلل بين:

- تعيينات مباشرة لبايت واحد (`enter`، `tab`، `ctrl+<letter>`، ASCII قابل للطباعة)،
- بحث O(1) لتسلسلات الهروب القديمة (خريطة PHF)،
- تحليل xterm `modifyOtherKeys`،
- تحليل بروتوكول Kitty (`CSI u`، `CSI ~`، `CSI 1;...<letter>`)،
- تطبيع إلى معرفات المفاتيح (`ctrl+c`، `shift+tab`، `pageUp`، `f5`، إلخ.).

معالجة المُعدِّلات:

- يتم مقارنة بتات shift/alt/ctrl فقط لمطابقة المفاتيح،
- يتم إخفاء بتات القفل قبل المقارنات.

سلوك التخطيط:

- الرجوع إلى التخطيط الأساسي مُقيَّد عمداً حتى لا تُنشئ التخطيطات المُعاد تعيينها مطابقات خاطئة لأحرف/رموز ASCII.

### سلوك الأخطاء

- التسلسلات غير المعروفة أو غير الصالحة تُنتج `null` من دوال التحليل.
- دوال المطابقة تُرجع `false` عند فشل التحليل أو عدم التطابق.
- لا يوجد سطح أخطاء مطروحة للمدخلات غير السليمة للمفاتيح.

## تعيين واجهة غلاف JS ↔ صادرات Rust

### الصدفة + PTY + العمليات

| واجهة غلاف TS | صادرة Rust N-API | ملاحظات |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | تنفيذ صدفة لمرة واحدة |
| `new Shell(options?)` | فئة `Shell` | جلسة صدفة مستمرة |
| `shell.run(options, onChunk?)` | `Shell::run` | يُعيد استخدام الجلسة عند تدفق تحكم الإبقاء حية |
| `shell.abort()` | `Shell::abort` | يُلغي التشغيل النشط لنسخة الصدفة تلك |
| `new PtySession()` | فئة `PtySession` | جلسة PTY ذات حالة |
| `pty.start(options, onChunk?)` | `PtySession::start` | تشغيل PTY تفاعلي |
| `pty.write(data)` | `PtySession::write` | تمرير مباشر لـ stdin الخام |
| `pty.resize(cols, rows)` | `PtySession::resize` | أبعاد طرفية مُقيَّدة |
| `pty.kill()` | `PtySession::kill` | قتل قسري للعملية الفرعية النشطة لـ PTY |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | إنهاء شجرة العمليات بدءاً من الأبناء |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | قائمة الأحفاد بشكل متكرر |

### المفاتيح

| واجهة غلاف TS | صادرة Rust N-API | ملاحظات |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | مطابقة نقطة الترميز+المُعدِّل لـ Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | محلل معرف المفتاح المُطبَّع |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | فحص دقيق لخريطة التسلسل القديم |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | نتيجة تحليل Kitty المُهيكلة |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | مُطابق مفاتيح عالي المستوى |

## تنظيف الجلسات المهجورة وملاحظات الإنهاء

- **جلسة الصدفة المستمرة**: إذا تم إلغاء التشغيل/انتهت مهلته/حدث خطأ/تدفق تحكم غير إبقاء حية، يقوم Rust صراحةً بإسقاط حالة الجلسة الداخلية. التشغيلات الناجحة العادية تُبقي الجلسة لإعادة الاستخدام.
- **جلسة PTY**: يتم دائماً مسح `core` بعد انتهاء `start()`، بما في ذلك مسارات الفشل.
- **لا يوجد عقد قتل صريح يُحرَّكه مُنهي JS** مُعرَّض من خلال الأغلفة؛ التنظيف مرتبط بشكل أساسي بمسارات اكتمال/إلغاء التشغيل. يجب على المُستدعين استخدام `timeoutMs` أو `AbortSignal` أو `shell.abort()` أو `pty.kill()` للتفكيك المحدد.
