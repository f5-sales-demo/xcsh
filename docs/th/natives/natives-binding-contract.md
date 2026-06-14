---
title: สัญญาการผูก Natives (ฝั่ง TypeScript)
description: >-
  สัญญาการผูกฝั่ง TypeScript สำหรับการเรียกใช้ฟังก์ชัน native ของ Rust ผ่าน
  N-API
sidebar:
  order: 2
  label: สัญญาการผูก
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# สัญญาการผูก Natives (ฝั่ง TypeScript)

เอกสารนี้กำหนดสัญญาฝั่ง TypeScript ที่อยู่ระหว่างผู้เรียกใช้ `@f5xc-salesdemos/pi-natives` และ N-API addon ที่โหลดไว้

โดยมุ่งเน้นที่สามส่วนหลัก:

1. รูปแบบสัญญา (`NativeBindings` + การเพิ่มประกาศโมดูล),
2. พฤติกรรมของ wrapper (`src/<module>/index.ts`),
3. พื้นผิวการส่งออกสาธารณะ (`src/index.ts`).

## ไฟล์การ implement

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## รูปแบบสัญญา

`packages/natives/src/bindings.ts` กำหนดสัญญาพื้นฐาน:

- `NativeBindings` (interface พื้นฐาน ปัจจุบันรวม `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` รูปแบบ callback ที่ใช้โดย N-API threadsafe callbacks

แต่ละโมดูลเพิ่มฟิลด์ของตัวเองโดยการผสาน declaration:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

วิธีนี้ช่วยให้มี interface การผูกแบบรวมเพียงชุดเดียวโดยไม่ต้องมีไฟล์ประเภทกลางแบบ monolithic

## วงจรชีวิตการผสาน declaration และการเปลี่ยนสถานะ

### 1) การประกอบประเภทในเวลาคอมไพล์

- `bindings.ts` ให้สัญลักษณ์ `NativeBindings` พื้นฐาน
- ทุก `src/<module>/types.ts` ขยาย `NativeBindings`
- `src/native.ts` นำเข้าไฟล์ `./<module>/types` ทั้งหมดเพื่อ side effects เพื่อให้สัญญาที่ผสานแล้วอยู่ใน scope ที่ใช้ `NativeBindings`

การเปลี่ยนสถานะ: **สัญญาพื้นฐาน** → **สัญญาที่ผสานแล้ว**

### 2) การโหลด addon ในขณะ runtime และประตูการตรวจสอบ

- `src/native.ts` โหลดไบนารี `.node` ที่เป็นตัวเลือก
- อ็อบเจกต์ที่โหลดจะถูกปฏิบัติเป็น `NativeBindings` และส่งผ่าน `validateNative(...)` ทันที
- `validateNative` ตรวจสอบ key การส่งออกที่จำเป็นโดย `typeof bindings[name] === "function"`

การเปลี่ยนสถานะ: **อ็อบเจกต์ addon ที่ยังไม่ได้รับการตรวจสอบ** → **อ็อบเจกต์การผูก native ที่ผ่านการตรวจสอบ** (หรือล้มเหลวแบบถาวร)

### 3) การเรียกใช้ wrapper

- Module wrapper ใน `src/<module>/index.ts` เรียก `native.<export>`
- Wrapper ปรับ default และรูปแบบ callback (`(err, value)` ไปยังรูปแบบ callback ที่รับเฉพาะค่าใน JS APIs)
- `src/index.ts` ส่งออก wrapper/ประเภทของโมดูลอีกครั้งเป็น API แพ็กเกจสาธารณะ

การเปลี่ยนสถานะ: **การผูก raw ที่ผ่านการตรวจสอบ** → **API สาธารณะที่ใช้งานง่าย**

## ความรับผิดชอบของ wrapper

Wrapper มีความบางโดยตั้งใจ โดยไม่ implement logic ของ native ใหม่

ความรับผิดชอบหลัก:

- **การปรับ/กำหนดค่า default ของ argument**
  - `glob()` แปลง `options.path` ให้เป็น absolute path และกำหนดค่า default ให้ `hidden`, `gitignore`, `recursive`
  - `hasMatch()` เติม flag default (`ignoreCase`, `multiline`) ก่อนการเรียก native
- **การปรับ callback**
  - `grep()`, `glob()`, `executeShell()` แปลง `TsFunc<T>` (`error, value`) ให้เป็น callback ของผู้ใช้ที่รับเฉพาะค่าที่สำเร็จ
- **พฤติกรรมสภาพแวดล้อมหรือนโยบายรอบการเรียก native**
  - Clipboard wrapper เพิ่มการจัดการ OSC52/Termux/headless และปฏิบัติการคัดลอกเป็น best effort
- **การตั้งชื่อสาธารณะและการจัดการการส่งออกใหม่**
  - `searchContent()` แมปไปยัง native export `search`

## การจัดระเบียบพื้นผิวการส่งออกสาธารณะ

`packages/natives/src/index.ts` คือ barrel สาธารณะ canonical โดยจัดกลุ่มการส่งออกตามโดเมนความสามารถ:

- การค้นหา/ข้อความ: `grep`, `glob`, `text`, `highlight`
- การ execute/process/terminal: `shell`, `pty`, `ps`, `keys`
- ระบบ/สื่อ/การแปลง: `image`, `html`, `clipboard`, `system-info`, `work`

กฎสำหรับผู้ดูแลระบบ: หาก wrapper ไม่ได้ถูกส่งออกใหม่จาก `src/index.ts` แสดงว่าไม่ได้เป็นส่วนหนึ่งของพื้นผิวแพ็กเกจสาธารณะที่ตั้งใจไว้

## การแมป JS API ↔ native export (ตัวแทน)

ฝั่ง Rust ใช้ชื่อ N-API export (โดยทั่วไปมาจากการแปลง snake_case -> camelCase ของ `#[napi]` โดยมี alias ชัดเจนบางครั้ง) ที่ต้องตรงกับ key การผูกเหล่านี้

| หมวดหมู่ | JS API สาธารณะ (wrapper) | Native binding key | ประเภทที่คืนค่า | Async? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | ใช่ |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | ไม่ |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | ไม่ |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | ใช่ |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | ใช่ |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | ไม่ |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | ใช่ |
| Shell | `Shell` | `Shell` | class constructor | N/A |
| PTY | `PtySession` | `PtySession` | class constructor | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | ไม่ |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | ไม่ |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | ไม่ |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | ไม่ |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | ใช่ |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | ไม่ |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | ไม่ |
| Process | `killTree(pid, signal)` | `killTree` | `number` | ไม่ |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | ไม่ |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (พฤติกรรม wrapper แบบ best effort) | ใช่ |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | ใช่ |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | ไม่ |

## ความแตกต่างของสัญญา sync และ async

สัญญาผสม API แบบ sync และ async ไว้ด้วยกัน โดย wrapper รักษารูปแบบการเรียก native ไว้แทนที่จะบังคับใช้โมเดลเดียว:

- **async แบบ Promise** สำหรับ I/O หรืองานที่ทำงานนาน (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, clipboard, การดำเนินการรูปภาพ)
- **export แบบ synchronous** สำหรับการแปลงในหน่วยความจำ/parser ที่ deterministic (`search`, `hasMatch`, highlighting, ความกว้าง/การตัดข้อความ, การแยกวิเคราะห์ key, การค้นหา process)
- **export แบบ constructor** สำหรับอ็อบเจกต์ runtime ที่มีสถานะ (`Shell`, `PtySession`, `PhotonImage`)

ผลกระทบสำหรับผู้ดูแลระบบ: การเปลี่ยน sync ↔ async สำหรับ export ที่มีอยู่ถือเป็นการเปลี่ยนแปลง API และสัญญาที่ breaking ทั้ง wrapper และผู้เรียกใช้

## รูปแบบการพิมพ์ object และ enum

### รูปแบบ object (สไตล์ `#[napi(object)]` ของ JS object)

TS สร้างแบบจำลองค่า native รูปแบบ object เป็น interface ตัวอย่างเช่น:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

สิ่งเหล่านี้เป็นสัญญาเชิงโครงสร้างในเวลาคอมไพล์ ความถูกต้องของรูปแบบในขณะ runtime เป็นความรับผิดชอบของ native implementation

### รูปแบบ enum

Native enum แบบตัวเลขถูกแสดงเป็นค่า `const enum` ใน TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

ผู้เรียกใช้เห็นชื่อสมาชิก enum ในขณะที่ขอบเขตการผูกส่งผ่านตัวเลข

## วิธีการตรวจจับความไม่ตรงกัน

การตรวจจับความไม่ตรงกันเกิดขึ้นที่สองชั้น:

1. **การตรวจสอบสัญญา TypeScript ในเวลาคอมไพล์**
   - Wrapper เรียก `native.<name>` กับ `NativeBindings` ที่ผสานแล้ว
   - Key การผูกที่หายไป/เปลี่ยนชื่อทำให้การตรวจสอบประเภท TS ใน wrapper เสียหาย

2. **การตรวจสอบ runtime ใน `validateNative`**
   - หลังการโหลด `native.ts` ตรวจสอบ export ที่จำเป็นและ throw หากมีการขาดหายไป
   - ข้อความ error รวม key ที่ขาดหายไปและคำแนะนำการ build ใหม่

วิธีนี้ตรวจจับการ drift ของไบนารีที่ล้าสมัยที่พบบ่อย: wrapper/ประเภทมีอยู่แต่ `.node` ที่โหลดขาด export

## พฤติกรรมความล้มเหลวและข้อควรระวัง

### ความล้มเหลวในการโหลด/ตรวจสอบ (ความล้มเหลวแบบถาวร)

- ความล้มเหลวในการโหลด addon หรือแพลตฟอร์มที่ไม่รองรับ throw ระหว่างการ init โมดูลใน `native.ts`
- Export ที่จำเป็นขาดหายไป throw ก่อนที่ wrapper จะใช้ได้

ผลกระทบ: แพ็กเกจล้มเหลวอย่างรวดเร็วแทนที่จะเลื่อนความล้มเหลวไปยังการเรียกครั้งแรก

### ความแตกต่างพฤติกรรมระดับ wrapper

- Wrapper บางตัวลดความรุนแรงของความล้มเหลวโดยตั้งใจ (`copyToClipboard` เป็น best effort และกลืน native failure)
- Streaming callback ละเว้น error payload ของ callback และส่งต่อเฉพาะเหตุการณ์ค่าที่สำเร็จ

### ข้อควรระวังระดับประเภท (runtime เข้มงวดกว่า TS)

- ฟิลด์ optional ของ TS ไม่รับประกัน semantic validity ชั้น native ยังสามารถปฏิเสธค่าที่มีรูปแบบไม่ถูกต้องได้
- การพิมพ์ `const enum` ไม่ป้องกันค่าตัวเลขนอกช่วงจากผู้เรียกที่ไม่มีประเภทในขณะ runtime
- `validateNative` ตรวจสอบเฉพาะการมีอยู่/ลักษณะเป็น function ของ export ที่จำเป็น ไม่ใช่ความเข้ากันได้ของรูปแบบ argument/return อย่างลึก
- `bindings.ts` รวม `cancelWork(id)` ใน base interface แต่รายการตรวจสอบ runtime ปัจจุบันไม่บังคับใช้ key นั้น

## รายการตรวจสอบสำหรับผู้ดูแลระบบเมื่อมีการเปลี่ยนแปลง binding

เมื่อเพิ่ม/เปลี่ยนแปลง export ให้อัปเดตทั้งหมดนี้:

1. `src/<module>/types.ts` (augmentation + ประเภทสัญญา)
2. `src/<module>/index.ts` (พฤติกรรม wrapper)
3. การนำเข้า `src/native.ts` สำหรับประเภทโมดูล (หากเป็นโมดูลใหม่)
4. การตรวจสอบ export ที่จำเป็นของ `validateNative`
5. การส่งออกใหม่สาธารณะของ `src/index.ts`

การข้ามขั้นตอนใดขั้นตอนหนึ่งจะสร้าง drift ในเวลาคอมไพล์หรือความล้มเหลวในเวลาโหลด runtime
