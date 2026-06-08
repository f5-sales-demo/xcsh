---
title: تأليف خادم وأدوات MCP
description: دليل لبناء خوادم MCP مخصصة وتسجيل الأدوات لوكيل البرمجة.
sidebar:
  order: 4
  label: تأليف الخادم والأدوات
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# تأليف خادم وأدوات MCP

يشرح هذا المستند كيف تتحول تعريفات خادم MCP إلى أدوات `mcp_*` قابلة للاستدعاء في coding-agent، وما يجب أن يتوقعه المشغلون عندما تكون التكوينات غير صالحة أو مكررة أو معطلة أو محمية بالمصادقة.

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

## 1) نموذج تكوين الخادم والتحقق من الصحة

يُعرّف `src/mcp/types.ts` الشكل المستخدم من قبل كتّاب تكوين MCP ووقت التشغيل:

- `stdio` (الافتراضي عند غياب `type`): يتطلب `command`، اختياري `args`، `env`، `cwd`
- `http`: يتطلب `url`، اختياري `headers`
- `sse`: يتطلب `url`، اختياري `headers` (يُحتفظ به للتوافقية)
- الحقول المشتركة: `enabled`، `timeout`، `auth`

تفرض `validateServerConfig()` (`src/mcp/config.ts`) أساسيات النقل:

- ترفض التكوينات التي تحدد كلاً من `command` و `url`
- تتطلب `command` لـ stdio
- تتطلب `url` لـ http/sse
- ترفض `type` غير المعروف

يطبق `config-writer.ts` هذا التحقق لعمليات الإضافة/التحديث ويتحقق أيضاً من أسماء الخوادم:

- غير فارغ
- حد أقصى 100 حرف
- فقط `[a-zA-Z0-9_.-]`

### مخاطر النقل

- حذف `type` يعني stdio. إذا كنت تقصد HTTP/SSE لكن حذفت `type`، يصبح `command` إلزامياً.
- لا يزال `sse` مقبولاً لكنه يُعامل كنقل HTTP داخلياً (`createHttpTransport`).
- التحقق هيكلي وليس للوصولية: عنوان URL صالح نحوياً يمكن أن يفشل عند الاتصال.

## 2) الاكتشاف والتطبيع والأسبقية

### الاكتشاف القائم على القدرات

تحمّل `loadAllMCPConfigs()` (`src/mcp/config.ts`) عناصر `MCPServer` الأساسية عبر `loadCapability(mcpCapability.id)`.

ثم تقوم طبقة القدرات (`src/capability/index.ts`) بـ:

1. تحميل الموفرين حسب ترتيب الأولوية
2. إزالة التكرارات حسب `server.name` (الفوز الأول = الأولوية الأعلى)
3. التحقق من العناصر بعد إزالة التكرار

النتيجة: أسماء الخوادم المكررة عبر المصادر لا يتم دمجها. تعريف واحد يفوز؛ والتكرارات ذات الأولوية الأدنى تُظلَّل.

### `.mcp.json` والملفات ذات الصلة

يقرأ الموفر الاحتياطي المخصص في `src/discovery/mcp-json.ts` ملفات `mcp.json` و `.mcp.json` في جذر المشروع (أولوية منخفضة).

عملياً تأتي خوادم MCP أيضاً من موفرين ذوي أولوية أعلى (على سبيل المثال `.xcsh/...` الأصلية ومجلدات التكوين الخاصة بالأدوات). إرشادات التأليف:

- فضّل `.xcsh/mcp.json` (المشروع) أو `~/.xcsh/mcp.json` (المستخدم) للتحكم الصريح.
- استخدم `mcp.json` / `.mcp.json` في الجذر عندما تحتاج توافقية احتياطية.
- إعادة استخدام نفس اسم الخادم في مصادر متعددة يسبب تظليل الأسبقية وليس الدمج.

### سلوك التطبيع

يربط `convertToLegacyConfig()` (`src/mcp/config.ts`) خادم `MCPServer` الأساسي إلى `MCPServerConfig` لوقت التشغيل.

السلوك الرئيسي:

- يُستنتج النقل كـ `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- الخوادم المعطلة (`enabled === false`) تُسقط قبل الاتصال
- الحقول الاختيارية تُحفظ عند وجودها

### توسيع متغيرات البيئة أثناء الاكتشاف

يوسّع `mcp-json.ts` العناصر النائبة للمتغيرات البيئية في حقول النصوص باستخدام `expandEnvVarsDeep()`:

- يدعم `${VAR}` و `${VAR:-default}`
- القيم غير المحلولة تبقى كنصوص حرفية `${VAR}`

يقوم `mcp-json.ts` أيضاً بفحوصات نوع وقت التشغيل لـ JSON المستخدم ويسجل تحذيرات لقيم `enabled`/`timeout` غير الصالحة بدلاً من فشل الملف بأكمله.

## 3) المصادقة وحل قيم وقت التشغيل

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) هي المرحلة النهائية قبل الاتصال.

### حقن بيانات اعتماد OAuth

إذا كان التكوين يحتوي على:

```ts
auth: { type: "oauth", credentialId: "..." }
```

وبيانات الاعتماد موجودة في مخزن المصادقة:

- `http`/`sse`: يحقن ترويسة `Authorization: Bearer <access_token>`
- `stdio`: يحقن متغير البيئة `OAUTH_ACCESS_TOKEN`

إذا فشل البحث عن بيانات الاعتماد، يسجل المدير تحذيراً ويتابع مع مصادقة غير محلولة.

### حل قيم الترويسات/متغيرات البيئة

قبل الاتصال، يحل المدير كل قيمة ترويسة/متغير بيئة عبر `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- القيمة التي تبدأ بـ `!` => تنفيذ أمر shell، استخدام stdout المقصوص (مخزن مؤقتاً)
- خلاف ذلك، تُعامل القيمة كاسم متغير بيئة أولاً (`process.env[name]`)، مع الرجوع للقيمة الحرفية
- قيم الأوامر/المتغيرات غير المحلولة تُحذف من خريطة الترويسات/المتغيرات النهائية

