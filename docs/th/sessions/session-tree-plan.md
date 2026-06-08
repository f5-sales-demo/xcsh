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

เอกสารนี้อธิบายวิธีการทำงานของการนำทาง session tree ในปัจจุบัน: โมเดล tree ใน memory, กฎการเคลื่อนที่ของ leaf, พฤติกรรมการ branching, และการทำงานร่วมกับ extension/event

## ระบบย่อยนี้คืออะไร

Session ถูกจัดเก็บเป็น append-only entry log แต่พฤติกรรมขณะ runtime เป็นแบบ tree:

- ทุก entry ที่ไม่ใช่ header มี `id` และ `parentId`
- ตำแหน่งที่ active อยู่คือ `leafId` ใน `SessionManager`
- การเพิ่ม entry จะสร้าง child ของ leaf ปัจจุบันเสมอ
- การ branching **ไม่**เขียนทับประวัติ เพียงแค่เปลี่ยนตำแหน่งที่ leaf ชี้ไปก่อนการ append ครั้งถัดไป

ไฟล์สำคัญ:

- `src/session/session-manager.ts` — โมเดลข้อมูล tree, การ traverse, การเคลื่อนที่ของ leaf, การดึง branch/session
- `src/session/agent-session.ts` — flow การนำทาง `/tree`, การสรุป, การส่ง hook/event
- `src/modes/components/tree-selector.ts` — พฤติกรรม UI ของ tree แบบโต้ตอบและการกรอง
- `src/modes/controllers/selector-controller.ts` — การจัดการ selector สำหรับ `/tree` และ `/branch`
- `src/modes/controllers/input-controller.ts` — การ routing คำสั่ง (`/tree`, `/branch`, พฤติกรรม double-escape)
- `src/session/messages.ts` — การแปลง entry ประเภท `branch_summary`, `compaction`, และ `custom_message` เป็น context message สำหรับ LLM

## โมเดลข้อมูล tree ใน `SessionManager`

ดัชนีขณะ runtime:

- `#byId: Map<string, SessionEntry>` — ค้นหา entry ใดก็ได้อย่างรวดเร็ว
- `#leafId: string | null` — ตำแหน่งปัจจุบันใน tree
- `#labelsById: Map<string, string>` — label ที่ resolve แล้วตาม target entry id

API ของ tree:

- `getBranch(fromId?)` เดินตาม parent link ไปยัง root และคืนค่าเส้นทาง root→node
- `getTree()` คืนค่า `SessionTreeNode[]` (`entry`, `children`, `label`)
  - parent link จะถูกแปลงเป็น children array
  - entry ที่ไม่มี parent จะถูกจัดเป็น root
  - children ถูกเรียงจากเก่าสุด→ใหม่สุดตาม timestamp
- `getChildren(parentId)` คืนค่า children โดยตรง
- `getLabel(id)` resolve label ปัจจุบันจาก `labelsById`

`getTree()` เป็นการฉายข้อมูลขณะ runtime; การจัดเก็บยังคงเป็น append-only JSONL entry

## ความหมายของการเคลื่อนที่ leaf

มี primitive สำหรับการเคลื่อนที่ leaf สามแบบ:

1. `branch(entryId)`
   - ตรวจสอบว่า entry มีอยู่จริง
   - ตั้งค่า `leafId = entryId`
   - ไม่มีการเขียน entry ใหม่

