---
title: الغلاف الأصلي وPTY والعملية ومفاتيح الداخلية
description: >-
  تنفيذ الغلاف وإدارة PTY ودورة حياة العملية ومعالجة أحداث المفاتيح في الطبقة
  الأصلية.
sidebar:
  order: 4
  label: الغلاف وPTY والعملية
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# الغلاف الأصلي وPTY والعملية ومفاتيح الداخلية

تتناول هذه الوثيقة **العمليات الأولية للتنفيذ/العملية/الطرفية** في `@f5-sales-demo/pi-natives`: `shell` و`pty` و`ps` و`keys`، باستخدام المصطلحات المعمارية من `docs/natives-architecture.md`.

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

- **طبقة غلاف/API في TypeScript** (`packages/natives/src/*`): نقاط دخول مكتوبة بالأنواع، وسطح الإلغاء (`timeoutMs`، `AbortSignal`)، وبيئة JavaScript.
- **طبقة وحدة Rust N-API** (`crates/pi-natives/src/*`): تنفيذ عملية الغلاف/PTY، واجتياز شجرة العمليات/إنهاؤها، وتحليل تسلسلات المفاتيح.
- **بوابة التحقق** (`native.ts`، على مستوى المعمارية): تضمن وجود الصادرات المطلوبة (`Shell`، `executeShell`، `PtySession`، `killTree`، `listDescendants`، ومساعدات المفاتيح) قبل استخدام الأغلفة.

## النظام الفرعي للغلاف (`shell`)

### نموذج API

يتم عرض وضعَي تنفيذ:

1. **لقطة واحدة** عبر `executeShell(options, onChunk?)`.
2. **جلسة دائمة** عبر `new Shell(options?)` ثم `shell.run(...)` بصورة متكررة.

يقوم كلاهما ببث الإخراج من خلال استدعاء خلفي آمن للخيوط ويعيد `{ exitCode?, cancelled, timedOut }`.

### إنشاء الجلسة ونموذج البيئة

ينشئ Rust `brush_core::Shell` بالإعدادات التالية:

- وضع غير تفاعلي،
- `do_not_inherit_env: true`،
- إعادة بناء صريحة للبيئة من بيئة المضيف،
- قائمة تجاهل للمتغيرات الحساسة للغلاف (`PS1`، `PWD`، `SHLVL`، صادرات دوال bash، إلخ).

سلوك بيئة الجلسة:

- يُطبَّق `ShellOptions.sessionEnv` مرة واحدة عند إنشاء الجلسة.
- يقتصر `ShellRunOptions.env` على نطاق الأمر (`EnvironmentScope::Command`) ويُزال بعد كل تشغيل.
- يُدمج `PATH` بشكل خاص على Windows مع إزالة التكرار غير الحساس لحالة الأحرف.

إثراء المسار الخاص بـ Windows فقط (`shell/windows.rs`): تُلحق مسارات Git-for-Windows المكتشفة (`cmd`، `bin`، `usr/bin`) إذا كانت موجودة ولم تُضمَّن مسبقاً.

### دورة حياة وقت التشغيل وانتقالات الحالة

يستخدم الغلاف الدائم (`Shell.run`) آلة الحالة التالية:

- **خامل/غير مُهيأ**: `session: None`.
- **قيد التشغيل**: أول استدعاء لـ `run()` ينشئ الجلسة بشكل كسول، ويخزن رمز `current_abort`، وينفذ الأمر.
- **مكتمل + استمرارية**: إذا كان تدفق التحكم في التنفيذ `Normal`، يُمسح `current_abort` وتُعاد استخدام الجلسة.
- **مكتمل + إنهاء**: إذا كان تدفق التحكم متعلقاً بالحلقة/النص البرمجي/خروج الغلاف (`BreakLoop`، `ContinueLoop`، `ReturnFromFunctionOrScript`، `ExitShell`)، تُسقط الجلسة (`session: None`).
- **مُلغى/انتهت مهلته**: تُلغى مهمة التشغيل، وانتظار سماح (2 ثانية)، ثم إلغاء قسري؛ وتُسقط الجلسة.
- **خطأ**: تُسقط الجلسة.

يقوم الغلاف أحادي الاستخدام (`executeShell`) دائماً بإنشاء جلسة جديدة وإسقاطها لكل استدعاء.

### سلوك البث/الإخراج

- يُوجَّه كلٌّ من stdout وstderr إلى أنبوب مشترك ويُقرأان بصورة متزامنة.
- يفك القارئ ترميز UTF-8 بشكل تدريجي؛ وتُصدر تسلسلات البايت غير الصالحة قطعاً بديلة `U+FFFD`.
- بعد اكتمال العملية، يخضع استنزاف الإخراج لحراسي خمول وأقصى مدة (`250ms` خمول، `2s` أقصى) لتفادي التوقف بسبب المهام الخلفية التي تبقي واصفات البيانات مفتوحة.

### الإلغاء والمهلة والمهام الخلفية

