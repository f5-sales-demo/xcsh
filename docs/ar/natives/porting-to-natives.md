---
title: الترحيل إلى pi-natives (N-API) — ملاحظات ميدانية
description: >-
  ملاحظات ميدانية لترحيل كود child_process وshell في Node.js إلى طبقة N-API
  الأصلية في Rust.
sidebar:
  order: 9
  label: الترحيل إلى pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# الترحيل إلى pi-natives (N-API) — ملاحظات ميدانية

هذا دليل عملي لنقل المسارات الحرجة إلى `crates/pi-natives` وربطها من خلال روابط JS. وُجد هذا الدليل لتجنب تكرار نفس الأخطاء.

## متى يجب الترحيل

قم بالترحيل عندما تكون أي من هذه الحالات صحيحة:

- المسار الحرج يعمل في حلقات العرض، أو تحديثات واجهة المستخدم المتكررة، أو الدفعات الكبيرة.
- تخصيصات JS هي المهيمنة (تكرار السلاسل النصية، التراجع في التعبيرات النمطية، المصفوفات الكبيرة).
- لديك بالفعل خط أساس في JS ويمكنك قياس أداء كلا الإصدارين جنبًا إلى جنب.
- العمل مرتبط بوحدة المعالجة المركزية أو إدخال/إخراج حاجب يمكن تشغيله على مجموعة خيوط libuv.
- العمل هو إدخال/إخراج غير متزامن يمكن تشغيله على وقت تشغيل Tokio (مثل تنفيذ الصدفة).

تجنب الترحيلات التي تعتمد على حالة خاصة بـ JS فقط أو الاستيرادات الديناميكية. يجب أن تكون صادرات N-API صافية، بيانات داخلة/بيانات خارجة. العمل طويل الأمد يجب أن يمر عبر `task::blocking` (مرتبط بوحدة المعالجة المركزية/إدخال وإخراج حاجب) أو `task::future` (إدخال/إخراج غير متزامن) مع إمكانية الإلغاء.

## تشريح تصدير أصلي

**جانب Rust:**

- التنفيذ يوجد في `crates/pi-natives/src/<module>.rs`. إذا أضفت وحدة جديدة، سجّلها في `crates/pi-natives/src/lib.rs`.
- صدّر باستخدام `#[napi]`؛ يتم تحويل الصادرات بصيغة snake_case إلى camelCase تلقائيًا. استخدم `js_name` صريحًا فقط للأسماء المستعارة الحقيقية/الأسماء غير الافتراضية. استخدم `#[napi(object)]` للهياكل.
- استخدم `task::blocking(tag, cancel_token, work)` (انظر `crates/pi-natives/src/task.rs`) للعمل المرتبط بوحدة المعالجة المركزية أو الحاجب. استخدم `task::future(env, tag, work)` للعمل غير المتزامن الذي يحتاج Tokio (مثل جلسات الصدفة). مرّر `CancelToken` عندما تعرض `timeoutMs` أو `AbortSignal`.

**جانب JS:**

- `packages/natives/src/bindings.ts` يحتوي على واجهة `NativeBindings` الأساسية.
- `packages/natives/src/<module>/types.ts` يعرّف أنواع TS ويوسّع `NativeBindings` عبر دمج التصريحات.
- `packages/natives/src/native.ts` يستورد كل ملف `<module>/types.ts` لتفعيل التصريحات.
- `packages/natives/src/<module>/index.ts` يغلّف ربط `native` من `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` يحمّل الإضافة و`validateNative` يفرض الصادرات المطلوبة.
- `packages/natives/src/index.ts` يعيد تصدير المغلّف للمستدعين في `packages/*`.

## قائمة مراجعة الترحيل

1. **أضف تنفيذ Rust**

- ضع المنطق الأساسي في دالة Rust عادية.
- إذا كانت وحدة جديدة، أضفها إلى `crates/pi-natives/src/lib.rs`.
- اعرضها باستخدام `#[napi]` حتى يبقى التحويل الافتراضي من snake_case إلى camelCase متسقًا.
- حافظ على التوقيعات مملوكة وبسيطة: `String`، `Vec<String>`، `Uint8Array`، أو `Either<JsString, Uint8Array>` للمدخلات الكبيرة من السلاسل النصية/البايتات.
- للعمل المرتبط بوحدة المعالجة المركزية أو الحاجب، استخدم `task::blocking`؛ للعمل غير المتزامن، استخدم `task::future`. مرّر `CancelToken` واستدعِ `heartbeat()` داخل الحلقات الطويلة.

2. **اربط روابط JS**

