---
title: SDK
description: >-
  مجموعة أدوات تطوير البرامج (SDK) لبناء وكلاء مخصصين وتكاملات على رأس وقت تشغيل
  وكيل الترميز xcsh.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 80f3a4374241
  translator: machine
---

# SDK

SDK هو سطح التكامل داخل العملية الواحدة لـ `@f5-sales-demo/xcsh`.
استخدمه عندما تريد وصولاً مباشراً إلى حالة الوكيل، وبث الأحداث، وتوصيل الأدوات، والتحكم في الجلسة من عملية Bun/Node الخاصة بك.

إذا كنت بحاجة إلى عزل متعدد اللغات/العمليات، فاستخدم وضع RPC بدلاً من ذلك.

## التثبيت

```bash
bun add @f5-sales-demo/xcsh
```

## نقاط الدخول

يُصدِّر `@f5-sales-demo/xcsh` واجهات برمجة SDK من جذر الحزمة (وأيضاً عبر `@f5-sales-demo/xcsh/sdk`).

الصادرات الأساسية للمضمِّنين:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- مساعدات الاكتشاف (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- سطح مصنع الأدوات (`createTools`, `BUILTIN_TOOLS`, فئات الأدوات)

## البداية السريعة (افتراضيات الاكتشاف التلقائي)

```ts
import { createAgentSession } from "@f5-sales-demo/xcsh";

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

## ما الذي تكتشفه `createAgentSession()` بشكل افتراضي

تتبع `createAgentSession()` مبدأ "قدِّم للتجاوز، أو أهمل للاكتشاف".

إذا أُهمل، فإنها تحلّ:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (عبر `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (مدعوم بالملفات)
- المهارات/ملفات السياق/قوالب الطلبات/أوامر الشرطة المائلة/الإضافات/الأوامر المخصصة بـ TS
- الأدوات المدمجة عبر `createTools(...)`
- أدوات MCP (مفعّلة بشكل افتراضي)
- تكامل LSP (مفعّل بشكل افتراضي)

### المدخلات الإلزامية مقابل الاختيارية

عادةً ما تحتاج إلى توفير ما تريد التحكم فيه فقط:

- **يجب توفيره**: لا شيء لجلسة بحد أدنى
- **يُوفَّر عادةً بشكل صريح** في المضمِّنين:
    - `sessionManager` (إذا كنت بحاجة إلى ذاكرة مؤقتة أو موقع مخصص)
    - `authStorage` + `modelRegistry` (إذا كنت تتحكم في دورة حياة بيانات الاعتماد/النماذج)
    - `model` أو `modelPattern` (إذا كان اختيار النموذج الحتمي مهماً)
    - `settings` (إذا كنت بحاجة إلى إعداد معزول/اختباري)

## سلوك مدير الجلسة (مستمر مقابل في الذاكرة)

تستخدم `AgentSession` دائماً `SessionManager`؛ ويعتمد السلوك على المصنع الذي تستخدمه.

### مدعوم بالملفات (الافتراضي)

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- يحفظ المحادثة/الرسائل/دلتا الحالة في ملفات الجلسة.
- يدعم سير عمل الاستئناف/الفتح/الإدراج/التفريع.
- `session.sessionFile` محدَّد.

### في الذاكرة

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- لا استمرارية على نظام الملفات.
- مفيد للاختبارات، والعمال المؤقتين، والوكلاء ذوي النطاق المحدود بالطلب.
- تعمل أساليب الجلسة بشكل طبيعي، لكن السلوكيات الخاصة بالاستمرارية (مسارات استئناف/تفريع الملفات) تكون محدودة طبيعياً.

### مساعدات الاستئناف/الفتح/الإدراج

```ts
import { SessionManager } from "@f5-sales-demo/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## توصيل النماذج والمصادقة

تستخدم `createAgentSession()` كلاً من `ModelRegistry` و`AuthStorage` لاختيار النماذج وحل مفاتيح API.

### التوصيل الصريح

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5-sales-demo/xcsh";

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

### ترتيب الاختيار عند إهمال `model`

عندما لا يُقدَّم `model`/`modelPattern` صريح:

1. استعادة النموذج من الجلسة الموجودة (إذا كانت قابلة للاستعادة والمفتاح متاح)
2. دور النموذج الافتراضي في الإعدادات (`default`)
3. أول نموذج متاح بمصادقة صالحة

إذا فشلت الاستعادة، يشرح `modelFallbackMessage` الخيار البديل.

### أولوية المصادقة

يحلّ `AuthStorage.getApiKey(...)` بهذا الترتيب:

1. التجاوز في وقت التشغيل (`setRuntimeApiKey`)
2. بيانات الاعتماد المخزنة في `agent.db`
3. متغيرات بيئة الموفر
4. حلّ المزود المخصص الاحتياطي (إذا كان مهيَّأً)

## نموذج الاشتراك في الأحداث

اشترك باستخدام `session.subscribe(listener)`؛ فتُعيد دالة إلغاء الاشتراك.

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

يتضمن `AgentSessionEvent` الأحداث الأساسية `AgentEvent` بالإضافة إلى أحداث مستوى الجلسة:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## دورة حياة الطلب

`session.prompt(text, options?)` هي نقطة الدخول الأساسية.

السلوك:

1. توسيع اختياري للأوامر/القوالب (أوامر `/`، والأوامر المخصصة، وأوامر الشرطة المائلة في الملفات، وقوالب الطلبات)
2. إذا كان يبث حالياً:
    - يتطلب `streamingBehavior: "steer" | "followUp"`
    - يضع في قائمة انتظار بدلاً من التخلي عن العمل
3. إذا كان خاملاً:
    - يتحقق من النموذج ومفتاح API
    - يُلحق رسالة المستخدم
    - يبدأ دور الوكيل

واجهات برمجة التطبيقات ذات الصلة:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## الأدوات وتكامل الإضافات

### المدمجات والتصفية

- تأتي المدمجات من `createTools(...)` و`BUILTIN_TOOLS`.
- يعمل `toolNames` كقائمة سماح للمدمجات.
- لا تزال الأدوات المخصصة (`customTools`) والأدوات المسجَّلة عبر الإضافات مُدرجة.
- الأدوات المخفية (مثل `submit_result`) تستوجب الاشتراك الصريح ما لم تطلبها الخيارات.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### الإضافات

- `extensions`: مصفوفة `ExtensionFactory[]` مضمَّنة
- `additionalExtensionPaths`: تحميل ملفات إضافات إضافية
- `disableExtensionDiscovery`: تعطيل فحص الإضافات التلقائي
- `preloadedExtensions`: إعادة استخدام مجموعة الإضافات المحمَّلة مسبقاً

### تغييرات مجموعة الأدوات في وقت التشغيل

تدعم `AgentSession` تحديثات التفعيل في وقت التشغيل:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

يُعاد بناء موجّه النظام ليعكس تغييرات الأدوات النشطة.

## مساعدات الاكتشاف

استخدم هذه المساعدات عندما تريد تحكماً جزئياً دون إعادة إنشاء منطق الاكتشاف الداخلي:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## خيارات موجَّهة للوكلاء الفرعيين

لمستهلكي SDK الذين يبنون منظِّمين (مشابهاً لتدفق منفِّذ المهام):

- `outputSchema`: يمرر توقع المخرجات المنظَّمة إلى سياق الأداة
- `requireSubmitResultTool`: يفرض تضمين أداة `submit_result`
- `taskDepth`: سياق عمق التكرار لجلسات المهام المتداخلة
- `parentTaskPrefix`: بادئة تسمية الأدوات لمخرجات المهام المتداخلة

هذه خيارات اختيارية لتضمين الوكيل الفردي الاعتيادي.

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

استخدم `setToolUIContext(...)` فقط إذا كان مضمِّنك يوفر إمكانيات واجهة مستخدم ينبغي للأدوات/الإضافات الاستدعاء إليها.

## مثال تضمين محكوم بحد أدنى

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5-sales-demo/xcsh";

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
