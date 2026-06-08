---
title: Hooks
description: Hook system for pre/post event automation in the coding agent lifecycle.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# الخطافات (Hooks)

يصف هذا المستند **الكود الحالي لنظام الخطافات الفرعي** في `src/extensibility/hooks/*`.

## الحالة الحالية في وقت التشغيل

حزمة الخطافات (`src/extensibility/hooks/`) لا تزال مُصدَّرة وقابلة للاستخدام كواجهة برمجية، لكن وقت تشغيل واجهة سطر الأوامر الافتراضي يقوم الآن بتهيئة مسار **مُشغّل الإضافات**. في تدفق بدء التشغيل الحالي:

- يُعامَل `--hook` كاسم مستعار لـ `--extension` (تُدمج مسارات واجهة سطر الأوامر في `additionalExtensionPaths`)
- تُغلَّف الأدوات بواسطة `ExtensionToolWrapper`، وليس `HookToolWrapper`
- تمر تحويلات السياق وإطلاقات دورة الحياة عبر `ExtensionRunner`

لذا يوثق هذا الملف تنفيذ نظام الخطافات الفرعي ذاته (الأنواع/المُحمِّل/المُشغِّل/المُغلِّف)، بما في ذلك السلوك القديم والقيود.

## الملفات الرئيسية

- `src/extensibility/hooks/types.ts` — سياق الخطاف، أنواع الأحداث، وعقود النتائج
- `src/extensibility/hooks/loader.ts` — تحميل الوحدات وجسر اكتشاف الخطافات
- `src/extensibility/hooks/runner.ts` — إرسال الأحداث، البحث عن الأوامر، إشارات الأخطاء
- `src/extensibility/hooks/tool-wrapper.ts` — مُغلِّف اعتراض الأدوات قبل/بعد التنفيذ
- `src/extensibility/hooks/index.ts` — التصديرات/إعادة التصدير

## ما هي وحدة الخطاف

يجب أن تُصدِّر وحدة الخطاف كتصدير افتراضي دالة مصنع:

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
- حفظ حالة غير متعلقة بنموذج اللغة الكبير باستخدام `pi.appendEntry(...)`
- تسجيل أوامر الشرطة المائلة عبر `pi.registerCommand(...)`
- تسجيل عارضات رسائل مخصصة عبر `pi.registerMessageRenderer(...)`
- تشغيل أوامر الصدفة عبر `pi.exec(...)`

## الاكتشاف والتحميل

تقوم `discoverAndLoadHooks(configuredPaths, cwd)` بما يلي:

1. تحميل الخطافات المكتشفة من سجل القدرات (`loadCapability("hooks")`)
2. إضافة المسارات المُهيأة صراحةً (بإزالة التكرار حسب المسار المطلق)
3. استدعاء `loadHooks(allPaths, cwd)`

ثم تقوم `loadHooks` باستيراد كل مسار وتتوقع وجود دالة `default`.

### تحليل المسار

يحلل `loader.ts` مسارات الخطافات كالتالي:

- مسار مطلق: يُستخدم كما هو
- مسار `~`: يُوسَّع
- مسار نسبي: يُحلَّل بالنسبة لـ `cwd`

### عدم تطابق مهم مع النظام القديم

لا تزال مزودات الاكتشاف لـ `hookCapability` تنمذج ملفات خطافات على نمط الصدفة قبل/بعد (على سبيل المثال `.claude/hooks/pre/*`، `.xcsh/.../hooks/pre/*`).

يستخدم مُحمِّل الخطافات هنا الاستيراد الديناميكي للوحدات ويتطلب دالة مصنع JS/TS افتراضية. إذا لم يكن مسار الخطاف المكتشف قابلاً للاستيراد كوحدة، يفشل التحميل ويُبلَّغ عنه في `LoadHooksResult.errors`.

## أسطح الأحداث

أحداث الخطافات مُنمَّطة بقوة في `types.ts`.

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

هذا هو نموذج الاعتراض الأساسي قبل/بعد في نظام الخطافات الفرعي.

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

تُطلق `HookToolWrapper.execute()` حدث `tool_call` قبل تنفيذ الأداة.

- إذا أرجع أي معالج `{ block: true }`، يتوقف التنفيذ
- إذا رمى المعالج خطأً، يفشل المُغلِّف بشكل آمن ويمنع التنفيذ
- تصبح قيمة `reason` المُرجعة نص الخطأ المرمي

### 2) تنفيذ الأداة

تُنفَّذ الأداة الأساسية بشكل طبيعي إذا لم تُحظر.

### 3) بعد التنفيذ: `tool_result`

بعد النجاح، يُطلق المُغلِّف `tool_result` مع:

- `toolName`، `toolCallId`، `input`
- `content`
- `details`
- `isError: false`

إذا أرجع المعالج تجاوزات:

- يمكن لـ `content` استبدال محتوى النتيجة
- يمكن لـ `details` استبدال تفاصيل النتيجة

