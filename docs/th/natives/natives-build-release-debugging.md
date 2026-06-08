---
title: 'Natives Build, Release, and Debugging Runbook'
description: >-
  Build, release, and debugging runbook for the Rust native addon across
  platforms.
sidebar:
  order: 8
  label: 'Build, release & debugging'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# คู่มือปฏิบัติการ Build, Release และ Debugging ของ Natives

คู่มือปฏิบัติการนี้อธิบายวิธีที่ pipeline การ build ของ `@f5xc-salesdemos/pi-natives` สร้างไฟล์ addon `.node`, วิธีที่ distribution ที่ถูกคอมไพล์โหลดไฟล์เหล่านั้น และวิธีการ debug ปัญหาของ loader/build

คู่มือนี้ใช้คำศัพท์ทางสถาปัตยกรรมจาก `docs/natives-architecture.md`:

- **การสร้าง artifact ในขั้นตอน build** (`scripts/build-native.ts`)
- **การสร้าง manifest ของ addon ที่ฝังตัว** (`scripts/embed-native.ts`)
- **การโหลด addon ในขณะรันไทม์ + gate การตรวจสอบ** (`src/native.ts`)

## ไฟล์ที่เกี่ยวข้องกับการ implement

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## ภาพรวม pipeline การ build

### 1) จุดเริ่มต้นการ build

