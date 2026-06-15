---
title: การพอร์ตไปยัง pi-natives (N-API) — บันทึกภาคสนาม
description: >-
  บันทึกภาคสนามสำหรับการย้าย Node.js child_process และโค้ด shell ไปยังเลเยอร์
  native N-API ของ Rust
sidebar:
  order: 9
  label: การพอร์ตไปยัง pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# การพอร์ตไปยัง pi-natives (N-API) — บันทึกภาคสนาม

นี่คือคู่มือปฏิบัติสำหรับการย้าย hot paths เข้าสู่ `crates/pi-natives` และเชื่อมต่อผ่าน JS bindings มีอยู่เพื่อป้องกันไม่ให้ความผิดพลาดเดิมเกิดขึ้นซ้ำสอง

## เมื่อใดควรพอร์ต

ให้พอร์ตเมื่อเป็นไปตามเงื่อนไขใดเงื่อนไขหนึ่งต่อไปนี้:

- hot path ทำงานใน render loops, การอัปเดต UI ที่หนาแน่น หรือ batch ขนาดใหญ่
- JS allocations ครอบงำ (string churn, regex backtracking, อาร์เรย์ขนาดใหญ่)
- คุณมี JS baseline อยู่แล้วและสามารถ benchmark ทั้งสองเวอร์ชันควบคู่กันได้
- งานผูกกับ CPU หรือเป็น blocking I/O ที่สามารถรันบน libuv thread pool ได้
- งานเป็น async I/O ที่สามารถรันบน Tokio's runtime ได้ (เช่น การรัน shell)

หลีกเลี่ยงการพอร์ตที่ขึ้นอยู่กับ JS-only state หรือ dynamic imports N-API exports ควรเป็น pure, data-in/data-out งานที่ใช้เวลานานควรผ่าน `task::blocking` (CPU-bound/blocking I/O) หรือ `task::future` (async I/O) พร้อมการยกเลิก

## โครงสร้างของ native export

**ฝั่ง Rust:**

- การ implementation อยู่ใน `crates/pi-natives/src/<module>.rs` หากคุณเพิ่ม module ใหม่ ให้ลงทะเบียนใน `crates/pi-natives/src/lib.rs`
- Export ด้วย `#[napi]`; snake_case exports จะถูกแปลงเป็น camelCase โดยอัตโนมัติ ใช้ `js_name` อย่างชัดเจนเฉพาะสำหรับ aliases/ชื่อที่ไม่ใช่ค่าเริ่มต้นเท่านั้น ใช้ `#[napi(object)]` สำหรับ structs
- ใช้ `task::blocking(tag, cancel_token, work)` (ดู `crates/pi-natives/src/task.rs`) สำหรับงาน CPU-bound หรือ blocking ใช้ `task::future(env, tag, work)` สำหรับงาน async ที่ต้องการ Tokio (เช่น shell sessions) ส่ง `CancelToken` เมื่อคุณเปิดเผย `timeoutMs` หรือ `AbortSignal`

**ฝั่ง JS:**

- `packages/natives/src/bindings.ts` เก็บ interface `NativeBindings` พื้นฐาน
- `packages/natives/src/<module>/types.ts` กำหนด TS types และเพิ่มเติม `NativeBindings` ผ่าน declaration merging
- `packages/natives/src/native.ts` import ไฟล์ `<module>/types.ts` แต่ละไฟล์เพื่อเปิดใช้งาน declarations
- `packages/natives/src/<module>/index.ts` ห่อหุ้ม `native` binding จาก `packages/natives/src/native.ts`
- `packages/natives/src/native.ts` โหลด addon และ `validateNative` บังคับใช้ exports ที่จำเป็น
- `packages/natives/src/index.ts` re-export wrapper สำหรับ callers ใน `packages/*`

## รายการตรวจสอบการพอร์ต

1. **เพิ่ม Rust implementation**

- วาง core logic ในฟังก์ชัน Rust ธรรมดา
- หากเป็น module ใหม่ ให้เพิ่มใน `crates/pi-natives/src/lib.rs`
- เปิดเผยด้วย `#[napi]` เพื่อให้การ mapping snake_case -> camelCase เริ่มต้นสอดคล้องกัน
- รักษา signatures ให้เป็น owned และเรียบง่าย: `String`, `Vec<String>`, `Uint8Array`, หรือ `Either<JsString, Uint8Array>` สำหรับ input string/byte ขนาดใหญ่
- สำหรับงาน CPU-bound หรือ blocking ให้ใช้ `task::blocking`; สำหรับงาน async ให้ใช้ `task::future` ส่ง `CancelToken` และเรียก `heartbeat()` ภายใน loop ที่ใช้เวลานาน

2. **เชื่อมต่อ JS bindings**

- เพิ่ม types และ `NativeBindings` augmentation ใน `packages/natives/src/<module>/types.ts`
- Import `./<module>/types` ใน `packages/natives/src/native.ts` เพื่อเรียกใช้ declaration merging
- เพิ่ม wrapper ใน `packages/natives/src/<module>/index.ts` ที่เรียก `native`
- Re-export จาก `packages/natives/src/index.ts`

