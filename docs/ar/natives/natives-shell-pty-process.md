---
title: الغلاف الأصلي، PTY، العملية، ومداخل الأحداث الرئيسية
description: >-
  تنفيذ الغلاف، إدارة PTY، دورة حياة العملية، ومعالجة أحداث لوحة المفاتيح في
  الطبقة الأصلية.
sidebar:
  order: 4
  label: الغلاف، PTY والعملية
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# الغلاف الأصلي، PTY، العملية، ومداخل الأحداث الرئيسية

تتناول هذه الوثيقة **العناصر الأولية للتنفيذ/العملية/الطرفية** في `@f5xc-salesdemos/pi-natives`: `shell`، و`pty`، و`ps`، و`keys`، باستخدام مصطلحات البنية المعمارية من `docs/natives-architecture.md`.

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

- **طبقة الغلاف/API الخاصة بـ TS** (`packages/natives/src/*`): نقاط دخول مكتوبة بأنواع، وسطح الإلغاء (`timeoutMs`، `AbortSignal`)، وميزات تسهيل استخدام JS.
- **طبقة وحدة Rust N-API** (`crates/pi-natives/src/*`): تنفيذ عمليات shell/PTY، اجتياز شجرة العمليات/إنهاؤها، وتحليل تسلسلات المفاتيح.
- **بوابة التحقق** (`native.ts`، على مستوى البنية المعمارية): تضمن وجود الصادرات المطلوبة (`Shell`، `executeShell`، `PtySession`، `killTree`، `listDescendants`، مساعدات المفاتيح) قبل استخدام الأغلفة.

## النظام الفرعي للغلاف (`shell`)

### نموذج API

يتم كشف وضعين للتنفيذ:

1. **تنفيذ مرة واحدة** عبر `executeShell(options, onChunk?)`.
2. **جلسة مستمرة** عبر `new Shell(options?)` ثم تشغيل `shell.run(...)` مراراً.

كلاهما يبثّ المخرجات عبر استدعاء راجع آمن للخيوط ويُعيد `{ exitCode?, cancelled, timedOut }`.

### إنشاء الجلسة ونموذج البيئة

يُنشئ Rust الكائن `brush_core::Shell` بالإعدادات التالية:

- وضع غير تفاعلي،
- `do_not_inherit_env: true`،
- إعادة بناء صريحة للبيئة من بيئة المضيف،
- قائمة استبعاد للمتغيرات الحساسة للغلاف (`PS1`، `PWD`، `SHLVL`، صادرات دوال bash، إلخ.).

سلوك بيئة الجلسة:

- يُطبَّق `ShellOptions.sessionEnv` مرة واحدة عند إنشاء الجلسة.
- يقتصر `ShellRunOptions.env` على نطاق الأمر (`EnvironmentScope::Command`) ويُزال بعد كل تشغيل.
- يُدمج `PATH` بشكل خاص على Windows مع إزالة التكرارات بطريقة لا تفرّق بين حالة الأحرف.

إثراء المسار على Windows فقط (`shell/windows.rs`): تُضاف مسارات Git-for-Windows المكتشفة (`cmd`، `bin`، `usr/bin`) إذا كانت موجودة ولم تُدرج مسبقاً.

### دورة حياة وقت التشغيل وانتقالات الحالة

تستخدم عملية الغلاف المستمرة (`Shell.run`) آلة الحالة التالية:

- **خامل/غير مهيأ**: `session: None`.
- **قيد التشغيل**: يُنشئ أول `run()` الجلسة بشكل كسول، ويخزّن رمز `current_abort`، وينفّذ الأمر.
- **مكتمل + إبقاء على قيد الحياة**: إذا كان تدفق التحكم في التنفيذ `Normal`، يُمسح `current_abort` وتُعاد استخدام الجلسة.
- **مكتمل + إنهاء**: إذا كان تدفق التحكم مرتبطاً بحلقة/سكريبت/خروج من الغلاف (`BreakLoop`، `ContinueLoop`، `ReturnFromFunctionOrScript`، `ExitShell`)، تُسقط الجلسة (`session: None`).
- **ملغى/انتهت مهلته**: يُلغى تشغيل المهمة، انتظار رشيق (2 ثانية)، ثم إلغاء قسري؛ وتُسقط الجلسة.
- **خطأ**: تُسقط الجلسة.

يُنشئ الغلاف أحادي التشغيل (`executeShell`) دائماً جلسة جديدة ويُسقطها في كل استدعاء.

### سلوك البث والمخرجات

- يُوجَّه stdout/stderr إلى أنبوب مشترك ويُقرأان بشكل متزامن.
- يُفكّك القارئ UTF-8 بشكل تدريجي؛ وتُصدر تسلسلات البايت غير الصالحة قطع `U+FFFD` بديلة.
- بعد اكتمال العملية، يخضع تصريف المخرجات لحراسات خمول/حد أقصى (`250ms` خمول، `2s` حد أقصى) لتجنب التعليق بسبب وظائف الخلفية التي تُبقي المواصفات مفتوحة.