สคริปต์ใน `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build แบบ release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build แบบ debug/dev profile (ตั้งชื่อ output เหมือนกัน)
- `bun scripts/embed-native.ts` (`embed:native`) → สร้าง `src/embedded-addon.ts` จากไฟล์ที่ build แล้ว

### 2) การ build artifact ของ Rust

`build-native.ts` รัน Cargo ใน `crates/pi-natives`:

- คำสั่งพื้นฐาน: `cargo build`
- โหมด release จะเพิ่ม `--release` ยกเว้นเมื่อส่ง `--dev`
- cross target จะเพิ่ม `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` ประกาศ `crate-type = ["cdylib"]` ดังนั้น Cargo จะสร้าง shared library (`.so`/`.dylib`/`.dll`) ที่จากนั้นจะถูกคัดลอก/เปลี่ยนชื่อเป็นไฟล์ addon `.node`

### 3) การค้นหาและติดตั้ง artifact

หลังจาก Cargo ทำงานเสร็จ `build-native.ts` จะสแกนไดเรกทอรี output ที่เป็นไปได้ตามลำดับ:

1. `${CARGO_TARGET_DIR}` (ถ้าตั้งค่าไว้)
2. `<repo>/target`
3. `crates/pi-natives/target`

สำหรับแต่ละ root จะตรวจสอบไดเรกทอรี profile:

- cross build: `<root>/<crossTarget>/<profile>` จากนั้น `<root>/<profile>`
- native build: `<root>/<profile>`

จากนั้นจะค้นหาไฟล์ใดไฟล์หนึ่งจากรายการต่อไปนี้:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

เมื่อพบแล้ว จะติดตั้งแบบ atomic ไปยัง `packages/natives/native/` ด้วย semantics แบบ temp-file + rename (ตัว fallback ของ Windows จัดการกับความล้มเหลวในการแทนที่ DLL ที่ถูกล็อกอย่างชัดเจน)

## โมเดล target/variant และข้อตกลงการตั้งชื่อ

## Platform tag

ทั้งการ build และรันไทม์ใช้ platform tag:

`<platform>-<arch>` (ตัวอย่าง: `darwin-arm64`, `linux-x64`)

## โมเดล variant (เฉพาะ x64)

x64 รองรับ CPU variant:

- `modern` (เส้นทางที่รองรับ AVX2)
- `baseline` (ตัว fallback)

สถาปัตยกรรมที่ไม่ใช่ x64 ใช้ artifact เริ่มต้นเพียงตัวเดียว (ไม่มี suffix ของ variant)

### ชื่อไฟล์ output

Build แบบ release:

- x64: `pi_natives.<platform>-<arch>-modern.node` หรือ `...-baseline.node`
- ไม่ใช่ x64: `pi_natives.<platform>-<arch>.node`

Build แบบ dev (`--dev`):

- ใช้ flag ของ debug profile แต่คงรูปแบบการตั้งชื่อ output ตาม platform tag มาตรฐาน

ลำดับการค้นหา candidate ของ loader ในรันไทม์ใน `native.ts`:

- candidate แบบ release
- โหมด compiled จะเพิ่ม candidate ที่ถูก extract/cache ไว้ก่อนไฟล์ในแพ็กเกจ

## ค่า flag ของ environment และตัวเลือกการ build

## Flag สำหรับรันไทม์

- `PI_DEV` (พฤติกรรม loader): เปิดการวินิจฉัยของ loader
- `PI_NATIVE_VARIANT` (พฤติกรรม loader, เฉพาะ x64): บังคับเลือก `modern` หรือ `baseline` ในรันไทม์
- `PI_COMPILED` (พฤติกรรม loader): เปิดพฤติกรรม candidate/extraction สำหรับ compiled-binary

## Flag/ตัวเลือกสำหรับขั้นตอน build

- `--dev` (argument ของสคริปต์): build ด้วย debug profile
- `CROSS_TARGET`: ส่งไปยัง Cargo `--target`
- `TARGET_PLATFORM`: override การตั้งชื่อ platform tag ของ output
- `TARGET_ARCH`: override การตั้งชื่อ arch ของ output
- `TARGET_VARIANT` (เฉพาะ x64): บังคับ `modern` หรือ `baseline` สำหรับชื่อไฟล์ output และนโยบาย RUSTFLAGS
- `CARGO_TARGET_DIR`: root เพิ่มเติมเมื่อค้นหา output ของ Cargo
- `RUSTFLAGS`:
  - ถ้าไม่ได้ตั้งค่าและไม่ได้ cross-compile สคริปต์จะตั้งค่า:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - ไม่ใช่ x64 / ไม่มี variant: `-C target-cpu=native`
  - ถ้าตั้งค่าไว้แล้ว สคริปต์จะไม่ override

## การเปลี่ยนผ่านสถานะ/วงจรชีวิตของ build

### วงจรชีวิตของ build (`build-native.ts`)

1. **Init**: parse args/env (`--dev`, target override, cross flag)
2. **Variant resolve**:
   - ไม่ใช่ x64 → ไม่มี variant
   - x64 + `TARGET_VARIANT` → variant ที่ระบุชัดเจน
   - x64 cross-build โดยไม่มี `TARGET_VARIANT` → error ทันที
   - x64 local build โดยไม่มี override → ตรวจจับ AVX2 ของเครื่อง host
3. **Compile**: รัน Cargo ด้วย profile/target ที่ resolve แล้ว
4. **Locate artifact**: สแกน target root/ไดเรกทอรี profile/ชื่อ library
5. **Install**: คัดลอก + atomic rename ไปยัง `packages/natives/native`
6. **Complete**: addon พร้อมสำหรับ candidate ของ loader

ความล้มเหลวจะออกจากโปรแกรมในทุกขั้นตอนพร้อมข้อความ error ที่ชัดเจน (variant ไม่ถูกต้อง, cargo build ล้มเหลว, ไม่พบ output library, การติดตั้ง/rename ล้มเหลว)

### วงจรชีวิตของ embed (`embed-native.ts`)

1. **Init**: คำนวณ platform tag จาก `TARGET_PLATFORM`/`TARGET_ARCH` หรือค่าของเครื่อง host
2. **Candidate set**:
   - x64 คาดหวังทั้ง `modern` และ `baseline`
   - ไม่ใช่ x64 คาดหวังไฟล์เริ่มต้นหนึ่งไฟล์
3. **ตรวจสอบความพร้อมใช้งาน** ใน `packages/natives/native`
4. **สร้าง manifest** (`src/embedded-addon.ts`) ด้วย Bun `file` import และเวอร์ชันของแพ็กเกจ
5. **พร้อมสำหรับการ extract ในรันไทม์** สำหรับโหมด compiled

`--reset` จะข้ามการตรวจสอบและเขียน manifest stub ที่เป็น null (`embeddedAddon = null`)

## เวิร์กโฟลว์การพัฒนา vs พฤติกรรมของไบนารีที่จัดส่ง/คอมไพล์

## เวิร์กโฟลว์การพัฒนาในเครื่อง

ลูปการพัฒนาในเครื่องทั่วไป:

1. Build addon:
   - release: `bun --cwd=packages/natives run build`
   - debug profile: `bun --cwd=packages/natives run dev:native`
2. ตั้งค่า `PI_DEV=1` เมื่อต้องการทดสอบการวินิจฉัยของ loader
3. Loader ใน `native.ts` จะ resolve candidate จาก `native/` ในแพ็กเกจ (และ fallback ไดเรกทอรีของ executable)
4. `validateNative` บังคับความเข้ากันได้ของ export ก่อนที่ wrapper จะใช้ binding

## เวิร์กโฟลว์ไบนารีที่จัดส่ง/คอมไพล์

ในโหมด compiled (`PI_COMPILED` หรือ marker ฝังตัวของ Bun):

1. Loader คำนวณไดเรกทอรี cache ที่มีเวอร์ชัน: `<getNativesDir()>/<packageVersion>` (ในทางปฏิบัติคือ `~/.xcsh/natives/<version>`)
2. ถ้า manifest ที่ฝังตัวตรงกับ platform+version ปัจจุบัน loader อาจ extract ไฟล์ที่ฝังตัวที่เลือกไว้ไปยังไดเรกทอรีที่มีเวอร์ชันนั้น
3. ลำดับ candidate ในรันไทม์รวมถึง:
   - ไดเรกทอรี cache ที่มีเวอร์ชัน
   - ไดเรกทอรี compiled-binary แบบเก่า (`%LOCALAPPDATA%/xcsh` บน Windows, `~/.local/bin` สำหรับอื่น ๆ)
   - ไดเรกทอรีแพ็กเกจ/executable
4. Addon ตัวแรกที่โหลดสำเร็จยังคงต้องผ่าน `validateNative`

นี่คือเหตุผลที่การ packaging + ความคาดหวังของ loader ในรันไทม์ต้องสอดคล้องกัน: ชื่อไฟล์, platform tag และ symbol ที่ export ต้องตรงกับที่ `native.ts` ตรวจสอบและ validate

## การ mapping JS API ↔ Rust export (ชุดย่อยของ validation gate)

`native.ts` ต้องการให้ export ที่มองเห็นได้จาก JS เหล่านี้มีอยู่บน addon ที่โหลด ซึ่ง map ไปยัง Rust N-API export ใน `crates/pi-natives/src`:

| ชื่อ JS ที่ `validateNative` ต้องการ | การประกาศ Rust export | ไฟล์ซอร์ส Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export แบบ camel-case) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

ถ้า symbol ที่จำเป็นตัวใดหายไป loader จะ fail fast พร้อมคำแนะนำให้ rebuild

## พฤติกรรมเมื่อเกิดความล้มเหลวและการวินิจฉัย

## ความล้มเหลวขั้นตอน build

- การกำหนดค่า variant ไม่ถูกต้อง:
  - ตั้ง `TARGET_VARIANT` บนสถาปัตยกรรมที่ไม่ใช่ x64 → error ทันที
  - x64 cross-build โดยไม่ระบุ `TARGET_VARIANT` อย่างชัดเจน → error ทันที
- Cargo build ล้มเหลว:
  - สคริปต์แสดง exit code ที่ไม่ใช่ศูนย์และ stderr
- ไม่พบ artifact:
  - สคริปต์แสดงทุกไดเรกทอรี profile ที่ตรวจสอบแล้ว
- การติดตั้งล้มเหลว:
  - ข้อความที่ชัดเจน; บน Windows จะมีคำแนะนำเรื่องไฟล์ที่ถูกล็อก

## ความล้มเหลวของ loader ในรันไทม์ (`native.ts`)

- Platform tag ที่ไม่รองรับ:
  - throw พร้อมรายการ platform ที่รองรับ
- ไม่มี candidate ใดโหลดได้:
  - throw พร้อมรายการ error ของ candidate ทั้งหมดและคำแนะนำการแก้ไขเฉพาะโหมด
- Export หายไป:
  - throw พร้อมชื่อ symbol ที่หายไปอย่างชัดเจนและคำสั่ง rebuild
- ปัญหาการ extract ของ embedded:
  - error ในการ mkdir/write ถูกบันทึกและรวมอยู่ในการวินิจฉัยสุดท้าย

## ตารางการแก้ไขปัญหา

| อาการ | สาเหตุที่เป็นไปได้ | วิธีตรวจสอบ | วิธีแก้ไข |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ไบนารี `.node` เก่า, ชื่อ Rust export ไม่ตรงกัน, หรือโหลดไบนารีผิดตัว | รันด้วย `PI_DEV=1` เพื่อดู path ที่โหลด; ตรวจสอบรายการ export ของไฟล์นั้น | Rebuild ด้วย `build`; ตรวจสอบว่าชื่อ Rust `#[napi]` export (หรือ alias ที่ระบุชัดเจนเมื่อจำเป็น) ตรงกับ JS key; ลบไฟล์ cached/versioned ที่เก่า |
| เครื่อง x64 โหลด baseline ทั้งที่คาดหวัง modern | `PI_NATIVE_VARIANT=baseline`, ตรวจไม่พบ AVX2, หรือมีเฉพาะไฟล์ baseline | ตรวจสอบ `PI_NATIVE_VARIANT`; ตรวจสอบ `native/` ว่ามีไฟล์ `-modern` หรือไม่ | Build variant modern (`TARGET_VARIANT=modern ... build`) และตรวจสอบว่าไฟล์ถูกรวมในการจัดส่ง |
| Cross-build สร้างไบนารีที่ใช้ไม่ได้/ตั้งชื่อผิด | ความไม่ตรงกันระหว่าง `CROSS_TARGET` กับ `TARGET_PLATFORM`/`TARGET_ARCH`, หรือขาด `TARGET_VARIANT` สำหรับ x64 | ยืนยัน tuple ของ env และชื่อไฟล์ output | รันใหม่ด้วยค่า env ที่สอดคล้องกันและ `TARGET_VARIANT` สำหรับ x64 ที่ระบุชัดเจน |
| ไบนารี compiled ล้มเหลวหลังอัปเกรด | cache ที่ extract ไว้เก่า (`~/.xcsh/natives/<old-or-mismatched-version>`) หรือ manifest ที่ฝังตัวไม่ตรงกัน | ตรวจสอบไดเรกทอรี natives ที่มีเวอร์ชันและรายการ error ของ loader | ลบ cache natives ที่มีเวอร์ชันสำหรับเวอร์ชันแพ็กเกจนั้นแล้วรันใหม่; สร้าง manifest ที่ฝังตัวใหม่ระหว่างการ packaging |
| Loader ตรวจสอบหลาย path แต่ไม่มีตัวใดทำงานได้ | platform ไม่ตรงกันหรือไม่มี release artifact ใน `native/` ของแพ็กเกจ | ตรวจสอบ `platformTag` เทียบกับชื่อไฟล์จริง | ตรวจสอบว่าชื่อไฟล์ที่ build ตรงกับข้อตกลง `pi_natives.<platform>-<arch>(-variant).node` อย่างแม่นยำและแพ็กเกจรวม `native/` |
| `embed:native` ล้มเหลวด้วย "Incomplete native addons" | ไม่ได้ build ไฟล์ variant ที่จำเป็นก่อนการ embed | ตรวจสอบรายการที่คาดหวัง vs ที่พบในข้อความ error | Build ไฟล์ที่จำเป็นก่อน (x64: ทั้ง modern+baseline; ไม่ใช่ x64: default) จากนั้นรัน `embed:native` ใหม่ |

## คำสั่งปฏิบัติการ

```bash
# Release artifact สำหรับเครื่อง host ปัจจุบัน
bun --cwd=packages/natives run build

# Build artifact แบบ debug profile
bun --cwd=packages/natives run dev:native

# Build variant x64 แบบระบุชัดเจน
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# สร้าง manifest ของ embedded addon จากไฟล์ native ที่ build แล้ว
bun --cwd=packages/natives run embed:native

# รีเซ็ต manifest ของ embedded เป็น null stub
bun --cwd=packages/natives run embed:native -- --reset
```
