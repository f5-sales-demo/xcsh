---
title: الأدوات المخصصة
description: تسجيل الأدوات المخصصة وتعريف المخطط وخط أنابيب التنفيذ لتوسيع قدرات العامل.
sidebar:
  order: 4
  label: الأدوات المخصصة
i18n:
  sourceHash: 5f4a441fc2e2
  translator: machine
---

# الأدوات المخصصة

الأدوات المخصصة هي دوال قابلة للاستدعاء بواسطة النموذج، وتندمج في خط أنابيب تنفيذ الأدوات نفسه المستخدم مع الأدوات المدمجة.

الأداة المخصصة هي وحدة TypeScript/JavaScript تُصدِّر مصنعاً (factory). يتلقى المصنع واجهة برمجية للمضيف (`CustomToolAPI`) ويعيد أداة واحدة أو مصفوفة من الأدوات.

## ما هذا (وما ليس كذلك)

- **الأداة المخصصة**: قابلة للاستدعاء بواسطة النموذج خلال الدور (`execute` + مخطط TypeBox).
- **الامتداد**: إطار عمل دورة الحياة/الأحداث الذي يمكنه تسجيل الأدوات واعتراض/تعديل الأحداث.
- **الخطاف (Hook)**: نصوص برمجية خارجية قبل/بعد الأوامر.
- **المهارة (Skill)**: حزمة إرشادات/سياق ثابتة، وليست كوداً تنفيذياً للأداة.

إذا كنت تحتاج إلى أن يستدعي النموذج الكود مباشرةً، فاستخدم أداة مخصصة.

## مسارات التكامل في الكود الحالي

ثمة أسلوبان نشطان للتكامل:

1. **الأدوات المخصصة المقدمة من SDK** (`options.customTools`)
   - تُغلَّف في أدوات العامل عبر `CustomToolAdapter` أو أغلفة الامتداد.
   - تُدرج دائماً في مجموعة الأدوات النشطة الأولية عند تمهيد SDK.

2. **الوحدات المكتشفة من نظام الملفات عبر واجهة المُحمِّل** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - مكشوفة كواجهات برمجية للمكتبة في `src/extensibility/custom-tools/loader.ts`.
   - يمكن لكود المضيف استدعاؤها لاكتشاف وتحميل وحدات الأدوات من مسارات الإعداد/الموفر/الإضافة.

```text
تدفق استدعاء أداة النموذج

استدعاء أداة LLM
   │
   ▼
سجل الأدوات (المدمجة + محولات الأدوات المخصصة)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> نتيجة جزئية متدفقة
   └─ return result  -> محتوى/تفاصيل الأداة النهائية
```

## مواقع الاكتشاف (واجهة المُحمِّل)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` تدمج:

1. موفري القدرات (`toolCapability`)، بما في ذلك:
   - إعداد OMP الأصلي (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - إعداد Claude (`~/.claude/tools`, `.claude/tools`)
   - إعداد Codex (`~/.codex/tools`, `.codex/tools`)
   - موفر ذاكرة التخزين المؤقت لإضافة سوق Claude
2. بيانات تعريف الإضافات المثبتة (`~/.xcsh/plugins/node_modules/*` عبر مُحمِّل الإضافات)
3. المسارات المُعدَّة الصريحة الممررة إلى المُحمِّل

### سلوك مهم

- المسارات المحللة المكررة تُزال تلقائياً.
- تعارضات أسماء الأدوات مرفوضة مقابل الأدوات المدمجة والأدوات المخصصة المحملة مسبقاً.
- ملفات `.md` و`.json` تُكتشف كبيانات تعريف للأدوات من قِبل بعض الموفرين، لكن مُحمِّل الوحدة التنفيذية يرفضها كأدوات قابلة للتشغيل.
- المسارات المُعدَّة النسبية تُحسم من `cwd`؛ ويُوسَّع الرمز `~`.

## عقد الوحدة

يجب أن تُصدِّر وحدة الأداة المخصصة دالة (يُفضَّل التصدير الافتراضي):

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

نوع إرجاع المصنع:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## سطح الواجهة البرمجية الممررة إلى المصانع (`CustomToolAPI`)

من `types.ts` و`loader.ts`:

- `cwd`: دليل عمل المضيف
- `exec(command, args, options?)`: مساعد تنفيذ العمليات
- `ui`: سياق واجهة المستخدم (يمكن أن يكون بدون تأثير في الأوضاع غير الرأسية)
- `hasUI`: `false` في التدفقات غير التفاعلية
- `logger`: مسجِّل الملفات المشترك
- `typebox`: `@sinclair/typebox` المحقون
- `pi`: صادرات `@f5-sales-demo/xcsh` المحقونة
- `pushPendingAction(action)`: تسجيل إجراء معاينة لأداة `resolve` المخفية (`docs/resolve-tool-runtime.md`)

يبدأ المُحمِّل بسياق واجهة مستخدم بدون تأثير، ويتطلب من كود المضيف استدعاء `setUIContext(...)` عند جاهزية واجهة المستخدم الحقيقية.

## عقد التنفيذ والكتابة

توقيع `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` مكتوب بشكل ثابت من مخطط TypeBox الخاص بك عبر `Static<TParams>`.
- التحقق من صحة وسيطات وقت التشغيل يحدث قبل التنفيذ في حلقة العامل.
- `onUpdate` يُصدر نتائج جزئية لبث واجهة المستخدم.
- `ctx` يتضمن حالة الجلسة/النموذج ومساعد `abort()`.
- `signal` يحمل إشارة الإلغاء.

`CustomToolAdapter` يُجسِّر هذا إلى واجهة أداة العامل ويُعيد توجيه الاستدعاءات بالترتيب الصحيح للوسيطات.

## كيفية كشف الأدوات للنموذج

- تُغلَّف الأدوات في مثيلات `AgentTool` (`CustomToolAdapter` أو أغلفة الامتداد).
- تُدرج في سجل أدوات الجلسة حسب الاسم.
- في تمهيد SDK، تُدرج الأدوات المخصصة والمسجلة بواسطة الامتداد إدراجاً إجبارياً في المجموعة النشطة الأولية.
- يتحقق `--tools` في CLI حالياً من أسماء الأدوات المدمجة فقط؛ ويُعالج إدراج الأدوات المخصصة عبر مسارات الاكتشاف/التسجيل وخيارات SDK.

## خطافات التصيير

خطافات التصيير الاختيارية:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

سلوك وقت التشغيل في TUI:

- إذا كانت الخطافات موجودة، يُصيَّر ناتج الأداة داخل حاوية `Box`.
- تتلقى `renderResult` القيمة `{ expanded, isPartial, spinnerFrame? }`.
- أخطاء المُصيِّر تُلتقط وتُسجَّل؛ وتعود واجهة المستخدم إلى التصيير النصي الافتراضي.

## معالجة الجلسة/الحالة

`onSession(event, ctx)` الاختياري يتلقى أحداث دورة حياة الجلسة، بما في ذلك:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

استخدم `ctx.sessionManager` لإعادة بناء الحالة من السجل عند تغيُّر سياق الفرع/الجلسة.

## دلالات الإخفاقات والإلغاء

### الإخفاقات المتزامنة/غير المتزامنة

- الإلقاء (أو الوعود المرفوضة) في `execute` يُعامَل كإخفاق للأداة.
- وقت تشغيل العامل يحول الإخفاقات إلى رسائل نتيجة أداة مع `isError: true` ومحتوى نص الخطأ.
- مع أغلفة الامتداد، يمكن لمعالجات `tool_result` إعادة كتابة المحتوى/التفاصيل وحتى تجاوز حالة الخطأ.

### الإلغاء

- إلغاء العامل يُشاع عبر `AbortSignal` إلى `execute`.
- مرِّر `signal` إلى عمل العمليات الفرعية (`pi.exec(..., { signal })`) للإلغاء التعاوني.
- `ctx.abort()` يسمح لأداة بطلب إلغاء عملية العامل الحالية.

### أخطاء onSession

- أخطاء `onSession` تُلتقط وتُسجَّل كتحذيرات؛ ولا تتسبب في تعطُّل الجلسة.

## القيود الحقيقية التي يجب مراعاتها في التصميم

- يجب أن تكون أسماء الأدوات فريدة عالمياً في السجل النشط.
- فضِّل المخرجات المحددة بالمخطط والحتمية في `details` لإعادة بناء المُصيِّر/الحالة.
- احرص على الحماية عند استخدام واجهة المستخدم مع `pi.hasUI`.
- عامِل ملفات `.md`/`.json` في أدلة الأدوات كبيانات تعريف، وليس وحدات تنفيذية.
