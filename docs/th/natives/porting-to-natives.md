---
title: การย้ายไปยัง pi-natives (N-API) — บันทึกภาคสนาม
description: >-
  บันทึกภาคสนามสำหรับการย้าย child_process และโค้ด shell ของ Node.js
  ไปยังเลเยอร์ native N-API ที่เขียนด้วย Rust
sidebar:
  order: 9
  label: การย้ายไปยัง pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# การย้ายไปยัง pi-natives (N-API) — บันทึกภาคสนาม

นี่คือคู่มือเชิงปฏิบัติสำหรับการย้าย hot path ไปไว้ใน `crates/pi-natives` และเชื่อมต่อผ่าน JS bindings เพื่อป้องกันไม่ให้เกิดความผิดพลาดเดิมซ้ำอีกครั้ง

## เมื่อไหร่ควรย้าย

ควรย้ายเมื่อเงื่อนไขใดเงื่อนไขหนึ่งต่อไปนี้เป็นจริง:

- hot path ทำงานใน render loop, การอัปเดต UI แบบต่อเนื่อง, หรือชุดงานขนาดใหญ่
- การจัดสรรหน่วยความจำของ JS เป็นตัวหลัก (การสร้าง string, การย้อนกลับของ regex, อาร์เรย์ขนาดใหญ่)
- มี JS baseline อยู่แล้วและสามารถวัดประสิทธิภาพทั้งสองเวอร์ชันเคียงกันได้
- งานเป็นแบบ CPU-bound หรือ blocking I/O ที่สามารถรันบน libuv thread pool ได้
- งานเป็นแบบ async I/O ที่สามารถรันบน runtime ของ Tokio ได้ (เช่น การรันคำสั่ง shell)

หลีกเลี่ยงการย้ายที่ขึ้นอยู่กับ state เฉพาะของ JS หรือ dynamic import ต่างๆ การ export ของ N-API ควรเป็นแบบ pure คือรับข้อมูลเข้าและส่งข้อมูลออกเท่านั้น งานที่รันเป็นเวลานานควรผ่าน `task::blocking` (CPU-bound/blocking I/O) หรือ `task::future` (async I/O) พร้อมรองรับการยกเลิก

## โครงสร้างของ native export

**ฝั่ง Rust:**

- การ implement อยู่ใน `crates/pi-natives/src/<module>.rs` หากเพิ่ม module ใหม่ ให้ลงทะเบียนใน `crates/pi-natives/src/lib.rs`
- Export ด้วย `#[napi]`; การ export แบบ snake_case จะถูกแปลงเป็น camelCase โดยอัตโนมัติ ใช้ `js_name` แบบระบุชัดเจนเฉพาะสำหรับ alias จริงๆ หรือชื่อที่ไม่ใช่ค่าเริ่มต้นเท่านั้น ใช้ `#[napi(object)]` สำหรับ struct
- ใช้ `task::blocking(tag, cancel_token, work)` (ดูใน `crates/pi-natives/src/task.rs`) สำหรับงาน CPU-bound หรือ blocking ใช้ `task::future(env, tag, work)` สำหรับงาน async ที่ต้องการ Tokio (เช่น shell session) ส่ง `CancelToken` เมื่อคุณ expose `timeoutMs` หรือ `AbortSignal`

**ฝั่ง JS:**

- `packages/natives/src/bindings.ts` เก็บ interface `NativeBindings` พื้นฐาน
- `packages/natives/src/<module>/types.ts` กำหนด TS types และเพิ่มเติม `NativeBindings` ผ่าน declaration merging
- `packages/natives/src/native.ts` import ไฟล์ `<module>/types.ts` แต่ละไฟล์เพื่อเปิดใช้งานการประกาศ
- `packages/natives/src/<module>/index.ts` ห่อ `native` binding จาก `packages/natives/src/native.ts`
- `packages/natives/src/native.ts` โหลด addon และ `validateNative` บังคับใช้ export ที่จำเป็น
- `packages/natives/src/index.ts` re-export wrapper สำหรับผู้เรียกใช้งานใน `packages/*`

## รายการตรวจสอบการย้าย

1. **เพิ่มการ implement ใน Rust**

- ใส่ logic หลักในฟังก์ชัน Rust ธรรมดา
- หากเป็น module ใหม่ ให้เพิ่มใน `crates/pi-natives/src/lib.rs`
- Expose ด้วย `#[napi]` เพื่อให้การแมปแบบ snake_case -> camelCase ค่าเริ่มต้นสอดคล้องกัน
- รักษา signature ให้เป็นแบบ owned และเรียบง่าย: `String`, `Vec<String>`, `Uint8Array`, หรือ `Either<JsString, Uint8Array>` สำหรับ input string/byte ขนาดใหญ่
- สำหรับงาน CPU-bound หรือ blocking ใช้ `task::blocking`; สำหรับงาน async ใช้ `task::future` ส่ง `CancelToken` และเรียก `heartbeat()` ภายใน loop ที่รันนาน

2. **เชื่อมต่อ JS bindings**

