---
title: สัญญาการเชื่อมต่อ Natives (ฝั่ง TypeScript)
description: >-
  สัญญาการเชื่อมต่อฝั่ง TypeScript สำหรับการเรียกใช้ฟังก์ชัน native ของ Rust
  ผ่าน N-API
sidebar:
  order: 2
  label: สัญญาการเชื่อมต่อ
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# สัญญาการเชื่อมต่อ Natives (ฝั่ง TypeScript)

เอกสารนี้กำหนดสัญญาฝั่ง TypeScript ที่อยู่ระหว่างผู้เรียกใช้ `@f5xc-salesdemos/pi-natives` และ N-API addon ที่ถูกโหลด

เนื้อหามุ่งเน้นที่สามส่วน:

1. รูปแบบสัญญา (`NativeBindings` + module augmentation),
2. พฤติกรรมของ wrapper (`src/<module>/index.ts`),
3. พื้นผิว export สาธารณะ (`src/index.ts`).

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

## โมเดลสัญญา

`packages/natives/src/bindings.ts` กำหนดสัญญาฐาน:

- `NativeBindings` (interface ฐาน ปัจจุบันรวม `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` รูปแบบ callback ที่ใช้โดย N-API threadsafe callbacks

แต่ละโมดูลเพิ่มฟิลด์ของตัวเองผ่าน declaration merging:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

วิธีนี้ทำให้ได้ binding interface รวมเดียวโดยไม่ต้องมีไฟล์ type ส่วนกลางขนาดใหญ่

## วงจรชีวิต Declaration-merging และการเปลี่ยนสถานะ

### 1) การประกอบ type ในเวลาคอมไพล์

- `bindings.ts` ให้สัญลักษณ์ `NativeBindings` ฐาน
- ทุก `src/<module>/types.ts` เสริม `NativeBindings`
- `src/native.ts` นำเข้าไฟล์ `./<module>/types` ทั้งหมดเพื่อ side effects เพื่อให้สัญญาที่รวมแล้วอยู่ในขอบเขตที่ `NativeBindings` ถูกใช้

การเปลี่ยนสถานะ: **สัญญาฐาน** → **สัญญาที่รวมแล้ว**

### 2) การโหลด addon ใน runtime และ gate การตรวจสอบ

- `src/native.ts` โหลดไบนารี `.node` ที่เป็นตัวเลือก
- วัตถุที่โหลดถูกจัดการเป็น `NativeBindings` และถูกส่งผ่าน `validateNative(...)` ทันที
- `validateNative` ตรวจสอบ export key ที่จำเป็นด้วย `typeof bindings[name] === "function"`

การเปลี่ยนสถานะ: **วัตถุ addon ที่ยังไม่ได้ตรวจสอบ** → **วัตถุ native binding ที่ผ่านการตรวจสอบ** (หรือล้มเหลวทันที)

### 3) การเรียกใช้ Wrapper

- Wrapper ของโมดูลใน `src/<module>/index.ts` เรียก `native.<export>`
- Wrapper ปรับค่าเริ่มต้นและรูปแบบ callback (`(err, value)` เป็นรูปแบบ callback ที่รับเฉพาะค่าใน JS APIs)
- `src/index.ts` re-export wrapper/types ของโมดูลเป็น public package API

การเปลี่ยนสถานะ: **Raw bindings ที่ผ่านการตรวจสอบ** → **Public API ที่ใช้งานง่าย**

## ความรับผิดชอบของ Wrapper

Wrapper ถูกออกแบบให้บางโดยตั้งใจ; ไม่ได้ implement ตรรกะ native ใหม่

ความรับผิดชอบหลัก:

- **การ normalize/ตั้งค่าเริ่มต้นของอาร์กิวเมนต์**
  - `glob()` แปลง `options.path` เป็น absolute path และตั้งค่าเริ่มต้น `hidden`, `gitignore`, `recursive`
  - `hasMatch()` เติม flag เริ่มต้น (`ignoreCase`, `multiline`) ก่อนเรียก native
- **การปรับ Callback**
  - `grep()`, `glob()`, `executeShell()` แปลง `TsFunc<T>` (`error, value`) เป็น callback ของผู้ใช้ที่รับเฉพาะค่าที่สำเร็จ
- **พฤติกรรมสภาพแวดล้อมหรือนโยบายรอบการเรียก native**
  - Clipboard wrapper เพิ่มการจัดการ OSC52/Termux/headless และถือว่าการ copy เป็น best effort
- **การตั้งชื่อสาธารณะและการคัดเลือก re-export**
  - `searchContent()` แมปไปยัง native export `search`

## การจัดระเบียบพื้นผิว export สาธารณะ

`packages/natives/src/index.ts` คือ public barrel ที่เป็นมาตรฐาน โดยจัดกลุ่ม export ตามโดเมนความสามารถ:

- ค้นหา/ข้อความ: `grep`, `glob`, `text`, `highlight`
- การดำเนินการ/โปรเซส/เทอร์มินัล: `shell`, `pty`, `ps`, `keys`
- ระบบ/สื่อ/การแปลง: `image`, `html`, `clipboard`, `system-info`, `work`

กฎสำหรับผู้ดูแล: หาก wrapper ไม่ได้ถูก re-export จาก `src/index.ts` จะไม่ถือเป็นส่วนหนึ่งของพื้นผิว public package ที่ตั้งใจไว้

## การแมป JS API ↔ native export (ตัวแทน)

ฝั่ง Rust ใช้ชื่อ N-API export (โดยทั่วไปจากการแปลง `#[napi]` snake_case -> camelCase พร้อม alias ที่กำหนดเองเป็นครั้งคราว) ที่ต้องตรงกับ binding key เหล่านี้

| หมวดหมู่ | Public JS API (wrapper) | Native binding key | ชนิดข้อมูลที่คืน | Async? |
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

## ความแตกต่างของสัญญาแบบ Sync และ Async

สัญญาผสม API แบบ sync และ async; wrapper คงรูปแบบการเรียก native แทนที่จะบังคับโมเดลเดียว:

- **Export แบบ async ที่ใช้ Promise** สำหรับ I/O หรืองานที่ใช้เวลานาน (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, clipboard, การดำเนินการกับรูปภาพ)
- **Export แบบ synchronous** สำหรับการแปลง/parser ที่กำหนดได้แน่นอนในหน่วยความจำ (`search`, `hasMatch`, highlighting, ความกว้างข้อความ/slicing, การแยกวิเคราะห์คีย์, การ query โปรเซส)
- **Export แบบ constructor** สำหรับวัตถุ runtime ที่มีสถานะ (`Shell`, `PtySession`, `PhotonImage`)

ข้อพึงระวังสำหรับผู้ดูแล: การเปลี่ยน sync ↔ async ของ export ที่มีอยู่ถือเป็นการเปลี่ยนแปลง API และสัญญาที่ทำให้เกิดความไม่เข้ากัน (breaking change) ข้ามทั้ง wrapper และผู้เรียกใช้

## รูปแบบการกำหนดชนิด Object และ Enum

### รูปแบบ Object (วัตถุ JS แบบ `#[napi(object)]`)

TS จำลองค่า native ที่มีรูปร่างแบบ object เป็น interface ตัวอย่างเช่น:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

สิ่งเหล่านี้เป็นสัญญาเชิงโครงสร้างในเวลาคอมไพล์; ความถูกต้องของรูปร่างใน runtime เป็นความรับผิดชอบของการ implement ฝั่ง native

### รูปแบบ Enum

Numeric native enum ถูกแสดงเป็นค่า `const enum` ใน TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

ผู้เรียกใช้เห็นสมาชิก enum ที่มีชื่อ; ขอบเขต binding ส่งผ่านตัวเลข

## วิธีการตรวจจับความไม่ตรงกัน

การตรวจจับความไม่ตรงกันเกิดขึ้นที่สองชั้น:

1. **การตรวจสอบสัญญา TypeScript ในเวลาคอมไพล์**
   - Wrapper เรียก `native.<name>` เทียบกับ `NativeBindings` ที่รวมแล้ว
   - Binding key ที่ขาดหาย/เปลี่ยนชื่อจะทำให้การตรวจสอบ type ของ TS ใน wrapper ล้มเหลว

2. **การตรวจสอบ runtime ใน `validateNative`**
   - หลังจากโหลด `native.ts` จะตรวจสอบ export ที่จำเป็นและ throw ถ้ามีส่วนใดขาดหาย
   - ข้อความ error รวม key ที่ขาดหายและคำแนะนำการ rebuild

สิ่งนี้ตรวจจับกรณีที่พบบ่อยของ stale-binary drift: wrapper/type มีอยู่แต่ `.node` ที่โหลดขาด export

## พฤติกรรมเมื่อล้มเหลวและข้อควรระวัง

### ความล้มเหลวในการโหลด/ตรวจสอบ (ความล้มเหลวแบบ hard)

- ความล้มเหลวในการโหลด addon หรือแพลตฟอร์มที่ไม่รองรับจะ throw ระหว่างการ init โมดูลใน `native.ts`
- Export ที่จำเป็นขาดหายจะ throw ก่อนที่ wrapper จะสามารถใช้งานได้

ผลกระทบ: package ล้มเหลวเร็วแทนที่จะเลื่อนความล้มเหลวไปยังการเรียกใช้ครั้งแรก

### ความแตกต่างของพฤติกรรมระดับ Wrapper

- Wrapper บางตัวตั้งใจลดความรุนแรงของความล้มเหลว (`copyToClipboard` เป็น best effort และกลืนความล้มเหลวของ native)
- Streaming callback ละเว้น payload error ของ callback และส่งต่อเฉพาะเหตุการณ์ค่าที่สำเร็จ

### ข้อควรระวังระดับ Type (runtime เข้มงวดกว่า TS)

- ฟิลด์ optional ใน TS ไม่รับประกันความถูกต้องเชิงความหมาย; ชั้น native ยังสามารถปฏิเสธค่าที่มีรูปแบบไม่ถูกต้อง
- การกำหนดชนิด `const enum` ไม่ได้ป้องกันค่าตัวเลขนอกช่วงจากผู้เรียกใช้ที่ไม่มี type ใน runtime
- `validateNative` ตรวจสอบเฉพาะการมีอยู่/ความเป็นฟังก์ชันของ export ที่จำเป็น ไม่ได้ตรวจสอบความเข้ากันได้ของรูปร่าง argument/return แบบเชิงลึก
- `bindings.ts` รวม `cancelWork(id)` ใน base interface แต่รายการตรวจสอบ runtime ปัจจุบันไม่ได้บังคับ key นั้น

## รายการตรวจสอบสำหรับผู้ดูแลเมื่อเปลี่ยนแปลง binding

เมื่อเพิ่ม/เปลี่ยนแปลง export ให้อัปเดตทั้งหมดนี้:

1. `src/<module>/types.ts` (augmentation + contract types)
2. `src/<module>/index.ts` (พฤติกรรมของ wrapper)
3. `src/native.ts` imports สำหรับ types ของโมดูล (ถ้าเป็นโมดูลใหม่)
4. การตรวจสอบ export ที่จำเป็นของ `validateNative`
5. public re-exports ของ `src/index.ts`

การข้ามขั้นตอนใดก็ตามจะสร้าง drift ในเวลาคอมไพล์หรือความล้มเหลวในเวลาโหลด runtime
