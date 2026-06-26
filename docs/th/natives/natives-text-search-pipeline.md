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

เอกสารนี้แมปพื้นผิวข้อความ/การค้นหาของ `@f5-sales-demo/pi-natives` (`grep`, `glob`, `text`, `highlight`) จาก TypeScript wrappers ไปยัง Rust N-API exports และกลับมาเป็น JS result objects

คำศัพท์ตาม `docs/natives-architecture.md`:

- **Wrapper**: TS API ใน `packages/natives/src/*`
- **Rust module layer**: N-API exports ใน `crates/pi-natives/src/*`
- **Shared scan cache**: แคชรายการไดเรกทอรีที่รองรับโดย `fs_cache` ซึ่งใช้โดยกระบวนการค้นพบ/ค้นหา

## ไฟล์การนำไปใช้งาน

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

### กระบวนการรับ input/options

1. TS wrapper ส่ง options ไปยัง native:
   - `grep/index.ts` ส่ง `options` ไปเกือบไม่เปลี่ยนแปลง และห่อ callback จาก `(match) => void` ให้เป็น napi threadsafe callback shape `(err, match)`
   - `searchContent` และ `hasMatch` ส่ง string/`Uint8Array` โดยตรง
2. Rust option structs ใน `grep.rs` แปลงฟิลด์ camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`)
3. `grep` สร้าง `CancelToken` จาก `timeoutMs` + `AbortSignal` และรันภายใน `task::blocking("grep", ...)`

### สาขาการประมวลผล

- **สาขาในหน่วยความจำ (pure utility)**
  - `search` → `search_sync` → `run_search` บนไบต์เนื้อหาที่ให้มา
  - ไม่มีการสแกนระบบไฟล์ ไม่ใช้ `fs_cache`
- **สาขาไฟล์เดียว (ขึ้นอยู่กับระบบไฟล์)**
  - `grep_sync` แก้ไข path, ตรวจสอบ metadata ว่าเป็นไฟล์, สตรีมสูงสุด `MAX_FILE_BYTES` ต่อไฟล์ (`4 MiB`) ผ่าน ripgrep matcher
- **สาขาไดเรกทอรี (ขึ้นอยู่กับระบบไฟล์)**
  - ค้นหาแคชเสริมผ่าน `fs_cache::get_or_scan` เมื่อ `cache: true`
  - สแกนใหม่ผ่าน `fs_cache::force_rescan` เมื่อ `cache: false`
  - ตรวจสอบผลลัพธ์ว่างซ้ำเสริมเมื่ออายุแคชเกิน `empty_recheck_ms()`
  - การกรอง entry: เฉพาะไฟล์ + ตัวกรอง glob เสริม (`glob_util`) + ตัวกรองประเภทเสริม (`js`, `ts`, `rust` เป็นต้น)

### ความหมายการค้นหา/รวบรวมผลลัพธ์

- Regex engine: `grep_regex::RegexMatcherBuilder` พร้อม `ignoreCase` และ `multiline`
- การกำหนด context:
  - `contextBefore/contextAfter` แทนที่ค่า `context` เดิม
  - โหมดที่ไม่ใช่ content จะเซ็ตการรวบรวม context เป็นศูนย์
- โหมดเอาต์พุต:
  - `content` => หนึ่ง `GrepMatch` ต่อการพบ
  - `count` และ `filesWithMatches` ทั้งสองแมปไปยัง count-style entries (`lineNumber=0`, `line=""`, `matchCount` ถูกตั้งค่า)
- ขีดจำกัด:
  - `offset` และ `maxCount` แบบ global ใช้กับทุกไฟล์
  - เส้นทางขนานใช้เฉพาะเมื่อ `maxCount` ไม่ได้ตั้งค่าและ `offset == 0` มิฉะนั้นเส้นทางลำดับจะรักษาความหมาย global offset/limit แบบ deterministic

### การจัดรูปแบบผลลัพธ์กลับสู่ JS

- ฟิลด์ `SearchResult`/`GrepResult` ของ Rust แมปไปยัง TS types ผ่านการแปลงฟิลด์ N-API object
- ตัวนับถูกจำกัดที่ `u32` ก่อนข้าม N-API
- Boolean เสริมจะถูกละเว้นหากไม่เป็น true ในบางเส้นทาง (`limitReached`)
- Streaming callback รับแต่ละ `GrepMatch` ที่จัดรูปแบบแล้ว (content หรือ count entry)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- `searchContent` คืนค่า `SearchResult.error` สำหรับข้อผิดพลาด regex/การค้นหาแทนการ throw
- `grep` ปฏิเสธด้วยข้อผิดพลาดร้ายแรง (path ไม่ถูกต้อง, glob/regex ไม่ถูกต้อง, การยกเลิก timeout/abort)
- `hasMatch` คืนค่า `Result<bool>` และ throw เมื่อ pattern/UTF-8 decoding errors ไม่ถูกต้อง
- ข้อผิดพลาดการเปิดไฟล์/การค้นหาในการสแกนหลายไฟล์จะถูกข้ามต่อไฟล์ การสแกนดำเนินต่อไป

### การจัดการ regex ที่ผิดรูปแบบ

`grep.rs` ทำความสะอาดวงเล็บปีกกาก่อน compile regex:

- วงเล็บปีกกาที่คล้ายการทำซ้ำที่ไม่ถูกต้องจะถูก escape (`{`/`}` -> `\{`/`\}`) เมื่อไม่สามารถสร้าง `{N}`, `{N,}`, `{N,M}` ได้
- ป้องกันไม่ให้ template fragments ทั่วไป (เช่น `${platform}`) ล้มเหลวเป็น malformed repetition
- ไวยากรณ์ regex ที่ไม่ถูกต้องที่เหลืออยู่ยังคงคืนค่า regex error

## 2) การค้นพบไฟล์ (`glob`) และการค้นหา path แบบ fuzzy (`fuzzyFind`)

`glob` และ `fuzzyFind` แชร์การสแกน `fs_cache` ร่วมกัน แต่ logic การจับคู่แตกต่างกัน

### กระบวนการ `glob`

1. TS wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`
   - ค่าเริ่มต้น: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`
2. Rust `glob` สร้าง `GlobConfig` และ compile pattern ผ่าน `glob_util::compile_glob`
3. แหล่ง entry:
   - `cache=true` => `get_or_scan` + `force_rescan` เสริมเมื่อผลลัพธ์ว่างล้าสมัย
   - `cache=false` => `force_rescan(..., store=false)` (ใหม่เท่านั้น)
4. การกรอง:
   - ข้าม `.git` เสมอ
   - ข้าม `node_modules` ยกเว้นเมื่อร้องขอ (`includeNodeModules` หรือ pattern ที่กล่าวถึง node_modules)
   - ใช้การจับคู่ glob
   - ใช้ตัวกรองประเภทไฟล์ การกรอง symlink `file/dir` จะแก้ไข target metadata
5. เรียงลำดับเสริมตาม mtime จากมากไปน้อย (`sortByMtime`) ก่อนตัดเหลือ `maxResults`

### กระบวนการ `fuzzyFind` (นำไปใช้ใน `fd.rs`)

1. TS wrapper ส่งออกจาก module `grep` แต่การนำไปใช้งาน Rust อยู่ใน `fd.rs`
2. แหล่งการสแกนที่แชร์จาก `fs_cache` พร้อมการแยก cache/no-cache และนโยบาย stale-empty recheck เดียวกัน
3. การให้คะแนน:
   - exact / starts-with / contains / subsequence-based fuzzy score
   - เส้นทางการให้คะแนนที่ normalize separator/punctuation
   - directory bonus และ tie-break แบบ deterministic (`score desc`, แล้ว `path asc`)
4. Symlink entries ถูกยกเว้นจากผลลัพธ์ fuzzy

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- glob pattern ไม่ถูกต้อง => error จาก `glob_util::compile_glob`
- Search root ต้องเป็นไดเรกทอรีที่มีอยู่ (`resolve_search_path`) มิฉะนั้น error
- การยกเลิก/timeout ส่งต่อเป็น abort errors ผ่านการตรวจสอบ `CancelToken::heartbeat()` ในลูป

### การจัดการ glob ที่ผิดรูปแบบ

`glob_util::build_glob_pattern` มีความยืดหยุ่น:

- Normalize `\` เป็น `/`
- เพิ่ม `**/` นำหน้าโดยอัตโนมัติสำหรับ simple recursive patterns เมื่อ `recursive=true`
- ปิดกลุ่ม alternation `{...` ที่ไม่สมดุลโดยอัตโนมัติก่อน compile

## 3) วงจรชีวิตการสแกน/แคชที่แชร์ (`fs_cache`)

`fs_cache` เก็บผลลัพธ์การสแกนเป็น entries สัมพัทธ์ที่ normalize (`path`, `fileType`, `mtime` เสริม) ที่ key โดย:

- search root แบบ canonical
- `include_hidden`
- `use_gitignore`

### การเปลี่ยนสถานะแคช

1. **Miss / ปิดใช้งาน**
   - TTL เป็น `0` หรือ key ไม่มี/หมดอายุ -> `collect_entries` ใหม่
2. **Hit**
   - อายุ entry `< cache_ttl_ms()` -> คืนค่า entries ที่แคชไว้ + `cache_age_ms`
3. **Stale-empty recheck** (นโยบายผู้เรียกใน `glob`/`grep`/`fd`)
   - หาก query ให้ผลการจับคู่เป็นศูนย์และ `cache_age_ms >= empty_recheck_ms()` จะ force rescan หนึ่งครั้ง
4. **การยกเลิก**
   - `invalidateFsScanCache(path?)`:
     - ไม่มี argument: ลบ keys ทั้งหมด
     - มี path argument: ลบ keys ที่ root เป็น prefix ของ target path นั้น

### การแลกเปลี่ยนผลลัพธ์ล้าสมัย

- แคชให้ความสำคัญกับการสแกนซ้ำที่มี latency ต่ำมากกว่าความสอดคล้องทันที
- ช่วง TTL อาจคืนค่า positives/negatives ที่ล้าสมัย
- Empty-result recheck ลด stale negatives สำหรับการสแกนที่แคชไว้เก่ากว่าโดยแลกกับการสแกนเพิ่มเติมหนึ่งครั้ง
- การยกเลิกที่ชัดเจนคือ hook ความถูกต้องที่ตั้งใจไว้หลังจากการเปลี่ยนแปลงไฟล์

## 4) ยูทิลิตี้ข้อความ ANSI (`text`)

ยูทิลิตี้เหล่านี้เป็น pure, in-memory utilities (ไม่มีการสแกนระบบไฟล์)

### ขอบเขตและความรับผิดชอบ

- **`text.rs` เป็นเจ้าของ terminal-cell semantics**:
  - การแยกวิเคราะห์ ANSI sequence
  - ความกว้างและการตัด slice ที่รับรู้ grapheme
  - พฤติกรรม wrap/truncate/sanitize
- **การตัด line ใน `grep.rs` (`maxColumns`) แยกต่างหาก**:
  - การตัด matched lines ที่ character-boundary อย่างง่ายพร้อม `...`
  - ไม่รักษา ANSI-state และไม่รับรู้ความกว้าง terminal-cell

### พฤติกรรมหลัก

- `wrapTextWithAnsi`: ตัดบรรทัดตามความกว้างที่มองเห็นได้ ส่ง active SGR codes ข้ามบรรทัดที่ตัดแล้ว
- `truncateToWidth`: การตัด visible-cell พร้อมนโยบาย ellipsis (`Unicode`, `Ascii`, `Omit`), padding ด้านขวาเสริม และ fast-path ที่คืนค่า JS string เดิมเมื่อไม่เปลี่ยนแปลง
- `sliceWithWidth`: การตัด column slice พร้อมการบังคับความกว้างแบบ strict เสริม
- `extractSegments`: แยก before/after segments รอบ overlay ขณะคืนค่า ANSI state สำหรับ segment `after`
- `sanitizeText`: ลบ ANSI escapes + control chars, ทิ้ง lone surrogates, normalize CR/LF โดยลบ `\r`
- `visibleWidth`: นับ visible terminal cells (tabs ใช้ `TAB_WIDTH` คงที่จากการนำไปใช้ Rust)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ฟังก์ชัน Text โดยทั่วไปคืนค่าเอาต์พุตที่แปลงแบบ deterministic ข้อผิดพลาดจำกัดอยู่ที่ขอบเขตการแปลง JS string (ความล้มเหลวการแปลง argument ของ N-API)

## 5) การ highlight syntax (`highlight`)

`highlight.rs` เป็น pure transformation (ไม่มี FS ไม่มีแคช)

### กระบวนการ

1. Wrapper ส่ง `code`, `lang` เสริม และ ANSI color palette
2. Rust แก้ไข syntax โดย:
   - ค้นหา token/ชื่อ
   - ค้นหา extension
   - fallback ของ alias table (`ts/tsx/js -> JavaScript` เป็นต้น)
   - fallback เป็น plain text syntax เมื่อไม่สามารถแก้ไขได้
3. แยกวิเคราะห์แต่ละบรรทัดด้วย syntect `ParseState` และ scope stack
4. แมป scopes ไปยัง 11 หมวดหมู่สี semantic และ inject/reset ANSI color codes

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- ข้อผิดพลาดการแยกวิเคราะห์ต่อบรรทัดไม่ทำให้การเรียกล้มเหลว: บรรทัดนั้นถูกเพิ่มโดยไม่ highlight และการประมวลผลดำเนินต่อไป
- ภาษาที่ไม่รู้จัก/ไม่รองรับจะ fallback เป็น plain text syntax

## Pure utility เทียบกับ flows ที่ขึ้นอยู่กับระบบไฟล์

| Flow | การเข้าถึงระบบไฟล์ | แคชที่แชร์ | หมายเหตุ |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | ไม่มี | ไม่มี | regex บน bytes/string ที่ให้มาเท่านั้น |
| ฟังก์ชัน module `text` | ไม่มี | ไม่มี | ANSI/width/sanitization เท่านั้น |
| ฟังก์ชัน module `highlight` | ไม่มี | ไม่มี | syntax + ANSI coloring เท่านั้น |
| `glob` | มี | เสริม | directory scans + glob filtering |
| `fuzzyFind` | มี | เสริม | directory scans + fuzzy scoring |
| `grep` (file/dir path) | มี | เสริม (dir mode) | ripgrep เหนือไฟล์, filters/callback เสริม |

## สรุปวงจรชีวิต end-to-end

1. Caller เรียก TS wrapper พร้อม typed options
2. Wrapper normalize ค่าเริ่มต้น (โดยเฉพาะ `glob`) และส่งต่อไปยัง export `native.*`
3. Rust ตรวจสอบ/normalize options และสร้าง matcher/search config
4. สำหรับ filesystem flows entries จะถูกสแกน (cache hit/miss/rescan) จากนั้นกรอง/ให้คะแนน
5. Worker loops เรียก cancel heartbeat เป็นระยะ timeout/abort สามารถยุติการประมวลผล
6. Rust จัดรูปแบบเอาต์พุตเป็น N-API objects (`lineNumber`, `matchCount`, `limitReached` เป็นต้น)
7. TS wrapper คืนค่า typed JS objects (และ per-match callbacks เสริมสำหรับ `grep`/`glob`)
