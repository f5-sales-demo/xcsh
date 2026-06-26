---
title: 'คู่มือการสร้าง, ปล่อยเวอร์ชัน และแก้ไขข้อผิดพลาดของ Natives'
description: >-
  คู่มือการสร้าง, ปล่อยเวอร์ชัน และแก้ไขข้อผิดพลาดสำหรับ Rust native addon
  บนหลายแพลตฟอร์ม
sidebar:
  order: 8
  label: 'การสร้าง, ปล่อยเวอร์ชัน และแก้ไขข้อผิดพลาด'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# คู่มือการสร้าง, ปล่อยเวอร์ชัน และแก้ไขข้อผิดพลาดของ Natives

คู่มือนี้อธิบายวิธีที่ไปป์ไลน์การสร้างของ `@f5-sales-demo/pi-natives` ผลิตไฟล์ `.node` addons, วิธีที่การแจกจ่ายที่คอมไพล์แล้วโหลดไฟล์เหล่านั้น, และวิธีแก้ไขข้อผิดพลาดของ loader/build

คู่มือนี้ใช้คำศัพท์ด้านสถาปัตยกรรมจาก `docs/natives-architecture.md`:

- **การผลิต artifact ในช่วง build-time** (`scripts/build-native.ts`)
- **การสร้าง embedded addon manifest** (`scripts/embed-native.ts`)
- **การโหลด addon ขณะ runtime + validation gate** (`src/native.ts`)

## ไฟล์ที่เกี่ยวข้องกับการนำไปใช้งาน

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## ภาพรวมของไปป์ไลน์การสร้าง

### 1) จุดเริ่มต้นการสร้าง

