---
title: نظام إضافات السوق
description: نظام إضافات السوق لاكتشاف وتثبيت وإدارة مجموعات الإضافات المنسّقة.
sidebar:
  order: 4
  label: السوق
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# نظام إضافات السوق

يتيح لك نظام السوق اكتشاف وتثبيت وإدارة الإضافات من كتالوجات مستضافة على Git. وهو متوافق مع تنسيق سجل إضافات Claude Code.

## البدء السريع

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

أو اكتب فقط `/marketplace` بدون أي وسائط لفتح متصفح الإضافات التفاعلي.

## المفاهيم

**السوق** هو مستودع Git (أو دليل محلي) يحتوي على ملف كتالوج في `.xcsh-plugin/marketplace.json`. يسرد الكتالوج الإضافات المتاحة مع مصادرها وأوصافها وبياناتها الوصفية.

**الإضافة** هي دليل يحتوي على مهارات أو أوامر أو خطافات أو خوادم MCP أو خوادم LSP. يتم تعريف الإضافات بصيغة `name@marketplace` (مثل `code-review@f5xc-salesdemos-marketplace`).

**النطاقات**: يمكن تثبيت الإضافات في نطاقين:

- **المستخدم** (الافتراضي) -- متاحة في جميع المشاريع، مخزنة في `~/.xcsh/plugins/installed_plugins.json`
- **المشروع** -- متاحة فقط في المشروع الحالي، مخزنة في `.xcsh/installed_plugins.json`

تثبيتات نطاق المشروع تتجاوز تثبيتات نطاق المستخدم لنفس الإضافة.

## الأوامر

### الوضع التفاعلي

| الأمر | التأثير |
|---|---|
| `/marketplace` | فتح متصفح الإضافات التفاعلي (التثبيت) |

### إدارة السوق

| الأمر | التأثير |
|---|---|
| `/marketplace add <source>` | إضافة مصدر سوق |
| `/marketplace remove <name>` | إزالة سوق |
| `/marketplace update [name]` | إعادة جلب الكتالوج(ات)؛ حذف الاسم لتحديث الكل |
| `/marketplace list` | عرض الأسواق المُعدّة |

### عمليات الإضافات

| الأمر | التأثير |
|---|---|
| `/marketplace discover [marketplace]` | تصفح الإضافات المتاحة |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | تثبيت إضافة |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | إلغاء تثبيت إضافة |
| `/marketplace installed` | عرض إضافات السوق المثبتة |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | ترقية إضافة واحدة أو جميع الإضافات |

### المكافئات في سطر الأوامر

نفس العمليات متاحة من سطر الأوامر:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## مصادر السوق

عند تشغيل `/marketplace add <source>`، يصنف النظام المصدر:

| تنسيق المصدر | النوع | مثال |
|---|---|---|
| `owner/repo` | اختصار GitHub | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | رابط كتالوج مباشر | `https://example.com/marketplace.json` |
| `https://...*.git` أو `git@...` | مستودع Git | `https://github.com/org/repo.git` |
| `./path` أو `~/path` أو `/path` | دليل محلي | `./my-marketplace` |

يقوم النظام باستنساخ المستودع (أو قراءة الدليل المحلي)، وتحديد موقع `.xcsh-plugin/marketplace.json`، والتحقق من صحته، وتخزين الكتالوج محلياً في ذاكرة التخزين المؤقت.

## تنسيق الكتالوج (marketplace.json)

يوجد كتالوج السوق في `.xcsh-plugin/marketplace.json` في جذر المستودع:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### الحقول المطلوبة

| الحقل | الوصف |
|---|---|
| `name` | اسم السوق. أحرف صغيرة وأرقام وشرطات ونقاط. يجب أن يبدأ وينتهي بحرف أبجدي رقمي. الحد الأقصى 64 حرفاً. |
| `owner.name` | اسم مالك السوق |
| `plugins` | مصفوفة من إدخالات الإضافات |

### حقول إدخال الإضافة

| الحقل | مطلوب | الوصف |
|---|---|---|
| `name` | نعم | اسم الإضافة (نفس قواعد اسم السوق) |
| `source` | نعم | مكان العثور على الإضافة (انظر أدناه) |
| `description` | لا | وصف مختصر |
| `version` | لا | سلسلة الإصدار |
| `author` | لا | `{ name, email? }` |
| `homepage` | لا | رابط URL |
| `category` | لا | سلسلة الفئة (مثل `development`، `productivity`، `security`) |
| `tags` | لا | مصفوفة من علامات نصية |
| `strict` | لا | قيمة منطقية |
| `commands` | لا | أوامر الشرطة المائلة المقدمة |
| `agents` | لا | الوكلاء المقدمون |
| `hooks` | لا | تعريفات الخطافات |
| `mcpServers` | لا | تعريفات خوادم MCP |
| `lspServers` | لا | تعريفات خوادم LSP |

### تنسيقات مصدر الإضافة

يدعم حقل `source` عدة تنسيقات:

**مسار نسبي** (داخل مستودع السوق):

```json
"source": "./plugins/my-plugin"
```

**رابط مستودع Git**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**اختصار GitHub**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**دليل فرعي Git** (مستودع أحادي):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**حزمة npm**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## التخطيط على القرص

```
~/.xcsh/
  config/
    marketplaces.json          # سجل الأسواق المضافة
  plugins/
    installed_plugins.json     # الإضافات المثبتة بنطاق المستخدم
    cache/
      marketplaces/            # كتالوجات الأسواق المخزنة مؤقتاً
      plugins/                 # أدلة الإضافات المخزنة مؤقتاً

<project>/.xcsh/
  installed_plugins.json       # الإضافات المثبتة بنطاق المشروع
```

## قواعد التسمية

يجب أن تكون أسماء الأسواق والإضافات:

- تبدأ وتنتهي بحرف صغير أو رقم
- تحتوي فقط على أحرف صغيرة وأرقام وشرطات ونقاط
- لا تتجاوز 64 حرفاً كحد أقصى

معرفات الإضافات (`name@marketplace`) يجب ألا تتجاوز 128 حرفاً إجمالاً.

أمثلة صالحة: `my-plugin`، `code-review`، `wordpress.com`، `ai-firstify`
أمثلة غير صالحة: `-bad`، `bad-`، `.bad`، `Bad`، `under_score`
