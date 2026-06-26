---
title: รันไทม์ตัวโหลด Addon ของ Natives
description: >-
  รันไทม์ตัวโหลด addon ของ N-API พร้อมการตรวจจับแพลตฟอร์ม กลยุทธ์การสำรอง
  และการแก้ไขโมดูล
sidebar:
  order: 3
  label: ตัวโหลด Addon
i18n:
  sourceHash: 743ea3e32c7c
  translator: machine
---

# รันไทม์ตัวโหลด Addon ของ Natives

เอกสารนี้เจาะลึกชั้นการโหลด/การตรวจสอบ addon ใน `@f5-sales-demo/pi-natives`: วิธีที่ `native.ts` ตัดสินใจว่าจะโหลดไฟล์ `.node` ใด เมื่อใดที่การแตกไฟล์ payload ที่ฝังไว้จะทำงาน และวิธีรายงานความล้มเหลวในการเริ่มต้น

## ไฟล์การนำไปใช้งาน

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## ขอบเขตและความรับผิดชอบ

ความรับผิดชอบของตัวโหลด/รันไทม์มีขอบเขตจำกัดโดยเจตนา:

- สร้างรายการผู้สมัครที่รองรับแพลตฟอร์ม/CPU สำหรับชื่อไฟล์ addon และไดเรกทอรี
- สร้าง addon ที่ฝังไว้ในไดเรกทอรีแคชตามเวอร์ชันต่อผู้ใช้ตามต้องการ
- ลองผู้สมัครตามลำดับที่กำหนด
- ปฏิเสธ addon ที่ล้าสมัยหรือไม่เข้ากันผ่าน `validateNative` ก่อนเปิดเผย bindings

นอกขอบเขตที่นี่: พฤติกรรม grep/text/highlight ที่เฉพาะเจาะจงกับโมดูล

## อินพุตรันไทม์และสถานะที่ได้มา

ที่การเริ่มต้นโมดูล (`export const native = loadNative();`) `native.ts` คำนวณบริบทแบบสถิต:

- **แท็กแพลตฟอร์ม**: ``${process.platform}-${process.arch}`` (เช่น `darwin-arm64`)
- **เวอร์ชันแพ็กเกจ**: จาก `packages/natives/package.json` (ฟิลด์ `version`)
- **ไดเรกทอรีหลัก**:
  - `nativeDir`: `packages/natives/native` ในแพ็กเกจ
  - `execDir`: ไดเรกทอรีที่มี `process.execPath`
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`
  - ทางสำรอง `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (หรือ `%USERPROFILE%/AppData/Local/xcsh`)
    - ที่ไม่ใช่ Windows: `~/.local/bin`
- **โหมดไบนารีที่คอมไพล์แล้ว** (`isCompiledBinary`): true หากมีข้อใดข้อหนึ่งต่อไปนี้:
  - ตัวแปรสภาพแวดล้อม `PI_COMPILED` ถูกตั้งค่า หรือ
  - `import.meta.url` มีเครื่องหมาย Bun-embedded (`$bunfs`, `~BUN`, `%7EBUN`)
- **การแทนที่ variant**: `PI_NATIVE_VARIANT` (เฉพาะ `modern`/`baseline`; ค่าที่ไม่ถูกต้องจะถูกละเว้น)
- **variant ที่เลือก**: การแทนที่อย่างชัดเจน มิฉะนั้นใช้การตรวจจับ AVX2 รันไทม์บน x64 (`modern` หาก AVX2 มิฉะนั้น `baseline`)

## การรองรับแพลตฟอร์มและการแก้ไขแท็ก

`SUPPORTED_PLATFORMS` ถูกกำหนดไว้สำหรับ:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

รายละเอียดพฤติกรรม:

- แพลตฟอร์มที่ไม่รองรับจะไม่ถูกปฏิเสธล่วงหน้า
- ตัวโหลดยังคงลองผู้สมัครที่คำนวณทั้งหมดก่อน
- หากไม่มีสิ่งใดโหลดได้ จะส่งข้อผิดพลาดแพลตฟอร์มที่ไม่รองรับอย่างชัดเจนพร้อมรายการแท็กที่รองรับ

การทำเช่นนี้รักษาการวินิจฉัยที่มีประโยชน์สำหรับกรณีที่ใกล้เคียง ขณะที่ยังคงล้มเหลวอย่างชัดเจนสำหรับเป้าหมายที่ไม่รองรับจริงๆ

## การเลือก variant (`modern` / `baseline` / ค่าเริ่มต้น)

### พฤติกรรม x64

