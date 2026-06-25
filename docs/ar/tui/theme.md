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

يصف هذا المستند كيفية عمل نظام السمات في وكيل الترميز اليوم: المخطط، والتحميل، وسلوك وقت التشغيل، وأوضاع الفشل.

## ما يتحكم فيه نظام السمات

يتحكم نظام السمات في:

- رموز ألوان المقدمة/الخلفية المستخدمة عبر TUI
- محوّلات تنسيق markdown (`getMarkdownTheme()`)
- محوّلات المحدد/المحرر/قائمة الإعدادات (`getSelectListTheme()`، `getEditorTheme()`، `getSettingsListTheme()`)
- الإعداد المسبق للرموز + تجاوزات الرموز (`unicode`، `nerd`، `ascii`)
- ألوان تمييز بناء الجملة المستخدمة بواسطة المُمَيِّز الأصلي (`@f5xc-salesdemos/pi-natives`)
- ألوان أجزاء شريط الحالة

التنفيذ الأساسي: `src/modes/theme/theme.ts`.

## شكل ملف JSON للسمة

ملفات السمات هي كائنات JSON يتم التحقق من صحتها مقابل مخطط وقت التشغيل في `theme.ts` (`ThemeJsonSchema`) والمعكوسة بواسطة `src/modes/theme/theme-schema.json`.

الحقول ذات المستوى الأعلى:

- `name` (مطلوب)
- `colors` (مطلوب؛ جميع رموز الألوان مطلوبة)
- `vars` (اختياري؛ متغيرات ألوان قابلة لإعادة الاستخدام)
- `export` (اختياري؛ ألوان تصدير HTML)
- `symbols` (اختياري)
  - `preset` (اختياري: `unicode | nerd | ascii`)
  - `overrides` (اختياري: تجاوزات مفتاح/قيمة لـ `SymbolKey`)

تقبل قيم الألوان:

- سلسلة hex (`"#RRGGBB"`)
- مؤشر 256 لونًا (`0..255`)
- سلسلة مرجع متغير (يتم حلها عبر `vars`)
- سلسلة فارغة (`""`) تعني الإعداد الافتراضي للطرفية (`\x1b[39m` للمقدمة، `\x1b[49m` للخلفية)

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

### فروق الأدوات + تمييز بناء الجملة (12)

`toolDiffAdded`، `toolDiffRemoved`، `toolDiffContext`،
`syntaxComment`، `syntaxKeyword`، `syntaxFunction`، `syntaxVariable`، `syntaxString`، `syntaxNumber`، `syntaxType`، `syntaxOperator`، `syntaxPunctuation`

### حدود الوضع/التفكير (8)

`thinkingOff`، `thinkingMinimal`، `thinkingLow`، `thinkingMedium`، `thinkingHigh`، `thinkingXhigh`، `bashMode`، `pythonMode`

### ألوان أجزاء شريط الحالة (14)

`statusLineSep`، `statusLineModel`، `statusLinePath`، `statusLineGitClean`، `statusLineGitDirty`، `statusLineContext`، `statusLineSpend`، `statusLineStaged`، `statusLineDirty`، `statusLineUntracked`، `statusLineOutput`، `statusLineCost`، `statusLineSubagents`

## الرموز الاختيارية

### قسم `export` (اختياري)

يُستخدم لمساعدات تحديد سمات تصدير HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

إذا تم حذفه، يشتق كود التصدير القيم الافتراضية من ألوان السمة المحلولة.

### قسم `symbols` (اختياري)

- `symbols.preset` يضبط مجموعة الرموز الافتراضية على مستوى السمة.
- `symbols.overrides` يمكنه تجاوز قيم `SymbolKey` الفردية.

أولوية وقت التشغيل:

1. تجاوز الإعدادات `symbolPreset` (إذا تم ضبطه)
2. `symbols.preset` في JSON للسمة
3. الاحتياطي `"unicode"`

يتم تجاهل مفاتيح التجاوز غير الصالحة وتسجيلها (`logger.debug`).

## مصادر السمات المدمجة مقابل المخصصة

ترتيب البحث عن السمات (`loadThemeJson`):

1. السمات المدمجة المضمنة (`defaults/xcsh-dark.json` و `defaults/xcsh-light.json` المترجمة إلى `defaultThemes`)
2. ملف السمة المخصصة: `<customThemesDir>/<name>.json`

يأتي دليل السمات المخصصة من `getCustomThemesDir()`:

- الافتراضي: `~/.xcsh/agent/themes`
- يتم تجاوزه بواسطة `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

تُرجع `getAvailableThemes()` الأسماء المدمجة والمخصصة مدمجةً، مرتبةً، مع أسبقية المدمجة عند تعارض الأسماء.

## التحميل والتحقق والحل

لملفات السمات المخصصة:

1. قراءة JSON
2. تحليل JSON
3. التحقق من الصحة مقابل `ThemeJsonSchema`
4. حل مراجع `vars` بشكل تكراري
5. تحويل القيم المحلولة إلى ANSI حسب وضع قدرة الطرفية

سلوك التحقق:

- رموز الألوان المطلوبة المفقودة: رسالة خطأ مجمعة صريحة
- أنواع/قيم رموز خاطئة: أخطاء تحقق مع مسار JSON
- ملف سمة غير معروف: `Theme not found: <name>`

سلوك مرجع المتغيرات:

- يدعم المراجع المتداخلة
- يُلقي خطأً عند مرجع متغير مفقود
- يُلقي خطأً عند المراجع الدائرية

## سلوك وضع ألوان الطرفية

اكتشاف وضع الألوان (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` في `dumb`، `linux`، أو فارغ => 256color
- وإلا => truecolor

