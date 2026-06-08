---
title: Natives Media and System Utilities
description: >-
  Native media processing utilities for screenshots, image handling, and system
  information.
sidebar:
  order: 7
  label: Media & system utils
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# ยูทิลิตี้สื่อ + ระบบแบบเนทีฟ

เอกสารนี้เป็นการเจาะลึกระบบย่อยสำหรับเลเยอร์ **พรีมิทีฟของระบบ/สื่อ/การแปลง** ที่อธิบายไว้ใน [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` และการโปรไฟล์ `work`

## ไฟล์การอิมพลีเมนต์

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

> หมายเหตุ: ไม่มีไฟล์ `crates/pi-natives/src/work.rs`; การโปรไฟล์ work ถูกอิมพลีเมนต์ใน `prof.rs` และได้รับข้อมูลจากการ instrumentation ใน `task.rs`

## การแมปของ TS API ↔ Rust export/module

| TS export (packages/natives)                | Rust N-API export                                                       | Rust module                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS fallback logic                                  | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## ขอบเขตของรูปแบบข้อมูลและการแปลง

### รูปภาพ (`image`)

- **ขอบเขตอินพุตฝั่ง JS**: `Uint8Array` ไบต์ของรูปภาพที่เข้ารหัสแล้ว
- **ขอบเขตการถอดรหัสฝั่ง Rust**: ไบต์จะถูกคัดลอกไปยัง `Vec<u8>` โดยรูปแบบจะถูกคาดเดาด้วย `ImageReader::with_guessed_format()` จากนั้นถอดรหัสเป็น `DynamicImage`
- **สถานะในหน่วยความจำ**: `PhotonImage` เก็บ `Arc<DynamicImage>`
- **ขอบเขตเอาต์พุต**: `encode(format, quality)` คืนค่า `Promise<Uint8Array>` (Rust `Vec<u8>`)

ID ของรูปแบบเป็นตัวเลข:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (ตัวเข้ารหัสแบบ lossless)
- `3`: GIF

ข้อจำกัด:

- `quality` ใช้เฉพาะกับ JPEG เท่านั้น
- PNG/WebP/GIF จะไม่สนใจ `quality`
- ID ของรูปแบบที่ไม่รองรับจะล้มเหลว (`Invalid image format: <id>`)

### การแปลง HTML (`html`)

- **ขอบเขตอินพุตฝั่ง JS**: HTML `string` + อ็อบเจกต์ที่เป็นทางเลือก `{ cleanContent?: boolean; skipImages?: boolean }`
- **ขอบเขตการแปลงฝั่ง Rust**: อินพุต `String` จะถูกแปลงโดย `html_to_markdown_rs::convert`
- **ขอบเขตเอาต์พุต**: Markdown `string`

พฤติกรรมการแปลง:

- `cleanContent` ค่าเริ่มต้นเป็น `false`
- เมื่อ `cleanContent=true` การประมวลผลเบื้องต้นจะถูกเปิดใช้งานด้วย `PreprocessingPreset::Aggressive` และแฟล็กการลบแบบเข้มงวดสำหรับ navigation/forms
- `skipImages` ค่าเริ่มต้นเป็น `false`

### คลิปบอร์ด (`clipboard`)

- **เส้นทางข้อความ**:
  - TS จะส่ง OSC 52 (`\x1b]52;c;<base64>\x07`) ก่อนเมื่อ stdout เป็น TTY
  - จากนั้นข้อความเดียวกันจะถูกพยายามผ่าน native clipboard API (`native.copyToClipboard`) แบบ best-effort
  - บน Termux, TS จะพยายาม `termux-clipboard-set` ก่อน
- **เส้นทางการอ่านรูปภาพ**:
  - Rust อ่านรูปภาพดิบจาก `arboard`
  - Rust เข้ารหัสใหม่เป็นไบต์ PNG (ใช้ `image` crate) คืนค่า `{ data: Uint8Array, mimeType: "image/png" }`
  - TS คืนค่า `null` ทันทีบน Termux หรือเซสชัน Linux ที่ไม่มี display server (ไม่มี `DISPLAY`/`WAYLAND_DISPLAY`)

### การโปรไฟล์ Work (`work`)

- **ขอบเขตการเก็บข้อมูล**: ตัวอย่างการโปรไฟล์ถูกสร้างโดย guard `profile_region(tag)` ใน `task::blocking` และ `task::future`
- **รูปแบบการจัดเก็บ**: circular buffer ขนาดคงที่ (`MAX_SAMPLES = 10_000`) ที่เก็บ stack path + duration (`μs`) + timestamp (`μs ตั้งแต่เริ่มกระบวนการ`)
- **ขอบเขตเอาต์พุต**: `getWorkProfile(lastSeconds)` คืนค่าอ็อบเจกต์:
  - `folded`: ข้อความ folded-stack (อินพุตสำหรับ flamegraph)
  - `summary`: ตารางสรุปแบบ markdown
  - `svg`: SVG flamegraph ที่เป็นทางเลือก
  - `totalMs`, `sampleCount`

## วงจรชีวิตและการเปลี่ยนสถานะ

### วงจรชีวิตของรูปภาพ

1. `PhotonImage.parse(bytes)` จัดตารางงานถอดรหัสแบบ blocking (`image.decode`)
2. เมื่อสำเร็จ จะมี native `PhotonImage` handle อยู่ใน JS
3. `resize(...)` สร้าง native handle ใหม่ (`image.resize`) โดย handle เก่าและใหม่สามารถอยู่ร่วมกันได้
4. `encode(...)` สร้างไบต์ (`image.encode`) โดยไม่เปลี่ยนขนาดของรูปภาพ

การเปลี่ยนสถานะเมื่อล้มเหลว:

- การตรวจจับรูปแบบ/การถอดรหัสล้มเหลวจะ reject parse promise
- การเข้ารหัสล้มเหลวจะ reject encode promise
- ID ของรูปแบบที่ไม่ถูกต้องจะ reject encode promise

### วงจรชีวิตของ HTML

1. `htmlToMarkdown(html, options)` จัดตารางงานแปลงแบบ blocking
2. การแปลงทำงานด้วยตัวเลือกค่าเริ่มต้น (`cleanContent=false`, `skipImages=false`) เว้นแต่จะระบุไว้
3. คืนค่า markdown string หรือ reject

การเปลี่ยนสถานะเมื่อล้มเหลว:

- ตัวแปลงล้มเหลวจะคืนค่า rejected promise (`Conversion error: ...`)

### วงจรชีวิตของคลิปบอร์ด

`copyToClipboard(text)` ตั้งใจให้เป็นแบบ best-effort และหลายเส้นทาง:

1. ถ้าเป็น TTY: พยายามเขียน OSC 52 (payload แบบ base64)
2. ลองคำสั่ง Termux เมื่อตั้งค่า `TERMUX_VERSION` ไว้
3. ลองคัดลอกข้อความด้วย `arboard` แบบเนทีฟ
4. ดูดซับข้อผิดพลาดที่เลเยอร์ TS

`readImageFromClipboard()` มีความเข้มงวดต่างกันในแต่ละขั้นตอน:

1. TS ปิดกั้นบริบทรันไทม์ที่ไม่รองรับ (Termux/headless Linux) อย่างเข้มงวดเป็น `null`
2. การอ่าน Rust `arboard` ทำงานเฉพาะเมื่อ TS อนุญาตเท่านั้น
3. `ContentNotAvailable` แมปเป็น `null`
4. ข้อผิดพลาด Rust อื่นๆ จะ reject

### วงจรชีวิตของการโปรไฟล์ Work

1. ไม่มีการเริ่มต้นอย่างชัดเจน: การโปรไฟล์จะเปิดใช้งานเสมอเมื่อ task helper ทำงาน
2. ทุก scope ของงานที่ถูก instrument จะบันทึกหนึ่งตัวอย่างเมื่อ guard ถูก drop
3. ตัวอย่างจะเขียนทับรายการที่เก่าที่สุดหลังจากความจุของ buffer เต็ม
4. `getWorkProfile(lastSeconds)` อ่านหน้าต่างเวลาและสร้าง artifact แบบ folded/summary/svg

การเปลี่ยนสถานะเมื่อล้มเหลว:

- การสร้าง SVG ล้มเหลวเป็นแบบ soft-fail (`svg: null`) ในขณะที่ folded และ summary ยังคงคืนค่าได้
- หน้าต่างตัวอย่างว่างจะคืนค่า folded data ที่ว่างและ `svg: null` ไม่ใช่ข้อผิดพลาด

## การดำเนินการที่ไม่รองรับและการแพร่กระจายข้อผิดพลาด

### รูปภาพ

- อินพุตการถอดรหัสที่ไม่รองรับหรือไบต์ที่เสียหาย: ล้มเหลวอย่างเข้มงวด (promise rejection)
- ID ของรูปแบบเข้ารหัสที่ไม่รองรับ: ล้มเหลวอย่างเข้มงวด
- ไม่มีเส้นทาง fallback แบบ best-effort ใน TS wrapper

### HTML

- ข้อผิดพลาดการแปลงเป็นการล้มเหลวอย่างเข้มงวด (rejection)
- การละเว้นตัวเลือกเป็นค่าเริ่มต้นแบบ best-effort ไม่ใช่ความล้มเหลว

### คลิปบอร์ด

- การคัดลอกข้อความเป็นแบบ best-effort ที่เลเยอร์ TS: ความล้มเหลวในการดำเนินงานจะถูกระงับ
- การอ่านรูปภาพแยกแยะระหว่าง "ไม่มีรูปภาพ" (`null`) กับความล้มเหลวในการดำเนินงาน (rejection)
- Termux/headless Linux ถูกถือว่าเป็นบริบทที่ไม่รองรับสำหรับการอ่านรูปภาพ (`null`)

### การโปรไฟล์ Work

- การดึงข้อมูลเป็นแบบเข้มงวดสำหรับการเรียกฟังก์ชันเอง แต่การสร้าง artifact เป็นแบบ best-effort บางส่วน (`svg` สามารถเป็น nullable)
- การตัดทอน buffer เป็นพฤติกรรมที่คาดหวัง (ring buffer) ไม่ใช่บั๊กของการสูญเสียข้อมูล

## ข้อควรระวังเฉพาะแพลตฟอร์ม

- **ข้อความคลิปบอร์ด**: OSC 52 ขึ้นอยู่กับการรองรับของเทอร์มินัล; การเข้าถึงคลิปบอร์ดแบบเนทีฟขึ้นอยู่กับ desktop environment/session
- **การอ่านรูปภาพจากคลิปบอร์ด**: ถูกบล็อกใน TS สำหรับ Termux และ Linux ที่ไม่มี display server
