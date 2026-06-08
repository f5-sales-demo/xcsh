---
title: Porting to pi-natives (N-API) — Field Notes
description: >-
  Field notes for migrating Node.js child_process and shell code to the Rust
  N-API native layer.
sidebar:
  order: 9
  label: الترحيل إلى pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# الترحيل إلى pi-natives (N-API) — ملاحظات ميدانية

هذا دليل عملي لنقل المسارات الساخنة إلى `crates/pi-natives` وربطها من خلال واجهات JS. الهدف منه تجنب تكرار نفس الأخطاء.

## متى يجب الترحيل

قم بالترحيل عندما تكون أي من هذه الحالات صحيحة:

- المسار الساخن يعمل في حلقات العرض، أو تحديثات واجهة المستخدم المكثفة، أو الدفعات الكبيرة.
- تخصيصات JS هي المهيمنة (تكرار السلاسل النصية، التراجع في التعبيرات النمطية، المصفوفات الكبيرة).
- لديك بالفعل خط أساسي بـ JS ويمكنك قياس أداء كلا الإصدارين جنباً إلى جنب.
- العمل مرتبط بوحدة المعالجة المركزية أو إدخال/إخراج حاجب يمكن تشغيله على مجموعة خيوط libuv.
- العمل هو إدخال/إخراج غير متزامن يمكن تشغيله على بيئة تشغيل Tokio (مثل تنفيذ الأوامر في الطرفية).

تجنب الترحيلات التي تعتمد على حالة خاصة بـ JS فقط أو الاستيرادات الديناميكية. يجب أن تكون صادرات N-API صرفة، بيانات-داخلة/بيانات-خارجة. العمل طويل المدى يجب أن يمر عبر `task::blocking` (المرتبط بوحدة المعالجة/الإدخال-الإخراج الحاجب) أو `task::future` (الإدخال-الإخراج غير المتزامن) مع دعم الإلغاء.

## تشريح صادرة أصلية

**جانب Rust:**

- التنفيذ يوجد في `crates/pi-natives/src/<module>.rs`. إذا أضفت وحدة جديدة، سجّلها في `crates/pi-natives/src/lib.rs`.
- استخدم التصدير بـ `#[napi]`؛ يتم تحويل صادرات snake_case إلى camelCase تلقائياً. استخدم `js_name` الصريح فقط للأسماء المستعارة الحقيقية/الأسماء غير الافتراضية. استخدم `#[napi(object)]` للهياكل.
- استخدم `task::blocking(tag, cancel_token, work)` (انظر `crates/pi-natives/src/task.rs`) للعمل المرتبط بوحدة المعالجة أو الحاجب. استخدم `task::future(env, tag, work)` للعمل غير المتزامن الذي يحتاج Tokio (مثل جلسات الطرفية). مرّر `CancelToken` عندما تُعرض `timeoutMs` أو `AbortSignal`.

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
- اعرضها بـ `#[napi]` حتى يبقى التعيين الافتراضي snake_case -> camelCase متسقاً.
- اجعل التوقيعات مملوكة وبسيطة: `String`، `Vec<String>`، `Uint8Array`، أو `Either<JsString, Uint8Array>` للمدخلات النصية/البايتية الكبيرة.
- للعمل المرتبط بوحدة المعالجة أو الحاجب، استخدم `task::blocking`؛ للعمل غير المتزامن، استخدم `task::future`. مرّر `CancelToken` واستدعِ `heartbeat()` داخل الحلقات الطويلة.

2. **اربط واجهات JS**

- أضف الأنواع وتوسعة `NativeBindings` في `packages/natives/src/<module>/types.ts`.
- استورد `./<module>/types` في `packages/natives/src/native.ts` لتفعيل دمج التصريحات.
- أضف مغلّفاً في `packages/natives/src/<module>/index.ts` يستدعي `native`.
- أعد التصدير من `packages/natives/src/index.ts`.

3. **حدّث التحقق من الأصلي**

- أضف `checkFn("newExport")` في `validateNative` (`packages/natives/src/native.ts`).

4. **أضف اختبارات الأداء**

