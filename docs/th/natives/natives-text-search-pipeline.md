---
title: ไปป์ไลน์ข้อความและการค้นหาแบบเนทีฟ
description: >-
  ไปป์ไลน์การค้นหาข้อความแบบเนทีฟด้วย grep, glob
  และการจัดทำดัชนีเนื้อหาไฟล์บนพื้นฐาน ripgrep
sidebar:
  order: 6
  label: ไปป์ไลน์ข้อความและการค้นหา
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# ไปป์ไลน์ข้อความ/การค้นหาแบบเนทีฟ

เอกสารนี้อธิบายพื้นผิว text/search ของ `@f5xc-salesdemos/pi-natives` (`grep`, `glob`, `text`, `highlight`) ตั้งแต่ TypeScript wrapper ไปจนถึง Rust N-API exports และย้อนกลับสู่ JS result objects

คำศัพท์ตาม `docs/natives-architecture.md`:

- **Wrapper**: TS API ใน `packages/natives/src/*`
- **Rust module layer**: N-API exports ใน `crates/pi-natives/src/*`
- **Shared scan cache**: แคชรายการไดเรกทอรีที่ใช้ `fs_cache` เป็นพื้นฐาน สำหรับกระบวนการค้นพบและค้นหา

## ไฟล์การปรับใช้งาน

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

### กระบวนการรับค่า/ตัวเลือก

1. TS wrapper ส่งต่อตัวเลือกไปยัง native:
   - `grep/index.ts` ส่ง `options` ไปเป็นส่วนใหญ่โดยไม่เปลี่ยนแปลง และห่อ callback จากรูปแบบ `(match) => void` เป็นรูปแบบ napi threadsafe callback `(err, match)`
   - `searchContent` และ `hasMatch` ส่ง string/`Uint8Array` โดยตรง
