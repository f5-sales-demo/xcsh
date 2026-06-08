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

เอกสารนี้เจาะลึกชั้นการโหลด/การตรวจสอบ addon ใน `@f5xc-salesdemos/pi-natives`: วิธีที่ `native.ts` ตัดสินใจเลือกโหลดไฟล์ `.node` ใด, เมื่อใดที่การแยก embedded payload ทำงาน, และวิธีการรายงานความล้มเหลวในการเริ่มต้น

## ไฟล์การ implement

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## ขอบเขตและความรับผิดชอบ

ความรับผิดชอบของ Loader/runtime ถูกจำกัดไว้อย่างตั้งใจ:

- สร้างรายการตัวเลือกสำหรับชื่อไฟล์และไดเรกทอรีของ addon ที่คำนึงถึง platform/CPU
- เลือกที่จะ materialize embedded addon ไปยังไดเรกทอรี cache แบบแยกเวอร์ชันต่อผู้ใช้
- ลองตัวเลือกตามลำดับที่กำหนดแน่นอน
- ปฏิเสธ addon ที่ล้าสมัยหรือไม่เข้ากันผ่าน `validateNative` ก่อนเปิดเผย bindings

สิ่งที่อยู่นอกขอบเขตที่นี่: พฤติกรรมเฉพาะโมดูลของ grep/text/highlight

## อินพุต runtime และ state ที่ได้มา

ณ เวลาเริ่มต้นโมดูล (`export const native = loadNative();`), `native.ts` จะคำนวณ context แบบ static:

- **Platform tag**: ``${process.platform}-${process.arch}`` (ตัวอย่างเช่น `darwin-arm64`)
- **เวอร์ชันของ package**: จาก `packages/natives/package.json` (ฟิลด์ `version`)
- **ไดเรกทอรีหลัก**:
  - `nativeDir`: `packages/natives/native` ภายใน package
  - `execDir`: ไดเรกทอรีที่มี `process.execPath`
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`
  - `userDataDir` สำรอง:
    - Windows: `%LOCALAPPDATA%/xcsh` (หรือ `%USERPROFILE%/AppData/Local/xcsh`)
    - ที่ไม่ใช่ Windows: `~/.local/bin`
- **โหมด compiled-binary** (`isCompiledBinary`): เป็น true หากเข้าเงื่อนไขใดเงื่อนไขหนึ่ง:
  - ตัวแปรสภาพแวดล้อม `PI_COMPILED` ถูกตั้งค่า, หรือ
  - `import.meta.url` มี Bun-embedded markers (`$bunfs`, `~BUN`, `%7EBUN`)
- **การกำหนด variant ด้วยตนเอง**: `PI_NATIVE_VARIANT` (เฉพาะ `modern`/`baseline` เท่านั้น; ค่าที่ไม่ถูกต้องจะถูกละเว้น)
- **Variant ที่เลือก**: การกำหนดด้วยตนเองหากมี มิฉะนั้นตรวจจับ AVX2 แบบ runtime บน x64 (`modern` หากมี AVX2 มิฉะนั้น `baseline`)

## การรองรับ platform และการแปลง tag

`SUPPORTED_PLATFORMS` ถูกกำหนดตายตัวเป็น:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

รายละเอียดพฤติกรรม:

- Platform ที่ไม่รองรับจะไม่ถูกปฏิเสธตั้งแต่แรก
- Loader ยังคงลองตัวเลือกที่คำนวณได้ทั้งหมดก่อน
- หากไม่มีอะไรโหลดได้ จะ throw ข้อผิดพลาด unsupported-platform อย่างชัดเจนพร้อมแสดงรายการ tag ที่รองรับ

สิ่งนี้รักษาการวินิจฉัยที่มีประโยชน์สำหรับกรณีที่เกือบตรง ในขณะที่ยังคง fail อย่างจริงจังสำหรับ target ที่ไม่รองรับอย่างแท้จริง

## การเลือก variant (`modern` / `baseline` / default)

### พฤติกรรม x64

1. หาก `PI_NATIVE_VARIANT` เป็น `modern` หรือ `baseline` ค่านั้นจะถูกใช้
2. มิฉะนั้นตรวจจับการรองรับ AVX2:
   - Linux: สแกน `/proc/cpuinfo` หา `avx2`
   - macOS: สอบถาม `sysctl` (`machdep.cpu.leaf7_features`, สำรอง `machdep.cpu.features`)
   - Windows: รัน PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`
