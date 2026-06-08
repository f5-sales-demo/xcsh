---
title: Secret Obfuscation
description: >-
  Secret obfuscation pipeline that redacts sensitive values from session logs
  and outputs.
sidebar:
  order: 3
  label: الأسرار
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# إخفاء الأسرار

يمنع إرسال القيم الحساسة (مفاتيح API، الرموز المميزة، كلمات المرور) إلى مزودي نماذج LLM. عند التفعيل، يتم استبدال الأسرار بعناصر نائبة حتمية قبل مغادرة العملية، ويتم استعادتها في وسائط استدعاء الأدوات التي يعيدها النموذج.

## التفعيل

مُفعّل افتراضيًا. يمكن التبديل عبر واجهة `/settings` أو مباشرة في `config.yml`:

```yaml
secrets:
  enabled: false
```

## كيف يعمل

1. عند بدء الجلسة، يتم جمع الأسرار من مصدرين:
   - **متغيرات البيئة** التي تطابق أنماط الأسرار الشائعة (`*_KEY`، `*_SECRET`، `*_TOKEN`، `*_PASSWORD`، إلخ) بقيم طولها >= 8 أحرف
   - **ملفات `secrets.yml`** (انظر أدناه)

2. الرسائل الصادرة إلى نموذج LLM يتم استبدال جميع قيم الأسرار فيها بعناصر نائبة مثل `<<$env:S0>>`، `<<$env:S1>>`، إلخ.

3. وسائط استدعاء الأدوات التي يعيدها النموذج يتم المرور عليها بعمق واستعادة العناصر النائبة إلى قيمها الأصلية قبل التنفيذ.

هناك وضعان يتحكمان فيما يحدث لكل سر:

| الوضع | السلوك | قابل للعكس |
|---|---|---|
| `obfuscate` (افتراضي) | يُستبدل بعنصر نائب مفهرس `<<$env:SN>>` | نعم (يُزال الإخفاء في وسائط الأدوات) |
| `replace` | يُستبدل بسلسلة حتمية بنفس الطول | لا (اتجاه واحد) |

## secrets.yml

حدد إدخالات أسرار مخصصة بصيغة YAML. يتم التحقق من موقعين:

| المستوى | المسار | الغرض |
|---|---|---|
| عام | `~/.xcsh/agent/secrets.yml` | أسرار عبر جميع المشاريع |
| المشروع | `<cwd>/.xcsh/secrets.yml` | أسرار خاصة بالمشروع |

إدخالات المشروع تتجاوز الإدخالات العامة ذات المحتوى `content` المطابق.

### المخطط

كل إدخال في المصفوفة يحتوي على هذه الحقول:

| الحقل | النوع | مطلوب | الوصف |
|---|---|---|---|
| `type` | `"plain"` أو `"regex"` | نعم | استراتيجية المطابقة |
| `content` | سلسلة نصية | نعم | قيمة السر (نص عادي) أو نمط التعبير النمطي (regex) |
| `mode` | `"obfuscate"` أو `"replace"` | لا | الافتراضي: `"obfuscate"` |
| `replacement` | سلسلة نصية | لا | بديل مخصص (وضع الاستبدال فقط) |
| `flags` | سلسلة نصية | لا | أعلام التعبير النمطي (نوع regex فقط) |

### أمثلة

#### أسرار نص عادي

```yaml
# Obfuscate a specific API key (default mode)
- type: plain
  content: sk-proj-abc123def456

# Replace a database password with a fixed string
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### أسرار التعبيرات النمطية

```yaml
# Obfuscate any AWS-style key
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive match with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex literal syntax (pattern and flags in one string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

إدخالات التعبيرات النمطية تفحص دائمًا بشكل شامل (يتم فرض علم `g` تلقائيًا). صيغة التعبير النمطي الحرفية `/pattern/flags` مدعومة كبديل لحقلي `content` + `flags` المنفصلين. يتم التعامل مع الشرطات المائلة المهربة داخل النمط (`\\/`) بشكل صحيح.

#### وضع الاستبدال مع التعبيرات النمطية

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## التفاعل مع اكتشاف متغيرات البيئة

يتم جمع متغيرات البيئة أولًا دائمًا. يتم إلحاق الإدخالات المعرّفة في الملفات بعدها، لذا يمكن لإدخالات الملفات تغطية الأسرار التي لا توجد في متغيرات البيئة (ملفات التكوين، القيم المكتوبة مباشرة في الكود، إلخ). إذا ظهرت نفس القيمة في كليهما، فإن وضع إدخال الملف يأخذ الأولوية.

## الملفات الرئيسية

- `src/secrets/index.ts` -- التحميل، الدمج، جمع متغيرات البيئة
- `src/secrets/obfuscator.ts` -- فئة `SecretObfuscator`، توليد العناصر النائبة، إخفاء الرسائل
- `src/secrets/regex.ts` -- تحليل وتجميع التعبيرات النمطية الحرفية
- `src/config/settings-schema.ts` -- تعريف إعداد `secrets.enabled`
