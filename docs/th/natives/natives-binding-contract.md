---
title: Natives Binding Contract (TypeScript Side)
description: >-
  TypeScript-side binding contract for calling into Rust native functions via
  N-API.
sidebar:
  order: 2
  label: Binding contract
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# สัญญาการผูก Natives (ฝั่ง TypeScript)

เอกสารนี้กำหนดสัญญาฝั่ง TypeScript ที่อยู่ระหว่างผู้เรียกใช้ `@f5xc-salesdemos/pi-natives` กับ N-API addon ที่ถูกโหลด

เอกสารนี้มุ่งเน้นไปที่สามส่วน:

1. รูปแบบสัญญา (`NativeBindings` + module augmentation),
2. พฤติกรรม wrapper (`src/<module>/index.ts`),
3. พื้นผิวการ export สาธารณะ (`src/index.ts`).

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

`packages/natives/src/bindings.ts` กำหนดสัญญาพื้นฐาน:

- `NativeBindings` (interface พื้นฐาน ปัจจุบันรวมถึง `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` รูปแบบ callback ที่ใช้โดย N-API threadsafe callbacks

แต่ละโมดูลเพิ่มฟิลด์ของตัวเองโดย declaration merging:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

วิธีนี้ทำให้มี binding interface รวมเพียงตัวเดียวโดยไม่ต้องมีไฟล์ type ส่วนกลางขนาดใหญ่

## วงจรชีวิตของ declaration-merging และการเปลี่ยนสถานะ

### 1) การประกอบ type ในเวลา compile

- `bindings.ts` ให้สัญลักษณ์ `NativeBindings` พื้นฐาน
- ทุกไฟล์ `src/<module>/types.ts` ขยาย `NativeBindings`
- `src/native.ts` import ไฟล์ `./<module>/types` ทั้งหมดเพื่อ side effects เพื่อให้สัญญาที่ถูก merge อยู่ใน scope ที่ `NativeBindings` ถูกใช้งาน

การเปลี่ยนสถานะ: **สัญญาพื้นฐาน** → **สัญญาที่ถูก merge**

### 2) การโหลด addon ในเวลา runtime และ validation gate

- `src/native.ts` โหลดไบนารี `.node` ที่เป็นตัวเลือก
- ออบเจ็กต์ที่โหลดถูกถือว่าเป็น `NativeBindings` และส่งผ่าน `validateNative(...)` ทันที
- `validateNative` ตรวจสอบ export keys ที่จำเป็นโดยใช้ `typeof bindings[name] === "function"`

การเปลี่ยนสถานะ: **ออบเจ็กต์ addon ที่ยังไม่น่าเชื่อถือ** → **ออบเจ็กต์ native binding ที่ผ่านการตรวจสอบแล้ว** (หรือล้มเหลวอย่างหนัก)

### 3) การเรียกใช้ wrapper

- Wrapper ของโมดูลใน `src/<module>/index.ts` เรียก `native.<export>`
- Wrapper ปรับค่าเริ่มต้นและรูปแบบ callback (`(err, value)` เป็นรูปแบบ callback ที่รับเฉพาะ value ใน JS APIs)
- `src/index.ts` re-export wrapper/types ของโมดูลเป็น API สาธารณะของแพ็กเกจ

การเปลี่ยนสถานะ: **Raw bindings ที่ผ่านการตรวจสอบ** → **API สาธารณะที่ใช้งานง่าย**

## ความรับผิดชอบของ wrapper

Wrapper ถูกออกแบบให้บางอย่างตั้งใจ; ไม่ได้ implement ตรรกะ native ซ้ำ

ความรับผิดชอบหลัก:

- **การ normalize/ตั้งค่าเริ่มต้นของ argument**
  - `glob()` แปลง `options.path` เป็น absolute path และตั้งค่าเริ่มต้นสำหรับ `hidden`, `gitignore`, `recursive`
  - `hasMatch()` เติม flags เริ่มต้น (`ignoreCase`, `multiline`) ก่อนเรียก native
- **การปรับ callback**
  - `grep()`, `glob()`, `executeShell()` แปลง `TsFunc<T>` (`error, value`) เป็น callback ของผู้ใช้ที่รับเฉพาะค่าที่สำเร็จ
- **พฤติกรรมสภาพแวดล้อมหรือนโยบายรอบการเรียก native**
  - Wrapper ของ clipboard เพิ่มการจัดการ OSC52/Termux/headless และถือว่าการ copy เป็น best effort
- **การตั้งชื่อสาธารณะและการจัดการ re-export**
  - `searchContent()` แมปกับ native export `search`

## การจัดระเบียบพื้นผิวการ export สาธารณะ

`packages/natives/src/index.ts` คือ barrel สาธารณะที่เป็นมาตรฐาน จัดกลุ่ม export ตามโดเมนความสามารถ:

- ค้นหา/ข้อความ: `grep`, `glob`, `text`, `highlight`
- การทำงาน/กระบวนการ/เทอร์มินัล: `shell`, `pty`, `ps`, `keys`
- ระบบ/สื่อ/การแปลง: `image`, `html`, `clipboard`, `system-info`, `work`

กฎสำหรับผู้ดูแล: หาก wrapper ไม่ได้ถูก re-export จาก `src/index.ts` จะไม่ถือเป็นส่วนหนึ่งของพื้นผิวแพ็กเกจสาธารณะที่ตั้งใจไว้

## การแมป JS API ↔ native export (ตัวแทน)

ฝั่ง Rust ใช้ชื่อ N-API export (โดยทั่วไปจากการแปลง `#[napi]` snake_case -> camelCase พร้อม alias ที่ระบุเป็นครั้งคราว) ที่ต้องตรงกับ binding keys เหล่านี้

| หมวดหมู่ | JS API สาธารณะ (wrapper) | Native binding key | ประเภทค่าส่งคืน | Async? |
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

## ความแตกต่างของสัญญา Sync กับ async

สัญญามีทั้ง sync และ async APIs ผสมกัน; wrapper รักษารูปแบบการเรียก native แทนที่จะบังคับใช้โมเดลเดียว:

- **Export async แบบ Promise** สำหรับ I/O หรืองานที่ใช้เวลานาน (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, clipboard, การดำเนินการกับรูปภาพ)
- **Export แบบ synchronous** สำหรับการแปลง/parser ที่กำหนดผลลัพธ์แน่นอนในหน่วยความจำ (`search`, `hasMatch`, highlighting, text width/slicing, key parsing, process queries)
- **Export แบบ constructor** สำหรับออบเจ็กต์ runtime ที่มี state (`Shell`, `PtySession`, `PhotonImage`)

นัยสำหรับผู้ดูแล: การเปลี่ยน sync ↔ async สำหรับ export ที่มีอยู่เป็นการเปลี่ยนแปลง API และสัญญาที่ทำให้เกิด breaking change ข้ามทั้ง wrapper และผู้เรียกใช้

## รูปแบบการกำหนด type ของออบเจ็กต์และ enum

### รูปแบบออบเจ็กต์ (JS objects แบบ `#[napi(object)]`)

TS จำลองค่า native ที่มีรูปแบบออบเจ็กต์เป็น interface เช่น:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

สิ่งเหล่านี้เป็นสัญญาเชิงโครงสร้างในเวลา compile; ความถูกต้องของรูปแบบในเวลา runtime เป็นความรับผิดชอบของ native implementation

### รูปแบบ enum

Numeric native enums ถูกแสดงเป็นค่า `const enum` ใน TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

ผู้เรียกใช้เห็น enum members ที่มีชื่อ; ขอบเขตของ binding ส่งผ่านตัวเลข

## การตรวจจับความไม่ตรงกัน

การตรวจจับความไม่ตรงกันเกิดขึ้นที่สองชั้น:

1. **การตรวจสอบสัญญา TypeScript ในเวลา compile**
   - Wrapper เรียก `native.<name>` กับ `NativeBindings` ที่ถูก merge แล้ว
   - Binding keys ที่ขาดหายหรือเปลี่ยนชื่อทำให้ TS type-checking ใน wrapper ล้มเหลว

2. **การตรวจสอบในเวลา runtime ใน `validateNative`**
   - หลังจากโหลด `native.ts` ตรวจสอบ exports ที่จำเป็นและ throw หากขาดหายไป
   - ข้อความ error รวมถึง keys ที่ขาดหายและคำแนะนำในการ rebuild

วิธีนี้ตรวจจับปัญหาที่พบบ่อยของ stale-binary drift: wrapper/type มีอยู่แต่ `.node` ที่โหลดไม่มี export นั้น

## พฤติกรรมเมื่อล้มเหลวและข้อควรระวัง

### ความล้มเหลวในการโหลด/ตรวจสอบ (ความล้มเหลวแบบหนัก)

- ความล้มเหลวในการโหลด addon หรือแพลตฟอร์มที่ไม่รองรับ throw ระหว่างการ init โมดูลใน `native.ts`
- Export ที่จำเป็นแต่ขาดหายจะ throw ก่อนที่ wrapper จะใช้งานได้

ผลกระทบ: แพ็กเกจล้มเหลวทันทีแทนที่จะเลื่อนความล้มเหลวไปจนถึงการเรียกใช้ครั้งแรก

### ความแตกต่างของพฤติกรรมระดับ wrapper

- Wrapper บางตัวตั้งใจลดความรุนแรงของความล้มเหลว (`copyToClipboard` เป็น best effort และกลืนความล้มเหลวของ native)
- Streaming callbacks ละเว้น error payload ของ callback และส่งต่อเฉพาะ event ที่มีค่าสำเร็จ

### ข้อควรระวังระดับ type (runtime เข้มงวดกว่า TS)

- ฟิลด์ optional ของ TS ไม่รับประกันความถูกต้องเชิงความหมาย; ชั้น native ยังสามารถปฏิเสธค่าที่มีรูปแบบไม่ถูกต้อง
- การกำหนด type เป็น `const enum` ไม่ได้ป้องกันค่าตัวเลขที่อยู่นอกช่วงจากผู้เรียกใช้ที่ไม่มี type ในเวลา runtime
- `validateNative` ตรวจสอบเฉพาะการมีอยู่/ความเป็น function ของ exports ที่จำเป็น ไม่ใช่ความเข้ากันได้ของ argument/return-shape อย่างลึก
- `bindings.ts` รวม `cancelWork(id)` ใน base interface แต่รายการตรวจสอบ runtime ปัจจุบันไม่ได้บังคับ key นั้น

## รายการตรวจสอบสำหรับผู้ดูแลเมื่อเปลี่ยนแปลง binding

เมื่อเพิ่ม/เปลี่ยนแปลง export ให้อัปเดตทั้งหมดต่อไปนี้:

1. `src/<module>/types.ts` (augmentation + contract types)
2. `src/<module>/index.ts` (พฤติกรรม wrapper)
3. `src/native.ts` imports สำหรับ module types (หากเป็นโมดูลใหม่)
4. การตรวจสอบ export ที่จำเป็นใน `validateNative`
5. public re-exports ใน `src/index.ts`

การข้ามขั้นตอนใดขั้นตอนหนึ่งจะทำให้เกิด drift ในเวลา compile หรือความล้มเหลวในเวลา runtime เมื่อโหลด
