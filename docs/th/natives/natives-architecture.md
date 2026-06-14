---
title: สถาปัตยกรรม Natives
description: >-
  สถาปัตยกรรม Rust N-API native addon ที่เชื่อมต่อ TypeScript
  กับการดำเนินการเฉพาะแพลตฟอร์ม
sidebar:
  order: 1
  label: สถาปัตยกรรม
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# สถาปัตยกรรม Natives

`@f5xc-salesdemos/pi-natives` คือสแตก 3 ชั้น:

1. **ชั้น TypeScript wrapper/API** เปิดเผย entrypoints ของ JS/TS ที่มีความเสถียร
2. **ชั้นโหลด/ตรวจสอบ Addon** ค้นหาและตรวจสอบไบนารี `.node` สำหรับ runtime ปัจจุบัน
3. **ชั้นโมดูล Rust N-API** ใช้งาน primitives ที่สำคัญต่อประสิทธิภาพซึ่งส่งออกไปยัง JS

เอกสารนี้เป็นรากฐานสำหรับเอกสารระดับโมดูลที่ลึกกว่านี้

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

`packages/natives/src/index.ts` คือ public barrel โดยจัดกลุ่ม exports ตามโดเมนความสามารถ และส่งออก typed wrappers แทนที่จะเปิดเผย raw N-API bindings โดยตรง

กลุ่มระดับบนสุดในปัจจุบัน:

- **primitives การค้นหา/ข้อความ**: `grep`, `glob`, `text`, `highlight`
- **primitives การรันคำสั่ง/กระบวนการ/เทอร์มินัล**: `shell`, `pty`, `ps`, `keys`
- **primitives ระบบ/สื่อ/การแปลง**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` กำหนด contract ของ interface พื้นฐาน:

- `NativeBindings` เริ่มต้นด้วยสมาชิกที่ใช้ร่วมกัน (`cancelWork(id: number)`)
- bindings เฉพาะโมดูลถูกเพิ่มโดยการรวม declaration จาก `types.ts` ของแต่ละโมดูล
- `Cancellable` กำหนดมาตรฐานตัวเลือก timeout และ abort-signal สำหรับ wrappers ที่เปิดเผยการยกเลิก

**Contract ที่รับประกัน (ด้าน API):** ผู้ใช้นำเข้าจาก `@f5xc-salesdemos/pi-natives` และใช้ typed wrappers

**รายละเอียดการใช้งาน (อาจเปลี่ยนแปลงได้):** การรวม declaration และ layout ภายในของ wrapper (`src/<module>/index.ts`, `src/<module>/types.ts`)

## ชั้นที่ 2: การโหลดและตรวจสอบ Addon

`packages/natives/src/native.ts` รับผิดชอบการเลือก addon ขณะ runtime การดึงข้อมูลแบบ optional และการตรวจสอบ export

### รูปแบบการค้นหา Candidate

- แท็กแพลตฟอร์มคือ `"${process.platform}-${process.arch}"`
- แท็กที่รองรับในปัจจุบันได้แก่:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 สามารถใช้ CPU variants:
  - `modern` (รองรับ AVX2)
  - `baseline` (fallback)
- สถาปัตยกรรมที่ไม่ใช่ x64 ใช้ชื่อไฟล์เริ่มต้น (ไม่มี variant suffix)

กลยุทธ์ชื่อไฟล์:

- Release: `pi_natives.<platform>-<arch>.node`
- Release แบบ x64 variant: `pi_natives.<platform>-<arch>-modern.node` และ/หรือ `...-baseline.node`
- `PI_DEV` เปิดใช้งานการวินิจฉัย loader แต่ไม่เปลี่ยนชื่อไฟล์ addon

### การตรวจจับ Variant เฉพาะแพลตฟอร์ม

สำหรับ x64 การเลือก variant ใช้:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: การตรวจสอบ PowerShell สำหรับ `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` สามารถบังคับให้ใช้ `modern` หรือ `baseline` อย่างชัดเจน

### รูปแบบการกระจายและดึงข้อมูลไบนารี

`packages/natives/package.json` รวมทั้ง `src` และ `native` ในไฟล์ที่เผยแพร่ โดยไดเรกทอรี `native/` เก็บ artifacts ที่สร้างไว้ล่วงหน้าตามแพลตฟอร์ม

สำหรับไบนารีที่คอมไพล์แล้ว (`PI_COMPILED` หรือ Bun embedded runtime markers) พฤติกรรมของ loader คือ:

1. ตรวจสอบ versioned user cache path: `<getNativesDir()>/<packageVersion>/...`
2. ตรวจสอบตำแหน่งไบนารีที่คอมไพล์แบบ legacy:
   - Windows: `%LOCALAPPDATA%/xcsh` (fallback `%USERPROFILE%/AppData/Local/xcsh`)
   - ที่ไม่ใช่ Windows: `~/.local/bin`
3. Fallback ไปยัง `native/` ที่แพ็กไว้และ candidates ของไดเรกทอรี executable

หากมี embedded addon manifest (`embedded-addon.ts` ที่สร้างโดย `scripts/embed-native.ts`) `native.ts` สามารถสร้างไบนารีที่ฝังตรงกันไปยัง versioned cache directory ก่อนโหลด

### การตรวจสอบและโหมดความล้มเหลว

หลังจาก `require(candidate)` แล้ว `validateNative(...)` จะตรวจสอบ exports ที่จำเป็น (เช่น `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`)

เส้นทางความล้มเหลวมีความชัดเจน:

- **แท็กแพลตฟอร์มที่ไม่รองรับ**: throw พร้อมรายการแพลตฟอร์มที่รองรับ
- **ไม่มี candidate ที่โหลดได้**: throw พร้อมเส้นทางทั้งหมดที่ลองแล้วและคำแนะนำการแก้ไข
- **exports ที่ขาดหายไป**: throw พร้อมชื่อที่ขาดหายไปอย่างแม่นยำและคำสั่ง rebuild
- **ข้อผิดพลาดการดึง embedded**: บันทึกความล้มเหลวของไดเรกทอรี/การเขียน และรวมไว้ในการวินิจฉัยการโหลดขั้นสุดท้าย

**Contract ที่รับประกัน (ด้าน API):** การโหลด addon สำเร็จพร้อม binding set ที่ตรวจสอบแล้ว หรือล้มเหลวอย่างรวดเร็วพร้อมข้อความข้อผิดพลาดที่ดำเนินการได้

**รายละเอียดการใช้งาน (อาจเปลี่ยนแปลงได้):** ลำดับการค้นหา candidate ที่แน่นอนและการเรียงลำดับ fallback path ของไบนารีที่คอมไพล์

## ชั้นที่ 3: ชั้นโมดูล Rust N-API

`crates/pi-natives/src/lib.rs` คือโมดูล entry ของ Rust ที่ประกาศความเป็นเจ้าของโมดูลที่ส่งออก:

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

โมดูลเหล่านี้ใช้งาน N-API symbols ที่ถูกใช้และตรวจสอบโดย `native.ts` ชื่อระดับ JS ถูกแสดงผ่าน TS wrappers ใน `packages/natives/src`

**Contract ที่รับประกัน (ด้าน API):** exports ของโมดูล Rust ต้องตรงกับชื่อ binding ที่ `validateNative` และโมดูล wrapper คาดหวัง

**รายละเอียดการใช้งาน (อาจเปลี่ยนแปลงได้):** การแบ่งโมดูล Rust ภายในและขอบเขตโมดูล helper (`glob_util`, `task` เป็นต้น)

## ขอบเขตความเป็นเจ้าของ

ในระดับสถาปัตยกรรม ความเป็นเจ้าของแบ่งดังนี้:

- **ความเป็นเจ้าของ TS wrapper/API (`packages/natives/src`)**
  - การจัดกลุ่ม public API การกำหนด option typing และ JS ergonomics ที่เสถียร
  - พื้นผิวการยกเลิก (`timeoutMs`, `AbortSignal`) ที่เปิดเผยต่อผู้เรียก
- **ความเป็นเจ้าของ Loader (`packages/natives/src/native.ts`)**
  - การเลือกไบนารีขณะ runtime
  - การเลือก CPU variant และการจัดการการ override
  - การดึงไบนารีที่คอมไพล์และการตรวจสอบ candidate
  - การตรวจสอบอย่างเข้มงวดของ native exports ที่จำเป็น
- **ความเป็นเจ้าของ Rust (`crates/pi-natives/src`)**
  - การใช้งานเชิงอัลกอริทึมและระดับระบบ
  - พฤติกรรมเฉพาะแพลตฟอร์มและตรรกะที่ไวต่อประสิทธิภาพ
  - การใช้งาน N-API symbol ที่ TS wrappers ใช้งาน

## ขั้นตอน Runtime (ภาพรวม)

1. ผู้ใช้นำเข้าจาก `@f5xc-salesdemos/pi-natives`
2. โมดูล wrapper เรียกใช้ singleton `native` binding
3. `native.ts` เลือกไบนารี candidate สำหรับ platform/arch/variant
4. การดึง embedded binary แบบ optional เกิดขึ้นสำหรับการกระจายที่คอมไพล์แล้ว
5. Addon ถูกโหลดและ export set ได้รับการตรวจสอบ
6. Wrapper ส่งคืนผลลัพธ์ที่มี type ให้ผู้เรียก

## อภิธานศัพท์

- **Native addon**: ไบนารี `.node` ที่โหลดผ่าน Node-API (N-API)
- **แท็กแพลตฟอร์ม**: tuple ของ runtime `platform-arch` (เช่น `darwin-arm64`)
- **Variant**: รูปแบบ build เฉพาะ CPU ของ x64 (`modern` AVX2, `baseline` fallback)
- **Wrapper**: ฟังก์ชัน/คลาส TS ที่ให้ typed API เหนือ raw native exports
- **Declaration merging**: เทคนิค TS ที่ใช้โดยไฟล์ `types.ts` ของโมดูลเพื่อขยาย `NativeBindings`
- **โหมด compiled binary**: โหมด runtime ที่ CLI ถูกรวมและ native addons ได้รับการค้นหาจากเส้นทาง extracted/cache แทนที่จะใช้เฉพาะเส้นทาง package-local
- **Embedded addon**: metadata ของ build artifact และการอ้างอิงไฟล์ที่สร้างลงใน `embedded-addon.ts` เพื่อให้ไบนารีที่คอมไพล์สามารถดึง payloads ของ `.node` ที่ตรงกัน
- **Validation gate**: การตรวจสอบ `validateNative(...)` ที่ปฏิเสธไบนารีที่ล้าสมัย/ไม่ตรงกันซึ่งขาด exports ที่จำเป็น
