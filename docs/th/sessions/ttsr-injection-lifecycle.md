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

เอกสารนี้ครอบคลุมเส้นทางรันไทม์ปัจจุบันของ Time Traveling Stream Rules (TTSR) ตั้งแต่การค้นพบกฎไปจนถึงการขัดจังหวะสตรีม การฉีดรีทราย การแจ้งเตือนส่วนขยาย และการจัดการสถานะเซสชัน

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

### พฤติกรรมการกำจัดรายการซ้ำก่อนการลงทะเบียน

`loadCapability("rules")` กำจัดรายการซ้ำตาม `rule.name` ด้วยหลักการตัวแรกชนะ (ผู้ให้บริการที่มีลำดับความสำคัญสูงกว่ามาก่อน) รายการซ้ำที่ถูกบดบังจะถูกลบออกก่อนการลงทะเบียน TTSR

### พฤติกรรมของ `TtsrManager.addRule()`

การลงทะเบียนจะถูกข้ามเมื่อ:

- `rule.ttsrTrigger` ไม่มีอยู่
- กฎที่มี `rule.name` เดียวกันถูกลงทะเบียนไว้แล้วในตัวจัดการนี้
- regex ไม่สามารถคอมไพล์ได้ (`new RegExp(rule.ttsrTrigger)` โยนข้อผิดพลาด)

ทริกเกอร์ regex ที่ไม่ถูกต้องจะถูกบันทึกเป็นคำเตือนและถูกเพิกเฉย; การเริ่มต้นเซสชันจะดำเนินต่อไป

### ข้อควรระวังเกี่ยวกับการตั้งค่า

`TtsrSettings.enabled` จะถูกโหลดเข้าสู่ตัวจัดการ แต่ปัจจุบันไม่ได้ถูกตรวจสอบในการควบคุมรันไทม์ หากมีกฎอยู่ การจับคู่จะยังคงทำงานต่อไป

## 2. วงจรชีวิตการตรวจสอบสตรีม

การตรวจจับ TTSR ทำงานภายใน `AgentSession.#handleAgentEvent`

### การเริ่มต้นเทิร์น

เมื่อ `turn_start` บัฟเฟอร์สตรีมจะถูกรีเซ็ต:

- `ttsrManager.resetBuffer()`

### ระหว่างสตรีม (`message_update`)

เมื่อการอัปเดตของผู้ช่วยมาถึงและมีกฎอยู่:

- ตรวจสอบ `text_delta` และ `toolcall_delta`
- เพิ่มเดลตาเข้าสู่บัฟเฟอร์ของตัวจัดการ
- เรียก `check(buffer)`

`check()` วนซ้ำผ่านกฎที่ลงทะเบียนไว้และส่งคืนกฎที่ตรงกันทั้งหมดที่ผ่านนโยบายการทำซ้ำ (`#canTrigger`)

## 3. การตัดสินใจทริกเกอร์และเส้นทางยกเลิกทันที

เมื่อมีกฎหนึ่งข้อหรือมากกว่าตรงกัน:

1. `markInjected(matches)` บันทึกชื่อกฎในสถานะการฉีดของตัวจัดการ
2. กฎที่ตรงกันจะถูกจัดคิวใน `#pendingTtsrInjections`
3. `#ttsrAbortPending = true`
4. `agent.abort()` ถูกเรียกทันที
5. อีเวนต์ `ttsr_triggered` ถูกปล่อยแบบอะซิงโครนัส (ยิงแล้วลืม)
6. งานรีทรายถูกกำหนดเวลาผ่าน `setTimeout(..., 50)`

การยกเลิกไม่ถูกบล็อกโดยการเรียกกลับของส่วนขยาย

## 4. การกำหนดเวลารีทราย โหมดบริบท และการฉีดตัวเตือน

หลังจากหมดเวลา 50ms:

1. `#ttsrAbortPending = false`
2. อ่าน `ttsrManager.getSettings().contextMode`
3. หาก `contextMode === "discard"` ให้ทิ้งเอาต์พุตบางส่วนของผู้ช่วยด้วย `agent.popMessage()`
4. สร้างเนื้อหาการฉีดจากกฎที่รอดำเนินการโดยใช้เทมเพลต `ttsr-interrupt.md`
5. เพิ่มข้อความผู้ใช้สังเคราะห์ที่ประกอบด้วยบล็อก `<system-interrupt ...>` หนึ่งบล็อกต่อกฎ
6. เรียก `agent.continue()` เพื่อรีทรายการสร้าง

เพย์โหลดของเทมเพลตคือ:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

การฉีดที่รอดำเนินการจะถูกล้างหลังจากการสร้างเนื้อหา

### พฤติกรรม `contextMode` ต่อเอาต์พุตบางส่วน

- `discard`: ข้อความผู้ช่วยที่ไม่สมบูรณ์/ถูกยกเลิกจะถูกลบออกก่อนรีทราย
- `keep`: เอาต์พุตบางส่วนของผู้ช่วยยังคงอยู่ในสถานะการสนทนา; ตัวเตือนจะถูกเพิ่มต่อท้าย

## 5. นโยบายการทำซ้ำและตรรกะช่องว่าง

`TtsrManager` ติดตาม `#messageCount` และ `lastInjectedAt` ของแต่ละกฎ

### `repeatMode: "once"`

กฎสามารถทริกเกอร์ได้เพียงครั้งเดียวหลังจากมีบันทึกการฉีดแล้ว

