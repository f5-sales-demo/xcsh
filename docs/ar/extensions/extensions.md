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

الدليل الأساسي لتأليف إضافات وقت التشغيل في `packages/coding-agent`.

يغطي هذا المستند بيئة تشغيل الإضافات الحالية في:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

لمسارات الاكتشاف وقواعد التحميل من نظام الملفات، انظر `docs/extension-loading.md`.

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
- أدوات قابلة للاستدعاء بواسطة نماذج اللغة الكبيرة (`pi.registerTool(...)`)
- أوامر الشرطة المائلة (`pi.registerCommand(...)`)
- اختصارات لوحة المفاتيح والأعلام
- عرض الرسائل المخصص
- واجهات برمجة حقن الجلسات/الرسائل (`sendMessage`، `sendUserMessage`، `appendEntry`)

## نموذج وقت التشغيل

1. يتم استيراد الإضافات وتشغيل دوال المصنع الخاصة بها.
2. خلال مرحلة التحميل تلك، تكون طرق التسجيل صالحة؛ أما طرق الإجراءات في وقت التشغيل فلا تكون مُهيأة بعد.
3. `ExtensionRunner.initialize(...)` يربط الإجراءات/السياقات الحية للوضع النشط.
4. يتم بث أحداث دورة حياة الجلسة/الوكيل/الأداة إلى المعالجات.
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

## بداية سريعة

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

## أسطح واجهة الإضافة البرمجية

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
- `events` (ناقل أحداث مشترك)

في الوضع التفاعلي، تُنفَّذ معالجات `input` قبل فحص العنوان التلقائي للرسالة الأولى المدمج. الإضافات التي تستدعي `await pi.setSessionName(...)` من `input` يمكنها تعيين اسم الجلسة المحفوظ ومنع تشغيل العنوان التلقائي الافتراضي لتلك الجلسة.

تُعرض أيضاً:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (صادرات الحزمة)

### دلالات تسليم الرسائل

`pi.sendMessage(message, options)` يدعم:

- `deliverAs: "steer"` (افتراضي) — يقطع التشغيل الحالي
- `deliverAs: "followUp"` — يُوضع في قائمة الانتظار ليُنفَّذ بعد التشغيل الحالي
- `deliverAs: "nextTurn"` — يُخزَّن ويُحقن عند المطالبة التالية للمستخدم
- `triggerTurn: true` — يبدأ دوراً عند الخمول (`nextTurn` يتجاهل هذا)

`pi.sendUserMessage(content, { deliverAs })` يمر دائماً عبر تدفق المطالبة؛ أثناء البث يُوضع في قائمة الانتظار كتوجيه/متابعة.

## 2) سياق المعالج (`ExtensionContext`)

تستقبل المعالجات ودالة `execute` للأداة `ctx` مع:

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

تحصل معالجات الأوامر بالإضافة على:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

استخدم سياق الأمر لتدفقات التحكم في الجلسات؛ هذه الطرق مفصولة عمداً عن معالجات الأحداث العامة.

## سطح الأحداث (الأسماء والسلوك الحالي)

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

`tool_result` يعمل بأسلوب البرمجيات الوسيطة: تُنفَّذ المعالجات بترتيب الإضافات ويرى كل منها التعديلات السابقة.

### إشارات الموثوقية/وقت التشغيل

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### اعتراض أوامر المستخدم

- `user_bash` (تجاوز مع `{ result }`)
- `user_python` (تجاوز مع `{ result }`)

### `resources_discover`

`resources_discover` موجود في أنواع الإضافة و `ExtensionRunner`.
ملاحظة وقت التشغيل الحالية: `ExtensionRunner.emitResourcesDiscover(...)` مُنفَّذ، لكن لا توجد مواقع استدعاء في `AgentSession` تستدعيه في قاعدة الكود الحالية.

## تفاصيل تأليف الأدوات

`registerTool` يستخدم `ToolDefinition` من `types.ts`.

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

`tool_call`/`tool_result` يعترضان جميع الأدوات بمجرد تغليف السجل في `sdk.ts`، بما في ذلك الأدوات المدمجة وأدوات الإضافات/المخصصة.

## نقاط تكامل واجهة المستخدم

`ctx.ui` ينفّذ واجهة `ExtensionUIContext`. يختلف الدعم حسب الوضع.

### الوضع التفاعلي (`extension-ui-controller.ts`)

مدعوم:

