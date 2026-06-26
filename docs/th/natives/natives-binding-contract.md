---
title: สัญญาการผูก Natives (ฝั่ง TypeScript)
description: >-
  สัญญาการผูกฝั่ง TypeScript สำหรับการเรียกใช้ฟังก์ชัน native ของ Rust ผ่าน
  N-API
sidebar:
  order: 2
  label: สัญญาการผูก
i18n:
  sourceHash: 36dc5fed1f0a
  translator: machine
---

# สัญญาการผูก Natives (ฝั่ง TypeScript)

เอกสารนี้กำหนดสัญญาฝั่ง TypeScript ที่อยู่ระหว่างผู้เรียกใช้ `@f5-sales-demo/pi-natives` และ N-API addon ที่โหลดไว้

เอกสารนี้มุ่งเน้นที่สามส่วน:

1. รูปแบบสัญญา (`NativeBindings` + module augmentation),
2. พฤติกรรมของ wrapper (`src/<module>/index.ts`),
3. พื้นผิวการส่งออกสาธารณะ (`src/index.ts`)

## ไฟล์ที่นำมาใช้งาน

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

- `NativeBindings` (อินเทอร์เฟซพื้นฐาน ปัจจุบันรวมถึง `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- รูปแบบ callback `TsFunc<T>` ที่ใช้โดย N-API threadsafe callbacks

แต่ละโมดูลเพิ่มฟิลด์ของตนเองผ่าน declaration merging:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

วิธีนี้รักษาอินเทอร์เฟซการผูกรวมเดียวไว้โดยไม่ต้องมีไฟล์ประเภทกลางที่ใหญ่โต

## วงจรชีวิต declaration-merging และการเปลี่ยนสถานะ

### 1) การประกอบประเภทในเวลาคอมไพล์

- `bindings.ts` ให้สัญลักษณ์ `NativeBindings` พื้นฐาน
- ทุก `src/<module>/types.ts` เพิ่มส่วนขยายให้กับ `NativeBindings`
- `src/native.ts` นำเข้าไฟล์ `./<module>/types` ทั้งหมดเพื่อผลข้างเคียง เพื่อให้สัญญาที่ผสานแล้วอยู่ในขอบเขตที่ใช้ `NativeBindings`

การเปลี่ยนสถานะ: **สัญญาพื้นฐาน** → **สัญญาที่ผสานแล้ว**

### 2) การโหลด addon ขณะ runtime และเกตการตรวจสอบ

- `src/native.ts` โหลดไบนารี `.node` ที่เป็นตัวเลือก
- อ็อบเจกต์ที่โหลดถูกจัดการเป็น `NativeBindings` และส่งผ่าน `validateNative(...)` ทันที
- `validateNative` ตรวจสอบคีย์การส่งออกที่จำเป็นด้วย `typeof bindings[name] === "function"`

การเปลี่ยนสถานะ: **อ็อบเจกต์ addon ที่ยังไม่ผ่านการตรวจสอบ** → **อ็อบเจกต์การผูก native ที่ผ่านการตรวจสอบแล้ว** (หรือเกิดความล้มเหลวอย่างสมบูรณ์)

### 3) การเรียกใช้ wrapper

- Module wrapper ใน `src/<module>/index.ts` เรียกใช้ `native.<export>`
- Wrapper ปรับค่าเริ่มต้นและรูปแบบ callback (รูปแบบ `(err, value)` เป็นรูปแบบ callback ที่รับเฉพาะค่าใน JS APIs)
- `src/index.ts` ส่งออกซ้ำ module wrapper/types เป็น API แพ็กเกจสาธารณะ

การเปลี่ยนสถานะ: **การผูก raw ที่ผ่านการตรวจสอบแล้ว** → **API สาธารณะที่ใช้งานสะดวก**

## ความรับผิดชอบของ wrapper

Wrapper ถูกออกแบบให้บางโดยตั้งใจ; ไม่นำตรรกะ native มาใช้ซ้ำ

ความรับผิดชอบหลัก:

- **การปรับมาตรฐาน/กำหนดค่าเริ่มต้นของอาร์กิวเมนต์**
  - `glob()` แปลง `options.path` เป็น absolute path และกำหนดค่าเริ่มต้นให้ `hidden`, `gitignore`, `recursive`
  - `hasMatch()` เติมค่าเริ่มต้นของ flags (`ignoreCase`, `multiline`) ก่อนเรียกใช้ native
- **การปรับ callback**
  - `grep()`, `glob()`, `executeShell()` แปลง `TsFunc<T>` (`error, value`) เป็น user callback ที่รับเฉพาะค่าที่สำเร็จ
- **พฤติกรรมของสภาพแวดล้อมหรือนโยบายรอบการเรียกใช้ native**
  - Clipboard wrapper เพิ่มการจัดการ OSC52/Termux/headless และจัดการการคัดลอกเป็นแบบ best effort
- **การตั้งชื่อสาธารณะและการจัดการการส่งออกซ้ำ**
  - `searchContent()` แมปไปยังการส่งออก native `search`

## การจัดระเบียบพื้นผิวการส่งออกสาธารณะ

`packages/natives/src/index.ts` เป็น public barrel ที่เป็นมาตรฐาน โดยจัดกลุ่มการส่งออกตามโดเมนความสามารถ:

- ค้นหา/ข้อความ: `grep`, `glob`, `text`, `highlight`
- การดำเนินการ/กระบวนการ/เทอร์มินัล: `shell`, `pty`, `ps`, `keys`
- ระบบ/สื่อ/การแปลง: `image`, `html`, `clipboard`, `system-info`, `work`

กฎของผู้ดูแล: หาก wrapper ไม่ถูกส่งออกซ้ำจาก `src/index.ts` ก็ไม่ถือเป็นส่วนหนึ่งของพื้นผิวแพ็กเกจสาธารณะที่ตั้งใจไว้

## การแมป JS API ↔ native export (ตัวอย่างที่เป็นตัวแทน)

ฝั่ง Rust ใช้ชื่อการส่งออก N-API (โดยทั่วไปจากการแปลง `#[napi]` snake_case -> camelCase พร้อม alias ที่กำหนดเองในบางครั้ง) ที่ต้องตรงกับคีย์การผูกเหล่านี้

| หมวดหมู่ | JS API สาธารณะ (wrapper) | คีย์การผูก native | ประเภทที่คืนค่า | Async? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | ใช่ |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | ไม่ |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | ไม่ |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | ใช่ |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | ใช่ |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | ไม่ |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | ใช่ |
| Shell | `Shell` | `Shell` | class constructor | ไม่มี |
| PTY | `PtySession` | `PtySession` | class constructor | ไม่มี |
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

สัญญาผสม API แบบ sync และ async; wrapper รักษารูปแบบการเรียกใช้ native แทนที่จะบังคับใช้รูปแบบเดียว:

- **การส่งออกแบบ Promise-based async** สำหรับ I/O หรืองานที่ทำงานนาน (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, clipboard, การดำเนินการรูปภาพ)
- **การส่งออกแบบ Synchronous** สำหรับการแปลงในหน่วยความจำแบบ deterministic/parsers (`search`, `hasMatch`, highlighting, ความกว้าง/การตัดข้อความ, การแยกวิเคราะห์คีย์, การสืบค้นกระบวนการ)
- **การส่งออกแบบ Constructor** สำหรับอ็อบเจกต์ runtime ที่มีสถานะ (`Shell`, `PtySession`, `PhotonImage`)

ผลกระทบต่อผู้ดูแล: การเปลี่ยนแปลง sync ↔ async สำหรับการส่งออกที่มีอยู่ถือเป็นการเปลี่ยนแปลง API และสัญญาที่ทำลายความเข้ากันได้กับ wrapper และผู้เรียกใช้

## รูปแบบการกำหนดประเภทของ Object และ enum

### รูปแบบ Object (`#[napi(object)]`-style JS objects)

TS สร้างแบบจำลองค่า native ที่มีรูปร่างเป็น object เป็น interface ตัวอย่างเช่น:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

สิ่งเหล่านี้เป็นสัญญาเชิงโครงสร้างในเวลาคอมไพล์; ความถูกต้องของรูปร่างในขณะ runtime เป็นของ native implementation

### รูปแบบ Enum

Native enum แบบตัวเลขถูกแสดงเป็นค่า `const enum` ใน TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

ผู้เรียกใช้เห็นสมาชิก enum ที่ตั้งชื่อแล้ว; ขอบเขตการผูกส่งผ่านตัวเลข

## วิธีการตรวจจับความไม่ตรงกัน

การตรวจจับความไม่ตรงกันเกิดขึ้นในสองชั้น:

1. **การตรวจสอบสัญญา TypeScript ในเวลาคอมไพล์**
   - Wrapper เรียกใช้ `native.<name>` กับ `NativeBindings` ที่ผสานแล้ว
   - คีย์การผูกที่หายไป/เปลี่ยนชื่อทำให้ TypeScript type-checking ใน wrapper ล้มเหลว

2. **การตรวจสอบขณะ runtime ใน `validateNative`**
   - หลังจากโหลด `native.ts` จะตรวจสอบการส่งออกที่จำเป็นและโยน error หากมีส่วนที่ขาดหายไป
   - ข้อความ error รวมถึงคีย์ที่หายไปและคำแนะนำในการ rebuild

วิธีนี้ตรวจจับปัญหา stale-binary drift ที่พบบ่อย: wrapper/type มีอยู่แต่ `.node` ที่โหลดขาดการส่งออก

## พฤติกรรมความล้มเหลวและข้อควรระวัง

### ความล้มเหลวในการโหลด/ตรวจสอบ (ความล้มเหลวอย่างสมบูรณ์)

- ความล้มเหลวในการโหลด addon หรือแพลตฟอร์มที่ไม่รองรับจะโยน error ระหว่างการเริ่มต้น module ใน `native.ts`
- การส่งออกที่จำเป็นที่หายไปจะโยน error ก่อนที่ wrapper จะสามารถใช้งานได้

ผล: แพ็กเกจล้มเหลวอย่างรวดเร็วแทนที่จะเลื่อนความล้มเหลวไปยังการเรียกใช้ครั้งแรก

### ความแตกต่างพฤติกรรมระดับ wrapper

- บาง wrapper ลดความรุนแรงของความล้มเหลวโดยตั้งใจ (`copyToClipboard` เป็นแบบ best effort และกลืนความล้มเหลวของ native)
- Streaming callback ละเว้น error payload ของ callback และส่งต่อเฉพาะ event ค่าที่สำเร็จ

### ข้อควรระวังระดับ type (runtime เข้มงวดกว่า TS)

- ฟิลด์ optional ของ TS ไม่รับประกันความถูกต้องทางความหมาย; ชั้น native ยังคงสามารถปฏิเสธค่าที่ไม่ถูกต้องได้
- การกำหนดประเภท `const enum` ไม่ป้องกันค่าตัวเลขที่อยู่นอกช่วงจากผู้เรียกใช้ที่ไม่มีประเภทในขณะ runtime
- `validateNative` ตรวจสอบเฉพาะการมีอยู่/ความเป็น function ของการส่งออกที่จำเป็น ไม่ใช่ความเข้ากันได้เชิงลึกของอาร์กิวเมนต์/รูปร่างที่คืนค่า
- `bindings.ts` รวมถึง `cancelWork(id)` ในอินเทอร์เฟซพื้นฐาน แต่รายการตรวจสอบความถูกต้อง runtime ปัจจุบันไม่บังคับใช้คีย์นั้น

## รายการตรวจสอบของผู้ดูแลสำหรับการเปลี่ยนแปลงการผูก

เมื่อเพิ่ม/เปลี่ยนแปลงการส่งออก ให้อัปเดตทั้งหมดของ:

1. `src/<module>/types.ts` (augmentation + contract types)
2. `src/<module>/index.ts` (พฤติกรรม wrapper)
3. การนำเข้า `src/native.ts` สำหรับ module types (หากเป็น module ใหม่)
4. การตรวจสอบการส่งออกที่จำเป็นของ `validateNative`
5. การส่งออกซ้ำสาธารณะของ `src/index.ts`

การข้ามขั้นตอนใดก็ตามจะสร้างการเบี่ยงเบนในเวลาคอมไพล์หรือความล้มเหลวในเวลาโหลด runtime
