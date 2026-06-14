---
title: الخطافات
description: نظام الخطافات للأتمتة قبل/بعد الأحداث في دورة حياة وكيل الترميز.
sidebar:
  order: 4
  label: الخطافات
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# الخطافات

يصف هذا المستند **كود نظام الخطافات الحالي** في `src/extensibility/hooks/*`.

## الحالة الراهنة في وقت التشغيل

لا يزال حزمة الخطافات (`src/extensibility/hooks/`) مُصدَّرة وقابلة للاستخدام كسطح API، غير أن وقت تشغيل CLI الافتراضي يُهيئ الآن مسار **منفذ الامتدادات**. في تدفق بدء التشغيل الحالي:

- يُعامَل `--hook` كاسم مستعار لـ `--extension` (يتم دمج مسارات CLI في `additionalExtensionPaths`)
- تُغلَّف الأدوات بواسطة `ExtensionToolWrapper`، وليس `HookToolWrapper`
- تتم تحويلات السياق وإرسال دورة الحياة عبر `ExtensionRunner`

لذلك يوثق هذا الملف تنفيذ نظام الخطافات بحد ذاته (الأنواع/المُحمِّل/المنفذ/الغلاف)، بما في ذلك السلوك القديم والقيود.

## الملفات الرئيسية

- `src/extensibility/hooks/types.ts` — سياق الخطاف، وأنواع الأحداث، وعقود النتائج
- `src/extensibility/hooks/loader.ts` — تحميل الوحدات وجسر اكتشاف الخطافات
- `src/extensibility/hooks/runner.ts` — إرسال الأحداث، والبحث عن الأوامر، وإشارات الخطأ
- `src/extensibility/hooks/tool-wrapper.ts` — غلاف الاعتراض قبل/بعد الأداة
- `src/extensibility/hooks/index.ts` — الصادرات وإعادة الصادرات

## ما هي وحدة الخطاف

يجب على وحدة الخطاف تصدير مصنع افتراضي:

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

يمكن للمصنع أن:

- يسجل معالجات الأحداث عبر `pi.on(...)`
- يُرسل رسائل مخصصة دائمة عبر `pi.sendMessage(...)`
- يُثبت حالة غير مرتبطة بنموذج اللغة عبر `pi.appendEntry(...)`
- يسجل أوامر الشرطة المائلة عبر `pi.registerCommand(...)`
- يسجل عارضات رسائل مخصصة عبر `pi.registerMessageRenderer(...)`
- ينفذ أوامر الصدفة عبر `pi.exec(...)`

## الاكتشاف والتحميل

تقوم `discoverAndLoadHooks(configuredPaths, cwd)` بما يلي:

1. تحميل الخطافات المكتشفة من سجل القدرات (`loadCapability("hooks")`)
2. إلحاق المسارات المُهيأة صراحةً (مُقيَّدة التكرار بالمسار المطلق)
3. استدعاء `loadHooks(allPaths, cwd)`

تستورد `loadHooks` كل مسار وتتوقع وجود دالة `default`.

### حل مسارات الملفات

يحل `loader.ts` مسارات الخطافات على النحو التالي:

- المسار المطلق: يُستخدم كما هو
- مسار `~`: يُوسَّع
- المسار النسبي: يُحَل بالنسبة إلى `cwd`

### تعارض قديم مهم

لا تزال موفرات الاكتشاف لـ `hookCapability` تُمثِّل ملفات خطاف قبل/بعد بأسلوب الصدفة (مثلاً `.claude/hooks/pre/*`، `.xcsh/.../hooks/pre/*`).

يستخدم مُحمِّل الخطافات هنا الاستيراد الديناميكي للوحدات ويتطلب مصنع خطاف JS/TS افتراضياً. إذا كان مسار الخطاف المكتشف غير قابل للاستيراد كوحدة، يفشل التحميل ويُبلَّغ عنه في `LoadHooksResult.errors`.

## أسطح الأحداث

أحداث الخطافات ذات أنواع محددة بدقة في `types.ts`.

### أحداث الجلسة

