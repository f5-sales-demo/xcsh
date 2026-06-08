---
title: Hooks
description: نظام الخطافات لأتمتة الأحداث قبل وبعد دورة حياة وكيل البرمجة.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# الخطافات (Hooks)

يصف هذا المستند **الكود الحالي لنظام الخطافات الفرعي** في `src/extensibility/hooks/*`.

## الحالة الراهنة في وقت التشغيل

حزمة الخطافات (`src/extensibility/hooks/`) لا تزال مُصدَّرة وقابلة للاستخدام كواجهة برمجية، لكن وقت تشغيل واجهة سطر الأوامر الافتراضي يُهيئ الآن مسار **مُشغِّل الإضافات**. في تدفق بدء التشغيل الحالي:

- يُعامَل `--hook` كاسم مستعار لـ `--extension` (تُدمج مسارات واجهة سطر الأوامر في `additionalExtensionPaths`)
- تُغلَّف الأدوات بواسطة `ExtensionToolWrapper`، وليس `HookToolWrapper`
- تمر تحويلات السياق وإصدارات دورة الحياة عبر `ExtensionRunner`

لذا يوثق هذا الملف تنفيذ نظام الخطافات الفرعي ذاته (الأنواع/المُحمِّل/المُشغِّل/المُغلِّف)، بما في ذلك السلوك القديم والقيود.

## الملفات الرئيسية

- `src/extensibility/hooks/types.ts` — سياق الخطاف وأنواع الأحداث وعقود النتائج
- `src/extensibility/hooks/loader.ts` — تحميل الوحدات وجسر اكتشاف الخطافات
- `src/extensibility/hooks/runner.ts` — إرسال الأحداث والبحث عن الأوامر وإشارات الأخطاء
- `src/extensibility/hooks/tool-wrapper.ts` — مُغلِّف اعتراض الأدوات قبل/بعد التنفيذ
- `src/extensibility/hooks/index.ts` — التصديرات/إعادة التصديرات

## ما هي وحدة الخطاف

يجب أن تُصدِّر وحدة الخطاف دالة مصنع كتصدير افتراضي:

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
- إرسال رسائل مخصصة دائمة باستخدام `pi.sendMessage(...)`
- حفظ حالة غير متعلقة بنموذج اللغة باستخدام `pi.appendEntry(...)`
- تسجيل أوامر الشرطة المائلة عبر `pi.registerCommand(...)`
- تسجيل عارضات رسائل مخصصة عبر `pi.registerMessageRenderer(...)`
- تنفيذ أوامر الطرفية عبر `pi.exec(...)`

## الاكتشاف والتحميل

تقوم `discoverAndLoadHooks(configuredPaths, cwd)` بما يلي:

1. تحميل الخطافات المكتشفة من سجل القدرات (`loadCapability("hooks")`)
2. إلحاق المسارات المُعدَّة صراحةً (مع إزالة التكرار بالمسار المطلق)
3. استدعاء `loadHooks(allPaths, cwd)`

ثم تستورد `loadHooks` كل مسار وتتوقع دالة `default`.

### تحليل المسارات

يحلل `loader.ts` مسارات الخطافات كالتالي:

- المسار المطلق: يُستخدم كما هو
- مسار `~`: يُوسَّع
- المسار النسبي: يُحلَّل نسبةً إلى `cwd`

### عدم تطابق قديم مهم

لا تزال مزودات الاكتشاف لـ `hookCapability` تنمذج ملفات خطافات بنمط shell للتنفيذ قبل/بعد (على سبيل المثال `.claude/hooks/pre/*`، `.xcsh/.../hooks/pre/*`).

يستخدم مُحمِّل الخطافات هنا استيراداً ديناميكياً للوحدات ويتطلب دالة مصنع JS/TS افتراضية. إذا لم يكن مسار الخطاف المكتشف قابلاً للاستيراد كوحدة، يفشل التحميل ويُبلَّغ عنه في `LoadHooksResult.errors`.

## أسطح الأحداث

أحداث الخطافات مُنمَّطة بشكل صارم في `types.ts`.

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

### أحداث الأدوات (نموذج قبل/بعد)

- `tool_call` (قبل التنفيذ) → يمكن أن تُرجع `{ block?: boolean; reason?: string }`
- `tool_result` (بعد التنفيذ) → يمكن أن تُرجع `{ content?; details?; isError? }`

هذا هو نموذج الاعتراض الأساسي قبل/بعد لنظام الخطافات الفرعي.

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

تُصدر `HookToolWrapper.execute()` حدث `tool_call` قبل تنفيذ الأداة.

- إذا أرجع أي معالج `{ block: true }`، يتوقف التنفيذ
- إذا أطلق المعالج خطأً، يفشل المُغلِّف بشكل آمن ويحجب التنفيذ
- يصبح `reason` المُرجَع نص الخطأ المُطلَق

### 2) تنفيذ الأداة

تُنفَّذ الأداة الأساسية بشكل طبيعي إذا لم تُحجَب.

### 3) بعد التنفيذ: `tool_result`

بعد النجاح، يُصدر المُغلِّف حدث `tool_result` مع:

- `toolName`، `toolCallId`، `input`
- `content`
- `details`
- `isError: false`

إذا أرجع المعالج تجاوزات:

- يمكن لـ `content` استبدال محتوى النتيجة
- يمكن لـ `details` استبدال تفاصيل النتيجة

عند فشل الأداة، يُصدر المُغلِّف حدث `tool_result` مع `isError: true` ونص الخطأ كمحتوى، ثم يعيد طرح الخطأ الأصلي.

### ما يمكن للخطافات تعديله