- أضف الأنواع وتوسيع `NativeBindings` في `packages/natives/src/<module>/types.ts`.
- استورد `./<module>/types` في `packages/natives/src/native.ts` لتفعيل دمج التصريحات.
- أضف مغلّفًا في `packages/natives/src/<module>/index.ts` يستدعي `native`.
- أعد التصدير من `packages/natives/src/index.ts`.

3. **حدّث التحقق من الأصلي**

- أضف `checkFn("newExport")` في `validateNative` (`packages/natives/src/native.ts`).

4. **أضف اختبارات الأداء**

- ضع اختبارات الأداء بجوار الحزمة المالكة (`packages/tui/bench`، `packages/natives/bench`، أو `packages/coding-agent/bench`).
- اشمل خط الأساس في JS والنسخة الأصلية في نفس التشغيل.
- استخدم `Bun.nanoseconds()` وعدد تكرارات ثابت.
- حافظ على مدخلات اختبار الأداء صغيرة وواقعية (بيانات فعلية مشاهدة في المسار الحرج).

5. **ابنِ الملف الثنائي الأصلي**

- `bun --cwd=packages/natives run build`
- استخدم `bun --cwd=packages/natives run build` واضبط `PI_DEV=1` إذا أردت تشخيصات المحمّل أثناء الاختبار.

6. **شغّل اختبار الأداء**

- `bun run packages/<pkg>/bench/<bench>.ts` (أو `bun --cwd=packages/natives run bench`)

7. **قرّر بشأن الاستخدام**

- إذا كان الأصلي أبطأ، **أبقِ على JS** واترك التصدير الأصلي غير مستخدم.
- إذا كان الأصلي أسرع، بدّل مواقع الاستدعاء إلى المغلّف الأصلي.

## نقاط الألم وكيفية تجنبها

### 1) ملف `pi_natives.node` القديم يمنع الصادرات الجديدة

يفضّل المحمّل الملف الثنائي الموسوم بالمنصة في `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` الآن يُفعّل تشخيصات المحمّل فقط؛ لم يعد يتحول إلى اسم ملف إضافة تطوير منفصل. يوجد أيضًا ملف احتياطي `pi_natives.node`. الملفات الثنائية المُجمّعة تُستخرج إلى `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. إذا كان أي من هذه قديمًا، فلن تُحدَّث الصادرات.

**الحل:** احذف الملف القديم قبل إعادة البناء.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

إذا كنت تشغّل ملفًا ثنائيًا مُجمّعًا، احذف مجلد الإضافة المُخزّن مؤقتًا:

```bash
rm -rf ~/.xcsh/natives/<version>
```

ثم تحقق من وجود التصدير في الملف الثنائي:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) أخطاء "الصادرات المفقودة" من `validateNative`

هذا **جيد** — يمنع عدم التطابق الصامت. عندما ترى هذا:

```
Native addon missing exports ... Missing: visibleWidth
```

فهذا يعني أن ملفك الثنائي قديم، أو أن اسم تصدير Rust (أو الاسم المستعار الصريح عند استخدامه) لا يتطابق مع اسم JS، أو أن التصدير لم يُجمّع أبدًا. أصلح البناء وعدم تطابق التسمية، لا تُضعف التحقق.

### 3) عدم تطابق توقيع Rust

حافظ على البساطة والملكية. `String`، `Vec<String>`، و`Uint8Array` تعمل. تجنب المراجع مثل `&str` في الصادرات العامة. إذا كنت تحتاج بيانات منظمة، غلّفها في هياكل `#[napi(object)]`.

### 4) أخطاء اختبار الأداء

- لا تقارن مدخلات أو تخصيصات مختلفة.
- حافظ على استخدام JS والأصلي لمصفوفات مدخلات متطابقة.
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

- `validateNative` ينجح (لا صادرات مفقودة).
- `NativeBindings` مُوسَّعة في `packages/natives/src/<module>/types.ts` والمغلّف مُعاد تصديره في `packages/natives/src/index.ts`.
- `Object.keys(require(...))` يتضمن تصديرك الجديد.
- أرقام اختبار الأداء مُسجّلة في طلب السحب/الملاحظات.
- موقع الاستدعاء مُحدَّث **فقط إذا** كان الأصلي أسرع أو مساويًا.

## القاعدة العامة

- إذا كان الأصلي أبطأ، **لا تبدّل**. أبقِ على التصدير للعمل المستقبلي، لكن واجهة المستخدم الطرفية يجب أن تبقى على المسار الأسرع.
- إذا كان الأصلي أسرع، بدّل موقع الاستدعاء وأبقِ على اختبار الأداء في مكانه لاكتشاف التراجعات.
