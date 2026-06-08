---
title: تهيئة MCP
description: تهيئة خادم MCP والتحقق من صحته وإدارته لبيئة تشغيل وكيل البرمجة.
sidebar:
  order: 1
  label: التهيئة
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# تهيئة MCP في OMP

يشرح هذا الدليل كيفية إضافة خوادم MCP وتحريرها والتحقق من صحتها لوكيل البرمجة OMP.

مصدر الحقيقة في الكود:

- أنواع تهيئة بيئة التشغيل: `packages/coding-agent/src/mcp/types.ts`
- كاتب التهيئة: `packages/coding-agent/src/mcp/config-writer.ts`
- المُحمّل + التحقق: `packages/coding-agent/src/mcp/config.ts`
- اكتشاف `mcp.json` المستقل: `packages/coding-agent/src/discovery/mcp-json.ts`
- المخطط: `packages/coding-agent/src/config/mcp-schema.json`

## مواقع التهيئة المفضلة

يمكن لـ OMP اكتشاف خوادم MCP من أدوات متعددة (`.claude/`، `.cursor/`، `.vscode/`، `opencode.json`، والمزيد)، لكن للتهيئة الأصلية لـ OMP يجب عادةً استخدام أحد هذه الملفات:

- المشروع: `.xcsh/mcp.json`
- المستخدم: `~/.xcsh/mcp.json`

يقبل OMP أيضاً ملفات مستقلة احتياطية في جذر المشروع:

- `mcp.json`
- `.mcp.json`

استخدم `.xcsh/mcp.json` عندما تريد أن يمتلك OMP التهيئة. استخدم `mcp.json` / `.mcp.json` في الجذر فقط عندما تريد ملفاً احتياطياً قابلاً للنقل يمكن لعملاء MCP الآخرين قراءته أيضاً.

## إضافة مرجع مخطط

أضف هذا السطر في أعلى الملف للحصول على الإكمال التلقائي والتحقق في المحرر:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

يكتب OMP الآن هذا تلقائياً عندما تقوم `/mcp add`، `/mcp enable`، `/mcp disable`، `/mcp reauth`، أو تدفقات كتابة التهيئة الأخرى بإنشاء أو تحديث ملف MCP مُدار بواسطة OMP.

## شكل الملف

يدعم OMP هذه البنية على المستوى الأعلى:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

المفاتيح على المستوى الأعلى:

- `$schema` — عنوان URL اختياري لمخطط JSON للأدوات
- `mcpServers` — خريطة من اسم الخادم إلى تهيئة الخادم
- `disabledServers` — قائمة حظر على مستوى المستخدم تُستخدم لإيقاف الخوادم المكتشفة بالاسم

يجب أن تتطابق أسماء الخوادم مع `^[a-zA-Z0-9_.-]{1,100}$`.

## حقول الخادم المدعومة

حقول مشتركة لكل وسيلة نقل:

- `enabled?: boolean` — تخطي هذا الخادم عندما تكون القيمة `false`
- `timeout?: number` — مهلة الاتصال بالمللي ثانية
- `auth?: { ... }` — بيانات وصفية للمصادقة يستخدمها OMP لتدفقات OAuth/مفتاح API
- `oauth?: { ... }` — إعدادات عميل OAuth صريحة تُستخدم أثناء المصادقة/إعادة المصادقة

### نقل `stdio`

`stdio` هو الافتراضي عند حذف `type`.

مطلوب:

- `command: string`

اختياري:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

مثال:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

يتبع هذا حزمة خادم Filesystem MCP الرسمية (`@modelcontextprotocol/server-filesystem`).

### نقل `http`

مطلوب:

- `type: "http"`
- `url: string`

اختياري:

- `headers?: Record<string, string>`

مثال:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

يتطابق هذا مع نقطة نهاية خادم GitHub MCP المستضاف من GitHub.

### نقل `sse`

مطلوب:

- `type: "sse"`
- `url: string`

اختياري:

- `headers?: Record<string, string>`

مثال:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

لا يزال `sse` مدعوماً للتوافق، لكن مواصفات MCP تفضل الآن Streamable HTTP (`type: "http"`) للخوادم الجديدة.

## حقول المصادقة

يفهم OMP كائنين مرتبطين بالمصادقة.

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

استخدم هذا عندما يجب على OMP تذكر كيفية إعادة تحميل بيانات الاعتماد لخادم ما.

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

استخدم هذا عندما يتطلب خادم MCP إعدادات عميل OAuth صريحة.

Slack هو أوضح مثال حالي. خادم MCP الخاص بـ Slack مستضاف على `https://mcp.slack.com/mcp`، يستخدم Streamable HTTP، ويتطلب OAuth سرياً مع بيانات اعتماد عميل تطبيق Slack الخاص بك.

مثال:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

نقاط نهاية Slack ذات الصلة من وثائق Slack:

- نقطة نهاية MCP: `https://mcp.slack.com/mcp`
- نقطة نهاية التفويض: `https://slack.com/oauth/v2_user/authorize`
- نقطة نهاية الرمز المميز: `https://slack.com/api/oauth.v2.user.access`

## أمثلة شائعة للنسخ واللصق

### خادم نظام الملفات عبر stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### خادم GitHub المستضاف عبر HTTP

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### خادم GitHub المحلي عبر Docker

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

