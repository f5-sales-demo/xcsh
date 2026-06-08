---
title: Natives Text and Search Pipeline
description: >-
  Native text search pipeline with grep, glob, and ripgrep-based file content
  indexing.
sidebar:
  order: 6
  label: Text & search pipeline
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Natives Text/Search Pipeline

เอกสารนี้แสดงการแมปพื้นผิว text/search ของ `@f5xc-salesdemos/pi-natives` (`grep`, `glob`, `text`, `highlight`) จาก TypeScript wrappers ไปยัง Rust N-API exports และกลับมายัง JS result objects

คำศัพท์เป็นไปตาม `docs/natives-architecture.md`:

- **Wrapper**: TS API ใน `packages/natives/src/*`
- **Rust module layer**: N-API exports ใน `crates/pi-natives/src/*`
- **Shared scan cache**: แคชรายการไดเรกทอรีที่สนับสนุนโดย `fs_cache` ซึ่งใช้โดย discovery/search flows

## ไฟล์การ implementation

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

## ภาพรวม pipeline แยกตามระบบย่อย

## 1) การค้นหา Regex (`grep`, `searchContent`, `hasMatch`)

### ขั้นตอนการรับ input/options

1. TS wrapper ส่งต่อ options ไปยัง native:
   - `grep/index.ts` ส่ง `options` โดยส่วนใหญ่ไม่เปลี่ยนแปลง และแปลง callback จาก `(match) => void` ให้เป็นรูปแบบ napi threadsafe callback `(err, match)`
   - `searchContent` และ `hasMatch` ส่ง string/`Uint8Array` โดยตรง
