---
title: Porting to pi-natives (N-API) — Field Notes
description: >-
  บันทึกภาคสนามสำหรับการย้าย child_process และโค้ด shell ของ Node.js
  ไปยังเลเยอร์ native ของ Rust N-API
sidebar:
  order: 9
  label: Porting to pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Porting to pi-natives (N-API) — บันทึกภาคสนาม

นี่คือคู่มือเชิงปฏิบัติสำหรับการย้าย hot path เข้าไปใน `crates/pi-natives` และเชื่อมต่อผ่าน JS bindings เอกสารนี้มีไว้เพื่อหลีกเลี่ยงความผิดพลาดเดิมไม่ให้เกิดขึ้นซ้ำ

## เมื่อไรควรย้าย

ให้ทำการย้ายเมื่อข้อใดข้อหนึ่งต่อไปนี้เป็นจริง:

- Hot path ทำงานใน render loop, การอัปเดต UI แบบถี่ หรือการประมวลผลแบบ batch ขนาดใหญ่
- การจัดสรรหน่วยความจำของ JS มีปริมาณมาก (string churn, regex backtracking, array ขนาดใหญ่)
- คุณมี JS baseline อยู่แล้วและสามารถทำ benchmark เปรียบเทียบทั้งสองเวอร์ชันพร้อมกันได้
- งานเป็นแบบ CPU-bound หรือ blocking I/O ที่สามารถทำงานบน libuv thread pool ได้
- งานเป็นแบบ async I/O ที่สามารถทำงานบน Tokio runtime ได้ (เช่น shell execution)

หลีกเลี่ยงการย้ายที่ต้องพึ่งพา JS-only state หรือ dynamic imports N-API exports ควรเป็นแบบ pure, data-in/data-out งานที่ทำงานนานควรผ่าน `task::blocking` (CPU-bound/blocking I/O) หรือ `task::future` (async I/O) พร้อมการยกเลิก (cancellation)

## โครงสร้างของ native export

**ฝั่ง Rust:**

- Implementation อยู่ใน `crates/pi-natives/src/<module>.rs` หากคุณเพิ่มโมดูลใหม่ ให้ลงทะเบียนใน `crates/pi-natives/src/lib.rs`
- Export ด้วย `#[napi]`; export แบบ snake_case จะถูกแปลงเป็น camelCase โดยอัตโนมัติ ใช้ `js_name` แบบ explicit เฉพาะเมื่อต้องการ alias จริงๆ หรือชื่อที่ไม่ใช่ค่าเริ่มต้น ใช้ `#[napi(object)]` สำหรับ struct
- ใช้ `task::blocking(tag, cancel_token, work)` (ดู `crates/pi-natives/src/task.rs`) สำหรับงาน CPU-bound หรือ blocking ใช้ `task::future(env, tag, work)` สำหรับงาน async ที่ต้องการ Tokio (เช่น shell sessions) ส่ง `CancelToken` เมื่อคุณเปิดใช้ `timeoutMs` หรือ `AbortSignal`

**ฝั่ง JS:**

- `packages/natives/src/bindings.ts` เก็บ interface `NativeBindings` หลัก
- `packages/natives/src/<module>/types.ts` กำหนด TS types และเพิ่มเติม `NativeBindings` ผ่าน declaration merging
- `packages/natives/src/native.ts` import แต่ละไฟล์ `<module>/types.ts` เพื่อเปิดใช้งาน declarations
- `packages/natives/src/<module>/index.ts` ห่อ `native` binding จาก `packages/natives/src/native.ts`
- `packages/natives/src/native.ts` โหลด addon และ `validateNative` บังคับ exports ที่จำเป็น
- `packages/natives/src/index.ts` re-export wrapper สำหรับ caller ใน `packages/*`

## รายการตรวจสอบสำหรับการย้าย

1. **เพิ่ม Rust implementation**

- วางตรรกะหลักใน Rust function ธรรมดา
- หากเป็นโมดูลใหม่ ให้เพิ่มใน `crates/pi-natives/src/lib.rs`
- Expose ด้วย `#[napi]` เพื่อให้การแมป snake_case -> camelCase เริ่มต้นมีความสอดคล้อง
- ให้ signature เป็นแบบ owned และเรียบง่าย: `String`, `Vec<String>`, `Uint8Array` หรือ `Either<JsString, Uint8Array>` สำหรับ input ที่เป็น string/byte ขนาดใหญ่
- สำหรับงาน CPU-bound หรือ blocking ใช้ `task::blocking`; สำหรับงาน async ใช้ `task::future` ส่ง `CancelToken` และเรียก `heartbeat()` ภายใน loop ที่ยาว

2. **เชื่อมต่อ JS bindings**

- เพิ่ม types และ `NativeBindings` augmentation ใน `packages/natives/src/<module>/types.ts`
- Import `./<module>/types` ใน `packages/natives/src/native.ts` เพื่อเรียกใช้ declaration merging
- เพิ่ม wrapper ใน `packages/natives/src/<module>/index.ts` ที่เรียก `native`
- Re-export จาก `packages/natives/src/index.ts`