### الإلغاء والمهلة ووظائف الخلفية

- يُبنى `CancelToken` من `timeoutMs` وإشارة `AbortSignal` الاختيارية.
- عند الإلغاء/انتهاء المهلة، يُشغَّل رمز الإلغاء للغلاف، ثم تحصل المهمة على نافذة رشيقة مدتها 2 ثانية قبل الإلغاء القسري.
- إذا حدث الإلغاء، تُنهى وظائف الخلفية (`TERM`، ثم `KILL` المتأخرة) باستخدام بيانات وظيفة brush.

سلوك `Shell.abort()`:

- يُلغي فقط الأمر الجاري تشغيله لتلك النسخة من `Shell`،
- يُعدّ عملية ناجحة لا شيء عندما لا يكون هناك شيء يعمل.

### سلوك الفشل

تشمل الأخطاء الشائعة التي تظهر:

- أخطاء تهيئة الجلسة (`Failed to initialize shell`)،
- أخطاء مجلد العمل الحالي (`Failed to set cwd`)،
- أخطاء تعيين/إزالة البيئة،
- أخطاء مصدر اللقطة،
- أخطاء إنشاء/استنساخ الأنبوب،
- فشل التنفيذ (`Shell execution failed: ...`)،
- أخطاء غلاف المهمة (`Shell execution task failed: ...`).

أعلام الإلغاء على مستوى النتيجة:

- انتهاء المهلة -> `exitCode: undefined`، `timedOut: true`.
- إشارة الإلغاء -> `exitCode: undefined`، `cancelled: true`.

## النظام الفرعي لـ PTY (`pty`)

### نموذج API

تُكشف `new PtySession()` عن:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### دورة حياة وقت التشغيل وانتقالات الحالة

آلة حالة `PtySession`:

- **خامل**: `core: None`.
- **محجوز**: تُثبّت `start()` قناة التحكم بشكل متزامن (`core: Some`) قبل بدء العمل غير المتزامن، مما يجعل `write/resize/kill` صالحة فوراً.
- **قيد التشغيل**: تتعامل حلقة PTY المحجوبة مع حالة الطفل، وأحداث القارئ، ونبضات قلب الإلغاء، ورسائل التحكم.
- **الطرفية مغلقة**: خروج الطفل + اكتمال القارئ.
- **نهائي**: يُعاد ضبط `core` دائماً إلى `None` بعد اكتمال مهمة البدء (نجاحاً أو خطأً).

حارس التزامن:

- يُعيد البدء أثناء التشغيل المسبق `PTY session already running`.

### أنماط الإنشاء/الإرفاق/الكتابة/القراءة/الإنهاء

- يُفتح PTY عبر `portable_pty::native_pty_system().openpty(...)`.
- يعمل الأمر حالياً كـ `sh -lc <command>` مع تجاوزات `cwd` والبيئة الاختيارية.
- يُرسل `write()` بايتات خام إلى stdin الـ PTY.
- يقيّد `resize()` الأبعاد (`cols 20..400`، `rows 5..200`) ويستدعي تغيير حجم المسيطر.
- يُعلّم `kill()` التشغيل كملغى ويقتل العملية الفرعية.

مسار المخرجات:

- خيط قارئ مخصص يقرأ تدفق المسيطر،
- فك تشفير UTF-8 التدريجي مع استبدال `U+FFFD` للبايتات غير الصالحة،
- القطع المُمرَّرة عبر الاستدعاء الراجع الآمن للخيوط في N-API.

### دلالات الإلغاء والمهلة

- يُغذّي `timeoutMs` و`AbortSignal` الكائن `CancelToken`.
- تستدعي الحلقة `ct.heartbeat()` بشكل دوري؛ ويُشغّل الإلغاء قتل الطفل.
- يعتمد تصنيف المهلة على السلسلة النصية (السلسلة الفرعية `"Timeout"` في خطأ نبضة القلب).

### سلوك الفشل

تشمل أسطح الأخطاء:

- فشل تخصيص/فتح PTY،
- فشل إنشاء PTY،
- فشل الحصول على الكاتب/القارئ،
- أخطاء حالة/انتظار الطفل،
- تسمم الأقفال،
- انقطاع قناة التحكم (`PTY session is no longer available`).

أخطاء استدعاءات التحكم عند عدم التشغيل:

- تُعيد `write/resize/kill` الخطأ `PTY session is not running`.

## النظام الفرعي لشجرة العمليات (`ps`)

### نموذج API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

يُسجّل غلاف TS أيضاً تكامل قتل الشجرة الأصلي في أدوات مساعدة مشتركة عبر `setNativeKillTree(native.killTree)`.

### التنفيذ المحدد للمنصة

