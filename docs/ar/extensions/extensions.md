---
title: الإضافات
description: >-
  نظرة عامة على وقت تشغيل الإضافات تشمل الأنواع ودورة حياة التشغيل والتسجيل
  والاكتشاف.
sidebar:
  order: 1
  label: نظرة عامة
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# الإضافات

الدليل الرئيسي لتأليف إضافات وقت التشغيل في `packages/coding-agent`.

تغطي هذه الوثيقة وقت تشغيل الإضافات الحالي في:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

لمسارات الاكتشاف وقواعد التحميل من نظام الملفات، راجع `docs/extension-loading.md`.

## ما هي الإضافة

الإضافة هي وحدة TS/JS تُصدّر مصنعًا افتراضيًا:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

يمكن للإضافات الجمع بين كل ما يلي في وحدة واحدة:

- معالجات الأحداث (`pi.on(...)`)
- الأدوات القابلة للاستدعاء بواسطة نماذج اللغة الكبيرة (`pi.registerTool(...)`)
- أوامر الشرطة المائلة (`pi.registerCommand(...)`)
- اختصارات لوحة المفاتيح والأعلام
- عرض الرسائل المخصص
- واجهات برمجية للجلسة/الرسائل (`sendMessage`، `sendUserMessage`، `appendEntry`)

## نموذج وقت التشغيل

1. يتم استيراد الإضافات وتشغيل دوال المصنع الخاصة بها.
2. خلال مرحلة التحميل هذه، تكون أساليب التسجيل صالحة؛ أما أساليب الإجراءات في وقت التشغيل فلم تُهيَّأ بعد.
3. يقوم `ExtensionRunner.initialize(...)` بتوصيل الإجراءات/السياقات الحية للوضع النشط.
4. تُرسَل أحداث دورة حياة الجلسة/العامل/الأداة إلى المعالجات.
5. كل تنفيذ للأداة مُغلَّف بعملية اعتراض من الإضافة (`tool_call` / `tool_result`).

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

قيد مهم من `loader.ts`:

- استدعاء أساليب الإجراءات مثل `pi.sendMessage()` أثناء تحميل الإضافة يُطلق `ExtensionRuntimeNotInitializedError`
- سجّل أولًا؛ ونفّذ سلوك وقت التشغيل من الأحداث/الأوامر/الأدوات

## البداية السريعة

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## أسطح واجهة برمجة الإضافات

## 1) التسجيل والإجراءات (`ExtensionAPI`)

الأساليب الأساسية:

- `on(event, handler)`
- `registerTool`، `registerCommand`، `registerShortcut`، `registerFlag`
- `registerMessageRenderer`
- `sendMessage`، `sendUserMessage`، `appendEntry`
- `getActiveTools`، `getAllTools`، `setActiveTools`
- `getSessionName`، `setSessionName`
- `setModel`، `getThinkingLevel`، `setThinkingLevel`
- `registerProvider`
- `events` (حافلة الأحداث المشتركة)

في الوضع التفاعلي، تعمل معالجات `input` قبل فحص العنوان التلقائي للرسالة الأولى المدمج. يمكن للإضافات التي تستدعي `await pi.setSessionName(...)` من `input` تعيين اسم الجلسة المستمر ومنع العنوان التلقائي الافتراضي من التشغيل لتلك الجلسة.

أيضًا مُتاح:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (صادرات الحزمة)

### دلالات تسليم الرسائل

`pi.sendMessage(message, options)` يدعم:

- `deliverAs: "steer"` (الافتراضي) — يقاطع التشغيل الحالي
- `deliverAs: "followUp"` — مُدرج في قائمة الانتظار للتشغيل بعد التشغيل الحالي
- `deliverAs: "nextTurn"` — مُخزَّن ويُحقن في مطالبة المستخدم التالية
- `triggerTurn: true` — يبدأ دورة عند الخمول (`nextTurn` يتجاهل هذا)

`pi.sendUserMessage(content, { deliverAs })` يمر دائمًا عبر تدفق المطالبة؛ أثناء البث يُضاف إلى قائمة الانتظار كتوجيه/متابعة.

## 2) سياق المعالج (`ExtensionContext`)

