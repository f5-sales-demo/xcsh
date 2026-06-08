---
title: Session Tree Architecture
description: >-
  Session tree architecture with branching, navigation, and parent-child
  conversation relationships.
sidebar:
  order: 2
  label: Tree architecture
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# สถาปัตยกรรม session tree (ปัจจุบัน)

อ้างอิง: [session.md](./session.md)

เอกสารนี้อธิบายวิธีการทำงานของการนำทาง session tree ในปัจจุบัน: โมเดล tree ในหน่วยความจำ, กฎการเคลื่อนที่ของ leaf, พฤติกรรมการแตกกิ่ง และการผสานรวม extension/event

## ระบบย่อยนี้คืออะไร

Session ถูกจัดเก็บเป็น entry log แบบ append-only แต่พฤติกรรมขณะทำงานเป็นแบบ tree-based:

- ทุก entry ที่ไม่ใช่ header จะมี `id` และ `parentId`
- ตำแหน่งที่ active คือ `leafId` ใน `SessionManager`
- การเพิ่ม entry จะสร้าง child ของ leaf ปัจจุบันเสมอ
- การแตกกิ่ง (branching) **ไม่ได้**เขียนประวัติใหม่ เพียงแค่เปลี่ยนตำแหน่งที่ leaf ชี้ไปก่อนการ append ครั้งถัดไป

ไฟล์สำคัญ:

- `src/session/session-manager.ts` — โมเดลข้อมูล tree, การท่องผ่าน, การเคลื่อนที่ leaf, การแยก branch/session
- `src/session/agent-session.ts` — ขั้นตอนการนำทาง `/tree`, การสรุป, การปล่อย hook/event
- `src/modes/components/tree-selector.ts` — พฤติกรรม UI ของ tree แบบโต้ตอบและการกรอง
- `src/modes/controllers/selector-controller.ts` — การจัดการ selector สำหรับ `/tree` และ `/branch`
- `src/modes/controllers/input-controller.ts` — การเส้นทางคำสั่ง (`/tree`, `/branch`, พฤติกรรม double-escape)
- `src/session/messages.ts` — การแปลง entry ประเภท `branch_summary`, `compaction` และ `custom_message` เป็นข้อความ context สำหรับ LLM

## โมเดลข้อมูล tree ใน `SessionManager`

ดัชนีขณะทำงาน:

- `#byId: Map<string, SessionEntry>` — ค้นหา entry ใดก็ได้อย่างรวดเร็ว
- `#leafId: string | null` — ตำแหน่งปัจจุบันใน tree
- `#labelsById: Map<string, string>` — ป้ายที่ resolve แล้วตาม id ของ entry เป้าหมาย

API ของ tree:

- `getBranch(fromId?)` เดินตาม parent links ไปยัง root และส่งคืนเส้นทาง root→node
- `getTree()` ส่งคืน `SessionTreeNode[]` (`entry`, `children`, `label`)
  - parent links จะกลายเป็น children arrays
  - entry ที่ parent หายไปจะถูกถือว่าเป็น roots
  - children จะเรียงจากเก่าสุด→ใหม่สุดตาม timestamp
- `getChildren(parentId)` ส่งคืน children ระดับตรง
- `getLabel(id)` resolve ป้ายปัจจุบันจาก `labelsById`

`getTree()` เป็นการฉายภาพขณะทำงาน การเก็บข้อมูลถาวรยังคงเป็น entry JSONL แบบ append-only

## ความหมายของการเคลื่อนที่ leaf

มี leaf movement primitives สามแบบ:

1. `branch(entryId)`
   - ตรวจสอบว่า entry มีอยู่
   - ตั้ง `leafId = entryId`
   - ไม่มีการเขียน entry ใหม่

