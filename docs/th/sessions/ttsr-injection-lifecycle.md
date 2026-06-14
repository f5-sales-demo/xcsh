---
title: วงจรชีวิตการฉีด TTSR
description: >-
  วงจรชีวิตการฉีด TTSR (tool-use, tool-result, system-reminder)
  สำหรับการจัดการบริบท
sidebar:
  order: 9
  label: การฉีด TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# วงจรชีวิตการฉีด TTSR

เอกสารนี้ครอบคลุมเส้นทางรันไทม์ปัจจุบันของ Time Traveling Stream Rules (TTSR) ตั้งแต่การค้นพบกฎไปจนถึงการหยุดกระแสข้อมูล การฉีดลองใหม่ การแจ้งเตือนส่วนขยาย และการจัดการสถานะเซสชัน

## ไฟล์การนำไปใช้งาน

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. ฟีดการค้นพบและการลงทะเบียนกฎ

เมื่อสร้างเซสชัน `createAgentSession()` จะโหลดกฎที่ค้นพบทั้งหมดและสร้าง `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### พฤติกรรมการตัดรายการซ้ำก่อนลงทะเบียน

`loadCapability("rules")` ตัดรายการซ้ำโดยใช้ `rule.name` ด้วยหลักการ first-wins (ลำดับความสำคัญของผู้ให้บริการที่สูงกว่าก่อน) รายการที่ซ้ำซ้อนซึ่งถูกบดบังจะถูกลบออกก่อนการลงทะเบียน TTSR

### พฤติกรรมของ `TtsrManager.addRule()`

การลงทะเบียนจะถูกข้ามเมื่อ:

- `rule.ttsrTrigger` ไม่มีอยู่
- กฎที่มี `rule.name` เดียวกันถูกลงทะเบียนในตัวจัดการนี้แล้ว
- regex ไม่สามารถคอมไพล์ได้ (`new RegExp(rule.ttsrTrigger)` เกิดข้อผิดพลาด)

ทริกเกอร์ regex ที่ไม่ถูกต้องจะถูกบันทึกเป็นคำเตือนและถูกเพิกเฉย การเริ่มต้นเซสชันจะดำเนินต่อไป

### ข้อควรระวังเกี่ยวกับการตั้งค่า

`TtsrSettings.enabled` ถูกโหลดเข้าสู่ตัวจัดการแต่ไม่ได้รับการตรวจสอบในการควบคุมรันไทม์ในปัจจุบัน หากกฎมีอยู่ การจับคู่จะยังคงทำงาน

## 2. วงจรชีวิตของตัวตรวจสอบการสตรีม

การตรวจจับ TTSR ทำงานภายใน `AgentSession.#handleAgentEvent`

### เริ่มต้นเทิร์น

เมื่อ `turn_start` บัฟเฟอร์กระแสข้อมูลจะถูกรีเซ็ต:

- `ttsrManager.resetBuffer()`

### ระหว่างการสตรีม (`message_update`)

เมื่อการอัปเดตจากผู้ช่วยมาถึงและมีกฎอยู่:

- ตรวจสอบ `text_delta` และ `toolcall_delta`
- ผนวก delta เข้าสู่บัฟเฟอร์ของตัวจัดการ
- เรียก `check(buffer)`

`check()` จะวนซ้ำกฎที่ลงทะเบียนและส่งคืนกฎที่ตรงกันทั้งหมดซึ่งผ่านนโยบายการทำซ้ำ (`#canTrigger`)

## 3. การตัดสินใจเรื่องทริกเกอร์และเส้นทางการยกเลิกทันที

เมื่อกฎตั้งแต่หนึ่งกฎขึ้นไปตรงกัน:

1. `markInjected(matches)` บันทึกชื่อกฎในสถานะการฉีดของตัวจัดการ
2. กฎที่ตรงกันจะถูกจัดคิวใน `#pendingTtsrInjections`
3. `#ttsrAbortPending = true`
4. `agent.abort()` ถูกเรียกทันที
5. เหตุการณ์ `ttsr_triggered` ถูกส่งออกแบบอะซิงโครนัส (fire-and-forget)
6. งานลองใหม่ถูกตั้งเวลาผ่าน `setTimeout(..., 50)`

การยกเลิกไม่ได้ถูกบล็อกโดยการเรียกกลับของส่วนขยาย

## 4. การตั้งเวลาลองใหม่ โหมดบริบท และการฉีดตัวเตือน

หลังจากหมดเวลา 50ms:

1. `#ttsrAbortPending = false`
2. อ่าน `ttsrManager.getSettings().contextMode`
3. หาก `contextMode === "discard"` ให้ทิ้งผลลัพธ์บางส่วนของผู้ช่วยด้วย `agent.popMessage()`
4. สร้างเนื้อหาการฉีดจากกฎที่รอดำเนินการโดยใช้เทมเพลต `ttsr-interrupt.md`
5. ผนวกข้อความผู้ใช้สังเคราะห์ที่มีบล็อก `<system-interrupt ...>` หนึ่งบล็อกต่อกฎ
6. เรียก `agent.continue()` เพื่อลองสร้างใหม่

เพย์โหลดของเทมเพลตคือ:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

การฉีดที่รอดำเนินการจะถูกล้างหลังจากการสร้างเนื้อหา

### พฤติกรรม `contextMode` ต่อผลลัพธ์บางส่วน

- `discard`: ข้อความผู้ช่วยที่บางส่วน/ถูกยกเลิกจะถูกลบออกก่อนลองใหม่
- `keep`: ผลลัพธ์บางส่วนของผู้ช่วยยังคงอยู่ในสถานะการสนทนา ตัวเตือนจะถูกผนวกต่อท้าย

## 5. นโยบายการทำซ้ำและตรรกะช่วงห่าง

`TtsrManager` ติดตาม `#messageCount` และ `lastInjectedAt` ต่อกฎ

### `repeatMode: "once"`

กฎสามารถทริกเกอร์ได้ครั้งเดียวหลังจากมีบันทึกการฉีด

### `repeatMode: "after-gap"`

กฎสามารถทริกเกอร์ซ้ำได้เฉพาะเมื่อ:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` เพิ่มขึ้นเมื่อ `turn_end` ดังนั้นช่วงห่างจะวัดเป็นจำนวนเทิร์นที่เสร็จสมบูรณ์ ไม่ใช่ชิ้นส่วนของกระแสข้อมูล

## 6. การส่งเหตุการณ์และพื้นผิวส่วนขยาย/hook

### เหตุการณ์เซสชัน

`AgentSessionEvent` ประกอบด้วย:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### ตัวรันส่วนขยาย

`#emitSessionEvent()` ส่งต่อเหตุการณ์ไปยัง:

- ผู้ฟังส่วนขยาย (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- ผู้สมัครรับข้อมูลเซสชันภายในเครื่อง

### การกำหนดประเภท hook และเครื่องมือที่กำหนดเอง

- API ส่วนขยายเปิดเผย `on("ttsr_triggered", ...)`
- API hook เปิดเผย `on("ttsr_triggered", ...)`
- เครื่องมือที่กำหนดเองรับ `onSession({ reason: "ttsr_triggered", rules })`

### ความแตกต่างในการแสดงผลโหมดอินเทอร์แอคทีฟ

โหมดอินเทอร์แอคทีฟใช้ `session.isTtsrAbortPending` เพื่อระงับการแสดงเหตุผลการหยุดของผู้ช่วยที่ถูกยกเลิกเป็นความล้มเหลวที่มองเห็นได้ในระหว่างการหยุดชะงักของ TTSR และแสดง `TtsrNotificationComponent` เมื่อเหตุการณ์มาถึง

## 7. สถานะการคงอยู่และการกลับมาดำเนินการ (การนำไปใช้งานปัจจุบัน)

`SessionManager` มีการสนับสนุนสคีมาเต็มรูปแบบสำหรับการคงอยู่ของกฎที่ฉีดแล้ว:

- ประเภทรายการ: `ttsr_injection`
- API เพิ่มเติม: `appendTtsrInjection(ruleNames)`
- API สอบถาม: `getInjectedTtsrRules()`
- การสร้างบริบทใหม่รวมถึง `SessionContext.injectedTtsrRules`

`TtsrManager` ยังรองรับการกู้คืนผ่าน `restoreInjected(ruleNames)`

### สถานะการเชื่อมต่อในปัจจุบัน

ในเส้นทางรันไทม์ปัจจุบัน:

- `AgentSession` ไม่ได้ผนวกรายการ `ttsr_injection` เมื่อ TTSR ทริกเกอร์
- `createAgentSession()` ไม่ได้กู้คืน `existingSession.injectedTtsrRules` กลับเข้าสู่ `ttsrManager`

ผลกระทบสุทธิ: การระงับกฎที่ฉีดแล้วจะถูกบังคับใช้ในหน่วยความจำสำหรับกระบวนการที่ทำงานอยู่ แต่ปัจจุบันยังไม่ได้รับการคงอยู่/กู้คืนข้ามการโหลด/กลับมาดำเนินการเซสชันในเส้นทางนี้

## 8. ขอบเขตการแข่งขันและการรับประกันลำดับ

### การยกเลิกเทียบกับการเรียกกลับลองใหม่

- การยกเลิกเป็นแบบซิงโครนัสจากมุมมองของตัวจัดการ TTSR (`agent.abort()` ถูกเรียกทันที)
- การลองใหม่ถูกเลื่อนออกไปด้วยตัวจับเวลา (`50ms`)
- การแจ้งเตือนส่วนขยายเป็นแบบอะซิงโครนัสและตั้งใจไม่รอก่อนการตั้งเวลายกเลิก/ลองใหม่

### การจับคู่หลายรายการในหน้าต่างกระแสข้อมูลเดียวกัน

`check()` ส่งคืนกฎที่มีสิทธิ์ตรงกันทั้งหมดในปัจจุบัน กฎเหล่านี้จะถูกฉีดเป็นชุดในข้อความลองใหม่ครั้งถัดไป

### ระหว่างการยกเลิกและการดำเนินการต่อ

ในช่วงหน้าต่างตัวจับเวลา สถานะอาจเปลี่ยนแปลงได้ (การหยุดชะงักของผู้ใช้ การดำเนินการโหมด เหตุการณ์เพิ่มเติม) การเรียกลองใหม่เป็นแบบ best-effort: `agent.continue().catch(() => {})` กลืนข้อผิดพลาดที่ตามมา

## 9. สรุปกรณีขอบ

- regex `ttsr_trigger` ที่ไม่ถูกต้อง: ถูกข้ามพร้อมคำเตือน กฎอื่นๆ ยังคงดำเนินต่อไป
- ชื่อกฎที่ซ้ำกันในเลเยอร์ความสามารถ: รายการที่ซ้ำซึ่งมีลำดับความสำคัญต่ำกว่าจะถูกบดบังก่อนการลงทะเบียน
- ชื่อที่ซ้ำกันในเลเยอร์ตัวจัดการ: การลงทะเบียนครั้งที่สองจะถูกเพิกเฉย
- `contextMode: "keep"`: ผลลัพธ์บางส่วนที่ละเมิดอาจยังคงอยู่ในบริบทก่อนการลองใหม่ด้วยตัวเตือน
- การทำซ้ำหลังช่วงห่างขึ้นอยู่กับการเพิ่มจำนวนเทิร์นเมื่อ `turn_end` ชิ้นส่วนกลางเทิร์นจะไม่เพิ่มตัวนับช่วงห่าง
