---
title: นโยบายการลองใหม่อัตโนมัติแบบไม่บีบอัด
description: >-
  นโยบายการลองใหม่อัตโนมัติสำหรับความล้มเหลวของ API
  ชั่วคราวที่อยู่นอกเส้นทางการบีบอัด
sidebar:
  order: 6
  label: นโยบายการลองใหม่
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# นโยบายการลองใหม่อัตโนมัติแบบไม่บีบอัด

เอกสารนี้อธิบายเส้นทางการลองใหม่เมื่อเกิดข้อผิดพลาด API มาตรฐานใน `AgentSession`

โดยไม่ครอบคลุมการกู้คืนเมื่อบริบทล้นผ่านการบีบอัดอัตโนมัติ การล้นบริบทจะถูกจัดการด้วยลอจิกการบีบอัดและมีเอกสารแยกต่างหากใน [`compaction.md`](./compaction.md)

## ไฟล์การดำเนินการ

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## ขอบเขตและความแตกต่างจากการบีบอัด

การลองใหม่และการบีบอัดถูกตรวจสอบจากเส้นทาง `agent_end` เดียวกัน แต่ถูกแยกออกจากกันโดยตั้งใจ:

1. `agent_end` ตรวจสอบข้อความของ assistant ล่าสุด
2. `#isRetryableError(...)` ทำงานก่อน
3. หากเริ่มการลองใหม่ การตรวจสอบการบีบอัดจะถูกข้ามสำหรับรอบนั้น
4. ข้อผิดพลาดที่บริบทล้นถูกยกเว้นอย่างเด็ดขาดจากการจำแนกประเภทการลองใหม่ (`isContextOverflow(...)` ตัดวงจรการลองใหม่)
5. การล้นบริบทจึงตกไปยัง `#checkCompaction(...)` แทนที่จะเป็นการลองใหม่มาตรฐาน

สรุป: ความล้มเหลวประเภทโหลดเกิน/อัตรา/เซิร์ฟเวอร์/เครือข่ายใช้นโยบายการลองใหม่นี้ ส่วนการล้นหน้าต่างบริบทใช้การกู้คืนด้วยการบีบอัด

## การจำแนกประเภทการลองใหม่

`#isRetryableError(...)` ต้องการเงื่อนไขทั้งหมดต่อไปนี้:

- assistant `stopReason === "error"`
- มี `errorMessage` อยู่
- ข้อความ**ไม่ใช่**การล้นบริบท
- `errorMessage` ตรงกับ `#isRetryableErrorMessage(...)`

ชุดรูปแบบที่ลองใหม่ได้ในปัจจุบัน (ใช้ regex):

- overloaded
- rate limit / usage limit / too many requests
- คลาสเซิร์ฟเวอร์คล้าย HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- คำว่า `retry delay`

การจำแนกประเภทนี้ใช้การจับคู่รูปแบบสตริง ไม่ใช่โค้ดข้อผิดพลาดของผู้ให้บริการแบบมีโครงสร้าง

## วงจรชีวิตการลองใหม่และการเปลี่ยนสถานะ

สถานะ session ที่ใช้โดยการลองใหม่:

- `#retryAttempt: number` (`0` หมายถึงไม่ได้ทำงาน)
- `#retryPromise: Promise<void> | undefined` (ติดตามวงจรชีวิตการลองใหม่ที่กำลังดำเนินการ)
- `#retryResolve: (() => void) | undefined` (แก้ไข `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (ยกเลิกการรอ backoff)

ขั้นตอน (`#handleRetryableError`):

1. อ่านกลุ่มการตั้งค่า `retry`
2. ถ้า `retry.enabled === false` หยุดทันที (`false` ไม่เริ่มการลองใหม่)
3. เพิ่มค่า `#retryAttempt`
4. สร้าง `#retryPromise` ครั้งเดียว (ครั้งแรกในห่วงโซ่)
5. ถ้าความพยายามเกิน `retry.maxRetries` ส่งเหตุการณ์ความล้มเหลวสุดท้ายและหยุด
6. คำนวณหน่วงเวลา: `retry.baseDelayMs * 2^(attempt-1)`
7. สำหรับข้อผิดพลาดขีดจำกัดการใช้งาน แยกวิเคราะห์คำใบ้การลองใหม่และเรียก auth storage (`markUsageLimitReached(...)`); ถ้าการสลับผู้ให้บริการ/โมเดลสำเร็จ บังคับหน่วงเวลาเป็น `0`
8. ส่ง `auto_retry_start`
9. ลบข้อความผิดพลาดของ assistant ท้ายสุดออกจากสถานะรันไทม์ของ agent (เก็บไว้ในประวัติ session ที่บันทึกแล้ว)
10. รอโดยมีการรองรับการยกเลิก
11. เมื่อตื่น กำหนดเวลา `agent.continue()` ผ่าน `setTimeout(..., 0)`

### สิ่งที่รีเซ็ตตัวนับการลองใหม่

`#retryAttempt` รีเซ็ตเป็น `0` ในกรณีเหล่านี้:

- ข้อความของ assistant ที่สำเร็จแบบไม่มีข้อผิดพลาดและไม่ถูกยกเลิกครั้งแรกหลังจากเริ่มการลองใหม่ (ส่ง `auto_retry_end { success: true }`)
- การยกเลิกการลองใหม่ระหว่างการรอ backoff
- เส้นทางที่เกินจำนวนการลองใหม่สูงสุด

`#retryPromise` แก้ไข/ล้างเมื่อห่วงโซ่การลองใหม่สิ้นสุด (สำเร็จ ยกเลิก หรือเกินสูงสุด) ผ่าน `#resolveRetry()`

## ความหมายของ Backoff และจำนวนความพยายามสูงสุด

การตั้งค่า:

- `retry.enabled` (ค่าเริ่มต้น `true`)
- `retry.maxRetries` (ค่าเริ่มต้น `3`)
- `retry.baseDelayMs` (ค่าเริ่มต้น `2000`)

การนับความพยายาม:

- ตัวนับความพยายามถูกเพิ่มก่อนการตรวจสอบค่าสูงสุด
- เหตุการณ์เริ่มต้นใช้ความพยายามปัจจุบัน (เริ่มจาก 1)
- เหตุการณ์สิ้นสุดที่เกินสูงสุดรายงาน `attempt: this.#retryAttempt - 1` (จำนวนการลองใหม่ครั้งสุดท้าย)

ลำดับ backoff ด้วยการตั้งค่าเริ่มต้น:

- ความพยายามที่ 1: 2000 มิลลิวินาที
- ความพยายามที่ 2: 4000 มิลลิวินาที
- ความพยายามที่ 3: 8000 มิลลิวินาที

อินพุตการแทนที่หน่วงเวลาถูกใช้เฉพาะในเส้นทางการจัดการขีดจำกัดการใช้งาน และเพื่อมีอิทธิพลต่อการตัดสินใจสลับโมเดล/บัญชีของ auth storage เท่านั้น ในเส้นทางการลองใหม่แบบไม่บีบอัดหลัก backoff ยังคงเป็นการหน่วงเวลาแบบเอกซ์โพเนนเชียลเฉพาะที่ เว้นแต่การสลับสำเร็จ (`delayMs = 0`)

## กลไกการยกเลิก

### การยกเลิกการลองใหม่อย่างชัดเจน

`abortRetry()`:

- ยกเลิก `#retryAbortController` (ถ้ามี)
- แก้ไข promise การลองใหม่ (`#resolveRetry()`) เพื่อปลดบล็อกผู้ที่รออยู่

ถ้าการยกเลิกเกิดขึ้นระหว่างการรอ เส้นทาง catch จะส่ง:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- รีเซ็ต attempt/controller

### การโต้ตอบกับการยกเลิกการทำงานทั่วไป

`abort()` เรียก `abortRetry()` ก่อนที่จะยกเลิก stream ของ agent ที่ทำงานอยู่ ซึ่งรับประกันว่า backoff การลองใหม่จะถูกยกเลิกเมื่อผู้ใช้สั่งยกเลิกทั่วไป

### การโต้ตอบกับ TUI

เมื่อ `auto_retry_start`, EventController:

- สลับตัวจัดการ `Esc` เป็น `session.abortRetry()`
- แสดงข้อความ loader: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

เมื่อ `auto_retry_end` จะคืนค่าตัวจัดการ `Esc` ก่อนหน้าและล้างสถานะ loader

## พฤติกรรมการสตรีมมิงและการเสร็จสิ้นพรอมต์

`prompt()` สุดท้ายรอที่ `#waitForRetry()` หลังจาก `agent.prompt(...)` ส่งคืน

ผลลัพธ์:

- การเรียก prompt จะไม่แก้ไขอย่างสมบูรณ์จนกว่าห่วงโซ่การลองใหม่ที่เริ่มแล้วจะสิ้นสุด (สำเร็จ/ล้มเหลว/ยกเลิก)
- วงจรชีวิตการลองใหม่เป็นส่วนหนึ่งของขอบเขตการดำเนินการ prompt เชิงตรรกะเดียว

สิ่งนี้ป้องกันผู้เรียกจากการถือว่ารอบที่กำลังลองใหม่เสร็จสิ้นก่อนเวลาอันควร

## การควบคุม: การตั้งค่าและ RPC

### ปุ่มการกำหนดค่า

กำหนดในสคีมาการตั้งค่าภายใต้กลุ่ม retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

การสลับแบบโปรแกรมใน session:

- `setAutoRetryEnabled(enabled)` เขียน `retry.enabled`
- `autoRetryEnabled` อ่าน `retry.enabled`
- `isRetrying` รายงานว่า promise วงจรชีวิตการลองใหม่กำลังทำงานอยู่หรือไม่

### การควบคุม RPC

พื้นผิวคำสั่ง RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

ตัวช่วย client:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

ทั้งสองคำสั่งส่งคืนการตอบสนองสำเร็จ รายละเอียดความคืบหน้า/ความล้มเหลวของการลองใหม่มาจากเหตุการณ์ session แบบ stream ไม่ใช่จาก payload การตอบสนองคำสั่ง

## การส่งเหตุการณ์และการแสดงผลความล้มเหลว

เหตุการณ์การลองใหม่ระดับ session:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

การแพร่กระจาย:

- ส่งผ่าน `AgentSession.subscribe(...)`
- ส่งต่อไปยัง extension runner เป็น extension events
- ในโหมด RPC ส่งต่อโดยตรงเป็น JSON event objects (`session.subscribe(event => output(event))`)
- ใน TUI ถูกใช้งานโดย `EventController` สำหรับ UI loader/error

การแสดงผลความล้มเหลวสุดท้าย:

- เมื่อเกินสูงสุดหรือยกเลิก `auto_retry_end.success === false`
- TUI แสดง: `Retry failed after N attempts: <finalError>`
- Extensions/hooks ได้รับ `auto_retry_end` ด้วยฟิลด์เดียวกัน
- ผู้บริโภค RPC ได้รับ event object เดียวกันบน stdout stream

## เงื่อนไขการหยุดถาวร

การลองใหม่จะหยุดและไม่ดำเนินการต่ออัตโนมัติเมื่อเกิดเหตุการณ์ใดๆ เหล่านี้:

- `retry.enabled` เป็น false
- ข้อผิดพลาดไม่ถูกจำแนกประเภทเป็นการลองใหม่ได้
- ข้อผิดพลาดคือการล้นบริบท (ส่งต่อไปยังเส้นทางการบีบอัด)
- เกินจำนวนการลองใหม่สูงสุด
- ผู้ใช้ยกเลิกการลองใหม่ (`abort_retry` หรือ `Esc` ระหว่าง loader การลองใหม่)
- การยกเลิกทั่วไป (`abort`) ยกเลิกการลองใหม่ก่อน

ห่วงโซ่การลองใหม่ใหม่ยังคงสามารถเริ่มต้นได้ในภายหลังเมื่อเกิดข้อผิดพลาดที่ลองใหม่ได้ในอนาคตหลังจากตัวนับรีเซ็ต

## ข้อควรระวังในการดำเนินงาน

- การจำแนกประเภทใช้การจับคู่ข้อความด้วย regex ไม่ใช้ข้อผิดพลาดที่มีโครงสร้างเฉพาะของผู้ให้บริการที่นี่
- การลองใหม่จะลบข้อผิดพลาดของ assistant ที่ล้มเหลวออกจาก**บริบทรันไทม์**ก่อนดำเนินการต่อ แต่ประวัติ session ยังคงเก็บรายการข้อผิดพลาดนั้นไว้
- `RpcSessionState` ในปัจจุบันเปิดเผย `autoCompactionEnabled` แต่ไม่มีฟิลด์ `autoRetryEnabled` ผู้เรียก RPC ต้องติดตามสถานะการสลับของตนเองหรือสอบถามการตั้งค่าผ่าน API อื่น