- الحوارات: `select`، `confirm`، `input`، `editor`
- الإشعارات/الحالة/نص المحرر/إدخال الطرفية/التراكبات المخصصة
- قائمة السمات/التحميل بالاسم (`setTheme` يدعم أسماء نصية)
- تبديل توسيع الأدوات

الطرق التي لا تفعل شيئاً حالياً في هذا المتحكم:

- `setFooter`
- `setHeader`
- `setEditorComponent`

أيضاً ملاحظة: `setWidget` يوجّه حالياً إلى نص شريط الحالة عبر `setHookWidget(...)`.

### وضع RPC (`rpc-mode.ts`)

`ctx.ui` مدعوم بأحداث RPC `extension_ui_request`:

- طرق الحوار (`select`، `confirm`، `input`، `editor`) تذهب وتعود إلى استجابات العميل
- الطرق التي تُنفَّذ دون انتظار تبث الطلبات (`notify`، `setStatus`، `setWidget` لمصفوفات النصوص، `setTitle`، `setEditorText`)

غير مدعوم/لا يفعل شيئاً في تنفيذ RPC:

- `onTerminalInput`
- `custom`
- `setFooter`، `setHeader`، `setEditorComponent`
- `setWorkingMessage`
- تبديل/تحميل السمات (`setTheme` يعيد فشلاً)
- عناصر التحكم في توسيع الأدوات خاملة

### مسارات الطباعة/بدون واجهة/الوكيل الفرعي

عند عدم توفير سياق واجهة مستخدم لتهيئة المُشغّل، يكون `ctx.hasUI` بقيمة `false` والطرق لا تفعل شيئاً/تعيد القيم الافتراضية.

### وضع الخلفية التفاعلي

وضع الخلفية يُثبّت كائن سياق واجهة مستخدم غير تفاعلي. في التنفيذ الحالي، قد يكون `ctx.hasUI` بقيمة `true` بينما تعيد الحوارات التفاعلية قيماً افتراضية/سلوك لا يفعل شيئاً.

## أنماط الجلسة والحالة

للحالة الدائمة للإضافة:

1. احفظ باستخدام `pi.appendEntry(customType, data)`.
2. أعد بناء الحالة من `ctx.sessionManager.getBranch()` عند `session_start`، `session_branch`، `session_tree`.
3. حافظ على `details` لنتيجة الأداة منظمة عندما يجب أن تكون الحالة مرئية/قابلة لإعادة البناء من سجل نتائج الأدوات.

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

## نقاط توسيع العرض

## عارض الرسائل المخصص

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

يُستخدم بواسطة العرض التفاعلي عند عرض الرسائل المخصصة.

## عارض استدعاء/نتيجة الأداة

وفّر `renderCall` / `renderResult` في تعريفات `registerTool` لتصور مخصص للأداة في واجهة المستخدم النصية.

## القيود والمزالق

- إجراءات وقت التشغيل غير متاحة أثناء تحميل الإضافة.
- أخطاء `tool_call` تحظر التنفيذ (فشل مغلق).
- تعارضات أسماء الأوامر مع المدمجة يتم تخطيها مع تشخيصات.
- الاختصارات المحجوزة يتم تجاهلها (`ctrl+c`، `ctrl+d`، `ctrl+z`، `ctrl+k`، `ctrl+p`، `ctrl+l`، `ctrl+o`، `ctrl+t`، `ctrl+g`، `shift+tab`، `shift+ctrl+p`، `alt+enter`، `escape`، `enter`).
- تعامل مع `ctx.reload()` كإنهاء لإطار معالج الأمر الحالي.

## الإضافات مقابل الخطافات مقابل الأدوات المخصصة

استخدم السطح المناسب:

- **الإضافات** (`src/extensibility/extensions/*`): نظام موحد (أحداث + أدوات + أوامر + عارضات + تسجيل مزودين).
- **الخطافات** (`src/extensibility/hooks/*`): واجهة أحداث قديمة منفصلة.
- **الأدوات المخصصة** (`src/extensibility/custom-tools/*`): وحدات تركز على الأدوات؛ عند تحميلها جنباً إلى جنب مع الإضافات يتم تكييفها وتمر عبر أغلفة اعتراض الإضافة.

إذا كنت بحاجة إلى حزمة واحدة تمتلك السياسة والأدوات وتجربة المستخدم للأوامر والعرض معاً، استخدم الإضافات.
