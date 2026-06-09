---
title: สถาปัตยกรรม Natives
description: >-
  สถาปัตยกรรม Rust N-API native addon ที่เชื่อมต่อ TypeScript
  กับการทำงานเฉพาะแพลตฟอร์ม
sidebar:
  order: 1
  label: สถาปัตยกรรม
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# สถาปัตยกรรม Natives

`@f5xc-salesdemos/pi-natives` เป็นสแตกสามชั้น:

1. **ชั้น TypeScript wrapper/API** เปิดเผยจุดเข้าถึง JS/TS ที่เสถียร
2. **ชั้นโหลดและตรวจสอบ Addon** ค้นหาและตรวจสอบไบนารี `.node` สำหรับรันไทม์ปัจจุบัน
3. **ชั้นโมดูล Rust N-API** สร้างพรีมิทีฟที่เน้นประสิทธิภาพซึ่งส่งออกไปยัง JS

เอกสารนี้เป็นพื้นฐานสำหรับเอกสารระดับโมดูลที่ลึกขึ้น

## ไฟล์การนำไปใช้งาน

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## ชั้นที่ 1: ชั้น TypeScript wrapper/API

`packages/natives/src/index.ts` เป็น barrel สาธารณะ ซึ่งจัดกลุ่มการส่งออกตามโดเมนความสามารถและส่งออก typed wrapper แทนที่จะเปิดเผย N-API binding ดิบโดยตรง

กลุ่มระดับบนสุดในปัจจุบัน:

