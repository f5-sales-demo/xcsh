---
title: นโยบายลองใหม่อัตโนมัติที่ไม่ใช่การบีบอัด
description: นโยบายลองใหม่อัตโนมัติสำหรับความล้มเหลวของ API ชั่วคราวนอกเส้นทางการบีบอัด
sidebar:
  order: 6
  label: นโยบายลองใหม่
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# นโยบายลองใหม่อัตโนมัติที่ไม่ใช่การบีบอัด

เอกสารนี้อธิบายเส้นทางการลองใหม่เมื่อเกิดข้อผิดพลาด API มาตรฐานใน `AgentSession`

เอกสารนี้ไม่รวมการกู้คืนจาก context overflow ผ่านการบีบอัดอัตโนมัติโดยชัดเจน Overflow จะถูกจัดการโดยตรรกะการบีบอัดและมีเอกสารแยกต่างหากใน [`compaction.md`](./compaction.md)

## ไฟล์การนำไปใช้งาน

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## ขอบเขตการแบ่งระหว่างการลองใหม่กับการบีบอัด

การลองใหม่และการบีบอัดถูกตรวจสอบจากเส้นทาง `agent_end` เดียวกัน แต่ถูกแยกออกจากกันโดยเจตนา:

1. `agent_end` ตรวจสอบข้อความ assistant ล่าสุด
2. `#isRetryableError(...)` ทำงานก่อน
3. หากเริ่มการลองใหม่ การตรวจสอบการบีบอัดจะถูกข้ามสำหรับรอบนั้น
4. ข้อผิดพลาด context overflow ถูกยกเว้นจากการจำแนกการลองใหม่อย่างเด็ดขาด (`isContextOverflow(...)` ตัดการลองใหม่ทันที)
5. ดังนั้น overflow จะตกไปที่ `#checkCompaction(...)` แทนที่จะเป็นการลองใหม่มาตรฐาน

สรุปคือ: ความล้มเหลวแบบ overload/rate/server/network ใช้นโยบายลองใหม่นี้ ส่วน context-window overflow ใช้การกู้คืนด้วยการบีบอัด

## การจำแนกการลองใหม่

`#isRetryableError(...)` ต้องการเงื่อนไขทั้งหมดต่อไปนี้:

- assistant `stopReason === "error"`
- มี `errorMessage` อยู่
- ข้อความ **ไม่ใช่** context overflow
- `errorMessage` ตรงกับ `#isRetryableErrorMessage(...)`

ชุดรูปแบบที่สามารถลองใหม่ได้ในปัจจุบัน (อิงตาม regex):

- overloaded
- rate limit / usage limit / too many requests
- คลาสเซิร์ฟเวอร์แบบ HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- ข้อความ `retry delay`

นี่คือการจำแนกด้วยรูปแบบสตริง ไม่ใช่รหัสข้อผิดพลาดแบบมีชนิดจากผู้ให้บริการ

## วงจรชีวิตการลองใหม่และการเปลี่ยนสถานะ

สถานะเซสชันที่ใช้โดยการลองใหม่:

- `#retryAttempt: number` (`0` หมายถึงว่าง)
- `#retryPromise: Promise<void> | undefined` (ติดตามวงจรชีวิตการลองใหม่ที่กำลังดำเนินอยู่)
- `#retryResolve: (() => void) | undefined` (resolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (ยกเลิก backoff sleep)

ขั้นตอนการทำงาน (`#handleRetryableError`):

1. อ่านกลุ่มการตั้งค่า `retry`
2. ถ้า `retry.enabled === false` หยุดทันที (`false` ไม่เริ่มการลองใหม่)
3. เพิ่มค่า `#retryAttempt`
4. สร้าง `#retryPromise` ครั้งเดียว (ความพยายามแรกในห่วงโซ่)
5. หากความพยายามเกิน `retry.maxRetries` จะส่งเหตุการณ์ความล้มเหลวสุดท้ายแล้วหยุด
6. คำนวณ delay: `retry.baseDelayMs * 2^(attempt-1)`
7. สำหรับข้อผิดพลาด usage-limit จะแยกวิเคราะห์คำแนะนำการลองใหม่และเรียก auth storage (`markUsageLimitReached(...)`) หากการสลับ provider/model สำเร็จ จะบังคับ delay เป็น `0`
8. ส่งเหตุการณ์ `auto_retry_start`
9. ลบข้อความข้อผิดพลาด assistant ท้ายสุดออกจากสถานะรันไทม์ของ agent (เก็บไว้ในประวัติเซสชันที่ถาวร)
10. Sleep พร้อมรองรับการยกเลิก
11. เมื่อตื่น จัดตาราง `agent.continue()` ผ่าน `setTimeout(..., 0)`

### สิ่งที่รีเซ็ตตัวนับการลองใหม่

`#retryAttempt` รีเซ็ตเป็น `0` ในกรณีเหล่านี้:

- ข้อความ assistant สำเร็จแรกที่ไม่ใช่ข้อผิดพลาดและไม่ถูกยกเลิกหลังจากเริ่มการลองใหม่ (ส่ง `auto_retry_end { success: true }`)
- การยกเลิกการลองใหม่ระหว่าง backoff sleep
- เส้นทางที่เกินจำนวนการลองใหม่สูงสุด

`#retryPromise` จะ resolve/ล้างเมื่อห่วงโซ่การลองใหม่สิ้นสุด (สำเร็จ ยกเลิก หรือเกินสูงสุด) ผ่าน `#resolveRetry()`

## ความหมายของ Backoff และจำนวนความพยายามสูงสุด

การตั้งค่า:

- `retry.enabled` (ค่าเริ่มต้น `true`)
- `retry.maxRetries` (ค่าเริ่มต้น `3`)
- `retry.baseDelayMs` (ค่าเริ่มต้น `2000`)

การนับหมายเลขความพยายาม:

- ตัวนับความพยายามจะถูกเพิ่มก่อนการตรวจสอบค่าสูงสุด
- เหตุการณ์เริ่มต้นใช้ความพยายามปัจจุบัน (เริ่มจาก 1)
- เหตุการณ์สิ้นสุดเมื่อเกินสูงสุดจะรายงาน `attempt: this.#retryAttempt - 1` (จำนวนการลองใหม่ครั้งสุดท้ายที่พยายาม)

ลำดับ backoff ด้วยการตั้งค่าเริ่มต้น:

- ความพยายามที่ 1: 2000 ms
- ความพยายามที่ 2: 4000 ms
- ความพยายามที่ 3: 8000 ms

อินพุตการแทนที่ delay จะถูกใช้เฉพาะในเส้นทางการจัดการ usage-limit เท่านั้น และใช้เพื่อมีอิทธิพลต่อการตัดสินใจสลับ model/account ของ auth-storage เท่านั้น ในเส้นทางการลองใหม่หลักที่ไม่ใช่การบีบอัด backoff จะคงเป็น delay แบบ exponential ในเครื่อง เว้นแต่การสลับสำเร็จ (`delayMs = 0`)

## กลไกการยกเลิก

### การยกเลิกการลองใหม่อย่างชัดเจน

`abortRetry()`:

- ยกเลิก `#retryAbortController` (หากมี)
- resolve retry promise (`#resolveRetry()`) เพื่อให้ผู้รอไม่ถูกบล็อก

หากการยกเลิกเกิดขึ้นระหว่าง sleep เส้นทาง catch จะส่ง:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- รีเซ็ต attempt/controller

### ปฏิสัมพันธ์กับการยกเลิกการดำเนินการทั้งหมด

`abort()` เรียก `abortRetry()` ก่อนที่จะยกเลิก agent stream ที่ทำงานอยู่ สิ่งนี้รับประกันว่า retry backoff จะถูกยกเลิกเมื่อผู้ใช้สั่งยกเลิกทั่วไป

### ปฏิสัมพันธ์กับ TUI

เมื่อ `auto_retry_start` EventController จะ:

- สลับตัวจัดการ `Esc` ไปเป็น `session.abortRetry()`
- แสดงข้อความ loader: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

เมื่อ `auto_retry_end` จะคืนค่าตัวจัดการ `Esc` ก่อนหน้าและล้างสถานะ loader

## พฤติกรรมการสตรีมและการเสร็จสมบูรณ์ของ prompt

`prompt()` ท้ายที่สุดจะรอ `#waitForRetry()` หลังจาก `agent.prompt(...)` return

ผลกระทบ:

- การเรียก prompt จะไม่ resolve อย่างสมบูรณ์จนกว่าห่วงโซ่การลองใหม่ที่เริ่มแล้วจะเสร็จสิ้น (สำเร็จ/ล้มเหลว/ยกเลิก)
- วงจรชีวิตการลองใหม่เป็นส่วนหนึ่งของขอบเขตการดำเนินการ prompt เชิงตรรกะหนึ่งรายการ

สิ่งนี้ป้องกันไม่ให้ผู้เรียกถือว่ารอบที่กำลังลองใหม่เสร็จสมบูรณ์เร็วเกินไป

## การควบคุม: การตั้งค่าและ RPC

### ปุ่มปรับค่า

กำหนดในสคีมาการตั้งค่าภายใต้กลุ่ม retry:

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

ตัวช่วยฝั่งไคลเอนต์:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

คำสั่งทั้งสองส่งคืน success response; รายละเอียดความคืบหน้า/ความล้มเหลวของการลองใหม่มาจากเหตุการณ์เซสชันที่สตรีม ไม่ใช่จาก payload การตอบกลับคำสั่ง

## การส่งเหตุการณ์และการแสดงความล้มเหลว

เหตุการณ์การลองใหม่ระดับเซสชัน:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

การกระจาย:

- ส่งผ่าน `AgentSession.subscribe(...)`
- ส่งต่อไปยัง extension runner เป็นเหตุการณ์ extension
- ในโหมด RPC ส่งต่อโดยตรงเป็นอ็อบเจ็กต์เหตุการณ์ JSON (`session.subscribe(event => output(event))`)
- ใน TUI ถูกบริโภคโดย `EventController` สำหรับ UI ของ loader/error

การแสดงความล้มเหลวสุดท้าย:

- เมื่อเกินสูงสุดหรือถูกยกเลิก `auto_retry_end.success === false`
- TUI แสดง: `Retry failed after N attempts: <finalError>`
- Extensions/hooks ได้รับ `auto_retry_end` พร้อมฟิลด์เดียวกัน
- ผู้ใช้ RPC ได้รับอ็อบเจ็กต์เหตุการณ์เดียวกันบนสตรีม stdout

## เงื่อนไขการหยุดถาวร

การลองใหม่จะหยุดและจะไม่ดำเนินต่ออัตโนมัติเมื่อเกิดเหตุการณ์ใดเหตุการณ์หนึ่งต่อไปนี้:

- `retry.enabled` เป็น false
- ข้อผิดพลาดไม่ถูกจำแนกว่าลองใหม่ได้
- ข้อผิดพลาดเป็น context overflow (มอบหมายให้เส้นทางการบีบอัด)
- เกินจำนวนการลองใหม่สูงสุด
- ผู้ใช้ยกเลิกการลองใหม่ (`abort_retry` หรือ `Esc` ระหว่าง retry loader)
- การยกเลิกทั้งหมด (`abort`) ยกเลิกการลองใหม่ก่อน

ห่วงโซ่การลองใหม่ใหม่ยังคงสามารถเริ่มต้นได้ในภายหลังเมื่อเกิดข้อผิดพลาดที่ลองใหม่ได้ในอนาคตหลังจากตัวนับรีเซ็ต

## ข้อควรระวังในการดำเนินงาน

- การจำแนกใช้การจับคู่ข้อความด้วย regex; ข้อผิดพลาดแบบมีโครงสร้างเฉพาะผู้ให้บริการไม่ถูกใช้ที่นี่
- การลองใหม่จะลบข้อผิดพลาด assistant ที่ล้มเหลวออกจาก **runtime context** ก่อนทำ re-continue แต่ประวัติเซสชันยังคงเก็บรายการข้อผิดพลาดนั้นไว้
- `RpcSessionState` ปัจจุบันเปิดเผย `autoCompactionEnabled` แต่ไม่มีฟิลด์ `autoRetryEnabled`; ผู้เรียก RPC ต้องติดตามสถานะการสลับของตัวเองหรือสอบถามการตั้งค่าผ่าน API อื่น
