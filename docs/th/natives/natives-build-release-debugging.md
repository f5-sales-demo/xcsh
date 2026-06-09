---
title: 'คู่มือการ Build, Release และ Debugging ของ Natives'
description: >-
  คู่มือการ build, release และ debugging สำหรับ Rust native addon
  บนแพลตฟอร์มต่าง ๆ
sidebar:
  order: 8
  label: 'การ Build, Release และ Debugging'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# คู่มือการ Build, Release และ Debugging ของ Natives

คู่มือนี้อธิบายวิธีที่ไปป์ไลน์การ build ของ `@f5xc-salesdemos/pi-natives` สร้าง addon `.node`, วิธีที่ distribution ที่คอมไพล์แล้วโหลดไฟล์เหล่านั้น, และวิธีการ debug ความล้มเหลวของ loader/build

คู่มือนี้เป็นไปตามคำศัพท์ทางสถาปัตยกรรมจาก `docs/natives-architecture.md`:

- **การสร้าง artifact ในช่วง build-time** (`scripts/build-native.ts`)
- **การสร้าง manifest ของ addon แบบฝังตัว** (`scripts/embed-native.ts`)
- **การโหลด addon ในช่วง runtime + validation gate** (`src/native.ts`)

## ไฟล์ที่เกี่ยวข้อง

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## ภาพรวมไปป์ไลน์การ build

### 1) จุดเข้าการ build