- ضع اختبارات الأداء بجانب الحزمة المالكة (`packages/tui/bench`، `packages/natives/bench`، أو `packages/coding-agent/bench`).
- قم بتضمين خط أساسي JS والإصدار الأصلي في نفس التشغيل.
- استخدم `Bun.nanoseconds()` وعدد تكرارات ثابت.
- اجعل مدخلات اختبار الأداء صغيرة وواقعية (بيانات فعلية مرئية في المسار الساخن).

5. **ابنِ الملف الثنائي الأصلي**

- `bun --cwd=packages/natives run build`
- استخدم `bun --cwd=packages/natives run build` واضبط `PI_DEV=1` إذا أردت تشخيصات المُحمّل أثناء الاختبار.

6. **شغّل اختبار الأداء**

- `bun run packages/<pkg>/bench/<bench>.ts` (أو `bun --cwd=packages/natives run bench`)

7. **قرّر بشأن الاستخدام**

- إذا كان الأصلي أبطأ، **أبقِ على JS** واترك الصادرة الأصلية غير مستخدمة.
- إذا كان الأصلي أسرع، انتقل إلى المغلّف الأصلي في مواقع الاستدعاء.

## نقاط الألم وكيفية تجنبها

### 1) ملف `pi_natives.node` القديم يمنع الصادرات الجديدة

يفضّل المُحمّل الملف الثنائي المُوسوم بالمنصة في `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` الآن يفعّل تشخيصات المُحمّل فقط؛ لم يعد يتحول إلى اسم ملف إضافة تطوير منفصل. يوجد أيضاً ملف احتياطي `pi_natives.node`. الملفات الثنائية المُجمّعة تُستخرج إلى `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. إذا كان أي منها قديماً، فلن تتحدث الصادرات.

**الإصلاح:** احذف الملف القديم قبل إعادة البناء.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

إذا كنت تشغّل ملفاً ثنائياً مُجمّعاً، احذف مجلد الإضافة المُخزّن مؤقتاً:

```bash
rm -rf ~/.xcsh/natives/<version>
```

ثم تحقق من وجود الصادرة في الملف الثنائي:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) أخطاء "صادرات مفقودة" من `validateNative`

هذا **أمر جيد** — فهو يمنع عدم التطابق الصامت. عندما ترى هذا:

```
Native addon missing exports ... Missing: visibleWidth
```

يعني أن ملفك الثنائي قديم، أو أن اسم صادرة Rust (أو الاسم المستعار الصريح عند استخدامه) لا يطابق اسم JS، أو أن الصادرة لم تُجمّع أبداً. أصلح البناء وعدم تطابق الأسماء، ولا تُضعف التحقق.

### 3) عدم تطابق توقيع Rust

اجعله بسيطاً ومملوكاً. `String`، `Vec<String>`، و`Uint8Array` تعمل. تجنب المراجع مثل `&str` في الصادرات العامة. إذا كنت تحتاج بيانات مُهيكلة، غلّفها في هياكل `#[napi(object)]`.

### 4) أخطاء اختبار الأداء

- لا تقارن مدخلات أو تخصيصات مختلفة.
- اجعل JS والأصلي يستخدمان مصفوفات مدخلات متطابقة.
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

- `validateNative` يمر بنجاح (بدون صادرات مفقودة).
- `NativeBindings` موسّع في `packages/natives/src/<module>/types.ts` والمغلّف مُعاد تصديره في `packages/natives/src/index.ts`.
- `Object.keys(require(...))` يتضمن صادرتك الجديدة.
- أرقام اختبار الأداء مسجلة في طلب السحب/الملاحظات.
- موقع الاستدعاء محدّث **فقط إذا** كان الأصلي أسرع أو مساوياً.

## القاعدة العامة

- إذا كان الأصلي أبطأ، **لا تنتقل**. أبقِ الصادرة للعمل المستقبلي، لكن واجهة TUI يجب أن تبقى على المسار الأسرع.
- إذا كان الأصلي أسرع، انتقل إلى موقع الاستدعاء الأصلي وأبقِ اختبار الأداء في مكانه لرصد التراجعات.
