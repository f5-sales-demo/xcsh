---
title: ยูทิลิตีมีเดียและระบบแบบเนทีฟ
description: ยูทิลิตีการประมวลผลมีเดียแบบเนทีฟสำหรับภาพหน้าจอ การจัดการรูปภาพ และข้อมูลระบบ
sidebar:
  order: 7
  label: ยูทิลิตีมีเดียและระบบ
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# ยูทิลิตีมีเดีย + ระบบแบบเนทีฟ

เอกสารนี้เป็นการเจาะลึกระบบย่อยสำหรับเลเยอร์ **system/media/conversion primitives** ที่อธิบายไว้ใน [`docs/natives-architecture.md`](./natives-architecture.md): ส่วนของ `image`, `html`, `clipboard` และการทำโปรไฟล์ `work`

## ไฟล์การนำไปใช้งาน

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

> หมายเหตุ: ไม่มีไฟล์ `crates/pi-natives/src/work.rs`; การทำโปรไฟล์งานถูกนำไปใช้งานใน `prof.rs` และรับข้อมูลจากการวัดผลใน `task.rs`

## การแมประหว่าง TS API ↔ Rust export/module

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

- **ขอบเขต JS input**: ไบต์ของรูปภาพที่เข้ารหัสเป็น `Uint8Array`
- **ขอบเขตการถอดรหัส Rust**: ไบต์จะถูกคัดลอกไปยัง `Vec<u8>` โดยรูปแบบจะถูกตรวจสอบด้วย `ImageReader::with_guessed_format()` จากนั้นถอดรหัสเป็น `DynamicImage`
- **สถานะในหน่วยความจำ**: `PhotonImage` จัดเก็บ `Arc<DynamicImage>`
- **ขอบเขต output**: `encode(format, quality)` คืนค่า `Promise<Uint8Array>` (Rust `Vec<u8>`)

รหัสรูปแบบเป็นตัวเลข:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (ตัวเข้ารหัสแบบ lossless)
- `3`: GIF

ข้อจำกัด:

- `quality` ใช้งานได้เฉพาะกับ JPEG เท่านั้น
- PNG/WebP/GIF ไม่สนใจค่า `quality`
- รหัสรูปแบบที่ไม่รองรับจะล้มเหลว (`Invalid image format: <id>`)

### การแปลง HTML (`html`)

- **ขอบเขต JS input**: `string` ของ HTML + optional object `{ cleanContent?: boolean; skipImages?: boolean }`
- **ขอบเขตการแปลง Rust**: `String` input ถูกแปลงโดย `html_to_markdown_rs::convert`
- **ขอบเขต output**: `string` ของ Markdown

พฤติกรรมการแปลง:

- `cleanContent` มีค่าเริ่มต้นเป็น `false`
- เมื่อ `cleanContent=true` การประมวลผลเบื้องต้นจะถูกเปิดใช้งานด้วย `PreprocessingPreset::Aggressive` พร้อมแฟล็กสำหรับลบ navigation/forms ออกอย่างถาวร
- `skipImages` มีค่าเริ่มต้นเป็น `false`

### คลิปบอร์ด (`clipboard`)

- **เส้นทางข้อความ**:
  - TS จะปล่อย OSC 52 (`\x1b]52;c;<base64>\x07`) เป็นอันดับแรกเมื่อ stdout เป็น TTY
  - ข้อความเดียวกันจะถูกลองผ่าน native clipboard API (`native.copyToClipboard`) แบบ best-effort
  - บน Termux, TS จะลอง `termux-clipboard-set` ก่อน
- **เส้นทางการอ่านรูปภาพ**:
  - Rust อ่านรูปภาพดิบจาก `arboard`
  - Rust เข้ารหัสใหม่เป็นไบต์ PNG (`image` crate) คืนค่า `{ data: Uint8Array, mimeType: "image/png" }`
  - TS คืนค่า `null` ก่อนกำหนดบน Termux หรือ Linux sessions ที่ไม่มี display server (ไม่มี `DISPLAY`/`WAYLAND_DISPLAY`)

### การทำโปรไฟล์งาน (`work`)

- **ขอบเขตการเก็บข้อมูล**: ตัวอย่างการทำโปรไฟล์ถูกสร้างโดย guards `profile_region(tag)` ใน `task::blocking` และ `task::future`
- **รูปแบบการจัดเก็บ**: circular buffer ขนาดคงที่ (`MAX_SAMPLES = 10_000`) ที่จัดเก็บ stack path + duration (`μs`) + timestamp (`μs นับจากเวลาเริ่มต้นของกระบวนการ`)
- **ขอบเขต output**: `getWorkProfile(lastSeconds)` คืนค่า object:
  - `folded`: ข้อความ folded-stack (input สำหรับ flamegraph)
  - `summary`: ตาราง markdown สรุป
  - `svg`: SVG ของ flamegraph แบบ optional
  - `totalMs`, `sampleCount`

## วงจรชีวิตและการเปลี่ยนสถานะ

### วงจรชีวิตรูปภาพ

1. `PhotonImage.parse(bytes)` กำหนดเวลา blocking decode task (`image.decode`)
2. เมื่อสำเร็จ native `PhotonImage` handle จะปรากฏอยู่ใน JS
3. `resize(...)` สร้าง native handle ใหม่ (`image.resize`) โดย handle เก่าและใหม่สามารถอยู่ร่วมกันได้
4. `encode(...)` สร้างไบต์ (`image.encode`) โดยไม่แก้ไขมิติของรูปภาพ