3. **อัปเดต native validation**

- เพิ่ม `checkFn("newExport")` ใน `validateNative` (`packages/natives/src/native.ts`)

4. **เพิ่ม benchmarks**

- วาง benchmarks ไว้ข้างๆ package ที่เป็นเจ้าของ (`packages/tui/bench`, `packages/natives/bench` หรือ `packages/coding-agent/bench`)
- รวม JS baseline และ native version ไว้ใน run เดียวกัน
- ใช้ `Bun.nanoseconds()` และจำนวน iteration คงที่
- ให้ benchmark inputs มีขนาดเล็กและสมจริง (ข้อมูลจริงที่พบใน hot path)

5. **Build native binary**

- `bun --cwd=packages/natives run build`
- ใช้ `bun --cwd=packages/natives run build` และตั้ง `PI_DEV=1` หากคุณต้องการ loader diagnostics ระหว่างการทดสอบ

6. **รัน benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (หรือ `bun --cwd=packages/natives run bench`)

7. **ตัดสินใจเรื่องการใช้งาน**

- หาก native ช้ากว่า **ให้ใช้ JS ต่อไป** และปล่อย native export ไว้โดยไม่ใช้
- หาก native เร็วกว่า ให้เปลี่ยน call site ไปใช้ native wrapper

## จุดที่เป็นปัญหาและวิธีหลีกเลี่ยง

### 1) `pi_natives.node` ที่ล้าสมัยทำให้ export ใหม่ไม่ปรากฏ

Loader จะเลือกใช้ binary ที่มี platform tag ใน `packages/natives/native` (`pi_natives.<platform>-<arch>.node`) ก่อน `PI_DEV=1` ตอนนี้เปิดเฉพาะ loader diagnostics เท่านั้น; ไม่ได้เปลี่ยนไปใช้ชื่อไฟล์ addon สำหรับ dev แยกต่างหากอีกต่อไป นอกจากนี้ยังมี fallback `pi_natives.node` Binary ที่คอมไพล์แล้วจะถูกแตกไฟล์ไปที่ `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` หากไฟล์ใดเหล่านี้ล้าสมัย exports จะไม่อัปเดต

**แก้ไข:** ลบไฟล์ที่ล้าสมัยก่อน rebuild

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

หากคุณกำลังรัน compiled binary ให้ลบไดเรกทอรี addon ที่ cache ไว้:

```bash
rm -rf ~/.xcsh/natives/<version>
```

จากนั้นตรวจสอบว่า export มีอยู่ใน binary:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) ข้อผิดพลาด "Missing exports" จาก `validateNative`

นี่เป็นสิ่ง**ดี** — มันป้องกันความไม่ตรงกันแบบเงียบๆ เมื่อคุณเห็นข้อความนี้:

```
Native addon missing exports ... Missing: visibleWidth
```

หมายความว่า binary ของคุณล้าสมัย, ชื่อ Rust export (หรือ alias แบบ explicit เมื่อใช้) ไม่ตรงกับชื่อ JS หรือ export ไม่ได้ถูกคอมไพล์เข้ามา ให้แก้ไข build และความไม่ตรงกันของชื่อ อย่าลดความเข้มงวดของ validation

### 3) Rust signature ไม่ตรงกัน

ให้ทำอย่างเรียบง่ายและเป็น owned `String`, `Vec<String>` และ `Uint8Array` ใช้ได้ หลีกเลี่ยง references เช่น `&str` ใน public exports หากคุณต้องการข้อมูลแบบมีโครงสร้าง ให้ห่อด้วย `#[napi(object)]` structs

### 4) ข้อผิดพลาดในการ benchmarking

- อย่าเปรียบเทียบ input หรือการจัดสรรหน่วยความจำที่ต่างกัน
- ให้ JS และ native ใช้ input array ที่เหมือนกัน
- รันทั้งสองในไฟล์ benchmark เดียวกันเพื่อหลีกเลี่ยงความเบี่ยงเบน

## เทมเพลต Benchmark

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

## รายการตรวจสอบยืนยัน

- `validateNative` ผ่าน (ไม่มี missing exports)
- `NativeBindings` ถูกเพิ่มเติมใน `packages/natives/src/<module>/types.ts` และ wrapper ถูก re-export ใน `packages/natives/src/index.ts`
- `Object.keys(require(...))` รวม export ใหม่ของคุณ
- ตัวเลข bench ถูกบันทึกใน PR/notes
- Call site ถูกอัปเดต **เฉพาะเมื่อ** native เร็วกว่าหรือเท่ากัน

## หลักทั่วไป

- หาก native ช้ากว่า **อย่าเปลี่ยน** ให้เก็บ export ไว้สำหรับงานในอนาคต แต่ TUI ควรอยู่บน path ที่เร็วกว่า
- หาก native เร็วกว่า ให้เปลี่ยน call site และเก็บ benchmark ไว้เพื่อตรวจจับ regression
