---
title: الأدوات المخصصة
description: تسجيل الأدوات المخصصة، وتعريف المخطط، وخط أنابيب التنفيذ لتوسيع قدرات الوكيل.
sidebar:
  order: 4
  label: الأدوات المخصصة
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# الأدوات المخصصة

الأدوات المخصصة هي دوال قابلة للاستدعاء من النموذج وتندمج في نفس خط أنابيب تنفيذ الأدوات المدمجة.

الأداة المخصصة عبارة عن وحدة TypeScript/JavaScript تُصدِّر مصنعًا (factory). يستقبل المصنع واجهة برمجية للمضيف (`CustomToolAPI`) ويُعيد أداةً واحدة أو مصفوفة من الأدوات.

## ما هذا (وما ليس كذلك)

- **الأداة المخصصة**: قابلة للاستدعاء من النموذج خلال الدورة (`execute` + مخطط TypeBox).
- **الامتداد**: إطار دورة حياة/أحداث يمكنه تسجيل الأدوات واعتراض/تعديل الأحداث.
- **الخطاف (Hook)**: نصوص برمجية خارجية قبل/بعد الأوامر.
- **المهارة (Skill)**: حزمة توجيه/سياق ثابتة، وليست كودًا تنفيذيًا.

إذا كنت بحاجة إلى أن يستدعي النموذج كودًا مباشرةً، فاستخدم أداةً مخصصة.

## مسارات التكامل في الكود الحالي

هناك أسلوبان نشطان للتكامل:

1. **الأدوات المخصصة المقدَّمة من SDK** (`options.customTools`)
   - تُلفَّف داخل أدوات الوكيل عبر `CustomToolAdapter` أو أغلفة الامتداد.
   - تُدرج دائمًا في مجموعة الأدوات النشطة الأولية أثناء تهيئة SDK.

2. **الوحدات المكتشفة من نظام الملفات عبر واجهة المُحمِّل** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - مكشوفة كواجهات برمجية للمكتبة في `src/extensibility/custom-tools/loader.ts`.
   - يمكن لكود المضيف استدعاؤها لاكتشاف وتحميل وحدات الأدوات من مسارات الإعداد/الموفر/الإضافة.

```text
تدفق استدعاء أداة النموذج

استدعاء أداة LLM
   │
   ▼
سجل الأدوات (المدمجة + محوّلات الأدوات المخصصة)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> نتيجة جزئية مبثوثة
   └─ return result  -> محتوى/تفاصيل الأداة النهائية
```

## مواقع الاكتشاف (واجهة المُحمِّل)

تدمج `discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)`:

1. موفري القدرات (`toolCapability`)، بما في ذلك:
   - إعداد OMP الأصلي (`~/.xcsh/agent/tools`، `.xcsh/tools`)
   - إعداد Claude (`~/.claude/tools`، `.claude/tools`)
   - إعداد Codex (`~/.codex/tools`، `.codex/tools`)
   - موفر ذاكرة التخزين المؤقت لإضافات السوق الخاصة بـ Claude
2. بيانات الإضافات المثبتة (`~/.xcsh/plugins/node_modules/*` عبر مُحمِّل الإضافات)
3. المسارات المُعدَّة صراحةً والمُمررة إلى المُحمِّل

### سلوك مهم

- تُزال المسارات المحلولة المكررة تلقائيًا.
- يُرفض تعارض أسماء الأدوات مع الأدوات المدمجة والأدوات المخصصة المحملة مسبقًا.
- تُكتشف ملفات `.md` و`.json` كبيانات وصفية للأدوات من قِبل بعض الموفرين، لكن مُحمِّل الوحدات التنفيذية يرفضها كأدوات قابلة للتشغيل.
- تُحلُّ المسارات المُعدَّة النسبية انطلاقًا من `cwd`؛ ويُوسَّع رمز `~`.

## عقد الوحدة

يجب أن تُصدِّر وحدة الأداة المخصصة دالةً (يُفضَّل التصدير الافتراضي):

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

نوع إعادة المصنع:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## واجهة API المُمررة إلى المصانع (`CustomToolAPI`)

من `types.ts` و`loader.ts`:

- `cwd`: دليل العمل للمضيف
- `exec(command, args, options?)`: مساعد تنفيذ العمليات
- `ui`: سياق واجهة المستخدم (قد يكون بلا تأثير في الأوضاع غير التفاعلية)
- `hasUI`: `false` في التدفقات غير التفاعلية
- `logger`: مُسجِّل ملفات مشترك
- `typebox`: `@sinclair/typebox` مُحقَّن
- `pi`: صادرات `@f5xc-salesdemos/xcsh` المُحقَّنة
- `pushPendingAction(action)`: تسجيل إجراء معاينة لأداة `resolve` المخفية (`docs/resolve-tool-runtime.md`)

يبدأ المُحمِّل بسياق واجهة مستخدم بلا تأثير، ويستلزم أن يستدعي كود المضيف `setUIContext(...)` عندما تكون واجهة المستخدم الفعلية جاهزة.

## عقد التنفيذ والكتابة

توقيع `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- يُكتَب `params` بشكل ثابت من مخطط TypeBox الخاص بك عبر `Static<TParams>`.
- يحدث التحقق من صحة الوسيطات في وقت التشغيل قبل التنفيذ في حلقة الوكيل.
- يُصدِر `onUpdate` نتائج جزئية لبث واجهة المستخدم.
- يتضمن `ctx` حالة الجلسة/النموذج ومساعد `abort()`.
- يحمل `signal` إشارة الإلغاء.

يربط `CustomToolAdapter` هذا بواجهة أداة الوكيل ويُعيد توجيه الاستدعاءات بالترتيب الصحيح للوسيطات.

## كيفية كشف الأدوات للنموذج

- تُلفَّف الأدوات داخل مثيلات `AgentTool` (عبر `CustomToolAdapter` أو أغلفة الامتداد).
- تُدرج في سجل أدوات الجلسة بالاسم.
- في تهيئة SDK، تُدرج الأدوات المخصصة والمسجَّلة عبر الامتداد إدراجًا إجباريًا في المجموعة النشطة الأولية.
- يتحقق CLI `--tools` حاليًا من أسماء الأدوات المدمجة فقط؛ يُعالج إدراج الأدوات المخصصة عبر مسارات الاكتشاف/التسجيل وخيارات SDK.

## خطافات العرض

خطافات العرض الاختيارية:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

سلوك وقت التشغيل في TUI:

- إذا وُجدت خطافات، يُعرض ناتج الأداة داخل حاوية `Box`.
- يستقبل `renderResult` القيمة `{ expanded, isPartial, spinnerFrame? }`.
- تُلتقط أخطاء العارض وتُسجَّل؛ تعود واجهة المستخدم إلى العرض النصي الافتراضي.

## معالجة الجلسة/الحالة

يستقبل `onSession(event, ctx)` الاختياري أحداث دورة حياة الجلسة، بما في ذلك:

- `start`، `switch`، `branch`، `tree`، `shutdown`
- `auto_compaction_start`، `auto_compaction_end`
- `auto_retry_start`، `auto_retry_end`
- `ttsr_triggered`، `todo_reminder`

استخدم `ctx.sessionManager` لإعادة بناء الحالة من السجل عند تغيير سياق الفرع/الجلسة.

## دلالات الفشل والإلغاء

### الفشل المتزامن/غير المتزامن

- يُعامَل الإلقاء (أو الوعود المرفوضة) في `execute` باعتباره فشلًا في الأداة.
- يحوِّل وقت تشغيل الوكيل الفشل إلى رسائل نتائج أداة تحمل `isError: true` ومحتوى نصي يصف الخطأ.
- مع أغلفة الامتداد، يمكن لمعالجات `tool_result` إعادة كتابة المحتوى/التفاصيل بل وتجاوز حالة الخطأ.

### الإلغاء

- يُشاع إلغاء الوكيل عبر `AbortSignal` إلى `execute`.
- مرِّر `signal` إلى عمل العمليات الفرعية (`pi.exec(..., { signal })`) للإلغاء التعاوني.
- يتيح `ctx.abort()` للأداة طلب إلغاء عملية الوكيل الجارية.

### أخطاء onSession

- تُلتقط أخطاء `onSession` وتُسجَّل كتحذيرات؛ ولا تُوقف الجلسة.

## قيود حقيقية يجب مراعاتها في التصميم

- يجب أن تكون أسماء الأدوات فريدةً عالميًا في السجل النشط.
- يُفضَّل استخدام مخرجات محددة وفق المخطط في `details` لإعادة بناء العارض/الحالة.
- احرص على الحماية عند استخدام واجهة المستخدم مع `pi.hasUI`.
- عامِل ملفات `.md`/`.json` في أدلة الأدوات على أنها بيانات وصفية لا وحدات تنفيذية.
