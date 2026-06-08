---
title: Custom Tools
description: تسجيل الأدوات المخصصة، تعريف المخطط، وخط أنابيب التنفيذ لتوسيع الوكيل.
sidebar:
  order: 4
  label: الأدوات المخصصة
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# الأدوات المخصصة

الأدوات المخصصة هي دوال قابلة للاستدعاء من قبل النموذج تتصل بنفس خط أنابيب تنفيذ الأدوات المدمجة.

الأداة المخصصة هي وحدة TypeScript/JavaScript تُصدّر مصنعاً (factory). يستقبل المصنع واجهة برمجة المضيف (`CustomToolAPI`) ويُرجع أداة واحدة أو مصفوفة من الأدوات.

## ما هذا (وما ليس كذلك)

- **أداة مخصصة**: قابلة للاستدعاء من قبل النموذج أثناء دورة (`execute` + مخطط TypeBox).
- **ملحق (Extension)**: إطار عمل لدورة الحياة/الأحداث يمكنه تسجيل الأدوات واعتراض/تعديل الأحداث.
- **خطاف (Hook)**: سكربتات خارجية قبل/بعد الأوامر.
- **مهارة (Skill)**: حزمة إرشادات/سياق ثابتة، وليست كود أداة قابل للتنفيذ.

إذا كنت تحتاج أن يستدعي النموذج كوداً مباشرة، استخدم أداة مخصصة.

## مسارات التكامل في الكود الحالي

هناك نمطان نشطان للتكامل:

1. **الأدوات المخصصة المُقدّمة عبر SDK** (`options.customTools`)
   - تُغلّف في أدوات الوكيل عبر `CustomToolAdapter` أو أغلفة الملحقات.
   - تُضمّن دائماً في مجموعة الأدوات النشطة الأولية عند تهيئة SDK.

2. **الوحدات المُكتشفة من نظام الملفات عبر واجهة التحميل** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - مكشوفة كواجهات برمجة مكتبية في `src/extensibility/custom-tools/loader.ts`.
   - يمكن لكود المضيف استدعاؤها لاكتشاف وتحميل وحدات الأدوات من مسارات التكوين/المزوّد/الإضافات.

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

## مواقع الاكتشاف (واجهة التحميل)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` تدمج:

1. مزوّدات القدرات (`toolCapability`)، بما في ذلك:
   - تكوين OMP الأصلي (`~/.xcsh/agent/tools`، `.xcsh/tools`)
   - تكوين Claude (`~/.claude/tools`، `.claude/tools`)
   - تكوين Codex (`~/.codex/tools`، `.codex/tools`)
   - مزوّد ذاكرة التخزين المؤقت لسوق إضافات Claude
2. بيانات الإضافات المُثبّتة (`~/.xcsh/plugins/node_modules/*` عبر محمّل الإضافات)
3. المسارات المُكوّنة الصريحة المُمرّرة إلى المحمّل

### سلوك مهم

- المسارات المحلولة المكررة يتم إزالة تكراراتها.
- تعارضات أسماء الأدوات تُرفض مقابل الأدوات المدمجة والأدوات المخصصة المحمّلة مسبقاً.
- ملفات `.md` و `.json` يتم اكتشافها كبيانات وصفية للأداة بواسطة بعض المزوّدات، لكن محمّل الوحدات القابلة للتنفيذ يرفضها كأدوات قابلة للتشغيل.
- المسارات النسبية المُكوّنة تُحلّ من `cwd`؛ و `~` يتم توسيعها.

## عقد الوحدة

يجب أن تُصدّر وحدة الأداة المخصصة دالة (يُفضّل التصدير الافتراضي):

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

نوع إرجاع المصنع:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## سطح واجهة البرمجة المُمرّر للمصانع (`CustomToolAPI`)

من `types.ts` و `loader.ts`:

- `cwd`: مجلد العمل الخاص بالمضيف
- `exec(command, args, options?)`: مساعد تنفيذ العمليات
- `ui`: سياق واجهة المستخدم (يمكن أن يكون بدون عمليات في الأوضاع بدون واجهة)
- `hasUI`: `false` في التدفقات غير التفاعلية
- `logger`: مسجّل ملفات مشترك
- `typebox`: حقن `@sinclair/typebox`
- `pi`: حقن تصديرات `@f5xc-salesdemos/xcsh`
- `pushPendingAction(action)`: تسجيل إجراء معاينة لأداة `resolve` المخفية (`docs/resolve-tool-runtime.md`)

