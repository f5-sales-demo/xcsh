---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Handoff pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# ไปป์ไลน์การสร้าง `/handoff`

เอกสารนี้อธิบายวิธีที่ coding-agent ใช้งาน `/handoff` ในปัจจุบัน: เส้นทางการทริกเกอร์, พรอมต์การสร้าง, การจับผลลัพธ์, การสลับเซสชัน และการฉีดบริบทกลับเข้าไป

## ขอบเขต

ครอบคลุม:

- การส่งคำสั่ง `/handoff` แบบโต้ตอบ
- วงจรชีวิตและการเปลี่ยนสถานะของ `AgentSession.handoff()`
- วิธีการจับผลลัพธ์ handoff จาก assistant output
- วิธีที่เซสชันเก่า/ใหม่เก็บข้อมูล handoff แตกต่างกัน
- พฤติกรรม UI สำหรับกรณีสำเร็จ, ยกเลิก และล้มเหลว

ไม่ครอบคลุม:

- รายละเอียดภายในของ tree navigation/branch ทั่วไป
- คำสั่งเซสชันที่ไม่ใช่ handoff (`/new`, `/fork`, `/resume`)

## ไฟล์ที่เกี่ยวข้องกับการใช้งาน

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## เส้นทางการทริกเกอร์

1. `/handoff` ถูกประกาศใน metadata ของ slash command ในตัว (`slash-commands.ts`) พร้อมคำแนะนำแบบ inline ที่เป็นตัวเลือก: `[focus instructions]`
2. ในการจัดการอินพุตแบบโต้ตอบ (`InputController`) ข้อความที่ส่งซึ่งตรงกับ `/handoff` หรือ `/handoff ...` จะถูกสกัดกั้นก่อนการส่งพรอมต์ปกติ
3. ตัวแก้ไขจะถูกล้างและเรียก `handleHandoffCommand(customInstructions?)`
4. `CommandController.handleHandoffCommand` ทำการตรวจสอบเบื้องต้นโดยใช้รายการปัจจุบัน:
   - นับรายการที่เป็น `type === "message"`
   - หาก `< 2` จะแสดงคำเตือน: `Nothing to hand off (no messages yet)` และ return

การตรวจสอบเนื้อหาขั้นต่ำเดียวกันนี้มีอยู่อีกครั้งภายใน `AgentSession.handoff()` และจะ throw หากถูกละเมิด ซึ่งเป็นการทำซ้ำความปลอดภัยทั้งในชั้น UI และชั้นเซสชัน

## วงจรชีวิตแบบ end-to-end

### 1) เริ่มการสร้าง handoff

`AgentSession.handoff(customInstructions?)`:

- อ่านรายการ branch ปัจจุบัน (`sessionManager.getBranch()`)
- ตรวจสอบจำนวนข้อความขั้นต่ำ (`>= 2`)
- สร้าง `#handoffAbortController`
- สร้างพรอมต์แบบ inline คงที่ที่ร้องขอเอกสาร handoff แบบมีโครงสร้าง (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- เพิ่ม `Additional focus: ...` หากมีคำแนะนำที่กำหนดเอง

พรอมต์ถูกส่งผ่าน:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` ป้องกันการขยาย slash/prompt-template ของ payload คำสั่งภายในนี้

### 2) จับผลลัพธ์ completion

ก่อนส่งพรอมต์ `handoff()` จะ subscribe เหตุการณ์เซสชันและรอ `agent_end`

เมื่อเกิด `agent_end` จะดึงข้อความ handoff จาก agent state โดยสแกนย้อนกลับเพื่อหาข้อความ `assistant` ล่าสุด จากนั้นรวม `content` blocks ทั้งหมดที่มี `type === "text"` ด้วย `\n`

สมมติฐานสำคัญในการดึงข้อมูล:

- ใช้เฉพาะ text blocks เท่านั้น; เนื้อหาที่ไม่ใช่ข้อความจะถูกข้ามไป
- สมมติว่าข้อความ assistant ล่าสุดตรงกับการสร้าง handoff
- ไม่มีการแยกวิเคราะห์ส่วน markdown หรือตรวจสอบความถูกต้องของรูปแบบ
- หาก assistant output ไม่มี text blocks จะถือว่า handoff หายไป

### 3) การตรวจสอบการยกเลิก

`handoff()` คืนค่า `undefined` เมื่อเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง:

- ไม่มีข้อความ handoff ที่จับได้ หรือ
- `#handoffAbortController.signal.aborted` เป็น true

จะล้าง `#handoffAbortController` ใน `finally` เสมอ

### 4) การสร้างเซสชันใหม่

หากจับข้อความได้และไม่ถูกยกเลิก:

1. Flush session writer ปัจจุบัน (`sessionManager.flush()`)
2. เริ่มเซสชันใหม่ทั้งหมด (`sessionManager.newSession()`)
3. รีเซ็ต agent state ในหน่วยความจำ (`agent.reset()`)
4. ผูก `agent.sessionId` กับ id เซสชันใหม่
5. ล้างอาร์เรย์บริบทที่อยู่ในคิว (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. รีเซ็ตตัวนับการแจ้งเตือน todo

`newSession()` สร้าง header ใหม่และรายการ entry ว่างเปล่า (รีเซ็ต leaf เป็น `null`) ในเส้นทาง handoff จะไม่มีการส่ง `parentSession`

### 5) การฉีดบริบท handoff

เอกสาร handoff ที่สร้างขึ้นจะถูกห่อหุ้มและเพิ่มเข้าไปในเซสชันใหม่เป็นรายการ `custom_message`:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

การเรียกแทรก:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

ความหมาย:

- `customType`: `"handoff"`
- `display`: `true` (มองเห็นได้ในการสร้าง TUI ใหม่)
- ประเภท Entry: `custom_message` (มีส่วนร่วมในบริบท LLM)

### 6) สร้างบริบท agent ที่ใช้งานใหม่

หลังจากการฉีด:

1. `sessionManager.buildSessionContext()` แก้ไขรายการข้อความสำหรับ leaf ปัจจุบัน
2. `agent.replaceMessages(sessionContext.messages)` ทำให้ข้อความ handoff ที่ฉีดเข้าไปเป็นบริบทที่ใช้งานอยู่
3. เมธอดคืนค่า `{ document: handoffText }`

ณ จุดนี้ บริบท LLM ที่ใช้งานอยู่ในเซสชันใหม่จะมีข้อความ handoff ที่ฉีดเข้าไป ไม่ใช่ transcript เก่า

## โมเดลการเก็บข้อมูล: เซสชันเก่า vs เซสชันใหม่

### เซสชันเก่า

ระหว่างการสร้าง การเก็บข้อความปกติยังคงทำงานอยู่ การตอบกลับ handoff ของ assistant จะถูกเก็บเป็นรายการ `message` ปกติเมื่อ `message_end`

ผลลัพธ์: เซสชันดั้งเดิมจะมี handoff ที่สร้างขึ้นซึ่งมองเห็นได้เป็นส่วนหนึ่งของ transcript ประวัติ

### เซสชันใหม่

หลังจากรีเซ็ตเซสชัน handoff จะถูกเก็บเป็น `custom_message` ที่มี `customType: "handoff"`

`buildSessionContext()` แปลงรายการนี้เป็น runtime custom/user-context message ผ่าน `createCustomMessage(...)` ดังนั้นจึงรวมอยู่ในพรอมต์ในอนาคตจากเซสชันใหม่

## พฤติกรรม Controller/UI

พฤติกรรมของ `CommandController.handleHandoffCommand`:

- เรียก `await session.handoff(customInstructions)`
- หากผลลัพธ์เป็น `undefined`: `showError("Handoff cancelled")`
- เมื่อสำเร็จ:
  - `rebuildChatFromMessages()` (โหลดบริบทเซสชันใหม่ รวมถึง handoff ที่ฉีดเข้าไป)
  - ทำให้ status line และ editor top border ไม่ถูกต้อง
  - โหลด todos ใหม่
  - เพิ่มบรรทัดแชทสำเร็จ: `New session started with handoff context`
- เมื่อเกิดข้อยกเว้น:
  - หากข้อความเป็น `"Handoff cancelled"` หรือชื่อข้อผิดพลาดเป็น `AbortError`: `showError("Handoff cancelled")`
  - กรณีอื่น: `showError("Handoff failed: <message>")`
- ร้องขอ render เมื่อจบ

## ความหมายของการยกเลิก (พฤติกรรมปัจจุบัน)

### กลไกการยกเลิกระดับเซสชัน

`AgentSession` เปิดเผย:

- `abortHandoff()` → ยกเลิก `#handoffAbortController`
- `isGeneratingHandoff` → true ขณะที่ controller มีอยู่

เมื่อใช้เส้นทางการยกเลิกนี้ handoff subscriber จะ reject ด้วย `Error("Handoff cancelled")` และ command controller จะแมปไปยัง UI การยกเลิก

### ข้อจำกัดของเส้นทาง `/handoff` แบบโต้ตอบ

ในการเชื่อมต่อ interactive controller ปัจจุบัน `/handoff` ไม่ได้ติดตั้ง Escape handler เฉพาะที่เรียก `abortHandoff()` (ไม่เหมือนเส้นทาง compaction/branch-summary ที่ override `editor.onEscape` ชั่วคราว)

ผลกระทบในทางปฏิบัติ:

- มีการรองรับการยกเลิกระดับเซสชัน แต่ไม่มี keybinding hook เฉพาะ handoff ในเส้นทางคำสั่ง `/handoff`
- การขัดจังหวะของผู้ใช้อาจยังคงเกิดขึ้นผ่านเส้นทาง agent abort ที่กว้างขึ้น แต่นั่นไม่ใช่ช่องทางการยกเลิกแบบชัดเจนเดียวกันกับที่ `abortHandoff()` ใช้

## Handoff ที่ถูกยกเลิก vs ล้มเหลว

การจำแนกประเภท UI ปัจจุบัน:

- **ถูกยกเลิก/cancelled**
  - เส้นทาง `abortHandoff()` ทริกเกอร์ `"Handoff cancelled"` หรือ
  - throw `AbortError`
  - UI แสดง `Handoff cancelled`

- **ล้มเหลว**
  - ข้อผิดพลาดอื่นๆ ที่ throw จาก `handoff()` / prompt pipeline (ข้อผิดพลาดการตรวจสอบ model/API, runtime exceptions เป็นต้น)
  - UI แสดง `Handoff failed: ...`

รายละเอียดเพิ่มเติม: หากการสร้างเสร็จสมบูรณ์แต่ไม่มีข้อความที่ดึงออกมาได้ `handoff()` จะคืนค่า `undefined` และ controller ปัจจุบันจะรายงานว่า **ถูกยกเลิก** ไม่ใช่ **ล้มเหลว**

## การป้องกันเซสชันสั้นและเนื้อหาขั้นต่ำ

การป้องกันสองจุดป้องกัน handoff ที่มีสัญญาณต่ำ:

- ชั้น UI (`handleHandoffCommand`): เตือนและ return ก่อนกำหนดสำหรับรายการข้อความ `< 2`
- ชั้นเซสชัน (`handoff()`): throw เงื่อนไขเดียวกันเป็นข้อผิดพลาด

สิ่งนี้หลีกเลี่ยงการสร้างเซสชันใหม่ที่มีบริบท handoff ว่างเปล่า/เกือบว่างเปล่า

## สรุปการเปลี่ยนสถานะ

กระแสสถานะระดับสูง:

1. สกัดกั้น slash command แบบโต้ตอบ
2. การตรวจสอบจำนวนข้อความเบื้องต้น
3. สร้าง `#handoffAbortController` (`isGeneratingHandoff = true`)
4. ส่ง handoff prompt ภายใน (มองเห็นได้ในแชทเป็นการสร้าง assistant ปกติ)
5. เมื่อ `agent_end` ดึงข้อความ assistant ล่าสุด
6. หากหายไป/ถูกยกเลิก → คืนค่า `undefined` หรือเส้นทางข้อผิดพลาดการยกเลิก
7. หากมีอยู่:
   - flush เซสชันเก่า
   - สร้างเซสชันว่างเปล่าใหม่
   - รีเซ็ตคิว runtime/ตัวนับ
   - เพิ่ม `custom_message(handoff)`
   - สร้างใหม่และแทนที่ข้อความ agent ที่ใช้งานอยู่
8. Controller สร้าง UI แชทใหม่และประกาศความสำเร็จ
9. ล้าง `#handoffAbortController` (`isGeneratingHandoff = false`)

## สมมติฐานและข้อจำกัดที่ทราบ

- การดึง handoff เป็นแบบ heuristic: "text blocks ของ assistant ล่าสุด"; ไม่มีการตรวจสอบโครงสร้าง
- ไม่มีการตรวจสอบอย่างเข้มงวดว่า markdown ที่สร้างขึ้นเป็นไปตามรูปแบบส่วนที่ร้องขอ
- ข้อความที่ดึงออกมาหายไปจะถูกรายงานเป็นการยกเลิกใน UX ของ controller
- กระแส `/handoff` แบบโต้ตอบปัจจุบันขาด binding เฉพาะ Escape→`abortHandoff()`
- metadata สายเซสชันใหม่ (`parentSession`) ไม่ถูกตั้งค่าโดยเส้นทางนี้
