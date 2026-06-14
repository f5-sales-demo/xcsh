---
title: Natives Addon Loader Runtime
description: >-
  N-API addon loader runtime พร้อมการตรวจจับแพลตฟอร์ม กลยุทธ์สำรอง
  และการแก้ไขโมดูล
sidebar:
  order: 3
  label: ตัวโหลด Addon
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Natives Addon Loader Runtime

เอกสารนี้เจาะลึกเลเยอร์การโหลด/ตรวจสอบ addon ใน `@f5xc-salesdemos/pi-natives`: วิธีที่ `native.ts` ตัดสินใจว่าจะโหลดไฟล์ `.node` ใด เมื่อใดที่การแตกไฟล์ payload แบบฝังตัวทำงาน และวิธีรายงานความล้มเหลวในการเริ่มต้น

## ไฟล์การนำไปใช้งาน

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## ขอบเขตและความรับผิดชอบ

ความรับผิดชอบของตัวโหลด/runtime มีขอบเขตแคบโดยเจตนา:

- สร้างรายการผู้สมัครที่รับรู้แพลตฟอร์ม/CPU สำหรับชื่อไฟล์และไดเรกทอรี addon
- แปลง addon แบบฝังตัวเป็นไดเรกทอรีแคชต่อผู้ใช้ที่มีเวอร์ชันตามต้องการ
- ลองผู้สมัครตามลำดับที่แน่นอน
- ปฏิเสธ addon ที่ล้าสมัยหรือไม่เข้ากันได้ผ่าน `validateNative` ก่อนเปิดเผย bindings

นอกขอบเขตที่นี่: พฤติกรรม grep/text/highlight เฉพาะโมดูล

## อินพุต Runtime และสถานะที่ได้มา

ที่การเริ่มต้นโมดูล (`export const native = loadNative();`), `native.ts` คำนวณบริบทแบบสถิต:

- **แท็กแพลตฟอร์ม**: ``${process.platform}-${process.arch}`` (ตัวอย่าง `darwin-arm64`)
- **เวอร์ชันแพ็กเกจ**: จาก `packages/natives/package.json` (ฟิลด์ `version`)
- **ไดเรกทอรีหลัก**:
  - `nativeDir`: `packages/natives/native` ในแพ็กเกจ
  - `execDir`: ไดเรกทอรีที่มี `process.execPath`
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`
  - ทางสำรอง `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (หรือ `%USERPROFILE%/AppData/Local/xcsh`)
    - ไม่ใช่ Windows: `~/.local/bin`
- **โหมดไบนารีที่คอมไพล์แล้ว** (`isCompiledBinary`): true หากมีสิ่งใดสิ่งหนึ่งต่อไปนี้:
  - ตัวแปรสภาพแวดล้อม `PI_COMPILED` ถูกตั้งค่า หรือ
  - `import.meta.url` มีตัวบ่งชี้ Bun แบบฝังตัว (`$bunfs`, `~BUN`, `%7EBUN`)
- **การแทนที่ Variant**: `PI_NATIVE_VARIANT` (`modern`/`baseline` เท่านั้น; ค่าที่ไม่ถูกต้องจะถูกละเว้น)
- **Variant ที่เลือก**: การแทนที่ที่ชัดเจน มิฉะนั้นการตรวจจับ AVX2 ขณะ runtime บน x64 (`modern` หาก AVX2 มิฉะนั้น `baseline`)

## การรองรับแพลตฟอร์มและการแก้ไขแท็ก

`SUPPORTED_PLATFORMS` กำหนดไว้ที่:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

รายละเอียดพฤติกรรม:

- แพลตฟอร์มที่ไม่รองรับจะไม่ถูกปฏิเสธล่วงหน้า
- ตัวโหลดยังคงลองผู้สมัครที่คำนวณแล้วทั้งหมดก่อน
- หากไม่มีสิ่งใดโหลด ระบบจะโยนข้อผิดพลาดแพลตฟอร์มที่ไม่รองรับอย่างชัดเจนพร้อมรายการแท็กที่รองรับ

สิ่งนี้รักษาการวินิจฉัยที่มีประโยชน์สำหรับกรณีที่ใกล้เคียง ในขณะที่ยังคงล้มเหลวอย่างหนักสำหรับเป้าหมายที่ไม่รองรับอย่างแท้จริง

## การเลือก Variant (`modern` / `baseline` / ค่าเริ่มต้น)

### พฤติกรรม x64

