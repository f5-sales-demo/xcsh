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

# Natives Binding Contract (ฝั่ง TypeScript)

เอกสารนี้กำหนดสัญญา (contract) ฝั่ง TypeScript ที่อยู่ระหว่างผู้เรียกใช้ `@f5xc-salesdemos/pi-natives` กับ N-API addon ที่ถูกโหลด

เอกสารนี้เน้นสามส่วน:

1. รูปแบบสัญญา (`NativeBindings` + module augmentation),
2. พฤติกรรมของ wrapper (`src/<module>/index.ts`),
3. พื้นผิวการ export สาธารณะ (`src/index.ts`)

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

แต่ละโมดูลเพิ่มฟิลด์ของตนเองผ่าน declaration merging:

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

### 1) การประกอบ type ณ เวลา compile

- `bindings.ts` ให้สัญลักษณ์ `NativeBindings` ฐาน
- ทุกไฟล์ `src/<module>/types.ts` ขยาย `NativeBindings`
- `src/native.ts` import ไฟล์ `./<module>/types` ทั้งหมดเพื่อ side effects เพื่อให้สัญญาที่รวมแล้วอยู่ใน scope ที่ `NativeBindings` ถูกใช้งาน

การเปลี่ยนสถานะ: **สัญญาฐาน** → **สัญญาที่รวมแล้ว**

### 2) การโหลด addon ณ runtime และขั้นตอนการตรวจสอบ

- `src/native.ts` โหลดไฟล์ไบนารี `.node` ที่เป็นผู้สมัคร
- อ็อบเจกต์ที่โหลดถูกปฏิบัติเป็น `NativeBindings` และส่งผ่าน `validateNative(...)` ทันที
- `validateNative` ตรวจสอบ export key ที่จำเป็นโดยใช้ `typeof bindings[name] === "function"`

การเปลี่ยนสถานะ: **อ็อบเจกต์ addon ที่ยังไม่น่าเชื่อถือ** → **อ็อบเจกต์ native binding ที่ผ่านการตรวจสอบแล้ว** (หรือล้มเหลวทันที)

### 3) การเรียกใช้ wrapper

- Wrapper ของโมดูลใน `src/<module>/index.ts` เรียก `native.<export>`
- Wrapper ปรับค่าเริ่มต้นและรูปแบบ callback (จาก `(err, value)` เป็นรูปแบบ callback ที่รับเฉพาะค่าใน JS APIs)
- `src/index.ts` re-export wrapper/types ของโมดูลเป็น API สาธารณะของแพ็กเกจ

การเปลี่ยนสถานะ: **Raw bindings ที่ผ่านการตรวจสอบแล้ว** → **API สาธารณะที่ใช้งานง่าย**

## ความรับผิดชอบของ wrapper

Wrapper ถูกออกแบบให้บางโดยตั้งใจ ไม่ได้ implement ตรรกะของ native ซ้ำ

ความรับผิดชอบหลัก:

- **การปรับค่าและกำหนดค่าเริ่มต้นของ argument**
  - `glob()` แปลง `options.path` เป็น absolute path และกำหนดค่าเริ่มต้นให้ `hidden`, `gitignore`, `recursive`
  - `hasMatch()` เติม flag เริ่มต้น (`ignoreCase`, `multiline`) ก่อนเรียก native
- **การปรับ callback**
  - `grep()`, `glob()`, `executeShell()` แปลง `TsFunc<T>` (`error, value`) เป็น user callback ที่รับเฉพาะค่าที่สำเร็จ
- **พฤติกรรมด้านสภาพแวดล้อมหรือนโยบายรอบการเรียก native**
  - Clipboard wrapper เพิ่มการจัดการ OSC52/Termux/headless และปฏิบัติต่อ copy ในลักษณะ best effort
- **การตั้งชื่อสาธารณะและการคัดสรร re-export**
  - `searchContent()` แมปไปยัง native export `search`

## การจัดระเบียบพื้นผิว export สาธารณะ

`packages/natives/src/index.ts` เป็น barrel สาธารณะหลัก โดยจัดกลุ่ม export ตามโดเมนความสามารถ:

- ค้นหา/ข้อความ: `grep`, `glob`, `text`, `highlight`
- การรันคำสั่ง/โปรเซส/เทอร์มินัล: `shell`, `pty`, `ps`, `keys`
- ระบบ/มีเดีย/การแปลง: `image`, `html`, `clipboard`, `system-info`, `work`

กฎสำหรับผู้ดูแล: หาก wrapper ไม่ได้ถูก re-export จาก `src/index.ts` จะไม่ถือเป็นส่วนหนึ่งของพื้นผิวแพ็กเกจสาธารณะที่ตั้งใจไว้

## การแมประหว่าง JS API ↔ native export (ตัวอย่างตัวแทน)

ฝั่ง Rust ใช้ชื่อ N-API export (โดยทั่วไปจากการแปลง `#[napi]` snake_case -> camelCase พร้อมกับ alias ที่ระบุเป็นครั้งคราว) ที่ต้องตรงกับ binding key เหล่านี้

| หมวดหมู่ | JS API สาธารณะ (wrapper) | Native binding key | ชนิดข้อมูลที่ส่งกลับ | Async? |
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

## ความแตกต่างของสัญญาระหว่าง sync และ async

