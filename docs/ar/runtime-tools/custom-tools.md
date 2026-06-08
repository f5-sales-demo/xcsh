---
title: Custom Tools
description: تسجيل الأدوات المخصصة وتعريف المخططات وخط أنابيب التنفيذ لتوسيع الوكيل.
sidebar:
  order: 4
  label: أدوات مخصصة
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# الأدوات المخصصة

الأدوات المخصصة هي دوال قابلة للاستدعاء بواسطة النموذج تندمج في نفس خط أنابيب تنفيذ الأدوات المُدمجة.

الأداة المخصصة هي وحدة TypeScript/JavaScript تُصدّر مصنعًا (factory). يستقبل المصنع واجهة برمجة المضيف (`CustomToolAPI`) ويُعيد أداة واحدة أو مصفوفة من الأدوات.

## ما هو هذا (وما ليس كذلك)

- **أداة مخصصة**: قابلة للاستدعاء بواسطة النموذج أثناء الدور (`execute` + مخطط TypeBox).
- **إضافة (Extension)**: إطار دورة حياة/أحداث يمكنه تسجيل الأدوات واعتراض/تعديل الأحداث.
- **خطاف (Hook)**: سكربتات أوامر خارجية تُنفذ قبل/بعد الأمر.
- **مهارة (Skill)**: حزمة إرشادات/سياق ثابتة، وليست شفرة أداة قابلة للتنفيذ.

إذا كنت تحتاج أن يستدعي النموذج شفرة مباشرة، استخدم أداة مخصصة.

## مسارات التكامل في الشفرة الحالية

هناك نمطان نشطان للتكامل:

1. **الأدوات المخصصة المقدمة عبر SDK** (`options.customTools`)
   - يتم تغليفها في أدوات الوكيل عبر `CustomToolAdapter` أو أغلفة الإضافات.
   - تُضمّن دائمًا في مجموعة الأدوات النشطة الأولية عند تهيئة SDK.

