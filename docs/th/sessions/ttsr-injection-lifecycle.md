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

เอกสารนี้ครอบคลุมเส้นทางรันไทม์ของ Time Traveling Stream Rules (TTSR) ในปัจจุบัน ตั้งแต่การค้นพบกฎจนถึงการหยุดสตรีม การฉีดเพื่อลองใหม่ การแจ้งเตือนส่วนขยาย และการจัดการสถานะเซสชัน

## ไฟล์ที่เกี่ยวข้องกับการใช้งาน

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

### พฤติกรรมการกำจัดรายการซ้ำก่อนลงทะเบียน

`loadCapability("rules")` กำจัดรายการซ้ำโดยใช้ `rule.name` โดยให้ค่าแรกที่พบเป็นผู้ชนะ (ลำดับความสำคัญของผู้ให้บริการที่สูงกว่าก่อน) รายการซ้ำที่ถูกบดบังจะถูกลบออกก่อนการลงทะเบียน TTSR

### พฤติกรรมของ `TtsrManager.addRule()`

การลงทะเบียนจะถูกข้ามเมื่อ:

- `rule.ttsrTrigger` ไม่มีอยู่
- กฎที่มี `rule.name` เดียวกันได้รับการลงทะเบียนในตัวจัดการนี้แล้ว
- regex คอมไพล์ไม่สำเร็จ (`new RegExp(rule.ttsrTrigger)` ส่งข้อผิดพลาด)

ทริกเกอร์ regex ที่ไม่ถูกต้องจะถูกบันทึกเป็นคำเตือนและถูกละเว้น โดยการเริ่มต้นเซสชันยังคงดำเนินต่อไป

### ข้อควรระวังเกี่ยวกับการตั้งค่า

`TtsrSettings.enabled` ถูกโหลดเข้าในตัวจัดการ แต่ปัจจุบันยังไม่ได้รับการตรวจสอบในการกำหนดเส้นทางรันไทม์ หากกฎมีอยู่ การจับคู่จะยังคงทำงาน

## 2. วงจรชีวิตของตัวตรวจสอบสตรีม

การตรวจจับ TTSR ทำงานภายใน `AgentSession.#handleAgentEvent`

### การเริ่มต้นเทิร์น

เมื่อ `turn_start` บัฟเฟอร์สตรีมจะถูกรีเซ็ต:

- `ttsrManager.resetBuffer()`

### ระหว่างสตรีม (`message_update`)

เมื่อการอัปเดตจากผู้ช่วยมาถึงและมีกฎอยู่:

- ตรวจสอบ `text_delta` และ `toolcall_delta`
- เพิ่ม delta เข้าในบัฟเฟอร์ของตัวจัดการ
- เรียก `check(buffer)`

`check()` วนซ้ำกฎที่ลงทะเบียนและส่งคืนกฎที่ตรงกันทั้งหมดที่ผ่านนโยบายการซ้ำ (`#canTrigger`)

## 3. การตัดสินใจทริกเกอร์และเส้นทางการยกเลิกทันที

เมื่อกฎหนึ่งกฎหรือมากกว่าตรงกัน:

1. `markInjected(matches)` บันทึกชื่อกฎในสถานะการฉีดของตัวจัดการ
2. กฎที่ตรงกันจะถูกเพิ่มในคิวของ `#pendingTtsrInjections`
3. `#ttsrAbortPending = true`
4. `agent.abort()` ถูกเรียกทันที
5. เหตุการณ์ `ttsr_triggered` ถูกส่งออกแบบอะซิงโครนัส (fire-and-forget)
6. งานลองใหม่ถูกกำหนดเวลาผ่าน `setTimeout(..., 50)`

การยกเลิกไม่ถูกบล็อกโดย callback ของส่วนขยาย

## 4. การกำหนดเวลาลองใหม่ โหมดบริบท และการฉีดตัวเตือน

หลังจาก timeout 50ms:

1. `#ttsrAbortPending = false`
2. อ่านค่า `ttsrManager.getSettings().contextMode`
3. ถ้า `contextMode === "discard"` ให้ทิ้งผลลัพธ์จากผู้ช่วยที่ไม่สมบูรณ์ด้วย `agent.popMessage()`
4. สร้างเนื้อหาการฉีดจากกฎที่รอดำเนินการโดยใช้เทมเพลต `ttsr-interrupt.md`
5. เพิ่มข้อความผู้ใช้สังเคราะห์ที่มีบล็อก `<system-interrupt ...>` หนึ่งบล็อกต่อกฎ
6. เรียก `agent.continue()` เพื่อลองสร้างใหม่

เพย์โหลดเทมเพลตคือ:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

การฉีดที่รอดำเนินการจะถูกล้างหลังจากสร้างเนื้อหา

### พฤติกรรมของ `contextMode` บนผลลัพธ์บางส่วน

- `discard`: ข้อความผู้ช่วยที่บางส่วน/ถูกยกเลิกจะถูกลบออกก่อนลองใหม่
- `keep`: ผลลัพธ์บางส่วนจากผู้ช่วยยังคงอยู่ในสถานะการสนทนา โดยตัวเตือนจะถูกเพิ่มต่อท้าย

## 5. นโยบายการซ้ำและลอจิกของช่องว่าง

`TtsrManager` ติดตาม `#messageCount` และ `lastInjectedAt` ต่อกฎ

### `repeatMode: "once"`

