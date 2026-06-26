---
title: الداخليات الخاصة بزمن تشغيل أداة Resolve
description: >-
  زمن تشغيل أداة Resolve لتحليل مسارات الملفات، وجلب المحتوى، والوصول إلى
  الموارد المستندة إلى URL.
sidebar:
  order: 3
  label: أداة Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# الداخليات الخاصة بزمن تشغيل أداة Resolve

يشرح هذا المستند كيفية نمذجة سير عمل المعاينة/التطبيق في coding-agent وكيف يمكن للأدوات المخصصة المشاركة عبر `pushPendingAction`.

## النطاق والملفات الرئيسية

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## ما الذي تقوم به `resolve`

`resolve` هي أداة مخفية تُنهي إجراء معاينة معلّقاً.

- `action: "apply"` تُنفّذ `apply(reason)` على الإجراء المعلّق وتثبّت التغييرات.
- `action: "discard"` تستدعي `reject(reason)` إذا توفّرت؛ وإلا تتجاهل الإجراء برسالة "تم التجاهل" الافتراضية.

إذا لم يكن ثمة إجراء معلّق، تفشل `resolve` برسالة:

- `No pending action to resolve. Nothing to apply or discard.`

## الإجراءات المعلّقة هي مكدّس (LIFO)

تُخزَّن الإجراءات المعلّقة في `PendingActionStore` على شكل مكدّس دفع/سحب:

- `push(action)` يضيف إجراءً معلّقاً جديداً في أعلى المكدّس.
- `peek()` يفحص الإجراء الموجود في أعلى المكدّس الحالي.
- `pop()` يُزيل الإجراء الموجود في الأعلى ويُعيده.
- `hasPending` يشير إلى ما إذا كان المكدّس غير فارغ.

تستهلك `resolve` دائماً الإجراء **الأعلى** أولاً (`pop()`)، لذا تُحلَّل الأدوات المنتجة لمعاينات متعددة بترتيب عكسي للتسجيل.

## مثال على منتج مدمج (`ast_edit`)

تُعاين `ast_edit` الاستبدالات البنيوية أولاً. عندما تحتوي المعاينة على استبدالات ولم تُطبَّق بعد، تدفع إجراءً معلّقاً يحتوي على:

- label (ملخص مقروء للإنسان)
- `sourceToolName` (`ast_edit`)
- رد نداء `apply(reason: string)` يُعيد تشغيل تحرير AST مع `dryRun: false`

تُمرّر `resolve(action="apply", reason="...")` قيمة `reason` إلى هذا رد النداء.

## الأدوات المخصصة: `pushPendingAction`

يمكن للأدوات المخصصة تسجيل إجراءات معلّقة متوافقة مع resolve عبر `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (مطلوب)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (مطلوب) — يُستدعى عند التطبيق؛ `reason` هي السلسلة المُمرَّرة إلى `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (اختياري) — يُستدعى عند التجاهل؛ تحلّ قيمة الإرجاع محلّ رسالة "تم التجاهل" الافتراضية إذا توفّرت
- `details?: unknown` (اختياري)
- `sourceToolName?: string` (اختياري، القيمة الافتراضية `"custom_tool"`)

### مثال على الاستخدام الأدنى

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## توافر زمن التشغيل والأعطال

يتمّ توصيل `pushPendingAction` بواسطة محمّل الأداة المخصصة باستخدام `PendingActionStore` للجلسة النشطة.

إذا كان زمن التشغيل لا يحتوي على مخزن للإجراءات المعلّقة، يرمي `pushPendingAction` استثناءً:

- `Pending action store unavailable for custom tools in this runtime.`

## سلوك اختيار الأداة

عندما تكون `PendingActionStore.hasPending` صحيحة، يُميل زمن تشغيل الوكيل اختيار الأداة نحو `resolve` بحيث تُنهى المعاينات المعلّقة صراحةً قبل استمرار تدفق الأداة الطبيعي.

## إرشادات المطور

- استخدم الإجراءات المعلّقة فقط للعمليات المدمّرة أو عالية التأثير التي ينبغي أن تدعم التطبيق/التجاهل الصريح.
- اجعل `label` موجزاً ومحدداً؛ إذ يظهر في مخرجات عارض resolve.
- تأكّد من أن `apply(reason)` حتمي وقابل للتكرار بما يكفي للتنفيذ مرة واحدة؛ `reason` معلوماتي ولا ينبغي أن يُغيّر السلوك.
- نفّذ `reject(reason)` عندما يحتاج التجاهل إلى تنظيف (حالة مؤقتة، أقفال، إشعارات)؛ أغفله في المعاينات عديمة الحالة حيث تكفي الرسالة الافتراضية.
- إذا كانت أداتك قادرة على تدريج معاينات متعددة، تذكّر دلالات LIFO: يُحلَّل الإجراء المدفوع الأخير أولاً.