2. `resetLeaf()`
   - ตั้งค่า `leafId = null`
   - การ append ครั้งถัดไปจะสร้าง root entry ใหม่ (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - รับ `branchFromId: string | null`
   - ตั้งค่า `leafId = branchFromId`
   - เพิ่ม entry ประเภท `branch_summary` เป็น child ของ leaf นั้น
   - เมื่อ `branchFromId` เป็น `null` จะบันทึก `fromId` เป็น `"root"`

## พฤติกรรมการนำทาง `/tree` (ไฟล์ session เดียวกัน)

`AgentSession.navigateTree()` คือการนำทาง ไม่ใช่การ fork ไฟล์

Flow:

1. ตรวจสอบเป้าหมายและคำนวณเส้นทางที่ถูกทิ้ง (`collectEntriesForBranchSummary`)
2. ส่ง event `session_before_tree` พร้อม `TreePreparation`
3. อาจสรุป entry ที่ถูกทิ้ง (สรุปจาก hook หรือตัวสรุปในตัว)
4. คำนวณเป้าหมาย leaf ใหม่:
   - การเลือกข้อความ **user**: leaf จะย้ายไปที่ parent และข้อความจะถูกคืนค่าเพื่อใส่ไว้ใน editor ล่วงหน้า
   - การเลือก **custom_message**: กฎเดียวกับ user message (leaf = parent, ข้อความใส่ใน editor ล่วงหน้า)
   - การเลือก entry ประเภทอื่น: leaf = id ของ entry ที่เลือก
5. ใช้การเคลื่อนที่ leaf:
   - มีสรุป: `branchWithSummary(newLeafId, ...)`
   - ไม่มีสรุปและ `newLeafId === null`: `resetLeaf()`
   - กรณีอื่น: `branch(newLeafId)`
6. สร้าง agent context ใหม่จาก leaf ใหม่และส่ง event `session_tree`

สำคัญ: entry สรุปจะถูกแนบที่**ตำแหน่งการนำทางใหม่** ไม่ใช่ที่ปลายของ branch ที่ถูกทิ้ง

## พฤติกรรม `/branch` (ไฟล์ session ใหม่)

`/branch` และ `/tree` ถูกออกแบบให้แตกต่างกันโดยเจตนา:

- `/tree` นำทางภายในไฟล์ session ปัจจุบัน
- `/branch` สร้างไฟล์ branch session ใหม่ (หรือแทนที่ใน memory สำหรับโหมดที่ไม่มีการจัดเก็บถาวร)

Flow `/branch` จากฝั่งผู้ใช้ (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- แหล่งที่มาของ branch ต้องเป็น **user message**
- ข้อความ user ที่เลือกจะถูกดึงมาใส่ใน editor ล่วงหน้า
- หาก user message ที่เลือกเป็น root (`parentId === null`): เริ่ม session ใหม่ผ่าน `newSession({ parentSession: previousSessionFile })`
- กรณีอื่น: `createBranchedSession(selectedEntry.parentId)` เพื่อ fork ประวัติจนถึงขอบเขตของ prompt ที่เลือก

รายละเอียดของ `SessionManager.createBranchedSession(leafId)`:

- สร้างเส้นทาง root→leaf ผ่าน `getBranch(leafId)`; throw error หากไม่พบ
- ไม่รวม entry ประเภท `label` ที่มีอยู่แล้วจากเส้นทางที่คัดลอก
- สร้าง label entry ใหม่จาก `labelsById` ที่ resolve แล้วสำหรับ entry ที่ยังอยู่ในเส้นทาง
- โหมด persistent: เขียนไฟล์ JSONL ใหม่และเปลี่ยน manager ไปใช้ไฟล์นั้น; คืนค่า path ของไฟล์ใหม่
- โหมด in-memory: แทนที่ entry ใน memory; คืนค่า `undefined`

## การสร้าง context ใหม่และการรวม summary/custom

`buildSessionContext()` (ใน `session-manager.ts`) resolve เส้นทาง root→leaf ที่ active อยู่และสร้างสถานะ context LLM ที่มีผล:

- ติดตามสถานะ thinking/model/mode/ttsr ล่าสุดบนเส้นทาง
- จัดการ compaction ล่าสุดบนเส้นทาง:
  - ส่งสรุป compaction ก่อน
  - เล่นซ้ำ message ที่เก็บไว้จาก `firstKeptEntryId` ถึงจุด compaction
  - จากนั้นเล่นซ้ำ message หลัง compaction
- รวม entry ประเภท `branch_summary` และ `custom_message` เป็นออบเจ็กต์ `AgentMessage`

`session/messages.ts` จากนั้นจะ map ประเภท message เหล่านี้สำหรับ input ของ model:

- `branchSummary` และ `compactionSummary` กลายเป็น context message แบบ template ที่มี role เป็น user
- `custom`/`hookMessage` กลายเป็น content message ที่มี role เป็น user

ดังนั้นการเคลื่อนที่ใน tree จะเปลี่ยน context โดยการเปลี่ยนเส้นทาง leaf ที่ active ไม่ใช่โดยการแก้ไข entry เก่า

## Label และพฤติกรรม UI ของ tree

การจัดเก็บ label:

- `appendLabelChange(targetId, label?)` เขียน entry ประเภท `label` บน leaf chain ปัจจุบัน
- `labelsById` จะถูกอัปเดตทันที (set หรือ delete)
- `getTree()` resolve label ปัจจุบันลงบนแต่ละ node ที่คืนค่า

พฤติกรรม tree selector (`tree-selector.ts`):

- แปลง tree ให้เป็นแบบแบนสำหรับการนำทาง เก็บการไฮไลต์เส้นทาง active และให้ความสำคัญกับการแสดง active branch ก่อน
- รองรับโหมดกรอง: `default`, `no-tools`, `user-only`, `labeled-only`, `all`
- รองรับการค้นหาข้อความอิสระเหนือ semantic content ที่แสดงผล
- `Shift+L` เปิดการแก้ไข label แบบ inline และเขียนผ่าน `appendLabelChange`

การ routing คำสั่ง:

- `/tree` เปิด tree selector เสมอ
- `/branch` เปิด user-message selector เว้นแต่ `doubleEscapeAction=tree` ซึ่งในกรณีนั้นจะใช้ UX ของ tree selector เช่นกัน

## จุดเชื่อมต่อ extension และ hook สำหรับการดำเนินการ tree

API ของ extension ขณะรับคำสั่ง (`ExtensionCommandContext`):

- `branch(entryId)` — สร้างไฟล์ session แบบ branch
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
  - สามารถให้ payload สรุปที่จะใช้แทนตัวสรุปในตัว
  - รับ `signal` สำหรับยกเลิก (เส้นทางการยกเลิกด้วย Escape)
- `session_tree`
  - ส่ง `newLeafId`, `oldLeafId`
  - รวม `summaryEntry` เมื่อมีการสร้างสรุป
  - `fromExtension` ระบุแหล่งที่มาของสรุป

Lifecycle hook ที่เกี่ยวข้อง:

- `session_before_branch` / `session_branch` สำหรับ flow `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` สำหรับ compaction entry ที่ส่งผลต่อการสร้าง tree-context ในภายหลัง

## ข้อจำกัดจริงและเงื่อนไขพิเศษ

- `branch()` ไม่สามารถชี้ไปที่ `null` ได้; ใช้ `resetLeaf()` สำหรับสถานะ root ก่อน entry แรก
- `branchWithSummary()` รองรับเป้าหมาย `null` และบันทึก `fromId: "root"`
- การเลือก leaf ปัจจุบันใน tree selector จะไม่มีผลใดๆ
- การสรุปต้องมี model ที่ active; หากไม่มี การนำทางแบบสรุปจะล้มเหลวทันที
- หากการสรุปถูกยกเลิก การนำทางจะถูกยกเลิกและ leaf จะไม่เปลี่ยนแปลง
- Session แบบ in-memory จะไม่คืนค่า path ของไฟล์ branch จาก `createBranchedSession`

## ความเข้ากันได้กับเวอร์ชันเก่าที่ยังคงมีอยู่

การ migrate session ยังคงทำงานเมื่อโหลด:

- v1→v2 เพิ่ม `id`/`parentId` และแปลง compaction index anchor เป็น id anchor
- v2→v3 migrate `hookMessage` role แบบเก่าเป็น `custom`

พฤติกรรม runtime ปัจจุบันเป็น tree semantics เวอร์ชัน 3 หลังการ migrate