1. หาก `PI_NATIVE_VARIANT` เป็น `modern` หรือ `baseline` ค่านั้นจะชนะ
2. มิฉะนั้นตรวจจับการรองรับ AVX2:
   - Linux: สแกน `/proc/cpuinfo` เพื่อหา `avx2`
   - macOS: สอบถาม `sysctl` (`machdep.cpu.leaf7_features` ทางสำรอง `machdep.cpu.features`)
   - Windows: รัน PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`
3. ผลลัพธ์:
   - AVX2 พร้อมใช้งาน -> `modern`
   - AVX2 ไม่พร้อมใช้งาน/ตรวจจับไม่ได้ -> `baseline`

### พฤติกรรมที่ไม่ใช่ x64

- ไม่มีการใช้ variant; ตัวโหลดยังคงใช้ชื่อไฟล์เริ่มต้น (`pi_natives.<platform>-<arch>.node`)

### การสร้างชื่อไฟล์

กำหนด `tag = <platform>-<arch>`:

- ที่ไม่ใช่ x64 หรือไม่มี variant: `pi_natives.<tag>.node`
- x64 + `modern`: ลองตามลำดับ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (ทางสำรองโดยเจตนา)
- x64 + `baseline`: เฉพาะ `pi_natives.<tag>-baseline.node`

`addonLabel` ที่ใช้ในข้อความแสดงข้อผิดพลาดสุดท้ายคือ `<tag>` หรือ `<tag> (<variant>)`

## การสร้างเส้นทางผู้สมัครและลำดับทางสำรอง

`native.ts` สร้างกลุ่มผู้สมัครก่อนการเรียก `require(...)` ใดๆ

### ผู้สมัครรีลีส

สร้างจากรายการชื่อไฟล์ที่แก้ไข variant แล้ว และค้นหาตามลำดับนี้:

- **รันไทม์ที่ไม่ได้คอมไพล์**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **รันไทม์ที่คอมไพล์แล้ว** (`PI_COMPILED` หรือเครื่องหมาย Bun embedded):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` ลบรายการซ้ำขณะรักษาลำดับการปรากฏครั้งแรก

### ลำดับรันไทม์สุดท้าย

ในเวลาโหลด:

1. ผู้สมัครการแตกไฟล์ที่ฝังไว้แบบเสริม (หากผลิต) จะถูกแทรกไว้ที่หน้า
2. ผู้สมัครที่ซ้ำกำจัดแล้วที่เหลือจะถูกลองตามลำดับ
3. ผู้สมัครแรกที่ทั้ง `require(...)` ได้และผ่าน `validateNative(...)` จะชนะ

## วงจรชีวิตการแตกไฟล์ addon ที่ฝังไว้

`embedded-addon.ts` กำหนดรูปร่าง manifest ที่สร้างขึ้น:

- `platformTag`
- `version`
- `files[]` โดยแต่ละรายการมี `variant`, `filename`, `filePath`

ค่าเริ่มต้นที่ตรวจสอบในปัจจุบันคือ `embeddedAddon: null`; อาร์ติแฟกต์ที่คอมไพล์แล้วอาจแทนที่ด้วยข้อมูลเมตาจริง

### เครื่องสถานะการแตกไฟล์

การแตกไฟล์ (`maybeExtractEmbeddedAddon`) ทำงานเฉพาะเมื่อผ่านเงื่อนไขทั้งหมด:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. พบไฟล์ที่ฝังไว้ที่เหมาะสมกับ variant

การเลือกไฟล์ variant สะท้อนความตั้งใจ variant รันไทม์:

- ที่ไม่ใช่ x64: ต้องการ `default` จากนั้นไฟล์แรกที่มี
- x64 + `modern`: ต้องการ `modern` ทางสำรองเป็น `baseline`
- x64 + `baseline`: ต้องการ `baseline`

พฤติกรรมการสร้างไฟล์:

1. ตรวจสอบให้แน่ใจว่า `<versionedDir>` มีอยู่ (`mkdirSync(..., { recursive: true })`)
2. หาก `<versionedDir>/<selected filename>` มีอยู่แล้ว ให้ใช้ซ้ำ (ไม่เขียนใหม่)
3. มิฉะนั้น อ่านต้นฉบับที่ฝัง `filePath` และเขียนไฟล์เป้าหมาย
4. ส่งคืนเส้นทางเป้าหมายสำหรับการพยายามโหลดลำดับความสำคัญสูงสุด

เมื่อล้มเหลว การแตกไฟล์จะไม่หยุดทำงานทันที; แต่จะเพิ่มรายการข้อผิดพลาด (การสร้างไดเรกทอรีหรือความล้มเหลวในการเขียน) และตัวโหลดดำเนินการตรวจสอบผู้สมัครตามปกติต่อไป

