---
title: الأدوات المخصصة
description: تسجيل الأدوات المخصصة، تعريف المخططات، وخط أنابيب التنفيذ لتوسيع الوكيل.
sidebar:
  order: 4
  label: الأدوات المخصصة
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# الأدوات المخصصة

الأدوات المخصصة هي دوال قابلة للاستدعاء من قبل النموذج تندمج في نفس خط أنابيب تنفيذ الأدوات المستخدم بواسطة الأدوات المدمجة.

الأداة المخصصة هي وحدة TypeScript/JavaScript تصدّر مصنعاً (factory). يستقبل المصنع واجهة برمجة المضيف (`CustomToolAPI`) ويعيد أداة واحدة أو مصفوفة من الأدوات.

## ما هذا (وما ليس كذلك)

- **الأداة المخصصة**: قابلة للاستدعاء من قبل النموذج أثناء الدور (`execute` + مخطط TypeBox).
- **الإضافة**: إطار دورة حياة/أحداث يمكنه تسجيل الأدوات واعتراض/تعديل الأحداث.
- **الخطاف**: سكربتات أوامر خارجية قبل/بعد التنفيذ.
- **المهارة**: حزمة إرشادات/سياق ثابتة، وليست شفرة أداة قابلة للتنفيذ.

إذا كنت بحاجة إلى أن يستدعي النموذج الشفرة مباشرة، استخدم أداة مخصصة.

## مسارات التكامل في الشفرة الحالية

هناك نمطان نشطان للتكامل:

1. **أدوات مخصصة مقدمة عبر SDK** (`options.customTools`)
   - يتم تغليفها في أدوات الوكيل عبر `CustomToolAdapter` أو مغلفات الإضافات.
   - تُضمّن دائماً في مجموعة الأدوات النشطة الأولية عند تهيئة SDK.

2. **وحدات مكتشفة من نظام الملفات عبر واجهة المُحمّل** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - مكشوفة كواجهات برمجة مكتبية في `src/extensibility/custom-tools/loader.ts`.
   - يمكن لشفرة المضيف استدعاؤها لاكتشاف وتحميل وحدات الأدوات من مسارات التكوين/المزود/الإضافات.

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## مواقع الاكتشاف (واجهة المُحمّل)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` يدمج:

1. مزودي القدرات (`toolCapability`)، بما في ذلك:
   - تكوين OMP الأصلي (`~/.xcsh/agent/tools`، `.xcsh/tools`)
   - تكوين Claude (`~/.claude/tools`، `.claude/tools`)
   - تكوين Codex (`~/.codex/tools`، `.codex/tools`)
   - مزود ذاكرة التخزين المؤقت لسوق إضافات Claude
2. بيانات الإضافات المثبتة (`~/.xcsh/plugins/node_modules/*` عبر مُحمّل الإضافات)
3. المسارات المكوّنة الصريحة المُمررة إلى المُحمّل

### سلوك مهم

- يتم إزالة التكرار من المسارات المحلولة المتكررة.
- تعارضات أسماء الأدوات تُرفض مقابل الأدوات المدمجة والأدوات المخصصة المحمّلة مسبقاً.
- ملفات `.md` و`.json` يتم اكتشافها كبيانات وصفية للأدوات بواسطة بعض المزودين، لكن مُحمّل الوحدات القابلة للتنفيذ يرفضها كأدوات قابلة للتشغيل.
- المسارات المكوّنة النسبية تُحلّ من `cwd`؛ ويتم توسيع `~`.

## عقد الوحدة

يجب أن تصدّر وحدة الأداة المخصصة دالة (يُفضل التصدير الافتراضي):

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

نوع القيمة المُرجعة من المصنع:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## السطح البرمجي المُمرر إلى المصانع (`CustomToolAPI`)

من `types.ts` و`loader.ts`:

- `cwd`: مجلد العمل الخاص بالمضيف
- `exec(command, args, options?)`: مساعد تنفيذ العمليات
- `ui`: سياق واجهة المستخدم (يمكن أن يكون بلا عملية في الأوضاع بدون واجهة)
- `hasUI`: `false` في التدفقات غير التفاعلية
- `logger`: مسجل ملفات مشترك
- `typebox`: `@sinclair/typebox` محقونة
- `pi`: تصديرات `@f5xc-salesdemos/xcsh` محقونة
- `pushPendingAction(action)`: تسجيل إجراء معاينة لأداة `resolve` المخفية (`docs/resolve-tool-runtime.md`)

