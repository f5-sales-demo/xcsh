---
title: الخطافات
description: نظام الخطافات لأتمتة الأحداث قبل/بعد التنفيذ في دورة حياة وكيل البرمجة.
sidebar:
  order: 4
  label: الخطافات
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# الخطافات

يصف هذا المستند **الكود الحالي لنظام الخطافات الفرعي** في `src/extensibility/hooks/*`.

## الحالة الحالية في وقت التشغيل

حزمة الخطافات (`src/extensibility/hooks/`) لا تزال مُصدَّرة وقابلة للاستخدام كواجهة برمجية، لكن وقت تشغيل واجهة سطر الأوامر الافتراضي يقوم الآن بتهيئة مسار **مُشغّل الإضافات**. في تدفق بدء التشغيل الحالي:

- `--hook` يُعامَل كاسم بديل لـ `--extension` (يتم دمج مسارات واجهة سطر الأوامر في `additionalExtensionPaths`)
- يتم تغليف الأدوات بواسطة `ExtensionToolWrapper`، وليس `HookToolWrapper`
- تحويلات السياق وبث دورة الحياة تمر عبر `ExtensionRunner`

لذا يوثق هذا الملف تنفيذ نظام الخطافات الفرعي نفسه (الأنواع/المُحمّل/المُشغّل/المُغلّف)، بما في ذلك السلوك القديم والقيود.

## الملفات الرئيسية

- `src/extensibility/hooks/types.ts` — سياق الخطاف، أنواع الأحداث، وعقود النتائج
- `src/extensibility/hooks/loader.ts` — تحميل الوحدات وجسر اكتشاف الخطافات
- `src/extensibility/hooks/runner.ts` — إرسال الأحداث، البحث عن الأوامر، الإشارة إلى الأخطاء
- `src/extensibility/hooks/tool-wrapper.ts` — مُغلّف الاعتراض قبل/بعد تنفيذ الأداة
- `src/extensibility/hooks/index.ts` — التصديرات/إعادة التصدير

## ما هي وحدة الخطاف

يجب أن تُصدّر وحدة الخطاف كتصدير افتراضي دالة مصنع:

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

يمكن لدالة المصنع:

- تسجيل معالجات الأحداث باستخدام `pi.on(...)`
- إرسال رسائل مخصصة مستمرة باستخدام `pi.sendMessage(...)`
- حفظ حالة غير متعلقة بنموذج اللغة باستخدام `pi.appendEntry(...)`
- تسجيل أوامر الشرطة المائلة عبر `pi.registerCommand(...)`
- تسجيل عارضات الرسائل المخصصة عبر `pi.registerMessageRenderer(...)`
- تشغيل أوامر الصدفة عبر `pi.exec(...)`

## الاكتشاف والتحميل

`discoverAndLoadHooks(configuredPaths, cwd)` تقوم بـ:

1. تحميل الخطافات المكتشفة من سجل القدرات (`loadCapability("hooks")`)
2. إلحاق المسارات المُعدّة صراحةً (مع إزالة التكرارات حسب المسار المطلق)
3. استدعاء `loadHooks(allPaths, cwd)`

ثم تقوم `loadHooks` باستيراد كل مسار وتتوقع دالة `default`.

### تحليل المسار

`loader.ts` يحلل مسارات الخطافات كالتالي:

- المسار المطلق: يُستخدم كما هو
- مسار `~`: يتم توسيعه
- المسار النسبي: يُحلّ بالنسبة لـ `cwd`

### عدم تطابق قديم مهم

مزودو الاكتشاف لـ `hookCapability` لا يزالون يُصممون ملفات خطافات بأسلوب الصدفة قبل/بعد التنفيذ (على سبيل المثال `.claude/hooks/pre/*`، `.xcsh/.../hooks/pre/*`).

مُحمّل الخطافات هنا يستخدم الاستيراد الديناميكي للوحدات ويتطلب دالة مصنع JS/TS افتراضية. إذا لم يكن مسار الخطاف المكتشف قابلاً للاستيراد كوحدة، يفشل التحميل ويتم الإبلاغ عنه في `LoadHooksResult.errors`.