2. Rust option structs ใน `grep.rs` แปลงฟิลด์ camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`)
3. `grep` สร้าง `CancelToken` จาก `timeoutMs` + `AbortSignal` และรันภายใน `task::blocking("grep", ...)`

### สาขาการประมวลผล

- **สาขา in-memory (pure utility)**
  - `search` → `search_sync` → `run_search` บนเนื้อหาที่ให้มาเป็นไบต์
  - ไม่มีการสแกนระบบไฟล์ ไม่ใช้ `fs_cache`
- **สาขาไฟล์เดียว (filesystem-dependent)**
  - `grep_sync` แก้ไข path, ตรวจสอบ metadata ว่าเป็นไฟล์, stream สูงสุด `MAX_FILE_BYTES` ต่อไฟล์ (`4 MiB`) ผ่าน ripgrep matcher
- **สาขาไดเรกทอรี (filesystem-dependent)**
  - ค้นหาแคชตัวเลือกผ่าน `fs_cache::get_or_scan` เมื่อ `cache: true`
  - สแกนใหม่ผ่าน `fs_cache::force_rescan` เมื่อ `cache: false`
  - ตรวจสอบผลลัพธ์ว่างตัวเลือกเมื่ออายุแคชเกิน `empty_recheck_ms()`
  - การกรองรายการ: ไฟล์เท่านั้น + กรอง glob ตัวเลือก (`glob_util`) + กรองประเภทตัวเลือก (`js`, `ts`, `rust` ฯลฯ)

### ความหมายของการค้นหาและการรวบรวม

- เครื่องมือ Regex: `grep_regex::RegexMatcherBuilder` พร้อม `ignoreCase` และ `multiline`
- การแก้ไข context:
  - `contextBefore/contextAfter` แทนที่ `context` แบบเดิม
  - โหมดที่ไม่ใช่ content จะตั้งค่าการรวบรวม context เป็นศูนย์
- โหมดผลลัพธ์:
  - `content` => `GrepMatch` หนึ่งรายการต่อหนึ่งการพบ
  - ทั้ง `count` และ `filesWithMatches` แมปไปยังรายการแบบ count (`lineNumber=0`, `line=""`, `matchCount` ถูกกำหนด)
- ขีดจำกัด:
  - `offset` และ `maxCount` แบบ global ใช้งานข้ามไฟล์
  - ใช้เส้นทางแบบขนานเฉพาะเมื่อ `maxCount` ไม่ได้กำหนดและ `offset == 0`; มิฉะนั้นใช้เส้นทางแบบลำดับเพื่อรักษาความหมายของ offset/limit แบบ global ที่กำหนดได้

### การจัดรูปแบบผลลัพธ์กลับสู่ JS

- ฟิลด์ `SearchResult`/`GrepResult` ของ Rust แมปไปยัง TS types ผ่านการแปลงฟิลด์ N-API object
- ตัวนับถูก clamp ที่ `u32` ก่อนข้าม N-API
- บูลีนตัวเลือกจะถูกละเว้นเว้นแต่เป็น true ในบางเส้นทาง (`limitReached`)
- Streaming callback รับ `GrepMatch` ที่จัดรูปแบบแล้วแต่ละรายการ (รายการ content หรือ count)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- `searchContent` คืนค่า `SearchResult.error` สำหรับความล้มเหลวของ regex/search แทนการ throw
- `grep` ปฏิเสธเมื่อเกิดข้อผิดพลาดร้ายแรง (path ไม่ถูกต้อง, glob/regex ไม่ถูกต้อง, การยกเลิกด้วย timeout/abort)
- `hasMatch` คืนค่า `Result<bool>` และ throw เมื่อ pattern ไม่ถูกต้อง/ข้อผิดพลาดการถอดรหัส UTF-8
- ข้อผิดพลาดการเปิด/ค้นหาไฟล์ในการสแกนหลายไฟล์จะถูกข้ามทีละไฟล์ และการสแกนดำเนินต่อไป

### การจัดการ regex ที่ไม่ถูกต้อง

`grep.rs` ทำความสะอาดวงเล็บปีกกาก่อนการคอมไพล์ regex:

- วงเล็บปีกกาที่มีลักษณะเป็น repetition ไม่ถูกต้องจะถูก escape (`{`/`}` -> `\{`/`\}`) เมื่อไม่สามารถสร้าง `{N}`, `{N,}`, `{N,M}` ได้
- ซึ่งป้องกันไม่ให้ fragment ของ literal-template ทั่วไป (เช่น `${platform}`) ล้มเหลวเป็น malformed repetition
- syntax ของ regex ที่ไม่ถูกต้องที่เหลืออยู่ยังคงคืนค่าข้อผิดพลาด regex

## 2) การค้นพบไฟล์ (`glob`) และการค้นหา path แบบ fuzzy (`fuzzyFind`)

`glob` และ `fuzzyFind` ใช้การสแกน `fs_cache` ร่วมกัน แต่ตรรกะการจับคู่แตกต่างกัน

### กระบวนการ `glob`

1. TS wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`
   - ค่าเริ่มต้น: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`
2. Rust `glob` สร้าง `GlobConfig` และคอมไพล์ pattern ผ่าน `glob_util::compile_glob`
3. แหล่งที่มาของรายการ:
   - `cache=true` => `get_or_scan` + `force_rescan` แบบ stale-empty ตัวเลือก
   - `cache=false` => `force_rescan(..., store=false)` (ใหม่เท่านั้น)
4. การกรอง:
   - ข้าม `.git` เสมอ
   - ข้าม `node_modules` เว้นแต่จะร้องขอ (`includeNodeModules` หรือ pattern ที่กล่าวถึง node_modules)
   - ใช้การจับคู่ glob
   - ใช้การกรองประเภทไฟล์; การกรอง symlink `file/dir` จะแก้ไข target metadata
5. การเรียงลำดับตัวเลือกตาม mtime desc (`sortByMtime`) ก่อนตัดให้เหลือ `maxResults`

### กระบวนการ `fuzzyFind` (ปรับใช้งานใน `fd.rs`)

1. TS wrapper ถูก export จาก `grep` module แต่การปรับใช้งาน Rust อยู่ใน `fd.rs`
2. แหล่งสแกนร่วมจาก `fs_cache` พร้อมการแบ่ง cache/no-cache และนโยบาย stale-empty recheck เหมือนกัน
3. การให้คะแนน:
   - คะแนน fuzzy แบบ exact / starts-with / contains / subsequence
   - เส้นทางการให้คะแนนที่ normalize ด้วย separator/punctuation
   - โบนัสไดเรกทอรีและการตัดสินเสมอแบบกำหนดได้ (`score desc`, แล้ว `path asc`)
4. รายการ symlink ถูกยกเว้นจากผลลัพธ์ fuzzy

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- glob pattern ไม่ถูกต้อง => ข้อผิดพลาดจาก `glob_util::compile_glob`
- root ของการค้นหาต้องเป็นไดเรกทอรีที่มีอยู่ (`resolve_search_path`) มิฉะนั้นจะเกิดข้อผิดพลาด
- การยกเลิก/timeout จะแพร่กระจายเป็น abort errors ผ่านการตรวจสอบ `CancelToken::heartbeat()` ในลูป

### การจัดการ glob ที่ไม่ถูกต้อง

`glob_util::build_glob_pattern` มีความอดทน:

- Normalize `\` เป็น `/`
- เพิ่ม `**/` นำหน้า pattern recursive แบบง่ายโดยอัตโนมัติเมื่อ `recursive=true`
- ปิดกลุ่ม alternation `{...` ที่ไม่สมดุลโดยอัตโนมัติก่อนคอมไพล์

## 3) วงจรชีวิตการสแกน/แคชร่วม (`fs_cache`)

`fs_cache` เก็บผลการสแกนเป็นรายการ relative ที่ normalize แล้ว (`path`, `fileType`, `mtime` ตัวเลือก) โดยมีคีย์ตาม:

- search root แบบ canonical
- `include_hidden`
- `use_gitignore`

### การเปลี่ยนสถานะแคช

1. **Miss / ปิดใช้งาน**
   - TTL เป็น `0` หรือ key ไม่มี/หมดอายุ -> `collect_entries` ใหม่
2. **Hit**
   - อายุรายการ `< cache_ttl_ms()` -> คืนค่ารายการที่แคชไว้ + `cache_age_ms`
3. **Stale-empty recheck** (นโยบาย caller ใน `glob`/`grep`/`fd`)
   - หากการสอบถามให้ผลลัพธ์เป็นศูนย์และ `cache_age_ms >= empty_recheck_ms()` ให้บังคับสแกนใหม่หนึ่งครั้ง
4. **การทำให้ไม่ถูกต้อง**
   - `invalidateFsScanCache(path?)`:
     - ไม่มี arg: ล้างทุก key
     - path arg: ลบ key ที่ root มี prefix ที่ตรง target path นั้น

### การแลกเปลี่ยนผลลัพธ์ที่ล้าสมัย

- แคชเน้นการสแกนซ้ำที่มี latency ต่ำมากกว่าความสอดคล้องทันที
- ช่วง TTL อาจคืนค่า positive/negative ที่ล้าสมัย
- Empty-result recheck ลด stale negative สำหรับการสแกนที่แคชไว้เก่าในราคาของการสแกนเพิ่มหนึ่งครั้ง
- การทำให้ไม่ถูกต้องแบบชัดเจนคือ hook ความถูกต้องที่ตั้งใจไว้หลังจากการกลายพันธุ์ของไฟล์

## 4) ANSI text utilities (`text`)

ยูทิลิตีเหล่านี้เป็น pure, in-memory (ไม่มีการสแกนระบบไฟล์)

### ขอบเขตและความรับผิดชอบ

- **`text.rs` เป็นเจ้าของ semantics ของ terminal-cell**:
  - การแยกวิเคราะห์ ANSI sequence
  - ความกว้างและการตัดแบบ grapheme-aware
  - พฤติกรรม wrap/truncate/sanitize
- **การตัดบรรทัดของ `grep.rs` (`maxColumns`) แยกต่างหาก**:
  - การตัดบรรทัดที่ตรงกันแบบง่ายตาม character-boundary ด้วย `...`
  - ไม่รักษา ANSI-state และไม่ตระหนักถึงความกว้าง terminal-cell

### พฤติกรรมหลัก

- `wrapTextWithAnsi`: ตัดบรรทัดตามความกว้างที่มองเห็น ส่ง SGR codes ที่ใช้งานอยู่ข้ามบรรทัดที่ตัด
- `truncateToWidth`: การตัดตาม visible-cell พร้อมนโยบาย ellipsis (`Unicode`, `Ascii`, `Omit`), padding ขวาตัวเลือก, และ fast-path ที่คืนค่า JS string เดิมเมื่อไม่มีการเปลี่ยนแปลง
- `sliceWithWidth`: การตัด column ด้วยการบังคับใช้ความกว้าง strict ตัวเลือก
- `extractSegments`: ดึง segment before/after รอบ overlay ขณะคืนค่า ANSI state สำหรับ segment `after`
- `sanitizeText`: ลบ ANSI escape + control chars, ลบ lone surrogate, normalize CR/LF โดยลบ `\r`
- `visibleWidth`: นับ visible terminal cell (tab ใช้ `TAB_WIDTH` คงที่จากการปรับใช้งาน Rust)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ฟังก์ชัน text โดยทั่วไปคืนค่า output ที่แปลงแบบกำหนดได้ ข้อผิดพลาดจำกัดอยู่ที่ขอบเขตการแปลง JS string (ความล้มเหลวในการแปลง argument ของ N-API)

## 5) Syntax highlighting (`highlight`)

`highlight.rs` เป็น pure transformation (ไม่มี FS ไม่มีแคช)

### กระบวนการ

1. Wrapper ส่งต่อ `code`, `lang` ตัวเลือก, และ ANSI color palette
2. Rust แก้ไข syntax โดย:
   - การค้นหา token/name
   - การค้นหา extension
   - fallback ของตาราง alias (`ts/tsx/js -> JavaScript` ฯลฯ)
   - fallback ไปยัง plain text syntax เมื่อแก้ไขไม่ได้
3. แยกวิเคราะห์แต่ละบรรทัดด้วย syntect `ParseState` และ scope stack
4. แมป scope ไปยัง 11 หมวดหมู่สี semantic และฉีด/รีเซ็ต ANSI color codes

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- ความล้มเหลวในการแยกวิเคราะห์ต่อบรรทัดไม่ทำให้การเรียกล้มเหลว: บรรทัดนั้นจะถูกต่อท้ายโดยไม่ highlight และการประมวลผลดำเนินต่อไป
- ภาษาที่ไม่รู้จัก/ไม่รองรับ fallback ไปยัง plain text syntax

## Pure utility เทียบกับ filesystem-dependent flows

| Flow | การเข้าถึงระบบไฟล์ | Shared cache | หมายเหตุ |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | ไม่มี | ไม่มี | regex บน bytes/string ที่ให้มาเท่านั้น |
| ฟังก์ชันใน `text` module | ไม่มี | ไม่มี | ANSI/width/sanitization เท่านั้น |
| ฟังก์ชันใน `highlight` module | ไม่มี | ไม่มี | syntax + ANSI coloring เท่านั้น |
| `glob` | มี | ตัวเลือก | การสแกนไดเรกทอรี + glob filtering |
| `fuzzyFind` | มี | ตัวเลือก | การสแกนไดเรกทอรี + fuzzy scoring |
| `grep` (file/dir path) | มี | ตัวเลือก (dir mode) | ripgrep ข้ามไฟล์, filters/callback ตัวเลือก |

## สรุปวงจรชีวิตแบบ end-to-end

1. ผู้เรียกเรียกใช้ TS wrapper พร้อม typed options
2. Wrapper normalize ค่าเริ่มต้น (โดยเฉพาะ `glob`) และส่งต่อไปยัง `native.*` export
3. Rust ตรวจสอบ/normalize options และสร้าง matcher/search config
4. สำหรับ filesystem flows รายการจะถูกสแกน (cache hit/miss/rescan) จากนั้น filtered/scored
5. Worker loop เรียก cancel heartbeat เป็นระยะ; timeout/abort สามารถยุติการประมวลผลได้
6. Rust จัดรูปแบบ output เป็น N-API objects (`lineNumber`, `matchCount`, `limitReached` ฯลฯ)
7. TS wrapper คืนค่า typed JS objects (และ per-match callback ตัวเลือกสำหรับ `grep`/`glob`)