يبدأ المُحمّل بسياق واجهة مستخدم بلا عملية ويتطلب من شفرة المضيف استدعاء `setUIContext(...)` عندما تكون واجهة المستخدم الحقيقية جاهزة.

## عقد التنفيذ والأنماط

توقيع `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` مُنمّط بشكل ثابت من مخطط TypeBox الخاص بك عبر `Static<TParams>`.
- يحدث التحقق من صحة المعاملات في وقت التشغيل قبل التنفيذ في حلقة الوكيل.
- `onUpdate` يبث نتائج جزئية لبث واجهة المستخدم.
- `ctx` يتضمن حالة الجلسة/النموذج ومساعد `abort()`.
- `signal` يحمل الإلغاء.

`CustomToolAdapter` يربط هذا بواجهة أداة الوكيل ويمرر الاستدعاءات بترتيب المعاملات الصحيح.

## كيف تُعرض الأدوات للنموذج

- يتم تغليف الأدوات في مثيلات `AgentTool` (`CustomToolAdapter` أو مغلفات الإضافات).
- يتم إدراجها في سجل أدوات الجلسة بالاسم.
- في تهيئة SDK، يتم إدراج الأدوات المخصصة والمسجلة عبر الإضافات بالقوة في المجموعة النشطة الأولية.
- `--tools` في واجهة سطر الأوامر يتحقق حالياً من أسماء الأدوات المدمجة فقط؛ إدراج الأدوات المخصصة يُعالج عبر مسارات الاكتشاف/التسجيل وخيارات SDK.

## خطافات العرض

خطافات عرض اختيارية:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

السلوك في وقت التشغيل في TUI:

- إذا كانت الخطافات موجودة، يُعرض مخرجات الأداة داخل حاوية `Box`.
- `renderResult` يستقبل `{ expanded, isPartial, spinnerFrame? }`.
- أخطاء العرض تُلتقط وتُسجل؛ تعود واجهة المستخدم إلى العرض النصي الافتراضي.

## معالجة الجلسة/الحالة

`onSession(event, ctx)` الاختيارية تستقبل أحداث دورة حياة الجلسة، بما في ذلك:

- `start`، `switch`، `branch`، `tree`، `shutdown`
- `auto_compaction_start`، `auto_compaction_end`
- `auto_retry_start`، `auto_retry_end`
- `ttsr_triggered`، `todo_reminder`

استخدم `ctx.sessionManager` لإعادة بناء الحالة من السجل عندما يتغير سياق الفرع/الجلسة.

## دلالات الفشل والإلغاء

### الفشل المتزامن/غير المتزامن

- رمي الاستثناءات (أو الوعود المرفوضة) في `execute` يُعامل كفشل أداة.
- يحول وقت تشغيل الوكيل حالات الفشل إلى رسائل نتيجة أداة مع `isError: true` ومحتوى نص الخطأ.
- مع مغلفات الإضافات، يمكن لمعالجات `tool_result` إعادة كتابة المحتوى/التفاصيل وحتى تجاوز حالة الخطأ.

### الإلغاء

- إلغاء الوكيل ينتشر عبر `AbortSignal` إلى `execute`.
- مرر `signal` إلى عمل العمليات الفرعية (`pi.exec(..., { signal })`) للإلغاء التعاوني.
- `ctx.abort()` يسمح للأداة بطلب إلغاء عملية الوكيل الحالية.

### أخطاء onSession

- أخطاء `onSession` تُلتقط وتُسجل كتحذيرات؛ ولا تتسبب في انهيار الجلسة.

## قيود حقيقية يجب التصميم لها

- أسماء الأدوات يجب أن تكون فريدة عالمياً في السجل النشط.
- يُفضل المخرجات الحتمية ذات الشكل المخططي في `details` لإعادة بناء العرض/الحالة.
- احمِ استخدام واجهة المستخدم بـ `pi.hasUI`.
- عامل ملفات `.md`/`.json` في مجلدات الأدوات كبيانات وصفية، وليس كوحدات قابلة للتنفيذ.
