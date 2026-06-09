---
title: حزمة تطوير البرمجيات (SDK)
description: >-
  SDK for building custom agents and integrations on top of the xcsh coding
  agent runtime.
sidebar:
  order: 6
  label: حزمة تطوير البرمجيات (SDK)
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# حزمة تطوير البرمجيات (SDK)

حزمة تطوير البرمجيات (SDK) هي واجهة التكامل داخل العملية لـ `@f5xc-salesdemos/xcsh`.
استخدمها عندما تريد الوصول المباشر إلى حالة الوكيل، وتدفق الأحداث، وتوصيل الأدوات، والتحكم في الجلسة من عملية Bun/Node الخاصة بك.

إذا كنت بحاجة إلى عزل عبر اللغات/العمليات، استخدم وضع RPC بدلاً من ذلك.

## التثبيت

```bash
bun add @f5xc-salesdemos/xcsh
```

## نقاط الدخول

يُصدّر `@f5xc-salesdemos/xcsh` واجهات SDK من جذر الحزمة (وأيضاً عبر `@f5xc-salesdemos/xcsh/sdk`).

الصادرات الأساسية للمُضمِّنين:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- مساعدات الاكتشاف (`discoverExtensions`، `discoverSkills`، `discoverContextFiles`، `discoverPromptTemplates`، `discoverSlashCommands`، `discoverCustomTSCommands`، `discoverMCPServers`)
- واجهة مصنع الأدوات (`createTools`، `BUILTIN_TOOLS`، فئات الأدوات)

## بداية سريعة (إعدادات الاكتشاف التلقائي الافتراضية)

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## ما يكتشفه `createAgentSession()` افتراضياً

يتبع `createAgentSession()` مبدأ "وفّر للتجاوز، احذف للاكتشاف".

