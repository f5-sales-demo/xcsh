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

เอกสารนี้กำหนดสัญญาปัจจุบันสำหรับ shared filesystem scan cache ที่ถูกนำไปใช้งานใน Rust (`crates/pi-natives/src/fs_cache.rs`) และถูกใช้งานโดย native discovery/search APIs ที่เปิดเผยให้กับ `packages/coding-agent`

## แคชนี้คืออะไร

แคชจัดเก็บรายการ directory-scan entry ทั้งหมด (`GlobMatch[]`) โดยมีคีย์เป็น scan scope และ traversal policy จากนั้นให้การดำเนินการระดับสูง (glob filtering, fuzzy scoring, grep file selection) ทำงานกับ cached entries เหล่านั้น

เป้าหมายหลัก:

- หลีกเลี่ยงการเดินสำรวจ filesystem ซ้ำๆ สำหรับการเรียก discovery/search ที่ทำซ้ำ
- รักษาความสอดคล้องระหว่าง `glob`, `fuzzyFind` และ `grep` เมื่อพวกมันใช้ scan policy เดียวกัน
- อนุญาตให้กู้คืนจากสถานะล้าสมัยอย่างชัดเจนสำหรับผลลัพธ์ว่าง และการทำให้แคชไม่ถูกต้องอย่างชัดเจนหลังจากการเปลี่ยนแปลงไฟล์

## ความเป็นเจ้าของและ public surface

- การนำไปใช้งานและนโยบายของแคช: `crates/pi-natives/src/fs_cache.rs`
- Native consumers:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JS binding/export:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- ตัวช่วยการทำให้แคชไม่ถูกต้องจากการเปลี่ยนแปลงของ Coding-agent:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## การแบ่งพาร์ทิชันคีย์แคช (สัญญาที่แน่นอน)

แต่ละ entry มีคีย์เป็น:

- เส้นทางไดเรกทอรี `root` ที่ถูก canonicalized
- `include_hidden` boolean
- `use_gitignore` boolean

ผลที่ตามมา:

- การสแกน hidden และ non-hidden **ไม่** ใช้ entries ร่วมกัน
- การสแกนที่เคารพ gitignore และการสแกนที่ปิดใช้งาน ignore **ไม่** ใช้ entries ร่วมกัน
- ผู้ใช้ต้องส่ง semantics ที่คงที่สำหรับพฤติกรรม hidden/gitignore การเปลี่ยน flag ใดก็ตามจะสร้าง cache partition ที่แตกต่างกัน

การรวม `node_modules` **ไม่** อยู่ในคีย์แคช แคชจัดเก็บ entries ที่รวม `node_modules` ไว้แล้ว โดยการกรองแยกต่อ consumer จะถูกนำไปใช้หลังจากดึงข้อมูล

## พฤติกรรมการรวบรวมข้อมูลการสแกน

การเติมข้อมูลแคชใช้ walker ที่กำหนดได้ (`ignore::WalkBuilder`) ซึ่งกำหนดค่าโดย `include_hidden` และ `use_gitignore`:

- `follow_links(false)`
- เรียงลำดับตามเส้นทางไฟล์
- `.git` จะถูกข้ามเสมอ
- `node_modules` จะถูกรวบรวมเสมอในเวลาสแกนแคช (และกรองออกทีหลังตามต้องการ)
- ชนิดไฟล์ของ entry + `mtime` ถูกบันทึกผ่าน `symlink_metadata`

ราก (root) ของการค้นหาถูก resolve โดย `resolve_search_path`:

- เส้นทางแบบสัมพัทธ์จะถูก resolve เทียบกับ cwd ปัจจุบัน
- เป้าหมายต้องเป็นไดเรกทอรีที่มีอยู่
- root จะถูก canonicalize เมื่อเป็นไปได้

## นโยบายความสดใหม่และการถอดออก

นโยบายส่วนกลาง (สามารถแทนที่ได้ผ่าน environment):

