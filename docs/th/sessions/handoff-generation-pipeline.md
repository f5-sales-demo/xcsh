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

เอกสารนี้อธิบายวิธีที่ coding-agent ดำเนินการ `/handoff` ในปัจจุบัน: เส้นทางทริกเกอร์ พร้อมต์การสร้าง การจับภาพผลลัพธ์ การสลับเซสชัน และการนำบริบทกลับมาใส่ใหม่

## ขอบเขต

ครอบคลุม:

- การจัดส่งคำสั่ง `/handoff` แบบโต้ตอบ
- วงจรชีวิตและการเปลี่ยนสถานะของ `AgentSession.handoff()`
- วิธีที่ผลลัพธ์ของ handoff ถูกจับจากเอาต์พุตของผู้ช่วย
- วิธีที่เซสชันเก่า/ใหม่บันทึกข้อมูล handoff ต่างกัน
- พฤติกรรม UI สำหรับความสำเร็จ การยกเลิก และความล้มเหลว

ไม่ครอบคลุม:

- การนำทางต้นไม้ทั่วไป/โครงสร้างภายในของ branch
- คำสั่งเซสชันที่ไม่ใช่ handoff (`/new`, `/fork`, `/resume`)

## ไฟล์การดำเนินการ

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## เส้นทางทริกเกอร์

1. `/handoff` ถูกประกาศในข้อมูลเมตาของ slash command ที่ฝังไว้ (`slash-commands.ts`) พร้อมคำใบ้อินไลน์แบบเลือกได้: `[focus instructions]`
2. ในการจัดการอินพุตแบบโต้ตอบ (`InputController`) ข้อความที่ส่งซึ่งตรงกับ `/handoff` หรือ `/handoff ...` จะถูกดักจับก่อนการส่งพร้อมต์ปกติ
3. ตัวแก้ไขถูกล้างและเรียก `handleHandoffCommand(customInstructions?)`
4. `CommandController.handleHandoffCommand` ดำเนินการตรวจสอบเบื้องต้นโดยใช้รายการปัจจุบัน:
   - นับรายการ `type === "message"`
   - หากน้อยกว่า `< 2` จะแสดงคำเตือน: `Nothing to hand off (no messages yet)` และ return

การตรวจสอบเนื้อหาขั้นต่ำแบบเดียวกันมีอยู่อีกครั้งภายใน `AgentSession.handoff()` และจะโยนข้อผิดพลาดหากละเมิด ซึ่งซ้ำซ้อนความปลอดภัยทั้งในชั้น UI และชั้นเซสชัน

## วงจรชีวิตแบบ end-to-end

### 1) เริ่มการสร้าง handoff

`AgentSession.handoff(customInstructions?)`:

- อ่านรายการ branch ปัจจุบัน (`sessionManager.getBranch()`)
- ตรวจสอบจำนวนข้อความขั้นต่ำ (`>= 2`)
- สร้าง `#handoffAbortController`
- สร้างพร้อมต์แบบตายตัวและอินไลน์ที่ขอเอกสาร handoff ที่มีโครงสร้าง (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- ต่อท้าย `Additional focus: ...` หากมีคำแนะนำที่กำหนดเอง

ส่งพร้อมต์ผ่าน:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` ป้องกันการขยาย slash/prompt-template ของ payload คำแนะนำภายในนี้

### 2) จับภาพผลลัพธ์

ก่อนส่งพร้อมต์ `handoff()` สมัครรับเหตุการณ์เซสชันและรอ `agent_end`

เมื่อได้รับ `agent_end` จะดึงข้อความ handoff จากสถานะ agent โดยสแกนย้อนกลับเพื่อหาข้อความ `assistant` ล่าสุด จากนั้นเชื่อมบล็อก `content` ทั้งหมดที่ `type === "text"` ด้วย `\n`

ข้อสมมติฐานการดึงข้อมูลที่สำคัญ:

- ใช้เฉพาะบล็อกข้อความเท่านั้น เนื้อหาที่ไม่ใช่ข้อความจะถูกละเว้น
- สมมติว่าข้อความ assistant ล่าสุดสอดคล้องกับการสร้าง handoff
- ไม่แยกวิเคราะห์ส่วน markdown หรือตรวจสอบการปฏิบัติตามรูปแบบ
- หากเอาต์พุตของผู้ช่วยไม่มีบล็อกข้อความ handoff จะถูกถือว่าขาดหาย

### 3) การตรวจสอบการยกเลิก

`handoff()` จะ return `undefined` เมื่อเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง:

- ไม่มีข้อความ handoff ที่จับได้ หรือ
- `#handoffAbortController.signal.aborted` เป็น true

จะล้าง `#handoffAbortController` ใน `finally` เสมอ

### 4) การสร้างเซสชันใหม่

หากจับข้อความได้และไม่ถูกยกเลิก:

1. Flush writer เซสชันปัจจุบัน (`sessionManager.flush()`)
2. เริ่มเซสชันใหม่ทั้งหมด (`sessionManager.newSession()`)
3. รีเซ็ตสถานะ agent ในหน่วยความจำ (`agent.reset()`)
4. ผูก `agent.sessionId` ใหม่กับ id เซสชันใหม่
5. ล้างอาร์เรย์บริบทที่คิวไว้ (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. รีเซ็ตตัวนับการเตือน todo

`newSession()` สร้าง header ใหม่และรายการเริ่มต้นที่ว่างเปล่า (leaf รีเซ็ตเป็น `null`) ในเส้นทาง handoff จะไม่ส่ง `parentSession`

### 5) การนำบริบท handoff เข้าสู่เซสชัน

เอกสาร handoff ที่สร้างขึ้นจะถูกห่อและต่อท้ายเซสชันใหม่เป็นรายการ `custom_message`:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

การเรียกเพื่อแทรก:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

ความหมาย:

- `customType`: `"handoff"`
- `display`: `true` (มองเห็นได้ในการสร้าง TUI ใหม่)
- ประเภทรายการ: `custom_message` (เข้าร่วมในบริบท LLM)

### 6) สร้างบริบท agent ที่ใช้งานอยู่ใหม่

หลังการแทรก:

1. `sessionManager.buildSessionContext()` แก้ไขรายการข้อความสำหรับ leaf ปัจจุบัน
2. `agent.replaceMessages(sessionContext.messages)` ทำให้ข้อความ handoff ที่แทรกเป็นบริบทที่ใช้งานอยู่
3. เมธอด return `{ document: handoffText }`

ณ จุดนี้ บริบท LLM ที่ใช้งานอยู่ในเซสชันใหม่ประกอบด้วยข้อความ handoff ที่แทรกไว้ ไม่ใช่ transcript เก่า

## โมเดลการคงอยู่: เซสชันเก่าเทียบกับเซสชันใหม่

### เซสชันเก่า

ระหว่างการสร้าง การคงอยู่ของข้อความปกติยังคงใช้งานได้ การตอบสนอง handoff ของผู้ช่วยจะถูกบันทึกเป็นรายการ `message` ปกติเมื่อ `message_end`

ผลลัพธ์: เซสชันต้นฉบับประกอบด้วย handoff ที่สร้างขึ้นซึ่งมองเห็นได้เป็นส่วนหนึ่งของ transcript ประวัติ

### เซสชันใหม่

หลังการรีเซ็ตเซสชัน handoff จะถูกบันทึกเป็น `custom_message` พร้อม `customType: "handoff"`

`buildSessionContext()` แปลงรายการนี้เป็นข้อความบริบทแบบกำหนดเอง/ผู้ใช้ระหว่างรันไทม์ผ่าน `createCustomMessage(...)` ดังนั้นจึงรวมอยู่ในพร้อมต์ในอนาคตจากเซสชันใหม่

## พฤติกรรม Controller/UI

พฤติกรรมของ `CommandController.handleHandoffCommand`:

- เรียก `await session.handoff(customInstructions)`
- หากผลลัพธ์เป็น `undefined`: `showError("Handoff cancelled")`
- เมื่อสำเร็จ:
  - `rebuildChatFromMessages()` (โหลดบริบทเซสชันใหม่ รวมถึง handoff ที่แทรก)
  - ทำให้ status line และขอบบนของตัวแก้ไขไม่ถูกต้อง
  - โหลด todo ใหม่
  - ต่อท้ายบรรทัดแชทสำเร็จ: `New session started with handoff context`
- เมื่อเกิดข้อยกเว้น:
  - หากข้อความเป็น `"Handoff cancelled"` หรือชื่อข้อผิดพลาดเป็น `AbortError`: `showError("Handoff cancelled")`
  - มิฉะนั้น: `showError("Handoff failed: <message>")`
- ร้องขอการ render ตอนท้าย

## ความหมายของการยกเลิก (พฤติกรรมปัจจุบัน)

### พื้นฐานการยกเลิกระดับเซสชัน

`AgentSession` เปิดเผย:

- `abortHandoff()` → ยกเลิก `#handoffAbortController`
- `isGeneratingHandoff` → true ขณะที่ controller มีอยู่

เมื่อใช้เส้นทางการยกเลิกนี้ subscriber ของ handoff จะปฏิเสธด้วย `Error("Handoff cancelled")` และ command controller แมปไปยัง UI การยกเลิก

### ข้อจำกัดของเส้นทาง `/handoff` แบบโต้ตอบ

ในการเชื่อมต่อ controller แบบโต้ตอบปัจจุบัน `/handoff` ไม่ได้ติดตั้ง handler Escape เฉพาะที่เรียก `abortHandoff()` (ต่างจากเส้นทาง compaction/branch-summary ที่แทนที่ `editor.onEscape` ชั่วคราว)

ผลกระทบในทางปฏิบัติ:

- มีการสนับสนุนการยกเลิกระดับเซสชัน แต่ไม่มี hook การผูกปุ่มเฉพาะ handoff ในเส้นทางคำสั่ง `/handoff`
- การขัดจังหวะของผู้ใช้อาจยังเกิดขึ้นผ่านเส้นทางการยกเลิก agent ที่กว้างกว่า แต่นั่นไม่ใช่ช่องทางการยกเลิกที่ชัดเจนแบบเดียวกับที่ `abortHandoff()` ใช้

## handoff ที่ถูกยกเลิกเทียบกับล้มเหลว

การจัดประเภท UI ปัจจุบัน:

- **ถูกยกเลิก/ยกเลิก**
  - เส้นทาง `abortHandoff()` ทริกเกอร์ `"Handoff cancelled"` หรือ
  - โยน `AbortError`
  - UI แสดง `Handoff cancelled`

- **ล้มเหลว**
  - ข้อผิดพลาดที่โยนอื่นๆ จาก `handoff()` / ไปป์ไลน์พร้อมต์ (ข้อผิดพลาดการตรวจสอบโมเดล/API ข้อยกเว้น runtime ฯลฯ)
  - UI แสดง `Handoff failed: ...`

ความละเอียดอ่อนเพิ่มเติม: หากการสร้างเสร็จสมบูรณ์แต่ไม่มีการดึงข้อความ `handoff()` จะ return `undefined` และ controller ปัจจุบันรายงานว่า**ถูกยกเลิก** ไม่ใช่**ล้มเหลว**

## การป้องกันเซสชันสั้นและเนื้อหาขั้นต่ำ

การป้องกันสองชั้นป้องกัน handoff ที่มีสัญญาณต่ำ:

- ชั้น UI (`handleHandoffCommand`): แสดงคำเตือนและ return ก่อนกำหนดสำหรับรายการข้อความ `< 2`
- ชั้นเซสชัน (`handoff()`): โยนเงื่อนไขเดียวกันเป็นข้อผิดพลาด

ซึ่งหลีกเลี่ยงการสร้างเซสชันใหม่ด้วยบริบท handoff ที่ว่างเปล่าหรือเกือบว่างเปล่า

## สรุปการเปลี่ยนสถานะ

흐름สถานะระดับสูง:

1. slash command แบบโต้ตอบถูกดักจับ
2. การตรวจสอบจำนวนข้อความก่อนบิน
3. สร้าง `#handoffAbortController` (`isGeneratingHandoff = true`)
4. ส่งพร้อมต์ handoff ภายใน (มองเห็นได้ในแชทเป็นการสร้างผู้ช่วยปกติ)
5. เมื่อ `agent_end` ดึงข้อความผู้ช่วยล่าสุด
6. หากขาดหาย/ถูกยกเลิก → return `undefined` หรือเส้นทางข้อผิดพลาดการยกเลิก
7. หากมีอยู่:
   - flush เซสชันเก่า
   - สร้างเซสชันว่างใหม่
   - รีเซ็ตคิว/ตัวนับ runtime
   - ต่อท้าย `custom_message(handoff)`
   - สร้างและแทนที่ข้อความ agent ที่ใช้งานอยู่ใหม่
8. Controller สร้าง UI แชทใหม่และประกาศความสำเร็จ
9. ล้าง `#handoffAbortController` (`isGeneratingHandoff = false`)

## ข้อสมมติฐานและข้อจำกัดที่ทราบ

- การดึง handoff เป็นแบบ heuristic: "บล็อกข้อความผู้ช่วยล่าสุด"; ไม่มีการตรวจสอบโครงสร้าง
- ไม่มีการตรวจสอบอย่างเข้มงวดว่า markdown ที่สร้างขึ้นเป็นไปตามรูปแบบส่วนที่ขอ
- ข้อความที่ดึงได้ขาดหายจะถูกรายงานเป็นการยกเลิกใน UX ของ controller
- 흐름โต้ตอบ `/handoff` ปัจจุบันขาด binding Escape→`abortHandoff()` เฉพาะ
- ข้อมูลเมตา lineage เซสชันใหม่ (`parentSession`) ไม่ถูกตั้งค่าโดยเส้นทางนี้
