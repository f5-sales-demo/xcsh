---
title: Filesystem Scan Cache Architecture
description: >-
  Filesystem scan cache contract for fast file discovery with
  stale-while-revalidate semantics.
sidebar:
  order: 8
  label: Filesystem scan cache
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# สัญญาสถาปัตยกรรม Filesystem Scan Cache

เอกสารนี้กำหนดสัญญาปัจจุบันสำหรับ shared filesystem scan cache ที่ implement ใน Rust (`crates/pi-natives/src/fs_cache.rs`) และถูกใช้งานโดย native discovery/search APIs ที่เปิดให้ `packages/coding-agent`

## แคชนี้คืออะไร

แคชจัดเก็บรายการ directory-scan entry แบบเต็ม (`GlobMatch[]`) โดยมีคีย์ตาม scan scope และ traversal policy จากนั้นให้การดำเนินการระดับสูงกว่า (glob filtering, fuzzy scoring, grep file selection) ทำงานกับ cached entries เหล่านั้น

เป้าหมายหลัก:

- หลีกเลี่ยง filesystem walks ซ้ำๆ สำหรับการเรียก discovery/search ซ้ำ
- รักษาความสอดคล้องระหว่าง `glob`, `fuzzyFind` และ `grep` เมื่อใช้ scan policy เดียวกัน
- อนุญาตการกู้คืน staleness อย่างชัดเจนสำหรับผลลัพธ์ว่างเปล่า และการ invalidation อย่างชัดเจนหลังจากการเปลี่ยนแปลงไฟล์

## ความเป็นเจ้าของและ public surface

- การ implement แคชและนโยบาย: `crates/pi-natives/src/fs_cache.rs`
- Native consumers:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JS binding/export:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agent mutation invalidation helpers:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## การแบ่ง Cache key (สัญญาที่แน่นอน)

แต่ละ entry มีคีย์ตาม:

- เส้นทาง `root` directory ที่ canonicalized แล้ว
- ค่า boolean `include_hidden`
- ค่า boolean `use_gitignore`

ผลกระทบ:

- การ scan แบบ hidden และ non-hidden จะ **ไม่** ใช้ entries ร่วมกัน
- การ scan แบบ gitignore-respecting และ ignore-disabled จะ **ไม่** ใช้ entries ร่วมกัน
- Consumer ต้องส่ง semantics ที่คงที่สำหรับพฤติกรรม hidden/gitignore; การเปลี่ยน flag ใดก็ตามจะสร้าง cache partition ที่แตกต่างกัน

การรวม `node_modules` **ไม่** อยู่ใน cache key แคชจัดเก็บ entries โดยรวม `node_modules` ไว้; การ filtering เฉพาะ consumer จะถูกใช้หลังจากการดึงข้อมูล

## พฤติกรรมการเก็บรวบรวม Scan

การ populate แคชใช้ deterministic walker (`ignore::WalkBuilder`) ที่กำหนดค่าโดย `include_hidden` และ `use_gitignore`:

- `follow_links(false)`
- เรียงตามเส้นทางไฟล์
- `.git` จะถูกข้ามเสมอ
- `node_modules` จะถูกเก็บรวบรวมเสมอในเวลา cache-scan (และ filtered ภายหลังตามต้องการ)
- file type + `mtime` ของ entry จะถูกเก็บผ่าน `symlink_metadata`

Search roots จะถูก resolve โดย `resolve_search_path`:

- เส้นทางสัมพัทธ์จะถูก resolve จาก cwd ปัจจุบัน
- เป้าหมายต้องเป็น directory ที่มีอยู่
- root จะถูก canonicalized เมื่อทำได้

## นโยบายความสดใหม่และการ eviction

นโยบายระดับ global (สามารถ override ผ่าน environment):

