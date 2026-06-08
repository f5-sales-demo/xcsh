---
title: تأليف خادم وأداة MCP
description: دليل لبناء خوادم MCP مخصصة وتسجيل الأدوات لوكيل البرمجة.
sidebar:
  order: 4
  label: تأليف الخادم والأداة
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# تأليف خادم وأداة MCP

يشرح هذا المستند كيف تتحول تعريفات خادم MCP إلى أدوات `mcp_*` قابلة للاستدعاء في وكيل البرمجة (coding-agent)، وما الذي يجب أن يتوقعه المشغلون عندما تكون الإعدادات غير صالحة أو مكررة أو معطلة أو محمية بالمصادقة.

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

## 1) نموذج إعدادات الخادم والتحقق من الصحة

يحدد `src/mcp/types.ts` شكل التأليف المستخدم من قبل كتّاب إعدادات MCP ووقت التشغيل:

- `stdio` (الافتراضي عند غياب `type`): يتطلب `command`، اختياري `args`، `env`، `cwd`
- `http`: يتطلب `url`، اختياري `headers`
- `sse`: يتطلب `url`، اختياري `headers` (محفوظ للتوافقية)
- الحقول المشتركة: `enabled`، `timeout`، `auth`

تفرض `validateServerConfig()` (`src/mcp/config.ts`) أساسيات النقل:

- ترفض الإعدادات التي تحدد كلاً من `command` و `url`
- تتطلب `command` لنوع stdio
- تتطلب `url` لنوع http/sse
- ترفض `type` غير المعروف

يطبق `config-writer.ts` هذا التحقق لعمليات الإضافة/التحديث ويتحقق أيضاً من أسماء الخوادم:

- غير فارغة
- بحد أقصى 100 حرف
- فقط `[a-zA-Z0-9_.-]`

### مزالق النقل

- حذف `type` يعني stdio. إذا كنت تنوي HTTP/SSE لكن حذفت `type`، يصبح `command` إلزامياً.
- لا يزال `sse` مقبولاً لكنه يُعامل داخلياً كنقل HTTP (`createHttpTransport`).
- التحقق هيكلي وليس تحقق من إمكانية الوصول: عنوان URL صالح نحوياً يمكن أن يفشل عند الاتصال.

## 2) الاكتشاف والتطبيع والأسبقية

### الاكتشاف القائم على القدرات

تقوم `loadAllMCPConfigs()` (`src/mcp/config.ts`) بتحميل عناصر `MCPServer` القانونية عبر `loadCapability(mcpCapability.id)`.

ثم تقوم طبقة القدرات (`src/capability/index.ts`) بما يلي:

1. تحميل المزودين بترتيب الأولوية
2. إزالة التكرار حسب `server.name` (الأول يفوز = الأعلى أولوية)
3. التحقق من العناصر بعد إزالة التكرار

النتيجة: أسماء الخوادم المكررة عبر المصادر لا يتم دمجها. تعريف واحد يفوز؛ والتكرارات الأقل أولوية تُحجب.

### `.mcp.json` والملفات ذات الصلة

يقرأ المزود الاحتياطي المخصص في `src/discovery/mcp-json.ts` ملفات `mcp.json` و `.mcp.json` من جذر المشروع (أولوية منخفضة).

في الممارسة العملية، تأتي خوادم MCP أيضاً من مزودين ذوي أولوية أعلى (مثل المجلدات الأصلية `.xcsh/...` ومجلدات إعدادات الأدوات المحددة). إرشادات التأليف:

- يُفضل `.xcsh/mcp.json` (للمشروع) أو `~/.xcsh/mcp.json` (للمستخدم) للتحكم الصريح.
- استخدم `mcp.json` / `.mcp.json` من الجذر عندما تحتاج إلى توافقية احتياطية.
- إعادة استخدام نفس اسم الخادم في مصادر متعددة يسبب حجب الأسبقية، وليس الدمج.

### سلوك التطبيع

تقوم `convertToLegacyConfig()` (`src/mcp/config.ts`) بتعيين `MCPServer` القانوني إلى `MCPServerConfig` لوقت التشغيل.

السلوك الرئيسي:

- يُستدل على النقل كالتالي: `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- الخوادم المعطلة (`enabled === false`) تُحذف قبل الاتصال
- الحقول الاختيارية تُحفظ عند وجودها

### توسيع متغيرات البيئة أثناء الاكتشاف

يوسّع `mcp-json.ts` العناصر النائبة للمتغيرات البيئية في حقول النص باستخدام `expandEnvVarsDeep()`:

- يدعم `${VAR}` و `${VAR:-default}`
- القيم غير المحلولة تبقى نصوصاً حرفية `${VAR}`

يقوم `mcp-json.ts` أيضاً بإجراء فحوصات نوع وقت التشغيل لـ JSON المستخدم ويسجل تحذيرات للقيم غير الصالحة لـ `enabled`/`timeout` بدلاً من إفشال الملف بالكامل.

## 3) المصادقة وحل قيم وقت التشغيل

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) هي المرحلة النهائية قبل الاتصال.

### حقن بيانات اعتماد OAuth

إذا كان الإعداد يحتوي على:

```ts
auth: { type: "oauth", credentialId: "..." }
```

وبيانات الاعتماد موجودة في مخزن المصادقة:

- `http`/`sse`: يحقن ترويسة `Authorization: Bearer <access_token>`
- `stdio`: يحقن متغير البيئة `OAUTH_ACCESS_TOKEN`

إذا فشل البحث عن بيانات الاعتماد، يسجل المدير تحذيراً ويستمر مع مصادقة غير محلولة.

### حل قيم الترويسات/متغيرات البيئة

قبل الاتصال، يحل المدير كل قيمة ترويسة/متغير بيئة عبر `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- القيمة التي تبدأ بـ `!` => تنفيذ أمر shell، استخدام stdout المقتطع (مع تخزين مؤقت)
- خلاف ذلك، معاملة القيمة كاسم متغير بيئة أولاً (`process.env[name]`)، مع التراجع إلى القيمة الحرفية
- القيم غير المحلولة للأوامر/متغيرات البيئة تُحذف من خريطة الترويسات/متغيرات البيئة النهائية