กฎสามารถทริกเกอร์ได้เพียงครั้งเดียวหลังจากมีบันทึกการฉีด

### `repeatMode: "after-gap"`

กฎสามารถทริกเกอร์ซ้ำได้เฉพาะเมื่อ:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` เพิ่มขึ้นเมื่อ `turn_end` ดังนั้นช่องว่างจะวัดเป็นจำนวนเทิร์นที่เสร็จสิ้น ไม่ใช่ chunks ของสตรีม

## 6. การส่งเหตุการณ์และพื้นที่ผิวของส่วนขยาย/hook

### เหตุการณ์เซสชัน

`AgentSessionEvent` รวมถึง:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### ตัวรันส่วนขยาย

`#emitSessionEvent()` ส่งเหตุการณ์ไปยัง:

- ผู้ฟังส่วนขยาย (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- ผู้สมัครสมาชิกเซสชันในเครื่อง

### การพิมพ์ hook และเครื่องมือกำหนดเอง

- API ส่วนขยายเปิดเผย `on("ttsr_triggered", ...)`
- API hook เปิดเผย `on("ttsr_triggered", ...)`
- เครื่องมือกำหนดเองรับ `onSession({ reason: "ttsr_triggered", rules })`

### ความแตกต่างของการแสดงผลในโหมดโต้ตอบ

โหมดโต้ตอบใช้ `session.isTtsrAbortPending` เพื่อระงับการแสดงเหตุผลการหยุดของผู้ช่วยที่ถูกยกเลิกเป็นความล้มเหลวที่มองเห็นได้ระหว่างการขัดจังหวะ TTSR และแสดง `TtsrNotificationComponent` เมื่อเหตุการณ์มาถึง

## 7. สถานะการคงอยู่และการเริ่มต้นใหม่ (การใช้งานปัจจุบัน)

`SessionManager` มีการรองรับ schema อย่างสมบูรณ์สำหรับการคงอยู่ของกฎที่ถูกฉีด:

- ประเภทรายการ: `ttsr_injection`
- API การเพิ่ม: `appendTtsrInjection(ruleNames)`
- API การค้นหา: `getInjectedTtsrRules()`
- การสร้างบริบทใหม่รวมถึง `SessionContext.injectedTtsrRules`

`TtsrManager` ยังรองรับการกู้คืนผ่าน `restoreInjected(ruleNames)`

### สถานะการเชื่อมต่อปัจจุบัน

ในเส้นทางรันไทม์ปัจจุบัน:

- `AgentSession` ไม่ต่อท้ายรายการ `ttsr_injection` เมื่อ TTSR ทริกเกอร์
- `createAgentSession()` ไม่กู้คืน `existingSession.injectedTtsrRules` กลับเข้าไปใน `ttsrManager`

ผลสุทธิ: การระงับกฎที่ถูกฉีดถูกบังคับใช้ในหน่วยความจำสำหรับกระบวนการที่ทำงานอยู่ แต่ปัจจุบันยังไม่ได้รับการคงอยู่/กู้คืนข้ามการโหลด/เริ่มต้นเซสชันใหม่โดยเส้นทางนี้

## 8. ขอบเขตของสภาวะแข่งขันและการรับประกันลำดับ

### การยกเลิก vs callback การลองใหม่

- การยกเลิกเป็นแบบซิงโครนัสจากมุมมองของตัวจัดการ TTSR (`agent.abort()` ถูกเรียกทันที)
- การลองใหม่ถูกเลื่อนออกไปด้วยตัวตั้งเวลา (`50ms`)
- การแจ้งเตือนส่วนขยายเป็นแบบอะซิงโครนัสและตั้งใจไม่รอ await ก่อนการยกเลิก/กำหนดเวลาลองใหม่

### การจับคู่หลายรายการในหน้าต่างสตรีมเดียวกัน

`check()` ส่งคืนกฎที่มีสิทธิ์ตรงกันทั้งหมดในขณะนั้น โดยจะถูกฉีดเป็นชุดในข้อความลองใหม่ถัดไป

### ระหว่างการยกเลิกและการดำเนินการต่อ

ระหว่างหน้าต่างตัวตั้งเวลา สถานะอาจเปลี่ยนแปลงได้ (การขัดจังหวะจากผู้ใช้ การกระทำของโหมด เหตุการณ์เพิ่มเติม) การเรียกลองใหม่เป็นแบบ best-effort: `agent.continue().catch(() => {})` กลืนข้อผิดพลาดที่ตามมา

## 9. สรุปกรณีขอบ

- `ttsr_trigger` regex ไม่ถูกต้อง: ถูกข้ามพร้อมคำเตือน โดยกฎอื่นยังคงดำเนินต่อไป
- ชื่อกฎซ้ำในชั้น capability: รายการที่มีลำดับความสำคัญต่ำกว่าจะถูกบดบังก่อนการลงทะเบียน
- ชื่อซ้ำในชั้นตัวจัดการ: การลงทะเบียนครั้งที่สองจะถูกละเว้น
- `contextMode: "keep"`: ผลลัพธ์บางส่วนที่ละเมิดอาจยังคงอยู่ในบริบทก่อนการลองใหม่ด้วยตัวเตือน
- การซ้ำหลังช่องว่างขึ้นอยู่กับการเพิ่มจำนวนเทิร์นที่ `turn_end` โดย chunks กลางเทิร์นไม่ได้เพิ่มตัวนับช่องว่าง
