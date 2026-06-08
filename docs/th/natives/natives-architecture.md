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

`@f5xc-salesdemos/pi-natives` เป็นสแตกสามชั้น:

1. **ชั้น TypeScript wrapper/API** เปิดเผยจุดเข้าใช้งาน JS/TS ที่เสถียร
2. **ชั้นการโหลด/ตรวจสอบ addon** ค้นหาและตรวจสอบไบนารี `.node` สำหรับรันไทม์ปัจจุบัน
3. **ชั้น Rust N-API module** ดำเนินการ primitives ที่ต้องการประสิทธิภาพสูงและส่งออกไปยัง JS

เอกสารนี้เป็นพื้นฐานสำหรับเอกสารระดับโมดูลที่ลึกกว่า

## ไฟล์การใช้งาน

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## ชั้นที่ 1: ชั้น TypeScript wrapper/API

`packages/natives/src/index.ts` เป็น barrel สาธารณะ โดยจัดกลุ่มการส่งออกตามโดเมนความสามารถและส่งออก typed wrappers แทนที่จะเปิดเผย raw N-API bindings โดยตรง

กลุ่มระดับบนสุดในปัจจุบัน:

- **Search/text primitives**: `grep`, `glob`, `text`, `highlight`
- **Execution/process/terminal primitives**: `shell`, `pty`, `ps`, `keys`
- **System/media/conversion primitives**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` กำหนดสัญญาอินเทอร์เฟซพื้นฐาน:

- `NativeBindings` เริ่มต้นด้วยสมาชิกที่ใช้ร่วมกัน (`cancelWork(id: number)`)
- bindings เฉพาะโมดูลถูกเพิ่มโดย declaration merging จากไฟล์ `types.ts` ของแต่ละโมดูล
- `Cancellable` กำหนดมาตรฐานตัวเลือก timeout และ abort-signal สำหรับ wrappers ที่เปิดเผยการยกเลิก

**สัญญาที่รับประกัน (ด้าน API):** ผู้ใช้งานนำเข้าจาก `@f5xc-salesdemos/pi-natives` และใช้ typed wrappers

**รายละเอียดการใช้งาน (อาจเปลี่ยนแปลง):** declaration merging และเลย์เอาต์ internal wrapper (`src/<module>/index.ts`, `src/<module>/types.ts`)

## ชั้นที่ 2: การโหลดและตรวจสอบ addon

`packages/natives/src/native.ts` รับผิดชอบการเลือก addon ขณะรันไทม์ การแตกไฟล์ที่เป็นทางเลือก และการตรวจสอบการส่งออก

### โมเดลการค้นหา candidate

- แท็กแพลตฟอร์มคือ `"${process.platform}-${process.arch}"`
- แท็กที่รองรับในปัจจุบันคือ:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 สามารถใช้ CPU variants ได้:
  - `modern` (รองรับ AVX2)
  - `baseline` (ทางเลือกสำรอง)
- สถาปัตยกรรมที่ไม่ใช่ x64 ใช้ชื่อไฟล์เริ่มต้น (ไม่มี variant suffix)

กลยุทธ์ชื่อไฟล์:

- Release: `pi_natives.<platform>-<arch>.node`
- x64 variant release: `pi_natives.<platform>-<arch>-modern.node` และ/หรือ `...-baseline.node`
- `PI_DEV` เปิดใช้งานการวินิจฉัย loader แต่ไม่เปลี่ยนชื่อไฟล์ addon

### การตรวจจับ variant เฉพาะแพลตฟอร์ม

สำหรับ x64 การเลือก variant ใช้:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: การตรวจสอบ PowerShell สำหรับ `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` สามารถบังคับ `modern` หรือ `baseline` ได้อย่างชัดเจน

### โมเดลการแจกจ่ายและแตกไฟล์ไบนารี

`packages/natives/package.json` รวมทั้ง `src` และ `native` ในไฟล์ที่เผยแพร่ ไดเรกทอรี `native/` จัดเก็บ artifacts ที่สร้างล่วงหน้าสำหรับแต่ละแพลตฟอร์ม

สำหรับไบนารีที่คอมไพล์แล้ว (ตัวบ่งชี้รันไทม์ `PI_COMPILED` หรือ Bun embedded) พฤติกรรมของ loader คือ:

1. ตรวจสอบเส้นทางแคชผู้ใช้ที่มีเวอร์ชัน: `<getNativesDir()>/<packageVersion>/...`
2. ตรวจสอบตำแหน่ง compiled-binary แบบเดิม:
   - Windows: `%LOCALAPPDATA%/xcsh` (ทางเลือกสำรอง `%USERPROFILE%/AppData/Local/xcsh`)
   - ระบบอื่น: `~/.local/bin`
3. ย้อนกลับไปใช้ `native/` ที่รวมในแพ็กเกจและ candidates ของไดเรกทอรีไฟล์เรียกทำงาน

หากมี manifest ของ embedded addon (`embedded-addon.ts` ที่สร้างโดย `scripts/embed-native.ts`) `native.ts` สามารถสร้างไบนารี embedded ที่ตรงกันลงในไดเรกทอรีแคชที่มีเวอร์ชันก่อนโหลด

### การตรวจสอบและโหมดความล้มเหลว

หลังจาก `require(candidate)` แล้ว `validateNative(...)` ตรวจสอบการส่งออกที่จำเป็น (เช่น `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`)

เส้นทางความล้มเหลวมีความชัดเจน:

- **แท็กแพลตฟอร์มที่ไม่รองรับ**: โยนข้อผิดพลาดพร้อมรายชื่อแพลตฟอร์มที่รองรับ
- **ไม่มี candidate ที่โหลดได้**: โยนข้อผิดพลาดพร้อมเส้นทางทั้งหมดที่พยายามและคำแนะนำในการแก้ไข
- **การส่งออกที่ขาดหาย**: โยนข้อผิดพลาดพร้อมชื่อที่ขาดหายอย่างแม่นยำและคำสั่งสร้างใหม่
- **ข้อผิดพลาดการแตกไฟล์ embedded**: บันทึกความล้มเหลวด้านไดเรกทอรี/การเขียนและรวมไว้ในการวินิจฉัยการโหลดขั้นสุดท้าย

**สัญญาที่รับประกัน (ด้าน API):** การโหลด addon จะสำเร็จพร้อม binding set ที่ตรวจสอบแล้ว หรือล้มเหลวทันทีพร้อมข้อความข้อผิดพลาดที่สามารถดำเนินการได้

**รายละเอียดการใช้งาน (อาจเปลี่ยนแปลง):** ลำดับการค้นหา candidate ที่แน่นอนและลำดับเส้นทางสำรองของ compiled-binary

## ชั้นที่ 3: ชั้น Rust N-API module

`crates/pi-natives/src/lib.rs` เป็นโมดูล Rust หลักที่ประกาศความเป็นเจ้าของโมดูลที่ส่งออก:

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

โมดูลเหล่านี้ดำเนินการ N-API symbols ที่ถูกใช้และตรวจสอบโดย `native.ts` ชื่อระดับ JS ถูกเปิดเผยผ่าน TS wrappers ใน `packages/natives/src`

**สัญญาที่รับประกัน (ด้าน API):** การส่งออกของ Rust module ต้องตรงกับชื่อ binding ที่ `validateNative` และ wrapper modules คาดหวัง

**รายละเอียดการใช้งาน (อาจเปลี่ยนแปลง):** การแบ่งส่วน Rust module ภายในและขอบเขตของ helper module (`glob_util`, `task` เป็นต้น)

## ขอบเขตความเป็นเจ้าของ

ในระดับสถาปัตยกรรม ความเป็นเจ้าของถูกแบ่งดังนี้:

- **ความเป็นเจ้าของ TS wrapper/API (`packages/natives/src`)**
  - การจัดกลุ่ม API สาธารณะ การกำหนดประเภทตัวเลือก และ JS ergonomics ที่เสถียร
  - พื้นผิวการยกเลิก (`timeoutMs`, `AbortSignal`) ที่เปิดเผยให้ผู้เรียกใช้
- **ความเป็นเจ้าของ Loader (`packages/natives/src/native.ts`)**
  - การเลือกไบนารีขณะรันไทม์
  - การเลือก CPU variant และการจัดการการแทนที่
  - การแตกไฟล์ compiled-binary และการสำรวจ candidate
  - การตรวจสอบอย่างเข้มงวดของการส่งออก native ที่จำเป็น
- **ความเป็นเจ้าของ Rust (`crates/pi-natives/src`)**
  - การใช้งานระดับอัลกอริทึมและระดับระบบ
  - พฤติกรรมเฉพาะแพลตฟอร์มและตรรกะที่ต้องการประสิทธิภาพสูง
  - การใช้งาน N-API symbol ที่ TS wrappers ใช้งาน

## ขั้นตอนการทำงานขณะรันไทม์ (ระดับสูง)

1. ผู้ใช้งานนำเข้าจาก `@f5xc-salesdemos/pi-natives`
2. Wrapper module เรียกไปยัง singleton `native` binding
3. `native.ts` เลือก candidate binary สำหรับ platform/arch/variant
4. การแตกไฟล์ embedded binary ที่เป็นทางเลือกเกิดขึ้นสำหรับ compiled distributions
5. Addon ถูกโหลดและชุดการส่งออกถูกตรวจสอบ
6. Wrapper ส่งคืนผลลัพธ์ที่มีการกำหนดประเภทให้ผู้เรียกใช้

## อภิธานศัพท์

- **Native addon**: ไบนารี `.node` ที่โหลดผ่าน Node-API (N-API)
- **Platform tag**: ทูเพิลรันไทม์ `platform-arch` (เช่น `darwin-arm64`)
- **Variant**: รูปแบบบิลด์เฉพาะ CPU x64 (`modern` AVX2, `baseline` ทางเลือกสำรอง)
- **Wrapper**: ฟังก์ชัน/คลาส TS ที่ให้ API ที่มีการกำหนดประเภทเหนือการส่งออก native แบบ raw
- **Declaration merging**: เทคนิค TS ที่ใช้โดยไฟล์ `types.ts` ของโมดูลเพื่อขยาย `NativeBindings`
- **Compiled binary mode**: โหมดรันไทม์ที่ CLI ถูกรวมเป็นชุดและ native addons ถูกค้นหาจากเส้นทางที่แตกไฟล์/แคชแทนที่จะเป็นเส้นทางภายในแพ็กเกจเท่านั้น
- **Embedded addon**: metadata และการอ้างอิงไฟล์ของ build artifact ที่สร้างลงใน `embedded-addon.ts` เพื่อให้ compiled binaries สามารถแตก `.node` payloads ที่ตรงกันได้
- **Validation gate**: การตรวจสอบ `validateNative(...)` ที่ปฏิเสธไบนารีที่ล้าสมัย/ไม่ตรงกันซึ่งขาดการส่งออกที่จำเป็น