سلوك التحويل:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- رقمي -> `38;5` / `48;5` ANSI
- `""` -> إعادة ضبط fg/bg الافتراضي

## سلوك التبديل في وقت التشغيل

### السمة الأولية (`initTheme`)

تقوم `main.ts` بتهيئة السمة مع الإعدادات:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

يستخدم الاختيار التلقائي لفتحة السمة اكتشاف خلفية `COLORFGBG`:

- تحليل مؤشر الخلفية من `COLORFGBG`
- `< 8` => فتحة داكنة (`theme.dark`)
- `>= 8` => فتحة فاتحة (`theme.light`)
- فشل التحليل => فتحة داكنة

الإعدادات الافتراضية الحالية من مخطط الإعدادات:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### التبديل الصريح (`setTheme`)

- تحميل السمة المحددة
- تحديث المفرد العام `theme`
- بدء المراقب اختياريًا
- تشغيل رد النداء `onThemeChange`

عند الفشل:

- الرجوع إلى السمة `dark` المدمجة
- إرجاع `{ success: false, error }`

### تبديل المعاينة (`previewTheme`)

- تطبيق سمة معاينة مؤقتة على `theme` العام
- **لا** يغير الإعدادات المحفوظة بحد ذاته
- إرجاع النجاح/الخطأ دون استبدال احتياطي

تستخدم واجهة مستخدم الإعدادات هذا للمعاينة المباشرة وتستعيد السمة السابقة عند الإلغاء.

## المراقبون وإعادة التحميل المباشر

عند تمكين المراقب (`setTheme(..., true)` / التهيئة التفاعلية):

- يراقب فقط مسار الملف المخصص `<customThemesDir>/<currentTheme>.json`
- السمات المدمجة لا تُراقب فعليًا
- `change` للملف: محاولة إعادة التحميل (مُؤخرة)
- `rename`/حذف الملف: الرجوع إلى `dark`، إغلاق المراقب

يقوم الوضع التلقائي أيضًا بتثبيت مستمع `SIGWINCH` ويمكنه إعادة تقييم تعيين فتحة داكن/فاتح عند تغير حالة الطرفية.

## سلوك وضع عمى الألوان

يغير `colorBlindMode` رمزًا واحدًا فقط في وقت التشغيل:

- يتم ضبط `toolDiffAdded` باستخدام HSV (تحويل اللون الأخضر نحو الأزرق)
- يُطبَّق الضبط فقط عندما تكون القيمة المحلولة سلسلة hex

الرموز الأخرى لا تتغير.

## مكان حفظ إعدادات السمة

يتم حفظ الإعدادات المتعلقة بالسمة بواسطة `Settings` في ملف YAML للإعداد العام:

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

1. أنشئ ملفًا في دليل السمات المخصصة، مثلًا `~/.xcsh/agent/themes/my-theme.json`.
2. أدرج `name`، وإختياريًا `vars`، و**جميع** رموز `colors` المطلوبة.
3. أدرج اختياريًا `symbols` و `export`.
4. حدد السمة في الإعدادات (`Display -> Dark theme` أو `Display -> Light theme`) بحسب فتحة التحديد التلقائي التي تريدها.

هيكل عظمي أدنى. كل مفتاح في `colors` مطلوب — يرفض المدقق في وقت التشغيل
(`additionalProperties: false`) كلًا من المفاتيح المفقودة والمفاتيح غير المعروفة.
للاطلاع على تطبيقات المرجع المشحونة راجع
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
و [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

يحتوي شريط الحالة على نظامَي ألوان متوازيَين موثقَين في المشكلة #242:

- ألوان النص بصيغة Hex (`statusLinePath`، `statusLineGitClean`، `statusLineGitDirty`،
  `statusLineStaged`، `statusLineDirty`، `statusLineUntracked`) تُشغّل عرض non-powerline.
- مؤشرات لوحة الألوان 256 (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  تُشغّل تعبئات أجزاء powerline. وهي مستقلة عن مفاتيح hex أعلاه —
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
    "statusLineProfileXcshBg": "accent",
    "statusLineProfileXcshFg": 231
  }
}
```

## اختبار السمات المخصصة

استخدم هذه الطريقة:

1. ابدأ الوضع التفاعلي (المراقب مُمكَّن منذ بدء التشغيل).
2. افتح الإعدادات وقم بمعاينة قيم السمة (مباشر `previewTheme`).
3. لملفات السمات المخصصة، قم بتعديل JSON أثناء التشغيل وتأكد من إعادة التحميل التلقائي عند الحفظ.
4. اختبر الأسطح الحيوية:
   - عرض markdown
   - كتل الأدوات (معلق/ناجح/خطأ)
   - عرض الفروق (مضاف/محذوف/سياق)
   - قابلية قراءة شريط الحالة
   - تغييرات حدود مستوى التفكير
   - ألوان حدود وضع bash/python
5. تحقق من صحة كلا الإعدادات المسبقة للرموز إذا كانت سمتك تعتمد على عرض/مظهر الرموز.

## القيود والتحفظات الفعلية

- جميع رموز `colors` مطلوبة للسمات المخصصة.
- `export` و `symbols` اختياريان.
- `$schema` في JSON للسمة إعلامي؛ يُفرض التحقق في وقت التشغيل بواسطة مخطط TypeBox المترجم في الكود.
- فشل `setTheme` يرجع إلى `dark`؛ فشل `previewTheme` لا يستبدل السمة الحالية.
- أخطاء إعادة تحميل مراقب الملف تُبقي السمة المحملة الحالية حتى يتم تشغيل إعادة تحميل ناجحة أو مسار احتياطي.
