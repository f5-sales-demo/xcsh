---
title: สถาปัตยกรรม Natives
description: >-
  สถาปัตยกรรม native addon แบบ Rust N-API ที่เชื่อมต่อระหว่าง TypeScript
  และการดำเนินการเฉพาะแพลตฟอร์ม
sidebar:
  order: 1
  label: สถาปัตยกรรม
i18n:
  sourceHash: d38ed2437bb7
  translator: machine
---

# สถาปัตยกรรม Natives

`@f5-sales-demo/pi-natives` เป็นสแต็กสามชั้น:

1. **ชั้น TypeScript wrapper/API** เปิดเผย entrypoint แบบ JS/TS ที่มีความเสถียร
2. **ชั้นโหลด/ตรวจสอบ Addon** ค้นหาและตรวจสอบไบนารี `.node` สำหรับ runtime ปัจจุบัน
3. **ชั้นโมดูล Rust N-API** ที่ implement primitives ที่ต้องการประสิทธิภาพสูงและส่งออกไปยัง JS

เอกสารนี้เป็นรากฐานสำหรับเอกสารระดับโมดูลที่ลึกยิ่งขึ้น

## ไฟล์ที่ implement

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## ชั้นที่ 1: ชั้น TypeScript wrapper/API

`packages/natives/src/index.ts` คือ public barrel โดยจัดกลุ่ม export ตามโดเมนความสามารถ และ re-export typed wrappers แทนที่จะเปิดเผย raw N-API bindings โดยตรง

กลุ่มระดับบนสุดในปัจจุบัน:

- **Search/text primitives**: `grep`, `glob`, `text`, `highlight`
- **Execution/process/terminal primitives**: `shell`, `pty`, `ps`, `keys`
- **System/media/conversion primitives**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` กำหนด contract ของ interface พื้นฐาน:

- `NativeBindings` เริ่มต้นด้วย shared members (`cancelWork(id: number)`)
- binding เฉพาะโมดูลถูกเพิ่มโดย declaration merging จาก `types.ts` ของแต่ละโมดูล
- `Cancellable` กำหนดมาตรฐาน option ของ timeout และ abort-signal สำหรับ wrapper ที่เปิดเผยการยกเลิก

**Contract ที่รับประกัน (ด้าน API):** ผู้ใช้งาน import จาก `@f5-sales-demo/pi-natives` และใช้ typed wrappers

**รายละเอียด implement (อาจเปลี่ยนแปลงได้):** declaration merging และ layout ภายในของ wrapper (`src/<module>/index.ts`, `src/<module>/types.ts`)

## ชั้นที่ 2: การโหลดและตรวจสอบ Addon

`packages/natives/src/native.ts` จัดการการเลือก addon ในเวลา runtime การแตกไฟล์แบบ optional และการตรวจสอบ export

### รูปแบบการค้นหา Candidate

- Platform tag คือ `"${process.platform}-${process.arch}"`
- tags ที่รองรับในปัจจุบัน:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 สามารถใช้ CPU variants ได้:
  - `modern` (รองรับ AVX2)
  - `baseline` (fallback)
- non-x64 ใช้ filename เริ่มต้น (ไม่มี variant suffix)

กลยุทธ์ชื่อไฟล์:

- Release: `pi_natives.<platform>-<arch>.node`
- x64 variant release: `pi_natives.<platform>-<arch>-modern.node` และ/หรือ `...-baseline.node`
- `PI_DEV` เปิดใช้งาน loader diagnostics แต่ไม่เปลี่ยนชื่อไฟล์ addon

### การตรวจจับ Variant เฉพาะแพลตฟอร์ม

สำหรับ x64 การเลือก variant ใช้:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: PowerShell ตรวจสอบ `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` สามารถบังคับให้ใช้ `modern` หรือ `baseline` ได้อย่างชัดเจน

### รูปแบบการแจกจ่ายและแตกไฟล์ไบนารี

`packages/natives/package.json` รวมทั้ง `src` และ `native` ไว้ในไฟล์ที่เผยแพร่ โดยไดเรกทอรี `native/` เก็บ artifact ของแพลตฟอร์มที่สร้างไว้ล่วงหน้า

สำหรับไบนารีที่คอมไพล์แล้ว (`PI_COMPILED` หรือ Bun embedded runtime markers) พฤติกรรมของ loader คือ:

1. ตรวจสอบ versioned user cache path: `<getNativesDir()>/<packageVersion>/...`
2. ตรวจสอบตำแหน่ง compiled-binary แบบ legacy:
   - Windows: `%LOCALAPPDATA%/xcsh` (fallback `%USERPROFILE%/AppData/Local/xcsh`)
   - non-Windows: `~/.local/bin`
3. ใช้ `native/` ที่แพ็กเกจมาและ candidates ในไดเรกทอรีของ executable เป็น fallback

หาก embedded addon manifest มีอยู่ (`embedded-addon.ts` ที่สร้างโดย `scripts/embed-native.ts`) `native.ts` สามารถแตกไบนารีที่ฝังตรงกันไปยังไดเรกทอรี versioned cache ก่อนโหลด

### การตรวจสอบและโหมดความล้มเหลว

หลังจาก `require(candidate)` แล้ว `validateNative(...)` จะตรวจสอบ export ที่จำเป็น (เช่น `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`)

เส้นทางความล้มเหลวมีการระบุชัดเจน:

- **Platform tag ที่ไม่รองรับ**: throw พร้อมรายการแพลตฟอร์มที่รองรับ
- **ไม่มี candidate ที่โหลดได้**: throw พร้อมเส้นทางทั้งหมดที่ลองแล้วและคำแนะนำในการแก้ไข
- **Export ที่ขาดหายไป**: throw พร้อมชื่อที่ขาดหายไปและคำสั่ง rebuild
- **ข้อผิดพลาดการแตก embedded**: บันทึกความล้มเหลวของไดเรกทอรี/การเขียน และรวมไว้ใน load diagnostics สุดท้าย

**Contract ที่รับประกัน (ด้าน API):** การโหลด addon จะสำเร็จพร้อม binding set ที่ตรวจสอบแล้ว หรือล้มเหลวอย่างรวดเร็วพร้อมข้อความแสดงข้อผิดพลาดที่นำไปดำเนินการได้

**รายละเอียด implement (อาจเปลี่ยนแปลงได้):** ลำดับการค้นหา candidate และการเรียงลำดับ fallback path ของ compiled-binary

## ชั้นที่ 3: ชั้นโมดูล Rust N-API

`crates/pi-natives/src/lib.rs` คือ Rust entry module ที่ประกาศความเป็นเจ้าของโมดูลที่ส่งออก:

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

โมดูลเหล่านี้ implement สัญลักษณ์ N-API ที่ถูกใช้งานและตรวจสอบโดย `native.ts` โดยชื่อระดับ JS จะถูกแสดงผ่าน TS wrappers ใน `packages/natives/src`

**Contract ที่รับประกัน (ด้าน API):** export ของโมดูล Rust ต้องตรงกับชื่อ binding ที่คาดหวังโดย `validateNative` และโมดูล wrapper

**รายละเอียด implement (อาจเปลี่ยนแปลงได้):** การแบ่งโมดูล Rust ภายในและขอบเขตของโมดูลตัวช่วย (`glob_util`, `task` ฯลฯ)

## ขอบเขตความเป็นเจ้าของ

ในระดับสถาปัตยกรรม ความเป็นเจ้าของแบ่งดังนี้:

- **TS wrapper/API ownership (`packages/natives/src`)**
  - การจัดกลุ่ม public API การกำหนดประเภท option และ JS ergonomics ที่เสถียร
  - surface การยกเลิก (`timeoutMs`, `AbortSignal`) ที่เปิดเผยแก่ผู้เรียก
- **Loader ownership (`packages/natives/src/native.ts`)**
  - การเลือกไบนารีในเวลา runtime
  - การเลือก CPU variant และการจัดการ override
  - การแตก compiled-binary และการตรวจสอบ candidate
  - การตรวจสอบแบบ hard ของ native exports ที่จำเป็น
- **Rust ownership (`crates/pi-natives/src`)**
  - การ implement เชิงอัลกอริทึมและระดับระบบ
  - พฤติกรรมเฉพาะแพลตฟอร์มและ logic ที่ต้องการประสิทธิภาพสูง
  - การ implement สัญลักษณ์ N-API ที่ TS wrappers ใช้งาน

## ขั้นตอนการทำงาน runtime (ภาพรวม)

1. ผู้ใช้งาน import จาก `@f5-sales-demo/pi-natives`
2. โมดูล wrapper เรียกใช้ singleton `native` binding
3. `native.ts` เลือกไบนารี candidate สำหรับ platform/arch/variant
4. การแตก embedded binary แบบ optional เกิดขึ้นสำหรับ compiled distributions
5. Addon ถูกโหลดและชุด export ถูกตรวจสอบ
6. Wrapper คืนค่าผลลัพธ์แบบ typed ให้ผู้เรียก

## อภิธานศัพท์

- **Native addon**: ไบนารี `.node` ที่โหลดผ่าน Node-API (N-API)
- **Platform tag**: tuple ของ runtime `platform-arch` (เช่น `darwin-arm64`)
- **Variant**: flavor ของการสร้างเฉพาะ CPU x64 (`modern` AVX2, `baseline` fallback)
- **Wrapper**: TS function/class ที่ให้ typed API เหนือ raw native exports
- **Declaration merging**: เทคนิค TS ที่ใช้โดยไฟล์ `types.ts` ของโมดูลเพื่อขยาย `NativeBindings`
- **Compiled binary mode**: โหมด runtime ที่ CLI ถูกบันเดิลและ native addons ถูกค้นหาจากเส้นทาง extracted/cache แทนที่จะเป็นเฉพาะเส้นทาง package-local
- **Embedded addon**: metadata ของ build artifact และการอ้างอิงไฟล์ที่สร้างลงใน `embedded-addon.ts` เพื่อให้ compiled binaries สามารถแตก payload `.node` ที่ตรงกันได้
- **Validation gate**: การตรวจสอบ `validateNative(...)` ที่ปฏิเสธไบนารีที่ล้าสมัย/ไม่ตรงกัน ซึ่งขาด export ที่จำเป็น
