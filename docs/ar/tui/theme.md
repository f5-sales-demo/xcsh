---
title: مرجع السمات
description: مرجع سمات TUI مع رموز الألوان وإعدادات الخطوط وتخصيص السمات.
sidebar:
  order: 3
  label: السمات
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# مرجع السمات

يصف هذا المستند آلية عمل السمات في وكيل البرمجة اليوم: المخطط، والتحميل، وسلوك وقت التشغيل، وأوضاع الفشل.

## ما يتحكم فيه نظام السمات

يتحكم نظام السمات في:

- رموز الألوان للمقدمة/الخلفية المستخدمة عبر TUI
- محولات تنسيق markdown (`getMarkdownTheme()`)
- محولات المحدد/المحرر/قائمة الإعدادات (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- الإعداد المسبق للرموز + تجاوزات الرموز (`unicode`, `nerd`, `ascii`)
- ألوان تمييز الصياغة المستخدمة بواسطة المميز الأصلي (`@f5xc-salesdemos/pi-natives`)
- ألوان مقاطع شريط الحالة

التنفيذ الأساسي: `src/modes/theme/theme.ts`.

## شكل ملف JSON للسمة

ملفات السمات عبارة عن كائنات JSON يتم التحقق منها مقابل المخطط في وقت التشغيل في `theme.ts` (`ThemeJsonSchema`) والمنعكسة بواسطة `src/modes/theme/theme-schema.json`.

الحقول الرئيسية:

- `name` (مطلوب)
- `colors` (مطلوب؛ جميع رموز الألوان مطلوبة)
- `vars` (اختياري؛ متغيرات ألوان قابلة لإعادة الاستخدام)
- `export` (اختياري؛ ألوان تصدير HTML)
- `symbols` (اختياري)
  - `preset` (اختياري: `unicode | nerd | ascii`)
  - `overrides` (اختياري: تجاوزات مفتاح/قيمة لـ `SymbolKey`)

قيم الألوان تقبل:

- سلسلة hex (`"#RRGGBB"`)
- مؤشر 256 لوناً (`0..255`)
- سلسلة مرجع متغير (يتم حلها من خلال `vars`)
- سلسلة فارغة (`""`) تعني الإعداد الافتراضي للطرفية (`\x1b[39m` fg، `\x1b[49m` bg)

## رموز الألوان المطلوبة (الحالية)

جميع الرموز أدناه مطلوبة في `colors`.

### النصوص والحدود الأساسية (11)

`accent`، `border`، `borderAccent`، `borderMuted`، `success`، `error`، `warning`، `muted`، `dim`، `text`، `thinkingText`

### كتل الخلفية (7)

`selectedBg`، `userMessageBg`، `customMessageBg`، `toolPendingBg`، `toolSuccessBg`، `toolErrorBg`، `statusLineBg`

### نص الرسالة/الأداة (5)

`userMessageText`، `customMessageText`، `customMessageLabel`، `toolTitle`، `toolOutput`

### Markdown (10)

`mdHeading`، `mdLink`، `mdLinkUrl`، `mdCode`، `mdCodeBlock`، `mdCodeBlockBorder`، `mdQuote`، `mdQuoteBorder`، `mdHr`، `mdListBullet`

### الفروق الأداة + تمييز الصياغة (12)

`toolDiffAdded`، `toolDiffRemoved`، `toolDiffContext`،
`syntaxComment`، `syntaxKeyword`، `syntaxFunction`، `syntaxVariable`، `syntaxString`، `syntaxNumber`، `syntaxType`، `syntaxOperator`، `syntaxPunctuation`

### حدود الوضع/التفكير (8)

`thinkingOff`، `thinkingMinimal`، `thinkingLow`، `thinkingMedium`، `thinkingHigh`، `thinkingXhigh`، `bashMode`، `pythonMode`

### ألوان مقاطع شريط الحالة (14)

`statusLineSep`، `statusLineModel`، `statusLinePath`، `statusLineGitClean`، `statusLineGitDirty`، `statusLineContext`، `statusLineSpend`، `statusLineStaged`، `statusLineDirty`، `statusLineUntracked`، `statusLineOutput`، `statusLineCost`، `statusLineSubagents`

## الرموز الاختيارية

### قسم `export` (اختياري)

يُستخدم لمساعدات تنسيق تصدير HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

في حال الحذف، يشتق كود التصدير القيم الافتراضية من ألوان السمة المحلولة.

### قسم `symbols` (اختياري)

- يضبط `symbols.preset` مجموعة الرموز الافتراضية على مستوى السمة.
- يمكن لـ `symbols.overrides` تجاوز قيم `SymbolKey` الفردية.

أولوية وقت التشغيل:

1. تجاوز `symbolPreset` في الإعدادات (إذا كان مضبوطاً)
2. `symbols.preset` في ملف JSON للسمة
3. الاحتياطي `"unicode"`

تُتجاهل مفاتيح التجاوز غير الصالحة ويتم تسجيلها (`logger.debug`).

## مصادر السمات المدمجة مقابل المخصصة

ترتيب البحث عن السمة (`loadThemeJson`):

1. السمات المدمجة المضمّنة (`defaults/xcsh-dark.json` و `defaults/xcsh-light.json` المجمّعة في `defaultThemes`)
2. ملف السمة المخصصة: `<customThemesDir>/<name>.json`

يأتي دليل السمات المخصصة من `getCustomThemesDir()`:

- الافتراضي: `~/.xcsh/agent/themes`
- يُتجاوز بـ `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

تُعيد `getAvailableThemes()` الأسماء المدمجة + المخصصة المدمجة، مرتبةً، مع أولوية المدمجة عند تعارض الأسماء.

## التحميل والتحقق والحل

لملفات السمات المخصصة:

1. قراءة JSON
2. تحليل JSON
3. التحقق مقابل `ThemeJsonSchema`
4. حل مراجع `vars` بصورة تعاودية
5. تحويل القيم المحلولة إلى ANSI حسب وضع قدرة الطرفية

سلوك التحقق:

- رموز الألوان المطلوبة المفقودة: رسالة خطأ مجمّعة صريحة
- أنواع/قيم رموز خاطئة: أخطاء التحقق مع مسار JSON
- ملف سمة غير معروف: `Theme not found: <name>`

سلوك مرجع المتغير:

- يدعم المراجع المتداخلة
- يُلقي استثناءً عند مرجع متغير مفقود
- يُلقي استثناءً عند المراجع الدائرية

## سلوك وضع ألوان الطرفية

اكتشاف وضع الألوان (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` في `dumb`، `linux`، أو فارغ => 256color
- وإلا => truecolor

سلوك التحويل:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- رقمي -> `38;5` / `48;5` ANSI
- `""` -> إعادة تعيين fg/bg الافتراضي

## سلوك التبديل في وقت التشغيل

### السمة الأولية (`initTheme`)

تُهيئ `main.ts` السمة بالإعدادات:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

يستخدم التحديد التلقائي لخانة السمة اكتشاف خلفية `COLORFGBG`:

- تحليل مؤشر الخلفية من `COLORFGBG`
- `< 8` => خانة داكنة (`theme.dark`)
- `>= 8` => خانة فاتحة (`theme.light`)
- فشل التحليل => خانة داكنة

الإعدادات الافتراضية الحالية من مخطط الإعدادات:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### التبديل الصريح (`setTheme`)

- يحمّل السمة المحددة
- يُحدّث المفرد العام `theme`
- يبدأ المراقب اختياريًا
- يُشغّل استدعاء `onThemeChange`

عند الفشل:

- يرجع إلى السمة المدمجة `dark`
- يُعيد `{ success: false, error }`

### التبديل للمعاينة (`previewTheme`)

- يُطبّق سمة معاينة مؤقتة على `theme` العام
- لا **يُغيّر** الإعدادات المحفوظة بحد ذاته
- يُعيد نجاحًا/خطأً دون استبدال احتياطي

تستخدم واجهة مستخدم الإعدادات هذا للمعاينة الحية وتستعيد السمة السابقة عند الإلغاء.

## المراقبون وإعادة التحميل الحية

عند تمكين المراقب (`setTheme(..., true)` / التهيئة التفاعلية):

- يراقب فقط مسار الملف المخصص `<customThemesDir>/<currentTheme>.json`
- السمات المدمجة لا تُراقب فعليًا
- `change` للملف: يحاول إعادة التحميل (مع تأخير)
- `rename`/حذف للملف: يرجع إلى `dark`، يغلق المراقب

يُثبّت الوضع التلقائي أيضًا مستمعاً لـ `SIGWINCH` ويمكنه إعادة تقييم خريطة الخانة الداكنة/الفاتحة عند تغيير حالة الطرفية.

## سلوك وضع عمى الألوان

يُغيّر `colorBlindMode` رمزاً واحداً فقط في وقت التشغيل:

- يتم ضبط `toolDiffAdded` بتعديل HSV (يتحول الأخضر نحو الأزرق)
- يُطبَّق التعديل فقط عندما تكون القيمة المحلولة سلسلة hex

تظل الرموز الأخرى دون تغيير.

## أين تُحفظ إعدادات السمة

يحفظ `Settings` الإعدادات المتعلقة بالسمة في ملف YAML للتكوين العام:

- المسار: `<agentDir>/config.yml`
- دليل الوكيل الافتراضي: `~/.xcsh/agent`
- الملف الافتراضي الفعلي: `~/.xcsh/agent/config.yml`

المفاتيح المحفوظة:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

يوجد ترحيل قديم: يتم ترحيل `theme: "name"` المسطح القديم إلى `theme.dark` أو `theme.light` المتداخل بناءً على اكتشاف السطوع.

## إنشاء سمة مخصصة (عملي)

1. أنشئ ملفاً في دليل السمات المخصصة، مثل `~/.xcsh/agent/themes/my-theme.json`.
2. أدرج `name`، و `vars` الاختياري، و**جميع** رموز `colors` **المطلوبة**.
3. أدرج اختياريًا `symbols` و `export`.
4. اختر السمة في الإعدادات (`Display -> Dark theme` أو `Display -> Light theme`) بحسب الخانة التلقائية التي تريدها.

هيكل عظمي أدنى. كل مفتاح في `colors` مطلوب — يرفض المحقق في وقت التشغيل
(`additionalProperties: false`) كلاً من المفاتيح المفقودة والمفاتيح غير المعروفة.
للاطلاع على تطبيقات المرجع المضمّنة انظر
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
و [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

يحتوي شريط الحالة على نظامَي ألوان متوازيَين موثَّقَين في المشكلة #242:

- ألوان النص Hex (`statusLinePath`، `statusLineGitClean`، `statusLineGitDirty`،
  `statusLineStaged`، `statusLineDirty`، `statusLineUntracked`) تُشغّل العرض غير powerline.
- مؤشرات لوحة 256 لوناً (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  تُشغّل ملء مقاطع powerline. وهي مستقلة عن مفاتيح hex أعلاه —
  يجب ضبط كليهما.

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileF5xcBg": "accent",
    "statusLineProfileF5xcFg": 231
  }
}
```

## اختبار السمات المخصصة

استخدم هذا السير:

1. ابدأ الوضع التفاعلي (المراقب مُمكَّن عند بدء التشغيل).
2. افتح الإعدادات وقم بمعاينة قيم السمة (المعاينة الحية `previewTheme`).
3. لملفات السمات المخصصة، قم بتحرير JSON أثناء التشغيل وتأكد من إعادة التحميل التلقائية عند الحفظ.
4. اختبر الأسطح الحرجة:
   - عرض markdown
   - كتل الأداة (قيد التنفيذ/نجاح/خطأ)
   - عرض الفروق (مضاف/محذوف/سياق)
   - قابلية قراءة شريط الحالة
   - تغييرات حدود مستوى التفكير
   - ألوان حدود وضع bash/python
5. تحقق من كلا الإعدادَين المسبقَين للرموز إذا كانت سمتك تعتمد على عرض/مظهر الرسوم.

## القيود الفعلية والتحفظات

- جميع رموز `colors` مطلوبة للسمات المخصصة.
- `export` و `symbols` اختيارية.
- `$schema` في ملف JSON للسمة معلوماتي فحسب؛ يُفرض التحقق في وقت التشغيل بواسطة مخطط TypeBox المجمَّع في الكود.
- فشل `setTheme` يرجع إلى `dark`؛ فشل `previewTheme` لا يستبدل السمة الحالية.
- أخطاء إعادة تحميل مراقب الملفات تحافظ على السمة المحملة الحالية حتى يتم إعادة التحميل الناجحة أو تشغيل مسار الاحتياطي.
