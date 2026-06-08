---
title: Theming Reference
description: >-
  TUI theming reference with color tokens, font settings, and theme
  customization.
sidebar:
  order: 3
  label: Theming
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# مرجع السمات

يصف هذا المستند كيفية عمل نظام السمات في وكيل البرمجة حالياً: المخطط، والتحميل، وسلوك وقت التشغيل، وأوضاع الفشل.

## ما الذي يتحكم فيه نظام السمات

يتحكم نظام السمات في:

- رموز ألوان المقدمة/الخلفية المستخدمة عبر واجهة TUI
- محولات تنسيق markdown (`getMarkdownTheme()`)
- محولات المحدد/المحرر/قائمة الإعدادات (`getSelectListTheme()`، `getEditorTheme()`، `getSettingsListTheme()`)
- إعداد الرموز المسبق + تجاوزات الرموز (`unicode`، `nerd`، `ascii`)
- ألوان تمييز بناء الجملة المستخدمة بواسطة المميز الأصلي (`@f5xc-salesdemos/pi-natives`)
- ألوان أجزاء شريط الحالة

التنفيذ الرئيسي: `src/modes/theme/theme.ts`.

## شكل JSON للسمة

ملفات السمات هي كائنات JSON يتم التحقق من صحتها مقابل مخطط وقت التشغيل في `theme.ts` (`ThemeJsonSchema`) والمنعكسة في `src/modes/theme/theme-schema.json`.

الحقول ذات المستوى الأعلى:

- `name` (مطلوب)
- `colors` (مطلوب؛ جميع رموز الألوان مطلوبة)
- `vars` (اختياري؛ متغيرات ألوان قابلة لإعادة الاستخدام)
- `export` (اختياري؛ ألوان التصدير بتنسيق HTML)
- `symbols` (اختياري)
  - `preset` (اختياري: `unicode | nerd | ascii`)
  - `overrides` (اختياري: تجاوزات مفتاح/قيمة لـ `SymbolKey`)

تقبل قيم الألوان:

- سلسلة ست عشرية (`"#RRGGBB"`)
- فهرس لون 256 (`0..255`)
- سلسلة مرجع متغير (يتم حلها عبر `vars`)
- سلسلة فارغة (`""`) تعني القيمة الافتراضية للطرفية (`\x1b[39m` للمقدمة، `\x1b[49m` للخلفية)

## رموز الألوان المطلوبة (الحالية)

جميع الرموز أدناه مطلوبة في `colors`.

### النص الأساسي والحدود (11)

`accent`، `border`، `borderAccent`، `borderMuted`، `success`، `error`، `warning`، `muted`، `dim`، `text`، `thinkingText`

### كتل الخلفية (7)

`selectedBg`، `userMessageBg`، `customMessageBg`، `toolPendingBg`، `toolSuccessBg`، `toolErrorBg`، `statusLineBg`

### نص الرسائل/الأدوات (5)

`userMessageText`، `customMessageText`، `customMessageLabel`، `toolTitle`، `toolOutput`

### Markdown (10)

`mdHeading`، `mdLink`، `mdLinkUrl`، `mdCode`، `mdCodeBlock`، `mdCodeBlockBorder`، `mdQuote`، `mdQuoteBorder`، `mdHr`، `mdListBullet`

### فروقات الأدوات + تمييز بناء الجملة (12)

`toolDiffAdded`، `toolDiffRemoved`، `toolDiffContext`،
`syntaxComment`، `syntaxKeyword`، `syntaxFunction`، `syntaxVariable`، `syntaxString`، `syntaxNumber`، `syntaxType`، `syntaxOperator`، `syntaxPunctuation`

### حدود الوضع/التفكير (8)

`thinkingOff`، `thinkingMinimal`، `thinkingLow`، `thinkingMedium`، `thinkingHigh`، `thinkingXhigh`، `bashMode`، `pythonMode`

### ألوان أجزاء شريط الحالة (14)

`statusLineSep`، `statusLineModel`، `statusLinePath`، `statusLineGitClean`، `statusLineGitDirty`، `statusLineContext`، `statusLineSpend`، `statusLineStaged`، `statusLineDirty`، `statusLineUntracked`، `statusLineOutput`، `statusLineCost`، `statusLineSubagents`

