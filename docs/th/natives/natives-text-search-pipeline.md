---
title: ไปป์ไลน์การค้นหาและข้อความแบบ Native
description: >-
  ไปม์ไลน์การค้นหาข้อความแบบ native พร้อมการจัดทำดัชนีเนื้อหาไฟล์ที่ใช้ grep,
  glob และ ripgrep
sidebar:
  order: 6
  label: ไปป์ไลน์ข้อความและการค้นหา
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# ไปป์ไลน์การค้นหา/ข้อความแบบ Native

เอกสารนี้แสดงการแมปพื้นผิวการค้นหา/ข้อความ (`grep`, `glob`, `text`, `highlight`) ของ `@f5xc-salesdemos/pi-natives` ตั้งแต่ TypeScript wrapper ไปจนถึง Rust N-API export และกลับมาเป็น JS result object

คำศัพท์เป็นไปตาม `docs/natives-architecture.md`:

- **Wrapper**: TS API ใน `packages/natives/src/*`
- **Rust module layer**: N-API export ใน `crates/pi-natives/src/*`
- **Shared scan cache**: แคช directory-entry ที่ได้รับการสนับสนุนจาก `fs_cache` ซึ่งใช้โดย flow การค้นพบ/การค้นหา

## ไฟล์การ implement

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## การแมป JS API ↔ Rust export

| JS wrapper API | Rust export (`#[napi]`, snake_case -> camelCase) | Rust module |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## ภาพรวมไปป์ไลน์แยกตามระบบย่อย

## 1) การค้นหาด้วย Regex (`grep`, `searchContent`, `hasMatch`)

### flow ของ input/options

1. TS wrapper ส่งต่อ options ไปยัง native:
   - `grep/index.ts` ส่ง `options` แบบแทบไม่เปลี่ยนแปลง และห่อ callback จาก `(match) => void` เป็นรูปแบบ napi threadsafe callback `(err, match)`
   - `searchContent` และ `hasMatch` ส่ง string/`Uint8Array` โดยตรง