- `FS_SCAN_CACHE_TTL_MS` (ค่าเริ่มต้น `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (ค่าเริ่มต้น `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (ค่าเริ่มต้น `16`)

พฤติกรรม:

- `get_or_scan(...)`
  - ถ้า TTL เป็น `0`: ข้ามแคชทั้งหมด สแกนใหม่เสมอ (`cache_age_ms = 0`)
  - เมื่อ cache hit ภายใน TTL: ส่งคืน cached entries + `cache_age_ms` ที่ไม่เป็นศูนย์
  - เมื่อ hit หมดอายุ: ถอดคีย์ออก สแกนใหม่ จัดเก็บ entry ใหม่
- การบังคับจำนวน entry สูงสุดจะถอดรายการที่เก่าที่สุดก่อนตาม `created_at`

## การตรวจสอบซ้ำอย่างรวดเร็วสำหรับผลลัพธ์ว่าง (แยกจาก normal hits)

Normal cache hit:

- cache hit ภายใน TTL จะส่งคืน cached entries และไม่ทำอะไรเพิ่มเติม

การตรวจสอบซ้ำอย่างรวดเร็วสำหรับผลลัพธ์ว่าง:

- นี่เป็นนโยบาย **ฝั่งผู้เรียก** ที่ใช้ `ScanResult.cache_age_ms`
- หากผลลัพธ์ที่กรองแล้ว/query ว่างเปล่า และอายุ cached scan มากกว่าหรือเท่ากับ `empty_recheck_ms()` ผู้เรียกจะทำ `force_rescan(...)` หนึ่งครั้งและลองใหม่
- มีไว้เพื่อลดผลลัพธ์ stale-negative เมื่อไฟล์ถูกเพิ่มเมื่อเร็วๆ นี้แต่แคชยังอยู่ภายใน TTL

ผู้ใช้ปัจจุบัน:

- `glob`: ตรวจสอบซ้ำเมื่อ filtered matches ว่างเปล่าและอายุสแกนเกินค่าขีดจำกัด
- `fuzzyFind` (`fd.rs`): ตรวจสอบซ้ำเฉพาะเมื่อ query ไม่ว่างและ scored matches ว่างเปล่า
- `grep`: ตรวจสอบซ้ำเมื่อรายการไฟล์ผู้สมัครที่เลือกว่างเปล่า

## ค่าเริ่มต้นของ consumer และการใช้งานแคช

แคชเป็นแบบ opt-in บน API ที่เปิดเผยทั้งหมด (`cache?: boolean`, ค่าเริ่มต้น `false`)

ค่าเริ่มต้นปัจจุบันใน native APIs:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false` และ cache scan จะใช้ `use_gitignore=true` เสมอ

ผู้เรียกจาก Coding-agent ในปัจจุบัน:

- การค้นหาผู้สมัคร mention ปริมาณสูงเปิดใช้งานแคช:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - โปรไฟล์: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- การรวม `grep` ระดับเครื่องมือปัจจุบันปิดใช้งาน scan cache (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## สัญญาการทำให้แคชไม่ถูกต้อง

จุดเข้า native invalidation:

- `invalidateFsScanCache(path?: string)`
  - กับ `path`: ลบ cache entries ที่ root เป็น prefix ของเส้นทางเป้าหมาย
  - โดยไม่มี path: ล้าง scan cache entries ทั้งหมด

รายละเอียดการจัดการเส้นทาง:

- เส้นทาง invalidation แบบสัมพัทธ์จะถูก resolve เทียบกับ cwd
- invalidation พยายาม canonicalization
- หากเป้าหมายไม่มีอยู่ (เช่น ลบไปแล้ว) จะ fallback canonicalize parent และแนบ filename กลับเมื่อเป็นไปได้
- สิ่งนี้รักษาพฤติกรรม invalidation สำหรับ create/delete/rename ที่ฝั่งใดฝั่งหนึ่งอาจไม่มีอยู่

## ความรับผิดชอบของขั้นตอนการเปลี่ยนแปลงใน Coding-agent

โค้ด Coding-agent ต้องทำให้แคชไม่ถูกต้องหลังจากการเปลี่ยนแปลง filesystem ที่สำเร็จ

ตัวช่วยส่วนกลาง:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (ทำให้ไม่ถูกต้องทั้งสองฝั่งเมื่อเส้นทางแตกต่างกัน)

callsites ของเครื่องมือเปลี่ยนแปลงปัจจุบัน:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (ขั้นตอน hashline/patch/replace)

กฎ: หากขั้นตอนใดเปลี่ยนแปลงเนื้อหาหรือตำแหน่งของ filesystem และข้ามตัวช่วยเหล่านี้ จะเกิดบั๊กแคชล้าสมัยตามที่คาดไว้

## การเพิ่ม cache consumer ใหม่อย่างปลอดภัย

เมื่อแนะนำการใช้แคชในเส้นทาง scanner/search ใหม่:

1. **ใช้ scan policy inputs ที่คงที่**
   - ตัดสินใจ hidden/gitignore semantics ก่อน
   - ส่งพวกมันอย่างสม่ำเสมอไปยัง `get_or_scan`/`force_rescan` เพื่อให้ cache partitions เป็นไปตามเจตนา

2. **ถือว่าข้อมูลแคชถูกกรองล่วงหน้าเฉพาะตาม traversal policy เท่านั้น**
   - นำการกรองเฉพาะเครื่องมือ (glob patterns, type filters, กฎ node_modules) มาใช้หลังจากดึงข้อมูล
   - อย่าสันนิษฐานว่า cached entries สะท้อนตัวกรองระดับสูงของคุณแล้ว

3. **นำการตรวจสอบซ้ำอย่างรวดเร็วสำหรับผลลัพธ์ว่างมาใช้เฉพาะสำหรับความเสี่ยง stale-negative**
   - ใช้ `scan.cache_age_ms >= empty_recheck_ms()`
   - ลองใหม่หนึ่งครั้งด้วย `force_rescan(..., store=true, ...)`
   - แยกเส้นทางนี้ออกจาก normal cache-hit logic

4. **เคารพโหมด no-cache อย่างชัดเจน**
   - เมื่อผู้เรียกปิดใช้งานแคช ให้เรียก `force_rescan(..., store=false, ...)`
   - อย่าเติมข้อมูล shared cache ในเส้นทางคำขอแบบ no-cache

5. **เชื่อมต่อ mutation invalidation สำหรับเส้นทางเขียนใหม่ทุกเส้นทาง**
   - หลังจาก write/edit/delete/rename ที่สำเร็จ ให้เรียกตัวช่วย invalidation ของ coding-agent
   - สำหรับ rename/move ให้ทำให้ไม่ถูกต้องทั้งเส้นทางเก่าและใหม่

6. **อย่าเพิ่มปุ่มปรับ TTL แบบ per-call**
   - สัญญาปัจจุบันเป็นนโยบายส่วนกลางเท่านั้น (กำหนดค่าผ่าน env) ไม่มีการแทนที่ TTL แบบ per-request

## ขอบเขตที่ทราบ

- ขอบเขตแคชเป็นแบบ in-memory ภายในกระบวนการ (`DashMap`) ไม่ถูกจัดเก็บถาวรข้ามการรีสตาร์ทกระบวนการ
- แคชจัดเก็บ scan entries ไม่ใช่ผลลัพธ์สุดท้ายของเครื่องมือ
- `glob`/`fuzzyFind`/`grep` ใช้ scan entries ร่วมกันเฉพาะเมื่อมิติของคีย์ (`root`, `hidden`, `gitignore`) ตรงกัน
- `.git` จะถูกยกเว้นเสมอในเวลารวบรวมข้อมูลการสแกน โดยไม่คำนึงถึงตัวเลือกของผู้เรียก