## أسطح الأحداث

أحداث الخطافات مُحددة الأنواع بشكل صارم في `types.ts`.

### أحداث الجلسة

- `session_start`
- `session_before_switch` → يمكن أن تُرجع `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → يمكن أن تُرجع `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → يمكن أن تُرجع `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → يمكن أن تُرجع `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → يمكن أن تُرجع `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### أحداث الوكيل/السياق

- `context` → يمكن أن تُرجع `{ messages?: Message[] }`
- `before_agent_start` → يمكن أن تُرجع `{ message?: { customType; content; display; details } }`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### أحداث الأداة (نموذج قبل/بعد)

- `tool_call` (قبل التنفيذ) → يمكن أن تُرجع `{ block?: boolean; reason?: string }`
- `tool_result` (بعد التنفيذ) → يمكن أن تُرجع `{ content?; details?; isError? }`

هذا هو نموذج الاعتراض الأساسي قبل/بعد التنفيذ في نظام الخطافات الفرعي.

```text
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## نموذج التنفيذ ودلالات التعديل

### 1) قبل التنفيذ: `tool_call`

`HookToolWrapper.execute()` تُصدر `tool_call` قبل تنفيذ الأداة.

- إذا أرجع أي معالج `{ block: true }`، يتوقف التنفيذ
- إذا ألقى المعالج خطأً، يفشل المُغلّف بأمان ويمنع التنفيذ
- `reason` المُرجع يصبح نص الخطأ المُلقى

### 2) تنفيذ الأداة

تُنفَّذ الأداة الأساسية بشكل طبيعي إذا لم يتم حظرها.

### 3) بعد التنفيذ: `tool_result`

بعد النجاح، يُصدر المُغلّف `tool_result` مع:

- `toolName`، `toolCallId`، `input`
- `content`
- `details`
- `isError: false`

إذا أرجع المعالج تجاوزات:

- `content` يمكن أن يستبدل محتوى النتيجة
- `details` يمكن أن يستبدل تفاصيل النتيجة

عند فشل الأداة، يُصدر المُغلّف `tool_result` مع `isError: true` ونص محتوى الخطأ، ثم يُعيد إلقاء الخطأ الأصلي.

### ما يمكن للخطافات تعديله

- سياق نموذج اللغة لاستدعاء واحد عبر `context` (سلسلة استبدال `messages`)
- محتوى/تفاصيل مخرجات الأداة عند نجاح استدعاءات الأداة (مسار `tool_result`)
- الرسالة المحقونة قبل الوكيل عبر `before_agent_start`
- سلوك الإلغاء/الضغط المخصص/الشجرة عبر `session_before_*` و `session.compacting`

### ما لا يمكن للخطافات تعديله في هذا التنفيذ

- معاملات إدخال الأداة الخام في مكانها (فقط حظر/سماح على `tool_call`)
- استمرار التنفيذ بعد أخطاء الأداة المُلقاة (مسار الخطأ يُعيد الإلقاء)
- حالة النجاح/الخطأ النهائية في سلوك المُغلّف (`isError` المُرجع مُحدد النوع لكن لا يُطبَّق بواسطة `HookToolWrapper`)

## الترتيب وسلوك التعارض

### الترتيب على مستوى الاكتشاف

مزودو القدرات مُرتبون حسب الأولوية (الأعلى أولاً). إزالة التكرارات تتم حسب مفتاح القدرة، الأول يفوز.

بالنسبة لـ `hooks`، مفتاح القدرة هو `${type}:${tool}:${name}`. التكرارات المُظللة من مزودين ذوي أولوية أقل تُعلَّم وتُستبعد من القائمة المكتشفة الفعالة.

### ترتيب التحميل

`discoverAndLoadHooks` تبني قائمة `allPaths` مسطحة، مع إزالة التكرارات حسب المسار المطلق المحلول، ثم تتكرر `loadHooks` بهذا الترتيب.
ترتيب الملفات داخل كل دليل مكتشف يعتمد على مخرجات `readdir`؛ مُحمّل الخطافات لا يقوم بترتيب إضافي.