- เพิ่ม types และการเพิ่มเติม `NativeBindings` ใน `packages/natives/src/<module>/types.ts`
- Import `./<module>/types` ใน `packages/natives/src/native.ts` เพื่อเปิดใช้งาน declaration merging
- เพิ่ม wrapper ใน `packages/natives/src/<module>/index.ts` ที่เรียก `native`
- Re-export จาก `packages/natives/src/index.ts`

3. **อัปเดตการตรวจสอบ native**

- เพิ่ม `checkFn("newExport")` ใน `validateNative` (`packages/natives/src/native.ts`)

4. **เพิ่ม benchmarks**

- วาง benchmark ไว้ข้างๆ package ที่เป็นเจ้าของ (`packages/tui/bench`, `packages/natives/bench`, หรือ `packages/coding-agent/bench`)
- รวม JS baseline และเวอร์ชัน native ไว้ในการรันเดียวกัน
- ใช้ `Bun.nanoseconds()` และจำนวน iteration ที่กำหนดไว้
- รักษา input ของ benchmark ให้เล็กและสมจริง (ข้อมูลจริงที่พบใน hot path)

5. **สร้าง native binary**

- `bun --cwd=packages/natives run build`
- ใช้ `bun --cwd=packages/natives run build` และตั้งค่า `PI_DEV=1` หากต้องการการวินิจฉัย loader ขณะทดสอบ

6. **รัน benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (หรือ `bun --cwd=packages/natives run bench`)

7. **ตัดสินใจเรื่องการใช้งาน**

- หาก native ช้ากว่า ให้ **คง JS ไว้** และปล่อย native export ไว้โดยไม่ใช้
- หาก native เร็วกว่า ให้เปลี่ยน call site ไปใช้ native wrapper

## จุดที่มักเกิดปัญหาและวิธีหลีกเลี่ยง

### 1) `pi_natives.node` ที่ล้าสมัยป้องกันการรับรู้ export ใหม่

ตัวโหลดให้ความสำคัญกับ binary ที่มีแท็กแพลตฟอร์มใน `packages/natives/native` (`pi_natives.<platform>-<arch>.node`) `PI_DEV=1` ตอนนี้เปิดใช้งานเฉพาะการวินิจฉัย loader เท่านั้น ไม่ได้เปลี่ยนไปใช้ชื่อไฟล์ addon สำหรับการพัฒนาแยกต่างหากอีกต่อไป นอกจากนี้ยังมี fallback `pi_natives.node` ด้วย Binary ที่คอมไพล์แล้วจะแตกออกมาที่ `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` หากไฟล์เหล่านี้ล้าสมัย export จะไม่อัปเดต

**วิธีแก้:** ลบไฟล์ที่ล้าสมัยก่อนสร้างใหม่

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

หากรัน binary ที่คอมไพล์แล้ว ให้ลบไดเรกทอรี addon ที่แคชไว้:

```bash
rm -rf ~/.xcsh/natives/<version>
```

จากนั้นตรวจสอบว่า export มีอยู่ใน binary:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) ข้อผิดพลาด "Missing exports" จาก `validateNative`

นี่คือ **สิ่งที่ดี** — มันป้องกันความไม่ตรงกันที่เกิดขึ้นอย่างเงียบๆ เมื่อคุณเห็น:

```
Native addon missing exports ... Missing: visibleWidth
```

หมายความว่า binary ของคุณล้าสมัย ชื่อ export ของ Rust (หรือ alias ที่ระบุชัดเจนเมื่อใช้) ไม่ตรงกับชื่อ JS หรือ export ไม่ได้ถูกคอมไพล์เข้าไป แก้ไข build และการไม่ตรงกันของชื่อ อย่าลดความเข้มงวดของการตรวจสอบ

### 3) Rust signature ไม่ตรงกัน

รักษาให้เรียบง่ายและเป็นแบบ owned `String`, `Vec<String>`, และ `Uint8Array` ใช้งานได้ หลีกเลี่ยง reference เช่น `&str` ใน public export หากต้องการข้อมูลแบบมีโครงสร้าง ให้ห่อด้วย struct แบบ `#[napi(object)]`

### 4) ข้อผิดพลาดในการ benchmark

- อย่าเปรียบเทียบ input หรือการจัดสรรหน่วยความจำที่ต่างกัน
- ให้ JS และ native ใช้อาร์เรย์ input ที่เหมือนกัน
- รันทั้งคู่ในไฟล์ benchmark เดียวกันเพื่อหลีกเลี่ยงความคลาดเคลื่อน

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

- `validateNative` ผ่าน (ไม่มี export ที่หายไป)
- `NativeBindings` ถูกเพิ่มเติมใน `packages/natives/src/<module>/types.ts` และ wrapper ถูก re-export ใน `packages/natives/src/index.ts`
- `Object.keys(require(...))` รวม export ใหม่ของคุณ
- บันทึกตัวเลข benchmark ใน PR/บันทึก
- อัปเดต call site **เฉพาะเมื่อ** native เร็วกว่าหรือเท่ากัน

## หลักการทั่วไป

- หาก native ช้ากว่า **อย่าเปลี่ยน** คง export ไว้สำหรับงานในอนาคต แต่ TUI ควรอยู่บน path ที่เร็วกว่า
- หาก native เร็วกว่า ให้เปลี่ยน call site และคง benchmark ไว้เพื่อตรวจจับการถดถอย