1. หาก `PI_NATIVE_VARIANT` คือ `modern` หรือ `baseline` ค่านั้นจะชนะ
2. มิฉะนั้นตรวจจับการรองรับ AVX2:
   - Linux: สแกน `/proc/cpuinfo` สำหรับ `avx2`
   - macOS: สอบถาม `sysctl` (`machdep.cpu.leaf7_features`, ทางสำรอง `machdep.cpu.features`)
   - Windows: รัน PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`
3. ผลลัพธ์:
   - AVX2 พร้อมใช้งาน -> `modern`
   - AVX2 ไม่พร้อมใช้งาน/ตรวจจับไม่ได้ -> `baseline`

### พฤติกรรมที่ไม่ใช่ x64

- ไม่ใช้ variant; ตัวโหลดยังคงใช้ชื่อไฟล์เริ่มต้น (`pi_natives.<platform>-<arch>.node`)

### การสร้างชื่อไฟล์

กำหนด `tag = <platform>-<arch>`:

- ไม่ใช่ x64 หรือไม่มี variant: `pi_natives.<tag>.node`
- x64 + `modern`: ลองตามลำดับ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (ทางสำรองโดยเจตนา)
- x64 + `baseline`: เฉพาะ `pi_natives.<tag>-baseline.node`

`addonLabel` ที่ใช้ในข้อความผิดพลาดสุดท้ายคือ `<tag>` หรือ `<tag> (<variant>)`

## การสร้างเส้นทางผู้สมัครและลำดับทางสำรอง

`native.ts` สร้างกลุ่มผู้สมัครก่อนการเรียก `require(...)` ใดๆ

### ผู้สมัคร Release

สร้างจากรายการชื่อไฟล์ที่แก้ไข variant แล้วและค้นหาตามลำดับนี้:

- **Runtime ที่ไม่ได้คอมไพล์**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime ที่คอมไพล์แล้ว** (`PI_COMPILED` หรือตัวบ่งชี้ Bun แบบฝังตัว):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` ลบรายการที่ซ้ำกันออกในขณะที่รักษาลำดับการเกิดขึ้นครั้งแรก

### ลำดับ Runtime สุดท้าย

ขณะโหลด:

1. ผู้สมัครการแตกไฟล์แบบฝังตัวที่เลือกไว้ (หากสร้างขึ้น) จะถูกแทรกไว้ด้านหน้า
2. ผู้สมัครที่ซ้ำกันที่เหลือจะถูกลองตามลำดับ
3. ผู้สมัครรายแรกที่ทั้ง `require(...)` และผ่าน `validateNative(...)` จะชนะ

## วงจรชีวิตการแตกไฟล์ addon แบบฝังตัว

`embedded-addon.ts` กำหนดรูปแบบ manifest ที่สร้างขึ้น:

- `platformTag`
- `version`
- `files[]` ซึ่งแต่ละรายการมี `variant`, `filename`, `filePath`

ค่าเริ่มต้นที่ check-in ปัจจุบันคือ `embeddedAddon: null`; artifacts ที่คอมไพล์แล้วอาจแทนที่ด้วยข้อมูลเมตาจริง

### เครื่องจักรสถานะการแตกไฟล์

การแตกไฟล์ (`maybeExtractEmbeddedAddon`) ทำงานเฉพาะเมื่อผ่านทุกเกตดังนี้:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. พบไฟล์แบบฝังตัวที่เหมาะสมกับ variant

การเลือกไฟล์ variant สะท้อนความตั้งใจ variant ของ runtime:

- ไม่ใช่ x64: ให้ความสำคัญ `default` จากนั้นไฟล์แรกที่พร้อมใช้งาน
- x64 + `modern`: ให้ความสำคัญ `modern` ทางสำรองเป็น `baseline`
- x64 + `baseline`: ต้องการ `baseline`

พฤติกรรมการแปลงไฟล์:

1. ตรวจสอบว่ามี `<versionedDir>` อยู่ (`mkdirSync(..., { recursive: true })`)
2. หาก `<versionedDir>/<selected filename>` มีอยู่แล้ว ให้นำกลับมาใช้ (ไม่เขียนซ้ำ)
3. มิฉะนั้นอ่านไฟล์ต้นทางแบบฝังตัว `filePath` และเขียนไฟล์เป้าหมาย
4. ส่งคืนเส้นทางเป้าหมายสำหรับความพยายามโหลดที่มีลำดับความสำคัญสูงสุด

