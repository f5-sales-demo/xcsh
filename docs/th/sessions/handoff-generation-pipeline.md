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

เอกสารนี้อธิบายวิธีที่ coding-agent ใช้งาน `/handoff` ในปัจจุบัน: เส้นทางการเรียกใช้, พรอมต์การสร้าง, การจับผลลัพธ์, การสลับเซสชัน และการฉีดบริบทกลับเข้าไป

## ขอบเขต

ครอบคลุม:

- การส่งคำสั่ง `/handoff` แบบโต้ตอบ
- วงจรชีวิตและการเปลี่ยนสถานะของ `AgentSession.handoff()`
- วิธีการจับผลลัพธ์ handoff จากเอาต์พุตของ assistant
- วิธีที่เซสชันเก่า/ใหม่จัดเก็บข้อมูล handoff แตกต่างกัน
- พฤติกรรมของ UI สำหรับกรณีสำเร็จ, ยกเลิก และล้มเหลว

ไม่ครอบคลุม:

- รายละเอียดภายในของการนำทางทรี/สาขาทั่วไป
- คำสั่งเซสชันที่ไม่ใช่ handoff (`/new`, `/fork`, `/resume`)

## ไฟล์การใช้งาน

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## เส้นทางการเรียกใช้

1. `/handoff` ถูกประกาศในเมทาดาต้า slash command ในตัว (`slash-commands.ts`) พร้อมคำแนะนำแบบ inline ที่ไม่บังคับ: `[focus instructions]`
2. ในการจัดการอินพุตแบบโต้ตอบ (`InputController`) ข้อความที่ส่งซึ่งตรงกับ `/handoff` หรือ `/handoff ...` จะถูกดักจับก่อนการส่งพรอมต์ปกติ
3. เอดิเตอร์จะถูกล้างและเรียก `handleHandoffCommand(customInstructions?)`
4. `CommandController.handleHandoffCommand` ทำการตรวจสอบเบื้องต้นโดยใช้รายการปัจจุบัน:
   - นับรายการที่เป็น `type === "message"`
   - หากมี `< 2` จะแจ้งเตือน: `Nothing to hand off (no messages yet)` แล้ว return

การตรวจสอบเนื้อหาขั้นต่ำแบบเดียวกันนี้มีอยู่อีกครั้งภายใน `AgentSession.handoff()` และจะ throw หากถูกละเมิด ซึ่งเป็นการซ้ำซ้อนเพื่อความปลอดภัยทั้งในชั้น UI และเซสชัน

## วงจรชีวิตแบบ end-to-end

### 1) เริ่มการสร้าง handoff

`AgentSession.handoff(customInstructions?)`:

- อ่านรายการสาขาปัจจุบัน (`sessionManager.getBranch()`)
- ตรวจสอบจำนวนข้อความขั้นต่ำ (`>= 2`)
- สร้าง `#handoffAbortController`
- สร้างพรอมต์คงที่แบบ inline ที่ร้องขอเอกสาร handoff ที่มีโครงสร้าง (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- เพิ่ม `Additional focus: ...` หากมีคำสั่งแบบกำหนดเอง

พรอมต์ถูกส่งผ่าน:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` ป้องกันการขยาย slash/prompt-template ของ payload คำสั่งภายในนี้

### 2) จับผลลัพธ์

ก่อนส่งพรอมต์ `handoff()` จะ subscribe กับเหตุการณ์เซสชันและรอ `agent_end`

เมื่อเกิด `agent_end` จะดึงข้อความ handoff จาก agent state โดยสแกนย้อนกลับหาข้อความ `assistant` ล่าสุด แล้วรวมบล็อก `content` ทั้งหมดที่ `type === "text"` ด้วย `\n`

ข้อสมมติสำคัญในการดึงข้อมูล:

- ใช้เฉพาะบล็อกข้อความเท่านั้น เนื้อหาที่ไม่ใช่ข้อความจะถูกข้ามไป
- สมมติว่าข้อความ assistant ล่าสุดสอดคล้องกับการสร้าง handoff
- ไม่ได้แยกวิเคราะห์ส่วน markdown หรือตรวจสอบความถูกต้องของรูปแบบ
- หากเอาต์พุต assistant ไม่มีบล็อกข้อความ handoff จะถือว่าขาดหายไป

### 3) การตรวจสอบการยกเลิก

`handoff()` จะ return `undefined` เมื่อเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง:

- ไม่มีข้อความ handoff ที่จับได้, หรือ
- `#handoffAbortController.signal.aborted` เป็น true

จะล้าง `#handoffAbortController` ใน `finally` เสมอ

### 4) การสร้างเซสชันใหม่

หากจับข้อความได้และไม่ถูกยกเลิก:

1. ล้าง session writer ปัจจุบัน (`sessionManager.flush()`)
2. เริ่มเซสชันใหม่ทั้งหมด (`sessionManager.newSession()`)
3. รีเซ็ต agent state ในหน่วยความจำ (`agent.reset()`)
4. ผูก `agent.sessionId` ใหม่กับ session id ใหม่
5. ล้างอาร์เรย์บริบทที่อยู่ในคิว (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. รีเซ็ตตัวนับการแจ้งเตือน todo

`newSession()` สร้างเฮดเดอร์ใหม่และรายการเอนทรีว่าง (leaf ถูกรีเซ็ตเป็น `null`) ในเส้นทาง handoff จะไม่มีการส่ง `parentSession`

### 5) การฉีดบริบท handoff

เอกสาร handoff ที่สร้างขึ้นจะถูกห่อหุ้มและเพิ่มลงในเซสชันใหม่เป็นเอนทรี `custom_message`:

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
- `display`: `true` (แสดงผลใน TUI rebuild)
- ประเภทเอนทรี: `custom_message` (มีส่วนร่วมในบริบท LLM)

### 6) สร้างบริบท agent ที่ใช้งานอยู่ใหม่

หลังจากฉีดบริบท:

1. `sessionManager.buildSessionContext()` สร้างรายการข้อความสำหรับ leaf ปัจจุบัน
2. `agent.replaceMessages(sessionContext.messages)` ทำให้ข้อความ handoff ที่ฉีดเข้าไปเป็นบริบทที่ใช้งานอยู่
3. เมธอด return `{ document: handoffText }`

ณ จุดนี้ บริบท LLM ที่ใช้งานอยู่ในเซสชันใหม่จะมีข้อความ handoff ที่ฉีดเข้าไป ไม่ใช่ทรานสคริปต์เดิม

## โมเดลการจัดเก็บ: เซสชันเก่า vs เซสชันใหม่

### เซสชันเก่า

ระหว่างการสร้าง การจัดเก็บข้อความปกติยังคงทำงานอยู่ การตอบกลับ handoff ของ assistant จะถูกจัดเก็บเป็นเอนทรี `message` ปกติเมื่อเกิด `message_end`

ผลลัพธ์: เซสชันเดิมจะมี handoff ที่สร้างขึ้นเป็นส่วนหนึ่งของทรานสคริปต์ประวัติที่มองเห็นได้

### เซสชันใหม่

หลังจากรีเซ็ตเซสชัน handoff จะถูกจัดเก็บเป็น `custom_message` พร้อม `customType: "handoff"`

`buildSessionContext()` จะแปลงเอนทรีนี้เป็นข้อความ custom/user-context ระหว่างรันไทม์ผ่าน `createCustomMessage(...)` เพื่อให้รวมอยู่ในพรอมต์ในอนาคตจากเซสชันใหม่

## พฤติกรรมของ Controller/UI

พฤติกรรมของ `CommandController.handleHandoffCommand`:

- เรียก `await session.handoff(customInstructions)`
- หากผลลัพธ์เป็น `undefined`: `showError("Handoff cancelled")`
- เมื่อสำเร็จ:
  - `rebuildChatFromMessages()` (โหลดบริบทเซสชันใหม่ รวมถึง handoff ที่ฉีดเข้าไป)
  - ทำให้ status line และ editor top border ไม่ถูกต้อง
  - โหลด todos ใหม่
  - เพิ่มบรรทัดแชทสำเร็จ: `New session started with handoff context`
- เมื่อเกิดข้อยกเว้น:
  - หากข้อความเป็น `"Handoff cancelled"` หรือชื่อ error เป็น `AbortError`: `showError("Handoff cancelled")`
  - มิฉะนั้น: `showError("Handoff failed: <message>")`
- ร้องขอการ render ในตอนท้าย

## ความหมายของการยกเลิก (พฤติกรรมปัจจุบัน)

### กลไกการยกเลิกระดับเซสชัน

`AgentSession` เปิดเผย:

- `abortHandoff()` → ยกเลิก `#handoffAbortController`
- `isGeneratingHandoff` → true ขณะที่ controller มีอยู่

เมื่อใช้เส้นทางการยกเลิกนี้ subscriber ของ handoff จะ reject ด้วย `Error("Handoff cancelled")` และ command controller จะแมปไปยัง UI การยกเลิก

### ข้อจำกัดของเส้นทาง `/handoff` แบบโต้ตอบ

ในการเชื่อมต่อ interactive controller ปัจจุบัน `/handoff` ไม่ได้ติดตั้ง Escape handler เฉพาะที่เรียก `abortHandoff()` (ต่างจากเส้นทาง compaction/branch-summary ที่ override `editor.onEscape` ชั่วคราว)

ผลกระทบในทางปฏิบัติ:

- มีการสนับสนุนการยกเลิกระดับเซสชัน แต่ไม่มี hook การผูกปุ่มเฉพาะสำหรับ handoff ในเส้นทางคำสั่ง `/handoff`
- การขัดจังหวะของผู้ใช้อาจยังเกิดขึ้นได้ผ่านเส้นทางการยกเลิก agent แบบกว้างขึ้น แต่นั่นไม่ใช่ช่องทางการยกเลิกแบบชัดเจนเดียวกับที่ใช้โดย `abortHandoff()`

## Handoff ที่ถูกยกเลิก vs ล้มเหลว

การจำแนกของ UI ปัจจุบัน:

- **ถูกยกเลิก/Cancelled**
  - เส้นทาง `abortHandoff()` ทริกเกอร์ `"Handoff cancelled"`, หรือ
  - throw `AbortError`
  - UI แสดง `Handoff cancelled`

- **ล้มเหลว/Failed**
  - error อื่นๆ ที่ throw จาก `handoff()` / ไปป์ไลน์พรอมต์ (ข้อผิดพลาดการตรวจสอบ model/API, runtime exceptions เป็นต้น)
  - UI แสดง `Handoff failed: ...`

รายละเอียดเพิ่มเติม: หากการสร้างเสร็จสมบูรณ์แต่ไม่มีข้อความถูกดึงออกมา `handoff()` จะ return `undefined` และ controller ปัจจุบันจะรายงานเป็น **cancelled** ไม่ใช่ **failed**

## การป้องกันเซสชันสั้นและเนื้อหาขั้นต่ำ

การป้องกันสองชั้นป้องกัน handoff ที่มีสัญญาณต่ำ:

- ชั้น UI (`handleHandoffCommand`): แจ้งเตือนและ return ก่อนเวลาสำหรับรายการข้อความ `< 2`
- ชั้นเซสชัน (`handoff()`): throw เงื่อนไขเดียวกันเป็น error

ซึ่งหลีกเลี่ยงการสร้างเซสชันใหม่ที่มีบริบท handoff ว่างเปล่า/เกือบว่างเปล่า

## สรุปการเปลี่ยนสถานะ

ลำดับสถานะระดับสูง:

1. ดักจับ slash command แบบโต้ตอบ
2. การตรวจสอบเบื้องต้นจำนวนข้อความ
3. สร้าง `#handoffAbortController` (`isGeneratingHandoff = true`)
4. ส่งพรอมต์ handoff ภายใน (แสดงในแชทเป็นการสร้างของ assistant ปกติ)
5. เมื่อเกิด `agent_end` ดึงข้อความ assistant ล่าสุด
6. หากขาดหาย/ถูกยกเลิก → return `undefined` หรือเส้นทาง error การยกเลิก
7. หากมีอยู่:
   - ล้างเซสชันเก่า
   - สร้างเซสชันใหม่ที่ว่างเปล่า
   - รีเซ็ตคิว/ตัวนับระหว่างรันไทม์
   - เพิ่ม `custom_message(handoff)`
   - สร้างใหม่และแทนที่ข้อความ agent ที่ใช้งานอยู่
8. Controller สร้าง UI แชทใหม่และประกาศความสำเร็จ
9. ล้าง `#handoffAbortController` (`isGeneratingHandoff = false`)

## ข้อสมมติและข้อจำกัดที่ทราบ

- การดึงข้อมูล handoff เป็นแบบ heuristic: "บล็อกข้อความ assistant ล่าสุด"; ไม่มีการตรวจสอบโครงสร้าง
- ไม่มีการตรวจสอบอย่างเข้มงวดว่า markdown ที่สร้างขึ้นตามรูปแบบส่วนที่ร้องขอ
- ข้อความที่ดึงมาหายไปจะถูกรายงานเป็นการยกเลิกใน UX ของ controller
- เส้นทางโต้ตอบ `/handoff` ปัจจุบันขาดการผูก Escape→`abortHandoff()` เฉพาะ
- เมทาดาต้าสายสัมพันธ์เซสชันใหม่ (`parentSession`) ไม่ได้ถูกตั้งค่าโดยเส้นทางนี้