- `FS_SCAN_CACHE_TTL_MS` (ค่าเริ่มต้น `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (ค่าเริ่มต้น `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (ค่าเริ่มต้น `16`)

พฤติกรรม:

- `get_or_scan(...)`
  - ถ้า TTL เป็น `0`: ข้ามแคชทั้งหมด ทำ fresh scan เสมอ (`cache_age_ms = 0`)
  - เมื่อ cache hit ภายใน TTL: ส่งคืน cached entries + `cache_age_ms` ที่ไม่ใช่ศูนย์
  - เมื่อ hit ที่หมดอายุ: evict key, rescan, เก็บ entry ใหม่
- การบังคับจำนวน entry สูงสุดจะ evict ตามลำดับเก่าที่สุดก่อนโดย `created_at`

## การ recheck ผลลัพธ์ว่างเปล่าแบบเร็ว (แยกจาก normal hits)

Cache hit ปกติ:

- cache hit ภายใน TTL จะส่งคืน cached entries และไม่ทำอะไรอื่น

การ recheck ผลลัพธ์ว่างเปล่าแบบเร็ว:

- นี่เป็นนโยบาย **ฝั่ง caller** ที่ใช้ `ScanResult.cache_age_ms`
- ถ้าผลลัพธ์ที่ filtered/query เป็นค่าว่างและอายุ cached scan มีค่าอย่างน้อย `empty_recheck_ms()`, caller จะทำ `force_rescan(...)` หนึ่งครั้งและลองใหม่
- มีจุดประสงค์เพื่อลดผลลัพธ์ stale-negative เมื่อไฟล์ถูกเพิ่มเมื่อเร็วๆ นี้แต่แคชยังอยู่ภายใน TTL

Consumer ปัจจุบัน:

- `glob`: recheck เมื่อ filtered matches ว่างเปล่าและอายุ scan เกิน threshold
- `fuzzyFind` (`fd.rs`): recheck เฉพาะเมื่อ query ไม่ว่างและ scored matches ว่างเปล่า
- `grep`: recheck เมื่อรายการ candidate file ที่เลือกว่างเปล่า

## ค่าเริ่มต้นของ Consumer และการใช้งานแคช

แคชเป็นแบบ opt-in ใน APIs ที่เปิดให้ใช้ทั้งหมด (`cache?: boolean`, ค่าเริ่มต้น `false`)

ค่าเริ่มต้นปัจจุบันใน native APIs:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, และ cache scan จะใช้ `use_gitignore=true` เสมอ

Coding-agent callers ในปัจจุบัน:

- การค้นหา mention candidate ปริมาณสูงจะเปิดใช้งานแคช:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - profile: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- การรวม `grep` ระดับ tool ปัจจุบันปิดใช้งาน scan cache (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## สัญญาการ Invalidation

Native invalidation entrypoint:

- `invalidateFsScanCache(path?: string)`
  - มี `path`: ลบ cache entries ที่ root เป็น prefix ของเส้นทางเป้าหมาย
  - ไม่มี path: ล้าง scan cache entries ทั้งหมด

รายละเอียดการจัดการเส้นทาง:

- เส้นทาง invalidation แบบสัมพัทธ์จะถูก resolve จาก cwd
- invalidation พยายามทำ canonicalization
- ถ้าเป้าหมายไม่มีอยู่ (เช่น ลบแล้ว) จะ fallback โดย canonicalize parent และแนบ filename กลับเมื่อทำได้
- สิ่งนี้รักษาพฤติกรรม invalidation สำหรับ create/delete/rename ที่ฝั่งหนึ่งอาจไม่มีอยู่

## ความรับผิดชอบของ Coding-agent mutation flow

โค้ด Coding-agent ต้อง invalidate หลังจาก filesystem mutations ที่สำเร็จ

Central helpers:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalidate ทั้งสองฝั่งเมื่อเส้นทางแตกต่างกัน)

Mutation tool callsites ปัจจุบัน:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (hashline/patch/replace flows)

กฎ: ถ้า flow ใดเปลี่ยนแปลงเนื้อหาหรือตำแหน่ง filesystem และข้าม helpers เหล่านี้ จะเกิดบั๊ก cache staleness ตามที่คาดหมาย

## การเพิ่ม cache consumer ใหม่อย่างปลอดภัย

เมื่อแนะนำการใช้แคชใน scanner/search path ใหม่:

1. **ใช้ scan policy inputs ที่คงที่**
   - ตัดสินใจ semantics ของ hidden/gitignore ก่อน
   - ส่งค่าเหล่านั้นอย่างสม่ำเสมอไปยัง `get_or_scan`/`force_rescan` เพื่อให้ cache partitions เป็นไปอย่างตั้งใจ

2. **ถือว่าข้อมูลแคชเป็นแค่ pre-filtered ตาม traversal policy เท่านั้น**
   - ใช้ tool-specific filtering (glob patterns, type filters, node_modules rules) หลังจากการดึงข้อมูล
   - อย่าสันนิษฐานว่า cached entries สะท้อน higher-level filters ของคุณแล้ว

3. **Implement การ recheck ผลลัพธ์ว่างเปล่าแบบเร็วเฉพาะสำหรับความเสี่ยง stale-negative**
   - ใช้ `scan.cache_age_ms >= empty_recheck_ms()`
   - ลองใหม่หนึ่งครั้งด้วย `force_rescan(..., store=true, ...)`
   - แยกเส้นทางนี้ออกจาก logic cache-hit ปกติ

4. **เคารพโหมด no-cache อย่างชัดเจน**
   - เมื่อ caller ปิดใช้งานแคช ให้เรียก `force_rescan(..., store=false, ...)`
   - อย่า populate shared cache ใน request path แบบ no-cache

5. **เชื่อมต่อ mutation invalidation สำหรับ write path ใหม่ทุกอัน**
   - หลังจาก write/edit/delete/rename ที่สำเร็จ ให้เรียก coding-agent invalidation helper
   - สำหรับ rename/move ให้ invalidate ทั้งเส้นทางเก่าและใหม่

6. **อย่าเพิ่ม TTL knobs แบบ per-call**
   - สัญญาปัจจุบันเป็นนโยบาย global เท่านั้น (กำหนดค่าผ่าน env) ไม่มี TTL override แบบ per-request

## ขอบเขตที่ทราบ

- ขอบเขตของแคชเป็นแบบ process-local in-memory (`DashMap`) ไม่คงอยู่ข้าม process restarts
- แคชเก็บ scan entries ไม่ใช่ผลลัพธ์สุดท้ายของ tool
- `glob`/`fuzzyFind`/`grep` ใช้ scan entries ร่วมกันเฉพาะเมื่อ key dimensions (`root`, `hidden`, `gitignore`) ตรงกัน
- `.git` จะถูกยกเว้นเสมอในเวลา scan collection โดยไม่คำนึงถึง caller options
