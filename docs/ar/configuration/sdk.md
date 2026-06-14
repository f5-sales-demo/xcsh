---
title: SDK
description: SDK لبناء وكلاء مخصصين وتكاملات على قمة بيئة تشغيل وكيل الترميز xcsh.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK هو سطح التكامل داخل العملية لـ `@f5xc-salesdemos/xcsh`.
استخدمه عندما تريد وصولاً مباشراً إلى حالة الوكيل، وتدفق الأحداث، وتوصيل الأدوات، والتحكم في الجلسة من عملية Bun/Node الخاصة بك.

إذا كنت بحاجة إلى عزل متعدد اللغات/العمليات، استخدم وضع RPC بدلاً من ذلك.

## التثبيت

```bash
bun add @f5xc-salesdemos/xcsh
```

## نقاط الدخول

يصدّر `@f5xc-salesdemos/xcsh` واجهات برمجية لـ SDK من جذر الحزمة (وأيضاً عبر `@f5xc-salesdemos/xcsh/sdk`).

الصادرات الأساسية للمُضمِّنين:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- مساعدات الاكتشاف (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- سطح مصنع الأدوات (`createTools`, `BUILTIN_TOOLS`, فئات الأدوات)

## البدء السريع (الإعدادات الافتراضية للاكتشاف التلقائي)

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

## ما الذي تكتشفه `createAgentSession()` افتراضياً

تتبع `createAgentSession()` مبدأ "قدِّم لتتجاوز، وأغفل للاكتشاف".

عند الإغفال، تُحلّ القيم التالية:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (عبر `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (مدعوم بالملفات)
- المهارات/ملفات السياق/قوالب الطلبات/أوامر الشرطة المائلة/الامتدادات/أوامر TS المخصصة
- الأدوات المدمجة عبر `createTools(...)`
- أدوات MCP (مُفعَّلة افتراضياً)
- تكامل LSP (مُفعَّل افتراضياً)

### المدخلات المطلوبة مقابل الاختيارية

عادةً ما تحتاج إلى توفير ما تريد التحكم فيه فقط:

- **يجب توفير**: لا شيء لجلسة بسيطة
- **يُوفَّر عادةً بشكل صريح** في المُضمِّنين:
    - `sessionManager` (إذا كنت بحاجة إلى ذاكرة أو موقع مخصص)
    - `authStorage` + `modelRegistry` (إذا كنت تمتلك دورة حياة بيانات الاعتماد/النموذج)
    - `model` أو `modelPattern` (إذا كان اختيار النموذج الحتمي مهماً)
    - `settings` (إذا كنت بحاجة إلى تهيئة معزولة/اختبارية)

## سلوك مدير الجلسة (دائم مقابل في الذاكرة)

يستخدم `AgentSession` دائماً `SessionManager`؛ يعتمد السلوك على المصنع الذي تستخدمه.

### مدعوم بالملفات (الافتراضي)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- يُثبِّت المحادثات/الرسائل/دلتا الحالة في ملفات الجلسة.
- يدعم سير عمل الاستئناف/الفتح/القائمة/التفريع.
- `session.sessionFile` مُعرَّف.

### في الذاكرة

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- لا استمرارية في نظام الملفات.
- مفيد للاختبارات، والعمال المؤقتين، والوكلاء المحدودين بالطلب.
- تعمل أساليب الجلسة بشكل طبيعي، لكن السلوكيات الخاصة بالاستمرارية (مسارات استئناف/تفريع الملفات) محدودة بطبيعتها.

### مساعدات الاستئناف/الفتح/القائمة

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## توصيل النموذج والمصادقة

تستخدم `createAgentSession()` الدمج بين `ModelRegistry` و`AuthStorage` لاختيار النموذج وحل مفتاح API.

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

### ترتيب الاختيار عند إغفال `model`

عند عدم توفير `model`/`modelPattern` صريح:

1. استعادة النموذج من الجلسة الموجودة (إذا كانت قابلة للاستعادة + المفتاح متاح)
2. دور النموذج الافتراضي في الإعدادات (`default`)
3. أول نموذج متاح مع مصادقة صالحة

إذا فشلت الاستعادة، يشرح `modelFallbackMessage` الرجوع إلى البديل.

### أولوية المصادقة

تُحلّ `AuthStorage.getApiKey(...)` بهذا الترتيب:

1. التجاوز في وقت التشغيل (`setRuntimeApiKey`)
2. بيانات الاعتماد المخزنة في `agent.db`
3. متغيرات بيئة الموفر
4. رجوع محلل الموفر المخصص (إذا تم تهيئته)

## نموذج الاشتراك في الأحداث

اشترك باستخدام `session.subscribe(listener)`؛ تُعيد دالة إلغاء الاشتراك.

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

يتضمن `AgentSessionEvent` الأحداث الأساسية لـ `AgentEvent` إضافةً إلى أحداث مستوى الجلسة:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## دورة حياة الطلب

`session.prompt(text, options?)` هي نقطة الدخول الأساسية.

السلوك:

1. توسيع الأوامر/القوالب الاختياري (أوامر `/`، والأوامر المخصصة، وأوامر ملفات الشرطة المائلة، وقوالب الطلبات)
2. إذا كان يتدفق حالياً:
    - يتطلب `streamingBehavior: "steer" | "followUp"`
    - يُضاف في قائمة الانتظار بدلاً من التخلي عن العمل
3. إذا كان خاملاً:
    - يتحقق من النموذج + مفتاح API
    - يُلحق رسالة المستخدم
    - يبدأ دورة الوكيل

واجهات برمجية ذات صلة:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## الأدوات وتكامل الامتدادات

### الأدوات المدمجة والتصفية

- تأتي الأدوات المدمجة من `createTools(...)` و`BUILTIN_TOOLS`.
- يعمل `toolNames` كقائمة مسموح بها للأدوات المدمجة.
- لا تزال الأدوات المخصصة (`customTools`) والأدوات المسجلة عبر الامتدادات مُدرَجة.
- الأدوات المخفية (مثل `submit_result`) تتطلب الاشتراك الصريح ما لم تتطلبها الخيارات.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### الامتدادات

- `extensions`: مصفوفة `ExtensionFactory[]` مضمّنة
- `additionalExtensionPaths`: تحميل ملفات امتداد إضافية
- `disableExtensionDiscovery`: تعطيل فحص الامتدادات التلقائي
- `preloadedExtensions`: إعادة استخدام مجموعة امتدادات محملة مسبقاً

### تغييرات مجموعة الأدوات في وقت التشغيل

يدعم `AgentSession` تحديثات التفعيل في وقت التشغيل:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

يُعاد بناء موجّه النظام لعكس تغييرات الأدوات النشطة.

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

لمستهلكي SDK الذين يبنون منسِّقين (مشابهين لتدفق منفذ المهام):

- `outputSchema`: يُمرِّر توقع المخرجات المهيكلة إلى سياق الأداة
- `requireSubmitResultTool`: يفرض تضمين أداة `submit_result`
- `taskDepth`: سياق عمق التكرار لجلسات المهام المتداخلة
- `parentTaskPrefix`: بادئة تسمية القطع الأثرية لمخرجات المهام المتداخلة

هذه اختيارية للتضمين الطبيعي لوكيل واحد.

## قيمة إرجاع `createAgentSession()`

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

استخدم `setToolUIContext(...)` فقط إذا كان مُضمِّنك يوفر إمكانيات واجهة مستخدم ينبغي للأدوات/الامتدادات الاستدعاء إليها.

## مثال تضمين متحكم به بشكل بسيط

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
