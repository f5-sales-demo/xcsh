---
title: สถาปัตยกรรมต้นไม้เซสชัน
description: >-
  สถาปัตยกรรมต้นไม้เซสชันพร้อมการแตกสาขา การนำทาง
  และความสัมพันธ์การสนทนาแบบพ่อแม่-ลูก
sidebar:
  order: 2
  label: สถาปัตยกรรมต้นไม้
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# สถาปัตยกรรมต้นไม้เซสชัน (ปัจจุบัน)

อ้างอิง: [session.md](./session.md)

เอกสารนี้อธิบายวิธีการทำงานของการนำทางต้นไม้เซสชันในปัจจุบัน ได้แก่ โมเดลต้นไม้ในหน่วยความจำ กฎการเคลื่อนที่ของใบ พฤติกรรมการแตกสาขา และการผสานรวมส่วนขยาย/เหตุการณ์

## ระบบย่อยนี้คืออะไร

เซสชันถูกจัดเก็บเป็นบันทึกรายการแบบ append-only แต่พฤติกรรมขณะรันไทม์เป็นแบบต้นไม้:

- ทุกรายการที่ไม่ใช่ส่วนหัวมี `id` และ `parentId`
- ตำแหน่งที่ใช้งานอยู่คือ `leafId` ใน `SessionManager`
- การต่อท้ายรายการจะสร้างรายการลูกของใบปัจจุบันเสมอ
- การแตกสาขา **ไม่** เขียนทับประวัติ แต่เพียงเปลี่ยนตำแหน่งที่ใบชี้ไปก่อนการต่อท้ายครั้งถัดไป

ไฟล์หลัก:

- `src/session/session-manager.ts` — โมเดลข้อมูลต้นไม้ การสำรวจ การเคลื่อนที่ของใบ การแยกสาขา/เซสชัน
- `src/session/agent-session.ts` — ขั้นตอนการนำทาง `/tree` การสรุป การปล่อยฮุก/เหตุการณ์
- `src/modes/components/tree-selector.ts` — พฤติกรรม UI ต้นไม้แบบโต้ตอบและการกรอง
- `src/modes/controllers/selector-controller.ts` — การประสานงาน selector สำหรับ `/tree` และ `/branch`
- `src/modes/controllers/input-controller.ts` — การกำหนดเส้นทางคำสั่ง (`/tree`, `/branch`, พฤติกรรม double-escape)
- `src/session/messages.ts` — การแปลงรายการ `branch_summary`, `compaction` และ `custom_message` เป็นข้อความบริบท LLM

## โมเดลข้อมูลต้นไม้ใน `SessionManager`

ดัชนีขณะรันไทม์:

- `#byId: Map<string, SessionEntry>` — การค้นหาแบบรวดเร็วสำหรับรายการใดก็ได้
- `#leafId: string | null` — ตำแหน่งปัจจุบันในต้นไม้
- `#labelsById: Map<string, string>` — ป้ายกำกับที่แก้ไขแล้วตาม id รายการเป้าหมาย

Tree API:

- `getBranch(fromId?)` เดินตามลิงก์พ่อแม่ไปยังรากและคืนค่าเส้นทาง root→node
- `getTree()` คืนค่า `SessionTreeNode[]` (`entry`, `children`, `label`)
  - ลิงก์พ่อแม่กลายเป็นอาร์เรย์ลูก
  - รายการที่ไม่มีพ่อแม่จะถูกถือว่าเป็นราก
  - ลูกจะถูกจัดเรียงจากเก่าไปใหม่ตาม timestamp
- `getChildren(parentId)` คืนค่าลูกโดยตรง
- `getLabel(id)` แก้ไขป้ายกำกับปัจจุบันจาก `labelsById`

`getTree()` คือการฉายภาพขณะรันไทม์ การคงอยู่ยังคงเป็นรายการ JSONL แบบ append-only

## ความหมายของการเคลื่อนที่ใบ

มีการดำเนินการพื้นฐานการเคลื่อนที่ใบสามแบบ:

1. `branch(entryId)`
   - ตรวจสอบว่ารายการมีอยู่
   - ตั้งค่า `leafId = entryId`
   - ไม่มีการเขียนรายการใหม่

