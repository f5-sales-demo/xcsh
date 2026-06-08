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

คู่มือปฏิบัติการนี้อธิบายวิธีที่ pipeline การ build ของ `@f5xc-salesdemos/pi-natives` สร้าง addon `.node`, วิธีที่ distribution ที่คอมไพล์แล้วโหลดไฟล์เหล่านี้ และวิธีการ debug ปัญหาของ loader/build

คู่มือนี้ใช้คำศัพท์สถาปัตยกรรมจาก `docs/natives-architecture.md`:

- **การผลิต artifact ในขั้นตอน build** (`scripts/build-native.ts`)
- **การสร้าง manifest ของ addon แบบฝังตัว** (`scripts/embed-native.ts`)
- **การโหลด addon ในขั้นตอน runtime + ด่านตรวจสอบความถูกต้อง** (`src/native.ts`)

## ไฟล์ implementation

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## ภาพรวม pipeline การ build

### 1) จุดเริ่มต้นการ build

สคริปต์ใน `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build แบบ release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build แบบ debug/dev profile (ใช้การตั้งชื่อ output เหมือนกัน)
- `bun scripts/embed-native.ts` (`embed:native`) → สร้าง `src/embedded-addon.ts` จากไฟล์ที่ build แล้ว

### 2) การ build artifact ของ Rust

`build-native.ts` รัน Cargo ใน `crates/pi-natives`:

- คำสั่งพื้นฐาน: `cargo build`
- โหมด release จะเพิ่ม `--release` ยกเว้นกรณีที่ส่ง `--dev`
- cross target จะเพิ่ม `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` ประกาศ `crate-type = ["cdylib"]` ดังนั้น Cargo จะสร้าง shared library (`.so`/`.dylib`/`.dll`) ที่จากนั้นจะถูกคัดลอก/เปลี่ยนชื่อเป็นชื่อไฟล์ addon `.node`

### 3) การค้นหาและติดตั้ง artifact

หลังจาก Cargo ทำงานเสร็จ `build-native.ts` จะสแกนไดเรกทอรี output ที่เป็นตัวเลือกตามลำดับ:

1. `${CARGO_TARGET_DIR}` (ถ้ามีการตั้งค่า)
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

เมื่อพบแล้ว จะติดตั้งลงใน `packages/natives/native/` แบบ atomic ด้วยกลไก temp-file + rename (fallback สำหรับ Windows จัดการความล้มเหลวในการแทนที่ DLL ที่ถูกล็อกอย่างชัดเจน)

## โมเดล target/variant และข้อตกลงการตั้งชื่อ

## แท็ก platform

ทั้งการ build และ runtime ใช้แท็ก platform:

`<platform>-<arch>` (ตัวอย่าง: `darwin-arm64`, `linux-x64`)

## โมเดล variant (เฉพาะ x64)

x64 รองรับ CPU variant:

- `modern` (เส้นทางที่รองรับ AVX2)
- `baseline` (ตัวเลือกสำรอง)

สถาปัตยกรรมที่ไม่ใช่ x64 ใช้ artifact เดียวแบบ default (ไม่มี suffix ของ variant)

### ชื่อไฟล์ output

Build แบบ release:

- x64: `pi_natives.<platform>-<arch>-modern.node` หรือ `...-baseline.node`
- ไม่ใช่ x64: `pi_natives.<platform>-<arch>.node`

Build แบบ dev (`--dev`):

- ใช้ flag ของ debug profile แต่คงการตั้งชื่อ output แบบ platform-tagged มาตรฐาน

ลำดับตัวเลือกของ runtime loader ใน `native.ts`:

- ตัวเลือก release
- โหมดคอมไพล์จะเพิ่มตัวเลือกจาก extracted/cache ก่อนไฟล์ในแพ็กเกจ

## flag สภาพแวดล้อมและตัวเลือกการ build

## flag สำหรับ runtime

- `PI_DEV` (พฤติกรรม loader): เปิดใช้งานการวินิจฉัยของ loader
- `PI_NATIVE_VARIANT` (พฤติกรรม loader, เฉพาะ x64): บังคับเลือก `modern` หรือ `baseline` ในขณะ runtime
- `PI_COMPILED` (พฤติกรรม loader): เปิดใช้งานพฤติกรรมตัวเลือก/การแยก compiled-binary

## flag/ตัวเลือกในขั้นตอน build

- `--dev` (อาร์กิวเมนต์สคริปต์): build แบบ debug profile
- `CROSS_TARGET`: ส่งไปยัง Cargo `--target`
- `TARGET_PLATFORM`: แทนที่การตั้งชื่อแท็ก platform ของ output
- `TARGET_ARCH`: แทนที่การตั้งชื่อ arch ของ output
- `TARGET_VARIANT` (เฉพาะ x64): บังคับ `modern` หรือ `baseline` สำหรับชื่อไฟล์ output และนโยบาย RUSTFLAGS
- `CARGO_TARGET_DIR`: root เพิ่มเติมเมื่อค้นหา output ของ Cargo
- `RUSTFLAGS`:
  - ถ้าไม่ได้ตั้งค่าและไม่ได้ cross-compile สคริปต์จะตั้งค่า:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - ไม่ใช่ x64 / ไม่มี variant: `-C target-cpu=native`
  - ถ้าตั้งค่าไว้แล้ว สคริปต์จะไม่แทนที่

## การเปลี่ยนสถานะ/วงจรชีวิตของ build

### วงจรชีวิต build (`build-native.ts`)

1. **Init**: วิเคราะห์อาร์กิวเมนต์/ตัวแปรสภาพแวดล้อม (`--dev`, การแทนที่ target, flag สำหรับ cross)
2. **Variant resolve**:
   - ไม่ใช่ x64 → ไม่มี variant
   - x64 + `TARGET_VARIANT` → variant ที่ระบุชัดเจน
   - x64 cross-build โดยไม่มี `TARGET_VARIANT` → error ทันที
   - x64 local build โดยไม่มีการแทนที่ → ตรวจจับ AVX2 ของเครื่อง host
3. **Compile**: รัน Cargo ด้วย profile/target ที่ resolve แล้ว
4. **Locate artifact**: สแกน target root/ไดเรกทอรี profile/ชื่อ library
5. **Install**: คัดลอก + atomic rename ลงใน `packages/natives/native`
6. **Complete**: addon พร้อมสำหรับตัวเลือกของ loader

ความล้มเหลวจะออกจากโปรแกรมที่ขั้นตอนใดก็ได้พร้อมข้อความ error ที่ชัดเจน (variant ไม่ถูกต้อง, cargo build ล้มเหลว, ไม่พบ library output, การติดตั้ง/rename ล้มเหลว)

### วงจรชีวิต embed (`embed-native.ts`)

1. **Init**: คำนวณแท็ก platform จาก `TARGET_PLATFORM`/`TARGET_ARCH` หรือค่าของเครื่อง host
2. **Candidate set**:
   - x64 คาดหวังทั้ง `modern` และ `baseline`
   - ไม่ใช่ x64 คาดหวังไฟล์ default หนึ่งไฟล์
3. **Validate availability** ใน `packages/natives/native`
4. **Generate manifest** (`src/embedded-addon.ts`) ด้วย Bun `file` import และเวอร์ชันของแพ็กเกจ
5. **Runtime extraction ready** สำหรับโหมดคอมไพล์

`--reset` ข้ามการตรวจสอบและเขียน manifest stub ที่เป็น null (`embeddedAddon = null`)

## ขั้นตอนการทำงานแบบ dev เทียบกับพฤติกรรมแบบ shipped/compiled

## ขั้นตอนการทำงานสำหรับการพัฒนาในเครื่อง

ลูปการพัฒนาในเครื่องทั่วไป:

1. Build addon:
   - release: `bun --cwd=packages/natives run build`
   - debug profile: `bun --cwd=packages/natives run dev:native`
2. ตั้งค่า `PI_DEV=1` เมื่อทดสอบการวินิจฉัยของ loader
3. Loader ใน `native.ts` resolve ตัวเลือกจาก `native/` ในแพ็กเกจ (และ fallback ไดเรกทอรีของ executable)
4. `validateNative` บังคับความเข้ากันได้ของ export ก่อนที่ wrapper จะใช้ binding

## ขั้นตอนการทำงานสำหรับ shipped/compiled binary

ในโหมดคอมไพล์ (`PI_COMPILED` หรือ marker แบบฝังตัวของ Bun):

1. Loader คำนวณไดเรกทอรี cache ตามเวอร์ชัน: `<getNativesDir()>/<packageVersion>` (ในทางปฏิบัติคือ `~/.xcsh/natives/<version>`)
2. ถ้า manifest แบบฝังตัวตรงกับ platform+version ปัจจุบัน loader อาจแยกไฟล์แบบฝังตัวที่เลือกไว้ลงในไดเรกทอรีตามเวอร์ชันนั้น
3. ลำดับตัวเลือกของ runtime ประกอบด้วย:
   - ไดเรกทอรี cache ตามเวอร์ชัน
   - ไดเรกทอรี compiled-binary แบบเดิม (`%LOCALAPPDATA%/xcsh` บน Windows, `~/.local/bin` สำหรับแพลตฟอร์มอื่น)
   - ไดเรกทอรีของแพ็กเกจ/executable
4. addon ตัวแรกที่โหลดสำเร็จยังคงต้องผ่าน `validateNative`

นี่คือเหตุผลว่าทำไมการ packaging + ความคาดหวังของ runtime loader ต้องสอดคล้องกัน: ชื่อไฟล์, แท็ก platform และ symbol ที่ export ต้องตรงกับสิ่งที่ `native.ts` ตรวจสอบและ validate

## การ mapping JS API ↔ Rust export (ชุดย่อยของด่านตรวจสอบ)

`native.ts` กำหนดให้ export ที่มองเห็นจาก JS เหล่านี้ต้องมีอยู่ใน addon ที่โหลด ซึ่ง map กับ Rust N-API export ใน `crates/pi-natives/src`:

| ชื่อ JS ที่ `validateNative` ต้องการ | การประกาศ Rust export | ไฟล์ซอร์ส Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export แบบ camel-case) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

ถ้า symbol ที่จำเป็นใดหายไป loader จะ fail ทันทีพร้อมคำแนะนำให้ rebuild

## พฤติกรรมเมื่อเกิดความล้มเหลวและการวินิจฉัย

## ความล้มเหลวในขั้นตอน build

- การกำหนดค่า variant ไม่ถูกต้อง:
  - `TARGET_VARIANT` ตั้งค่าบนสถาปัตยกรรมที่ไม่ใช่ x64 → error ทันที
  - x64 cross-build โดยไม่มี `TARGET_VARIANT` ที่ระบุชัดเจน → error ทันที
- Cargo build ล้มเหลว:
  - สคริปต์แสดง exit code ที่ไม่ใช่ศูนย์และ stderr
- ไม่พบ artifact:
  - สคริปต์พิมพ์ไดเรกทอรี profile ทั้งหมดที่ตรวจสอบ
- การติดตั้งล้มเหลว:
  - ข้อความชัดเจน; Windows รวมคำแนะนำเกี่ยวกับไฟล์ที่ถูกล็อก

## ความล้มเหลวของ runtime loader (`native.ts`)

- แท็ก platform ที่ไม่รองรับ:
  - throw พร้อมรายการ platform ที่รองรับ
- ไม่สามารถโหลดตัวเลือกใดได้:
  - throw พร้อมรายการ error ของตัวเลือกทั้งหมดและคำแนะนำการแก้ไขตามโหมด
- export หายไป:
  - throw พร้อมชื่อ symbol ที่หายไปอย่างชัดเจนและคำสั่ง rebuild
- ปัญหาการแยก embedded:
  - error ของ mkdir/write ในการแยกจะถูกบันทึกและรวมอยู่ในการวินิจฉัยขั้นสุดท้าย

## ตารางแก้ไขปัญหา

| อาการ | สาเหตุที่น่าจะเป็น | การตรวจสอบ | วิธีแก้ไข |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ไฟล์ binary `.node` ที่ล้าสมัย, ชื่อ Rust export ไม่ตรงกัน หรือโหลด binary ผิดไฟล์ | รันด้วย `PI_DEV=1` เพื่อดู path ที่โหลด; ตรวจสอบรายการ export ของไฟล์นั้น | Rebuild `build`; ตรวจสอบให้แน่ใจว่าชื่อ Rust `#[napi]` export (หรือ alias ที่ระบุชัดเจนเมื่อจำเป็น) ตรงกับ key ของ JS; ลบไฟล์ cached/versioned ที่ล้าสมัย |
| เครื่อง x64 โหลด baseline เมื่อคาดหวัง modern | `PI_NATIVE_VARIANT=baseline`, ไม่ตรวจพบ AVX2 หรือมีเฉพาะไฟล์ baseline | ตรวจสอบ `PI_NATIVE_VARIANT`; ตรวจสอบไฟล์ `-modern` ใน `native/` | Build variant modern (`TARGET_VARIANT=modern ... build`) และตรวจสอบให้แน่ใจว่ามีไฟล์รวมอยู่ในการ ship |
| Cross-build สร้าง binary ที่ใช้ไม่ได้/ติดป้ายผิด | ไม่ตรงกันระหว่าง `CROSS_TARGET` กับ `TARGET_PLATFORM`/`TARGET_ARCH` หรือขาด `TARGET_VARIANT` สำหรับ x64 | ยืนยัน env tuple และชื่อไฟล์ output | รันใหม่ด้วยค่า env ที่สอดคล้องกันและ `TARGET_VARIANT` ที่ระบุชัดเจนสำหรับ x64 |
| Compiled binary ล้มเหลวหลังจากอัปเกรด | cache ที่แยกออกมาล้าสมัย (`~/.xcsh/natives/<old-or-mismatched-version>`) หรือ manifest แบบฝังตัวไม่ตรงกัน | ตรวจสอบไดเรกทอรี natives ตามเวอร์ชันและรายการ error ของ loader | ลบ cache natives ตามเวอร์ชันสำหรับเวอร์ชันแพ็กเกจนั้นและรันใหม่; สร้าง manifest แบบฝังตัวใหม่ระหว่างการ packaging |
| Loader ตรวจสอบหลาย path แต่ไม่มีอันไหนใช้ได้ | platform ไม่ตรงกันหรือไม่มี release artifact ในแพ็กเกจ `native/` | ตรวจสอบ `platformTag` เทียบกับชื่อไฟล์จริง | ตรวจสอบให้แน่ใจว่าชื่อไฟล์ที่ build ตรงกับข้อตกลง `pi_natives.<platform>-<arch>(-variant).node` อย่างแม่นยำ และแพ็กเกจรวม `native/` ด้วย |
| `embed:native` ล้มเหลวด้วย "Incomplete native addons" | ไฟล์ variant ที่จำเป็นไม่ได้ถูก build ก่อนการ embed | ตรวจสอบรายการ expected เทียบกับ found ในข้อความ error | Build ไฟล์ที่จำเป็นก่อน (x64: ทั้ง modern+baseline; ไม่ใช่ x64: default) จากนั้นรัน `embed:native` ใหม่ |

## คำสั่งปฏิบัติการ

```bash
# Release artifact สำหรับเครื่อง host ปัจจุบัน
bun --cwd=packages/natives run build

# Build artifact แบบ debug profile
bun --cwd=packages/natives run dev:native

# Build variant x64 แบบระบุชัดเจน
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# สร้าง manifest ของ addon แบบฝังตัวจากไฟล์ native ที่ build แล้ว
bun --cwd=packages/natives run embed:native

# รีเซ็ต manifest แบบฝังตัวเป็น null stub
bun --cwd=packages/natives run embed:native -- --reset
```