- `session_start`
- `session_before_switch` ← يمكن أن يُعيد `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` ← يمكن أن يُعيد `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` ← يمكن أن يُعيد `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` ← يمكن أن يُعيد `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` ← يمكن أن يُعيد `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### أحداث الوكيل/السياق

- `context` ← يمكن أن يُعيد `{ messages?: Message[] }`
- `before_agent_start` ← يمكن أن يُعيد `{ message?: { customType; content; display; details } }`
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

- `tool_call` (قبل التنفيذ) ← يمكن أن يُعيد `{ block?: boolean; reason?: string }`
- `tool_result` (بعد التنفيذ) ← يمكن أن يُعيد `{ content?; details?; isError? }`

هذا هو نموذج الاعتراض الأساسي قبل/بعد في نظام الخطافات.

```text
تدفق اعتراض أداة الخطاف

معالجات tool_call
   │
   ├─ أي { block: true }؟ ── نعم ──> رمي (الأداة محجوبة)
   │
   └─ لا
      │
      ▼
   تنفيذ الأداة الأساسية
      │
      ├─ نجاح ──> يمكن لمعالجات tool_result تجاوز { content, details }
      │
      └─ خطأ   ──> إرسال tool_result(isError=true) ثم إعادة رمي الخطأ الأصلي
