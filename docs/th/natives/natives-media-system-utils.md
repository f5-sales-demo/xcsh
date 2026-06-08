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

# ยูทิลิตี้ natives media + system

เอกสารนี้เป็นการเจาะลึกระบบย่อยสำหรับเลเยอร์ **system/media/conversion primitives** ที่อธิบายไว้ใน [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` และ `work` profiling

## ไฟล์ implementation

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

## การแมป TS API ↔ Rust export/module

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

### Image (`image`)

- **ขอบเขตอินพุต JS**: `Uint8Array` ไบต์ของภาพที่เข้ารหัสแล้ว
- **ขอบเขตการถอดรหัส Rust**: ไบต์ถูกคัดลอกไปยัง `Vec<u8>`, รูปแบบถูกคาดเดาด้วย `ImageReader::with_guessed_format()` แล้วถอดรหัสเป็น `DynamicImage`
- **สถานะในหน่วยความจำ**: `PhotonImage` เก็บ `Arc<DynamicImage>`
- **ขอบเขตเอาต์พุต**: `encode(format, quality)` คืนค่า `Promise<Uint8Array>` (Rust `Vec<u8>`)

Format IDs เป็นตัวเลข:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (lossless encoder)
- `3`: GIF

ข้อจำกัด:

- `quality` ใช้เฉพาะกับ JPEG เท่านั้น
- PNG/WebP/GIF จะไม่สนใจ `quality`
- Format IDs ที่ไม่รองรับจะล้มเหลว (`Invalid image format: <id>`)

### การแปลง HTML (`html`)

- **ขอบเขตอินพุต JS**: HTML `string` + อ็อบเจกต์แบบ optional `{ cleanContent?: boolean; skipImages?: boolean }`
- **ขอบเขตการแปลง Rust**: อินพุต `String` ถูกแปลงโดย `html_to_markdown_rs::convert`
- **ขอบเขตเอาต์พุต**: Markdown `string`

พฤติกรรมการแปลง:

- `cleanContent` ค่าเริ่มต้นเป็น `false`
- เมื่อ `cleanContent=true`, การประมวลผลล่วงหน้าจะถูกเปิดใช้งานด้วย `PreprocessingPreset::Aggressive` และแฟล็กการลบอย่างเด็ดขาดสำหรับ navigation/forms
- `skipImages` ค่าเริ่มต้นเป็น `false`

### Clipboard (`clipboard`)

- **เส้นทาง Text**:
  - TS จะส่ง OSC 52 (`\x1b]52;c;<base64>\x07`) ก่อนเมื่อ stdout เป็น TTY
  - ข้อความเดียวกันจะถูกพยายามส่งผ่าน native clipboard API (`native.copyToClipboard`) แบบ best-effort
  - บน Termux, TS จะพยายาม `termux-clipboard-set` ก่อน
- **เส้นทางการอ่าน Image**:
  - Rust อ่านภาพดิบจาก `arboard`
  - Rust เข้ารหัสใหม่เป็นไบต์ PNG (`image` crate), คืนค่า `{ data: Uint8Array, mimeType: "image/png" }`
  - TS คืนค่า `null` ทันทีบน Termux หรือ Linux sessions ที่ไม่มี display server (`DISPLAY`/`WAYLAND_DISPLAY` หายไป)

### Work profiling (`work`)

- **ขอบเขตการเก็บข้อมูล**: ตัวอย่าง profiling ถูกสร้างโดย `profile_region(tag)` guards ใน `task::blocking` และ `task::future`
- **รูปแบบการจัดเก็บ**: circular buffer ขนาดคงที่ (`MAX_SAMPLES = 10_000`) เก็บ stack path + duration (`μs`) + timestamp (`μs ตั้งแต่เริ่มต้น process`)
- **ขอบเขตเอาต์พุต**: `getWorkProfile(lastSeconds)` คืนค่าอ็อบเจกต์:
  - `folded`: ข้อความ folded-stack (อินพุตสำหรับ flamegraph)
  - `summary`: ตารางสรุปแบบ markdown
  - `svg`: SVG flamegraph แบบ optional
  - `totalMs`, `sampleCount`

## วงจรชีวิตและการเปลี่ยนผ่านสถานะ

### วงจรชีวิต Image

1. `PhotonImage.parse(bytes)` จัดตาราง blocking decode task (`image.decode`)
2. เมื่อสำเร็จ, native `PhotonImage` handle จะมีอยู่ใน JS
3. `resize(...)` สร้าง native handle ใหม่ (`image.resize`), handle เก่าและใหม่สามารถอยู่ร่วมกันได้
4. `encode(...)` สร้างไบต์ (`image.encode`) โดยไม่เปลี่ยนแปลงขนาดภาพ

การเปลี่ยนผ่านเมื่อล้มเหลว:

- การตรวจจับรูปแบบ/ถอดรหัสล้มเหลวจะ reject parse promise
- การเข้ารหัสล้มเหลวจะ reject encode promise
- Format ID ที่ไม่ถูกต้องจะ reject encode promise

### วงจรชีวิต HTML

1. `htmlToMarkdown(html, options)` จัดตาราง blocking conversion task
2. การแปลงทำงานด้วยตัวเลือกค่าเริ่มต้น (`cleanContent=false`, `skipImages=false`) เว้นแต่จะระบุเป็นอื่น
3. คืนค่า markdown string หรือ reject

การเปลี่ยนผ่านเมื่อล้มเหลว:

- ความล้มเหลวของ converter คืนค่า rejected promise (`Conversion error: ...`)

### วงจรชีวิต Clipboard

`copyToClipboard(text)` ตั้งใจเป็นแบบ best-effort และหลายเส้นทาง:

1. ถ้าเป็น TTY: พยายามเขียน OSC 52 (base64 payload)
2. ลอง Termux command เมื่อตั้งค่า `TERMUX_VERSION` ไว้แล้ว
3. ลอง native `arboard` text copy
4. กลืนข้อผิดพลาดที่เลเยอร์ TS

`readImageFromClipboard()` ความเข้มงวดแตกต่างกันตามขั้นตอน:

1. TS จะบล็อก runtime context ที่ไม่รองรับ (Termux/headless Linux) ให้เป็น `null` อย่างเด็ดขาด
2. Rust `arboard` read ทำงานเฉพาะเมื่อ TS อนุญาต
3. `ContentNotAvailable` แมปเป็น `null`
4. ข้อผิดพลาด Rust อื่นๆ จะ reject

### วงจรชีวิต Work profiling

1. ไม่มีการเริ่มต้นอย่างชัดเจน: profiling จะเปิดอยู่เสมอเมื่อ task helpers ทำงาน
2. ทุก instrumented task scope บันทึกหนึ่งตัวอย่างเมื่อ guard drop
3. ตัวอย่างจะเขียนทับรายการเก่าที่สุดหลังจากความจุ buffer เต็ม
4. `getWorkProfile(lastSeconds)` อ่านช่วงเวลาและสร้าง folded/summary/svg artifacts

การเปลี่ยนผ่านเมื่อล้มเหลว:

- การสร้าง SVG ล้มเหลวเป็นแบบ soft-fail (`svg: null`), ในขณะที่ folded และ summary ยังคงคืนค่า
- ช่วงตัวอย่างที่ว่างเปล่าคืนค่า folded data ว่างเปล่าและ `svg: null`, ไม่ใช่ข้อผิดพลาด

## การดำเนินการที่ไม่รองรับและการส่งต่อข้อผิดพลาด

### Image

- อินพุตการถอดรหัสที่ไม่รองรับหรือไบต์เสียหาย: ล้มเหลวอย่างเด็ดขาด (promise rejection)
- Format ID การเข้ารหัสที่ไม่รองรับ: ล้มเหลวอย่างเด็ดขาด
- ไม่มีเส้นทาง best-effort fallback ใน TS wrapper

### HTML

- ข้อผิดพลาดของการแปลงเป็นความล้มเหลวอย่างเด็ดขาด (rejection)
- การละเว้นตัวเลือกเป็นการตั้งค่าเริ่มต้นแบบ best-effort ไม่ใช่ความล้มเหลว

### Clipboard

- การคัดลอกข้อความเป็นแบบ best-effort ที่เลเยอร์ TS: ความล้มเหลวในการดำเนินงานจะถูกระงับ
- การอ่านภาพแยกความแตกต่างระหว่าง "ไม่มีภาพ" (`null`) กับความล้มเหลวในการดำเนินงาน (rejection)
- Termux/headless Linux ถูกจัดว่าเป็น context ที่ไม่รองรับสำหรับการอ่านภาพ (`null`)

### Work profiling

- การดึงข้อมูลเป็นแบบเด็ดขาดสำหรับการเรียกฟังก์ชันเอง แต่การสร้าง artifact เป็นแบบ best-effort บางส่วน (`svg` เป็น nullable)
- การตัดทอน buffer เป็นพฤติกรรมที่คาดหวัง (ring buffer) ไม่ใช่บั๊กการสูญเสียข้อมูล

## ข้อควรระวังเฉพาะแพลตฟอร์ม

- **Clipboard text**: OSC 52 ขึ้นอยู่กับการรองรับของ terminal; การเข้าถึง native clipboard ขึ้นอยู่กับ desktop environment/session
- **การอ่านภาพ Clipboard**: ถูกบล็อกใน TS สำหรับ Termux และ Linux ที่ไม่มี display server