สคริปต์ `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build แบบ release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build แบบ debug/dev profile (ชื่อ output เหมือนกัน)
- `bun scripts/embed-native.ts` (`embed:native`) → สร้าง `src/embedded-addon.ts` จากไฟล์ที่ build แล้ว

### 2) การ build artifact จาก Rust

`build-native.ts` รัน Cargo ใน `crates/pi-natives`:

- คำสั่งพื้นฐาน: `cargo build`
- โหมด release จะเพิ่ม `--release` เว้นแต่จะส่ง `--dev`
- cross target จะเพิ่ม `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` ประกาศ `crate-type = ["cdylib"]` ดังนั้น Cargo จะสร้าง shared library (`.so`/`.dylib`/`.dll`) ซึ่งจะถูกคัดลอก/เปลี่ยนชื่อเป็นชื่อไฟล์ addon `.node`

### 3) การค้นหาและติดตั้ง artifact

หลังจาก Cargo ทำงานเสร็จ `build-native.ts` จะสแกนไดเรกทอรี output ที่เป็นไปได้ตามลำดับ:

1. `${CARGO_TARGET_DIR}` (หากมีการตั้งค่า)
2. `<repo>/target`
3. `crates/pi-natives/target`

สำหรับแต่ละ root จะตรวจสอบไดเรกทอรี profile:

- cross build: `<root>/<crossTarget>/<profile>` จากนั้น `<root>/<profile>`
- native build: `<root>/<profile>`

จากนั้นจะค้นหาไฟล์ใดไฟล์หนึ่ง:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

เมื่อพบแล้ว จะติดตั้งแบบ atomic ไปยัง `packages/natives/native/` ด้วยวิธี temp-file + rename (การ fallback บน Windows จะจัดการความล้มเหลวในการแทนที่ DLL ที่ถูกล็อกอย่างชัดเจน)

## โมเดล target/variant และหลักการตั้งชื่อ

## แท็กแพลตฟอร์ม

ทั้ง build และ runtime ใช้แท็กแพลตฟอร์ม:

`<platform>-<arch>` (ตัวอย่าง: `darwin-arm64`, `linux-x64`)

## โมเดล variant (เฉพาะ x64)

x64 รองรับ CPU variant:

- `modern` (เส้นทางที่รองรับ AVX2)
- `baseline` (fallback)

ที่ไม่ใช่ x64 จะใช้ artifact เดียวเป็นค่าเริ่มต้น (ไม่มี suffix ของ variant)

### ชื่อไฟล์ output

build แบบ release:

- x64: `pi_natives.<platform>-<arch>-modern.node` หรือ `...-baseline.node`
- ไม่ใช่ x64: `pi_natives.<platform>-<arch>.node`

build แบบ dev (`--dev`):

- ใช้ flag ของ debug profile แต่คงชื่อ output แบบ platform-tagged มาตรฐาน

ลำดับ candidate ของ runtime loader ใน `native.ts`:

- candidate แบบ release
- โหมด compiled จะเพิ่ม candidate ที่แตกไฟล์/cache ไว้ก่อนไฟล์ใน package

## flag สภาพแวดล้อมและตัวเลือกการ build

## flag สำหรับ runtime

- `PI_DEV` (พฤติกรรม loader): เปิดใช้งาน diagnostics ของ loader
- `PI_NATIVE_VARIANT` (พฤติกรรม loader, เฉพาะ x64): บังคับเลือก `modern` หรือ `baseline` ในช่วง runtime
- `PI_COMPILED` (พฤติกรรม loader): เปิดใช้งานพฤติกรรม candidate/extraction ของ compiled-binary

## flag/ตัวเลือกในช่วง build-time

- `--dev` (อาร์กิวเมนต์สคริปต์): build ด้วย debug profile
- `CROSS_TARGET`: ส่งไปยัง Cargo `--target`
- `TARGET_PLATFORM`: แทนที่ชื่อแท็กแพลตฟอร์มของ output
- `TARGET_ARCH`: แทนที่ชื่อ arch ของ output
- `TARGET_VARIANT` (เฉพาะ x64): บังคับ `modern` หรือ `baseline` สำหรับชื่อไฟล์ output และนโยบาย RUSTFLAGS
- `CARGO_TARGET_DIR`: root เพิ่มเติมเมื่อค้นหา output ของ Cargo
- `RUSTFLAGS`:
  - หากไม่ได้ตั้งค่าและไม่ได้ cross-compile สคริปต์จะตั้งค่า:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - ไม่ใช่ x64 / ไม่มี variant: `-C target-cpu=native`
  - หากตั้งค่าไว้แล้ว สคริปต์จะไม่แทนที่

## การเปลี่ยนสถานะ/วงจรชีวิตของ build

### วงจรชีวิตการ build (`build-native.ts`)

1. **เริ่มต้น**: parse อาร์กิวเมนต์/env (`--dev`, การแทนที่ target, flag สำหรับ cross)
2. **แก้ไข variant**:
   - ไม่ใช่ x64 → ไม่มี variant
   - x64 + `TARGET_VARIANT` → variant ที่ระบุชัดเจน
   - x64 cross-build โดยไม่มี `TARGET_VARIANT` → error ทันที
   - x64 local build โดยไม่มีการแทนที่ → ตรวจจับ AVX2 ของ host
3. **คอมไพล์**: รัน Cargo ด้วย profile/target ที่แก้ไขแล้ว
4. **ค้นหา artifact**: สแกน root ของ target/ไดเรกทอรี profile/ชื่อ library
5. **ติดตั้ง**: คัดลอก + เปลี่ยนชื่อแบบ atomic ไปยัง `packages/natives/native`
6. **เสร็จสิ้น**: addon พร้อมสำหรับ candidate ของ loader

ความล้มเหลวจะออกจากโปรแกรมได้ในทุกขั้นตอนพร้อมข้อความ error ที่ชัดเจน (variant ไม่ถูกต้อง, cargo build ล้มเหลว, ไม่พบ output library, การติดตั้ง/เปลี่ยนชื่อล้มเหลว)

### วงจรชีวิตการ embed (`embed-native.ts`)

1. **เริ่มต้น**: คำนวณแท็กแพลตฟอร์มจาก `TARGET_PLATFORM`/`TARGET_ARCH` หรือค่าของ host
2. **ชุด candidate**:
   - x64 คาดหวังทั้ง `modern` และ `baseline`
   - ไม่ใช่ x64 คาดหวังไฟล์เริ่มต้นหนึ่งไฟล์
3. **ตรวจสอบความพร้อม** ใน `packages/natives/native`
4. **สร้าง manifest** (`src/embedded-addon.ts`) ด้วย Bun `file` imports และเวอร์ชันของ package
5. **พร้อมสำหรับการแตกไฟล์ในช่วง runtime** สำหรับโหมด compiled

`--reset` จะข้ามการ validate และเขียน null manifest stub (`embeddedAddon = null`)

## เวิร์กโฟลว์การพัฒนา vs พฤติกรรมแบบ shipped/compiled

## เวิร์กโฟลว์การพัฒนาในเครื่อง

ลูปการพัฒนาทั่วไป:

1. Build addon:
   - release: `bun --cwd=packages/natives run build`
   - debug profile: `bun --cwd=packages/natives run dev:native`
2. ตั้ง `PI_DEV=1` เมื่อทดสอบ diagnostics ของ loader
3. Loader ใน `native.ts` จะค้นหา candidate ใน `native/` ของ package (และ fallback ไดเรกทอรีของ executable)
4. `validateNative` บังคับความเข้ากันได้ของ export ก่อนที่ wrapper จะใช้ binding

## เวิร์กโฟลว์ไบนารีแบบ shipped/compiled

ในโหมด compiled (`PI_COMPILED` หรือ Bun embedded markers):

1. Loader คำนวณไดเรกทอรี cache ตามเวอร์ชัน: `<getNativesDir()>/<packageVersion>` (ในทางปฏิบัติคือ `~/.xcsh/natives/<version>`)
2. หาก embedded manifest ตรงกับแพลตฟอร์ม+เวอร์ชันปัจจุบัน loader อาจแตกไฟล์ embedded ที่เลือกไว้ลงในไดเรกทอรีตามเวอร์ชันนั้น
3. ลำดับ candidate ใน runtime ประกอบด้วย:
   - ไดเรกทอรี cache ตามเวอร์ชัน
   - ไดเรกทอรี compiled-binary แบบเก่า (`%LOCALAPPDATA%/xcsh` บน Windows, `~/.local/bin` ที่อื่น)
   - ไดเรกทอรี package/executable
4. addon แรกที่โหลดสำเร็จยังคงต้องผ่าน `validateNative`

นี่คือเหตุผลที่การ packaging + ความคาดหวังของ runtime loader ต้องสอดคล้องกัน: ชื่อไฟล์, แท็กแพลตฟอร์ม และ symbol ที่ export ต้องตรงกับสิ่งที่ `native.ts` ตรวจสอบและ validate

## การแมป JS API ↔ Rust export (ส่วนย่อยของ validation gate)

`native.ts` ต้องการ export ที่เห็นจาก JS เหล่านี้ที่ addon ที่โหลดต้องมี ซึ่งแมปกับ N-API export ของ Rust ใน `crates/pi-natives/src`:

| ชื่อ JS ที่ `validateNative` ต้องการ | การประกาศ Rust export | ไฟล์ซอร์ส Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (camel-cased export) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

หาก symbol ที่จำเป็นใด ๆ หายไป loader จะ fail fast พร้อมคำแนะนำให้ rebuild

## พฤติกรรมความล้มเหลวและ diagnostics

## ความล้มเหลวในช่วง build-time

- การกำหนดค่า variant ไม่ถูกต้อง:
  - `TARGET_VARIANT` ตั้งบนที่ไม่ใช่ x64 → error ทันที
  - x64 cross-build โดยไม่มี `TARGET_VARIANT` ที่ระบุชัดเจน → error ทันที
- Cargo build ล้มเหลว:
  - สคริปต์แสดง exit code ที่ไม่ใช่ศูนย์และ stderr
- ไม่พบ artifact:
  - สคริปต์พิมพ์ทุกไดเรกทอรี profile ที่ตรวจสอบ
- การติดตั้งล้มเหลว:
  - ข้อความชัดเจน; Windows มีคำแนะนำเกี่ยวกับไฟล์ที่ถูกล็อก

## ความล้มเหลวของ runtime loader (`native.ts`)

- แท็กแพลตฟอร์มที่ไม่รองรับ:
  - throw พร้อมรายการแพลตฟอร์มที่รองรับ
- ไม่สามารถโหลด candidate ใดได้:
  - throw พร้อมรายการ error ของ candidate ทั้งหมดและคำแนะนำการแก้ไขเฉพาะโหมด
- export ที่หายไป:
  - throw พร้อมชื่อ symbol ที่หายไปอย่างชัดเจนและคำสั่ง rebuild
- ปัญหาการแตกไฟล์ embedded:
  - error ของ mkdir/write ในการแตกไฟล์จะถูกบันทึกและรวมไว้ใน diagnostics สุดท้าย

## ตารางการแก้ไขปัญหา

| อาการ | สาเหตุที่เป็นไปได้ | วิธีตรวจสอบ | วิธีแก้ไข |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ไบนารี `.node` เก่า, ชื่อ Rust export ไม่ตรง, หรือโหลดไบนารีผิดตัว | รันด้วย `PI_DEV=1` เพื่อดู path ที่โหลด; ตรวจสอบรายการ export ของไฟล์นั้น | Rebuild `build`; ตรวจสอบว่าชื่อ Rust `#[napi]` export (หรือ alias ที่ระบุชัดเจนเมื่อจำเป็น) ตรงกับ JS key; ลบไฟล์ที่ cache/versioned ที่เก่าออก |
| เครื่อง x64 โหลด baseline เมื่อควรได้ modern | `PI_NATIVE_VARIANT=baseline`, ไม่ตรวจพบ AVX2, หรือมีเฉพาะไฟล์ baseline | ตรวจสอบ `PI_NATIVE_VARIANT`; ตรวจสอบไฟล์ `-modern` ใน `native/` | Build modern variant (`TARGET_VARIANT=modern ... build`) และตรวจสอบว่าไฟล์ถูก ship |
| Cross-build สร้างไบนารีที่ใช้ไม่ได้/ติดป้ายผิด | ไม่ตรงกันระหว่าง `CROSS_TARGET` และ `TARGET_PLATFORM`/`TARGET_ARCH`, หรือขาด `TARGET_VARIANT` สำหรับ x64 | ยืนยัน tuple ของ env และชื่อไฟล์ output | รันใหม่ด้วยค่า env ที่สอดคล้องกันและ `TARGET_VARIANT` สำหรับ x64 ที่ระบุชัดเจน |
| ไบนารี compiled ล้มเหลวหลังอัปเกรด | cache ที่แตกไฟล์ไว้เก่า (`~/.xcsh/natives/<old-or-mismatched-version>`) หรือ embedded manifest ไม่ตรง | ตรวจสอบไดเรกทอรี natives ตามเวอร์ชันและรายการ error ของ loader | ลบ natives cache ตามเวอร์ชันของ package version นั้นและรันใหม่; สร้าง embedded manifest ใหม่ระหว่างการ packaging |
| Loader ตรวจสอบหลาย path และไม่มีอันไหนใช้ได้ | แพลตฟอร์มไม่ตรงหรือขาด release artifact ใน `native/` ของ package | ตรวจสอบ `platformTag` เทียบกับชื่อไฟล์จริง | ตรวจสอบว่าชื่อไฟล์ที่ build ตรงกับหลักการ `pi_natives.<platform>-<arch>(-variant).node` อย่างถูกต้อง และ package มี `native/` |
| `embed:native` ล้มเหลวด้วย "Incomplete native addons" | ไฟล์ variant ที่ต้องการยังไม่ได้ build ก่อนทำ embed | ตรวจสอบรายการที่คาดหวัง vs ที่พบในข้อความ error | Build ไฟล์ที่ต้องการก่อน (x64: ทั้ง modern+baseline; ไม่ใช่ x64: default) จากนั้นรัน `embed:native` ใหม่ |

## คำสั่งปฏิบัติงาน

```bash
# Release artifact สำหรับ host ปัจจุบัน
bun --cwd=packages/natives run build

# Build artifact แบบ debug profile
bun --cwd=packages/natives run dev:native

# Build variant x64 ที่ระบุชัดเจน
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# สร้าง embedded addon manifest จากไฟล์ native ที่ build แล้ว
bun --cwd=packages/natives run embed:native

# รีเซ็ต embedded manifest เป็น null stub
bun --cwd=packages/natives run embed:native -- --reset
```
