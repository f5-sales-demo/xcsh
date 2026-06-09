---
title: تأليف خوادم وأدوات MCP
description: دليل لبناء خوادم MCP مخصصة وتسجيل الأدوات لوكيل البرمجة.
sidebar:
  order: 4
  label: تأليف الخوادم والأدوات
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# تأليف خوادم وأدوات MCP

يشرح هذا المستند كيف تتحول تعريفات خوادم MCP إلى أدوات `mcp_*` قابلة للاستدعاء في وكيل البرمجة (coding-agent)، وما الذي يجب أن يتوقعه المشغّلون عندما تكون الإعدادات غير صالحة أو مكررة أو معطّلة أو محمية بالمصادقة.

## نظرة عامة على البنية

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) نموذج إعدادات الخادم والتحقق منها

يعرّف `src/mcp/types.ts` الشكل التأليفي المستخدم من قِبل كتّاب إعدادات MCP ووقت التشغيل:

- `stdio` (الافتراضي عند غياب `type`): يتطلب `command`، مع `args` و`env` و`cwd` اختياريًا
- `http`: يتطلب `url`، مع `headers` اختياريًا
- `sse`: يتطلب `url`، مع `headers` اختياريًا (محتفظ به للتوافق)
- الحقول المشتركة: `enabled`، `timeout`، `auth`

تفرض `validateServerConfig()` (`src/mcp/config.ts`) أساسيات النقل:

- ترفض الإعدادات التي تحدد كلاً من `command` و`url`
- تتطلب `command` لنوع stdio
- تتطلب `url` لنوع http/sse
- ترفض أنواع `type` غير المعروفة

يطبّق `config-writer.ts` هذا التحقق لعمليات الإضافة/التحديث ويتحقق أيضًا من أسماء الخوادم:

- غير فارغة
- بحد أقصى 100 حرف
- تحتوي فقط على `[a-zA-Z0-9_.-]`

### مزالق النقل

- حذف `type` يعني stdio. إذا كنت تنوي HTTP/SSE لكن حذفت `type`، يصبح `command` إلزاميًا.
- `sse` لا يزال مقبولاً لكنه يُعامل داخليًا كنقل HTTP (`createHttpTransport`).
- التحقق هيكلي وليس اختبار قابلية الوصول: عنوان URL صحيح نحويًا قد يفشل عند الاتصال.

## 2) الاكتشاف والتطبيع والأسبقية

### الاكتشاف القائم على القدرات

تحمّل `loadAllMCPConfigs()` (`src/mcp/config.ts`) عناصر `MCPServer` القانونية عبر `loadCapability(mcpCapability.id)`.

ثم تقوم طبقة القدرات (`src/capability/index.ts`) بما يلي:

1. تحميل الموفرين بترتيب الأولوية
2. إزالة التكرار حسب `server.name` (الفوز الأول = الأولوية الأعلى)
3. التحقق من العناصر بعد إزالة التكرار

النتيجة: أسماء الخوادم المكررة عبر المصادر لا تُدمج. تعريف واحد يفوز؛ والتكرارات ذات الأولوية الأدنى تُحجب.

### `.mcp.json` والملفات ذات الصلة

يقرأ الموفر الاحتياطي المخصص في `src/discovery/mcp-json.ts` ملفي `mcp.json` و`.mcp.json` من جذر المشروع (أولوية منخفضة).

في الممارسة العملية، تأتي خوادم MCP أيضًا من موفرين ذوي أولوية أعلى (مثل `.xcsh/...` الأصلي ومجلدات إعدادات خاصة بالأدوات). إرشادات التأليف:

- فضّل `.xcsh/mcp.json` (للمشروع) أو `~/.xcsh/mcp.json` (للمستخدم) للتحكم الصريح.
- استخدم `mcp.json` / `.mcp.json` في الجذر عندما تحتاج التوافق الاحتياطي.
- إعادة استخدام نفس اسم الخادم في مصادر متعددة يسبب حجب الأسبقية وليس الدمج.

### سلوك التطبيع

تقوم `convertToLegacyConfig()` (`src/mcp/config.ts`) بربط `MCPServer` القانوني مع `MCPServerConfig` وقت التشغيل.

السلوك الأساسي:

- يُستنتج النقل كالتالي `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- تُحذف الخوادم المعطّلة (`enabled === false`) قبل الاتصال
- تُحفظ الحقول الاختيارية عند وجودها

### توسيع متغيرات البيئة أثناء الاكتشاف

يوسّع `mcp-json.ts` العناصر النائبة لمتغيرات البيئة في حقول النصوص باستخدام `expandEnvVarsDeep()`:

- يدعم `${VAR}` و`${VAR:-default}`
- القيم غير المحلولة تبقى كنصوص حرفية `${VAR}`

يقوم `mcp-json.ts` أيضًا بفحوصات نوع وقت التشغيل لملف JSON الخاص بالمستخدم ويسجّل تحذيرات للقيم غير الصالحة لـ `enabled`/`timeout` بدلاً من إفشال الملف بالكامل.

## 3) المصادقة وحل القيم في وقت التشغيل

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) هي المرحلة النهائية قبل الاتصال.

### حقن بيانات اعتماد OAuth

إذا كانت الإعدادات تحتوي على:

```ts
auth: { type: "oauth", credentialId: "..." }
```

وبيانات الاعتماد موجودة في مخزن المصادقة:

- `http`/`sse`: تحقن ترويسة `Authorization: Bearer <access_token>`
- `stdio`: تحقن متغير بيئة `OAUTH_ACCESS_TOKEN`

إذا فشل البحث عن بيانات الاعتماد، يسجّل المدير تحذيرًا ويستمر مع مصادقة غير محلولة.

### حل قيم الترويسات/متغيرات البيئة

قبل الاتصال، يحل المدير كل قيمة ترويسة/متغير بيئة عبر `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- القيمة التي تبدأ بـ `!` => تنفيذ أمر shell، واستخدام المخرجات المقتطعة (مع تخزين مؤقت)
- وإلا، تُعامل القيمة كاسم متغير بيئة أولاً (`process.env[name]`)، مع العودة للقيمة الحرفية
- القيم غير المحلولة للأوامر/متغيرات البيئة تُحذف من خريطة الترويسات/متغيرات البيئة النهائية