يتطابق هذا مع صورة Docker المحلية الرسمية من GitHub `ghcr.io/github/github-mcp-server`.

### خادم Slack المستضاف عبر OAuth

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## الأسرار وحل المتغيرات

هذا هو الجزء الذي عادةً ما يُربك الناس.

### في `.xcsh/mcp.json` و `~/.xcsh/mcp.json`

قبل أن يُشغّل OMP خادماً أو يُجري طلب HTTP، يحل قيم `env` و `headers` كالتالي:

1. إذا بدأت القيمة بـ `!`، يُنفذها OMP كأمر صدفة ويستخدم المخرج المقتطع.
2. وإلا يتحقق OMP أولاً مما إذا كانت القيمة تطابق اسم متغير بيئة.
3. إذا لم يكن متغير البيئة هذا مُعيّناً، يستخدم OMP السلسلة النصية حرفياً.

أمثلة:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

هذا يعني أن ما يلي صالح ومريح للأسرار المحلية:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → نسخ من بيئة الصدفة الحالية
- `"Authorization": "Bearer hardcoded-token"` → استخدام القيمة الحرفية
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → بناء الترويسة من أمر

### في `mcp.json` و `.mcp.json` الجذر

يقوم مُحمّل الاحتياطي المستقل أيضاً بتوسيع `${VAR}` و `${VAR:-default}` داخل السلاسل النصية أثناء الاكتشاف.

مثال:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

إذا كنت تريد سلوك OMP الأقل إثارة للدهشة، فضّل `.xcsh/mcp.json` واستخدم قيم env/header صريحة.

## `disabledServers`

`disabledServers` مفيد بشكل أساسي في ملف تهيئة المستخدم (`~/.xcsh/mcp.json`) عندما يتم اكتشاف خادم من مصدر آخر وتريد من OMP تجاهله دون تحرير تهيئة تلك الأداة الأخرى.

مثال:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` مقابل تحرير JSON مباشرةً

استخدم `/mcp add` عندما تريد إعداداً موجّهاً.

استخدم تحرير JSON المباشر عندما:

- تحتاج إلى خيار نقل أو مصادقة لا يطلبه المعالج بعد
- تريد لصق تعريف خادم من عميل MCP آخر
- تريد التحقق المدعوم بالمخطط في محررك

بعد التحرير، استخدم:

- `/mcp reload` لإعادة اكتشاف الخوادم وإعادة الاتصال بها في الجلسة الحالية
- `/mcp list` لمعرفة ملف التهيئة الذي جاء منه الخادم
- `/mcp test <name>` لاختبار خادم واحد

## قواعد التحقق التي يفرضها OMP

من `validateServerConfig()` في `packages/coding-agent/src/mcp/config.ts`:

- `stdio` يتطلب `command`
- `http` و `sse` يتطلبان `url`
- لا يمكن للخادم تعيين كل من `command` و `url`
- يتم رفض قيم `type` غير المعروفة

الآثار العملية:

- حذف `type` يعني `stdio`
- إذا لصقت تهيئة خادم بعيد ونسيت `"type": "http"`، سيعامله OMP كـ `stdio` ويشتكي من أن `command` مفقود
- `sse` يبقى صالحاً للتوافق، لكن الخوادم المستضافة الجديدة يجب عادةً تهيئتها كـ `http`

## الاكتشاف والأولوية

لا يدمج OMP تعريفات الخوادم المكررة عبر الملفات. يتم ترتيب مزودي الاكتشاف حسب الأولوية، ويفوز التعريف الأعلى أولوية.

في الممارسة:

- فضّل `.xcsh/mcp.json` أو `~/.xcsh/mcp.json` عندما تريد تجاوزاً خاصاً بـ OMP
- حافظ على تفرد أسماء الخوادم عبر الأدوات قدر الإمكان
- استخدم `disabledServers` في تهيئة المستخدم عندما تستمر تهيئة طرف ثالث في إعادة تقديم خادم لا تريده

## استكشاف الأخطاء وإصلاحها

### `Server "name": stdio server requires "command" field`

من المحتمل أنك حذفت `type: "http"` على خادم بعيد.

### `Server "name": both "command" and "url" are set`

اختر وسيلة نقل واحدة. يعامل OMP `command` كـ stdio و `url` كـ http/sse.

### `/mcp add` نجح لكن الخادم لا يزال لا يتصل

JSON صالح، لكن الخادم قد يكون لا يزال غير قابل للوصول. استخدم `/mcp test <name>` وتحقق مما إذا كان:

- الملف الثنائي أو صورة Docker موجودة
- متغيرات البيئة المطلوبة مُعيّنة
- عنوان URL البعيد قابل للوصول
- رمز OAuth أو API صالح

### الخادم موجود في تهيئة أداة أخرى لكن ليس في OMP

شغّل `/mcp list`. يكتشف OMP العديد من ملفات MCP التابعة لأطراف ثالثة، لكن يمكن أيضاً تعطيل التحميل على مستوى المشروع عبر إعداد `mcp.enableProjectConfig`.

## المراجع

- مواصفات نقل MCP: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- حزمة خادم نظام الملفات: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- خادم GitHub MCP: <https://github.com/github/github-mcp-server>
- وثائق خادم Slack MCP: <https://docs.slack.dev/ai/slack-mcp-server/>
