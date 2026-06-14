---
title: รันไทม์ตัวโหลด Addon แบบเนทีฟ
description: >-
  รันไทม์ตัวโหลด addon แบบ N-API พร้อมการตรวจจับแพลตฟอร์ม กลยุทธ์สำรอง
  และการระบุโมดูล
sidebar:
  order: 3
  label: ตัวโหลด Addon
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# รันไทม์ตัวโหลด Addon แบบเนทีฟ

เอกสารนี้อธิบายเชิงลึกเกี่ยวกับเลเยอร์การโหลด/ตรวจสอบความถูกต้องของ addon ใน `@f5xc-salesdemos/pi-natives`: วิธีที่ `native.ts` ตัดสินใจว่าจะโหลดไฟล์ `.node` ใด เมื่อใดที่การแตกไฟล์ payload ที่ฝังอยู่จะทำงาน และวิธีที่ความล้มเหลวในการเริ่มต้นจะถูกรายงาน

## ไฟล์การนำไปใช้งาน

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## ขอบเขตและความรับผิดชอบ

ความรับผิดชอบของตัวโหลด/รันไทม์ถูกกำหนดให้แคบโดยเจตนา:

- สร้างรายการผู้สมัครที่รับรู้แพลตฟอร์ม/CPU สำหรับชื่อไฟล์และไดเรกทอรี addon
- แยกไฟล์ addon ที่ฝังอยู่ไปยังไดเรกทอรีแคชตามเวอร์ชันต่อผู้ใช้โดยเลือกได้
- ลองรายการผู้สมัครตามลำดับที่กำหนดไว้
- ปฏิเสธ addon ที่ล้าสมัยหรือเข้ากันไม่ได้ผ่าน `validateNative` ก่อนเปิดเผย bindings

ไม่อยู่ในขอบเขตที่นี่: พฤติกรรม grep/text/highlight เฉพาะโมดูล

## อินพุตรันไทม์และสถานะที่ได้รับ

เมื่อเริ่มต้นโมดูล (`export const native = loadNative();`) `native.ts` จะคำนวณบริบทแบบสถิต:

- **แท็กแพลตฟอร์ม**: ``${process.platform}-${process.arch}`` (ตัวอย่างเช่น `darwin-arm64`)
- **เวอร์ชันแพ็กเกจ**: จาก `packages/natives/package.json` (ฟิลด์ `version`)
- **ไดเรกทอรีหลัก**:
  - `nativeDir`: `packages/natives/native` ภายในแพ็กเกจ
  - `execDir`: ไดเรกทอรีที่มี `process.execPath`
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`
  - ทางสำรอง `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (หรือ `%USERPROFILE%/AppData/Local/xcsh`)
    - ไม่ใช่ Windows: `~/.local/bin`
- **โหมดไบนารีที่คอมไพล์แล้ว** (`isCompiledBinary`): เป็น true หากมีเงื่อนไขใดต่อไปนี้:
  - ตั้งค่าตัวแปรสภาพแวดล้อม `PI_COMPILED` หรือ
  - `import.meta.url` มีเครื่องหมาย Bun-embedded (`$bunfs`, `~BUN`, `%7EBUN`)
- **การแทนที่ตัวแปร**: `PI_NATIVE_VARIANT` (เฉพาะ `modern`/`baseline`; ค่าที่ไม่ถูกต้องจะถูกละเว้น)
- **ตัวแปรที่เลือก**: การแทนที่ที่ชัดเจน หรือการตรวจจับ AVX2 ที่รันไทม์บน x64 (`modern` หาก AVX2 มีอยู่ มิฉะนั้น `baseline`)

## การรองรับแพลตฟอร์มและการระบุแท็ก

`SUPPORTED_PLATFORMS` ถูกกำหนดไว้ที่:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

รายละเอียดพฤติกรรม:

- แพลตฟอร์มที่ไม่รองรับจะไม่ถูกปฏิเสธล่วงหน้า
- ตัวโหลดยังคงลองรายการผู้สมัครที่คำนวณได้ทั้งหมดก่อน
- หากไม่มีการโหลดใดสำเร็จ ระบบจะโยนข้อผิดพลาดแพลตฟอร์มที่ไม่รองรับโดยแสดงแท็กที่รองรับ

วิธีนี้รักษาการวินิจฉัยที่เป็นประโยชน์สำหรับกรณีที่ใกล้เคียง ในขณะที่ยังคงล้มเหลวอย่างชัดเจนสำหรับเป้าหมายที่ไม่รองรับจริงๆ

## การเลือกตัวแปร (`modern` / `baseline` / ค่าเริ่มต้น)

### พฤติกรรมบน x64