การเปลี่ยนสถานะเมื่อเกิดข้อผิดพลาด:

- การตรวจจับรูปแบบ/ความล้มเหลวในการถอดรหัส จะปฏิเสธ promise ของ parse
- ความล้มเหลวในการเข้ารหัสจะปฏิเสธ promise ของ encode
- รหัสรูปแบบที่ไม่ถูกต้องจะปฏิเสธ promise ของ encode

### วงจรชีวิต HTML

1. `htmlToMarkdown(html, options)` กำหนดเวลา blocking conversion task
2. การแปลงจะทำงานด้วยตัวเลือกที่กำหนดค่าเริ่มต้น (`cleanContent=false`, `skipImages=false`) หากไม่ได้ระบุ
3. คืนค่า markdown string หรือปฏิเสธ

การเปลี่ยนสถานะเมื่อเกิดข้อผิดพลาด:

- ความล้มเหลวของตัวแปลงคืนค่า rejected promise (`Conversion error: ...`)

### วงจรชีวิตคลิปบอร์ด

`copyToClipboard(text)` ถูกออกแบบมาให้เป็นแบบ best-effort และมีหลายเส้นทาง:

1. หากเป็น TTY: ลองเขียน OSC 52 (payload แบบ base64)
2. ลอง Termux command เมื่อตั้งค่า `TERMUX_VERSION`
3. ลอง native `arboard` text copy
4. ยกเลิกข้อผิดพลาดที่เลเยอร์ TS

ความเข้มงวดของ `readImageFromClipboard()` แตกต่างกันตามขั้นตอน:

1. TS จะปิดกั้น runtime contexts ที่ไม่รองรับอย่างเด็ดขาด (Termux/headless Linux) ด้วย `null`
2. Rust `arboard` read จะทำงานเฉพาะเมื่อ TS อนุญาต
3. `ContentNotAvailable` แมปไปยัง `null`
4. ข้อผิดพลาด Rust อื่น ๆ จะปฏิเสธ

### วงจรชีวิตการทำโปรไฟล์งาน

1. ไม่มีการเริ่มต้นที่ชัดเจน: การทำโปรไฟล์จะทำงานตลอดเวลาเมื่อ task helpers ทำงาน
2. ทุก instrumented task scope บันทึกตัวอย่างหนึ่งรายการเมื่อ guard ถูก drop
3. ตัวอย่างจะเขียนทับรายการที่เก่าที่สุดหลังจาก buffer capacity ถึงขีดจำกัด
4. `getWorkProfile(lastSeconds)` อ่านช่วงเวลาและสร้าง artifacts ของ folded/summary/svg

การเปลี่ยนสถานะเมื่อเกิดข้อผิดพลาด:

- ความล้มเหลวในการสร้าง SVG เป็นแบบ soft-fail (`svg: null`) ในขณะที่ folded และ summary ยังคืนค่าได้
- ช่วงเวลาตัวอย่างที่ว่างเปล่าคืนค่า folded data ว่างและ `svg: null` ไม่ใช่ข้อผิดพลาด

## การดำเนินการที่ไม่รองรับและการส่งต่อข้อผิดพลาด

### รูปภาพ

- input การถอดรหัสที่ไม่รองรับหรือไบต์ที่เสียหาย: ความล้มเหลวแบบเข้มงวด (การปฏิเสธ promise)
- รหัสรูปแบบการเข้ารหัสที่ไม่รองรับ: ความล้มเหลวแบบเข้มงวด
- ไม่มีเส้นทาง best-effort fallback ใน TS wrapper

### HTML

- ข้อผิดพลาดการแปลงเป็นความล้มเหลวแบบเข้มงวด (การปฏิเสธ)
- การละเว้น option เป็นแบบ best-effort defaulting ไม่ใช่ความล้มเหลว

### คลิปบอร์ด

- การคัดลอกข้อความเป็นแบบ best-effort ที่เลเยอร์ TS: ความล้มเหลวในการดำเนินการจะถูกระงับ
- การอ่านรูปภาพแยกแยะระหว่าง "ไม่มีรูปภาพ" (`null`) กับความล้มเหลวในการดำเนินการ (การปฏิเสธ)
- Termux/headless Linux ถูกจัดการเป็น context ที่ไม่รองรับสำหรับการอ่านรูปภาพ (`null`)

### การทำโปรไฟล์งาน

- การเรียกค้นข้อมูลเป็นแบบเข้มงวดสำหรับการเรียกฟังก์ชันเอง แต่การสร้าง artifact เป็นแบบ best-effort บางส่วน (`svg` สามารถเป็น null ได้)
- การตัดทอน buffer เป็นพฤติกรรมที่คาดหวัง (ring buffer) ไม่ใช่ bug ที่ทำให้ข้อมูลสูญหาย

## ข้อจำกัดของแพลตฟอร์ม

- **ข้อความคลิปบอร์ด**: OSC 52 ขึ้นอยู่กับการรองรับของ terminal; การเข้าถึง native clipboard ขึ้นอยู่กับ desktop environment/session
- **การอ่านรูปภาพจากคลิปบอร์ด**: ถูกบล็อกใน TS สำหรับ Termux และ Linux ที่ไม่มี display server