## الرموز الاختيارية

### قسم `export` (اختياري)

يُستخدم لمساعدات سمات التصدير بتنسيق HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

إذا تم حذفه، يشتق كود التصدير القيم الافتراضية من ألوان السمة المحلولة.

### قسم `symbols` (اختياري)

- `symbols.preset` يعيّن مجموعة رموز افتراضية على مستوى السمة.
- `symbols.overrides` يمكنه تجاوز قيم `SymbolKey` الفردية.

أولوية وقت التشغيل:

1. تجاوز `symbolPreset` في الإعدادات (إذا تم تعيينه)
2. `symbols.preset` في JSON للسمة
3. القيمة الاحتياطية `"unicode"`

يتم تجاهل مفاتيح التجاوز غير الصالحة وتسجيلها (`logger.debug`).

## مصادر السمات المدمجة مقابل المخصصة

ترتيب البحث عن السمات (`loadThemeJson`):

1. السمات المدمجة المضمّنة (`defaults/xcsh-dark.json` و `defaults/xcsh-light.json` المُجمّعة في `defaultThemes`)
2. ملف سمة مخصص: `<customThemesDir>/<name>.json`

يأتي مجلد السمات المخصصة من `getCustomThemesDir()`:

- الافتراضي: `~/.xcsh/agent/themes`
- يُتجاوز بواسطة `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

تُرجع `getAvailableThemes()` أسماء مدمجة + مخصصة مدمجة ومرتبة، مع أولوية السمات المدمجة عند تعارض الأسماء.

## التحميل والتحقق والحل

لملفات السمات المخصصة:

1. قراءة JSON
2. تحليل JSON
3. التحقق مقابل `ThemeJsonSchema`
4. حل مراجع `vars` بشكل تكراري
5. تحويل القيم المحلولة إلى ANSI حسب وضع قدرة الطرفية

سلوك التحقق:

- رموز ألوان مطلوبة مفقودة: رسالة خطأ مجمّعة صريحة
- أنواع/قيم رموز خاطئة: أخطاء تحقق مع مسار JSON
- ملف سمة غير معروف: `Theme not found: <name>`

سلوك مرجع المتغيرات:

- يدعم المراجع المتداخلة
- يطرح خطأ عند مرجع متغير مفقود
- يطرح خطأ عند المراجع الدائرية

## سلوك وضع ألوان الطرفية

كشف وضع الألوان (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` يساوي `dumb` أو `linux` أو فارغ => 256color
- خلاف ذلك => truecolor

سلوك التحويل:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- رقمي -> `38;5` / `48;5` ANSI
- `""` -> إعادة تعيين المقدمة/الخلفية الافتراضية

## سلوك التبديل أثناء التشغيل

### السمة الأولية (`initTheme`)

يقوم `main.ts` بتهيئة السمة مع الإعدادات:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

يستخدم الاختيار التلقائي لفتحة السمة كشف خلفية `COLORFGBG`:

- تحليل فهرس الخلفية من `COLORFGBG`
- `< 8` => فتحة داكنة (`theme.dark`)
- `>= 8` => فتحة فاتحة (`theme.light`)
- فشل التحليل => فتحة داكنة

القيم الافتراضية الحالية من مخطط الإعدادات:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### التبديل الصريح (`setTheme`)

- يحمّل السمة المحددة
- يحدّث كائن `theme` العام المفرد
- يبدأ اختيارياً المراقب
- يُطلق رد نداء `onThemeChange`

عند الفشل:

- يعود إلى السمة المدمجة `dark`
- يُرجع `{ success: false, error }`

### تبديل المعاينة (`previewTheme`)

- يطبّق سمة معاينة مؤقتة على `theme` العام
- **لا** يغيّر الإعدادات المحفوظة بذاته
- يُرجع نجاح/خطأ بدون استبدال احتياطي

تستخدم واجهة الإعدادات هذا للمعاينة المباشرة وتستعيد السمة السابقة عند الإلغاء.

## المراقبون وإعادة التحميل المباشر

عند تمكين المراقب (`setTheme(..., true)` / التهيئة التفاعلية):

- يراقب فقط مسار الملف المخصص `<customThemesDir>/<currentTheme>.json`
- السمات المدمجة لا تُراقب فعلياً
- `change` للملف: يحاول إعادة التحميل (مع تأخير)
- `rename`/حذف للملف: يعود إلى `dark`، ويغلق المراقب