1. หาก `PI_NATIVE_VARIANT` เป็น `modern` หรือ `baseline` ค่านั้นจะถูกใช้
2. มิฉะนั้น ตรวจจับการรองรับ AVX2:
   - Linux: สแกน `/proc/cpuinfo` หาคำว่า `avx2`
   - macOS: สอบถาม `sysctl` (`machdep.cpu.leaf7_features` ทางสำรองคือ `machdep.cpu.features`)
   - Windows: รัน PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`
3. ผลลัพธ์:
   - AVX2 พร้อมใช้งาน -> `modern`
   - AVX2 ไม่พร้อมใช้งาน/ตรวจจับไม่ได้ -> `baseline`

### พฤติกรรมบนสถาปัตยกรรมที่ไม่ใช่ x64

- ไม่มีการใช้ตัวแปร; ตัวโหลดใช้ชื่อไฟล์เริ่มต้น (`pi_natives.<platform>-<arch>.node`)

### การสร้างชื่อไฟล์

กำหนด `tag = <platform>-<arch>`:

- ไม่ใช่ x64 หรือไม่มีตัวแปร: `pi_natives.<tag>.node`
- x64 + `modern`: ลองตามลำดับ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (ทางสำรองโดยเจตนา)
- x64 + `baseline`: เฉพาะ `pi_natives.<tag>-baseline.node`

`addonLabel` ที่ใช้ในข้อความแสดงข้อผิดพลาดสุดท้ายคือ `<tag>` หรือ `<tag> (<variant>)`

## การสร้างพาธผู้สมัครและลำดับทางสำรอง

`native.ts` สร้างกลุ่มผู้สมัครก่อนการเรียก `require(...)` ใดๆ

### รายการผู้สมัครรีลีส

สร้างจากรายการชื่อไฟล์ที่ระบุตัวแปรแล้ว และค้นหาตามลำดับนี้:

- **รันไทม์ที่ไม่ได้คอมไพล์**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **รันไทม์ที่คอมไพล์แล้ว** (`PI_COMPILED` หรือ Bun embedded markers):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` จะลบรายการซ้ำในขณะที่รักษาลำดับการปรากฏครั้งแรก

### ลำดับรันไทม์สุดท้าย

เมื่อโหลด:

1. รายการผู้สมัครที่แตกไฟล์ที่ฝังอยู่โดยเลือกได้ (หากผลิตได้) จะถูกแทรกไว้ที่ด้านหน้า
2. รายการผู้สมัครที่ลบรายการซ้ำที่เหลือจะถูกลองตามลำดับ
3. รายการผู้สมัครแรกที่ทั้ง `require(...)` และผ่าน `validateNative(...)` จะชนะ

## วงจรชีวิตการแตกไฟล์ addon ที่ฝังอยู่

`embedded-addon.ts` กำหนดรูปแบบ manifest ที่สร้างขึ้น:

- `platformTag`
- `version`
- `files[]` โดยแต่ละรายการมี `variant`, `filename`, `filePath`

ค่าเริ่มต้นที่ตรวจสอบในปัจจุบันคือ `embeddedAddon: null`; อาร์ติแฟกต์ที่คอมไพล์แล้วอาจแทนที่ด้วยข้อมูลเมตาจริง

### สเตตแมชชีนการแตกไฟล์

การแตกไฟล์ (`maybeExtractEmbeddedAddon`) จะทำงานเฉพาะเมื่อผ่านเงื่อนไขทั้งหมด:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. พบไฟล์ที่ฝังอยู่ที่เหมาะสมกับตัวแปร

การเลือกไฟล์ตัวแปรสะท้อนถึงความตั้งใจของตัวแปรรันไทม์:

- ไม่ใช่ x64: ต้องการ `default` จากนั้นไฟล์แรกที่มี
- x64 + `modern`: ต้องการ `modern` ทางสำรองคือ `baseline`
- x64 + `baseline`: ต้องการ `baseline`

พฤติกรรมการสร้างไฟล์:

1. ตรวจสอบว่ามี `<versionedDir>` อยู่ (`mkdirSync(..., { recursive: true })`)
2. หาก `<versionedDir>/<selected filename>` มีอยู่แล้ว ให้นำกลับมาใช้ (ไม่เขียนซ้ำ)
3. มิฉะนั้น อ่านต้นฉบับที่ฝังอยู่ `filePath` และเขียนไฟล์เป้าหมาย
4. คืนค่าพาธเป้าหมายสำหรับการลองโหลดที่มีลำดับสูงสุด

