---
title: Extensions
description: >-
  Extension runtime overview covering types, runner lifecycle, registration, and
  discovery.
sidebar:
  order: 1
  label: نظرة عامة
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# الإضافات

الدليل الرئيسي لتأليف إضافات وقت التشغيل في `packages/coding-agent`.

يغطي هذا المستند نظام تشغيل الإضافات الحالي في:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

لمسارات الاكتشاف وقواعد التحميل من نظام الملفات، راجع `docs/extension-loading.md`.

## ما هي الإضافة

الإضافة هي وحدة TS/JS تصدّر دالة مصنع افتراضية:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

يمكن للإضافات الجمع بين كل ما يلي في وحدة واحدة:

- معالجات الأحداث (`pi.on(...)`)
- أدوات قابلة للاستدعاء بواسطة LLM (`pi.registerTool(...)`)
- أوامر الشرطة المائلة (`pi.registerCommand(...)`)
- اختصارات لوحة المفاتيح والأعلام
- عرض الرسائل المخصص
- واجهات برمجة حقن الجلسات/الرسائل (`sendMessage`، `sendUserMessage`، `appendEntry`)

## نموذج وقت التشغيل

1. يتم استيراد الإضافات وتشغيل دوال المصنع الخاصة بها.
2. أثناء مرحلة التحميل تلك، تكون طرق التسجيل صالحة؛ بينما طرق الإجراءات في وقت التشغيل لم تتم تهيئتها بعد.
3. يقوم `ExtensionRunner.initialize(...)` بربط الإجراءات/السياقات الحية للوضع النشط.
4. يتم إرسال أحداث دورة حياة الجلسة/الوكيل/الأداة إلى المعالجات.
5. يتم تغليف كل تنفيذ أداة باعتراض الإضافة (`tool_call` / `tool_result`).

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

- استدعاء طرق الإجراءات مثل `pi.sendMessage()` أثناء تحميل الإضافة يرمي خطأ `ExtensionRuntimeNotInitializedError`
- قم بالتسجيل أولاً؛ ونفّذ سلوك وقت التشغيل من الأحداث/الأوامر/الأدوات

## البدء السريع

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

الطرق الأساسية:

- `on(event, handler)`
- `registerTool`، `registerCommand`، `registerShortcut`، `registerFlag`
- `registerMessageRenderer`
- `sendMessage`، `sendUserMessage`، `appendEntry`
- `getActiveTools`، `getAllTools`، `setActiveTools`
- `getSessionName`، `setSessionName`
- `setModel`، `getThinkingLevel`، `setThinkingLevel`
- `registerProvider`
- `events` (ناقل الأحداث المشترك)

في الوضع التفاعلي، تعمل معالجات `input` قبل فحص العنوان التلقائي للرسالة الأولى المدمج. يمكن للإضافات التي تستدعي `await pi.setSessionName(...)` من `input` تعيين اسم الجلسة المحفوظ ومنع العنوان الافتراضي المُنشأ تلقائياً من العمل لتلك الجلسة.

أيضاً متاح:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (صادرات الحزمة)

### دلالات تسليم الرسائل

يدعم `pi.sendMessage(message, options)`:

- `deliverAs: "steer"` (افتراضي) — يقاطع التشغيل الحالي
- `deliverAs: "followUp"` — يوضع في قائمة الانتظار للتشغيل بعد التشغيل الحالي
- `deliverAs: "nextTurn"` — يُخزّن ويُحقن عند المطالبة التالية من المستخدم
- `triggerTurn: true` — يبدأ دوراً عندما يكون خاملاً (`nextTurn` يتجاهل هذا)

يمر `pi.sendUserMessage(content, { deliverAs })` دائماً عبر تدفق المطالبة؛ أثناء البث يوضع في قائمة الانتظار كتوجيه/متابعة.

## 2) سياق المعالج (`ExtensionContext`)

تتلقى المعالجات ودالة `execute` الخاصة بالأداة `ctx` مع:

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

تحصل معالجات الأوامر بالإضافة إلى ذلك على:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

استخدم سياق الأمر لتدفقات التحكم بالجلسة؛ هذه الطرق مفصولة عمداً عن معالجات الأحداث العامة.

## سطح الأحداث (الأسماء والسلوك الحالي)

اتحادات الأحداث القياسية وأنواع الحمولات موجودة في `types.ts`.

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

### دورة حياة المطالبة والدور

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### دورة حياة الأداة

