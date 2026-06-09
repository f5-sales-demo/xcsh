---
title: النقل إلى pi-natives (N-API) — ملاحظات ميدانية
description: >-
  ملاحظات ميدانية لترحيل كود child_process والصدفة في Node.js إلى طبقة N-API
  الأصلية في Rust.
sidebar:
  order: 9
  label: النقل إلى pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# النقل إلى pi-natives (N-API) — ملاحظات ميدانية

هذا دليل عملي لنقل المسارات الساخنة إلى `crates/pi-natives` وتوصيلها عبر ارتباطات JS. وهو موجود لتجنب تكرار نفس الإخفاقات.

## متى يجب النقل

قم بالنقل عندما يكون أي من هذه الشروط صحيحاً:

- المسار الساخن يعمل في حلقات العرض، أو تحديثات واجهة المستخدم المتكررة، أو الدفعات الكبيرة.
- تخصيصات JS هي المهيمنة (تبديل السلاسل النصية، التراجع في التعبيرات النمطية، المصفوفات الكبيرة).
- لديك بالفعل خط أساس JS ويمكنك قياس أداء كلا الإصدارين جنباً إلى جنب.
- العمل مرتبط بوحدة المعالجة المركزية أو عمليات إدخال/إخراج حاجبة يمكن تشغيلها على مجمع خيوط libuv.
- العمل عبارة عن إدخال/إخراج غير متزامن يمكن تشغيله على بيئة تشغيل Tokio (مثل تنفيذ الصدفة).

تجنب عمليات النقل التي تعتمد على حالة خاصة بـ JS فقط أو الاستيراد الديناميكي. يجب أن تكون صادرات N-API نقية، بيانات داخلة/بيانات خارجة. يجب أن يمر العمل طويل الأمد عبر `task::blocking` (مرتبط بوحدة المعالجة المركزية/إدخال-إخراج حاجب) أو `task::future` (إدخال/إخراج غير متزامن) مع دعم الإلغاء.

## تشريح تصدير أصلي

**جانب Rust:**

- التنفيذ يوجد في `crates/pi-natives/src/<module>.rs`. إذا أضفت وحدة جديدة، سجّلها في `crates/pi-natives/src/lib.rs`.
- قم بالتصدير باستخدام `#[napi]`؛ يتم تحويل صادرات snake_case إلى camelCase تلقائياً. استخدم `js_name` الصريح فقط للأسماء البديلة الحقيقية/الأسماء غير الافتراضية. استخدم `#[napi(object)]` للهياكل.
- استخدم `task::blocking(tag, cancel_token, work)` (انظر `crates/pi-natives/src/task.rs`) للعمل المرتبط بوحدة المعالجة المركزية أو الحاجب. استخدم `task::future(env, tag, work)` للعمل غير المتزامن الذي يحتاج Tokio (مثل جلسات الصدفة). مرر `CancelToken` عندما تكشف `timeoutMs` أو `AbortSignal`.

**جانب JS:**

- `packages/natives/src/bindings.ts` يحتوي على واجهة `NativeBindings` الأساسية.
- `packages/natives/src/<module>/types.ts` يعرّف أنواع TS ويوسّع `NativeBindings` عبر دمج التصريحات.
- `packages/natives/src/native.ts` يستورد كل ملف `<module>/types.ts` لتفعيل التصريحات.
- `packages/natives/src/<module>/index.ts` يغلّف ارتباط `native` من `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` يحمّل الإضافة و `validateNative` يفرض الصادرات المطلوبة.
- `packages/natives/src/index.ts` يعيد تصدير المغلّف للمستدعين في `packages/*`.

## قائمة مراجعة النقل

1. **أضف تنفيذ Rust**

- ضع المنطق الأساسي في دالة Rust عادية.
- إذا كانت وحدة جديدة، أضفها إلى `crates/pi-natives/src/lib.rs`.
- اكشفها باستخدام `#[napi]` بحيث يبقى التحويل الافتراضي من snake_case إلى camelCase متسقاً.
- حافظ على التوقيعات مملوكة وبسيطة: `String`، `Vec<String>`، `Uint8Array`، أو `Either<JsString, Uint8Array>` للمدخلات الكبيرة من السلاسل النصية/البايتات.
- للعمل المرتبط بوحدة المعالجة المركزية أو الحاجب، استخدم `task::blocking`؛ للعمل غير المتزامن، استخدم `task::future`. مرر `CancelToken` واستدعِ `heartbeat()` داخل الحلقات الطويلة.

2. **وصّل ارتباطات JS**

