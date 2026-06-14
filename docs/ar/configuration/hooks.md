---
title: الخطافات (Hooks)
description: نظام الخطافات للأتمتة قبل/بعد الأحداث في دورة حياة عميل الترميز.
sidebar:
  order: 4
  label: الخطافات (Hooks)
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# الخطافات (Hooks)

يصف هذا المستند **كود نظام الخطافات الحالي** في `src/extensibility/hooks/*`.

## الحالة الراهنة في وقت التشغيل

لا يزال حزمة الخطافات (`src/extensibility/hooks/`) مُصدَّرة وقابلة للاستخدام كسطح API، غير أن وقت تشغيل واجهة سطر الأوامر الافتراضي يُهيّئ الآن مسار **مشغّل الامتدادات**. في تدفق بدء التشغيل الحالي:

- يُعامَل `--hook` كاسم مستعار لـ `--extension` (يتم دمج مسارات واجهة سطر الأوامر في `additionalExtensionPaths`)
- تُغلَّف الأدوات بواسطة `ExtensionToolWrapper`، لا `HookToolWrapper`
- تمر تحويلات السياق وانبعاثات دورة الحياة عبر `ExtensionRunner`

لذلك يوثّق هذا الملف تطبيق نظام الخطافات نفسه (الأنواع/المحمّل/المشغّل/الغلاف)، بما في ذلك السلوك القديم والقيود.

## الملفات الرئيسية

- `src/extensibility/hooks/types.ts` — سياق الخطاف، وأنواع الأحداث، وعقود النتائج
- `src/extensibility/hooks/loader.ts` — تحميل الوحدات وجسر اكتشاف الخطافات
- `src/extensibility/hooks/runner.ts` — إرسال الأحداث، والبحث عن الأوامر، وإشارة الأخطاء
- `src/extensibility/hooks/tool-wrapper.ts` — غلاف اعتراض الأدوات قبل/بعد التنفيذ
- `src/extensibility/hooks/index.ts` — الصادرات/إعادة الصادرات

## ما هي وحدة الخطاف

يجب أن تصدّر وحدة الخطاف تصديرًا افتراضيًا لمصنع:

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

يمكن للمصنع:

- تسجيل معالجات الأحداث باستخدام `pi.on(...)`
- إرسال رسائل مخصصة دائمة باستخدام `pi.sendMessage(...)`
- استمرار الحالة غير المرتبطة بنموذج اللغة الكبير باستخدام `pi.appendEntry(...)`
- تسجيل أوامر الشرطة المائلة عبر `pi.registerCommand(...)`
- تسجيل عارضات رسائل مخصصة عبر `pi.registerMessageRenderer(...)`
- تشغيل أوامر الصدفة عبر `pi.exec(...)`

## الاكتشاف والتحميل

تقوم `discoverAndLoadHooks(configuredPaths, cwd)` بما يلي:

1. تحميل الخطافات المكتشفة من سجل القدرات (`loadCapability("hooks")`)
2. إلحاق المسارات المُهيَّأة صراحةً (مع إزالة التكرار وفق المسار المطلق)
3. استدعاء `loadHooks(allPaths, cwd)`

تستورد `loadHooks` بعد ذلك كل مسار وتتوقع وجود دالة `default`.

### تحليل المسارات

يحلّ `loader.ts` مسارات الخطافات على النحو التالي:

- المسار المطلق: يُستخدم كما هو
- مسار `~`: يُوسَّع
- المسار النسبي: يُحلّ بالنسبة إلى `cwd`

### عدم التطابق مع النظام القديم

لا تزال موفرو الاكتشاف لـ `hookCapability` تُنمذج ملفات خطافات الصدفة الأسلوب قبل/بعد (مثلاً `.claude/hooks/pre/*`، `.xcsh/.../hooks/pre/*`).

يستخدم محمّل الخطافات هنا استيراد الوحدة الديناميكي ويتطلب وجود مصنع خطاف JS/TS افتراضي. إذا كان مسار الخطاف المكتشف غير قابل للاستيراد كوحدة، يفشل التحميل ويُبلَّغ عنه في `LoadHooksResult.errors`.

## أسطح الأحداث

