---
title: الإضافات
description: >-
  نظرة عامة على وقت تشغيل الإضافات تشمل الأنواع ودورة حياة المُشغِّل والتسجيل
  والاكتشاف.
sidebar:
  order: 1
  label: نظرة عامة
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# الإضافات

الدليل الأساسي لتأليف إضافات وقت التشغيل في `packages/coding-agent`.

تغطي هذه الوثيقة وقت تشغيل الإضافات الحالي في:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

للاطلاع على مسارات الاكتشاف وقواعد التحميل من نظام الملفات، راجع `docs/extension-loading.md`.

## ما هي الإضافة

الإضافة هي وحدة TS/JS تُصدِّر مصنعًا افتراضيًا:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

يمكن للإضافات الجمع بين كل ما يلي في وحدة واحدة:

- معالجات الأحداث (`pi.on(...)`)
- الأدوات القابلة للاستدعاء بواسطة LLM (`pi.registerTool(...)`)
- أوامر الشرطة المائلة (`pi.registerCommand(...)`)
- اختصارات لوحة المفاتيح والأعلام
- عرض الرسائل المخصص
- واجهات برمجية لحقن الجلسات/الرسائل (`sendMessage`، `sendUserMessage`، `appendEntry`)

## نموذج وقت التشغيل

1. يتم استيراد الإضافات وتشغيل دوال المصنع الخاصة بها.
2. خلال مرحلة التحميل هذه، تكون طرق التسجيل صالحة؛ أما طرق الإجراءات في وقت التشغيل فلم تُهيَّأ بعد.
3. تقوم `ExtensionRunner.initialize(...)` بربط الإجراءات/السياقات الحية للوضع النشط.
4. تُرسَل أحداث دورة حياة الجلسة/الوكيل/الأداة إلى المعالجات.
5. يتم تغليف كل تنفيذ للأدوات باعتراض الإضافات (`tool_call` / `tool_result`).

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

- استدعاء طرق الإجراءات مثل `pi.sendMessage()` أثناء تحميل الإضافة يُلقي `ExtensionRuntimeNotInitializedError`
- قم بالتسجيل أولاً؛ ونفِّذ سلوك وقت التشغيل من الأحداث/الأوامر/الأدوات

## البداية السريعة

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
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
- `events` (ناقل أحداث مشترك)

في الوضع التفاعلي، تعمل معالجات `input` قبل الفحص الافتراضي للعنوان التلقائي للرسالة الأولى. يمكن للإضافات التي تستدعي `await pi.setSessionName(...)` من `input` تعيين اسم الجلسة الدائم ومنع تشغيل العنوان المُولَّد تلقائيًا الافتراضي لتلك الجلسة.

كما يتاح أيضاً:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (صادرات الحزمة)

### دلالات توصيل الرسائل

تدعم `pi.sendMessage(message, options)`:

- `deliverAs: "steer"` (الافتراضي) — يقاطع التشغيل الحالي
- `deliverAs: "followUp"` — مُدرَج في الطابور للتشغيل بعد التشغيل الحالي
- `deliverAs: "nextTurn"` — مُخزَّن ويُحقَن في موجه المستخدم التالي
- `triggerTurn: true` — يبدأ دورة عند الخمول (`nextTurn` يتجاهل هذا)

تمر `pi.sendUserMessage(content, { deliverAs })` دائمًا عبر تدفق الموجه؛ أثناء البث تُدرَج في الطابور كتوجيه/متابعة.

## 2) سياق المعالج (`ExtensionContext`)

تستقبل المعالجات وأداة `execute` السياق `ctx` الذي يحتوي على:

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

تحصل معالجات الأوامر إضافةً إلى ذلك على:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

استخدم سياق الأمر لتدفقات التحكم في الجلسات؛ هذه الطرق مفصولة عمدًا عن معالجات الأحداث العامة.

## سطح الأحداث (الأسماء والسلوك الحالي)

اتحادات الأحداث الأساسية وأنواع الحمولة موجودة في `types.ts`.

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

### دورة حياة الموجه والدورة

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### دورة حياة الأداة