สัญญานี้ผสมผสาน API แบบ sync และ async; wrapper รักษารูปแบบการเรียก native แทนที่จะบังคับใช้โมเดลเดียว:

- **Export แบบ async ที่ใช้ Promise** สำหรับงาน I/O หรืองานที่ใช้เวลานาน (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, clipboard, การดำเนินการกับรูปภาพ)
- **Export แบบ synchronous** สำหรับการแปลง/parser แบบ deterministic ใน memory (`search`, `hasMatch`, highlighting, text width/slicing, key parsing, process queries)
- **Export แบบ constructor** สำหรับอ็อบเจกต์ runtime ที่มี state (`Shell`, `PtySession`, `PhotonImage`)

ข้อสำคัญสำหรับผู้ดูแล: การเปลี่ยน sync ↔ async สำหรับ export ที่มีอยู่ถือเป็นการเปลี่ยนแปลง API และสัญญาที่ไม่เข้ากันกับเวอร์ชันก่อนหน้า (breaking change) ทั้งใน wrapper และผู้เรียกใช้

## รูปแบบการกำหนดชนิด object และ enum

### รูปแบบ Object (JS objects แบบ `#[napi(object)]`)

TS กำหนดโมเดลค่า native ที่มีรูปร่างแบบ object เป็น interface เช่น:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

สิ่งเหล่านี้เป็นสัญญาเชิงโครงสร้างณเวลา compile; ความถูกต้องของรูปร่างณ runtime เป็นหน้าที่ของ native implementation

### รูปแบบ Enum

Numeric native enum ถูกแสดงเป็นค่า `const enum` ใน TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

ผู้เรียกใช้เห็น enum member ที่มีชื่อ; ขอบเขตของ binding ส่งผ่านตัวเลข

## วิธีตรวจจับความไม่ตรงกัน

การตรวจจับความไม่ตรงกันเกิดขึ้นที่สองชั้น:

1. **การตรวจสอบสัญญา TypeScript ณ เวลา compile**
   - Wrapper เรียก `native.<name>` เทียบกับ `NativeBindings` ที่รวมแล้ว
   - Binding key ที่หายไป/เปลี่ยนชื่อจะทำให้ TS type-checking ใน wrapper ล้มเหลว

2. **การตรวจสอบ runtime ใน `validateNative`**
   - หลังจากโหลด `native.ts` จะตรวจสอบ export ที่จำเป็นและ throw หากมีที่หายไป
   - ข้อความ error รวมถึง key ที่หายไปและคำแนะนำในการ rebuild

วิธีนี้จับปัญหา stale-binary drift ที่พบบ่อย: wrapper/type มีอยู่แต่ไฟล์ `.node` ที่โหลดไม่มี export นั้น

## พฤติกรรมเมื่อล้มเหลวและข้อควรระวัง

### ความล้มเหลวในการโหลด/ตรวจสอบ (ล้มเหลวทันที)

- ความล้มเหลวในการโหลด addon หรือแพลตฟอร์มที่ไม่รองรับจะ throw ระหว่างการ init โมดูลใน `native.ts`
- Export ที่จำเป็นที่หายไปจะ throw ก่อนที่ wrapper จะใช้งานได้

ผลลัพธ์: แพ็กเกจล้มเหลวทันทีแทนที่จะเลื่อนความล้มเหลวไปจนถึงการเรียกใช้ครั้งแรก

### ความแตกต่างของพฤติกรรมในระดับ wrapper

- Wrapper บางตัวตั้งใจบรรเทาความล้มเหลว (`copyToClipboard` เป็น best effort และกลืนความล้มเหลวของ native)
- Streaming callback ละเว้น payload error ของ callback และส่งต่อเฉพาะ event ที่สำเร็จ

### ข้อควรระวังในระดับ type (runtime เข้มงวดกว่า TS)

- ฟิลด์ optional ใน TS ไม่ได้รับประกันความถูกต้องเชิงความหมาย; ชั้น native ยังสามารถปฏิเสธค่าที่มีรูปร่างไม่ถูกต้อง
- การกำหนดชนิดด้วย `const enum` ไม่ได้ป้องกันค่าตัวเลขที่อยู่นอกช่วงจากผู้เรียกที่ไม่ได้กำหนดชนิดณ runtime
- `validateNative` ตรวจสอบเฉพาะการมีอยู่/ความเป็นฟังก์ชันของ export ที่จำเป็น ไม่ได้ตรวจสอบความเข้ากันได้ของรูปร่าง argument/return อย่างลึก
- `bindings.ts` รวม `cancelWork(id)` ใน base interface แต่รายการตรวจสอบ runtime ปัจจุบันไม่ได้บังคับ key นั้น

## รายการตรวจสอบสำหรับผู้ดูแลเมื่อเปลี่ยน binding

เมื่อเพิ่ม/เปลี่ยน export ให้อัปเดตทั้งหมดนี้:

1. `src/<module>/types.ts` (augmentation + contract types)
2. `src/<module>/index.ts` (พฤติกรรมของ wrapper)
3. `src/native.ts` imports สำหรับ types ของโมดูล (หากเป็นโมดูลใหม่)
4. การตรวจสอบ export ที่จำเป็นใน `validateNative`
5. `src/index.ts` public re-exports

การข้ามขั้นตอนใดก็ตามจะสร้าง drift ณ เวลา compile หรือความล้มเหลวณเวลาโหลดใน runtime
