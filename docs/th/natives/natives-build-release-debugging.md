---
title: 'คู่มือการสร้าง, เผยแพร่, และดีบัก Natives'
description: 'คู่มือการสร้าง, เผยแพร่, และดีบักสำหรับ Rust native addon บนหลายแพลตฟอร์ม'
sidebar:
  order: 8
  label: 'การสร้าง, เผยแพร่ และดีบัก'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# คู่มือการสร้าง, เผยแพร่, และดีบัก Natives

คู่มือนี้อธิบายวิธีที่ไปป์ไลน์การสร้างของ `@f5xc-salesdemos/pi-natives` ผลิต `.node` addons วิธีที่การกระจายที่คอมไพล์แล้วโหลดไฟล์เหล่านั้น และวิธีดีบักความล้มเหลวของ loader/build

เนื้อหาเป็นไปตามคำศัพท์ทางสถาปัตยกรรมจาก `docs/natives-architecture.md`:

- **การผลิต artifact ในช่วง build-time** (`scripts/build-native.ts`)
- **การสร้าง manifest ของ addon ที่ฝังไว้** (`scripts/embed-native.ts`)
- **การโหลด addon ในช่วง runtime + ประตูตรวจสอบ** (`src/native.ts`)

## ไฟล์การดำเนินงาน

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## ภาพรวมไปป์ไลน์การสร้าง

### 1) จุดเริ่มต้นการสร้าง

