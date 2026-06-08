---
title: Non-Compaction Auto-Retry Policy
description: >-
  นโยบายลองใหม่อัตโนมัติสำหรับความล้มเหลวของ API
  ชั่วคราวที่อยู่นอกเส้นทางการบีบอัด
sidebar:
  order: 6
  label: นโยบายลองใหม่
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# นโยบายลองใหม่อัตโนมัติที่ไม่ใช่การบีบอัด

เอกสารนี้อธิบายเส้นทางการลองใหม่เมื่อเกิดข้อผิดพลาด API มาตรฐานใน `AgentSession`

เอกสารนี้ไม่รวมการกู้คืนจาก context-overflow ผ่านการบีบอัดอัตโนมัติ ปัญหา Overflow จะถูกจัดการโดยตรรกะการบีบอัดและมีเอกสารแยกต่างหากใน [`compaction.md`](./compaction.md)

## ไฟล์การใช้งาน

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## ขอบเขตระหว่างการลองใหม่กับการบีบอัด

การลองใหม่และการบีบอัดจะถูกตรวจสอบจากเส้นทาง `agent_end` เดียวกัน แต่ถูกแยกออกจากกันโดยตั้งใจ:

1. `agent_end` ตรวจสอบข้อความ assistant ล่าสุด
2. `#isRetryableError(...)` ทำงานก่อน
3. หากการลองใหม่เริ่มต้นขึ้น การตรวจสอบการบีบอัดจะถูกข้ามไปสำหรับรอบนั้น
4. ข้อผิดพลาด Context-overflow จะถูกยกเว้นอย่างเด็ดขาดจากการจำแนกประเภทการลองใหม่ (`isContextOverflow(...)` ทำให้ข้ามการลองใหม่)
5. ดังนั้น Overflow จึงตกไปที่ `#checkCompaction(...)` แทนที่จะเป็นการลองใหม่มาตรฐาน

สรุป: ความล้มเหลวแบบ overload/rate/server/network ใช้นโยบายลองใหม่นี้ ส่วน context-window overflow ใช้การกู้คืนด้วยการบีบอัด

## การจำแนกประเภทการลองใหม่

`#isRetryableError(...)` ต้องเป็นไปตามเงื่อนไขทั้งหมดต่อไปนี้:

- assistant `stopReason === "error"`
- `errorMessage` มีอยู่
- ข้อความ **ไม่ใช่** context overflow
- `errorMessage` ตรงกับ `#isRetryableErrorMessage(...)`

ชุดรูปแบบที่สามารถลองใหม่ได้ในปัจจุบัน (อิงตาม regex):

- overloaded
- rate limit / usage limit / too many requests
- คลาสเซิร์ฟเวอร์แบบ HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- คำว่า `retry delay`

นี่เป็นการจำแนกประเภทด้วยรูปแบบสตริง ไม่ใช่รหัสข้อผิดพลาดแบบมีโครงสร้างจากผู้ให้บริการ

## วงจรชีวิตการลองใหม่และการเปลี่ยนสถานะ

สถานะเซสชันที่ใช้โดยการลองใหม่:

- `#retryAttempt: number` (`0` หมายถึงไม่ได้ใช้งาน)
- `#retryPromise: Promise<void> | undefined` (ติดตามวงจรชีวิตการลองใหม่ที่กำลังดำเนินอยู่)
- `#retryResolve: (() => void) | undefined` (แก้ไข `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (ยกเลิกการพัก backoff)

ลำดับการทำงาน (`#handleRetryableError`):

1. อ่านกลุ่มการตั้งค่า `retry`
2. หาก `retry.enabled === false` หยุดทันที (`false` ไม่เริ่มลองใหม่)
3. เพิ่ม `#retryAttempt`
4. สร้าง `#retryPromise` ครั้งเดียว (ความพยายามแรกในลำดับ)
5. หากความพยายามเกิน `retry.maxRetries` ส่งเหตุการณ์ความล้มเหลวสุดท้ายและหยุด
6. คำนวณการหน่วงเวลา: `retry.baseDelayMs * 2^(attempt-1)`
7. สำหรับข้อผิดพลาด usage-limit แยกวิเคราะห์คำแนะนำการลองใหม่และเรียก auth storage (`markUsageLimitReached(...)`) หากการเปลี่ยน provider/model สำเร็จ บังคับให้หน่วงเวลาเป็น `0`
8. ส่ง `auto_retry_start`
9. ลบข้อความข้อผิดพลาดของ assistant ที่ต่อท้ายออกจากสถานะ runtime ของ agent (เก็บไว้ในประวัติเซสชันที่บันทึกถาวร)
10. พักด้วยการรองรับการยกเลิก
11. เมื่อตื่น กำหนดเวลา `agent.continue()` ผ่าน `setTimeout(..., 0)`

### สิ่งที่รีเซ็ตตัวนับการลองใหม่

`#retryAttempt` รีเซ็ตเป็น `0` ในกรณีเหล่านี้:

- ข้อความ assistant ที่สำเร็จครั้งแรกที่ไม่ใช่ข้อผิดพลาดและไม่ถูกยกเลิก หลังจากการลองใหม่เริ่มต้น (ส่ง `auto_retry_end { success: true }`)
- การยกเลิกการลองใหม่ระหว่างการพัก backoff
- เส้นทางที่เกินจำนวนลองใหม่สูงสุด

`#retryPromise` จะแก้ไข/ล้างเมื่อลำดับการลองใหม่สิ้นสุด (สำเร็จ ยกเลิก หรือเกินจำนวนสูงสุด) ผ่าน `#resolveRetry()`

## ความหมายของ backoff และจำนวนความพยายามสูงสุด

การตั้งค่า:

- `retry.enabled` (ค่าเริ่มต้น `true`)
- `retry.maxRetries` (ค่าเริ่มต้น `3`)
- `retry.baseDelayMs` (ค่าเริ่มต้น `2000`)

การนับจำนวนความพยายาม:

- ตัวนับความพยายามจะเพิ่มขึ้นก่อนการตรวจสอบค่าสูงสุด
- เหตุการณ์เริ่มต้นใช้ความพยายามปัจจุบัน (เริ่มจาก 1)
- เหตุการณ์สิ้นสุดเมื่อเกินค่าสูงสุดรายงาน `attempt: this.#retryAttempt - 1` (จำนวนการลองใหม่ล่าสุดที่พยายาม)

ลำดับ backoff ด้วยการตั้งค่าเริ่มต้น:

- ความพยายามที่ 1: 2000 ms
- ความพยายามที่ 2: 4000 ms
- ความพยายามที่ 3: 8000 ms

อินพุตการแทนที่การหน่วงเวลาจะใช้เฉพาะในเส้นทางการจัดการ usage-limit เท่านั้น และใช้เพื่อส่งผลต่อการตัดสินใจสลับ model/account ของ auth-storage ในเส้นทางการลองใหม่หลักที่ไม่ใช่การบีบอัด backoff จะยังคงเป็นการหน่วงเวลาแบบเอ็กซ์โพเนนเชียลในเครื่อง เว้นแต่การสลับสำเร็จ (`delayMs = 0`)

## กลไกการยกเลิก

### การยกเลิกการลองใหม่อย่างชัดเจน

`abortRetry()`:

- ยกเลิก `#retryAbortController` (หากมี)
- แก้ไข retry promise (`#resolveRetry()`) เพื่อปลดบล็อกผู้รอ

หากการยกเลิกเกิดขึ้นระหว่างการพัก เส้นทาง catch จะส่ง:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- รีเซ็ต attempt/controller

### การโต้ตอบกับการยกเลิกการดำเนินการทั่วไป

`abort()` เรียก `abortRetry()` ก่อนยกเลิกสตรีม agent ที่กำลังทำงาน สิ่งนี้รับประกันว่า backoff ของการลองใหม่จะถูกยกเลิกเมื่อผู้ใช้ออกคำสั่งยกเลิกทั่วไป

### การโต้ตอบกับ TUI

เมื่อเกิด `auto_retry_start` EventController จะ:

- สลับตัวจัดการ `Esc` ไปที่ `session.abortRetry()`
- แสดงข้อความโหลด: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

เมื่อเกิด `auto_retry_end` จะคืนค่าตัวจัดการ `Esc` ก่อนหน้าและล้างสถานะโหลด

## พฤติกรรมการสตรีมมิ่งและการทำ prompt ให้เสร็จสมบูรณ์

`prompt()` ท้ายที่สุดจะรอ `#waitForRetry()` หลังจาก `agent.prompt(...)` ส่งค่ากลับ

ผลลัพธ์:

- การเรียก prompt จะไม่แก้ไขอย่างสมบูรณ์จนกว่าลำดับการลองใหม่ที่เริ่มต้นแล้วจะเสร็จสิ้น (สำเร็จ/ล้มเหลว/ยกเลิก)
- วงจรชีวิตการลองใหม่เป็นส่วนหนึ่งของขอบเขตการดำเนินการ prompt เชิงตรรกะหนึ่งครั้ง

สิ่งนี้ป้องกันไม่ให้ผู้เรียกถือว่ารอบที่กำลังลองใหม่เสร็จสมบูรณ์เร็วเกินไป

## การควบคุม: การตั้งค่าและ RPC

### ปุ่มปรับแต่งการกำหนดค่า

กำหนดไว้ใน settings schema ภายใต้กลุ่ม retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

การสลับทางโปรแกรมในเซสชัน:

- `setAutoRetryEnabled(enabled)` เขียน `retry.enabled`
- `autoRetryEnabled` อ่าน `retry.enabled`
- `isRetrying` รายงานว่า retry lifecycle promise ยังทำงานอยู่หรือไม่

### การควบคุม RPC

พื้นผิวคำสั่ง RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

ตัวช่วยฝั่ง client:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

คำสั่งทั้งสองส่งคืนการตอบกลับสำเร็จ รายละเอียดความคืบหน้า/ความล้มเหลวของการลองใหม่มาจากเหตุการณ์เซสชันที่สตรีม ไม่ใช่จาก payload การตอบกลับคำสั่ง

## การส่งเหตุการณ์และการแสดงความล้มเหลว

เหตุการณ์การลองใหม่ระดับเซสชัน:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

การส่งต่อ:

- ส่งผ่าน `AgentSession.subscribe(...)`
- ส่งต่อไปยัง extension runner เป็น extension events
- ในโหมด RPC ส่งต่อโดยตรงเป็นอ็อบเจกต์เหตุการณ์ JSON (`session.subscribe(event => output(event))`)
- ใน TUI ถูกใช้โดย `EventController` สำหรับ UI โหลด/ข้อผิดพลาด

การแสดงความล้มเหลวสุดท้าย:

- เมื่อเกินจำนวนสูงสุดหรือถูกยกเลิก `auto_retry_end.success === false`
- TUI แสดง: `Retry failed after N attempts: <finalError>`
- Extension/hook ได้รับ `auto_retry_end` พร้อมฟิลด์เดียวกัน
- ผู้ใช้ RPC ได้รับอ็อบเจกต์เหตุการณ์เดียวกันบนสตรีม stdout

## เงื่อนไขการหยุดถาวร

การลองใหม่จะหยุดและจะไม่ดำเนินการต่อโดยอัตโนมัติเมื่อเกิดเหตุการณ์ใดเหตุการณ์หนึ่งต่อไปนี้:

- `retry.enabled` เป็น false
- ข้อผิดพลาดไม่ได้ถูกจำแนกว่าลองใหม่ได้
- ข้อผิดพลาดเป็น context overflow (มอบให้เส้นทางการบีบอัด)
- เกินจำนวนลองใหม่สูงสุด
- ผู้ใช้ยกเลิกการลองใหม่ (`abort_retry` หรือ `Esc` ระหว่างตัวโหลดการลองใหม่)
- การยกเลิกทั่วไป (`abort`) ยกเลิกการลองใหม่ก่อน

ลำดับการลองใหม่ใหม่ยังคงสามารถเริ่มต้นได้ในภายหลังเมื่อเกิดข้อผิดพลาดที่ลองใหม่ได้ในอนาคตหลังจากตัวนับรีเซ็ต

## ข้อควรระวังในการดำเนินงาน

- การจำแนกประเภทเป็นการจับคู่ข้อความด้วย regex ไม่ได้ใช้ข้อผิดพลาดแบบมีโครงสร้างเฉพาะผู้ให้บริการที่นี่
- การลองใหม่จะลบข้อผิดพลาดของ assistant ที่ล้มเหลวออกจาก **บริบท runtime** ก่อนดำเนินการต่อ แต่ประวัติเซสชันยังคงเก็บรายการข้อผิดพลาดนั้นไว้
- `RpcSessionState` ปัจจุบันเปิดเผย `autoCompactionEnabled` แต่ไม่มีฟิลด์ `autoRetryEnabled` ผู้เรียก RPC ต้องติดตามสถานะการสลับของตนเอง หรือสอบถามการตั้งค่าผ่าน API อื่น