- **Linux**: يقرأ بشكل متكرر `/proc/<pid>/task/<pid>/children`.
- **macOS**: يستخدم `libproc` و`proc_listchildpids`.
- **Windows**: يأخذ لقطة لجدول العمليات باستخدام `CreateToolhelp32Snapshot`، ويبني خريطة أب->أبناء، وينهي العمليات باستخدام `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### سلوك قتل الشجرة

- يُجمع الأحفاد بشكل متكرر.
- يكون ترتيب القتل من الأسفل إلى الأعلى (أعمق الأحفاد أولاً) للحد من إعادة تبنّي الأيتام.
- يُقتل معرّف العملية الجذرية أخيراً.
- القيمة المُعادة هي عدد عمليات الإنهاء الناجحة.

سلوك الإشارة:

- POSIX: تُمرَّر `signal` المقدمة إلى `kill`.
- Windows: يُتجاهل `signal`؛ الإنهاء هو إنهاء غير مشروط للعملية.

### سلوك الفشل

هذه الوحدة مصممة عمداً بحيث لا تُلقي أخطاء على مستوى API:

- تُتخطى فروع شجرة العمليات المفقودة/غير القابلة للوصول،
- تُحسب أخطاء قتل العمليات المنفردة كغير ناجحة (لا كأخطاء)،
- يُنتج فشل البحث عادةً `[]` من `listDescendants` و`0` من `killTree`.

## النظام الفرعي لتحليل المفاتيح (`keys`)

### نموذج API

المساعدات المكشوفة:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### نموذج التحليل

يجمع المحلل بين:

- تعيينات بايت مفرد مباشرة (`enter`، `tab`، `ctrl+<letter>`، ASCII قابل للطباعة)،
- بحث O(1) في تسلسل الهروب القديم (خريطة PHF)،
- تحليل `modifyOtherKeys` الخاصة بـ xterm،
- تحليل بروتوكول Kitty (`CSI u`، `CSI ~`، `CSI 1;...<letter>`)،
- التطبيع إلى معرّفات المفاتيح (`ctrl+c`، `shift+tab`، `pageUp`، `f5`، إلخ.).

معالجة المُعدِّلات:

- تُقارن فقط بتات shift/alt/ctrl لمطابقة المفاتيح،
- تُخفى بتات القفل قبل المقارنات.

سلوك التخطيط:

- يكون الرجوع إلى التخطيط الأساسي مقيّداً عمداً حتى لا تُنشئ التخطيطات المُعاد تعيينها تطابقات زائفة للحروف/الرموز ASCII.

### سلوك الفشل

- تُنتج التسلسلات غير المعروفة أو غير الصالحة `null` من دوال التحليل.
- تُعيد دوال المطابقة `false` عند فشل التحليل أو عدم التطابق.
- لا يوجد سطح لإلقاء الأخطاء عند إدخال مفاتيح مشوهة.

## تعيين API غلاف JS ↔ صادرات Rust

### الغلاف + PTY + العملية

| API غلاف TS | صادرة Rust N-API | ملاحظات |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | تنفيذ غلاف مرة واحدة |
| `new Shell(options?)` | الصنف `Shell` | جلسة غلاف مستمرة |
| `shell.run(options, onChunk?)` | `Shell::run` | يُعيد استخدام الجلسة عند تدفق التحكم بالإبقاء على قيد الحياة |
| `shell.abort()` | `Shell::abort` | يُلغي التشغيل النشط لتلك النسخة من الغلاف |
| `new PtySession()` | الصنف `PtySession` | جلسة PTY ذات حالة |
| `pty.start(options, onChunk?)` | `PtySession::start` | تشغيل PTY تفاعلي |
| `pty.write(data)` | `PtySession::write` | تمرير stdin الخام مباشرةً |
| `pty.resize(cols, rows)` | `PtySession::resize` | أبعاد طرفية مقيّدة |
| `pty.kill()` | `PtySession::kill` | يقتل طفل PTY النشط قسراً |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | إنهاء شجرة العمليات بدءاً من الأبناء |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | سرد الأحفاد بشكل متكرر |

### المفاتيح

| API غلاف TS | صادرة Rust N-API | ملاحظات |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | مطابقة نقطة كود Kitty + مُعدِّل |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | محلل معرّف المفتاح المطبَّع |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | فحص خريطة التسلسل القديم الدقيق |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | نتيجة تحليل Kitty المهيكلة |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | مطابق مفاتيح عالي المستوى |

## ملاحظات تنظيف الجلسات المهجورة والتهيئة النهائية

- **جلسة الغلاف المستمرة**: إذا أُلغي تشغيل ما أو انتهت مهلته أو أخفق أو كان تدفق التحكم غير إبقائي، يُسقط Rust صراحةً حالة الجلسة الداخلية. تُحافظ عمليات التشغيل الطبيعية الناجحة على الجلسة لإعادة استخدامها.
- **جلسة PTY**: يُمسح `core` دائماً بعد اكتمال `start()`، بما في ذلك مسارات الفشل.
- **لا يوجد عقد قتل صريح مُشغَّل بالمُنهي في JS** مكشوف من قِبل الأغلفة؛ يرتبط التنظيف بشكل أساسي بمسارات اكتمال/إلغاء التشغيل. يجب على المستدعين استخدام `timeoutMs` أو `AbortSignal` أو `shell.abort()` أو `pty.kill()` للإنهاء الحتمي.