สคริปต์ใน `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → สร้างแบบ release
- `bun scripts/build-native.ts --dev` (`dev:native`) → สร้างแบบ debug/dev profile (ชื่อ output เหมือนกัน)
- `bun scripts/embed-native.ts` (`embed:native`) → สร้าง `src/embedded-addon.ts` จากไฟล์ที่สร้างแล้ว

### 2) การสร้าง Rust artifact

`build-native.ts` รัน Cargo ใน `crates/pi-natives`:

- คำสั่งพื้นฐาน: `cargo build`
- โหมด release เพิ่ม `--release` เว้นแต่จะส่ง `--dev`
- cross target เพิ่ม `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` ประกาศ `crate-type = ["cdylib"]` ทำให้ Cargo สร้าง shared library (`.so`/`.dylib`/`.dll`) ซึ่งจะถูกคัดลอก/เปลี่ยนชื่อเป็นชื่อไฟล์ `.node` addon

### 3) การค้นหาและติดตั้ง artifact

หลังจาก Cargo เสร็จสิ้น `build-native.ts` จะสแกนไดเรกทอรี output ที่เป็นตัวเลือกตามลำดับ:

1. `${CARGO_TARGET_DIR}` (ถ้ากำหนดไว้)
2. `<repo>/target`
3. `crates/pi-natives/target`

สำหรับแต่ละ root จะตรวจสอบไดเรกทอรี profile:

- cross build: `<root>/<crossTarget>/<profile>` จากนั้น `<root>/<profile>`
- native build: `<root>/<profile>`

จากนั้นจะค้นหาหนึ่งในไฟล์ต่อไปนี้:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

เมื่อพบแล้ว จะติดตั้งแบบ atomic ลงใน `packages/natives/native/` โดยใช้ temp-file + rename semantics (การ fallback บน Windows จัดการกับความล้มเหลวในการแทนที่ DLL ที่ถูกล็อกไว้อย่างชัดเจน)

## โมเดล Target/Variant และข้อตกลงการตั้งชื่อ

## Platform tag

ทั้งการสร้างและ runtime ใช้ platform tag:

`<platform>-<arch>` (ตัวอย่าง: `darwin-arm64`, `linux-x64`)

## โมเดล Variant (สำหรับ x64 เท่านั้น)

x64 รองรับ CPU variants:

- `modern` (เส้นทางที่รองรับ AVX2)
- `baseline` (สำรอง)

สถาปัตยกรรมที่ไม่ใช่ x64 ใช้ artifact เดียวแบบ default (ไม่มีส่วนต่อท้าย variant)

### ชื่อไฟล์ output

การสร้างแบบ release:

- x64: `pi_natives.<platform>-<arch>-modern.node` หรือ `...-baseline.node`
- ไม่ใช่ x64: `pi_natives.<platform>-<arch>.node`

การสร้างแบบ dev (`--dev`):

- ใช้ debug profile flags แต่คงชื่อ output ที่มี platform tag มาตรฐานไว้

ลำดับตัวเลือกของ runtime loader ใน `native.ts`:

- ตัวเลือก release
- โหมด compiled จะเพิ่มตัวเลือกที่แตกไฟล์/แคชไว้ก่อนไฟล์ในแพ็กเกจ

## Environment flags และตัวเลือกการสร้าง

## Runtime flags

- `PI_DEV` (พฤติกรรม loader): เปิดใช้งานการวินิจฉัย loader
- `PI_NATIVE_VARIANT` (พฤติกรรม loader, สำหรับ x64 เท่านั้น): บังคับเลือก `modern` หรือ `baseline` ขณะ runtime
- `PI_COMPILED` (พฤติกรรม loader): เปิดใช้งานพฤติกรรมการเลือก candidate/แตกไฟล์ของ compiled-binary

## Build-time flags/ตัวเลือก

- `--dev` (อาร์กิวเมนต์ของสคริปต์): สร้าง debug profile
- `CROSS_TARGET`: ส่งให้ Cargo `--target`
- `TARGET_PLATFORM`: แทนที่การตั้งชื่อ platform tag ใน output
- `TARGET_ARCH`: แทนที่การตั้งชื่อ arch ใน output
- `TARGET_VARIANT` (สำหรับ x64 เท่านั้น): บังคับ `modern` หรือ `baseline` สำหรับชื่อไฟล์ output และนโยบาย RUSTFLAGS
- `CARGO_TARGET_DIR`: root เพิ่มเติมเมื่อค้นหา Cargo outputs
- `RUSTFLAGS`:
  - ถ้าไม่ได้กำหนดและไม่ใช่ cross-compiling สคริปต์จะกำหนด:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - ไม่ใช่ x64 / ไม่มี variant: `-C target-cpu=native`
  - ถ้ากำหนดไว้แล้ว สคริปต์จะไม่แทนที่

## สถานะ/การเปลี่ยนแปลงวงจรชีวิตของการสร้าง

### วงจรชีวิตการสร้าง (`build-native.ts`)

1. **เริ่มต้น**: แยกวิเคราะห์ args/env (`--dev`, target overrides, cross flags)
2. **ระบุ Variant**:
   - ไม่ใช่ x64 → ไม่มี variant
   - x64 + `TARGET_VARIANT` → explicit variant
   - x64 cross-build ไม่มี `TARGET_VARIANT` → ข้อผิดพลาดร้ายแรง
   - x64 local build ไม่มี override → ตรวจสอบ host AVX2
3. **คอมไพล์**: รัน Cargo ด้วย profile/target ที่ระบุแล้ว
4. **ค้นหา artifact**: สแกน target roots/profile dirs/library names
5. **ติดตั้ง**: คัดลอก + atomic rename ลงใน `packages/natives/native`
6. **เสร็จสิ้น**: addon พร้อมสำหรับตัวเลือกของ loader

การออกจากโปรแกรมเมื่อเกิดความล้มเหลวจะเกิดขึ้นในทุกขั้นตอนพร้อมข้อความแสดงข้อผิดพลาดที่ชัดเจน (variant ไม่ถูกต้อง, cargo build ล้มเหลว, ไม่พบ output library, ความล้มเหลวในการติดตั้ง/rename)

### วงจรชีวิต Embed (`embed-native.ts`)

1. **เริ่มต้น**: คำนวณ platform tag จาก `TARGET_PLATFORM`/`TARGET_ARCH` หรือค่า host
2. **ชุดตัวเลือก**:
   - x64 คาดหวังทั้ง `modern` และ `baseline`
   - ไม่ใช่ x64 คาดหวังไฟล์ default หนึ่งไฟล์
3. **ตรวจสอบความพร้อมใช้งาน** ใน `packages/natives/native`
4. **สร้าง manifest** (`src/embedded-addon.ts`) ด้วย Bun `file` imports และ package version
5. **พร้อมแตกไฟล์ขณะ runtime** สำหรับโหมด compiled

`--reset` จะข้ามการตรวจสอบและเขียน null manifest stub (`embeddedAddon = null`)

## เวิร์กโฟลว์การพัฒนา vs พฤติกรรม shipped/compiled

## เวิร์กโฟลว์การพัฒนาในเครื่อง

วงจรการทำงานในเครื่องทั่วไป:

1. สร้าง addon:
   - release: `bun --cwd=packages/natives run build`
   - debug profile: `bun --cwd=packages/natives run dev:native`
2. กำหนด `PI_DEV=1` เมื่อทดสอบการวินิจฉัย loader
3. Loader ใน `native.ts` ค้นหาตัวเลือกใน `native/` ของแพ็กเกจ (และ executable-dir fallback)
4. `validateNative` บังคับใช้ความเข้ากันได้ของ export ก่อนที่ wrappers จะใช้ binding

## เวิร์กโฟลว์ไบนารี shipped/compiled

ในโหมด compiled (`PI_COMPILED` หรือ Bun embedded markers):

1. Loader คำนวณ versioned cache dir: `<getNativesDir()>/<packageVersion>` (ในการใช้งานจริงคือ `~/.xcsh/natives/<version>`)
2. ถ้า embedded manifest ตรงกับ platform+version ปัจจุบัน loader อาจแตกไฟล์ที่เลือกไว้ใน embedded ลงในไดเรกทอรีที่มี version นั้น
3. ลำดับตัวเลือกขณะ runtime รวมถึง:
   - versioned cache dir
   - legacy compiled-binary dir (`%LOCALAPPDATA%/xcsh` บน Windows, `~/.local/bin` บนระบบอื่น)
   - ไดเรกทอรีแพ็กเกจ/ไฟล์ปฏิบัติการ
4. addon ที่โหลดสำเร็จเป็นตัวแรกยังต้องผ่าน `validateNative`

นี่คือเหตุผลที่การ packaging + ความคาดหวังของ runtime loader ต้องสอดคล้องกัน: ชื่อไฟล์, platform tags, และ exported symbols ต้องตรงกับสิ่งที่ `native.ts` ตรวจสอบและ validate

## การแมป JS API ↔ Rust export (subset ของ validation gate)

`native.ts` กำหนดให้ exports ที่มองเห็นได้ใน JS เหล่านี้ต้องมีอยู่ใน addon ที่โหลดแล้ว โดยแมปกับ Rust N-API exports ใน `crates/pi-natives/src`:

| ชื่อ JS ที่ `validateNative` ต้องการ | การประกาศ Rust export | ไฟล์ต้นทาง Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (camel-cased export) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

ถ้าสัญลักษณ์ที่ต้องการขาดหายไป loader จะล้มเหลวทันทีพร้อมคำแนะนำการ rebuild

## พฤติกรรมเมื่อเกิดความล้มเหลวและการวินิจฉัย

## ความล้มเหลวในช่วง build-time

- การกำหนดค่า variant ไม่ถูกต้อง:
  - กำหนด `TARGET_VARIANT` บนสถาปัตยกรรมที่ไม่ใช่ x64 → ข้อผิดพลาดทันที
  - x64 cross-build ไม่มี explicit `TARGET_VARIANT` → ข้อผิดพลาดทันที
- ความล้มเหลวในการสร้าง Cargo:
  - สคริปต์แสดง exit code ที่ไม่ใช่ศูนย์และ stderr
- ไม่พบ artifact:
  - สคริปต์พิมพ์ทุกไดเรกทอรี profile ที่ตรวจสอบ
- ความล้มเหลวในการติดตั้ง:
  - ข้อความที่ชัดเจน; บน Windows รวมคำแนะนำเกี่ยวกับไฟล์ที่ถูกล็อก

## ความล้มเหลวของ runtime loader (`native.ts`)

- Platform tag ที่ไม่รองรับ:
  - throw พร้อมรายการ platform ที่รองรับ
- ไม่มีตัวเลือกใดที่โหลดได้:
  - throw พร้อมรายการข้อผิดพลาดของตัวเลือกทั้งหมดและคำแนะนำการแก้ไขตามโหมด
- Export ที่ขาดหายไป:
  - throw พร้อมชื่อสัญลักษณ์ที่ขาดหายไปอย่างแน่ชัดและคำสั่ง rebuild
- ปัญหาการแตกไฟล์ embedded:
  - ข้อผิดพลาด mkdir/write ขณะแตกไฟล์จะถูกบันทึกและรวมไว้ในการวินิจฉัยขั้นสุดท้าย

## ตารางการแก้ไขปัญหา

| อาการ | สาเหตุที่น่าจะเป็น | การตรวจสอบ | การแก้ไข |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ไบนารี `.node` ที่ล้าสมัย, ชื่อ Rust export ไม่ตรงกัน, หรือโหลดไบนารีผิดไฟล์ | รันด้วย `PI_DEV=1` เพื่อดู path ที่โหลด; ตรวจสอบรายการ export ของไฟล์นั้น | Rebuild `build`; ตรวจสอบให้แน่ใจว่าชื่อ Rust `#[napi]` export (หรือ alias ที่ชัดเจนเมื่อจำเป็น) ตรงกับ JS key; ลบไฟล์ที่แคชหรือมี version เก่า |
| เครื่อง x64 โหลด baseline แทน modern | `PI_NATIVE_VARIANT=baseline`, ไม่ตรวจพบ AVX2, หรือมีเฉพาะไฟล์ baseline | ตรวจสอบ `PI_NATIVE_VARIANT`; ตรวจสอบ `native/` สำหรับไฟล์ `-modern` | สร้าง modern variant (`TARGET_VARIANT=modern ... build`) และตรวจสอบให้แน่ใจว่าไฟล์ถูกรวมไว้ |
| Cross-build ผลิตไบนารีที่ใช้ไม่ได้/ติดป้ายกำกับผิด | ไม่ตรงกันระหว่าง `CROSS_TARGET` กับ `TARGET_PLATFORM`/`TARGET_ARCH`, หรือไม่มี `TARGET_VARIANT` สำหรับ x64 | ยืนยัน env tuple และชื่อไฟล์ output | รันใหม่ด้วยค่า env ที่สอดคล้องกันและ `TARGET_VARIANT` ที่ชัดเจนสำหรับ x64 |
| Compiled binary ล้มเหลวหลังอัปเกรด | แคชที่แตกไฟล์ไว้ล้าสมัย (`~/.xcsh/natives/<old-or-mismatched-version>`) หรือ embedded manifest ไม่ตรงกัน | ตรวจสอบ versioned natives dir และรายการข้อผิดพลาดของ loader | ลบ versioned natives cache สำหรับ package version นั้นและรันใหม่; สร้าง embedded manifest ใหม่ในช่วง packaging |
| Loader ตรวจสอบหลาย path แต่ไม่มีที่ใดทำงานได้ | Platform ไม่ตรงกันหรือไม่มี release artifact ใน `native/` ของแพ็กเกจ | ตรวจสอบ `platformTag` เทียบกับชื่อไฟล์จริง | ตรวจสอบให้แน่ใจว่าชื่อไฟล์ที่สร้างตรงกับข้อตกลง `pi_natives.<platform>-<arch>(-variant).node` และแพ็กเกจรวม `native/` ไว้ด้วย |
| `embed:native` ล้มเหลวพร้อม "Incomplete native addons" | ไม่ได้สร้างไฟล์ variant ที่ต้องการก่อน embedding | ตรวจสอบรายการ expected vs found ในข้อความแสดงข้อผิดพลาด | สร้างไฟล์ที่ต้องการก่อน (x64: ทั้ง modern+baseline; ไม่ใช่ x64: default) จากนั้นรัน `embed:native` อีกครั้ง |

## คำสั่งสำหรับการใช้งาน

```bash
# Release artifact สำหรับ host ปัจจุบัน
bun --cwd=packages/natives run build

# สร้าง debug profile artifact
bun --cwd=packages/natives run dev:native

# สร้าง x64 variants ที่ชัดเจน
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# สร้าง embedded addon manifest จากไฟล์ native ที่สร้างแล้ว
bun --cwd=packages/natives run embed:native

# รีเซ็ต embedded manifest เป็น null stub
bun --cwd=packages/natives run embed:native -- --reset
```
