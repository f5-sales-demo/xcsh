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

# นโยบายลองใหม่อัตโนมัติแบบไม่ผ่านการบีบอัด

เอกสารนี้อธิบายเส้นทางการลองใหม่เมื่อเกิดข้อผิดพลาดจาก API มาตรฐานใน `AgentSession`

เอกสารนี้ไม่รวมถึงการกู้คืนจาก context overflow ผ่านการบีบอัดอัตโนมัติ การจัดการ overflow ดำเนินการโดยตรรกะการบีบอัดและมีเอกสารแยกต่างหากใน [`compaction.md`](./compaction.md)

## ไฟล์การ implement

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## ขอบเขตระหว่างการลองใหม่กับการบีบอัด

การลองใหม่และการบีบอัดถูกตรวจสอบจากเส้นทาง `agent_end` เดียวกัน แต่ถูกแยกออกจากกันโดยตั้งใจ:

1. `agent_end` ตรวจสอบข้อความ assistant ล่าสุด
2. `#isRetryableError(...)` ทำงานก่อน
3. หากเริ่มการลองใหม่ การตรวจสอบการบีบอัดจะถูกข้ามสำหรับรอบนั้น
4. ข้อผิดพลาด context overflow จะถูกกันออกจากการจัดประเภทการลองใหม่อย่างเด็ดขาด (`isContextOverflow(...)` ตัดการลองใหม่ออกทันที)
5. ดังนั้น overflow จะถูกส่งต่อไปยัง `#checkCompaction(...)` แทนที่จะเป็นการลองใหม่มาตรฐาน

สรุปคือ: ความล้มเหลวแบบ overload/rate/server/network ใช้นโยบายลองใหม่นี้ ส่วน context-window overflow ใช้การกู้คืนด้วยการบีบอัด

## การจัดประเภทการลองใหม่

`#isRetryableError(...)` ต้องการเงื่อนไขทั้งหมดต่อไปนี้:

- `stopReason === "error"` ของ assistant
- มี `errorMessage` อยู่
- ข้อความ **ไม่ใช่** context overflow
- `errorMessage` ตรงกับ `#isRetryableErrorMessage(...)`

ชุดรูปแบบที่สามารถลองใหม่ได้ในปัจจุบัน (ใช้ regex):

- overloaded
- rate limit / usage limit / too many requests
- คลาส server แบบ HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- ข้อความที่มีคำว่า `retry delay`

นี่เป็นการจัดประเภทโดยการจับคู่รูปแบบข้อความ ไม่ใช่รหัสข้อผิดพลาดที่มีโครงสร้างเฉพาะผู้ให้บริการ

## วงจรชีวิตการลองใหม่และการเปลี่ยนสถานะ

สถานะ session ที่ใช้โดยการลองใหม่:

- `#retryAttempt: number` (`0` หมายความว่าไม่ได้ทำงาน)
- `#retryPromise: Promise<void> | undefined` (ติดตามวงจรชีวิตการลองใหม่ที่กำลังดำเนินการ)
- `#retryResolve: (() => void) | undefined` (resolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (ยกเลิกการ sleep ของ backoff)

ลำดับการทำงาน (`#handleRetryableError`):

1. อ่านกลุ่มการตั้งค่า `retry`
2. หาก `retry.enabled === false` หยุดทันที (`false` ไม่เริ่มการลองใหม่)
3. เพิ่ม `#retryAttempt`
4. สร้าง `#retryPromise` ครั้งเดียว (ความพยายามแรกในห่วงโซ่)
5. หากจำนวนความพยายามเกิน `retry.maxRetries` ส่งเหตุการณ์ความล้มเหลวสุดท้ายและหยุด
6. คำนวณการหน่วงเวลา: `retry.baseDelayMs * 2^(attempt-1)`
7. สำหรับข้อผิดพลาด usage-limit แยกวิเคราะห์คำแนะนำการลองใหม่และเรียก auth storage (`markUsageLimitReached(...)`) หากการสลับ provider/model สำเร็จ บังคับให้หน่วงเวลาเป็น `0`
8. ส่งเหตุการณ์ `auto_retry_start`
9. ลบข้อความข้อผิดพลาดของ assistant ตัวท้ายจากสถานะ runtime ของ agent (ยังคงเก็บในประวัติ session ที่บันทึกถาวร)
10. Sleep พร้อมรองรับการยกเลิก
11. เมื่อตื่น กำหนดเวลา `agent.continue()` ผ่าน `setTimeout(..., 0)`

### สิ่งที่รีเซ็ตตัวนับการลองใหม่

`#retryAttempt` รีเซ็ตเป็น `0` ในกรณีเหล่านี้:

- ข้อความ assistant แรกที่สำเร็จ (ไม่ใช่ error และไม่ถูก abort) หลังจากเริ่มการลองใหม่ (ส่งเหตุการณ์ `auto_retry_end { success: true }`)
- การยกเลิกการลองใหม่ระหว่าง backoff sleep
- เส้นทางที่เกินจำนวนการลองใหม่สูงสุด

`#retryPromise` จะ resolve/เคลียร์เมื่อห่วงโซ่การลองใหม่สิ้นสุด (สำเร็จ ยกเลิก หรือเกินจำนวนสูงสุด) ผ่าน `#resolveRetry()`

## ความหมายของ backoff และจำนวนความพยายามสูงสุด

การตั้งค่า:

- `retry.enabled` (ค่าเริ่มต้น `true`)
- `retry.maxRetries` (ค่าเริ่มต้น `3`)
- `retry.baseDelayMs` (ค่าเริ่มต้น `2000`)

การนับจำนวนความพยายาม:

- ตัวนับความพยายามจะเพิ่มขึ้นก่อนการตรวจสอบค่าสูงสุด
- เหตุการณ์เริ่มต้นใช้ความพยายามปัจจุบัน (เริ่มจาก 1)
- เหตุการณ์สิ้นสุดเมื่อเกินค่าสูงสุดรายงาน `attempt: this.#retryAttempt - 1` (จำนวนการลองใหม่ที่พยายามครั้งสุดท้าย)

ลำดับ backoff ด้วยการตั้งค่าเริ่มต้น:

- ความพยายามที่ 1: 2000 ms
- ความพยายามที่ 2: 4000 ms
- ความพยายามที่ 3: 8000 ms

อินพุตการแทนที่การหน่วงเวลาจะใช้เฉพาะในเส้นทางการจัดการ usage-limit เท่านั้น และใช้เฉพาะเพื่อมีอิทธิพลต่อการตัดสินใจสลับ model/account ของ auth-storage ในเส้นทางการลองใหม่แบบไม่ผ่านการบีบอัดหลัก backoff ยังคงเป็นการหน่วงเวลาแบบ exponential ในเครื่อง เว้นแต่การสลับจะสำเร็จ (`delayMs = 0`)

## กลไกการยกเลิก

### การยกเลิกการลองใหม่โดยชัดเจน

`abortRetry()`:

- ยกเลิก `#retryAbortController` (หากมี)
- resolve retry promise (`#resolveRetry()`) เพื่อปลดบล็อกผู้ที่รออยู่

หากการยกเลิกเกิดขึ้นระหว่าง sleep เส้นทาง catch จะส่ง:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- รีเซ็ตความพยายาม/controller

### ปฏิสัมพันธ์กับการยกเลิกการทำงานทั้งระบบ

`abort()` เรียก `abortRetry()` ก่อนที่จะยกเลิก agent stream ที่กำลังทำงาน สิ่งนี้รับประกันว่า backoff ของการลองใหม่จะถูกยกเลิกเมื่อผู้ใช้สั่งยกเลิกทั่วไป

### ปฏิสัมพันธ์กับ TUI

เมื่อเกิด `auto_retry_start` EventController จะ:

- สลับตัวจัดการ `Esc` ไปที่ `session.abortRetry()`
- แสดงข้อความโหลด: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

เมื่อเกิด `auto_retry_end` จะคืนค่าตัวจัดการ `Esc` ก่อนหน้าและเคลียร์สถานะโหลด

## พฤติกรรมของ streaming และการทำงานจนเสร็จของ prompt

`prompt()` ในท้ายที่สุดจะรอ `#waitForRetry()` หลังจาก `agent.prompt(...)` คืนค่า

ผลลัพธ์:

- การเรียก prompt จะไม่ resolve อย่างสมบูรณ์จนกว่าห่วงโซ่การลองใหม่ที่เริ่มไว้จะเสร็จสิ้น (สำเร็จ/ล้มเหลว/ยกเลิก)
- วงจรชีวิตการลองใหม่เป็นส่วนหนึ่งของขอบเขตการดำเนินการ prompt เชิงตรรกะหนึ่งรอบ

สิ่งนี้ป้องกันไม่ให้ผู้เรียกถือว่ารอบที่กำลังลองใหม่เสร็จสมบูรณ์เร็วเกินไป

## การควบคุม: การตั้งค่าและ RPC

### ตัวปรับแต่งการกำหนดค่า

กำหนดไว้ใน schema การตั้งค่าภายใต้กลุ่ม retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

ตัวสลับแบบโปรแกรมใน session:

- `setAutoRetryEnabled(enabled)` เขียน `retry.enabled`
- `autoRetryEnabled` อ่าน `retry.enabled`
- `isRetrying` รายงานว่า retry lifecycle promise กำลังทำงานอยู่หรือไม่

### การควบคุม RPC

พื้นผิวคำสั่ง RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

ตัวช่วย client:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

คำสั่งทั้งสองคืนค่า success response ส่วนรายละเอียดความคืบหน้า/ความล้มเหลวของการลองใหม่มาจากเหตุการณ์ session ที่สตรีม ไม่ใช่จาก payload ของ command response

## การส่งเหตุการณ์และการแสดงความล้มเหลว

เหตุการณ์การลองใหม่ระดับ session:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

การส่งต่อ:

- ส่งผ่าน `AgentSession.subscribe(...)`
- ส่งต่อไปยัง extension runner เป็นเหตุการณ์ extension
- ในโหมด RPC ส่งต่อโดยตรงเป็นอ็อบเจกต์เหตุการณ์ JSON (`session.subscribe(event => output(event))`)
- ใน TUI ถูกใช้โดย `EventController` สำหรับ UI ของโหลด/ข้อผิดพลาด

การแสดงความล้มเหลวสุดท้าย:

- เมื่อเกินจำนวนสูงสุดหรือถูกยกเลิก `auto_retry_end.success === false`
- TUI แสดง: `Retry failed after N attempts: <finalError>`
- Extension/hook ได้รับ `auto_retry_end` พร้อมฟิลด์เดียวกัน
- ผู้ใช้ RPC ได้รับอ็อบเจกต์เหตุการณ์เดียวกันบน stdout stream

## เงื่อนไขการหยุดถาวร

การลองใหม่จะหยุดและไม่ดำเนินการต่ออัตโนมัติเมื่อเกิดเหตุการณ์ใดเหตุการณ์หนึ่งต่อไปนี้:

- `retry.enabled` เป็น false
- ข้อผิดพลาดไม่ได้ถูกจัดประเภทให้ลองใหม่ได้
- ข้อผิดพลาดเป็น context overflow (มอบหมายไปยังเส้นทางการบีบอัด)
- เกินจำนวนการลองใหม่สูงสุด
- ผู้ใช้ยกเลิกการลองใหม่ (`abort_retry` หรือ `Esc` ระหว่างโหลดการลองใหม่)
- การยกเลิกทั่วไป (`abort`) ยกเลิกการลองใหม่ก่อน

ห่วงโซ่การลองใหม่ใหม่ยังคงสามารถเริ่มได้ในภายหลังเมื่อเกิดข้อผิดพลาดที่ลองใหม่ได้ในอนาคตหลังจากตัวนับรีเซ็ต

## ข้อควรระวังในการใช้งาน

- การจัดประเภทใช้การจับคู่ข้อความ regex ข้อผิดพลาดที่มีโครงสร้างเฉพาะผู้ให้บริการไม่ได้ถูกใช้ที่นี่
- การลองใหม่จะลบข้อผิดพลาดของ assistant ที่ล้มเหลวออกจาก **runtime context** ก่อนที่จะ re-continue แต่ประวัติ session ยังคงเก็บรายการข้อผิดพลาดนั้นไว้
- `RpcSessionState` ในปัจจุบันเปิดเผย `autoCompactionEnabled` แต่ไม่มีฟิลด์ `autoRetryEnabled` ผู้เรียก RPC ต้องติดตามสถานะการสลับของตนเองหรือสอบถามการตั้งค่าผ่าน API อื่น