3. **อัปเดต native validation**

- เพิ่ม `checkFn("newExport")` ใน `validateNative` (`packages/natives/src/native.ts`)

4. **เพิ่ม benchmarks**

- วาง benchmarks ไว้ข้างๆ package ที่เป็นเจ้าของ (`packages/tui/bench`, `packages/natives/bench`, หรือ `packages/coding-agent/bench`)
- รวม JS baseline และเวอร์ชัน native ในการรันเดียวกัน
- ใช้ `Bun.nanoseconds()` และจำนวน iteration ที่กำหนด
- รักษา benchmark inputs ให้เล็กและสมจริง (ข้อมูลจริงที่พบใน hot path)

5. **Build native binary**

- `bun --cwd=packages/natives run build`
- ใช้ `bun --cwd=packages/natives run build` และตั้งค่า `PI_DEV=1` หากต้องการ loader diagnostics ขณะทดสอบ

6. **รัน benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (หรือ `bun --cwd=packages/natives run bench`)

7. **ตัดสินใจเรื่องการใช้งาน**

- หาก native ช้ากว่า **ให้คง JS ไว้** และปล่อย native export ไว้โดยไม่ใช้งาน
- หาก native เร็วกว่า ให้เปลี่ยน call sites ไปใช้ native wrapper

## จุดเจ็บปวดและวิธีหลีกเลี่ยง

### 1) `pi_natives.node` ที่ล้าสมัยป้องกัน exports ใหม่

loader ให้ความสำคัญกับ binary ที่มีแท็กแพลตฟอร์มใน `packages/natives/native` (`pi_natives.<platform>-<arch>.node`) ตอนนี้ `PI_DEV=1` เปิดใช้งานเฉพาะ loader diagnostics เท่านั้น ไม่เปลี่ยนไปใช้ชื่อไฟล์ dev addon แยกต่างหากอีกต่อไป นอกจากนี้ยังมี fallback `pi_natives.node` Compiled binaries จะแตกไฟล์ไปยัง `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` หากไฟล์เหล่านี้ล้าสมัย exports จะไม่อัปเดต

**แก้ไข:** ลบไฟล์ที่ล้าสมัยก่อน rebuild

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

หากคุณกำลังรัน compiled binary ให้ลบ cached addon directory:

```bash
rm -rf ~/.xcsh/natives/<version>
```

จากนั้นตรวจสอบว่า export มีอยู่ใน binary:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) ข้อผิดพลาด "Missing exports" จาก `validateNative`

นี่เป็นสิ่งที่ **ดี** — มันป้องกันความไม่ตรงกันที่ไม่มีเสียง เมื่อคุณเห็นสิ่งนี้:

```
Native addon missing exports ... Missing: visibleWidth
```

หมายความว่า binary ของคุณล้าสมัย, ชื่อ Rust export (หรือ explicit alias เมื่อใช้งาน) ไม่ตรงกับชื่อ JS, หรือ export ไม่ได้ compile เข้ามา แก้ไข build และความไม่ตรงกันของการตั้งชื่อ อย่าทำ validation อ่อนแอลง

### 3) Rust signature ไม่ตรงกัน

รักษาให้เรียบง่ายและ owned `String`, `Vec<String>`, และ `Uint8Array` ใช้งานได้ หลีกเลี่ยง references อย่าง `&str` ใน public exports หากต้องการข้อมูลที่มีโครงสร้าง ให้ห่อใน `#[napi(object)]` structs

### 4) ความผิดพลาดใน benchmarking

- อย่าเปรียบเทียบ inputs หรือ allocations ที่แตกต่างกัน
- รักษา JS และ native ให้ใช้ input arrays ที่เหมือนกัน
- รันทั้งคู่ในไฟล์ benchmark เดียวกันเพื่อหลีกเลี่ยงความเบี่ยงเบน

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

## รายการตรวจสอบการยืนยัน

- `validateNative` ผ่าน (ไม่มี exports ที่ขาดหายไป)
- `NativeBindings` ถูกเพิ่มเติมใน `packages/natives/src/<module>/types.ts` และ wrapper ถูก re-export ใน `packages/natives/src/index.ts`
- `Object.keys(require(...))` รวม export ใหม่ของคุณ
- ตัวเลข Bench ถูกบันทึกใน PR/notes
- Call site อัปเดต **เฉพาะเมื่อ** native เร็วกว่าหรือเท่ากัน

## กฎเกณฑ์ทั่วไป

- หาก native ช้ากว่า **อย่าเปลี่ยน** เก็บ export ไว้สำหรับงานในอนาคต แต่ TUI ควรอยู่บน path ที่เร็วกว่า
- หาก native เร็วกว่า ให้เปลี่ยน call site และเก็บ benchmark ไว้เพื่อตรวจจับ regressions