يبدأ المحمّل بسياق واجهة مستخدم بدون عمليات ويتطلب أن يستدعي كود المضيف `setUIContext(...)` عندما تكون واجهة المستخدم الحقيقية جاهزة.

## عقد التنفيذ والأنواع

توقيع `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` مُنمّط بشكل ثابت من مخطط TypeBox الخاص بك عبر `Static<TParams>`.
- التحقق من صحة المعاملات في وقت التشغيل يحدث قبل التنفيذ في حلقة الوكيل.
- `onUpdate` يُصدر نتائج جزئية لبث واجهة المستخدم.
- `ctx` يتضمن حالة الجلسة/النموذج ومساعد `abort()`.
- `signal` يحمل الإلغاء.

`CustomToolAdapter` يربط هذا بواجهة أداة الوكيل ويُمرّر الاستدعاءات بترتيب المعاملات الصحيح.

## كيف تُكشف الأدوات للنموذج

- تُغلّف الأدوات في نسخ `AgentTool` (`CustomToolAdapter` أو أغلفة الملحقات).
- تُدرج في سجل أدوات الجلسة بالاسم.
- في تهيئة SDK، تُضمّن الأدوات المخصصة والمسجّلة عبر الملحقات قسراً في المجموعة النشطة الأولية.
- واجهة سطر الأوامر `--tools` تتحقق حالياً فقط من أسماء الأدوات المدمجة؛ إدراج الأدوات المخصصة يُعالج عبر مسارات الاكتشاف/التسجيل وخيارات SDK.

## خطافات العرض

خطافات عرض اختيارية:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

السلوك في وقت التشغيل في TUI:

- إذا وُجدت الخطافات، يُعرض ناتج الأداة داخل حاوية `Box`.
- `renderResult` يستقبل `{ expanded, isPartial, spinnerFrame? }`.
- أخطاء العارض تُلتقط وتُسجّل؛ تعود واجهة المستخدم إلى عرض النص الافتراضي.

## معالجة الجلسة/الحالة

الخطاف الاختياري `onSession(event, ctx)` يستقبل أحداث دورة حياة الجلسة، بما في ذلك:

- `start`، `switch`، `branch`، `tree`، `shutdown`
- `auto_compaction_start`، `auto_compaction_end`
- `auto_retry_start`، `auto_retry_end`
- `ttsr_triggered`، `todo_reminder`

استخدم `ctx.sessionManager` لإعادة بناء الحالة من السجل عند تغيّر سياق الفرع/الجلسة.

## دلالات الفشل والإلغاء

### الفشل المتزامن/غير المتزامن

- رمي الأخطاء (أو الوعود المرفوضة) في `execute` يُعامل كفشل أداة.
- يحوّل وقت تشغيل الوكيل حالات الفشل إلى رسائل نتائج أداة مع `isError: true` ومحتوى نص الخطأ.
- مع أغلفة الملحقات، يمكن لمعالجات `tool_result` إعادة كتابة المحتوى/التفاصيل بشكل إضافي وحتى تجاوز حالة الخطأ.

### الإلغاء

- إلغاء الوكيل ينتشر عبر `AbortSignal` إلى `execute`.
- مرّر `signal` إلى عمل العمليات الفرعية (`pi.exec(..., { signal })`) للإلغاء التعاوني.
- `ctx.abort()` يتيح للأداة طلب إلغاء عملية الوكيل الحالية.

### أخطاء onSession

- أخطاء `onSession` تُلتقط وتُسجّل كتحذيرات؛ لا تُعطّل الجلسة.

## قيود حقيقية يجب التصميم لها

- أسماء الأدوات يجب أن تكون فريدة عالمياً في السجل النشط.
- يُفضّل المخرجات الحتمية ذات شكل المخطط في `details` لإعادة بناء العارض/الحالة.
- احمِ استخدام واجهة المستخدم بـ `pi.hasUI`.
- عامل ملفات `.md`/`.json` في مجلدات الأدوات كبيانات وصفية، وليست وحدات قابلة للتنفيذ.