2. `resetLeaf()`
   - ตั้ง `leafId = null`
   - การ append ครั้งถัดไปจะสร้าง root entry ใหม่ (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - รับ `branchFromId: string | null`
   - ตั้ง `leafId = branchFromId`
   - เพิ่ม entry `branch_summary` เป็น child ของ leaf นั้น
   - เมื่อ `branchFromId` เป็น `null`, `fromId` จะถูกบันทึกเป็น `"root"`

## พฤติกรรมการนำทาง `/tree` (ไฟล์ session เดียวกัน)

`AgentSession.navigateTree()` เป็นการนำทาง ไม่ใช่การ fork ไฟล์

ขั้นตอน:

1. ตรวจสอบเป้าหมายและคำนวณเส้นทางที่ถูกละทิ้ง (`collectEntriesForBranchSummary`)
2. ปล่อย `session_before_tree` พร้อม `TreePreparation`
3. สรุป entry ที่ถูกละทิ้งหากต้องการ (สรุปจาก hook หรือ summarizer ในตัว)
4. คำนวณเป้าหมาย leaf ใหม่:
   - เลือกข้อความ **user**: leaf เคลื่อนไปยัง parent และข้อความจะถูกส่งคืนเพื่อเติมล่วงหน้าในตัวแก้ไข
   - เลือก **custom_message**: กฎเดียวกับข้อความ user (leaf = parent, ข้อความเติมล่วงหน้าในตัวแก้ไข)
   - เลือก entry อื่น: leaf = id ของ entry ที่เลือก
5. ใช้การเคลื่อนที่ leaf:
   - มีสรุป: `branchWithSummary(newLeafId, ...)`
   - ไม่มีสรุปและ `newLeafId === null`: `resetLeaf()`
   - กรณีอื่น: `branch(newLeafId)`
6. สร้าง agent context ใหม่จาก leaf ใหม่และปล่อย `session_tree`

สิ่งสำคัญ: entry สรุปจะถูกแนบที่**ตำแหน่งนำทางใหม่** ไม่ใช่ที่ปลายของ branch ที่ถูกละทิ้ง

## พฤติกรรม `/branch` (ไฟล์ session ใหม่)

`/branch` และ `/tree` ถูกออกแบบให้แตกต่างกันโดยตั้งใจ:

- `/tree` นำทางภายในไฟล์ session ปัจจุบัน
- `/branch` สร้างไฟล์ branch session ใหม่ (หรือแทนที่ในหน่วยความจำสำหรับโหมดที่ไม่มีการเก็บข้อมูลถาวร)

ขั้นตอน `/branch` สำหรับผู้ใช้ (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- แหล่งที่มาของ branch ต้องเป็น**ข้อความ user**
- ข้อความ user ที่เลือกจะถูกแยกออกเพื่อเติมล่วงหน้าในตัวแก้ไข
- หากข้อความ user ที่เลือกเป็น root (`parentId === null`): เริ่ม session ใหม่ผ่าน `newSession({ parentSession: previousSessionFile })`
- กรณีอื่น: `createBranchedSession(selectedEntry.parentId)` เพื่อ fork ประวัติจนถึงขอบเขตของ prompt ที่เลือก

รายละเอียดเฉพาะของ `SessionManager.createBranchedSession(leafId)`:

- สร้างเส้นทาง root→leaf ผ่าน `getBranch(leafId)` โยน error หากไม่พบ
- ไม่รวม entry `label` ที่มีอยู่แล้วจากเส้นทางที่คัดลอก
- สร้าง entry label ใหม่จาก `labelsById` ที่ resolve แล้วสำหรับ entry ที่ยังคงอยู่ในเส้นทาง
- โหมดถาวร: เขียนไฟล์ JSONL ใหม่และสลับ manager ไปใช้ ส่งคืนเส้นทางไฟล์ใหม่
- โหมดในหน่วยความจำ: แทนที่ entry ในหน่วยความจำ ส่งคืน `undefined`

## การสร้าง context ใหม่และการผสานรวม summary/custom

`buildSessionContext()` (ใน `session-manager.ts`) resolve เส้นทาง root→leaf ที่ active และสร้างสถานะ context LLM ที่มีผล:

- ติดตามสถานะ thinking/model/mode/ttsr ล่าสุดบนเส้นทาง
- จัดการ compaction ล่าสุดบนเส้นทาง:
  - ปล่อย compaction summary ก่อน
  - เล่นซ้ำข้อความที่เก็บไว้จาก `firstKeptEntryId` ถึงจุด compaction
  - จากนั้นเล่นซ้ำข้อความหลัง compaction
- รวม entry `branch_summary` และ `custom_message` เป็นวัตถุ `AgentMessage`

`session/messages.ts` จากนั้นแม็ป message type เหล่านี้สำหรับ input ของโมเดล:

- `branchSummary` และ `compactionSummary` จะกลายเป็นข้อความ context แบบ template ในบทบาท user
- `custom`/`hookMessage` จะกลายเป็นข้อความ content ในบทบาท user

ดังนั้นการเคลื่อนที่ใน tree จะเปลี่ยน context โดยการเปลี่ยนเส้นทาง leaf ที่ active ไม่ใช่โดยการแก้ไข entry เก่า

## ป้ายและพฤติกรรม UI ของ tree

การเก็บป้ายถาวร:

- `appendLabelChange(targetId, label?)` เขียน entry `label` บนสาย leaf ปัจจุบัน
- `labelsById` จะถูกอัปเดตทันที (ตั้งค่าหรือลบ)
- `getTree()` resolve ป้ายปัจจุบันลงบนแต่ละ node ที่ส่งคืน

พฤติกรรม tree selector (`tree-selector.ts`):

- แผ่ tree สำหรับการนำทาง รักษาการเน้นเส้นทางที่ active และให้ความสำคัญกับการแสดง branch ที่ active ก่อน
- รองรับโหมดกรอง: `default`, `no-tools`, `user-only`, `labeled-only`, `all`
- รองรับการค้นหาข้อความอิสระเหนือเนื้อหาเชิงความหมายที่แสดงผล
- `Shift+L` เปิดการแก้ไขป้ายแบบ inline และเขียนผ่าน `appendLabelChange`

การเส้นทางคำสั่ง:

- `/tree` เปิด tree selector เสมอ
- `/branch` เปิด user-message selector เว้นแต่ `doubleEscapeAction=tree` ซึ่งในกรณีนั้นจะใช้ UX ของ tree selector ด้วย

## จุดเชื่อมต่อ extension และ hook สำหรับการดำเนินการ tree

API extension ขณะรันคำสั่ง (`ExtensionCommandContext`):

- `branch(entryId)` — สร้างไฟล์ session แบบ branched
- `navigateTree(targetId, { summarize? })` — เคลื่อนที่ภายใน tree/ไฟล์ปัจจุบัน

Event รอบการนำทาง tree:

- `session_before_tree`
  - รับ `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - สามารถยกเลิกการนำทาง
  - สามารถให้ payload สรุปที่ใช้แทน summarizer ในตัว
  - รับ abort `signal` (เส้นทางยกเลิกด้วย Escape)
- `session_tree`
  - ปล่อย `newLeafId`, `oldLeafId`
  - รวม `summaryEntry` เมื่อมีการสร้างสรุป
  - `fromExtension` ระบุแหล่งที่มาของสรุป

Lifecycle hook ที่เกี่ยวข้องแต่อยู่ในกลุ่มใกล้เคียง:

- `session_before_branch` / `session_branch` สำหรับขั้นตอน `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` สำหรับ entry compaction ที่ส่งผลต่อการสร้าง tree-context ในภายหลัง

## ข้อจำกัดจริงและเงื่อนไขขอบ

- `branch()` ไม่สามารถระบุ `null` เป็นเป้าหมาย ใช้ `resetLeaf()` สำหรับสถานะ root-before-first-entry
- `branchWithSummary()` รองรับเป้าหมาย `null` และบันทึก `fromId: "root"`
- การเลือก leaf ปัจจุบันใน tree selector จะไม่มีการดำเนินการใด (no-op)
- การสรุปต้องมีโมเดลที่ active หากไม่มี การนำทางแบบสรุปจะล้มเหลวทันที
- หากการสรุปถูกยกเลิก การนำทางจะถูกยกเลิกและ leaf ไม่เปลี่ยนแปลง
- session ในหน่วยความจำจะไม่ส่งคืนเส้นทางไฟล์ branch จาก `createBranchedSession`

## ความเข้ากันได้ย้อนหลังที่ยังคงมีอยู่

การย้าย session ยังคงทำงานเมื่อโหลด:

- v1→v2 เพิ่ม `id`/`parentId` และแปลง compaction index anchor เป็น id anchor
- v2→v3 ย้าย `hookMessage` role แบบ legacy เป็น `custom`

พฤติกรรมขณะทำงานในปัจจุบันเป็น tree semantics เวอร์ชัน 3 หลังการย้าย