تحذير تشغيلي: هذا يعني أن مفتاح أمر/متغير بيئة سري مكتوب بشكل خاطئ يمكن أن يزيل بصمت إدخال تلك الترويسة/متغير البيئة، مما ينتج أخطاء 401/403 أو فشل في بدء تشغيل الخادم في المراحل اللاحقة.

## 4) جسر الأدوات: MCP -> أدوات قابلة للاستدعاء من الوكيل

يحوّل `src/mcp/tool-bridge.ts` تعريفات أدوات MCP إلى `CustomTool`s.

### التسمية ونطاق التعارض

تُولّد أسماء الأدوات كالتالي:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

القواعد:

- تحويل إلى أحرف صغيرة
- الأحرف غير `[a-z_]` تصبح `_`
- الشرطات السفلية المتكررة تُدمج
- بادئة `<server>_` الزائدة في اسم الأداة تُزال مرة واحدة

هذا يتجنب العديد من التعارضات، لكن ليس جميعها. يمكن أن تتحول أسماء خام مختلفة إلى نفس المعرّف بعد التطهير (مثلاً `my-server` و`my.server` يتحولان بشكل متشابه)، وإدراج السجل يعمل بمبدأ الكتابة الأخيرة تفوز.

### ربط المخطط

تحتفظ `convertSchema()` بمخطط MCP JSON Schema كما هو في الغالب لكنها تصحح مخططات الكائنات التي تفتقر إلى `properties` بـ `{}` لتوافق الموفر.

### ربط التنفيذ

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- تستدعي `tools/call` من MCP
- تسطّح محتوى MCP إلى نص قابل للعرض
- تعيد تفاصيل مهيكلة (`serverName`، `mcpToolName`، بيانات وصفية للموفر)
- تحوّل `isError` المُبلّغ عنه من الخادم إلى نتيجة نصية `Error: ...`
- تحوّل أخطاء النقل/وقت التشغيل المرمية إلى `MCP error: ...`
- تحافظ على دلالات الإلغاء بتحويل AbortError إلى `ToolAbortError`

## 5) دورة حياة المشغّل: الإضافة/التعديل/الإزالة والتحديثات الحية

يكشف الوضع التفاعلي `/mcp` في `src/modes/controllers/mcp-command-controller.ts`.

العمليات المدعومة:

- `add` (معالج أو إضافة سريعة)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

عمليات كتابة الإعدادات ذرّية (`writeMCPConfigFile`: ملف مؤقت + إعادة تسمية).

بعد التغييرات، يستدعي المتحكم `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

تستبدل `refreshMCPTools()` جميع إدخالات السجل `mcp_` وتعيد تفعيل أحدث مجموعة أدوات MCP فورًا، لذا تسري التغييرات دون إعادة تشغيل الجلسة.

### الاختلافات حسب الوضع

- **الوضع التفاعلي/TUI**: `/mcp` يوفر تجربة مستخدم داخل التطبيق (معالج، تدفق OAuth، نص حالة الاتصال، إعادة ربط فوري في وقت التشغيل).
- **تكامل SDK/بدون واجهة**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) تعيد الأدوات المحمّلة + أخطاء لكل خادم؛ بدون تجربة مستخدم لأمر `/mcp`.

## 6) أسطح الأخطاء المرئية للمستخدم

رسائل الخطأ الشائعة التي يراها المستخدمون/المشغّلون:

- فشل التحقق عند الإضافة/التحديث:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- مشاكل معاملات الإضافة السريعة:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- فشل الاتصال/الاختبار:
  - `Failed to connect to "<name>": <message>`
  - نص مساعدة عن المهلة يقترح زيادة المهلة
  - نص مساعدة المصادقة لأخطاء `401/403`
- تدفقات المصادقة/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- استخدام خادم معطّل:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

يُعالج JSON المصدر غير الصالح في الاكتشاف عمومًا كتحذيرات/سجلات؛ مسارات config-writer ترمي أخطاء صريحة.

## 7) إرشادات عملية للتأليف

لتأليف MCP قوي في قاعدة الكود هذه:

1. حافظ على أسماء الخوادم فريدة عالميًا عبر جميع مصادر إعدادات MCP.
2. فضّل الأسماء الأبجدية الرقمية/الشرطة السفلية لتجنب تعارض الأسماء المطهّرة في أسماء أدوات `mcp_*` المولّدة.
3. استخدم `type` صريحًا لتجنب الإعدادات الافتراضية العرضية لـ stdio.
4. عامل `enabled: false` كإيقاف تام: الخادم يُحذف من مجموعة الاتصال في وقت التشغيل.
5. لإعدادات OAuth، خزّن `credentialId` صالحًا؛ وإلا يُتخطى حقن المصادقة.
6. إذا كنت تستخدم حل الأسرار القائم على الأوامر (`!cmd`)، تحقق من أن مخرجات الأمر مستقرة وغير فارغة.

## ملفات التنفيذ

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