2. Rust option structs ใน `grep.rs` ทำการ deserialize ฟิลด์ camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`)
3. `grep` สร้าง `CancelToken` จาก `timeoutMs` + `AbortSignal` และรันภายใน `task::blocking("grep", ...)`

### สาขาการทำงาน

- **สาขา in-memory (ยูทิลิตี้ล้วน)**
  - `search` → `search_sync` → `run_search` บนเนื้อหาไบต์ที่ให้มา
  - ไม่มีการสแกนระบบไฟล์ ไม่ใช้ `fs_cache`
- **สาขาไฟล์เดียว (ขึ้นกับระบบไฟล์)**
  - `grep_sync` แก้ไข path ตรวจสอบว่า metadata เป็นไฟล์ สตรีมได้สูงสุด `MAX_FILE_BYTES` ต่อไฟล์ (`4 MiB`) ผ่าน ripgrep matcher
- **สาขาไดเรกทอรี (ขึ้นกับระบบไฟล์)**
  - ค้นหาแคชเพิ่มเติมผ่าน `fs_cache::get_or_scan` เมื่อ `cache: true`
  - สแกนใหม่ผ่าน `fs_cache::force_rescan` เมื่อ `cache: false`
  - ตรวจสอบผลลัพธ์ว่างซ้ำเพิ่มเติมเมื่ออายุแคชเกิน `empty_recheck_ms()`
  - การกรองรายการ: ไฟล์เท่านั้น + ตัวกรอง glob เพิ่มเติม (`glob_util`) + การแมปตัวกรองประเภทเพิ่มเติม (`js`, `ts`, `rust` เป็นต้น)

### ความหมายของการค้นหา/การรวบรวม

- เอ็นจิน Regex: `grep_regex::RegexMatcherBuilder` พร้อม `ignoreCase` และ `multiline`
- การแก้ไข context:
  - `contextBefore/contextAfter` แทนที่ `context` แบบ legacy
  - โหมดที่ไม่ใช่ content จะทำให้การรวบรวม context เป็นศูนย์
- โหมดเอาต์พุต:
  - `content` => หนึ่ง `GrepMatch` ต่อผลลัพธ์ที่พบ
  - `count` และ `filesWithMatches` ทั้งคู่แมปไปยังรายการแบบ count (`lineNumber=0`, `line=""`, `matchCount` ถูกตั้งค่า)
- ขีดจำกัด:
  - `offset` และ `maxCount` แบบ global ถูกใช้ข้ามไฟล์
  - เส้นทางแบบขนานถูกใช้เฉพาะเมื่อ `maxCount` ไม่ได้ถูกตั้งค่าและ `offset == 0`; ไม่เช่นนั้นเส้นทางแบบลำดับจะรักษาความหมาย global offset/limit ที่ deterministic

### การจัดรูปร่างผลลัพธ์กลับไปยัง JS

- ฟิลด์ Rust `SearchResult`/`GrepResult` แมปไปยังประเภท TS ผ่านการแปลงฟิลด์ N-API object
- ตัวนับถูก clamp เป็น `u32` ก่อนข้าม N-API
- ค่า boolean ที่เป็น optional จะถูกละเว้นเว้นแต่เป็น true ในบาง path (`limitReached`)
- Streaming callback รับ `GrepMatch` ที่จัดรูปร่างแล้วแต่ละรายการ (รายการ content หรือ count)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- `searchContent` คืนค่า `SearchResult.error` สำหรับข้อผิดพลาด regex/search แทนที่จะ throw
- `grep` reject เมื่อเกิดข้อผิดพลาดร้ายแรง (path ไม่ถูกต้อง, glob/regex ไม่ถูกต้อง, timeout/abort ของ cancellation)
- `hasMatch` คืนค่า `Result<bool>` และ throw เมื่อ pattern/UTF-8 decoding ผิดพลาด
- ข้อผิดพลาดในการเปิดไฟล์/ค้นหาในการสแกนหลายไฟล์จะถูกข้ามต่อไฟล์; การสแกนดำเนินต่อไป

### การจัดการ regex ที่ผิดรูปแบบ

`grep.rs` ทำความสะอาด braces ก่อนการ compile regex:

- Braces ที่ไม่ใช่ repetition ที่ถูกต้องจะถูก escape (`{`/`}` -> `\{`/`\}`) เมื่อไม่สามารถสร้าง `{N}`, `{N,}`, `{N,M}` ได้
- สิ่งนี้ป้องกัน literal-template fragments ทั่วไป (เช่น `${platform}`) จากการล้มเหลวเนื่องจากเป็น malformed repetition
- Regex syntax ที่ไม่ถูกต้องที่เหลือยังคงคืนค่า regex error

## 2) การค้นพบไฟล์ (`glob`) และการค้นหา path แบบ fuzzy (`fuzzyFind`)

`glob` และ `fuzzyFind` ใช้การสแกน `fs_cache` ร่วมกัน; ตรรกะการจับคู่แตกต่างกัน

### ขั้นตอน `glob`

1. TS wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`
   - ค่าเริ่มต้น: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`
2. Rust `glob` สร้าง `GlobConfig` และ compile pattern ผ่าน `glob_util::compile_glob`
3. แหล่งรายการ:
   - `cache=true` => `get_or_scan` + `force_rescan` เพิ่มเติมเมื่อ stale-empty
   - `cache=false` => `force_rescan(..., store=false)` (สดเท่านั้น)
4. การกรอง:
   - ข้าม `.git` เสมอ
   - ข้าม `node_modules` เว้นแต่ร้องขอ (`includeNodeModules` หรือ pattern ที่กล่าวถึง node_modules)
   - ใช้การจับคู่ glob
   - ใช้ตัวกรองประเภทไฟล์; ตัวกรอง `file/dir` ของ symlink จะแก้ไข target metadata
5. การเรียงลำดับเพิ่มเติมตาม mtime จากมากไปน้อย (`sortByMtime`) ก่อนตัดให้เหลือ `maxResults`

### ขั้นตอน `fuzzyFind` (implement ใน `fd.rs`)

1. TS wrapper ถูก export จาก `grep` module แต่ Rust implementation อยู่ใน `fd.rs`
2. แหล่งสแกนร่วมจาก `fs_cache` พร้อมการแบ่ง cache/no-cache เหมือนกันและนโยบายตรวจสอบซ้ำเมื่อ stale-empty
3. การให้คะแนน:
   - คะแนน fuzzy แบบ exact / starts-with / contains / subsequence-based
   - เส้นทางการให้คะแนนที่ normalize ด้วย separator/punctuation
   - โบนัสไดเรกทอรีและ tie-break แบบ deterministic (`score desc` จากนั้น `path asc`)
4. รายการ symlink จะถูกแยกออกจากผลลัพธ์ fuzzy

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- Glob pattern ไม่ถูกต้อง => error จาก `glob_util::compile_glob`
- Search root ต้องเป็นไดเรกทอรีที่มีอยู่ (`resolve_search_path`) ไม่เช่นนั้นจะเกิด error
- การยกเลิก/timeout จะถูกส่งต่อเป็น abort errors ผ่านการตรวจสอบ `CancelToken::heartbeat()` ในลูป

### การจัดการ glob ที่ผิดรูปแบบ

`glob_util::build_glob_pattern` มีความทนทาน:

- Normalize `\` เป็น `/`
- เติม `**/` นำหน้าอัตโนมัติสำหรับ recursive patterns ที่เรียบง่ายเมื่อ `recursive=true`
- ปิดกลุ่ม alternation `{...` ที่ไม่สมดุลอัตโนมัติก่อน compile

## 3) วงจรชีวิต shared scan/cache (`fs_cache`)

`fs_cache` จัดเก็บผลลัพธ์การสแกนเป็นรายการสัมพัทธ์ที่ normalize แล้ว (`path`, `fileType`, `mtime` เพิ่มเติม) โดยใช้คีย์:

- canonical search root
- `include_hidden`
- `use_gitignore`

### การเปลี่ยนสถานะของแคช

1. **พลาด / ปิดใช้งาน**
   - TTL เป็น `0` หรือคีย์ไม่มี/หมดอายุ -> `collect_entries` ใหม่
2. **ตรง**
   - อายุรายการ `< cache_ttl_ms()` -> คืนค่ารายการที่แคชไว้ + `cache_age_ms`
3. **ตรวจสอบซ้ำเมื่อ stale-empty** (นโยบายของผู้เรียกใน `glob`/`grep`/`fd`)
   - หากคำค้นให้ผลลัพธ์ศูนย์รายการและ `cache_age_ms >= empty_recheck_ms()` จะบังคับสแกนใหม่หนึ่งครั้ง
4. **การทำให้แคชเป็นโมฆะ**
   - `invalidateFsScanCache(path?)`:
     - ไม่มี arg: ล้างคีย์ทั้งหมด
     - มี path arg: ลบคีย์ที่ root เป็น prefix ของ path เป้าหมาย

### การแลกเปลี่ยนผลลัพธ์ที่ล้าสมัย

- แคชให้ความสำคัญกับการสแกนซ้ำที่มี latency ต่ำมากกว่าความสอดคล้องทันที
- หน้าต่าง TTL อาจคืนค่า stale positives/negatives
- การตรวจสอบซ้ำผลลัพธ์ว่างลด stale negatives สำหรับการสแกนที่แคชไว้เก่ากว่าโดยแลกกับการสแกนเพิ่มเติมหนึ่งครั้ง
- การทำให้แคชเป็นโมฆะแบบชัดเจนเป็นตัวเชื่อมความถูกต้องที่ตั้งใจไว้หลังจากการเปลี่ยนแปลงไฟล์

## 4) ยูทิลิตี้ข้อความ ANSI (`text`)

เหล่านี้เป็นยูทิลิตี้ล้วนที่ทำงานใน memory (ไม่มีการสแกนระบบไฟล์)

### ขอบเขตและความรับผิดชอบ

- **`text.rs` รับผิดชอบ terminal-cell semantics**:
  - การแยกวิเคราะห์ ANSI sequence
  - ความกว้างและการตัดที่ตระหนักถึง grapheme
  - พฤติกรรม wrap/truncate/sanitize
- **การตัดบรรทัดของ `grep.rs` (`maxColumns`) แยกต่างหาก**:
  - การตัดขอบตัวอักษรอย่างง่ายของบรรทัดที่จับคู่ได้พร้อม `...`
  - ไม่รักษาสถานะ ANSI และไม่ตระหนักถึงความกว้าง terminal-cell

### พฤติกรรมหลัก

- `wrapTextWithAnsi`: ตัดบรรทัดตามความกว้างที่มองเห็นได้ นำ SGR codes ที่ active ข้ามบรรทัดที่ตัด
- `truncateToWidth`: การตัด visible-cell พร้อมนโยบาย ellipsis (`Unicode`, `Ascii`, `Omit`), การเติมขวาเพิ่มเติม, และ fast-path ที่คืนค่า JS string เดิมเมื่อไม่เปลี่ยนแปลง
- `sliceWithWidth`: การตัดคอลัมน์พร้อมการบังคับความกว้างที่เข้มงวดเพิ่มเติม
- `extractSegments`: แยกส่วน before/after รอบ overlay ขณะกู้คืนสถานะ ANSI สำหรับส่วน `after`
- `sanitizeText`: ลบ ANSI escapes + control chars, ตัด lone surrogates, normalize CR/LF โดยลบ `\r`
- `visibleWidth`: นับ visible terminal cells (tabs ใช้ `TAB_WIDTH` คงที่จาก Rust implementation)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ฟังก์ชันข้อความโดยทั่วไปคืนค่าเอาต์พุตที่แปลงแล้วอย่าง deterministic; ข้อผิดพลาดจำกัดอยู่ที่ขอบเขตการแปลง JS string (ข้อผิดพลาดการแปลง argument ของ N-API)

## 5) การเน้นสี syntax (`highlight`)

`highlight.rs` เป็นการแปลงล้วน (ไม่มี FS ไม่มีแคช)

### ขั้นตอน

1. Wrapper ส่งต่อ `code`, `lang` เพิ่มเติม, และ ANSI color palette
2. Rust แก้ไข syntax โดย:
   - ค้นหาด้วย token/name
   - ค้นหาด้วย extension
   - fallback ด้วยตาราง alias (`ts/tsx/js -> JavaScript` เป็นต้น)
   - fallback เป็น plain text syntax เมื่อไม่สามารถแก้ไขได้
3. แยกวิเคราะห์แต่ละบรรทัดด้วย syntect `ParseState` และ scope stack
4. แมป scopes ไปยัง 11 หมวดหมู่สีเชิงความหมายและ inject/reset ANSI color codes

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- ข้อผิดพลาดในการ parse ต่อบรรทัดไม่ทำให้การเรียกล้มเหลว: บรรทัดนั้นจะถูกเพิ่มโดยไม่เน้นสีและการประมวลผลดำเนินต่อไป
- ภาษาที่ไม่รู้จัก/ไม่รองรับจะ fallback เป็น plain text syntax

## Pure utility เทียบกับ flows ที่ขึ้นกับระบบไฟล์

| Flow | การเข้าถึงระบบไฟล์ | แคชร่วม | หมายเหตุ |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | ไม่ | ไม่ | regex บน bytes/string ที่ให้มาเท่านั้น |
| ฟังก์ชันโมดูล `text` | ไม่ | ไม่ | ANSI/width/sanitization เท่านั้น |
| ฟังก์ชันโมดูล `highlight` | ไม่ | ไม่ | syntax + ANSI coloring เท่านั้น |
| `glob` | ใช่ | เพิ่มเติม | การสแกนไดเรกทอรี + การกรอง glob |
| `fuzzyFind` | ใช่ | เพิ่มเติม | การสแกนไดเรกทอรี + การให้คะแนน fuzzy |
| `grep` (file/dir path) | ใช่ | เพิ่มเติม (โหมด dir) | ripgrep ข้ามไฟล์, ตัวกรอง/callback เพิ่มเติม |

## สรุปวงจรชีวิตแบบ end-to-end

1. ผู้เรียกเรียกใช้ TS wrapper พร้อม typed options
2. Wrapper normalize ค่าเริ่มต้น (โดยเฉพาะ `glob`) และส่งต่อไปยัง `native.*` export
3. Rust ตรวจสอบ/normalize options และสร้าง matcher/search config
4. สำหรับ filesystem flows รายการจะถูกสแกน (cache hit/miss/rescan) จากนั้นกรอง/ให้คะแนน
5. Worker loops เรียก cancel heartbeat เป็นระยะ; timeout/abort สามารถยุติการทำงานได้
6. Rust จัดรูปร่างเอาต์พุตเป็น N-API objects (`lineNumber`, `matchCount`, `limitReached` เป็นต้น)
7. TS wrapper คืนค่า typed JS objects (และ per-match callbacks เพิ่มเติมสำหรับ `grep`/`glob`)