- سياق نموذج اللغة لاستدعاء واحد عبر `context` (سلسلة استبدال `messages`)
- محتوى/تفاصيل مخرجات الأداة عند نجاح استدعاءات الأدوات (مسار `tool_result`)
- رسالة محقونة قبل الوكيل عبر `before_agent_start`
- سلوك الإلغاء/الضغط المخصص/الشجرة عبر `session_before_*` و `session.compacting`

### ما لا يمكن للخطافات تعديله في هذا التنفيذ

- معاملات إدخال الأداة الخام في مكانها (فقط حجب/سماح على `tool_call`)
- استمرار التنفيذ بعد أخطاء الأداة المُطلَقة (مسار الخطأ يعيد الطرح)
- حالة النجاح/الخطأ النهائية في سلوك المُغلِّف (`isError` المُرجَع مُنمَّط لكن لا يُطبَّق بواسطة `HookToolWrapper`)

## الترتيب وسلوك التعارض

### الترتيب على مستوى الاكتشاف

تُرتَّب مزودات القدرات حسب الأولوية (الأعلى أولاً). إزالة التكرار تتم بمفتاح القدرة، والأول يفوز.

بالنسبة لـ `hooks`، مفتاح القدرة هو `${type}:${tool}:${name}`. تُعلَّم التكرارات المظلَّلة من المزودات ذات الأولوية الأدنى وتُستبعَد من القائمة المكتشفة الفعالة.

### ترتيب التحميل

تبني `discoverAndLoadHooks` قائمة `allPaths` مسطحة، مع إزالة التكرار بالمسار المطلق المُحلَّل، ثم تتكرر `loadHooks` بهذا الترتيب.
يعتمد ترتيب الملفات داخل كل مجلد مكتشف على مخرجات `readdir`؛ لا يُجري مُحمِّل الخطافات ترتيباً إضافياً.

### ترتيب المعالجات في وقت التشغيل

داخل `HookRunner`، الترتيب حتمي بتسلسل التسجيل:

1. ترتيب مصفوفة الخطافات
2. ترتيب تسجيل المعالجات لكل خطاف/حدث

سلوك التعارض حسب نوع الحدث:

- `tool_call`: النتيجة الأخيرة المُرجَعة تفوز ما لم يحجب معالج؛ أول حجب يقطع الدائرة
- `tool_result`: آخر تجاوز مُرجَع يفوز (بدون قطع دائرة)
- `context`: متسلسل؛ كل معالج يتلقى مخرجات الرسائل من المعالج السابق
- `before_agent_start`: أول رسالة مُرجَعة تُحفَظ؛ الرسائل اللاحقة تُتجاهَل
- `session_before_*`: تُتتبَّع آخر نتيجة مُرجَعة؛ `cancel: true` يقطع الدائرة فوراً
- `session.compacting`: آخر نتيجة مُرجَعة تفوز

تعارضات الأوامر/العارضات:

- `getCommand(name)` تُرجع أول تطابق عبر الخطافات (الأول تحميلاً يفوز)
- `getMessageRenderer(customType)` تُرجع أول تطابق
- `getRegisteredCommands()` تُرجع جميع الأوامر (بدون إزالة تكرار)

## تفاعلات واجهة المستخدم (`HookContext.ui`)

يتضمن `HookUIContext`:

- `select`، `confirm`، `input`، `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`، `getEditorText`
- مُحصِّل `theme`

يشير `ctx.hasUI` إلى ما إذا كانت واجهة المستخدم التفاعلية متاحة.

عند التشغيل بدون واجهة مستخدم، يكون سلوك السياق الافتراضي بلا عمليات كالتالي:

- `select/input/editor` تُرجع `undefined`
- `confirm` تُرجع `false`
- `notify`، `setStatus`، `setEditorText` بلا عمليات
- `getEditorText` تُرجع `""`

### سلوك سطر الحالة

نص حالة الخطاف المُعيَّن عبر `ctx.ui.setStatus(key, text)`:

- يُخزَّن لكل مفتاح
- يُرتَّب حسب اسم المفتاح
- يُعقَّم (`\r`، `\n`، `\t` → مسافات؛ المسافات المتكررة تُدمَج)
- يُدمَج ويُقتطَع بالعرض للعرض

## انتشار الأخطاء والاحتياطي

### وقت التحميل

- وحدة غير صالحة أو تصدير افتراضي مفقود → يُلتقَط في `LoadHooksResult.errors`
- يستمر التحميل للخطافات الأخرى

### وقت الحدث

يلتقط `HookRunner.emit(...)` أخطاء المعالج لمعظم الأحداث ويُصدر `HookError` للمستمعين (`hookPath`، `event`، `error`)، ثم يستمر.

`emitToolCall(...)` أكثر صرامة: لا تُبتلَع أخطاء المعالج هناك؛ بل تنتشر إلى المُستدعي. في `HookToolWrapper`، هذا يحجب استدعاء الأداة (آمن عند الفشل).

## أمثلة واقعية لواجهة البرمجة

### حجب أوامر bash غير الآمنة

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

### تسجيل أمر شرطة مائلة مع طرق سياق آمنة للأوامر

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

يُصدِّر `src/extensibility/hooks/index.ts`:

- واجهات التحميل البرمجية (`discoverAndLoadHooks`، `loadHooks`)
- المُشغِّل والمُغلِّف (`HookRunner`، `HookToolWrapper`)
- جميع أنواع الخطافات
- إعادة تصدير `execCommand`

وجذر الحزمة (`src/index.ts`) يعيد تصدير **أنواع** الخطافات كسطح توافقية قديم.