### ترتيب المعالجات في وقت التشغيل

داخل `HookRunner`، الترتيب حتمي حسب تسلسل التسجيل:

1. ترتيب مصفوفة الخطافات
2. ترتيب تسجيل المعالج لكل خطاف/حدث

سلوك التعارض حسب نوع الحدث:

- `tool_call`: آخر نتيجة مُرجعة تفوز ما لم يحظر معالج؛ أول حظر يقطع الدورة فوراً
- `tool_result`: آخر تجاوز مُرجع يفوز (بدون قطع مبكر)
- `context`: متسلسل؛ كل معالج يتلقى مخرجات الرسائل من المعالج السابق
- `before_agent_start`: أول رسالة مُرجعة تُحفَظ؛ الرسائل اللاحقة تُتجاهل
- `session_before_*`: يتم تتبع آخر نتيجة مُرجعة؛ `cancel: true` يقطع الدورة فوراً
- `session.compacting`: آخر نتيجة مُرجعة تفوز

تعارضات الأوامر/العارضات:

- `getCommand(name)` تُرجع أول تطابق عبر الخطافات (الأول تحميلاً يفوز)
- `getMessageRenderer(customType)` تُرجع أول تطابق
- `getRegisteredCommands()` تُرجع جميع الأوامر (بدون إزالة تكرارات)

## تفاعلات واجهة المستخدم (`HookContext.ui`)

`HookUIContext` تتضمن:

- `select`، `confirm`، `input`، `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`، `getEditorText`
- مُحصّل `theme`

`ctx.hasUI` يشير إلى ما إذا كانت واجهة المستخدم التفاعلية متاحة.

عند التشغيل بدون واجهة مستخدم، السلوك الافتراضي لسياق عدم التنفيذ هو:

- `select/input/editor` تُرجع `undefined`
- `confirm` تُرجع `false`
- `notify`، `setStatus`، `setEditorText` لا تقوم بأي عملية
- `getEditorText` تُرجع `""`

### سلوك سطر الحالة

نص حالة الخطاف المُعيَّن عبر `ctx.ui.setStatus(key, text)`:

- يُخزَّن لكل مفتاح
- يُرتَّب حسب اسم المفتاح
- يُنقَّح (`\r`، `\n`، `\t` → مسافات؛ المسافات المتكررة تُدمج)
- يُدمج ويُقتطع بالعرض للعرض

## انتشار الأخطاء والرجوع الاحتياطي

### وقت التحميل

- وحدة غير صالحة أو تصدير افتراضي مفقود → يُلتقط في `LoadHooksResult.errors`
- يستمر التحميل للخطافات الأخرى

### وقت الحدث

`HookRunner.emit(...)` تلتقط أخطاء المعالج لمعظم الأحداث وتُصدر `HookError` للمستمعين (`hookPath`، `event`، `error`)، ثم تستمر.

`emitToolCall(...)` أكثر صرامة: أخطاء المعالج لا تُبتلع هناك؛ بل تنتشر إلى المُستدعي. في `HookToolWrapper`، هذا يمنع استدعاء الأداة (آمن عند الفشل).

## أمثلة عملية واقعية لواجهة البرمجة

### حظر أوامر bash غير الآمنة

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### تنقيح مخرجات الأداة بعد التنفيذ

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### تعديل سياق النموذج لكل استدعاء لنموذج اللغة

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### تسجيل أمر شرطة مائلة مع أساليب سياق آمنة للأوامر

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## سطح التصدير

`src/extensibility/hooks/index.ts` تُصدّر:

- واجهات التحميل (`discoverAndLoadHooks`، `loadHooks`)
- المُشغّل والمُغلّف (`HookRunner`، `HookToolWrapper`)
- جميع أنواع الخطافات
- إعادة تصدير `execCommand`

وجذر الحزمة (`src/index.ts`) يُعيد تصدير **أنواع** الخطافات كسطح توافقية قديم.