الوضع التلقائي يثبّت أيضاً مستمع `SIGWINCH` ويمكنه إعادة تقييم تعيين فتحة داكنة/فاتحة عند تغيّر حالة الطرفية.

## سلوك وضع عمى الألوان

يغيّر `colorBlindMode` رمزاً واحداً فقط أثناء التشغيل:

- يتم تعديل `toolDiffAdded` بتقنية HSV (يُزاح الأخضر نحو الأزرق)
- يُطبّق التعديل فقط عندما تكون القيمة المحلولة سلسلة ست عشرية

الرموز الأخرى لا تتغير.

## أين يتم حفظ إعدادات السمات

يتم حفظ الإعدادات المتعلقة بالسمات بواسطة `Settings` في ملف تكوين YAML العام:

- المسار: `<agentDir>/config.yml`
- مجلد الوكيل الافتراضي: `~/.xcsh/agent`
- الملف الافتراضي الفعلي: `~/.xcsh/agent/config.yml`

المفاتيح المحفوظة:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

يوجد ترحيل قديم: يتم ترحيل `theme: "name"` المسطح القديم إلى `theme.dark` أو `theme.light` المتداخل بناءً على كشف السطوع.

## إنشاء سمة مخصصة (عملي)

1. أنشئ ملفاً في مجلد السمات المخصصة، مثل `~/.xcsh/agent/themes/my-theme.json`.
2. ضمّن `name`، و `vars` الاختياري، و**جميع** رموز `colors` المطلوبة.
3. ضمّن اختيارياً `symbols` و `export`.
4. حدد السمة في الإعدادات (`Display -> Dark theme` أو `Display -> Light theme`) حسب فتحة الاختيار التلقائي التي تريدها.

هيكل بسيط. كل مفتاح في `colors` مطلوب — مدقق وقت التشغيل
(`additionalProperties: false`) يرفض المفاتيح المفقودة والمفاتيح غير المعروفة على حد سواء.
للاطلاع على التنفيذات المرجعية المُرفقة انظر
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
و [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

يحتوي شريط الحالة على نظامي ألوان متوازيين موثقين في المشكلة #242:

- ألوان النص الست عشرية (`statusLinePath`، `statusLineGitClean`، `statusLineGitDirty`،
  `statusLineStaged`، `statusLineDirty`، `statusLineUntracked`) تتحكم في العرض غير المتعلق بـ powerline.
- فهارس لوحة ألوان 256 (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  تتحكم في تعبئة أجزاء powerline. وهي مستقلة عن المفاتيح الست عشرية أعلاه —
  يجب تعيين كليهما.

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

استخدم سير العمل التالي:

1. ابدأ الوضع التفاعلي (المراقب مُمكّن من بدء التشغيل).
2. افتح الإعدادات ومعاينة قيم السمة (معاينة مباشرة عبر `previewTheme`).
3. لملفات السمات المخصصة، حرّر ملف JSON أثناء التشغيل وتأكد من إعادة التحميل التلقائي عند الحفظ.
4. اختبر الأسطح الحرجة:
   - عرض markdown
   - كتل الأدوات (معلّقة/ناجحة/خطأ)
   - عرض الفروقات (مضاف/محذوف/سياق)
   - قراءة شريط الحالة
   - تغييرات حدود مستوى التفكير
   - ألوان حدود وضع bash/python
5. تحقق من كلا إعدادات الرموز المسبقة إذا كانت سمتك تعتمد على عرض/مظهر الحروف الرسومية.

## القيود والتحذيرات الفعلية

- جميع رموز `colors` مطلوبة للسمات المخصصة.
- `export` و `symbols` اختياريان.
- `$schema` في JSON للسمة معلوماتي فقط؛ التحقق أثناء التشغيل يُفرض بواسطة مخطط TypeBox المُجمّع في الكود.
- فشل `setTheme` يعود إلى `dark`؛ فشل `previewTheme` لا يستبدل السمة الحالية.
- أخطاء إعادة تحميل مراقب الملفات تُبقي السمة المحمّلة حالياً حتى إعادة تحميل ناجحة أو تشغيل مسار احتياطي.
