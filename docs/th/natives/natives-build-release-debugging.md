---
title: 'Natives Build, Release, and Debugging Runbook'
description: >-
  Build, release, and debugging runbook for the Rust native addon across
  platforms.
sidebar:
  order: 8
  label: 'การ Build, Release และการดีบัก'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Natives Build, Release และ Debugging Runbook

Runbook นี้อธิบายวิธีที่ pipeline การ build ของ `@f5xc-salesdemos/pi-natives` สร้าง `.node` addons วิธีที่ distribution ที่คอมไพล์แล้วโหลด addons เหล่านี้ และวิธีดีบักข้อผิดพลาดของ loader/build

เนื้อหาอ้างอิงคำศัพท์ด้านสถาปัตยกรรมจาก `docs/natives-architecture.md`:

- **การผลิต artifact ในช่วง build-time** (`scripts/build-native.ts`)
- **การสร้าง embedded addon manifest** (`scripts/embed-native.ts`)
- **การโหลด addon ขณะ runtime + validation gate** (`src/native.ts`)

## ไฟล์ที่เกี่ยวข้องในการดำเนินการ

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## ภาพรวม Build Pipeline

### 1) จุดเข้าสู่กระบวนการ Build

สคริปต์ใน `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → สร้าง release build
- `bun scripts/build-native.ts --dev` (`dev:native`) → สร้าง debug/dev profile build (ใช้ชื่อ output เหมือนกัน)
- `bun scripts/embed-native.ts` (`embed:native`) → สร้าง `src/embedded-addon.ts` จากไฟล์ที่ build แล้ว

### 2) การ Build Rust Artifact

`build-native.ts` รัน Cargo ใน `crates/pi-natives`:

- คำสั่งพื้นฐาน: `cargo build`
- release mode เพิ่ม `--release` เว้นแต่จะมีการส่ง `--dev`
- cross target เพิ่ม `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` ประกาศ `crate-type = ["cdylib"]` ดังนั้น Cargo จะสร้าง shared library (`.so`/`.dylib`/`.dll`) ซึ่งจะถูกคัดลอก/เปลี่ยนชื่อเป็นชื่อไฟล์ `.node` addon

### 3) การค้นหาและติดตั้ง Artifact

หลังจาก Cargo เสร็จสิ้น `build-native.ts` จะสแกนไดเรกทอรี output ที่เป็นไปได้ตามลำดับ:

1. `${CARGO_TARGET_DIR}` (หากมีการตั้งค่า)
2. `<repo>/target`
3. `crates/pi-natives/target`

สำหรับแต่ละ root จะตรวจสอบไดเรกทอรี profile:

- cross build: `<root>/<crossTarget>/<profile>` จากนั้น `<root>/<profile>`
- native build: `<root>/<profile>`

จากนั้นจะค้นหาไฟล์ใดไฟล์หนึ่งต่อไปนี้:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

เมื่อพบแล้ว จะติดตั้งเข้าสู่ `packages/natives/native/` แบบ atomic ด้วย temp-file + rename semantics (Windows fallback จัดการกับข้อผิดพลาดการแทนที่ DLL ที่ถูกล็อกอย่างชัดเจน)

## โมเดล Target/Variant และหลักการตั้งชื่อ

## Platform Tag

ทั้ง build และ runtime ใช้ platform tag:

`<platform>-<arch>` (ตัวอย่าง: `darwin-arm64`, `linux-x64`)

## Variant Model (เฉพาะ x64)

x64 รองรับ CPU variants:

- `modern` (เส้นทางสำหรับ CPU ที่รองรับ AVX2)
- `baseline` (ตัวเลือกสำรอง)

สถาปัตยกรรมที่ไม่ใช่ x64 ใช้ artifact เดียวโดยไม่มี variant suffix

### ชื่อไฟล์ Output

สำหรับ release builds:

- x64: `pi_natives.<platform>-<arch>-modern.node` หรือ `...-baseline.node`
- non-x64: `pi_natives.<platform>-<arch>.node`

Dev build (`--dev`):

- ใช้ debug profile flags แต่ยังคงใช้ชื่อ output ที่มี platform tag มาตรฐาน

ลำดับ candidate ของ runtime loader ใน `native.ts`:

- release candidates
- compiled mode จะเพิ่ม extracted/cache candidates ไว้ก่อนไฟล์ package-local

## Environment Flags และตัวเลือกการ Build

## Runtime Flags

- `PI_DEV` (พฤติกรรม loader): เปิดใช้งาน loader diagnostics
- `PI_NATIVE_VARIANT` (พฤติกรรม loader, เฉพาะ x64): บังคับเลือก `modern` หรือ `baseline` ขณะ runtime
- `PI_COMPILED` (พฤติกรรม loader): เปิดใช้งานพฤติกรรม compiled-binary candidate/extraction

## Build-time Flags/Options

- `--dev` (script arg): สร้าง debug profile
- `CROSS_TARGET`: ส่งต่อไปยัง Cargo `--target`
- `TARGET_PLATFORM`: กำหนด platform tag ของ output เอง
- `TARGET_ARCH`: กำหนด arch ของ output เอง
- `TARGET_VARIANT` (เฉพาะ x64): บังคับใช้ `modern` หรือ `baseline` สำหรับชื่อไฟล์ output และนโยบาย RUSTFLAGS
- `CARGO_TARGET_DIR`: root เพิ่มเติมเมื่อค้นหา Cargo outputs
- `RUSTFLAGS`:
  - หากไม่ได้ตั้งค่าและไม่ได้ cross-compiling สคริปต์จะตั้งค่า:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - non-x64 / ไม่มี variant: `-C target-cpu=native`
  - หากมีการตั้งค่าแล้ว สคริปต์จะไม่ทับค่า

## Build State/Lifecycle Transitions

### Build Lifecycle (`build-native.ts`)

1. **Init**: แยก args/env (`--dev`, target overrides, cross flags)
2. **Variant resolve**:
   - non-x64 → ไม่มี variant
   - x64 + `TARGET_VARIANT` → variant ที่กำหนดชัดเจน
   - x64 cross-build ไม่มี `TARGET_VARIANT` → hard error
   - x64 local build ไม่มี override → ตรวจสอบ host AVX2
3. **Compile**: รัน Cargo ด้วย profile/target ที่กำหนด
4. **Locate artifact**: สแกน target roots/profile dirs/library names
5. **Install**: คัดลอก + atomic rename เข้าสู่ `packages/natives/native`
6. **Complete**: addon พร้อมสำหรับ loader candidates

หากเกิดข้อผิดพลาดจะออกจากกระบวนการทุกขั้นตอนพร้อมข้อความแสดงข้อผิดพลาดที่ชัดเจน (invalid variant, Cargo build ล้มเหลว, ไม่พบ output library, install/rename ล้มเหลว)

### Embed Lifecycle (`embed-native.ts`)

1. **Init**: คำนวณ platform tag จาก `TARGET_PLATFORM`/`TARGET_ARCH` หรือค่าของ host
2. **Candidate set**:
   - x64 คาดหวังทั้ง `modern` และ `baseline`
   - non-x64 คาดหวังไฟล์ default หนึ่งไฟล์
3. **ตรวจสอบความพร้อม** ใน `packages/natives/native`
4. **สร้าง manifest** (`src/embedded-addon.ts`) ด้วย Bun `file` imports และ package version
5. **พร้อมสำหรับ runtime extraction** สำหรับ compiled mode

`--reset` จะข้ามการตรวจสอบและเขียน null manifest stub (`embeddedAddon = null`)

## Dev Workflow เทียบกับพฤติกรรมแบบ Shipped/Compiled

## Local Development Workflow

รูปแบบการทำงานในเครื่องทั่วไป:

1. Build addon:
   - release: `bun --cwd=packages/natives run build`
   - debug profile: `bun --cwd=packages/natives run dev:native`
2. ตั้งค่า `PI_DEV=1` เมื่อทดสอบ loader diagnostics
3. Loader ใน `native.ts` จะค้นหา package-local `native/` (และ executable-dir fallback) candidates
4. `validateNative` บังคับให้ตรวจสอบความเข้ากันได้ของ export ก่อนที่ wrappers จะใช้ binding

## Shipped/Compiled Binary Workflow

ใน compiled mode (`PI_COMPILED` หรือ Bun embedded markers):

1. Loader คำนวณ versioned cache dir: `<getNativesDir()>/<packageVersion>` (ในทางปฏิบัติคือ `~/.xcsh/natives/<version>`)
2. หาก embedded manifest ตรงกับ platform+version ปัจจุบัน loader อาจ extract ไฟล์ embedded ที่เลือกไว้เข้าสู่ versioned dir นั้น
3. ลำดับ runtime candidate รวมถึง:
   - versioned cache dir
   - legacy compiled-binary dir (`%LOCALAPPDATA%/xcsh` บน Windows, `~/.local/bin` สำหรับระบบอื่น)
   - ไดเรกทอรี package/executable
4. addon ที่โหลดสำเร็จเป็นตัวแรกยังต้องผ่าน `validateNative`

นี่คือเหตุผลที่ packaging และความคาดหวังของ runtime loader ต้องสอดคล้องกัน: ชื่อไฟล์ platform tags และ exported symbols ต้องตรงกับที่ `native.ts` ตรวจสอบและ validate

## การแมป JS API ↔ Rust Export (subset ของ validation gate)

`native.ts` กำหนดให้ export ที่มองเห็นจาก JS เหล่านี้ต้องมีอยู่ใน addon ที่โหลด โดยแมปกับ Rust N-API exports ใน `crates/pi-natives/src`:

| ชื่อ JS ที่กำหนดโดย `validateNative` | การประกาศ Rust export | ไฟล์ Rust source |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (camel-cased export) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

หากไม่พบ symbol ที่กำหนดใดๆ loader จะหยุดทันทีพร้อมคำแนะนำให้ rebuild

## พฤติกรรมเมื่อเกิดข้อผิดพลาดและการวินิจฉัย

## ข้อผิดพลาดในช่วง Build-time

- การกำหนดค่า variant ไม่ถูกต้อง:
  - ตั้งค่า `TARGET_VARIANT` บน non-x64 → เกิดข้อผิดพลาดทันที
  - x64 cross-build ไม่มี `TARGET_VARIANT` ที่กำหนดชัดเจน → เกิดข้อผิดพลาดทันที
- Cargo build ล้มเหลว:
  - สคริปต์แสดง exit code ที่ไม่ใช่ศูนย์และ stderr
- ไม่พบ artifact:
  - สคริปต์แสดงทุก profile directory ที่ตรวจสอบแล้ว
- Install ล้มเหลว:
  - แสดงข้อความที่ชัดเจน; Windows รวมคำใบ้เกี่ยวกับไฟล์ที่ถูกล็อก

## ข้อผิดพลาดของ Runtime Loader (`native.ts`)

- Platform tag ไม่รองรับ:
  - แสดง error พร้อมรายการ platform ที่รองรับ
- ไม่มี candidate ใดโหลดได้:
  - แสดง error พร้อมรายการข้อผิดพลาดของ candidate ทั้งหมดและคำใบ้แก้ไขที่เฉพาะเจาะจงตาม mode
- Export หายไป:
  - แสดง error พร้อมชื่อ symbol ที่หายไปอย่างแม่นยำและคำสั่ง rebuild
- ปัญหาการ extract แบบ embedded:
  - ข้อผิดพลาด mkdir/write ในการ extraction จะถูกบันทึกและรวมไว้ใน diagnostics สุดท้าย

## ตารางการแก้ไขปัญหา

| อาการ | สาเหตุที่เป็นไปได้ | วิธีตรวจสอบ | วิธีแก้ไข |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ไฟล์ `.node` ที่ล้าสมัย ชื่อ Rust export ไม่ตรงกัน หรือโหลด binary ผิดไฟล์ | รันด้วย `PI_DEV=1` เพื่อดูเส้นทางที่โหลด; ตรวจสอบรายการ export ของไฟล์นั้น | Rebuild ด้วย `build`; ตรวจสอบให้ชื่อ Rust `#[napi]` export (หรือ explicit alias หากจำเป็น) ตรงกับ JS key; ลบไฟล์ cached/versioned ที่ล้าสมัย |
| เครื่อง x64 โหลด baseline แทน modern ที่คาดไว้ | `PI_NATIVE_VARIANT=baseline`, ไม่พบ AVX2 หรือมีเฉพาะไฟล์ baseline | ตรวจสอบ `PI_NATIVE_VARIANT`; ตรวจสอบ `native/` สำหรับไฟล์ `-modern` | Build modern variant (`TARGET_VARIANT=modern ... build`) และตรวจสอบให้แน่ใจว่าไฟล์ถูกจัดส่ง |
| Cross-build สร้าง binary ที่ใช้งานไม่ได้/มี label ผิด | ความไม่ตรงกันระหว่าง `CROSS_TARGET` และ `TARGET_PLATFORM`/`TARGET_ARCH` หรือขาด `TARGET_VARIANT` สำหรับ x64 | ยืนยัน env tuple และชื่อไฟล์ output | รันใหม่ด้วยค่า env ที่สอดคล้องกันและ x64 `TARGET_VARIANT` ที่กำหนดชัดเจน |
| Compiled binary ล้มเหลวหลัง upgrade | Extracted cache ที่ล้าสมัย (`~/.xcsh/natives/<old-or-mismatched-version>`) หรือ embedded manifest ไม่ตรงกัน | ตรวจสอบ versioned natives dir และรายการข้อผิดพลาดของ loader | ลบ versioned natives cache สำหรับ package version และรันใหม่; สร้าง embedded manifest ใหม่ระหว่าง packaging |
| Loader ตรวจสอบหลาย path แต่ไม่มีที่ใดทำงานได้ | Platform ไม่ตรงกันหรือไม่มี release artifact ใน `native/` ของ package | ตรวจสอบ `platformTag` เทียบกับชื่อไฟล์จริง | ตรวจสอบให้ชื่อไฟล์ที่ build ตรงกับรูปแบบ `pi_natives.<platform>-<arch>(-variant).node` อย่างแม่นยำ และ package รวมไดเรกทอรี `native/` |
| `embed:native` ล้มเหลวด้วย "Incomplete native addons" | ไฟล์ variant ที่ต้องการยังไม่ได้ build ก่อน embedding | ตรวจสอบรายการ expected vs found ในข้อความ error | Build ไฟล์ที่ต้องการก่อน (x64: ทั้ง modern+baseline; non-x64: default) จากนั้นรัน `embed:native` ใหม่ |

## คำสั่งปฏิบัติการ

```bash
# Release artifact สำหรับ host ปัจจุบัน
bun --cwd=packages/natives run build

# Debug profile artifact build
bun --cwd=packages/natives run dev:native

# Build explicit x64 variants
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# สร้าง embedded addon manifest จากไฟล์ native ที่ build แล้ว
bun --cwd=packages/natives run embed:native

# รีเซ็ต embedded manifest เป็น null stub
bun --cwd=packages/natives run embed:native -- --reset
```
