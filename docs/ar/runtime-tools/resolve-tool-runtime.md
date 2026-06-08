---
title: Resolve Tool Runtime Internals
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: أداة Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# البنية الداخلية لأداة Resolve أثناء التشغيل

يشرح هذا المستند كيفية نمذجة سير عمل المعاينة/التطبيق في coding-agent وكيف يمكن للأدوات المخصصة المشاركة عبر `pushPendingAction`.

## النطاق والملفات الرئيسية

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## ما تفعله `resolve`

`resolve` هي أداة مخفية تُنهي إجراء معاينة معلّق.

- `action: "apply"` تُنفّذ `apply(reason)` على الإجراء المعلّق وتحفظ التغييرات.
- `action: "discard"` تستدعي `reject(reason)` إذا كانت متوفرة؛ وإلا تتجاهل الإجراء مع رسالة افتراضية "Discarded".

إذا لم يكن هناك إجراء معلّق، تفشل `resolve` مع:

- `No pending action to resolve. Nothing to apply or discard.`

## الإجراءات المعلّقة هي مكدس (LIFO)

تُخزَّن الإجراءات المعلّقة في `PendingActionStore` كمكدس إضافة/سحب:

- `push(action)` يضيف إجراءً معلّقاً جديداً في الأعلى.
- `peek()` يفحص الإجراء الأعلى الحالي.
- `pop()` يزيل ويعيد الإجراء الأعلى.
- `hasPending` يشير إلى ما إذا كان المكدس غير فارغ.

تستهلك `resolve` دائماً الإجراء المعلّق **الأعلى** أولاً (`pop()`)، لذا تُحلّ الأدوات المتعددة المنتجة للمعاينات بترتيب عكسي للتسجيل.

## مثال منتج مدمج (`ast_edit`)

تعرض `ast_edit` الاستبدالات الهيكلية أولاً كمعاينة. عندما تحتوي المعاينة على استبدالات ولم تُطبَّق بعد، تدفع إجراءً معلّقاً يحتوي على:

- تسمية (ملخص مقروء بشرياً)
- `sourceToolName` (`ast_edit`)
- دالة استدعاء `apply(reason: string)` تعيد تشغيل تحرير AST مع `dryRun: false`

`resolve(action="apply", reason="...")` تمرر `reason` إلى دالة الاستدعاء هذه.

## الأدوات المخصصة: `pushPendingAction`

يمكن للأدوات المخصصة تسجيل إجراءات معلّقة متوافقة مع resolve من خلال `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (مطلوب)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (مطلوب) — يُستدعى عند التطبيق؛ `reason` هو النص الممرر إلى `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (اختياري) — يُستدعى عند التجاهل؛ القيمة المعادة تحل محل رسالة "Discarded" الافتراضية إذا تم توفيرها
- `details?: unknown` (اختياري)
- `sourceToolName?: string` (اختياري، القيمة الافتراضية `"custom_tool"`)

### مثال استخدام بسيط

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

## التوفر أثناء التشغيل وحالات الفشل

يتم ربط `pushPendingAction` بواسطة محمّل الأدوات المخصصة باستخدام `PendingActionStore` للجلسة النشطة.

إذا لم يكن لدى بيئة التشغيل مخزن إجراءات معلّقة، يرمي `pushPendingAction` خطأ:

- `Pending action store unavailable for custom tools in this runtime.`

## سلوك اختيار الأداة

عندما يكون `PendingActionStore.hasPending` صحيحاً (true)، توجّه بيئة تشغيل الوكيل اختيار الأداة نحو `resolve` بحيث يتم إنهاء المعاينات المعلّقة صراحةً قبل استئناف تدفق الأدوات العادي.

## إرشادات للمطورين

- استخدم الإجراءات المعلّقة فقط للعمليات المدمرة أو ذات التأثير العالي التي يجب أن تدعم التطبيق/التجاهل الصريح.
- اجعل `label` موجزة ومحددة؛ فهي تُعرض في مخرجات عارض resolve.
- تأكد من أن `apply(reason)` حتمية ومتساوية القوة بما يكفي للتنفيذ مرة واحدة؛ `reason` معلوماتية ولا يجب أن تغيّر السلوك.
- نفّذ `reject(reason)` عندما يحتاج التجاهل إلى تنظيف (حالة مؤقتة، أقفال، إشعارات)؛ اتركها للمعاينات عديمة الحالة حيث تكفي الرسالة الافتراضية.
- إذا كانت أداتك قادرة على تجهيز معاينات متعددة، تذكر دلالات LIFO: آخر إجراء تم دفعه يُحلّ أولاً.
