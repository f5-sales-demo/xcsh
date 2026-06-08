---
title: 'Natives Shell, PTY, Process, and Key Internals'
description: >-
  Shell execution, PTY management, process lifecycle, and key event handling in
  the native layer.
sidebar:
  order: 4
  label: 'Shell, PTY & process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# العناصر الداخلية للـ Shell و PTY والعمليات والمفاتيح في الطبقة الأصلية

يغطي هذا المستند **أوليات التنفيذ/العمليات/الطرفية** في `@f5xc-salesdemos/pi-natives`: `shell` و `pty` و `ps` و `keys`، باستخدام مصطلحات البنية المعمارية من `docs/natives-architecture.md`.

## ملفات التنفيذ

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (نظام Windows فقط)
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

- **طبقة غلاف/واجهة TS** (`packages/natives/src/*`): نقاط دخول مُنمَّطة، وسطح الإلغاء (`timeoutMs`، `AbortSignal`)، وسهولة استخدام JS.
- **طبقة وحدة Rust N-API** (`crates/pi-natives/src/*`): تنفيذ عمليات shell/PTY، واستعراض/إنهاء شجرة العمليات، وتحليل تسلسلات المفاتيح.
- **بوابة التحقق** (`native.ts`، على مستوى البنية المعمارية): تتأكد من وجود الصادرات المطلوبة (`Shell`، `executeShell`، `PtySession`، `killTree`، `listDescendants`، مساعدات المفاتيح) قبل استخدام الأغلفة.

## النظام الفرعي للـ Shell (`shell`)

### نموذج الواجهة

يتم كشف وضعين للتنفيذ:

1. **تنفيذ لمرة واحدة** عبر `executeShell(options, onChunk?)`.
2. **جلسة مستمرة** عبر `new Shell(options?)` ثم `shell.run(...)` بشكل متكرر.

كلاهما يبث المخرجات من خلال استدعاء راجع آمن للخيوط ويعيد `{ exitCode?, cancelled, timedOut }`.

### إنشاء الجلسة ونموذج البيئة

ينشئ Rust `brush_core::Shell` مع:

- وضع غير تفاعلي،
- `do_not_inherit_env: true`،
- إعادة بناء صريحة للبيئة من بيئة المضيف،
- قائمة تخطي للمتغيرات الحساسة للـ shell (`PS1`، `PWD`، `SHLVL`، صادرات دوال bash، إلخ).

سلوك بيئة الجلسة:

- يتم تطبيق `ShellOptions.sessionEnv` مرة واحدة عند إنشاء الجلسة.
- `ShellRunOptions.env` محدود النطاق بالأمر (`EnvironmentScope::Command`) ويتم إزالته بعد كل تشغيل.
- يتم دمج `PATH` بشكل خاص على Windows مع إزالة التكرار بدون حساسية لحالة الأحرف.

إثراء المسار الخاص بـ Windows (`shell/windows.rs`): يتم إلحاق مسارات Git-for-Windows المكتشفة (`cmd`، `bin`، `usr/bin`) إذا كانت موجودة وغير مدرجة بالفعل.

### دورة حياة التشغيل وانتقالات الحالة

يستخدم الـ shell المستمر (`Shell.run`) آلة الحالة التالية:

- **خامل/غير مُهيأ**: `session: None`.
- **قيد التشغيل**: أول `run()` ينشئ الجلسة بشكل كسول، يخزن رمز `current_abort`، وينفذ الأمر.
- **مكتمل + إبقاء حي**: إذا كان تدفق التحكم في التنفيذ `Normal`، يتم مسح `current_abort` ويُعاد استخدام الجلسة.
- **مكتمل + تفكيك**: إذا كان تدفق التحكم مرتبطاً بحلقة/نص/خروج shell (`BreakLoop`، `ContinueLoop`، `ReturnFromFunctionOrScript`، `ExitShell`)، يتم إسقاط الجلسة (`session: None`).
- **ملغي/انتهت المهلة**: يتم إلغاء مهمة التشغيل، انتظار سماحي (2 ثانية)، ثم إيقاف قسري؛ يتم إسقاط الجلسة.
- **خطأ**: يتم إسقاط الجلسة.

الـ shell لمرة واحدة (`executeShell`) ينشئ ويسقط جلسة جديدة دائماً في كل استدعاء.

### سلوك البث/المخرجات

- يتم توجيه stdout/stderr إلى أنبوب مشترك وقراءتهما بشكل متزامن.
- يفك القارئ ترميز UTF-8 بشكل تدريجي؛ تسلسلات البايت غير الصالحة تُصدر أجزاء بديلة `U+FFFD`.
- بعد اكتمال العملية، يحتوي تصريف المخرجات على حراس خمول/حد أقصى (`250ms` خمول، `2s` حد أقصى) لتجنب التعليق على المهام الخلفية التي تبقي الواصفات مفتوحة.

### الإلغاء والمهلة والمهام الخلفية