3. ผลลัพธ์:
   - AVX2 ใช้งานได้ -> `modern`
   - AVX2 ใช้งานไม่ได้/ตรวจจับไม่ได้ -> `baseline`

### พฤติกรรมที่ไม่ใช่ x64

- ไม่มีการใช้ variant; loader ใช้ชื่อไฟล์เริ่มต้น (`pi_natives.<platform>-<arch>.node`)

### การสร้างชื่อไฟล์

กำหนด `tag = <platform>-<arch>`:

- ไม่ใช่ x64 หรือไม่มี variant: `pi_natives.<tag>.node`
- x64 + `modern`: ลองตามลำดับ
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (fallback ที่ตั้งใจไว้)
- x64 + `baseline`: เฉพาะ `pi_natives.<tag>-baseline.node`

`addonLabel` ที่ใช้ในข้อความ error สุดท้ายจะเป็น `<tag>` หรือ `<tag> (<variant>)`

## การสร้างเส้นทางตัวเลือกและลำดับ fallback

`native.ts` สร้าง pool ของตัวเลือกก่อนการเรียก `require(...)` ใดๆ

### ตัวเลือก release

สร้างจากรายการชื่อไฟล์ที่แปลง variant แล้วและค้นหาตามลำดับนี้:

- **Runtime ที่ไม่ใช่ compiled**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime ที่ compiled** (`PI_COMPILED` หรือ Bun embedded markers):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` ลบรายการซ้ำโดยรักษาลำดับการปรากฏครั้งแรก

### ลำดับ runtime สุดท้าย

ณ เวลาโหลด:

1. ตัวเลือกการแยก embedded (หากสร้างขึ้น) จะถูกแทรกไว้ด้านหน้า
2. ตัวเลือกที่ deduplicate แล้วที่เหลือจะถูกลองตามลำดับ
3. ตัวเลือกแรกที่ทั้ง `require(...)` สำเร็จและผ่าน `validateNative(...)` จะชนะ

## วงจรชีวิตการแยก embedded addon

`embedded-addon.ts` กำหนดรูปแบบ manifest ที่สร้างขึ้น:

- `platformTag`
- `version`
- `files[]` โดยแต่ละรายการมี `variant`, `filename`, `filePath`

ค่าเริ่มต้นที่ check-in ในปัจจุบันคือ `embeddedAddon: null`; artifact ที่ compiled อาจแทนที่สิ่งนี้ด้วย metadata จริง

### State machine ของการแยก

การแยก (`maybeExtractEmbeddedAddon`) จะทำงานเฉพาะเมื่อเงื่อนไขทั้งหมดผ่าน:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. พบไฟล์ embedded ที่เหมาะสมกับ variant

การเลือกไฟล์ variant สะท้อนเจตนา variant ของ runtime:

- ไม่ใช่ x64: เลือก `default` ก่อน แล้วตามด้วยไฟล์แรกที่มี
- x64 + `modern`: เลือก `modern` ก่อน fallback เป็น `baseline`
- x64 + `baseline`: ต้องการ `baseline`

พฤติกรรมการ materialize:

1. ตรวจสอบว่า `<versionedDir>` มีอยู่ (`mkdirSync(..., { recursive: true })`)
2. หาก `<versionedDir>/<selected filename>` มีอยู่แล้ว ใช้ซ้ำ (ไม่เขียนใหม่)
3. มิฉะนั้นอ่าน `filePath` ต้นทาง embedded และเขียนไฟล์เป้าหมาย
4. คืนเส้นทางเป้าหมายสำหรับความพยายามโหลดที่มีลำดับความสำคัญสูงสุด

เมื่อเกิดความล้มเหลว การแยกจะไม่ crash ทันที; จะเพิ่มรายการ error (ความล้มเหลวในการสร้างไดเรกทอรีหรือการเขียน) และ loader จะดำเนินการตรวจสอบตัวเลือกปกติต่อไป

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

## สัญญาการตรวจสอบของ `validateNative`

`validateNative(bindings, source)` บังคับสัญญาแบบ function-only เหนือ `NativeBindings` ณ เวลาเริ่มต้น

กลไก:

- สำหรับแต่ละชื่อ export ที่จำเป็น จะตรวจสอบ `typeof bindings[name] === "function"`
- ชื่อที่ขาดหายจะถูกรวบรวม
- หากมีรายการที่ขาดหาย loader จะ throw:
  - เส้นทาง addon ต้นทาง,
  - รายการ export ที่ขาดหาย,
  - คำแนะนำคำสั่ง rebuild

นี่เป็น gate ความเข้ากันได้แบบเข้มงวดต่อ binary ที่ล้าสมัย, build ที่ไม่สมบูรณ์, และ symbol/name ที่เปลี่ยนแปลง

### การ mapping JS API ↔ native export (gate การตรวจสอบ)

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

หมายเหตุ: `bindings.ts` ประกาศเฉพาะ member พื้นฐาน `cancelWork(id)`; ไฟล์ `types.ts` ของโมดูลจะ declaration-merge symbol เพิ่มเติมที่ `validateNative` บังคับ

## พฤติกรรมความล้มเหลวและการวินิจฉัย

## Platform ที่ไม่รองรับ

หากตัวเลือกทั้งหมดล้มเหลวและ `platformTag` ไม่อยู่ใน `SUPPORTED_PLATFORMS` loader จะ throw:

- `Unsupported platform: <tag>`
- รายการ platform ที่รองรับทั้งหมด
- คำแนะนำการรายงานปัญหาอย่างชัดเจน

## อาการ binary ล้าสมัย / ไม่ตรงกัน

สัญญาณความไม่ตรงกันที่ล้าสมัยทั่วไป:

- `Native addon missing exports (<candidate>). Missing: ...`

สาเหตุทั่วไป:

- binary `.node` เก่าจากเวอร์ชัน/รูปแบบ API ของ package ก่อนหน้า
- artifact variant ที่ผิดถูกเลือก (สำหรับ x64)
- Rust export ใหม่ไม่มีอยู่ใน artifact ที่โหลด

พฤติกรรม loader:

- บันทึกความล้มเหลวของ export ที่ขาดหายต่อตัวเลือก
- ดำเนินการตรวจสอบตัวเลือกที่เหลือ
- หากไม่มีตัวเลือกใดผ่านการตรวจสอบ error สุดท้ายจะรวมทุกเส้นทางที่ลองพร้อมข้อความความล้มเหลวของแต่ละรายการ

## ความล้มเหลวในการเริ่มต้น compiled-binary

ในโหมด compiled การวินิจฉัยสุดท้ายจะรวม:

- เส้นทาง versioned cache เป้าหมายที่คาดหวัง (`<versionedDir>/<filename>`),
- การแก้ไขโดยลบ `<versionedDir>` ที่ล้าสมัยและรันใหม่,
- คำสั่ง `curl` สำหรับดาวน์โหลด release โดยตรงสำหรับแต่ละชื่อไฟล์ที่คาดหวัง

## ความล้มเหลวในการเริ่มต้นแบบไม่ใช่ compiled

ในโหมด package/runtime ปกติ การวินิจฉัยสุดท้ายจะรวม:

- คำแนะนำการติดตั้งใหม่ (`bun install @f5xc-salesdemos/pi-natives`),
- คำสั่ง rebuild ในเครื่อง (`bun --cwd=packages/natives run build`),
- คำแนะนำ variant build สำหรับ x64 (ไม่บังคับ) (`TARGET_VARIANT=baseline|modern ...`)

## พฤติกรรม runtime

- Loader ใช้ chain ตัวเลือก release เสมอ
- การตั้งค่า `PI_DEV` เปิดใช้งานเฉพาะการวินิจฉัยต่อตัวเลือกใน console (`Loaded native addon...` และ load errors)
