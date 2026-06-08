---
title: سياقات F5 XC
description: >-
  ربط xcsh بمستأجري F5 Distributed Cloud -- إنشاء سياقات المصادقة والتبديل بينها
  وإدارتها.
sidebar:
  order: 1
  label: سياقات F5 XC
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# سياقات F5 XC

يتصل xcsh بـ F5 Distributed Cloud من خلال **السياقات** -- وهي مجموعات بيانات اعتماد مُسمّاة تربط عنوان URL للمستأجر ورمز API ومساحة الاسم. إذا كنت قد استخدمت `kubectl config use-context` أو `kubectx` من قبل، فسير العمل مطابق تمامًا: أنشئ سياقًا، وتبدّل بينها بالاسم، واستخدم `-` للعودة السريعة.

## البدء

### 1. إنشاء سياقك الأول

تحتاج إلى ثلاثة أشياء من وحدة تحكم F5 XC الخاصة بك: عنوان URL للمستأجر، ورمز API، واختياريًا مساحة اسم.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

أو استخدم المعالج الموجّه إذا كنت تفضل الإرشاد خطوة بخطوة:

```
/context wizard
```

### 2. تفعيله

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

بمجرد التفعيل، يقوم xcsh بحقن بيانات اعتماد المستأجر في جلستك. يمكن للوكيل الآن إجراء استدعاءات API الخاصة بـ F5 XC، ويعرض شريط الحالة السياق النشط.

### 3. إضافة المزيد من السياقات والتبديل بينها

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

التبديل بالاسم -- لا حاجة لأمر فرعي:

```
/context staging
```

العودة إلى السياق السابق (بأسلوب `cd -`):

```
/context -
```

استدعاء `/context -` مرتين يعيدك إلى حيث بدأت.

### 4. عرض ما لديك

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

يشير الرمز `*` إلى السياق النشط.

## الأوامر اليومية

| الأمر | ما يفعله |
|---|---|
| `/context` | عرض جميع السياقات |
| `/context <name>` | التبديل إلى سياق |
| `/context -` | التبديل إلى السياق السابق |
| `/context show` | عرض تفاصيل السياق النشط (مع إخفاء الرموز) |
| `/context status` | عرض حالة المصادقة الحالية |

## دورة حياة السياق

| الأمر | ما يفعله |
|---|---|
| `/context create <name> <url> <token> [namespace]` | إنشاء سياق |
| `/context delete <name> --confirm` | حذف سياق (يتطلب `--confirm`) |
| `/context rename <old> <new>` | إعادة تسمية سياق |
| `/context validate <name>` | اختبار بيانات الاعتماد دون التبديل |
| `/context export [name] [--include-token]` | التصدير بتنسيق JSON (الرموز مخفية افتراضيًا) |
| `/context import <path-or-json> [--overwrite]` | الاستيراد من ملف أو JSON مضمّن |
| `/context wizard` | إعداد تفاعلي موجّه |

## تبديل مساحات الأسماء

لكل سياق مساحة اسم افتراضية. يمكنك تبديلها دون تغيير السياق:

```
/context namespace system
```

يوفر الإكمال التلقائي بالتبويب أسماء مساحات الأسماء من المستأجر النشط.

## متغيرات البيئة على السياقات

يمكن أن تحمل السياقات متغيرات بيئة إضافية يتم حقنها في جلستك عند التفعيل. مفيدة للتكوين الخاص بكل مستأجر والذي لا يعد جزءًا من مجموعة بيانات الاعتماد.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

الأسماء البديلة: `add` = `set`، `remove`/`clear` = `unset`.

## الإكمال التلقائي بالتبويب

اكتب `/context ` ثم اضغط Tab. تعرض القائمة المنسدلة:

1. **أسماء السياقات** -- مع تلميحات عنوان URL للمستأجر، حتى تتمكن من التمييز بين المستأجرين
2. **`-`** -- يظهر عندما تكون قد قمت بالتبديل سابقًا، ويعرض السياق الذي ستنتقل إليه
3. **الأوامر الفرعية** -- `list`، `create`، `delete`، إلخ.

تظهر أسماء السياقات أولًا لأن التبديل هو الإجراء الأكثر شيوعًا.

يعمل الإكمال على مستوى الأوامر الفرعية أيضًا: `/context activate <Tab>` يُكمل أسماء السياقات، `/context namespace <Tab>` يُكمل مساحات الأسماء، `/context unset <Tab>` يُكمل مفاتيح متغيرات البيئة المعروفة.

## قواعد التسمية

يجب أن تكون أسماء السياقات من 1 إلى 64 حرفًا: أحرف، أرقام، شرطات، شرطات سفلية.

تُرفض الأسماء التي تتعارض مع الأوامر الفرعية:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

مجموعة الأسماء المحجوزة الكاملة: `list`، `show`، `status`، `create`، `delete`، `rename`، `namespace`، `env`، `set`، `unset`، `add`، `remove`، `clear`، `activate`، `validate`، `export`، `import`، `wizard`، `help`. المقارنة غير حساسة لحالة الأحرف.

## تجاوز متغيرات البيئة

إذا تم تعيين `F5XC_API_URL` و `F5XC_API_TOKEN` في بيئة الصدفة الخاصة بك قبل تشغيل xcsh، فإنها تأخذ الأولوية على أي سياق. هذا مفيد لخطوط أنابيب CI/CD أو الجلسات الفردية التي لا تريد فيها إنشاء سياق دائم.

عند التشغيل في هذا الوضع، يعرض `/context` بيانات الاعتماد المستمدة من البيئة مع تسمية `(via env vars)`.

## سلوك السياق السابق

- **محدود بالجلسة**: يتم إعادة تعيين السياق السابق عند إعادة تشغيل xcsh. لا يتم حفظه على القرص.
- **التبادل المتكرر**: `/context -` مرتين يعيدك إلى حيث بدأت.
- **آمن عبر التعديلات**: إذا حذفت السياق السابق، يتم مسح المؤشر. إذا أعدت تسميته، يتبع المؤشر الاسم الجديد.
- **إعادة التفعيل لا تفعل شيئًا**: `/context production` عندما تكون بالفعل على `production` لا يعيد تعيين المؤشر السابق.

## اصطلاحات التصميم

يتبع تجربة استخدام `/context`:

- **kubectx**: `kubectx <name>` للتبديل، `kubectx -` للسابق، `kubectx` بدون معاملات للعرض
- **kubectl**: `kubectl config use-context` للصيغة الصريحة
- **الصدفة**: `cd -` / `OLDPWD` لتتبع المجلد السابق