- يتم إنشاء `CancelToken` من `timeoutMs` و `AbortSignal` الاختياري.
- عند الإلغاء/انتهاء المهلة، يتم تفعيل رمز إلغاء الـ shell، ثم تحصل المهمة على نافذة سماحية مدتها 2 ثانية قبل الإيقاف القسري.
- إذا حدث الإلغاء، يتم إنهاء المهام الخلفية (`TERM`، ثم `KILL` بتأخير) باستخدام بيانات وظائف brush الوصفية.

سلوك `Shell.abort()`:

- يلغي فقط الأمر الجاري حالياً لذلك المثيل من `Shell`،
- لا يفعل شيئاً (نجاح) عندما لا يوجد شيء قيد التشغيل.

### سلوك الأخطاء

تشمل الأخطاء الشائعة المُظهَرة:

- فشل تهيئة الجلسة (`Failed to initialize shell`)،
- أخطاء دليل العمل (`Failed to set cwd`)،
- فشل تعيين/إزالة البيئة،
- فشل مصدر اللقطة،
- فشل إنشاء/نسخ الأنبوب،
- فشل التنفيذ (`Shell execution failed: ...`)،
- فشل غلاف المهمة (`Shell execution task failed: ...`).

أعلام الإلغاء على مستوى النتيجة:

- انتهاء المهلة -> `exitCode: undefined`، `timedOut: true`.
- إشارة الإيقاف -> `exitCode: undefined`، `cancelled: true`.

## النظام الفرعي للـ PTY (`pty`)

### نموذج الواجهة

يكشف `new PtySession()`:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### دورة حياة التشغيل وانتقالات الحالة

آلة حالة `PtySession`:

- **خامل**: `core: None`.
- **محجوز**: `start()` يُثبّت قناة التحكم بشكل متزامن (`core: Some`) قبل بدء العمل غير المتزامن، بحيث يصبح `write/resize/kill` صالحاً فوراً.
- **قيد التشغيل**: حلقة PTY المُحجِبة تتعامل مع حالة العملية الفرعية، وأحداث القارئ، ونبضة الإلغاء، ورسائل التحكم.
- **الطرفية مغلقة**: خروج العملية الفرعية + اكتمال القارئ.
- **مُنتهي**: يتم دائماً إعادة تعيين `core` إلى `None` بعد اكتمال مهمة البدء (نجاح أو خطأ).

حارس التزامن:

- البدء أثناء التشغيل بالفعل يعيد `PTY session already running`.

### أنماط الإنشاء/الربط/الكتابة/القراءة/الإنهاء

- يتم فتح PTY عبر `portable_pty::native_pty_system().openpty(...)`.
- الأمر حالياً يُنفَّذ كـ `sh -lc <command>` مع `cwd` اختياري وتجاوزات البيئة.
- `write()` يرسل بايتات خام إلى stdin الـ PTY.
- `resize()` يُقيّد الأبعاد (`cols 20..400`، `rows 5..200`) ويستدعي تغيير حجم المُتحكم الرئيسي.
- `kill()` يُعلّم التشغيل كملغي ويقتل العملية الفرعية.

مسار المخرجات:

- خيط قارئ مخصص يقرأ تدفق المُتحكم الرئيسي،
- فك ترميز UTF-8 تدريجي مع استبدال `U+FFFD` عند البايتات غير الصالحة،
- يتم تمرير الأجزاء عبر استدعاء راجع آمن للخيوط N-API.

### دلالات الإلغاء والمهلة

- `timeoutMs` و `AbortSignal` يغذيان `CancelToken`.
- الحلقة تستدعي `ct.heartbeat()` دورياً؛ الإيقاف يُفعّل قتل العملية الفرعية.
- تصنيف المهلة يعتمد على السلسلة النصية (سلسلة فرعية `"Timeout"` في خطأ النبضة).

### سلوك الأخطاء

تشمل أسطح الأخطاء:

- فشل تخصيص/فتح PTY،
- فشل إنشاء عملية PTY،
- فشل الحصول على الكاتب/القارئ،
- فشل حالة/انتظار العملية الفرعية،
- تسمم القفل،
- انقطاع قناة التحكم (`PTY session is no longer available`).

فشل استدعاءات التحكم عندما لا يكون قيد التشغيل:

- `write/resize/kill` تعيد `PTY session is not running`.

## النظام الفرعي لشجرة العمليات (`ps`)

### نموذج الواجهة

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

غلاف TS يسجل أيضاً تكامل kill-tree الأصلي في الأدوات المشتركة عبر `setNativeKillTree(native.killTree)`.

### التنفيذ الخاص بالمنصة