إذا تم حذفها، يقوم بحل:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (عبر `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (مدعوم بالملفات)
- المهارات/ملفات السياق/قوالب الأوامر/أوامر الشرطة المائلة/الإضافات/أوامر TS المخصصة
- الأدوات المدمجة عبر `createTools(...)`
- أدوات MCP (مفعّلة افتراضياً)
- تكامل LSP (مفعّل افتراضياً)

### المدخلات المطلوبة مقابل الاختيارية

عادةً يجب عليك توفير ما تريد التحكم فيه فقط:

- **يجب توفيره**: لا شيء لجلسة بسيطة
- **يُوفَّر صراحةً عادةً** في المُضمِّنين:
    - `sessionManager` (إذا كنت بحاجة إلى تخزين في الذاكرة أو موقع مخصص)
    - `authStorage` + `modelRegistry` (إذا كنت تدير دورة حياة بيانات الاعتماد/النموذج)
    - `model` أو `modelPattern` (إذا كان اختيار النموذج الحتمي مهماً)
    - `settings` (إذا كنت بحاجة إلى تكوين معزول/اختباري)

## سلوك مدير الجلسات (مستمر مقابل في الذاكرة)

يستخدم `AgentSession` دائماً `SessionManager`؛ يعتمد السلوك على المصنع الذي تستخدمه.

### مدعوم بالملفات (افتراضي)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- يحفظ المحادثة/الرسائل/تغييرات الحالة في ملفات الجلسة.
- يدعم سير عمل الاستئناف/الفتح/القائمة/التفرع.
- `session.sessionFile` يكون معرّفاً.

### في الذاكرة

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- لا يوجد حفظ على نظام الملفات.
- مفيد للاختبارات، والعمّال المؤقتين، والوكلاء محددي نطاق الطلب.
- طرق الجلسة تعمل بشكل طبيعي، لكن السلوكيات المتعلقة بالحفظ (مسارات استئناف/تفرع الملفات) تكون محدودة بطبيعة الحال.

### مساعدات الاستئناف/الفتح/القائمة

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## توصيل النموذج والمصادقة

يستخدم `createAgentSession()` كلاً من `ModelRegistry` و `AuthStorage` لاختيار النموذج وحل مفتاح API.

### التوصيل الصريح

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### ترتيب الاختيار عند حذف `model`

عندما لا يتم توفير `model`/`modelPattern` صراحةً:

1. استعادة النموذج من جلسة موجودة (إذا كان قابلاً للاستعادة + المفتاح متاح)
2. دور النموذج الافتراضي في الإعدادات (`default`)
3. أول نموذج متاح بمصادقة صالحة

إذا فشلت الاستعادة، يشرح `modelFallbackMessage` الرجوع البديل.

### أولوية المصادقة

يحل `AuthStorage.getApiKey(...)` بهذا الترتيب:

1. التجاوز في وقت التشغيل (`setRuntimeApiKey`)
2. بيانات الاعتماد المخزنة في `agent.db`
3. متغيرات بيئة المزود
4. حل المزود المخصص كبديل أخير (إذا تم تكوينه)

## نموذج الاشتراك في الأحداث

اشترك باستخدام `session.subscribe(listener)`؛ يُرجع دالة إلغاء الاشتراك.

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

يتضمن `AgentSessionEvent` أحداث `AgentEvent` الأساسية بالإضافة إلى أحداث مستوى الجلسة:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## دورة حياة الأمر

`session.prompt(text, options?)` هي نقطة الدخول الأساسية.

السلوك:

1. توسيع اختياري للأوامر/القوالب (أوامر `/`، الأوامر المخصصة، أوامر شرطة الملفات المائلة، قوالب الأوامر)
2. إذا كان يبث حالياً:
    - يتطلب `streamingBehavior: "steer" | "followUp"`
    - يُضاف إلى قائمة الانتظار بدلاً من التخلص من العمل
3. إذا كان خاملاً:
    - يتحقق من صحة النموذج + مفتاح API
    - يُلحق رسالة المستخدم
    - يبدأ دور الوكيل

واجهات برمجة التطبيقات ذات الصلة:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## الأدوات وتكامل الإضافات

### الأدوات المدمجة والتصفية

- الأدوات المدمجة تأتي من `createTools(...)` و `BUILTIN_TOOLS`.
- `toolNames` يعمل كقائمة سماح للأدوات المدمجة.
- `customTools` والأدوات المسجلة عبر الإضافات تظل مُدرجة.
- الأدوات المخفية (مثل `submit_result`) تكون اختيارية ما لم تكن مطلوبة بواسطة الخيارات.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### الإضافات

- `extensions`: مصفوفة `ExtensionFactory[]` مضمّنة
- `additionalExtensionPaths`: تحميل ملفات إضافات إضافية
- `disableExtensionDiscovery`: تعطيل الفحص التلقائي للإضافات
- `preloadedExtensions`: إعادة استخدام مجموعة إضافات محمّلة مسبقاً

### تغييرات مجموعة الأدوات في وقت التشغيل

يدعم `AgentSession` تحديثات التنشيط في وقت التشغيل:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

يُعاد بناء أمر النظام ليعكس تغييرات الأدوات النشطة.

## مساعدات الاكتشاف

استخدم هذه عندما تريد تحكماً جزئياً دون إعادة إنشاء منطق الاكتشاف الداخلي:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## خيارات موجهة للوكيل الفرعي

لمستهلكي SDK الذين يبنون مُنسّقين (مشابهاً لتدفق منفّذ المهام):

- `outputSchema`: يمرر توقع الإخراج المُهيكل إلى سياق الأداة
- `requireSubmitResultTool`: يفرض تضمين أداة `submit_result`
- `taskDepth`: سياق عمق التكرار لجلسات المهام المتداخلة
- `parentTaskPrefix`: بادئة تسمية المخرجات لمهام متداخلة

هذه اختيارية للتضمين العادي بوكيل واحد.

## القيمة المُرجعة من `createAgentSession()`

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

استخدم `setToolUIContext(...)` فقط إذا كان المُضمِّن الخاص بك يوفر قدرات واجهة مستخدم يجب أن تستدعيها الأدوات/الإضافات.

## مثال تضمين محكوم بسيط

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
