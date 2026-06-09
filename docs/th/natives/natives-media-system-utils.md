---
title: ยูทิลิตี้สื่อและระบบแบบ Native
description: >-
  ยูทิลิตี้ประมวลผลสื่อแบบ native สำหรับการจับภาพหน้าจอ การจัดการรูปภาพ
  และข้อมูลระบบ
sidebar:
  order: 7
  label: ยูทิลิตี้สื่อและระบบ
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# ยูทิลิตี้สื่อ + ระบบแบบ native

เอกสารนี้เป็นการเจาะลึกระบบย่อยสำหรับชั้น **system/media/conversion primitives** ที่อธิบายไว้ใน [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` และ `work` profiling

## ไฟล์การ implement

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> หมายเหตุ: ไม่มีไฟล์ `crates/pi-natives/src/work.rs`; work profiling ถูก implement ใน `prof.rs` และได้รับข้อมูลจาก instrumentation ใน `task.rs`

## การ map TS API ↔ Rust export/module

| TS export (packages/natives)                | Rust N-API export                                                       | Rust module                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS fallback logic                                  | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## ขอบเขตรูปแบบข้อมูลและการแปลง

### รูปภาพ (`image`)

- **ขอบเขตอินพุต JS**: ไบต์ของรูปภาพที่เข้ารหัสแบบ `Uint8Array`
- **ขอบเขตการถอดรหัส Rust**: ไบต์จะถูกคัดลอกไปยัง `Vec<u8>` รูปแบบจะถูกเดาด้วย `ImageReader::with_guessed_format()` จากนั้นถอดรหัสเป็น `DynamicImage`
- **สถานะในหน่วยความจำ**: `PhotonImage` เก็บ `Arc<DynamicImage>`
- **ขอบเขตเอาต์พุต**: `encode(format, quality)` คืนค่า `Promise<Uint8Array>` (Rust `Vec<u8>`)

รหัสรูปแบบเป็นตัวเลข:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (lossless encoder)
- `3`: GIF

ข้อจำกัด:

- `quality` ใช้สำหรับ JPEG เท่านั้น
- PNG/WebP/GIF ไม่สนใจ `quality`
- รหัสรูปแบบที่ไม่รองรับจะล้มเหลว (`Invalid image format: <id>`)

### การแปลง HTML (`html`)

- **ขอบเขตอินพุต JS**: `string` HTML + object ที่เป็นตัวเลือก `{ cleanContent?: boolean; skipImages?: boolean }`
- **ขอบเขตการแปลง Rust**: อินพุต `String` ถูกแปลงโดย `html_to_markdown_rs::convert`
- **ขอบเขตเอาต์พุต**: `string` Markdown

พฤติกรรมการแปลง:

- `cleanContent` ค่าเริ่มต้นคือ `false`
- เมื่อ `cleanContent=true` การประมวลผลล่วงหน้าจะเปิดใช้งานด้วย `PreprocessingPreset::Aggressive` และแฟล็กลบแบบตายตัวสำหรับ navigation/forms
- `skipImages` ค่าเริ่มต้นคือ `false`

### คลิปบอร์ด (`clipboard`)

- **เส้นทางข้อความ**:
  - TS จะส่ง OSC 52 (`\x1b]52;c;<base64>\x07`) ก่อนเมื่อ stdout เป็น TTY
  - ข้อความเดียวกันจากนั้นจะพยายามผ่าน native clipboard API (`native.copyToClipboard`) แบบ best-effort
  - บน Termux, TS จะพยายาม `termux-clipboard-set` ก่อน
- **เส้นทางการอ่านรูปภาพ**:
  - Rust อ่านรูปภาพดิบจาก `arboard`
  - Rust เข้ารหัสใหม่เป็นไบต์ PNG (crate `image`) คืนค่า `{ data: Uint8Array, mimeType: "image/png" }`
  - TS คืนค่า `null` ทันทีบน Termux หรือเซสชัน Linux ที่ไม่มี display server (ไม่พบ `DISPLAY`/`WAYLAND_DISPLAY`)

### การ profiling งาน (`work`)

- **ขอบเขตการเก็บข้อมูล**: ตัวอย่างการ profiling ถูกสร้างโดย guard `profile_region(tag)` ใน `task::blocking` และ `task::future`
- **รูปแบบการจัดเก็บ**: circular buffer ขนาดคงที่ (`MAX_SAMPLES = 10_000`) เก็บ stack path + duration (`μs`) + timestamp (`μs since process start`)
- **ขอบเขตเอาต์พุต**: `getWorkProfile(lastSeconds)` คืนค่า object:
  - `folded`: ข้อความ folded-stack (อินพุต flamegraph)
  - `summary`: ตารางสรุป markdown
  - `svg`: SVG flamegraph ที่เป็นตัวเลือก
  - `totalMs`, `sampleCount`

## วงจรชีวิตและการเปลี่ยนแปลงสถานะ

### วงจรชีวิตรูปภาพ

1. `PhotonImage.parse(bytes)` จัดตาราง blocking decode task (`image.decode`)
2. เมื่อสำเร็จ native `PhotonImage` handle จะมีอยู่ใน JS
3. `resize(...)` สร้าง native handle ใหม่ (`image.resize`) handle เก่าและใหม่สามารถอยู่ร่วมกันได้
4. `encode(...)` สร้างไบต์ (`image.encode`) โดยไม่เปลี่ยนแปลงขนาดรูปภาพ

การเปลี่ยนสถานะเมื่อล้มเหลว:

- ความล้มเหลวในการตรวจจับรูปแบบ/ถอดรหัสจะ reject parse promise
- ความล้มเหลวในการเข้ารหัสจะ reject encode promise
- รหัสรูปแบบที่ไม่ถูกต้องจะ reject encode promise

### วงจรชีวิต HTML

1. `htmlToMarkdown(html, options)` จัดตาราง blocking conversion task
2. การแปลงทำงานด้วยตัวเลือกค่าเริ่มต้น (`cleanContent=false`, `skipImages=false`) เว้นแต่ระบุไว้
3. คืนค่า markdown string หรือ reject

การเปลี่ยนสถานะเมื่อล้มเหลว:

- ความล้มเหลวของตัวแปลงจะคืนค่า rejected promise (`Conversion error: ...`)

### วงจรชีวิตคลิปบอร์ด

`copyToClipboard(text)` ตั้งใจให้เป็น best-effort และหลายเส้นทาง:

1. ถ้าเป็น TTY: พยายามเขียน OSC 52 (base64 payload)
2. ลอง Termux command เมื่อมีการตั้งค่า `TERMUX_VERSION`
3. ลอง native `arboard` text copy
4. กลืนข้อผิดพลาดที่ชั้น TS

`readImageFromClipboard()` ความเข้มงวดแตกต่างกันตามขั้นตอน:

1. TS จำกัดบริบทรันไทม์ที่ไม่รองรับอย่างเข้มงวด (Termux/headless Linux) เป็น `null`
2. Rust `arboard` read ทำงานเฉพาะเมื่อ TS อนุญาต
3. `ContentNotAvailable` ถูก map เป็น `null`
4. ข้อผิดพลาด Rust อื่นๆ จะ reject

### วงจรชีวิต work profiling

1. ไม่ต้องเริ่มต้นอย่างชัดเจน: การ profiling เปิดตลอดเมื่อ task helpers ทำงาน
2. ทุก scope ของ instrumented task จะบันทึกหนึ่งตัวอย่างเมื่อ guard drop
3. ตัวอย่างจะเขียนทับรายการเก่าที่สุดหลังจากความจุของ buffer เต็ม
4. `getWorkProfile(lastSeconds)` อ่านกรอบเวลาและสร้าง folded/summary/svg artifacts

การเปลี่ยนสถานะเมื่อล้มเหลว:

- ความล้มเหลวในการสร้าง SVG เป็น soft-fail (`svg: null`) ในขณะที่ folded และ summary ยังคืนค่า
- กรอบเวลาตัวอย่างที่ว่างจะคืนค่า folded data ว่างและ `svg: null` ไม่ใช่ข้อผิดพลาด

## การดำเนินการที่ไม่รองรับและการแพร่กระจายข้อผิดพลาด

### รูปภาพ

- อินพุตถอดรหัสที่ไม่รองรับหรือไบต์ที่เสียหาย: ล้มเหลวแบบเข้มงวด (promise rejection)
- รหัสรูปแบบเข้ารหัสที่ไม่รองรับ: ล้มเหลวแบบเข้มงวด
- ไม่มีเส้นทาง best-effort fallback ใน TS wrapper

### HTML

- ข้อผิดพลาดการแปลงเป็นความล้มเหลวแบบเข้มงวด (rejection)
- การละเว้นตัวเลือกเป็นการตั้งค่าเริ่มต้นแบบ best-effort ไม่ใช่ความล้มเหลว

### คลิปบอร์ด

- การคัดลอกข้อความเป็น best-effort ที่ชั้น TS: ความล้มเหลวในการดำเนินงานจะถูกระงับ
- การอ่านรูปภาพแยกแยะ "ไม่มีรูปภาพ" (`null`) จากความล้มเหลวในการดำเนินงาน (rejection)
- Termux/headless Linux ถูกถือเป็นบริบทที่ไม่รองรับสำหรับการอ่านรูปภาพ (`null`)

### Work profiling

- การดึงข้อมูลเป็นแบบเข้มงวดสำหรับการเรียกฟังก์ชันเอง แต่การสร้าง artifact เป็น best-effort บางส่วน (`svg` เป็น nullable ได้)
- การตัด buffer เป็นพฤติกรรมที่คาดหวัง (ring buffer) ไม่ใช่บั๊กการสูญเสียข้อมูล

## ข้อควรระวังเฉพาะแพลตฟอร์ม

- **ข้อความคลิปบอร์ด**: OSC 52 ขึ้นอยู่กับการรองรับของเทอร์มินัล; การเข้าถึง native clipboard ขึ้นอยู่กับ desktop environment/session
- **การอ่านรูปภาพคลิปบอร์ด**: ถูกบล็อกใน TS สำหรับ Termux และ Linux ที่ไม่มี display server