```

## نموذج التنفيذ ودلالات الطفرة

### 1) قبل التنفيذ: `tool_call`

تُرسل `HookToolWrapper.execute()` حدث `tool_call` قبل تنفيذ الأداة.

- إذا أعاد أي معالج `{ block: true }`، يتوقف التنفيذ
- إذا رمى المعالج، يفشل الغلاف بأمان ويحجب التنفيذ
- يصبح `reason` المُعاد نص الخطأ المرمي

### 2) تنفيذ الأداة

تُنفَّذ الأداة الأساسية بشكل طبيعي إذا لم تُحجَب.

### 3) بعد التنفيذ: `tool_result`

بعد النجاح، يُرسل الغلاف `tool_result` مع:

- `toolName`، و`toolCallId`، و`input`
- `content`
- `details`
- `isError: false`

إذا أعاد المعالج تجاوزات:

- يمكن لـ `content` استبدال محتوى النتيجة
- يمكن لـ `details` استبدال تفاصيل النتيجة

عند فشل الأداة، يُرسل الغلاف `tool_result` مع `isError: true` ومحتوى نص الخطأ، ثم يُعيد رمي الخطأ الأصلي.

### ما يمكن للخطافات تغييره

- سياق نموذج اللغة لاستدعاء واحد عبر `context` (سلسلة استبدال `messages`)
- محتوى/تفاصيل إخراج الأداة عند نجاح استدعاءات الأداة (مسار `tool_result`)
- الرسالة المُحقونة قبل الوكيل عبر `before_agent_start`
- الإلغاء/الضغط المخصص/سلوك الشجرة عبر `session_before_*` و`session.compacting`

### ما لا يمكن للخطافات تغييره في هذا التنفيذ

- معاملات إدخال الأداة الخام في الموضع (حجب/سماح فقط في `tool_call`)
- استمرار التنفيذ بعد رمي أخطاء الأداة (يُعيد مسار الخطأ الرمي)
- حالة النجاح/الخطأ النهائية في سلوك الغلاف (يُكتب `isError` المُعاد لكنه لا يُطبَّق بواسطة `HookToolWrapper`)

## الترتيب وسلوك التعارض

### الترتيب على مستوى الاكتشاف

يُرتَّب موفرو القدرات حسب الأولوية (الأعلى أولاً). يعتمد إزالة التكرار على مفتاح القدرة، ويفوز الأول.

بالنسبة لـ `hooks`، مفتاح القدرة هو `${type}:${tool}:${name}`. تُوسَم التكرارات المظللة من الموفرين ذوي الأولوية الأقل وتُستبعد من القائمة الفعلية المكتشفة.

### ترتيب التحميل

تبني `discoverAndLoadHooks` قائمة `allPaths` مسطحة، مُقيَّدة التكرار بالمسار المطلق المحلول، ثم تُكرر `loadHooks` بهذا الترتيب.
يعتمد ترتيب الملفات داخل كل دليل مكتشف على إخراج `readdir`؛ لا يُجري مُحمِّل الخطافات ترتيباً إضافياً.

### ترتيب المعالجات في وقت التشغيل

داخل `HookRunner`، يكون الترتيب محدداً بتسلسل التسجيل:

1. ترتيب مصفوفة الخطافات
2. ترتيب تسجيل المعالج لكل خطاف/حدث

سلوك التعارض حسب نوع الحدث:

- `tool_call`: يفوز آخر نتيجة مُعادة ما لم يحجب معالج؛ أول حجب يُقصر الدائرة
- `tool_result`: يفوز آخر تجاوز مُعاد (بدون تقصير دائرة)
- `context`: متسلسل؛ يتلقى كل معالج إخراج رسائل المعالج السابق
- `before_agent_start`: تُحتفظ بأول رسالة مُعادة؛ تُتجاهل الرسائل اللاحقة
- `session_before_*`: تُتتبع آخر نتيجة مُعادة؛ `cancel: true` يُقصر الدائرة فوراً
- `session.compacting`: يفوز آخر نتيجة مُعادة

تعارضات الأوامر/العارضات:

- يُعيد `getCommand(name)` أول تطابق عبر الخطافات (يفوز المُحمَّل أولاً)
- يُعيد `getMessageRenderer(customType)` أول تطابق
- يُعيد `getRegisteredCommands()` جميع الأوامر (بدون إزالة تكرار)

## تفاعلات واجهة المستخدم (`HookContext.ui`)

يتضمن `HookUIContext`:

- `select`، و`confirm`، و`input`، و`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`، و`getEditorText`
- مُحضِر `theme`

يشير `ctx.hasUI` إلى ما إذا كانت واجهة المستخدم التفاعلية متاحة.

عند التشغيل بدون واجهة مستخدم، يكون السلوك الافتراضي للسياق بدون عملية:

- تُعيد `select/input/editor` قيمة `undefined`
- تُعيد `confirm` قيمة `false`
- `notify` و`setStatus` و`setEditorText` لا تؤدي أي عملية
- تُعيد `getEditorText` قيمة `""`

### سلوك سطر الحالة

نص حالة الخطاف المُعيَّن عبر `ctx.ui.setStatus(key, text)`:

- يُخزَّن لكل مفتاح
- يُرتَّب حسب اسم المفتاح
- يُعقَّم (`\r`، و`\n`، و`\t` ← مسافات؛ تُضغط المسافات المتكررة)
- يُضم ويُقلَّص العرض للعرض

## انتشار الأخطاء والاحتياطي

### وقت التحميل

- الوحدة غير الصالحة أو الصادر الافتراضي المفقود ← يُلتقط في `LoadHooksResult.errors`
- يستمر التحميل للخطافات الأخرى

### وقت الحدث

يلتقط `HookRunner.emit(...)` أخطاء المعالج لمعظم الأحداث ويُرسل `HookError` إلى المستمعين (`hookPath`، و`event`، و`error`)، ثم يستمر.

`emitToolCall(...)` أكثر صرامة: لا تُبتلع أخطاء المعالج هناك؛ بل تنتشر إلى المُستدعي. في `HookToolWrapper`، يحجب ذلك استدعاء الأداة (إخفاق آمن).

## أمثلة API واقعية

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

### تنقيح إخراج الأداة بعد التنفيذ

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

### تعديل سياق النموذج لكل استدعاء نموذج لغوي

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

تُصدر `src/extensibility/hooks/index.ts`:

- واجهات برمجة التحميل (`discoverAndLoadHooks`، و`loadHooks`)
- المنفذ والغلاف (`HookRunner`، و`HookToolWrapper`)
- جميع أنواع الخطافات
- إعادة تصدير `execCommand`

وتُعيد جذر الحزمة (`src/index.ts`) تصدير **أنواع** الخطافات كسطح توافق قديم.