2. Rust option struct ใน `grep.rs` ทำ deserialize ฟิลด์แบบ camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`)
3. `grep` สร้าง `CancelToken` จาก `timeoutMs` + `AbortSignal` และรันภายใน `task::blocking("grep", ...)`

### สาขาการทำงาน

- **สาขาในหน่วยความจำ (pure utility)**
  - `search` → `search_sync` → `run_search` บนไบต์เนื้อหาที่ให้มา
  - ไม่มีการสแกนระบบไฟล์ ไม่มี `fs_cache`
- **สาขาไฟล์เดียว (ขึ้นกับระบบไฟล์)**
  - `grep_sync` แก้ไข path ตรวจสอบ metadata ว่าเป็นไฟล์ สตรีมสูงสุด `MAX_FILE_BYTES` ต่อไฟล์ (`4 MiB`) ผ่าน ripgrep matcher
- **สาขาไดเรกทอรี (ขึ้นกับระบบไฟล์)**
  - ค้นหาแคชเพิ่มเติมผ่าน `fs_cache::get_or_scan` เมื่อ `cache: true`
  - สแกนใหม่ผ่าน `fs_cache::force_rescan` เมื่อ `cache: false`
  - ตรวจสอบผลลัพธ์ว่างอีกครั้งเพิ่มเติมเมื่ออายุแคชเกิน `empty_recheck_ms()`
  - การกรองรายการ: เฉพาะไฟล์ + ตัวกรอง glob เพิ่มเติม (`glob_util`) + ตัวกรองประเภทไฟล์เพิ่มเติม (`js`, `ts`, `rust` เป็นต้น)

### ความหมายของการค้นหา/รวบรวม

- เอ็นจิน regex: `grep_regex::RegexMatcherBuilder` พร้อม `ignoreCase` และ `multiline`
- การแก้ไข context:
  - `contextBefore/contextAfter` แทนที่ `context` แบบเดิม
  - โหมดที่ไม่ใช่ content จะทำให้การรวบรวม context เป็นศูนย์
- โหมดผลลัพธ์:
  - `content` => หนึ่ง `GrepMatch` ต่อการจับคู่หนึ่งครั้ง
  - `count` และ `filesWithMatches` ทั้งคู่แมปเป็นรายการแบบ count (`lineNumber=0`, `line=""`, `matchCount` ถูกตั้งค่า)
- ขีดจำกัด:
  - `offset` ระดับ global และ `maxCount` ถูกนำไปใช้ข้ามไฟล์
  - เส้นทางแบบขนานจะใช้เฉพาะเมื่อไม่ได้ตั้ง `maxCount` และ `offset == 0` มิฉะนั้นจะใช้เส้นทางแบบต่อเนื่องเพื่อรักษาความหมายของ global offset/limit แบบ deterministic

### การจัดรูปผลลัพธ์กลับไปยัง JS

- ฟิลด์ `SearchResult`/`GrepResult` ของ Rust แมปไปยังประเภท TS ผ่านการแปลง N-API object field
- ตัวนับถูกจำกัดที่ `u32` ก่อนข้าม N-API
- boolean ที่เป็น optional จะถูกละเว้นเว้นแต่เป็น true ในบาง path (`limitReached`)
- streaming callback รับ `GrepMatch` ที่จัดรูปแล้วแต่ละรายการ (รายการ content หรือ count)

### พฤติกรรมเมื่อเกิดความล้มเหลว

- `searchContent` คืน `SearchResult.error` สำหรับความล้มเหลวของ regex/การค้นหา แทนที่จะ throw
- `grep` reject เมื่อเกิดข้อผิดพลาดร้ายแรง (path ไม่ถูกต้อง, glob/regex ไม่ถูกต้อง, หมดเวลาจากการยกเลิก/abort)
- `hasMatch` คืน `Result<bool>` และ throw เมื่อ pattern ไม่ถูกต้อง/ข้อผิดพลาดการถอดรหัส UTF-8
- ข้อผิดพลาดในการเปิด/ค้นหาไฟล์ในการสแกนหลายไฟล์จะถูกข้ามต่อไฟล์ การสแกนดำเนินต่อไป

### การจัดการ regex ที่ไม่ถูกรูปแบบ

`grep.rs` ทำความสะอาดวงเล็บปีกกาก่อนการคอมไพล์ regex:

- วงเล็บปีกกาที่เป็นการซ้ำไม่ถูกต้องจะถูก escape (`{`/`}` -> `\{`/`\}`) เมื่อไม่สามารถสร้าง `{N}`, `{N,}`, `{N,M}` ได้
- สิ่งนี้ป้องกันไม่ให้ส่วน literal-template ทั่วไป (เช่น `${platform}`) ล้มเหลวเป็นการซ้ำที่ไม่ถูกรูปแบบ
- ไวยากรณ์ regex ที่ไม่ถูกต้องที่เหลือยังคงคืนข้อผิดพลาด regex

## 2) การค้นพบไฟล์ (`glob`) และการค้นหา path แบบ fuzzy (`fuzzyFind`)

`glob` และ `fuzzyFind` ใช้การสแกน `fs_cache` ร่วมกัน ตรรกะการจับคู่แตกต่างกัน

### flow ของ `glob`

1. TS wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`
   - ค่าเริ่มต้น: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`
2. Rust `glob` สร้าง `GlobConfig` และคอมไพล์ pattern ผ่าน `glob_util::compile_glob`
3. แหล่งรายการ:
   - `cache=true` => `get_or_scan` + `force_rescan` เมื่อข้อมูลเก่าว่างเปล่า (ถ้ามี)
   - `cache=false` => `force_rescan(..., store=false)` (สดเท่านั้น)
4. การกรอง:
   - ข้าม `.git` เสมอ
   - ข้าม `node_modules` เว้นแต่ร้องขอ (`includeNodeModules` หรือ pattern ที่กล่าวถึง node_modules)
   - ใช้การจับคู่ glob
   - ใช้ตัวกรองประเภทไฟล์ ตัวกรอง `file/dir` ของ symlink จะ resolve metadata ของเป้าหมาย
5. เรียงลำดับตาม mtime จากมากไปน้อย (`sortByMtime`) เพิ่มเติมก่อนตัดที่ `maxResults`

### flow ของ `fuzzyFind` (implement ใน `fd.rs`)

1. TS wrapper ถูก export จากโมดูล `grep` แต่การ implement ของ Rust อยู่ใน `fd.rs`
2. แหล่งสแกนร่วมจาก `fs_cache` พร้อมการแบ่ง cache/no-cache เหมือนกันและนโยบายตรวจสอบซ้ำเมื่อข้อมูลเก่าว่าง
3. การให้คะแนน:
   - คะแนน fuzzy แบบ exact / starts-with / contains / subsequence-based
   - เส้นทางการให้คะแนนที่ normalize ตาม separator/punctuation
   - โบนัสไดเรกทอรีและการตัดสินเสมอแบบ deterministic (`score desc` จากนั้น `path asc`)
4. รายการ symlink จะถูกแยกออกจากผลลัพธ์ fuzzy

### พฤติกรรมเมื่อเกิดความล้มเหลว

- glob pattern ไม่ถูกต้อง => ข้อผิดพลาดจาก `glob_util::compile_glob`
- รากการค้นหาต้องเป็นไดเรกทอรีที่มีอยู่ (`resolve_search_path`) มิฉะนั้นจะเกิดข้อผิดพลาด
- การยกเลิก/หมดเวลาแพร่กระจายเป็นข้อผิดพลาด abort ผ่านการตรวจสอบ `CancelToken::heartbeat()` ในลูป

### การจัดการ glob ที่ไม่ถูกรูปแบบ

`glob_util::build_glob_pattern` มีความยืดหยุ่น:

- Normalize `\` เป็น `/`
- เติมคำนำหน้า `**/` อัตโนมัติสำหรับ pattern แบบ recursive ง่ายๆ เมื่อ `recursive=true`
- ปิดกลุ่มสลับ `{...` ที่ไม่สมดุลอัตโนมัติก่อนคอมไพล์

## 3) วงจรชีวิตของ shared scan/cache (`fs_cache`)

`fs_cache` จัดเก็บผลลัพธ์การสแกนเป็นรายการสัมพัทธ์ที่ normalize แล้ว (`path`, `fileType`, `mtime` ที่เป็น optional) โดยมีคีย์เป็น:

- รากการค้นหาแบบ canonical
- `include_hidden`
- `use_gitignore`

### การเปลี่ยนสถานะแคช

1. **พลาด / ปิดใช้งาน**
   - TTL เป็น `0` หรือคีย์ไม่มี/หมดอายุ -> `collect_entries` ใหม่
2. **ตรง**
   - อายุรายการ `< cache_ttl_ms()` -> คืนรายการที่แคชไว้ + `cache_age_ms`
3. **ตรวจสอบซ้ำเมื่อข้อมูลเก่าว่าง** (นโยบายผู้เรียกใน `glob`/`grep`/`fd`)
   - ถ้าคำค้นหาได้ผลลัพธ์ศูนย์รายการและ `cache_age_ms >= empty_recheck_ms()` บังคับสแกนใหม่หนึ่งครั้ง
4. **การทำให้ไม่ถูกต้อง**
   - `invalidateFsScanCache(path?)`:
     - ไม่มีอาร์กิวเมนต์: ล้างคีย์ทั้งหมด
     - อาร์กิวเมนต์ path: ลบคีย์ที่รากเป็นคำนำหน้าของ path เป้าหมาย

### การแลกเปลี่ยนของผลลัพธ์เก่า

- แคชให้ความสำคัญกับการสแกนซ้ำที่มี latency ต่ำมากกว่าความสอดคล้องทันที
- หน้าต่าง TTL อาจคืนผลลัพธ์เก่าทั้งแบบ positive และ negative
- การตรวจสอบซ้ำเมื่อผลลัพธ์ว่างลดผลลัพธ์เก่าแบบ negative สำหรับการสแกนที่แคชไว้เก่ากว่า โดยแลกกับการสแกนเพิ่มเติมหนึ่งครั้ง
- การทำให้ไม่ถูกต้องอย่างชัดเจนเป็นกลไกความถูกต้องที่ตั้งใจไว้หลังจากการเปลี่ยนแปลงไฟล์

## 4) ยูทิลิตี้ข้อความ ANSI (`text`)

เหล่านี้เป็นยูทิลิตี้ในหน่วยความจำล้วน (ไม่มีการสแกนระบบไฟล์)

### ขอบเขตและความรับผิดชอบ

- **`text.rs` เป็นเจ้าของความหมายของ terminal-cell**:
  - การแยกวิเคราะห์ลำดับ ANSI
  - ความกว้างและการตัดแบ่งที่รับรู้ grapheme
  - พฤติกรรม wrap/truncate/sanitize
- **การตัดบรรทัดของ `grep.rs` (`maxColumns`) แยกต่างหาก**:
  - การตัดขอบอักขระแบบง่ายของบรรทัดที่จับคู่ได้พร้อม `...`
  - ไม่รักษาสถานะ ANSI และไม่รับรู้ความกว้าง terminal-cell

### พฤติกรรมหลัก

- `wrapTextWithAnsi`: ห่อตามความกว้างที่มองเห็นได้ ส่งรหัส SGR ที่ active ข้ามบรรทัดที่ห่อ
- `truncateToWidth`: การตัดแบบ visible-cell พร้อมนโยบาย ellipsis (`Unicode`, `Ascii`, `Omit`), การเติมด้านขวาเพิ่มเติม, และ fast-path ที่คืน JS string ดั้งเดิมเมื่อไม่เปลี่ยนแปลง
- `sliceWithWidth`: การตัดแบ่งคอลัมน์พร้อมการบังคับใช้ความกว้างแบบเข้มงวดเพิ่มเติม
- `extractSegments`: ดึงส่วน before/after รอบ overlay พร้อมคืนสถานะ ANSI สำหรับส่วน `after`
- `sanitizeText`: ลบ ANSI escape + อักขระควบคุม ตัด surrogate เดี่ยว normalize CR/LF โดยลบ `\r`
- `visibleWidth`: นับ terminal cell ที่มองเห็นได้ (tab ใช้ `TAB_WIDTH` คงที่จากการ implement ของ Rust)

### พฤติกรรมเมื่อเกิดความล้มเหลว

ฟังก์ชันข้อความโดยทั่วไปคืนผลลัพธ์ที่แปลงแล้วแบบ deterministic ข้อผิดพลาดจำกัดอยู่ที่ขอบเขตการแปลง JS string (ความล้มเหลวในการแปลงอาร์กิวเมนต์ N-API)

## 5) การเน้นสี syntax (`highlight`)

`highlight.rs` เป็นการแปลงล้วน (ไม่มี FS ไม่มี cache)

### Flow

1. Wrapper ส่งต่อ `code`, `lang` ที่เป็น optional, และจานสี ANSI
2. Rust แก้ไข syntax โดย:
   - ค้นหาตาม token/name
   - ค้นหาตาม extension
   - ตาราง alias สำรอง (`ts/tsx/js -> JavaScript` เป็นต้น)
   - สำรองเป็น syntax ข้อความธรรมดาเมื่อแก้ไขไม่ได้
3. แยกวิเคราะห์แต่ละบรรทัดด้วย syntect `ParseState` และ scope stack
4. แมป scope เป็น 11 หมวดหมู่สีเชิงความหมายและแทรก/รีเซ็ตรหัสสี ANSI

### พฤติกรรมเมื่อเกิดความล้มเหลว

- ความล้มเหลวในการแยกวิเคราะห์ต่อบรรทัดจะไม่ทำให้การเรียกล้มเหลว: บรรทัดนั้นจะถูกเพิ่มแบบไม่เน้นสีและการประมวลผลดำเนินต่อไป
- ภาษาที่ไม่รู้จัก/ไม่รองรับจะสำรองเป็น syntax ข้อความธรรมดา

## Flow แบบ pure utility เทียบกับ flow ที่ขึ้นกับระบบไฟล์

| Flow | การเข้าถึงระบบไฟล์ | Shared cache | หมายเหตุ |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | ไม่ | ไม่ | regex บนไบต์/string ที่ให้มาเท่านั้น |
| ฟังก์ชันโมดูล `text` | ไม่ | ไม่ | ANSI/ความกว้าง/การทำความสะอาดเท่านั้น |
| ฟังก์ชันโมดูล `highlight` | ไม่ | ไม่ | syntax + การเน้นสี ANSI เท่านั้น |
| `glob` | ใช่ | เพิ่มเติม | การสแกนไดเรกทอรี + การกรอง glob |
| `fuzzyFind` | ใช่ | เพิ่มเติม | การสแกนไดเรกทอรี + การให้คะแนน fuzzy |
| `grep` (file/dir path) | ใช่ | เพิ่มเติม (โหมด dir) | ripgrep ข้ามไฟล์, ตัวกรอง/callback เพิ่มเติม |

## สรุปวงจรชีวิตแบบครบวงจร

1. ผู้เรียกเรียกใช้ TS wrapper พร้อม typed options
2. Wrapper normalize ค่าเริ่มต้น (โดยเฉพาะ `glob`) และส่งต่อไปยัง `native.*` export
3. Rust ตรวจสอบ/normalize options และสร้าง matcher/search config
4. สำหรับ flow ที่เข้าถึงระบบไฟล์ รายการจะถูกสแกน (cache hit/miss/rescan) จากนั้นกรอง/ให้คะแนน
5. ลูป worker เรียก cancel heartbeat เป็นระยะ timeout/abort สามารถยุติการทำงานได้
6. Rust จัดรูปผลลัพธ์เป็น N-API object (`lineNumber`, `matchCount`, `limitReached` เป็นต้น)
7. TS wrapper คืน typed JS object (และ callback ต่อการจับคู่เพิ่มเติมสำหรับ `grep`/`glob`)