- يُنشأ `CancelToken` من `timeoutMs` والإشارة الاختيارية `AbortSignal`.
- عند الإلغاء/انتهاء المهلة، يُشغَّل رمز إلغاء الغلاف، ثم تحصل المهمة على نافذة سماح لمدة ثانيتين قبل الإلغاء القسري.
- إذا حدث الإلغاء، تُنهى المهام الخلفية (`TERM`، ثم `KILL` بعد تأخير) باستخدام بيانات وظائف brush.

سلوك `Shell.abort()`:

- يُلغي فقط الأمر الجاري تشغيله لتلك النسخة من `Shell`،
- لا يُنفِّذ شيئاً عند عدم وجود تشغيل نشط.

### سلوك الفشل

تشمل الأخطاء الشائعة التي تظهر:

- فشل تهيئة الجلسة (`Failed to initialize shell`)،
- أخطاء مجلد العمل الحالي (`Failed to set cwd`)،
- فشل تعيين/إزالة البيئة،
- فشل مصدر اللقطة،
- فشل إنشاء/استنساخ الأنبوب،
- فشل التنفيذ (`Shell execution failed: ...`)،
- فشل غلاف المهمة (`Shell execution task failed: ...`).

علامات الإلغاء على مستوى النتيجة:

- انتهاء المهلة -> `exitCode: undefined`، `timedOut: true`.
- إشارة الإلغاء -> `exitCode: undefined`، `cancelled: true`.

## النظام الفرعي لـ PTY (`pty`)

### نموذج API

يعرض `new PtySession()`:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### دورة حياة وقت التشغيل وانتقالات الحالة

آلة حالة `PtySession`:

- **خامل**: `core: None`.
- **محجوز**: تُثبِّت `start()` قناة التحكم بصورة متزامنة (`core: Some`) قبل بدء العمل غير المتزامن، مما يجعل `write/resize/kill` صالحة فوراً.
- **قيد التشغيل**: تعالج حلقة PTY المحجوبة حالة العملية الفرعية وأحداث القارئ ونبضات الإلغاء ورسائل التحكم.
- **مغلق الطرفية**: خروج العملية الفرعية + اكتمال القارئ.
- **منتهٍ**: يُعاد تعيين `core` إلى `None` دائماً بعد اكتمال مهمة البدء (نجاحاً أو خطأً).

حارس التزامن:

- يُعيد البدء أثناء التشغيل الفعلي `PTY session already running`.

### أنماط الإنشاء/الإرفاق/الكتابة/القراءة/الإنهاء

- يُفتح PTY عبر `portable_pty::native_pty_system().openpty(...)`.
- يعمل الأمر حالياً كـ `sh -lc <command>` مع تجاوزات اختيارية لـ `cwd` والبيئة.
- يُرسل `write()` بايتات خام إلى stdin لـ PTY.
- يُثبِّت `resize()` الأبعاد (`cols 20..400`، `rows 5..200`) ويستدعي تغيير حجم الرئيسي.
- يُعلِّم `kill()` التشغيل ملغىً ويقتل العملية الفرعية.

مسار الإخراج:

- يقرأ خيط قارئ مخصص دفق الرئيسي،
- فك ترميز UTF-8 التدريجي مع استبدال `U+FFFD` عند البايتات غير الصالحة،
- تُعاد توجيه القطع عبر استدعاء N-API الخلفي الآمن للخيوط.

### دلالات الإلغاء والمهلة

- يُغذِّي `timeoutMs` و`AbortSignal` `CancelToken`.
- تستدعي الحلقة `ct.heartbeat()` دورياً؛ ويُشغِّل الإلغاءُ قتلَ العملية الفرعية.
- يعتمد تصنيف المهلة على النص (`"Timeout"` كجزء من نص خطأ نبضة القلب).

### سلوك الفشل

تشمل أسطح الأخطاء:

- فشل تخصيص/فتح PTY،
- فشل إنشاء PTY،
- فشل الحصول على الكاتب/القارئ،
- فشل حالة/انتظار العملية الفرعية،
- تسمم القفل،
- قطع قناة التحكم (`PTY session is no longer available`).

فشل استدعاءات التحكم عند عدم التشغيل:

- تُعيد `write/resize/kill` `PTY session is not running`.

## النظام الفرعي لشجرة العمليات (`ps`)

### نموذج API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

كما يُسجِّل غلاف TypeScript تكامل kill-tree الأصلي في الأدوات المشتركة عبر `setNativeKillTree(native.killTree)`.

### التنفيذ الخاص بالمنصة

