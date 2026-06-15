---
title: ไปป์ไลน์การสร้าง Handoff
description: >-
  ไปป์ไลน์การสร้าง Handoff
  สำหรับการสร้างสรุปเซสชันแบบพกพาเพื่อการทำงานร่วมกันของทีม
sidebar:
  order: 8
  label: ไปป์ไลน์ Handoff
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# ไปป์ไลน์การสร้าง `/handoff`

เอกสารนี้อธิบายวิธีที่ coding-agent ดำเนินการ `/handoff` ในปัจจุบัน: เส้นทางการเรียกใช้งาน การสร้างพรอมต์ การจับผลลัพธ์ที่สมบูรณ์ การสลับเซสชัน และการฉีดบริบทใหม่

## ขอบเขต

ครอบคลุม:

- การส่งคำสั่ง `/handoff` แบบโต้ตอบ
- วงจรชีวิตและการเปลี่ยนสถานะของ `AgentSession.handoff()`
- วิธีที่ผลลัพธ์ของ handoff ถูกจับจากเอาต์พุตของ assistant
- วิธีที่เซสชันเก่า/ใหม่จัดเก็บข้อมูล handoff แตกต่างกัน
- พฤติกรรม UI สำหรับความสำเร็จ การยกเลิก และความล้มเหลว

ไม่ครอบคลุม:

- การนำทาง tree ทั่วไป/โครงสร้างภายใน branch
- คำสั่งเซสชันที่ไม่ใช่ handoff (`/new`, `/fork`, `/resume`)

## ไฟล์การดำเนินการ

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## เส้นทางการเรียกใช้งาน

1. `/handoff` ถูกประกาศในข้อมูลเมตาของ slash command ที่มีอยู่ (`slash-commands.ts`) พร้อมคำ힌트แบบ inline ที่เป็นตัวเลือก: `[focus instructions]`
2. ในการจัดการอินพุตแบบโต้ตอบ (`InputController`) ข้อความที่ส่งซึ่งตรงกับ `/handoff` หรือ `/handoff ...` จะถูกดักจับก่อนการส่งพรอมต์ปกติ
3. editor จะถูกล้างและเรียกใช้ `handleHandoffCommand(customInstructions?)`
4. `CommandController.handleHandoffCommand` ดำเนินการตรวจสอบเบื้องต้นโดยใช้รายการปัจจุบัน:
   - นับรายการ `type === "message"`
   - หากมี `< 2` รายการ จะแสดงคำเตือน: `Nothing to hand off (no messages yet)` และคืนค่า

การตรวจสอบเนื้อหาขั้นต่ำแบบเดียวกันมีอยู่อีกครั้งใน `AgentSession.handoff()` และจะโยนข้อผิดพลาดหากถูกละเมิด ซึ่งซ้ำซ้อนความปลอดภัยทั้งในชั้น UI และชั้นเซสชัน

## วงจรชีวิตแบบ end-to-end

### 1) เริ่มการสร้าง handoff

`AgentSession.handoff(customInstructions?)`:

- อ่านรายการ branch ปัจจุบัน (`sessionManager.getBranch()`)
- ตรวจสอบจำนวนข้อความขั้นต่ำ (`>= 2`)
- สร้าง `#handoffAbortController`
- สร้างพรอมต์แบบ inline ที่กำหนดไว้ล่วงหน้า เพื่อขอเอกสาร handoff ที่มีโครงสร้าง (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- เพิ่ม `Additional focus: ...` หากมีคำสั่งที่กำหนดเองให้ไว้

พรอมต์ถูกส่งผ่าน:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` ป้องกันการขยาย slash/prompt-template ของ payload คำสั่งภายในนี้

### 2) จับผลลัพธ์ที่สมบูรณ์

ก่อนส่งพรอมต์ `handoff()` สมัครรับเหตุการณ์เซสชันและรอ `agent_end`

เมื่อ `agent_end` เกิดขึ้น จะดึงข้อความ handoff จากสถานะ agent โดยสแกนย้อนกลับหาข้อความ `assistant` ล่าสุด จากนั้นต่อบล็อก `content` ทั้งหมดที่ `type === "text"` ด้วย `\n`

ข้อสมมติสำคัญในการดึงข้อมูล:

- ใช้เฉพาะบล็อกข้อความเท่านั้น เนื้อหาที่ไม่ใช่ข้อความจะถูกละเว้น
- สมมติว่าข้อความ assistant ล่าสุดสอดคล้องกับการสร้าง handoff
- ไม่แยกวิเคราะห์ส่วน markdown หรือตรวจสอบความสอดคล้องของรูปแบบ
- หากเอาต์พุตของ assistant ไม่มีบล็อกข้อความ handoff จะถือว่าหายไป

### 3) การตรวจสอบการยกเลิก

`handoff()` คืนค่า `undefined` เมื่อเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง:

- ไม่มีข้อความ handoff ที่จับได้ หรือ
- `#handoffAbortController.signal.aborted` เป็น true

เมื่อดำเนินการเสร็จ จะล้าง `#handoffAbortController` ใน `finally` เสมอ

### 4) การสร้างเซสชันใหม่

หากมีข้อความที่จับได้และไม่ถูกยกเลิก:

1. ล้าง writer ของเซสชันปัจจุบัน (`sessionManager.flush()`)
2. เริ่มเซสชันใหม่ (`sessionManager.newSession()`)
3. รีเซ็ตสถานะ agent ในหน่วยความจำ (`agent.reset()`)
4. ผูก `agent.sessionId` ใหม่กับ session id ใหม่
5. ล้างอาร์เรย์บริบทที่อยู่ในคิว (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. รีเซ็ตตัวนับการเตือน todo

`newSession()` สร้างส่วนหัวใหม่และรายการว่างเปล่า (รีเซ็ต leaf เป็น `null`) ในเส้นทาง handoff ไม่มีการส่ง `parentSession`

### 5) การฉีดบริบท handoff

เอกสาร handoff ที่สร้างขึ้นจะถูกห่อและต่อท้ายเซสชันใหม่เป็นรายการ `custom_message`:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

การเรียกใช้การแทรก:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

ความหมาย:

- `customType`: `"handoff"`
- `display`: `true` (มองเห็นได้ใน TUI rebuild)
- ประเภทรายการ: `custom_message` (มีส่วนร่วมใน LLM context)

### 6) สร้างบริบท agent ที่ใช้งานอยู่ใหม่

หลังจากการฉีด:

1. `sessionManager.buildSessionContext()` แก้ไขรายการข้อความสำหรับ leaf ปัจจุบัน
2. `agent.replaceMessages(sessionContext.messages)` ทำให้ข้อความ handoff ที่ฉีดเข้ามาเป็น active context
3. เมธอดคืนค่า `{ document: handoffText }`

ณ จุดนี้ active LLM context ในเซสชันใหม่มีข้อความ handoff ที่ฉีดเข้ามา ไม่ใช่ transcript เก่า

## โมเดลการคงอยู่: เซสชันเก่า vs เซสชันใหม่

### เซสชันเก่า

ระหว่างการสร้าง การคงอยู่ของข้อความปกติยังคงทำงาน การตอบสนอง handoff ของ assistant จะถูกคงอยู่เป็นรายการ `message` ปกติใน `message_end`

ผลลัพธ์: เซสชันต้นฉบับมี handoff ที่สร้างขึ้นและมองเห็นได้เป็นส่วนหนึ่งของ transcript ประวัติ

### เซสชันใหม่

หลังจากรีเซ็ตเซสชัน handoff จะถูกคงอยู่เป็น `custom_message` พร้อม `customType: "handoff"`

`buildSessionContext()` แปลงรายการนี้เป็นข้อความบริบท custom/user ในรันไทม์ผ่าน `createCustomMessage(...)` ดังนั้นจึงถูกรวมไว้ในพรอมต์ในอนาคตจากเซสชันใหม่

## พฤติกรรม Controller/UI

พฤติกรรมของ `CommandController.handleHandoffCommand`:

- เรียกใช้ `await session.handoff(customInstructions)`
- หากผลลัพธ์เป็น `undefined`: `showError("Handoff cancelled")`
- เมื่อสำเร็จ:
  - `rebuildChatFromMessages()` (โหลดบริบทเซสชันใหม่ รวมถึง handoff ที่ฉีดเข้ามา)
  - ทำให้ status line และ editor top border ไม่ถูกต้อง
  - โหลด todo ใหม่
  - ต่อท้ายบรรทัดแชทที่สำเร็จ: `New session started with handoff context`
- เมื่อเกิดข้อยกเว้น:
  - หากข้อความเป็น `"Handoff cancelled"` หรือชื่อ error เป็น `AbortError`: `showError("Handoff cancelled")`
  - มิฉะนั้น: `showError("Handoff failed: <message>")`
- ขอการ render เมื่อสิ้นสุด

## ความหมายของการยกเลิก (พฤติกรรมปัจจุบัน)

### พื้นฐานการยกเลิกระดับเซสชัน

`AgentSession` เปิดเผย:

- `abortHandoff()` → ยกเลิก `#handoffAbortController`
- `isGeneratingHandoff` → เป็น true ในขณะที่ controller มีอยู่

เมื่อใช้เส้นทางการยกเลิกนี้ subscriber ของ handoff จะปฏิเสธด้วย `Error("Handoff cancelled")` และ command controller จะแมปไปยัง UI การยกเลิก

### ข้อจำกัดของเส้นทาง `/handoff` แบบโต้ตอบ

ในการเชื่อมต่อ interactive controller ปัจจุบัน `/handoff` ไม่ได้ติดตั้ง handler Escape เฉพาะที่เรียก `abortHandoff()` (ต่างจากเส้นทาง compaction/branch-summary ที่แทนที่ `editor.onEscape` ชั่วคราว)

ผลกระทบในทางปฏิบัติ:

- มีการรองรับการยกเลิกระดับเซสชัน แต่ไม่มี keybinding hook เฉพาะสำหรับ handoff ในเส้นทางคำสั่ง `/handoff`
- การขัดจังหวะโดยผู้ใช้อาจยังคงเกิดขึ้นผ่านเส้นทางการยกเลิก agent ที่กว้างขึ้น แต่นั่นไม่ใช่ช่องทางการยกเลิกที่ชัดเจนแบบเดียวกับที่ใช้โดย `abortHandoff()`

## Handoff ที่ถูกยกเลิก vs ล้มเหลว

การจำแนกประเภท UI ปัจจุบัน:

- **ถูกยกเลิก/ยกเลิกแล้ว**
  - เส้นทาง `abortHandoff()` เรียกใช้ `"Handoff cancelled"` หรือ
  - โยน `AbortError`
  - UI แสดง `Handoff cancelled`

- **ล้มเหลว**
  - ข้อผิดพลาดอื่น ๆ ที่โยนจาก `handoff()` / prompt pipeline (ข้อผิดพลาดการตรวจสอบ model/API, ข้อยกเว้นในรันไทม์ ฯลฯ)
  - UI แสดง `Handoff failed: ...`

รายละเอียดเพิ่มเติม: หากการสร้างเสร็จสมบูรณ์แต่ไม่มีข้อความที่ดึงได้ `handoff()` จะคืนค่า `undefined` และ controller ในปัจจุบันรายงานว่า **ถูกยกเลิก** ไม่ใช่ **ล้มเหลว**

## การป้องกันเซสชันสั้นและเนื้อหาขั้นต่ำ

การป้องกันสองชั้นป้องกัน handoff ที่มีสัญญาณน้อย:

- ชั้น UI (`handleHandoffCommand`): แสดงคำเตือนและคืนค่าก่อนกำหนดสำหรับรายการข้อความ `< 2`
- ชั้นเซสชัน (`handoff()`): โยนเงื่อนไขเดียวกันเป็นข้อผิดพลาด

ซึ่งหลีกเลี่ยงการสร้างเซสชันใหม่ด้วยบริบท handoff ที่ว่างเปล่า/ใกล้เปล่า

## สรุปการเปลี่ยนสถานะ

ลำดับสถานะระดับสูง:

1. slash command แบบโต้ตอบถูกดักจับ
2. การตรวจสอบจำนวนข้อความเบื้องต้น
3. สร้าง `#handoffAbortController` (`isGeneratingHandoff = true`)
4. ส่งพรอมต์ handoff ภายใน (มองเห็นได้ในแชทเป็นการสร้าง assistant ปกติ)
5. เมื่อ `agent_end` ข้อความ assistant ล่าสุดจะถูกดึงออก
6. หากหายไป/ถูกยกเลิก → คืนค่า `undefined` หรือเส้นทางข้อผิดพลาดการยกเลิก
7. หากมีอยู่:
   - ล้างเซสชันเก่า
   - สร้างเซสชันว่างใหม่
   - รีเซ็ตคิว/ตัวนับในรันไทม์
   - ต่อท้าย `custom_message(handoff)`
   - สร้างและแทนที่ข้อความ agent ที่ใช้งานอยู่
8. Controller สร้าง chat UI ใหม่และประกาศความสำเร็จ
9. ล้าง `#handoffAbortController` (`isGeneratingHandoff = false`)

## ข้อสมมติและข้อจำกัดที่ทราบ

- การดึง handoff เป็นการคาดเดา: "บล็อกข้อความ assistant ล่าสุด" ไม่มีการตรวจสอบโครงสร้าง
- ไม่มีการตรวจสอบแบบเข้มงวดว่า markdown ที่สร้างขึ้นเป็นไปตามรูปแบบส่วนที่ขอ
- ข้อความที่ดึงได้หายไปจะถูกรายงานเป็นการยกเลิกใน UX ของ controller
- การไหลแบบโต้ตอบของ `/handoff` ในปัจจุบันขาด binding Escape→`abortHandoff()` เฉพาะ
- ข้อมูลเมตา lineage ของเซสชันใหม่ (`parentSession`) ไม่ได้ถูกตั้งค่าโดยเส้นทางนี้