تحذير تشغيلي: هذا يعني أن اسم أمر/مفتاح سري خاطئ يمكن أن يزيل بصمت إدخال تلك الترويسة/المتغير، مما ينتج عنه أخطاء 401/403 أو فشل في بدء الخادم في المراحل اللاحقة.

## 4) جسر الأدوات: من MCP إلى أدوات قابلة للاستدعاء بواسطة الوكيل

يحوّل `src/mcp/tool-bridge.ts` تعريفات أدوات MCP إلى `CustomTool`s.

### التسمية ونطاق التعارض

تُنشأ أسماء الأدوات كالتالي:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

القواعد:

- تحويل للأحرف الصغيرة
- الأحرف غير `[a-z_]` تصبح `_`
- الشرطات السفلية المتكررة تُدمج
- بادئة `<server>_` الزائدة في اسم الأداة تُزال مرة واحدة

هذا يتجنب كثيراً من التعارضات، لكن ليس جميعها. يمكن لأسماء خام مختلفة أن تُطهَّر لنفس المعرف (مثلاً `my-server` و `my.server` كلاهما يُطهَّر بشكل مشابه)، وإدراج السجل يعتمد على مبدأ الكتابة الأخيرة تفوز.

### تعيين المخطط

يحتفظ `convertSchema()` بمخطط JSON الخاص بـ MCP كما هو تقريباً لكنه يُصلح مخططات الكائنات التي تفتقد `properties` بـ `{}` لتوافقية الموفر.

### تعيين التنفيذ

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- يستدعي `tools/call` الخاص بـ MCP
- يُسطّح محتوى MCP إلى نص قابل للعرض
- يُرجع تفاصيل منظمة (`serverName`، `mcpToolName`، بيانات الموفر الوصفية)
- يربط `isError` المُبلَّغ عنه من الخادم بنتيجة نصية `Error: ...`
- يربط أخطاء النقل/وقت التشغيل المُلقاة بـ `MCP error: ...`
- يحافظ على دلالات الإلغاء بترجمة AbortError إلى `ToolAbortError`

## 5) دورة حياة المشغل: الإضافة/التعديل/الإزالة والتحديثات الحية

يكشف الوضع التفاعلي `/mcp` في `src/modes/controllers/mcp-command-controller.ts`.

العمليات المدعومة:

- `add` (معالج أو إضافة سريعة)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

عمليات كتابة التكوين ذرية (`writeMCPConfigFile`: ملف مؤقت + إعادة تسمية).

بعد التغييرات، يستدعي المتحكم `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

يستبدل `refreshMCPTools()` جميع إدخالات السجل `mcp_` ويُعيد تفعيل أحدث مجموعة أدوات MCP فوراً، لذا تسري التغييرات دون إعادة تشغيل الجلسة.

### اختلافات الأوضاع

- **الوضع التفاعلي/TUI**: `/mcp` يوفر تجربة مستخدم داخل التطبيق (معالج، تدفق OAuth، نص حالة الاتصال، إعادة ربط فورية لوقت التشغيل).
- **تكامل SDK/بدون واجهة**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) يُرجع الأدوات المحملة + أخطاء لكل خادم؛ بدون تجربة مستخدم لأمر `/mcp`.

## 6) أسطح الأخطاء المرئية للمستخدم

سلاسل الأخطاء الشائعة التي يراها المستخدمون/المشغلون:

- فشل التحقق عند الإضافة/التحديث:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- مشاكل وسائط الإضافة السريعة:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- فشل الاتصال/الاختبار:
  - `Failed to connect to "<name>": <message>`
  - نص مساعدة المهلة يقترح زيادة المهلة
  - نص مساعدة المصادقة لـ `401/403`
- تدفقات المصادقة/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- استخدام خادم معطل:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

يُعالج JSON المصدر غير الصالح في الاكتشاف عموماً كتحذيرات/سجلات؛ مسارات config-writer تُلقي أخطاء صريحة.

## 7) إرشادات عملية للتأليف

لتأليف MCP قوي في قاعدة الكود هذه:

1. حافظ على أسماء الخوادم فريدة عالمياً عبر جميع مصادر التكوين القادرة على MCP.
2. فضّل الأسماء الأبجدية الرقمية/الشرطة السفلية لتجنب تعارضات الأسماء المُطهَّرة في أسماء أدوات `mcp_*` المُنشأة.
3. استخدم `type` صريحاً لتجنب الافتراضيات العرضية لـ stdio.
4. عامل `enabled: false` كإيقاف تام: الخادم يُحذف من مجموعة الاتصال لوقت التشغيل.
5. لتكوينات OAuth، خزّن `credentialId` صالحاً؛ وإلا يتم تخطي حقن المصادقة.
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