- **พรีมิทีฟการค้นหา/ข้อความ**: `grep`, `glob`, `text`, `highlight`
- **พรีมิทีฟการดำเนินการ/โปรเซส/เทอร์มินัล**: `shell`, `pty`, `ps`, `keys`
- **พรีมิทีฟระบบ/สื่อ/การแปลง**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` กำหนดสัญญาอินเทอร์เฟซพื้นฐาน:

- `NativeBindings` เริ่มต้นด้วยสมาชิกที่ใช้ร่วมกัน (`cancelWork(id: number)`)
- binding เฉพาะโมดูลถูกเพิ่มโดย declaration merging จากไฟล์ `types.ts` ของแต่ละโมดูล
- `Cancellable` กำหนดมาตรฐานตัวเลือก timeout และ abort-signal สำหรับ wrapper ที่เปิดเผยการยกเลิก

**สัญญาที่รับประกัน (ด้าน API):** ผู้ใช้งานนำเข้าจาก `@f5xc-salesdemos/pi-natives` และใช้ typed wrapper

**รายละเอียดการนำไปใช้งาน (อาจเปลี่ยนแปลง):** declaration merging และเลย์เอาต์ wrapper ภายใน (`src/<module>/index.ts`, `src/<module>/types.ts`)

## ชั้นที่ 2: การโหลดและตรวจสอบ Addon

`packages/natives/src/native.ts` รับผิดชอบการเลือก addon ของรันไทม์ การแตกไฟล์ตามเงื่อนไข และการตรวจสอบการส่งออก

### โมเดลการค้นหาตัวเลือก

- แท็กแพลตฟอร์มคือ `"${process.platform}-${process.arch}"`
- แท็กที่รองรับในปัจจุบันคือ:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 สามารถใช้ตัวแปร CPU:
  - `modern` (รองรับ AVX2)
  - `baseline` (ตัวเลือกสำรอง)
- ที่ไม่ใช่ x64 ใช้ชื่อไฟล์เริ่มต้น (ไม่มีส่วนต่อท้ายตัวแปร)

กลยุทธ์ชื่อไฟล์:

- Release: `pi_natives.<platform>-<arch>.node`
- Release ตัวแปร x64: `pi_natives.<platform>-<arch>-modern.node` และ/หรือ `...-baseline.node`
- `PI_DEV` เปิดใช้งานการวินิจฉัยตัวโหลดแต่ไม่เปลี่ยนชื่อไฟล์ addon

### การตรวจจับตัวแปรเฉพาะแพลตฟอร์ม

สำหรับ x64 การเลือกตัวแปรใช้:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: การตรวจสอบ PowerShell สำหรับ `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` สามารถบังคับให้ใช้ `modern` หรือ `baseline` อย่างชัดเจน

### โมเดลการแจกจ่ายและแตกไฟล์ไบนารี

`packages/natives/package.json` รวมทั้ง `src` และ `native` ในไฟล์ที่เผยแพร่ ไดเรกทอรี `native/` เก็บสิ่งประดิษฐ์แพลตฟอร์มที่สร้างไว้ล่วงหน้า

สำหรับไบนารีที่คอมไพล์แล้ว (ตัวบ่งชี้ `PI_COMPILED` หรือรันไทม์ฝังตัว Bun) พฤติกรรมของตัวโหลดคือ:

1. ตรวจสอบเส้นทางแคชผู้ใช้ที่มีเวอร์ชัน: `<getNativesDir()>/<packageVersion>/...`
2. ตรวจสอบตำแหน่งไบนารีที่คอมไพล์แล้วแบบเก่า:
   - Windows: `%LOCALAPPDATA%/xcsh` (สำรอง `%USERPROFILE%/AppData/Local/xcsh`)
   - ที่ไม่ใช่ Windows: `~/.local/bin`
3. ใช้ตัวเลือก `native/` ที่บรรจุในแพ็กเกจและไดเรกทอรีของไฟล์ปฏิบัติการเป็นตัวสำรอง

หากมีไฟล์ manifest ของ addon ฝังตัว (`embedded-addon.ts` ที่สร้างโดย `scripts/embed-native.ts`) `native.ts` สามารถสร้างไบนารีฝังตัวที่ตรงกันลงในไดเรกทอรีแคชที่มีเวอร์ชันก่อนโหลด

### การตรวจสอบและโหมดความล้มเหลว

หลังจาก `require(candidate)` แล้ว `validateNative(...)` จะตรวจสอบการส่งออกที่จำเป็น (เช่น `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`)

เส้นทางความล้มเหลวมีความชัดเจน:

- **แท็กแพลตฟอร์มที่ไม่รองรับ**: โยนข้อผิดพลาดพร้อมรายชื่อแพลตฟอร์มที่รองรับ
- **ไม่มีตัวเลือกที่โหลดได้**: โยนข้อผิดพลาดพร้อมเส้นทางทั้งหมดที่ลองแล้วและคำแนะนำการแก้ไข
- **การส่งออกที่ขาดหาย**: โยนข้อผิดพลาดพร้อมชื่อที่ขาดหายอย่างแม่นยำและคำสั่งสร้างใหม่
- **ข้อผิดพลาดในการแตกไฟล์ฝังตัว**: บันทึกความล้มเหลวของไดเรกทอรี/การเขียนและรวมไว้ในการวินิจฉัยการโหลดสุดท้าย

**สัญญาที่รับประกัน (ด้าน API):** การโหลด addon จะสำเร็จพร้อมชุด binding ที่ตรวจสอบแล้ว หรือล้มเหลวอย่างรวดเร็วพร้อมข้อความข้อผิดพลาดที่ปฏิบัติได้

**รายละเอียดการนำไปใช้งาน (อาจเปลี่ยนแปลง):** ลำดับการค้นหาตัวเลือกที่แน่นอนและลำดับเส้นทางสำรองของไบนารีที่คอมไพล์แล้ว

## ชั้นที่ 3: ชั้นโมดูล Rust N-API

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

โมดูลเหล่านี้นำเสนอสัญลักษณ์ N-API ที่ถูกใช้งานและตรวจสอบโดย `native.ts` ชื่อระดับ JS ถูกเปิดเผยผ่าน TS wrapper ใน `packages/natives/src`

**สัญญาที่รับประกัน (ด้าน API):** การส่งออกโมดูล Rust ต้องตรงกับชื่อ binding ที่คาดหวังโดย `validateNative` และโมดูล wrapper

**รายละเอียดการนำไปใช้งาน (อาจเปลี่ยนแปลง):** การแยกย่อยโมดูล Rust ภายในและขอบเขตโมดูลตัวช่วย (`glob_util`, `task` ฯลฯ)

## ขอบเขตความเป็นเจ้าของ

ในระดับสถาปัตยกรรม ความเป็นเจ้าของแบ่งดังนี้:

- **ความเป็นเจ้าของ TS wrapper/API (`packages/natives/src`)**
  - การจัดกลุ่ม API สาธารณะ การกำหนดประเภทตัวเลือก และการใช้งาน JS ที่เสถียร
  - พื้นผิวการยกเลิก (`timeoutMs`, `AbortSignal`) ที่เปิดเผยต่อผู้เรียกใช้
- **ความเป็นเจ้าของตัวโหลด (`packages/natives/src/native.ts`)**
  - การเลือกไบนารีของรันไทม์
  - การเลือกตัวแปร CPU และการจัดการการแทนที่
  - การแตกไฟล์ไบนารีที่คอมไพล์แล้วและการสำรวจตัวเลือก
  - การตรวจสอบอย่างเข้มงวดของการส่งออก native ที่จำเป็น
- **ความเป็นเจ้าของ Rust (`crates/pi-natives/src`)**
  - การนำไปใช้งานระดับอัลกอริทึมและระบบ
  - พฤติกรรมเฉพาะแพลตฟอร์มและตรรกะที่อ่อนไหวต่อประสิทธิภาพ
  - การนำเสนอสัญลักษณ์ N-API ที่ TS wrapper ใช้งาน

## ขั้นตอนการทำงานของรันไทม์ (ระดับสูง)

1. ผู้ใช้งานนำเข้าจาก `@f5xc-salesdemos/pi-natives`
2. โมดูล wrapper เรียกใช้ singleton `native` binding
3. `native.ts` เลือกไบนารีตัวเลือกสำหรับแพลตฟอร์ม/สถาปัตยกรรม/ตัวแปร
4. การแตกไฟล์ไบนารีฝังตัวตามเงื่อนไขเกิดขึ้นสำหรับการแจกจ่ายที่คอมไพล์แล้ว
5. โหลด addon และตรวจสอบชุดการส่งออก
6. wrapper ส่งผลลัพธ์ที่มีการกำหนดประเภทกลับไปยังผู้เรียกใช้

## อภิธานศัพท์

- **Native addon**: ไบนารี `.node` ที่โหลดผ่าน Node-API (N-API)
- **แท็กแพลตฟอร์ม**: ทูเพิลของรันไทม์ `platform-arch` (เช่น `darwin-arm64`)
- **ตัวแปร**: รสชาติการสร้างเฉพาะ CPU x64 (`modern` AVX2, `baseline` ตัวเลือกสำรอง)
- **Wrapper**: ฟังก์ชัน/คลาส TS ที่ให้ API ที่มีการกำหนดประเภทเหนือการส่งออก native ดิบ
- **Declaration merging**: เทคนิค TS ที่ใช้โดยไฟล์ `types.ts` ของโมดูลเพื่อขยาย `NativeBindings`
- **โหมดไบนารีที่คอมไพล์แล้ว**: โหมดรันไทม์ที่ CLI ถูกรวมเป็นชุดและ native addon ถูกค้นหาจากเส้นทางที่แตกไฟล์/แคชแทนที่จะเป็นเส้นทางภายในแพ็กเกจเท่านั้น
- **Addon ฝังตัว**: ข้อมูลเมตาของสิ่งประดิษฐ์การสร้างและการอ้างอิงไฟล์ที่สร้างลงใน `embedded-addon.ts` เพื่อให้ไบนารีที่คอมไพล์แล้วสามารถแตกไฟล์ payload `.node` ที่ตรงกัน
- **ประตูการตรวจสอบ**: การตรวจสอบ `validateNative(...)` ที่ปฏิเสธไบนารีที่ล้าสมัย/ไม่ตรงกันซึ่งขาดการส่งออกที่จำเป็น