- `tool_call` (ما قبل التنفيذ، يمكن الحجب)
- `tool_result` (ما بعد التنفيذ، يمكن تعديل المحتوى/التفاصيل/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (قابلية المراقبة)

`tool_result` ذو أسلوب وسيط: تعمل المعالجات بترتيب الإضافات وكل منها يرى التعديلات السابقة.

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
ملاحظة وقت التشغيل الحالي: `ExtensionRunner.emitResourcesDiscover(...)` مُنفَّذ، لكن لا توجد نقاط استدعاء `AgentSession` تستدعيه في قاعدة الكود الحالية.

## تفاصيل تأليف الأدوات

تستخدم `registerTool` الـ `ToolDefinition` من `types.ts`.

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

القالب:

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

يُنفِّذ `ctx.ui` واجهة `ExtensionUIContext`. يختلف الدعم حسب الوضع.

### الوضع التفاعلي (`extension-ui-controller.ts`)

المدعوم:

- مربعات الحوار: `select`، `confirm`، `input`، `editor`
- الإشعارات/الحالة/نص المحرر/إدخال الطرفية/التراكبات المخصصة
- سرد السمات/تحميلها بالاسم (`setTheme` يدعم أسماء السلاسل)
- تبديل توسيع الأدوات

الطرق التي لا تُنفِّذ شيئًا حاليًا في هذا المتحكم:

- `setFooter`
- `setHeader`
- `setEditorComponent`

لاحظ أيضًا: يتوجه `setWidget` حاليًا إلى نص سطر الحالة عبر `setHookWidget(...)`.

### وضع RPC (`rpc-mode.ts`)

يعتمد `ctx.ui` على أحداث `extension_ui_request` الخاصة بـ RPC:

- طرق مربعات الحوار (`select`، `confirm`، `input`، `editor`) تُرسَل ذهابًا وإيابًا إلى استجابات العميل
- الطرق التي ترسل وتنسى تُطلق طلبات (`notify`، `setStatus`، `setWidget` لمصفوفات السلاسل، `setTitle`، `setEditorText`)

غير مدعوم/لا يُنفِّذ شيئًا في تنفيذ RPC:

- `onTerminalInput`
- `custom`
- `setFooter`، `setHeader`، `setEditorComponent`
- `setWorkingMessage`
- تبديل السمات/تحميلها (`setTheme` يُعيد فشلاً)
- عناصر التحكم في توسيع الأدوات غير فعّالة

### مسارات الطباعة/بدون رأس/الوكيل الفرعي

عند عدم تزويد سياق واجهة المستخدم لتهيئة المُشغِّل، يكون `ctx.hasUI` بقيمة `false` وتكون الطرق عديمة التأثير أو تُعيد قيمة افتراضية.

### وضع تفاعلي في الخلفية

يُثبِّت وضع الخلفية كائن سياق واجهة مستخدم غير تفاعلي. في التنفيذ الحالي، قد يظل `ctx.hasUI` بقيمة `true` بينما تُعيد مربعات الحوار التفاعلية قيمًا افتراضية/لا تُنفِّذ شيئًا.

## أنماط الجلسة والحالة

للحفاظ الدائم على حالة الإضافة:

1. احفظ بـ `pi.appendEntry(customType, data)`.
2. أعد بناء الحالة من `ctx.sessionManager.getBranch()` عند `session_start`، `session_branch`، `session_tree`.
3. احتفظ بـ `details` نتيجة الأداة منظَّمة عندما يجب أن تكون الحالة مرئية/قابلة للإعادة من تاريخ نتائج الأداة.

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

## نقاط توسعة العرض

## عارض الرسائل المخصص

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

يُستخدم في العرض التفاعلي عند عرض الرسائل المخصصة.

## عارض استدعاء/نتيجة الأداة

قدِّم `renderCall` / `renderResult` على تعريفات `registerTool` لتصوير مخصص للأداة في TUI.

## القيود والمزالق

- إجراءات وقت التشغيل غير متاحة أثناء تحميل الإضافة.
- أخطاء `tool_call` تحجب التنفيذ (الفشل مغلق).
- تعارضات أسماء الأوامر مع الأوامر المدمجة يتم تخطيها مع تشخيصات.
- الاختصارات المحجوزة يتم تجاهلها (`ctrl+c`، `ctrl+d`، `ctrl+z`، `ctrl+k`، `ctrl+p`، `ctrl+l`، `ctrl+o`، `ctrl+t`، `ctrl+g`، `shift+tab`، `shift+ctrl+p`، `alt+enter`، `escape`، `enter`).
- عامِل `ctx.reload()` باعتباره نهائيًا لإطار معالج الأمر الحالي.

## الإضافات مقابل الخطافات مقابل الأدوات المخصصة

استخدم السطح المناسب:

- **الإضافات** (`src/extensibility/extensions/*`): نظام موحد (أحداث + أدوات + أوامر + عارضات + تسجيل الموفر).
- **الخطافات** (`src/extensibility/hooks/*`): واجهة برمجية للأحداث إرثية منفصلة.
- **الأدوات المخصصة** (`src/extensibility/custom-tools/*`): وحدات تركز على الأدوات؛ عند تحميلها جنبًا إلى جنب مع الإضافات يتم تكييفها وتمريرها عبر أغلفة اعتراض الإضافات.

إذا كنت بحاجة إلى حزمة واحدة تمتلك السياسة والأدوات وتجربة مستخدم الأوامر والعرض معًا، فاستخدم الإضافات.
