---
title: Natives Architecture
description: >-
  Rust N-API native addon architecture bridging TypeScript and platform-specific
  operations.
sidebar:
  order: 1
  label: Architecture
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# สถาปัตยกรรม Natives

`@f5xc-salesdemos/pi-natives` เป็นสแต็ก 3 ชั้น:

1. **ชั้น TypeScript wrapper/API** เปิดเผยจุดเข้าใช้งาน JS/TS ที่เสถียร
2. **ชั้นโหลดและตรวจสอบ Addon** ค้นหาและตรวจสอบไบนารี `.node` สำหรับรันไทม์ปัจจุบัน
3. **ชั้นโมดูล Rust N-API** ดำเนินการ primitive ที่ต้องการประสิทธิภาพสูงซึ่งส่งออกไปยัง JS

เอกสารนี้เป็นรากฐานสำหรับเอกสารในระดับโมดูลที่ลึกยิ่งขึ้น

## ไฟล์การดำเนินการ

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## ชั้นที่ 1: ชั้น TypeScript wrapper/API

`packages/natives/src/index.ts` เป็น barrel สาธารณะ ซึ่งจัดกลุ่มการส่งออกตามโดเมนความสามารถ และ re-export typed wrapper แทนที่จะเปิดเผย N-API bindings ดิบโดยตรง

กลุ่มระดับบนสุดในปัจจุบัน:

- **Search/text primitives**: `grep`, `glob`, `text`, `highlight`
- **Execution/process/terminal primitives**: `shell`, `pty`, `ps`, `keys`
- **System/media/conversion primitives**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` กำหนดสัญญาอินเทอร์เฟซพื้นฐาน:

- `NativeBindings` เริ่มต้นด้วยสมาชิกที่ใช้ร่วมกัน (`cancelWork(id: number)`)
- bindings เฉพาะโมดูลจะถูกเพิ่มโดย declaration merging จาก `types.ts` ของแต่ละโมดูล
- `Cancellable` ทำให้ตัวเลือก timeout และ abort-signal เป็นมาตรฐานสำหรับ wrapper ที่เปิดเผยการยกเลิก

**สัญญาที่รับประกัน (ด้าน API):** ผู้ใช้นำเข้าจาก `@f5xc-salesdemos/pi-natives` และใช้ typed wrapper

**รายละเอียดการดำเนินการ (อาจเปลี่ยนแปลง):** declaration merging และโครงสร้าง wrapper ภายใน (`src/<module>/index.ts`, `src/<module>/types.ts`)

## ชั้นที่ 2: การโหลดและตรวจสอบ Addon

`packages/natives/src/native.ts` รับผิดชอบการเลือก addon ที่รันไทม์ การแตกไฟล์ตามตัวเลือก และการตรวจสอบการส่งออก

### โมเดลการค้นหาตัวเลือก

- แท็กแพลตฟอร์มคือ `"${process.platform}-${process.arch}"`
- แท็กที่รองรับในปัจจุบัน:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 สามารถใช้ตัวแปร CPU:
  - `modern` (รองรับ AVX2)
  - `baseline` (ทางเลือกสำรอง)
- ที่ไม่ใช่ x64 จะใช้ชื่อไฟล์เริ่มต้น (ไม่มี suffix ตัวแปร)

กลยุทธ์ชื่อไฟล์:

- Release: `pi_natives.<platform>-<arch>.node`
- x64 variant release: `pi_natives.<platform>-<arch>-modern.node` และ/หรือ `...-baseline.node`
- `PI_DEV` เปิดใช้การวินิจฉัยตัวโหลด แต่ไม่เปลี่ยนชื่อไฟล์ addon

### การตรวจจับตัวแปรเฉพาะแพลตฟอร์ม

สำหรับ x64 การเลือกตัวแปรใช้:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: การตรวจสอบ PowerShell สำหรับ `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` สามารถบังคับ `modern` หรือ `baseline` ได้อย่างชัดเจน

### โมเดลการแจกจ่ายและแตกไฟล์ไบนารี

`packages/natives/package.json` รวมทั้ง `src` และ `native` ในไฟล์ที่เผยแพร่ ไดเรกทอรี `native/` เก็บ artifact แพลตฟอร์มที่สร้างไว้ล่วงหน้า

สำหรับไบนารีที่คอมไพล์แล้ว (ตัวระบุรันไทม์ `PI_COMPILED` หรือ Bun embedded) พฤติกรรมตัวโหลดคือ:

1. ตรวจสอบเส้นทาง user cache ที่มีเวอร์ชัน: `<getNativesDir()>/<packageVersion>/...`
2. ตรวจสอบตำแหน่ง compiled-binary แบบเก่า:
   - Windows: `%LOCALAPPDATA%/xcsh` (ทางเลือกสำรอง `%USERPROFILE%/AppData/Local/xcsh`)
   - ที่ไม่ใช่ Windows: `~/.local/bin`
3. ย้อนกลับไปที่ `native/` ในแพ็คเกจและไดเรกทอรีตัวเลือกของ executable

หากมี manifest ของ embedded addon (`embedded-addon.ts` ที่สร้างโดย `scripts/embed-native.ts`) `native.ts` สามารถทำให้ไบนารี embedded ที่ตรงกันปรากฏในไดเรกทอรี cache ที่มีเวอร์ชันก่อนโหลด

### การตรวจสอบและโหมดความล้มเหลว

หลังจาก `require(candidate)` แล้ว `validateNative(...)` จะตรวจสอบการส่งออกที่จำเป็น (เช่น `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`)

เส้นทางความล้มเหลวมีความชัดเจน:

- **แท็กแพลตฟอร์มที่ไม่รองรับ**: throw พร้อมรายชื่อแพลตฟอร์มที่รองรับ
- **ไม่มีตัวเลือกที่โหลดได้**: throw พร้อมเส้นทางทั้งหมดที่พยายามและคำแนะนำการแก้ไข
- **การส่งออกที่ขาดหาย**: throw พร้อมชื่อที่ขาดหายอย่างแม่นยำและคำสั่ง rebuild
- **ข้อผิดพลาดในการแตกไฟล์ embedded**: บันทึกความล้มเหลวของไดเรกทอรี/การเขียนและรวมไว้ในการวินิจฉัยการโหลดขั้นสุดท้าย

**สัญญาที่รับประกัน (ด้าน API):** การโหลด addon จะสำเร็จพร้อมชุด binding ที่ผ่านการตรวจสอบ หรือล้มเหลวทันทีพร้อมข้อความข้อผิดพลาดที่สามารถดำเนินการได้

**รายละเอียดการดำเนินการ (อาจเปลี่ยนแปลง):** ลำดับการค้นหาตัวเลือกที่แน่นอนและลำดับเส้นทางสำรอง compiled-binary

## ชั้นที่ 3: ชั้นโมดูล Rust N-API

`crates/pi-natives/src/lib.rs` เป็นโมดูลเข้า Rust ที่ประกาศความเป็นเจ้าของโมดูลที่ส่งออก:

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

โมดูลเหล่านี้ดำเนินการสัญลักษณ์ N-API ที่ถูกใช้งานและตรวจสอบโดย `native.ts` ชื่อระดับ JS จะปรากฏผ่าน TS wrapper ใน `packages/natives/src`

**สัญญาที่รับประกัน (ด้าน API):** การส่งออกโมดูล Rust ต้องตรงกับชื่อ binding ที่ `validateNative` และโมดูล wrapper คาดหวัง

**รายละเอียดการดำเนินการ (อาจเปลี่ยนแปลง):** การแบ่งโมดูล Rust ภายในและขอบเขตโมดูลตัวช่วย (`glob_util`, `task` เป็นต้น)

## ขอบเขตความเป็นเจ้าของ

ในระดับสถาปัตยกรรม ความเป็นเจ้าของถูกแบ่งดังนี้:

- **ความเป็นเจ้าของ TS wrapper/API (`packages/natives/src`)**
  - การจัดกลุ่ม API สาธารณะ, option typing และ JS ergonomics ที่เสถียร
  - พื้นผิวการยกเลิก (`timeoutMs`, `AbortSignal`) ที่เปิดเผยให้ผู้เรียก
- **ความเป็นเจ้าของตัวโหลด (`packages/natives/src/native.ts`)**
  - การเลือกไบนารีที่รันไทม์
  - การเลือกตัวแปร CPU และการจัดการการแทนที่
  - การแตกไฟล์ compiled-binary และการตรวจสอบตัวเลือก
  - การตรวจสอบอย่างเข้มงวดของการส่งออก native ที่จำเป็น
- **ความเป็นเจ้าของ Rust (`crates/pi-natives/src`)**
  - การดำเนินการระดับอัลกอริทึมและระดับระบบ
  - พฤติกรรมเฉพาะแพลตฟอร์มและตรรกะที่ต้องการประสิทธิภาพสูง
  - การดำเนินการสัญลักษณ์ N-API ที่ TS wrapper ใช้งาน

## ขั้นตอนการทำงานที่รันไทม์ (ระดับสูง)

1. ผู้ใช้นำเข้าจาก `@f5xc-salesdemos/pi-natives`
2. โมดูล wrapper เรียกเข้าสู่ singleton `native` binding
3. `native.ts` เลือกไบนารีตัวเลือกสำหรับ platform/arch/variant
4. การแตกไฟล์ไบนารี embedded ตามตัวเลือกจะเกิดขึ้นสำหรับ compiled distribution
5. Addon ถูกโหลดและชุดการส่งออกถูกตรวจสอบ
6. Wrapper ส่งคืนผลลัพธ์ที่มีประเภทให้ผู้เรียก

## อภิธานศัพท์

- **Native addon**: ไบนารี `.node` ที่โหลดผ่าน Node-API (N-API)
- **Platform tag**: ทูเพิลรันไทม์ `platform-arch` (เช่น `darwin-arm64`)
- **Variant**: รูปแบบบิลด์เฉพาะ CPU x64 (`modern` AVX2, `baseline` ทางเลือกสำรอง)
- **Wrapper**: ฟังก์ชัน/คลาส TS ที่ให้ API ที่มีประเภทเหนือการส่งออก native ดิบ
- **Declaration merging**: เทคนิค TS ที่ใช้โดยไฟล์ `types.ts` ของโมดูลเพื่อขยาย `NativeBindings`
- **Compiled binary mode**: โหมดรันไทม์ที่ CLI ถูก bundle และ native addon ถูกค้นหาจากเส้นทาง extracted/cache แทนที่จะเป็นเฉพาะเส้นทางภายในแพ็คเกจ
- **Embedded addon**: เมตาดาต้า build artifact และการอ้างอิงไฟล์ที่สร้างขึ้นใน `embedded-addon.ts` เพื่อให้ compiled binary สามารถแตกไฟล์ payload `.node` ที่ตรงกัน
- **Validation gate**: การตรวจสอบ `validateNative(...)` ที่ปฏิเสธไบนารีที่ล้าสมัย/ไม่ตรงกันซึ่งขาดการส่งออกที่จำเป็น