- `tool_call` (قبل التنفيذ، قد يحظر)
- `tool_result` (بعد التنفيذ، قد يعدّل المحتوى/التفاصيل/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (المراقبة)

`tool_result` يعمل بأسلوب البرمجيات الوسيطة: تعمل المعالجات بترتيب الإضافات وكل منها يرى التعديلات السابقة.

### إشارات الموثوقية/وقت التشغيل

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### اعتراض أوامر المستخدم

- `user_bash` (تجاوز بـ `{ result }`)
- `user_python` (تجاوز بـ `{ result }`)

### `resources_discover`

`resources_discover` موجود في أنواع الإضافات و `ExtensionRunner`.
ملاحظة وقت التشغيل الحالية: `ExtensionRunner.emitResourcesDiscover(...)` مُنفّذ، لكن لا توجد نقاط استدعاء في `AgentSession` تستدعيه في قاعدة الكود الحالية.

## تفاصيل تأليف الأدوات

يستخدم `registerTool` نوع `ToolDefinition` من `types.ts`.

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

قالب:

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

ينفّذ `ctx.ui` واجهة `ExtensionUIContext`. يختلف الدعم حسب الوضع.

### الوضع التفاعلي (`extension-ui-controller.ts`)

مدعوم:

- مربعات الحوار: `select`، `confirm`، `input`، `editor`
- الإشعارات/الحالة/نص المحرر/إدخال الطرفية/التراكبات المخصصة
- قائمة السمات/التحميل بالاسم (`setTheme` يدعم أسماء نصية)
- تبديل توسيع الأدوات

الطرق التي لا تقوم بأي عملية حالياً في هذا المتحكم:

- `setFooter`
- `setHeader`
- `setEditorComponent`

ملاحظة أيضاً: `setWidget` يُوجّه حالياً إلى نص سطر الحالة عبر `setHookWidget(...)`.

### وضع RPC (`rpc-mode.ts`)

يُدعم `ctx.ui` بأحداث RPC من نوع `extension_ui_request`:

- طرق مربعات الحوار (`select`، `confirm`، `input`، `editor`) ترسل وتستقبل من استجابات العميل
- الطرق التي تُطلق وتُنسى تُصدر طلبات (`notify`، `setStatus`، `setWidget` لمصفوفات النصوص، `setTitle`، `setEditorText`)

غير مدعوم/لا عملية في تنفيذ RPC:

- `onTerminalInput`
- `custom`
- `setFooter`، `setHeader`، `setEditorComponent`
- `setWorkingMessage`
- تبديل/تحميل السمات (`setTheme` يُرجع فشل)
- عناصر التحكم في توسيع الأدوات خاملة

### مسارات الطباعة/بدون واجهة/الوكيل الفرعي

عندما لا يتم توفير سياق واجهة مستخدم لتهيئة المشغّل، يكون `ctx.hasUI` بقيمة `false` والطرق لا تقوم بأي عملية/تُرجع القيم الافتراضية.

### الوضع التفاعلي في الخلفية

يُثبّت الوضع الخلفي كائن سياق واجهة مستخدم غير تفاعلي. في التنفيذ الحالي، قد يظل `ctx.hasUI` بقيمة `true` بينما تُرجع مربعات الحوار التفاعلية القيم الافتراضية/سلوك عدم العملية.

## أنماط الجلسة والحالة

للحالة الدائمة للإضافة:

1. احفظ باستخدام `pi.appendEntry(customType, data)`.
2. أعد بناء الحالة من `ctx.sessionManager.getBranch()` عند `session_start`، `session_branch`، `session_tree`.
3. حافظ على `details` نتيجة الأداة مُهيكلة عندما يجب أن تكون الحالة مرئية/قابلة لإعادة البناء من سجل نتائج الأدوات.

نمط إعادة البناء كمثال:

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

## نقاط التوسع في العرض

## عارض الرسائل المخصص

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

يُستخدم بواسطة العرض التفاعلي عند عرض الرسائل المخصصة.

## عارض استدعاء/نتيجة الأداة

قدّم `renderCall` / `renderResult` في تعريفات `registerTool` لتصور مخصص للأدوات في واجهة TUI.

## القيود والمزالق

- إجراءات وقت التشغيل غير متاحة أثناء تحميل الإضافة.
- أخطاء `tool_call` تحظر التنفيذ (فشل مغلق).
- تعارضات أسماء الأوامر مع المدمجة يتم تخطيها مع تشخيصات.
- الاختصارات المحجوزة يتم تجاهلها (`ctrl+c`، `ctrl+d`، `ctrl+z`، `ctrl+k`، `ctrl+p`، `ctrl+l`، `ctrl+o`، `ctrl+t`، `ctrl+g`، `shift+tab`، `shift+ctrl+p`، `alt+enter`، `escape`، `enter`).
- تعامل مع `ctx.reload()` كنهاية لإطار معالج الأمر الحالي.

## الإضافات مقابل الخطافات مقابل الأدوات المخصصة

استخدم السطح المناسب:

- **الإضافات** (`src/extensibility/extensions/*`): نظام موحد (أحداث + أدوات + أوامر + عارضات + تسجيل مزودين).
- **الخطافات** (`src/extensibility/hooks/*`): واجهة أحداث قديمة منفصلة.
- **الأدوات المخصصة** (`src/extensibility/custom-tools/*`): وحدات مركزة على الأدوات؛ عند تحميلها بجانب الإضافات يتم تكييفها وتمر عبر أغلفة اعتراض الإضافات.

إذا كنت بحاجة إلى حزمة واحدة تمتلك السياسة والأدوات وتجربة مستخدم الأوامر والعرض معاً، استخدم الإضافات.
