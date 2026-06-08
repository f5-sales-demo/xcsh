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

เอกสารนี้แสดงการแมป text/search surface (`grep`, `glob`, `text`, `highlight`) ของ `@f5xc-salesdemos/pi-natives` จาก TypeScript wrappers ไปยัง Rust N-API exports และกลับมาเป็น JS result objects

คำศัพท์เป็นไปตาม `docs/natives-architecture.md`:

- **Wrapper**: TS API ใน `packages/natives/src/*`
- **Rust module layer**: N-API exports ใน `crates/pi-natives/src/*`
- **Shared scan cache**: `fs_cache`-backed directory-entry cache ที่ใช้โดย discovery/search flows

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

## ภาพรวม pipeline แยกตามระบบย่อย

## 1) การค้นหาด้วย Regex (`grep`, `searchContent`, `hasMatch`)

### flow ของ input/options

1. TS wrapper ส่งต่อ options ไปยัง native:
   - `grep/index.ts` ส่ง `options` โดยแทบไม่เปลี่ยนแปลง และแปลง callback จาก `(match) => void` เป็นรูปแบบ napi threadsafe callback `(err, match)`
   - `searchContent` และ `hasMatch` ส่ง string/`Uint8Array` โดยตรง
2. Rust option structs ใน `grep.rs` ทำ deserialize ฟิลด์ camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`)
3. `grep` สร้าง `CancelToken` จาก `timeoutMs` + `AbortSignal` และทำงานภายใน `task::blocking("grep", ...)`

### สาขาการทำงาน

- **สาขา in-memory (pure utility)**
  - `search` → `search_sync` → `run_search` บน content bytes ที่ให้มา
  - ไม่มีการสแกน filesystem, ไม่ใช้ `fs_cache`
- **สาขาไฟล์เดียว (ขึ้นอยู่กับ filesystem)**
  - `grep_sync` resolve path, ตรวจสอบ metadata ว่าเป็นไฟล์, สตรีมสูงสุด `MAX_FILE_BYTES` ต่อไฟล์ (`4 MiB`) ผ่าน ripgrep matcher
- **สาขาไดเรกทอรี (ขึ้นอยู่กับ filesystem)**
  - เลือกค้นหาจาก cache ผ่าน `fs_cache::get_or_scan` เมื่อ `cache: true`
  - สแกนใหม่ผ่าน `fs_cache::force_rescan` เมื่อ `cache: false`
  - เลือกตรวจสอบผลลัพธ์ว่างซ้ำเมื่ออายุ cache เกิน `empty_recheck_ms()`
  - กรอง entry: เฉพาะไฟล์ + ตัวกรอง glob เสริม (`glob_util`) + ตัวกรองประเภทไฟล์เสริม (`js`, `ts`, `rust` เป็นต้น)

### ความหมายของการค้นหา/รวบรวม

- Regex engine: `grep_regex::RegexMatcherBuilder` พร้อม `ignoreCase` และ `multiline`
- การ resolve บริบท:
  - `contextBefore/contextAfter` แทนที่ `context` แบบเดิม
  - โหมดที่ไม่ใช่ content จะทำให้การรวบรวมบริบทเป็นศูนย์
- โหมดเอาต์พุต:
  - `content` => หนึ่ง `GrepMatch` ต่อผลลัพธ์
  - `count` และ `filesWithMatches` ทั้งคู่แมปเป็น count-style entries (`lineNumber=0`, `line=""`, `matchCount` ถูกตั้งค่า)
- ข้อจำกัด:
  - `offset` และ `maxCount` แบบ global ถูกใช้ข้ามไฟล์
  - เส้นทางแบบ parallel ถูกใช้เฉพาะเมื่อ `maxCount` ไม่ได้ตั้งค่าและ `offset == 0`; มิฉะนั้นเส้นทางแบบ sequential จะรักษาความหมาย global offset/limit ที่ deterministic

### การจัดรูปผลลัพธ์กลับไป JS

- ฟิลด์ของ Rust `SearchResult`/`GrepResult` แมปไปยัง TS types ผ่านการแปลง N-API object field
- Counters ถูก clamp เป็น `u32` ก่อนข้าม N-API
- Optional booleans จะถูกละไว้เว้นแต่เป็น true ในบาง paths (`limitReached`)
- Streaming callback ได้รับ `GrepMatch` ที่จัดรูปแล้วแต่ละรายการ (content หรือ count entry)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- `searchContent` คืน `SearchResult.error` สำหรับ regex/search failures แทนที่จะ throw
- `grep` reject เมื่อเกิดข้อผิดพลาดร้ายแรง (path ไม่ถูกต้อง, glob/regex ไม่ถูกต้อง, cancellation timeout/abort)
- `hasMatch` คืน `Result<bool>` และ throw เมื่อ pattern/UTF-8 decoding errors ไม่ถูกต้อง
- ข้อผิดพลาดการเปิดไฟล์/ค้นหาในการสแกนหลายไฟล์จะถูกข้ามต่อไฟล์; การสแกนดำเนินต่อไป

### การจัดการ regex ที่ผิดรูปแบบ

`grep.rs` ทำ sanitize วงเล็บปีกกาก่อนคอมไพล์ regex:

- วงเล็บปีกกาแบบ repetition ที่ไม่ถูกต้องจะถูก escape (`{`/`}` -> `\{`/`\}`) เมื่อไม่สามารถสร้าง `{N}`, `{N,}`, `{N,M}` ได้
- สิ่งนี้ป้องกันไม่ให้ literal-template fragments ทั่วไป (เช่น `${platform}`) ล้มเหลวเป็น malformed repetition
- Regex syntax ที่ไม่ถูกต้องที่เหลือยังคงคืน regex error

## 2) การค้นหาไฟล์ (`glob`) และการค้นหา path แบบ fuzzy (`fuzzyFind`)

`glob` และ `fuzzyFind` ใช้ `fs_cache` scans ร่วมกัน; logic การจับคู่แตกต่างกัน

### flow ของ `glob`

1. TS wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`
   - ค่าเริ่มต้น: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`
2. Rust `glob` สร้าง `GlobConfig` และคอมไพล์ pattern ผ่าน `glob_util::compile_glob`
3. แหล่งที่มาของ entry:
   - `cache=true` => `get_or_scan` + เลือก `force_rescan` เมื่อ stale-empty
   - `cache=false` => `force_rescan(..., store=false)` (สแกนใหม่เท่านั้น)
4. การกรอง:
   - ข้าม `.git` เสมอ
   - ข้าม `node_modules` เว้นแต่ร้องขอ (`includeNodeModules` หรือ pattern ที่กล่าวถึง node_modules)
   - ใช้การจับคู่ glob
   - ใช้ตัวกรองประเภทไฟล์; ตัวกรอง symlink `file/dir` resolve target metadata
5. เลือกจัดเรียงตาม mtime จากมากไปน้อย (`sortByMtime`) ก่อนตัดให้เหลือ `maxResults`

### flow ของ `fuzzyFind` (implement ใน `fd.rs`)

1. TS wrapper ถูก export จากโมดูล `grep` แต่ Rust implementation อยู่ใน `fd.rs`
2. แหล่งสแกนร่วมจาก `fs_cache` พร้อมการแยก cache/no-cache และนโยบายตรวจสอบ stale-empty ซ้ำเหมือนกัน
3. การให้คะแนน:
   - คะแนน fuzzy แบบ exact / starts-with / contains / subsequence-based
   - เส้นทางการให้คะแนนที่ normalize ด้วย separator/punctuation
   - directory bonus และ tie-break ที่ deterministic (`score desc` จากนั้น `path asc`)
4. Symlink entries จะถูกยกเว้นจากผลลัพธ์ fuzzy

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- Glob pattern ไม่ถูกต้อง => error จาก `glob_util::compile_glob`
- Search root ต้องเป็นไดเรกทอรีที่มีอยู่ (`resolve_search_path`), มิฉะนั้น error
- Cancellation/timeouts แพร่กระจายเป็น abort errors ผ่านการตรวจสอบ `CancelToken::heartbeat()` ใน loops

### การจัดการ glob ที่ผิดรูปแบบ

`glob_util::build_glob_pattern` มีความยืดหยุ่น:

- Normalize `\` เป็น `/`
- เติม `**/` ข้างหน้า simple recursive patterns อัตโนมัติเมื่อ `recursive=true`
- ปิดกลุ่ม `{...` alternation ที่ไม่สมดุลอัตโนมัติก่อนคอมไพล์

## 3) วงจรชีวิตของ shared scan/cache (`fs_cache`)

`fs_cache` เก็บผลลัพธ์การสแกนเป็น normalized relative entries (`path`, `fileType`, optional `mtime`) โดยมี key ดังนี้:

- canonical search root
- `include_hidden`
- `use_gitignore`

### การเปลี่ยนสถานะของ cache

1. **พลาด / ปิดใช้งาน**
   - TTL เป็น `0` หรือ key ไม่มี/หมดอายุ -> `collect_entries` ใหม่
2. **ตรง**
   - อายุ entry `< cache_ttl_ms()` -> คืน cached entries + `cache_age_ms`
3. **ตรวจสอบ stale-empty ซ้ำ** (นโยบายผู้เรียกใน `glob`/`grep`/`fd`)
   - หาก query ให้ผลลัพธ์ศูนย์รายการและ `cache_age_ms >= empty_recheck_ms()`, บังคับสแกนซ้ำหนึ่งครั้ง
4. **การ invalidation**
   - `invalidateFsScanCache(path?)`:
     - ไม่มี arg: ล้าง keys ทั้งหมด
     - path arg: ลบ keys ที่ root เป็น prefix ของ target path นั้น

### การแลกเปลี่ยนของผลลัพธ์ stale

- Cache ให้ความสำคัญกับ low-latency ในการสแกนซ้ำมากกว่าความสอดคล้องทันที
- หน้าต่าง TTL สามารถคืนผลบวก/ลบ stale ได้
- การตรวจสอบผลลัพธ์ว่างซ้ำลดผลลบ stale สำหรับการสแกน cache เก่า โดยแลกกับการสแกนเพิ่มอีกหนึ่งครั้ง
- การ invalidation แบบชัดเจนเป็น hook ความถูกต้องที่ตั้งใจไว้หลังจากการเปลี่ยนแปลงไฟล์

## 4) ANSI text utilities (`text`)

เหล่านี้เป็น pure utilities แบบ in-memory (ไม่มีการสแกน filesystem)

### ขอบเขตและความรับผิดชอบ

- **`text.rs` เป็นเจ้าของ terminal-cell semantics**:
  - การ parse ANSI sequence
  - width และ slicing ที่ aware ต่อ grapheme
  - พฤติกรรม wrap/truncate/sanitize
- **การตัดบรรทัดใน `grep.rs` (`maxColumns`) เป็นคนละส่วน**:
  - การตัดที่ character-boundary แบบง่ายของบรรทัดที่จับคู่พร้อม `...`
  - ไม่รักษาสถานะ ANSI และไม่ aware ต่อ terminal-cell width

### พฤติกรรมสำคัญ

- `wrapTextWithAnsi`: wrap ตาม visible width, ส่ง SGR codes ที่ active ข้ามบรรทัดที่ถูก wrap
- `truncateToWidth`: ตัดที่ visible-cell พร้อมนโยบาย ellipsis (`Unicode`, `Ascii`, `Omit`), เลือก right padding, และ fast-path คืน JS string เดิมเมื่อไม่มีการเปลี่ยนแปลง
- `sliceWithWidth`: column slicing พร้อมเลือกบังคับ strict width
- `extractSegments`: แยก segments ก่อน/หลังรอบ overlay พร้อมกู้คืนสถานะ ANSI สำหรับ `after` segment
- `sanitizeText`: ลบ ANSI escapes + control chars, ทิ้ง lone surrogates, normalize CR/LF โดยลบ `\r`
- `visibleWidth`: นับ visible terminal cells (tabs ใช้ `TAB_WIDTH` คงที่จาก Rust implementation)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ฟังก์ชัน text โดยทั่วไปคืนเอาต์พุตที่ถูกแปลงอย่าง deterministic; ข้อผิดพลาดจำกัดอยู่ที่ขอบเขตการแปลง JS string (ความล้มเหลวในการแปลง argument ของ N-API)

## 5) Syntax highlighting (`highlight`)

`highlight.rs` เป็น pure transformation (ไม่มี FS, ไม่มี cache)

### Flow

1. Wrapper ส่งต่อ `code`, `lang` เสริม, และ ANSI color palette
2. Rust resolve syntax โดย:
   - ค้นหา token/name
   - ค้นหา extension
   - ใช้ alias table fallback (`ts/tsx/js -> JavaScript` เป็นต้น)
   - fallback เป็น plain text syntax เมื่อ resolve ไม่ได้
3. Parse แต่ละบรรทัดด้วย syntect `ParseState` และ scope stack
4. แมป scopes ไปยัง 11 หมวดหมู่สี semantic และ inject/reset ANSI color codes

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- ความล้มเหลวในการ parse ต่อบรรทัดจะไม่ทำให้การเรียกล้มเหลว: บรรทัดนั้นจะถูกเพิ่มแบบไม่ highlight และการประมวลผลดำเนินต่อไป
- ภาษาที่ไม่รู้จัก/ไม่รองรับ fallback เป็น plain text syntax

## Pure utility เทียบกับ flows ที่ขึ้นอยู่กับ filesystem

| Flow | การเข้าถึง Filesystem | Shared cache | หมายเหตุ |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | ไม่ | ไม่ | regex บน bytes/string ที่ให้มาเท่านั้น |
| ฟังก์ชันโมดูล `text` | ไม่ | ไม่ | ANSI/width/sanitization เท่านั้น |
| ฟังก์ชันโมดูล `highlight` | ไม่ | ไม่ | syntax + ANSI coloring เท่านั้น |
| `glob` | ใช่ | เลือกได้ | สแกนไดเรกทอรี + กรอง glob |
| `fuzzyFind` | ใช่ | เลือกได้ | สแกนไดเรกทอรี + ให้คะแนน fuzzy |
| `grep` (file/dir path) | ใช่ | เลือกได้ (โหมด dir) | ripgrep บนไฟล์, ตัวกรอง/callback เสริม |

## สรุปวงจรชีวิตแบบ end-to-end

1. ผู้เรียกเรียก TS wrapper พร้อม typed options
2. Wrapper normalize ค่าเริ่มต้น (โดยเฉพาะ `glob`) และส่งต่อไปยัง `native.*` export
3. Rust ตรวจสอบ/normalize options และสร้าง matcher/search config
4. สำหรับ filesystem flows, entries จะถูกสแกน (cache hit/miss/rescan) จากนั้นกรอง/ให้คะแนน
5. Worker loops เรียก cancel heartbeat เป็นระยะ; timeout/abort สามารถยุติการทำงาน
6. Rust จัดรูปเอาต์พุตเป็น N-API objects (`lineNumber`, `matchCount`, `limitReached` เป็นต้น)
7. TS wrapper คืน typed JS objects (และ per-match callbacks เสริมสำหรับ `grep`/`glob`)
