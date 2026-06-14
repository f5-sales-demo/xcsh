---
title: นโยบายการลองใหม่อัตโนมัติแบบไม่บีบอัด
description: นโยบายการลองใหม่อัตโนมัติสำหรับความล้มเหลวของ API ชั่วคราวนอกเส้นทางการบีบอัด
sidebar:
  order: 6
  label: นโยบายการลองใหม่
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# นโยบายการลองใหม่อัตโนมัติแบบไม่บีบอัด

เอกสารนี้อธิบายเส้นทางการลองใหม่เมื่อเกิดข้อผิดพลาด API มาตรฐานใน `AgentSession`

โดยไม่รวมการกู้คืนจากการล้นของบริบทผ่านการบีบอัดอัตโนมัติ การล้นจะถูกจัดการโดยตรรกะการบีบอัดและมีเอกสารแยกต่างหากใน [`compaction.md`](./compaction.md)

## ไฟล์การดำเนินงาน

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## ขอบเขตของนโยบายเทียบกับการบีบอัด

การลองใหม่และการบีบอัดจะถูกตรวจสอบจากเส้นทาง `agent_end` เดียวกัน แต่แยกออกจากกันโดยเจตนา:

1. `agent_end` ตรวจสอบข้อความผู้ช่วยล่าสุด
2. `#isRetryableError(...)` ทำงานก่อน
3. หากเริ่มการลองใหม่ การตรวจสอบการบีบอัดจะถูกข้ามในรอบนั้น
4. ข้อผิดพลาดการล้นของบริบทถูกตัดออกอย่างเด็ดขาดจากการจำแนกการลองใหม่ (`isContextOverflow(...)` ทำการลัดวงจรการลองใหม่)
5. การล้นจึงส่งผ่านไปยัง `#checkCompaction(...)` แทนการลองใหม่มาตรฐาน

กล่าวโดยสรุป: ความล้มเหลวแบบโอเวอร์โหลด/ราคา/เซิร์ฟเวอร์/เครือข่ายใช้นโยบายการลองใหม่นี้ ส่วนการล้นของหน้าต่างบริบทใช้การกู้คืนด้วยการบีบอัด

## การจำแนกการลองใหม่

`#isRetryableError(...)` ต้องการเงื่อนไขทั้งหมดต่อไปนี้:

- `stopReason === "error"` ของผู้ช่วย
- `errorMessage` มีอยู่
- ข้อความ **ไม่ใช่** การล้นของบริบท
- `errorMessage` ตรงกับ `#isRetryableErrorMessage(...)`

ชุดรูปแบบที่ลองใหม่ได้ปัจจุบัน (อิงจาก regex):

- overloaded
- rate limit / usage limit / too many requests
- คลาสเซิร์ฟเวอร์แบบ HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- วลี `retry delay`

นี่คือการจำแนกแบบรูปแบบสตริง ไม่ใช่รหัสข้อผิดพลาดผู้ให้บริการแบบมีชนิด

## วงจรชีวิตการลองใหม่และการเปลี่ยนสถานะ

สถานะเซสชันที่ใช้โดยการลองใหม่:

- `#retryAttempt: number` (`0` หมายถึงไม่ทำงาน)
- `#retryPromise: Promise<void> | undefined` (ติดตามวงจรชีวิตการลองใหม่ที่กำลังดำเนินการ)
- `#retryResolve: (() => void) | undefined` (แก้ไข `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (ยกเลิกการนอนหลับแบบ backoff)

ขั้นตอน (`#handleRetryableError`):

1. อ่านกลุ่มการตั้งค่า `retry`
2. หาก `retry.enabled === false` หยุดทันที (`false` ไม่เริ่มการลองใหม่)
3. เพิ่ม `#retryAttempt`
4. สร้าง `#retryPromise` ครั้งเดียว (ความพยายามครั้งแรกในห่วงโซ่)
5. หากจำนวนครั้งเกิน `retry.maxRetries` ส่งเหตุการณ์ความล้มเหลวสุดท้ายและหยุด
6. คำนวณความล่าช้า: `retry.baseDelayMs * 2^(attempt-1)`
7. สำหรับข้อผิดพลาดขีดจำกัดการใช้งาน ให้วิเคราะห์คำแนะนำการลองใหม่และเรียก auth storage (`markUsageLimitReached(...)`); หากการสลับผู้ให้บริการ/โมเดลสำเร็จ บังคับให้ความล่าช้าเป็น `0`
8. ส่ง `auto_retry_start`
9. ลบข้อความผิดพลาดผู้ช่วยท้ายสุดออกจากสถานะ runtime ของ agent (เก็บไว้ในประวัติเซสชันที่บันทึกไว้)
10. นอนหลับพร้อมรองรับการยกเลิก
11. เมื่อตื่น กำหนดเวลา `agent.continue()` ผ่าน `setTimeout(..., 0)`

### สิ่งที่รีเซ็ตตัวนับการลองใหม่

`#retryAttempt` รีเซ็ตเป็น `0` ในกรณีเหล่านี้:

- ข้อความผู้ช่วยที่ไม่มีข้อผิดพลาดและไม่ถูกยกเลิกสำเร็จครั้งแรกหลังจากเริ่มการลองใหม่ (ส่ง `auto_retry_end { success: true }`)
- การยกเลิกการลองใหม่ระหว่างการนอนหลับ backoff
- เส้นทางที่เกินจำนวนครั้งสูงสุด

`#retryPromise` แก้ไข/ล้างเมื่อห่วงโซ่การลองใหม่สิ้นสุด (สำเร็จ ยกเลิก หรือเกินจำนวนสูงสุด) ผ่าน `#resolveRetry()`

## ความหมายของ Backoff และจำนวนครั้งสูงสุด

การตั้งค่า:

- `retry.enabled` (ค่าเริ่มต้น `true`)
- `retry.maxRetries` (ค่าเริ่มต้น `3`)
- `retry.baseDelayMs` (ค่าเริ่มต้น `2000`)

การนับจำนวนครั้ง:

- ตัวนับครั้งจะเพิ่มก่อนการตรวจสอบจำนวนสูงสุด
- เหตุการณ์เริ่มต้นใช้ครั้งปัจจุบัน (นับจาก 1)
- เหตุการณ์สิ้นสุดที่เกินจำนวนสูงสุดรายงาน `attempt: this.#retryAttempt - 1` (จำนวนครั้งลองใหม่ครั้งสุดท้าย)

ลำดับ backoff ด้วยการตั้งค่าเริ่มต้น:

- ครั้งที่ 1: 2000 ms
- ครั้งที่ 2: 4000 ms
- ครั้งที่ 3: 8000 ms

อินพุตการแทนที่ความล่าช้าจะใช้เฉพาะในเส้นทางการจัดการขีดจำกัดการใช้งาน และเพื่อมีอิทธิพลต่อการตัดสินใจสลับโมเดล/บัญชีของ auth-storage เท่านั้น ในเส้นทางการลองใหม่แบบไม่บีบอัดหลัก backoff ยังคงเป็นความล่าช้าแบบ exponential ในพื้นที่ เว้นแต่การสลับสำเร็จ (`delayMs = 0`)

## กลไกการยกเลิก

### การยกเลิกการลองใหม่อย่างชัดเจน

`abortRetry()`:

- ยกเลิก `#retryAbortController` (หากมี)
- แก้ไข retry promise (`#resolveRetry()`) เพื่อให้ผู้รอปลดบล็อก

หากการยกเลิกเกิดขึ้นระหว่างการนอนหลับ เส้นทาง catch จะส่ง:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- รีเซ็ตครั้ง/controller

### การโต้ตอบกับการยกเลิกการดำเนินการทั่วโลก

`abort()` เรียก `abortRetry()` ก่อนที่จะยกเลิก agent stream ที่ทำงานอยู่ ซึ่งรับประกันว่า backoff การลองใหม่จะถูกยกเลิกเมื่อผู้ใช้สั่งยกเลิกทั่วไป

### การโต้ตอบกับ TUI

เมื่อเกิด `auto_retry_start` EventController จะ:

- สลับตัวจัดการ `Esc` เป็น `session.abortRetry()`
- แสดงข้อความ loader: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

เมื่อเกิด `auto_retry_end` จะกู้คืนตัวจัดการ `Esc` ก่อนหน้าและล้างสถานะ loader

## พฤติกรรมการสตรีมและการเสร็จสิ้น prompt

`prompt()` รอที่ `#waitForRetry()` ในท้ายที่สุดหลังจาก `agent.prompt(...)` ส่งคืน

ผลกระทบ:

- การเรียก prompt ไม่แก้ไขอย่างสมบูรณ์จนกว่าห่วงโซ่การลองใหม่ที่เริ่มต้นจะสิ้นสุด (สำเร็จ/ล้มเหลว/ยกเลิก)
- วงจรชีวิตการลองใหม่เป็นส่วนหนึ่งของขอบเขตการดำเนินการ prompt เชิงตรรกะหนึ่งหน่วย

สิ่งนี้ป้องกันไม่ให้ผู้เรียกถือว่ารอบที่กำลังลองใหม่เสร็จสิ้นก่อนเวลา

## การควบคุม: การตั้งค่าและ RPC

### ปุ่มการกำหนดค่า

กำหนดไว้ในสคีมาการตั้งค่าภายใต้กลุ่ม retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

การสลับแบบโปรแกรมในเซสชัน:

- `setAutoRetryEnabled(enabled)` เขียน `retry.enabled`
- `autoRetryEnabled` อ่าน `retry.enabled`
- `isRetrying` รายงานว่า retry lifecycle promise ทำงานอยู่หรือไม่

### การควบคุม RPC

พื้นผิวคำสั่ง RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

ตัวช่วย client:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

คำสั่งทั้งสองส่งคืนการตอบสนองที่สำเร็จ รายละเอียดความคืบหน้า/ความล้มเหลวของการลองใหม่มาจากเหตุการณ์เซสชันที่สตรีม ไม่ใช่เพย์โหลดการตอบสนองคำสั่ง

## การส่งเหตุการณ์และการแสดงความล้มเหลว

เหตุการณ์การลองใหม่ระดับเซสชัน:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

การส่งต่อ:

- ส่งผ่าน `AgentSession.subscribe(...)`
- ส่งต่อไปยัง extension runner เป็นเหตุการณ์ส่วนขยาย
- ในโหมด RPC ส่งต่อโดยตรงเป็น JSON event objects (`session.subscribe(event => output(event))`)
- ใน TUI ถูก `EventController` ใช้สำหรับ UI loader/error

การแสดงความล้มเหลวสุดท้าย:

- เมื่อเกินจำนวนสูงสุดหรือยกเลิก `auto_retry_end.success === false`
- TUI แสดง: `Retry failed after N attempts: <finalError>`
- ส่วนขยาย/hooks รับ `auto_retry_end` พร้อมฟิลด์เดียวกัน
- ผู้ใช้ RPC รับ event object เดียวกันบน stdout stream

## เงื่อนไขการหยุดถาวร

การลองใหม่จะหยุดและจะไม่ดำเนินการต่ออัตโนมัติเมื่อเกิดกรณีใดกรณีหนึ่งต่อไปนี้:

- `retry.enabled` เป็น false
- ข้อผิดพลาดไม่ถูกจำแนกว่าลองใหม่ได้
- ข้อผิดพลาดเป็นการล้นของบริบท (มอบหมายให้เส้นทางการบีบอัด)
- เกินจำนวนครั้งลองใหม่สูงสุด
- ผู้ใช้ยกเลิกการลองใหม่ (`abort_retry` หรือ `Esc` ระหว่าง retry loader)
- การยกเลิกทั่วโลก (`abort`) ยกเลิกการลองใหม่ก่อน

ห่วงโซ่การลองใหม่ใหม่ยังสามารถเริ่มต้นในภายหลังสำหรับข้อผิดพลาดที่ลองใหม่ได้ในอนาคตหลังจากตัวนับรีเซ็ต

## ข้อควรระวังในการดำเนินการ

- การจำแนกเป็นการจับคู่ข้อความด้วย regex รหัสข้อผิดพลาดแบบมีโครงสร้างเฉพาะผู้ให้บริการไม่ได้ถูกใช้ที่นี่
- การลองใหม่จะลบข้อผิดพลาดผู้ช่วยที่ล้มเหลวออกจาก **runtime context** ก่อนดำเนินการต่อ แต่ประวัติเซสชันยังคงเก็บรายการข้อผิดพลาดนั้นไว้
- `RpcSessionState` ปัจจุบันเปิดเผย `autoCompactionEnabled` แต่ไม่มีฟิลด์ `autoRetryEnabled`; ผู้เรียก RPC ต้องติดตามสถานะการสลับของตนเองหรือสอบถามการตั้งค่าผ่าน API อื่น