- **Linux**: يقرأ بشكل تعاودي `/proc/<pid>/task/<pid>/children`.
- **macOS**: يستخدم `libproc` `proc_listchildpids`.
- **Windows**: يأخذ لقطة لجدول العمليات بـ `CreateToolhelp32Snapshot`، ويبني خريطة الوالد->الأبناء، وينهي بـ `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### سلوك kill-tree

- تُجمع العمليات الفرعية بشكل تعاودي.
- يكون ترتيب القتل من الأسفل إلى الأعلى (العمليات الفرعية الأعمق أولاً) للحد من إعادة تبني الأيتام.
- يُقتل pid الجذر أخيراً.
- تكون قيمة الإرجاع هي عدد الإنهاءات الناجحة.

سلوك الإشارة:

- POSIX: يُمرَّر `signal` المُقدَّم إلى `kill`.
- Windows: يُتجاهل `signal`؛ والإنهاء هو إنهاء غير مشروط للعملية.

### سلوك الفشل

هذه الوحدة مصممة عمداً لعدم إطلاق أخطاء على مستوى الواجهة:

- تُتخطى فروع شجرة العمليات المفقودة/غير القابلة للوصول،
- تُحسب إخفاقات قتل pid كل منها كغير ناجحة (وليست أخطاء)،
- عادةً ما تُنتج فجوة البحث `[]` من `listDescendants` و`0` من `killTree`.

## النظام الفرعي لتحليل المفاتيح (`keys`)

### نموذج API

المساعدات المعروضة:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### نموذج التحليل

يجمع المحلل:

- تعيينات مباشرة أحادية البايت (`enter`، `tab`، `ctrl+<letter>`، ASCII قابل للطباعة)،
- بحث O(1) في تسلسل الهروب القديم (خريطة PHF)،
- تحليل `modifyOtherKeys` لـ xterm،
- تحليل بروتوكول Kitty (`CSI u`، `CSI ~`، `CSI 1;...<letter>`)،
- تطبيع إلى معرِّفات المفاتيح (`ctrl+c`، `shift+tab`، `pageUp`، `f5`، إلخ).

معالجة المُعدِّل:

- تُقارَن فقط بتات shift/alt/ctrl لمطابقة المفاتيح،
- تُقنَّع بتات القفل قبل المقارنات.

سلوك التخطيط:

- يُقيَّد الرجوع إلى التخطيط الأساسي عمداً حتى لا تُنشئ التخطيطات المعاد تعيينها تطابقات زائفة للأحرف/الرموز ASCII.

### سلوك الفشل

- تُنتج التسلسلات غير المعروفة أو غير الصالحة `null` من دوال التحليل.
- تُعيد دوال المطابقة `false` عند فشل التحليل أو عدم التطابق.
- لا يوجد سطح خطأ مُطلَق لإدخال المفاتيح المشوه.

## تعيين واجهة JS للغلاف ↔ صادرات Rust

### الغلاف + PTY + العملية

| واجهة غلاف TypeScript | صادر Rust N-API | ملاحظات |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | تنفيذ غلاف أحادي الاستخدام |
| `new Shell(options?)` | فئة `Shell` | جلسة غلاف دائمة |
| `shell.run(options, onChunk?)` | `Shell::run` | يُعيد استخدام الجلسة عند تدفق التحكم باستمرارية |
| `shell.abort()` | `Shell::abort` | يُلغي التشغيل النشط لتلك النسخة من الغلاف |
| `new PtySession()` | فئة `PtySession` | جلسة PTY ذات حالة |
| `pty.start(options, onChunk?)` | `PtySession::start` | تشغيل PTY تفاعلي |
| `pty.write(data)` | `PtySession::write` | تمرير مباشر لـ stdin الخام |
| `pty.resize(cols, rows)` | `PtySession::resize` | أبعاد طرفية محدودة |
| `pty.kill()` | `PtySession::kill` | قتل قسري للعملية الفرعية النشطة في PTY |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | إنهاء شجرة العمليات بدءاً من الأبناء |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | قائمة تعاودية بالعمليات الفرعية |

### المفاتيح

| واجهة غلاف TypeScript | صادر Rust N-API | ملاحظات |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | مطابقة codepoint+modifier لـ Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | محلل معرِّف المفتاح المُطبَّع |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | فحص خريطة التسلسل القديم الدقيق |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | نتيجة تحليل Kitty المهيكلة |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | مطابقة مفاتيح عالية المستوى |

## ملاحظات تنظيف الجلسات المهجورة والإنهاء

- **جلسة الغلاف الدائمة**: إذا أُلغي تشغيل ما أو انتهت مهلته أو أخفق أو كان تدفق التحكم من غير النوع الاستمراري، يُسقط Rust صراحةً حالة الجلسة الداخلية. تحتفظ عمليات التشغيل العادية الناجحة بالجلسة لإعادة الاستخدام.
- **جلسة PTY**: يُمسح `core` دائماً بعد انتهاء `start()`، بما في ذلك مسارات الفشل.
- **لا يُعرض عقد قتل صريح مدفوع بمُنهي JS** من قِبل الأغلفة؛ يرتبط التنظيف أساساً بمسارات اكتمال التشغيل/الإلغاء. يجب على المستدعين استخدام `timeoutMs` أو `AbortSignal` أو `shell.abort()` أو `pty.kill()` للإنهاء الحتمي.
