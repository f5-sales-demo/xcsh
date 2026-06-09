---
title: รันไทม์ Natives Addon Loader
description: >-
  รันไทม์ N-API addon loader พร้อมการตรวจจับแพลตฟอร์ม กลยุทธ์สำรอง
  และการค้นหาโมดูล
sidebar:
  order: 3
  label: Addon loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# รันไทม์ Natives Addon Loader

เอกสารนี้เจาะลึกชั้นการโหลด/การตรวจสอบ addon ใน `@f5xc-salesdemos/pi-natives`: วิธีที่ `native.ts` ตัดสินใจว่าจะโหลดไฟล์ `.node` ใด การแตกไฟล์ embedded payload ทำงานเมื่อใด และรายงานข้อผิดพลาดในการเริ่มต้นอย่างไร

## ไฟล์การใช้งาน

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## ขอบเขตและความรับผิดชอบ

ความรับผิดชอบของ Loader/runtime ถูกจำกัดไว้อย่างตั้งใจ:

- สร้างรายการตัวเลือกที่คำนึงถึงแพลตฟอร์ม/CPU สำหรับชื่อไฟล์และไดเรกทอรีของ addon
- สร้าง embedded addon ลงในไดเรกทอรีแคชที่กำหนดเวอร์ชันต่อผู้ใช้ (ถ้าจำเป็น)
- ลองตัวเลือกต่างๆ ตามลำดับที่กำหนดแน่นอน
- ปฏิเสธ addon ที่ล้าสมัยหรือไม่เข้ากันผ่าน `validateNative` ก่อนเปิดเผย bindings

สิ่งที่อยู่นอกขอบเขตในที่นี้: พฤติกรรมเฉพาะโมดูลของ grep/text/highlight

## อินพุตรันไทม์และสถานะที่คำนวณได้

ในขั้นตอนการเริ่มต้นโมดูล (`export const native = loadNative();`), `native.ts` คำนวณบริบทแบบ static:

- **แท็กแพลตฟอร์ม**: ``${process.platform}-${process.arch}`` (ตัวอย่างเช่น `darwin-arm64`)
- **เวอร์ชันแพ็กเกจ**: จาก `packages/natives/package.json` (ฟิลด์ `version`)
- **ไดเรกทอรีหลัก**:
  - `nativeDir`: `packages/natives/native` ภายในแพ็กเกจ
  - `execDir`: ไดเรกทอรีที่มี `process.execPath`
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`
  - `userDataDir` สำรอง:
    - Windows: `%LOCALAPPDATA%/xcsh` (หรือ `%USERPROFILE%/AppData/Local/xcsh`)
    - ที่ไม่ใช่ Windows: `~/.local/bin`
- **โหมด compiled-binary** (`isCompiledBinary`): เป็น true ถ้าเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง:
  - ตัวแปรสภาพแวดล้อม `PI_COMPILED` ถูกตั้งค่า หรือ
  - `import.meta.url` มีเครื่องหมาย Bun-embedded (`$bunfs`, `~BUN`, `%7EBUN`)
- **การระบุ variant แบบกำหนดเอง**: `PI_NATIVE_VARIANT` (`modern`/`baseline` เท่านั้น; ค่าที่ไม่ถูกต้องจะถูกเพิกเฉย)
- **Variant ที่เลือก**: การระบุแบบกำหนดเอง มิฉะนั้นจะตรวจจับ AVX2 ในรันไทม์บน x64 (`modern` ถ้ามี AVX2, มิฉะนั้น `baseline`)

## การรองรับแพลตฟอร์มและการแก้ไขแท็ก

`SUPPORTED_PLATFORMS` ถูกกำหนดตายตัวเป็น:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

รายละเอียดพฤติกรรม:

- แพลตฟอร์มที่ไม่รองรับจะไม่ถูกปฏิเสธตั้งแต่แรก
- Loader ยังคงลองตัวเลือกที่คำนวณได้ทั้งหมดก่อน
- ถ้าไม่มีอะไรโหลดได้ จะโยนข้อผิดพลาดแพลตฟอร์มที่ไม่รองรับอย่างชัดเจน พร้อมแสดงรายการแท็กที่รองรับ

วิธีนี้รักษาข้อมูลวินิจฉัยที่มีประโยชน์สำหรับกรณีที่ใกล้เคียง ในขณะที่ยังคงล้มเหลวอย่างชัดเจนสำหรับเป้าหมายที่ไม่รองรับจริงๆ

## การเลือก Variant (`modern` / `baseline` / ค่าเริ่มต้น)

### พฤติกรรม x64

1. ถ้า `PI_NATIVE_VARIANT` เป็น `modern` หรือ `baseline` ค่านั้นจะมีผลเหนือกว่า
2. มิฉะนั้นจะตรวจจับการรองรับ AVX2:
   - Linux: สแกน `/proc/cpuinfo` หา `avx2`
   - macOS: สอบถาม `sysctl` (`machdep.cpu.leaf7_features`, สำรอง `machdep.cpu.features`)
   - Windows: รัน PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`