تحذير تشغيلي: هذا يعني أن اسم أمر/مفتاح متغير بيئة مكتوب بشكل خاطئ يمكن أن يحذف بصمت ذلك الإدخال في الترويسة/متغير البيئة، مما ينتج أخطاء 401/403 أو فشل في بدء تشغيل الخادم لاحقاً.

## 4) جسر الأدوات: MCP -> أدوات قابلة للاستدعاء بواسطة الوكيل

يحوّل `src/mcp/tool-bridge.ts` تعريفات أدوات MCP إلى `CustomTool`.

### التسمية ونطاق التعارض

تُولَّد أسماء الأدوات كالتالي:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

القواعد:

- تحويل إلى أحرف صغيرة
- الأحرف غير `[a-z_]` تصبح `_`
- الشرطات السفلية المتكررة تُطوى
- بادئة `<server>_` المكررة في اسم الأداة تُزال مرة واحدة

هذا يتجنب العديد من التعارضات، لكن ليس جميعها. يمكن أن تُنقّح أسماء خام مختلفة إلى نفس المعرف (مثلاً `my-server` و `my.server` كلاهما يُنقّح بشكل مشابه)، وإدراج السجل يعمل بنظام الكتابة الأخيرة تفوز.

### تعيين المخطط

تحافظ `convertSchema()` على مخطط JSON Schema الخاص بـ MCP كما هو في الغالب لكنها تصحح مخططات الكائنات التي تفتقد `properties` بـ `{}` لتوافق المزود.

### تعيين التنفيذ

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- تستدعي MCP `tools/call`
- تسطّح محتوى MCP إلى نص قابل للعرض
- تعيد تفاصيل منظمة (`serverName`، `mcpToolName`، بيانات وصفية للمزود)
- تحوّل `isError` المبلغ عنه من الخادم إلى نتيجة نصية `Error: ...`
- تحوّل أخطاء النقل/وقت التشغيل المُلقاة إلى `MCP error: ...`
- تحافظ على دلالات الإلغاء بترجمة AbortError إلى `ToolAbortError`

## 5) دورة حياة المشغل: الإضافة/التعديل/الحذف والتحديثات المباشرة

يعرض الوضع التفاعلي `/mcp` في `src/modes/controllers/mcp-command-controller.ts`.

العمليات المدعومة:

- `add` (معالج إرشادي أو إضافة سريعة)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

عمليات كتابة الإعدادات ذرية (`writeMCPConfigFile`: ملف مؤقت + إعادة تسمية).

بعد التغييرات، يستدعي المتحكم `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

تستبدل `refreshMCPTools()` جميع إدخالات `mcp_` في السجل وتعيد تفعيل أحدث مجموعة أدوات MCP فوراً، لذا تسري التغييرات دون إعادة تشغيل الجلسة.

### الاختلافات حسب الوضع

- **الوضع التفاعلي/واجهة المستخدم النصية**: يوفر `/mcp` تجربة مستخدم داخل التطبيق (معالج إرشادي، تدفق OAuth، نص حالة الاتصال، إعادة ربط فورية أثناء التشغيل).
- **تكامل SDK/بدون واجهة**: تعيد `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) الأدوات المحملة + الأخطاء لكل خادم؛ بدون تجربة مستخدم لأمر `/mcp`.

## 6) أسطح الأخطاء المرئية للمستخدم

رسائل الخطأ الشائعة التي يراها المستخدمون/المشغلون:

- فشل التحقق عند الإضافة/التحديث:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- مشاكل معاملات الإضافة السريعة:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- فشل الاتصال/الاختبار:
  - `Failed to connect to "<name>": <message>`
  - نص مساعدة المهلة الزمنية يقترح زيادة المهلة
  - نص مساعدة المصادقة لـ `401/403`
- تدفقات المصادقة/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- استخدام خادم معطل:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

يُعالج JSON المصدر غير الصالح في الاكتشاف عموماً كتحذيرات/سجلات؛ أما مسارات كاتب الإعدادات فتطرح أخطاء صريحة.

## 7) إرشادات عملية للتأليف

لتأليف MCP متين في قاعدة الكود هذه:

1. حافظ على أسماء الخوادم فريدة عالمياً عبر جميع مصادر إعدادات MCP.
2. فضّل الأسماء الأبجدية الرقمية/الشرطة السفلية لتجنب تعارضات الأسماء المنقحة في أسماء أدوات `mcp_*` المولدة.
3. استخدم `type` صريحاً لتجنب الافتراض العرضي لـ stdio.
4. عامل `enabled: false` كإيقاف كامل: يُحذف الخادم من مجموعة الاتصال أثناء التشغيل.
5. لإعدادات OAuth، خزّن `credentialId` صالحاً؛ وإلا يُتخطى حقن المصادقة.
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