เมื่อเกิดความล้มเหลว การแตกไฟล์จะไม่หยุดทำงานทันที แต่จะเพิ่มรายการข้อผิดพลาด (การสร้างไดเรกทอรีหรือความล้มเหลวในการเขียน) และตัวโหลดจะดำเนินการตรวจสอบรายการผู้สมัครปกติต่อไป

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

## การตรวจสอบสัญญา `validateNative`

`validateNative(bindings, source)` บังคับใช้สัญญาเฉพาะฟังก์ชันเหนือ `NativeBindings` เมื่อเริ่มต้น

กลไก:

- สำหรับชื่อการส่งออกที่ต้องการแต่ละชื่อ จะตรวจสอบ `typeof bindings[name] === "function"`
- ชื่อที่ขาดหายไปจะถูกรวบรวม
- หากมีชื่อขาดหายไป ตัวโหลดจะโยน:
  - พาธ addon ต้นทาง,
  - รายการการส่งออกที่ขาดหายไป,
  - คำแนะนำคำสั่งสร้างใหม่

นี่คือเกตความเข้ากันได้แบบเข้มงวดสำหรับไบนารีที่ล้าสมัย บิลด์บางส่วน และการเปลี่ยนแปลง symbol/ชื่อ

### การแมป JS API ↔ native export (เกตการตรวจสอบ)

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

หมายเหตุ: `bindings.ts` ประกาศเฉพาะสมาชิก `cancelWork(id)` พื้นฐาน; ไฟล์ `types.ts` ของโมดูลจะผสานการประกาศสัญลักษณ์เพิ่มเติมที่ `validateNative` บังคับใช้

## พฤติกรรมความล้มเหลวและการวินิจฉัย

## แพลตฟอร์มที่ไม่รองรับ

หากรายการผู้สมัครทั้งหมดล้มเหลวและ `platformTag` ไม่อยู่ใน `SUPPORTED_PLATFORMS` ตัวโหลดจะโยน:

- `Unsupported platform: <tag>`
- รายการแพลตฟอร์มที่รองรับทั้งหมด
- คำแนะนำการรายงานปัญหาอย่างชัดเจน

## อาการของไบนารีล้าสมัย / ไม่ตรงกัน

สัญญาณความไม่ตรงกันที่ล้าสมัยทั่วไป:

- `Native addon missing exports (<candidate>). Missing: ...`

สาเหตุทั่วไป:

- ไบนารี `.node` เก่าจากเวอร์ชันแพ็กเกจ/รูปแบบ API ก่อนหน้า
- เลือกอาร์ติแฟกต์ตัวแปรผิด (สำหรับ x64)
- การส่งออก Rust ใหม่ที่ไม่มีอยู่ในอาร์ติแฟกต์ที่โหลด

พฤติกรรมตัวโหลด:

- บันทึกความล้มเหลวการส่งออกขาดหายไปต่อรายการผู้สมัคร
- ดำเนินการตรวจสอบรายการผู้สมัครที่เหลือต่อไป
- หากไม่มีรายการผู้สมัครใดผ่านการตรวจสอบ ข้อผิดพลาดสุดท้ายจะรวมทุกพาธที่ลองพร้อมข้อความความล้มเหลวแต่ละรายการ

## ความล้มเหลวในการเริ่มต้นไบนารีที่คอมไพล์แล้ว

ในโหมดที่คอมไพล์แล้ว การวินิจฉัยสุดท้ายประกอบด้วย:

- พาธเป้าหมายแคชตามเวอร์ชันที่คาดหวัง (`<versionedDir>/<filename>`),
- การแก้ไขเพื่อลบ `<versionedDir>` ที่ล้าสมัยและรันใหม่,
- คำสั่ง `curl` สำหรับดาวน์โหลดรีลีสโดยตรงสำหรับแต่ละชื่อไฟล์ที่คาดหวัง

## ความล้มเหลวในการเริ่มต้นที่ไม่ได้คอมไพล์

ในโหมดแพ็กเกจ/รันไทม์ปกติ การวินิจฉัยสุดท้ายประกอบด้วย:

- คำแนะนำการติดตั้งใหม่ (`bun install @f5xc-salesdemos/pi-natives`),
- คำสั่งสร้างใหม่ภายในเครื่อง (`bun --cwd=packages/natives run build`),
- คำแนะนำการสร้างตัวแปร x64 โดยเลือกได้ (`TARGET_VARIANT=baseline|modern ...`)

## พฤติกรรมรันไทม์

- ตัวโหลดใช้สายรายการผู้สมัครรีลีสเสมอ
- การตั้งค่า `PI_DEV` จะเปิดใช้งานเฉพาะการวินิจฉัยคอนโซลต่อรายการผู้สมัคร (`Loaded native addon...` และข้อผิดพลาดการโหลด)