- أضف الأنواع وتوسيع `NativeBindings` في `packages/natives/src/<module>/types.ts`.
- استورد `./<module>/types` في `packages/natives/src/native.ts` لتفعيل دمج التصريحات.
- أضف مغلّفاً في `packages/natives/src/<module>/index.ts` يستدعي `native`.
- أعد التصدير من `packages/natives/src/index.ts`.

3. **حدّث التحقق من الصادرات الأصلية**

- أضف `checkFn("newExport")` في `validateNative` (`packages/natives/src/native.ts`).

4. **أضف اختبارات الأداء**

- ضع اختبارات الأداء بجوار الحزمة المالكة (`packages/tui/bench`، `packages/natives/bench`، أو `packages/coding-agent/bench`).
- اشمل خط أساس JS والنسخة الأصلية في نفس التشغيل.
- استخدم `Bun.nanoseconds()` وعدد تكرارات ثابت.
- حافظ على مدخلات اختبار الأداء صغيرة وواقعية (بيانات فعلية مشاهدة في المسار الساخن).

5. **ابنِ الملف الثنائي الأصلي**

- `bun --cwd=packages/natives run build`
- استخدم `bun --cwd=packages/natives run build` واضبط `PI_DEV=1` إذا أردت تشخيصات المُحمّل أثناء الاختبار.

6. **شغّل اختبار الأداء**

- `bun run packages/<pkg>/bench/<bench>.ts` (أو `bun --cwd=packages/natives run bench`)

7. **قرر بشأن الاستخدام**

- إذا كانت النسخة الأصلية أبطأ، **أبقِ على JS** واترك التصدير الأصلي غير مستخدم.
- إذا كانت النسخة الأصلية أسرع، انقل مواقع الاستدعاء إلى المغلّف الأصلي.

## نقاط الألم وكيفية تجنبها

### 1) ملف `pi_natives.node` القديم يمنع الصادرات الجديدة

يفضّل المُحمّل الملف الثنائي الموسوم بالمنصة في `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` الآن يفعّل تشخيصات المُحمّل فقط؛ لم يعد ينتقل إلى اسم ملف إضافة تطوير منفصل. هناك أيضاً ملف احتياطي `pi_natives.node`. تُستخرج الملفات الثنائية المُجمّعة إلى `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. إذا كان أي من هذه الملفات قديماً، فلن تُحدّث الصادرات.

**الإصلاح:** احذف الملف القديم قبل إعادة البناء.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

إذا كنت تشغّل ملفاً ثنائياً مُجمّعاً، احذف مجلد الإضافة المخزّن مؤقتاً:

```bash
rm -rf ~/.xcsh/natives/<version>
```

ثم تحقق من وجود التصدير في الملف الثنائي:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) أخطاء "صادرات مفقودة" من `validateNative`

هذا **أمر جيد** — فهو يمنع عدم التطابق الصامت. عندما ترى هذا:

```
Native addon missing exports ... Missing: visibleWidth
```

فهذا يعني أن ملفك الثنائي قديم، أو أن اسم تصدير Rust (أو الاسم البديل الصريح عند استخدامه) لا يتطابق مع اسم JS، أو أن التصدير لم يُجمّع من الأساس. أصلح البناء وعدم تطابق الأسماء، لا تُضعف التحقق.

### 3) عدم تطابق توقيع Rust

حافظ على البساطة والملكية. `String`، `Vec<String>`، و `Uint8Array` تعمل. تجنب المراجع مثل `&str` في الصادرات العامة. إذا كنت بحاجة إلى بيانات منظمة، غلّفها في هياكل `#[napi(object)]`.

### 4) أخطاء قياس الأداء

- لا تقارن مدخلات أو تخصيصات مختلفة.
- حافظ على استخدام JS والنسخة الأصلية لنفس مصفوفات المدخلات.
- شغّل كليهما في نفس ملف اختبار الأداء لتجنب الانحراف.

## قالب اختبار الأداء

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## قائمة مراجعة التحقق

- `validateNative` يمرّ بنجاح (لا صادرات مفقودة).
- `NativeBindings` موسّعة في `packages/natives/src/<module>/types.ts` والمغلّف معاد تصديره في `packages/natives/src/index.ts`.
- `Object.keys(require(...))` يتضمن تصديرك الجديد.
- أرقام اختبار الأداء مسجّلة في طلب الدمج/الملاحظات.
- موقع الاستدعاء محدّث **فقط إذا** كانت النسخة الأصلية أسرع أو مساوية.

## قاعدة عامة

- إذا كانت النسخة الأصلية أبطأ، **لا تنتقل**. أبقِ التصدير للعمل المستقبلي، لكن واجهة المستخدم الطرفية يجب أن تبقى على المسار الأسرع.
- إذا كانت النسخة الأصلية أسرع، انقل موقع الاستدعاء وأبقِ اختبار الأداء في مكانه لالتقاط التراجعات.
