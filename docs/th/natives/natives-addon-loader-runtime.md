---
title: Natives Addon Loader Runtime
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: Addon loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Natives Addon Loader Runtime

เอกสารนี้อธิบายรายละเอียดเชิงลึกของชั้นการโหลด/ตรวจสอบ addon ใน `@f5xc-salesdemos/pi-natives`: วิธีที่ `native.ts` ตัดสินใจว่าจะโหลดไฟล์ `.node` ใด เมื่อใดที่การแยก embedded payload ทำงาน และวิธีการรายงานข้อผิดพลาดขณะเริ่มต้นระบบ

## ไฟล์การ implement

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## ขอบเขตและความรับผิดชอบ

ความรับผิดชอบของ Loader/runtime ถูกกำหนดให้แคบอย่างตั้งใจ:

- สร้างรายชื่อ candidate ของชื่อไฟล์และไดเรกทอรีของ addon ที่รองรับแพลตฟอร์ม/CPU
- สามารถ materialize embedded addon ลงในไดเรกทอรี cache แบบ versioned ต่อผู้ใช้ได้ตามต้องการ
- ลอง candidate ตามลำดับที่แน่นอน
- ปฏิเสธ addon ที่ล้าสมัยหรือไม่เข้ากันผ่าน `validateNative` ก่อนเปิดเผย bindings

สิ่งที่อยู่นอกขอบเขตในที่นี้: พฤติกรรมเฉพาะของโมดูลอย่าง grep/text/highlight

## อินพุตของ runtime และ state ที่ได้จากการคำนวณ

ที่การ initialization ของโมดูล (`export const native = loadNative();`), `native.ts` จะคำนวณ context แบบ static:

- **Platform tag**: ``${process.platform}-${process.arch}`` (ตัวอย่างเช่น `darwin-arm64`)
- **Package version**: จาก `packages/natives/package.json` (ฟิลด์ `version`)
- **ไดเรกทอรีหลัก**:
  - `nativeDir`: `packages/natives/native` ภายในแพ็กเกจ
  - `execDir`: ไดเรกทอรีที่มี `process.execPath`
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`
  - `userDataDir` สำรอง:
    - Windows: `%LOCALAPPDATA%/xcsh` (หรือ `%USERPROFILE%/AppData/Local/xcsh`)
    - ไม่ใช่ Windows: `~/.local/bin`
- **โหมด compiled-binary** (`isCompiledBinary`): เป็น true ถ้าเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง:
  - ตัวแปรสภาพแวดล้อม `PI_COMPILED` ถูกตั้งค่า หรือ
  - `import.meta.url` มี Bun-embedded markers (`$bunfs`, `~BUN`, `%7EBUN`)
- **การกำหนด variant ภายนอก**: `PI_NATIVE_VARIANT` (รับเฉพาะ `modern`/`baseline` เท่านั้น; ค่าที่ไม่ถูกต้องจะถูกเพิกเฉย)
- **Variant ที่เลือก**: ค่าที่กำหนดภายนอกอย่างชัดเจน มิฉะนั้นตรวจจับ AVX2 ขณะ runtime บน x64 (`modern` ถ้ามี AVX2 มิฉะนั้น `baseline`)

## การรองรับแพลตฟอร์มและการ resolve tag

`SUPPORTED_PLATFORMS` ถูกกำหนดตายตัวเป็น:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

รายละเอียดพฤติกรรม:

- แพลตฟอร์มที่ไม่รองรับจะไม่ถูกปฏิเสธล่วงหน้า
- Loader ยังคงลอง candidate ทั้งหมดที่คำนวณได้ก่อน
- ถ้าไม่มีอะไรโหลดได้ จะ throw ข้อผิดพลาดแพลตฟอร์มที่ไม่รองรับอย่างชัดเจน พร้อมแสดงรายชื่อ tag ที่รองรับ

วิธีนี้รักษาการวินิจฉัยที่มีประโยชน์สำหรับกรณีที่เกือบตรง ในขณะที่ยังคง fail อย่างชัดเจนสำหรับ target ที่ไม่รองรับจริงๆ

## การเลือก variant (`modern` / `baseline` / default)

### พฤติกรรม x64

1. ถ้า `PI_NATIVE_VARIANT` เป็น `modern` หรือ `baseline` ค่านั้นจะถูกใช้
2. มิฉะนั้นตรวจจับการรองรับ AVX2:
   - Linux: สแกน `/proc/cpuinfo` เพื่อหา `avx2`
   - macOS: สอบถาม `sysctl` (`machdep.cpu.leaf7_features`, สำรอง `machdep.cpu.features`)
   - Windows: รัน PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`
