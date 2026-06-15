---
title: ยูทิลิตี้มีเดียและระบบแบบ Native
description: >-
  ยูทิลิตี้การประมวลผลมีเดียแบบ Native สำหรับสกรีนช็อต การจัดการรูปภาพ
  และข้อมูลระบบ
sidebar:
  order: 7
  label: ยูทิลิตี้มีเดียและระบบ
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# มีเดีย Native + ยูทิลิตี้ระบบ

เอกสารนี้เป็นการวิเคราะห์เชิงลึกของระบบย่อยสำหรับชั้น **system/media/conversion primitives** ที่อธิบายไว้ใน [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` และการโปรไฟล์ `work`

## ไฟล์การติดตั้ง

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

> หมายเหตุ: ไม่มี `crates/pi-natives/src/work.rs`; การโปรไฟล์งานถูกติดตั้งใน `prof.rs` และป้อนข้อมูลโดยการ instrumentation ใน `task.rs`

## การแมปการส่งออก/โมดูล TS API ↔ Rust

| การส่งออก TS (packages/natives)             | การส่งออก Rust N-API                                                    | โมดูล Rust                            |
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

- **ขอบเขตอินพุต JS**: ไบต์รูปภาพที่เข้ารหัสเป็น `Uint8Array`
- **ขอบเขตการถอดรหัส Rust**: ไบต์ถูกคัดลอกไปยัง `Vec<u8>` ระบบเดาฟอร์แมตด้วย `ImageReader::with_guessed_format()` จากนั้นถอดรหัสเป็น `DynamicImage`
- **สถานะในหน่วยความจำ**: `PhotonImage` เก็บ `Arc<DynamicImage>`
- **ขอบเขตเอาต์พุต**: `encode(format, quality)` คืนค่า `Promise<Uint8Array>` (Rust `Vec<u8>`)

รหัสฟอร์แมตเป็นตัวเลข:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (ตัวเข้ารหัสแบบไม่สูญเสียข้อมูล)
- `3`: GIF

ข้อจำกัด:

- `quality` ใช้งานได้เฉพาะกับ JPEG เท่านั้น
- PNG/WebP/GIF ไม่สนใจค่า `quality`
- รหัสฟอร์แมตที่ไม่รองรับจะล้มเหลว (`Invalid image format: <id>`)

### การแปลง HTML (`html`)

- **ขอบเขตอินพุต JS**: `string` ของ HTML + ออบเจ็กต์ทางเลือก `{ cleanContent?: boolean; skipImages?: boolean }`
- **ขอบเขตการแปลง Rust**: อินพุต `String` ถูกแปลงโดย `html_to_markdown_rs::convert`
- **ขอบเขตเอาต์พุต**: `string` ของ Markdown

พฤติกรรมการแปลง:

- `cleanContent` ค่าเริ่มต้นคือ `false`
- เมื่อ `cleanContent=true` จะเปิดใช้งานการประมวลผลล่วงหน้าด้วย `PreprocessingPreset::Aggressive` และแฟล็กลบอย่างถาวรสำหรับการนำทาง/ฟอร์ม
- `skipImages` ค่าเริ่มต้นคือ `false`

### คลิปบอร์ด (`clipboard`)

- **เส้นทางข้อความ**:
  - TS ปล่อย OSC 52 (`\x1b]52;c;<base64>\x07`) ก่อนเมื่อ stdout เป็น TTY
  - ข้อความเดียวกันจะถูกพยายามผ่าน clipboard API แบบ native (`native.copyToClipboard`) ในฐานะ best-effort
  - บน Termux, TS จะพยายาม `termux-clipboard-set` ก่อน
- **เส้นทางอ่านรูปภาพ**:
  - Rust อ่านรูปภาพดิบจาก `arboard`
  - Rust เข้ารหัสซ้ำเป็นไบต์ PNG (ไลบรารี `image`) คืนค่า `{ data: Uint8Array, mimeType: "image/png" }`
  - TS คืนค่า `null` ก่อนกำหนดบน Termux หรือ Linux sessions ที่ไม่มี display server (`DISPLAY`/`WAYLAND_DISPLAY` ขาดหายไป)

### การโปรไฟล์งาน (`work`)

- **ขอบเขตการเก็บข้อมูล**: ตัวอย่างการโปรไฟล์ถูกสร้างโดย guards `profile_region(tag)` ใน `task::blocking` และ `task::future`
- **รูปแบบการจัดเก็บ**: บัฟเฟอร์วงกลมขนาดคงที่ (`MAX_SAMPLES = 10_000`) เก็บ stack path + duration (`μs`) + timestamp (`μs นับจากการเริ่มต้นกระบวนการ`)
- **ขอบเขตเอาต์พุต**: `getWorkProfile(lastSeconds)` คืนค่าออบเจ็กต์:
  - `folded`: ข้อความ folded-stack (อินพุตสำหรับ flamegraph)
  - `summary`: สรุปตาราง markdown
  - `svg`: SVG flamegraph แบบทางเลือก
  - `totalMs`, `sampleCount`

## วงจรชีวิตและการเปลี่ยนสถานะ

### วงจรชีวิตของรูปภาพ

1. `PhotonImage.parse(bytes)` กำหนดตารางเวลา blocking decode task (`image.decode`)
2. เมื่อสำเร็จ จะมี handle `PhotonImage` แบบ native ใน JS
3. `resize(...)` สร้าง handle แบบ native ใหม่ (`image.resize`) โดย handle เก่าและใหม่สามารถอยู่ร่วมกันได้
4. `encode(...)` สร้างไบต์จริง (`image.encode`) โดยไม่เปลี่ยนแปลงขนาดของรูปภาพ

การเปลี่ยนสถานะเมื่อล้มเหลว:

- การตรวจจับฟอร์แมต/การถอดรหัสล้มเหลว จะปฏิเสธ promise การแยกวิเคราะห์
- การเข้ารหัสล้มเหลว จะปฏิเสธ promise การเข้ารหัส
- รหัสฟอร์แมตไม่ถูกต้อง จะปฏิเสธ promise การเข้ารหัส

### วงจรชีวิตของ HTML

1. `htmlToMarkdown(html, options)` กำหนดตารางเวลา blocking conversion task
2. การแปลงทำงานด้วยออปชันค่าเริ่มต้น (`cleanContent=false`, `skipImages=false`) หากไม่ได้ระบุ
3. คืนค่า markdown string หรือปฏิเสธ

การเปลี่ยนสถานะเมื่อล้มเหลว:

- ความล้มเหลวของตัวแปลงคืนค่า rejected promise (`Conversion error: ...`)

### วงจรชีวิตของคลิปบอร์ด

`copyToClipboard(text)` ถูกออกแบบมาให้เป็น best-effort และมีหลายเส้นทางโดยเจตนา:

1. ถ้าเป็น TTY: พยายามเขียน OSC 52 (payload base64)
2. ลอง Termux command เมื่อตั้งค่า `TERMUX_VERSION` ไว้
3. ลองคัดลอกข้อความแบบ native ด้วย `arboard`
4. กลืนกินข้อผิดพลาดที่ชั้น TS

ความเข้มงวดของ `readImageFromClipboard()` แตกต่างกันตามขั้นตอน:

1. TS ปิดกั้นอย่างเด็ดขาดสำหรับ runtime context ที่ไม่รองรับ (Termux/headless Linux) ให้เป็น `null`
2. Rust `arboard` read ทำงานเฉพาะเมื่อ TS อนุญาต
3. `ContentNotAvailable` แมปเป็น `null`
4. ข้อผิดพลาด Rust อื่นๆ จะปฏิเสธ

### วงจรชีวิตของการโปรไฟล์งาน

1. ไม่มีการเริ่มต้นอย่างชัดเจน: การโปรไฟล์เปิดอยู่เสมอเมื่อ task helpers ทำงาน
2. ทุก instrumented task scope บันทึกหนึ่งตัวอย่างเมื่อ guard drop
3. ตัวอย่างจะเขียนทับรายการเก่าที่สุดหลังจากถึงความจุของบัฟเฟอร์
4. `getWorkProfile(lastSeconds)` อ่านช่วงเวลาหนึ่งและสร้างผลลัพธ์ folded/summary/svg

การเปลี่ยนสถานะเมื่อล้มเหลว:

- การสร้าง SVG ล้มเหลวจะเป็น soft-fail (`svg: null`) ในขณะที่ folded และ summary ยังคงคืนค่า
- ช่วงเวลาตัวอย่างว่างเปล่าจะคืนค่าข้อมูล folded ว่างเปล่าและ `svg: null` ไม่ใช่ข้อผิดพลาด

## การดำเนินการที่ไม่รองรับและการส่งต่อข้อผิดพลาด

### รูปภาพ

- อินพุตการถอดรหัสที่ไม่รองรับหรือไบต์เสียหาย: ล้มเหลวอย่างเข้มงวด (promise rejection)
- รหัสฟอร์แมตการเข้ารหัสที่ไม่รองรับ: ล้มเหลวอย่างเข้มงวด
- ไม่มีเส้นทาง best-effort fallback ใน TS wrapper

### HTML

- ข้อผิดพลาดการแปลงเป็นความล้มเหลวอย่างเข้มงวด (rejection)
- การละเว้นออปชันเป็น best-effort defaulting ไม่ใช่ความล้มเหลว

### คลิปบอร์ด

- การคัดลอกข้อความเป็น best-effort ที่ชั้น TS: ความล้มเหลวในการดำเนินงานถูกระงับ
- การอ่านรูปภาพแยกแยะ "ไม่มีรูปภาพ" (`null`) จากความล้มเหลวในการดำเนินงาน (rejection)
- Termux/headless Linux ถูกถือว่าเป็น context ที่ไม่รองรับสำหรับการอ่านรูปภาพ (`null`)

### การโปรไฟล์งาน

- การดึงข้อมูลเป็นความเข้มงวดสำหรับการเรียกใช้ฟังก์ชันเอง แต่การสร้าง artifact เป็น best-effort บางส่วน (`svg` เป็น nullable)
- การตัดทอนบัฟเฟอร์เป็นพฤติกรรมที่คาดหวัง (ring buffer) ไม่ใช่บัคการสูญหายของข้อมูล

## ข้อจำกัดของแพลตฟอร์ม

- **ข้อความคลิปบอร์ด**: OSC 52 ขึ้นอยู่กับการรองรับของ terminal; การเข้าถึง clipboard แบบ native ขึ้นอยู่กับ desktop environment/session
- **การอ่านรูปภาพจากคลิปบอร์ด**: ถูกบล็อกใน TS สำหรับ Termux และ Linux ที่ไม่มี display server