أحداث الخطافات مكتوبة بشكل صارم في `types.ts`.

### أحداث الجلسة

- `session_start`
- `session_before_switch` → يمكن أن يُرجع `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → يمكن أن يُرجع `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → يمكن أن يُرجع `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → يمكن أن يُرجع `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → يمكن أن يُرجع `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### أحداث العامل/السياق

- `context` → يمكن أن يُرجع `{ messages?: Message[] }`
- `before_agent_start` → يمكن أن يُرجع `{ message?: { customType; content; display; details } }`
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

### أحداث الأدوات (نموذج قبل/بعد)

- `tool_call` (قبل التنفيذ) → يمكن أن يُرجع `{ block?: boolean; reason?: string }`
- `tool_result` (بعد التنفيذ) → يمكن أن يُرجع `{ content?; details?; isError? }`

هذا هو النموذج الأساسي للاعتراض قبل/بعد في نظام الخطافات.

```text
تدفق اعتراض خطاف الأداة

معالجات tool_call
   │
   ├─ أي { block: true }؟ ── نعم ──> رمي استثناء (الأداة محظورة)
   │
   └─ لا
      │
      ▼
   تنفيذ الأداة الأساسية
      │
      ├─ نجاح ──> يمكن لمعالجات tool_result تجاوز { content, details }
      │
      └─ خطأ   ──> إصدار tool_result(isError=true) ثم إعادة رمي الخطأ الأصلي