عند فشل الأداة، يُطلق المُغلِّف `tool_result` مع `isError: true` ونص محتوى الخطأ، ثم يُعيد رمي الخطأ الأصلي.

### ما يمكن للخطافات تعديله

- سياق نموذج اللغة الكبير لاستدعاء واحد عبر `context` (سلسلة استبدال `messages`)
- محتوى/تفاصيل مخرجات الأداة عند نجاح استدعاءات الأدوات (مسار `tool_result`)
- الرسالة المحقونة قبل الوكيل عبر `before_agent_start`
- سلوك الإلغاء/الضغط المخصص/الشجرة عبر `session_before_*` و `session.compacting`

### ما لا يمكن للخطافات تعديله في هذا التنفيذ

- معاملات إدخال الأداة الخام في مكانها (فقط حظر/سماح على `tool_call`)
- استمرار التنفيذ بعد أخطاء الأداة المرمية (مسار الخطأ يُعيد الرمي)
- حالة النجاح/الفشل النهائية في سلوك المُغلِّف (قيمة `isError` المُرجعة مُنمَّطة لكن لا تُطبَّق بواسطة `HookToolWrapper`)

## الترتيب وسلوك التعارض

### الترتيب على مستوى الاكتشاف

تُرتَّب مزودات القدرات حسب الأولوية (الأعلى أولاً). تتم إزالة التكرار حسب مفتاح القدرة، الأول يفوز.

بالنسبة لـ `hooks`، مفتاح القدرة هو `${type}:${tool}:${name}`. تُعلَّم التكرارات المُظلَّلة من المزودات ذات الأولوية الأقل وتُستبعد من القائمة المكتشفة الفعالة.

### ترتيب التحميل

تبني `discoverAndLoadHooks` قائمة مسطحة `allPaths`، مع إزالة التكرار حسب المسار المطلق المُحلَّل، ثم تتكرر `loadHooks` بهذا الترتيب.
يعتمد ترتيب الملفات داخل كل مجلد مكتشف على مخرجات `readdir`؛ لا يقوم مُحمِّل الخطافات بإجراء فرز إضافي.

### ترتيب المعالجات في وقت التشغيل

داخل `HookRunner`، الترتيب حتمي حسب تسلسل التسجيل:

1. ترتيب مصفوفة الخطافات
2. ترتيب تسجيل المعالجات لكل خطاف/حدث

سلوك التعارض حسب نوع الحدث:

- `tool_call`: آخر نتيجة مُرجعة تفوز ما لم يحظر معالج؛ أول حظر يقطع الدائرة
- `tool_result`: آخر تجاوز مُرجع يفوز (بدون قطع دائرة)
- `context`: مُتسلسل؛ كل معالج يتلقى مخرجات رسائل المعالج السابق
- `before_agent_start`: أول رسالة مُرجعة تُحفظ؛ الرسائل اللاحقة تُتجاهل
- `session_before_*`: تُتبع آخر نتيجة مُرجعة؛ `cancel: true` يقطع الدائرة فوراً
- `session.compacting`: آخر نتيجة مُرجعة تفوز

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

عند التشغيل بدون واجهة مستخدم، يكون سلوك السياق الافتراضي بدون عمليات:

- `select/input/editor` تُرجع `undefined`
- `confirm` تُرجع `false`
- `notify`، `setStatus`، `setEditorText` عمليات فارغة
- `getEditorText` تُرجع `""`

### سلوك سطر الحالة

نص حالة الخطاف المُعيَّن عبر `ctx.ui.setStatus(key, text)`:

- يُخزَّن لكل مفتاح
- يُرتَّب حسب اسم المفتاح
- يُنظَّف (`\r`، `\n`، `\t` → مسافات؛ المسافات المتكررة تُدمج)
- يُجمع ويُقتطع العرض للعرض

## انتشار الأخطاء والسلوك الاحتياطي

### وقت التحميل

- وحدة غير صالحة أو تصدير افتراضي مفقود → يُلتقط في `LoadHooksResult.errors`
- يستمر التحميل للخطافات الأخرى

### وقت الحدث

تلتقط `HookRunner.emit(...)` أخطاء المعالجات لمعظم الأحداث وتُطلق `HookError` للمستمعين (`hookPath`، `event`، `error`)، ثم تستمر.

`emitToolCall(...)` أكثر صرامة: لا تُبتلع أخطاء المعالجات هناك؛ بل تنتشر إلى المُستدعي. في `HookToolWrapper`، هذا يحظر استدعاء الأداة (فشل آمن).

## أمثلة واقعية لواجهة البرمجة

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

### تعديل سياق النموذج لكل استدعاء لنموذج اللغة الكبير

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

ويُعيد جذر الحزمة (`src/index.ts`) تصدير **أنواع** الخطافات كسطح توافقية مع النظام القديم.
