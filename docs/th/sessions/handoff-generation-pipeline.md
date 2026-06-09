---
title: ไปป์ไลน์การสร้าง Handoff
description: ไปป์ไลน์การสร้าง handoff สำหรับสร้างสรุปเซสชันแบบพกพาเพื่อการทำงานร่วมกันในทีม
sidebar:
  order: 8
  label: ไปป์ไลน์ Handoff
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
- วิธีจับผลลัพธ์ handoff จากเอาต์พุตของ assistant
- วิธีที่เซสชันเก่า/ใหม่เก็บข้อมูล handoff แตกต่างกัน
- พฤติกรรม UI สำหรับกรณีสำเร็จ, ยกเลิก และล้มเหลว

ไม่ครอบคลุม:

- รายละเอียดภายในของการนำทาง tree/branch ทั่วไป
- คำสั่งเซสชันที่ไม่ใช่ handoff (`/new`, `/fork`, `/resume`)

## ไฟล์ที่เกี่ยวข้องกับการใช้งาน

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## เส้นทางการทริกเกอร์

1. `/handoff` ถูกประกาศในเมตาดาต้า slash command ที่มีมาในตัว (`slash-commands.ts`) พร้อมคำแนะนำแบบ inline ที่เป็นทางเลือก: `[focus instructions]`
2. ในการจัดการอินพุตแบบโต้ตอบ (`InputController`) ข้อความที่ส่งตรงกับ `/handoff` หรือ `/handoff ...` จะถูกดักจับก่อนการส่งพรอมต์ปกติ
3. ตัวแก้ไขจะถูกล้างและเรียก `handleHandoffCommand(customInstructions?)`
4. `CommandController.handleHandoffCommand` ทำการตรวจสอบเบื้องต้นโดยใช้รายการปัจจุบัน:
   - นับรายการที่มี `type === "message"`
   - หากน้อยกว่า `< 2` จะแจ้งเตือน: `Nothing to hand off (no messages yet)` แล้วคืนค่ากลับ

การตรวจสอบเนื้อหาขั้นต่ำเดียวกันนี้มีอยู่อีกครั้งภายใน `AgentSession.handoff()` และจะ throw หากไม่ผ่านเงื่อนไข ทำให้มีการตรวจสอบความปลอดภัยซ้ำที่ทั้งเลเยอร์ UI และเลเยอร์เซสชัน

## วงจรชีวิตแบบ End-to-end

### 1) เริ่มการสร้าง handoff

`AgentSession.handoff(customInstructions?)`:

- อ่านรายการ branch ปัจจุบัน (`sessionManager.getBranch()`)
- ตรวจสอบจำนวนข้อความขั้นต่ำ (`>= 2`)
- สร้าง `#handoffAbortController`
- สร้างพรอมต์แบบ inline คงที่ที่ร้องขอเอกสาร handoff ที่มีโครงสร้าง (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- เพิ่ม `Additional focus: ...` หากมี custom instructions

พรอมต์ถูกส่งผ่าน:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` ป้องกันการขยาย slash/prompt-template ของ payload คำสั่งภายในนี้

### 2) จับผลลัพธ์ completion

ก่อนส่งพรอมต์ `handoff()` จะ subscribe ไปยังอีเวนต์ของเซสชันและรอ `agent_end`

เมื่อเกิด `agent_end` จะดึงข้อความ handoff จากสถานะ agent โดยสแกนย้อนกลับหาข้อความ `assistant` ล่าสุด จากนั้นรวมบล็อก `content` ทั้งหมดที่มี `type === "text"` ด้วย `\n`

สมมติฐานสำคัญในการดึงข้อมูล:

- ใช้เฉพาะบล็อกข้อความเท่านั้น; เนื้อหาที่ไม่ใช่ข้อความจะถูกละเว้น
- สมมติว่าข้อความ assistant ล่าสุดตรงกับการสร้าง handoff
- ไม่มีการแยกวิเคราะห์ส่วน markdown หรือตรวจสอบความถูกต้องของรูปแบบ
- หากเอาต์พุต assistant ไม่มีบล็อกข้อความ handoff จะถือว่าไม่มี

### 3) การตรวจสอบการยกเลิก

`handoff()` คืนค่า `undefined` เมื่อเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง:

- ไม่มีข้อความ handoff ที่จับได้ หรือ
- `#handoffAbortController.signal.aborted` เป็น true

จะล้าง `#handoffAbortController` ใน `finally` เสมอ

### 4) การสร้างเซสชันใหม่

หากจับข้อความได้และไม่ถูกยกเลิก:

1. Flush session writer ปัจจุบัน (`sessionManager.flush()`)
2. เริ่มเซสชันใหม่ (`sessionManager.newSession()`)
3. รีเซ็ตสถานะ agent ในหน่วยความจำ (`agent.reset()`)
4. ผูก `agent.sessionId` ใหม่กับ session id ใหม่
5. ล้างอาร์เรย์บริบทที่อยู่ในคิว (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. รีเซ็ตตัวนับ todo reminder

`newSession()` สร้าง header ใหม่และรายการ entry ว่าง (leaf รีเซ็ตเป็น `null`) ในเส้นทาง handoff จะไม่มีการส่ง `parentSession`

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
- `display`: `true` (แสดงผลได้ใน TUI rebuild)
- ประเภท entry: `custom_message` (มีส่วนร่วมในบริบท LLM)

### 6) สร้างบริบท agent ที่ใช้งานอยู่ใหม่

หลังจากการฉีด:

1. `sessionManager.buildSessionContext()` แก้ไขรายการข้อความสำหรับ leaf ปัจจุบัน
2. `agent.replaceMessages(sessionContext.messages)` ทำให้ข้อความ handoff ที่ฉีดเข้าไปเป็นบริบทที่ใช้งานอยู่
3. เมธอดคืนค่า `{ document: handoffText }`

ณ จุดนี้ บริบท LLM ที่ใช้งานอยู่ในเซสชันใหม่ประกอบด้วยข้อความ handoff ที่ฉีดเข้าไป ไม่ใช่ transcript เก่า

## โมเดลการเก็บข้อมูล: เซสชันเก่า vs เซสชันใหม่

### เซสชันเก่า

ระหว่างการสร้าง การเก็บข้อความปกติยังคงทำงานอยู่ การตอบ handoff ของ assistant จะถูกเก็บเป็นรายการ `message` ปกติเมื่อ `message_end`

ผลลัพธ์: เซสชันเดิมมี handoff ที่สร้างขึ้นและแสดงผลได้เป็นส่วนหนึ่งของ transcript ประวัติ

### เซสชันใหม่

หลังจากรีเซ็ตเซสชัน handoff จะถูกเก็บเป็น `custom_message` ที่มี `customType: "handoff"`

`buildSessionContext()` แปลงรายการนี้เป็นข้อความ custom/user-context ขณะรันไทม์ผ่าน `createCustomMessage(...)` ดังนั้นจะถูกรวมในพรอมต์ในอนาคตจากเซสชันใหม่

## พฤติกรรม Controller/UI

พฤติกรรมของ `CommandController.handleHandoffCommand`:

- เรียก `await session.handoff(customInstructions)`
- หากผลลัพธ์เป็น `undefined`: `showError("Handoff cancelled")`
- เมื่อสำเร็จ:
  - `rebuildChatFromMessages()` (โหลดบริบทเซสชันใหม่ รวมถึง handoff ที่ฉีดเข้าไป)
  - ทำให้ status line และ editor top border ไม่ถูกต้อง (invalidate)
  - โหลด todos ใหม่
  - เพิ่มบรรทัดแชทสำเร็จ: `New session started with handoff context`
- เมื่อเกิดข้อยกเว้น:
  - หากข้อความคือ `"Handoff cancelled"` หรือชื่อ error คือ `AbortError`: `showError("Handoff cancelled")`
  - มิฉะนั้น: `showError("Handoff failed: <message>")`
- ร้องขอการ render เมื่อสิ้นสุด

## ความหมายของการยกเลิก (พฤติกรรมปัจจุบัน)

### primitive การยกเลิกระดับเซสชัน

`AgentSession` เปิดเผย:

- `abortHandoff()` → ยกเลิก `#handoffAbortController`
- `isGeneratingHandoff` → true ขณะที่ controller ยังมีอยู่

เมื่อใช้เส้นทาง abort นี้ subscriber ของ handoff จะ reject ด้วย `Error("Handoff cancelled")` และ command controller จะแมปไปยัง UI การยกเลิก

### ข้อจำกัดของเส้นทาง `/handoff` แบบโต้ตอบ

ในการเชื่อมต่อ interactive controller ปัจจุบัน `/handoff` ไม่ได้ติดตั้ง Escape handler เฉพาะที่เรียก `abortHandoff()` (ต่างจากเส้นทาง compaction/branch-summary ที่แทนที่ `editor.onEscape` ชั่วคราว)

ผลกระทบในทางปฏิบัติ:

- มีการรองรับการยกเลิกระดับเซสชัน แต่ไม่มี keybinding hook เฉพาะ handoff ในเส้นทางคำสั่ง `/handoff`
- การขัดจังหวะจากผู้ใช้อาจยังเกิดขึ้นได้ผ่านเส้นทาง agent abort ที่กว้างกว่า แต่นั่นไม่ใช่ช่องทางการยกเลิกแบบชัดเจนเดียวกันที่ใช้โดย `abortHandoff()`

## Handoff ที่ถูกยกเลิก vs ล้มเหลว

การจำแนกประเภท UI ปัจจุบัน:

- **ถูกยกเลิก/cancelled**
  - เส้นทาง `abortHandoff()` ทริกเกอร์ `"Handoff cancelled"` หรือ
  - throw `AbortError`
  - UI แสดง `Handoff cancelled`

- **ล้มเหลว**
  - error อื่นๆ ที่ throw จาก `handoff()` / prompt pipeline (ข้อผิดพลาดการตรวจสอบ model/API, runtime exceptions ฯลฯ)
  - UI แสดง `Handoff failed: ...`

ความแตกต่างเพิ่มเติม: หากการสร้างเสร็จสมบูรณ์แต่ไม่มีข้อความที่ดึงออกมาได้ `handoff()` จะคืนค่า `undefined` และ controller ปัจจุบันรายงานว่า **ถูกยกเลิก** ไม่ใช่ **ล้มเหลว**

## การป้องกันเซสชันสั้นและเนื้อหาขั้นต่ำ

การตรวจสอบสองจุดป้องกัน handoff ที่มีข้อมูลน้อย:

- เลเยอร์ UI (`handleHandoffCommand`): แจ้งเตือนและคืนค่าก่อนกำหนดสำหรับรายการข้อความ `< 2`
- เลเยอร์เซสชัน (`handoff()`): throw เงื่อนไขเดียวกันเป็น error

สิ่งนี้หลีกเลี่ยงการสร้างเซสชันใหม่ที่มีบริบท handoff ว่าง/เกือบว่าง

## สรุปการเปลี่ยนสถานะ

ลำดับการเปลี่ยนสถานะระดับสูง:

1. คำสั่ง slash แบบโต้ตอบถูกดักจับ
2. การตรวจสอบจำนวนข้อความเบื้องต้น
3. สร้าง `#handoffAbortController` (`isGeneratingHandoff = true`)
4. ส่งพรอมต์ handoff ภายใน (แสดงในแชทเป็นการสร้างจาก assistant ปกติ)
5. เมื่อเกิด `agent_end` ดึงข้อความ assistant ล่าสุด
6. หากไม่มี/ถูกยกเลิก → คืนค่า `undefined` หรือเส้นทาง cancellation error
7. หากมี:
   - flush เซสชันเก่า
   - สร้างเซสชันใหม่ว่าง
   - รีเซ็ตคิวและตัวนับ runtime
   - เพิ่ม `custom_message(handoff)`
   - สร้างใหม่และแทนที่ข้อความ agent ที่ใช้งานอยู่
8. Controller สร้าง UI แชทใหม่และประกาศความสำเร็จ
9. ล้าง `#handoffAbortController` (`isGeneratingHandoff = false`)

## สมมติฐานและข้อจำกัดที่ทราบ

- การดึง handoff เป็นแบบ heuristic: "บล็อกข้อความ assistant ล่าสุด"; ไม่มีการตรวจสอบโครงสร้าง
- ไม่มีการตรวจสอบอย่างเข้มงวดว่า markdown ที่สร้างขึ้นเป็นไปตามรูปแบบส่วนที่ร้องขอ
- ข้อความที่ดึงออกมาไม่ได้จะถูกรายงานเป็นการยกเลิกใน UX ของ controller
- ลำดับการทำงานแบบโต้ตอบของ `/handoff` ปัจจุบันขาดการผูก Escape→`abortHandoff()` เฉพาะ
- เมตาดาต้าสายสัมพันธ์ของเซสชันใหม่ (`parentSession`) ไม่ได้ถูกตั้งค่าโดยเส้นทางนี้