تتلقى المعالجات وتنفيذ الأداة `ctx` يحتوي على:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (للقراءة فقط)
- `modelRegistry`، `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`، `hasPendingMessages()`، `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) سياق الأمر (`ExtensionCommandContext`)

تحصل معالجات الأوامر إضافةً على:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

استخدم سياق الأمر لتدفقات التحكم في الجلسة؛ هذه الأساليب مفصولة عمدًا عن معالجات الأحداث العامة.

## سطح الأحداث (الأسماء الحالية والسلوك)

اتحادات الأحداث القانونية وأنواع الحمولة موجودة في `types.ts`.

### دورة حياة الجلسة

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

الأحداث المسبقة القابلة للإلغاء:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### دورة حياة المطالبة والدورة

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### دورة حياة الأداة

- `tool_call` (قبل التنفيذ، قد تحجب)
- `tool_result` (بعد التنفيذ، قد تُعدّل المحتوى/التفاصيل/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (قابلية المراقبة)

`tool_result` بأسلوب البرمجيات الوسيطة: تعمل المعالجات بترتيب الإضافات وكل منها يرى التعديلات السابقة.

### إشارات الموثوقية/وقت التشغيل

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### اعتراض أوامر المستخدم

- `user_bash` (تجاوز بـ `{ result }`)
- `user_python` (تجاوز بـ `{ result }`)

### `resources_discover`

`resources_discover` موجود في أنواع الإضافات و`ExtensionRunner`.
ملاحظة وقت التشغيل الحالية: `ExtensionRunner.emitResourcesDiscover(...)` مُنفَّذ، لكن لا توجد نقاط استدعاء `AgentSession` تستدعيه في قاعدة الكود الحالية.

## تفاصيل تأليف الأدوات

يستخدم `registerTool` الـ `ToolDefinition` من `types.ts`.

توقيع `execute` الحالي:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

النموذج:

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

يعترض `tool_call`/`tool_result` جميع الأدوات بمجرد تغليف السجل في `sdk.ts`، بما في ذلك الأدوات المدمجة وأدوات الإضافات/المخصصة.

## نقاط تكامل واجهة المستخدم

`ctx.ui` يُنفّذ واجهة `ExtensionUIContext`. يختلف الدعم حسب الوضع.

### الوضع التفاعلي (`extension-ui-controller.ts`)

مدعوم:

- مربعات الحوار: `select`، `confirm`، `input`، `editor`
- الإشعارات/الحالة/نص المحرر/إدخال الطرفية/التراكبات المخصصة
- سرد السمات/تحميلها بالاسم (`setTheme` يدعم أسماء السلاسل)
- تبديل توسيع الأدوات

الأساليب غير العاملة الحالية في هذا المتحكم:

- `setFooter`
- `setHeader`
- `setEditorComponent`

ملاحظة أيضًا: `setWidget` يوجّه حاليًا إلى نص شريط الحالة عبر `setHookWidget(...)`.

### وضع RPC (`rpc-mode.ts`)

`ctx.ui` مدعوم ببيانات أحداث RPC `extension_ui_request`:

- أساليب مربعات الحوار (`select`، `confirm`، `input`، `editor`) تُنجز رحلة ذهابًا وإيابًا إلى استجابات العميل
- الأساليب غير المتزامنة (أرسل ونسَ) تُصدر طلبات (`notify`، `setStatus`، `setWidget` لمصفوفات السلاسل، `setTitle`، `setEditorText`)

غير مدعوم/غير عامل في تنفيذ RPC:

- `onTerminalInput`
- `custom`
- `setFooter`، `setHeader`، `setEditorComponent`
- `setWorkingMessage`
- تبديل/تحميل السمات (`setTheme` يُعيد فشلًا)
- عناصر التحكم في توسيع الأدوات غير فعّالة

### مسارات الطباعة/بدون واجهة/العامل الفرعي

عند عدم توفير سياق واجهة مستخدم لتهيئة التشغيل، يكون `ctx.hasUI` بقيمة `false` والأساليب غير عاملة/تُعيد قيمًا افتراضية.

### الوضع التفاعلي في الخلفية

يُثبّت وضع الخلفية كائن سياق واجهة مستخدم غير تفاعلي. في التنفيذ الحالي، قد لا يزال `ctx.hasUI` بقيمة `true` بينما تُعيد مربعات الحوار التفاعلية قيمًا افتراضية/سلوكًا غير عامل.

## أنماط الجلسة والحالة

للحالة الدائمة للإضافة:

1. احفظ مع `pi.appendEntry(customType, data)`.
2. أعد بناء الحالة من `ctx.sessionManager.getBranch()` عند `session_start`، `session_branch`، `session_tree`.
3. أبقِ تفاصيل نتيجة الأداة `details` منظمة عندما يجب أن تكون الحالة مرئية/قابلة للإعادة من سجل نتائج الأدوات.

مثال على نمط إعادة البناء:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## نقاط توسيع العرض

## عارض الرسائل المخصص

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

يُستخدم في العرض التفاعلي عند عرض الرسائل المخصصة.

## عارض استدعاء/نتيجة الأداة

وفّر `renderCall` / `renderResult` على تعريفات `registerTool` للتصور المخصص للأداة في TUI.

## القيود والمزالق

- إجراءات وقت التشغيل غير متاحة أثناء تحميل الإضافة.
- أخطاء `tool_call` تحجب التنفيذ (تفشل بشكل مغلق).
- تعارضات أسماء الأوامر مع الأوامر المدمجة تُتخطى مع تشخيصات.
- الاختصارات المحجوزة تُتجاهل (`ctrl+c`، `ctrl+d`، `ctrl+z`، `ctrl+k`، `ctrl+p`، `ctrl+l`، `ctrl+o`، `ctrl+t`، `ctrl+g`، `shift+tab`، `shift+ctrl+p`، `alt+enter`، `escape`، `enter`).
- عامل `ctx.reload()` كنهاية للإطار الحالي لمعالج الأمر.

## الإضافات مقابل الخطافات مقابل الأدوات المخصصة

استخدم السطح الصحيح:

- **الإضافات** (`src/extensibility/extensions/*`): النظام الموحد (الأحداث + الأدوات + الأوامر + العارضات + تسجيل الموفر).
- **الخطافات** (`src/extensibility/hooks/*`): واجهة برمجية للأحداث قديمة منفصلة.
- **الأدوات المخصصة** (`src/extensibility/custom-tools/*`): وحدات تركز على الأدوات؛ عند تحميلها جنبًا إلى جنب مع الإضافات يتم تكييفها وما زالت تمر عبر أغلفة الاعتراض الخاصة بالإضافات.

إذا كنت بحاجة إلى حزمة واحدة تمتلك السياسة والأدوات وتجربة مستخدم الأوامر والعرض معًا، فاستخدم الإضافات.
