---
title: เอกสารอ้างอิงคำสั่ง Tree
description: >-
  เอกสารอ้างอิงคำสั่ง /tree
  สำหรับการแสดงประวัติเซสชันและสาขาการสนทนาในรูปแบบแผนผัง
sidebar:
  order: 4
  label: คำสั่ง /tree
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# เอกสารอ้างอิงคำสั่ง `/tree`

`/tree` เปิดตัวนำทาง **Session Tree** แบบโต้ตอบ ซึ่งช่วยให้คุณสามารถข้ามไปยังรายการใดก็ได้ในไฟล์เซสชันปัจจุบัน และดำเนินการต่อจากจุดนั้น

นี่คือการย้ายใบ (leaf move) ภายในไฟล์เดิม ไม่ใช่การส่งออกเซสชันใหม่

## สิ่งที่ `/tree` ทำ

- สร้างแผนผังจากรายการเซสชันปัจจุบัน (`SessionManager.getTree()`)
- เปิด `TreeSelectorComponent` พร้อมการนำทางด้วยแป้นพิมพ์ ตัวกรอง และการค้นหา
- เมื่อเลือก จะเรียก `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- สร้างการแสดงผลแชทใหม่จากเส้นทางใบ (leaf path) ใหม่
- เติมข้อความในตัวแก้ไขล่วงหน้าเมื่อเลือกข้อความประเภท user/custom (ถ้ามี)

การใช้งานหลัก:

- `src/modes/controllers/input-controller.ts` (`/tree`, การเชื่อมต่อ keybinding, พฤติกรรม double-escape)
- `src/modes/controllers/selector-controller.ts` (การเปิด tree UI + กระบวนการ summary prompt)
- `src/modes/components/tree-selector.ts` (การนำทาง, ตัวกรอง, การค้นหา, ป้ายกำกับ, การแสดงผล)
- `src/session/agent-session.ts` (การสลับใบด้วย `navigateTree` + summary แบบเลือกได้)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, การคงป้ายกำกับ)

## วิธีเปิดใช้งาน

ทางเลือกใดก็ได้ต่อไปนี้จะเปิดตัวเลือกตัวเดียวกัน:

- `/tree`
- การกำหนด keybinding สำหรับ action `tree`
- กด double-escape บน editor ที่ว่างเปล่า เมื่อ `doubleEscapeAction = "tree"` (ค่าเริ่มต้น)
- `/branch` เมื่อ `doubleEscapeAction = "tree"` (จะนำทางไปยัง tree selector แทนตัวเลือก branch แบบ user-only)

## โมเดล UI ของแผนผัง

แผนผังถูกสร้างจากตัวชี้ parent ของรายการเซสชัน (`id` / `parentId`)

- ลูก (Children) จะถูกเรียงตามเวลาจากน้อยไปมาก (เก่าก่อน ใหม่ทีหลัง)
- สาขาที่ใช้งานอยู่ (เส้นทางจาก root ถึงใบปัจจุบัน) จะถูกทำเครื่องหมายด้วยจุด
- ป้ายกำกับ (ถ้ามี) จะแสดงเป็น `[label]` ก่อนข้อความโหนด
- หากมี root หลายรายการ (parent chain ที่ขาดหายหรือเสียหาย) จะแสดงอยู่ภายใต้ virtual branching root

```text
ตัวอย่างมุมมองแผนผัง (เส้นทางที่ใช้งานอยู่ทำเครื่องหมายด้วย •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

ตัวเลือกจะจัดกลางรอบการเลือกปัจจุบันและแสดงได้สูงสุด:

- `max(5, floor(terminalHeight / 2))` แถว

## Keybindings ภายใน tree selector

- `Up` / `Down`: เลื่อนการเลือก (วนซ้ำ)
- `Left` / `Right`: เลื่อนหน้าขึ้น / เลื่อนหน้าลง
- `Enter`: เลือกโหนด
- `Esc`: ล้างการค้นหาถ้ากำลังค้นหาอยู่ มิฉะนั้นปิดตัวเลือก
- `Ctrl+C`: ปิดตัวเลือก
- `Type`: เพิ่มต่อท้าย search query
- `Backspace`: ลบตัวอักษรจากการค้นหา
- `Shift+L`: แก้ไข/ล้างป้ายกำกับของรายการที่เลือก
- `Ctrl+O`: วน filter ไปข้างหน้า
- `Shift+Ctrl+O`: วน filter ย้อนกลับ
- `Alt+D/T/U/L/A`: ข้ามไปยัง filter mode ที่กำหนดโดยตรง

## ตัวกรองและความหมายของการค้นหา

Filter modes (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

แสดงโหนดการสนทนาส่วนใหญ่ แต่ซ่อนประเภทรายการ bookkeeping:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

เหมือนกับ `default` แต่ซ่อนข้อความ `toolResult` เพิ่มเติม

### `user-only`

เฉพาะรายการ `message` ที่มี role เป็น `user` เท่านั้น

### `labeled-only`

เฉพาะรายการที่มีการแก้ไขป้ายกำกับในปัจจุบันเท่านั้น

### `all`

ทุกอย่างในแผนผังเซสชัน รวมถึงรายการ bookkeeping/custom

### พฤติกรรมของโหนด assistant ที่มีแต่ tool

ข้อความ assistant ที่มี **เฉพาะ tool calls** (ไม่มีข้อความ) จะถูกซ่อนตามค่าเริ่มต้นในมุมมอง filtered ทั้งหมด เว้นแต่:

- ข้อความมีข้อผิดพลาด/ถูกยกเลิก (`stopReason` ไม่ใช่ `stop`/`toolUse`) หรือ
- เป็นใบปัจจุบัน (จะแสดงเสมอ)

### พฤติกรรมการค้นหา

- Query จะถูกแบ่ง token ด้วยช่องว่าง
- การจับคู่ไม่คำนึงถึงตัวพิมพ์เล็ก/ใหญ่
- ทุก token ต้องตรงกัน (AND semantics)
- ข้อความที่ค้นหาได้รวมถึงป้ายกำกับ, role, และเนื้อหาเฉพาะประเภท (ข้อความในข้อความ, ข้อความ branch summary, ประเภท custom, snippet คำสั่ง tool ฯลฯ)

## ผลลัพธ์ของการเลือก (สำคัญ)

`navigateTree` คำนวณพฤติกรรมใบใหม่จากประเภทรายการที่เลือก:

### การเลือกข้อความ `user`

- ใบใหม่จะกลายเป็น `parentId` ของรายการที่เลือก
- หาก parent เป็น `null` (ข้อความ user ที่ root) ใบจะรีเซ็ตไปยัง root (`resetLeaf()`)
- ข้อความที่เลือกจะถูกคัดลอกไปยัง editor เพื่อแก้ไข/ส่งใหม่

### การเลือก `custom_message`

- กฎใบเหมือนกับข้อความ user (`parentId`)
- เนื้อหาข้อความจะถูกดึงออกและคัดลอกไปยัง editor

### การเลือกโหนดที่ไม่ใช่ user (assistant/tool/summary/compaction/custom bookkeeping ฯลฯ)

- ใบใหม่จะกลายเป็น id ของโหนดที่เลือก
- Editor จะไม่ถูกเติมข้อความล่วงหน้า

### การเลือกใบปัจจุบัน

- ไม่มีการดำเนินการ; ตัวเลือกจะปิดพร้อมข้อความ "Already at this point"

```text
การตัดสินใจเลือก (แบบย่อ):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## กระบวนการ Summary-on-switch

Summary prompt ถูกควบคุมโดย `branchSummary.enabled` (ค่าเริ่มต้น: `false`)

เมื่อเปิดใช้งาน หลังจากเลือกโหนด UI จะถามว่า:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

รายละเอียดกระบวนการ:

- การกด Escape ใน summary prompt จะเปิด tree selector อีกครั้ง
- การยกเลิก custom prompt จะกลับไปยัง summary choice loop
- ระหว่างการสรุป UI จะแสดง loader และผูก `Esc` กับ `abortBranchSummary()`
- หากการสรุปถูกยกเลิก tree selector จะเปิดขึ้นอีกครั้งและไม่มีการย้ายใด ๆ ถูกนำไปใช้

ส่วนภายในของ `navigateTree`:

- รวบรวมรายการ abandoned-branch จากใบเก่าไปยัง common ancestor
- ส่ง `session_before_tree` (extensions สามารถยกเลิกหรือแทรก summary ได้)
- ใช้ summarizer เริ่มต้นเฉพาะเมื่อร้องขอและจำเป็น
- ใช้การย้ายด้วย:
  - `branchWithSummary(...)` เมื่อมี summary อยู่
  - `branch(newLeafId)` สำหรับการย้ายที่ไม่ใช่ root โดยไม่มี summary
  - `resetLeaf()` สำหรับการย้าย root โดยไม่มี summary
- แทนที่การสนทนา agent ด้วย session context ที่สร้างใหม่
- ส่ง `session_tree`

หมายเหตุ: หากผู้ใช้ร้องขอ summary แต่ไม่มีอะไรให้สรุป การนำทางจะดำเนินต่อโดยไม่สร้างรายการ summary

## ป้ายกำกับ

การแก้ไขป้ายกำกับใน tree UI จะเรียก `appendLabelChange(targetId, label)`

- ป้ายกำกับที่ไม่ว่างเปล่าจะตั้งค่า/อัปเดตป้ายกำกับที่แก้ไขแล้ว
- ป้ายกำกับว่างเปล่าจะล้างมัน
- ป้ายกำกับถูกจัดเก็บเป็นรายการ `label` แบบ append-only
- โหนดในแผนผังจะแสดงสถานะป้ายกำกับที่แก้ไขแล้ว ไม่ใช่ประวัติ label-entry ดิบ

## `/tree` เทียบกับการดำเนินการที่เกี่ยวข้อง

| การดำเนินการ | ขอบเขต | ผลลัพธ์ |
|---|---|---|
| `/tree` | ไฟล์เซสชันปัจจุบัน | ย้ายใบไปยังจุดที่เลือก (ไฟล์เดิม) |
| `/branch` | โดยปกติไฟล์เซสชันปัจจุบัน -> ไฟล์เซสชันใหม่ | ตามค่าเริ่มต้นจะแตกสาขาจากข้อความ **user** ที่เลือกไปยังไฟล์เซสชันใหม่ หาก `doubleEscapeAction = "tree"` จะเปิด tree navigation UI แทน |
| `/fork` | เซสชันปัจจุบันทั้งหมด | ทำสำเนาเซสชันไปยังไฟล์เซสชันที่คงไว้ใหม่ |
| `/resume` | รายการเซสชัน | สลับไปยังไฟล์เซสชันอื่น |

ข้อแตกต่างสำคัญ: `/tree` คือเครื่องมือนำทาง/จัดตำแหน่งใหม่ภายในไฟล์เซสชันเดียว `/branch`, `/fork`, และ `/resume` ทั้งหมดจะเปลี่ยนบริบทของไฟล์เซสชัน

## เวิร์กโฟลว์สำหรับผู้ใช้งาน

### เรียกใช้ซ้ำจาก user prompt เก่าโดยไม่สูญเสียสาขาปัจจุบัน

1. `/tree`
2. ค้นหา/เลือกข้อความ user ก่อนหน้า
3. เลือก `No summary` (หรือ summarize ถ้าจำเป็น)
4. แก้ไขข้อความที่ถูกเติมไว้ล่วงหน้าใน editor
5. ส่ง

ผลลัพธ์: สาขาใหม่จะเติบโตจากจุดที่เลือกภายในไฟล์เซสชันเดิม

### ออกจากสาขาปัจจุบันพร้อม context breadcrumb

1. เปิดใช้งาน `branchSummary.enabled`
2. `/tree` และเลือกโหนดเป้าหมาย
3. เลือก `Summarize` (หรือ custom prompt)

ผลลัพธ์: รายการ `branch_summary` จะถูกเพิ่มที่ตำแหน่งเป้าหมายก่อนดำเนินการต่อ

### ตรวจสอบรายการ bookkeeping ที่ซ่อนอยู่

1. `/tree`
2. กด `Alt+A` (all)
3. ค้นหา `model`, `thinking`, `custom`, หรือ labels

ผลลัพธ์: ตรวจสอบ timeline ภายในทั้งหมด ไม่ใช่แค่โหนดการสนทนา

### บันทึกจุดสำคัญสำหรับการข้ามในภายหลัง

1. `/tree`
2. ไปที่รายการ
3. กด `Shift+L` และตั้งป้ายกำกับ
4. ในภายหลังใช้ `Alt+L` (`labeled-only`) เพื่อข้ามไปอย่างรวดเร็ว

ผลลัพธ์: การนำทางอย่างรวดเร็วระหว่างจุดสำคัญของสาขาที่คงทน