เมื่อล้มเหลว การแตกไฟล์จะไม่หยุดทำงานทันที แต่จะเพิ่มรายการข้อผิดพลาด (การสร้างไดเรกทอรีหรือความล้มเหลวในการเขียน) และตัวโหลดจะดำเนินการสำรวจผู้สมัครตามปกติ

## วงจรชีวิตและการเปลี่ยนผ่านสถานะ

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

## สัญญาการตรวจสอบ `validateNative`

`validateNative(bindings, source)` บังคับใช้สัญญาเฉพาะฟังก์ชันกับ `NativeBindings` เมื่อเริ่มต้น

กลไก:

- สำหรับชื่อ export ที่ต้องการแต่ละชื่อ ระบบจะตรวจสอบ `typeof bindings[name] === "function"`
- ชื่อที่ขาดหายไปจะถูกรวบรวม
- หากมีชื่อใดขาดหายไป ตัวโหลดจะโยน:
  - เส้นทาง addon ต้นทาง
  - รายการ export ที่ขาดหายไป
  - คำแนะนำคำสั่งสร้างใหม่

นี่คือเกตความเข้ากันได้แบบ hard สำหรับไบนารีที่ล้าสมัย, บิลด์บางส่วน และการเปลี่ยนแปลง symbol/ชื่อ

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

หมายเหตุ: `bindings.ts` ประกาศเฉพาะสมาชิก `cancelWork(id)` พื้นฐาน; ไฟล์ `types.ts` ของโมดูลประกาศ-ผสานสัญลักษณ์เพิ่มเติมที่ `validateNative` บังคับใช้

## พฤติกรรมความล้มเหลวและการวินิจฉัย

## แพลตฟอร์มที่ไม่รองรับ

หากผู้สมัครทั้งหมดล้มเหลวและ `platformTag` ไม่อยู่ใน `SUPPORTED_PLATFORMS` ตัวโหลดจะโยน:

- `Unsupported platform: <tag>`
- รายการแพลตฟอร์มที่รองรับทั้งหมด
- คำแนะนำการรายงานปัญหาอย่างชัดเจน

## อาการไบนารีล้าสมัย / ไม่ตรงกัน

สัญญาณไม่ตรงกันของไบนารีล้าสมัยทั่วไป:

- `Native addon missing exports (<candidate>). Missing: ...`

สาเหตุทั่วไป:

- ไบนารี `.node` เก่าจากเวอร์ชันแพ็กเกจ/รูปแบบ API ก่อนหน้า
- เลือก artifact variant ผิด (สำหรับ x64)
- Rust export ใหม่ไม่มีอยู่ใน artifact ที่โหลด

พฤติกรรมตัวโหลด:

- บันทึกความล้มเหลวของ export ที่ขาดหายไปต่อผู้สมัคร
- ดำเนินการสำรวจผู้สมัครที่เหลือต่อไป
- หากไม่มีผู้สมัครรายใดผ่านการตรวจสอบ ข้อผิดพลาดสุดท้ายจะรวมทุกเส้นทางที่พยายามพร้อมข้อความความล้มเหลวแต่ละรายการ

## ความล้มเหลวในการเริ่มต้นของไบนารีที่คอมไพล์แล้ว

ในโหมดที่คอมไพล์แล้ว การวินิจฉัยสุดท้ายประกอบด้วย:

- เส้นทางเป้าหมายแคชที่มีเวอร์ชันที่คาดหวัง (`<versionedDir>/<filename>`),
- การแก้ไขเพื่อลบ `<versionedDir>` ที่ล้าสมัยและรันใหม่,
- คำสั่ง `curl` สำหรับดาวน์โหลด release โดยตรงสำหรับแต่ละชื่อไฟล์ที่คาดหวัง

## ความล้มเหลวในการเริ่มต้นที่ไม่ได้คอมไพล์

ในโหมดแพ็กเกจ/runtime ปกติ การวินิจฉัยสุดท้ายประกอบด้วย:

- คำแนะนำการติดตั้งใหม่ (`bun install @f5xc-salesdemos/pi-natives`),
- คำสั่งสร้างใหม่ในเครื่อง (`bun --cwd=packages/natives run build`),
- คำแนะนำการสร้าง x64 variant เสริม (`TARGET_VARIANT=baseline|modern ...`)

## พฤติกรรม Runtime

- ตัวโหลดใช้ chain ผู้สมัคร release เสมอ
- การตั้งค่า `PI_DEV` เปิดใช้งานเฉพาะการวินิจฉัย console ต่อผู้สมัคร (`Loaded native addon...` และข้อผิดพลาดการโหลด)