สคริปต์ใน `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → การสร้างแบบ release
- `bun scripts/build-native.ts --dev` (`dev:native`) → การสร้างแบบ debug/dev profile (ชื่อ output เหมือนกัน)
- `bun scripts/embed-native.ts` (`embed:native`) → สร้าง `src/embedded-addon.ts` จากไฟล์ที่สร้างแล้ว

### 2) การสร้าง Rust artifact

`build-native.ts` รัน Cargo ใน `crates/pi-natives`:

- คำสั่งพื้นฐาน: `cargo build`
- โหมด release เพิ่ม `--release` เว้นแต่จะส่ง `--dev`
- เป้าหมาย cross เพิ่ม `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` ประกาศ `crate-type = ["cdylib"]` ดังนั้น Cargo จึงสร้าง shared library (`.so`/`.dylib`/`.dll`) ซึ่งถูกคัดลอก/เปลี่ยนชื่อเป็นชื่อไฟล์ `.node` addon

### 3) การค้นหาและติดตั้ง artifact

หลังจาก Cargo เสร็จสิ้น `build-native.ts` จะสแกนไดเรกทอรี output ที่เป็นตัวเลือกตามลำดับ:

1. `${CARGO_TARGET_DIR}` (หากตั้งค่าไว้)
2. `<repo>/target`
3. `crates/pi-natives/target`

สำหรับแต่ละ root จะตรวจสอบไดเรกทอรี profile:

- cross build: `<root>/<crossTarget>/<profile>` จากนั้น `<root>/<profile>`
- native build: `<root>/<profile>`

จากนั้นค้นหาหนึ่งในรายการต่อไปนี้:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

เมื่อพบแล้ว จะติดตั้งแบบ atomic ลงใน `packages/natives/native/` ด้วยวิธีการสร้างไฟล์ชั่วคราว + เปลี่ยนชื่อ (Windows fallback จัดการความล้มเหลวในการแทนที่ DLL ที่ถูกล็อคไว้อย่างชัดเจน)

## โมเดล target/variant และข้อตกลงการตั้งชื่อ

## Platform tag

ทั้งการสร้างและ runtime ใช้ platform tag:

`<platform>-<arch>` (ตัวอย่าง: `darwin-arm64`, `linux-x64`)

## โมเดล variant (สำหรับ x64 เท่านั้น)

x64 รองรับ CPU variants:

- `modern` (เส้นทางที่รองรับ AVX2)
- `baseline` (fallback)

สถาปัตยกรรมที่ไม่ใช่ x64 ใช้ artifact เริ่มต้นเพียงชิ้นเดียว (ไม่มีส่วนต่อท้าย variant)

### ชื่อไฟล์ output

Release builds:

- x64: `pi_natives.<platform>-<arch>-modern.node` หรือ `...-baseline.node`
- ไม่ใช่ x64: `pi_natives.<platform>-<arch>.node`

Dev build (`--dev`):

- ใช้ debug profile flags แต่คงชื่อ output ที่มี platform tag มาตรฐาน

ลำดับตัวเลือก loader ใน `native.ts`:

- ตัวเลือก release
- โหมด compiled จะนำตัวเลือก extracted/cache มาก่อนไฟล์ที่อยู่ในแพ็กเกจ

## Environment flags และตัวเลือกการสร้าง

## Runtime flags

- `PI_DEV` (พฤติกรรม loader): เปิดใช้งานการวินิจฉัย loader
- `PI_NATIVE_VARIANT` (พฤติกรรม loader, x64 เท่านั้น): บังคับเลือก `modern` หรือ `baseline` ในช่วง runtime
- `PI_COMPILED` (พฤติกรรม loader): เปิดใช้งานพฤติกรรม compiled-binary candidate/extraction

## Build-time flags/options

- `--dev` (อาร์กิวเมนต์สคริปต์): สร้าง debug profile
- `CROSS_TARGET`: ส่งไปยัง Cargo `--target`
- `TARGET_PLATFORM`: แทนที่การตั้งชื่อ platform tag ของ output
- `TARGET_ARCH`: แทนที่การตั้งชื่อ arch ของ output
- `TARGET_VARIANT` (x64 เท่านั้น): บังคับ `modern` หรือ `baseline` สำหรับชื่อไฟล์ output และนโยบาย RUSTFLAGS
- `CARGO_TARGET_DIR`: root เพิ่มเติมเมื่อค้นหา Cargo outputs
- `RUSTFLAGS`:
  - หากไม่ได้ตั้งค่าและไม่ได้ cross-compiling สคริปต์จะตั้งค่า:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - ไม่ใช่ x64 / ไม่มี variant: `-C target-cpu=native`
  - หากตั้งค่าไว้แล้ว สคริปต์จะไม่แทนที่

## สถานะ/การเปลี่ยนผ่านวงจรชีวิตการสร้าง

### วงจรชีวิตการสร้าง (`build-native.ts`)

1. **เริ่มต้น**: แยก args/env (`--dev`, target overrides, cross flags)
2. **แก้ไข variant**:
   - ไม่ใช่ x64 → ไม่มี variant
   - x64 + `TARGET_VARIANT` → variant ที่ระบุอย่างชัดเจน
   - x64 cross-build โดยไม่มี `TARGET_VARIANT` → error ร้ายแรง
   - x64 local build โดยไม่มี override → ตรวจจับ AVX2 ของ host
3. **คอมไพล์**: รัน Cargo ด้วย profile/target ที่แก้ไขแล้ว
4. **ค้นหา artifact**: สแกน target roots/profile dirs/library names
5. **ติดตั้ง**: คัดลอก + เปลี่ยนชื่อแบบ atomic ลงใน `packages/natives/native`
6. **เสร็จสิ้น**: addon output พร้อมสำหรับตัวเลือก loader

ความล้มเหลวจะออกจากโปรแกรมในทุกขั้นตอนพร้อมข้อความ error ที่ชัดเจน (variant ไม่ถูกต้อง, cargo build ล้มเหลว, ไม่พบ output library, ความล้มเหลวในการติดตั้ง/เปลี่ยนชื่อ)

### วงจรชีวิต Embed (`embed-native.ts`)

1. **เริ่มต้น**: คำนวณ platform tag จาก `TARGET_PLATFORM`/`TARGET_ARCH` หรือค่าของ host
2. **ชุดตัวเลือก**:
   - x64 คาดหวังทั้ง `modern` และ `baseline`
   - ไม่ใช่ x64 คาดหวังไฟล์ default หนึ่งไฟล์
3. **ตรวจสอบความพร้อม** ใน `packages/natives/native`
4. **สร้าง manifest** (`src/embedded-addon.ts`) ด้วย Bun `file` imports และเวอร์ชันแพ็กเกจ
5. **พร้อม runtime extraction** สำหรับโหมด compiled

`--reset` จะข้ามการตรวจสอบและเขียน null manifest stub (`embeddedAddon = null`)

## เวิร์กโฟลว์การพัฒนาเทียบกับพฤติกรรม shipped/compiled

## เวิร์กโฟลว์การพัฒนาในเครื่อง

วงจรการทำงานในเครื่องทั่วไป:

1. สร้าง addon:
   - release: `bun --cwd=packages/natives run build`
   - debug profile: `bun --cwd=packages/natives run dev:native`
2. ตั้งค่า `PI_DEV=1` เมื่อทดสอบการวินิจฉัย loader
3. Loader ใน `native.ts` แก้ไขตัวเลือก `native/` ในแพ็กเกจ (และ executable-dir fallback)
4. `validateNative` บังคับความเข้ากันได้ของ export ก่อนที่ wrapper จะใช้ binding

## เวิร์กโฟลว์ไบนารี shipped/compiled

ในโหมด compiled (`PI_COMPILED` หรือ Bun embedded markers):

1. Loader คำนวณไดเรกทอรี cache ที่มีเวอร์ชัน: `<getNativesDir()>/<packageVersion>` (ในทางปฏิบัติคือ `~/.xcsh/natives/<version>`)
2. หาก embedded manifest ตรงกับ platform+version ปัจจุบัน loader อาจ extract ไฟล์ที่เลือกไว้ในไดเรกทอรีที่มีเวอร์ชันนั้น
3. ลำดับตัวเลือก runtime ประกอบด้วย:
   - ไดเรกทอรี cache ที่มีเวอร์ชัน
   - ไดเรกทอรี compiled-binary แบบ legacy (`%LOCALAPPDATA%/xcsh` บน Windows, `~/.local/bin` บนระบบอื่น)
   - ไดเรกทอรี package/executable
4. addon ที่โหลดสำเร็จเป็นชิ้นแรกยังต้องผ่าน `validateNative`

นี่คือเหตุผลที่การแพ็กเกจ + ความคาดหวังของ runtime loader ต้องสอดคล้องกัน: ชื่อไฟล์, platform tags, และ exported symbols ต้องตรงกับสิ่งที่ `native.ts` ตรวจสอบและยืนยัน

## การแมป JS API ↔ Rust export (ส่วนย่อยของประตูตรวจสอบ)

`native.ts` ต้องการให้ exports ที่มองเห็นได้ใน JS เหล่านี้มีอยู่บน addon ที่โหลด โดยแมปไปยัง Rust N-API exports ใน `crates/pi-natives/src`:

| ชื่อ JS ที่ต้องการโดย `validateNative` | การประกาศ Rust export | ไฟล์ต้นทาง Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export แบบ camel-case) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

หาก symbol ที่ต้องการขาดหายไป loader จะล้มเหลวอย่างรวดเร็วพร้อมคำแนะนำให้ rebuild

## พฤติกรรมเมื่อล้มเหลวและการวินิจฉัย

## ความล้มเหลวในช่วง build-time

- การกำหนดค่า variant ไม่ถูกต้อง:
  - `TARGET_VARIANT` ตั้งค่าบนสถาปัตยกรรมที่ไม่ใช่ x64 → error ทันที
  - x64 cross-build โดยไม่มี `TARGET_VARIANT` ที่ระบุชัดเจน → error ทันที
- Cargo build ล้มเหลว:
  - สคริปต์แสดง exit code ที่ไม่ใช่ศูนย์และ stderr
- ไม่พบ artifact:
  - สคริปต์พิมพ์ทุกไดเรกทอรี profile ที่ตรวจสอบ
- ความล้มเหลวในการติดตั้ง:
  - ข้อความชัดเจน; Windows มีคำแนะนำเรื่องไฟล์ที่ถูกล็อค

## ความล้มเหลวของ runtime loader (`native.ts`)

- Platform tag ที่ไม่รองรับ:
  - โยน error พร้อมรายการ platform ที่รองรับ
- ไม่สามารถโหลดตัวเลือกใดได้:
  - โยน error พร้อมรายการ error ของตัวเลือกทั้งหมดและคำแนะนำการแก้ไขตามโหมด
- exports ที่ขาดหายไป:
  - โยน error พร้อมชื่อ symbol ที่ขาดหายไปอย่างชัดเจนและคำสั่ง rebuild
- ปัญหาการ extract ที่ฝังไว้:
  - ข้อผิดพลาด mkdir/write ของการ extraction จะถูกบันทึกและรวมอยู่ในการวินิจฉัยสุดท้าย

## เมทริกซ์การแก้ไขปัญหา

| อาการ | สาเหตุที่น่าจะเป็น | วิธีตรวจสอบ | วิธีแก้ไข |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | ไบนารี `.node` ที่ล้าสมัย, ชื่อ Rust export ไม่ตรงกัน, หรือโหลดไบนารีผิดไฟล์ | รันด้วย `PI_DEV=1` เพื่อดูเส้นทางที่โหลด; ตรวจสอบรายการ export สำหรับไฟล์นั้น | Rebuild `build`; ตรวจสอบว่าชื่อ Rust `#[napi]` export (หรือ alias ที่ระบุชัดเจนเมื่อจำเป็น) ตรงกับ JS key; ลบไฟล์ cached/versioned ที่ล้าสมัย |
| เครื่อง x64 โหลด baseline เมื่อคาดหวัง modern | `PI_NATIVE_VARIANT=baseline`, ไม่ตรวจพบ AVX2, หรือมีเฉพาะไฟล์ baseline | ตรวจสอบ `PI_NATIVE_VARIANT`; ตรวจสอบ `native/` สำหรับไฟล์ `-modern` | สร้าง modern variant (`TARGET_VARIANT=modern ... build`) และตรวจสอบว่าไฟล์ถูกส่งมอบ |
| Cross-build สร้างไบนารีที่ใช้งานไม่ได้/มีป้ายกำกับผิด | ความไม่ตรงกันระหว่าง `CROSS_TARGET` กับ `TARGET_PLATFORM`/`TARGET_ARCH` หรือขาด `TARGET_VARIANT` สำหรับ x64 | ยืนยันชุด env และชื่อไฟล์ output | รันใหม่ด้วยค่า env ที่สอดคล้องกันและ `TARGET_VARIANT` x64 ที่ระบุชัดเจน |
| ไบนารี compiled ล้มเหลวหลังจากอัปเกรด | extracted cache ที่ล้าสมัย (`~/.xcsh/natives/<old-or-mismatched-version>`) หรือ embedded manifest ไม่ตรงกัน | ตรวจสอบไดเรกทอรี natives ที่มีเวอร์ชันและรายการ error ของ loader | ลบ versioned natives cache สำหรับเวอร์ชันแพ็กเกจนั้นและรันใหม่; สร้าง embedded manifest ใหม่ระหว่างการแพ็กเกจ |
| Loader ตรวจสอบหลายเส้นทางและไม่มีที่ใดทำงานได้ | Platform ไม่ตรงกันหรือขาด release artifact ใน `native/` ของแพ็กเกจ | ตรวจสอบ `platformTag` เทียบกับชื่อไฟล์จริง | ตรวจสอบว่าชื่อไฟล์ที่สร้างตรงกับรูปแบบ `pi_natives.<platform>-<arch>(-variant).node` อย่างแม่นยำ และแพ็กเกจมี `native/` อยู่ด้วย |
| `embed:native` ล้มเหลวด้วย "Incomplete native addons" | ไฟล์ variant ที่ต้องการยังไม่ได้สร้างก่อนการ embed | ตรวจสอบรายการที่คาดหวังเทียบกับที่พบในข้อความ error | สร้างไฟล์ที่จำเป็นก่อน (x64: ทั้ง modern+baseline; ไม่ใช่ x64: default) จากนั้นรัน `embed:native` ใหม่ |

## คำสั่งการดำเนินงาน

```bash
# Release artifact สำหรับ host ปัจจุบัน
bun --cwd=packages/natives run build

# Debug profile artifact build
bun --cwd=packages/natives run dev:native

# สร้าง x64 variants อย่างชัดเจน
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# สร้าง embedded addon manifest จากไฟล์ native ที่สร้างแล้ว
bun --cwd=packages/natives run embed:native

# รีเซ็ต embedded manifest เป็น null stub
bun --cwd=packages/natives run embed:native -- --reset
```