```

## نموذج التنفيذ ودلالات التحويل

### 1) قبل التنفيذ: `tool_call`

تُصدر `HookToolWrapper.execute()` حدث `tool_call` قبل تنفيذ الأداة.

- إذا أرجع أي معالج `{ block: true }`، يتوقف التنفيذ
- إذا رمى المعالج استثناءً، يفشل الغلاف بأمان ويحظر التنفيذ
- يصبح `reason` المُرجَع نص الخطأ المرمي

### 2) تنفيذ الأداة

تُنفَّذ الأداة الأساسية بشكل طبيعي إذا لم تُحظر.

### 3) بعد التنفيذ: `tool_result`

بعد النجاح، يُصدر الغلاف حدث `tool_result` مع:

- `toolName`، `toolCallId`، `input`
- `content`
- `details`
- `isError: false`

إذا أرجع المعالج تجاوزات:

- يمكن لـ `content` استبدال محتوى النتيجة
- يمكن لـ `details` استبدال تفاصيل النتيجة

عند فشل الأداة، يُصدر الغلاف حدث `tool_result` مع `isError: true` ومحتوى نص الخطأ، ثم يُعيد رمي الخطأ الأصلي.

### ما يمكن للخطافات تحويله

- سياق نموذج اللغة الكبير لاستدعاء واحد عبر `context` (سلسلة استبدال `messages`)
- محتوى/تفاصيل مخرجات الأداة عند نجاح استدعاءات الأداة (مسار `tool_result`)
- الرسالة المُحقونة قبل بدء العامل عبر `before_agent_start`
- سلوك الإلغاء/الضغط المخصص/الشجرة عبر `session_before_*` و`session.compacting`

### ما لا يمكن للخطافات تحويله في هذا التطبيق

- معاملات إدخال الأداة الخام في مكانها (الحظر/السماح فقط على `tool_call`)
- استمرار التنفيذ بعد أخطاء الأداة المرمية (مسار الخطأ يُعيد الرمي)
- حالة النجاح/الخطأ النهائية في سلوك الغلاف (النوع المُرجَع `isError` لا يُطبَّق بواسطة `HookToolWrapper`)

## الترتيب وسلوك التعارض

### ترتيب مستوى الاكتشاف

يُرتَّب موفرو القدرات حسب الأولوية (الأعلى أولاً). إزالة التكرار تكون بمفتاح القدرة، الأول يفوز.

بالنسبة لـ `hooks`، مفتاح القدرة هو `${type}:${tool}:${name}`. التكرارات المُظلَّلة من الموفرين ذوي الأولوية الأدنى مُعلَّمة ومستبعدة من القائمة المكتشفة الفعّالة.

### ترتيب التحميل

تبني `discoverAndLoadHooks` قائمة `allPaths` مسطحة، مُزالة التكرار بالمسار المطلق المحلول، ثم تكرر `loadHooks` بذلك الترتيب.
يعتمد ترتيب الملفات داخل كل دليل مكتشف على مخرجات `readdir`؛ لا يُجري محمّل الخطافات ترتيبًا إضافيًا.

### ترتيب المعالجات في وقت التشغيل

داخل `HookRunner`، الترتيب محدد بتسلسل التسجيل:

1. ترتيب مصفوفة الخطافات
2. ترتيب تسجيل المعالجات لكل خطاف/حدث

سلوك التعارض حسب نوع الحدث:

- `tool_call`: آخر نتيجة مُرجَعة تفوز ما لم يحظر أحد المعالجات؛ أول حظر يُقصر الدائرة
- `tool_result`: آخر تجاوز مُرجَع يفوز (بدون تقصير الدائرة)
- `context`: متسلسل؛ كل معالج يستقبل مخرجات رسائل المعالج السابق
- `before_agent_start`: أول رسالة مُرجَعة تُحفظ؛ الرسائل اللاحقة تُتجاهل
- `session_before_*`: يُتتبَّع آخر نتيجة مُرجَعة؛ `cancel: true` يُقصر الدائرة فورًا
- `session.compacting`: آخر نتيجة مُرجَعة تفوز

تعارضات الأوامر/العارضات:

- يُرجع `getCommand(name)` أول تطابق عبر الخطافات (الأول المحمَّل يفوز)
- يُرجع `getMessageRenderer(customType)` أول تطابق
- يُرجع `getRegisteredCommands()` جميع الأوامر (بدون إزالة تكرار)

## تفاعلات واجهة المستخدم (`HookContext.ui`)

يتضمن `HookUIContext`:

- `select`، `confirm`، `input`، `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`، `getEditorText`
- مُحصِّل `theme`

يشير `ctx.hasUI` إلى ما إذا كانت واجهة المستخدم التفاعلية متاحة.

عند التشغيل بدون واجهة مستخدم، يكون سلوك السياق الافتراضي عديم التأثير:

- تُرجع `select/input/editor` القيمة `undefined`
- تُرجع `confirm` القيمة `false`
- `notify` و`setStatus` و`setEditorText` لا تؤثر على شيء
- تُرجع `getEditorText` القيمة `""`

### سلوك سطر الحالة

نص حالة الخطاف المُعيَّن عبر `ctx.ui.setStatus(key, text)`:

- يُخزَّن لكل مفتاح
- يُرتَّب حسب اسم المفتاح
- يُعقَّم (`\r`، `\n`، `\t` → مسافات؛ تُطوى المسافات المتكررة)
- يُدمج ويُقتطع بحسب العرض للعرض

## انتشار الأخطاء والرجوع

### وقت التحميل

- وحدة غير صالحة أو تصدير افتراضي مفقود → يُلتقط في `LoadHooksResult.errors`
- يستمر التحميل للخطافات الأخرى

### وقت الحدث

تلتقط `HookRunner.emit(...)` أخطاء المعالجات لمعظم الأحداث وتُصدر `HookError` للمستمعين (`hookPath`، `event`، `error`)، ثم تستمر.

`emitToolCall(...)` أكثر صرامة: لا تُبتلع أخطاء المعالجات هنا؛ بل تنتشر إلى المُستدعي. في `HookToolWrapper`، يحظر هذا استدعاء الأداة (الفشل الآمن).

## أمثلة API واقعية

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

### تعديل سياق النموذج لكل استدعاء نموذج اللغة الكبير

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### تسجيل أمر الشرطة المائلة مع أساليب سياق آمنة للأوامر

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

يُصدر `src/extensibility/hooks/index.ts`:

- واجهات برمجة التحميل (`discoverAndLoadHooks`، `loadHooks`)
- المشغّل والغلاف (`HookRunner`، `HookToolWrapper`)
- جميع أنواع الخطافات
- إعادة تصدير `execCommand`

ويُعيد جذر الحزمة (`src/index.ts`) تصدير **أنواع** الخطافات كسطح توافق قديم.