## วงจรชีวิตและการเปลี่ยนสถานะ

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## การตรวจสอบข้อกำหนดของ `validateNative`

`validateNative(bindings, source)` บังคับใช้ข้อกำหนดเฉพาะฟังก์ชันเหนือ `NativeBindings` เมื่อเริ่มต้น

กลไก:

- สำหรับชื่อ export ที่ต้องการแต่ละรายการ จะตรวจสอบ `typeof bindings[name] === "function"`
- ชื่อที่หายไปจะถูกรวบรวม
- หากมีชื่อที่หายไป ตัวโหลดจะส่ง:
  - เส้นทาง addon ต้นทาง
  - รายการ export ที่หายไป
  - คำแนะนำคำสั่ง rebuild

นี่คือประตูความเข้ากันได้แบบเข้มงวดสำหรับไบนารีที่ล้าสมัย การสร้างบางส่วน และการเลื่อนหลุดของ symbol/ชื่อ

### การแมป JS API ↔ native export (ประตูการตรวจสอบ)

| ชื่อ JS binding ที่ตรวจสอบใน `validateNative` | ชื่อ native export ที่คาดหวัง |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

หมายเหตุ: `bindings.ts` ประกาศเฉพาะสมาชิก `cancelWork(id)` พื้นฐาน; ไฟล์ `types.ts` ของโมดูลรวม declaration-merge สัญลักษณ์เพิ่มเติมที่ `validateNative` บังคับใช้

## พฤติกรรมความล้มเหลวและการวินิจฉัย

## แพลตฟอร์มที่ไม่รองรับ

หากผู้สมัครทั้งหมดล้มเหลวและ `platformTag` ไม่อยู่ใน `SUPPORTED_PLATFORMS` ตัวโหลดจะส่ง:

- `Unsupported platform: <tag>`
- รายการแพลตฟอร์มที่รองรับทั้งหมด
- คำแนะนำการรายงานปัญหาอย่างชัดเจน

## อาการไบนารีล้าสมัย / ไม่ตรงกัน

สัญญาณความไม่ตรงกันของสิ่งล้าสมัยที่พบบ่อย:

- `Native addon missing exports (<candidate>). Missing: ...`

สาเหตุทั่วไป:

- ไบนารี `.node` เก่าจากเวอร์ชันแพ็กเกจ/รูปร่าง API ก่อนหน้า
- อาร์ติแฟกต์ variant ผิดที่เลือกสำหรับ x64
- การ export ของ Rust ใหม่ที่ไม่มีในอาร์ติแฟกต์ที่โหลด

พฤติกรรมตัวโหลด:

- บันทึกความล้มเหลวของ missing-export ต่อผู้สมัคร
- ดำเนินการตรวจสอบผู้สมัครที่เหลือต่อไป
- หากไม่มีผู้สมัครผ่านการตรวจสอบ ข้อผิดพลาดสุดท้ายจะรวมทุกเส้นทางที่พยายามพร้อมข้อความความล้มเหลวแต่ละรายการ

## ความล้มเหลวในการเริ่มต้นไบนารีที่คอมไพล์แล้ว

ในโหมดที่คอมไพล์แล้ว การวินิจฉัยสุดท้ายประกอบด้วย:

- เส้นทางเป้าหมายแคชตามเวอร์ชันที่คาดหวัง (`<versionedDir>/<filename>`)
- การแก้ไขเพื่อลบ `<versionedDir>` ที่ล้าสมัยและรันใหม่
- คำสั่ง `curl` ดาวน์โหลดรีลีสโดยตรงสำหรับแต่ละชื่อไฟล์ที่คาดหวัง

## ความล้มเหลวในการเริ่มต้นที่ไม่ได้คอมไพล์

ในโหมดแพ็กเกจ/รันไทม์ปกติ การวินิจฉัยสุดท้ายประกอบด้วย:

- คำแนะนำการติดตั้งใหม่ (`bun install @f5-sales-demo/pi-natives`)
- คำสั่ง rebuild ในพื้นที่ (`bun --cwd=packages/natives run build`)
- คำแนะนำการ build variant x64 แบบเสริม (`TARGET_VARIANT=baseline|modern ...`)

## พฤติกรรมรันไทม์

- ตัวโหลดใช้ chain ผู้สมัครรีลีสเสมอ
- การตั้งค่า `PI_DEV` เปิดใช้งานเฉพาะการวินิจฉัย console ต่อผู้สมัคร (`Loaded native addon...` และข้อผิดพลาดในการโหลด)