3. ผลลัพธ์:
   - AVX2 พร้อมใช้งาน -> `modern`
   - AVX2 ไม่พร้อมใช้งาน/ตรวจจับไม่ได้ -> `baseline`

### พฤติกรรมที่ไม่ใช่ x64

- ไม่มีการใช้ variant; loader ใช้ชื่อไฟล์เริ่มต้น (`pi_natives.<platform>-<arch>.node`)

### การสร้างชื่อไฟล์

เมื่อกำหนด `tag = <platform>-<arch>`:

- ไม่ใช่ x64 หรือไม่มี variant: `pi_natives.<tag>.node`
- x64 + `modern`: ลองตามลำดับ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (เป็น fallback ที่ตั้งใจไว้)
- x64 + `baseline`: เฉพาะ `pi_natives.<tag>-baseline.node`

`addonLabel` ที่ใช้ในข้อความ error สุดท้ายจะเป็น `<tag>` หรือ `<tag> (<variant>)`

## การสร้างเส้นทาง candidate และลำดับ fallback

`native.ts` สร้างกลุ่ม candidate ก่อนการเรียก `require(...)` ใดๆ

### Release candidates

สร้างจากรายชื่อไฟล์ที่ resolve variant แล้วและค้นหาตามลำดับนี้:

- **Runtime แบบไม่ compiled**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime แบบ compiled** (`PI_COMPILED` หรือ Bun embedded markers):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` จะลบรายการซ้ำโดยรักษาลำดับการปรากฏครั้งแรก

### ลำดับการทำงานจริงขณะ runtime

ขณะโหลด:

1. Embedded extraction candidate ที่เป็นทางเลือก (ถ้าสร้างขึ้น) จะถูกแทรกไว้ด้านหน้า
2. Candidate ที่เหลือที่ตัดซ้ำแล้วจะถูกลองตามลำดับ
3. Candidate แรกที่ทั้ง `require(...)` สำเร็จและผ่าน `validateNative(...)` จะเป็นตัวที่ถูกเลือก

## วงจรชีวิตการแยก embedded addon

`embedded-addon.ts` กำหนดรูปแบบ manifest ที่สร้างขึ้น:

- `platformTag`
- `version`
- `files[]` โดยแต่ละรายการมี `variant`, `filename`, `filePath`

ค่าเริ่มต้นที่ checked-in ในปัจจุบันคือ `embeddedAddon: null`; artifact ที่ compile แล้วอาจแทนที่ด้วย metadata จริง

### State machine ของการแยก

การแยก (`maybeExtractEmbeddedAddon`) ทำงานเฉพาะเมื่อเงื่อนไขทั้งหมดผ่าน:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. พบไฟล์ embedded ที่เหมาะสมกับ variant

การเลือกไฟล์ตาม variant สะท้อนความตั้งใจของ variant ขณะ runtime:

- ไม่ใช่ x64: เลือก `default` ก่อน จากนั้นไฟล์แรกที่มี
- x64 + `modern`: เลือก `modern` ก่อน fallback ไปที่ `baseline`
- x64 + `baseline`: ต้องเป็น `baseline`

พฤติกรรมการ materialize:

1. ตรวจสอบว่า `<versionedDir>` มีอยู่ (`mkdirSync(..., { recursive: true })`)
2. ถ้า `<versionedDir>/<selected filename>` มีอยู่แล้ว ใช้ซ้ำ (ไม่เขียนใหม่)
3. มิฉะนั้นอ่านไฟล์ต้นทาง embedded `filePath` และเขียนไฟล์เป้าหมาย
4. คืนค่าเส้นทางเป้าหมายสำหรับการโหลดลำดับความสำคัญสูงสุด

เมื่อล้มเหลว การแยกจะไม่ crash ทันที; จะเพิ่มรายการ error (การสร้างไดเรกทอรีหรือการเขียนล้มเหลว) และ loader จะดำเนินการ probe candidate ตามปกติต่อไป

## วงจรชีวิตและการเปลี่ยน state

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

`validateNative(bindings, source)` บังคับใช้สัญญาแบบ function-only เหนือ `NativeBindings` ขณะเริ่มต้นระบบ

กลไก:

- สำหรับแต่ละชื่อ export ที่จำเป็น จะตรวจสอบ `typeof bindings[name] === "function"`
- ชื่อที่หายไปจะถูกรวบรวม
- ถ้ามีชื่อที่หายไป loader จะ throw:
  - เส้นทาง addon ต้นทาง
  - รายชื่อ export ที่หายไป
  - คำแนะนำคำสั่ง rebuild

นี่คือ gate ความเข้ากันได้แบบเข้มงวดเพื่อป้องกัน binary ที่ล้าสมัย, การ build ที่ไม่สมบูรณ์ และการเปลี่ยนแปลง symbol/name

### การ mapping JS API ↔ native export (validation gate)

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

## พฤติกรรมเมื่อล้มเหลวและการวินิจฉัย

## แพลตฟอร์มที่ไม่รองรับ

ถ้า candidate ทั้งหมดล้มเหลวและ `platformTag` ไม่อยู่ใน `SUPPORTED_PLATFORMS` loader จะ throw:

- `Unsupported platform: <tag>`
- รายชื่อแพลตฟอร์มที่รองรับทั้งหมด
- คำแนะนำการรายงานปัญหาอย่างชัดเจน

## อาการ binary ล้าสมัย / ไม่ตรงกัน

สัญญาณทั่วไปของ binary ที่ไม่ตรงกัน:

- `Native addon missing exports (<candidate>). Missing: ...`

สาเหตุทั่วไป:

- binary `.node` เก่าจากเวอร์ชันแพ็กเกจ/รูปแบบ API ก่อนหน้า
- เลือก variant artifact ผิด (สำหรับ x64)
- export ใหม่จาก Rust ไม่มีอยู่ใน artifact ที่โหลด

พฤติกรรม Loader:

- บันทึกข้อผิดพลาด missing-export ต่อ candidate
- ดำเนินการ probe candidate ที่เหลือต่อ
- ถ้าไม่มี candidate ใดผ่านการ validate error สุดท้ายจะรวมเส้นทางทั้งหมดที่ลองพร้อมข้อความ failure ของแต่ละเส้นทาง

## ข้อผิดพลาดขณะเริ่มต้นในโหมด compiled-binary

ในโหมด compiled การวินิจฉัยสุดท้ายจะรวม:

- เส้นทาง versioned cache เป้าหมายที่คาดหวัง (`<versionedDir>/<filename>`)
- วิธีแก้ไขโดยลบ `<versionedDir>` ที่ล้าสมัยแล้วรันใหม่
- คำสั่ง `curl` สำหรับดาวน์โหลดโดยตรงจาก release สำหรับแต่ละชื่อไฟล์ที่คาดหวัง

## ข้อผิดพลาดขณะเริ่มต้นในโหมดไม่ compiled

ในโหมดแพ็กเกจ/runtime ปกติ การวินิจฉัยสุดท้ายจะรวม:

- คำแนะนำการติดตั้งใหม่ (`bun install @f5xc-salesdemos/pi-natives`)
- คำสั่ง rebuild ในเครื่อง (`bun --cwd=packages/natives run build`)
- คำแนะนำการ build variant สำหรับ x64 เพิ่มเติม (`TARGET_VARIANT=baseline|modern ...`)

## พฤติกรรมขณะ runtime

- Loader ใช้ release candidate chain เสมอ
- การตั้งค่า `PI_DEV` เปิดใช้งานเฉพาะการวินิจฉัยต่อ candidate ผ่าน console (`Loaded native addon...` และ load errors)