### `repeatMode: "after-gap"`

กฎสามารถทริกเกอร์ซ้ำได้เฉพาะเมื่อ:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` เพิ่มขึ้นเมื่อ `turn_end` ดังนั้นช่องว่างจะวัดเป็นเทิร์นที่เสร็จสมบูรณ์ ไม่ใช่ชิ้นส่วนสตรีม

## 6. การปล่อยอีเวนต์และพื้นผิวส่วนขยาย/ฮุก

### อีเวนต์เซสชัน

`AgentSessionEvent` รวมถึง:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### ตัวรันส่วนขยาย

`#emitSessionEvent()` ส่งอีเวนต์ไปยัง:

- ตัวฟังส่วนขยาย (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- ผู้สมัครรับข้อมูลเซสชันในเครื่อง

### การกำหนดประเภทฮุกและเครื่องมือกำหนดเอง

- API ส่วนขยายเปิดเผย `on("ttsr_triggered", ...)`
- API ฮุกเปิดเผย `on("ttsr_triggered", ...)`
- เครื่องมือกำหนดเองรับ `onSession({ reason: "ttsr_triggered", rules })`

### ความแตกต่างในการเรนเดอร์โหมดโต้ตอบ

โหมดโต้ตอบใช้ `session.isTtsrAbortPending` เพื่อระงับการแสดงเหตุผลการหยุดของผู้ช่วยที่ถูกยกเลิกเป็นความล้มเหลวที่มองเห็นได้ระหว่างการขัดจังหวะ TTSR และเรนเดอร์ `TtsrNotificationComponent` เมื่ออีเวนต์มาถึง

## 7. การคงอยู่และสถานะการกลับมาทำงาน (การนำไปใช้งานปัจจุบัน)

`SessionManager` มีการรองรับสคีมาเต็มรูปแบบสำหรับการคงอยู่ของกฎที่ถูกฉีด:

- ประเภทรายการ: `ttsr_injection`
- API เพิ่ม: `appendTtsrInjection(ruleNames)`
- API สอบถาม: `getInjectedTtsrRules()`
- การสร้างบริบทใหม่รวมถึง `SessionContext.injectedTtsrRules`

`TtsrManager` ยังรองรับการกู้คืนผ่าน `restoreInjected(ruleNames)`

### สถานะการเชื่อมต่อปัจจุบัน

ในเส้นทางรันไทม์ปัจจุบัน:

- `AgentSession` ไม่ได้เพิ่มรายการ `ttsr_injection` เมื่อ TTSR ทริกเกอร์
- `createAgentSession()` ไม่ได้กู้คืน `existingSession.injectedTtsrRules` กลับเข้าสู่ `ttsrManager`

ผลลัพธ์สุทธิ: การระงับกฎที่ถูกฉีดจะถูกบังคับใช้ในหน่วยความจำสำหรับกระบวนการที่กำลังทำงาน แต่ปัจจุบันไม่ได้ถูกคงอยู่/กู้คืนข้ามการโหลดซ้ำ/กลับมาทำงานของเซสชันผ่านเส้นทางนี้

## 8. ขอบเขตของสภาวะการแข่งขันและการรับประกันลำดับ

### การยกเลิกเทียบกับการเรียกกลับรีทราย

- การยกเลิกเป็นแบบซิงโครนัสจากมุมมองของตัวจัดการ TTSR (`agent.abort()` ถูกเรียกทันที)
- การรีทรายถูกเลื่อนออกไปด้วยตัวจับเวลา (`50ms`)
- การแจ้งเตือนส่วนขยายเป็นแบบอะซิงโครนัสและตั้งใจไม่รอก่อนการกำหนดเวลาการยกเลิก/รีทราย

### การจับคู่หลายรายการในหน้าต่างสตรีมเดียวกัน

`check()` ส่งคืนกฎที่มีสิทธิ์ตรงกันทั้งหมดในปัจจุบัน กฎเหล่านั้นจะถูกฉีดเป็นชุดในข้อความรีทรายถัดไป

### ระหว่างการยกเลิกและการดำเนินต่อ

ระหว่างช่วงเวลาของตัวจับเวลา สถานะอาจเปลี่ยนแปลง (การขัดจังหวะของผู้ใช้ การดำเนินการโหมด อีเวนต์เพิ่มเติม) การเรียกรีทรายเป็นแบบพยายามอย่างดีที่สุด: `agent.continue().catch(() => {})` จะกลืนข้อผิดพลาดที่ตามมา

## 9. สรุปกรณีขอบ

- regex `ttsr_trigger` ที่ไม่ถูกต้อง: ถูกข้ามพร้อมคำเตือน; กฎอื่นๆ ดำเนินต่อ
- ชื่อกฎซ้ำกันที่ชั้นความสามารถ: รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะถูกบดบังก่อนการลงทะเบียน
- ชื่อซ้ำกันที่ชั้นตัวจัดการ: การลงทะเบียนครั้งที่สองจะถูกเพิกเฉย
- `contextMode: "keep"`: เอาต์พุตที่ละเมิดบางส่วนอาจยังคงอยู่ในบริบทก่อนการรีทรายตัวเตือน
- การทำซ้ำหลังช่องว่างขึ้นอยู่กับการเพิ่มจำนวนเทิร์นเมื่อ `turn_end`; ชิ้นส่วนกลางเทิร์นไม่เพิ่มตัวนับช่องว่าง