3. ผลลัพธ์:
   - มี AVX2 -> `modern`
   - ไม่มี AVX2/ตรวจจับไม่ได้ -> `baseline`

### พฤติกรรมที่ไม่ใช่ x64

- ไม่มีการใช้ variant; loader ใช้ชื่อไฟล์เริ่มต้น (`pi_natives.<platform>-<arch>.node`)

### การสร้างชื่อไฟล์

กำหนด `tag = <platform>-<arch>`:

- ไม่ใช่ x64 หรือไม่มี variant: `pi_natives.<tag>.node`
- x64 + `modern`: ลองตามลำดับ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (สำรองอย่างตั้งใจ)
- x64 + `baseline`: เฉพาะ `pi_natives.<tag>-baseline.node`

`addonLabel` ที่ใช้ในข้อความข้อผิดพลาดสุดท้ายเป็น `<tag>` หรือ `<tag> (<variant>)`

## การสร้างเส้นทางตัวเลือกและลำดับสำรอง

`native.ts` สร้างกลุ่มตัวเลือกก่อนการเรียก `require(...)` ใดๆ

### ตัวเลือกสำหรับ release

สร้างจากรายการชื่อไฟล์ที่แก้ไข variant แล้ว และค้นหาตามลำดับนี้:

- **รันไทม์แบบไม่ compiled**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **รันไทม์แบบ compiled** (`PI_COMPILED` หรือเครื่องหมาย Bun embedded):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` ลบรายการซ้ำโดยรักษาลำดับของรายการที่ปรากฏก่อน

### ลำดับรันไทม์สุดท้าย

ในเวลาโหลด:

1. ตัวเลือกจากการแตกไฟล์ embedded (ถ้ามี) จะถูกแทรกที่ด้านหน้า
2. ตัวเลือกที่ลบรายการซ้ำแล้วจะถูกลองตามลำดับ
3. ตัวเลือกแรกที่ทั้ง `require(...)` ได้สำเร็จและผ่าน `validateNative(...)` จะถูกเลือก

## วงจรชีวิตการแตกไฟล์ Embedded addon

`embedded-addon.ts` กำหนดรูปแบบ manifest ที่สร้างขึ้น:

- `platformTag`
- `version`
- `files[]` โดยแต่ละรายการมี `variant`, `filename`, `filePath`

ค่าเริ่มต้นที่ checked-in ในปัจจุบันคือ `embeddedAddon: null`; artifact ที่ compiled อาจแทนที่ด้วยข้อมูลเมตาจริง

### เครื่องสถานะการแตกไฟล์

การแตกไฟล์ (`maybeExtractEmbeddedAddon`) จะทำงานก็ต่อเมื่อผ่านเงื่อนไขทั้งหมด:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. พบไฟล์ embedded ที่เหมาะสมกับ variant

การเลือกไฟล์ variant สะท้อนเจตนา variant ของรันไทม์:

- ไม่ใช่ x64: ต้องการ `default` แล้วไฟล์แรกที่มี
- x64 + `modern`: ต้องการ `modern`, สำรองเป็น `baseline`
- x64 + `baseline`: ต้องการ `baseline`

พฤติกรรมการสร้างไฟล์:

1. ตรวจสอบว่า `<versionedDir>` มีอยู่ (`mkdirSync(..., { recursive: true })`)
2. ถ้า `<versionedDir>/<selected filename>` มีอยู่แล้ว ใช้ซ้ำ (ไม่เขียนใหม่)
3. มิฉะนั้นอ่านไฟล์ต้นทาง embedded `filePath` และเขียนไฟล์เป้าหมาย
4. คืนเส้นทางเป้าหมายสำหรับการลองโหลดที่มีลำดับความสำคัญสูงสุด

เมื่อล้มเหลว การแตกไฟล์จะไม่ทำให้โปรแกรมหยุดทำงานทันที; จะเพิ่มรายการข้อผิดพลาด (ล้มเหลวในการสร้างไดเรกทอรีหรือเขียนไฟล์) และ loader จะดำเนินการตรวจสอบตัวเลือกตามปกติ

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

## การตรวจสอบสัญญาของ `validateNative`

`validateNative(bindings, source)` บังคับใช้สัญญาแบบ function-only เหนือ `NativeBindings` ในขั้นตอนเริ่มต้น

กลไก:

- สำหรับแต่ละชื่อ export ที่จำเป็น จะตรวจสอบ `typeof bindings[name] === "function"`
- ชื่อที่หายไปจะถูกรวบรวม
- ถ้ามีชื่อใดหายไป loader จะโยนข้อผิดพลาด:
  - เส้นทาง addon ต้นทาง
  - รายการ export ที่หายไป
  - คำแนะนำคำสั่ง rebuild

นี่คือเกตความเข้ากันได้ที่เข้มงวดต่อ binary ที่ล้าสมัย, build ที่ไม่สมบูรณ์ และการเลื่อนไหลของ symbol/name

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

หมายเหตุ: `bindings.ts` ประกาศเฉพาะสมาชิกพื้นฐาน `cancelWork(id)`; ไฟล์ `types.ts` ของโมดูลจะ declaration-merge สัญลักษณ์เพิ่มเติมที่ `validateNative` บังคับใช้

## พฤติกรรมเมื่อล้มเหลวและข้อมูลวินิจฉัย

## แพลตฟอร์มที่ไม่รองรับ

ถ้าตัวเลือกทั้งหมดล้มเหลวและ `platformTag` ไม่อยู่ใน `SUPPORTED_PLATFORMS`, loader จะโยนข้อผิดพลาด:

- `Unsupported platform: <tag>`
- รายการแพลตฟอร์มที่รองรับทั้งหมด
- คำแนะนำในการรายงานปัญหาอย่างชัดเจน

## อาการของ binary ที่ล้าสมัย / ไม่ตรงกัน

สัญญาณทั่วไปของความไม่ตรงกัน:

- `Native addon missing exports (<candidate>). Missing: ...`

สาเหตุทั่วไป:

- binary `.node` เก่าจากเวอร์ชัน/รูปแบบ API ของแพ็กเกจก่อนหน้า
- เลือก artifact ผิด variant (สำหรับ x64)
- export ใหม่จาก Rust ไม่มีใน artifact ที่โหลด

พฤติกรรมของ Loader:

- บันทึกข้อผิดพลาด export ที่หายไปต่อตัวเลือก
- ดำเนินการตรวจสอบตัวเลือกที่เหลือต่อไป
- ถ้าไม่มีตัวเลือกใดผ่านการตรวจสอบ ข้อผิดพลาดสุดท้ายจะรวมทุกเส้นทางที่ลองพร้อมข้อความข้อผิดพลาดแต่ละรายการ

## ข้อผิดพลาดในการเริ่มต้นโหมด Compiled-binary

ในโหมด compiled ข้อมูลวินิจฉัยสุดท้ายรวมถึง:

- เส้นทางเป้าหมายแคชที่กำหนดเวอร์ชันที่คาดหวัง (`<versionedDir>/<filename>`)
- การแก้ไขโดยลบ `<versionedDir>` ที่ล้าสมัยแล้วรันใหม่
- คำสั่ง `curl` สำหรับดาวน์โหลด release โดยตรงสำหรับแต่ละชื่อไฟล์ที่คาดหวัง

## ข้อผิดพลาดในการเริ่มต้นโหมดไม่ compiled

ในโหมดแพ็กเกจ/รันไทม์ปกติ ข้อมูลวินิจฉัยสุดท้ายรวมถึง:

- คำแนะนำให้ติดตั้งใหม่ (`bun install @f5xc-salesdemos/pi-natives`)
- คำสั่ง rebuild ภายในเครื่อง (`bun --cwd=packages/natives run build`)
- คำแนะนำ build variant สำหรับ x64 (ไม่บังคับ) (`TARGET_VARIANT=baseline|modern ...`)

## พฤติกรรมรันไทม์

- Loader ใช้ห่วงโซ่ตัวเลือก release เสมอ
- การตั้งค่า `PI_DEV` เปิดใช้งานเฉพาะข้อมูลวินิจฉัยในคอนโซลต่อตัวเลือก (`Loaded native addon...` และข้อผิดพลาดในการโหลด)