2. **الوحدات المكتشفة من نظام الملفات عبر واجهة المُحمّل** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - مُعرضة كواجهات برمجة مكتبية في `src/extensibility/custom-tools/loader.ts`.
   - يمكن لشفرة المضيف استدعاء هذه الواجهات لاكتشاف وتحميل وحدات الأدوات من مسارات التكوين/المزود/الإضافات.

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

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` تدمج:

1. مزودي القدرات (`toolCapability`)، بما في ذلك:
   - تكوين OMP الأصلي (`~/.xcsh/agent/tools`، `.xcsh/tools`)
   - تكوين Claude (`~/.claude/tools`، `.claude/tools`)
   - تكوين Codex (`~/.codex/tools`، `.codex/tools`)
   - مزود ذاكرة التخزين المؤقت لسوق إضافات Claude
2. بيانات الإضافات المُثبتة (`~/.xcsh/plugins/node_modules/*` عبر مُحمّل الإضافات)
3. المسارات المُكوّنة الصريحة المُمررة إلى المُحمّل

### سلوك مهم

- يتم إلغاء تكرار المسارات المحلولة المتكررة.
- يتم رفض تعارضات أسماء الأدوات مقابل الأدوات المُدمجة والأدوات المخصصة المُحمّلة مسبقًا.
- ملفات `.md` و `.json` يتم اكتشافها كبيانات وصفية للأدوات بواسطة بعض المزودين، لكن مُحمّل الوحدات القابلة للتنفيذ يرفضها كأدوات قابلة للتشغيل.
- المسارات المُكوّنة النسبية تُحل من `cwd`؛ ويتم توسيع `~`.

## عقد الوحدة

يجب أن تُصدّر وحدة الأداة المخصصة دالة (يُفضل التصدير الافتراضي):

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

نوع القيمة المُعادة من المصنع:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## سطح واجهة البرمجة المُمرر إلى المصانع (`CustomToolAPI`)

من `types.ts` و `loader.ts`:

- `cwd`: مجلد العمل الخاص بالمضيف
- `exec(command, args, options?)`: مساعد تنفيذ العمليات
- `ui`: سياق واجهة المستخدم (يمكن أن يكون بدون عملية في الأوضاع بدون واجهة)
- `hasUI`: `false` في التدفقات غير التفاعلية
- `logger`: مسجّل ملفات مشترك
- `typebox`: حقن `@sinclair/typebox`
- `pi`: حقن تصديرات `@f5xc-salesdemos/xcsh`
- `pushPendingAction(action)`: تسجيل إجراء معاينة لأداة `resolve` المخفية (`docs/resolve-tool-runtime.md`)

يبدأ المُحمّل بسياق واجهة مستخدم بدون عملية ويتطلب من شفرة المضيف استدعاء `setUIContext(...)` عندما تكون واجهة المستخدم الحقيقية جاهزة.

## عقد التنفيذ والأنواع

توقيع `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` مُحدد النوع ثابتًا من مخطط TypeBox الخاص بك عبر `Static<TParams>`.
- يحدث التحقق من صحة الوسائط في وقت التشغيل قبل التنفيذ في حلقة الوكيل.
- `onUpdate` يُصدر نتائج جزئية لبث واجهة المستخدم.
- `ctx` يتضمن حالة الجلسة/النموذج ومساعد `abort()`.
- `signal` يحمل الإلغاء.

`CustomToolAdapter` يربط هذا بواجهة أداة الوكيل ويُوجّه الاستدعاءات بالترتيب الصحيح للوسائط.

## كيف تُعرض الأدوات للنموذج

- يتم تغليف الأدوات في نسخ `AgentTool` (`CustomToolAdapter` أو أغلفة الإضافات).
- يتم إدراجها في سجل أدوات الجلسة بالاسم.
- في تهيئة SDK، يتم تضمين الأدوات المخصصة والمسجلة عبر الإضافات إجباريًا في المجموعة النشطة الأولية.
- خيار CLI `--tools` يتحقق حاليًا فقط من أسماء الأدوات المُدمجة؛ يتم التعامل مع تضمين الأدوات المخصصة من خلال مسارات الاكتشاف/التسجيل وخيارات SDK.

## خطافات العرض

خطافات عرض اختيارية:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

السلوك في وقت التشغيل في TUI:

- إذا كانت الخطافات موجودة، يتم عرض مخرجات الأداة داخل حاوية `Box`.
- `renderResult` يستقبل `{ expanded, isPartial, spinnerFrame? }`.
- يتم التقاط أخطاء العارض وتسجيلها؛ وتعود واجهة المستخدم إلى عرض النص الافتراضي.

## التعامل مع الجلسة/الحالة

`onSession(event, ctx)` الاختيارية تستقبل أحداث دورة حياة الجلسة، بما في ذلك:

- `start`، `switch`، `branch`، `tree`، `shutdown`
- `auto_compaction_start`، `auto_compaction_end`
- `auto_retry_start`، `auto_retry_end`
- `ttsr_triggered`، `todo_reminder`

استخدم `ctx.sessionManager` لإعادة بناء الحالة من السجل عند تغيير سياق الفرع/الجلسة.

## دلالات الفشل والإلغاء

### الفشل المتزامن/غير المتزامن

- رمي الاستثناء (أو الوعود المرفوضة) في `execute` يُعامل كفشل للأداة.
- يحول وقت تشغيل الوكيل حالات الفشل إلى رسائل نتيجة الأداة مع `isError: true` ومحتوى نص الخطأ.
- مع أغلفة الإضافات، يمكن لمعالجات `tool_result` إعادة كتابة المحتوى/التفاصيل بشكل إضافي وحتى تجاوز حالة الخطأ.

### الإلغاء

- ينتشر إلغاء الوكيل عبر `AbortSignal` إلى `execute`.
- مرّر `signal` إلى عمل العمليات الفرعية (`pi.exec(..., { signal })`) للإلغاء التعاوني.
- `ctx.abort()` يتيح للأداة طلب إلغاء عملية الوكيل الحالية.

### أخطاء onSession

- يتم التقاط أخطاء `onSession` وتسجيلها كتحذيرات؛ ولا تتسبب في تعطل الجلسة.

## قيود حقيقية يجب التصميم لأجلها

- يجب أن تكون أسماء الأدوات فريدة عالميًا في السجل النشط.
- يُفضل المخرجات الحتمية ذات شكل المخطط في `details` لإعادة بناء العارض/الحالة.
- احمِ استخدام واجهة المستخدم بـ `pi.hasUI`.
- تعامل مع ملفات `.md`/`.json` في مجلدات الأدوات كبيانات وصفية، وليس وحدات قابلة للتنفيذ.
