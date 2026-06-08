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

# البنية الداخلية لوقت تشغيل أداة Resolve

يشرح هذا المستند كيفية نمذجة سير عمل المعاينة/التطبيق في coding-agent وكيف يمكن للأدوات المخصصة المشاركة عبر `pushPendingAction`.

## النطاق والملفات الرئيسية

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## ما تفعله أداة `resolve`

`resolve` هي أداة مخفية تُنهي إجراء معاينة معلّق.

- `action: "apply"` تُنفّذ `apply(reason)` على الإجراء المعلّق وتحفظ التغييرات.
- `action: "discard"` تستدعي `reject(reason)` إذا كانت متوفرة؛ وإلا تُسقط الإجراء برسالة افتراضية "Discarded".

إذا لم يكن هناك إجراء معلّق، تفشل `resolve` مع:

- `No pending action to resolve. Nothing to apply or discard.`

## الإجراءات المعلّقة هي مكدس (LIFO)

تُخزَّن الإجراءات المعلّقة في `PendingActionStore` كمكدس إضافة/سحب:

- `push(action)` تُضيف إجراءً معلّقاً جديداً في الأعلى.
- `peek()` تفحص الإجراء الأعلى الحالي.
- `pop()` تُزيل وتُرجع الإجراء الأعلى.
- `hasPending` تُشير إلى ما إذا كان المكدس غير فارغ.

تستهلك `resolve` دائماً الإجراء المعلّق **الأعلى** أولاً (`pop()`)، لذا تُحَل الأدوات المتعددة المُنتجة للمعاينات بترتيب عكسي للتسجيل.

## مثال على مُنتج مُدمج (`ast_edit`)

تعرض `ast_edit` الاستبدالات الهيكلية كمعاينة أولاً. عندما تحتوي المعاينة على استبدالات ولم تُطبَّق بعد، تدفع إجراءً معلّقاً يحتوي على:

- label (ملخص مقروء للبشر)
- `sourceToolName` (`ast_edit`)
- دالة رد `apply(reason: string)` تُعيد تشغيل تحرير AST مع `dryRun: false`

`resolve(action="apply", reason="...")` تُمرر `reason` إلى دالة الرد هذه.

## الأدوات المخصصة: `pushPendingAction`

يمكن للأدوات المخصصة تسجيل إجراءات معلّقة متوافقة مع resolve من خلال `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (مطلوب)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (مطلوب) — تُستدعى عند التطبيق؛ `reason` هي السلسلة النصية المُمررة إلى `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (اختياري) — تُستدعى عند التجاهل؛ القيمة المُرجعة تحل محل رسالة "Discarded" الافتراضية إذا توفرت
- `details?: unknown` (اختياري)
- `sourceToolName?: string` (اختياري، الافتراضي `"custom_tool"`)

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

## التوفر في وقت التشغيل والإخفاقات

يتم ربط `pushPendingAction` بواسطة مُحمّل الأدوات المخصصة باستخدام `PendingActionStore` الخاص بالجلسة النشطة.

إذا لم يكن لدى وقت التشغيل مخزن إجراءات معلّقة، تُطلق `pushPendingAction` خطأ:

- `Pending action store unavailable for custom tools in this runtime.`

## سلوك اختيار الأداة

عندما تكون `PendingActionStore.hasPending` بقيمة true، يُوجّه وقت تشغيل الوكيل اختيار الأداة نحو `resolve` بحيث تُنهى المعاينات المعلّقة بشكل صريح قبل متابعة تدفق الأدوات العادي.

## إرشادات المطوّرين

- استخدم الإجراءات المعلّقة فقط للعمليات المدمّرة أو عالية التأثير التي يجب أن تدعم التطبيق/التجاهل الصريح.
- اجعل `label` موجزاً ومحدداً؛ فهو يُعرض في مخرجات عارض resolve.
- تأكد من أن `apply(reason)` حتمية وغير متغيرة النتيجة بما يكفي للتنفيذ لمرة واحدة؛ `reason` معلوماتية ولا ينبغي أن تُغيّر السلوك.
- نفّذ `reject(reason)` عندما يحتاج التجاهل إلى تنظيف (حالة مؤقتة، أقفال، إشعارات)؛ تجاهلها للمعاينات عديمة الحالة حيث تكفي الرسالة الافتراضية.
- إذا كانت أداتك قادرة على تقديم معاينات متعددة، تذكّر دلالات LIFO: آخر إجراء مدفوع يُحَل أولاً.