- **Linux**: يقرأ بشكل تكراري `/proc/<pid>/task/<pid>/children`.
- **macOS**: يستخدم `libproc` `proc_listchildpids`.
- **Windows**: يأخذ لقطة لجدول العمليات باستخدام `CreateToolhelp32Snapshot`، يبني خريطة أب->أبناء، ويُنهي باستخدام `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### سلوك Kill-tree

- يتم جمع الأحفاد بشكل تكراري.
- ترتيب القتل من الأسفل إلى الأعلى (الأحفاد الأعمق أولاً) لتقليل إعادة تعيين الأبوة للعمليات اليتيمة.
- يتم قتل معرف العملية الجذر أخيراً.
- القيمة المُعادة هي عدد عمليات الإنهاء الناجحة.

سلوك الإشارة:

- POSIX: يتم تمرير `signal` المُقدم إلى `kill`.
- Windows: يتم تجاهل `signal`؛ الإنهاء هو إنهاء عملية غير مشروط.

### سلوك الأخطاء

هذه الوحدة مصممة عمداً لعدم إطلاق استثناءات على سطح الواجهة:

- يتم تخطي فروع شجرة العمليات المفقودة/غير القابلة للوصول،
- فشل القتل لكل معرف عملية يُحسب كغير ناجح (وليس أخطاء)،
- عدم العثور عادة يُنتج `[]` من `listDescendants` و `0` من `killTree`.

## النظام الفرعي لتحليل المفاتيح (`keys`)

### نموذج الواجهة

المساعدات المكشوفة:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### نموذج التحليل

يجمع المحلل بين:

- تعيينات بايت مفرد مباشرة (`enter`، `tab`، `ctrl+<letter>`، ASCII قابل للطباعة)،
- بحث تسلسل escape تقليدي بتعقيد O(1) (خريطة PHF)،
- تحليل xterm `modifyOtherKeys`،
- تحليل بروتوكول Kitty (`CSI u`، `CSI ~`، `CSI 1;...<letter>`)،
- تطبيع إلى معرفات المفاتيح (`ctrl+c`، `shift+tab`، `pageUp`، `f5`، إلخ).

معالجة المُعدِّلات:

- يتم مقارنة بتات shift/alt/ctrl فقط لمطابقة المفاتيح،
- يتم إخفاء بتات القفل قبل المقارنات.

سلوك التخطيط:

- الرجوع إلى التخطيط الأساسي مُقيَّد عمداً حتى لا تُنشئ التخطيطات المُعاد تعيينها مطابقات خاطئة للحروف/الرموز ASCII.

### سلوك الأخطاء

- التسلسلات غير المعروفة أو غير الصالحة تُنتج `null` من دوال التحليل.
- دوال المطابقة تعيد `false` عند فشل التحليل أو عدم التطابق.
- لا يوجد سطح استثناءات لإدخال مفاتيح مشوه.

## تعيين واجهة غلاف JS ↔ صادرات Rust

### Shell + PTY + العمليات

| واجهة غلاف TS | صادرة Rust N-API | ملاحظات |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | تنفيذ shell لمرة واحدة |
| `new Shell(options?)` | `Shell` class | جلسة shell مستمرة |
| `shell.run(options, onChunk?)` | `Shell::run` | يعيد استخدام الجلسة عند تدفق تحكم الإبقاء حياً |
| `shell.abort()` | `Shell::abort` | يلغي التشغيل النشط لذلك المثيل من shell |
| `new PtySession()` | `PtySession` class | جلسة PTY ذات حالة |
| `pty.start(options, onChunk?)` | `PtySession::start` | تشغيل PTY تفاعلي |
| `pty.write(data)` | `PtySession::write` | تمرير stdin الخام |
| `pty.resize(cols, rows)` | `PtySession::resize` | أبعاد طرفية مُقيَّدة |
| `pty.kill()` | `PtySession::kill` | يقتل قسرياً عملية PTY الفرعية النشطة |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | إنهاء شجرة العمليات بدءاً من الأبناء |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | قائمة الأحفاد التكرارية |

### المفاتيح

| واجهة غلاف TS | صادرة Rust N-API | ملاحظات |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | مطابقة نقطة رمز Kitty + المُعدِّل |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | محلل معرف المفتاح المُطبَّع |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | فحص خريطة التسلسل التقليدي بالضبط |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | نتيجة تحليل Kitty المُهيكلة |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | مُطابق المفاتيح عالي المستوى |

## تنظيف الجلسات المهجورة وملاحظات الإنهاء

- **جلسة Shell المستمرة**: إذا تم إلغاء/انتهاء مهلة/خطأ/تدفق تحكم غير إبقاء حي للتشغيل، يُسقط Rust صراحة حالة الجلسة الداخلية. التشغيلات الناجحة العادية تحتفظ بالجلسة لإعادة الاستخدام.
- **جلسة PTY**: يتم دائماً مسح `core` بعد انتهاء `start()`، بما في ذلك مسارات الفشل.
- **لا يوجد عقد قتل مدفوع بمُنهي JS صريح** مكشوف بواسطة الأغلفة؛ التنظيف مرتبط بشكل أساسي بمسارات اكتمال/إلغاء التشغيل. يجب على المستدعين استخدام `timeoutMs` أو `AbortSignal` أو `shell.abort()` أو `pty.kill()` للتفكيك الحتمي.
