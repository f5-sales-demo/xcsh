---
title: البنية الداخلية لوقت تشغيل أداة Resolve
description: >-
  وقت تشغيل أداة Resolve لتحليل مسارات الملفات، وجلب المحتوى، والوصول إلى
  الموارد المستندة إلى عناوين URL.
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

## ما تفعله `resolve`

`resolve` هي أداة مخفية تُنهي إجراء معاينة معلقاً.

- `action: "apply"` تُنفّذ `apply(reason)` على الإجراء المعلق وتحفظ التغييرات.
- `action: "discard"` تستدعي `reject(reason)` إذا كانت متوفرة؛ وإلا تُسقط الإجراء برسالة افتراضية "تم التجاهل".

إذا لم يكن هناك إجراء معلق، تفشل `resolve` بالرسالة:

- `No pending action to resolve. Nothing to apply or discard.`

## الإجراءات المعلقة هي مكدس (LIFO)

تُخزَّن الإجراءات المعلقة في `PendingActionStore` كمكدس دفع/سحب:

- `push(action)` يُضيف إجراءً معلقاً جديداً في الأعلى.
- `peek()` يفحص الإجراء الأعلى الحالي.
- `pop()` يُزيل ويُعيد الإجراء الأعلى.
- `hasPending` يُشير إلى ما إذا كان المكدس غير فارغ.

تستهلك `resolve` دائماً الإجراء المعلق **الأعلى** أولاً (`pop()`)، لذا تُحلَّ الأدوات المتعددة المُنتجة للمعاينات بترتيب عكسي للتسجيل.

## مثال على مُنتج مدمج (`ast_edit`)

تعرض `ast_edit` الاستبدالات الهيكلية كمعاينة أولاً. عندما تحتوي المعاينة على استبدالات ولم تُطبَّق بعد، تدفع إجراءً معلقاً يحتوي على:

- التسمية (ملخص مقروء للبشر)
- `sourceToolName` (`ast_edit`)
- دالة رد نداء `apply(reason: string)` تُعيد تشغيل تحرير AST مع `dryRun: false`

`resolve(action="apply", reason="...")` تُمرر `reason` إلى دالة رد النداء هذه.

## الأدوات المخصصة: `pushPendingAction`

يمكن للأدوات المخصصة تسجيل إجراءات معلقة متوافقة مع resolve من خلال `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (مطلوب)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (مطلوب) — تُستدعى عند التطبيق؛ `reason` هي السلسلة النصية المُمررة إلى `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (اختياري) — تُستدعى عند التجاهل؛ القيمة المُعادة تحل محل رسالة "تم التجاهل" الافتراضية إذا تم توفيرها
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

## التوفر أثناء التشغيل والإخفاقات

يتم ربط `pushPendingAction` بواسطة مُحمّل الأدوات المخصصة باستخدام `PendingActionStore` الخاص بالجلسة النشطة.

إذا لم يكن لدى وقت التشغيل مخزن إجراءات معلقة، فإن `pushPendingAction` يطرح استثناءً:

- `Pending action store unavailable for custom tools in this runtime.`

## سلوك اختيار الأداة

عندما تكون `PendingActionStore.hasPending` صحيحة (true)، يُوجّه وقت تشغيل الوكيل اختيار الأداة نحو `resolve` بحيث تُنهى المعاينات المعلقة صراحةً قبل متابعة تدفق الأدوات العادي.

## إرشادات للمطورين

- استخدم الإجراءات المعلقة فقط للعمليات المدمرة أو عالية التأثير التي يجب أن تدعم التطبيق/التجاهل الصريح.
- اجعل `label` موجزاً ومحدداً؛ فهو يُعرض في مخرجات عارض resolve.
- تأكد من أن `apply(reason)` حتمية وقابلة للتكرار بشكل كافٍ للتنفيذ لمرة واحدة؛ `reason` معلوماتية ولا ينبغي أن تُغيّر السلوك.
- نفّذ `reject(reason)` عندما يحتاج التجاهل إلى تنظيف (حالة مؤقتة، أقفال، إشعارات)؛ واحذفها للمعاينات عديمة الحالة حيث تكفي الرسالة الافتراضية.
- إذا كانت أداتك قادرة على تجهيز معاينات متعددة، تذكر دلالات LIFO: آخر إجراء تم دفعه يُحلّ أولاً.