2. `resetLeaf()`
   - ตั้งค่า `leafId = null`
   - การต่อท้ายครั้งถัดไปจะสร้างรายการรากใหม่ (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - รับ `branchFromId: string | null`
   - ตั้งค่า `leafId = branchFromId`
   - ต่อท้ายรายการ `branch_summary` เป็นลูกของใบนั้น
   - เมื่อ `branchFromId` เป็น `null` จะบันทึก `fromId` เป็น `"root"`

## พฤติกรรมการนำทาง `/tree` (ไฟล์เซสชันเดียวกัน)

`AgentSession.navigateTree()` คือการนำทาง ไม่ใช่การแยกไฟล์

ขั้นตอน:

1. ตรวจสอบเป้าหมายและคำนวณเส้นทางที่ถูกละทิ้ง (`collectEntriesForBranchSummary`)
2. ปล่อย `session_before_tree` พร้อม `TreePreparation`
3. สรุปรายการที่ถูกละทิ้งโดยเลือกได้ (สรุปที่ฮุกจัดหามาหรือตัวสรุปในตัว)
4. คำนวณเป้าหมายใบใหม่:
   - การเลือกข้อความ **user**: ใบย้ายไปยังพ่อแม่ของมัน และข้อความจะถูกส่งกลับสำหรับการเติมล่วงหน้าของ editor
   - การเลือก **custom_message**: กฎเดียวกับข้อความ user (ใบ = พ่อแม่, ข้อความเติมล่วงหน้า editor)
   - การเลือกรายการอื่นใด: ใบ = id รายการที่เลือก
5. ใช้การเคลื่อนที่ใบ:
   - มีสรุป: `branchWithSummary(newLeafId, ...)`
   - ไม่มีสรุปและ `newLeafId === null`: `resetLeaf()`
   - มิฉะนั้น: `branch(newLeafId)`
6. สร้างบริบท agent ใหม่จากใบใหม่และปล่อย `session_tree`

สำคัญ: รายการสรุปจะแนบที่ **ตำแหน่งการนำทางใหม่** ไม่ใช่ที่ส่วนท้ายของสาขาที่ถูกละทิ้ง

## พฤติกรรม `/branch` (ไฟล์เซสชันใหม่)

`/branch` และ `/tree` แตกต่างกันโดยเจตนา:

- `/tree` นำทางภายในไฟล์เซสชันปัจจุบัน
- `/branch` สร้างไฟล์สาขาเซสชันใหม่ (หรือการแทนที่ในหน่วยความจำสำหรับโหมดที่ไม่คงอยู่)

ขั้นตอน `/branch` ที่ผู้ใช้เห็น (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- แหล่งที่มาของสาขาต้องเป็น **ข้อความ user**
- ข้อความ user ที่เลือกจะถูกแยกออกมาสำหรับการเติมล่วงหน้าของ editor
- หากข้อความ user ที่เลือกเป็นราก (`parentId === null`): เริ่มเซสชันใหม่ผ่าน `newSession({ parentSession: previousSessionFile })`
- มิฉะนั้น: `createBranchedSession(selectedEntry.parentId)` เพื่อแยกประวัติไปยังขอบเขตพรอมต์ที่เลือก

รายละเอียด `SessionManager.createBranchedSession(leafId)`:

- สร้างเส้นทาง root→leaf ผ่าน `getBranch(leafId)` โยนข้อผิดพลาดหากไม่พบ
- ยกเว้นรายการ `label` ที่มีอยู่จากเส้นทางที่คัดลอก
- สร้างรายการป้ายกำกับใหม่จาก `labelsById` ที่แก้ไขแล้วสำหรับรายการที่ยังคงอยู่ในเส้นทาง
- โหมดคงอยู่: เขียนไฟล์ JSONL ใหม่และเปลี่ยน manager ไปใช้ไฟล์นั้น คืนค่าเส้นทางไฟล์ใหม่
- โหมดในหน่วยความจำ: แทนที่รายการในหน่วยความจำ คืนค่า `undefined`

## การสร้างบริบทใหม่และการผสานรวมสรุป/กำหนดเอง

`buildSessionContext()` (ใน `session-manager.ts`) แก้ไขเส้นทาง root→leaf ที่ใช้งานอยู่และสร้างสถานะบริบท LLM ที่มีผล:

- ติดตามสถานะ thinking/model/mode/ttsr ล่าสุดในเส้นทาง
- จัดการการบีบอัดล่าสุดในเส้นทาง:
  - ปล่อยสรุปการบีบอัดก่อน
  - เล่นซ้ำข้อความที่เก็บไว้จาก `firstKeptEntryId` ไปยังจุดบีบอัด
  - จากนั้นเล่นซ้ำข้อความหลังการบีบอัด
- รวมรายการ `branch_summary` และ `custom_message` เป็นออบเจ็กต์ `AgentMessage`

`session/messages.ts` จากนั้นแมปประเภทข้อความเหล่านี้สำหรับอินพุตโมเดล:

- `branchSummary` และ `compactionSummary` กลายเป็นข้อความบริบทที่ใช้เทมเพลตบทบาท user
- `custom`/`hookMessage` กลายเป็นข้อความเนื้อหาบทบาท user

ดังนั้นการเคลื่อนที่ต้นไม้จะเปลี่ยนบริบทโดยการเปลี่ยนเส้นทางใบที่ใช้งานอยู่ ไม่ใช่โดยการเปลี่ยนแปลงรายการเก่า

## ป้ายกำกับและพฤติกรรม UI ต้นไม้

การคงอยู่ของป้ายกำกับ:

- `appendLabelChange(targetId, label?)` เขียนรายการ `label` บนเชนใบปัจจุบัน
- `labelsById` ถูกอัปเดตทันที (ตั้งค่าหรือลบ)
- `getTree()` แก้ไขป้ายกำกับปัจจุบันลงในแต่ละโหนดที่คืนค่า

พฤติกรรม tree selector (`tree-selector.ts`):

- ทำให้ต้นไม้แบนราบสำหรับการนำทาง รักษาการเน้น active-path และจัดลำดับความสำคัญในการแสดงสาขาที่ใช้งานอยู่ก่อน
- รองรับโหมดกรอง: `default`, `no-tools`, `user-only`, `labeled-only`, `all`
- รองรับการค้นหาข้อความอิสระบนเนื้อหาเชิงความหมายที่แสดงผล
- `Shift+L` เปิดการแก้ไขป้ายกำกับแบบ inline และเขียนผ่าน `appendLabelChange`

การกำหนดเส้นทางคำสั่ง:

- `/tree` เปิด tree selector เสมอ
- `/branch` เปิด user-message selector เว้นแต่ `doubleEscapeAction=tree` ซึ่งในกรณีนั้นจะใช้ UX ของ tree selector ด้วย

## จุดเชื่อมต่อส่วนขยายและฮุกสำหรับการดำเนินการต้นไม้

Extension API ขณะใช้คำสั่ง (`ExtensionCommandContext`):

- `branch(entryId)` — สร้างไฟล์เซสชันที่แตกสาขา
- `navigateTree(targetId, { summarize? })` — ย้ายภายในต้นไม้/ไฟล์ปัจจุบัน

เหตุการณ์รอบการนำทางต้นไม้:

- `session_before_tree`
  - รับ `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - อาจยกเลิกการนำทาง
  - อาจจัดหา payload สรุปที่ใช้แทนตัวสรุปในตัว
  - รับ `signal` ยกเลิก (เส้นทางการยกเลิกด้วย Escape)
- `session_tree`
  - ปล่อย `newLeafId`, `oldLeafId`
  - รวม `summaryEntry` เมื่อมีการสร้างสรุป
  - `fromExtension` ระบุแหล่งที่มาของสรุป

ฮุก lifecycle ที่อยู่ใกล้เคียงแต่เกี่ยวข้อง:

- `session_before_branch` / `session_branch` สำหรับขั้นตอน `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` สำหรับรายการบีบอัดที่ภายหลังส่งผลต่อการสร้างบริบทต้นไม้ใหม่

## ข้อจำกัดจริงและเงื่อนไขขอบเขต

- `branch()` ไม่สามารถกำหนดเป้าหมายเป็น `null` ได้ ใช้ `resetLeaf()` สำหรับสถานะ root-before-first-entry
- `branchWithSummary()` รองรับเป้าหมาย `null` และบันทึก `fromId: "root"`
- การเลือกใบปัจจุบันใน tree selector เป็นการดำเนินการที่ไม่มีผล
- การสรุปต้องการโมเดลที่ใช้งานอยู่ หากไม่มี การนำทางพร้อมสรุปจะล้มเหลวทันที
- หากการสรุปถูกยกเลิก การนำทางจะถูกยกเลิกและใบจะไม่เปลี่ยนแปลง
- เซสชันในหน่วยความจำจะไม่คืนค่าเส้นทางไฟล์สาขาจาก `createBranchedSession` เลย

## ความเข้ากันได้แบบเดิมที่ยังคงมีอยู่

การย้ายโอนเซสชันยังคงทำงานเมื่อโหลด:

- v1→v2 เพิ่ม `id`/`parentId` และแปลง anchor ดัชนีบีบอัดเดิมเป็น id anchor
- v2→v3 ย้ายโอนบทบาท `hookMessage` เดิมไปยัง `custom`

พฤติกรรมขณะรันไทม์ปัจจุบันคือ semantics ต้นไม้เวอร์ชัน 3 หลังการย้ายโอน
