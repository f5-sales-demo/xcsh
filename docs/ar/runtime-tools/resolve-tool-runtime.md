---
title: الآليات الداخلية لوقت تشغيل أداة Resolve
description: >-
  وقت تشغيل أداة Resolve لتحليل مسارات الملفات، وجلب المحتوى، والوصول إلى
  الموارد عبر URL.
sidebar:
  order: 3
  label: أداة Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# الآليات الداخلية لوقت تشغيل أداة Resolve

يشرح هذا المستند كيفية نمذجة سير عمل المعاينة/التطبيق في وكيل البرمجة، وكيف يمكن للأدوات المخصصة المشاركة عبر `pushPendingAction`.

## النطاق والملفات الرئيسية

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## ما الذي تقوم به أداة `resolve`

`resolve` هي أداة مخفية تُنهي إجراء معاينة معلَّقاً.

- `action: "apply"` تُنفِّذ `apply(reason)` على الإجراء المعلَّق وتحفظ التغييرات.
- `action: "discard"` تستدعي `reject(reason)` إذا كانت متوفرة؛ وإلا تتجاهل الإجراء مع رسالة "Discarded" الافتراضية.

إذا لم يكن هناك إجراء معلَّق، تفشل `resolve` مع الرسالة التالية:

- `No pending action to resolve. Nothing to apply or discard.`

## الإجراءات المعلَّقة عبارة عن مكدس (LIFO)

تُخزَّن الإجراءات المعلَّقة في `PendingActionStore` كمكدس دفع/سحب:

- `push(action)` يُضيف إجراءً معلَّقاً جديداً في أعلى المكدس.
- `peek()` يفحص الإجراء الموجود في أعلى المكدس حالياً.
- `pop()` يزيل ويُعيد الإجراء الموجود في أعلى المكدس.
- `hasPending` يُشير إلى ما إذا كان المكدس غير فارغ.

تستهلك `resolve` دائماً الإجراء المعلَّق **الأعلى** أولاً (`pop()`)، لذا تُحَل الأدوات المنتجة لمعاينات متعددة بترتيب عكسي لتسجيلها.

## مثال على منتج مدمج (`ast_edit`)

تُعاين `ast_edit` الاستبدالات الهيكلية أولاً. عندما تحتوي المعاينة على استبدالات ولم تُطبَّق بعد، تدفع إجراءً معلَّقاً يحتوي على:

- التسمية (ملخص مقروء للإنسان)
- `sourceToolName` (`ast_edit`)
- رد نداء `apply(reason: string)` الذي يُعيد تشغيل تعديل AST مع `dryRun: false`

`resolve(action="apply", reason="...")` يمرر `reason` إلى هذا رد النداء.

## الأدوات المخصصة: `pushPendingAction`

يمكن للأدوات المخصصة تسجيل إجراءات معلَّقة متوافقة مع resolve عبر `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (مطلوب)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (مطلوب) — يُستدعى عند التطبيق؛ `reason` هي السلسلة المُمررة إلى `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (اختياري) — يُستدعى عند التجاهل؛ تُحل قيمة الإرجاع محل رسالة "Discarded" الافتراضية إذا كانت متوفرة
- `details?: unknown` (اختياري)
- `sourceToolName?: string` (اختياري، يُعيَّن افتراضياً إلى `"custom_tool"`)

### مثال على الاستخدام الأدنى

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

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

## التوفر في وقت التشغيل والأعطال

يتم توصيل `pushPendingAction` بواسطة محمِّل الأدوات المخصصة باستخدام `PendingActionStore` للجلسة النشطة.

إذا لم يكن لدى وقت التشغيل مخزن للإجراءات المعلَّقة، ترمي `pushPendingAction` الخطأ التالي:

- `Pending action store unavailable for custom tools in this runtime.`

## سلوك اختيار الأداة

عندما تكون قيمة `PendingActionStore.hasPending` صحيحة، يميل وقت تشغيل الوكيل إلى اختيار الأداة `resolve` حتى تُنهى المعاينات المعلَّقة صراحةً قبل استمرار تدفق الأدوات الاعتيادي.

## إرشادات المطوِّر

- استخدم الإجراءات المعلَّقة فقط للعمليات المدمِّرة أو عالية التأثير التي يجب أن تدعم التطبيق/التجاهل الصريح.
- أبقِ `label` موجزاً ومحدداً؛ إذ يظهر في مخرجات محرك العرض الخاص بـ resolve.
- تأكد من أن `apply(reason)` حتمي وقابل للتكرار بما يكفي للتنفيذ لمرة واحدة؛ فـ `reason` إعلامية ولا ينبغي أن تغير السلوك.
- نفِّذ `reject(reason)` عندما يحتاج التجاهل إلى تنظيف (حالة مؤقتة، أقفال، إشعارات)؛ وأغفلها للمعاينات عديمة الحالة حيث تكفي الرسالة الافتراضية.
- إذا كانت أداتك قادرة على تنظيم معاينات متعددة، تذكر دلالات LIFO: يُحَل آخر إجراء مدفوع أولاً.
